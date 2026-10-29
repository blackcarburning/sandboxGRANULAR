const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(process.env.WAV_BROWSER_UNIT_HTML || path.join(__dirname, '../index.html'), 'utf8');

function extractFunction(name) {
    const start = html.search(new RegExp(`        (?:async )?function ${name}\\(`));
    if (start === -1) return '';
    const next = html.slice(start + 1).search(/\n        (?:async )?function /);
    return html.slice(start, start + 1 + next);
}

class Element {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.listeners = new Map();
        this.classList = { add() {}, remove() {}, toggle() {} };
        this.value = '';
        this.hidden = false;
        this.textContent = '';
        this.paused = true;
        this.style = {};
        this.loadCount = 0;
    }
    set innerHTML(value) { this.children = []; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    addEventListener(event, handler) {
        const listeners = this.listeners.get(event) || [];
        listeners.push(handler);
        this.listeners.set(event, listeners);
    }
    removeEventListener(event, handler) {
        this.listeners.set(event, (this.listeners.get(event) || []).filter(listener => listener !== handler));
    }
    async emit(event) {
        for (const handler of [...this.listeners.get(event) || []]) await handler({ target: this });
    }
    pause() { this.paused = true; this.emit('pause'); }
    play() { this.paused = false; this.emit('play'); return Promise.resolve(); }
    load() { this.loadCount += 1; this.paused = true; }
    blur() {}
    get dataset() { return this._dataset ||= {}; }
}

function descendants(element) {
    return element.children.flatMap(child => [child, ...descendants(child)]);
}

function fixtureFiles(count = 2000) {
    return Array.from({ length: count }, (_, index) => ({
        name: `fixture-${String(index).padStart(4, '0')}.wav`,
        url: `https://example.test/mygrain-wavs/fixture-${index}.wav`,
        size: 64000000,
        feedback: { comment: '', reaction: '' }
    }));
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
}

function harness(fetch = async () => ({ ok: true, json: async () => ({ ok: true, files: [] }) })) {
    const body = new Element('body');
    for (const id of ['wavRepositoryBrowserOverlay', 'wavRepositoryBrowserList', 'wavRepositoryBrowserFilter', 'wavRepositoryBrowserStatus']) {
        const element = new Element('div');
        element.id = id;
        body.appendChild(element);
    }
    const timers = new Map();
    const frames = new Map();
    const requests = [];
    const errors = [];
    let sequence = 0;
    let favouriteSearches = 0;
    const byId = id => descendants(body).find(element => element.id === id);
    const context = {
        AbortController, URL, Promise, Date, Map, Set, performance,
        navigator: { userAgent: 'Desktop regression fixture', maxTouchPoints: 0 },
        WAV_REPOSITORY_BROWSER_TIMEOUT_MS: 180000,
        WAV_REPOSITORY_BROWSER_PAGE_SIZE: 40,
        WAV_REPOSITORY_LIST_API_URL: 'https://example.test/mygrain-wavs/api/list',
        WAV_REPOSITORY_FEEDBACK_API_URL: 'https://example.test/mygrain-wavs/api/file-feedback',
        wavRepositoryPreviewRecovery: new WeakMap(),
        wavRepositoryBrowserFiles: [], wavRepositoryBrowserLoading: false,
        wavRepositoryBrowserPage: 0, wavRepositoryBrowserRenderTimer: null,
        wavRepositoryBrowserRenderGeneration: 0, wavRepositoryBrowserRefreshController: null,
        wavRepositoryBrowserDownloadControllers: new Set(),
        window: {
            location: { href: 'https://example.test/mygrain/' },
            mygrainFavourites: {
                ensureToolbar() {}, decorate() {}, matches: () => true,
                searchText: () => { favouriteSearches += 1; return ''; }
            }
        },
        MygrainFavourites: { itemKey: (source, name) => `${source}:${name}` },
        document: {
            body, createElement: name => new Element(name), getElementById: byId,
            querySelectorAll: selector => descendants(byId('wavRepositoryBrowserList'))
                .filter(element => element.tagName === selector.split(' ').at(-1))
        },
        setTimeout: (handler, delay) => { const id = ++sequence; timers.set(id, { handler, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        requestAnimationFrame: handler => { const id = ++sequence; frames.set(id, handler); return id; },
        cancelAnimationFrame: id => frames.delete(id),
        autosizeSampleBrowserFeedbackTextarea: textarea => {
            if (textarea.__autosizeFrame) frames.delete(textarea.__autosizeFrame);
            textarea.__autosizeFrame = ++sequence;
            frames.set(sequence, () => {});
        },
        setStatus: message => errors.push(message),
        console: { error: error => errors.push(error.message) },
        fetch: (...args) => { requests.push(args); return fetch(...args); }
    };
    vm.createContext(context);
    for (const name of [
        'pauseWavRepositoryBrowserPreviewAudio', 'cancelWavRepositoryBrowserRender',
        'setWavRepositoryBrowserStatus', 'fetchWavRepositoryBrowserData', 'setupWavRepositoryPreviewRecovery',
        'formatWavRepositoryFileMeta', 'normalizeWavRepositoryBrowserFeedback',
        'ensureWavRepositoryBrowserFeedbackDraft', 'isWavRepositoryBrowserFeedbackDirty',
        'getWavRepositoryBrowserFeedbackStatusText', 'syncWavRepositoryBrowserFeedbackUi',
        'saveWavRepositoryBrowserFeedback', 'renderWavRepositoryBrowserFiles',
        'refreshWavRepositoryBrowser', 'openWavRepositoryBrowser', 'closeWavRepositoryBrowser'
    ]) vm.runInContext(extractFunction(name), context);
    const nodes = tagName => descendants(byId('wavRepositoryBrowserList')).filter(element => element.tagName === tagName);
    const drain = () => {
        let turns = 0;
        while ([...timers.values()].some(timer => timer.delay === 0)) {
            assert.ok(++turns < 100, 'render work stays bounded');
            const [id, timer] = [...timers].find(([, entry]) => entry.delay === 0);
            timers.delete(id);
            timer.handler();
        }
    };
    return { context, byId, nodes, timers, frames, requests, errors, drain, favouriteSearches: () => favouriteSearches };
}

async function flush() {
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

test('2,000 WAVs render at most eight initially and 40 per page, without media fetches', async () => {
    const browser = harness();
    browser.context.wavRepositoryBrowserFiles = fixtureFiles();
    browser.context.renderWavRepositoryBrowserFiles();
    assert.ok(browser.nodes('article').length <= 8);
    browser.drain();
    assert.equal(browser.nodes('article').length, 40);
    assert.equal(browser.nodes('audio').length, 40);
    assert.ok(browser.nodes('audio').every(audio => audio.preload === 'none'));
    assert.equal(browser.requests.length, 0);
    assert.equal(browser.favouriteSearches(), 0);
    assert.match(browser.byId('wavRepositoryBrowserPageStatus').textContent, /1–40 of 2000/);
    await browser.byId('wavRepositoryBrowserNextBtn').emit('click');
    browser.drain();
    assert.equal(browser.nodes('article').length, 40);
    assert.match(browser.byId('wavRepositoryBrowserPageStatus').textContent, /41–80 of 2000/);
    await browser.byId('wavRepositoryBrowserPreviousBtn').emit('click');
    browser.drain();
    assert.match(browser.byId('wavRepositoryBrowserPageStatus').textContent, /1–40 of 2000/);
});

test('search covers the last WAV and note drafts survive filtering and paging', async () => {
    const browser = harness();
    browser.context.wavRepositoryBrowserFiles = fixtureFiles();
    browser.context.renderWavRepositoryBrowserFiles();
    browser.drain();
    browser.nodes('textarea')[0].value = 'Keep this unsaved note';
    await browser.nodes('textarea')[0].emit('input');
    browser.byId('wavRepositoryBrowserFilter').value = 'fixture-1999';
    browser.context.renderWavRepositoryBrowserFiles();
    browser.drain();
    assert.equal(browser.nodes('article').length, 1);
    assert.equal(browser.nodes('audio')[0].src, fixtureFiles()[1999].url);
    browser.byId('wavRepositoryBrowserFilter').value = '';
    browser.context.renderWavRepositoryBrowserFiles();
    browser.drain();
    assert.equal(browser.nodes('textarea')[0].value, 'Keep this unsaved note');
});

test('close cancels queued rendering, sizing and previews and releases every media source', async () => {
    const browser = harness();
    browser.context.wavRepositoryBrowserFiles = fixtureFiles();
    browser.context.renderWavRepositoryBrowserFiles();
    const audios = browser.nodes('audio');
    await audios[0].play();
    browser.context.closeWavRepositoryBrowser();
    const count = browser.nodes('article').length;
    browser.drain();
    assert.equal(browser.byId('wavRepositoryBrowserOverlay').hidden, true);
    assert.equal(browser.nodes('article').length, count);
    assert.equal(browser.timers.size, 0);
    assert.equal(browser.frames.size, 0);
    for (const audio of audios) {
        assert.equal(audio.paused, true);
        assert.equal(audio.src, undefined);
        assert.equal(audio.loadCount, 1);
        assert.equal(browser.context.wavRepositoryPreviewRecovery.has(audio), false);
    }
});

test('close aborts a list request and ignores its late response and status', async () => {
    const response = deferred();
    const browser = harness(() => response.promise);
    const loading = browser.context.refreshWavRepositoryBrowser();
    browser.context.closeWavRepositoryBrowser();
    const status = browser.byId('wavRepositoryBrowserStatus').textContent;
    assert.equal(browser.requests[0][1].signal.aborted, true);
    response.resolve({ ok: true, json: async () => ({ ok: true, files: fixtureFiles(3) }) });
    await loading;
    browser.drain();
    assert.equal(browser.context.wavRepositoryBrowserFiles.length, 0);
    assert.equal(browser.byId('wavRepositoryBrowserStatus').textContent, status);
    assert.equal(browser.requests.length, 1);
    assert.equal(browser.timers.size, 0);
});

test('a superseded refresh cannot overwrite a newer listing or clear its loading state', async () => {
    const first = deferred();
    const second = deferred();
    const browser = harness(() => browser.requests.length === 1 ? first.promise : second.promise);
    const stale = browser.context.refreshWavRepositoryBrowser();
    const current = browser.context.refreshWavRepositoryBrowser({ forceRefresh: true });
    first.resolve({ ok: true, json: async () => ({ ok: true, files: fixtureFiles(9) }) });
    await stale;
    assert.equal(browser.context.wavRepositoryBrowserLoading, true);
    assert.equal(browser.context.wavRepositoryBrowserFiles.length, 0);
    second.resolve({ ok: true, json: async () => ({ ok: true, files: fixtureFiles(2) }) });
    await current;
    browser.drain();
    assert.equal(browser.context.wavRepositoryBrowserLoading, false);
    assert.equal(browser.context.wavRepositoryBrowserFiles.length, 2);
    assert.match(browser.requests[1][0], /\?refresh=1$/);
});

test('reopen shows cached entries immediately and unchanged refresh preserves live controls and drafts', async () => {
    const response = deferred();
    const files = fixtureFiles(2);
    const browser = harness(() => response.promise);
    browser.context.wavRepositoryBrowserFiles = files.map(file => ({ ...file,
        feedback: browser.context.normalizeWavRepositoryBrowserFeedback(file.feedback, file),
        feedbackDraft: { comment: 'draft', reaction: '' }
    }));
    browser.context.closeWavRepositoryBrowser();
    browser.context.openWavRepositoryBrowser();
    browser.drain();
    assert.equal(browser.nodes('article').length, 2);
    const audio = browser.nodes('audio')[0];
    await audio.play();
    response.resolve({ ok: true, json: async () => ({ ok: true, files }) });
    await flush();
    browser.drain();
    assert.equal(browser.nodes('audio')[0], audio);
    assert.equal(audio.paused, false);
    assert.equal(browser.nodes('textarea')[0].value, 'draft');
});

test('failed refresh reports its real error while keeping cached entries', async () => {
    const browser = harness(async () => { throw new Error('fixture offline'); });
    browser.context.wavRepositoryBrowserFiles = fixtureFiles(2);
    await browser.context.refreshWavRepositoryBrowser();
    assert.equal(browser.requests.length, 2);
    assert.match(browser.byId('wavRepositoryBrowserStatus').textContent, /fixture offline.*automatic retry also failed/);
    assert.equal(browser.context.wavRepositoryBrowserFiles.length, 2);
});

test('changed remote notes update clean controls while unsaved drafts survive a refresh', async () => {
    const files = fixtureFiles(2);
    const browser = harness(async () => ({ ok: true, json: async () => ({ ok: true,
        files: files.map(file => ({ ...file, feedback: { comment: 'remote update', reaction: 'like' } }))
    }) }));
    browser.context.wavRepositoryBrowserFiles = files;
    browser.context.renderWavRepositoryBrowserFiles();
    browser.nodes('textarea')[1].value = 'local unsaved';
    await browser.nodes('textarea')[1].emit('input');
    await browser.context.refreshWavRepositoryBrowser();
    browser.drain();
    assert.equal(browser.nodes('textarea')[0].value, 'remote update');
    assert.equal(browser.nodes('textarea')[1].value, 'local unsaved');
});

test('close aborts downloads without a save dialog, another retry or late error', async () => {
    const response = deferred();
    const browser = harness(() => response.promise);
    browser.context.wavRepositoryBrowserFiles = fixtureFiles(1);
    browser.context.renderWavRepositoryBrowserFiles();
    let saves = 0;
    browser.context.saveAudioFiles = async () => { saves += 1; };
    const download = browser.nodes('button').find(button => button.textContent === 'Download WAV').emit('click');
    browser.context.closeWavRepositoryBrowser();
    assert.equal(browser.requests[0][1].signal.aborted, true);
    response.resolve({ ok: true, blob: async () => ({ size: 100 }) });
    await download;
    assert.equal(saves, 0);
    assert.equal(browser.requests.length, 1);
    assert.equal(browser.errors.length, 0);
    assert.equal(browser.context.wavRepositoryBrowserDownloadControllers.size, 0);
});

test('note saving retains its POST endpoint and payload schema', async () => {
    const browser = harness(async () => ({ ok: true, json: async () => ({
        ok: true, feedback: { comment: 'permanent note', reaction: 'love', updatedAt: '2026-10-16T12:00:00Z' }
    }) }));
    browser.context.wavRepositoryBrowserFiles = fixtureFiles(1);
    browser.context.renderWavRepositoryBrowserFiles();
    const textarea = browser.nodes('textarea')[0];
    textarea.value = 'permanent note';
    await textarea.emit('input');
    browser.context.wavRepositoryBrowserFiles[0].feedbackDraft.reaction = 'love';
    await browser.nodes('button').find(button => button.textContent === 'Save Notes').emit('click');
    assert.equal(browser.requests[0][0], browser.context.WAV_REPOSITORY_FEEDBACK_API_URL);
    assert.equal(browser.requests[0][1].method, 'POST');
    assert.deepEqual(JSON.parse(browser.requests[0][1].body), {
        filename: 'fixture-0000.wav', comment: 'permanent note', reaction: 'love'
    });
    assert.equal(browser.context.wavRepositoryBrowserFiles[0].feedback.comment, 'permanent note');
});
