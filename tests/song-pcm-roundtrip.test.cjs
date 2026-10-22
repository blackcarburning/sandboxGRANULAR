const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const adapter = fs.readFileSync(path.join(__dirname, '../song-beta-adapter.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function extract(text, name) {
    const match = text.match(new RegExp(`    function ${name}\\([\\s\\S]*?\\n    \\}`));
    assert.ok(match, name); return match[0];
}
function fixture() {
    const context = vm.createContext({DataView, ArrayBuffer, Float32Array, Array, Math, songPcm16Sources: new WeakSet()});
    for (const name of ['audioBufferToWav', 'interleaveChannels', 'writeString']) {
        const start = html.indexOf(`        function ${name}(`), end = html.indexOf('\n        }', start) + '\n        }'.length;
        assert.ok(start > 0); vm.runInContext(html.slice(start, end), context);
    }
    for (const name of ['markSongPcm16Source', 'encodeSongSource']) vm.runInContext(extract(adapter, name), context);
    return context;
}
function buffer(channels, sampleRate = 48000) {
    return {length: channels[0].length, numberOfChannels: channels.length, sampleRate, getChannelData: channel => channels[channel]};
}
function bytes(body) {return new Uint8Array(body);}

test('every signed PCM16 sample survives repeated mono/stereo Song decode/save byte-for-byte', () => {
    for (const count of [1, 2]) {
        const c = fixture();
        const channels = Array.from({length: count}, (_, channel) => Float32Array.from({length: 65536}, (_, i) => ((channel ? 65535 - i : i) - 32768) / 32768));
        const source = buffer(channels);
        const expected = c.audioBufferToWav(source), expectedView = new DataView(expected);
        let offset = 44;
        for (let frame = 0; frame < source.length; frame++) for (const channel of channels) {expectedView.setInt16(offset, channel[frame] * 32768, true); offset += 2;}
        let previous = bytes(expected);
        for (let pass = 0; pass < 4; pass++) {
            const view = new DataView(previous.buffer), decodedChannels = channels.map(() => new Float32Array(source.length));
            offset = 44;
            for (let frame = 0; frame < source.length; frame++) for (const channel of decodedChannels) {channel[frame] = view.getInt16(offset, true) / 32768; offset += 2;}
            const decoded = buffer(decodedChannels); c.markSongPcm16Source(previous, decoded);
            assert.equal(c.songPcm16Sources.has(decoded), true);
            const actual = bytes(c.encodeSongSource(decoded)); assert.deepEqual(actual, previous); previous = actual;
        }
    }
});

test('fresh recordings and generated buffers retain the existing export encoding', () => {
    const c = fixture(), source = buffer([Float32Array.from([-1, -.3333, 0, .1, .5, 1])], 44100);
    assert.deepEqual(bytes(c.encodeSongSource(source)), bytes(c.audioBufferToWav(source)));
});

test('PCM16 provenance is not applied to resampled, resized or differently encoded WAVs', () => {
    const c = fixture(), source = buffer([new Float32Array(8)]), canonical = bytes(c.audioBufferToWav(source));
    for (const target of [buffer([new Float32Array(8)], 44100), buffer([new Float32Array(9)]), buffer([new Float32Array(8), new Float32Array(8)])]) {
        c.markSongPcm16Source(canonical, target); assert.equal(c.songPcm16Sources.has(target), false);
    }
    const otherEncoding = canonical.slice(); new DataView(otherEncoding.buffer).setUint16(34, 24, true);
    c.markSongPcm16Source(otherEncoding, source); assert.equal(c.songPcm16Sources.has(source), false);
});

test('actual source edits still change encoded bytes; tagging never substitutes stale audio', () => {
    const c = fixture(), samples = new Float32Array([0, .25, -.5]), source = buffer([samples]);
    const original = bytes(c.audioBufferToWav(source)); c.markSongPcm16Source(original, source);
    const before = bytes(c.encodeSongSource(source)); samples[0] = .75;
    const after = bytes(c.encodeSongSource(source)); assert.notDeepEqual(after, before); assert.equal(new DataView(after.buffer).getInt16(44, true), 24576);
});
