const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { partDurationSeconds, libraryKey, libraryStorage, parseLibraryAccess } = require('../song-beta.js');

function makeController(overrides = {}, stored = {}, navigator = {}) {
    const elements = new Map();
    const document = { getElementById(id) {
        if (!elements.has(id)) elements.set(id, { value: '', listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; } });
        return elements.get(id);
    } };
    const data = new Map(Object.entries(stored));
    const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
    const timers = new Map();
    let nextTimer = 0;
    const context = {
        console, Uint8Array, Map, Set, Promise, DOMException, AbortController, navigator,
        setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
        clearTimeout(id) { timers.delete(id); },
        crypto: webcrypto,
        location: { origin: 'http://test' },
        fetch: async () => { throw new Error('Unexpected network request'); }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../song-beta-storage.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../song-beta-locks.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../song-beta.js'), 'utf8'), context);
    let clock = 0;
    const calls = [];
    let finished;
    let endTime = Infinity;
    const adapter = {
        ready: async () => {},
        prepare: part => part,
        recall: (part, options) => { calls.push(['recall', part, options]); return clock; },
        capture: async () => new Blob(['complete snapshot']),
        clockRunning: () => true,
        scheduleSong(parts, renders, onEnded) {
            const entries = [];
            let origin = clock;
            for (const part of parts) {
                const end = origin + partDurationSeconds(part);
                entries.push({ id: part.id, start: origin, end });
                calls.push(['scheduled', part.id, origin, end]);
                origin = end;
            }
            endTime = origin;
            finished = onEnded;
            return { entries, stop: () => calls.push(['stopScheduled']) };
        },
        stop: () => calls.push(['stop']),
        running: () => true,
        time: () => clock,
        ...overrides
    };
    adapter.scheduleStoredSong ||= async (parts, load, onEnded, signal, destination, options) => {
        calls.push(['storedOptions', options]);
        return adapter.scheduleSong(parts, null, onEnded);
    };
    const storedRenders = new Map();
    const renderStore = { get: async key => storedRenders.get(key), put: async (key, bytes) => storedRenders.set(key, bytes), delete: async key => storedRenders.delete(key), warning: '' };
    const controller = new context.MygrainSongBeta.Controller(adapter, { document, storage, crypto: webcrypto, renderStore });
    controller.canEditSong = () => true;
    controller.renderLockUi = () => {};
    controller.lease.watch = async () => {};
    controller.lease.acquire = async () => controller.song;
    controller.lease.release = async () => {};
    controller.readPart = async part => {
        const info = { snapshot: {}, decodedBytes: 0, body: new ArrayBuffer(0) };
        controller.snapshots.set(part.id, { snapshot: {}, contentSha256: part.contentSha256 || part.sha256 });
        return info;
    };
    controller.prepareRender = async part => { controller.renders.set(part.id, {}); controller.renderSources.set(part.id, part.contentSha256 || part.sha256); };
    controller.render = () => {};
    controller.status = message => calls.push(['status', message]);
    return { controller, calls, elements, timers, context, data, setClock(value) { clock = value; if (clock >= endTime) finished?.('finished'); } };
}

const first = { id: 'intro', name: 'Intro', bpm: 120, patternSteps: 16, repeats: 2 };
const second = { id: 'verse', name: 'Verse', bpm: 60, patternSteps: 8, repeats: 1 };

test('phone preparation budgets cover Android as well as iPhone/iPad and reject oversized sources before downloading or decoding', async () => {
    for (const navigator of [{ userAgent: 'Android' }, { userAgent: 'iPhone' }, { platform: 'MacIntel', maxTouchPoints: 5 }]) {
        const { controller } = makeController({ decode: () => assert.fail('Unsafe decode') }, {}, navigator);
        assert.equal(controller.memoryBudget.limitBytes, 96 * 1048576);
        assert.equal(controller.armConcurrency, 1);
        assert.equal(controller.renderLimitBytes, 24 * 1048576);
        controller.partManifests = true;
        const part = { ...first, sha256: 'huge', bytes: 70 * 1048576 };
        controller.song = { id: 'song', parts: [part] };
        controller.snapshots.set(part.id, { snapshot: {}, decodedBytes: 140 * 1048576, contentSha256: 'huge' });
        controller.readPart = async () => assert.fail('Unsafe archive download');
        await assert.rejects(controller.loadPart(part), /safety budget/);
        assert.equal(controller.memoryBudget.bytes, 0);
        assert.equal(controller.cache.size, 0);
        assert.equal(controller.song.parts[0], part);
    }
});

test('active preparation evicts hot renders without forgetting reusable saved audio', async () => {
    const { controller } = makeController();
    const limit = controller.memoryBudget.limitBytes;
    const buffer = { length: limit / 8, numberOfChannels: 1 };
    controller.renders.set(first.id, buffer); controller.renderBytes = limit / 2;
    controller.renderSources.set(first.id, 'unchanged');
    const release = await controller.reservePreparation(limit * .75);
    assert.equal(controller.renderBytes, 0);
    assert.equal(controller.renders.size, 0);
    assert.equal(controller.renderSources.get(first.id), 'unchanged');
    release();
    assert.equal(controller.memoryBudget.bytes, 0);
});

test('an individual oversized render is not retained beyond the hot-cache bound', () => {
    const { controller } = makeController();
    controller.renderLimitBytes = 1024;
    const buffer = { duration: 2, sampleRate: 48000, length: 96000, numberOfChannels: 2 };
    controller.retainRender(first, buffer);
    assert.equal(controller.renderBytes, 0);
    assert.equal(controller.renders.size, 0);
});

test('memory reservations include encoded source clones, source buffers, render capture/encoding and renderer headroom', () => {
    const { controller } = makeController({ context: () => ({ sampleRate: 48000 }) });
    const part = { ...first, bytes: 1000 };
    const sourceOnly = controller.preparationBytes(part, { decodedBytes: 4000 }, false);
    assert.equal(sourceOnly, 16 * 1048576 + 2000 + 8000);
    assert.equal(controller.preparationBytes(part, { decodedBytes: 4000 }), sourceOnly + 2 * 48000 * 8 * 4);
});

function compatibilityController() {
    const fixture = makeController({ upgradePart: async () => new Blob(['normalized archive']) });
    const { controller, calls } = fixture;
    const part = { ...first, id: '1'.repeat(32), sha256: 'a'.repeat(64), contentSha256: 'b'.repeat(64), revision: 1, colour: '#123456' };
    part.render = { version: 1, sourceSha256: part.sha256, sha256: 'c'.repeat(64), bytes: 64,
        keyboardVersion: 1, grainVersion: 4, portableVersion: 1 };
    const reference = { ...part, id: '2'.repeat(32), sourcePartId: part.id, repeats: 5 };
    controller.song = { id: 'compatibility-12345678', revision: 4, parts: [reference, part] };
    controller.songs = [controller.song];
    const snapshot = { state: { modes: { bastardLoopKEnabled: false } }, extra: { freezeStateVersion: 1 } };
    let remote = structuredClone(controller.song);
    let writable = false;
    const history = [];
    const requests = [];
    const renderBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    controller.canEditSong = () => writable;
    controller.beginEditing = async () => { calls.push(['acquire']); writable = true; };
    controller.readPart = async entry => {
        const info = { snapshot, decodedBytes: 0, body: new ArrayBuffer(0), upgrade: { lanes: ['K'] }, releaseDownload: () => calls.push(['release']) };
        controller.snapshots.set(entry.sourcePartId || entry.id, { snapshot, contentSha256: entry.contentSha256, upgradePending: true });
        return info;
    };
    controller.readRender = async () => renderBytes;
    controller.loadPart = async () => ({ snapshot });
    controller.prepareRender = async entry => {
        const id = entry.sourcePartId || entry.id;
        controller.renderSources.set(id, entry.contentSha256 || entry.sha256);
    };
    controller.request = async (endpoint, options) => {
        requests.push({ endpoint, options, revision: controller.song.revision });
        if (endpoint.includes('/save?')) {
            history.push(structuredClone(remote.parts[1]));
            remote.revision += 1;
            const digest = Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', await options.body.arrayBuffer())), value => value.toString(16).padStart(2, '0')).join('');
            remote.parts = remote.parts.map(entry => {
                const updated = { ...entry, sha256: digest, contentSha256: 'e'.repeat(64), revision: 2 };
                delete updated.render;
                return updated;
            });
        } else if (endpoint.includes('/render?')) {
            remote.parts = remote.parts.map(entry => ({ ...entry, render: { ...part.render, sourceSha256: entry.sha256 } }));
        } else throw new Error(`Unexpected request: ${endpoint}`);
        return { ok: true, song: structuredClone(remote) };
    };
    return { ...fixture, part, reference, history, requests, renderBytes, snapshot };
}

test('legacy upgrades reject an oversized archive before original download or save', async () => {
    const { controller, snapshot } = compatibilityController();
    controller.song = { ...controller.song, parts: controller.song.parts.map(part => ({ ...part, bytes: 100 * 1048576 })) };
    const original = controller.song;
    controller.readPartMetadata = async () => ({ snapshot, decodedBytes: 0, upgrade: { lanes: ['K'] } });
    controller.readPart = async () => assert.fail('Oversized upgrade must not download original WAVs');
    controller.request = async () => assert.fail('Oversized upgrade must not save');
    await assert.rejects(controller.upgradeSongParts(controller.generation), /safety budget/);
    assert.equal(controller.song, original);
    assert.equal(controller.memoryBudget.bytes, 0);
    assert.equal(controller.downloadBudget.bytes, 0);
});

test('hash-bound metadata avoids source downloads for compatible cached parts and reuses warm checks', async () => {
    const {controller} = makeController({upgradePart: async () => {}, inspectSnapshot: snapshot => ({snapshot, decodedBytes: 0, upgrade: null})});
    controller.partManifests = true;
    const part = {...first, sha256: 'a'.repeat(64), render: {version: 1, sourceSha256: 'a'.repeat(64)}};
    controller.song = {id: 'metadata-12345678', parts: [part]};
    let manifests = 0;
    controller.readPart = () => assert.fail('Compatible cached renders must not fetch original audio');
    controller.request = async endpoint => {
        manifests++;
        assert.equal(endpoint, `/metadata-12345678/parts/intro/manifest?sha256=${part.sha256}`);
        return {format: 'mygrain-song-part-manifest', version: 1, sourceSha256: part.sha256, snapshot: {state: {modes: {}}}};
    };
    await controller.arm(); await controller.arm();
    assert.equal(controller.armed, true); assert.equal(manifests, 1);
});

test('metadata only fast-paths advertised servers and rejects mismatched hashes, schemas and cancellation', async () => {
    const {controller} = makeController({inspectSnapshot: snapshot => ({snapshot, decodedBytes: 0, upgrade: null})});
    controller.song = {id: 'metadata-12345678', parts: []};
    const part = {...first, sha256: 'a'.repeat(64)};
    let sources = 0;
    controller.readPart = async () => { sources++; return {body: new ArrayBuffer(0)}; };
    await controller.readPartMetadata(part); assert.equal(sources, 1);
    controller.partManifests = true;
    const good = {format: 'mygrain-song-part-manifest', version: 1, sourceSha256: part.sha256, snapshot: {}};
    for (const changes of [{sourceSha256: 'b'.repeat(64)}, {version: 2}, {format: 'other'}]) {
        controller.request = async () => ({...good, ...changes});
        await assert.rejects(controller.readPartMetadata(part), /metadata integrity check failed/);
        assert.equal(controller.snapshots.size, 0);
    }
    controller.request = async () => { controller.generation++; return good; };
    await assert.rejects(controller.readPartMetadata(part), {name: 'AbortError'});
    assert.equal(controller.snapshots.size, 0); assert.equal(sources, 1);
});

test('explicit legacy compatibility persistence uses normal guarded save; subsequent Arm is read-only', async () => {
    const {controller, snapshot, history} = compatibilityController();
    controller.partManifests = true;
    controller.adapter.inspectSnapshot = () => ({snapshot, decodedBytes: 0, upgrade: {lanes: ['K']}});
    let manifests = 0, sources = 0;
    const request = controller.request, read = controller.readPart;
    controller.readPart = async (...args) => { sources++; return read(...args); };
    controller.request = async (endpoint, options) => {
        if (endpoint.includes('/manifest?')) {
            manifests++;
            return {format: 'mygrain-song-part-manifest', version: 1, sourceSha256: controller.song.parts[0].sha256, snapshot};
        }
        return request(endpoint, options);
    };
    await controller.upgradeSongParts(controller.generation);
    await controller.arm();
    assert.equal(controller.armed, true); assert.equal(manifests, 1); assert.equal(sources, 1); assert.equal(history.length, 1);
});

test('legacy programmatic persistence upgrades each shared source once and Arm retains exact renders', async () => {
    const { controller, calls, part, reference, requests, history, renderBytes } = compatibilityController();
    const order = controller.song.parts.map(entry => [entry.id, entry.repeats, entry.colour]);
    await controller.upgradeSongParts(controller.generation);
    await controller.arm();
    assert.equal(controller.armed, true);
    assert.equal(calls.filter(call => call[0] === 'acquire').length, 1);
    assert.equal(history.length, 1);
    assert.equal(history[0].sha256, part.sha256);
    assert.equal(controller.song.revision, 5);
    assert.deepEqual(controller.song.parts.map(entry => [entry.id, entry.repeats, entry.colour]), order);
    assert.equal(controller.song.parts[0].sourcePartId, part.id);
    assert.equal(controller.song.parts[0].sha256, controller.song.parts[1].sha256);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].endpoint, `/${controller.song.id}/parts/${reference.id}/save?sha256=${part.sha256}`);
    assert.equal(requests[0].revision, 4);
    assert.equal(requests[1].revision, 5);
    assert.equal(requests[1].options.body, renderBytes);
    assert.match(requests[1].endpoint, /&keyboard=1&grain=4&portable=1$/);
    await controller.arm();
    assert.equal(requests.length, 2);
    assert.equal(history.length, 1);
    assert.equal(controller.song.revision, 5);
});

test('another editor leaves arming read-only with an honest pending status, then explicit compatibility persistence saves once', async () => {
    const { controller, requests, calls, history } = compatibilityController();
    const acquire = controller.beginEditing;
    controller.beginEditing = async () => { throw Object.assign(new Error('Another phone is editing'), { code: 'SONG_LOCKED' }); };
    await controller.arm();
    assert.equal(controller.armed, true);
    assert.equal(controller.song.revision, 4);
    assert.equal(requests.length, 0);
    assert.equal(history.length, 0);
    assert.match(calls.filter(call => call[0] === 'status').at(-1)[1], /legacy parts use compatible in-memory defaults/);
    controller.beginEditing = acquire;
    await controller.upgradeSongParts(controller.generation);
    await controller.arm();
    assert.equal(controller.armed, true);
    assert.equal(history.length, 1);
    assert.equal(controller.song.revision, 5);
    assert.doesNotMatch(calls.filter(call => call[0] === 'status').at(-1)[1], /legacy parts use compatible in-memory defaults/);
});

test('an outstanding amendment allows read-only compatibility arming without acquiring or saving', async () => {
    const { controller, requests, calls } = compatibilityController();
    controller.editing = { id: controller.song.parts[0].id, songId: controller.song.id };
    await controller.arm();
    assert.equal(controller.armed, true);
    assert.equal(requests.length, 0);
    assert.equal(calls.filter(call => call[0] === 'acquire').length, 0);
    assert.ok(controller.editing);
});

test('a revision change during automatic editing acquisition never saves a compatibility archive', async () => {
    const { controller, requests } = compatibilityController();
    const acquire = controller.beginEditing;
    controller.beginEditing = async () => { await acquire(); controller.song.revision += 1; };
    await assert.rejects(controller.upgradeSongParts(controller.generation), /changed while requesting editing/);
    assert.equal(requests.length, 0);
    assert.equal(controller.armed, false);
});

test('a save conflict is never downgraded into a read-only compatibility success', async () => {
    const { controller, history } = compatibilityController();
    controller.request = async () => { throw Object.assign(new Error('Refresh the changed song'), { code: 'SONG_REVISION_CONFLICT' }); };
    await assert.rejects(controller.upgradeSongParts(controller.generation), /Refresh the changed song/);
    assert.equal(history.length, 0);
    assert.equal(controller.armed, false);
});

test('losing the editor lock at save time leaves compatible playback available without a mutation', async () => {
    const { controller, history, calls } = compatibilityController();
    controller.request = async () => { throw Object.assign(new Error('Editing lock expired'), { code: 'SONG_LOCK_LOST' }); };
    await controller.upgradeSongParts(controller.generation);
    await controller.arm();
    assert.equal(controller.armed, true);
    assert.equal(controller.song.revision, 4);
    assert.equal(history.length, 0);
    assert.match(calls.filter(call => call[0] === 'status').at(-1)[1], /legacy parts use compatible in-memory defaults/);
});

function compatibilityGate() {
    let resolve;
    const promise = new Promise(complete => { resolve = complete; });
    return { promise, resolve };
}

test('delayed save replies cannot replace a cancelled generation or a changed library, song, revision, or source', async () => {
    for (const change of ['generation', 'library', 'song', 'revision', 'source']) {
        const { controller } = compatibilityController();
        const entered = compatibilityGate();
        const resume = compatibilityGate();
        const request = controller.request;
        controller.request = async (endpoint, options) => {
            const result = await request(endpoint, options);
            entered.resolve(result);
            await resume.promise;
            return result;
        };
        const operation = controller.upgradeSongParts(controller.generation);
        await entered.promise;
        if (change === 'generation') { controller.cancel(); controller.song = { ...controller.song, revision: 9 }; }
        if (change === 'library') controller.key = 'f'.repeat(64);
        if (change === 'song') controller.song = { ...controller.song, id: 'another-12345678' };
        if (change === 'revision') controller.song = { ...controller.song, revision: 9 };
        if (change === 'source') controller.song = { ...controller.song, parts: controller.song.parts.map(part => ({ ...part, sha256: 'f'.repeat(64) })) };
        const current = controller.song;
        controller.songs = [current];
        const retained = { snapshot: { sentinel: change } };
        controller.snapshots.set('newer-cache', retained);
        resume.resolve();
        await assert.rejects(operation, { name: 'AbortError' });
        assert.equal(controller.song, current, change);
        assert.equal(controller.songs[0], current, change);
        assert.equal(controller.snapshots.get('newer-cache'), retained, change);
        assert.equal(controller.revisionConflict, !['library', 'song'].includes(change), change);
    }
});

test('a cancelled committed save is reconciled by Refresh Songs, not by applying its delayed reply', async () => {
    const { controller, requests } = compatibilityController();
    const entered = compatibilityGate();
    const resume = compatibilityGate();
    const request = controller.request;
    controller.request = async (endpoint, options) => {
        const result = await request(endpoint, options);
        entered.resolve(result);
        await resume.promise;
        return result;
    };
    const operation = controller.upgradeSongParts(controller.generation);
    const committed = await entered.promise;
    controller.cancel();
    const current = controller.song;
    resume.resolve();
    await assert.rejects(operation, { name: 'AbortError' });
    assert.equal(controller.song, current);
    assert.equal(controller.song.revision, 4);
    assert.equal(controller.revisionConflict, true);
    assert.equal(requests.length, 1);
    controller.request = async () => ({ ok: true, songs: [committed.song] });
    await controller.refresh();
    assert.equal(controller.song.revision, 5);
    assert.equal(controller.revisionConflict, false);
    assert.equal(controller.song.parts[0].sha256, committed.song.parts[0].sha256);
});

test('delayed render-retention replies cannot overwrite newer state or invalidate newer caches', async () => {
    for (const change of ['generation', 'library', 'song', 'revision', 'source']) {
        const { controller } = compatibilityController();
        const entered = compatibilityGate();
        const resume = compatibilityGate();
        const request = controller.request;
        controller.request = async (endpoint, options) => {
            const result = await request(endpoint, options);
            if (endpoint.includes('/render?')) { entered.resolve(); await resume.promise; }
            return result;
        };
        const operation = controller.upgradeSongParts(controller.generation);
        await entered.promise;
        if (change === 'generation') { controller.cancel(); controller.song = { ...controller.song, revision: 9 }; }
        if (change === 'library') controller.key = 'f'.repeat(64);
        if (change === 'song') controller.song = { ...controller.song, id: 'another-12345678' };
        if (change === 'revision') controller.song = { ...controller.song, revision: 9 };
        if (change === 'source') controller.song = { ...controller.song, parts: controller.song.parts.map(part => ({ ...part, sha256: 'f'.repeat(64) })) };
        const current = controller.song;
        controller.songs = [current];
        const retained = { snapshot: { sentinel: change } };
        controller.snapshots.set('newer-cache', retained);
        resume.resolve();
        await assert.rejects(operation, { name: 'AbortError' });
        assert.equal(controller.song, current, change);
        assert.equal(controller.songs[0], current, change);
        assert.equal(controller.snapshots.get('newer-cache'), retained, change);
        assert.equal(controller.revisionConflict, !['library', 'song'].includes(change), change);
    }
});

test('save replies with an unexpected server revision, song, or upgraded archive hash are not applied', async () => {
    for (const change of ['revision', 'sourceRevision', 'song', 'hash']) {
        const { controller } = compatibilityController();
        const current = controller.song;
        const request = controller.request;
        controller.request = async (endpoint, options) => {
            const result = await request(endpoint, options);
            if (change === 'revision') result.song.revision += 1;
            if (change === 'sourceRevision') result.song.parts.forEach(part => { part.revision += 1; });
            if (change === 'song') result.song.id = 'another-12345678';
            if (change === 'hash') result.song.parts = result.song.parts.map(part => ({ ...part, sha256: 'f'.repeat(64) }));
            return result;
        };
        await assert.rejects(controller.upgradeSongParts(controller.generation), /Unexpected saved-song upgrade/);
        assert.equal(controller.song, current, change);
        assert.equal(controller.song.revision, 4, change);
        assert.equal(controller.revisionConflict, true, change);
    }
});

test('render replies with an unexpected server revision or source/render hash are not reattached', async () => {
    for (const change of ['revision', 'source', 'render']) {
        const { controller } = compatibilityController();
        const request = controller.request;
        controller.request = async (endpoint, options) => {
            const result = await request(endpoint, options);
            if (endpoint.includes('/render?')) {
                if (change === 'revision') result.song.revision += 1;
                else result.song.parts.forEach(part => { part.render[change === 'source' ? 'sourceSha256' : 'sha256'] = 'f'.repeat(64); });
            }
            return result;
        };
        await assert.rejects(controller.upgradeSongParts(controller.generation), /changed while retaining its render/);
        assert.equal(controller.song.revision, 5, change);
        assert.ok(controller.song.parts.every(part => !part.render), change);
        assert.equal(controller.revisionConflict, true, change);
    }
});

test('changes during archive preparation are detected before sending a source save', async () => {
    const { controller, requests } = compatibilityController();
    controller.adapter.upgradePart = async () => { controller.song.revision += 1; return new Blob(['normalized archive']); };
    await assert.rejects(controller.upgradeSongParts(controller.generation), { name: 'AbortError' });
    assert.equal(requests.length, 0);
    assert.equal(controller.revisionConflict, false);
});

test('an existing but unverified editor token has a distinct code and keeps compatibility arming read-only', async () => {
    const { controller, requests, calls } = compatibilityController();
    controller.lease.token = 'unverified-token';
    controller.lease.message = 'Connection cannot be verified';
    controller.lease.check = async () => { calls.push(['checkLease']); };
    await assert.rejects(controller.ensureEditing(controller.song.parts[0]), { code: 'SONG_EDIT_UNVERIFIED' });
    await controller.arm();
    assert.equal(controller.armed, true);
    assert.equal(controller.song.revision, 4);
    assert.equal(requests.length, 0);
    assert.equal(calls.filter(call => call[0] === 'acquire').length, 0);
    assert.match(calls.filter(call => call[0] === 'status').at(-1)[1], /legacy parts use compatible in-memory defaults/);
});

test('Amend requests editing automatically without recalling over the current live edits', async () => {
    const { controller, calls } = makeController();
    const part = { ...first, sha256: 'saved' };
    controller.song = { id: 'song', revision: 2, parts: [part] };
    controller.active = part.id;
    let writable = false;
    controller.canEditSong = () => writable;
    controller.beginEditing = async () => { calls.push(['acquire']); writable = true; };
    await controller.amendPart(part);
    assert.equal(controller.editing.id, part.id);
    assert.equal(calls.filter(call => call[0] === 'acquire').length, 1);
    assert.equal(calls.some(call => call[0] === 'recall'), false);
    assert.equal(controller.expandedParts.has('song:intro'), true);
});

test('New Part requests access before capturing and saving audio', async () => {
    const { controller, calls } = makeController({ capture: async () => { calls.push(['capture']); return new Blob(['snapshot']); } });
    controller.song = { id: 'song', revision: 1, parts: [] };
    controller.element('songBetaPartName').value = 'New part';
    controller.element('songBetaRepeats').value = 1;
    let writable = false;
    controller.canEditSong = () => writable;
    controller.beginEditing = async () => { calls.push(['acquire']); writable = true; };
    controller.request = async () => {
        assert.equal(writable, true);
        calls.push(['save']);
        return { song: { ...controller.song, revision: 2, parts: [first] } };
    };
    await controller.newPart();
    assert.deepEqual(calls.filter(call => ['acquire', 'capture', 'save'].includes(call[0])).map(call => call[0]), ['acquire', 'capture', 'save']);
});

test('stored AI parts append the supplied archive, name and repeats without capturing or clearing the live draft', async () => {
    const { controller } = makeController({ capture: async () => { throw Error('Must not capture the live patch'); } });
    controller.song = { id: 'song', revision: 1, parts: [first] };
    controller.element('songBetaPartName').value = 'Unsent draft';
    const blob = new Blob(['saved archive']), abort = new AbortController();
    controller.request = async (path, options) => {
        assert.equal(path, '/song/parts?name=Chorus%201&repeats=2'); assert.equal(options.body, blob); assert.equal(options.signal, abort.signal);
        return { song: { ...controller.song, revision: 2, parts: [first, { ...second, name: 'Chorus 1', repeats: 2 }] } };
    };
    const part = await controller.newPart({ blob, name: 'Chorus 1', repeats: 2, signal: abort.signal });
    assert.equal(part.name, 'Chorus 1'); assert.equal(controller.element('songBetaPartName').value, 'Unsent draft'); assert.deepEqual(controller.song.parts[0], first);
    abort.abort(); controller.request = async () => { throw Error('Cancelled upload must not start'); };
    await assert.rejects(controller.newPart({ blob, name: 'Cancelled', repeats: 1, signal: abort.signal }), { name: 'AbortError' });
});

for (const action of ['reuse', 'full-copy', 'rename-song', 'rename-part', 'move', 'delete', 'colour', 'repeats', 'save-amendment']) {
    test(`${action} requests editing access automatically before its saved mutation`, async () => {
        const { controller, context } = makeController();
        const part = { ...first, sha256: 'saved' };
        controller.song = { id: 'song', revision: 2, parts: [part, second] };
        let writable = false;
        let acquired = 0;
        let saved = 0;
        controller.canEditSong = () => writable;
        controller.beginEditing = async () => { acquired += 1; writable = true; };
        controller.request = async () => { assert.equal(writable, true); saved += 1; return { song: controller.song }; };
        context.confirm = () => true;
        context.prompt = () => 'Renamed';
        if (action === 'reuse') await controller.reusePart(part);
        if (action === 'full-copy') await controller.fullCopyPart(part);
        if (action === 'rename-song') await controller.renameSong();
        if (action === 'rename-part') await controller.arrange(part);
        if (action === 'move') await controller.arrange(part, 1);
        if (action === 'delete') await controller.deletePart(part);
        if (action === 'colour') await controller.setColour(part, '#123456');
        if (action === 'repeats') await controller.setRepeats(part, 3);
        if (action === 'save-amendment') {
            controller.editing = { id: part.id, sha256: part.sha256, songId: controller.song.id };
            controller.element('songBetaPartName').value = part.name;
            controller.element('songBetaRepeats').value = part.repeats;
            await controller.savePart();
        }
        assert.equal(acquired, 1);
        assert.equal(saved, 1);
    });
}

test('cancelled rename and delete prompts neither reserve editing nor save', async () => {
    const { controller, context } = makeController();
    controller.song = { id: 'song', parts: [first] };
    controller.canEditSong = () => false;
    controller.beginEditing = async () => { throw new Error('Must not reserve editing'); };
    controller.request = async () => { throw new Error('Must not save'); };
    context.prompt = () => null;
    context.confirm = () => false;
    await controller.renameSong();
    await controller.arrange(first);
    await controller.deletePart(first);
});

test('Amend retains the saved and live pattern when another device holds editing', async () => {
    const { controller, calls } = makeController();
    controller.song = { id: 'song', parts: [first] };
    controller.active = first.id;
    controller.canEditSong = () => false;
    controller.beginEditing = async () => { throw new Error('Song is being edited on Other phone'); };
    await assert.rejects(controller.amendPart(first), /Other phone/);
    assert.equal(controller.editing, null);
    assert.equal(controller.active, first.id);
    assert.equal(calls.some(call => ['recall', 'stop'].includes(call[0])), false);
});

test('Amend rejects recording both before and after requesting editing', async () => {
    let checks = 0;
    const { controller } = makeController({ assertNotRecording() { checks += 1; if (checks === 2) throw new Error('Finish recording'); } });
    controller.song = { id: 'song', parts: [first] };
    controller.canEditSong = () => false;
    controller.beginEditing = async () => { controller.canEditSong = () => true; };
    await assert.rejects(controller.amendPart(first), /Finish recording/);
    assert.equal(controller.editing, null);
});

test('automatic editing rejects changed songs, libraries and part revisions', async () => {
    for (const change of ['song', 'library', 'revision', 'part']) {
        const { controller } = makeController();
        const part = { ...first, sha256: 'original' };
        controller.song = { id: 'song', revision: 1, parts: [part] };
        controller.canEditSong = () => false;
        controller.beginEditing = async () => {
            controller.canEditSong = () => true;
            if (change === 'song') controller.song.id = 'other';
            if (change === 'library') controller.key = 'other-library';
            if (change === 'revision') controller.song.revision += 1;
            if (change === 'part') controller.song.parts = [{ ...part, sha256: 'other' }];
        };
        await assert.rejects(controller.amendPart(part), /changed/);
        assert.equal(controller.editing, null);
    }
});

test('cancelling an amendment restores controls without discarding the copied loop', () => {
    const { controller } = makeController();
    controller.editing = { id: first.id };
    controller.loopClipboard = { layer: 'A' };
    controller.cancelAmendment();
    assert.equal(controller.editing, null);
    assert.equal(controller.loopClipboard.layer, 'A');
});

test('loop copy pins the saved revision and shared source without decoding or changing live audio', () => {
    const { controller, calls } = makeController();
    const part = { ...first, id: 'placement', sourcePartId: 'shared', sha256: 'a'.repeat(64) };
    controller.song = { id: 'source-song', parts: [part] };
    controller.copyLoop(part, 'M+');
    assert.equal(controller.loopClipboard.sourcePartId, 'shared');
    assert.equal(controller.loopClipboard.sourceSha256, part.sha256);
    assert.equal(controller.loopClipboard.layer, 'M+');
    assert.deepEqual(calls.map(call => call[0]), ['status']);
    part.sha256 = 'b'.repeat(64);
    assert.equal(controller.loopClipboard.sourceSha256, 'a'.repeat(64));
    assert.throws(() => controller.copyLoop(part, 'unknown'), /current saved part/);
});

test('loop paste sends only the pinned source and accepts a complete destination amendment', async () => {
    const { controller, calls, context } = makeController();
    const part = { ...first, sha256: 'old', contentSha256: 'old-content' };
    const other = { ...second, sha256: 'other', contentSha256: 'other-content' };
    controller.song = { id: 'song', revision: 2, parts: [part, other] };
    controller.copyLoop(part, 'X');
    const copied = controller.loopClipboard;
    controller.renders.set(other.id, { length: 16, numberOfChannels: 2 });
    controller.renderSources.set(other.id, other.contentSha256);
    context.confirm = () => true;
    let request;
    const saved = { ...part, sha256: 'new', contentSha256: 'new-content' };
    controller.request = async (path, options) => {
        request = { path, options };
        return { song: { ...controller.song, revision: 3, parts: [saved, other] } };
    };
    await controller.pasteLoop(part);
    assert.match(request.path, /\/intro\/paste-loop\?sha256=old$/);
    assert.deepEqual(JSON.parse(request.options.body), { sourceSongId: 'song', sourcePartId: 'intro', sourceSha256: 'old', layer: 'X' });
    assert.equal(controller.song.parts[0], saved);
    assert.equal(controller.song.parts[1], other);
    assert.equal(controller.renders.has(other.id), true);
    assert.equal(controller.loopClipboard, copied);
    assert.equal(controller.armed, false);
    assert.equal(calls.some(call => call[0] === 'recall'), false);
    assert.match(calls.at(-1)[1], /use Arm Cache/);
});

test('multi-copy pins one saved revision and normalizes loop/K/drum selections without live changes', () => {
    const { controller, calls } = makeController();
    const part = { ...first, sha256: 'source-hash' };
    controller.song = { id: 'song', parts: [part] };
    const selection = ['drumKick', 'K5', 'M', 'K2', 'V', 'V'];
    controller.copyLoop(part, selection);
    selection.push('drumSnare');
    assert.deepEqual(Array.from(controller.loopClipboard.layers), ['V', 'M', 'K2', 'K5', 'drumKick']);
    assert.equal(controller.loopClipboard.sourceSha256, 'source-hash');
    assert.equal(controller.loopClipboard.layer, undefined);
    assert.match(calls.at(-1)[1], /Bastardloop V, Bastardloop M, K track 2, K track 5, Kick drum lane/);
    assert.equal(calls.some(call => call[0] === 'recall'), false);
    const copied = controller.loopClipboard;
    for (const invalid of [[], ['V', 'bad'], null, ['drums', {}]]) {
        assert.throws(() => controller.copyLoop(part, invalid), /current saved part/);
        assert.equal(controller.loopClipboard, copied);
    }
});

test('all-drums selection collapses redundant lanes while keeping selected loops', () => {
    const { controller } = makeController();
    controller.song = { id: 'song', parts: [first] };
    controller.copyLoop(first, ['V', 'drums', 'drumKick', 'drumRoll']);
    assert.deepEqual(Array.from(controller.loopClipboard.layers), ['V', 'drums']);
});

test('multi-paste publishes once with all selected items and one confirmation', async () => {
    const { controller, context } = makeController();
    const part = { ...first, sha256: 'old' };
    controller.song = { id: 'song', revision: 2, parts: [part] };
    controller.copyLoop(part, ['V', 'M', 'K1', 'K3', 'K5', 'drumKick']);
    let confirmations = 0, requests = 0;
    context.confirm = text => { confirmations++; assert.match(text, /Bastardloop V, Bastardloop M, K track 1, K track 3, K track 5, Kick drum lane/); return true; };
    controller.request = async (url, options) => {
        requests++;
        assert.match(url, /\/paste-loop\?sha256=old$/);
        assert.deepEqual(JSON.parse(options.body), { sourceSongId: 'song', sourcePartId: part.id, sourceSha256: 'old', layers: ['V', 'M', 'K1', 'K3', 'K5', 'drumKick'] });
        return { song: { ...controller.song, revision: 3, parts: [{ ...part, sha256: 'new' }] } };
    };
    await controller.pasteLoop(part);
    assert.equal(requests, 1);
    assert.equal(confirmations, 1);
    assert.equal(controller.song.revision, 3);
    assert.deepEqual(Array.from(controller.loopClipboard.layers), ['V', 'M', 'K1', 'K3', 'K5', 'drumKick']);
});

test('cancelled or failed multi-paste keeps the complete clipboard and saved destination', async () => {
    const { controller, context } = makeController();
    const part = { ...first, sha256: 'old' };
    controller.song = { id: 'song', parts: [part] };
    controller.copyLoop(part, ['V', 'drumHat', 'drumClap']);
    const copied = controller.loopClipboard;
    context.confirm = () => false;
    controller.request = async () => { throw new Error('No partial writes'); };
    await controller.pasteLoop(part);
    assert.equal(controller.loopClipboard, copied);
    context.confirm = () => true;
    await assert.rejects(controller.pasteLoop(part), /No partial writes/);
    assert.equal(controller.loopClipboard, copied);
    assert.equal(controller.song.parts[0], part);
});

test('previously armed songs save pasted audio without auto-arming and retain the clipboard', async () => {
    const { controller, calls, context } = makeController();
    const part = { ...first, sha256: 'old' };
    controller.song = { id: 'song', parts: [part] };
    controller.copyLoop(part, 'Q');
    controller.armed = true;
    context.confirm = () => true;
    const order = [];
    controller.request = async () => { order.push('save'); return { song: { id: 'song', parts: [{ ...part, sha256: 'new' }] } }; };
    controller.arm = async () => { order.push('arm'); assert.equal(controller.song.parts[0].sha256, 'new'); controller.armed = true; };
    await controller.pasteLoop(part);
    assert.deepEqual(order, ['save']);
    assert.equal(controller.armed, false);
    assert.equal(controller.loopClipboard.layer, 'Q');
    assert.match(calls.at(-1)[1], /Paste more parts.*Arm Cache once/);
});

test('pasting never calls rendering even when automatic preparation would fail', async () => {
    const { controller, calls, context } = makeController();
    const part = { ...first, sha256: 'old' };
    controller.song = { id: 'song', parts: [part] };
    controller.copyLoop(part, 'L');
    controller.armed = true;
    context.confirm = () => true;
    let writes = 0;
    controller.request = async () => { writes += 1; return { song: { id: 'song', parts: [{ ...part, sha256: 'saved' }] } }; };
    controller.arm = async () => { throw new Error('fixture render failure'); };
    await controller.pasteLoop(part);
    assert.equal(writes, 1);
    assert.equal(controller.song.parts[0].sha256, 'saved');
    assert.equal(controller.armed, false);
    assert.match(calls.at(-1)[1], /Paste more parts.*Arm Cache once/);
});

test('loop paste cancellation and failed saves leave current parts and armed audio unchanged', async () => {
    const { controller, context } = makeController();
    const part = { ...first, sha256: 'old' };
    const song = { id: 'song', parts: [part] };
    controller.song = song;
    controller.copyLoop(part, 'B');
    controller.armed = true;
    controller.request = async () => { throw new Error('fixture offline'); };
    context.confirm = () => false;
    await controller.pasteLoop(part);
    assert.equal(controller.song, song);
    assert.equal(controller.armed, true);
    context.confirm = () => true;
    await assert.rejects(controller.pasteLoop(part), /fixture offline/);
    assert.equal(controller.song, song);
    assert.equal(controller.armed, true);
    assert.equal(controller.loopClipboard.layer, 'B');
});

test('copy and paste reject stale parts, unsaved amendments, playback and other-library clipboards', async () => {
    const { controller, context } = makeController();
    const part = { ...first, sha256: 'old' };
    controller.song = { id: 'song', parts: [part] };
    context.confirm = () => true;
    await assert.rejects(controller.pasteLoop(part), /Copy From Part/);
    controller.copyLoop(part, 'M');
    assert.throws(() => controller.copyLoop({ ...part, sha256: 'stale' }, 'M'), /current saved part/);
    await assert.rejects(controller.pasteLoop({ ...part, sha256: 'stale' }), /changed part/);
    controller.playing = true;
    assert.throws(() => controller.copyLoop(part, 'M'), /Stop the song/);
    await assert.rejects(controller.pasteLoop(part), /Stop the song/);
    controller.playing = false;
    controller.editing = { id: part.id };
    await assert.rejects(controller.pasteLoop(part), /finish the amendment/);
    controller.editing = null;
    controller.key = 'another-library';
    await assert.rejects(controller.pasteLoop(part), /Copy From Part/);
    controller.canEditSong = () => false;
    controller.revisionConflict = true;
    await assert.rejects(controller.pasteLoop(part), /Refresh Songs/);
});

test('read-only paste confirms before requesting editing and saves only after acquiring the lock', async () => {
    const { controller, context } = makeController();
    const part = { ...first, sha256: 'old' };
    controller.song = { id: 'song', revision: 2, parts: [part] };
    controller.copyLoop(part, 'A');
    let writable = false;
    const order = [];
    controller.canEditSong = () => writable;
    context.confirm = message => { assert.match(message, /Editing access will be requested automatically/); order.push('confirm'); return true; };
    controller.beginEditing = async () => { order.push('edit'); writable = true; };
    controller.request = async () => {
        assert.equal(writable, true);
        order.push('paste');
        return { song: { ...controller.song, revision: 3, parts: [{ ...part, sha256: 'saved' }] } };
    };
    await controller.pasteLoop(part);
    assert.deepEqual(order, ['confirm', 'edit', 'paste']);
    assert.equal(controller.song.parts[0].sha256, 'saved');
});

test('cancelling read-only paste acquires no lock and makes no save', async () => {
    const { controller, context } = makeController();
    const part = { ...first, sha256: 'old' };
    controller.song = { id: 'song', parts: [part] };
    controller.copyLoop(part, 'L');
    controller.canEditSong = () => false;
    controller.beginEditing = async () => { throw new Error('Must not acquire a lock'); };
    controller.request = async () => { throw new Error('Must not save'); };
    context.confirm = () => false;
    await controller.pasteLoop(part);
    assert.equal(controller.loopClipboard.layer, 'L');
    assert.equal(controller.song.parts[0], part);
});

test('another device lock blocks read-only paste without discarding the copied loop', async () => {
    const { controller, context } = makeController();
    const part = { ...first, sha256: 'old' };
    controller.song = { id: 'song', parts: [part] };
    controller.copyLoop(part, 'M+');
    controller.canEditSong = () => false;
    context.confirm = () => true;
    controller.beginEditing = async () => { throw new Error('This song is being edited on Other iPhone'); };
    controller.request = async () => { throw new Error('Must not save'); };
    await assert.rejects(controller.pasteLoop(part), /Other iPhone/);
    assert.equal(controller.loopClipboard.layer, 'M+');
    assert.equal(controller.song.parts[0], part);
});

test('a paused existing edit lease must be verified instead of acquiring another lock', async () => {
    const { controller, context } = makeController();
    const part = { ...first, sha256: 'old' };
    controller.song = { id: 'song', parts: [part] };
    controller.copyLoop(part, 'B');
    controller.lease.token = 'existing';
    let writable = false;
    controller.canEditSong = () => writable;
    context.confirm = () => true;
    controller.lease.check = async () => { writable = true; };
    controller.beginEditing = async () => { throw new Error('Must not acquire another lock'); };
    controller.request = async () => ({ song: { ...controller.song, parts: [{ ...part, sha256: 'saved' }] } });
    await controller.pasteLoop(part);
    assert.equal(controller.song.parts[0].sha256, 'saved');
});

test('an unverified connection cannot acquire over its existing edit lease or save', async () => {
    const { controller, context } = makeController();
    const part = { ...first, sha256: 'old' };
    controller.song = { id: 'song', parts: [part] };
    controller.copyLoop(part, 'Q');
    controller.lease.token = 'existing';
    controller.lease.message = 'Connection lost: editing is paused';
    controller.canEditSong = () => false;
    context.confirm = () => true;
    controller.lease.check = async () => {};
    controller.beginEditing = async () => { throw new Error('Must not acquire another lock'); };
    controller.request = async () => { throw new Error('Must not save'); };
    await assert.rejects(controller.pasteLoop(part), /Connection lost/);
    assert.equal(controller.song.parts[0], part);
});

test('an expired lease can be explicitly reacquired by confirmed paste', async () => {
    const { controller, context } = makeController();
    const part = { ...first, sha256: 'old' };
    controller.song = { id: 'song', parts: [part] };
    controller.copyLoop(part, 'X');
    controller.lease.token = 'expired';
    let writable = false;
    controller.canEditSong = () => writable;
    context.confirm = () => true;
    controller.lease.check = async () => { controller.lease.token = null; };
    controller.beginEditing = async () => { writable = true; };
    controller.request = async () => ({ song: { ...controller.song, parts: [{ ...part, sha256: 'saved' }] } });
    await controller.pasteLoop(part);
    assert.equal(controller.song.parts[0].sha256, 'saved');
});

test('destination changes and recording started while requesting editing prevent the paste write', async () => {
    for (const change of ['destination', 'recording']) {
        const { controller, context } = makeController();
        const part = { ...first, sha256: 'old' };
        controller.song = { id: 'song', parts: [part] };
        controller.copyLoop(part, 'C');
        let writable = false;
        controller.canEditSong = () => writable;
        context.confirm = () => true;
        controller.beginEditing = async () => {
            writable = true;
            if (change === 'destination') controller.song = { ...controller.song, parts: [{ ...part, sha256: 'changed' }] };
            else controller.adapter.assertNotRecording = () => { throw new Error('Finish recording first'); };
        };
        controller.request = async () => { throw new Error('Must not save'); };
        await assert.rejects(controller.pasteLoop(part), change === 'destination' ? /destination changed/ : /Finish recording/);
    }
});

test('active recording blocks loop paste before confirmation, network writes or audio changes', async () => {
    const { controller, context, calls } = makeController({ assertNotRecording() { throw new Error('Finish recording first'); } });
    const part = { ...first, sha256: 'old' };
    controller.song = { id: 'song', parts: [part] };
    controller.copyLoop(part, 'M+');
    context.confirm = () => { throw new Error('Confirmation must not be shown'); };
    await assert.rejects(controller.pasteLoop(part), /Finish recording first/);
    assert.equal(calls.some(call => call[0] === 'stop'), false);
    assert.equal(controller.song.parts[0], part);
});

test('part transport stays grouped with move arrows rather than the part name', () => {
    const source = fs.readFileSync(path.join(__dirname, '../song-beta.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../song-beta.css'), 'utf8');
    assert.match(source, /actions\.className = 'song-beta-part-actions'/);
    assert.match(source, /actions\.append\(transport\)/);
    assert.match(source, /if \(direction\) actions\.append\(edit\)/);
    assert.match(source, /header\.append\(actions\)/);
    assert.doesNotMatch(source, /header\.append\(transport\)/);
    assert.match(css, /\.song-beta-part-actions \{[^}]*flex: 0 0 auto;[^}]*flex-wrap: nowrap;/);
    assert.match(css, /#songBetaCard \.song-beta-part-header \.song-beta-toggle \{ flex-basis: 100%; \}/);
});

test('portable freezes and legacy drum-volume snapshots cannot reuse pre-audit rendered audio', () => {
    const { controller } = makeController();
    const part = { ...first, render: { version: 1, keyboardVersion: 1, grainVersion: 4 } };
    for (const snapshot of [
        { state: { sliders: {} }, extra: { freezeStateVersion: 1 } },
        { state: { sliders: { performanceDrumMachineLevel: '29' } }, extra: {} }
    ]) {
        assert.equal(controller.isRenderCompatible(part, { snapshot }), false);
        assert.equal(controller.isRenderCompatible({ ...part, render: { ...part.render, portableVersion: 1 } }, { snapshot }), true);
    }
});

test('Loop Song toggles without saving changes and loops the complete arrangement from a selected part', async () => {
    const { controller, elements, calls } = makeController();
    controller.song = { id: 'song', parts: [first, second] };
    controller.armed = true;
    controller.renders.set(first.id, {});
    controller.renders.set(second.id, {});
    elements.get('songBetaLoop').listeners.click();
    assert.equal(controller.loopSong, true);
    await controller.playSong(second.id);
    assert.equal(controller.playing, true);
    assert.equal(controller.loopPartId, null);
    assert.deepEqual(calls.filter(call => call[0] === 'scheduled').map(call => call[1]), [first.id, second.id]);
    const options = calls.find(call => call[0] === 'storedOptions')[1];
    assert.equal(options.loop, true);
    assert.equal(options.startIndex, 1);
    controller.stop();
    assert.equal(controller.playing, false);
    assert.equal(controller.loopSong, true);
    elements.get('songBetaLoop').listeners.click();
    assert.equal(controller.loopSong, false);
});

test('Loop Part plays only its selected occurrence and pressing it again stops it', async () => {
    const { controller, calls } = makeController();
    controller.song = { id: 'song', parts: [first, second] };
    controller.armed = true;
    controller.loopSong = true;
    controller.renders.set(second.id, {});
    await controller.loopPart(second.id);
    assert.equal(controller.loopPartId, second.id);
    assert.deepEqual(calls.filter(call => call[0] === 'scheduled').map(call => call[1]), [second.id]);
    const options = calls.find(call => call[0] === 'storedOptions')[1];
    assert.equal(options.loop, true);
    assert.equal(options.startIndex, 0);
    await controller.loopPart(second.id);
    assert.equal(controller.playing, false);
    assert.equal(controller.loopPartId, null);
    assert.equal(controller.armed, true);
});

test('Loop Part cancellation leaves unarmed songs unchanged and confirmation arms before playback', async () => {
    const { controller, context, calls } = makeController();
    controller.song = { id: 'song', parts: [first] };
    context.confirm = () => false;
    await controller.loopPart(first.id);
    assert.equal(controller.playing, false);
    assert.equal(controller.armed, false);
    assert.equal(calls.filter(call => call[0] === 'scheduled').length, 0);
    context.confirm = () => true;
    controller.arm = async () => { controller.armed = true; controller.renders.set(first.id, {}); };
    await controller.loopPart(first.id);
    assert.equal(controller.playing, true);
    assert.equal(controller.loopPartId, first.id);
    controller.stop();
});

test('saved-song selection captures the requested ID before the busy render resets the dropdown', async () => {
    const { controller, elements, data } = makeController();
    const empty = { id: 'empty', name: 'Empty Song', parts: [] };
    const saved = { id: 'saved', name: 'Saved Song', parts: [first, second] };
    controller.songs = [saved, empty];
    controller.song = empty;
    controller.armed = true;
    controller.renders.set('old-render', {});
    const select = elements.get('songBetaSongs');
    controller.render = () => { select.value = controller.song?.id || ''; };
    const requests = [];
    controller.request = async path => {
        requests.push(path);
        return { song: controller.songs.find(song => `/${song.id}` === path) };
    };
    for (const target of [saved, empty, saved]) {
        select.value = target.id;
        await select.listeners.change({ target: select });
        assert.equal(controller.song, target);
        assert.equal(select.value, target.id);
        assert.equal(data.get('mygrain-song-selected-v1'), target.id);
        assert.equal(controller.armed, false);
        assert.equal(controller.renders.size, 0);
        assert.equal(controller.busy, false);
    }
    assert.deepEqual(requests, ['/saved', '/empty', '/saved']);
});

test('choosing the saved-song placeholder clears selection without requesting the previous song', async () => {
    const { controller, elements, data } = makeController();
    controller.song = { id: 'saved', name: 'Saved Song', parts: [first] };
    const select = elements.get('songBetaSongs');
    controller.render = () => { select.value = controller.song?.id || ''; };
    let requested = false;
    controller.request = async () => { requested = true; return { song: controller.song }; };
    select.value = '';
    await select.listeners.change({ target: select });
    assert.equal(controller.song, null);
    assert.equal(select.value, '');
    assert.equal(data.get('mygrain-song-selected-v1'), '');
    assert.equal(requested, false);
});

test('a failed song load preserves the previous song and saved selection and reports the error', async () => {
    const { controller, elements, data, calls } = makeController({}, { 'mygrain-song-selected-v1': 'saved' });
    const previous = { id: 'saved', name: 'Saved Song', parts: [first] };
    controller.song = previous;
    const select = elements.get('songBetaSongs');
    controller.render = () => { select.value = controller.song?.id || ''; };
    const requests = [];
    controller.request = async path => { requests.push(path); throw new Error('Song unavailable'); };
    select.value = 'unavailable';
    await select.listeners.change({ target: select });
    assert.deepEqual(requests, ['/unavailable']);
    assert.equal(controller.song, previous);
    assert.equal(select.value, previous.id);
    assert.equal(data.get('mygrain-song-selected-v1'), previous.id);
    assert.equal(controller.busy, false);
    assert.deepEqual(calls.at(-1), ['status', 'Song unavailable']);
});

test('duration follows each saved tempo, pattern length, and repeats', () => {
    assert.equal(partDurationSeconds(first), 4);
    assert.equal(partDurationSeconds(second), 2);
    assert.equal(partDurationSeconds({ ...first, patternSteps: 12, repeats: 1 }), 1.5);
});

test('invalid timing is rejected rather than starting an endless song', () => {
    for (const values of [{ bpm: 0 }, { bpm: Infinity }, { repeats: 0 }, { repeats: 1.5 }, { patternSteps: 128 }]) {
        assert.throws(() => partDurationSeconds({ ...first, ...values }));
    }
});

test('library key is secure, persisted, and reused', () => {
    const stored = new Map();
    const storage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
    const key = libraryKey(storage, webcrypto);
    assert.match(key, /^[a-f0-9]{64}$/);
    assert.equal(libraryKey(storage, webcrypto), key);
});

test('song library credentials and selection work when browser storage is blocked', () => {
    const storage = libraryStorage({ getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Full'); } });
    const key = libraryKey(storage, webcrypto);
    assert.equal(storage.persistent, false);
    assert.equal(libraryKey(storage, webcrypto), key);
    storage.setItem('mygrain-song-selected-v1', 'saved-song');
    assert.equal(storage.getItem('mygrain-song-selected-v1'), 'saved-song');
    const absent = libraryStorage(null);
    assert.equal(absent.persistent, false);
    assert.match(libraryKey(absent, webcrypto), /^[a-f0-9]{64}$/);
});

test('the Song controller can initialize even when obtaining localStorage throws', () => {
    const { controller, context } = makeController();
    Object.defineProperty(context, 'localStorage', { get() { throw new Error('Storage blocked'); } });
    const clean = new context.MygrainSongBeta.Controller(controller.adapter, {
        document: { getElementById: id => controller.element(id) },
        renderStore: controller.renderStore
    });
    assert.match(clean.key, /^[a-f0-9]{64}$/);
    assert.equal(clean.storage.persistent, false);
});

test('Song Access files validate credentials without accepting patch data or invalid selections', () => {
    const access = { format: 'mygrain-song-library-access', version: 1, key: 'a'.repeat(64), songId: 'saved-song-1234abcd' };
    assert.deepEqual(parseLibraryAccess(JSON.stringify(access)), { key: access.key, songId: access.songId });
    assert.deepEqual(parseLibraryAccess(JSON.stringify({ ...access, songId: null })), { key: access.key, songId: '' });
    for (const invalid of [null, 'x'.repeat(4097), '{', 'null', '{}', JSON.stringify({ ...access, version: 2 }), JSON.stringify({ ...access, key: [access.key] }), JSON.stringify({ ...access, key: 'invalid' }), JSON.stringify({ ...access, songId: '../other' })]) {
        assert.throws(() => parseLibraryAccess(invalid), /Song Access/);
    }
});

test('Song Access backup contains only credentials and server selection, never samples or patches', async () => {
    let exported;
    const { controller, calls } = makeController({ downloadLibraryAccess: async access => { exported = access; return true; } });
    controller.song = { id: 'saved-song-1234abcd', parts: [first] };
    await controller.backupLibraryAccess();
    assert.deepEqual(Object.keys(exported).sort(), ['format', 'key', 'songId', 'version']);
    assert.equal(exported.key, controller.key);
    assert.equal(exported.songId, controller.song.id);
    assert.ok(calls.some(call => call[0] === 'status' && /Keep it private/.test(call[1])));
    controller.adapter.downloadLibraryAccess = async () => false;
    await controller.backupLibraryAccess();
    assert.match(calls.at(-1)[1], /cancelled/);
    controller.playing = true;
    await assert.rejects(controller.backupLibraryAccess(), /Stop the song/);
});

test('opening Song Access validates server access before replacing the active library', async () => {
    const { controller, data, context } = makeController();
    const oldKey = controller.key;
    const access = { format: 'mygrain-song-library-access', version: 1, key: 'b'.repeat(64), songId: 'saved-song-1234abcd' };
    const file = { size: 200, text: async () => JSON.stringify(access) };
    controller.request = async () => { throw new Error('Offline'); };
    await assert.rejects(controller.openLibraryAccess(file), /Offline/);
    assert.equal(controller.key, oldKey);
    assert.equal(data.get('mygrain-song-library-key-v1'), oldKey);
    let request;
    controller.request = async (...args) => { request = args; return { songs: [{ id: access.songId, parts: [first] }] }; };
    await controller.openLibraryAccess(file);
    assert.equal(request[1].headers['X-Mygrain-Song-Key'], access.key);
    assert.equal(controller.key, access.key);
    assert.equal(controller.song.id, access.songId);
    assert.equal(data.get('mygrain-song-library-key-v1'), access.key);
    assert.equal(controller.armed, false);
    const nextAccess = { ...access, key: 'c'.repeat(64) };
    context.confirm = () => false;
    await controller.openLibraryAccess({ ...file, text: async () => JSON.stringify(nextAccess) });
    assert.equal(controller.key, access.key);
    controller.editing = first;
    await assert.rejects(controller.openLibraryAccess(file), /finish the amendment/);
});

test('playing an unarmed song is refused', async () => {
    const { controller, calls } = makeController();
    controller.song = { parts: [first] };
    await assert.rejects(controller.playSong(), /Arm Cache/);
    assert.equal(calls.length, 0);
});

test('Play Song From Here confirms before arming and starts at the chosen part', async () => {
    const { controller, calls, context } = makeController();
    controller.song = { parts: [first, second] };
    controller.loadPart = async part => { controller.cache.set(part.id, {}); };
    const prompts = [];
    context.confirm = message => { prompts.push(message); return true; };
    await controller.playSongFromHere(second.id);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /Arm Cache\?/);
    assert.match(prompts[0], /Verse/);
    assert.equal(controller.armed, true);
    assert.equal(controller.playing, true);
    assert.deepEqual(calls.filter(call => call[0] === 'scheduled').map(call => call[1]), ['verse']);
    assert.deepEqual([...controller.renders.keys()], ['intro', 'verse']);
});

test('cancelling the arm prompt leaves cache and playback unchanged', async () => {
    const { controller, calls, context } = makeController();
    controller.song = { parts: [first, second] };
    context.confirm = () => false;
    controller.arm = async () => assert.fail('Cancelled confirmation must not arm');
    const generation = controller.generation;
    await controller.playSongFromHere(second.id);
    assert.equal(controller.generation, generation);
    assert.equal(controller.armed, false);
    assert.equal(controller.playing, false);
    assert.equal(controller.renders.size, 0);
    assert.equal(calls.length, 0);
});

test('armed Play Song From Here starts immediately without confirming or re-arming', async () => {
    const { controller, calls, context } = makeController();
    controller.song = { parts: [first, second] };
    controller.armed = true;
    context.confirm = () => assert.fail('Armed playback must not prompt');
    controller.arm = async () => assert.fail('Armed playback must not re-arm');
    await controller.playSongFromHere(second.id);
    assert.deepEqual(calls.filter(call => call[0] === 'scheduled').map(call => call[1]), ['verse']);
});

test('failed or cancelled arming never starts playback from a part', async () => {
    for (const failure of [null, new Error('Cache storage failed')]) {
        const { controller, calls, context } = makeController();
        controller.song = { parts: [first, second] };
        context.confirm = () => true;
        controller.arm = async () => { if (failure) throw failure; };
        if (failure) await assert.rejects(controller.playSongFromHere(second.id), /Cache storage failed/);
        else await controller.playSongFromHere(second.id);
        assert.equal(controller.playing, false);
        assert.equal(calls.length, 0);
    }
});

test('Stop during confirmed cache preparation cannot start playback afterwards', async () => {
    let ready;
    const { controller, calls, context } = makeController({ ready: () => new Promise(resolve => { ready = resolve; }) });
    controller.song = { parts: [first, second] };
    context.confirm = () => true;
    const playing = controller.playSongFromHere(second.id);
    controller.stop();
    ready();
    await playing;
    assert.equal(controller.armed, false);
    assert.equal(controller.playing, false);
    assert.equal(calls.filter(call => call[0] === 'scheduled').length, 0);
});

test('invalid start parts and pending amendments cannot prompt or arm', async () => {
    const { controller, calls, context } = makeController();
    context.confirm = () => assert.fail('Invalid playback must not prompt');
    controller.arm = async () => assert.fail('Invalid playback must not arm');
    await assert.rejects(controller.playSongFromHere(second.id), /no longer in this song/);
    controller.song = { parts: [first, second] };
    await assert.rejects(controller.playSongFromHere('deleted-part'), /no longer in this song/);
    controller.editing = { id: first.id };
    await assert.rejects(controller.playSongFromHere(second.id), /amendment/);
    assert.equal(calls.length, 0);
});

test('armed order schedules every part ahead on the audio clock without live recall', async () => {
    const { controller, calls, timers, setClock } = makeController();
    controller.song = { parts: [first, second] };
    controller.cache.set('intro', 'intro-snapshot');
    controller.cache.set('verse', 'verse-snapshot');
    controller.armed = true;
    await controller.playSong();
    assert.equal(controller.active, 'intro');
    setClock(3.99);
    [...timers.values()].at(-1)();
    assert.equal(controller.active, 'intro');
    setClock(4);
    [...timers.values()].at(-1)();
    assert.equal(controller.active, 'verse');
    setClock(6);
    [...timers.values()].at(-1)();
    assert.equal(controller.playing, false);
    assert.deepEqual(calls.filter(call => call[0] === 'scheduled').map(call => call[1]), ['intro', 'verse']);
    assert.equal(calls.filter(call => call[0] === 'recall').length, 0);
    assert.ok(calls.some(call => call[0] === 'stop'));
});

test('stop invalidates queued callbacks so no later part can start', async () => {
    const { controller, calls, timers, setClock } = makeController();
    controller.song = { parts: [first, second] };
    controller.armed = true;
    controller.cache.set(first.id, {});
    controller.cache.set(second.id, {});
    await controller.playSong();
    const callback = [...timers.values()][0];
    controller.stop();
    setClock(10);
    callback();
    assert.equal(calls.filter(call => call[0] === 'recall').length, 0);
    assert.ok(calls.some(call => call[0] === 'stopScheduled'));
    assert.equal(controller.armed, true);
});

test('Play Song From Here skips preceding parts, preserves repeats and tempos, and highlights the original song position', async () => {
    const { controller, calls, timers, setClock } = makeController();
    const outro = { ...first, id: 'outro', name: 'Outro', bpm: 90 };
    controller.song = { id: 'song', parts: [first, second, outro] };
    const original = JSON.stringify(controller.song);
    controller.armed = true;
    for (const part of controller.song.parts) controller.renders.set(part.id, {});
    await controller.playSong(second.id);
    const scheduled = calls.filter(call => call[0] === 'scheduled');
    assert.deepEqual(scheduled.map(call => call[1]), ['verse', 'outro']);
    assert.equal(scheduled[0][2], 0);
    assert.equal(scheduled[0][3], partDurationSeconds(second));
    assert.equal(scheduled[1][2], scheduled[0][3]);
    assert.equal(scheduled[1][3], partDurationSeconds(second) + partDurationSeconds(outro));
    assert.equal(controller.active, second.id);
    assert.match(calls.at(-1)[1], /Playing 2\/3: Verse/);
    setClock(partDurationSeconds(second));
    [...timers.values()].at(-1)();
    assert.equal(controller.active, outro.id);
    setClock(scheduled[1][3]);
    assert.equal(controller.playing, false);
    assert.equal(controller.armed, true);
    assert.equal(JSON.stringify(controller.song), original);
    assert.equal(calls.filter(call => call[0] === 'recall').length, 0);
    assert.match(calls.at(-1)[1], /Played from Verse through the last part/);
});

test('starting at the last part plays only that part and ordinary Play Song still starts at the beginning', async () => {
    const { controller, calls, setClock } = makeController();
    controller.song = { parts: [first, second] };
    controller.armed = true;
    await controller.playSong(second.id);
    assert.deepEqual(calls.filter(call => call[0] === 'scheduled').map(call => call[1]), ['verse']);
    setClock(partDurationSeconds(second));
    assert.equal(controller.playing, false);
    calls.length = 0;
    await controller.playSong();
    assert.deepEqual(calls.filter(call => call[0] === 'scheduled').map(call => call[1]), ['intro', 'verse']);
});

test('jumping to another part cancels the previous playback and follows current order by part ID', async () => {
    const { controller, calls } = makeController();
    const outro = { ...first, id: 'outro', name: 'Outro' };
    controller.song = { parts: [outro, first, second] };
    controller.armed = true;
    await controller.playSong();
    calls.length = 0;
    await controller.playSong(first.id);
    assert.ok(calls.some(call => call[0] === 'stopScheduled'));
    assert.deepEqual(calls.filter(call => call[0] === 'scheduled').map(call => call[1]), ['intro', 'verse']);
    assert.equal(controller.active, first.id);
});

test('invalid start points and pending amendments do not interrupt existing playback', async () => {
    const { controller, calls } = makeController();
    controller.song = { parts: [first, second] };
    await assert.rejects(controller.playSong(second.id), /Arm Cache/);
    controller.armed = true;
    controller.playing = true;
    const generation = controller.generation;
    await assert.rejects(controller.playSong('deleted-part'), /no longer in this song/);
    controller.editing = { id: first.id };
    await assert.rejects(controller.playSong(second.id), /amendment/);
    assert.equal(controller.generation, generation);
    assert.equal(controller.playing, true);
    assert.equal(calls.length, 0);
});

test('storage-backed playback loads only the selected part and the remaining arrangement', async () => {
    const { controller } = makeController();
    const outro = { ...first, id: 'outro', name: 'Outro' };
    controller.song = { parts: [first, second, outro] };
    controller.armed = true;
    const loaded = [];
    controller.loadRender = async part => { loaded.push(part.id); return {}; };
    controller.adapter.scheduleStoredSong = async (parts, load, ended, signal) => {
        assert.equal(signal.aborted, false);
        for (const part of parts) await load(part);
        return controller.adapter.scheduleSong(parts, null, ended);
    };
    await controller.playSong(second.id);
    assert.deepEqual(loaded, ['verse', 'outro']);
    assert.equal(controller.playback.entries.length, 2);
    controller.stop();
    assert.equal(controller.playing, false);
    assert.equal(controller.abort, null);
});

test('external stopped transport cancels the rest of the song', async () => {
    let running = true;
    const { controller, timers, calls } = makeController({ clockRunning: () => running });
    controller.song = { parts: [first, second] };
    controller.armed = true;
    controller.cache.set(first.id, {});
    controller.cache.set(second.id, {});
    await controller.playSong();
    running = false;
    [...timers.values()][0]();
    assert.equal(controller.playing, false);
    assert.equal(calls.filter(call => call[0] === 'recall').length, 0);
});

test('arming prepares all playback renders and releases sources without starting audio', async () => {
    const { controller, calls } = makeController();
    controller.song = { parts: [first, second] };
    controller.loadPart = async part => { controller.cache.set(part.id, {}); };
    await controller.arm();
    assert.equal(controller.armed, true);
    assert.equal(controller.cache.size, 0);
    assert.equal(controller.renders.size, 2);
    assert.equal(controller.audioCache.bytes, 0);
    assert.equal(calls.filter(call => call[0] === 'recall').length, 0);
});

test('failed arming keeps completed renders for retry but keeps play disabled', async () => {
    const { controller } = makeController();
    controller.song = { parts: [first, second] };
    controller.loadPart = async part => {
        if (part.id === second.id) throw new Error('Missing audio');
        controller.cache.set(part.id, {});
    };
    await assert.rejects(controller.arm(), /Missing audio/);
    assert.equal(controller.armed, false);
    assert.equal(controller.cache.size, 0);
    assert.equal(controller.renders.size, 1);
    assert.equal(controller.isPartReady(first), true);
    assert.equal(controller.renders.has(first.id), true);
});

test('stop during async readiness cannot restart playback', async () => {
    let ready;
    const { controller, calls } = makeController({ ready: () => new Promise(resolve => { ready = resolve; }) });
    controller.song = { parts: [first] };
    controller.armed = true;
    controller.cache.set(first.id, {});
    const playing = controller.playSong();
    controller.stop();
    ready();
    await playing;
    assert.equal(calls.filter(call => call[0] === 'recall').length, 0);
});

test('recall restores one saved part and automatically starts it', async () => {
    const { controller, calls } = makeController();
    controller.song = { parts: [first] };
    controller.cache.set(first.id, 'saved-snapshot');
    await controller.recall(first);
    assert.equal(controller.active, first.id);
    assert.equal(controller.playing, false);
    assert.equal(calls.find(call => call[0] === 'recall')[1], 'saved-snapshot');
});

test('changing the saved arrangement invalidates armed cache', () => {
    const { controller } = makeController();
    controller.armed = true;
    controller.cache.set(first.id, {});
    controller.acceptSong({ id: 'song', parts: [first] });
    assert.equal(controller.armed, false);
    assert.equal(controller.cache.size, 0);
});

test('next pattern is already audio-clock scheduled before the first part plays', async () => {
    const { controller, calls } = makeController();
    controller.song = { parts: [first, second] };
    controller.cache.set(first.id, 'intro');
    controller.cache.set(second.id, 'verse-with-long-samples');
    controller.armed = true;
    await controller.playSong();
    assert.deepEqual(calls.filter(call => call[0] === 'scheduled'), [['scheduled', 'intro', 0, 4], ['scheduled', 'verse', 4, 6]]);
});

test('delayed UI callbacks do not determine audio handoff times', async () => {
    const { controller, timers, setClock, calls } = makeController();
    controller.song = { parts: [first, second, { ...second, id: 'outro' }] };
    for (const part of controller.song.parts) controller.cache.set(part.id, part.id);
    controller.armed = true;
    await controller.playSong();
    const scheduled = calls.filter(call => call[0] === 'scheduled');
    setClock(4.15);
    [...timers.values()].at(-1)();
    assert.equal(controller.active, 'verse');
    setClock(6.23);
    [...timers.values()].at(-1)();
    assert.deepEqual(scheduled.map(call => call.slice(2)), [[0, 4], [4, 6], [6, 8]]);
    assert.equal(controller.active, 'outro');
});

test('last part is cut at pattern length even if rendered audio is longer', async () => {
    const stops = [];
    const { controller, timers, setClock } = makeController({ stop: options => stops.push(options) });
    controller.song = { parts: [first] };
    controller.cache.set(first.id, { sampleDuration: 20 });
    controller.armed = true;
    await controller.playSong();
    setClock(3.999);
    [...timers.values()].at(-1)();
    assert.equal(controller.playing, true);
    setClock(4);
    [...timers.values()].at(-1)();
    assert.equal(controller.playing, false);
    assert.equal(stops.at(-1).hardCut, true);
});

test('Recall loads an editable part without starting transport or selecting an amendment', async () => {
    const { controller, calls } = makeController();
    controller.song = { id: 'song', parts: [first] };
    controller.cache.set(first.id, 'editable-snapshot');
    await controller.recall(first, { start: false });
    assert.equal(calls.find(call => call[0] === 'recall')[2].start, false);
    assert.equal(controller.editing, null);
    assert.equal(controller.element('songBetaPartName').value, first.name);
});

test('Amend loads the saved snapshot and Save atomically commits that part rather than appending', async () => {
    const { controller, calls } = makeController();
    const part = { ...first, sha256: 'original' };
    controller.song = { id: 'song', parts: [part] };
    controller.cache.set(part.id, { sourceSha256: part.sha256 });
    await controller.recall(part, { start: false, amend: true });
    assert.equal(controller.editing.id, part.id);
    assert.equal(calls.find(call => call[0] === 'recall')[2].start, false);
    let uploaded;
    controller.request = async (path, options) => {
        uploaded = { path, options };
        return { song: { id: 'song', parts: [{ ...part, sha256: 'amended', name: 'Chorus', revision: 2 }] } };
    };
    controller.element('songBetaPartName').value = 'Chorus';
    controller.armed = true;
    await controller.savePart();
    assert.match(uploaded.path, /\/parts\/intro\/save\?sha256=original&name=Chorus&repeats=2/);
    assert.equal(uploaded.options.method, 'POST');
    assert.equal(controller.song.parts.length, 1);
    assert.equal(controller.song.parts[0].id, first.id);
    assert.equal(controller.editing, null);
    assert.equal(controller.armed, false);
});

test('failed amendment upload preserves the draft for retry', async () => {
    const { controller } = makeController();
    const part = { ...first, sha256: 'original' };
    controller.song = { id: 'song', parts: [part] };
    controller.editing = { id: first.id, songId: 'song', sha256: 'original' };
    controller.element('songBetaPartName').value = 'Chorus';
    controller.element('songBetaRepeats').value = 1;
    controller.request = async () => { throw new Error('Server save failed'); };
    await assert.rejects(controller.savePart(), /Server save failed/);
    assert.equal(controller.editing.id, first.id);
    assert.equal(controller.song.parts[0], part);
});

test('Amend on the currently recalled pattern keeps unsaved live edits rather than recalling over them', async () => {
    const { controller, calls } = makeController();
    const part = { ...first, sha256: 'original' };
    controller.song = { id: 'song', parts: [part] };
    controller.cache.set(part.id, { sourceSha256: part.sha256 });
    await controller.recall(part, { start: false });
    controller.element('songBetaPartName').value = 'Edited current pattern';
    await controller.amendPart(part);
    assert.equal(calls.filter(call => call[0] === 'recall').length, 1);
    assert.equal(controller.element('songBetaPartName').value, 'Edited current pattern');
    assert.equal(controller.editing.id, part.id);
});

test('inline repeats save only arrangement metadata and update the next playback boundaries', async () => {
    const { controller, calls } = makeController();
    const part = { ...first, sha256: 'unchanged', render: { sha256: 'cached-render' } };
    controller.song = { id: 'song', parts: [part, second] };
    controller.active = part.id;
    controller.armed = true;
    let uploaded;
    controller.request = async (requestPath, options) => {
        uploaded = { path: requestPath, options };
        const parts = JSON.parse(options.body).parts;
        return { song: { id: 'song', parts: [part, second].map(entry => ({ ...entry, ...parts.find(saved => saved.id === entry.id) })) } };
    };
    await controller.setRepeats(part, '3');
    assert.equal(uploaded.path, '/song/arrange');
    assert.equal(uploaded.options.method, 'POST');
    assert.deepEqual(JSON.parse(uploaded.options.body).parts, [
        { id: first.id, name: first.name, repeats: 3 },
        { id: second.id, name: second.name, repeats: second.repeats }
    ]);
    assert.equal(controller.song.parts[0].sha256, part.sha256);
    assert.equal(controller.song.parts[0].render.sha256, part.render.sha256);
    assert.equal(controller.element('songBetaRepeats').value, 3);
    assert.equal(controller.armed, false);
    controller.armed = true;
    await controller.playSong();
    assert.deepEqual(calls.filter(call => call[0] === 'scheduled').map(call => call.slice(2)), [[0, 6], [6, 8]]);
});

test('invalid inline repeats never change or upload saved parts', async () => {
    const { controller } = makeController();
    controller.song = { id: 'song', parts: [first] };
    for (const value of ['', '0', '-1', '65', '1.5', 'abc', 'Infinity']) {
        await assert.rejects(controller.setRepeats(first, value), /1–64 whole-pattern repeats/);
        assert.equal(controller.song.parts[0].repeats, first.repeats);
    }
});

test('inline repeats refuse changes during playback or a pending amendment', async () => {
    const { controller } = makeController();
    controller.song = { id: 'song', parts: [first] };
    controller.playing = true;
    await assert.rejects(controller.setRepeats(first, 3), /Stop playback/);
    controller.playing = false;
    controller.editing = { id: first.id };
    await assert.rejects(controller.setRepeats(first, 3), /finish the amendment/);
});

test('failed repeat saves preserve the previous arrangement and armed cache', async () => {
    const { controller } = makeController();
    controller.song = { id: 'song', parts: [first] };
    controller.armed = true;
    controller.request = async () => { throw new Error('Server save failed'); };
    await assert.rejects(controller.setRepeats(first, 3), /Server save failed/);
    assert.equal(controller.song.parts[0], first);
    assert.equal(controller.armed, true);
});

test('unchanged inline repeats do not save or invalidate the cache', async () => {
    const { controller } = makeController();
    controller.song = { id: 'song', parts: [first] };
    controller.armed = true;
    await controller.setRepeats(first, String(first.repeats));
    assert.equal(controller.song.parts[0], first);
    assert.equal(controller.armed, true);
});

test('part colour saves metadata without invalidating armed audio or amendments', async () => {
    const { controller, calls } = makeController();
    const part = { ...first, sha256: 'snapshot', render: { sha256: 'render' } };
    controller.song = { id: 'song', parts: [part, second] };
    controller.songs = [controller.song];
    controller.armed = true;
    controller.playing = true;
    const draft = { id: part.id, sha256: part.sha256 };
    controller.editing = draft;
    const audio = {};
    controller.renders.set(part.id, audio);
    let uploaded;
    controller.request = async (requestPath, options) => {
        uploaded = { path: requestPath, options };
        return { song: { ...controller.song, parts: [{ ...part, ...JSON.parse(options.body) }, second] } };
    };
    await controller.setColour(part, '#AABBCC');
    assert.equal(uploaded.path, '/song/parts/intro/colour?sha256=snapshot');
    assert.equal(uploaded.options.method, 'POST');
    assert.deepEqual(JSON.parse(uploaded.options.body), { colour: '#aabbcc' });
    assert.equal(controller.song.parts[0].colour, '#aabbcc');
    assert.equal(controller.song.parts[0].render, part.render);
    assert.equal(controller.songs[0], controller.song);
    assert.equal(controller.renders.get(part.id), audio);
    assert.equal(controller.armed, true);
    assert.equal(controller.playing, true);
    assert.equal(controller.editing, draft);
    assert.equal(calls.filter(call => call[0] === 'stop').length, 0);
});

test('clearing a colour explicitly saves null without changing snapshot metadata', async () => {
    const { controller } = makeController();
    const part = { ...first, sha256: 'snapshot', colour: '#aabbcc' };
    controller.song = { id: 'song', parts: [part] };
    controller.request = async (requestPath, options) => {
        assert.deepEqual(JSON.parse(options.body), { colour: null });
        return { song: { ...controller.song, parts: [{ ...part, colour: null }] } };
    };
    await controller.setColour(part, null);
    assert.equal(controller.song.parts[0].colour, null);
    assert.equal(controller.song.parts[0].sha256, part.sha256);
});

test('invalid or unchanged colours do not upload anything', async () => {
    const { controller } = makeController();
    const part = { ...first, colour: '#aabbcc' };
    controller.song = { id: 'song', parts: [part] };
    for (const value of ['', '#fff', 'red', '#12345678', '#zzzzzz', 'url(bad)', 42]) {
        await assert.rejects(controller.setColour(part, value), /hex colour/);
    }
    await controller.setColour(part, '#AABBCC');
    await controller.setColour(first, null);
    assert.equal(controller.song.parts[0], part);
});

test('failed colour writes keep the previous colour and armed cache', async () => {
    const { controller } = makeController();
    const part = { ...first, colour: '#aabbcc' };
    controller.song = { id: 'song', parts: [part] };
    controller.armed = true;
    controller.request = async () => { throw new Error('Disk full'); };
    await assert.rejects(controller.setColour(part, '#112233'), /Disk full/);
    assert.equal(controller.song.parts[0], part);
    assert.equal(controller.armed, true);
});

function cachedSongFixture() {
    const fixture = makeController();
    const { controller } = fixture;
    controller.song = { id: 'song', name: 'Song', parts: [{ ...first, sha256: 'intro-hash' }, { ...second, sha256: 'verse-hash' }] };
    const shared = { length: 100, numberOfChannels: 1 };
    controller.audioCache.buffers.set('shared', shared);
    controller.audioCache.bytes = 400;
    for (const part of controller.song.parts) {
        controller.cache.set(part.id, { sourceSha256: part.sha256, buffers: new Map([['audio', shared]]) });
        controller.renders.set(part.id, { length: 200, numberOfChannels: 2 });
        controller.renderSources.set(part.id, part.sha256);
    }
    controller.renderBytes = 3200;
    return fixture;
}

test('reusing an armed part appends a reference without capturing or duplicating audio', async () => {
    const { controller } = cachedSongFixture();
    const part = controller.song.parts[0];
    const render = controller.renders.get(part.id);
    const reference = { ...part, id: 'intro-again', sourcePartId: part.id };
    controller.armed = true;
    controller.adapter.capture = async () => assert.fail('Reuse must not capture a new snapshot');
    controller.request = async (path, options) => {
        assert.equal(path, `/song/parts/${part.id}/reuse?sha256=${part.sha256}`);
        assert.equal(options.method, 'POST');
        assert.equal(options.body, undefined);
        return { song: { ...controller.song, parts: [...controller.song.parts, reference] } };
    };
    await controller.reusePart(part);
    assert.equal(controller.song.parts.at(-1).sourcePartId, part.id);
    assert.equal(controller.armed, true);
    assert.equal(controller.renders.get(part.id), render);
    assert.equal(controller.renders.size, 2);
    assert.equal(controller.renderBytes, 3200);
    assert.equal(controller.isPartReady(reference), true);
    controller.loadPart = async () => assert.fail('An unchanged reference must not load originals');
    controller.prepareRender = async () => assert.fail('An unchanged reference must not render again');
    await controller.arm();
    assert.equal(controller.renders.size, 2);
});

test('a full copy appends an independent ready part without recalling or capturing the live pattern', async () => {
    const { controller } = cachedSongFixture();
    const part = controller.song.parts[0];
    part.render = { version: 1, sourceSha256: part.sha256, sha256: 'render-hash', keyboardVersion: 1, grainVersion: 4, portableVersion: 1 };
    const copied = { ...part, id: 'independent', name: 'Intro_full_copy', archive: 'independent.zip', render: { ...part.render, file: 'independent.wav' } };
    controller.armed = true;
    controller.adapter.capture = async () => assert.fail('Copy must not capture live sounds');
    controller.adapter.recall = async () => assert.fail('Copy must not recall over live sounds');
    controller.request = async (path, options) => {
        assert.equal(path, `/song/parts/${part.id}/full-copy?sha256=${part.sha256}`);
        assert.equal(options.method, 'POST');
        assert.equal(options.body, undefined);
        return { song: { ...controller.song, parts: [...controller.song.parts, copied] }, partId: copied.id };
    };
    await controller.fullCopyPart(part);
    assert.equal(controller.song.parts.at(-1), copied);
    assert.equal(controller.armed, true);
    assert.equal(controller.isPartReady(copied), true);
    assert.equal(controller.cache.has(copied.id), false);
    assert.equal(controller.renders.has(copied.id), false);
    assert.equal(controller.expandedParts.has(`song:${copied.id}`), true);
});

test('full copy refuses playback or unsaved amendments and preserves the song on server failure', async () => {
    const { controller } = cachedSongFixture();
    const part = controller.song.parts[0], song = controller.song;
    let requested = false;
    controller.request = async () => { requested = true; throw Error('Disk full'); };
    controller.playing = true;
    await assert.rejects(controller.fullCopyPart(part), /Stop the song/);
    controller.playing = false;
    controller.editing = { id: part.id };
    await assert.rejects(controller.fullCopyPart(part), /finish the amendment/);
    assert.equal(requested, false);
    controller.editing = null;
    controller.armed = true;
    await assert.rejects(controller.fullCopyPart(part), /Disk full/);
    assert.equal(controller.song, song);
    assert.equal(controller.armed, true);
});

test('cache preparation admits each shared source only once even with ten workers', async () => {
    const { controller } = makeController();
    controller.armConcurrency = 10;
    controller.song = { id: 'song', parts: [first, second, ...Array.from({ length: 8 }, (unused, index) => ({ ...first, id: `reuse-${index}`, sourcePartId: first.id }))] };
    const loaded = [];
    const rendered = [];
    controller.loadPart = async part => { loaded.push(part.id); controller.cache.set(part.id, {}); };
    controller.prepareRender = async part => {
        rendered.push(part.id);
        controller.renders.set(part.id, {});
        controller.renderSources.set(part.id, part.sha256);
    };
    await controller.arm();
    assert.deepEqual(loaded, [first.id, second.id]);
    assert.deepEqual(rendered, [first.id, second.id]);
    assert.equal(controller.renders.size, 2);
    assert.equal(controller.armed, true);
    assert.equal(controller.song.parts.length, 10);
});

test('reuse refuses active playback and incomplete amendments without a server write', async () => {
    const { controller } = cachedSongFixture();
    controller.request = async () => assert.fail('A blocked reuse must not save');
    controller.playing = true;
    await assert.rejects(controller.reusePart(controller.song.parts[0]), /Stop the song/);
    controller.playing = false;
    controller.editing = { id: first.id };
    await assert.rejects(controller.reusePart(controller.song.parts[0]), /finish the amendment/);
});

test('removing an original placement retains shared source caches until its last use is removed', () => {
    const { controller } = cachedSongFixture();
    const reference = { ...controller.song.parts[0], id: 'intro-again', sourcePartId: first.id };
    const render = controller.renders.get(first.id);
    controller.acceptSong({ ...controller.song, parts: [controller.song.parts[1], reference] });
    assert.equal(controller.renders.get(first.id), render);
    assert.equal(controller.isPartReady(reference), true);
    assert.equal(controller.cache.size, 2);
    controller.acceptSong({ ...controller.song, parts: [controller.song.parts[0]] });
    assert.equal(controller.renders.has(first.id), false);
    assert.equal(controller.cache.has(first.id), false);
    assert.equal(controller.renders.size, 1);
});

test('shared amendments invalidate one source cache and every placement while preserving other sources', () => {
    const { controller } = cachedSongFixture();
    const reference = { ...controller.song.parts[0], id: 'intro-again', sourcePartId: first.id };
    const untouched = controller.renders.get(second.id);
    controller.acceptSong({ ...controller.song, parts: [...controller.song.parts, reference].map(part => (part.sourcePartId || part.id) === first.id ? { ...part, sha256: 'amended' } : part) });
    assert.equal(controller.renders.size, 1);
    assert.equal(controller.renders.get(second.id), untouched);
    assert.equal(controller.isPartReady(controller.song.parts[0]), false);
    assert.equal(controller.isPartReady(controller.song.parts[2]), false);
    assert.equal(controller.isPartReady(controller.song.parts[1]), true);
});

test('renaming a shared part updates all names while changing repeats affects only one placement', async () => {
    const { controller, context } = cachedSongFixture();
    const reference = { ...controller.song.parts[0], id: 'intro-again', sourcePartId: first.id };
    controller.song.parts.push(reference);
    let payload;
    controller.request = async (path, options) => {
        payload = JSON.parse(options.body);
        return { song: { ...controller.song, parts: controller.song.parts.map(part => ({ ...part, ...payload.parts.find(entry => entry.id === part.id) })) } };
    };
    await controller.setRepeats(reference, 5);
    assert.deepEqual(payload.parts.map(part => part.repeats), [2, 1, 5]);
    context.prompt = () => 'Verse 1';
    await controller.arrange(controller.song.parts[2]);
    assert.deepEqual(payload.parts.map(part => part.name), ['Verse 1', 'Verse', 'Verse 1']);
    assert.equal(controller.renders.size, 2);
});

test('play from a reused occurrence starts at that exact placement on hot and storage paths', async () => {
    for (const stored of [false, true]) {
        const { controller, calls } = cachedSongFixture();
        const reference = { ...controller.song.parts[0], id: 'intro-again', sourcePartId: first.id, repeats: 1 };
        controller.song.parts.push(reference);
        controller.armed = true;
        if (stored) controller.renders.clear();
        await controller.playSongFromHere(reference.id);
        assert.deepEqual(calls.filter(call => call[0] === 'scheduled').map(call => call[1]), [reference.id]);
        assert.equal(controller.active, reference.id);
        assert.equal(controller.playback.entries[0].end - controller.playback.entries[0].start, 2);
    }
});

test('recalling a reused occurrence keeps one editable source buffer and identifies the selected placement', async () => {
    const { controller } = cachedSongFixture();
    const reference = { ...controller.song.parts[0], id: 'intro-again', sourcePartId: first.id };
    controller.song.parts.push(reference);
    const decoded = controller.cache.get(first.id);
    controller.readPart = async () => assert.fail('The existing shared source must be reused');
    await controller.recall(reference, { start: false, amend: true });
    assert.equal(controller.cache.size, 1);
    assert.equal(controller.cache.get(first.id), decoded);
    assert.equal(controller.active, reference.id);
    assert.equal(controller.editing.id, reference.id);
});

test('concurrent storage loads for reused occurrences decode and retain only one render', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    let reads = 0;
    let decodes = 0;
    let release;
    const { controller } = makeController({ decodeRender: async () => { decodes += 1; return buffer; } });
    const original = { ...first, sha256: 'source', render: { version: 1, sha256: 'render', sourceSha256: 'source' } };
    const reference = { ...original, id: 'intro-again', sourcePartId: original.id };
    controller.song = { id: 'song', parts: [original, reference] };
    controller.renderSources.set(original.id, original.sha256);
    assert.equal(controller.renderKey(original), controller.renderKey(reference));
    controller.readRender = async () => { reads += 1; await new Promise(resolve => { release = resolve; }); return new ArrayBuffer(0); };
    const loading = [controller.loadRender(original), controller.loadRender(reference)];
    assert.equal(reads, 1);
    release();
    const buffers = await Promise.all(loading);
    assert.equal(buffers[0], buffers[1]);
    assert.equal(decodes, 1);
    assert.equal(controller.renders.size, 1);
    assert.equal(controller.renderBytes, 16000);
    assert.equal(controller.renderLoads.size, 0);
});

test('Stop cancels a shared in-flight load without retaining its decoded buffer', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ decodeRender: async () => buffer });
    const original = { ...first, sha256: 'source' };
    const reference = { ...original, id: 'intro-again', sourcePartId: original.id };
    controller.song = { id: 'song', parts: [original, reference] };
    controller.renderSources.set(original.id, original.sha256);
    let release;
    controller.readRender = () => new Promise(resolve => { release = resolve; });
    const loading = [controller.loadRender(original), controller.loadRender(reference)];
    controller.stop();
    release(new ArrayBuffer(0));
    const outcomes = await Promise.allSettled(loading);
    assert.ok(outcomes.every(result => result.status === 'rejected' && result.reason.name === 'AbortError'));
    assert.equal(controller.renderLoads.size, 0);
    assert.equal(controller.renders.size, 0);
    assert.equal(controller.renderBytes, 0);
});

test('failed shared loads clear the in-flight entry so another occurrence can retry', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ decodeRender: async () => buffer });
    const original = { ...first, sha256: 'source' };
    const reference = { ...original, id: 'intro-again', sourcePartId: original.id };
    controller.song = { id: 'song', parts: [original, reference] };
    controller.renderSources.set(original.id, original.sha256);
    controller.readRender = async () => { throw new Error('Storage unavailable'); };
    const outcomes = await Promise.allSettled([controller.loadRender(original), controller.loadRender(reference)]);
    assert.ok(outcomes.every(result => result.status === 'rejected'));
    assert.equal(controller.renderLoads.size, 0);
    controller.readRender = async () => new ArrayBuffer(0);
    assert.equal(await controller.loadRender(reference), buffer);
    assert.equal(controller.renders.size, 1);
});

test('a render uploaded through a reference updates every placement and uses one persistent cache key', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    let rendered = 0;
    const { controller } = makeController({ renderPart: async () => { rendered += 1; return buffer; }, encodeRender: () => new ArrayBuffer(8), decodeRender: async () => buffer });
    const original = { ...first, sha256: 'source' };
    const reference = { ...original, id: 'intro-again', sourcePartId: original.id };
    controller.song = { id: 'song', parts: [original, reference] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    controller.request = async () => ({ song: { ...controller.song, parts: controller.song.parts.map(part => ({ ...part, render: { version: 1, sha256: 'render', sourceSha256: 'source' } })) } });
    const writes = [];
    controller.renderStore.put = async key => writes.push(key);
    await controller.prepareRender(reference, {}, controller.generation);
    await controller.prepareRender(controller.song.parts[0], {}, controller.generation);
    assert.equal(rendered, 1);
    assert.equal(writes.length, 1);
    assert.equal(writes[0], controller.renderKey(controller.song.parts[0]));
    assert.equal(controller.song.parts[0].render, controller.song.parts[1].render);
    assert.equal(controller.renderBytes, 16000);
    assert.equal(controller.renders.size, 1);
});

test('parallel arming overlaps two preparations and never starts a third until a slot is free', async () => {
    const { controller } = makeController();
    controller.song = { id: 'song', parts: [first, second, { ...first, id: 'outro' }] };
    const releases = [];
    const starts = [];
    let active = 0;
    let peak = 0;
    controller.loadPart = async part => { controller.cache.set(part.id, {}); };
    controller.prepareRender = async part => {
        starts.push(part.id);
        peak = Math.max(peak, ++active);
        await new Promise(resolve => releases.push(resolve));
        active -= 1;
        controller.renders.set(part.id, {});
    };
    const arming = controller.arm();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(starts, ['intro', 'verse']);
    releases.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(starts, ['intro', 'verse', 'outro']);
    releases.splice(0).forEach(resolve => resolve());
    await arming;
    assert.equal(peak, 2);
    assert.equal(controller.armed, true);
});

test('cache worker setting accepts and remembers every count from one through ten', () => {
    for (let count = 1; count <= 10; count += 1) {
        const { controller, elements, data } = makeController({}, { 'mygrain-song-arm-concurrency-v1': String(count) });
        assert.equal(controller.armConcurrency, count);
        const select = elements.get('songBetaArmConcurrency');
        select.value = String(11 - count);
        select.listeners.change({ target: select });
        assert.equal(controller.armConcurrency, 11 - count);
        assert.equal(data.get('mygrain-song-arm-concurrency-v1'), String(11 - count));
        assert.equal(makeController({}, Object.fromEntries(data)).controller.armConcurrency, 11 - count);
    }
});

test('invalid cache worker settings fall back to the existing two-worker default', () => {
    for (const value of ['', '0', '-1', '11', '1.5', 'Infinity', 'ten']) {
        const { controller } = makeController({}, { 'mygrain-song-arm-concurrency-v1': value });
        assert.equal(controller.armConcurrency, 2);
    }
    assert.equal(makeController().controller.armConcurrency, 2);
});

test('ten workers prepare ten parts and queue further parts until a slot is free', async () => {
    const { controller } = makeController();
    controller.armConcurrency = 10;
    controller.song = { parts: Array.from({ length: 12 }, (unusedPart, index) => ({ ...first, id: `part-${index}` })) };
    const releases = [];
    const starts = [];
    let active = 0;
    let peak = 0;
    controller.loadPart = async part => { controller.cache.set(part.id, {}); };
    controller.prepareRender = async part => {
        starts.push(part.id);
        peak = Math.max(peak, ++active);
        await new Promise(resolve => releases.push(resolve));
        active -= 1;
        controller.renders.set(part.id, {});
    };
    const arming = controller.arm();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(starts.length, 10);
    releases.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(starts.length, 11);
    releases.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(starts.length, 12);
    releases.splice(0).forEach(resolve => resolve());
    await arming;
    assert.equal(peak, 10);
    assert.equal(controller.armed, true);
});

test('iPhone and desktop-mode iPad override a saved ten-worker preference and arm sequentially', async () => {
    for (const navigator of [{ userAgent: 'iPhone' }, { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }]) {
        const { controller, data } = makeController({}, { 'mygrain-song-arm-concurrency-v1': '10' }, navigator);
        assert.equal(controller.armConcurrency, 1);
        assert.equal(data.get('mygrain-song-arm-concurrency-v1'), '10', 'keep the saved desktop preference');
        assert.equal(controller.renderLimitBytes, 24 * 1024 * 1024);
        controller.armConcurrency = 10; // Even a stale caller cannot bypass admission.
        controller.song = { parts: [first, second] };
        const starts = [];
        const releases = [];
        controller.loadPart = async () => ({});
        controller.prepareRender = async part => {
            starts.push(part.id);
            await new Promise(resolve => releases.push(resolve));
            controller.renderSources.set(part.id, part.contentSha256 || part.sha256);
        };
        const arming = controller.arm();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(starts, [first.id]);
        releases.shift()();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(starts, [first.id, second.id]);
        releases.shift()();
        await arming;
        assert.equal(controller.armed, true);
    }
});

test('cancellation drains all ten render workers and never starts queued parts', async () => {
    const { controller } = makeController();
    controller.armConcurrency = 10;
    controller.song = { parts: Array.from({ length: 12 }, (unusedPart, index) => ({ ...first, id: `part-${index}` })) };
    let started = 0;
    let cleaned = 0;
    controller.loadPart = async part => { controller.cache.set(part.id, {}); };
    controller.prepareRender = async () => {
        started += 1;
        await new Promise((resolve, reject) => controller.abort.signal.addEventListener('abort', () => {
            cleaned += 1;
            reject(new DOMException('Cancelled', 'AbortError'));
        }));
    };
    const arming = controller.arm();
    const rejected = assert.rejects(arming, { name: 'AbortError' });
    await new Promise(resolve => setImmediate(resolve));
    controller.stop();
    await rejected;
    assert.equal(started, 10);
    assert.equal(cleaned, 10);
    assert.equal(controller.armed, false);
});

test('rearming skips ready parts entirely and prepares only an amended part', async () => {
    const { controller } = cachedSongFixture();
    controller.acceptSong({ ...controller.song, parts: controller.song.parts.map(part => part.id === second.id ? { ...part, sha256: 'changed' } : part) });
    const calls = [];
    controller.loadPart = async part => {
        calls.push(['load', part.id]);
        const decoded = { sourceSha256: part.sha256 };
        controller.cache.set(part.id, decoded);
        return decoded;
    };
    controller.prepareRender = async part => {
        calls.push(['render', part.id]);
        controller.renders.set(part.id, {});
        controller.renderSources.set(part.id, part.sha256);
    };
    await controller.arm();
    assert.deepEqual(calls, [['load', second.id], ['render', second.id]]);
    await controller.arm();
    assert.equal(calls.length, 2);
    assert.equal(controller.armed, true);
});

test('unchanged content hashes preserve decoded audio despite new archive timestamps', async () => {
    const { controller } = cachedSongFixture();
    const decoded = controller.cache.get(first.id);
    const render = controller.renders.get(first.id);
    decoded.contentSha256 = 'stable-content';
    controller.renderSources.set(first.id, 'stable-content');
    controller.acceptSong({ ...controller.song, parts: controller.song.parts.map(part => part.id === first.id ? { ...part, sha256: 'new-archive-hash', contentSha256: 'stable-content' } : part) });
    assert.equal(controller.cache.get(first.id), decoded);
    assert.equal(decoded.sourceSha256, 'new-archive-hash');
    assert.equal(controller.renders.get(first.id), render);
    controller.loadPart = async () => { throw new Error('Unchanged part must be skipped'); };
    controller.prepareRender = async () => { throw new Error('Unchanged part must not render'); };
    await controller.arm();
    assert.equal(controller.armed, true);
});

test('failed preparation retains previously ready parts for the next retry', async () => {
    const { controller } = cachedSongFixture();
    const render = controller.renders.get(first.id);
    controller.acceptSong({ ...controller.song, parts: controller.song.parts.map(part => part.id === second.id ? { ...part, sha256: 'changed' } : part) });
    controller.loadPart = async () => { throw new Error('Unavailable changed part'); };
    await assert.rejects(controller.arm(), /Unavailable changed part/);
    assert.equal(controller.cache.size, 0);
    assert.equal(controller.isPartReady(controller.song.parts[0]), true);
    assert.equal(controller.renders.get(first.id), render);
    assert.equal(controller.armed, false);
});

test('renaming a song saves metadata without changing its identity or armed audio', async () => {
    const { controller, context } = cachedSongFixture();
    const before = controller.song;
    const decoded = controller.cache.get(first.id);
    controller.songs = [before];
    controller.armed = true;
    context.prompt = (label, value) => { assert.equal(value, before.name); return ' Renamed Song '; };
    controller.request = async (path, options) => {
        assert.equal(path, '/song/rename');
        assert.deepEqual(JSON.parse(options.body), { name: 'Renamed Song' });
        return { song: { ...before, name: 'Renamed Song' } };
    };
    await controller.renameSong();
    assert.equal(controller.song.id, before.id);
    assert.equal(controller.song.name, 'Renamed Song');
    assert.equal(controller.songs[0].name, 'Renamed Song');
    assert.equal(controller.cache.get(first.id), decoded);
    assert.equal(controller.armed, true);
});

test('cancelled, identical and invalid song renames never save or disturb cache', async () => {
    const { controller, context } = cachedSongFixture();
    const before = controller.song;
    controller.armed = true;
    for (const value of [null, before.name]) {
        context.prompt = () => value;
        await controller.renameSong();
    }
    for (const value of ['', ' ', 'x'.repeat(101), 'invalid\nname']) {
        context.prompt = () => value;
        await assert.rejects(controller.renameSong(), /between 1 and 100/);
    }
    assert.equal(controller.song, before);
    assert.equal(controller.armed, true);
});

test('failed song rename keeps the previous name and ready cache', async () => {
    const { controller, context } = cachedSongFixture();
    const before = controller.song;
    controller.armed = true;
    context.prompt = () => 'New name';
    controller.request = async () => { throw new Error('Rename failed'); };
    await assert.rejects(controller.renameSong(), /Rename failed/);
    assert.equal(controller.song, before);
    assert.equal(controller.armed, true);
});

test('sequential mode prepares only one part at a time', async () => {
    const { controller } = makeController();
    controller.armConcurrency = 1;
    controller.song = { parts: [first, second] };
    const starts = [];
    const releases = [];
    controller.loadPart = async part => { controller.cache.set(part.id, {}); };
    controller.prepareRender = async part => {
        starts.push(part.id);
        await new Promise(resolve => releases.push(resolve));
        controller.renders.set(part.id, {});
    };
    const arming = controller.arm();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(starts, ['intro']);
    releases.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(starts, ['intro', 'verse']);
    releases.shift()();
    await arming;
});

test('rearming unchanged audio makes no network requests or new decodes and drops original sources', async () => {
    const { controller } = cachedSongFixture();
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    const render = controller.renders.get(first.id);
    await controller.arm();
    await controller.arm();
    assert.equal(controller.cache.size, 0);
    assert.equal(controller.renders.get(first.id), render);
    assert.equal(controller.audioCache.bytes, 0);
    assert.equal(controller.renderBytes, 3200);
    assert.equal(controller.armed, true);
});

test('reordering, repeat edits and renames keep matching decoded snapshots and renders', () => {
    const { controller } = cachedSongFixture();
    const decoded = controller.cache.get(first.id);
    const render = controller.renders.get(first.id);
    controller.acceptSong({ ...controller.song, parts: [{ ...controller.song.parts[1], repeats: 4 }, { ...controller.song.parts[0], name: 'Renamed' }] });
    assert.equal(controller.cache.get(first.id), decoded);
    assert.equal(controller.renders.get(first.id), render);
    assert.equal(controller.audioCache.bytes, 400);
    assert.equal(controller.armed, false);
});

test('an amendment discards only the changed part and unreferenced source buffers', () => {
    const { controller } = cachedSongFixture();
    const orphan = { length: 500, numberOfChannels: 2 };
    controller.audioCache.buffers.set('orphan', orphan);
    controller.cache.get(first.id).buffers.set('orphan', orphan);
    const unaffected = controller.cache.get(second.id);
    controller.acceptSong({ ...controller.song, parts: controller.song.parts.map(part => ({ ...part, sha256: part.id === first.id ? 'amended' : part.sha256 })) });
    assert.equal(controller.cache.has(first.id), false);
    assert.equal(controller.renders.has(first.id), false);
    assert.equal(controller.cache.get(second.id), unaffected);
    assert.equal(controller.audioCache.buffers.has('orphan'), false);
    assert.equal(controller.audioCache.bytes, 400);
    assert.equal(controller.renderBytes, 1600);
});

test('refreshing the same song keeps valid caches while switching libraries clears them', async () => {
    const { controller } = cachedSongFixture();
    const decoded = controller.cache.get(first.id);
    controller.request = async () => ({ songs: [controller.song] });
    await controller.refresh();
    assert.equal(controller.cache.get(first.id), decoded);
    controller.acceptSong({ id: 'other-song', parts: [] });
    assert.equal(controller.cache.size, 0);
    assert.equal(controller.renders.size, 0);
    assert.equal(controller.audioCache.bytes, 0);
});

test('stopping parallel preparation aborts both renderers, drains their cleanup and never arms', async () => {
    const { controller } = makeController();
    controller.song = { parts: [first, second, { ...first, id: 'outro' }] };
    let started = 0;
    let cleaned = 0;
    controller.loadPart = async part => { controller.cache.set(part.id, {}); };
    controller.prepareRender = async () => {
        started += 1;
        const signal = controller.abort.signal;
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => {
            setImmediate(() => { cleaned += 1; reject(new DOMException('Cancelled', 'AbortError')); });
        }));
    };
    const arming = controller.arm();
    const rejected = assert.rejects(arming, { name: 'AbortError' });
    await new Promise(resolve => setImmediate(resolve));
    controller.stop();
    await rejected;
    assert.equal(started, 2);
    assert.equal(cleaned, 2);
    assert.equal(controller.armed, false);
    assert.equal(controller.abort, null);
});

test('one failed worker cancels its peer before clearing partial cache', async () => {
    const { controller } = makeController();
    controller.song = { parts: [first, second] };
    let cleaned = false;
    controller.loadPart = async part => { controller.cache.set(part.id, {}); };
    controller.prepareRender = async part => {
        if (part.id === first.id) throw new Error('Render failed');
        const signal = controller.abort.signal;
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => setImmediate(() => {
            cleaned = true;
            reject(new DOMException('Cancelled', 'AbortError'));
        })));
    };
    await assert.rejects(controller.arm(), /Render failed/);
    assert.equal(cleaned, true);
    assert.equal(controller.cache.size, 0);
    assert.equal(controller.renders.size, 0);
    assert.equal(controller.armed, false);
});

test('out-of-order render upload responses merge metadata rather than losing another render', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8), decodeRender: async () => buffer });
    controller.song = { id: 'song', parts: [{ ...first, sha256: 'a' }, { ...second, sha256: 'b' }] };
    controller.songs = [controller.song];
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    const responses = new Map();
    controller.request = path => new Promise(resolve => responses.set(path.includes('/intro/') ? 'intro' : 'verse', resolve));
    const preparations = controller.song.parts.map(part => controller.prepareRender(part, {}, controller.generation));
    await new Promise(resolve => setImmediate(resolve));
    responses.get('verse')({ song: { ...controller.song, parts: controller.song.parts.map(part => part.id === 'verse' ? { ...part, render: { sourceSha256: part.sha256, sha256: 'render-b' } } : part) } });
    await preparations[1];
    responses.get('intro')({ song: { ...controller.song, parts: controller.song.parts.map(part => part.id === 'intro' ? { ...part, render: { sourceSha256: part.sha256, sha256: 'render-a' } } : { ...part, render: undefined }) } });
    await preparations[0];
    assert.deepEqual(Array.from(controller.song.parts, part => part.render.sha256), ['render-a', 'render-b']);
    assert.equal(controller.renderBytes, 32000);
});

test('concurrent render completions evict decoded playback audio instead of rejecting a large song', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8), decodeRender: async () => buffer });
    controller.song = { id: 'song', parts: [{ ...first, sha256: 'a' }, { ...second, sha256: 'b' }] };
    controller.renderLimitBytes = 20000;
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    controller.request = async () => ({ song: { ...controller.song, parts: controller.song.parts.map(part => ({ ...part, render: { sourceSha256: part.sha256 } })) } });
    const results = await Promise.allSettled(controller.song.parts.map(part => controller.prepareRender(part, {}, controller.generation)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
    assert.equal(controller.renderSources.size, 2);
    assert.equal(controller.renders.size, 1);
    assert.equal(controller.renderBytes, 16000);
});

test('missing or corrupt browser render copies recover from the verified server copy', async () => {
    const { controller } = makeController();
    const body = Uint8Array.from([1, 2, 3, 4]).buffer;
    const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', body)).toString('hex');
    const part = { ...first, sha256: 'snapshot', render: { version: 1, sha256: hash, sourceSha256: 'snapshot' } };
    controller.song = { id: 'song', parts: [part] };
    const key = controller.renderKey(part);
    await controller.renderStore.put(key, Uint8Array.from([5]).buffer);
    let requests = 0;
    controller.request = async () => { requests += 1; return body; };
    assert.equal(await controller.readRender(part), body);
    assert.equal(requests, 1);
    assert.equal(await controller.renderStore.get(key), body);
    await controller.renderStore.put(key, body);
    assert.equal(await controller.readRender(part), body);
    assert.equal(requests, 1);
    await controller.renderStore.delete(key);
    controller.request = async () => Uint8Array.from([0]).buffer;
    await assert.rejects(controller.readRender(part), /integrity/);
});

test('legacy keyboard renders are regenerated and marked without double-counting the in-memory cache', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    let rendered = 0;
    const { controller } = makeController({
        renderPart: async () => { rendered += 1; return buffer; },
        encodeRender: () => new ArrayBuffer(8), decodeRender: async () => buffer
    });
    const part = { ...first, sha256: 'snapshot', render: { version: 1, sourceSha256: 'snapshot', sha256: 'legacy' } };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    controller.renders.set(part.id, buffer);
    controller.renderSources.set(part.id, part.sha256);
    controller.renderBytes = 16000;
    controller.request = async (path, options) => {
        assert.match(path, /render\?sha256=snapshot&keyboard=1$/);
        assert.equal(options.method, 'POST');
        return { song: { ...controller.song, parts: [{ ...part, render: { ...part.render, keyboardVersion: 1 } }] } };
    };
    await controller.prepareRender(part, { snapshot: { extra: { heldNotes: ['C3', 'E3', 'G3'] } } }, controller.generation);
    assert.equal(rendered, 1);
    assert.equal(controller.renderBytes, 16000);
    assert.equal(controller.song.parts[0].render.keyboardVersion, 1);
});

test('keyboard-aware matching renders are reused without regenerating or fetching', async () => {
    const { controller } = makeController();
    const part = { ...first, sha256: 'snapshot', render: { version: 1, sourceSha256: 'snapshot', keyboardVersion: 1 } };
    const buffer = { duration: 2, length: 2000, numberOfChannels: 2 };
    controller.song = { id: 'song', parts: [part] };
    controller.renders.set(part.id, buffer);
    controller.renderSources.set(part.id, part.sha256);
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    await controller.prepareRender(part, { snapshot: { extra: { heldNotes: ['C3', 'E3'] } } }, controller.generation);
    assert.equal(controller.renders.get(part.id), buffer);
});

test('keyboard rendering refuses an old server rather than accepting an unmarked render', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8) });
    const part = { ...first, sha256: 'snapshot' };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    controller.request = async () => ({ song: { ...controller.song, parts: [{ ...part, render: { sourceSha256: 'snapshot', version: 1 } }] } });
    await assert.rejects(controller.prepareRender(part, { snapshot: { extra: { heldNotes: ['C3'] } } }, controller.generation), /server needs keyboard-render support/);
    assert.equal(controller.renders.size, 0);
});

test('song export prompts before arming, reuses an armed arrangement and reports the server filename', async () => {
    let uploads = 0;
    const { controller, calls } = makeController({
        chooseSongExportFilename: () => 'Renamed.song.120.wav',
        exportSong: async (parts, renders, name, signal) => {
            assert.deepEqual(parts, controller.song.parts);
            assert.equal(renders, controller.renders);
            assert.equal(name, 'Renamed.song.120.wav');
            assert.equal(signal.aborted, false);
            uploads += 1;
            return { savedName: 'Renamed.song.120-2.wav' };
        }
    });
    controller.song = { id: 'song', parts: [first] };
    controller.armed = true;
    controller.arm = async () => { throw new Error('Unnecessary re-arm'); };
    controller.renders.set(first.id, {});
    await controller.exportSong();
    assert.equal(uploads, 1);
    assert.equal(controller.abort, null);
    assert.match(calls.at(-1)[1], /Renamed.song.120-2.wav/);
});

test('cancelled filename prompt does not prepare or upload audio', async () => {
    const { controller } = makeController({ chooseSongExportFilename: () => null });
    controller.song = { id: 'song', parts: [first] };
    controller.arm = async () => { throw new Error('Unexpected arm'); };
    await controller.exportSong();
    assert.equal(controller.abort, null);
});

test('unarmed song export prepares the cache first and blocks incomplete amendments or playback', async () => {
    const order = [];
    const { controller } = makeController({ chooseSongExportFilename: () => 'Song.song.120.wav', exportSong: async () => { order.push('upload'); return {}; } });
    controller.song = { id: 'song', parts: [first] };
    controller.arm = async () => { order.push('arm'); controller.armed = true; };
    await controller.exportSong();
    assert.deepEqual(order, ['arm', 'upload']);
    controller.playing = true;
    await assert.rejects(controller.exportSong(), /Stop the song/);
    controller.playing = false;
    controller.editing = { id: first.id };
    await assert.rejects(controller.exportSong(), /finish the amendment/);
});

test('pre-smoothing grain renders refresh on manual Arm but non-grain frozen recordings remain compatible', () => {
    const { controller } = makeController();
    const part = { ...first, render: { version: 1, sourceSha256: first.sha256, grainVersion: 1 } };
    assert.equal(controller.isRenderCompatible(part, { snapshot: { state: { modes: { granularLayersEnabled: true } } } }), false);
    assert.equal(controller.isRenderCompatible(part, { snapshot: { state: { modes: { granularLayersEnabled: false } } } }), true);
    part.render.grainVersion = 2;
    assert.equal(controller.isRenderCompatible(part, { snapshot: { state: { modes: { granularLayersEnabled: true } } } }), false);
    part.render.grainVersion = 3;
    assert.equal(controller.isRenderCompatible(part, { snapshot: { state: { modes: { granularLayersEnabled: true } } } }), false);
    part.render.grainVersion = 4;
    assert.equal(controller.isRenderCompatible(part, { snapshot: { state: { modes: { granularLayersEnabled: true } } } }), true);
});

test('old granular renders regenerate with a current smoothing marker and unchanged snapshot', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    let rendered = 0;
    const { controller } = makeController({ renderPart: async () => { rendered += 1; return buffer; }, encodeRender: () => new ArrayBuffer(8), decodeRender: async () => buffer });
    const part = { ...first, sha256: 'snapshot', render: { version: 1, sourceSha256: 'snapshot' } };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    controller.request = async path => {
        assert.match(path, /&grain=4$/);
        return { song: { ...controller.song, parts: [{ ...part, render: { ...part.render, grainVersion: 4 } }] } };
    };
    await controller.prepareRender(part, { snapshot: { state: { modes: { granularLayersEnabled: true } } } }, controller.generation);
    assert.equal(rendered, 1);
    assert.equal(controller.song.parts[0].sha256, 'snapshot');
    assert.equal(controller.song.parts[0].render.grainVersion, 4);
});

test('vocal-cut snapshots reject incompatible cached audio and regenerate with a version marker', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    let rendered = 0;
    const { controller } = makeController({ renderPart: async () => { rendered += 1; return buffer; }, encodeRender: () => new ArrayBuffer(8), decodeRender: async () => buffer });
    const part = { ...first, sha256: 'snapshot', render: { version: 1, sourceSha256: 'snapshot' } };
    const decoded = { snapshot: { state: { modes: { bastardLoopVCut: { enabled: true, start: 6 / 16, end: 8 / 16 } } } } };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    assert.equal(controller.isRenderCompatible(part, decoded), false);
    controller.request = async requestPath => {
        assert.match(requestPath, /&vocalcut=1$/);
        return { song: { ...controller.song, parts: [{ ...part, render: { ...part.render, vocalCutVersion: 1 } }] } };
    };
    await controller.prepareRender(part, decoded, controller.generation);
    assert.equal(rendered, 1);
    assert.equal(controller.song.parts[0].sha256, 'snapshot');
    assert.equal(controller.isRenderCompatible(controller.song.parts[0], decoded), true);
    assert.equal(controller.isRenderCompatible(part, { snapshot: {} }), true);
});

test('vocal-cut rendering refuses an old server rather than saving uncategorized audio', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8) });
    const part = { ...first, sha256: 'snapshot' };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    controller.request = async () => ({ song: { parts: [{ ...part, render: { version: 1 } }] } });
    await assert.rejects(controller.prepareRender(part, { snapshot: { state: { modes: { bastardLoopVCut: { enabled: true } } } } }, controller.generation), /server needs vocal-cut render support/);
});

test('section-repeat and new drum lanes invalidate legacy renders and save explicit feature markers', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8), decodeRender: async () => buffer });
    const part = { ...first, sha256: 'snapshot', render: { version: 1, sourceSha256: 'snapshot', vocalCutVersion: 1 } };
    const decoded = { snapshot: { state: { modes: { bastardLoopVCut: { enabled: true, repeat: true }, drumMachineExtraTracks: { clap: { pattern: [true] }, cymbals: { pattern: [true] } } } } } };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    assert.equal(controller.isRenderCompatible(part, decoded), false);
    controller.request = async requestPath => {
        assert.match(requestPath, /&vocalcut=1&vocalrepeat=1&drumlanes=1$/);
        return { song: { parts: [{ ...part, render: { ...part.render, vocalRepeatVersion: 1, drumLanesVersion: 1 } }] } };
    };
    await controller.prepareRender(part, decoded, controller.generation);
    assert.equal(controller.isRenderCompatible(controller.song.parts[0], decoded), true);
});

test('new features refuse an old render server instead of silently dropping repeat or drums', async () => {
    for (const [modes, message] of [
        [{ bastardLoopVCut: { enabled: true, repeat: true } }, /server needs vocal section-repeat/],
        [{ drumMachineExtraTracks: { clap: { pattern: [true] } } }, /server needs Clap\/Cymbals/]
    ]) {
        const { controller } = makeController({ renderPart: async () => ({ duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 }), encodeRender: () => new ArrayBuffer(8) });
        const part = { ...first, sha256: 'snapshot' };
        controller.song = { id: 'song', parts: [part] };
        controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
        controller.request = async () => ({ song: { parts: [{ ...part, render: { version: 1, vocalCutVersion: 1 } }] } });
        await assert.rejects(controller.prepareRender(part, { snapshot: { state: { modes } } }, controller.generation), message);
    }
});

test('Q parts invalidate pre-Q freezes and require a Q render marker', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8), decodeRender: async () => buffer });
    const part = { ...first, sha256: 'snapshot', qVersion: 1, render: { version: 1, sourceSha256: 'snapshot' } };
    const decoded = { snapshot: { state: { q: { enabled: true, sequence: [{ notes: [48, 52, 55] }] } } } };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    assert.equal(controller.isRenderCompatible(part, decoded), false);
    controller.renderSources.set(part.id, 'snapshot');
    assert.equal(controller.isRenderCompatible(part), false);
    controller.request = async requestPath => {
        assert.match(requestPath, /&q=1$/);
        return { song: { parts: [{ ...part, render: { ...part.render, qVersion: 1 } }] } };
    };
    await controller.prepareRender(part, decoded, controller.generation);
    assert.equal(controller.isRenderCompatible(controller.song.parts[0], decoded), true);
    assert.equal(controller.isRenderCompatible(part, { snapshot: { state: { q: { enabled: false, sequence: [{ notes: [48] }] } } } }), true);
    assert.equal(controller.isRenderCompatible(part, { snapshot: { state: { q: { enabled: true, sequence: [null] } } } }), true);
});

test('Q rendering refuses an old server rather than saving a silent piano freeze', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8) });
    const part = { ...first, sha256: 'snapshot' };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    controller.request = async () => ({ song: { parts: [{ ...part, render: { version: 1 } }] } });
    await assert.rejects(controller.prepareRender(part, { snapshot: { state: { q: { enabled: true, sequence: [{ notes: [48, 52, 55] }] } } } }, controller.generation), /server needs Q piano render support/);
});

test('Q arpeggios require corrected version-three freezes while old block-chord freezes remain reusable', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8), decodeRender: async () => buffer });
    const part = { ...first, sha256: 'snapshot', qVersion: 2, render: { version: 1, sourceSha256: 'snapshot', qVersion: 1 } };
    const decoded = { snapshot: { state: { q: { enabled: true, arpEnabled: true, sequence: [{ notes: [48, 52, 55] }] } } } };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    assert.equal(controller.isRenderCompatible(part, decoded), false);
    assert.equal(controller.isRenderCompatible(part), false);
    assert.equal(controller.isRenderCompatible(part, { snapshot: { state: { q: { enabled: true, sequence: [{ notes: [48] }] } } } }), true);
    controller.request = async requestPath => {
        assert.match(requestPath, /&q=3$/);
        return { song: { parts: [{ ...part, render: { ...part.render, qVersion: 3 } }] } };
    };
    await controller.prepareRender(part, decoded, controller.generation);
    assert.equal(controller.isRenderCompatible(controller.song.parts[0], decoded), true);
    assert.equal(controller.isRenderCompatible({ ...part, render: { ...part.render, qVersion: 2 } }, decoded), false);
    assert.equal(controller.isRenderCompatible({ ...part, render: { ...part.render, qVersion: 2 } }), false);
});

test('Q arpeggio freeze refuses a server that only supports block chords', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8) });
    const part = { ...first, sha256: 'snapshot', qVersion: 2 };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    controller.request = async () => ({ song: { parts: [{ ...part, render: { version: 1, qVersion: 1 } }] } });
    await assert.rejects(controller.prepareRender(part, { snapshot: { state: { q: { enabled: true, arpEnabled: true, sequence: [{ notes: [48, 52, 55] }] } } } }, controller.generation), /Q piano arpeggiator render support/);
});

test('Q reverb invalidates hot legacy freezes and requires version-four effects renders', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8), decodeRender: async () => buffer });
    const part = { ...first, sha256: 'snapshot', qVersion: 4, render: { version: 1, sourceSha256: 'snapshot', qVersion: 3 } };
    const decoded = { snapshot: { state: { q: { enabled: true, room: .1, delayBeats: 1 / 3, sequence: [{ notes: [48, 52, 55] }] } } } };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    controller.renderSources.set(part.id, 'snapshot');
    assert.equal(controller.isRenderCompatible(part), false);
    assert.equal(controller.isRenderCompatible(part, decoded), false);
    assert.equal(controller.isRenderCompatible({ ...part, qVersion: 1 }, decoded), false);
    controller.request = async requestPath => {
        assert.match(requestPath, /&q=4$/);
        return { song: { parts: [{ ...part, render: { ...part.render, qVersion: 4 } }] } };
    };
    await controller.prepareRender(part, decoded, controller.generation);
    assert.equal(controller.isRenderCompatible(controller.song.parts[0], decoded), true);
    assert.equal(controller.isRenderCompatible(controller.song.parts[0]), true);
});

test('Q effects render refuses an old server rather than reusing distorted reverb', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8) });
    const part = { ...first, sha256: 'snapshot', qVersion: 4 };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    controller.request = async () => ({ song: { parts: [{ ...part, render: { version: 1, qVersion: 3 } }] } });
    await assert.rejects(controller.prepareRender(part, { snapshot: { state: { q: { enabled: true, room: .1, sequence: [{ notes: [48, 52, 55] }] } } } }, controller.generation), /Q piano effects render support/);
});

test('arming inspects legacy Q sources even when portable freeze metadata looks compatible', async () => {
    const { controller } = makeController();
    const part = { ...first, sha256: 'snapshot', qVersion: 1, render: { version: 1, sourceSha256: 'snapshot', qVersion: 1, keyboardVersion: 1, grainVersion: 4, portableVersion: 1 } };
    controller.song = { id: 'song', parts: [part] };
    let reads = 0;
    const readPart = controller.readPart;
    controller.readPart = async (...args) => { reads += 1; return readPart(...args); };
    assert.equal(controller.isRenderCompatible(part), true);
    await controller.arm();
    assert.equal(reads, 1);
    assert.equal(controller.armed, true);
});

test('Q strings require version-five freezes and cannot reuse a piano render', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8), decodeRender: async () => buffer });
    const part = { ...first, sha256: 'snapshot', qVersion: 5, render: { version: 1, sourceSha256: 'snapshot', qVersion: 4 } };
    const decoded = { snapshot: { state: { q: { enabled: true, instrument: 'strings', sequence: [{ notes: [48, 52, 55] }] } } } };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    controller.renderSources.set(part.id, 'snapshot');
    assert.equal(controller.isRenderCompatible(part), false);
    assert.equal(controller.isRenderCompatible(part, decoded), false);
    controller.request = async requestPath => {
        assert.match(requestPath, /&q=5$/);
        return { song: { parts: [{ ...part, render: { ...part.render, qVersion: 5 } }] } };
    };
    await controller.prepareRender(part, decoded, controller.generation);
    assert.equal(controller.isRenderCompatible(controller.song.parts[0], decoded), true);
});

test('Q strings refuse an old server instead of silently recalling the piano', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8) });
    const part = { ...first, sha256: 'snapshot', qVersion: 5 };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    controller.request = async () => ({ song: { parts: [{ ...part, render: { version: 1, qVersion: 4 } }] } });
    await assert.rejects(controller.prepareRender(part, { snapshot: { state: { q: { enabled: true, instrument: 'strings', sequence: [{ notes: [48, 52, 55] }] } } } }, controller.generation), /Q strings render support/);
});

test('Q blank accents and custom gaps require version-six freezes and reject older renderer results', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8), decodeRender: async () => buffer });
    const part = { ...first, sha256: 'snapshot', qVersion: 6, render: { version: 1, sourceSha256: 'snapshot', qVersion: 5 } };
    const decoded = { snapshot: { state: { q: { enabled: true, performanceVersion: 6, arpEnabled: true, arpPattern: 'custom', arpSteps: [3, 0, 1], sequence: [{ notes: [48, 52, 55] }, { kind: 'accent', notes: [], accent: true }] } } } };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    assert.equal(controller.isRenderCompatible(part, decoded), false);
    assert.equal(controller.isRenderCompatible(part), false);
    controller.request = async requestPath => {
        assert.match(requestPath, /&q=6$/);
        return { song: { parts: [{ ...part, render: { ...part.render, qVersion: 6 } }] } };
    };
    await controller.prepareRender(part, decoded, controller.generation);
    assert.equal(controller.isRenderCompatible(controller.song.parts[0], decoded), true);
    controller.song = { id: 'song', parts: [part] };
    controller.request = async () => ({ song: { parts: [{ ...part, render: { ...part.render, qVersion: 5 } }] } });
    await assert.rejects(controller.prepareRender(part, decoded, controller.generation), /accent \/ custom arpeggiator render support/);
    const legacyAccent = { snapshot: { state: { q: { enabled: true, instrument: 'strings', sequence: [{ notes: [48], accent: true }] } } } };
    assert.equal(controller.isRenderCompatible({ ...part, qVersion: 5 }, legacyAccent), false);
});

test('shortened Q samples require version-seven freezes while full-length legacy parts remain compatible', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8), decodeRender: async () => buffer });
    const part = { ...first, sha256: 'snapshot', qVersion: 7, render: { version: 1, sourceSha256: 'snapshot', qVersion: 6 } };
    const decoded = { snapshot: { state: { q: { enabled: true, performanceVersion: 6, sampleLength: .25, sampleDecay: .4, sequence: [{ notes: [48, 52, 55] }] } } } };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    assert.equal(controller.isRenderCompatible(part, decoded), false);
    assert.equal(controller.isRenderCompatible(part), false);
    controller.request = async requestPath => {
        assert.match(requestPath, /&q=7$/);
        return { song: { parts: [{ ...part, render: { ...part.render, qVersion: 7 } }] } };
    };
    await controller.prepareRender(part, decoded, controller.generation);
    assert.equal(controller.isRenderCompatible(controller.song.parts[0], decoded), true);
    controller.song = { id: 'song', parts: [part] };
    controller.request = async () => ({ song: { parts: [{ ...part, render: { ...part.render, qVersion: 6 } }] } });
    await assert.rejects(controller.prepareRender(part, decoded, controller.generation), /sample length \/ decay render support/);
    decoded.snapshot.state.q.sampleLength = 1;
    decoded.snapshot.state.q.sampleDecay = 1;
    assert.equal(controller.isRenderCompatible({ ...part, qVersion: 6 }, decoded), true);
    decoded.snapshot.state.q.sampleDecay = .5;
    assert.equal(controller.isRenderCompatible({ ...part, qVersion: 6 }, decoded), false);
});

test('held block chords require version-eight freezes; ARP and Hold Off preserve existing renders', async () => {
    const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
    const { controller } = makeController({ renderPart: async () => buffer, encodeRender: () => new ArrayBuffer(8), decodeRender: async () => buffer });
    const part = { ...first, sha256: 'snapshot', qVersion: 8, render: { version: 1, sourceSha256: 'snapshot', qVersion: 7 } };
    const decoded = { snapshot: { state: { q: { enabled: true, performanceVersion: 6, chordHold: true, sampleLength: 1, sampleDecay: 1, sequence: [{ notes: [48, 52, 55] }] } } } };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    assert.equal(controller.isRenderCompatible(part, decoded), false);
    assert.equal(controller.isRenderCompatible(part), false);
    controller.request = async requestPath => {
        assert.match(requestPath, /&q=8$/);
        return { song: { parts: [{ ...part, render: { ...part.render, qVersion: 8 } }] } };
    };
    await controller.prepareRender(part, decoded, controller.generation);
    assert.equal(controller.isRenderCompatible(controller.song.parts[0], decoded), true);
    controller.song = { id: 'song', parts: [part] };
    controller.request = async () => ({ song: { parts: [{ ...part, render: { ...part.render, qVersion: 7 } }] } });
    await assert.rejects(controller.prepareRender(part, decoded, controller.generation), /chord hold render support/);
    decoded.snapshot.state.q.chordHold = false;
    assert.equal(controller.isRenderCompatible({ ...part, qVersion: 6 }, decoded), true);
    decoded.snapshot.state.q.chordHold = true;
    assert.equal(controller.isRenderCompatible({ ...part, qVersion: 6 }, decoded), false);
    decoded.snapshot.state.q.arpEnabled = true;
    assert.equal(controller.isRenderCompatible({ ...part, qVersion: 6 }, decoded), true);
});

test('active sampled drums refresh old fades, including hot cached PCM, without changing the saved source', async () => {
    for (const modes of [
        { drumMachineEnabled: true, drumMachineKickPattern: [true] },
        { drumMachineEnabled: true, drumMachineExtraTracks: { etc: { pattern: [true], decay: 1, length: 1 } } }
    ]) {
        const buffer = { duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 };
        let rendered = 0;
        const { controller } = makeController({ renderPart: async () => { rendered++; return buffer; }, encodeRender: () => new ArrayBuffer(8), decodeRender: async () => buffer });
        const part = { ...first, sha256: 'snapshot', render: { version: 1, sourceSha256: 'snapshot', drumLanesVersion: 1 } };
        const decoded = { snapshot: { state: { modes } } }, original = JSON.stringify(decoded);
        controller.song = { id: 'song', parts: [part] };
        controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
        controller.renders.set(part.id, buffer); controller.renderSources.set(part.id, 'snapshot'); controller.renderBytes = 16000;
        assert.equal(controller.isRenderCompatible(part, decoded), false);
        controller.request = async requestPath => {
            assert.match(requestPath, /&drumsample=1/);
            return { song: { parts: [{ ...part, render: { ...part.render, drumSampleVersion: 1 } }] } };
        };
        await controller.prepareRender(part, decoded, controller.generation);
        assert.equal(rendered, 1); assert.equal(controller.isRenderCompatible(controller.song.parts[0], decoded), true);
        assert.equal(JSON.stringify(decoded), original); assert.equal(controller.song.parts[0].sha256, 'snapshot');
        const disabled = structuredClone(decoded); disabled.snapshot.state.modes.drumMachineEnabled = false;
        assert.equal(controller.isRenderCompatible(part, disabled), true);
    }
});

test('full-decay drum renders reject an old server and inspect unversioned legacy sources before reuse', async () => {
    const { controller } = makeController({ renderPart: async () => ({ duration: 2, length: 2000, sampleRate: 1000, numberOfChannels: 2 }), encodeRender: () => new ArrayBuffer(8) });
    const part = { ...first, sha256: 'snapshot', render: { version: 1, sourceSha256: 'snapshot', keyboardVersion: 1, grainVersion: 4, portableVersion: 1 } };
    controller.song = { id: 'song', parts: [part] };
    controller.prepareRender = Object.getPrototypeOf(controller).prepareRender;
    controller.request = async () => ({ song: { parts: [part] } });
    await assert.rejects(controller.prepareRender(part, { snapshot: { state: { modes: { drumMachineEnabled: true, drumMachineSnarePattern: [true] } } } }, controller.generation), /full-decay drum sample render support/);
    const fixture = makeController(); fixture.controller.song = { id: 'song', parts: [part] };
    let reads = 0; const read = fixture.controller.readPart;
    fixture.controller.readPart = async (...args) => { reads++; return read(...args); };
    await fixture.controller.arm(); assert.equal(reads, 1); assert.equal(fixture.controller.armed, true);
});

test('Amend exposes preparation before a delayed lease and clears it on failure without claiming readiness', async () => {
    const {controller} = makeController();
    const part = {...first, sha256: 'saved'};
    controller.song = {id: 'song', parts: [part]};
    let rejectLease;
    controller.ensureEditing = () => new Promise((resolve, reject) => { rejectLease = reject; });
    const pending = controller.amendPart(part);
    assert.equal(controller.amendLoading.id, part.id);
    assert.equal(controller.editing, null);
    rejectLease(new Error('Another device owns this Song'));
    await assert.rejects(pending, /Another device/);
    assert.equal(controller.amendLoading, null);
    assert.equal(controller.editing, null);
});

test('original archive cache is exact-hash/library/song scoped, verified and repairs corrupt local bytes', async () => {
    const {controller} = makeController({inspectPart: () => ({snapshot: {}, decodedBytes: 4})});
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
    const part = {...first, sha256, bytes: bytes.byteLength};
    controller.song = {id: 'song', parts: [part]};
    const archives = new Map(), keys = [];
    controller.sourceStore = {
        get: async key => {keys.push(key); return archives.get(key);},
        put: async (key, value) => {archives.set(key, value);},
        delete: async key => {archives.delete(key);}
    };
    let downloads = 0;
    controller.request = async () => {downloads++; return bytes;};
    const read = () => Object.getPrototypeOf(controller).readPart.call(controller, part);
    for (let i = 0; i < 2; i++) {const info = await read(); info.releaseDownload();}
    assert.equal(downloads, 1);
    archives.set(keys.at(-1), new Uint8Array([9]).buffer);
    (await read()).releaseDownload();
    assert.equal(downloads, 2);
    controller.key = 'different-library';
    (await read()).releaseDownload();
    assert.equal(downloads, 3);
    assert.notEqual(keys.at(-1), keys[0]);
    controller.song.id = 'another-song';
    (await read()).releaseDownload();
    assert.equal(downloads, 4);
    part.sha256 = 'bad-server-hash';
    await assert.rejects(read(), /integrity check failed/);
    assert.equal(controller.downloadBudget.bytes, 0);
    assert.equal(archives.size, 3);
});

test('losing the verified lease during Amend loading never restores audio or enables the draft', async () => {
    const {controller, calls} = makeController();
    const part = {...first, sha256: 'saved'};
    controller.song = {id: 'song', parts: [part]};
    controller.loadPart = async () => {
        controller.canEditSong = () => false;
        return {buffers: new Map(), snapshot: {}};
    };
    await assert.rejects(controller.amendPart(part), /editing|access|Edit Song/i);
    assert.equal(controller.editing, null);
    assert.equal(controller.amendLoading, null);
    assert.equal(calls.some(call => call[0] === 'recall'), false);
});

function pastePickerFixture() {
    const fixture = makeController();
    const { controller, context } = fixture;
    const parts = [first, second, { ...second, id: 'bridge', name: 'Bridge' }, { ...second, id: 'outro', name: 'Outro' }].map((part, i) => ({ ...part, sha256: `original-${i}` }));
    controller.song = { id: 'paste-song', revision: 10, parts };
    controller.songs = [controller.song];
    controller.copyLoop(parts[0], ['V', 'M', 'drumKick']);
    const clipboard = controller.loopClipboard;
    const requests = [];
    context.confirm = () => assert.fail('The destination dialog is the batch confirmation');
    controller.arm = async () => assert.fail('Pasting must not arm');
    controller.adapter.recall = () => assert.fail('Pasting must not replace the live editor');
    controller.request = async (path, options) => {
        const id = path.match(/\/parts\/([^/]+)\//)[1];
        const target = controller.song.parts.find(part => part.id === id);
        requests.push({ path, payload: JSON.parse(options.body) });
        return { song: { ...controller.song, revision: controller.song.revision + 1, parts: controller.song.parts.map(part => (part.sourcePartId || part.id) === (target.sourcePartId || target.id) ? { ...part, sha256: `pasted-${requests.length}` } : part) } };
    };
    return { ...fixture, parts, clipboard, requests };
}

test('main-card paste saves multiple destinations sequentially with the pinned clipboard and never arms or recalls', async () => {
    const { controller, parts, clipboard, requests, calls } = pastePickerFixture();
    controller.armed = true;
    await controller.pasteParts([parts[1], parts[2]]);
    assert.equal(requests.length, 2);
    assert.equal(controller.song.revision, 12);
    assert.equal(controller.song.parts[0], parts[0]);
    assert.equal(controller.song.parts[3], parts[3]);
    assert.deepEqual(requests.map(request => request.payload), [1, 2].map(() => ({ sourceSongId: 'paste-song', sourcePartId: first.id, sourceSha256: 'original-0', layers: ['V', 'M', 'drumKick'] })));
    assert.equal(controller.loopClipboard, clipboard);
    assert.equal(controller.armed, false);
    assert.match(calls.at(-1)[1], /into 2 saved parts \(2 song positions\).*Arm Cache once/);
});

test('main-card paste de-duplicates linked destinations and saves every shared use exactly once', async () => {
    const { controller, parts, requests, calls } = pastePickerFixture();
    const reused = { ...parts[1], id: 'reused-verse', sourcePartId: parts[1].id, repeats: 5 };
    controller.song.parts.push(reused);
    await controller.pasteParts([parts[1], reused, parts[1]]);
    assert.equal(requests.length, 1);
    assert.equal(controller.song.parts[1].sha256, controller.song.parts.at(-1).sha256);
    assert.equal(controller.song.parts.at(-1).repeats, 5);
    assert.match(calls.at(-1)[1], /into 1 saved part \(2 song positions\)/);
});

test('main-card paste keeps an immutable source revision even when the source is also a destination', async () => {
    const { controller, parts, requests } = pastePickerFixture();
    await controller.pasteParts([parts[0], parts[1]]);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(request => request.payload.sourceSha256 === 'original-0'));
});

test('main-card paste rejects stale song/library/revision or replaced clipboard before saving anything', async () => {
    for (const change of ['song', 'library', 'revision', 'clipboard', 'target']) {
        const { controller, parts, clipboard, requests } = pastePickerFixture();
        const expected = { library: controller.key, songId: controller.song.id, revision: controller.song.revision };
        const selected = parts[1];
        if (change === 'song') controller.song = { ...controller.song, id: 'another-song' };
        if (change === 'library') controller.key = 'different';
        if (change === 'revision') controller.song = { ...controller.song, revision: 11 };
        if (change === 'clipboard') controller.loopClipboard = { ...clipboard };
        if (change === 'target') controller.song.parts[1] = { ...parts[1], sha256: 'amended' };
        await assert.rejects(controller.pasteParts([selected], expected, clipboard), /changed|current song parts/);
        assert.equal(requests.length, 0);
    }
});

test('main-card paste validates all destinations and recording/amendment/playback guards before the first write', async () => {
    for (const guard of ['empty', 'invalid', 'recording', 'editing', 'playing']) {
        const { controller, parts, requests } = pastePickerFixture();
        if (guard === 'recording') controller.adapter.assertNotRecording = () => { throw new Error('Finish recording'); };
        if (guard === 'editing') controller.editing = { id: first.id };
        if (guard === 'playing') controller.playing = true;
        const targets = guard === 'empty' ? [] : guard === 'invalid' ? [parts[1], { ...parts[2], sha256: 'old' }] : [parts[1]];
        await assert.rejects(controller.pasteParts(targets));
        assert.equal(requests.length, 0);
    }
});

test('main-card paste stops at the first failed destination, reports acknowledged saves and retains its clipboard', async () => {
    const { controller, parts, clipboard, requests } = pastePickerFixture();
    const request = controller.request;
    controller.request = async (...args) => { if (requests.length === 1) throw new Error('Lost connection'); return request(...args); };
    await assert.rejects(controller.pasteParts(parts.slice(1)), /Saved 1\/3.*stopped at Bridge.*Lost connection.*remain saved.*Refresh Songs/);
    assert.equal(requests.length, 1);
    assert.equal(controller.song.parts[1].sha256, 'pasted-1');
    assert.equal(controller.song.parts[2], parts[2]);
    assert.equal(controller.song.parts[3], parts[3]);
    assert.equal(controller.loopClipboard, clipboard);
});

function optionalKConversionController() {
    const fixture = compatibilityController();
    const { controller, context, snapshot } = fixture;
    controller.phonePreparation = true;
    controller.armConcurrency = 1;
    controller.memoryBudget = new context.MygrainSongStorage.MemoryBudget(96 * 1048576, true);
    controller.song = { ...controller.song, parts: controller.song.parts.map(part => ({ ...part, bytes: 35454452,
        render: { ...part.render, bytes: 1706712 } })) };
    controller.partManifests = true;
    controller.adapter.inspectSnapshot = () => ({ snapshot, decodedBytes: 67 * 1048576,
        upgrade: { lanes: ['K five-track recorder'], explicitOnly: true } });
    let manifests = 0;
    const request = controller.request;
    controller.request = async (endpoint, options) => {
        if (endpoint.includes('/manifest?')) {
            manifests++;
            return { format: 'mygrain-song-part-manifest', version: 1,
                sourceSha256: controller.song.parts[0].sha256, snapshot };
        }
        return request(endpoint, options);
    };
    return { ...fixture, manifests: () => manifests };
}

test('phone Arm never rewrites a large ZIP for optional K-only conversion; warm Arm reuses normalized metadata', async () => {
    const { controller, calls, requests, history, manifests } = optionalKConversionController();
    const before = JSON.stringify(controller.song);
    controller.readPart = async () => assert.fail('Arm must not download editable originals for a compatible saved mix');
    await controller.arm();
    assert.equal(controller.armed, true);
    assert.equal(JSON.stringify(controller.song), before);
    assert.equal(controller.memoryBudget.limitBytes, 96 * 1048576);
    assert.equal(controller.memoryBudget.bytes, 0);
    assert.equal(controller.downloadBudget.bytes, 0);
    assert.equal(controller.cache.size, 0);
    assert.equal(requests.length, 0); assert.equal(history.length, 0);
    assert.equal(calls.filter(call => call[0] === 'acquire').length, 0);
    assert.equal(manifests(), 1);
    await controller.arm();
    assert.equal(controller.armed, true); assert.equal(manifests(), 1);
    assert.equal(JSON.stringify(controller.song), before);
});

test('197 MB mixed legacy compatibility preparation is metadata-only during phone Arm, without edits or source ZIPs', async () => {
    const {controller,calls,history,requests,snapshot} = optionalKConversionController();
    controller.song.parts = controller.song.parts.map(p => ({...p,bytes:61628266}));
    controller.adapter.inspectSnapshot = () => ({snapshot,decodedBytes:120*1048576,
        upgrade:{lanes:['Keyboard Sample','Q','K five-track recorder'],explicitOnly:false}});
    const before=JSON.stringify(controller.song);
    controller.readPart=async()=>assert.fail('Arm must not download a source ZIP for compatibility');
    controller.adapter.upgradePart=async()=>assert.fail('Arm must not rewrite a compatibility ZIP');
    await controller.arm(); await controller.arm();
    assert.equal(controller.armed,true);assert.equal(JSON.stringify(controller.song),before);
    assert.equal(history.length,0);assert.equal(requests.length,0);
    assert.equal(calls.filter(c=>c[0]==='acquire').length,0);
    assert.equal(controller.memoryBudget.bytes,0);assert.equal(controller.downloadBudget.bytes,0);
});

test('skipping optional K persistence cannot bypass the source-rendering memory limit when no compatible mix exists', async () => {
    const { controller, history } = optionalKConversionController();
    controller.song.parts = controller.song.parts.map(part => ({ ...part, render: undefined }));
    delete controller.loadPart; // Use the real admission path, not the compatibility fixture's render stub.
    controller.readPart = async () => assert.fail('Unsafe originals must still be rejected before download');
    await assert.rejects(controller.arm(), /96 MB safety budget/);
    assert.equal(controller.armed, false); assert.equal(history.length, 0);
    assert.equal(controller.memoryBudget.bytes, 0); assert.equal(controller.downloadBudget.bytes, 0);
});

test('large and fitting explicit K conversions always send one server request and no source ZIPs', async () => {
    for (const bytes of [35454452, 1024]) {
        const { controller, history } = optionalKConversionController();
        controller.song.parts = controller.song.parts.map(p => ({ ...p, bytes }));
        controller.readPart = async () => assert.fail('Conversion must not download originals');
        controller.adapter.upgradePart = async () => assert.fail('Conversion must not rewrite archives locally');
        const requests = [];
        controller.request = async (endpoint, options) => {
            requests.push({endpoint,options});
            return {ok:true,converted:1,song:{...controller.song,revision:controller.song.revision+1}};
        };
        await controller.convertKTracks();
        assert.equal(controller.song.revision,5);
        assert.equal(requests.length,1); assert.match(requests[0].endpoint,/\/convert-k$/);
        assert.equal(requests[0].options.method,'POST');assert.equal(requests[0].options.body,undefined);
        assert.equal(history.length,0);assert.equal(controller.memoryBudget.bytes,0);assert.equal(controller.downloadBudget.bytes,0);
    }
});


function boundedEditFixture(overrides = {}) {
    const trace = [], live = { snapshot: { old: true }, buffers: new Map() }, fresh = { snapshot: { fresh: true }, buffers: new Map() };
    const f = makeController({
        editingResidency: () => ({ bytes: 1048576, scratch: 1024 }),
        planEditing: async (info, check) => { trace.push('plan'); check(); return { bytes: 40 * 1048576, verify: check }; },
        decodeEditing: async (info, plan) => { trace.push('decode'); plan.verify(); return fresh; },
        capture: async () => live,
        whenPersisted: async () => { trace.push('persist'); },
        recall: (part, options) => { trace.push(['restore', part, options]); },
        ...overrides
    }, {}, { userAgent: 'iPhone' });
    const part = { id: 'edit-source', name: 'Editable', repeats: 1, sha256: 'a'.repeat(64), bytes: 34 * 1048576 };
    f.controller.song = { id: 'bounded-edit', revision: 1, parts: [part] };
    f.controller.partAudioAssets = true;
    f.controller.readPartMetadata = async () => ({ snapshot: {}, audioAssets: [], decodedBytes: 68 * 1048576 });
    f.controller.readPart = async () => assert.fail('Bounded editing must never fetch the full source ZIP');
    return { ...f, trace, live, fresh, part };
}

test('bounded Amend transfers a fresh deck without clones or retained source cache and waits for persistence', async () => {
    const { controller: c, trace, part, fresh } = boundedEditFixture();
    c.renders.set('old', { length: 100, numberOfChannels: 2 }); c.renderBytes = 800;
    await c.recall(part, { start: false, amend: true });
    const restore = trace.find(item => Array.isArray(item));
    assert.equal(restore[1], fresh);
    assert.equal(restore[2].takeOwnership, true);
    assert.equal(restore[2].start, false);
    assert.equal(trace.at(-1), 'persist');
    assert.equal(c.cache.size, 0); assert.equal(c.audioCache.bytes, 0);
    assert.equal(c.renderBytes, 0); assert.equal(c.memoryBudget.bytes, 0);
    assert.equal(c.active, part.id); assert.equal(c.editing.id, part.id);
});

test('bounded Amend rejects an oversized editing plan before any sound fetch or live restore', async () => {
    const { controller: c, trace, part } = boundedEditFixture({ planEditing: async () => ({ bytes: 97 * 1048576, verify() {} }) });
    await assert.rejects(c.recall(part, { start: false, amend: true }), /safety budget/);
    assert.ok(!trace.includes('decode')); assert.ok(!trace.some(Array.isArray));
    assert.equal(c.memoryBudget.bytes, 0); assert.equal(c.editing, null);
});

test('bounded Amend includes the current editor during hashing and refuses unsafe residency', async () => {
    const { controller: c, trace, part } = boundedEditFixture({ editingResidency: () => ({ bytes: 90 * 1048576, scratch: 1 }) });
    await assert.rejects(c.recall(part, { start: false, amend: true }), /safety budget/);
    assert.ok(!trace.includes('plan')); assert.equal(c.memoryBudget.bytes, 0);
});

test('cancel or lease loss during sequential source loading cannot replace live audio', async () => {
    for (const mode of ['cancel', 'lease']) {
        let loading, resolve;
        const gate = new Promise(done => { resolve = done; });
        const fixture = boundedEditFixture({ decodeEditing: async () => { loading = true; await gate; return {}; } });
        const { controller: c, trace, part } = fixture;
        const pending = c.recall(part, { start: false, amend: true });
        while (!loading) await new Promise(done => setImmediate(done));
        if (mode === 'cancel') c.cancel(true); else c.canEditSong = () => false;
        resolve(); await assert.rejects(pending, mode === 'cancel' ? { name: 'AbortError' } : /read-only/);
        assert.ok(!trace.some(Array.isArray)); assert.equal(c.editing, null); assert.equal(c.memoryBudget.bytes, 0);
    }
});

test('failed editing restore rolls back exact prior state and buffer references and releases memory', async () => {
    const restored = [];
    const fixture = boundedEditFixture({ recall: (part, options) => { restored.push([part, options]); if (restored.length === 1) throw new Error('Control restore failed'); } });
    const { controller: c, part, live, fresh } = fixture;
    await assert.rejects(c.recall(part, { start: false, amend: true }), /Control restore failed/);
    assert.equal(restored[0][0], fresh); assert.equal(restored[1][0], live);
    assert.equal(restored[1][1].prepared, live); assert.equal(restored[1][1].start, false);
    assert.equal(c.memoryBudget.bytes, 0); assert.equal(c.editing, null);
});

test('bounded binary requests enforce the source WAV size before or during response reading', async () => {
    const { controller: c } = makeController();
    for (const headers of [{ 'Content-Length': '9' }, {}]) {
        let pulled = 0;
        c.fetch = async () => new Response(new ReadableStream({ pull(stream) { pulled++; stream.enqueue(new Uint8Array(5)); if (pulled === 2) stream.close(); } }), { headers });
        await assert.rejects(c.request('/sound', { binary: true, maxBinaryBytes: 4 }), /declared size/);
    }
    c.fetch = async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'Content-Length': '4' } });
    assert.deepEqual([...new Uint8Array(await c.request('/sound', { binary: true, maxBinaryBytes: 4 }))], [1, 2, 3, 4]);
});

function checkpointEditFixture({ failure, rollbackFailure, saveFailure, emptyBytes = 40 * 1048576 } = {}) {
    const fixture = boundedEditFixture();
    const { controller: c, context, live, fresh, trace } = fixture;
    let detached = false;
    c.adapter.detachEditingSources = () => { detached = true; trace.push('detach'); };
    c.adapter.releaseEditorHistory = async () => { trace.push('history-to-disk'); };
    c.adapter.context = () => ({});
    c.adapter.planEditing = async (info, check) => ({ bytes: detached ? 40 * 1048576 : 120 * 1048576, emptyBytes, verify: check });
    c.adapter.decodeEditing = async () => { if (failure) await failure(c); return fresh; };
    context.MygrainSongStorage.EditCheckpoint = class {
        async save(part, check) { assert.equal(part, live); trace.push('checkpoint'); if (saveFailure) throw saveFailure; check(); return { bytes: 1048576, largest: 1024 }; }
        async restore() { trace.push('rollback-from-disk'); if (rollbackFailure) throw rollbackFailure; return live; }
        async dispose() { trace.push('dispose-checkpoint'); }
    };
    return fixture;
}

test('a populated large editor is checkpointed before detachment; successful restore deletes only the temporary checkpoint', async () => {
    const { controller: c, part, trace } = checkpointEditFixture();
    await c.recall(part, { start: false, amend: true });
    assert.ok(trace.indexOf('checkpoint') < trace.indexOf('detach'));
    assert.ok(trace.indexOf('history-to-disk') < trace.indexOf('detach'));
    assert.equal(trace.at(-1), 'dispose-checkpoint');
    assert.ok(!trace.includes('rollback-from-disk'));
    assert.equal(c.memoryBudget.bytes, 0); assert.equal(c.cache.size, 0);
});

test('an oversized fresh deck or failed checkpoint never detaches the current editor', async () => {
    for (const options of [{ emptyBytes: 97 * 1048576 }, { saveFailure: new Error('Disk quota exceeded') }]) {
        const { controller: c, part, trace } = checkpointEditFixture(options);
        await assert.rejects(c.recall(part, { start: false, amend: true }), /safety budget|Disk quota/);
        assert.ok(!trace.includes('detach')); assert.ok(!trace.includes('rollback-from-disk'));
        assert.equal(c.memoryBudget.bytes, 0); assert.equal(c.editing, null);
    }
});

test('network failure, cancellation and lease loss after parking restore exact checkpointed audio without writing a Song', async () => {
    for (const mode of ['network', 'cancel', 'lease']) {
        const { controller: c, part, trace, live } = checkpointEditFixture({ failure: async c => {
            if (mode === 'cancel') c.cancel(true);
            else if (mode === 'lease') c.canEditSong = () => false;
            else throw new Error('Network failed');
        } });
        await assert.rejects(c.recall(part, { start: false, amend: true }));
        assert.ok(trace.includes('rollback-from-disk'), mode);
        const restores = trace.filter(Array.isArray);
        assert.equal(restores.at(-1)[1], live);
        assert.equal(restores.at(-1)[2].prepared, live);
        assert.equal(trace.at(-1), 'dispose-checkpoint');
        assert.equal(c.memoryBudget.bytes, 0); assert.equal(c.editing, null);
    }
});

test('a failed rollback retains its temporary Float32 checkpoint for recovery', async () => {
    const { controller: c, part, trace } = checkpointEditFixture({ failure: async () => { throw new Error('Network failed'); }, rollbackFailure: new Error('Temporary storage read failed') });
    await assert.rejects(c.recall(part, { start: false, amend: true }), /remain in browser checkpoint/);
    assert.ok(!trace.includes('dispose-checkpoint'));
    assert.equal(c.memoryBudget.bytes, 0); assert.equal(c.editing, null);
});
