const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const vm = require('node:vm');
const { namespace, scopedStorage, scopedDatabases, protectedUrl, wavCredits, wavNotesLabel, commentText, createMediaPreview } = require('../mygrain-accounts.js');

function frontendFunction(name) {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const start = html.search(new RegExp(`        (?:async )?function ${name}\\(`));
    assert.notEqual(start, -1, name);
    const next = html.slice(start + 1).search(/\n        (?:async )?function /);
    assert.notEqual(next, -1, name);
    return html.slice(start, start + 1 + next);
}

class Storage {
    constructor(entries = []) { this.values = new Map(entries); }
    get length() { return this.values.size; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    getItem(key) { return this.values.get(String(key)) ?? null; }
    setItem(key, value) { this.values.set(String(key), String(value)); }
    removeItem(key) { this.values.delete(String(key)); }
}

test('admin retains legacy keys and every other account has an isolated enumerable storage view', () => {
    const original = new Storage([['granularSynthState', 'legacy patch'], ['dropboxEnabled', 'true'], ['__mygrain_account_event__', 'metadata']]);
    const admin = scopedStorage(original, 'admin');
    const dan = scopedStorage(original, 'dan');
    assert.equal(namespace('admin'), '');
    assert.equal(admin.getItem('granularSynthState'), 'legacy patch');
    assert.equal(dan.getItem('granularSynthState'), null);
    dan.granularSynthState = 'dan patch';
    dan.setItem('dropboxEnabled', false);
    Object.defineProperty(dan, 'favourites', { value: 'dan favourites' });
    assert.equal(dan.granularSynthState, 'dan patch');
    assert.equal(admin.granularSynthState, 'legacy patch');
    assert.deepEqual(Object.keys(admin), ['granularSynthState', 'dropboxEnabled']);
    assert.deepEqual(Object.keys(dan), ['granularSynthState', 'dropboxEnabled', 'favourites']);
    assert.equal(dan.key(0), 'granularSynthState');
    assert.equal(dan.key(3), null);
    assert.equal(dan.length, 3);
    assert.equal(admin.getItem('mygrain-account:dan:granularSynthState'), null);
    assert.equal(admin.getItem('__mygrain_account_event__'), null);
    delete dan.dropboxEnabled;
    assert.equal(admin.dropboxEnabled, 'true');
    admin.clear();
    assert.equal(dan.granularSynthState, 'dan patch');
    assert.equal(original.getItem('__mygrain_account_event__'), 'metadata');
    dan.clear();
    assert.equal(original.length, 1);
});

test('all persisted browser keys use the same account boundary and stale writes are blocked', () => {
    const keys = ['granularSynthState', 'dropboxEnabled', 'mygrain-favourite-views', 'mygrain-vocal-workspace-selection-v1', 'mygrain-song-library-key', 'selected', 'armconcurrency', 'device', 'label', 'mygrain-runtime-debug-v1:session', 'mygrain-runtime-tab-v1'];
    const raw = new Storage(keys.map(key => [key, 'admin']));
    let writable = true;
    const dan = scopedStorage(raw, 'dan', () => writable);
    keys.forEach(key => { assert.equal(dan.getItem(key), null); dan.setItem(key, 'dan'); });
    keys.forEach(key => assert.equal(raw.getItem(key), 'admin'));
    writable = false;
    assert.throws(() => dan.setItem('label', 'stale'), { name: 'SecurityError' });
    assert.throws(() => dan.clear(), { name: 'SecurityError' });
    assert.throws(() => delete dan.label, { name: 'SecurityError' });
});

test('all IndexedDB names including debug and Song caches stay isolated; admin names do not migrate', async () => {
    const opened = [];
    const removed = [];
    const database = {
        open(name, version) { opened.push([name, version]); return new EventTarget(); },
        deleteDatabase(name) { removed.push(name); },
        databases: async () => [{ name: 'GranularSynthAudioDB', version: 1 }, { name: 'mygrain-account:dan:GranularSynthAudioDB', version: 1 }]
    };
    let writable = true;
    const admin = scopedDatabases(database, 'admin');
    const dan = scopedDatabases(database, 'dan', () => writable);
    for (const name of ['GranularSynthAudioDB', 'mygrain-song-renders-v1', 'mygrain-audio-debug-v1']) {
        admin.open(name, 1);
        dan.open(name, 1);
    }
    assert.equal(opened[0][0], 'GranularSynthAudioDB');
    assert.equal(opened[1][0], 'mygrain-account:dan:GranularSynthAudioDB');
    dan.deleteDatabase('mygrain-song-renders-v1');
    assert.deepEqual(removed, ['mygrain-account:dan:mygrain-song-renders-v1']);
    assert.deepEqual(await dan.databases(), [{ name: 'GranularSynthAudioDB', version: 1 }]);
    assert.deepEqual(await admin.databases(), [{ name: 'GranularSynthAudioDB', version: 1 }]);
    writable = false;
    assert.throws(() => dan.open('GranularSynthAudioDB'), { name: 'SecurityError' });
    assert.throws(() => admin.open('mygrain-account:dan:GranularSynthAudioDB'), { name: 'SecurityError' });
});

test('account headers apply only to same-origin app API/repositories, not offline/data/sample fetches', () => {
    const base = 'https://example.test/mygrain/';
    for (const url of ['/mygrain/api/songs', '/mygrain/api/auth/users', '/mygrain/patches/demo.zip', '/mygrain-wavs/api/share', '/mygrain-stems/api/files', '/mygrain-midi/file.mid', '/mygrain-bastardloops/loop.wav', '/mygrain/']) assert.equal(protectedUrl(url, base), true, url);
    for (const url of ['data:audio/wav;base64,AA==', 'blob:https://example.test/id', 'q-scales.json', '/mygrain/SAMPLES_Q/test.wav', 'https://another.test/mygrain-wavs/api/share', '/mygrain-other/api/files']) assert.equal(protectedUrl(url, base), false, url);
    assert.equal(protectedUrl({ url: `${base}api/songs` }, base), true);
});

test('recipient comments support text and structured notes without interpreting markup', () => {
    assert.equal(commentText([{ username: 'dan', comment: '<img src=x>', reaction: 'love' }, 'Second note']), 'dan: <img src=x> (love)\nSecond note');
    assert.equal(commentText({ comment: 'Current saved note', reaction: 'like' }), 'Current saved note (like)');
    assert.equal(commentText([]), '');
});

test('WAV credits distinguish creator, immediate sharer and actual note author without guessing legacy ownership', () => {
    const file = { createdBy: 'admin', sharedBy: 'dan', commentBy: 'original-author', feedback: { comment: 'Inherited note' } };
    assert.equal(wavCredits(file), 'Created by admin · Shared by dan');
    assert.equal(wavNotesLabel(file), 'Repo Notes · Comment by original-author · Your Repo Notes on this copy are visible to dan.');
    assert.equal(wavNotesLabel({ ...file, feedback: { comment: 'New note', commentBy: 'third-user' } }), 'Repo Notes · Comment by third-user · Your Repo Notes on this copy are visible to dan.');
    assert.equal(wavCredits({ sharedBy: 'admin' }), 'Created by unknown · Shared by admin');
    assert.equal(wavCredits({}), 'Created by unknown');
    assert.equal(wavNotesLabel({ recipient: 'dan', feedback: { comment: 'Legacy note' } }), 'Repo Notes · Comment by unknown');
    assert.equal(wavNotesLabel({ feedback: { comment: '', commentBy: 'admin' } }), 'Repo Notes');
});

test('shared note credits prefer explicit authors over fallback authors and preserve legacy string compatibility', () => {
    assert.equal(commentText('Inherited note', 'dan', 'Comment by '), 'Comment by dan: Inherited note');
    assert.equal(commentText([
        { author: { username: 'original-author' }, text: '<img src=x>' },
        { username: 'second-author', comment: 'Second note' },
        { commentBy: 'third-author', message: 'Third note' },
        'Legacy string'
    ], 'dan', 'Comment by '), 'Comment by original-author: <img src=x>\nComment by second-author: Second note\nComment by third-author: Third note\nComment by dan: Legacy string');
    assert.equal(commentText('Legacy string'), 'Legacy string');
    assert.equal(commentText('', 'dan', 'Comment by '), '');
});

test('shared WAV dialog renders creator, immediate sharer and inherited comment authors as plain text', () => {
    class Element {
        constructor() { this.children = []; this.dataset = {}; this.textContent = ''; }
        append(...children) { this.children.push(...children); }
        replaceChildren() { this.children = []; }
    }
    const thread = new Element();
    const source = fs.readFileSync(path.join(__dirname, '../mygrain-accounts.js'), 'utf8');
    const start = source.indexOf('    function renderComments(');
    const end = source.indexOf('\n    function ensureShareDialog(', start);
    const scope = { document: { createElement: () => new Element() }, byId: () => thread, wavCredits, commentText, creditName: value => typeof value === 'string' ? value : '' };
    vm.createContext(scope);
    vm.runInContext(source.slice(start, end), scope);
    scope.renderComments([
        { id: 'reshared', filename: 'copy.wav', recipient: 'new-recipient', createdBy: 'admin', sharedBy: 'dan', commentsBy: 'original-author', comments: 'Inherited note' },
        { id: 'legacy', filename: 'old.wav', recipient: 'not-the-author', comments: '<img src=x>' },
        { id: 'structured', filename: 'structured.wav', recipient: 'other-user', commentsBy: 'fallback-author', comments: [{ author: 'actual-author', text: 'Structured note' }] }
    ]);
    assert.equal(thread.children[0].children[2].textContent, 'Created by admin · Shared by dan');
    assert.equal(thread.children[0].children[3].textContent, 'Comment by original-author: Inherited note');
    assert.equal(thread.children[1].children[3].textContent, 'Comment by unknown: <img src=x>');
    assert.equal(thread.children[2].children[3].textContent, 'Comment by actual-author: Structured note');
    assert.equal(thread.children[1].children[3].children.length, 0);
});

test('WAV note normalization preserves nested and top-level authors but never infers authors from creators', () => {
    const scope = {};
    vm.createContext(scope);
    vm.runInContext(frontendFunction('normalizeWavRepositoryBrowserFeedback'), scope);
    assert.equal(scope.normalizeWavRepositoryBrowserFeedback({ comment: 'Note', commentBy: 'dan' }, { commentBy: 'admin' }).commentBy, 'dan');
    assert.equal(scope.normalizeWavRepositoryBrowserFeedback({ comment: 'Note' }, { commentBy: 'dan' }).commentBy, 'dan');
    assert.equal(scope.normalizeWavRepositoryBrowserFeedback({ comment: 'Note' }, { createdBy: 'admin', sharedBy: 'dan' }).commentBy, '');
});

test('saving a WAV note immediately updates its credit from authenticated response fields only', async () => {
    for (const responseAuthor of [{ feedbackAuthor: 'new-author' }, { topAuthor: 'new-author' }, {}]) {
        const file = { name: 'fixture.wav', commentBy: 'old-author', feedback: { comment: 'Inherited note', commentBy: 'old-author' }, feedbackDraft: { comment: 'Changed note', reaction: '' } };
        const controls = { label: {}, status: {}, textarea: { value: 'Changed note', blur() {} }, saveButton: {} };
        const scope = {
            window: { mygrainAccounts: { wavNotesLabel } },
            WAV_REPOSITORY_FEEDBACK_API_URL: '/mygrain-wavs/api/file-feedback',
            autosizeSampleBrowserFeedbackTextarea() {}, setWavRepositoryBrowserStatus() {},
            fetch: async () => ({ ok: true, json: async () => ({ ok: true, ...(responseAuthor.topAuthor ? { commentBy: responseAuthor.topAuthor } : {}), feedback: { comment: 'Changed note', reaction: '', ...(responseAuthor.feedbackAuthor ? { commentBy: responseAuthor.feedbackAuthor } : {}) } }) })
        };
        vm.createContext(scope);
        for (const name of ['normalizeWavRepositoryBrowserFeedback', 'ensureWavRepositoryBrowserFeedbackDraft', 'isWavRepositoryBrowserFeedbackDirty', 'getWavRepositoryBrowserFeedbackStatusText', 'syncWavRepositoryBrowserFeedbackUi', 'saveWavRepositoryBrowserFeedback']) vm.runInContext(frontendFunction(name), scope);
        scope.syncWavRepositoryBrowserFeedbackUi(file, controls);
        assert.match(controls.label.textContent, /Comment by old-author/);
        await scope.saveWavRepositoryBrowserFeedback(file, controls);
        assert.match(controls.label.textContent, responseAuthor.feedbackAuthor || responseAuthor.topAuthor ? /Comment by new-author/ : /Comment by unknown/);
        assert.equal(file.feedbackDraft.comment, 'Changed note');
    }
});

class PreviewAudio extends EventTarget {
    constructor() { super(); this.src = ''; this.paused = true; this.loads = 0; }
    pause() { this.paused = true; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() { this.loads += 1; }
    async play() { this.paused = false; }
}

function mediaHost(fetch = async () => ({ ok: true, blob: async () => new Blob(['wav']) })) {
    const created = [];
    const revoked = [];
    return { created, revoked, host: { fetch, URL: {
        createObjectURL(blob) { created.push(blob); return `blob:fixture-${created.length}`; },
        revokeObjectURL(url) { revoked.push(url); }
    } } };
}

test('protected media is fetched on demand and only blob URLs reach native audio; ended/dispose revoke them', async () => {
    const requests = [];
    const fixture = mediaHost(async (url, options) => { requests.push({ url, options }); return { ok: true, blob: async () => new Blob(['wav']) }; });
    const audio = new PreviewAudio();
    const preview = createMediaPreview(audio, '/mygrain-bastardloops/api/source-sample?path=fixture.wav', fixture.host);
    assert.equal(requests.length, 0);
    assert.equal(audio.src, '');
    assert.equal(await preview.play(), true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.cache, 'no-store');
    assert.ok(requests[0].options.signal instanceof AbortSignal);
    assert.equal(audio.src, 'blob:fixture-1');
    audio.dispatchEvent(new Event('ended'));
    assert.equal(audio.src, '');
    assert.deepEqual(fixture.revoked, ['blob:fixture-1']);
    await preview.play();
    preview.dispose();
    assert.deepEqual(fixture.revoked, ['blob:fixture-1', 'blob:fixture-2']);
    assert.equal(await preview.play(), false);
});

test('closing an authenticated media preview aborts download and discards even a late response', async () => {
    let release;
    let signal;
    const fixture = mediaHost((url, options) => { signal = options.signal; return new Promise(resolve => release = resolve); });
    const audio = new PreviewAudio();
    const preview = createMediaPreview(audio, '/mygrain/api/vocal-takes/takes/id/audio', fixture.host);
    const pending = preview.play();
    preview.dispose();
    assert.equal(signal.aborted, true);
    release({ ok: true, blob: async () => new Blob(['late audio']) });
    assert.equal(await pending, false);
    assert.deepEqual(fixture.created, []);
    assert.equal(audio.src, '');
});

test('failed media playback releases its blob; download failures never reach native protected src', async () => {
    const fixture = mediaHost();
    const audio = new PreviewAudio();
    audio.play = async () => { throw new Error('Playback blocked'); };
    const preview = createMediaPreview(audio, '/mygrain/api/vocal-takes/takes/id/audio', fixture.host);
    await assert.rejects(preview.play(), /Playback blocked/);
    assert.deepEqual(fixture.revoked, ['blob:fixture-1']);
    assert.equal(audio.src, '');
    const denied = mediaHost(async () => ({ ok: false, status: 401 }));
    await assert.rejects(createMediaPreview(audio, '/mygrain/api/private', denied.host).play(), /401/);
    assert.deepEqual(denied.created, []);
});

test('a browser requiring a fresh playback gesture keeps the authenticated blob for native Play/retry', async () => {
    const fixture = mediaHost();
    const audio = new PreviewAudio();
    audio.play = async () => { throw new DOMException('Tap Play again', 'NotAllowedError'); };
    const preview = createMediaPreview(audio, '/mygrain/api/vocal-takes/takes/id/audio', fixture.host);
    assert.equal(await preview.play(), true);
    assert.equal(audio.src, 'blob:fixture-1');
    assert.equal(audio.paused, true);
    audio.play = async () => { audio.paused = false; };
    assert.equal(await preview.play(), true);
    assert.equal(audio.paused, false);
    assert.equal(fixture.created.length, 1);
    preview.dispose();
    assert.deepEqual(fixture.revoked, ['blob:fixture-1']);
});

test('saved vocal audition uses the authenticated blob helper and close cancels without late status', async () => {
    const { Library } = require('../vocal-takes.js');
    const originalAudio = global.Audio;
    const originalAccounts = global.mygrainAccounts;
    const statuses = [];
    const fixture = mediaHost();
    global.Audio = PreviewAudio;
    global.mygrainAccounts = { createMediaPreview: (audio, source) => createMediaPreview(audio, source, fixture.host) };
    try {
        const library = Object.create(Library.prototype);
        Object.assign(library, { preview: null, base: '/mygrain/api/vocal-takes', setStatus: message => statuses.push(message) });
        await library.audition({ id: 'fixture', name: 'Saved fixture' });
        assert.equal(library.preview.src, 'blob:fixture-1');
        library.stopPreview();
        assert.equal(library.preview, null);
        assert.deepEqual(fixture.revoked, ['blob:fixture-1']);
        let release;
        fixture.host.fetch = () => new Promise(resolve => release = resolve);
        const pending = library.audition({ id: 'late', name: 'Cancelled fixture' });
        library.stopPreview();
        release({ ok: true, blob: async () => new Blob(['late']) });
        await pending;
        assert.equal(statuses.length, 1);
        assert.equal(library.preview, null);
    } finally {
        global.Audio = originalAudio;
        global.mygrainAccounts = originalAccounts;
    }
});

test('early bootstrap precedes all persistence modules and keeps existing runtime cache queries intact', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    assert.ok(html.indexOf('/mygrain/account-context.js') < html.indexOf('mygrain-accounts.js'));
    assert.ok(html.indexOf('mygrain-accounts.js') < html.indexOf('runtime-diagnostics.js'));
    assert.ok(html.indexOf('mygrain-accounts.js') < html.indexOf('audio-debug-storage.js'));
    assert.ok(html.indexOf('mygrain-accounts.js') < html.indexOf('sample-favourites.js'));
    assert.match(html, /id="start-btn" disabled/);
    assert.match(html, /q-card\.js\?v=20261016-k-keyboard-19/);
    assert.match(html, /vocal-takes\.js\?v=20261016-accounts-media-k20/);
    assert.match(html, /song-beta-clock\.js\?v=\d{8}-[a-z0-9-]+/);
    assert.match(html, /<strong>v\d{4}\.\d{2}\.\d{2}\.[A-Z]+\.\d+<\/strong>/);
    assert.match(html, /mygrain-accounts\.js\?v=\d{8}-[a-z0-9-]+/);
    assert.match(html, /mygrain-accounts\.css\?v=\d{8}-[a-z0-9-]+/);
    for (const route of ['wavs', 'stems', 'midi', 'bastardloops']) assert.ok(html.includes(`new URL('/mygrain-${route}', document.baseURI).href`));
});

test('account toolbar is mounted in normal header flow immediately before Debug controls', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const script = fs.readFileSync(path.join(__dirname, '../mygrain-accounts.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../mygrain-accounts.css'), 'utf8');
    assert.match(html, /<div id="mygrainAccountControls"><\/div>\s*<div class="debug-console-card" id="debugConsoleCard">/);
    assert.match(script, /if \(accountControls\) accountControls\.append\(toolbar\)/);
    const toolbarStyle = css.match(/\.mygrain-account-toolbar \{([^}]+)\}/)[1];
    assert.match(toolbarStyle, /position: static/);
    assert.doesNotMatch(toolbarStyle, /position:\s*(fixed|sticky|absolute)|z-index|\btop:|\bright:/);
    assert.match(toolbarStyle, /flex-wrap: wrap/);
});

test('late creator, sharer and note-author attribution refreshes WAV cards without discarding drafts', async () => {
    for (const update of [{ createdBy: 'admin' }, { sharedBy: 'admin' }, { commentBy: 'dan' }, { feedback: { comment: 'Note', commentBy: 'dan' } }]) {
        const previous = { name: 'fixture.wav', url: '/mygrain-wavs/fixture.wav', size: 12, modified: 1, feedback: { comment: 'Note' }, feedbackDraft: { comment: 'unsaved', reaction: '' } };
        const incoming = { ...previous, ...update };
        let renders = 0;
        const scope = {
            AbortController, Map, JSON,
            document: { getElementById: () => ({ hidden: false }) },
            wavRepositoryBrowserFiles: [previous], wavRepositoryBrowserRefreshController: null,
            WAV_REPOSITORY_LIST_API_URL: '/mygrain-wavs/api/list',
            isWavRepositoryBrowserFeedbackDirty: () => true,
            fetchWavRepositoryBrowserData: async () => ({ ok: true, files: [incoming] }),
            setWavRepositoryBrowserStatus() {}, renderWavRepositoryBrowserFiles() { renders += 1; }
        };
        vm.createContext(scope);
        vm.runInContext(frontendFunction('normalizeWavRepositoryBrowserFeedback'), scope);
        previous.feedback = scope.normalizeWavRepositoryBrowserFeedback(previous.feedback, previous);
        vm.runInContext(frontendFunction('refreshWavRepositoryBrowser'), scope);
        await scope.refreshWavRepositoryBrowser();
        assert.equal(renders, 1, JSON.stringify(update));
        assert.notEqual(scope.wavRepositoryBrowserFiles[0], previous);
        assert.equal(scope.wavRepositoryBrowserFiles[0].feedbackDraft, previous.feedbackDraft);
        assert.equal(scope.wavRepositoryBrowserFiles[0].feedback.commentBy, update.commentBy || update.feedback?.commentBy || '');
    }
});

test('explicit unchanged WAV Refresh resets only errored previews, preserving healthy audio controls and drafts', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const start = html.indexOf('        async function refreshWavRepositoryBrowser(');
    const end = html.indexOf('\n        function openWavRepositoryBrowser(', start);
    const file = { name: 'fixture.wav', url: '/mygrain-wavs/fixture.wav', size: 12, modified: 1, feedback: {}, feedbackDraft: { comment: 'unsaved' } };
    const healthy = { error: null, currentTime: 12 };
    const errored = { error: { message: 'network' } };
    const resets = [];
    const scope = {
        AbortController, Map, JSON,
        document: { getElementById: () => ({ hidden: false }), querySelectorAll: () => [healthy, errored] },
        wavRepositoryBrowserFiles: [file], wavRepositoryBrowserRefreshController: null,
        wavRepositoryPreviewRecovery: new Map([[healthy, { reset: () => resets.push(healthy) }], [errored, { reset: () => resets.push(errored) }]]),
        WAV_REPOSITORY_LIST_API_URL: '/mygrain-wavs/api/list',
        normalizeWavRepositoryBrowserFeedback: feedback => feedback,
        isWavRepositoryBrowserFeedbackDirty: () => true,
        fetchWavRepositoryBrowserData: async () => ({ ok: true, files: [{ ...file }] }),
        setWavRepositoryBrowserStatus() {},
        renderWavRepositoryBrowserFiles() { assert.fail('unchanged refresh must not rebuild cards'); }
    };
    vm.createContext(scope);
    vm.runInContext(html.slice(start, end), scope);
    await scope.refreshWavRepositoryBrowser();
    assert.deepEqual(resets, []);
    await scope.refreshWavRepositoryBrowser({ forceRefresh: true });
    assert.deepEqual(resets, [errored]);
    assert.equal(scope.wavRepositoryBrowserFiles[0], file);
    assert.equal(file.feedbackDraft.comment, 'unsaved');
    assert.equal(healthy.currentTime, 12);
});

async function fixtureServer() {
    const root = path.join(__dirname, '..');
    const password = 'test-only-password-123';
    const users = new Map([['admin', password], ['dan', password]]);
    const sessions = new Map();
    const shares = [];
    const requests = [];
    const wav = Buffer.alloc(16044);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
    let serial = 0;
    const fixture = `<!doctype html><html><head><link rel="stylesheet" href="/mygrain/mygrain-accounts.css"><script src="/mygrain/account-context.js"></script><script src="/mygrain/mygrain-accounts.js"></script></head><body><div id="start-overlay"><button id="start-btn" disabled>START MYGRAIN</button></div><button id="share-fixture">Share WAV</button><script>window.fixtureRestored=localStorage.getItem('granularSynthState');document.getElementById('share-fixture').onclick=()=>mygrainAccounts.openShare({name:'fixture.wav'});</script></template></body></html>`;
    const server = http.createServer(async (request, response) => {
        const url = new URL(request.url, 'http://fixture');
        requests.push({ path: url.pathname, user: request.headers['x-mygrain-user'], method: request.method });
        const cookie = /(?:^|;\s*)mygrain=([^;]+)/.exec(request.headers.cookie || '')?.[1];
        const username = sessions.get(cookie) || null;
        const json = (status, payload, headers = {}) => { response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(JSON.stringify(payload)); };
        const body = async () => { let data = ''; for await (const chunk of request) data += chunk; return JSON.parse(data || '{}'); };
        try {
            if (url.pathname === '/mygrain/account-context.js') {
                response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
                response.end(`window.mygrainAccountContext=${JSON.stringify({ user: username ? { username } : null })};`);
            } else if (url.pathname === '/fixture') {
                response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(fixture);
            } else if (url.pathname === '/mygrain/') {
                response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(fs.readFileSync(path.join(root, 'index.html')));
            } else if (url.pathname === '/mygrain/api/auth/session') {
                json(200, { ok: true, authenticated: Boolean(username), user: username ? { username } : null });
            } else if (/\/auth\/(login|register)$/.test(url.pathname)) {
                const data = await body();
                const register = url.pathname.endsWith('/register');
                if (register && users.has(data.username)) { json(409, { ok: false, error: 'Username already exists.' }); return; }
                if (register) users.set(data.username, data.password);
                if (!data.username || users.get(data.username) !== data.password) { json(401, { ok: false, error: 'Incorrect username or password.' }); return; }
                const token = String(++serial);
                sessions.set(token, data.username);
                json(200, { ok: true, user: { username: data.username } }, { 'Set-Cookie': `mygrain=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` });
            } else if (url.pathname.endsWith('/auth/logout')) {
                sessions.delete(cookie);
                json(200, { ok: true }, { 'Set-Cookie': 'mygrain=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
            } else if (url.pathname === '/mygrain-wavs/fixture.wav') {
                if (!username) { json(401, { ok: false }); return; }
                response.writeHead(200, { 'Content-Type': 'audio/wav' }); response.end(wav);
            } else if (url.pathname.startsWith('/mygrain/api/') || url.pathname.startsWith('/mygrain-wavs/api/') || url.pathname.startsWith('/mygrain-bastardloops/api/')) {
                if (!username) { json(401, { ok: false, error: 'Log in.' }); return; }
                if (request.headers['x-mygrain-user'] !== username) { json(403, { ok: false, error: 'Account changed.' }); return; }
                if (url.pathname.endsWith('/source-sample') || url.pathname.endsWith('/takes/fixture/audio')) {
                    response.writeHead(200, { 'Content-Type': 'audio/wav' }); response.end(wav);
                } else if (url.pathname.endsWith('/auth/users')) json(200, { ok: true, users: [...users.keys()].map(username => ({ username })) });
                else if (url.pathname.endsWith('/shares')) json(200, { ok: true, shares: shares.filter(share => share.sender === username) });
                else if (url.pathname.endsWith('/share')) {
                    const data = await body();
                    const share = { id: String(++serial), filename: data.filename, sender: username, recipient: data.username, recipientFilename: `copy-${serial}.wav`, comments: [] };
                    shares.push(share); json(200, { ok: true, share });
                } else if (url.pathname.endsWith('/feedback')) {
                    const data = await body();
                    shares.filter(share => share.recipient === username && share.recipientFilename === data.filename).forEach(share => share.comments = [{ username, comment: data.comment }]);
                    json(200, { ok: true });
                } else if (url.pathname.endsWith('/slow')) setTimeout(() => { if (!response.destroyed) json(200, { ok: true }); }, 1000).unref();
                else if (url.pathname.endsWith('/late-body')) {
                    response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{"ok":');
                    setTimeout(() => { if (!response.destroyed) response.end('true}'); }, 1000).unref();
                }
                else json(200, { ok: true });
            } else if (/^\/mygrain\/mygrain-accounts\.(js|css)$/.test(url.pathname)) {
                response.writeHead(200, { 'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript' });
                response.end(fs.readFileSync(path.join(root, path.basename(url.pathname))));
            } else { response.writeHead(404); response.end(); }
        } catch (error) { json(500, { ok: false, error: error.message }); }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return { server, password, requests, shares, sessions, base: `http://127.0.0.1:${server.address().port}` };
}

test('browser account shell, persistent sessions, isolated storage, multitab cancellation and sharing', { timeout: 60000 }, async context => {
    const { chromium } = require('playwright-core');
    const fixture = await fixtureServer();
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
    context.after(async () => { await browser.close(); fixture.server.closeAllConnections(); await new Promise(resolve => fixture.server.close(resolve)); });
    const profile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await profile.route('**/*', route => new URL(route.request().url()).origin === fixture.base ? route.continue() : route.abort());
    const page = await profile.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const login = async (page, username, create = false) => {
        if (!await page.locator('#mygrainLoginForm').isVisible()) {
            await page.locator(`[data-mygrain-account-action="${create ? 'create' : 'login'}"]`).click();
        }
        await page.locator('#mygrainLoginUsername').fill(username);
        await page.locator('#mygrainLoginPassword').fill(fixture.password);
        await page.locator(create ? '#mygrainCreateUserBtn' : '#mygrainLoginBtn').click();
        await page.waitForFunction(user => document.getElementById('mygrainCurrentUser')?.textContent === user, username);
        if (new URL(page.url()).pathname === '/fixture') {
            // The minimal storage fixture has no audio engine to dismiss its launcher.
            await page.locator('#start-overlay').evaluate(el => el.style.display = 'none');
        }
    };
    const logout = async page => {
        if (new URL(page.url()).pathname === '/fixture') {
            await page.locator('#start-overlay').evaluate(el => el.style.display = 'none');
        }
        await page.locator('#mygrainLogoutBtn').click();
        await page.locator('.mygrain-start-account[data-account-state="guest"]').waitFor();
        await page.locator('[data-mygrain-account-action="login"]').click();
        await page.waitForFunction(() => document.getElementById('mygrainLoginUsername') && !document.getElementById('mygrainLoginUsername').disabled);
    };
    const databaseValue = (page, value) => page.evaluate(async value => {
        const request = indexedDB.open('GranularSynthAudioDB', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('audioBuffers');
        const database = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        const transaction = database.transaction('audioBuffers', value ? 'readwrite' : 'readonly');
        const result = value ? transaction.objectStore('audioBuffers').put(value, 'mic') : transaction.objectStore('audioBuffers').get('mic');
        const answer = await new Promise((resolve, reject) => { result.onsuccess = () => resolve(result.result); result.onerror = () => reject(result.error); });
        await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
        window.testDatabase = database;
        return answer;
    }, value);

    await context.test('real anonymous index stays inert, makes no eager library/API calls and fits mobile', async () => {
        await page.goto(`${fixture.base}/mygrain/`);
        await page.locator('#start-btn').waitFor();
        assert.equal(await page.locator('#mygrainLoginForm').count(), 0);
        assert.equal(await page.locator('.synth-container').count(), 0);
        assert.equal(await page.locator('#start-overlay > *').count(), 4);
        assert.equal(await page.locator('#start-overlay p, #start-overlay #submitSavedDebugLogBtn').count(), 0);
        assert.equal(fixture.requests.some(request => /runtime-diagnostics|favourites|q-card|song-beta|\/api\//.test(request.path)), false);
        await page.locator('[data-mygrain-account-action="login"]').click();
        await page.locator('#mygrainLoginUsername').waitFor();
        assert.equal(await page.locator('#start-btn').count(), 1);
        assert.equal(await page.locator('#mygrainLoginUsername').getAttribute('autocomplete'), 'username');
        assert.equal(await page.locator('#mygrainLoginPassword').getAttribute('autocomplete'), 'current-password');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            const bounds = await page.locator('.mygrain-account-panel').boundingBox();
            assert.ok(bounds.x >= 16, `login panel keeps left padding at ${viewport.width}px`);
            assert.ok(bounds.x + bounds.width <= viewport.width - 16, `login panel keeps right padding at ${viewport.width}px`);
            assert.equal(await page.evaluate(() => {
                const shell = document.getElementById('mygrain-account-shell');
                return document.documentElement.scrollWidth <= innerWidth && shell.scrollWidth <= shell.clientWidth;
            }), true, `no horizontal document/shell overflow at ${viewport.width}px`);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#mygrainLoginBackBtn').click();
        assert.equal(await page.locator('#mygrainLoginForm').count(), 0);
        await page.locator('#start-btn').click();
        await page.locator('#mygrainLoginUsername').waitFor();
        assert.equal(await page.evaluate(() => mygrainAccounts.authenticated), false);
        assert.deepEqual(errors, []);
    });

    await context.test('remembered initial screen exposes safe login, create user and logout without starting audio', async () => {
        const accounts = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await accounts.route('**/*', route => new URL(route.request().url()).origin === fixture.base ? route.continue() : route.abort());
        const initial = await accounts.newPage();
        try {
            await initial.goto(`${fixture.base}/fixture`);
            await login(initial, 'admin');
            await initial.evaluate(() => localStorage.setItem('frontpage-preserved-state', 'admin-saved-workspace'));
            await initial.goto(`${fixture.base}/mygrain/`);
            await initial.reload();
            for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
                await initial.setViewportSize(viewport);
                assert.equal(await initial.locator('#mygrainStartCurrentUser').textContent(), 'admin');
                for (const selector of ['[data-mygrain-account-action="login"]', '[data-mygrain-account-action="create"]', '.mygrain-start-account [data-mygrain-logout]', '#start-btn']) {
                    const usable = await initial.locator(selector).evaluate(button => {
                        const bounds = button.getBoundingClientRect();
                        return bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth && button.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
                    });
                    assert.ok(usable, `${selector} is visible and unobscured before START at ${viewport.width}px`);
                }
            }
            const guarded = await initial.evaluate(() => {
                document.querySelector('[data-mygrain-account-action="login"]').click();
                let blocked = false;
                try { localStorage.setItem('frontpage-preserved-state', 'stale-write'); } catch (error) { blocked = error.name === 'SecurityError'; }
                return { locked: !mygrainAccounts.authenticated, blocked };
            });
            assert.deepEqual(guarded, { locked: true, blocked: true });
            await initial.waitForURL(address => address.searchParams.get('account') === 'login');
            await initial.locator('#mygrainLoginUsername').waitFor();
            assert.equal(await initial.locator('.synth-container').count(), 0);
            assert.equal(await initial.locator('#mygrainLoginPassword').getAttribute('autocomplete'), 'current-password');
            assert.equal((await (await accounts.request.get(`${fixture.base}/mygrain/api/auth/session`)).json()).authenticated, false);
            await login(initial, 'dan');
            assert.equal(await initial.evaluate(() => localStorage.getItem('frontpage-preserved-state')), null);
            assert.equal(new URL(initial.url()).searchParams.has('account'), false);
            await initial.locator('[data-mygrain-account-action="create"]').click();
            await initial.waitForURL(address => address.searchParams.get('account') === 'create');
            await initial.locator('#mygrainLoginUsername').waitFor();
            assert.equal(await initial.locator('#mygrainLoginPassword').getAttribute('autocomplete'), 'new-password');
            assert.equal(await initial.locator('.mygrain-account-panel .mygrain-account-actions button').first().getAttribute('id'), 'mygrainCreateUserBtn');
            await initial.locator('#mygrainLoginUsername').fill('frontpage-new-user');
            await initial.locator('#mygrainLoginPassword').fill(fixture.password);
            await initial.locator('#mygrainLoginPassword').press('Enter');
            await initial.waitForFunction(() => document.getElementById('mygrainCurrentUser')?.textContent === 'frontpage-new-user');
            assert.equal(new URL(initial.url()).searchParams.has('account'), false);
            await Promise.all([
                initial.waitForNavigation({ waitUntil: 'load' }),
                initial.locator('.mygrain-start-account [data-mygrain-logout]').click()
            ]);
            await initial.locator('.mygrain-start-account[data-account-state="guest"]').waitFor();
            await login(initial, 'admin');
            assert.equal(await initial.evaluate(() => localStorage.getItem('frontpage-preserved-state')), 'admin-saved-workspace');
        } finally {
            await accounts.close();
        }
    });

    await context.test('login errors are visible and original admin browser state survives admin/dan/admin switching', async () => {
        await page.goto(`${fixture.base}/fixture`);
        await page.evaluate(() => { localStorage.setItem('granularSynthState', 'legacy-admin-patch'); sessionStorage.setItem('mygrain-runtime-tab-v1', 'admin-tab'); });
        await page.locator('[data-mygrain-account-action="login"]').click();
        await page.locator('#mygrainLoginUsername').fill('admin');
        await page.locator('#mygrainLoginPassword').fill('incorrect');
        await page.locator('#mygrainLoginBtn').click();
        await page.waitForFunction(() => document.getElementById('mygrainLoginStatus').textContent.includes('Incorrect'));
        await login(page, 'admin');
        assert.equal(await page.evaluate(() => fixtureRestored), 'legacy-admin-patch');
        assert.equal(await page.locator('#start-btn').isEnabled(), true);
        await databaseValue(page, 'admin-mic');
        await page.reload();
        assert.equal(await page.locator('#mygrainCurrentUser').textContent(), 'admin');
        assert.equal(await databaseValue(page), 'admin-mic');
        const cookies = await profile.cookies();
        assert.ok(cookies.some(cookie => cookie.name === 'mygrain' && cookie.httpOnly && cookie.expires > Date.now() / 1000));
        const stale = await profile.newPage();
        await stale.goto(`${fixture.base}/fixture`);
        assert.equal(await databaseValue(stale), 'admin-mic');
        await stale.evaluate(async () => {
            window.testAudio = new AudioContext();
            window.staleMedia = new Audio();
            window.stalePreview = mygrainAccounts.createMediaPreview(staleMedia, '/mygrain/api/vocal-takes/takes/fixture/audio');
            await stalePreview.play();
            window.oldResponse = await fetch('/mygrain/api/late-body');
            window.slowResult = fetch('/mygrain/api/slow').then(response => response.json()).then(() => 'STALE RESPONSE').catch(error => error.name);
        });
        await logout(page);
        await stale.locator('#mygrainLoginUsername').waitFor();
        assert.equal(await stale.evaluate(() => testAudio.state), 'closed');
        assert.equal(await stale.evaluate(() => slowResult), 'AbortError');
        assert.equal(await stale.evaluate(() => oldResponse.json().then(() => 'STALE BODY').catch(error => error.name)), 'AbortError');
        assert.equal(await stale.evaluate(() => staleMedia.paused && !staleMedia.getAttribute('src')), true);
        assert.equal(await stale.evaluate(() => { try { testDatabase.transaction('audioBuffers', 'readwrite'); return false; } catch (error) { return error.name === 'SecurityError'; } }), true);
        assert.equal(await stale.evaluate(() => { try { localStorage.setItem('granularSynthState', 'stale'); return false; } catch { return true; } }), true);
        await login(page, 'dan');
        assert.equal(await page.evaluate(() => fixtureRestored), null);
        assert.equal(await page.evaluate(() => sessionStorage.getItem('mygrain-runtime-tab-v1')), null);
        assert.equal(await databaseValue(page), undefined);
        await page.evaluate(() => { localStorage.granularSynthState = 'dan-patch'; sessionStorage.setItem('mygrain-runtime-tab-v1', 'dan-tab'); });
        await databaseValue(page, 'dan-mic');
        await logout(page);
        await login(page, 'admin');
        assert.equal(await page.evaluate(() => fixtureRestored), 'legacy-admin-patch');
        assert.equal(await page.evaluate(() => sessionStorage.getItem('mygrain-runtime-tab-v1')), 'admin-tab');
        assert.equal(await databaseValue(page), 'admin-mic');
        await stale.close();
    });

    await context.test('native sample/take players use guarded blobs while direct saved WAV media still works', async () => {
        const result = await page.evaluate(async () => {
            const states = [];
            for (const source of ['/mygrain-bastardloops/api/source-sample?path=fixture.wav', '/mygrain/api/vocal-takes/takes/fixture/audio']) {
                const audio = new Audio();
                const preview = mygrainAccounts.createMediaPreview(audio, source);
                const started = await preview.play();
                states.push({ started, blob: audio.src.startsWith('blob:'), duration: audio.duration, paused: audio.paused });
                preview.dispose();
                states.at(-1).released = !audio.getAttribute('src');
            }
            const direct = new Audio('/mygrain-wavs/fixture.wav');
            await direct.play();
            states.push({ direct: !direct.paused && direct.src.includes('/mygrain-wavs/fixture.wav') });
            direct.pause(); direct.removeAttribute('src'); direct.load();
            return states;
        });
        assert.deepEqual(result.slice(0, 2), [{ started: true, blob: true, duration: 1, paused: false, released: true }, { started: true, blob: true, duration: 1, paused: false, released: true }]);
        assert.equal(result[2].direct, true);
        assert.ok(fixture.requests.filter(request => /source-sample|takes\/fixture\/audio/.test(request.path)).every(request => request.user === 'admin'));
    });

    await context.test('sharing chooses a username, copies once, displays recipient comments safely and refreshes', async () => {
        await page.locator('#share-fixture').click();
        await page.locator('#mygrainShareRecipient option[value="dan"]').waitFor({ state: 'attached' });
        await page.locator('#mygrainShareRecipient').selectOption('dan');
        await page.locator('#mygrainShareSubmit').click();
        await page.waitForFunction(() => document.getElementById('mygrainShareStatus').textContent.startsWith('Shared a copy'));
        assert.equal(fixture.shares.length, 1);
        assert.equal(fixture.shares[0].recipient, 'dan');
        const recipient = await browser.newContext();
        await recipient.request.post(`${fixture.base}/mygrain/api/auth/login`, { data: { username: 'dan', password: fixture.password } });
        await recipient.request.post(`${fixture.base}/mygrain-wavs/api/feedback`, { headers: { 'X-Mygrain-User': 'dan' }, data: { filename: fixture.shares[0].recipientFilename, comment: '<img src=x onerror=alert(1)> Great track!' } });
        await page.locator('#mygrainShareRefresh').click();
        await page.waitForFunction(() => document.getElementById('mygrainShareComments').textContent.includes('Great track!'));
        assert.equal(await page.locator('#mygrainShareComments img').count(), 0);
        assert.equal(await page.evaluate(() => document.getElementById('mygrainShareDialog').getBoundingClientRect().width <= innerWidth), true);
        await page.locator('#mygrainShareClose').click();
        await page.locator('#mygrainSharedWavsBtn').click();
        await page.waitForFunction(() => document.getElementById('mygrainShareThread').textContent.includes('Great track!'));
        await page.locator('#mygrainShareClose').click();
        await recipient.close();
    });

    await context.test('registration uses native password-manager hints without saving passwords in app storage', async () => {
        await logout(page);
        await page.locator('#mygrainCreateUserBtn').focus();
        assert.equal(await page.locator('#mygrainLoginPassword').getAttribute('autocomplete'), 'new-password');
        await login(page, 'new-user', true);
        assert.equal(await page.evaluate(() => fixtureRestored), null);
        assert.equal(await page.evaluate(password => Object.keys(localStorage).some(key => String(localStorage[key]).includes(password)), fixture.password), false);
        await logout(page);
        await page.locator('#mygrainLoginUsername').fill('new-user');
        await page.locator('#mygrainLoginPassword').fill(fixture.password);
        await page.locator('#mygrainCreateUserBtn').click();
        await page.waitForFunction(() => document.getElementById('mygrainLoginStatus').textContent.includes('already exists'));
        await login(page, 'admin');
    });

    await context.test('auth expiry locks the app and stale/forged identity requests are denied before writes', async () => {
        const forged = await profile.request.post(`${fixture.base}/mygrain-wavs/api/share`, { headers: { 'X-Mygrain-User': 'dan' }, data: { filename: 'fixture.wav', username: 'dan' } });
        assert.equal(forged.status(), 403);
        assert.equal(fixture.shares.length, 1);
        fixture.sessions.clear();
        await page.evaluate(() => fetch('/mygrain/api/probe').catch(() => {}));
        await page.locator('#mygrainLoginUsername').waitFor();
        assert.match(await page.locator('#mygrainLoginStatus').textContent(), /expired or changed/);
        assert.equal(await page.evaluate(() => mygrainAccounts.authenticated), false);
        assert.deepEqual(errors, []);
    });
});
