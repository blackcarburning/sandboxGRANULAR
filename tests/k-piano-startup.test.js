const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const theory = require('../q-theory.js');
const { Piano, Controller, createKeyboardPlayer } = require('../q-card.js');

const root = path.resolve(__dirname, '..');
const original = JSON.parse(fs.readFileSync(path.join(root, 'SAMPLES_Q/manifest.json')));
const compact = JSON.parse(fs.readFileSync(path.join(root, 'SAMPLES_Q_KEYBOARD/catalog.json')));
const strings = JSON.parse(fs.readFileSync(path.join(root, 'SAMPLES_Q_STRINGS/manifest.json')));
const descriptors = new Map([...original.samples, ...compact.samples, ...strings.samples].map(sample => [sample.sha256, sample]));
const checksum = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function deferred() {
    let resolve;
    const promise = new Promise(finish => { resolve = finish; });
    return { promise, resolve };
}

function fixture(context, options = {}) {
    const fetches = [];
    const decoded = [];
    const sources = [];
    const output = {};
    const capture = {};
    const node = properties => ({ connections: [], connect(destination) { this.connections.push(destination); }, disconnect() { this.connections = []; }, ...properties });
    const audio = {
        state: 'running', currentTime: 1, sampleRate: options.sampleRate || 48000,
        async decodeAudioData(bytes) {
            const descriptor = descriptors.get(checksum(Buffer.from(bytes)));
            assert.ok(descriptor, 'decoder receives a verified real repository asset');
            decoded.push(descriptor);
            const length = Math.round(descriptor.frames * audio.sampleRate / descriptor.sampleRate);
            const buffer = { sampleRate: audio.sampleRate, length, numberOfChannels: 2, duration: length / audio.sampleRate };
            return options.decode ? options.decode(descriptor, buffer) : buffer;
        },
        createBufferSource() {
            const source = node({ playbackRate: {}, starts: [], stops: [], start(...arguments) { this.starts.push(arguments); }, stop(time) { this.stops.push(time); } });
            sources.push(source);
            return source;
        },
        createGain() {
            const calls = [];
            return node({ gain: { calls, setValueAtTime(...arguments) { calls.push(['set', ...arguments]); },
                linearRampToValueAtTime(...arguments) { calls.push(['ramp', ...arguments]); }, cancelScheduledValues(time) { calls.push(['cancel', time]); } } });
        }
    };
    context.mock.method(globalThis, 'fetch', async url => {
        fetches.push(url);
        if (url === options.missing) return { ok: false };
        if (url.endsWith('.mp3') && options.gate) await options.gate.promise;
        let bytes = fs.readFileSync(path.join(root, url));
        if ((options.corrupt && url.endsWith('.mp3')) || (options.corruptOriginal && url.endsWith('.wav'))) {
            bytes = Buffer.from(bytes);
            bytes[bytes.length - 1] ^= 1;
        }
        return { ok: true,
            json: async () => url.endsWith('catalog.json') && options.catalog ? options.catalog : JSON.parse(bytes),
            arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    });
    const host = { context: () => audio, output: () => output, capture: () => capture };
    return { player: createKeyboardPlayer(host), host, audio, fetches, decoded, sources, output, capture };
}

test('all 120 keyboard assets are compact, authenticated full-duration stereo derivatives of the original Q WAVs', () => {
    assert.equal(compact.samples.length, 120);
    assert.equal(compact.sourceId, original.id);
    assert.equal(compact.revision, original.revision);
    assert.equal(compact.codec, 'mp3');
    assert.equal(compact.license, original.license);
    for (const sample of compact.samples) {
        const source = original.samples.find(candidate => candidate.id === sample.id);
        for (const property of ['midi', 'velocity', 'frames', 'sampleRate', 'channels']) assert.equal(sample[property], source[property]);
        assert.equal(sample.sourceSha256, source.sha256);
        assert.equal(sample.channels, 2);
        const bytes = fs.readFileSync(path.join(root, 'SAMPLES_Q_KEYBOARD', sample.file));
        assert.equal(sample.bytes, bytes.length);
        assert.equal(sample.sha256, checksum(bytes));
        assert.ok(sample.bytes < source.bytes / 6);
    }
});

test('visible MIDI 47–60 transfers under 9% of the former five-root WAV payload without removing tails', () => {
    const pitches = new Set(Array.from({ length: 14 }, (_, index) => theory.sampleMidi(47 + index)));
    const samples = manifest => manifest.samples.filter(sample => pitches.has(sample.midi) && sample.velocity === 127);
    const total = manifest => samples(manifest).reduce((bytes, sample) => bytes + sample.bytes, 0);
    assert.equal(samples(compact).length, 5);
    assert.equal(total(original), 13973824);
    assert.ok(total(compact) < total(original) * .09);
    assert.deepEqual(samples(compact).map(sample => sample.frames), samples(original).map(sample => sample.frames));
});

test('cold prepare fetches only the compact piano asset and repeated ready taps stay synchronous', async context => {
    const { player, fetches, decoded } = fixture(context);
    const selected = await player.prepare('piano', 60, 127);
    assert.ok(selected.duration > 15);
    assert.deepEqual(fetches, ['SAMPLES_Q/manifest.json', 'SAMPLES_Q_KEYBOARD/catalog.json', 'SAMPLES_Q_KEYBOARD/samples/C4v16.mp3']);
    assert.equal(decoded.length, 1);
    assert.equal(decoded[0].sourceSha256, original.samples.find(sample => sample.id === 'C4v16').sha256);
    const first = player.noteOn('first', 60, { velocity: 127 });
    const second = player.noteOn('second', 64, { velocity: 127 });
    assert.equal(player.voices.has('first'), true);
    player.noteOff('second');
    await first;
    await second;
    player.stop();
});

test('parallel requests share both catalogs and each verified MP3 download', async context => {
    const { player, fetches } = fixture(context);
    const requests = [60, 60, 61, 63, 63, 64].map(pitch => player.prepare('piano', pitch, 127));
    await Promise.all(requests);
    assert.equal(fetches.filter(url => url === 'SAMPLES_Q/manifest.json').length, 1);
    assert.equal(fetches.filter(url => url.endsWith('catalog.json')).length, 1);
    assert.equal(fetches.filter(url => url.endsWith('.mp3')).length, 2);
    assert.equal(fetches.some(url => url.endsWith('.wav')), false);
    assert.equal(player.metrics.pending, 0);
});

for (const sampleRate of [44100, 48000]) {
    test(`held piano preserves the full natural tail, pitch, release and K capture at ${sampleRate} Hz`, async context => {
        const { player, audio, output, capture } = fixture(context, { sampleRate });
        const voice = await player.noteOn('held', 60.5, { velocity: 127 });
        const sample = original.samples.find(candidate => candidate.id === 'C4v16');
        const duration = Math.round(sample.frames * sampleRate / sample.sampleRate) / sampleRate;
        assert.equal(voice.end, voice.start + duration / 2 ** (.5 / 12));
        assert.ok(voice.end - voice.start > 15);
        assert.equal(voice.source.loop, undefined);
        assert.deepEqual(voice.gain.connections, [output, capture]);
        audio.currentTime = 10;
        player.noteOff('held');
        assert.equal(voice.end, 10.16);
        assert.deepEqual(voice.gain.gain.calls.at(-1), ['ramp', 0, 10.16]);
        voice.source.onended();
        assert.equal(player.voices.size, 0);
        assert.deepEqual(voice.gain.connections, []);
    });
}

test('scheduled arpeggio notes keep their duration and route into the same isolated K capture bus', async context => {
    const { player, output, capture } = fixture(context);
    const voice = await player.noteOn('arp', 60, { velocity: 127, startTime: 4, duration: .2 });
    assert.equal(voice.end, 4.36);
    assert.equal(voice.source.loop, undefined);
    assert.deepEqual(voice.gain.connections, [output, capture]);
    player.stop();
});

test('main Q/Song sampling remains full WAV and independent of compact keyboard state', async context => {
    const { player, host, fetches } = fixture(context);
    const main = new Controller(host);
    main.state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55] });
    const state = JSON.stringify(main.getState());
    await main.piano.ensure([{ notes: [60], velocity: 127 }]);
    const buffer = main.piano.source(60, 127).buffer;
    await player.prepare('piano', 60, 127);
    assert.ok(main.piano instanceof Piano);
    assert.notEqual(main.piano, player.samplers.get('piano').piano);
    assert.ok(fetches.includes('SAMPLES_Q/samples/C4v16.wav'));
    assert.ok(fetches.includes('SAMPLES_Q_KEYBOARD/samples/C4v16.mp3'));
    assert.equal(main.piano.source(60, 127).buffer, buffer);
    assert.equal(JSON.stringify(main.getState()), state);
    assert.equal(main.piano.bank, null);
});

test('pinned saved keyboard audio bypasses all repository fetches', async context => {
    const { player, fetches } = fixture(context);
    const sample = original.samples.find(candidate => candidate.id === 'C4v16');
    const buffer = { sampleRate: 44100, length: sample.frames, numberOfChannels: 2 };
    player.samplers.get('piano').piano.restored(buffer, { version: 1, instrument: original.id, sampleRate: 44100, samples: [{ ...sample, offset: 0 }] });
    const selected = await player.prepare('piano', 60, 127);
    assert.equal(selected.buffer, buffer);
    assert.deepEqual(fetches, []);
});

test('strings keep original authenticated WAVs and verified sustain loops', async context => {
    const { player, fetches } = fixture(context);
    const voice = await player.noteOn('strings', 60, { instrument: 'strings', velocity: 100 });
    assert.equal(voice.source.loop, true);
    assert.ok(voice.source.loopEnd > voice.source.loopStart);
    assert.equal(fetches.length, 2);
    assert.ok(fetches.every(url => url.startsWith('SAMPLES_Q_STRINGS/')));
    player.stop();
});

test('unsupported MP3 decoding falls back once to the same verified full Q WAV, never a synthetic sound', async context => {
    const { player, fetches, decoded } = fixture(context, { decode: (sample, buffer) => {
        if (sample.sourceSha256) throw new DOMException('Unsupported codec', 'EncodingError');
        return buffer;
    } });
    const selected = await player.prepare('piano', 60, 127);
    assert.ok(selected.duration > 15);
    assert.equal(fetches.filter(url => url.endsWith('.mp3')).length, 1);
    assert.deepEqual(fetches.filter(url => url.endsWith('.wav')), ['SAMPLES_Q/samples/C4v16.wav']);
    assert.equal(decoded.length, 2);
    await player.prepare('piano', 60, 127);
    assert.equal(decoded.length, 2);
});

test('the unsupported-codec WAV fallback still enforces original SHA-256 integrity', async context => {
    const { player, sources, decoded } = fixture(context, { corruptOriginal: true, decode: () => {
        throw new DOMException('Unsupported codec', 'EncodingError');
    } });
    await assert.rejects(player.noteOn('bad-fallback', 60, { velocity: 127 }), /integrity check failed/);
    assert.equal(decoded.length, 1);
    assert.equal(sources.length, 0);
    assert.equal(player.metrics.cachedBytes, 0);
});

test('invalid stereo dimensions in both MP3 and WAV reject instead of caching unusable audio', async context => {
    const { player, sources, decoded } = fixture(context, { decode: (sample, buffer) => ({ ...buffer, numberOfChannels: 1 }) });
    await assert.rejects(player.noteOn('bad-dimensions', 60, { velocity: 127 }), /dimensions are invalid/);
    assert.equal(decoded.length, 2);
    assert.equal(sources.length, 0);
    assert.equal(player.metrics.cachedBytes, 0);
});

for (const dimensions of [{ duration: NaN }, { duration: 2 }, { numberOfChannels: 1 }]) {
    test(`invalid MP3 decoder dimensions use verified full WAV instead: ${JSON.stringify(dimensions)}`, async context => {
        const { player, fetches } = fixture(context, { decode: (sample, buffer) => sample.sourceSha256 ? { ...buffer, ...dimensions } : buffer });
        const selected = await player.prepare('piano', 60, 127);
        assert.ok(selected.duration > 15);
        assert.equal(selected.buffer.numberOfChannels, 2);
        assert.ok(fetches.includes('SAMPLES_Q/samples/C4v16.wav'));
    });
}

test('invalid catalog identity, paths, dimensions, provenance and duplicates fail closed before audio downloads', async context => {
    const mutations = [
        catalog => { catalog.id = original.id; },
        catalog => { catalog.sourceId = 'another-piano'; },
        catalog => { catalog.samples[0].file = '../elsewhere.mp3'; },
        catalog => { catalog.samples[0].frames -= 1; },
        catalog => { catalog.samples[0].channels = 1; },
        catalog => { catalog.samples[0].sourceSha256 = '0'.repeat(64); },
        catalog => { catalog.samples[0].sha256 = 'invalid'; },
        catalog => { catalog.samples[1] = catalog.samples[0]; }
    ];
    for (const mutate of mutations) {
        const catalog = structuredClone(compact);
        mutate(catalog);
        const { player, fetches } = fixture(context, { catalog });
        await assert.rejects(player.prepare('piano', 60, 127), /keyboard piano manifest is invalid/);
        assert.equal(fetches.some(url => /\.(wav|mp3)$/.test(url)), false);
        assert.equal(player.metrics.pending, 0);
    }
});

test('corrupt MP3 bytes reject before decoding without hiding integrity failure behind a WAV fallback', async context => {
    const { player, fetches, decoded } = fixture(context, { corrupt: true });
    await assert.rejects(player.noteOn('bad', 60, { velocity: 127 }), /integrity check failed/);
    assert.deepEqual(decoded, []);
    assert.equal(fetches.some(url => url.endsWith('.wav')), false);
    assert.equal(player.metrics.voices, 0);
    assert.equal(player.metrics.pending, 0);
});

test('missing derivative assets fail visibly rather than silently reintroducing huge downloads', async context => {
    const { player, fetches } = fixture(context, { missing: 'SAMPLES_Q_KEYBOARD/samples/C4v16.mp3' });
    await assert.rejects(player.prepare('piano', 60, 127), /Could not load Q sample/);
    assert.equal(fetches.some(url => url.endsWith('.wav')), false);
    assert.equal(player.metrics.pending, 0);
});

test('release during compact loading cancels immediately and cannot create a delayed K capture voice', async context => {
    const gate = deferred();
    const { player, fetches, sources } = fixture(context, { gate });
    const promise = player.noteOn('released', 60, { velocity: 127 });
    while (!fetches.some(url => url.endsWith('.mp3'))) await new Promise(setImmediate);
    player.noteOff('released');
    assert.equal(await promise, null);
    gate.resolve();
    await player.prepare('piano', 60, 127);
    assert.equal(sources.length, 0);
    assert.equal(player.metrics.pending, 0);
});

test('restoring a bank during compact loading prevents stale audio from populating the new generation', async context => {
    const gate = deferred();
    const { player, fetches } = fixture(context, { gate });
    const promise = player.prepare('piano', 60, 127);
    while (!fetches.some(url => url.endsWith('.mp3'))) await new Promise(setImmediate);
    const sampler = player.samplers.get('piano').piano;
    sampler.restored(null, null);
    gate.resolve();
    await assert.rejects(promise, error => error.name === 'AbortError');
    assert.equal(sampler.cache.size, 0);
    assert.ok((await player.prepare('piano', 60, 127)).duration > 15);
});
