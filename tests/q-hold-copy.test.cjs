const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../q-theory.js');
const { Controller } = require('../q-card.js');
const chord = (notes = [60, 63, 68], extra = {}) => T.normalizeStep({ root: 60, type: 'custom', notes, gate: .25, ...extra });
const state = () => { const s = T.defaults(); s.chordHold = true; s.sequence[2] = chord(); s.sequence[10] = chord([62, 65, 69]); return s; };

test('block Hold ignores stored gates, spans empty cells and wraps to the first chord', () => {
    const s = state();
    assert.deepEqual(T.playbackEvents(s, 16).map(e => [e.start, e.gate]), [[2, 8], [10, 8]]);
    s.chordHold = false;
    assert.deepEqual(T.playbackEvents(s, 16).map(e => e.gate), [.25, .25]);
    assert.equal(s.sequence[2].gate, .25);
});
test('one chord holds a complete cycle; explicit rests interrupt but accent-only cells do not', () => {
    const s = state(); s.sequence[10] = null;
    assert.equal(T.playbackEvents(s, 16)[0].gate, 16);
    s.sequence[7] = T.normalizeStep({ kind: 'accent', notes: [], accent: true });
    assert.equal(T.playbackEvents(s, 16)[0].gate, 16);
    s.sequence[0] = chord([48], { rest: true });
    assert.equal(T.playbackEvents(s, 16)[0].gate, 14);
    s.sequence[8] = chord([48], { rest: true });
    assert.equal(T.playbackEvents(s, 16)[0].gate, 6);
});
test('Hold retriggers ratchets without overlap, leaves ARP events unchanged and empty loops safe', () => {
    const s = state(); s.sequence[2].ratchet = 2;
    assert.deepEqual(T.playbackEvents(s, 16).map(e => [e.start, e.gate]), [[2, .5], [2.5, 7.5], [10, 8]]);
    s.arpEnabled = true; const held = T.playbackEvents(s, 16); s.chordHold = false;
    assert.deepEqual(T.playbackEvents(s, 16), held);
    s.sequence.fill(null); assert.deepEqual(T.playbackEvents(s, 16), []);
});
test('Hold and exact edited chords normalize and roundtrip without enabling an explicit mute', () => {
    const s = state(); s.enabled = false;
    const restored = T.normalizeState(JSON.parse(JSON.stringify(s)));
    assert.equal(restored.chordHold, true); assert.equal(restored.enabled, false);
    assert.deepEqual(restored.sequence[2], s.sequence[2]);
    assert.equal(T.normalizeState({}).chordHold, false);
    assert.equal(T.normalizeState({ chordHold: 'true' }).chordHold, false);
    assert.equal(T.normalizeState().enabled, true);
    assert.equal(T.normalizeState({ enabled: false }).enabled, false);
});
test('single-chord clipboard copies actual edited pitches and all parameters, independently and repeatedly', async () => {
    const c = new Controller({ length: () => 16 });
    c.sync = () => {}; c.status = () => {}; let saves = 0; c.changed = () => { saves++; };
    const original = chord([59, 63, 68, 72], { velocity: 71, gate: 6.2, inversion: 1, voicing: 'open', accent: true, tie: true, ratchet: 3 });
    c.state.sequence[2] = T.copy(original); c.cursor = 2;
    c.state.selection = chord([60, 64, 67]); // stale builder/template must be ignored.
    c.state.transpose = 3;
    c.clipboard = [chord([48])];
    await c.action('copy-chord');
    c.state.sequence[2].notes[0] = 58; c.cursor = 5;
    await c.action('paste-chord'); assert.deepEqual(c.state.sequence[5], original);
    c.state.sequence[5].notes[0] = 57; c.cursor = 9;
    await c.action('paste-chord'); assert.deepEqual(c.state.sequence[9], original);
    assert.deepEqual(c.clipboard[0].notes, [48]); assert.equal(c.state.transpose, 3); assert.equal(saves, 2);
    c.cursor = 0; await assert.rejects(c.action('copy-chord'), /Select a grid chord/);
});
test('held string voices end at the next onset, not a release tail later', () => {
    const context = { currentTime: 0, createBufferSource: () => ({ playbackRate: {}, connect: g => g, start() {}, stop(t) { this.stopped = t; } }), createGain: () => ({ gain: { cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }) };
    const c = new Controller({ context: () => context, bpm: () => 120 }); c.state.instrument = 'strings';
    c.ensureGraph = () => ({ input: {} }); c.piano.source = () => ({ sample: { midi: 60 }, duration: 2, buffer: {}, offset: 0, loopStart: .1, loopEnd: .8 });
    c.voice(60, 96, .1, 3, { hold: true, releaseSeconds: .006 });
    const v = [...c.voices][0]; assert.equal(v.source.loop, true); assert.equal(v.end, 3.1); assert.equal(v.source.stopped, 3.1);
});
test('cold sample loading preserves the supplied shared origin and joins an ongoing held chord', async () => {
    let finish; const calls = []; const context = { currentTime: 10, state: 'running' };
    const c = new Controller({ context: () => context, length: () => 16, bpm: () => 120 });
    c.state = state(); c.state.sequence[0] = chord(); c.ensureGraph = () => ({});
    c.syncTransport = () => {}; c.reflectPlaying = () => {}; c.updatePlayhead = () => {}; c.updateEffects = () => {}; c.status = () => {};
    c.voice = (...args) => calls.push(args);
    let available = false; c.piano.source = () => { if (!available) throw Error('cold'); return {}; };
    c.piano.ensure = () => new Promise(resolve => { finish = () => { available = true; resolve(); }; });
    assert.equal(c.start(10.2, { origin: 10 }), true);
    context.currentTime = 10.55; finish(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(c.origin, 10); assert(calls.length > 0); assert(calls.every(call => call[2] >= 10.55));
    c.stop(); assert.equal(c.running, false);
});
