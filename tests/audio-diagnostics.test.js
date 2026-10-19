const test = require('node:test');
const assert = require('node:assert/strict');
const diagnostics = require('../audio-diagnostics');

test('persistence hooks receive fault events and samples without adding another timer', () => {
    const events = [];
    let samples = 0;
    const setup = fixture({ monitor: { onEvent: entry => events.push(entry.type), onSample: () => { samples += 1; } } });
    setup.monitor.start();
    setup.advance(1600);
    assert.ok(events.includes('main-thread-delay'));
    assert.equal(samples, 2);
    assert.equal(setup.timers.size, 1);
});

test('failed persistence hooks cannot stop the audio diagnostic probe', () => {
    const setup = fixture({ monitor: { onEvent: () => { throw new Error('storage failed'); }, onSample: () => { throw new Error('storage failed'); } } });
    setup.monitor.start();
    setup.advance();
    assert.equal(setup.monitor.snapshot().timing.samples, 2);
    assert.equal(setup.timers.size, 1);
});

function eventTarget(extra = {}) {
    const listeners = new Map();
    return { ...extra, listeners,
        addEventListener(type, callback) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(callback);
        },
        removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
        emit(type, details = {}) { for (const callback of [...(listeners.get(type) || [])]) callback({ type, ...details }); }
    };
}

function fixture(options = {}) {
    let instant = 0;
    let context = eventTarget({ state: 'running', currentTime: 0, sampleRate: 48000, baseLatency: .01,
        destination: { channelCount: 2, maxChannelCount: 2 } });
    const timers = new Map();
    let serial = 0;
    let stateReads = 0;
    const host = eventTarget({ document: eventTarget({ visibilityState: 'visible', hasFocus: () => true }),
        navigator: { userAgent: 'iPhone OS 26_0 Version/26.0 Safari/605.1.15', platform: 'iPhone', maxTouchPoints: 5 },
        performance: { now: () => instant },
        setInterval(callback, interval) { assert.equal(interval, 1000); timers.set(++serial, callback); return serial; },
        clearInterval(id) { timers.delete(id); }
    });
    Object.assign(host, options.host);
    const monitor = diagnostics.createMonitor({ host, now: () => instant, wallNow: () => 1792076400000 + instant,
        build: 'DIAG-test', getContext: () => context, getState: detail => {
            stateReads += 1;
            return { counts: { xVoices: 3 }, caches: { oscillatorWaves: 128 }, scheduling: { skippedSteps: 4 },
                playback: { activeLayers: ['X'] }, detail };
        }, ...options.monitor });
    return { host, monitor, timers, get context() { return context; }, set context(value) { context = value; },
        get stateReads() { return stateReads; },
        advance(milliseconds = 1000, audioSeconds = milliseconds / 1000) {
            instant += milliseconds;
            if (context) context.currentTime += audioSeconds;
            for (const callback of timers.values()) callback();
        }
    };
}

test('reported iOS/Safari, standalone mode, activation and viewport are captured without guessing a model', () => {
    const environment = diagnostics.describeEnvironment({ navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) Version/26.1 Mobile Safari/604.1',
        platform: 'iPhone', standalone: true, maxTouchPoints: 5 }, innerWidth: 390, innerHeight: 844,
        document: { visibilityState: 'visible', hasFocus: () => true } });
    assert.equal(environment.reportedIOS, '26.1');
    assert.equal(environment.reportedBrowserVersion, 'Version 26.1');
    assert.equal(environment.appleMobile, true);
    assert.equal(environment.standalone, true);
    assert.equal(environment.viewport.width, 390);
    assert.equal(environment.deviceMemoryGB, null);
    assert.ok(environment.unavailable.includes('Exact iPhone model'));
});

test('desktop-style iPad user agents are identified without inventing an iOS version', () => {
    const environment = diagnostics.describeEnvironment({ navigator: { userAgent: 'Macintosh Version/26.0 Safari', platform: 'MacIntel', maxTouchPoints: 5 } });
    assert.equal(environment.appleMobile, true);
    assert.equal(environment.reportedIOS, 'not reported in user agent');
    assert.equal(environment.audioSession.available, false);
});

test('unavailable memory is explicit and browser heap is never labelled as native/device RAM', () => {
    assert.equal(diagnostics.describeHeap({}).available, false);
    const heap = diagnostics.describeHeap({ performance: { memory: { usedJSHeapSize: 1234, totalJSHeapSize: 4321, jsHeapSizeLimit: 8000 } } });
    assert.equal(heap.usedBytes, 1234);
    assert.match(heap.note, /excludes native audio/);
});

test('PCM estimates deduplicate aliases and retain only metadata for the eight largest known buffers', () => {
    const shared = { length: 48000, sampleRate: 48000, numberOfChannels: 2, duration: 1 };
    const entries = [['A', shared], ['B', shared], ['empty', null]];
    for (let index = 1; index <= 12; index += 1) entries.push([`extra-${index}`, { ...shared, length: index * 48000 }]);
    const result = diagnostics.describeBuffers(entries);
    assert.equal(result.uniqueBuffers, 13);
    assert.equal(result.estimatedPCMBytes, (1 + 78) * 48000 * 2 * 4);
    assert.equal(result.largest.length, 8);
    assert.equal(result.largest[0].slot, 'extra-12');
    assert.ok(!JSON.stringify(result).includes('getChannelData'));
    assert.match(result.note, /excludes hidden caches/);
});

test('microphone diagnostics omit labels/device IDs and never request capture permission', () => {
    const tracks = diagnostics.describeMicrophones([['main', { getAudioTracks: () => [{ readyState: 'live', muted: true, enabled: true,
        label: 'Private microphone', getSettings: () => ({ deviceId: 'secret-id', groupId: 'secret-group', sampleRate: 48000,
            channelCount: 1, echoCancellation: false }) }] }], ['absent', null]]);
    assert.equal(tracks.length, 1);
    assert.deepEqual(tracks[0].settings, { sampleRate: 48000, channelCount: 1, echoCancellation: false });
    assert.ok(!JSON.stringify(tracks).includes('secret'));
    assert.ok(!JSON.stringify(tracks).includes('Private'));
});

test('monitor starts once at 1 Hz, uses bounded history and stops every listener/timer', () => {
    const setup = fixture();
    setup.monitor.start();
    setup.monitor.start();
    assert.equal(setup.timers.size, 1);
    assert.equal(setup.host.listeners.get('pageshow').size, 1);
    assert.equal(setup.context.listeners.get('statechange').size, 1);
    setup.monitor.stop();
    assert.equal(setup.timers.size, 0);
    assert.equal(setup.host.listeners.get('pageshow').size, 0);
    assert.equal(setup.context.listeners.get('statechange').size, 0);
});

test('normal running audio and regular callbacks do not produce stalls', () => {
    const setup = fixture();
    setup.monitor.start();
    for (let index = 0; index < 15; index += 1) setup.advance();
    const capture = setup.monitor.snapshot();
    assert.equal(capture.timing.maximumDelayMs, 0);
    assert.equal(capture.timing.audioClockStallSamples, 0);
    assert.equal(capture.timing.foregroundSamples, 15);
    assert.equal(capture.audio.sampleRate, 48000);
    assert.equal(capture.audio.baseLatencyMs, 10);
    assert.equal(capture.audio.outputLatencyMs, null);
    assert.equal(capture.longTasks.available, false);
});

test('main-thread lateness is measured separately from audio-clock progress', () => {
    const setup = fixture();
    setup.monitor.start();
    setup.advance(1400);
    const capture = setup.monitor.snapshot();
    assert.equal(capture.timing.maximumDelayMs, 400);
    assert.equal(capture.timing.delayedOver120ms, 1);
    assert.equal(capture.timing.audioClockStallSamples, 0);
    assert.equal(capture.events.at(-1).type, 'main-thread-delay');
});

test('a running but frozen audio clock records consecutive stalls without claiming hardware underruns', () => {
    const setup = fixture();
    setup.monitor.start();
    for (let index = 0; index < 4; index += 1) setup.advance(1000, 0);
    const capture = setup.monitor.snapshot();
    assert.equal(capture.timing.audioClockStallSamples, 4);
    assert.equal(capture.timing.longestClockStallSamples, 4);
    assert.equal(capture.events.filter(entry => entry.type === 'audio-clock-not-advancing').length, 1);
    assert.match(capture.timing.note, /not a hardware underrun detector/);
    setup.advance();
    assert.equal(setup.monitor.snapshot().timing.consecutiveClockStalls, 0);
});

test('background/focus transitions are retained but do not count background timer throttling as a foreground fault', () => {
    const setup = fixture();
    setup.monitor.start();
    setup.host.document.visibilityState = 'hidden';
    setup.host.document.emit('visibilitychange');
    setup.advance(300000, 0);
    setup.host.document.visibilityState = 'visible';
    setup.host.document.emit('visibilitychange');
    setup.advance();
    const capture = setup.monitor.snapshot();
    assert.equal(capture.timing.delayedOver120ms, 0);
    assert.equal(capture.timing.audioClockStallSamples, 0);
    assert.equal(capture.events.filter(entry => entry.type === 'visibilitychange').length, 2);
});

test('interrupted/suspended states are recorded without resuming, rebuilding or changing the context', () => {
    const setup = fixture();
    setup.context.resume = () => assert.fail('Diagnostics must not resume the engine');
    setup.monitor.start();
    setup.context.state = 'interrupted';
    setup.context.emit('statechange');
    setup.advance(10000, 0);
    const capture = setup.monitor.snapshot();
    assert.equal(capture.audio.state, 'interrupted');
    assert.equal(capture.audio.stateTransitions, 1);
    assert.equal(capture.timing.audioClockStallSamples, 0);
    assert.ok(capture.events.some(entry => entry.type === 'audio-state' && entry.state === 'interrupted'));
});

test('replacing a context detaches the old listener and retains bounded lifecycle evidence', () => {
    const setup = fixture();
    setup.monitor.start();
    const original = setup.context;
    setup.context = eventTarget({ state: 'running', currentTime: 0, sampleRate: 44100 });
    setup.monitor.observeContext();
    assert.equal(original.listeners.get('statechange').size, 0);
    assert.equal(setup.context.listeners.get('statechange').size, 1);
    const capture = setup.monitor.snapshot();
    assert.equal(capture.audio.contextsObserved, 2);
    assert.equal(capture.audio.id, 2);
    assert.equal(capture.audio.sampleRate, 44100);
});

test('getOutputTimestamp is optional, feature-detected and exception-safe', () => {
    const setup = fixture();
    setup.monitor.start();
    assert.equal(setup.monitor.snapshot().audio.outputTimestamp.available, false);
    setup.context.getOutputTimestamp = () => { throw new Error('Not supported here'); };
    assert.equal(setup.monitor.snapshot().audio.outputTimestamp.valid, false);
    setup.context.getOutputTimestamp = () => ({ contextTime: .9, performanceTime: 900 });
    setup.advance();
    const output = setup.monitor.snapshot().audio.outputTimestamp;
    assert.equal(output.valid, true);
    assert.equal(output.ageMs, 100);
    assert.ok(Math.abs(output.renderAheadMs - 100) < .000001);
});

test('supported Long Task observers aggregate numbers without keeping entry/attribution objects', () => {
    let callback;
    let disconnected = false;
    class Observer {
        static supportedEntryTypes = ['longtask'];
        constructor(listener) { callback = listener; }
        observe(options) { assert.equal(options.type, 'longtask'); }
        disconnect() { disconnected = true; }
    }
    const setup = fixture({ host: { PerformanceObserver: Observer } });
    setup.monitor.start();
    callback({ getEntries: () => [{ duration: 60, attribution: ['private'] }, { duration: 120 }] });
    assert.deepEqual(setup.monitor.snapshot().longTasks, { available: true, count: 2, totalMs: 180, maximumMs: 120 });
    setup.monitor.stop();
    assert.equal(disconnected, true);
});

test('unsupported observers and failing UI refresh callbacks do not stop monitoring', () => {
    class Observer {
        static supportedEntryTypes = ['longtask'];
        observe() { throw new Error('Not implemented'); }
        disconnect() {}
    }
    const setup = fixture({ host: { PerformanceObserver: Observer }, monitor: { onHistory: () => { throw new Error('UI unavailable'); } } });
    setup.monitor.start();
    setup.advance();
    assert.equal(setup.monitor.snapshot().longTasks.available, false);
    assert.equal(setup.monitor.snapshot().timing.samples, 2);
});

test('two hours of diagnostics retain fixed limits and primitive resource metadata only', () => {
    const setup = fixture();
    setup.monitor.start();
    for (let index = 0; index < 7200; index += 1) setup.advance();
    for (let index = 0; index < 1000; index += 1) setup.monitor.record('test-event', { count: index });
    const capture = setup.monitor.snapshot();
    assert.equal(capture.history.length, 180);
    assert.equal(capture.events.length, 80);
    assert.equal(capture.timing.recentSamples, 120);
    assert.equal(capture.history.at(-1).counts.xVoices, 3);
    assert.ok(JSON.stringify(capture).length < 100000);
});

test('marked incidents keep pre-fault context and last twelve timeline points, with no recursive incident growth', () => {
    const setup = fixture();
    setup.monitor.start();
    for (let index = 0; index < 200; index += 1) setup.advance();
    for (let index = 0; index < 9; index += 1) setup.monitor.markProblem();
    const capture = setup.monitor.snapshot();
    assert.equal(capture.incidents.length, 5);
    assert.equal(capture.incidents[0].capture.history.length, 12);
    assert.equal(capture.incidents[0].capture.incidents.length, 0);
    assert.ok(capture.incidents[0].capture.events.some(entry => entry.type === 'user-marked-crackle'));
    assert.ok(JSON.stringify(capture).length < 100000);
});

test('resource sampling is sparse, and unknown engine state still exports readable phone diagnostics', () => {
    const setup = fixture();
    setup.context = null;
    setup.monitor.start();
    for (let index = 0; index < 19; index += 1) setup.advance();
    assert.equal(setup.stateReads, 2);
    const capture = setup.monitor.snapshot();
    assert.equal(capture.audio.state, 'not-started');
    assert.match(diagnostics.formatText(capture), /iPhone \/ Browser Diagnostics/);
    assert.match(diagnostics.formatText(capture), /DIAG-test/);
    assert.match(diagnostics.formatText(capture), /JS heap API unavailable/);
});

test('audio-session events retain the event category rather than overwriting it with the session type', () => {
    const setup = fixture();
    setup.host.navigator.audioSession = eventTarget({ type: 'playback', state: 'interrupted' });
    setup.monitor.start();
    setup.host.navigator.audioSession.emit('statechange');
    const latest = setup.monitor.snapshot().events.at(-1);
    assert.equal(latest.type, 'audio-session');
    assert.equal(latest.sessionType, 'playback');
    assert.equal(latest.state, 'interrupted');
});

test('Clear Log erases retained incidents, histories and timing samples without touching playback or its monitor', () => {
    const setup = fixture();
    setup.monitor.start();
    setup.advance(2000);
    setup.monitor.markProblem();
    setup.monitor.clearHistory();
    const capture = setup.monitor.snapshot();
    assert.equal(capture.incidents.length, 0);
    assert.equal(capture.history.length, 0);
    assert.equal(capture.events.length, 1);
    assert.equal(capture.events[0].type, 'diagnostics-cleared');
    assert.equal(capture.timing.delayedOver120ms, 0);
    assert.equal(setup.timers.size, 1);
    assert.equal(setup.context.state, 'running');
    setup.advance();
    assert.equal(setup.monitor.snapshot().history.length, 1);
});

test('device/rotation changes are recorded without enumerating devices or exposing their IDs', () => {
    const setup = fixture();
    setup.host.navigator.mediaDevices = eventTarget({ enumerateDevices: () => assert.fail('Do not enumerate devices') });
    setup.monitor.start();
    setup.host.navigator.mediaDevices.emit('devicechange');
    setup.host.emit('orientationchange');
    const capture = setup.monitor.snapshot();
    assert.ok(capture.events.some(entry => entry.type === 'media-device-change'));
    assert.ok(capture.events.some(entry => entry.type === 'orientationchange'));
    setup.monitor.stop();
    assert.equal(setup.host.navigator.mediaDevices.listeners.get('devicechange').size, 0);
});
