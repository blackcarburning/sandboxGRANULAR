const test = require('node:test');
const assert = require('node:assert/strict');
const radio = require('../radiolab.js');
const { parseYouTubeURL, captureSettings, apiBase, capturePhase, seedRecorder, Controller, TARGETS } = require('../videolab.js');

function audio(channels, sampleRate = 8000) {
    return { length: channels[0].length, numberOfChannels: channels.length, sampleRate, getChannelData: channel => channels[channel] };
}

function values(body) {
    const view = new DataView(body);
    return Array.from({ length: (body.byteLength - 44) / 2 }, (_, index) => view.getInt16(44 + index * 2, true));
}

test('single-video URL validation canonicalises supported YouTube forms without playlist retrieval', () => {
    for (const url of ['https://youtu.be/abcdefghijk?t=9', 'https://m.youtube.com/watch?v=abcdefghijk&list=PLAYLIST', 'https://www.youtube.com/shorts/abcdefghijk', 'https://www.youtube.com/live/abcdefghijk', 'https://youtube.com/embed/abcdefghijk']) {
        assert.deepEqual(parseYouTubeURL(url), { kind: 'video', videoID: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk' });
    }
    assert.equal(parseYouTubeURL('https://www.youtube.com/@BBCArchive').kind, 'channel');
    assert.equal(parseYouTubeURL('https://youtube.com/channel/UCabcdef/videos').kind, 'channel');
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://evil.test/@BBCArchive', 'https://youtube.com@evil.test/', 'https://user:pass@youtube.com/watch?v=abcdefghijk', 'https://youtube.com:8080/watch?v=abcdefghijk', 'https://youtube.com/playlist?list=abc', 'https://youtube.com/watch?v=abc', '', 'https://youtu.be/../../localhost']) assert.throws(() => parseYouTubeURL(url));
});

test('capture settings strictly bound a finite interval and base URL follows deployment path', () => {
    assert.deepEqual(captureSettings('00:00', '120'), { startSeconds: 0, durationSeconds: 120 });
    assert.deepEqual(captureSettings('02:30', '120'), { startSeconds: 150, durationSeconds: 120 });
    assert.equal(captureSettings(' 2:30 ', 120).startSeconds, 150);
    assert.equal(captureSettings('65:04', 120).startSeconds, 3904);
    assert.equal(captureSettings('360:00', 120).startSeconds, 21600);
    assert.deepEqual(captureSettings('00:01.5', 180), { startSeconds: 1.5, durationSeconds: 180 });
    for (const settings of [['00:00', 181], ['-01:00', 120], ['360:01', 10], [NaN, 10], ['00:00', Infinity], ['00:00', 0], ['', 120], ['00:00', ''], ['abc', 120], ['02:60', 120], ['1:2', 120], ['150', 120], ['1:02:30', 120], ['00:00.0001', 120]]) assert.throws(() => captureSettings(...settings));
    assert.throws(() => captureSettings('02:60', 120), /minutes:seconds \(mm:ss\)/);
    assert.equal(apiBase('https://host/mygrain/index.html?x=1').href, 'https://host/mygrain/api/videolab/');
    assert.equal(apiBase('https://host/staging/mygrain/').href, 'https://host/staging/mygrain/api/videolab/');
    assert.deepEqual(Object.values(TARGETS), ['Apply', 'V', 'Grain A', 'Grain B']);
    for (const phase of ['ready', 'complete', 'completed', 'done']) assert.equal(capturePhase({ phase }), 'ready');
    assert.equal(capturePhase({ status: 'failed' }), 'error');
    assert.equal(capturePhase({ state: 'canceled' }), 'cancelled');
});

test('real RadioLab PCM trim, normalise and Save encode exactly the selected stereo samples', async () => {
    const recorder = seedRecorder(audio([Float32Array.from([1, 0.1, 0.25, -0.5, 0.125, -1]), Float32Array.from([-1, 0.2, -0.125, 0.25, -0.25, 1])]), radio);
    recorder.setTrimFrames(2, 5);
    const elements = { videolabSampleName: { value: 'Exact selected interval' } };
    let upload;
    const controller = Object.assign(Object.create(Controller.prototype), {
        recorder, capture: null, assertActive() {}, element: id => elements[id], stopPreview() {}, render() {}, status() {},
        async request(path, options) { upload = { path, options }; return { ok: true, sample: { filename: 'exact.wav' } }; }
    });
    await controller.save();
    assert.equal(upload.path, 'samples?name=Exact%20selected%20interval');
    assert.equal(upload.options.headers['Content-Type'], 'audio/wav');
    assert.equal(upload.options.body.byteLength, 44 + 3 * 2 * 2);
    assert.deepEqual(values(upload.options.body), [16384, -8192, -32768, 16384, 8192, -16384]);
    assert.equal(recorder.frames, 6);
    assert.equal(recorder.chunks[0][0][0], 1);
    recorder.setTrimFrames(1, 4);
    assert.equal(recorder.normalized, false);
});

test('120 and 180 second stereo PCM are not silently cut by the default RadioLab byte limit', () => {
    for (const sampleRate of [44100, 48000]) {
        for (const seconds of [120, 180]) {
            const frames = sampleRate * seconds;
            const channels = [new Float32Array(frames).fill(0.125), new Float32Array(frames).fill(-0.25)];
            const recorder = seedRecorder(audio(channels, sampleRate), radio);
            assert.equal(recorder.frames, frames);
            assert.equal(recorder.duration, seconds);
            assert.ok(recorder.maxFrames >= frames);
            recorder.clear();
        }
    }
});

test('invalid, empty, silent, overlong and nonfinite PCM never becomes a take', () => {
    for (const buffer of [audio([new Float32Array(0)]), audio([new Float32Array(8)]), audio([Float32Array.from([NaN, 1])]), audio([Float32Array.from([Infinity, 1])]), audio([new Float32Array(181)], 1)]) assert.throws(() => seedRecorder(buffer, radio));
    assert.throws(() => seedRecorder(audio([Float32Array.of(1)]), null), /RadioLab/);
});

test('cancel wakes polling, aborts requests and leaves the previous take byte-exact', () => {
    const recorder = seedRecorder(audio([Float32Array.from([0.1, -0.5, 0.25])]), radio);
    const original = recorder.wav();
    let wakes = 0;
    let deleted;
    const operation = { abort: new AbortController(), id: 'job-1', username: 'alice', timer: 12, wake: () => wakes++ };
    const controller = Object.assign(Object.create(Controller.prototype), { recorder, capture: operation, root: { clearTimeout() {} }, deleteCapture: (id, username) => { deleted = { id, username }; }, status() {}, render() {} });
    controller.cancelCapture();
    assert.equal(controller.capture, null);
    assert.equal(operation.abort.signal.aborted, true);
    assert.equal(operation.username, null);
    assert.equal(wakes, 1);
    assert.deepEqual(deleted, { id: 'job-1', username: 'alice' });
    assert.deepEqual(recorder.wav(), original);
});

test('shared context is mandatory: never constructs or resumes a private Web Audio context', () => {
    const controller = Object.assign(Object.create(Controller.prototype), { assertActive() {}, adapter: { getContext: () => null } });
    assert.throws(() => controller.context(), /Start MYGRAIN/);
    controller.adapter.getContext = () => ({ state: 'suspended', resume() { throw new Error('Must not resume'); } });
    assert.throws(() => controller.context(), /Start MYGRAIN/);
    const context = { state: 'running' };
    controller.adapter.getContext = () => context;
    assert.equal(controller.context(), context);
});
