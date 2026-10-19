const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('function playGrain(');
const end = html.indexOf('// --- Scheduler ---', start);
assert.ok(start > 0 && end > start);
const source = html.slice(start, end);

function grainTimingFixture(clickGuard = .008) {
    const times = [];
    const context = {
        console, activeGrainNodes: 0, MAX_GRAIN_NODES: 100, activeGrains: new Map(),
        audioContext: { currentTime: 1 },
        canPlayGrains: () => true,
        getGrainTimingMode: () => 'synth', getGrainModeProfile: () => ({}),
        getGranularKeyboardNoteFrequency: () => 130.81,
        getClickGuardSeconds: () => clickGuard,
        withModulationEvaluationTime(time, callback) { times.push(time); return callback(); },
        getGranularLayerSettings: () => []
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return { context, times };
}

test('late keyboard grains use one future timestamp for their envelopes instead of overlapping browser-clamped curves', () => {
    const { context, times } = grainTimingFixture();
    context.playGrain('C3', .5, 1, { role: 'keyboard' });
    assert.deepEqual(times, [1.01]);
    assert.equal(context.activeGrainNodes, 0);
});

test('future grains keep their scheduled timestamp and live keys honor the configured click guard', () => {
    const { context, times } = grainTimingFixture(.03);
    context.playGrain('E3', 2, 1, { role: 'keyboard' });
    context.playGrain('G3', null, 1, { role: 'keyboard' });
    assert.deepEqual(times, [2, 1.03]);
});

test('song stop retains keyboard selection without transiently restarting voices during renderer disposal', () => {
    const adapter = fs.readFileSync(path.join(__dirname, '../song-beta-adapter.js'), 'utf8');
    const start = adapter.indexOf('function stopSongAudio(');
    const end = adapter.indexOf('function refreshSongAudioUi(', start);
    const selectedNotes = new Set(['C3', 'E3', 'G3']);
    const calls = [];
    const context = {
        heldNotes: selectedNotes,
        stopAllPerformancePlayback() { assert.equal(context.heldNotes.size, 0); calls.push('transport'); },
        stopHeldKeyboardPlaybackPreserveSelection(options) { assert.equal(options.immediate, true); assert.equal(context.heldNotes, selectedNotes); calls.push('keyboard'); },
        stopAllGrains() { calls.push('grains'); },
        stopAllOscillators() { calls.push('oscillators'); }
    };
    vm.createContext(context);
    vm.runInContext(adapter.slice(start, end), context);
    context.stopSongAudio();
    assert.equal(context.heldNotes, selectedNotes);
    assert.deepEqual([...context.heldNotes], ['C3', 'E3', 'G3']);
    assert.deepEqual(calls, ['transport', 'keyboard', 'grains', 'oscillators']);
});
