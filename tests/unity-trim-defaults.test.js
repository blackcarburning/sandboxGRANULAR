const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function functionSource(name) {
    const start = html.indexOf(`        function ${name}(`);
    assert.notEqual(start, -1, name);
    const end = html.indexOf('\n        }', start);
    assert.notEqual(end, -1, name);
    return html.slice(start, end + '\n        }'.length);
}

function fixture() {
    const controls = Object.fromEntries(['performanceGeneratedDryTrim', 'performanceInputTrim', 'performancePostFilterTrim',
        'preFilterGain', 'postFilterGain'].flatMap(id => [[id, { value: '-12' }], [`${id}Value`, { textContent: '-12.0dB' }]]));
    controls.autoMakeupGain = { checked: true };
    controls.performanceMasterTrim = { value: '-2.5' };
    controls.performanceGranularTrim = { value: '-7' };
    controls.performanceBastardLoopLevel = { value: '64' };
    const effects = { dryGain: .25, syncs: 0 };
    const context = {
        document: { getElementById: id => controls[id], querySelectorAll: () => [] },
        audioContext: { state: 'suspended' }, generatedDryTrimDb: -12,
        preFilterGainNode: { gain: { value: .25 } }, makeupGain: { gain: { value: .25 } },
        updateGeneratedDryLoopMix() { effects.dryGain = context.dbToLinear(context.generatedDryTrimDb); },
        syncPerformanceSoundControls() {
            effects.syncs += 1;
            controls.performanceInputTrim.value = controls.preFilterGain.value;
            controls.performancePostFilterTrim.value = controls.postFilterGain.value;
            for (const id of ['performanceInputTrim', 'performancePostFilterTrim']) {
                controls[`${id}Value`].textContent = context.formatDb(Number(controls[id].value));
            }
        }
    };
    for (const map of ['lfoEnabled', 'lfo2Enabled', 'lfo3Enabled', 'lfoInverted', 'lfo2Inverted', 'lfo3Inverted']) {
        context[map] = { preFilterGain: true, postFilterGain: true, volume: true };
    }
    vm.createContext(context);
    for (const name of ['formatDb', 'dbToLinear', 'smoothGainParam', 'clearModulationForParam',
        'setGeneratedDryTrimDb', 'setPreFilterGainDb', 'setPostFilterGainDb', 'applyUnityTrimDefaults']) {
        vm.runInContext(functionSource(name), context);
    }
    return { context, controls, effects };
}

test('all three trim displays, backing controls and actual gain stages reset to unity', () => {
    const { context, controls, effects } = fixture();
    context.applyUnityTrimDefaults();
    for (const id of ['performanceGeneratedDryTrim', 'performanceInputTrim', 'performancePostFilterTrim', 'preFilterGain', 'postFilterGain']) {
        assert.equal(Number(controls[id].value), 0, id);
        assert.equal(controls[`${id}Value`].textContent, '0.0dB', id);
    }
    assert.equal(context.generatedDryTrimDb, 0);
    assert.equal(effects.dryGain, 1);
    assert.equal(context.preFilterGainNode.gain.value, 1);
    assert.equal(context.makeupGain.gain.value, 1);
    assert.equal(effects.syncs, 1);
});

test('unity defaults disable automatic makeup and only clear the two filter-gain modulation routes', () => {
    const { context, controls } = fixture();
    context.applyUnityTrimDefaults();
    assert.equal(controls.autoMakeupGain.checked, false);
    for (const map of ['lfoEnabled', 'lfo2Enabled', 'lfo3Enabled', 'lfoInverted', 'lfo2Inverted', 'lfo3Inverted']) {
        assert.equal(context[map].preFilterGain, false, map);
        assert.equal(context[map].postFilterGain, false, map);
        assert.equal(context[map].volume, true, map);
    }
});

test('master, granular and Bastardloop channel levels are not raised or reset', () => {
    const { context, controls } = fixture();
    context.applyUnityTrimDefaults();
    assert.equal(controls.performanceMasterTrim.value, '-2.5');
    assert.equal(controls.performanceGranularTrim.value, '-7');
    assert.equal(controls.performanceBastardLoopLevel.value, '64');
});

test('manual trim adjustments and Auto Makeup remain available after the default is applied', () => {
    const { context, controls, effects } = fixture();
    context.applyUnityTrimDefaults();
    context.setGeneratedDryTrimDb(-6);
    context.setPreFilterGainDb(-12);
    context.setPostFilterGainDb(6);
    assert.ok(Math.abs(effects.dryGain - 10 ** (-6 / 20)) < 1e-10);
    assert.ok(Math.abs(context.preFilterGainNode.gain.value - 10 ** (-12 / 20)) < 1e-10);
    assert.ok(Math.abs(context.makeupGain.gain.value - 10 ** (6 / 20)) < 1e-10);
    controls.autoMakeupGain.checked = true;
    context.setPostFilterGainDb(-8);
    assert.equal(controls.autoMakeupGain.checked, true);
    assert.ok(Math.abs(context.makeupGain.gain.value - 10 ** (6 / 20)) < 1e-10);
});

for (const value of [-24, -12, 0, 6]) {
    test(`defaulting overrides a previously stored ${value} dB without cumulative boosts`, () => {
        const { context } = fixture();
        context.setGeneratedDryTrimDb(value);
        context.setPreFilterGainDb(value);
        context.setPostFilterGainDb(value);
        context.applyUnityTrimDefaults();
        context.applyUnityTrimDefaults();
        assert.equal(context.generatedDryTrimDb, 0);
        assert.equal(context.preFilterGainNode.gain.value, 1);
        assert.equal(context.makeupGain.gain.value, 1);
    });
}

test('defaults also apply before an audio graph exists', () => {
    const { context, controls } = fixture();
    context.audioContext = null;
    context.preFilterGainNode = null;
    context.makeupGain = null;
    context.applyUnityTrimDefaults();
    assert.equal(controls.performanceInputTrim.value, '0');
    assert.equal(controls.performancePostFilterTrim.value, '0');
});

test('startup, presets, Reset and randomisation inherit trim defaults without rewriting exact Song recall', () => {
    assert.match(functionSource('applyFinalBusDefaults'), /applyUnityTrimDefaults\(\)/);
    assert.match(html, /const restored = restoreState\(\);\s*applyFinalBusDefaults\(\);/);
    assert.match(functionSource('applyPreset'), /applyFinalBusDefaults\(\);/);
    assert.match(html, /setFxMuted\(false, \{ silent: true \}\);\s*applyFinalBusDefaults\(\);/);
    assert.match(html, /restoreRandomizeBpmState\(bpmSnapshot\);\s*applyFinalBusDefaults\(\);/);
    assert.match(html, /megaRandomCommentary = null;\s*applyFinalBusDefaults\(\);/);
    assert.doesNotMatch(functionSource('restoreState'), /applyUnityTrimDefaults|applyFinalBusDefaults/);
});

test('full-patch randomisation no longer assigns random attenuation to either filter mirror or Dry Trim', () => {
    const randomize = functionSource('randomizeFullPatchPerformanceState');
    for (const id of ['performanceGeneratedDryTrim', 'performanceInputTrim', 'performancePostFilterTrim', 'preFilterGain', 'postFilterGain']) {
        assert.ok(!randomize.includes(`setSliderValue('${id}', randomIntegerInRange`), id);
    }
    assert.match(randomize, /applyUnityTrimDefaults\(\);\s*syncPerformanceControlState\(\);/);
});

test('the initial HTML has zero trims and automatic makeup unchecked', () => {
    for (const id of ['performanceGeneratedDryTrim', 'performanceInputTrim', 'performancePostFilterTrim', 'preFilterGain', 'postFilterGain']) {
        assert.match(html, new RegExp(`<input[^>]*id="${id}"[^>]*value="0"`));
    }
    const checkbox = html.match(/<input[^>]*id="autoMakeupGain"[^>]*>/)[0];
    assert.doesNotMatch(checkbox, /\bchecked\b/);
});
