const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { renderDatabases } = require('../mygrain-accounts.js');

const deckSource = fs.readFileSync(path.join(__dirname, '../song-beta-render-deck.js'), 'utf8');
const clockSource = fs.readFileSync(path.join(__dirname, '../song-beta-clock.js'), 'utf8');

test('finished render sources and disconnected envelopes are released during a long part, not only at frame teardown', async () => {
    const node = scheduled => Object.assign(new EventTarget(), {
        connect() {}, disconnect() {}, buffer: scheduled ? new Float32Array(128) : null,
        ...(scheduled ? { start() {}, stop() {} } : {})
    });
    const bridge = { state: {}, nodes: new Set(), databases: new Set(), context: {
        createBufferSource: () => node(true), createGain: () => node(false)
    } };
    const window = { name: 'lifetime', indexedDB: {} };
    vm.runInNewContext(deckSource, { window, parent: { __mygrainSongRenderBridges: new Map([['lifetime', bridge]]) } });
    const context = new window.AudioContext();
    const bus = context.createGain();
    for (let index = 0; index < 2000; index++) {
        const source = context.createBufferSource(), envelope = context.createGain();
        source.connect(envelope); envelope.connect(bus);
        let handlerSawOriginalBuffer = false;
        source.addEventListener('ended', () => { handlerSawOriginalBuffer = Boolean(source.buffer); source.disconnect(); envelope.disconnect(); });
        source.dispatchEvent(new Event('ended'));
        await Promise.resolve();
        assert.equal(handlerSawOriginalBuffer, true);
        assert.equal(source.buffer, null);
        assert.equal(bridge.nodes.size, 1);
    }
    bus.disconnect();
    assert.equal(bridge.nodes.size, 0);
    bus.connect({});
    assert.equal(bridge.nodes.size, 1, 'reconnected nodes must be tracked for final cleanup');
});

function renderFixture(username, lateSuccess = false) {
    const opened = [];
    const deleted = [];
    const requests = [];
    const stored = new Set();
    let closed = 0;
    const listeners = new Set();
    const nodes = [];
    const controller = new AbortController();
    const database = {
        open(name) {
            opened.push(name);
            stored.add(name);
            const request = new EventTarget();
            request.result = { name, close() { closed += 1; } };
            requests.push(request);
            if (!lateSuccess) queueMicrotask(() => request.dispatchEvent(new Event('success')));
            return request;
        },
        deleteDatabase(name) { deleted.push(name); stored.delete(name); return new EventTarget(); }
    };
    const audioContext = {
        audioWorklet: { addModule: async () => {} }, destination: {},
        addEventListener(type, listener) { listeners.add(listener); },
        removeEventListener(type, listener) { listeners.delete(listener); },
        createBufferSource() {
            const node = { buffer: { retainedPCM: true }, onended() {}, stop() {}, disconnect() { this.disconnected = true; } };
            nodes.push(node);
            return node;
        },
        createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
    };
    const root = {
        URL, DOMException, setTimeout, clearTimeout,
        crypto: { randomUUID: () => 'account-fixture' },
        mygrainAccountContext: { user: { username } },
        mygrainAccounts: { createRenderDatabaseFactory: bridge => renderDatabases(database, username, bridge) },
        indexedDB: { deleteDatabase() { throw new Error('Account-scoped cleanup must not prefix a physical name twice.'); } },
        AudioWorkletNode: function () {},
        fetch: async () => ({ ok: true, text: async () => '<head></head>' }),
        document: {
            hidden: false, baseURI: 'https://fixture.invalid/mygrain/',
            createElement() {
                return { style: {}, setAttribute() {}, remove() {} };
            },
            body: {
                append(frame) {
                    const window = { name: frame.name, indexedDB: database };
                    vm.runInNewContext(deckSource, { window, parent: root });
                    window.document = { getElementById: () => ({ click() {} }) };
                    window.mygrainSongBetaAdapter = {
                        async ready() {
                            const context = new window.AudioContext();
                            context.addEventListener('statechange', () => window.document);
                            context.createBufferSource();
                            window.indexedDB.open('GranularSynthAudioDB', 1);
                            await Promise.resolve();
                            controller.abort();
                        },
                        stop() {}
                    };
                    frame.contentWindow = window;
                }
            }
        }
    };
    vm.runInNewContext(clockSource, root);
    return { root, audioContext, controller, opened, deleted, requests, stored, listeners, nodes, closed: () => closed };
}

for (const username of ['admin', 'dan', 'other-user']) {
    for (const lateSuccess of [false, true]) {
        test(`${username}: render cancellation cleans its exact temporary database${lateSuccess ? ' after a late open' : ''}`, async () => {
            const fixture = renderFixture(username, lateSuccess);
            const prefix = username === 'admin' ? '' : `mygrain-account:${encodeURIComponent(username)}:`;
            const expected = `${prefix}GranularSynthAudioDB-song-render-song-account-fixture`;
            await assert.rejects(fixture.root.MygrainSongClock.render(fixture.audioContext,
                { snapshot: { state: {} } }, { bpm: 120, patternSteps: 16 }, fixture.controller.signal), { name: 'AbortError' });
            if (lateSuccess) fixture.requests.forEach(request => request.dispatchEvent(new Event('success')));
            assert.deepEqual(fixture.opened, [expected]);
            assert.ok(fixture.deleted.length > 0);
            assert.ok(fixture.deleted.every(name => name === expected));
            assert.equal(fixture.stored.size, 0);
            assert.ok(fixture.closed() >= 1);
            assert.equal(fixture.root.__mygrainSongRenderBridges.size, 0);
            assert.equal(fixture.listeners.size, 0, 'removed renderer must not remain attached to the shared AudioContext');
            assert.ok(fixture.nodes.every(node => node.disconnected && node.buffer === null && node.onended === null), 'temporary nodes must release their PCM and callbacks');
        });
    }
}

test('renderer teardown preserves listeners belonging to the main audio engine', async () => {
    const fixture = renderFixture('admin');
    const parentListener = () => {};
    fixture.audioContext.addEventListener('statechange', parentListener);
    await assert.rejects(fixture.root.MygrainSongClock.render(fixture.audioContext,
        { snapshot: { state: {} } }, { bpm: 120, patternSteps: 16 }, fixture.controller.signal), { name: 'AbortError' });
    assert.equal(fixture.listeners.size, 1);
    assert.ok(fixture.listeners.has(parentListener));
});

test('a locked renderer can clean only its registered temporary databases, not reopen or delete user audio', () => {
    let active = true;
    const removed = [];
    const database = { open: () => new EventTarget(), deleteDatabase: name => removed.push(name) };
    const bridge = { databases: new Set(), connections: new Set() };
    const factory = renderDatabases(database, 'dan', bridge, () => active);
    assert.throws(() => factory.open('GranularSynthAudioDB', 1), { name: 'SecurityError' });
    factory.open('GranularSynthAudioDB-song-render-fixture', 1);
    active = false;
    assert.throws(() => factory.open('GranularSynthAudioDB', 1), { name: 'SecurityError' });
    assert.throws(() => factory.deleteDatabase('GranularSynthAudioDB'), { name: 'SecurityError' });
    factory.deleteDatabase('GranularSynthAudioDB-song-render-fixture');
    assert.deepEqual(removed, ['mygrain-account:dan:GranularSynthAudioDB-song-render-fixture']);
});
