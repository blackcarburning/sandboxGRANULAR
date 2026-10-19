const test = require('node:test');
const assert = require('node:assert/strict');
require('../song-beta.js');
const { filename, layout, wav, MAX_BYTES } = require('../song-beta-export.js');

function buffer(channels) {
    return { length: channels[0].length, numberOfChannels: channels.length, getChannelData: index => channels[index] };
}

function readSample(bytes, frame, channel = 0) {
    const offset = 44 + frame * 6 + channel * 3;
    let integer = bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
    if (integer & 0x800000) integer -= 0x1000000;
    return integer / (integer < 0 ? 0x800000 : 0x7fffff);
}

const part = { id: 'a', name: 'Verse', bpm: 120, patternSteps: 8, repeats: 2 };

test('WAV export includes reused placements without requiring duplicate render buffers', async () => {
    const reference = { ...part, id: 'verse-again', sourcePartId: part.id, repeats: 1 };
    const other = { ...part, id: 'bridge', repeats: 1 };
    const renders = new Map([[part.id, buffer([new Float32Array(8000).fill(.25)])], [other.id, buffer([new Float32Array(8000).fill(-.125)])]]);
    const result = await wav([part, other, reference], renders, 8000);
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    assert.equal(renders.size, 2);
    assert.equal(result.frames, 32000);
    assert.ok(Math.abs(readSample(bytes, 100) - .25) < .000001);
    assert.ok(Math.abs(readSample(bytes, 16100) + .125) < .000001);
    assert.ok(Math.abs(readSample(bytes, 24100) - .25) < .000001);
});

test('song filenames sanitize rename input and retain a single song/tempo postfix', () => {
    assert.equal(filename('Nice take.wav', [part]), 'Nice-take.song.120.wav');
    assert.equal(filename('../../Nice.song.120.wav', [part]), 'Nice.song.120.wav');
    assert.equal(filename('', [part]), 'mygrain.song.120.wav');
    assert.equal(filename('Nice', [part, { ...part, bpm: 90 }, part]), 'Nice.song.120-90.wav');
    assert.equal(filename('Nice.song.120-mixed.wav', Array.from({ length: 64 }, (_, index) => ({ ...part, bpm: 120 + index }))), 'Nice.song.120-mixed.wav');
    assert.throws(() => filename('Nice', [{ ...part, bpm: NaN }]), /invalid tempo/);
});

test('storage-backed export loads one render at a time and preserves order, repeats and stereo samples', async () => {
    const parts = [part, { ...part, id: 'next', repeats: 1 }];
    const loaded = [];
    const result = await wav(parts, async entry => {
        loaded.push(entry.id);
        return buffer([new Float32Array(8000).fill(entry.id === part.id ? .25 : .5)]);
    }, 8000);
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    assert.deepEqual(loaded, ['a', 'next']);
    assert.equal(result.frames, 24000);
    assert.ok(Math.abs(readSample(bytes, 100) - .25) < .000001);
    assert.ok(Math.abs(readSample(bytes, 16100) - .5) < .000001);
});

test('song export writes stereo PCM24 with arrangement repeats, order, levels and exact frame count', async () => {
    const next = { ...part, id: 'b', bpm: 60, repeats: 1 };
    const left = Float32Array.from({ length: 8000 }, () => .25);
    const right = Float32Array.from({ length: 8000 }, () => -.5);
    const second = Float32Array.from({ length: 16000 }, () => -.125);
    const result = await wav([part, next], new Map([['a', buffer([left, right])], ['b', buffer([second])]]), 8000);
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const header = new DataView(bytes.buffer);
    assert.equal(result.frames, 32000);
    assert.equal(bytes.length, 44 + 32000 * 6);
    assert.equal(header.getUint32(4, true), bytes.length - 8);
    assert.equal(header.getUint16(22, true), 2);
    assert.equal(header.getUint32(24, true), 8000);
    assert.equal(header.getUint16(34, true), 24);
    assert.equal(header.getUint32(40, true), result.frames * 6);
    for (const frame of [0, 7999, 8000, 15999]) {
        assert.ok(Math.abs(readSample(bytes, frame) - .25) < .000001);
        assert.ok(Math.abs(readSample(bytes, frame, 1) + .5) < .000001);
    }
    for (const frame of [16000, 31999]) {
        assert.ok(Math.abs(readSample(bytes, frame) + .125) < .000001);
        assert.equal(readSample(bytes, frame), readSample(bytes, frame, 1));
    }
    assert.equal(result.peak, .5);
});

test('mixed tempo boundaries round cumulative song duration rather than each repeat separately', () => {
    const parts = [{ ...part, bpm: 127, patternSteps: 12, repeats: 3 }, { ...part, id: 'b', bpm: 91, patternSteps: 32, repeats: 2 }];
    const renders = new Map(parts.map(entry => [entry.id, buffer([new Float32Array(16)])]));
    const result = layout(parts, renders, 48000);
    assert.equal(result.entries[0].end, Math.round(60 / 127 * 3 * 3 * 48000));
    assert.equal(result.entries[0].end, result.entries[1].start);
    assert.equal(result.frames, Math.round((60 / 127 * 3 * 3 + 60 / 91 * 8 * 2) * 48000));
});

test('render samples are interpolated across repeated patterns with the playback clock rate', async () => {
    const samples = new Float32Array([0, .25, .5, .75]);
    const result = await wav([part], new Map([['a', buffer([samples])]]), 8000);
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    assert.ok(Math.abs(readSample(bytes, 1000) - .125) < .000001);
    assert.ok(Math.abs(readSample(bytes, 7000) - .375) < .000001);
    assert.equal(readSample(bytes, 1000), readSample(bytes, 9000));
});

test('export rejects unarmed, invalid or oversized songs before allocating WAV audio', () => {
    assert.throws(() => layout([part], new Map(), 48000), /Arm Cache/);
    const renders = new Map([['a', buffer([new Float32Array(16)])]]);
    assert.throws(() => layout([], renders, 48000), /requires parts/);
    assert.throws(() => layout([part], renders, 0), /valid sample rate/);
    assert.throws(() => layout([{ ...part, bpm: 40, patternSteps: 64, repeats: 64 }], renders, 48000), /64 MB/);
    assert.throws(() => layout([{ ...part, bpm: 40, patternSteps: 64, repeats: 64 }], null, 48000), /64 MB/);
    assert.equal(MAX_BYTES, 64 * 1024 * 1024);
});

test('Stop cancels chunked song export before upload and original cached audio stays unchanged', async () => {
    const abort = new AbortController();
    abort.abort();
    const samples = new Float32Array([.25, .5]);
    await assert.rejects(wav([part], new Map([['a', buffer([samples])]]), 8000, abort.signal), { name: 'AbortError' });
    assert.deepEqual([...samples], [.25, .5]);
});

test('invalid samples are rejected instead of silently producing corrupt audio', async () => {
    await assert.rejects(wav([part], new Map([['a', buffer([new Float32Array([NaN])])]]), 8000), /invalid audio/);
});
