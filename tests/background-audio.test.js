const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { create, clockSource } = require('../background-audio.js');
function fixture({ supported = true, fail = false } = {}) {
    const events = new EventTarget(), document = new EventTarget(); document.hidden = false;
    const ports = [], nodes = [], revoked = [], writes = [];
    let capture = false, playing = true, ticks = 0, callback, type = 'auto';
    const navigator = { mediaSession: {} };
    if (supported) navigator.audioSession = { get type() { return type; }, set type(value) { type = value; writes.push(value); } };
    const host = { document, navigator, performance: { now: () => 1000 }, Blob,
        addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
        URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: url => revoked.push(url) },
        setInterval(fn) { callback = fn; return 4; }, clearInterval(id) { assert.equal(id, 4); callback = null; },
        AudioWorkletNode: class { constructor() { this.port = { postMessage(value) { ports.push(value); }, close() { ports.push('closed'); } }; nodes.push(this); } connect(node) { this.target = node; } disconnect() { this.target = null; } }
    };
    const context = { state: 'running', destination: {}, audioWorklet: { async addModule() { if (fail) throw new Error('unavailable'); } } };
    const controller = create(host, { playing: () => playing, microphoneActive: () => capture, tick: () => ticks++ });
    const hidden = value => { document.hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
    return { host, context, controller, nodes, ports, revoked, writes, hidden, events, setCapture(value) { capture = value; }, setPlaying(value) { playing = value; }, get ticks() { return ticks; }, get callback() { return callback; } };
}
test('requests playback, retains recording mode, and only changes session type when needed', async () => {
    const f = fixture(); await f.controller.attach(f.context);
    assert.deepEqual(f.writes, ['playback']); f.controller.sync(); assert.equal(f.writes.length, 1);
    f.setCapture(true); f.controller.sync(); assert.equal(f.writes.at(-1), 'play-and-record');
    f.setCapture(false); f.controller.sync(); assert.equal(f.writes.at(-1), 'playback');
    assert.equal(f.host.navigator.mediaSession.playbackState, 'playing');
    f.setPlaying(false); f.controller.sync(); assert.equal(f.host.navigator.mediaSession.playbackState, 'none');
    f.controller.dispose();
});
test('hidden audio clock pumps schedulers, foreground does not, and interruption never forces resume', async () => {
    const f = fixture(); await f.controller.attach(f.context); const node = f.nodes[0];
    node.port.onmessage(); assert.equal(f.ticks, 0);
    f.hidden(true); node.port.onmessage(); assert.equal(f.ticks, 1); assert.equal(f.ports.at(-1), true);
    f.context.state = 'interrupted'; node.port.onmessage(); assert.equal(f.ticks, 1);
    f.hidden(false); assert.equal(f.ports.at(-1), false);
    f.controller.dispose(); assert.equal(node.target, null); assert.equal(node.port.onmessage, null); assert.equal(f.callback, null);
});
test('missing APIs and worklet failure leave normal playback usable', async () => {
    for (const options of [{ supported: false }, { fail: true }]) {
        const f = fixture(options); await f.controller.attach(f.context); f.hidden(true); f.controller.sync();
        assert.equal(f.host.navigator.mediaSession.playbackState, 'playing');
        if (options.fail) assert.match(f.controller.diagnostics.clockError, /unavailable/);
        assert.deepEqual(f.revoked, ['blob:fixture']); f.controller.dispose();
    }
});
test('context replacement and late attach cannot leak a node or own an old context', async () => {
    const f = fixture(); let ready; f.context.audioWorklet.addModule = () => new Promise(r => ready = r);
    const pending = f.controller.attach(f.context);
    const next = { state: 'running', destination: {}, audioWorklet: { async addModule() {} } };
    await f.controller.attach(next); ready(); await pending;
    assert.equal(f.nodes.length, 1); assert.equal(f.nodes[0].target, next.destination);
    f.events.dispatchEvent(new Event('mygrain-account-lock')); assert.equal(f.nodes[0].target, null);
    assert.equal(f.host.navigator.mediaSession.playbackState, 'none');
});
test('native clock is silent and disabled in foreground; background pulse is bounded to 50Hz', () => {
    let Processor; const messages = [];
    const scope = { sampleRate: 48000, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: value => messages.push(value) }; } }, registerProcessor(name, value) { Processor = value; } };
    vm.runInNewContext(clockSource, scope); const clock = new Processor();
    const output = [new Float32Array(128)];
    for (let i = 0; i < 400; i++) clock.process([], [output]); assert.equal(messages.length, 0);
    clock.port.onmessage({ data: true });
    for (let i = 0; i < 375; i++) clock.process([], [output]);
    assert(messages.length >= 45 && messages.length <= 50); assert(output[0].every(v => v === 0));
});
