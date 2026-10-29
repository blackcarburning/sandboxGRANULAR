const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function extractFunction(name) {
    const start = html.search(new RegExp(`        (?:async )?function ${name}\\(`));
    assert.notEqual(start, -1, name);
    const next = html.slice(start + 1).search(/\n        (?:async )?function /);
    return html.slice(start, start + 1 + next);
}

function createHarness(fetch = async () => ({ ok: true, blob: async () => ({ size: 64000000 }) })) {
    const timers = new Map();
    const messages = [];
    const requests = [];
    const revokedUrls = [];
    let nextTimer = 0;
    let nextUrl = 0;
    class PreviewURL extends URL {
        static createObjectURL() { return `blob:fixture-${++nextUrl}`; }
        static revokeObjectURL(url) { revokedUrls.push(url); }
    }
    const context = {
        AbortController, URL: PreviewURL, Promise, Date,
        WAV_REPOSITORY_BROWSER_TIMEOUT_MS: 180000,
        wavRepositoryPreviewRecovery: new WeakMap(),
        window: { location: { href: 'https://example.test/mygrain/' } },
        setWavRepositoryBrowserStatus: message => messages.push(message),
        setTimeout: (handler, delay) => {
            const timer = ++nextTimer;
            timers.set(timer, { handler, delay });
            return timer;
        },
        clearTimeout: timer => timers.delete(timer),
        fetch: (...args) => { requests.push(args); return fetch(...args); }
    };
    vm.createContext(context);
    for (const name of ['fetchWavRepositoryBrowserData', 'setupWavRepositoryPreviewRecovery', 'pauseWavRepositoryBrowserPreviewAudio']) {
        vm.runInContext(extractFunction(name), context);
    }
    return {
        context, timers, messages, requests, revokedUrls,
        expire: () => {
            const [timer, entry] = timers.entries().next().value;
            timers.delete(timer);
            entry.handler();
        }
    };
}

async function flush() {
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

class FakeAudio {
    constructor() {
        this.listeners = new Map();
        this.paused = true;
        this.currentTime = 0;
        this.error = null;
        this.playCount = 0;
        this.loadCount = 0;
        this.src = 'https://example.test/mygrain-wavs/big.wav';
    }
    addEventListener(event, handler, options = {}) {
        const handlers = this.listeners.get(event) || [];
        handlers.push({ handler, once: options.once });
        this.listeners.set(event, handlers);
    }
    removeEventListener(event, handler) {
        this.listeners.set(event, (this.listeners.get(event) || []).filter(entry => entry.handler !== handler));
    }
    emit(event) {
        for (const entry of [...this.listeners.get(event) || []]) {
            if (entry.once) this.removeEventListener(event, entry.handler);
            entry.handler();
        }
    }
    load() {
        this.loadCount += 1;
        const wasPlaying = !this.paused;
        this.paused = true;
        this.error = null;
        if (wasPlaying) this.emit('pause');
    }
    play() {
        this.playCount += 1;
        this.paused = false;
        this.emit('play');
        return this.playResult || Promise.resolve();
    }
    pause() {
        this.paused = true;
        this.emit('pause');
    }
    removeAttribute(name) {
        if (name === 'src') this.src = '';
    }
}

function previewHarness() {
    const harness = createHarness();
    const audio = new FakeAudio();
    harness.context.setupWavRepositoryPreviewRecovery(audio, { name: 'big.wav', url: audio.src });
    return { ...harness, audio };
}

test('WAV browser timeout is three minutes and scoped to safe GET requests', () => {
    assert.match(html, /const WAV_REPOSITORY_BROWSER_TIMEOUT_MS = 180000;/);
    assert.match(extractFunction('renderWavRepositoryBrowserFiles'), /fetchWavRepositoryBrowserData\(file.url/);
    assert.match(extractFunction('refreshWavRepositoryBrowser'), /fetchWavRepositoryBrowserData\(url/);
    assert.doesNotMatch(extractFunction('uploadWavToRepository'), /fetchWavRepositoryBrowserData/);
    assert.doesNotMatch(extractFunction('deleteWavFromRepository'), /fetchWavRepositoryBrowserData/);
    assert.doesNotMatch(extractFunction('renameWavInRepository'), /fetchWavRepositoryBrowserData/);
});

test('successful JSON request clears its timeout without retrying', async () => {
    let calls = 0;
    const harness = createHarness(async (url, options) => {
        calls += 1;
        assert.equal(options.cache, 'no-store');
        assert.equal(options.signal.aborted, false);
        return { ok: true, json: async () => ({ ok: true, files: [] }) };
    });
    await harness.context.fetchWavRepositoryBrowserData('/list');
    assert.equal(calls, 1);
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.messages.length, 0);
});

for (const failure of ['network', 'HTTP', 'invalid JSON', 'API error', 'body failure']) {
    test(`${failure} failure retries once and updates the small status line`, async () => {
        let calls = 0;
        const payload = { ok: true, files: [] };
        const harness = createHarness(async () => {
            calls += 1;
            if (calls === 1 && failure === 'network') throw new TypeError('Network disconnected');
            return {
                ok: calls !== 1 || failure !== 'HTTP', status: 503,
                json: async () => {
                    if (calls === 1 && failure === 'invalid JSON') throw new SyntaxError('Bad JSON');
                    if (calls === 1 && failure === 'body failure') throw new TypeError('Body interrupted');
                    return calls === 1 && failure === 'API error' ? { ok: false, error: 'Busy' } : payload;
                }
            };
        });
        assert.equal(await harness.context.fetchWavRepositoryBrowserData('/list', { label: 'Load WAV list' }), payload);
        assert.equal(calls, 2);
        assert.match(harness.messages[0], /Load WAV list: .*Retrying \(1\/1\)/);
        assert.equal(harness.timers.size, 0);
    });
}

test('download timeout remains armed through the full response body and retries after abort', async () => {
    let calls = 0;
    const blob = { size: 64000000 };
    const harness = createHarness(async (url, options) => {
        calls += 1;
        return {
            ok: true,
            blob: () => calls === 1 ? new Promise((resolve, reject) => {
                assert.equal(harness.timers.size, 1);
                options.signal.addEventListener('abort', () => reject(new Error('Aborted')));
            }) : Promise.resolve(blob)
        };
    });
    const download = harness.context.fetchWavRepositoryBrowserData('/big.wav', { responseType: 'blob', label: 'Download big.wav' });
    await Promise.resolve();
    assert.equal(harness.timers.values().next().value.delay, 180000);
    harness.expire();
    assert.equal(await download, blob);
    assert.equal(calls, 2);
    assert.match(harness.messages[0], /Timed out after 3 minutes.*Retrying/);
    assert.equal(harness.timers.size, 0);
});

test('two request failures stop instead of looping indefinitely', async () => {
    let calls = 0;
    const harness = createHarness(async () => { calls += 1; throw new Error('Offline'); });
    await assert.rejects(harness.context.fetchWavRepositoryBrowserData('/list'), /automatic retry also failed/);
    assert.equal(calls, 2);
    assert.equal(harness.timers.size, 0);
});

test('large preview waits three minutes and loading progress refreshes the watchdog', async () => {
    const { audio, timers, expire, messages } = previewHarness();
    audio.play();
    const first = [...timers.keys()][0];
    audio.emit('progress');
    assert.equal(timers.has(first), false);
    assert.equal(timers.values().next().value.delay, 180000);
    expire();
    await flush();
    assert.equal(audio.loadCount, 1);
    assert.match(messages.at(-1), /No loading progress for 3 minutes.*Retrying/);
});

test('preview error fully downloads a cache-busted URL, restores position and reports success', async () => {
    const { audio, timers, messages, requests } = previewHarness();
    audio.play();
    audio.currentTime = 12;
    audio.error = { message: 'Network interrupted' };
    audio.emit('error');
    await flush();
    assert.equal(audio.loadCount, 1);
    assert.match(requests[0][0], /mygrain-preview-retry=/);
    assert.match(audio.src, /^blob:/);
    audio.currentTime = 0;
    audio.emit('loadedmetadata');
    assert.equal(audio.currentTime, 12);
    audio.emit('playing');
    assert.equal(timers.size, 0);
    assert.match(messages.at(-1), /retry succeeded/);
});

test('two preview errors exhaust the retry and ignore duplicate error events', async () => {
    const { audio, timers, messages } = previewHarness();
    audio.play();
    audio.emit('error');
    await flush();
    audio.error = { message: 'Still offline' };
    audio.emit('error');
    audio.emit('error');
    assert.equal(audio.loadCount, 1);
    assert.equal(audio.paused, true);
    assert.equal(timers.size, 0);
    assert.match(messages.at(-1), /Automatic retry also failed/);
});

test('pause cancels recovery, while a fresh Play gets a new retry budget', async () => {
    const { audio, timers } = previewHarness();
    audio.play();
    audio.pause();
    audio.emit('stalled');
    audio.emit('error');
    assert.equal(audio.loadCount, 0);
    assert.equal(timers.size, 0);
    audio.play();
    audio.emit('error');
    await flush();
    assert.equal(audio.loadCount, 1);
});

test('close and rerender cancel pending playback without late status messages', async () => {
    const { audio, context, timers, messages } = previewHarness();
    context.document = { querySelectorAll: () => [audio] };
    audio.play();
    audio.emit('error');
    await flush();
    context.pauseWavRepositoryBrowserPreviewAudio({ dispose: true });
    const count = messages.length;
    await Promise.resolve();
    audio.emit('waiting');
    audio.emit('error');
    assert.equal(timers.size, 0);
    assert.equal(messages.length, count);
    assert.equal(context.wavRepositoryPreviewRecovery.has(audio), false);
});

test('rejected retry playback is handled and never causes an unhandled rejection', async () => {
    const { audio, timers, messages } = previewHarness();
    audio.play();
    audio.playResult = Promise.reject(new Error('Playback denied'));
    audio.emit('error');
    await flush();
    assert.equal(audio.loadCount, 1);
    assert.equal(timers.size, 0);
    assert.match(messages.at(-1), /Playback denied.*Automatic retry also failed/);
});

test('closing during a full preview download aborts it without another request', async () => {
    const harness = createHarness((url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('Aborted')));
    }));
    const audio = new FakeAudio();
    harness.context.setupWavRepositoryPreviewRecovery(audio, { name: 'big.wav', url: audio.src });
    harness.context.document = { querySelectorAll: () => [audio] };
    audio.play();
    audio.emit('error');
    const count = harness.messages.length;
    harness.context.pauseWavRepositoryBrowserPreviewAudio();
    await flush();
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0][1].signal.aborted, true);
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.messages.length, count);
});

test('failed full-download fallback consumes only one automatic retry', async () => {
    const harness = createHarness(async () => { throw new Error('Still offline'); });
    const audio = new FakeAudio();
    harness.context.setupWavRepositoryPreviewRecovery(audio, { name: 'big.wav', url: audio.src });
    audio.play();
    audio.emit('error');
    audio.emit('error');
    await flush();
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.timers.size, 0);
    assert.match(harness.messages.at(-1), /Still offline.*Automatic retry also failed/);
});

test('rerender releases the full-download blob and buffered playback ignores harmless stalls', async () => {
    const { audio, context, timers, revokedUrls } = previewHarness();
    audio.play();
    audio.emit('error');
    await flush();
    audio.emit('playing');
    audio.readyState = 4;
    audio.emit('stalled');
    assert.equal(timers.size, 0);
    context.document = { querySelectorAll: () => [audio] };
    context.pauseWavRepositoryBrowserPreviewAudio({ dispose: true });
    assert.deepEqual(revokedUrls, ['blob:fixture-1']);
    assert.equal(audio.src, '');
    assert.equal(audio.paused, true);
    assert.equal(audio.loadCount, 2);
    assert.equal([...audio.listeners.values()].flat().length, 0);
});

test('native probe failure before play shows a useful error instead of staying silent', () => {
    const { audio, messages, requests } = previewHarness();
    audio.error = { code: 4, message: 'Source rejected' };
    audio.emit('error');
    assert.match(messages.at(-1), /Cannot play big.wav: Source rejected/);
    assert.equal(requests.length, 0, 'A metadata probe must not eagerly download a full WAV');
});
