const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { BUILD, PCMBufferRing, PCMRecorder, S16LEPCMDecoder, encodeWav, stationStreamUrl, stationPriority, Controller } = require('../radiolab.js');

function stereo(values) { return [Float32Array.from(values), Float32Array.from(values, value => -value)]; }

function pcm(wav, channel = 0) {
    const view = new DataView(wav);
    const channels = view.getUint16(22, true);
    return Array.from({ length: view.getUint32(40, true) / (channels * 2) }, (_, frame) => view.getInt16(44 + (frame * channels + channel) * 2, true));
}

test('ring retains exactly fifteen seconds across uneven wrapped PCM blocks', () => {
    const ring = new PCMBufferRing({ sampleRate: 4 });
    for (let start = 0; start < 96; start += 8) ring.append(stereo(Array.from({ length: 8 }, (_, offset) => start + offset)));
    assert.equal(ring.capacity, 60);
    assert.equal(ring.frames, 60);
    assert.equal(ring.written, 96);
    assert.equal(ring.duration, 15);
    assert.deepEqual(Array.from(ring.snapshot()[0]), Array.from({ length: 60 }, (_, offset) => offset + 36));
    assert.deepEqual(Array.from(ring.snapshot(1)[1]), [-92, -93, -94, -95]);
    ring.append(stereo(Array.from({ length: 100 }, (_, offset) => offset + 96)));
    assert.deepEqual(Array.from(ring.snapshot()[0]), Array.from({ length: 60 }, (_, offset) => offset + 136));
});

test('rewind clamps to actual warmup, has a live-edge empty snapshot, and returns copies', () => {
    const ring = new PCMBufferRing({ sampleRate: 4 });
    ring.append(stereo([1, 2, 3, 4, 5, 6]));
    assert.equal(ring.duration, 1.5);
    assert.deepEqual(Array.from(ring.snapshot(15)[0]), [1, 2, 3, 4, 5, 6]);
    assert.equal(ring.snapshot(0)[0].length, 0);
    assert.equal(ring.snapshot(-3)[0].length, 0);
    assert.deepEqual(Array.from(ring.snapshot(0.51)[0]), [5, 6]);
    ring.snapshot()[0].fill(42);
    assert.deepEqual(Array.from(ring.snapshot(0.5)[0]), [5, 6]);
});

test('ring duplicates mono, sanitizes non-finite PCM, and clears private bytes', () => {
    const ring = new PCMBufferRing({ sampleRate: 4 });
    ring.append([Float32Array.from([0.5, NaN, Infinity, -0.25])]);
    assert.deepEqual(Array.from(ring.snapshot()[0]), [0.5, 0, 0, -0.25]);
    assert.deepEqual(ring.snapshot()[0], ring.snapshot()[1]);
    ring.clear();
    assert.equal(ring.frames, 0);
    assert.equal(ring.written, 0);
    assert.ok(ring.data.every(channel => channel.every(value => value === 0)));
});

test('record freezes exact rewind pre-roll then appends new PCM once until Stop', () => {
    const ring = new PCMBufferRing({ sampleRate: 4 });
    ring.append(stereo([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]));
    const recorder = new PCMRecorder({ sampleRate: 4 }).start(ring, 1, { station: { id: 'russian-news' } });
    assert.equal(recorder.frames, 4);
    assert.equal(recorder.metadata.rewindSeconds, 1);
    ring.clear();
    ring.append(stereo([0.9, 0.8, 0.7, 0.6]));
    recorder.append(stereo([0.9, 0.8]));
    recorder.stop();
    const expected = recorder.chunks.flatMap(chunk => Array.from(chunk[0]));
    assert.equal(recorder.duration, 1.5);
    assert.deepEqual(expected.map(value => Math.round(value * 10)), [5, 6, 7, 8, 9, 8]);
    recorder.append(stereo([1, 1, 1, 1]));
    assert.equal(recorder.frames, 6);
    assert.equal(recorder.wav().byteLength, 44 + 6 * 4);
    assert.throws(() => recorder.start(ring, 1));
});

test('live-edge record contains no automatic snapshot, repeat, tempo grid, or padding', () => {
    const ring = new PCMBufferRing({ sampleRate: 8 });
    ring.append(stereo([1, 0, -1, 0]));
    const recorder = new PCMRecorder({ sampleRate: 8 }).start(ring, 0);
    assert.equal(recorder.frames, 0);
    assert.throws(() => recorder.wav());
    recorder.append(stereo([0.1, 0.25, -0.5]));
    assert.throws(() => recorder.wav());
    recorder.stop();
    assert.equal(recorder.duration, 3 / 8);
    assert.deepEqual(pcm(recorder.wav()), [3277, 8192, -16384]);
});

test('recording caps exactly at frame and byte limits including buffered pre-roll', () => {
    const ring = new PCMBufferRing({ sampleRate: 8 });
    ring.append(stereo([1, 1, 1, 1]));
    const recorder = new PCMRecorder({ sampleRate: 8, maxSeconds: 1, maxBytes: 48 }).start(ring, 0.5);
    recorder.append(stereo([0.1, 0.2, 0.3, 0.4]));
    assert.equal(recorder.frames, 6);
    assert.equal(recorder.state, 'stopped');
    assert.equal(recorder.limitReached, true);
    recorder.append(stereo([1, 1]));
    assert.equal(recorder.frames, 6);
    const preRollLimited = new PCMRecorder({ sampleRate: 8, maxSeconds: 0.25 }).start(ring, 0.5);
    assert.equal(preRollLimited.frames, 2);
    assert.equal(preRollLimited.state, 'stopped');
    assert.equal(preRollLimited.limitReached, true);
});

test('PCM WAV is standard stereo PCM16, interleaved and finite, with no loop chunks', () => {
    const wav = encodeWav([stereo([1, -1, 0, 0.5]), [Float32Array.from([NaN])]], 48000);
    const view = new DataView(wav);
    const text = (start, size) => Buffer.from(wav, start, size).toString();
    assert.equal(text(0, 4), 'RIFF');
    assert.equal(text(8, 4), 'WAVE');
    assert.equal(text(12, 4), 'fmt ');
    assert.equal(text(36, 4), 'data');
    assert.equal(view.getUint16(20, true), 1);
    assert.equal(view.getUint16(22, true), 2);
    assert.equal(view.getUint32(24, true), 48000);
    assert.equal(view.getUint32(28, true), 192000);
    assert.equal(view.getUint16(32, true), 4);
    assert.equal(view.getUint16(34, true), 16);
    assert.equal(view.getUint32(4, true), wav.byteLength - 8);
    assert.deepEqual(pcm(wav), [32767, -32768, 0, 16384, 0]);
    assert.deepEqual(pcm(wav, 1), [-32768, 32767, 0, -16384, 0]);
    assert.equal(wav.byteLength, 64);
});

test('Normalize uses one peak across every chunk and channel non-destructively, preserving stereo, silence and metadata', () => {
    const recorder = new PCMRecorder({ sampleRate: 8 }).start(null, 0, { station: { id: 'first' }, capturePath: 'server-pcm-fetch' });
    recorder.append([Float32Array.of(.125, -.25, 0), Float32Array.of(.25, -.5, 0)]);
    recorder.append([Float32Array.of(.0625, .25), Float32Array.of(.125, .375)]);
    recorder.stop();
    const chunks = recorder.chunks;
    const channelReferences = chunks.flat();
    const metadata = recorder.metadata;
    assert.equal(recorder.normalized, false);
    assert.equal(recorder.normalize(), recorder);
    assert.equal(recorder.normalized, true);
    assert.equal(recorder.chunks, chunks);
    assert.ok(recorder.chunks.flat().every((channel, index) => channel === channelReferences[index]));
    assert.equal(recorder.metadata, metadata);
    assert.equal(recorder.frames, 5);
    assert.equal(recorder.duration, 5 / 8);
    assert.deepEqual(chunks.map(chunk => chunk.map(channel => Array.from(channel))), [
        [[.125, -.25, 0], [.25, -.5, 0]], [[.0625, .25], [.125, .375]]
    ]);
    assert.deepEqual(recorder.selectedChunks().map(chunk => chunk.map(channel => Array.from(channel))), [
        [[.25, -.5, 0], [.5, -1, 0]], [[.125, .5], [.25, .75]]
    ]);
    assert.deepEqual(pcm(recorder.wav()), [8192, -16384, 0, 4096, 16384]);
    assert.deepEqual(pcm(recorder.wav(), 1), [16384, -32768, 0, 8192, 24575]);
    const normalized = recorder.wav();
    recorder.normalize().normalize();
    assert.deepEqual(recorder.wav(), normalized);
    recorder.clear();
    assert.equal(recorder.normalized, false);
    assert.ok(channelReferences.every(channel => channel.every(value => value === 0)));
    recorder.start(null).append(stereo([.25]));
    recorder.stop();
    assert.equal(recorder.normalized, false);
});

test('Normalize is deterministic, finite, non-clipping and idempotent for quiet, full-scale and oversized peaks', () => {
    for (const peak of [.0001, .25, 1, 3, 3.4028234663852886e38]) {
        const recorder = new PCMRecorder({ sampleRate: 8 }).start(null);
        recorder.append([Float32Array.of(peak / 2, 0, -peak), Float32Array.of(peak / 4, NaN, Infinity)]);
        recorder.stop().normalize();
        const values = recorder.selectedChunks().flatMap(chunk => chunk.flatMap(channel => Array.from(channel)));
        assert.ok(values.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
        assert.equal(Math.max(...values.map(Math.abs)), 1);
        assert.equal(values[1], 0);
        assert.equal(values[4], 0);
        assert.equal(values[5], 0);
        assert.ok(Math.abs(values[0] - .5) < 1e-7);
        assert.ok(Math.abs(values[3] - .25) < 1e-7);
        const body = recorder.wav();
        recorder.normalize();
        assert.deepEqual(recorder.wav(), body);
    }
});

test('Normalize rejects idle, active, empty and PCM16-silent takes without marking or mutating them', () => {
    const recorder = new PCMRecorder({ sampleRate: 8 });
    assert.throws(() => recorder.normalize(), /Stop a non-empty/);
    recorder.start(null);
    assert.throws(() => recorder.normalize(), /Stop a non-empty/);
    recorder.append(stereo([.25]));
    const raw = recorder.chunks[0][0][0];
    assert.throws(() => recorder.normalize(), /Stop a non-empty/);
    assert.equal(recorder.chunks[0][0][0], raw);
    recorder.clear();
    recorder.start(null).stop();
    assert.throws(() => recorder.normalize(), /Stop a non-empty/);
    recorder.clear();
    recorder.start(null).append([Float32Array.of(0, NaN, Infinity, -Infinity, .000001)]);
    recorder.stop();
    const silent = recorder.wav();
    assert.throws(() => recorder.normalize(), /Stop a non-empty/);
    assert.equal(recorder.normalized, false);
    assert.deepEqual(recorder.wav(), silent);
});

for (const sampleRate of [8, 44100, 48000]) {
    for (const channels of [1, 2]) {
        for (const [start, end] of [[0, 1], [1, 2], [1, 5], [2, 6], [3, 4], [5, 6], [0, 6], [2, 3]]) {
            test(`trim exact selected WAV, raw preview and linked normalized samples: ${sampleRate}Hz/${channels}ch [${start},${end})`, () => {
                const source = [Float32Array.of(1, .125, -.25, 0, .0625, -.5), Float32Array.of(.75, -.0625, .125, 0, .25, .375)].slice(0, channels);
                const recorder = new PCMRecorder({ sampleRate, channels }).start(null);
                for (const [first, last] of [[0, 2], [2, 3], [3, 6]]) recorder.append(source.map(channel => channel.subarray(first, last)));
                recorder.stop();
                const original = recorder.wav();
                const references = recorder.chunks.flat();
                recorder.setTrimFrames(start, end);
                assert.equal(recorder.frames, 6);
                assert.equal(recorder.duration, 6 / sampleRate);
                assert.equal(recorder.selectedFrames, end - start);
                const raw = source.map(channel => channel.subarray(start, end));
                assert.deepEqual(recorder.wav(), encodeWav([raw], sampleRate, channels));
                const joined = Array.from({ length: channels }, (_, channel) => recorder.selectedChunks().flatMap(chunk => Array.from(chunk[channel])));
                assert.deepEqual(joined, raw.map(channel => Array.from(channel)));
                const peak = Math.max(...raw.flatMap(channel => Array.from(channel, Math.abs)));
                if (peak) {
                    const normalized = raw.map(channel => Float32Array.from(channel, value => value / peak));
                    recorder.normalize();
                    const saved = recorder.wav();
                    assert.deepEqual(saved, encodeWav([normalized], sampleRate, channels));
                    assert.equal(new DataView(saved).getUint32(24, true), sampleRate);
                    assert.equal(new DataView(saved).getUint16(22, true), channels);
                    assert.equal(saved.byteLength, 44 + (end - start) * channels * 2);
                    assert.deepEqual(Array.from({ length: channels }, (_, channel) => recorder.selectedChunks().flatMap(chunk => Array.from(chunk[channel]))), normalized.map(channel => Array.from(channel)));
                    recorder.normalize();
                    assert.deepEqual(recorder.wav(), saved);
                } else {
                    assert.equal(recorder.selectionStats().audible, false);
                    assert.throws(() => recorder.normalize(), /non-empty, audible/);
                }
                assert.ok(recorder.chunks.flat().every((channel, index) => channel === references[index]));
                recorder.setTrimFrames(0, 6);
                assert.deepEqual(recorder.wav(), original);
                assert.deepEqual(recorder.chunks.flatMap(chunk => Array.from(chunk[0])), Array.from(source[0]));
            });
        }
    }
}

test('trim clamps frame bounds, rejects nonfinite/active requests and rejects empty normalization and WAV', () => {
    const recorder = new PCMRecorder({ sampleRate: 44100 }).start(null);
    recorder.append(stereo([.125, -.25, .5]));
    assert.throws(() => recorder.setTrimFrames(0, 1), /Stop a non-empty/);
    recorder.stop().setTrimFrames(-100, 100);
    assert.equal(recorder.trimStartFrame, 0);
    assert.equal(recorder.endFrame, 3);
    for (const invalid of [NaN, Infinity, -Infinity]) assert.throws(() => recorder.setTrimFrames(invalid, 2));
    recorder.setTrimFrames(1.49, 1.51);
    assert.equal(recorder.selectedFrames, 1);
    assert.deepEqual(pcm(recorder.normalize().wav()), [-32768]);
    recorder.setTrimFrames(3, -3);
    assert.equal(recorder.selectedFrames, 0);
    assert.throws(() => recorder.normalize(), /non-empty, audible/);
    assert.throws(() => recorder.wav(), /non-empty/);
    recorder.setTrimFrames(0, 3);
    assert.equal(recorder.normalized, false);
    assert.deepEqual(pcm(recorder.wav()), [4096, -8192, 16384]);
});

test('trim and re-normalize never compound gain or destroy removed samples, including a one-frame take', () => {
    const recorder = new PCMRecorder({ sampleRate: 48000 }).start(null);
    recorder.append([Float32Array.of(.875, .03125, -.0625, -.75), Float32Array.of(.5, -.125, .0625, 1)]);
    recorder.stop();
    const raw = recorder.wav();
    recorder.setTrimFrames(1, 3).normalize();
    const selected = recorder.wav();
    assert.deepEqual(pcm(selected), [8192, -16384]);
    assert.deepEqual(pcm(selected, 1), [-32768, 16384]);
    for (let repeat = 0; repeat < 5; repeat += 1) {
        recorder.setTrimFrames(0, 4).normalize();
        assert.deepEqual(recorder.wav(), raw);
        recorder.setTrimFrames(1, 3).normalize();
        assert.deepEqual(recorder.wav(), selected);
    }
    recorder.clear();
    assert.equal(recorder.waveform, null);
    assert.equal(recorder.selection, null);
    recorder.start(null).append(stereo([-.125]));
    recorder.stop().normalize();
    assert.equal(recorder.selectedFrames, 1);
    assert.deepEqual(pcm(recorder.wav()), [-32768]);
});

test('cached waveform stays bounded and selected statistics remain exact across bins and chunks', () => {
    const recorder = new PCMRecorder({ sampleRate: 32000 });
    const left = new Float32Array(32000 * 120).fill(.03125);
    const right = new Float32Array(left.length).fill(-.0625);
    const start = 10001;
    const end = left.length - 7003;
    left[start - 1] = 1;
    right[end] = -1;
    left[start] = .125;
    right[end - 1] = -.25;
    recorder.start(null);
    recorder.append([left.subarray(0, start + 2), right.subarray(0, start + 2)]);
    recorder.append([left.subarray(start + 2), right.subarray(start + 2)]);
    recorder.stop().setTrimFrames(start, end);
    const envelope = recorder.envelope();
    assert.ok(envelope.minimum.length <= 2048);
    assert.equal(recorder.envelope(), envelope);
    assert.equal(recorder.selectionStats().peak, .25);
    recorder.normalize();
    assert.equal(recorder.normalizationGain, 4);
    assert.equal(recorder.envelope(), envelope);
    recorder.setTrimFrames(start + 1, end - 1);
    assert.equal(recorder.selectionStats().peak, .0625);
    assert.equal(recorder.envelope(), envelope);
    recorder.setTrimFrames(start - 1, end + 1);
    assert.equal(recorder.selectionStats().peak, 1);
});

test('recording survives ring/wheel/station mutation and clears its private chunks', () => {
    const ring = new PCMBufferRing({ sampleRate: 4 });
    ring.append(stereo([0.25, 0.5]));
    const recorder = new PCMRecorder({ sampleRate: 4 }).start(ring, 15, { station: { id: 'first' } });
    ring.snapshot(0);
    ring.clear();
    recorder.stop();
    const chunks = recorder.chunks;
    assert.equal(recorder.metadata.station.id, 'first');
    assert.equal(recorder.duration, 0.5);
    assert.deepEqual(pcm(recorder.wav()), [8192, 16384]);
    recorder.clear();
    assert.equal(recorder.frames, 0);
    assert.equal(recorder.metadata, null);
    assert.ok(chunks.every(chunk => chunk.every(channel => channel.every(value => value === 0))));
});

test('PCM constructors reject unbounded or invalid dimensions and changed formats', () => {
    for (const sampleRate of [0, -1, NaN, Infinity]) {
        assert.throws(() => new PCMBufferRing({ sampleRate }));
        assert.throws(() => new PCMRecorder({ sampleRate }));
    }
    assert.throws(() => new PCMBufferRing({ sampleRate: 4, channels: 3 }));
    assert.throws(() => new PCMRecorder({ sampleRate: 4, maxBytes: Infinity }));
    const ring = new PCMBufferRing({ sampleRate: 8 });
    assert.throws(() => new PCMRecorder({ sampleRate: 4 }).start(ring));
});

test('station native media relay is exact same-origin non-API with guarded account query', () => {
    const station = { id: 'radio-news', streamUrl: '/mygrain/radiolab/stream/radio-news?_mygrain_user=wrong&url=https://evil.invalid' };
    const url = new URL(stationStreamUrl(station, 'test user', 'https://example.invalid/mygrain/'));
    assert.equal(url.pathname, '/mygrain/radiolab/stream/radio-news');
    assert.equal(url.searchParams.get('_mygrain_user'), 'test user');
    assert.deepEqual([...url.searchParams.keys()], ['_mygrain_user']);
    for (const streamUrl of ['https://evil.invalid/mygrain/radiolab/stream/radio-news', '/mygrain/api/radiolab/stream/radio-news', '/mygrain/radiolab/stream/other', 'javascript:alert(1)']) assert.throws(() => stationStreamUrl({ ...station, streamUrl }, 'test', 'https://example.invalid/mygrain/'));
    assert.throws(() => stationStreamUrl(station, '', 'https://example.invalid/mygrain/'));
    assert.throws(() => stationStreamUrl({ id: '../other', streamUrl: '/' }, 'test', 'https://example.invalid/mygrain/'));
});

test('station ordering favors spoken and requested languages without hardcoded URLs', () => {
    assert.ok(stationPriority({ language: 'Russian', kind: 'state news' }) < stationPriority({ language: 'English', kind: 'music' }));
    assert.ok(stationPriority({ language: 'zh-CN', kind: 'spoken' }) < stationPriority({ language: 'English', kind: 'spoken' }));
    assert.ok(stationPriority({ language: 'ja', kind: 'public' }) < stationPriority({ language: 'English', kind: 'music' }));
});

test('real worklet transfers copied stereo PCM, outputs silence, bounds its queue and disposes', () => {
    let Processor;
    class ProcessorBase {
        constructor() { this.messages = []; this.port = { postMessage: message => this.messages.push(message) }; }
    }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../radiolab-worklet.js'), 'utf8'), { AudioWorkletProcessor: ProcessorBase, registerProcessor(name, processor) { assert.equal(name, 'mygrain-radiolab-tap'); Processor = processor; }, Float32Array });
    const tap = new Processor();
    const output = [[Float32Array.from([1, 1]), Float32Array.from([1, 1])]];
    const input = [[Float32Array.from([0.25, -0.5])]];
    assert.equal(tap.process(input, output), true);
    assert.equal(tap.messages.length, 0);
    tap.port.onmessage({ data: { type: 'capture', enabled: true } });
    tap.process(input, output);
    assert.deepEqual(Array.from(tap.messages[0].channels[0]), [0.25, -0.5]);
    assert.deepEqual(tap.messages[0].channels[0], tap.messages[0].channels[1]);
    input[0][0].fill(0);
    assert.equal(tap.messages[0].channels[0][0], 0.25);
    assert.ok(output[0].every(channel => channel.every(value => value === 0)));
    for (let count = 0; count < 400; count += 1) tap.process(input, output);
    assert.equal(tap.pending, 256);
    assert.equal(tap.messages.filter(message => message.type === 'overflow').length, 1);
    tap.port.onmessage({ data: { type: 'ack' } });
    assert.equal(tap.pending, 255);
    tap.port.onmessage({ data: { type: 'capture', enabled: false } });
    tap.process(input, output);
    assert.equal(tap.pending, 255);
    tap.port.onmessage({ data: { type: 'dispose' } });
    assert.equal(tap.process(input, output), false);
});

test('HTML integration has stable controls, private folders, guarded full-file loaders and independent build', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    for (const id of ['radiolabCard', 'radiolabStation', 'radiolabListen', 'radiolabRewind', 'radiolabRecord', 'radiolabStop', 'radiolabPreview', 'radiolabNormalize', 'radiolabNormalizeHelp', 'radiolabName', 'radiolabSave', 'radiolabBrowser', 'radiolabSamplesDialog', 'radiolabSampleList', 'radiolabLoadTarget', 'radiolabBrowserClose', 'performanceBastardLoopVUseRadiolabBtn', 'sectionJumpRadiolabBtn']) assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, id);
    assert.match(html, /GRAIN_SAMPLE_BROWSER_SOURCE_LABELS = \{\s+samples_radiolab: 'SAMPLES_RADIOLAB'/);
    assert.match(html, /BASTARD_LOOP_SOURCE_LABELS = \{\s+samples_radiolab: 'SAMPLES_RADIOLAB'/);
    assert.match(html, /id="performanceBastardLoopVSampleFolder"[^>]*><option value="samples_radiolab"/);
    assert.equal(BUILD, 'v2026.10.27.RADIO-V.1');
    const buildMarkers = Array.from(html.matchAll(/Build <strong>(v\d{4}\.\d{2}\.\d{2}\.[A-Z-]+\.\d+)<\/strong>/g), match => match[1]);
    assert.equal(buildMarkers.length, 2);
    assert.equal(new Set(buildMarkers).size, 1);
    const dialog = html.match(/<dialog id="radiolabSamplesDialog"[\s\S]*?<\/dialog>/)[0];
    assert.doesNotMatch(dialog, /radiolabPlaySample|radiolabPreviewStop|id="radiolabLoad"|<select id="radiolabSampleList"/);
    assert.equal((dialog.match(/>Close<\/button>/g) || []).length, 1);
    for (const target of ['grainMain', 'grainA', 'grainB', 'V']) assert.match(dialog, new RegExp(`<option value="${target}">`));
    assert.match(html, /q-card\.js\?v=20261016-k-keyboard-19/);
    assert.match(html, /mygrain-accounts\.js\?v=20261017-account-credits-r2/);
    assert.match(html, /fallback\.guard\?\.\(\);\s+await applyLoadedAudioBuffer/);
    assert.match(html, /setBastardLoopVCut\(\{ enabled: false, start: 0, end: 1 \}/);
    for (const asset of ['radiolab.js', 'radiolab.css', 'radiolab-worklet.js']) assert.ok(fs.existsSync(path.join(__dirname, '..', asset)));
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (!/\bsrc=|type=["']module/.test(match[1])) assert.doesNotThrow(() => new vm.Script(match[2]));
});

test('read-only controller state exposes metadata only, never PCM', () => {
    const controller = Object.create(Controller.prototype);
    Object.assign(controller, { locked: false, username: 'test', listening: true, monitor: false, rewind: 2, ring: { duration: 12 }, recorder: { state: 'recording', duration: 5 }, tapKind: 'AudioWorklet' });
    controller.element = () => ({ value: 'station' });
    const state = controller.state;
    assert.equal(state.recording, true);
    assert.equal(state.monitoring, false);
    assert.equal(state.bufferSeconds, 0);
    assert.equal(state.rewindSeconds, 0);
    assert.equal(state.recordedSeconds, 5);
    assert.ok(Object.isFrozen(state));
    assert.equal('ring' in state, false);
    assert.equal('chunks' in state, false);
});

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function previewController(context) {
    const controller = Object.create(Controller.prototype);
    Object.assign(controller, { epoch: 0, previewEpoch: 0, locked: false, listening: true, recorder: { state: 'recording' }, dialog: { open: true } });
    controller.ensureContext = async () => context;
    controller.assertActive = () => {};
    controller.syncMonitor = () => {};
    controller.render = () => {};
    return controller;
}

test('Stop Preview during delayed context resume prevents late playback without touching radio', async () => {
    const resumed = deferred();
    let sources = 0;
    const context = { createBuffer() { sources += 1; } };
    const controller = previewController(context);
    controller.ensureContext = () => resumed.promise;
    const playing = controller.playPCM(stereo([0.1, 0.2]), 4);
    controller.stopPreview();
    resumed.resolve(context);
    await playing;
    assert.equal(sources, 0);
    assert.equal(controller.listening, true);
    assert.equal(controller.recorder.state, 'recording');
});

test('sample change or Stop Preview during delayed download cancels before decode', async () => {
    const downloaded = deferred();
    let decodes = 0;
    const controller = previewController({ decodeAudioData() { decodes += 1; } });
    controller.sampleBody = () => downloaded.promise;
    const playing = controller.playSample({ filename: 'test.wav' });
    await Promise.resolve();
    controller.stopPreview();
    downloaded.resolve(new ArrayBuffer(8));
    await playing;
    assert.equal(decodes, 0);
    assert.equal(controller.listening, true);
});

test('Stop Preview or dialog close during delayed decode cannot restart saved-sample preview', async () => {
    const decoded = deferred();
    const started = deferred();
    let plays = 0;
    const controller = previewController({ decodeAudioData() { started.resolve(); return decoded.promise; } });
    controller.sampleBody = async () => new ArrayBuffer(8);
    controller.playPCM = async () => { plays += 1; };
    const playing = controller.playSample({ filename: 'test.wav' });
    await started.promise;
    controller.stopPreview();
    controller.dialog.open = false;
    decoded.resolve({ numberOfChannels: 2, sampleRate: 4, getChannelData: () => Float32Array.from([0.1, 0.2]) });
    await playing;
    assert.equal(plays, 0);
    assert.equal(controller.listening, true);
    assert.equal(controller.recorder.state, 'recording');
});

test('ring signal detection follows the current rewind window and retains quiet nonzero input', () => {
    const ring = new PCMBufferRing({ sampleRate: 4, seconds: 1 });
    assert.equal(ring.hasSignal, false);
    ring.append([Float32Array.from([0, NaN, Infinity, -Infinity])]);
    assert.equal(ring.hasSignal, false);
    ring.append([Float32Array.from([0.000000001])]);
    assert.equal(ring.hasSignal, true);
    ring.append(stereo([0, 0, 0, 0]));
    assert.equal(ring.hasSignal, false);
    ring.append([Float32Array.from([0]), Float32Array.from([1 / 32768])]);
    assert.equal(ring.hasSignal, true);
    ring.append(stereo([0, 0, 0]));
    assert.equal(ring.hasSignal, true);
    ring.append(stereo([0]));
    assert.equal(ring.hasSignal, false);
    ring.append(stereo([0.25]));
    ring.clear();
    assert.equal(ring.hasSignal, false);
});

test('recorder distinguishes a silent PCM16 take from real signal without dropping silent spans', () => {
    const ring = new PCMBufferRing({ sampleRate: 8 });
    ring.append(stereo([0, 0, 0, 0]));
    const recorder = new PCMRecorder({ sampleRate: 8 }).start(ring, .5);
    recorder.append([Float32Array.from([NaN, Infinity, 0.000001, -0.000001])]);
    assert.equal(recorder.hasSignal, false);
    recorder.stop();
    assert.ok(pcm(recorder.wav()).every(value => value === 0));
    const audible = new PCMRecorder({ sampleRate: 8 }).start(ring, .5);
    audible.append([Float32Array.from([0, 0]), Float32Array.from([0, -1 / 32768])]);
    audible.append(stereo([0, 0]));
    assert.equal(audible.hasSignal, true);
    audible.stop();
    assert.equal(audible.frames, 8);
    assert.deepEqual(pcm(audible.wav(), 1), [0, 0, 0, 0, 0, -1, 0, 0]);
    audible.clear();
    assert.equal(audible.hasSignal, false);
});

function silentTakeController() {
    const ring = new PCMBufferRing({ sampleRate: 8 });
    ring.append(stereo(Array(8).fill(0)));
    const recorder = new PCMRecorder({ sampleRate: 8 }).start(ring, 1, { station: { id: 'fixture', name: 'Silent station' } });
    const elements = new Map();
    const controller = Object.assign(Object.create(Controller.prototype), {
        ring, recorder, epoch: 0, previewEpoch: 0, locked: false, listening: true,
        stations: [], rewind: 0, busy: false, monitor: true,
        assertActive() {}, syncMonitor() {}, stopPreview() {},
        element(id) {
            if (!elements.has(id)) elements.set(id, { value: 'Silent station', style: { setProperty() {} }, setAttribute() {}, toggleAttribute() {}, replaceChildren() {} });
            return elements.get(id);
        }
    });
    return controller;
}

test('silent decoded stream and stopped take are warned, not advertised as ready or saveable', () => {
    const controller = silentTakeController();
    controller.render();
    assert.match(controller.element('radiolabRewindValue').textContent, /no rewind or pre-roll/i);
    assert.equal(controller.element('radiolabRecord').disabled, true);
    assert.match(controller.element('radiolabTake').textContent, /Recording digital silence/);
    controller.stop();
    assert.match(controller.element('radiolabStatus').textContent, /only digital silence/i);
    assert.doesNotMatch(controller.element('radiolabTake').textContent, /Take ready/);
    assert.match(controller.element('radiolabTake').textContent, /silent take/i);
    assert.equal(controller.element('radiolabSave').disabled, true);
});

function manualRecordController(hooks = {}) {
    const controller = silentTakeController();
    controller.recorder.stop();
    controller.ring.clear();
    controller.listening = false;
    controller.monitor = false;
    controller.stations = [{ id: 'fixture', name: 'Test station', streamUrl: '/mygrain/radiolab/stream/fixture' }];
    controller.element('radiolabStation').value = 'fixture';
    controller.recorder = new PCMRecorder({ sampleRate: 8 }).start(null, 0, { station: { id: 'previous' } });
    controller.recorder.append(stereo([.5, -.5]));
    controller.recorder.stop();
    controller.username = 'fixture-user';
    const requests = [];
    const releases = [];
    const timers = new Map();
    const queue = [];
    let waiter;
    let timerId = 0;
    let cancelled = 0;
    const send = result => {
        if (waiter) { const resolve = waiter; waiter = null; resolve(result); }
        else queue.push(result);
    };
    const reader = {
        read() { return queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => { waiter = resolve; }); },
        cancel() { cancelled += 1; if (!hooks.lateReader) send({ done: true }); return Promise.resolve(); }
    };
    const response = {
        ok: true, status: 200,
        headers: new Headers({ 'Content-Type': 'application/octet-stream', 'X-Radiolab-Sample-Rate': '44100', 'X-Radiolab-Channels': '2' }),
        body: { getReader: () => reader }, ...hooks.response
    };
    controller.root = {
        mygrainAccounts: { authenticated: true, user: { username: controller.username } },
        location: { href: 'http://localhost/mygrain/' }, document: { baseURI: 'http://localhost/mygrain/' },
        fetch(url, options) {
            const request = { url: new URL(url, 'http://localhost'), options };
            if (request.url.pathname.endsWith('/release')) { releases.push(request); return Promise.resolve({ ok: true }); }
            requests.push(request);
            return hooks.fetch ? hooks.fetch(request) : Promise.resolve(response);
        },
        setInterval, clearInterval,
        setTimeout(handler) { timers.set(++timerId, handler); return timerId; },
        clearTimeout(identifier) { timers.delete(identifier); }
    };
    controller.assertActive = Controller.prototype.assertActive;
    controller.dialog = { open: false };
    controller.requests = new Set();
    controller.requestEpoch = 0;
    controller.fixture = {
        requests, releases, timers,
        push(bytes) { send({ value: new Uint8Array(bytes), done: false }); },
        end() { send({ done: true }); },
        expire() { for (const [identifier, handler] of Array.from(timers)) if (timers.has(identifier)) handler(); },
        get cancelled() { return cancelled; }
    };
    return controller;
}

function rawPCM(values) { return new Uint8Array(encodeWav([stereo(values)], 44100), 44); }
async function flushCapture() { await new Promise(resolve => setImmediate(resolve)); }

test('S16LE decoder preserves exact signed stereo values at every arbitrary network byte boundary', () => {
    const raw = Buffer.alloc(24);
    [-32768, 32767, -1, 1, 0, 0, 8192, -8192, 42, -42, 32766, -32767].forEach((value, offset) => raw.writeInt16LE(value, offset * 2));
    for (let split = 0; split <= raw.length; split += 1) {
        const decoder = new S16LEPCMDecoder();
        const chunks = [decoder.decode(raw.subarray(0, split)), decoder.decode(raw.subarray(split))];
        assert.deepEqual(new Uint8Array(encodeWav(chunks, 44100), 44), new Uint8Array(raw));
        assert.equal(decoder.remainder.length, 0);
    }
    const decoder = new S16LEPCMDecoder();
    assert.equal(decoder.decode(Uint8Array.of(1, 2, 3))[0].length, 0);
    const privateBytes = decoder.remainder;
    decoder.clear();
    assert.deepEqual(Array.from(privateBytes), [0, 0, 0]);
    assert.equal(decoder.remainder.length, 0);
    assert.throws(() => new S16LEPCMDecoder(1), /stereo/);
});

test('idle manual recording needs no AudioContext, media element, permission, tap or ring signal', async () => {
    const controller = manualRecordController();
    controller.ring = null;
    controller.context = null;
    controller.prepareContext = () => { throw new Error('must not touch WebAudio'); };
    controller.listen = () => { throw new Error('must not auto-tune monitoring'); };
    const retained = controller.recorder;
    await controller.run(() => controller.record());
    assert.equal(controller.state.armed, true);
    assert.equal(controller.busy, false);
    assert.equal(controller.recorder, retained);
    assert.equal(controller.element('radiolabStop').disabled, false);
    const request = controller.fixture.requests[0];
    assert.equal(request.url.searchParams.get('_radiolab_format'), 'pcm');
    assert.equal(request.url.searchParams.get('_mygrain_user'), 'fixture-user');
    assert.match(request.url.searchParams.get('_radiolab_client'), /-pcm$/);
    assert.equal(request.options.credentials, 'same-origin');
    assert.equal(request.options.cache, 'no-store');
    controller.fixture.push(rawPCM([.25, -.5, 0, .75]));
    await flushCapture();
    assert.equal(controller.state.armed, false);
    assert.equal(controller.state.recording, true);
    assert.equal(controller.recorder.sampleRate, 44100);
    assert.equal(controller.recorder.frames, 4);
    assert.equal(controller.recorder.metadata.rewindSeconds, 0);
    assert.equal(controller.recorder.hasSignal, true);
    controller.stop();
    assert.equal(controller.fixture.cancelled, 1);
    assert.equal(controller.fixture.timers.size, 0);
    assert.equal(controller.element('radiolabSave').disabled, false);
    assert.deepEqual(new Uint8Array(controller.recorder.wav(), 44), rawPCM([.25, -.5, 0, .75]));
});

for (const tapMode of ['zeros', 'no-callback']) test('audible advancing native monitor with ' + tapMode + ' still records independent nonzero PCM exactly once', async () => {
    const controller = manualRecordController();
    controller.listening = true;
    controller.monitor = true;
    controller.audio = { paused: false, readyState: 3, currentTime: 8.69 };
    controller.detach = () => {};
    controller.context = { state: 'running', sampleRate: 48000 };
    controller.rewind = 12;
    await controller.record();
    if (tapMode === 'zeros') controller.acceptPCM(stereo([0, 0, 0, 0]));
    assert.equal(controller.state.armed, true);
    controller.fixture.push(rawPCM([.25, -.5, .5]));
    await flushCapture();
    assert.equal(controller.diagnostics.hasSignal, false);
    assert.equal(controller.diagnostics.takeHasSignal, true);
    assert.equal(controller.recorder.frames, 3);
    controller.acceptPCM(stereo([.5, -.5]));
    assert.equal(controller.recorder.frames, 3, 'tap PCM cannot contaminate or duplicate server PCM');
    assert.equal(controller.recorder.metadata.rewindSeconds, 0);
    assert.match(controller.element('radiolabStatus').textContent, /independent.*lag monitoring/i);
    assert.deepEqual(controller.diagnostics.capture, { path: 'server-pcm-fetch', state: 'recording', bytes: 12, sampleRate: 44100, channels: 2 });
    controller.stop();
    assert.deepEqual(new Uint8Array(controller.recorder.wav(), 44), rawPCM([.25, -.5, .5]));
});

for (const reason of ['capacity', 'unauthorized', 'bad-format', 'missing-body', 'network', 'empty', 'partial-frame']) test('failed capture start retains previous take/name and allows retry: ' + reason, async () => {
    const response = reason === 'capacity' ? { ok: false, status: 429 }
        : reason === 'unauthorized' ? { ok: false, status: 401 }
        : reason === 'bad-format' ? { headers: new Headers({ 'Content-Type': 'audio/mpeg' }) }
        : reason === 'missing-body' ? { body: null } : {};
    const controller = manualRecordController({ response, fetch: reason === 'network' ? () => Promise.reject(new Error('Network connection lost')) : undefined });
    const retained = controller.recorder;
    const bytes = retained.wav();
    controller.element('radiolabName').value = 'Keep this take';
    await controller.run(() => controller.record());
    if (reason === 'partial-frame') controller.fixture.push(Uint8Array.of(1, 2, 3));
    if (reason === 'empty' || reason === 'partial-frame') controller.fixture.end();
    await flushCapture();
    assert.equal(controller.state.armed || controller.state.recording || controller.busy, false);
    assert.equal(controller.recorder, retained);
    assert.deepEqual(retained.wav(), bytes);
    assert.equal(controller.element('radiolabName').value, 'Keep this take');
    assert.equal(controller.element('radiolabRecord').disabled, false);
    assert.equal(controller.element('radiolabSave').disabled, false);
    assert.equal(controller.diagnostics.capture.state, 'failed');
    assert.equal(controller.fixture.timers.size, 0);
    assert.equal(controller.fixture.releases.length, 1);
    if (reason === 'capacity') assert.match(controller.element('radiolabStatus').textContent, /capacity.*close or stop another radio tab.*retry Record/i);
});

for (const phase of ['fetch', 'first-byte', 'silence', 'fragment']) test('bounded first-nonzero deadline does not leave Record armed or busy: ' + phase, async () => {
    const controller = manualRecordController({ fetch: phase === 'fetch' ? () => new Promise(() => {}) : undefined });
    const retained = controller.recorder;
    const starting = controller.run(() => controller.record());
    if (phase !== 'fetch') await starting;
    if (phase === 'silence') controller.fixture.push(rawPCM([0, 0, 0, 0]));
    if (phase === 'fragment') controller.fixture.push(Uint8Array.of(1));
    await flushCapture();
    controller.fixture.expire();
    await starting;
    await flushCapture();
    assert.equal(controller.state.armed || controller.state.recording || controller.busy, false);
    assert.equal(controller.recorder, retained);
    assert.equal(controller.fixture.timers.size, 0);
    assert.match(controller.element('radiolabStatus').textContent, /within 12 seconds/i);
    assert.equal(controller.diagnostics.capture.state, 'failed');
});

test('digital silence byte budget fails fast without replacing an audible finished take', async () => {
    const controller = manualRecordController();
    const retained = controller.recorder;
    await controller.record();
    controller.fixture.push(new Uint8Array(44100 * 4 * 12));
    await flushCapture();
    assert.equal(controller.state.armed, false);
    assert.equal(controller.recorder, retained);
    assert.match(controller.element('radiolabStatus').textContent, /only digital silence/i);
    assert.equal(controller.fixture.timers.size, 0);
});

test('stalled read ends an audible take without manufacturing silence or losing captured PCM', async () => {
    const controller = manualRecordController();
    await controller.run(() => controller.record());
    controller.fixture.push(rawPCM([.25, -.5, 0]));
    await flushCapture();
    controller.fixture.expire();
    await flushCapture();
    assert.equal(controller.state.armed || controller.state.recording || controller.busy, false);
    assert.equal(controller.recorder.frames, 3);
    assert.equal(controller.element('radiolabSave').disabled, false);
    assert.match(controller.element('radiolabStatus').textContent, /stalled.*retained/i);
    assert.equal(controller.fixture.timers.size, 0);
});

test('rewind input and audition cannot expose an unsupported buffer or alter live recording metadata', async () => {
    const controller = manualRecordController();
    controller.ring.append(stereo([.5, -.5]));
    controller.setRewind(15);
    assert.equal(controller.rewind, 0);
    assert.equal(controller.state.rewindSeconds, 0);
    assert.equal(controller.state.bufferSeconds, 0);
    assert.equal(controller.element('radiolabRewind').disabled, true);
    assert.equal(controller.element('radiolabAudition').disabled, true);
    await assert.rejects(controller.auditionRing(), /rewind is unavailable/i);
    await controller.record();
    controller.fixture.push(rawPCM([.25, -.25]));
    await flushCapture();
    assert.equal(controller.recorder.frames, 2);
    assert.equal(controller.recorder.metadata.rewindSeconds, 0);
    controller.stop();
});

test('sub-frame fragments cannot reset a stalled recording deadline', async () => {
    const controller = manualRecordController();
    await controller.record();
    controller.fixture.push(rawPCM([.25, -.25]));
    await flushCapture();
    const timer = controller.captureOperation.timer;
    controller.fixture.push(Uint8Array.of(1));
    await flushCapture();
    assert.equal(controller.captureOperation.timer, timer);
    controller.fixture.expire();
    await flushCapture();
    assert.equal(controller.recorder.state, 'stopped');
    assert.equal(controller.recorder.frames, 2);
});

test('Stop and new Record isolate client scopes and generations and ignore a cancelled reader completing late', async () => {
    const controller = manualRecordController({ lateReader: true });
    const retained = controller.recorder;
    await controller.record();
    const old = controller.captureOperation;
    controller.stop();
    controller.fixture.push(rawPCM([.9, -.9]));
    await flushCapture();
    assert.equal(controller.recorder, retained);
    assert.equal(controller.state.armed || controller.state.recording, false);
    assert.equal(old.abort.signal.aborted, true);
    await controller.record();
    assert.equal(controller.captureOperation.client, old.client);
    assert.ok(controller.captureOperation.generation > old.generation);
    controller.fixture.push(rawPCM([.25, -.25]));
    await flushCapture();
    assert.equal(controller.recorder.frames, 2);
    controller.stop();
    const release = controller.fixture.releases[0];
    assert.equal(release.url.searchParams.get('_radiolab_client'), old.client);
    assert.equal(release.url.searchParams.get('_radiolab_generation'), String(old.generation));
    assert.equal(controller.fixture.timers.size, 0);
});

test('capture diagnostics expose bounded state and byte counts but never private URLs/accounts/tokens or audio', async () => {
    const controller = manualRecordController();
    await controller.record();
    controller.fixture.push(rawPCM([.25, -.25]));
    await flushCapture();
    const diagnostics = controller.diagnostics;
    assert.equal(diagnostics.capture.bytes, 8);
    diagnostics.capture.bytes = 999;
    assert.equal(controller.diagnostics.capture.bytes, 8);
    const serialized = JSON.stringify(controller.diagnostics);
    for (const secret of ['fixture-user', controller.streamClient, 'http:', 'channels":[' ]) assert.ok(!serialized.includes(secret));
    controller.dispose(true);
    assert.equal(controller.diagnostics.capture, null);
    assert.deepEqual(controller.diagnostics.events, []);
    assert.equal(controller.recorder, null);
    assert.equal(controller.fixture.timers.size, 0);
    assert.equal(controller.fixture.releases.length, 1);
});

test('Save refuses an all-zero take before upload and retains the original PCM', async () => {
    const controller = silentTakeController();
    controller.recorder.stop();
    let uploads = 0;
    controller.request = async () => { uploads += 1; return { sample: { name: 'Silent station' } }; };
    await assert.rejects(controller.save(), /only digital silence/i);
    assert.equal(uploads, 0);
    assert.equal(controller.recorder.frames, 8);
    assert.ok(pcm(controller.recorder.wav()).every(value => value === 0));
});

test('saved all-zero PCM is identified before preview or loading while genuine samples remain byte-exact', async () => {
    const silent = encodeWav([stereo([0, 0, 0, 0])], 8000);
    const controller = Object.assign(Object.create(Controller.prototype), { request: async () => silent });
    await assert.rejects(controller.sampleBody({ filename: 'silent.wav' }), /saved sample contains only digital silence/i);
    const audible = encodeWav([stereo([0, 0, 1 / 32768, 0])], 8000);
    controller.request = async () => audible;
    assert.equal(await controller.sampleBody({ filename: 'audible.wav' }), audible);
});

test('saved silence detection handles unsigned PCM8, signed PCM24/32 and padded ancillary chunks', async () => {
    for (const bits of [8, 24, 32]) {
        const bytes = new Uint8Array(64 + bits / 8 * 4);
        const view = new DataView(bytes.buffer);
        const text = (offset, value) => { for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index); };
        text(0, 'RIFF');
        view.setUint32(4, bytes.length - 8, true);
        text(8, 'WAVEfmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint16(34, bits, true);
        text(36, 'JUNK');
        view.setUint32(40, 3, true);
        bytes.fill(99, 44, 47);
        text(48, 'LIST');
        view.setUint32(52, 0, true);
        text(56, 'data');
        view.setUint32(60, bytes.length - 64, true);
        bytes.fill(bits === 8 ? 128 : 0, 64);
        const controller = Object.assign(Object.create(Controller.prototype), { request: async () => bytes.buffer });
        await assert.rejects(controller.sampleBody({ filename: 'silent.wav' }), /only digital silence/i, `${bits}-bit silence`);
        bytes[bytes.length - 1] += 1;
        assert.equal(await controller.sampleBody({ filename: 'signal.wav' }), bytes.buffer, `${bits}-bit signal`);
    }
});
