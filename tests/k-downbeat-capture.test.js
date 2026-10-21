const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../song-beta-capture-worklet.js'), 'utf8');
function fixture(startFrame, frames) {
    let Processor, messages = [];
    const context = vm.createContext({ Float32Array, Math, currentFrame: 0,
        AudioWorkletProcessor: class { constructor() { this.port = { postMessage: data => messages.push(data) }; } },
        registerProcessor(name, implementation) { Processor = implementation; }
    });
    vm.runInContext(source, context);
    const processor = new Processor({ processorOptions: { startFrame, frames } });
    return { context, processor, messages };
}
for (const rate of [44100, 48000]) {
    test(`K accepts no count-in samples and captures from the exact first downbeat frame at ${rate} Hz`, () => {
        const start = Math.round(rate * 2.08), frames = Math.round(rate * .8);
        const { context, processor, messages } = fixture(start, frames);
        for (let blockStart = 0; blockStart < start + frames + 128; blockStart += 128) {
            context.currentFrame = blockStart;
            const data = Float32Array.from({ length: 128 }, (_, offset) => {
                const frame = blockStart + offset;
                return frame < start ? .75 : frame >= start + frames ? -.75 : (frame - start + 1) / frames;
            });
            const output = new Float32Array(128);
            const active = processor.process([[data]], [[output, new Float32Array(128)]]);
            assert.ok(output.every(v => v === 0), 'capture never duplicates monitored sound');
            if (blockStart + 128 <= start) {
                assert.ok(processor.channels[0].every(v => v === 0), 'count-in never writes into recording');
                assert.equal(messages.length, 0);
            }
            if (!active) break;
        }
        assert.equal(messages.length, 1);
        for (const channel of messages[0].channels) {
            const actual = new Float32Array(channel);
            assert.equal(actual.length, frames);
            for (let i = 0; i < frames; i++) assert.equal(actual[i], Math.fround((i + 1) / frames));
        }
    });
}
test('cancelling capture releases worklet storage and prevents a completion message', () => {
    const { context, processor, messages } = fixture(1000, 2000);
    processor.port.onmessage({ data: { type: 'cancel' } });
    assert.equal(processor.channels.length, 0);
    context.currentFrame = 3000;
    assert.equal(processor.process([[]], [[new Float32Array(128)]]), false);
    assert.equal(messages.length, 0);
});
test('K uses scheduled PCM capture, not count-in MediaRecorder capture and post-trimming', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const begin = html.slice(html.indexOf('async function beginBastardLoopKRecording('), html.indexOf('function cancelBastardLoopKRecording('));
    assert.match(begin, /recordKeyboardKAtTime\(recordingStartTime, recordingDurationSeconds/);
    assert.doesNotMatch(begin, /recordLiveOutputBuffer|captureTrimSeconds|createFixedLengthAudioBufferFromSource/);
    assert.match(html, /mygrainCardHistory\.run\('Clear K', \(\) => clearBastardLoopK\(\)\)/);
});
test('K and Song share one successful worklet load per context, and failed loads can retry', async () => {
    const c = vm.createContext({ URL, Map, WeakMap, Promise, AudioWorkletNode: class {},
        document: { baseURI: 'https://example.test/mygrain/' } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../song-beta-clock.js'), 'utf8'), c);
    let loads = 0;
    const context = { audioWorklet: { addModule(url) { loads++; assert.match(url, /song-beta-capture-worklet\.js\?v=20261021-k-2/); return Promise.resolve(); } } };
    const first = c.MygrainSongClock.prepareCapture(context);
    assert.equal(c.MygrainSongClock.prepareCapture(context), first);
    await first;
    await c.MygrainSongClock.prepareCapture(context);
    assert.equal(loads, 1);
    let attempts = 0;
    const failing = { audioWorklet: { addModule() { return ++attempts === 1 ? Promise.reject(new Error('network failed')) : Promise.resolve(); } } };
    await assert.rejects(c.MygrainSongClock.prepareCapture(failing), /network failed/);
    await c.MygrainSongClock.prepareCapture(failing);
    assert.equal(attempts, 2);
});
