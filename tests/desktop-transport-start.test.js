const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function fixture(previousPreparation = 1.5) {
    const calls = { starts: [], cancelled: [], warmups: 0 };
    const state = {
        Math, Number, Map, Error,
        audioContext: { currentTime: 1, sampleRate: 48000 },
        transportSync: { depth: 0, preparationSeconds: previousPreparation },
        TRANSPORT_START_BUFFER_SECONDS: .3,
        sequencerBPM: 120, sequencerPlaying: false, drumMachinePlaying: false,
        bastardLoopPlaying: false, bastardLoopLTransportActive: false, bastardLoopXTransportActive: false,
        activeGrains: new Map(),
        prewarmTransportBuffers() { calls.warmups++; },
        getSharedLoopTransportOriginTime() { return null; },
        setTransportEpoch(origin) { state.transportSync.origin = origin; },
        cancelPreparedTransportStarts(plans) { calls.cancelled.push(...plans); },
        hasSharedRhythmClockWork() { return false; },
        ensureSharedRhythmClockRunning() { throw new Error('No rhythm work in this fixture'); },
        scheduleSequencer() { throw new Error('No sequencer in this fixture'); }
    };
    vm.createContext(state);
    for (const name of ['getTransportPreparationLeadSeconds', 'getTransportGridPosition', 'withBufferedTransportStart']) {
        const start = html.indexOf(`        function ${name}(`);
        assert.ok(start >= 0);
        const end = html.indexOf('\n        }', start);
        vm.runInContext(html.slice(start, end + 10), state);
    }
    function prepare(costs) {
        let attempt = 0;
        return deadline => {
            const source = { attempt: ++attempt };
            state.transportSync.preparedStarts.push({ source, args: [deadline], start(time) { calls.starts.push({ source, time, committedAt: state.audioContext.currentTime }); } });
            state.audioContext.currentTime += costs[attempt - 1] ?? 0;
            return deadline;
        };
    }
    return { state, calls, prepare };
}

test('desktop warm start does not inherit a slow preparation from earlier playback', () => {
    const { state, calls, prepare } = fixture(4);
    const deadline = state.withBufferedTransportStart(null, prepare([.01]), { reset: true, startLeadSeconds: .12 });
    assert.ok(Math.abs(deadline - 1.12) < 1e-9);
    assert.equal(calls.starts.length, 1);
    assert.ok(calls.starts[0].time - calls.starts[0].committedAt >= .05);
    assert.equal(calls.cancelled.length, 0);
});

test('a cold desktop start cancels an unsafe first plan and retries using current preparation cost', () => {
    const { state, calls, prepare } = fixture(4);
    const deadline = state.withBufferedTransportStart(null, prepare([.09, .01]), { reset: true, startLeadSeconds: .12 });
    assert.equal(calls.cancelled.length, 1);
    assert.equal(calls.starts.length, 1);
    assert.equal(calls.starts[0].source.attempt, 2);
    assert.equal(state.transportSync.preparation.attempts, 2);
    assert.ok(deadline < 1.5, 'must not fall back to the old multi-second preparation estimate');
    assert.ok(calls.starts[0].time - calls.starts[0].committedAt >= .05);
});

test('mobile/default callers retain the original adaptive start delay', () => {
    const { state, calls, prepare } = fixture(1.5);
    const deadline = state.withBufferedTransportStart(null, prepare([.01]), { reset: true });
    assert.ok(Math.abs(deadline - 4.3) < 1e-9);
    assert.equal(calls.starts.length, 1);
});

test('explicit recording and synchronization deadlines are not shortened by the desktop hint', () => {
    const { state, calls, prepare } = fixture(1.5);
    const deadline = state.withBufferedTransportStart(3, prepare([.01]), { reset: true, startLeadSeconds: .12 });
    assert.equal(deadline, 3);
    assert.equal(calls.starts[0].time, 3);
});

test('failed explicit preparation never starts stale audio or moves the requested deadline', () => {
    const { state, calls, prepare } = fixture(0);
    assert.throws(() => state.withBufferedTransportStart(1.12, prepare([.1]), { reset: true, startLeadSeconds: .12 }), /deadline expired/);
    assert.equal(calls.starts.length, 0);
    assert.equal(calls.cancelled.length, 1);
});
