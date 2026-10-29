const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { create, clockSource } = require('../background-audio.js');
function fixture({ supported = true, fail = false } = {}) {
    const events = new EventTarget(), document = new EventTarget(); document.hidden = false;
    const ports = [], nodes = [], revoked = [], writes = [];
    let now = 1000, capture = false, playing = true, ticks = 0, callback, type = 'auto';
    const navigator = { mediaSession: {} };
    if (supported) navigator.audioSession = { get type() { return type; }, set type(value) { type = value; writes.push(value); } };
    const host = { document, navigator, performance: { now: () => now }, Blob,
        addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
        URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: url => revoked.push(url) },
        setInterval(fn) { callback = fn; return 4; }, clearInterval(id) { assert.equal(id, 4); callback = null; },
        AudioWorkletNode: class { constructor() { this.port = { postMessage(value) { ports.push(value); }, close() { ports.push('closed'); } }; nodes.push(this); } connect(node) { this.target = node; } disconnect() { this.target = null; } }
    };
    const context = { state: 'running', destination: {}, audioWorklet: { async addModule() { if (fail) throw new Error('unavailable'); } } };
    const controller = create(host, { playing: () => playing, microphoneActive: () => capture, tick: () => ticks++ });
    const hidden = value => { document.hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
    return { host, context, controller, nodes, ports, revoked, writes, hidden, events, advance(ms) { now += ms; }, setCapture(value) { capture = value; }, setPlaying(value) { playing = value; }, get ticks() { return ticks; }, get callback() { return callback; } };
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
test('native audio clock pumps foreground and hidden schedulers; interruption never forces resume', async () => {
    const f = fixture(); await f.controller.attach(f.context); const node = f.nodes[0];
    node.port.onmessage(); assert.equal(f.ticks, 1); assert(f.controller.driving);
    f.hidden(true); node.port.onmessage(); assert.equal(f.ticks, 2); assert.equal(f.ports.at(-1), 'ack');
    f.context.state = 'interrupted'; node.port.onmessage(); assert.equal(f.ticks, 2);
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
test('native clock is silent and disabled until requested; acknowledged pulse is bounded to 50Hz', () => {
    let Processor; const messages = [];
    const scope = { sampleRate: 48000, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: value => messages.push(value) }; } }, registerProcessor(name, value) { Processor = value; } };
    vm.runInNewContext(clockSource, scope); const clock = new Processor();
    const output = [new Float32Array(128)];
    for (let i = 0; i < 400; i++) clock.process([], [output]); assert.equal(messages.length, 0);
    clock.port.onmessage({ data: true });
    for (let i = 0; i < 375; i++) { clock.process([], [output]); clock.port.onmessage({data:'ack'}); }
    assert(messages.length >= 45 && messages.length <= 50); assert(output[0].every(v => v === 0));
});

function idleFixture() {
    const f = fixture(); f.controller.dispose();
    let playing = false, busy = false, microphone = false, sleeps = 0, wakes = 0, suspends = 0, resumes = 0;
    f.context.suspend = async () => { suspends++; f.context.state = 'suspended'; };
    f.context.resume = async () => { resumes++; f.context.state = 'running'; };
    const controller = create(f.host, { playing: () => playing, busy: () => busy,
        microphoneActive: () => microphone, idleEligible: () => true, tick() {},
        onIdle() { sleeps++; }, onWake() { wakes++; } });
    return { ...f, controller, setPlaying(v) { playing = v; }, setBusy(v) { busy = v; }, setMic(v) { microphone = v; },
        get counts() { return { sleeps, wakes, suspends, resumes }; } };
}
const flush = async () => { for (let i=0;i<8;i++) await Promise.resolve(); };
test('idle suspends after eight seconds; focus/visibility never wake it, interaction does', async () => {
    const f = idleFixture(); await f.controller.attach(f.context); f.advance(7999); f.controller.sync(); await flush();
    assert.equal(f.context.state, 'running'); f.advance(1); f.controller.sync(); await flush();
    assert.equal(f.context.state, 'suspended'); assert.equal(f.counts.sleeps, 1); assert(f.controller.idleSuspended);
    f.hidden(true); f.hidden(false); await flush(); assert.equal(f.counts.resumes, 0);
    f.host.document.dispatchEvent(new Event('pointerdown')); await flush();
    assert.equal(f.context.state, 'running'); assert.equal(f.counts.wakes, 1); f.controller.dispose();
});
test('playing while locked, microphone capture, and background operations prevent suspension', async () => {
    for (const setter of ['setPlaying','setMic','setBusy']) {
        const f=idleFixture(); await f.controller.attach(f.context); f[setter](true); f.hidden(true);
        f.advance(60000); f.controller.sync(); await flush(); assert.equal(f.counts.suspends,0,setter);
        if(setter==='setPlaying') assert.equal(f.ports.at(-1),true);
        f[setter](false); f.controller.sync(); f.advance(8001); f.controller.sync(); await flush();
        assert.equal(f.context.state,'suspended'); assert.equal(f.ports.at(-1),false); f.controller.dispose();
    }
});
test('only self-owned idle suspension auto-wakes, never a genuine device interruption', async () => {
    const f=idleFixture(); await f.controller.attach(f.context); f.context.state='interrupted'; f.setPlaying(true);
    f.controller.sync(); await f.controller.wake(); assert.equal(f.counts.resumes,0);
    f.context.state='running'; f.setPlaying(false); f.controller.sync(); f.advance(8001); f.controller.sync(); await flush();
    f.setPlaying(true); f.controller.sync(); await flush(); assert.equal(f.context.state,'running'); assert.equal(f.counts.resumes,1);f.controller.dispose();
});
test('gesture during pending suspension orders resume after suspend and prevents a stuck sleeper', async () => {
    const f=idleFixture(); await f.controller.attach(f.context); let finish;const order=[];
    f.context.suspend=()=>{order.push('suspend');return new Promise(r=>finish=()=>{f.context.state='suspended';r()})};
    f.context.resume=()=>{order.push('resume');return Promise.resolve().then(()=>{finish();f.context.state='running'})};
    f.advance(8001);f.controller.sync();await f.controller.wake();await flush();
    assert.deepEqual(order,['suspend','resume']);assert.equal(f.context.state,'running');assert(!f.controller.idleSuspended);f.controller.dispose();
});
test('repeated sleep/wake reuses one clock and hidden programmatic Play enables it immediately', async () => {
    const f=idleFixture();await f.controller.attach(f.context);
    for(let i=0;i<3;i++){
        f.setPlaying(false);f.controller.sync();f.advance(8001);f.controller.sync();await flush();
        assert.equal(f.context.state,'suspended');f.hidden(true);f.setPlaying(true);f.controller.sync();await flush();
        assert.equal(f.context.state,'running');assert.equal(f.ports.at(-1),true);
    }
    assert.equal(f.nodes.length,1);assert.equal(f.counts.sleeps,3);assert.equal(f.counts.wakes,3);f.controller.dispose();
});
test('a rejected suspend does not claim ownership of an externally stopped context', async () => {
    const f=idleFixture();await f.controller.attach(f.context);f.context.suspend=()=>Promise.reject(Error('unavailable'));
    f.advance(8001);f.controller.sync();await flush();assert(!f.controller.idleSuspended);assert.equal(f.counts.sleeps,0);f.controller.dispose();
});
test('direct explicit resume releases idle ownership without immediate resuspension', async () => {
    const f=idleFixture();await f.controller.attach(f.context);f.advance(8001);f.controller.sync();await flush();
    await f.context.resume();f.controller.sync();assert(!f.controller.idleSuspended);assert.equal(f.counts.wakes,1);
    f.advance(7999);f.controller.sync();assert.equal(f.context.state,'running');f.controller.dispose();
});
test('hidden idle grace uses native pulses to suspend even if UI bookkeeping timers never wake', async () => {
    const f=idleFixture();await f.controller.attach(f.context);f.hidden(true);assert.equal(f.ports.at(-1),true);
    f.advance(8001);f.nodes[0].port.onmessage();await flush();assert.equal(f.context.state,'suspended');
    assert.equal(f.ports.filter(value=>typeof value==='boolean').at(-1),false);f.controller.dispose();
});

test('native pulses keep at most one unacknowledged message and recover after disable', () => {
    let Processor; const messages=[];
    vm.runInNewContext(clockSource,{sampleRate:48000,AudioWorkletProcessor:class {constructor(){this.port={postMessage:x=>messages.push(x)}}},registerProcessor:(name,type)=>Processor=type});
    const clock=new Processor();clock.port.onmessage({data:true});
    for(let i=0;i<3750;i++)clock.process();
    assert.equal(messages.length,1,'A blocked GUI must not accumulate pulse messages');
    clock.port.onmessage({data:'ack'});clock.process();assert.equal(messages.length,2);
    clock.port.onmessage({data:false});for(let i=0;i<100;i++)clock.process();assert.equal(messages.length,2);
    clock.port.onmessage({data:true});for(let i=0;i<8;i++)clock.process();assert.equal(messages.length,3);
});

test('native ownership expires when pulses stall and releases on processor failure or Stop',async()=>{
    const f=fixture();await f.controller.attach(f.context);assert.equal(f.controller.driving,false);
    f.nodes[0].port.onmessage();assert.equal(f.controller.driving,true);
    f.advance(151);assert.equal(f.controller.driving,false);
    f.nodes[0].port.onmessage();assert.equal(f.controller.driving,true);
    f.nodes[0].onprocessorerror();assert.equal(f.controller.driving,false);f.controller.dispose();
    const g=fixture();await g.controller.attach(g.context);g.nodes[0].port.onmessage();
    g.setPlaying(false);g.controller.sync();assert.equal(g.controller.driving,false);g.controller.dispose();
});

test('pulse failure still acknowledges the message instead of wedging the audio clock',async()=>{
    const f=fixture();f.controller.dispose();const controller=create(f.host,{playing:()=>true,tick(){throw Error('scheduler failure')}});
    await controller.attach(f.context);assert.throws(()=>f.nodes.at(-1).port.onmessage(),/scheduler failure/);
    assert.equal(f.ports.at(-1),'ack');controller.dispose();
});

test('simple foreground native playback adds no scheduler pulses, while hidden playback retains them',async()=>{
    const f=fixture();f.controller.dispose();let scheduling=false;
    const controller=create(f.host,{playing:()=>true,scheduling:()=>scheduling,tick(){}});
    await controller.attach(f.context);assert.equal(f.ports.at(-1),false);
    scheduling=true;controller.sync();assert.equal(f.ports.at(-1),true);
    scheduling=false;controller.sync();assert.equal(f.ports.at(-1),false);
    f.hidden(true);assert.equal(f.ports.at(-1),true);controller.dispose();
});
