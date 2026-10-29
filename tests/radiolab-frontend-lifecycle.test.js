const test = require('node:test');
const assert = require('node:assert/strict');
const { Controller, PCMBufferRing, PCMRecorder, encodeWav } = require('../radiolab.js');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, handler) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(handler);
    }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
    dispatch(type, properties = {}) {
        for (const handler of Array.from(this.listeners.get(type) || [])) handler({ target: this, ...properties });
    }
}

function fixture(hooks = {}) {
    const calls = [];
    const audios = [];
    const sources = [];
    const taps = [];
    const releases = [];
    const timers = new Map();
    let timerId = 0;
    const elements = new Map();
    const document = Object.assign(new Events(), { baseURI: 'http://localhost/mygrain/', visibilityState: 'visible' });
    document.createElement = tagName => Object.assign(new Events(), {
        tagName: tagName.toUpperCase(), value: '', textContent: '', open: false, dataset: {}, attributes: {}, children: [],
        style: { setProperty() {} },
        setAttribute(name, value) { this.attributes[name] = value; }, toggleAttribute() {},
        replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); },
        focus() { document.activeElement = this; },
        showModal() { this.open = true; }, close() { this.open = false; this.dispatch('close'); }
    });
    document.getElementById = id => {
        if (!elements.has(id)) elements.set(id, document.createElement('div'));
        return elements.get(id);
    };
    const node = () => ({ connect() {}, disconnect() { this.disconnected = true; } });
    const context = Object.assign(new Events(), {
        state: 'running', currentTime: 0, sampleRate: 8, destination: {},
        resume() { calls.push('resume'); return hooks.resume?.(this) || Promise.resolve().then(() => { this.state = 'running'; }); },
        createGain() { return { ...node(), gain: { value: 1, setValueAtTime(value) { this.value = value; } } }; },
        createMediaElementSource(audio) {
            assert.equal(audio.sourced, undefined, 'a media element can only have one MediaElementAudioSourceNode');
            audio.sourced = true;
            const source = node();
            sources.push(source);
            return source;
        },
        createScriptProcessor() { const tap = node(); taps.push(tap); return tap; },
        close() { this.state = 'closed'; return Promise.resolve(); }
    });
    if (hooks.worklet) context.audioWorklet = { addModule() { calls.push('module'); return hooks.worklet(); } };
    const root = Object.assign(new Events(), {
        document, location: { href: document.baseURI },
        mygrainAccounts: { authenticated: true, user: { username: 'fixture-user' } },
        fetch(url, options) { releases.push({ url: new URL(url, document.baseURI), options, source: audios[0]?.src }); return hooks.release?.() || Promise.resolve({ ok: true }); },
        setInterval, clearInterval,
        setTimeout(handler) { const identifier = ++timerId; timers.set(identifier, handler); return identifier; },
        clearTimeout(identifier) { timers.delete(identifier); },
        Audio: class extends Events {
            constructor() { super(); this.paused = true; this.readyState = 0; this.src = ''; this.loads = 0; audios.push(this); }
            setAttribute() {}
            getAttribute(name) { return name === 'src' ? this.src : null; }
            removeAttribute(name) { if (name === 'src') this.src = ''; }
            load() { this.loads += 1; this.readyState = 0; this.error = null; this.ended = false; }
            pause() { this.paused = true; }
            play() { calls.push('play'); this.paused = false; this.readyState = 2; return hooks.play?.(this) || Promise.resolve(); }
        },
        AudioWorkletNode: class {
            constructor() {
                Object.assign(this, node());
                this.port = { onmessage: null, postMessage() { assert.equal(this.closed, undefined); }, close() { this.closed = true; } };
                taps.push(this);
            }
        }
    });
    const ring = new PCMBufferRing({ sampleRate: 8 });
    ring.append([Float32Array.from([.25, -.25])]);
    const recorder = new PCMRecorder({ sampleRate: 8 }).start(ring, .25, { station: { id: 'old', name: 'Old station' } });
    recorder.stop();
    const controller = Object.assign(Object.create(Controller.prototype), {
        root, context, ownsContext: false, username: 'fixture-user', epoch: 0, requestEpoch: 0, previewEpoch: 0,
        busy: false, locked: false, listening: false, monitor: true, rewind: 0, pendingRecord: null,
        browserEpoch: 0, browserRequests: new Set(), sampleRows: new Map(),
        ring, recorder, requests: new Set(), samples: [],
        stations: [
            { id: 'first', name: 'First station', streamUrl: '/mygrain/radiolab/stream/first' },
            { id: 'second', name: 'Second station', streamUrl: '/mygrain/radiolab/stream/second' }
        ],
        adapter: { getContext: () => context }, dialog: document.getElementById('radiolabSamplesDialog')
    });
    controller.element('radiolabStation').value = 'first';
    controller.element('radiolabName').value = 'Keep my take name';
    controller.bind();
    controller.render();
    return { controller, root, context, calls, audios, sources, taps, timers, releases,
        expire() { for (const handler of Array.from(timers.values())) handler(); }
    };
}

async function settled(promise) {
    let timer;
    try {
        await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('cancelled operation did not settle')), 150); })]);
    } finally { clearTimeout(timer); }
}

function captureTransport(state) {
    const originalFetch = state.root.fetch;
    const transports = [];
    state.root.fetch = (url, options) => {
        if (new URL(url, state.root.location.href).searchParams.get('_radiolab_format') !== 'pcm') return originalFetch(url, options);
        const transport = { url: new URL(url), options, cancelled: false };
        transports.push(transport);
        return Promise.resolve({
            ok: true, status: 200,
            headers: new Headers({ 'Content-Type': 'application/octet-stream', 'X-Radiolab-Sample-Rate': '44100', 'X-Radiolab-Channels': '2' }),
            body: new ReadableStream({ start(stream) { transport.stream = stream; }, cancel() { transport.cancelled = true; } })
        });
    };
    return transports;
}

async function deliverCapture(transport) {
    transport.stream.enqueue(Uint8Array.of(0, 32, 0, 224));
    await new Promise(resolve => setImmediate(resolve));
}

test('monitor context interruption cannot gate or stop independent server PCM capture', async () => {
    const state = fixture();
    const transports = captureTransport(state);
    await state.controller.listen();
    const monitor = state.controller.streamOperation;
    await state.controller.record();
    await deliverCapture(transports[0]);
    const recorder = state.controller.recorder;
    state.context.state = 'interrupted';
    state.context.dispatch('statechange');
    assert.equal(state.controller.listening, false);
    assert.equal(state.controller.state.recording, true);
    assert.equal(transports[0].cancelled, false);
    await deliverCapture(transports[0]);
    assert.equal(recorder.frames, 2);
    assert.equal(state.releases[0].url.searchParams.get('_radiolab_client'), monitor.client);
    state.controller.stop();
    assert.equal(transports[0].cancelled, true);
    assert.equal(state.releases.length, 2);
    assert.equal(state.timers.size, 0);
});

test('station change stops and releases monitor plus capture scopes and retains only the completed take', async () => {
    const state = fixture();
    const transports = captureTransport(state);
    await state.controller.listen();
    const monitor = state.controller.streamOperation;
    await state.controller.record();
    await deliverCapture(transports[0]);
    const capture = state.controller.captureOperation;
    const recorder = state.controller.recorder;
    assert.notEqual(monitor.client, capture.client);
    assert.equal(capture.client, monitor.client + '-pcm');
    state.controller.element('radiolabStation').value = 'second';
    state.controller.element('radiolabStation').dispatch('change');
    assert.equal(state.controller.state.armed || state.controller.state.recording || state.controller.listening, false);
    assert.equal(state.controller.recorder, recorder);
    assert.equal(recorder.metadata.station.id, 'first');
    assert.equal(recorder.state, 'stopped');
    assert.equal(state.audios[0].src, '');
    assert.equal(transports[0].cancelled, true);
    assert.deepEqual(new Set(state.releases.map(release => release.url.searchParams.get('_radiolab_client'))), new Set([capture.client, monitor.client]));
    assert.equal(state.timers.size, 0);
});

for (const lifecycle of ['pagehide', 'mygrain-account-lock', 'visibilitychange']) test('dual radio transports cleanly release on ' + lifecycle, async () => {
    const state = fixture();
    const transports = captureTransport(state);
    await state.controller.listen();
    await state.controller.record();
    await deliverCapture(transports[0]);
    const recorder = state.controller.recorder;
    const chunk = recorder.chunks[0];
    if (lifecycle === 'visibilitychange') {
        state.root.document.visibilityState = 'hidden';
        state.root.document.dispatch(lifecycle);
    } else state.root.dispatch(lifecycle);
    assert.equal(state.controller.listening || state.controller.state.armed || state.controller.state.recording, false);
    assert.equal(state.audios[0].src, '');
    assert.equal(transports[0].cancelled, true);
    assert.equal(state.releases.length, 2);
    assert.equal(state.timers.size, 0);
    if (lifecycle === 'visibilitychange') {
        assert.equal(state.controller.recorder, recorder);
        assert.equal(recorder.hasSignal, true);
        assert.equal(recorder.state, 'stopped');
    } else {
        assert.equal(state.controller.recorder, null);
        assert.ok(chunk.every(channel => channel.every(value => value === 0)));
        assert.equal(state.controller.diagnostics.capture, null);
        assert.deepEqual(state.controller.diagnostics.events, []);
    }
});

test('radio diagnostics retain bounded media events without private URLs, tokens, accounts or take names', async () => {
    const { controller, audios } = fixture();
    await controller.listen();
    audios[0].error = { code: 3, message: 'private URL must never be copied' };
    controller.diagnosticEvent('error');
    let snapshot = controller.diagnostics;
    assert.equal(snapshot.events[0].station, 'first');
    assert.equal(snapshot.media.errorCode, 3);
    for (let i = 0; i < 80; i++) controller.diagnosticEvent('waiting');
    snapshot = controller.diagnostics;
    assert.equal(snapshot.events.length, 32);
    snapshot.events[0].media.errorCode = 99;
    assert.equal(controller.diagnostics.events[0].media.errorCode, 3);
    const text = JSON.stringify(snapshot);
    for (const secret of ['fixture-user', controller.streamClient, 'Keep my take name', 'http:', 'private URL']) assert.ok(!text.includes(secret));
    controller.stop();
    assert.equal(controller.diagnostics.events.at(-1).type, 'detach');
    controller.dispose(true);
    assert.deepEqual(controller.diagnostics.events, []);
    assert.equal(controller.diagnostics.media, null);
});

test('Stop settles a hung play immediately, empties the media source and preserves the take/name/rewind', async () => {
    const play = deferred();
    const { controller, audios, sources } = fixture({ play: () => play.promise });
    const take = controller.recorder;
    const starting = controller.run(() => controller.listen());
    const ring = controller.ring;
    assert.equal(controller.busy, true);
    controller.stop();
    await settled(starting);
    assert.equal(controller.busy || controller.listening, false);
    assert.equal(audios[0].src, '');
    assert.equal(audios[0].paused, true);
    assert.ok(audios[0].loads >= 2);
    assert.equal(sources[0].disconnected, true);
    assert.equal(controller.recorder, take);
    assert.equal(controller.ring, ring);
    assert.equal(controller.element('radiolabName').value, 'Keep my take name');
    play.reject(new Error('late play rejection'));
});

test('station change cancels a hung tune and stale play/error callbacks cannot stop a newer station', async () => {
    const play = deferred();
    let attempts = 0;
    const { controller, audios, sources } = fixture({ play: () => ++attempts === 1 ? play.promise : Promise.resolve() });
    const first = controller.run(() => controller.listen());
    const error = Array.from(audios[0].listeners.get('error'))[0];
    assert.equal(controller.element('radiolabStation').disabled, false);
    controller.element('radiolabStation').value = 'second';
    controller.element('radiolabStation').dispatch('change');
    await settled(first);
    await controller.run(() => controller.listen());
    const status = controller.element('radiolabStatus').textContent;
    play.reject(new Error('old station failed'));
    error();
    await Promise.resolve();
    assert.equal(controller.listening, true);
    assert.equal(controller.tunedStation, 'second');
    assert.equal(controller.busy, false);
    assert.equal(controller.element('radiolabStatus').textContent, status);
    assert.equal(audios.length, 1);
    assert.equal(sources.length, 1);
    controller.stop();
});

test('failed play retries with a new loaded stream URL and reuses its single media source', async () => {
    let attempts = 0;
    const { controller, audios, sources } = fixture({ play: () => ++attempts === 1 ? Promise.reject(new Error('NotAllowedError: tap again')) : Promise.resolve() });
    const take = controller.recorder;
    const starting = controller.run(() => controller.listen());
    const firstUrl = audios[0].src;
    await starting;
    assert.equal(controller.busy || controller.listening, false);
    assert.equal(audios[0].src, '');
    await controller.run(() => controller.listen());
    assert.notEqual(audios[0].src, firstUrl);
    assert.equal(audios.length, 1);
    assert.equal(sources.length, 1);
    assert.equal(controller.recorder, take);
    assert.equal(controller.element('radiolabName').value, 'Keep my take name');
    assert.equal(controller.listening, true);
    controller.stop();
});

for (const phase of ['play', 'resume', 'worklet']) {
    test(`a hung ${phase} has a bounded deadline and late settlement cannot damage retry`, async () => {
        const pending = deferred();
        let attempts = 0;
        const state = fixture({ [phase]: () => ++attempts === 1 ? pending.promise : Promise.resolve() });
        const { controller, context } = state;
        if (phase === 'resume') context.state = 'suspended';
        const starting = controller.run(() => controller.listen());
        state.expire();
        await settled(starting);
        assert.equal(controller.busy || controller.listening, false);
        assert.match(controller.element('radiolabStatus').textContent, /timed out|tap.*again|retry/i);
        context.state = 'running';
        await controller.run(() => controller.listen());
        const status = controller.element('radiolabStatus').textContent;
        pending.reject(new Error(`late ${phase} rejection`));
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(controller.listening, true);
        assert.equal(controller.element('radiolabStatus').textContent, status);
        controller.stop();
        assert.equal(state.timers.size, 0);
    });
}

test('resume and play are called synchronously inside the gesture even with a pending worklet', async () => {
    const module = deferred();
    const resume = deferred();
    const { controller, context, calls } = fixture({ worklet: () => module.promise, resume: () => resume.promise });
    context.state = 'suspended';
    const starting = controller.run(() => controller.listen());
    assert.ok(calls.includes('resume'));
    assert.ok(calls.includes('play'));
    assert.equal(controller.state.listening, true);
    controller.stop();
    await settled(starting);
    module.resolve();
    resume.resolve();
});

test('stale worklet messages and processor errors are inert after a newer tune', async () => {
    const { controller, taps } = fixture({ worklet: () => Promise.resolve() });
    await controller.run(() => controller.listen());
    const message = taps[0].port.onmessage;
    const error = taps[0].onprocessorerror;
    controller.stop();
    await controller.run(() => controller.listen());
    const status = controller.element('radiolabStatus').textContent;
    message({ data: { type: 'pcm', channels: [Float32Array.from([.5])] } });
    message({ data: { type: 'overflow' } });
    error();
    assert.equal(controller.listening, true);
    assert.equal(controller.ring.frames, 0);
    assert.equal(controller.element('radiolabStatus').textContent, status);
    controller.stop();
});

test('a context interruption releases the stream without auto-restarting; the next gesture resumes and plays', async () => {
    const { controller, context, audios, calls } = fixture();
    await controller.run(() => controller.listen());
    context.state = 'interrupted';
    context.dispatch('statechange');
    assert.equal(controller.listening || controller.busy, false);
    assert.equal(audios[0].src, '');
    context.state = 'running';
    context.dispatch('statechange');
    assert.equal(calls.filter(call => call === 'play').length, 1);
    context.state = 'suspended';
    const starting = controller.run(() => controller.listen());
    assert.deepEqual(calls.slice(-2), ['resume', 'play']);
    await starting;
    assert.equal(controller.listening, true);
    controller.stop();
});

test('hidden-page lifecycle releases radio and requires a new gesture while retaining the finished take', async () => {
    const { controller, root, audios } = fixture();
    const take = controller.recorder;
    await controller.run(() => controller.listen());
    root.document.visibilityState = 'hidden';
    root.document.dispatch('visibilitychange');
    assert.equal(controller.listening || controller.busy, false);
    assert.equal(audios[0].src, '');
    assert.equal(controller.recorder, take);
    root.document.visibilityState = 'visible';
    root.document.dispatch('visibilitychange');
    assert.equal(controller.listening, false);
});

test('release captures its generation/account, detaches first, never blocks a newer tune and keeps a per-page token', async () => {
    const release = deferred();
    const { controller, root, audios, releases } = fixture({ release: () => release.promise });
    await controller.run(() => controller.listen());
    const first = new URL(audios[0].src);
    const client = first.searchParams.get('_radiolab_client');
    assert.match(client, /^[A-Za-z0-9_-]{16,96}$/);
    assert.equal(first.searchParams.get('_radiolab_generation'), '1');
    controller.stop();
    await controller.run(() => controller.listen());
    const second = new URL(audios[0].src);
    assert.equal(second.searchParams.get('_radiolab_client'), client);
    assert.equal(second.searchParams.get('_radiolab_generation'), '2');
    assert.equal(releases.length, 1);
    assert.equal(releases[0].source, '');
    assert.equal(releases[0].url.pathname, '/mygrain/api/radiolab/stream/release');
    assert.equal(releases[0].url.searchParams.get('_radiolab_client'), client);
    assert.equal(releases[0].url.searchParams.get('_radiolab_generation'), '1');
    assert.equal(releases[0].options.method, 'POST');
    assert.equal(releases[0].options.credentials, 'same-origin');
    assert.equal(releases[0].options.headers['X-Mygrain-User'], 'fixture-user');
    assert.equal(releases[0].options.body, '');
    root.mygrainAccounts.user.username = 'different-account';
    controller.dispose(true);
    assert.equal(releases[1].url.searchParams.get('_radiolab_generation'), '2');
    assert.equal(releases[1].url.searchParams.get('_mygrain_user'), 'fixture-user');
    assert.equal(releases[1].options.keepalive, true);
    release.reject(new Error('network unavailable during unload'));
    const otherPage = fixture();
    await otherPage.controller.run(() => otherPage.controller.listen());
    assert.notEqual(new URL(otherPage.audios[0].src).searchParams.get('_radiolab_client'), client);
    otherPage.controller.stop();
});

test('Stop before a play handshake settles still releases that generation and the next retry increments it', async () => {
    const play = deferred();
    let attempts = 0;
    const { controller, audios, releases } = fixture({ play: () => ++attempts === 1 ? play.promise : Promise.resolve() });
    const first = controller.run(() => controller.listen());
    controller.stop();
    await settled(first);
    assert.equal(releases[0].url.searchParams.get('_radiolab_generation'), '1');
    await controller.run(() => controller.listen());
    assert.equal(new URL(audios[0].src).searchParams.get('_radiolab_generation'), '2');
    play.resolve();
    controller.stop();
});

test('pagehide clears private audio and BFCache pageshow refreshes without playing or resetting the generation', async () => {
    const { controller, root, releases, calls } = fixture();
    await controller.run(() => controller.listen());
    root.dispatch('pagehide');
    assert.equal(controller.audio, null);
    assert.equal(controller.source, null);
    assert.equal(controller.ring, null);
    assert.equal(controller.recorder, null);
    assert.equal(controller.element('radiolabName').value, '');
    assert.equal(releases.length, 1);
    let refreshes = 0;
    controller.refreshStations = async () => { refreshes += 1; };
    root.dispatch('pageshow', { persisted: true });
    await Promise.resolve();
    assert.equal(refreshes, 1);
    assert.equal(controller.locked, false);
    assert.equal(controller.streamGeneration, 1);
    assert.equal(calls.filter(call => call === 'play').length, 1);
});

test('a closed context gets a fresh media/source pair rather than rebinding the previously sourced element', async () => {
    const { controller, context, audios, sources } = fixture();
    await controller.run(() => controller.listen());
    controller.stop();
    context.state = 'closed';
    const replacement = fixture().context;
    controller.adapter.getContext = () => replacement;
    await controller.run(() => controller.listen());
    assert.equal(controller.context, replacement);
    assert.equal(audios.length, 2);
    assert.equal(sources.length, 1);
    assert.equal(audios[0].src, '');
    assert.equal(audios[1].sourced, true);
    assert.equal(controller.listening, true);
    controller.stop();
});

test('suspension while worklet setup is pending cannot leave a false listening/busy state after setup', async () => {
    const module = deferred();
    const { controller, context, releases } = fixture({ worklet: () => module.promise });
    const starting = controller.run(() => controller.listen());
    await Promise.resolve();
    context.state = 'suspended';
    context.dispatch('statechange');
    module.resolve();
    await starting;
    assert.equal(controller.listening || controller.busy, false);
    assert.equal(controller.element('radiolabListen').disabled, false);
    assert.match(controller.element('radiolabStatus').textContent, /suspended.*tap/i);
    assert.equal(releases.length, 1);
});

test('twenty rapid station changes cancel every hung attempt without leaking listeners or disturbing the final tune', async () => {
    let hanging = true;
    const plays = [];
    const starting = [];
    const staleErrors = [];
    const { controller, audios, sources, timers, releases } = fixture({ play() {
        if (!hanging) return Promise.resolve();
        const play = deferred();
        plays.push(play);
        return play.promise;
    } });
    for (let index = 0; index < 20; index += 1) {
        starting.push(controller.run(() => controller.listen()));
        staleErrors.push(Array.from(audios[0].listeners.get('error'))[0]);
        controller.element('radiolabStation').value = index % 2 ? 'first' : 'second';
        controller.element('radiolabStation').dispatch('change');
        assert.equal(controller.busy, false);
    }
    hanging = false;
    await controller.run(() => controller.listen());
    const status = controller.element('radiolabStatus').textContent;
    for (let index = 0; index < plays.length; index += 1) {
        plays[index].reject(new Error('obsolete station'));
        staleErrors[index]();
    }
    await settled(Promise.all(starting));
    assert.equal(controller.listening, true);
    assert.equal(controller.element('radiolabStatus').textContent, status);
    assert.equal(controller.streamGeneration, 21);
    assert.equal(releases.length, 20);
    assert.equal(audios.length, 1);
    assert.equal(sources.length, 1);
    assert.equal(audios[0].listeners.get('error').size, 1);
    assert.equal(timers.size, 0);
    controller.stop();
    assert.equal(audios[0].listeners.get('error').size, 0);
});

function recordingBrowser() {
    const state = fixture();
    const { controller, root, context } = state;
    const requests = [];
    const confirmations = [];
    const previews = [];
    const buffers = [];
    const body = encodeWav([[Float32Array.of(.25, -.25), Float32Array.of(-.25, .25)]], 8);
    controller.samples = [
        { name: 'My named recording', filename: 'radio one + café.wav', duration: .25 },
        { name: '<img src=x onerror=alert(1)>', filename: 'radio-two.wav', duration: 1.5 }
    ];
    controller.dialog.showModal();
    controller.element('radiolabLoadTarget').value = 'V';
    root.confirm = message => { confirmations.push(message); return true; };
    root.fetch = async (url, options) => {
        requests.push({ url: new URL(url, root.location.href), options, preview: controller.preview });
        return { ok: true, arrayBuffer: async () => body, json: async () => ({ samples: controller.samples }) };
    };
    context.decodeAudioData = async () => ({ numberOfChannels: 2, sampleRate: 8, getChannelData: () => Float32Array.of(.25, -.25) });
    context.createBuffer = (channels, frames, sampleRate) => {
        const data = Array.from({ length: channels }, () => new Float32Array(frames));
        const buffer = { numberOfChannels: channels, length: frames, sampleRate,
            copyToChannel(values, channel, offset = 0) { data[channel].set(values, offset); },
            getChannelData(channel) { return data[channel]; } };
        buffers.push(buffer);
        return buffer;
    };
    context.createBufferSource = () => {
        const source = { connect() {}, start() { this.started = true; }, stop() { this.stopped = true; }, disconnect() { this.disconnected = true; } };
        previews.push(source);
        return source;
    };
    controller.renderSamples();
    return { ...state, requests, confirmations, previews, buffers, body };
}

function currentTakeBrowser() {
    const state = recordingBrowser();
    const recorder = new PCMRecorder({ sampleRate: 8 }).start(null, 0, { station: { id: 'first', name: 'First station' }, capturePath: 'server-pcm-fetch' });
    recorder.append([Float32Array.of(.125, -.25, 0), Float32Array.of(.25, -.5, 0)]);
    recorder.append([Float32Array.of(.0625, .25), Float32Array.of(.125, .375)]);
    state.controller.recorder = recorder.stop();
    state.controller.render();
    return state;
}

function interleavedPCM(body) {
    const view = new DataView(body);
    return Array.from({ length: view.getUint32(40, true) / 2 }, (_, index) => view.getInt16(44 + index * 2, true));
}

function trimmedTakeBrowser() {
    const state = currentTakeBrowser();
    const recorder = new PCMRecorder({ sampleRate: 8 }).start(null, 0, { station: { id: 'first', name: 'First station' } });
    recorder.append([Float32Array.of(1, .125, -.25), Float32Array.of(-1, -.0625, .125)]);
    recorder.append([Float32Array.of(0, .0625, -.875), Float32Array.of(0, -.125, 1)]);
    state.controller.recorder = recorder.stop();
    state.controller.setTrim('start', .125);
    state.controller.setTrim('end', .625);
    return state;
}

test('trim range controls and controller state describe exact selected frames, raw and normalized Preview', async () => {
    const { controller, buffers, previews } = trimmedTakeBrowser();
    const recorder = controller.recorder;
    const original = recorder.chunks.map(chunk => chunk.map(channel => Array.from(channel)));
    assert.equal(controller.state.recordedSeconds, .75);
    assert.equal(controller.state.trimStartSeconds, .125);
    assert.equal(controller.state.trimEndSeconds, .625);
    assert.equal(controller.state.trimmedSeconds, .5);
    assert.equal(controller.element('radiolabTrimPanel').hidden, false);
    assert.equal(controller.element('radiolabTrimPanel').disabled, false);
    assert.equal(controller.element('radiolabTrimStart').step, '0.125');
    assert.equal(controller.element('radiolabTrimStartValue').textContent, '0.125 s');
    assert.equal(controller.element('radiolabTrimEndValue').textContent, '0.625 s');
    assert.equal(controller.element('radiolabTrimDuration').textContent, 'Selected: 0.500 s');
    await controller.run(() => controller.previewCurrentTake());
    assert.equal(buffers.at(-1).length, 4);
    assert.equal(buffers.at(-1).sampleRate, 8);
    assert.deepEqual(Array.from(buffers.at(-1).getChannelData(0)), [.125, -.25, 0, .0625]);
    assert.deepEqual(Array.from(buffers.at(-1).getChannelData(1)), [-.0625, .125, 0, -.125]);
    controller.normalizeTake();
    assert.equal(previews.at(-1).stopped, true);
    await controller.run(() => controller.previewCurrentTake());
    assert.deepEqual(Array.from(buffers.at(-1).getChannelData(0)), [.5, -1, 0, .25]);
    assert.deepEqual(Array.from(buffers.at(-1).getChannelData(1)), [-.25, .5, 0, -.5]);
    controller.element('radiolabTrimStart').value = '.25';
    controller.element('radiolabTrimStart').dispatch('input');
    assert.equal(previews.at(-1).stopped, true);
    assert.equal(controller.state.previewingTake, false);
    assert.equal(controller.state.normalized, false);
    assert.equal(controller.state.trimmedSeconds, .375);
    assert.deepEqual(recorder.chunks.map(chunk => chunk.map(channel => Array.from(channel))), original);
    controller.element('radiolabTrimReset').dispatch('click');
    assert.equal(controller.state.trimStartSeconds, 0);
    assert.equal(controller.state.trimEndSeconds, .75);
    assert.equal(controller.state.normalized, false);
});

test('trim Save excludes loud removed samples, normalizes linked stereo, and retries byte-identically without editing original chunks', async () => {
    const { controller, root } = trimmedTakeBrowser();
    const recorder = controller.recorder;
    const references = recorder.chunks.flat();
    const original = recorder.chunks.map(chunk => chunk.map(channel => Array.from(channel)));
    const uploads = [];
    root.fetch = async (url, options) => {
        uploads.push(options.body);
        return { ok: uploads.length > 1, status: 503, json: async () => uploads.length > 1 ? { sample: { name: 'Selected take' } } : { error: 'Retry selected take' } };
    };
    for (let attempt = 0; attempt < 3; attempt += 1) await controller.run(() => controller.save());
    assert.equal(uploads.length, 3);
    assert.equal(uploads[0].byteLength, 60);
    assert.deepEqual(interleavedPCM(uploads[0]), [16384, -8192, -32768, 16384, 0, 0, 8192, -16384]);
    assert.deepEqual(uploads[0], uploads[1]);
    assert.deepEqual(uploads[1], uploads[2]);
    assert.equal(recorder.normalizationGain, 4);
    assert.equal(controller.state.normalized, true);
    assert.ok(recorder.chunks.flat().every((channel, index) => channel === references[index]));
    assert.deepEqual(recorder.chunks.map(chunk => chunk.map(channel => Array.from(channel))), original);
    controller.setTrim('reset');
    assert.equal(controller.state.normalized, false);
    await controller.run(() => controller.save());
    assert.equal(uploads.at(-1).byteLength, 68);
    assert.equal(recorder.normalizationGain, 1);
    controller.setTrim('start', .125);
    controller.setTrim('end', .625);
    await controller.run(() => controller.save());
    assert.deepEqual(uploads.at(-1), uploads[0]);
});

for (const kind of ['silent', 'empty']) test(`${kind} trim selection disables and rejects Preview, Normalize and Save without upload`, async () => {
    const { controller, root, previews } = trimmedTakeBrowser();
    controller.recorder.setTrimFrames(3, kind === 'empty' ? 3 : 4);
    controller.render();
    for (const id of ['radiolabPreview', 'radiolabNormalize', 'radiolabSave']) assert.equal(controller.element(id).disabled, true);
    let uploads = 0;
    root.fetch = async () => { uploads += 1; };
    await assert.rejects(controller.previewCurrentTake(), /non-empty, audible/);
    assert.throws(() => controller.normalizeTake(), /non-empty, audible/);
    await assert.rejects(controller.save(), /non-empty, audible/);
    assert.equal(uploads, 0);
    assert.equal(previews.length, 0);
    assert.equal(controller.recorder.normalized, false);
    assert.equal(controller.recorder.frames, 6);
    controller.setTrim('reset');
    assert.equal(controller.element('radiolabSave').disabled, false);
});

for (const action of ['stop', 'station', 'cancel-record', 'failed-record']) test(`selected normalized take and original samples survive ${action}`, async () => {
    const state = trimmedTakeBrowser();
    const { controller, root } = state;
    controller.normalizeTake();
    const recorder = controller.recorder;
    const selected = recorder.wav();
    if (action === 'stop') controller.stop();
    if (action === 'station') controller.element('radiolabStation').dispatch('change');
    if (action === 'cancel-record') {
        captureTransport(state);
        await controller.run(() => controller.record());
        assert.equal(controller.element('radiolabTrimPanel').disabled, true);
        controller.stop();
    }
    if (action === 'failed-record') {
        root.fetch = async () => ({ ok: false, status: 503 });
        await controller.run(() => controller.record());
    }
    assert.equal(controller.recorder, recorder);
    assert.equal(controller.state.normalized, true);
    assert.equal(controller.state.trimStartSeconds, .125);
    assert.equal(controller.state.trimEndSeconds, .625);
    assert.deepEqual(recorder.wav(), selected);
    assert.deepEqual(Array.from(recorder.chunks[0][0]), [1, .125, -.25]);
});

test('first genuine new recording PCM resets selection; pending failure retains selection', async () => {
    const state = trimmedTakeBrowser();
    const { controller } = state;
    const transports = captureTransport(state);
    const previous = controller.recorder;
    const references = previous.chunks.flat();
    await controller.run(() => controller.record());
    assert.equal(controller.state.trimStartSeconds, .125);
    await deliverCapture(transports.at(-1));
    assert.notEqual(controller.recorder, previous);
    assert.equal(controller.state.trimStartSeconds, 0);
    assert.equal(controller.state.trimEndSeconds, controller.state.recordedSeconds);
    assert.equal(controller.state.normalized, false);
    assert.equal(controller.element('radiolabTrimPanel').hidden, true);
    assert.ok(references.every(channel => channel.every(value => value === 0)));
    controller.stop();
    assert.equal(controller.element('radiolabTrimPanel').hidden, false);
    assert.equal(controller.state.trimmedSeconds, controller.state.recordedSeconds);
});

for (const action of ['account', 'dispose', 'wrong-user', 'busy']) test(`trim controls preserve account and action guards during ${action}`, () => {
    const { controller, root } = trimmedTakeBrowser();
    const recorder = controller.recorder;
    const channels = recorder.chunks.flat();
    recorder.envelope();
    if (action === 'account') root.dispatch('mygrain-account-lock');
    if (action === 'dispose') controller.dispose(false);
    if (action === 'wrong-user') root.mygrainAccounts.user.username = 'different-user';
    if (action === 'busy') controller.busy = true;
    controller.element('radiolabTrimReset').dispatch('click');
    controller.setTrim('end', .375);
    if (action === 'account' || action === 'dispose') {
        assert.equal(controller.recorder, null);
        assert.equal(controller.state.trimStartSeconds, 0);
        assert.equal(controller.state.trimEndSeconds, 0);
        assert.equal(controller.element('radiolabTrimPanel').hidden, true);
        assert.equal(recorder.waveform, null);
        assert.equal(recorder.selection, null);
        assert.ok(channels.every(channel => channel.every(value => value === 0)));
    } else {
        assert.equal(controller.state.trimStartSeconds, .125);
        assert.equal(controller.state.trimEndSeconds, .625);
    }
});

function waveformFixture() {
    const state = trimmedTakeBrowser();
    const { controller, root } = state;
    const canvas = controller.element('radiolabWaveform');
    const paints = [];
    const drawing = Object.fromEntries(['setTransform', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillRect'].map(method => [method, (...args) => paints.push({ method, args })]));
    let width = 300;
    canvas.getContext = () => drawing;
    canvas.getBoundingClientRect = () => ({ left: 10, width, height: 120 });
    canvas.setPointerCapture = identifier => { canvas.captured = identifier; };
    canvas.hasPointerCapture = identifier => canvas.captured === identifier;
    canvas.releasePointerCapture = () => { canvas.captured = null; };
    root.devicePixelRatio = 2;
    const observers = [];
    root.ResizeObserver = class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(element) { this.element = element; }
        disconnect() { this.disconnected = true; }
    };
    controller.render();
    return { ...state, canvas, paints, observers, setWidth(value) { width = value; } };
}

test('waveform caches min/max summaries and skips unchanged paints, redraws selection, normalization, resize and DPR, and clears on disposal', () => {
    const { controller, root, canvas, paints, observers, setWidth } = waveformFixture();
    assert.equal(canvas.width, 600);
    assert.equal(canvas.height, 240);
    assert.equal(observers.length, 1);
    assert.equal(observers[0].element, canvas);
    assert.ok(paints.some(call => call.method === 'fillRect' && call.args[2] === 50));
    const envelope = controller.recorder.envelope();
    const count = paints.length;
    controller.render();
    controller.drawWaveform();
    assert.equal(paints.length, count);
    controller.setTrim('start', .25);
    assert.ok(paints.length > count);
    assert.equal(controller.recorder.envelope(), envelope);
    const rawPaints = paints.length;
    controller.normalizeTake();
    assert.ok(paints.length > rawPaints);
    setWidth(500);
    observers[0].callback();
    assert.equal(canvas.width, 1000);
    root.devicePixelRatio = 3;
    root.dispatch('resize');
    assert.equal(canvas.width, 1500);
    assert.equal(canvas.height, 360);
    controller.dispose(false);
    assert.equal(observers[0].disconnected, true);
    assert.equal(controller.waveformObserver, null);
    assert.equal(controller.waveformPaint, null);
    assert.equal(paints.at(-1).method, 'clearRect');
});

for (const pointerType of ['mouse', 'touch']) test(`${pointerType} waveform handles clamp exactly, capture dragging, and release cancellation`, () => {
    const { controller, canvas } = waveformFixture();
    const event = (clientX, extra = {}) => ({ pointerId: 7, pointerType, button: 0, clientX, preventDefault() {}, ...extra });
    canvas.dispatch('pointerdown', event(60));
    assert.equal(canvas.captured, 7);
    canvas.dispatch('pointermove', event(110));
    assert.equal(controller.recorder.trimStartFrame, 2);
    canvas.dispatch('pointermove', event(-500));
    assert.equal(controller.recorder.trimStartFrame, 0);
    canvas.dispatch('pointermove', event(1000));
    assert.equal(controller.recorder.trimStartFrame, 4);
    assert.equal(controller.recorder.selectedFrames, 1);
    canvas.dispatch('pointercancel', event(1000));
    assert.equal(canvas.captured, null);
    assert.equal(controller.trimPointer, null);
    canvas.dispatch('pointerdown', event(260));
    canvas.dispatch('pointermove', event(1000));
    assert.equal(controller.recorder.endFrame, 6);
    canvas.dispatch('pointerup', event(1000));
    assert.equal(controller.trimPointer, null);
    canvas.dispatch('pointermove', event(0));
    assert.equal(controller.recorder.endFrame, 6);
});

for (const action of ['account', 'record', 'save']) test(`waveform releases active pointer capture before ${action} and cannot apply stale dragging`, async () => {
    const state = waveformFixture();
    const { controller, canvas, root } = state;
    canvas.dispatch('pointerdown', { pointerId: 9, button: 0, clientX: 60, preventDefault() {} });
    assert.equal(canvas.captured, 9);
    if (action === 'account') root.dispatch('mygrain-account-lock');
    if (action === 'record') {
        captureTransport(state);
        await controller.run(() => controller.record());
    }
    if (action === 'save') await controller.run(() => controller.save());
    assert.equal(controller.trimPointer, null);
    assert.equal(canvas.captured, null);
    canvas.dispatch('pointermove', { pointerId: 9, clientX: 200, preventDefault() {} });
    if (action !== 'account') assert.equal(controller.recorder.trimStartFrame, 1);
    controller.stop();
});

test('current take Preview plays raw chunks then current normalized PCM, ducks only monitoring and naturally resets labels', async () => {
    const { controller, previews, buffers, audios } = currentTakeBrowser();
    await controller.listen();
    const recorder = controller.recorder;
    const metadata = recorder.metadata;
    const source = controller.source;
    assert.equal(controller.monitorGain.gain.value, .8);
    await controller.run(() => controller.previewCurrentTake());
    assert.equal(controller.state.previewingTake, true);
    assert.equal(controller.state.normalized, false);
    assert.equal(controller.element('radiolabPreview').textContent, 'Stop Preview');
    assert.equal(controller.element('radiolabPreview').disabled, false);
    assert.equal(controller.monitorGain.gain.value, 0);
    assert.deepEqual(Array.from(buffers[0].getChannelData(0)), [.125, -.25, 0, .0625, .25]);
    assert.deepEqual(Array.from(buffers[0].getChannelData(1)), [.25, -.5, 0, .125, .375]);
    assert.equal(buffers[0].length, 5);
    assert.equal(buffers[0].sampleRate, 8);
    controller.element('radiolabPreview').dispatch('click');
    assert.equal(previews[0].stopped, true);
    assert.equal(controller.state.previewingTake, false);
    assert.equal(controller.listening, true);
    assert.equal(audios[0].paused, false);
    assert.equal(controller.source, source);
    assert.equal(source.disconnected, undefined);
    assert.equal(controller.recorder, recorder);
    assert.equal(controller.monitorGain.gain.value, .8);
    await controller.run(() => controller.previewCurrentTake());
    controller.normalizeTake();
    assert.equal(previews[1].stopped, true);
    assert.equal(controller.state.normalized, true);
    assert.equal(controller.element('radiolabNormalize').textContent, 'Normalized');
    assert.equal(controller.element('radiolabNormalize').disabled, true);
    assert.match(controller.element('radiolabTake').textContent, /Normalized: peak 1.0/);
    assert.equal(controller.recorder.metadata, metadata);
    await controller.run(() => controller.previewCurrentTake());
    assert.deepEqual(Array.from(buffers[2].getChannelData(0)), [.25, -.5, 0, .125, .5]);
    assert.deepEqual(Array.from(buffers[2].getChannelData(1)), [.5, -1, 0, .25, .75]);
    previews[2].onended();
    assert.equal(controller.state.previewing, false);
    assert.equal(controller.state.previewingTake, false);
    assert.equal(controller.element('radiolabPreview').textContent, 'Preview');
    assert.equal(controller.element('radiolabPreview').attributes['aria-pressed'], 'false');
    assert.equal(controller.monitorGain.gain.value, .8);
    assert.equal(controller.listening, true);
    controller.stop();
});

test('Save auto-normalizes the exact stereo WAV payload; failure and unconfirmed Save retain it for byte-identical retries', async () => {
    const { controller, previews, root, buffers } = currentTakeBrowser();
    const recorder = controller.recorder;
    const chunks = recorder.chunks;
    const metadata = recorder.metadata;
    const uploads = [];
    const originalFetch = root.fetch;
    let attempt = 0;
    root.fetch = async (url, options) => {
        if (options.method !== 'POST') return originalFetch(url, options);
        uploads.push(options.body);
        attempt += 1;
        if (attempt === 1) return { ok: false, status: 503, json: async () => ({ error: 'Fixture storage unavailable' }) };
        return { ok: true, json: async () => attempt === 2 ? {} : { sample: { name: 'Saved take' } } };
    };
    await controller.run(() => controller.previewCurrentTake());
    await controller.run(() => controller.save());
    assert.match(controller.element('radiolabStatus').textContent, /Fixture storage unavailable/);
    assert.equal(previews[0].stopped, true);
    assert.equal(controller.state.normalized, true);
    assert.equal(controller.recorder, recorder);
    assert.equal(recorder.chunks, chunks);
    assert.equal(recorder.metadata, metadata);
    assert.equal(recorder.frames, 5);
    assert.equal(controller.element('radiolabSave').disabled, false);
    assert.deepEqual(interleavedPCM(uploads[0]), [8192, 16384, -16384, -32768, 0, 0, 4096, 8192, 16384, 24575]);
    assert.equal(new DataView(uploads[0]).getUint16(22, true), 2);
    assert.equal(new DataView(uploads[0]).getUint32(24, true), 8);
    await controller.run(() => controller.save());
    assert.match(controller.element('radiolabStatus').textContent, /did not confirm/);
    controller.normalizeTake();
    await controller.run(() => controller.save());
    assert.match(controller.element('radiolabStatus').textContent, /Saved “Saved take”/);
    assert.equal(uploads.length, 3);
    assert.deepEqual(uploads[0], uploads[1]);
    assert.deepEqual(uploads[1], uploads[2]);
    assert.equal(controller.state.normalized, true);
    await controller.run(() => controller.previewCurrentTake());
    assert.deepEqual(Array.from(buffers.at(-1).getChannelData(1)), [.5, -1, 0, .25, .75]);
    controller.stopPreview();
});

test('main and saved-row previews share a single source without changing existing saved payloads or load targets', async () => {
    const { controller, previews, body, buffers } = currentTakeBrowser();
    const savedBody = body.slice(0);
    await controller.run(() => controller.playSample(controller.samples[0]), true);
    const staleEnded = previews[0].onended;
    await controller.run(() => controller.previewCurrentTake());
    assert.equal(previews[0].stopped, true);
    assert.equal(controller.previewFilename, null);
    assert.equal(controller.state.previewingTake, true);
    staleEnded();
    assert.equal(previews[1].stopped, undefined);
    controller.normalizeTake();
    await controller.run(() => controller.previewCurrentTake());
    await controller.run(() => controller.playSample(controller.samples[1]), true);
    assert.equal(previews[2].stopped, true);
    assert.equal(controller.state.previewingTake, false);
    assert.equal(controller.previewFilename, controller.samples[1].filename);
    assert.deepEqual(Array.from(buffers.at(-1).getChannelData(0)), [.25, -.25]);
    assert.deepEqual(body, savedBody);
    assert.equal(controller.element('radiolabLoadTarget').value, 'V');
    assert.equal(controller.state.normalized, true);
    controller.stopPreview();
});

test('Stop Preview cancels a pending current-take resume, releases busy immediately and cannot finish a newer action', async () => {
    const { controller, previews } = currentTakeBrowser();
    const pending = deferred();
    const context = controller.context;
    controller.ensureContext = () => pending.promise;
    const playing = controller.run(() => controller.previewCurrentTake());
    assert.equal(controller.busy, true);
    assert.equal(controller.state.previewingTake, true);
    assert.equal(controller.element('radiolabPreview').disabled, false);
    controller.element('radiolabPreview').dispatch('click');
    assert.equal(controller.busy, false);
    assert.equal(controller.state.previewingTake, false);
    const newer = deferred();
    const saving = controller.run(() => newer.promise);
    pending.resolve(context);
    await playing;
    assert.equal(controller.busy, true);
    assert.equal(previews.length, 0);
    newer.resolve();
    await saving;
    assert.equal(controller.busy, false);
});

for (const action of ['stop', 'normalize', 'record', 'station', 'account', 'dispose', 'save', 'trim']) test(`pending current-take Preview cannot play after ${action}`, async () => {
    const state = currentTakeBrowser();
    const { controller, root, context, previews } = state;
    const pending = deferred();
    const transports = captureTransport(state);
    controller.ensureContext = () => pending.promise;
    const playing = controller.run(() => controller.previewCurrentTake());
    const recorder = controller.recorder;
    if (action === 'stop') controller.stop();
    if (action === 'normalize') controller.normalizeTake();
    if (action === 'trim') controller.setTrim('start', 1 / recorder.sampleRate);
    if (action === 'record') await controller.record();
    if (action === 'station') controller.element('radiolabStation').dispatch('change');
    if (action === 'account') root.dispatch('mygrain-account-lock');
    if (action === 'dispose') controller.dispose(false);
    if (action === 'save') await assert.rejects(controller.save(), /did not confirm/);
    pending.resolve(context);
    await playing;
    assert.equal(previews.length, 0);
    assert.equal(controller.state.previewingTake, false);
    if (action !== 'account' && action !== 'dispose') {
        assert.equal(controller.recorder, recorder);
        assert.equal(recorder.frames, 5);
    } else {
        assert.equal(controller.recorder, null);
        assert.equal(controller.state.normalized, false);
    }
    if (transports.length) controller.stop();
});

test('failed current preview reports an error and recovers controls without clearing or normalizing the take', async () => {
    const { controller, context } = currentTakeBrowser();
    const recorder = controller.recorder;
    controller.ensureContext = async () => { throw new Error('Fixture audio resume denied'); };
    await controller.run(() => controller.previewCurrentTake());
    assert.match(controller.element('radiolabStatus').textContent, /audio resume denied/);
    assert.equal(controller.busy, false);
    assert.equal(controller.state.previewingTake, false);
    assert.equal(controller.state.normalized, false);
    assert.equal(controller.recorder, recorder);
    assert.equal(controller.element('radiolabPreview').disabled, false);
    controller.ensureContext = async () => context;
    context.createBufferSource = () => ({ connect() {}, disconnect() {}, stop() {}, start() { throw new Error('Fixture source denied'); } });
    await controller.run(() => controller.previewCurrentTake());
    assert.match(controller.element('radiolabStatus').textContent, /source denied/);
    assert.equal(controller.state.previewing, false);
    assert.equal(controller.state.previewingTake, false);
    assert.equal(controller.recorder, recorder);
});

test('cancelled and failed new Record retain a normalized take; first genuine new PCM resets normalization', async () => {
    const state = currentTakeBrowser();
    const { controller, root } = state;
    const transports = captureTransport(state);
    controller.normalizeTake();
    const recorder = controller.recorder;
    const normalized = recorder.wav();
    await controller.run(() => controller.record());
    assert.equal(controller.element('radiolabPreview').disabled, true);
    assert.equal(controller.element('radiolabNormalize').disabled, true);
    assert.equal(controller.element('radiolabSave').disabled, true);
    await assert.rejects(controller.previewCurrentTake(), /Stop a non-empty/);
    assert.throws(() => controller.normalizeTake(), /Stop a non-empty/);
    await assert.rejects(controller.save(), /Stop recording/);
    controller.stop();
    assert.equal(controller.state.normalized, true);
    assert.equal(controller.recorder, recorder);
    const fetch = root.fetch;
    root.fetch = async () => ({ ok: false, status: 429 });
    await controller.run(() => controller.record());
    assert.equal(controller.state.normalized, true);
    assert.deepEqual(recorder.wav(), normalized);
    root.fetch = fetch;
    await controller.run(() => controller.record());
    await deliverCapture(transports.at(-1));
    assert.equal(controller.state.recording, true);
    assert.equal(controller.state.normalized, false);
    assert.notEqual(controller.recorder, recorder);
    assert.equal(controller.element('radiolabPreview').disabled, true);
    assert.equal(controller.element('radiolabNormalize').disabled, true);
    controller.stop();
    assert.equal(controller.element('radiolabPreview').disabled, false);
    assert.equal(controller.element('radiolabNormalize').disabled, false);
});

test('current-take controls are disabled for locked, busy, empty, active and digitally silent states', async () => {
    for (const mode of ['locked', 'busy', 'empty', 'active', 'silent']) {
        const { controller } = currentTakeBrowser();
        if (mode === 'locked') controller.locked = true;
        if (mode === 'busy') controller.busy = true;
        if (mode === 'empty') controller.recorder = null;
        if (mode === 'active') controller.recorder.state = 'recording';
        if (mode === 'silent') {
            controller.recorder.clear();
            controller.recorder.start(null).append([Float32Array.of(0, NaN, Infinity)]);
            controller.recorder.stop();
        }
        controller.render();
        for (const control of ['radiolabPreview', 'radiolabNormalize', 'radiolabSave']) assert.equal(controller.element(control).disabled, true, `${mode}: ${control}`);
        if (mode !== 'busy') {
            await assert.rejects(controller.previewCurrentTake());
            assert.throws(() => controller.normalizeTake());
        }
    }
});

test('private recordings render separate named cards with explicit, accessible row actions and no selected-sample state', () => {
    const { controller } = recordingBrowser();
    const list = controller.element('radiolabSampleList');
    assert.equal(list.children.length, 2);
    for (const sample of controller.samples) {
        const controls = controller.sampleRows.get(sample.filename);
        assert.equal(controls.row.dataset.filename, sample.filename);
        assert.match(controls.row.className, /radiolab-sample-row/);
        assert.equal(controls.row.children[0].textContent, sample.name);
        assert.match(controls.row.children[1].textContent, new RegExp(sample.duration.toFixed(2) + 's'));
        for (const action of ['play', 'load', 'delete']) {
            assert.equal(controls[action].dataset.action, action);
            assert.ok(controls[action].attributes['aria-label'].includes(sample.filename));
        }
        assert.equal(controls.load.attributes['aria-label'], `Load ${sample.filename} into V`);
    }
    controller.samples = [];
    controller.renderSamples();
    assert.equal(controller.sampleRows.size, 0);
    assert.match(list.children[0].textContent, /No saved radio recordings/);
});

test('row Play toggles only that file to Stop; natural end and explicit Stop release the preview without touching capture', async () => {
    const { controller, previews } = recordingBrowser();
    const [first, second] = controller.samples;
    await controller.run(() => controller.playSample(first), true);
    assert.equal(previews[0].started, true);
    assert.equal(previews[0].loop, false);
    assert.equal(controller.sampleRows.get(first.filename).play.textContent, 'Stop');
    assert.equal(controller.sampleRows.get(second.filename).play.textContent, 'Play');
    controller.sampleRows.get(first.filename).play.dispatch('click');
    assert.equal(previews[0].stopped && previews[0].disconnected, true);
    assert.equal(controller.previewFilename, null);
    await controller.run(() => controller.playSample(second), true);
    previews[1].onended();
    assert.equal(controller.sampleRows.get(second.filename).play.textContent, 'Play');
    assert.equal(controller.recorder.state, 'stopped');
});

for (const target of ['V', 'grainMain', 'grainA', 'grainB']) test(`row Load uses complete original bytes and chosen ${target} without playback`, async () => {
    const { controller, body, previews, requests } = recordingBrowser();
    controller.element('radiolabLoadTarget').value = target;
    const sample = controller.samples[1];
    let loaded = false;
    controller.adapter.load = async (bytes, source, selectedTarget, guard) => {
        guard();
        assert.equal(bytes, body);
        assert.equal(source, sample);
        assert.equal(selectedTarget, target);
        loaded = true;
    };
    await controller.run(() => controller.loadSample(sample), true);
    assert.equal(loaded, true);
    assert.equal(previews.length, 0);
    assert.equal(requests[0].url.searchParams.get('name'), sample.filename);
    assert.match(controller.element('radiolabBrowserStatus').textContent, /Playback was not started/);
});

test('Delete confirms the exact filename, cancellation sends nothing, then stops only the matching preview before authenticated deletion', async () => {
    const { controller, root, requests, previews, confirmations } = recordingBrowser();
    const sample = controller.samples[0];
    await controller.run(() => controller.playSample(sample), true);
    root.confirm = () => false;
    await controller.run(() => controller.deleteSample(sample), true);
    assert.equal(requests.length, 1);
    assert.equal(previews[0].stopped, undefined);
    root.confirm = message => { confirmations.push(message); return true; };
    await controller.run(() => controller.deleteSample(sample), true);
    assert.ok(confirmations[0].includes(sample.filename));
    const deletion = requests[1];
    assert.equal(deletion.preview, null);
    assert.equal(previews[0].stopped, true);
    assert.equal(deletion.options.method, 'DELETE');
    assert.equal(deletion.options.credentials, 'same-origin');
    assert.equal(deletion.url.pathname, '/mygrain/api/radiolab/samples');
    assert.equal(deletion.url.searchParams.get('name'), sample.filename);
    assert.equal(controller.samples.length, 1);
    assert.equal(controller.sampleRows.has(sample.filename), false);
    assert.equal(root.document.activeElement, controller.sampleRows.get(controller.samples[0].filename).delete);
});

test('Delete failure retains the card and reports the error; deleting a different file does not stop the playing row', async () => {
    const { controller, root, previews } = recordingBrowser();
    await controller.run(() => controller.playSample(controller.samples[0]), true);
    root.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'Fixture deletion failed' }) });
    await controller.run(() => controller.deleteSample(controller.samples[1]), true);
    assert.equal(controller.samples.length, 2);
    assert.equal(controller.sampleRows.size, 2);
    assert.equal(previews[0].stopped, undefined);
    assert.equal(controller.busy, false);
    assert.match(controller.element('radiolabBrowserStatus').textContent, /Fixture deletion failed/);
});

test('row Stop aborts a pending preview, permits a new action immediately, and ignores its late fetch response', async () => {
    const { controller, root, body, previews } = recordingBrowser();
    const pending = deferred();
    let signal;
    root.fetch = (url, options) => { signal = options.signal; return pending.promise; };
    const playing = controller.run(() => controller.playSample(controller.samples[0]), true);
    await Promise.resolve();
    assert.equal(controller.busy, true);
    const stop = controller.sampleRows.get(controller.samples[0].filename).play;
    assert.equal(stop.disabled, false);
    stop.dispatch('click');
    assert.equal(signal.aborted, true);
    assert.equal(controller.busy, false);
    const newer = deferred();
    const loading = controller.run(() => newer.promise, true);
    pending.resolve({ ok: true, arrayBuffer: async () => body });
    await playing;
    assert.equal(controller.busy, true);
    assert.equal(previews.length, 0);
    newer.resolve();
    await loading;
    assert.equal(controller.busy, false);
});

for (const action of ['refresh', 'play', 'load', 'delete']) test(`dialog close aborts stale ${action} response without repopulating UI or overriding a reopened browser`, async () => {
    const { controller, root, body, previews } = recordingBrowser();
    const pending = deferred();
    let signal;
    let loads = 0;
    root.fetch = (url, options) => { signal = options.signal; return pending.promise; };
    controller.adapter.load = async () => { loads += 1; };
    const sample = controller.samples[0];
    const old = controller.run(() => action === 'refresh' ? controller.refreshSamples() : action === 'play' ? controller.playSample(sample) : action === 'load' ? controller.loadSample(sample) : controller.deleteSample(sample), true);
    await Promise.resolve();
    controller.dialog.close();
    assert.equal(signal.aborted, true);
    assert.equal(controller.busy, false);
    controller.dialog.showModal();
    controller.samples = [{ filename: 'new-session.wav', name: 'New browser state' }];
    controller.renderSamples();
    controller.element('radiolabBrowserStatus').textContent = 'New browser status';
    pending.resolve({ ok: true, arrayBuffer: async () => body, json: async () => ({ samples: [sample] }) });
    await old;
    assert.equal(previews.length + loads, 0);
    assert.equal(controller.samples[0].filename, 'new-session.wav');
    assert.equal(controller.element('radiolabBrowserStatus').textContent, 'New browser status');
});

test('closing during Load adapter decode invalidates its guard before any sample is applied', async () => {
    const { controller } = recordingBrowser();
    const entered = deferred();
    const decoded = deferred();
    let applied = false;
    controller.adapter.load = async (body, sample, target, guard) => { entered.resolve(); await decoded.promise; guard(); applied = true; };
    const loading = controller.run(() => controller.loadSample(controller.samples[0]), true);
    await entered.promise;
    controller.dialog.close();
    decoded.resolve();
    await loading;
    assert.equal(applied, false);
    assert.equal(controller.busy, false);
});

for (const phase of ['fetch', 'decode']) test(`account lock clears private rows and rejects late preview ${phase} without reviving audio`, async () => {
    const { controller, root, body, context, previews } = recordingBrowser();
    const pending = deferred();
    const entered = deferred();
    if (phase === 'fetch') root.fetch = () => { entered.resolve(); return pending.promise; };
    else context.decodeAudioData = () => { entered.resolve(); return pending.promise; };
    const playing = controller.run(() => controller.playSample(controller.samples[0]), true);
    await entered.promise;
    root.mygrainAccounts = { authenticated: true, user: { username: 'different-account' } };
    root.dispatch('mygrain-account-lock');
    if (phase === 'fetch') pending.resolve({ ok: true, arrayBuffer: async () => body });
    else pending.resolve({ numberOfChannels: 2, sampleRate: 8, getChannelData: () => Float32Array.of(.25) });
    await playing;
    assert.equal(controller.locked, true);
    assert.equal(controller.dialog.open, false);
    assert.equal(controller.samples.length + controller.sampleRows.size, 0);
    assert.equal(controller.element('radiolabSampleList').children.length, 0);
    assert.equal(previews.length, 0);
});

for (const monitoring of [false, true]) test(`twelve repeated Record/Stop takes release every capture generation with monitoring ${monitoring ? 'on' : 'off'}`, async () => {
    const state = fixture();
    const { controller, releases, timers } = state;
    const transports = captureTransport(state);
    const generations = new Set();
    for (let index = 0; index < 12; index += 1) {
        if (monitoring) await controller.listen();
        await controller.run(() => controller.record());
        await deliverCapture(transports[index]);
        const operation = controller.captureOperation;
        generations.add(operation.generation);
        assert.equal(controller.state.recording, true);
        controller.stop();
        assert.equal(transports[index].cancelled, true);
        assert.equal(controller.recorder.state, 'stopped');
        assert.equal(controller.recorder.frames, 1);
        assert.equal(controller.state.recordedSeconds, 1 / 44100);
        assert.equal(controller.state.rewindSeconds, 0);
        assert.equal(timers.size, 0);
        const release = releases.find(item => item.url.searchParams.get('_radiolab_client') === operation.client && item.url.searchParams.get('_radiolab_generation') === String(operation.generation));
        assert.ok(release);
        assert.equal(release.options.method, 'POST');
    }
    assert.equal(generations.size, 12);
    assert.equal(releases.length, monitoring ? 24 : 12);
    assert.equal(controller.busy, false);
});
