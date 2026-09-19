const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildKeyboardGeometry,
    recordingExtensionForMimeType,
    resolveSampleWindow,
    validatePreset
} = require('../mygrain-utils.js');

test('validatePreset clamps values and removes unsupported fields', () => {
    const sliderSchema = {
        volume: { min: 0, max: 100, defaultValue: 100 },
        grainSize: { min: 10, max: 500, defaultValue: 100 }
    };

    const { preset, warnings } = validatePreset({
        sliders: { volume: 1000, grainSize: 'nan', ignored: 5 },
        lfoWaveform: 'invalid',
        noiseType: 'brown',
        lfo: { mode: 'bpm', enabled: { volume: 1, ignored: true } },
        octave: 99
    }, {
        sliderSchema,
        toggleParams: ['volume', 'grainSize']
    });

    assert.equal(preset.sliders.volume, 100);
    assert.equal(preset.sliders.grainSize, 100);
    assert.deepEqual(preset.lfo.enabled, { volume: true });
    assert.equal(preset.lfo.mode, 'bpm');
    assert.equal(preset.lfoWaveform, 'sine');
    assert.equal(preset.noiseType, 'none');
    assert.equal(preset.octave, 3);
    assert.ok(warnings.length >= 3);
});

test('resolveSampleWindow keeps play position and region in bounds', () => {
    const region = resolveSampleWindow({
        bufferDuration: 1.5,
        startPct: 0.9,
        endPct: 0.1,
        positionPct: 1,
        grainSizeSeconds: 0.4,
        sprayAmount: 1,
        randomValue: 1
    });

    assert.ok(region.startTime >= 0);
    assert.ok(region.endTime <= 1.5);
    assert.ok(region.endTime - region.startTime >= 0.39);
    assert.ok(region.playPosition >= region.startTime);
    assert.ok(region.playPosition <= region.endTime - region.grainSizeSeconds + 1e-9);
});

test('buildKeyboardGeometry creates contiguous white keys and inset black keys', () => {
    const layout = buildKeyboardGeometry(['C1', 'C#1', 'D1', 'D#1', 'E1'], 50, 30);

    assert.deepEqual(layout[0], { note: 'C1', left: 0, width: 50, isBlack: false });
    assert.equal(layout[1].note, 'C#1');
    assert.equal(layout[1].left, 35);
    assert.equal(layout[2].left, 50);
    assert.equal(layout[3].left, 85);
});

test('recordingExtensionForMimeType matches common recorder outputs', () => {
    assert.equal(recordingExtensionForMimeType('audio/webm;codecs=opus'), '.webm');
    assert.equal(recordingExtensionForMimeType('audio/ogg'), '.ogg');
    assert.equal(recordingExtensionForMimeType('audio/mp4'), '.m4a');
    assert.equal(recordingExtensionForMimeType('audio/wav'), '.wav');
});
