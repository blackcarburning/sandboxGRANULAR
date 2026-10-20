const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixture = require('./drum-parallel-fx-fixture.js');

const html = fs.readFileSync(fixture.sourcePath, 'utf8');

function createHarness(options = {}) {
    const timers = new Map();
    const workers = [];
    const revoked = [];
    let timerId = 0;
    let clock = 0;
    class ControlledWorker {
        constructor(url) {
            this.url = url;
            this.terminated = false;
            workers.push(this);
        }
        postMessage(request, transfer) {
            this.request = request;
            this.transfer = transfer;
        }
        terminate() { this.terminated = true; }
        reply(type, overrides = {}) {
            this.onmessage({ data: { type, requestId: this.request.requestId,
                requestKey: this.request.requestKey, sampleRate: 48000, length: 32,
                channels: [new Float32Array(32).fill(.25), new Float32Array(32).fill(-.5)], ...overrides } });
        }
    }
    const context = fixture.createFakeContext(48000);
    context.state = 'running';
    const created = fixture.createFixture(fixture.collectSources(html), context, { globals: {
        Worker: options.noWorker ? undefined : ControlledWorker,
        URL: { createObjectURL: () => `blob:qa-${workers.length}`, revokeObjectURL: url => revoked.push(url) },
        setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
        clearTimeout: identifier => timers.delete(identifier),
        performance: { now: () => { clock += options.yieldCopies ? 3 : 0; return clock; } }
    } });
    const graph = { context, nodes: [], isLive: options.live !== false, disposed: false,
        impulseGeneration: 0, requestedImpulseKey: '', impulseKey: '', impulseReady: Promise.resolve(true),
        reverb: context.createConvolver() };
    created.state.drumSendFxGraph = graph;
    const reverb = { enabled: true, amount: 65, send: 100, room: 'hall', size: 40, decay: 60 };
    const request = (changes = {}, mode = 'off') => created.functions.requestDrumSendImpulseBuild(graph, { ...reverb, ...changes }, mode);
    const flush = delay => {
        for (const [identifier, pending] of [...timers]) {
            if (pending.delay !== delay) continue;
            timers.delete(identifier);
            pending.callback();
        }
    };
    return { ...created, graph, timers, workers, revoked, request, flush };
}

async function drainMicrotasks() {
    for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
}

test('nine queued room edits collapse to one latest worker, not nine serialized jobs', async () => {
    const created = createHarness();
    const obsolete = [];
    for (let decay = 10; decay <= 90; decay += 10) {
        created.request({ decay });
        obsolete.push(created.graph.impulseReady);
    }
    assert.equal(created.timers.size, 1);
    assert.equal(created.workers.length, 0);
    assert.deepEqual(await Promise.all(obsolete.slice(0, -1)), Array(8).fill(false));
    created.flush(100);
    assert.equal(created.workers.length, 1);
    const worker = created.workers[0];
    assert.equal(worker.request.decay, 90);
    assert.equal(created.graph.impulseStatus, 'building');
    worker.reply('base');
    worker.reply('done');
    assert.equal(await obsolete.at(-1), true);
    assert.equal(created.graph.impulseKey, 'hall:40:90:off');
    assert.equal(created.graph.impulseStatus, 'ready');
    assert.ok(worker.terminated);
    assert.equal(created.revoked.length, 1);
});

test('latest readiness follows replacement generation and rejects late terminated worker replies', async () => {
    const created = createHarness();
    created.request();
    created.flush(100);
    const oldWorker = created.workers[0];
    const ready = created.functions.waitForDrumSendImpulse(created.graph);
    created.request({ room: 'cathedral' }, '24');
    assert.ok(oldWorker.terminated);
    oldWorker.reply('base');
    oldWorker.reply('done');
    await drainMicrotasks();
    assert.equal(created.graph.reverb.buffer, undefined);
    created.flush(100);
    const latest = created.workers[1];
    let settled = false;
    ready.then(() => { settled = true; });
    latest.reply('base');
    await drainMicrotasks();
    assert.equal(created.graph.impulseStatus, 'building');
    assert.equal(settled, false);
    latest.reply('done');
    assert.equal(await ready, true);
    assert.equal(created.graph.impulseKey, 'cathedral:40:60:off');
    assert.equal('shimmer' in created.graph, false);
});

for (const staleReason of ['disposed', 'closed-context', 'replaced-context', 'replaced-live-graph']) {
    test(`stale ${staleReason} response never installs its impulse`, async () => {
        const created = createHarness();
        created.request();
        created.flush(100);
        const pending = created.graph.impulseReady;
        if (staleReason === 'disposed') created.functions.disposeDrumSendFxGraph();
        if (staleReason === 'closed-context') created.context.state = 'closed';
        if (staleReason === 'replaced-context') created.state.audioContext = fixture.createFakeContext(44100);
        if (staleReason === 'replaced-live-graph') created.state.drumSendFxGraph = { context: created.context };
        const worker = created.workers[0];
        worker.reply('base');
        worker.reply('done');
        assert.equal(await pending, false);
        await drainMicrotasks();
        assert.equal(created.graph.reverb.buffer ?? null, null);
        assert.ok(worker.terminated);
    });
}

test('generation cancellation during chunked AudioBuffer copy cannot install stale partial PCM', async () => {
    const created = createHarness({ yieldCopies: true });
    created.request();
    created.flush(100);
    const oldWorker = created.workers[0];
    oldWorker.reply('base', { length: 32769, channels: [new Float32Array(32769), new Float32Array(32769)] });
    oldWorker.reply('done');
    await drainMicrotasks();
    assert.ok([...created.timers.values()].some(timer => timer.delay === 0));
    created.request({ decay: 75 });
    created.flush(0);
    await drainMicrotasks();
    assert.equal(created.graph.reverb.buffer, undefined);
    created.flush(100);
    const latest = created.workers[1];
    latest.reply('base');
    latest.reply('done');
    for (let turn = 0; turn < 8; turn += 1) {
        await drainMicrotasks();
        created.flush(0);
    }
    assert.equal(await created.functions.waitForDrumSendImpulse(created.graph), true);
    assert.equal(created.graph.baseImpulseKey, 'hall:40:75');
});

for (const disabledField of ['enabled', 'amount', 'send']) {
    test(`${disabledField} disables pending worker work without clearing an existing room`, async () => {
        const created = createHarness();
        const retained = created.context.createBuffer(2, 16, 48000);
        created.graph.reverb.buffer = retained;
        created.request();
        created.flush(100);
        const pending = created.graph.impulseReady;
        created.request({ [disabledField]: disabledField === 'enabled' ? false : 0 });
        assert.equal(await pending, false);
        assert.equal(created.graph.reverb.buffer, retained);
        assert.equal(created.graph.impulseStatus, 'idle');
        assert.ok(created.workers[0].terminated);
        assert.equal(created.timers.size, 0);
    });
}

test('cached identical room ignores legacy shimmer requests without new workers or detached PCM', async () => {
    const created = createHarness();
    created.request(); created.flush(100);
    created.workers[0].reply('base'); created.workers[0].reply('done');
    assert.equal(await created.graph.impulseReady, true);
    const base = created.graph.reverb.buffer;
    created.request({}, '12'); created.flush(100);
    assert.equal(created.workers.length, 1);
    assert.equal(created.timers.size, 0);
    assert.equal(base.getChannelData(0)[0], .25);
    assert.equal(created.graph.reverb.buffer, base);
    assert.equal('shimmer' in created.graph, false);
});

for (const failure of ['worker-error', 'decode-error', 'reported-error', 'unavailable']) {
    test(`${failure} resolves readiness false, retains prior room, and cleans worker resources`, async () => {
        const created = createHarness({ noWorker: failure === 'unavailable' });
        const prior = created.context.createBuffer(2, 16, 48000);
        created.graph.reverb.buffer = prior;
        created.request();
        const ready = created.functions.waitForDrumSendImpulse(created.graph);
        created.flush(100);
        const worker = created.workers[0];
        if (failure === 'worker-error') worker.onerror({ message: 'QA worker failure', preventDefault() {} });
        if (failure === 'decode-error') worker.onmessageerror();
        if (failure === 'reported-error') worker.reply('error', { error: 'QA builder failure' });
        assert.equal(await ready, false);
        assert.equal(created.graph.impulseStatus, 'error');
        assert.equal(created.graph.reverb.buffer, prior);
        assert.equal(created.graph.impulseWorker, null);
        if (worker) assert.ok(worker.terminated);
    });
}

test('offline graph readiness is independent of the current live context', async () => {
    const created = createHarness({ live: false });
    created.request();
    created.flush(100);
    created.state.audioContext = fixture.createFakeContext(44100);
    created.workers[0].reply('base');
    created.workers[0].reply('done');
    assert.equal(await created.functions.waitForDrumSendImpulse(created.graph), true);
    assert.equal(created.graph.reverb.buffer.sampleRate, 48000);
});
