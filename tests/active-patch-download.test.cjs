'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const html = fs.readFileSync(process.env.MYGRAIN_INDEX || path.join(__dirname, '../index.html'), 'utf8');
function fn(name) {
    const pattern = new RegExp('        (?:async )?function ' + name + '\\b[\\s\\S]*?(?=\\n        (?:async )?function )');
    const match = html.match(pattern); assert(match, 'Missing ' + name); return match[0];
}
const context = vm.createContext({});
vm.runInContext("const GRANULAR_LAYER_SOURCE_DEFAULTS = {main:'grainMainSample', A:'grainASample', B:'grainBSample'};\n" +
    fn('normalizeGranularLayerSourceMode') + fn('getEnabledPatchAudioKeys'), context);
const grain = ['generated', 'generatedBase', 'grainMainSample', 'grainASample', 'grainBSample', 'mic', 'grainAMic', 'grainBMic'];
const drums = ['drumKick', 'drumSnare', 'drumHat', 'drumPerc', 'drumClap', 'drumCymbals', 'drumEtc'];
const loops = ['bastardA', 'bastardB', 'bastardC', 'bastardD', 'bastardV', 'bastardW', 'bastardP', 'bastardO',
    'bastardL', 'bastardX', 'bastardM', 'bastardMRender', 'bastardMPlus', 'bastardMPlusRender',
    'bastardK', 'bastardKRender', 'bastardKTrack2', 'bastardKTrack3', 'bastardKTrack4', 'bastardKTrack5', 'bastardQ'];
const all = [...grain, ...drums, ...loops, 'qSourceSample', 'keyboardSample', 'dropboxSample', 'dropboxRender'];
const offModes = () => ({ granularLayersEnabled: false, generatedSampleLayerEnabled: false, generatedDryLoopEnabled: false,
    bastardLoopEnabled: false, bastardLoop2Enabled: false, bastardLoop3Enabled: false, bastardLoopVEnabled: false,
    bastardLoopWEnabled: false, bastardLoopPEnabled: false, bastardLoopOEnabled: false, bastardLoopLEnabled: false,
    bastardLoopXEnabled: false, bastardLoopMEnabled: false, bastardLoopMPlusEnabled: false, bastardLoopKEnabled: false,
    loopD: { enabled: false }, drumMachineEnabled: false, dropboxSampleLayerEnabled: false, keyboardSoundSource: 'grain' });
const state = (modes = {}, q = { enabled: false }) => ({ modes: { ...offModes(), ...modes }, q, selects: {} });
const select = (saved, keys = all) => [...context.getEnabledPatchAudioKeys(saved, keys.map(key => ({ key })))].sort();
const equal = (actual, expected) => assert.deepEqual(actual, [...expected].sort());

test('drums-only patch excludes every disabled-card source and retains all drum samples', () => {
    const saved = state({ drumMachineEnabled: true }), original = JSON.stringify(saved);
    equal(select(saved), drums); assert.equal(JSON.stringify(saved), original);
});
test('all cards Off produces no audio; missing old gates and future slots are conservative', () => {
    equal(select(state()), []);
    assert(select({ modes: {}, selects: {} }).includes('bastardA'));
    equal(select(state(), ['futureAudioSlot']), ['futureAudioSlot']);
});
test('enabled silent layers retain source audio regardless of zero volume or pattern rests', () => {
    equal(select(state({ bastardLoopEnabled: true, drumMachineEnabled: true, bastardLoopLevel: 0,
        drumMachineKickPattern: Array(16).fill(false) })), ['bastardA', ...drums]);
});
test('loop source/render pairs share their saved card gate', () => {
    equal(select(state({ bastardLoopMEnabled: true, bastardLoopMPlusEnabled: true, loopD: { enabled: true } })),
        ['bastardD', 'bastardM', 'bastardMRender', 'bastardMPlus', 'bastardMPlusRender']);
});
test('L/X synth mode does not include previously loaded sample files', () => {
    equal(select(state({ bastardLoopLEnabled: true, bastardLoopXEnabled: true,
        bastardLoopLSourceMode: 'synth', bastardLoopXSourceMode: 'synth' })), []);
    equal(select(state({ bastardLoopLEnabled: true, bastardLoopXEnabled: true,
        bastardLoopLSourceMode: 'sample', bastardLoopXSourceMode: 'sample' })), ['bastardL', 'bastardX']);
});
test('K respects parent, per-track disable and mute gates', () => {
    equal(select(state({ bastardLoopKEnabled: true, kMultitrack: { tracks: [
        { enabled: true }, { enabled: false }, { enabled: true, mute: true }, { enabled: true }, { enabled: false }
    ] } })), ['bastardK', 'bastardKRender', 'bastardKTrack4']);
});
test('an enabled grain retains its selected cross-layer input, not all dormant samples', () => {
    const saved = state({ granularLayersEnabled: true, grainAMuted: true, grainBMuted: true });
    saved.selects.grainMainSource = 'grainASample'; equal(select(saved), ['grainASample']);
});
test('All Sources and missing selected-input fallbacks retain dependencies', () => {
    const saved = state({ granularLayersEnabled: true, grainAMuted: true, grainBMuted: true });
    saved.selects.grainMainSource = 'all'; equal(select(saved), grain);
    saved.selects.grainMainSource = 'mic'; equal(select(saved, ['generated', 'generatedBase']), ['generated', 'generatedBase']);
});
test('the generated dry loop keeps both current and base PCM when grains are Off', () => {
    equal(select(state({ generatedDryLoopEnabled: true })), ['generated', 'generatedBase']);
});
test('Q keeps only the chosen piano/sample source, and grain dependencies survive the global gate', () => {
    equal(select(state({}, { enabled: true, soundSource: 'sample' })), ['qSourceSample']);
    equal(select(state({}, { enabled: true, soundSource: 'piano' })), ['bastardQ']);
    equal(select(state({}, { enabled: true, soundSource: 'grain' })), ['grainMainSample', 'grainASample', 'grainBSample']);
});
test('keyboard sample and Dropbox source/render are retained only when selected/enabled', () => {
    equal(select(state({ keyboardSoundSource: 'sample', dropboxSampleLayerEnabled: true })),
        ['keyboardSample', 'dropboxSample', 'dropboxRender']);
    equal(select(state({ keyboardSoundSource: 'sample', keyboardInstrumentEnabled: { sample: false } })), []);
});
