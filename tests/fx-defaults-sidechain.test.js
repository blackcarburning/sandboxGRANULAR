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
    const controls = Object.fromEntries(['drumMachineKickLevel', 'finalSidechainKickLevel',
        'drumMachineKickLevelValue', 'finalSidechainKickLevelValue'].map(id => [id, { value: '100', textContent: '100%' }]));
    const hits = [];
    const triggers = [];
    const routes = [];
    const context = {
        document: { getElementById: id => controls[id] },
        setSliderValue(id, value) { (controls[id] ||= {}).value = String(value); },
        setLfoRouteState(...args) { routes.push(args); },
        updateEffects() {}, applyUnityTrimDefaults() {}, saveState() {},
        drumMachineKickTrackLevel: 1,
        finalCompressorSidechainSource: 'off',
        FINAL_COMPRESSOR_SIDECHAIN_OPTIONS: ['off', 'lfo1', 'kick'].map(value => ({ value })),
        audioContext: {}, drumMachineExtraTracks: {},
        drumMachineKickPattern: [true], drumMachineSnarePattern: [true], drumMachinePercPattern: [true],
        drumMachineKickRatchetPattern: [1], drumMachineSnareRatchetPattern: [1], drumMachinePercRatchetPattern: [1],
        drumMachineKickBuffer: {}, drumMachineSnareBuffer: {}, drumMachinePercBuffer: {},
        getDrumMachineKickPitchRatio: () => 1, getDrumMachineSnarePitchRatio: () => 1, getDrumMachinePercPitchRatio: () => 1,
        getDrumMachineKickDecayValue: () => 1, getDrumMachineSnareDecayValue: () => 1, getDrumMachinePercDecayValue: () => 1,
        getDrumMachineKickLengthValue: () => 1, getDrumMachineSnareLengthValue: () => 1, getDrumMachinePercLengthValue: () => 1,
        getDrumMachineSnareLevelValue: () => .6, getDrumMachinePercLevelValue: () => .5,
        getDrumMachineSnareDistortionAmount: () => 0,
        shouldRouteDrumMachineDirectToOutput: () => false,
        registerFinalSidechainKickTrigger(time, intensity) { triggers.push({ time, intensity }); },
        playDrumMachineHit(buffer, time, pitch, options) { hits.push({ time, ...options }); }
    };
    vm.createContext(context);
    for (const name of ['getFinalSidechainKickLevelValue', 'setFinalSidechainKickLevelPercent',
        'setDrumMachineKickLevelPercent', 'getDrumMachineKickLevelValue', 'getDrumMachineKickPlaybackLevel',
        'normalizeFinalCompressorSidechainSource', 'shouldRouteKickAroundFinalCompressor',
        'scheduleDrumMachineRepeats', 'applyFinalBusDefaults', 'getFinalCompressorReleaseSeconds']) {
        vm.runInContext(functionSource(name), context);
    }
    return { context, controls, hits, triggers, routes };
}

test('load/random defaults set ring and every distortion to zero, bus comp 30%, release 100ms', () => {
    const { context, controls, routes } = fixture();
    context.applyFinalBusDefaults();
    for (const id of ['finalRingDepth', 'finalDriveSoft', 'finalDriveHard', 'finalDriveFold', 'finalDriveCrush', 'distortion', 'drumMachineSnareDistortion']) {
        assert.equal(controls[id].value, '0', id);
    }
    assert.equal(controls.finalCompressorAmount.value, '30');
    assert.equal(controls.finalCompressorRelease.value, '100');
    assert.equal(context.getFinalCompressorReleaseSeconds(), .1);
    assert.deepEqual(routes, [['distortion', '1', false], ['distortion', '2', false], ['distortion', '3', false]]);
});

for (const source of ['off', 'lfo1', 'kick']) {
    for (const amount of [0, 25, 100]) {
        test(`SC ${source} at ${amount}% keeps independent drum levels and gates the kick trim`, () => {
            const { context, controls, hits, triggers } = fixture();
            context.finalCompressorSidechainSource = source;
            context.setDrumMachineKickLevelPercent(80);
            context.setFinalSidechainKickLevelPercent(amount);
            assert.equal(controls.drumMachineKickLevel.value, '80');
            assert.equal(controls.drumMachineKickLevelValue.textContent, '80%');
            assert.equal(controls.finalSidechainKickLevel.value, String(amount));
            assert.equal(context.getDrumMachineKickLevelValue(), .8);
            assert.equal(controls.finalSidechainKickLevel.value, String(amount));
            const expected = .8 * (source === 'kick' ? amount / 100 : 1);
            assert.equal(context.getDrumMachineKickPlaybackLevel(), expected);
            context.scheduleDrumMachineRepeats('kick', 0, 1, .125);
            assert.equal(hits[0].level, expected);
            assert.equal(hits[0].bypassFinalCompressor, source === 'kick');
            assert.equal(triggers.length, expected > 0 ? 1 : 0);
            context.scheduleDrumMachineRepeats('snare', 0, 1, .125);
            context.scheduleDrumMachineRepeats('perc', 0, 1, .125);
            assert.equal(hits[1].level, .6);
            assert.equal(hits[2].level, .5);
        });
    }
}

test('turning SC off immediately restores the base level for new kick hits without changing either slider', () => {
    const { context, controls } = fixture();
    context.setDrumMachineKickLevelPercent(65);
    context.setFinalSidechainKickLevelPercent(0);
    context.finalCompressorSidechainSource = 'kick';
    assert.equal(context.getDrumMachineKickPlaybackLevel(), 0);
    context.finalCompressorSidechainSource = 'off';
    assert.equal(context.getDrumMachineKickPlaybackLevel(), .65);
    assert.equal(controls.drumMachineKickLevel.value, '65');
    assert.equal(controls.finalSidechainKickLevel.value, '0');
});

test('SC trim also stays inactive for the direct drum-output path when SC is off', () => {
    const { context, hits } = fixture();
    context.shouldRouteDrumMachineDirectToOutput = () => true;
    context.setDrumMachineKickLevelPercent(70);
    context.setFinalSidechainKickLevelPercent(0);
    context.scheduleDrumMachineRepeats('kick', 0, 1, .125);
    assert.equal(hits[0].level, .7);
    assert.equal(hits[0].bypassFinalCompressor, false);
});

test('SC trim preserves kick ratchet scaling', () => {
    const { context, hits } = fixture();
    context.finalCompressorSidechainSource = 'kick';
    context.drumMachineKickRatchetPattern[0] = 4;
    context.setFinalSidechainKickLevelPercent(50);
    context.scheduleDrumMachineRepeats('kick', 0, 1, .125);
    assert.deepEqual(hits.map(hit => hit.level), [.5, .3, .3, .3]);
});

test('missing legacy SC slider defaults to unity and never supplies the drum Kick level', () => {
    const { context, controls } = fixture();
    delete controls.finalSidechainKickLevel;
    assert.equal(context.getFinalSidechainKickLevelValue(), 1);
    controls.finalSidechainKickLevel = { value: '0' };
    delete controls.drumMachineKickLevel;
    context.drumMachineKickTrackLevel = .75;
    assert.equal(context.getDrumMachineKickLevelValue(), .75);
});

test('defaults cover startup after restore, presets and both randomisation modes without changing Song snapshot restore', () => {
    assert.match(html, /const restored = restoreState\(\);\s*(?:warmKeyboardSound\(\);\s*)?applyFinalBusDefaults\(\);/);
    assert.match(functionSource('applyPreset'), /applyFinalBusDefaults\(\);/);
    assert.doesNotMatch(functionSource('restoreState'), /applyFinalBusDefaults/);
    assert.match(functionSource('applyRandomizeFinalCompressorDefaults'), /applyFinalBusDefaults\(\);/);
    assert.match(html, /restoreRandomizeBpmState\(bpmSnapshot\);\s*applyFinalBusDefaults\(\);/);
    assert.match(html, /megaRandomCommentary = null;\s*resetRandomizeGlobalMixSends\(\);\s*applyFinalBusDefaults\(\);/);
    assert.match(html, /finalCompressorAmount: 30,\s*finalCompressorRelease: 100,/);
    assert.doesNotMatch(html, /setSliderValue\('finalRingDepth', randomIntegerInRange/);
});
