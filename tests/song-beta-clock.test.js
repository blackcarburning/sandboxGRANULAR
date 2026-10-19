const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../song-beta.js');
const { schedule, scheduleStored } = require('../song-beta-clock.js');

test('isolated rendering can start with IndexedDB denied and cannot borrow browser audio', () => {
    const bridge = { context: { state: 'running', destination: {} }, state: { modes: {} }, databases: new Set(), destination: {} };
    const window = { name: 'saved-part-render' };
    Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('Blocked', 'SecurityError'); } });
    const context = { window, parent: { __mygrainSongRenderBridges: new Map([[window.name, bridge]]) } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../song-beta-render-deck.js'), 'utf8'), context);
    assert.equal(window.__mygrainSongRenderDeck, true);
    assert.equal(window.localStorage.getItem('granularSynthState'), JSON.stringify(bridge.state));
    assert.throws(() => window.indexedDB.open('GranularSynthAudioDB', 1), /saved snapshot/);
    assert.equal(bridge.databases.size, 0);
    assert.equal(new window.AudioContext().destination, bridge.destination);
});

function contextFixture() {
    const sources = [];
    const listeners = new Map();
    const context = {
        currentTime: 1, sampleRate: 48000, destination: {}, state: 'running',
        addEventListener: (name, callback) => listeners.set(name, callback),
        removeEventListener: name => listeners.delete(name),
        createBufferSource() {
            const source = {
                playbackRate: {}, start(time) { this.startTime = time; },
                stop(time) { this.stopTime = time; }, connect() {}, disconnect() { this.disconnected = true; }
            };
            sources.push(source);
            return source;
        }
    };
    return { context, sources, listeners };
}

test('reused placements share one AudioBuffer but retain separate clock boundaries and identities', () => {
    const { context, sources } = contextFixture();
    const original = { id: 'verse', name: 'Verse', bpm: 120, patternSteps: 8, repeats: 2 };
    const reference = { ...original, id: 'verse-again', sourcePartId: original.id, repeats: 1 };
    const buffer = { duration: 1 };
    const renders = new Map([[original.id, buffer]]);
    const playback = schedule(context, [original, reference], renders);
    assert.equal(renders.size, 1);
    assert.equal(sources[0].buffer, sources[1].buffer);
    assert.equal(sources[0].buffer, buffer);
    assert.deepEqual(playback.entries.map(entry => entry.id), [original.id, reference.id]);
    assert.equal(sources[0].stopTime, sources[1].startTime);
    assert.equal(sources[0].stopTime - sources[0].startTime, 2);
    assert.equal(sources[1].stopTime - sources[1].startTime, 1);
    playback.stop();
});

test('all buffer starts/stops are scheduled beforehand with identical adjacent boundary times', () => {
    const { context, sources } = contextFixture();
    const parts = [{ id: 'a', bpm: 127, patternSteps: 12, repeats: 3 }, { id: 'b', bpm: 91, patternSteps: 32, repeats: 2 }];
    const renders = new Map(parts.map(part => [part.id, { duration: Math.round(60 / part.bpm * part.patternSteps / 4 * 48000) / 48000 }]));
    const playback = schedule(context, parts, renders);
    assert.equal(sources.length, 2);
    assert.equal(sources[0].stopTime, sources[1].startTime);
    assert.equal(playback.entries[0].end, playback.entries[1].start);
    assert.equal(sources[0].loop, true);
    assert.equal(sources[0].playbackRate.value, renders.get('a').duration / (60 / 127 * 3));
    context.currentTime = 999;
    assert.equal(sources[0].stopTime, sources[1].startTime);
});

test('stop cancels every scheduled future source and disables the completion callback', () => {
    const { context, sources } = contextFixture();
    const part = { id: 'a', bpm: 120, patternSteps: 16, repeats: 1 };
    let ended = 0;
    const playback = schedule(context, [part], new Map([['a', { duration: 2 }]]), () => { ended += 1; });
    const callback = sources[0].onended;
    playback.stop();
    callback();
    assert.equal(ended, 0);
    assert.equal(sources[0].onended, null);
    assert.equal(sources[0].disconnected, true);
});

test('incomplete render cache cancels already prepared sources rather than playing a partial song', () => {
    const { context, sources } = contextFixture();
    const part = { id: 'a', name: 'Intro', bpm: 120, patternSteps: 16, repeats: 1 };
    assert.throws(() => schedule(context, [part, { ...part, id: 'b' }], new Map([['a', { duration: 2 }]])), /Arm Cache/);
    assert.equal(sources[0].disconnected, true);
});

test('audio interruption cancels future sources immediately without waiting for a UI timer', () => {
    const { context, sources, listeners } = contextFixture();
    const part = { id: 'a', bpm: 120, patternSteps: 16, repeats: 1 };
    let reason;
    schedule(context, [part], new Map([['a', { duration: 2 }]]), result => { reason = result; });
    context.state = 'suspended';
    listeners.get('statechange')();
    assert.equal(reason, 'interrupted');
    assert.equal(sources[0].disconnected, true);
    assert.equal(listeners.size, 0);
});

test('storage playback schedules two parts and prefetches one without retaining all scheduled sources', async () => {
    const { context, sources } = contextFixture();
    const parts = Array.from({ length: 5 }, (unusedPart, index) => ({ id: `part-${index}`, name: `Part ${index}`, bpm: 120, patternSteps: 16, repeats: 1 }));
    const loaded = [];
    const reasons = [];
    const playback = await scheduleStored(context, parts, async part => { loaded.push(part.id); return { duration: 2 }; }, reason => reasons.push(reason));
    assert.equal(sources.length, 2);
    assert.equal(loaded.length, 3);
    for (let index = 0; index < parts.length; index += 1) {
        assert.ok(sources.filter(source => !source.disconnected).length <= 2);
        context.currentTime = playback.entries[index].end;
        sources[index].onended();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(sources[index].buffer, null);
        if (index < parts.length - 1) assert.equal(sources[index].stopTime, sources[index + 1].startTime);
    }
    assert.deepEqual(reasons, ['finished']);
    assert.equal(loaded.length, 5);
    assert.equal(sources.filter(source => !source.disconnected).length, 0);
});

test('Stop during storage prefetch cancels queued sources and prevents late decode completion from scheduling audio', async () => {
    const { context, sources } = contextFixture();
    const parts = Array.from({ length: 3 }, (unusedPart, index) => ({ id: `part-${index}`, bpm: 120, patternSteps: 16, repeats: 1 }));
    let finish;
    const reasons = [];
    const playback = await scheduleStored(context, parts, async part => part.id === 'part-2' ? new Promise(resolve => { finish = resolve; }) : { duration: 2 }, reason => reasons.push(reason));
    playback.stop();
    finish({ duration: 2 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sources.length, 2);
    assert.ok(sources.every(source => source.disconnected && source.onended === null && source.buffer === null));
    assert.deepEqual(reasons, []);
});

test('storage deadlines stop playback explicitly instead of shifting the beat or skipping a part', async () => {
    const { context, sources } = contextFixture();
    const parts = Array.from({ length: 3 }, (unusedPart, index) => ({ id: `part-${index}`, name: `Part ${index}`, bpm: 120, patternSteps: 16, repeats: 1 }));
    const reasons = [];
    const playback = await scheduleStored(context, parts, async () => ({ duration: 2 }), reason => reasons.push(reason));
    context.currentTime = playback.entries[2].start;
    sources[0].onended();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reasons.length, 1);
    assert.match(reasons[0], /before its beat boundary/);
    assert.equal(sources.length, 2);
    assert.ok(sources.every(source => source.disconnected));
});

test('cancellation during initial storage loads never starts playback', async () => {
    const { context, sources } = contextFixture();
    const abort = new AbortController();
    let finish;
    const pending = scheduleStored(context, [{ id: 'first' }], () => new Promise(resolve => { finish = resolve; }), () => {}, abort.signal);
    abort.abort();
    finish({ duration: 2 });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(sources.length, 0);
});

test('looping a song wraps from the selected start through the complete arrangement at exact boundaries', async () => {
    const { context, sources } = contextFixture();
    const parts = [
        { id: 'intro', bpm: 127, patternSteps: 12, repeats: 2 },
        { id: 'verse', bpm: 91, patternSteps: 8, repeats: 1 },
        { id: 'verse-again', sourcePartId: 'verse', bpm: 91, patternSteps: 8, repeats: 3 }
    ];
    const buffers = new Map([['intro', { duration: 2 }], ['verse', { duration: 1 }]]);
    const reasons = [];
    const playback = await scheduleStored(context, parts, async part => buffers.get(part.sourcePartId || part.id), reason => reasons.push(reason), undefined, context.destination, { loop: true, startIndex: 1 });
    assert.equal(playback.endTime, Infinity);
    assert.deepEqual(playback.entries.map(entry => entry.id), ['verse', 'verse-again']);
    for (let index = 0; index < 30; index += 1) {
        const source = sources[index];
        assert.equal(source.buffer, buffers.get(parts[(index + 1) % 3].sourcePartId || parts[(index + 1) % 3].id));
        context.currentTime = source.stopTime;
        source.onended();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(source.stopTime, sources[index + 1].startTime);
        assert.ok(playback.entries.length <= 2);
        assert.equal(sources.filter(entry => !entry.disconnected).length, 2);
    }
    assert.deepEqual(reasons, []);
    playback.stop();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(sources.every(source => source.disconnected));
});

test('Loop Part retains one shared buffer across repeated cycles and abort cancels future audio', async () => {
    const { context, sources } = contextFixture();
    const part = { id: 'verse-again', sourcePartId: 'verse', bpm: 300, patternSteps: 8, repeats: 2 };
    const buffer = { duration: .4 };
    const abort = new AbortController();
    let loads = 0;
    const playback = await scheduleStored(context, [part], async () => { loads += 1; return buffer; }, () => assert.fail('Stopped loops must not finish'), abort.signal, context.destination, { loop: true });
    for (let index = 0; index < 20; index += 1) {
        assert.equal(sources[index].buffer, buffer);
        assert.ok(Math.abs(sources[index].stopTime - sources[index].startTime - .8) < 1 / context.sampleRate);
        context.currentTime = sources[index].stopTime;
        sources[index].onended();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(sources[index].stopTime, sources[index + 1].startTime);
        assert.ok(playback.entries.length <= 2);
    }
    assert.equal(loads, 1);
    abort.abort();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(sources.every(source => source.disconnected && source.buffer === null && source.onended === null));
});

test('a loop interrupted by audio suspension stops rather than restarting automatically', async () => {
    const { context, sources, listeners } = contextFixture();
    const reasons = [];
    await scheduleStored(context, [{ id: 'verse', bpm: 120, patternSteps: 8, repeats: 1 }], async () => ({ duration: 1 }), reason => reasons.push(reason), undefined, context.destination, { loop: true });
    context.state = 'suspended';
    listeners.get('statechange')();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(reasons, ['interrupted']);
    assert.ok(sources.every(source => source.disconnected));
});

test('Stop while loading the next loop prevents late audio and preserves the original failure handling', async () => {
    const { context, sources } = contextFixture();
    let finish;
    let loads = 0;
    const reasons = [];
    const parts = [{ id: 'a', bpm: 120, patternSteps: 8, repeats: 1 }, { id: 'b', bpm: 120, patternSteps: 8, repeats: 1 }];
    const playback = await scheduleStored(context, parts, () => ++loads === 3 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ duration: 1 }), reason => reasons.push(reason), undefined, context.destination, { loop: true });
    playback.stop();
    finish({ duration: 1 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sources.length, 2);
    assert.deepEqual(reasons, []);
    assert.ok(sources.every(source => source.disconnected));
});

test('capture worklet keeps exactly the requested sample frames without codec padding or render tails', () => {
    let Processor;
    const messages = [];
    const context = {
        AudioWorkletProcessor: class { constructor() { this.port = { postMessage: value => messages.push(value) }; } },
        registerProcessor(name, value) { Processor = value; }, Float32Array, currentFrame: 0
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../song-beta-capture-worklet.js'), 'utf8'), context);
    const capture = new Processor({ processorOptions: { startFrame: 3, frames: 7 } });
    assert.equal(capture.process([[Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7])]], [[new Float32Array(8), new Float32Array(8)]]), true);
    context.currentFrame = 8;
    assert.equal(capture.process([[Float32Array.from([8, 9, 10, 11, 12, 13, 14, 15])]], [[new Float32Array(8), new Float32Array(8)]]), false);
    assert.equal(messages.length, 1);
    assert.deepEqual([...new Float32Array(messages[0].channels[0])], [3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual([...new Float32Array(messages[0].channels[1])], [3, 4, 5, 6, 7, 8, 9]);
});
