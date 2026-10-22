const test = require('node:test');
const assert = require('node:assert/strict');
const theory = require('../q-theory.js');
const { Controller } = require('../q-card.js');
const scale = [0, 2, 4, 5, 7, 9, 11];

test('bass pool includes chromatic roots, deduplicates octaves and leaves sequences/samples/playback intact', () => {
    let saves = 0;
    const controller = new Controller({ bassNotes: () => [43, 55, 37, null, 40, NaN], save: () => saves++ });
    controller.sync = controller.updateEffects = controller.status = () => {};
    controller.changed = options => { assert.deepEqual(options, { preserveSamples: true, reschedule: false }); controller.host.save(); };
    controller.state.sequence[0] = theory.normalizeStep({ root: 48, notes: [48, 52, 55] });
    const sequence = JSON.stringify(controller.state.sequence);
    controller.setPaletteFromBass(true);
    assert.deepEqual(controller.state.paletteBassRoots, [7, 1, 4]);
    assert.equal(controller.state.chordRoot, 7);
    const pool = controller.palette();
    assert.deepEqual([...new Set(pool.map(chord => chord.root % 12))], [7, 1, 4]);
    assert(pool.some(chord => chord.root === 49 && chord.type === 'major'));
    assert(pool.every(chord => chord.notes.every(note => note >= 21 && note <= 108)));
    assert.equal(JSON.stringify(controller.state.sequence), sequence);
    assert.equal(saves, 1);
    controller.setPaletteFromBass(false);
    assert.equal(controller.state.paletteBassRoots, null);
    assert(controller.palette().every(chord => chord.notes.every(note => scale.includes(note % 12))));
    assert.equal(JSON.stringify(controller.state.sequence), sequence);
});

test('empty bass is a no-op, and repeated clicks rescan the current source', () => {
    let notes = [];
    const controller = new Controller({ bassNotes: () => notes });
    controller.status = controller.changed = () => {};
    const initial = JSON.stringify(controller.state);
    assert.throws(() => controller.setPaletteFromBass(true), /no playable notes/);
    assert.equal(JSON.stringify(controller.state), initial);
    notes = [36]; controller.setPaletteFromBass(true);
    notes = [42, 54]; controller.setPaletteFromBass(true);
    assert.deepEqual(controller.state.paletteBassRoots, [6]);
    notes = []; const saved = JSON.stringify(controller.state);
    assert.throws(() => controller.setPaletteFromBass(true), /no playable notes/);
    assert.equal(JSON.stringify(controller.state), saved);
});

test('bass-root pools retain family, inversion, voicing, octave and focus controls', () => {
    const state = { ...theory.defaults(), paletteBassRoots: [1, 7], paletteFamilies: 'sevenths', inversion: 1, voicing: 'open', octave: 4, chordRoot: 7 };
    const pool = theory.chordPalette(state, scale);
    assert.equal(pool[0].root, 67);
    assert(pool.every(chord => theory.qualities[chord.type].length === 4));
    assert.deepEqual(pool[0].notes, theory.chord(67, pool[0].type, 1, 'open'));
    for (const octave of [0, 8]) {
        state.octave = octave;
        assert(theory.chordPalette(state, scale).every(chord => chord.notes.every(note => note >= 21 && note <= 108)));
    }
});

test('legacy imports use the original scale pool and optional roots survive normalized JSON roundtrips', () => {
    for (const value of [undefined, null, [], 'bad', [12, -1, '7', 2.5]]) {
        const state = theory.normalizeState({ paletteBassRoots: value });
        assert.equal(state.paletteBassRoots, null);
        assert(theory.chordPalette(state, scale).every(chord => chord.notes.every(note => scale.includes(note % 12))));
    }
    const saved = theory.normalizeState({ paletteBassRoots: [7, 1, 7, '2', null, 4, 99] });
    assert.deepEqual(saved.paletteBassRoots, [7, 1, 4]);
    assert.deepEqual(theory.normalizeState(JSON.parse(JSON.stringify(saved))).paletteBassRoots, [7, 1, 4]);
    assert.equal(saved.version, 1);
});
