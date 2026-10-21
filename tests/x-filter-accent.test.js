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
    const controls = {
        bastardLoopXAccentAmount: { value: '35' },
        performanceBastardLoopXFilterEnvelope: { value: '40' },
        performanceBastardLoopXLevel: { value: '100' }
    };
    const peaks = [];
    const context = {
        document: { getElementById: id => controls[id] },
        MIX_HEADROOM: .9,
        bastardLoopXLevel: 1,
        bastardLoopXEnabled: true,
        bastardLoopXAccentAmount: .35,
        bastardLoopXFilterEnvelopeAmount: .4,
        bastardLoopXSampleBuffer: { duration: 1 },
        bastardLoopXSampleMetadata: null,
        isBastardLoopXUsingSynth: () => false,
        bastardLoopXActiveVoices: new Set(),
        getLoopLayerSoloGain: () => 1,
        audioContext: {
            currentTime: 0,
            createBufferSource: () => ({ playbackRate: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }),
            createGain: () => ({ gain: {
                setValueAtTime() {},
                linearRampToValueAtTime(value) { peaks.push(value); },
                exponentialRampToValueAtTime() {}
            }, connect() {} })
        },
        createBastardLoopConfigurableFilters: () => [],
        getBastardLoopXFilterCutoff: () => 18000,
        getBastardLoopXFilterMode: () => 'lowpass-48',
        getBastardLoopXPlaybackDestination: () => ({}),
        ensureBastardLoopXDelayBus: destination => destination,
        getBastardLoopXPitchRatioForNote: () => 1,
        getBastardLoopXStepLengthRatio: () => 1,
        getBastardLoopXDecayRatio: () => 1,
        getBastardLoopXStartTrimRatio: () => 0,
        getBastardLoopXAttackSeconds: () => .004,
        scheduleTransportSourceStop: (source, time) => source.stop(time),
        connectBastardLoopFilterChain() {},
        applyBastardLoopXFilterEnvelope() {},
        attachBastardLoopXFilterLfoToVoice() {}
    };
    vm.createContext(context);
    for (const name of ['getBastardLoopXSampleRegion', 'getBastardLoopXAccentAmount', 'getBastardLoopXFilterEnvelopeAmount',
        'getBastardLoopXFilterEnvelopeAmountForStep', 'getBastardLoopXLevelValue',
        'getBastardLoopXAuditionLevel', 'scheduleBastardLoopXSingleVoice', 'previewBastardLoopXStep']) {
        vm.runInContext(functionSource(name), context);
    }
    return { context, controls, peaks };
}

for (const amount of [-100, -50, 0, 35, 100]) {
    test(`X filter accent ${amount}% changes the envelope, never voice gain`, () => {
        const { context, controls, peaks } = fixture();
        controls.bastardLoopXAccentAmount.value = String(amount);
        const plain = { note: 'C3', accent: false };
        const accented = { note: 'C3', accent: true };
        assert.equal(context.getBastardLoopXFilterEnvelopeAmountForStep(plain), .4);
        assert.equal(context.getBastardLoopXFilterEnvelopeAmountForStep(accented), Math.max(0, Math.min(1, .4 + amount / 200)));
        for (const step of [plain, accented]) {
            context.scheduleBastardLoopXSingleVoice(step, .01, .125, null);
            assert.equal(context.previewBastardLoopXStep(step), true);
        }
        assert.deepEqual(peaks, [.9, .9, .9, .9]);
    });
}

test('X filter accent clamps at both envelope boundaries', () => {
    const { context, controls } = fixture();
    controls.performanceBastardLoopXFilterEnvelope.value = '100';
    controls.bastardLoopXAccentAmount.value = '100';
    assert.equal(context.getBastardLoopXFilterEnvelopeAmountForStep({ accent: true }), 1);
    controls.performanceBastardLoopXFilterEnvelope.value = '0';
    controls.bastardLoopXAccentAmount.value = '-100';
    assert.equal(context.getBastardLoopXFilterEnvelopeAmountForStep({ accent: true }), 0);
});

test('existing signed X accent values still load without a schema change', () => {
    const { context, controls } = fixture();
    delete controls.bastardLoopXAccentAmount;
    context.bastardLoopXAccentAmount = -.6;
    assert.equal(context.getBastardLoopXAccentAmount(), -.6);
    assert.ok(Math.abs(context.getBastardLoopXFilterEnvelopeAmountForStep({ accent: true }) - .1) < 1e-12);
    context.bastardLoopXAccentAmount = .35;
    assert.equal(context.getBastardLoopXAccentAmount(), .35);
});

test('X uses full shared headroom and retains level, mute and solo gates', () => {
    const { context, controls, peaks } = fixture();
    assert.equal(context.getBastardLoopXLevelValue(), .9);
    assert.equal(context.getBastardLoopXAuditionLevel(), .9);
    controls.performanceBastardLoopXLevel.value = '50';
    assert.equal(context.getBastardLoopXLevelValue(), .45);
    assert.equal(context.getBastardLoopXAuditionLevel(), .45);
    context.bastardLoopXEnabled = false;
    assert.equal(context.getBastardLoopXLevelValue(), 0);
    context.scheduleBastardLoopXSingleVoice({ note: 'C3', accent: true }, .01, .125, null);
    assert.deepEqual(peaks, []);
    context.bastardLoopXEnabled = true;
    context.getLoopLayerSoloGain = () => 0;
    assert.equal(context.getBastardLoopXLevelValue(), 0);
    context.getLoopLayerSoloGain = () => 1;
    controls.performanceBastardLoopXLevel.value = '0';
    assert.equal(context.getBastardLoopXLevelValue(), 0);
});

test('X ratchet attenuation stays independent of accent', () => {
    const { context, peaks } = fixture();
    context.scheduleBastardLoopXSingleVoice({ note: 'C3', accent: true }, .01, .125, null, { levelScale: .58 });
    assert.equal(peaks[0], .9 * .58);
});

test('X MIDI and feedback no longer turn filter accents into volume accents', () => {
    assert.doesNotMatch(functionSource('buildBastardLoopXMidiBlob'), /getAccentVelocityScale/);
    assert.doesNotMatch(functionSource('auditionBastardLoopXCurrentStep'), /gain: step\.accent/);
    assert.doesNotMatch(html, /computeBastardLoopXAccentGainMultiplier|getBastardLoopXAccentGainMultiplier/);
    assert.match(html, /<span>Filter Accent<\/span>/);
    assert.match(html, /id="performanceBastardLoopXFilterEnvelope"[^>]*>\s*<p[^>]*>Filter Accent adjusts/);
    assert.match(html, /id="performanceBastardLoopLFilterEnvelope"[^>]*>\s*<p[^>]*>Accented notes add \+50%/);
});
