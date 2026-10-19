const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const theory = require('../q-theory.js');
const { Piano, Controller, createKeyboardPlayer } = require('../q-card.js');

const manifests = Object.fromEntries(['piano', 'strings'].map(instrument => [instrument, JSON.parse(fs.readFileSync(path.join(__dirname, '..', theory.instruments[instrument].repository, 'manifest.json')))]));

function deferred() {
    let resolve;
    const promise = new Promise(finish => { resolve = finish; });
    return { promise, resolve };
}

function holdSamples(piano) {
    const segment = piano.segment.bind(piano);
    piano.segment = () => null;
    return () => { piano.segment = segment; };
}

function fixture({ pinned = true, capture = true, sampleRate = 48000 } = {}) {
    const sources = [];
    const gains = [];
    const output = { connections: [] };
    const tap = { connections: [] };
    const node = extra => ({ connections: [], disconnected: false, connect(destination) { this.connections.push(destination); return destination; }, disconnect() { this.disconnected = true; this.connections = []; }, ...extra });
    const context = {
        currentTime: 1, sampleRate,
        createBufferSource() {
            const source = node({ playbackRate: {}, starts: [], stops: [], start(...args) { this.starts.push(args); }, stop(time) { this.stops.push(time); } });
            sources.push(source);
            return source;
        },
        createGain() {
            const calls = [];
            const gain = node({ gain: { value: 1, calls, setValueAtTime(value, time) { calls.push(['set', value, time]); }, linearRampToValueAtTime(value, time) { calls.push(['ramp', value, time]); }, cancelScheduledValues(time) { calls.push(['cancel', time]); } } });
            gains.push(gain);
            return gain;
        },
        async decodeAudioData(bytes) {
            const header = new DataView(bytes);
            let frames;
            let channels;
            let rate;
            let stride;
            for (let offset = 12; offset < header.byteLength;) {
                const size = header.getUint32(offset + 4, true);
                const id = String.fromCharCode(...new Uint8Array(bytes, offset, 4));
                if (id === 'fmt ') {
                    channels = header.getUint16(offset + 10, true);
                    rate = header.getUint32(offset + 12, true);
                    stride = header.getUint16(offset + 20, true);
                }
                if (id === 'data') frames = size / stride;
                offset += 8 + size + size % 2;
            }
            const length = Math.round(frames * sampleRate / rate);
            return { sampleRate, length, duration: length / sampleRate, numberOfChannels: channels };
        }
    };
    const host = { context: () => context, output: () => output, ...(capture ? { capture: () => tap } : {}) };
    const player = createKeyboardPlayer(host);
    if (pinned) for (const [instrument, entry] of player.samplers) {
        const samples = manifests[instrument].samples.map(sample => ({ ...sample, offset: 44100, frames: 441000 }));
        entry.piano.restored({ sampleRate, length: sampleRate * 11, numberOfChannels: 2 }, { version: 1, instrument: theory.instruments[instrument].id, sampleRate: 44100, samples });
    }
    return { player, context, host, output, tap, sources, gains };
}

test('factory owns independent per-instrument Piano samplers without mutating main Q state or banks', async () => {
    const main = new Controller({});
    main.state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55] });
    Object.assign(main.state, { room: .7, delay: .4, instrument: 'strings' });
    main.piano.select('strings');
    const bank = { instrument: theory.instruments.strings.id, samples: [{ id: 'viola48v96' }] };
    const atlas = {};
    main.piano.restored(atlas, bank);
    main.running = true;
    const state = JSON.stringify(main.state);
    const originalMain = globalThis.mygrainQ;
    globalThis.mygrainQ = main;
    try {
        const { player } = fixture();
        const piano = await player.noteOn('piano', 60, { instrument: 'piano' });
        const strings = await player.noteOn('strings', 60, { instrument: 'strings' });
        assert.equal(piano.instrument, 'piano');
        assert.equal(strings.instrument, 'strings');
        for (const [instrument, entry] of player.samplers) {
            assert.ok(entry.piano instanceof Piano);
            assert.equal(entry.piano.instrument, instrument);
            assert.notEqual(entry.piano, main.piano);
        }
        assert.equal(JSON.stringify(main.state), state);
        assert.equal(main.piano.atlas, atlas);
        assert.deepEqual(main.piano.bank, bank);
        assert.equal(main.running, true);
        assert.equal(main.voices.size, 0);
        player.stop();
    } finally { globalThis.mygrainQ = originalMain; }
});

test('stereo sample graph connects audible output and isolated K tap without connecting tap to output', async () => {
    const { player, output, tap } = fixture();
    const voice = await player.noteOn('key', 60);
    assert.equal(voice.source.buffer.numberOfChannels, 2);
    assert.deepEqual(voice.source.connections, [voice.gain]);
    assert.deepEqual(voice.gain.connections, [output, tap]);
    assert.deepEqual(tap.connections, []);
    player.stop();
});

test('optional capture is not required and an identical capture/output does not double-route', async () => {
    const first = fixture({ capture: false });
    assert.deepEqual((await first.player.noteOn('key', 60)).gain.connections, [first.output]);
    first.player.stop();
    const second = fixture();
    second.host.capture = () => second.output;
    assert.deepEqual((await second.player.noteOn('key', 60)).gain.connections, [second.output]);
    second.player.stop();
});

test('fractional MIDI retains precise sample rate and piano naturally sustains with release', async () => {
    const { player, context } = fixture();
    const voice = await player.noteOn('key', 60.5, { velocity: 100, volume: .5 });
    assert.equal(voice.source.playbackRate.value, 2 ** (.5 / 12));
    assert.equal(voice.source.loop, undefined);
    assert.equal(voice.end, voice.start + 10 / voice.source.playbackRate.value);
    assert.equal(voice.peak, Math.sqrt(100 / 127) * .60 * .5);
    context.currentTime = 2;
    player.noteOff('key');
    assert.equal(voice.end, 2.16);
    assert.deepEqual(voice.gain.gain.calls.at(-1), ['ramp', 0, 2.16]);
    voice.source.onended();
    assert.equal(player.voices.size, 0);
    assert.equal(voice.source.disconnected, true);
    assert.equal(voice.gain.disconnected, true);
});

test('held strings loop verified Q sustain points at both context rates and release on key-up', async () => {
    for (const sampleRate of [44100, 48000]) {
        const { player, context } = fixture({ sampleRate });
        const voice = await player.noteOn('key', 60.25, { instrument: 'strings', velocity: 96 });
        const sample = manifests.strings.samples.find(item => item.midi === theory.sampleMidi(60.25, 'strings') && item.velocity === 96);
        assert.equal(voice.source.buffer.numberOfChannels, 2);
        assert.equal(voice.source.loop, true);
        assert.equal(voice.source.loopStart, 1 + sample.loopStart / sample.sampleRate);
        assert.equal(voice.source.loopEnd, 1 + sample.loopEnd / sample.sampleRate);
        assert.equal(voice.source.playbackRate.value, 2 ** ((60.25 - sample.midi) / 12));
        assert.equal(voice.end, Infinity);
        assert.equal(voice.source.stops.length, 0);
        context.currentTime = 20;
        player.noteOff('key');
        assert.deepEqual(voice.source.stops, [20.25]);
        voice.source.onended();
        assert.equal(player.metrics.voices, 0);
    }
});

test('independent keyboard sample mix scales live voices, future direct/arp notes and only the K tap', async () => {
    const { player, host, output, tap, context } = fixture();
    const volumes = { piano: .6, strings: .3 };
    host.volume = instrument => volumes[instrument];
    const main = new Controller({});
    main.state.level = .42;
    main.state.instrument = 'strings';
    main.running = true;
    const mainState = JSON.stringify(main.state);
    const piano = await player.noteOn('keyboard:C4', 60, { instrument: 'piano' });
    const strings = await player.noteOn('keyboard:E4', 64, { instrument: 'strings' });
    for (const voice of [piano, strings]) {
        assert.deepEqual(voice.gain.connections, [voice.mixGain]);
        assert.deepEqual(voice.mixGain.connections, [output, tap]);
        assert.equal(voice.mixGain.gain.value, volumes[voice.instrument]);
    }
    assert.deepEqual(tap.connections, [], 'K capture cannot monitor or capture independent backing');
    const envelopes = [piano, strings].map(voice => JSON.stringify(voice.gain.gain.calls));
    volumes.piano = 0;
    context.currentTime = 2;
    player.refreshVolumes();
    assert.deepEqual(piano.mixGain.gain.calls.at(-1), ['ramp', 0, 2.015]);
    assert.deepEqual(strings.mixGain.gain.calls.at(-1), ['ramp', .3, 2.015]);
    const mutedPiano = await player.noteOn('arp:G4', 67, { instrument: 'piano' });
    assert.equal(mutedPiano.mixGain.gain.value, 0, 'zero must mute new arp notes without forcing a minimum');
    volumes.piano = .8;
    volumes.strings = 0;
    context.currentTime = 20;
    player.refreshVolumes();
    assert.equal(strings.end, Infinity);
    assert.equal(strings.released, false);
    assert.equal(strings.source.loop, true);
    assert.equal(strings.source.stops.length, 0);
    assert.deepEqual(piano.mixGain.gain.calls.at(-1), ['ramp', .8, 20.015]);
    assert.deepEqual(strings.mixGain.gain.calls.at(-1), ['ramp', 0, 20.015]);
    const mutedStrings = await player.noteOn('keyboard:G4', 67, { instrument: 'strings' });
    assert.equal(mutedStrings.mixGain.gain.value, 0);
    volumes.strings = .75;
    player.refreshVolumes();
    assert.deepEqual(strings.mixGain.gain.calls.at(-1), ['ramp', .75, 20.015]);
    assert.deepEqual([piano, strings].map(voice => JSON.stringify(voice.gain.gain.calls)), envelopes);
    assert.equal(JSON.stringify(main.state), mainState);
    assert.equal(main.running, true);
    player.stop();
    for (const voice of [piano, strings, mutedPiano, mutedStrings]) {
        assert.equal(voice.mixGain.disconnected, true);
        assert.equal(voice.gain.disconnected, true);
        assert.equal(voice.source.disconnected, true);
    }
});

test('a sample finishing its asynchronous load uses the current mixer value, including zero', async () => {
    for (const instrument of ['piano', 'strings']) {
        const { player, host } = fixture();
        let volume = 1;
        host.volume = () => volume;
        const load = deferred();
        const piano = player.samplers.get(instrument).piano;
        const restoreSamples = holdSamples(piano);
        piano.ensure = () => load.promise;
        const pending = player.noteOn('keyboard:C4', 60, { instrument });
        volume = 0;
        player.refreshVolumes();
        restoreSamples();
        load.resolve();
        const voice = await pending;
        assert.equal(voice.mixGain.gain.value, 0);
        player.stop();
    }
});

test('scheduled arpeggio durations release and clean up both instruments without explicit key-up', async () => {
    const { player } = fixture();
    for (const instrument of ['piano', 'strings']) {
        const voice = await player.noteOn(instrument, 60, { instrument, startTime: 4, duration: .2 });
        assert.deepEqual(voice.source.starts, [[4, 1]]);
        assert.equal(voice.end, 4.2 + (instrument === 'strings' ? .25 : .16));
        assert.deepEqual(voice.source.stops, [voice.end]);
        voice.source.onended();
        assert.equal(voice.source.disconnected, true);
        assert.equal(voice.gain.disconnected, true);
    }
    assert.equal(player.metrics.voices, 0);
});

test('key-up during sample loading cancels a late note and settles immediately', async () => {
    const { player, sources } = fixture();
    const load = deferred();
    const restoreSamples = holdSamples(player.samplers.get('piano').piano);
    player.samplers.get('piano').piano.ensure = () => load.promise;
    const pending = player.noteOn('key', 60);
    assert.equal(player.metrics.pending, 1);
    player.noteOff('key');
    assert.equal(await pending, null);
    restoreSamples();
    load.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sources.length, 0);
    assert.equal(player.metrics.pending, 0);
});

test('stop cancels both in-flight and queued loads without late source creation', async () => {
    const { player, sources } = fixture();
    const load = deferred();
    const restoreSamples = holdSamples(player.samplers.get('piano').piano);
    player.samplers.get('piano').piano.ensure = () => load.promise;
    const requests = [player.noteOn('first', 60), player.noteOn('second', 64), player.prepare('piano', 67)];
    player.stop();
    assert.deepEqual(await Promise.all(requests), [null, null, null]);
    restoreSamples();
    load.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sources.length, 0);
    assert.equal(player.samplers.get('piano').queue.size, 0);
});

test('repeated same key cancels old loading requests and stops an already playing source', async () => {
    const { player } = fixture();
    const load = deferred();
    const piano = player.samplers.get('piano').piano;
    const originalEnsure = piano.ensure.bind(piano);
    const restoreSamples = holdSamples(piano);
    piano.ensure = () => load.promise;
    const first = player.noteOn('key', 60);
    const second = player.noteOn('key', 64);
    assert.equal(await first, null);
    piano.ensure = originalEnsure;
    restoreSamples();
    load.resolve();
    const voice = await second;
    assert.equal(voice.midi, 64);
    const next = await player.noteOn('key', 67);
    assert.equal(voice.source.disconnected, true);
    assert.equal(voice.source.onended, null);
    assert.equal(player.voices.get('key'), next);
    assert.equal(player.metrics.voices, 1);
    player.stop();
});

test('releasing or stopping a future scheduled source cancels and disconnects it immediately', async () => {
    const { player } = fixture();
    const voice = await player.noteOn('key', 60, { startTime: 10, duration: .1 });
    player.noteOff('key');
    assert.equal(voice.source.stops.at(-1), undefined);
    assert.equal(voice.source.disconnected, true);
    assert.equal(voice.gain.disconnected, true);
    assert.equal(player.metrics.voices, 0);
});

test('bounded queues drop the oldest pending requests, and active voices never exceed 64', async () => {
    const { player } = fixture();
    const load = deferred();
    const piano = player.samplers.get('piano').piano;
    const originalEnsure = piano.ensure.bind(piano);
    const restoreSamples = holdSamples(piano);
    piano.ensure = () => load.promise;
    const pending = Array.from({ length: 100 }, (_, index) => player.noteOn(index, 60));
    assert.equal(player.metrics.pending, 64);
    assert.ok(player.samplers.get('piano').queue.size <= 64);
    assert.deepEqual(await Promise.all(pending.slice(0, 36)), Array(36).fill(null));
    piano.ensure = originalEnsure;
    restoreSamples();
    load.resolve();
    const voices = await Promise.all(pending);
    assert.equal(voices.filter(Boolean).length, 64);
    const first = player.activeVoices.values().next().value;
    await player.noteOn('last', 64);
    assert.equal(first.source.disconnected, true);
    assert.equal(player.metrics.voices, 64);
    player.stop();
    assert.equal(player.metrics.voices, 0);
});

test('per-instrument preparation and cache eviction keep total decoded cached audio within 96 MB', async () => {
    const { player, sources } = fixture();
    for (const entry of player.samplers.values()) {
        entry.piano.cache.set('older', { length: 8 * 1024 * 1024, numberOfChannels: 2 });
        entry.piano.cache.set('newer', { length: 4 * 1024 * 1024, numberOfChannels: 2 });
    }
    await player.prepare('strings');
    assert.ok(player.metrics.cachedBytes <= 96 * 1024 * 1024);
    assert.equal(sources.length, 0);
    assert.equal(player.samplers.get('strings').piano.instrument, 'strings');
});

test('cold samples load in parallel while Piano and Strings remain independent', async () => {
    const { player } = fixture();
    const gate = deferred();
    const restoreSamples = holdSamples(player.samplers.get('piano').piano);
    let loads = 0;
    player.samplers.get('piano').piano.ensure = async () => { loads += 1; await gate.promise; };
    const pending = [player.noteOn('one', 60), player.noteOn('two', 64)];
    const strings = await player.noteOn('strings', 60, { instrument: 'strings' });
    assert.equal(strings.instrument, 'strings');
    assert.equal(loads, 2);
    restoreSamples();
    gate.resolve();
    await Promise.all(pending);
    assert.equal(loads, 2);
    player.stop();
});

test('context replacement, absent output, invalid pitch and stale scheduled notes cannot create sources', async () => {
    const first = fixture();
    const load = deferred();
    const restoreSamples = holdSamples(first.player.samplers.get('piano').piano);
    first.player.samplers.get('piano').piano.ensure = () => load.promise;
    const pending = first.player.noteOn('key', 60);
    first.host.context = () => ({ currentTime: 2 });
    restoreSamples();
    load.resolve();
    assert.equal(await pending, null);
    assert.equal(first.sources.length, 0);
    const second = fixture();
    second.host.output = () => null;
    assert.equal(await second.player.noteOn('key', 60), null);
    assert.equal(await second.player.noteOn('invalid', NaN), null);
    second.host.output = () => second.output;
    assert.equal(await second.player.noteOn('late', 60, { startTime: 0, duration: .2 }), null);
    assert.equal(second.sources.length, 0);
});

test('source setup failures reject the request and disconnect partially-created nodes', async () => {
    const { player, host, sources, gains } = fixture();
    host.capture = () => { throw new Error('tap unavailable'); };
    await assert.rejects(player.noteOn('key', 60), /tap unavailable/);
    assert.equal(player.metrics.pending, 0);
    assert.equal(player.metrics.voices, 0);
    assert.equal(sources[0].disconnected, true);
    assert.equal(gains[0].disconnected, true);
});

test('unknown instrument never substitutes an unrelated Q instrument', async () => {
    const { player } = fixture();
    await assert.rejects(player.noteOn('key', 60, { instrument: 'constructor' }), /Unknown Q keyboard instrument/);
    await assert.rejects(player.prepare('drums'), /Unknown Q keyboard instrument/);
    assert.equal(player.metrics.voices, 0);
});

test('failed sample loads reject only the affected request and leave the queue usable', async () => {
    const { player } = fixture();
    const piano = player.samplers.get('piano').piano;
    const originalEnsure = piano.ensure.bind(piano);
    const restoreSamples = holdSamples(piano);
    let loads = 0;
    piano.ensure = async events => {
        loads += 1;
        if (loads === 1) throw new Error('sample unavailable');
        restoreSamples();
        await originalEnsure(events);
    };
    const failed = player.noteOn('missing', 60);
    const ready = player.noteOn('ready', 64);
    await assert.rejects(failed, /sample unavailable/);
    assert.equal((await ready).midi, 64);
    assert.equal(player.metrics.pending, 0);
    player.stop();
});

test('velocity and level stay bounded while zero level remains silent', async () => {
    const { player } = fixture();
    const low = await player.noteOn('low', 60, { instrument: 'strings', velocity: -20 });
    const high = await player.noteOn('high', 60, { instrument: 'strings', velocity: 800, volume: 800 });
    const silent = await player.noteOn('silent', 60, { volume: 0 });
    assert.equal(low.velocity, 1);
    assert.equal(high.velocity, 127);
    assert.equal(high.peak, 1.30 * 4);
    assert.equal(silent.peak, 0);
    player.stop();
});

test('the keyboard uses the real local manifests, SHA-256 sample checks and stereo dimension validation', async context => {
    const { player, sources } = fixture({ pinned: false });
    const fetches = [];
    context.mock.method(globalThis, 'fetch', async url => {
        fetches.push(url);
        const bytes = fs.readFileSync(path.join(__dirname, '..', url));
        return { ok: true, json: async () => JSON.parse(bytes), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    });
    for (const instrument of ['piano', 'strings']) {
        const voice = await player.noteOn(instrument, 60.5, { instrument, velocity: 100, duration: .1 });
        assert.equal(voice.source.buffer.numberOfChannels, 2);
        const cache = player.samplers.get(instrument).piano.cache;
        assert.equal(cache.size, 1);
        await player.prepare(instrument, 60.5, 100);
        assert.equal(cache.size, 1);
    }
    assert.equal(fetches.filter(url => url.endsWith('manifest.json')).length, 2);
    assert.equal(fetches.filter(url => url.endsWith('.wav')).length, 2);
    player.stop();
    assert.ok(sources.every(source => source.disconnected));
});

for (const instrument of ['piano', 'strings']) {
    test(`${instrument} ready taps and chords start synchronously behind a cold sample`, async () => {
        const { player, sources, context } = fixture();
        const piano = player.samplers.get(instrument).piano;
        const gate = deferred();
        const originalSegment = piano.segment.bind(piano);
        piano.segment = (midi, velocity) => midi === 48 ? null : originalSegment(midi, velocity);
        piano.ensure = () => gate.promise;
        const cold = player.noteOn('cold', 48, { instrument });
        try {
            for (let press = 0; press < 8; press += 1) {
                const pending = player.noteOn('warm', 60, { instrument });
                assert.ok(player.voices.has('warm'), 'Ready notes start without awaiting unrelated loading or a microtask');
                context.currentTime += .01;
                player.noteOff('warm');
                assert.ok(await pending);
            }
            const chord = [60, 64, 67].map(midi => player.noteOn(`chord-${midi}`, midi, { instrument }));
            assert.equal(sources.length, 11);
            assert.ok((await Promise.all(chord)).every(Boolean));
            player.noteOff('cold');
            assert.equal(await cold, null);
        } finally {
            piano.segment = originalSegment;
            gate.resolve();
            player.stop();
            await cold;
        }
    });
}

test('ready source preparation resolves without queuing behind cold preload work', async () => {
    const { player } = fixture();
    const piano = player.samplers.get('piano').piano;
    const originalSegment = piano.segment.bind(piano);
    const gate = deferred();
    piano.segment = (midi, velocity) => midi === 48 ? null : originalSegment(midi, velocity);
    piano.ensure = () => gate.promise;
    const cold = player.prepare('piano', 48);
    try {
        const warm = player.prepare('piano', 60);
        let ready = false;
        warm.then(() => { ready = true; });
        await new Promise(setImmediate);
        assert.equal(ready, true);
    } finally {
        piano.segment = originalSegment;
        gate.resolve();
        player.stop();
        await cold;
    }
});

test('cold loading is bounded to three requests and queued live notes precede background preparation', async () => {
    const { player } = fixture();
    const piano = player.samplers.get('piano').piano;
    const originalSegment = piano.segment.bind(piano);
    const loaded = new Set();
    const gates = new Map();
    const started = [];
    let active = 0;
    let peak = 0;
    piano.segment = (midi, velocity) => loaded.has(midi) ? originalSegment(midi, velocity) : null;
    piano.ensure = async events => {
        const midi = events[0].notes[0];
        const gate = deferred();
        gates.set(midi, gate);
        started.push(midi);
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        loaded.add(midi);
        active -= 1;
    };
    const requests = [48, 49, 50, 51, 52].map(midi => player.prepare('piano', midi));
    requests.push(player.noteOn('live', 72));
    try {
        assert.deepEqual(started, [48, 49, 50]);
        gates.get(48).resolve();
        await new Promise(setImmediate);
        assert.deepEqual(started, [48, 49, 50, 72]);
        assert.equal(peak, 3);
    } finally {
        player.stop();
        for (const gate of gates.values()) gate.resolve();
        await Promise.all(requests);
    }
});

test('suspended contexts resume before playback and release during resume still cancels', async () => {
    const { player, context, sources } = fixture();
    const gate = deferred();
    context.state = 'suspended';
    context.resume = async () => { await gate.promise; context.state = 'running'; };
    const cancelled = player.noteOn('released', 60);
    player.noteOff('released');
    assert.equal(await cancelled, null);
    gate.resolve();
    await new Promise(setImmediate);
    assert.equal(sources.length, 0);
    context.state = 'suspended';
    assert.ok(await player.noteOn('held', 64));
    assert.equal(context.state, 'running');
    player.stop();
});

test('parallel sample preparation shares one validated manifest request per instrument', async context => {
    const { player } = fixture({ pinned: false });
    const sampler = player.samplers.get('piano').piano;
    const gate = deferred();
    let fetches = 0;
    context.mock.method(globalThis, 'fetch', async () => {
        fetches += 1;
        await gate.promise;
        return { ok: true, json: async () => manifests.piano };
    });
    const requests = [sampler.catalog(), sampler.catalog(), sampler.catalog()];
    gate.resolve();
    assert.ok((await Promise.all(requests)).every(manifest => manifest === manifests.piano));
    assert.equal(fetches, 1);
});
