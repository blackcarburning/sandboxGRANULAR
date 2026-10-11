const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunctionSource(name) {
    const signature = `function ${name}`;
    const start = indexHtml.indexOf(signature);
    assert.notEqual(start, -1, `Expected ${name} in index.html`);
    let parenDepth = 0;
    let sawOpeningParen = false;
    let braceStart = -1;
    for (let index = start; index < indexHtml.length; index += 1) {
        const char = indexHtml[index];
        if (char === '(') {
            parenDepth += 1;
            sawOpeningParen = true;
        } else if (char === ')') {
            parenDepth = Math.max(0, parenDepth - 1);
        } else if (char === '{' && sawOpeningParen && parenDepth === 0) {
            braceStart = index;
            break;
        }
    }
    assert.notEqual(braceStart, -1, `Expected ${name} body in index.html`);
    let depth = 0;
    for (let index = braceStart; index < indexHtml.length; index += 1) {
        const char = indexHtml[index];
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return indexHtml.slice(start, index + 1);
            }
        }
    }
    throw new Error(`Could not extract ${name} from index.html`);
}

const context = {
    BASTARD_LOOP_L_STEP_DOUBLE_TAP_MS: 320,
    noteSemitoneOffsets: {
        C: 0,
        'C#': 1,
        D: 2,
        'D#': 3,
        E: 4,
        F: 5,
        'F#': 6,
        G: 7,
        'G#': 8,
        A: 9,
        'A#': 10,
        B: 11
    }
};

vm.runInNewContext([
    extractFunctionSource('normalizeLeadSamplePitchClass'),
    extractFunctionSource('detectLeadSampleRootNote'),
    extractFunctionSource('createEmptyBastardLoopLStep'),
    extractFunctionSource('normalizeBastardLoopLStep'),
    extractFunctionSource('computeBastardLoopLStepTapState'),
    extractFunctionSource('computeBastardLoopLAccentGainMultiplier'),
    `globalThis.loopLExports = {
        normalizeLeadSamplePitchClass,
        detectLeadSampleRootNote,
        createEmptyBastardLoopLStep,
        normalizeBastardLoopLStep,
        computeBastardLoopLStepTapState,
        computeBastardLoopLAccentGainMultiplier
    };`
].join('\n\n'), context);

const {
    normalizeLeadSamplePitchClass,
    detectLeadSampleRootNote,
    createEmptyBastardLoopLStep,
    normalizeBastardLoopLStep,
    computeBastardLoopLStepTapState,
    computeBastardLoopLAccentGainMultiplier
} = context.loopLExports;

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

test('Loop L root-note parsing keeps explicit octave names from lead sample filenames', () => {
    assert.equal(detectLeadSampleRootNote('OS_MS_C4_80s_Lead.wav'), 'C4');
    assert.equal(detectLeadSampleRootNote('DS_VPDH_synth_oneshot_lead_dreamer_C3.wav'), 'C3');
});

test('Loop L root-note parsing falls back to musical note names in sample filenames', () => {
    assert.equal(detectLeadSampleRootNote('TL_MR_Lead_Synth_Screech_High_B.wav'), 'B4');
    assert.equal(detectLeadSampleRootNote('TRKTRN_KATO_Synth_Sine_Lead_Low_Pink_Stain_Fmaj.wav'), 'F2');
    assert.equal(detectLeadSampleRootNote('AHA_LRAH_synth_lead_one_shot_seek_g#maj.wav'), 'G#3');
    assert.equal(detectLeadSampleRootNote('SUT_EMF_TONE_A#_05.wav'), 'A#3');
});

test('Loop L pitch-class normalization keeps B natural intact and normalizes flats', () => {
    assert.equal(normalizeLeadSamplePitchClass('B'), 'B');
    assert.equal(normalizeLeadSamplePitchClass('Bb'), 'A#');
    assert.equal(normalizeLeadSamplePitchClass('Gb'), 'F#');
});

test('Loop L step normalization defaults ratchet to x1 and clamps explicit ratchets', () => {
    assert.deepEqual(plain(createEmptyBastardLoopLStep()), {
        note: '',
        rest: false,
        accent: false,
        slide: false,
        ratchet: 1
    });
    assert.deepEqual(plain(normalizeBastardLoopLStep({ note: 'C3', ratchet: 0 })), {
        note: 'C3',
        rest: false,
        accent: false,
        slide: false,
        ratchet: 1
    });
    assert.deepEqual(plain(normalizeBastardLoopLStep({ note: 'D3', accent: 1, slide: 1, ratchet: 99 })), {
        note: 'D3',
        rest: false,
        accent: true,
        slide: true,
        ratchet: 8
    });
});

test('Loop L step double-tap state survives a rerender by using shared tap memory', () => {
    const firstTap = plain(computeBastardLoopLStepTapState(-1, 0, 6, 1000));
    assert.deepEqual(firstTap, {
        isDoubleTap: false,
        nextIndex: 6,
        nextAt: 1000
    });

    const secondTap = plain(computeBastardLoopLStepTapState(firstTap.nextIndex, firstTap.nextAt, 6, 1210));
    assert.deepEqual(secondTap, {
        isDoubleTap: true,
        nextIndex: -1,
        nextAt: 0
    });

    const differentStep = plain(computeBastardLoopLStepTapState(firstTap.nextIndex, firstTap.nextAt, 7, 1110));
    assert.equal(differentStep.isDoubleTap, false);
    assert.equal(differentStep.nextIndex, 7);
});

test('Loop L accent multiplier can both cut and strongly boost accented notes', () => {
    assert.equal(computeBastardLoopLAccentGainMultiplier(0), 1);
    assert.ok(computeBastardLoopLAccentGainMultiplier(-1) <= 0.08);
    assert.ok(computeBastardLoopLAccentGainMultiplier(-0.5) < 1);
    assert.ok(computeBastardLoopLAccentGainMultiplier(0.35) > 1.35);
    assert.ok(computeBastardLoopLAccentGainMultiplier(1) >= 3.3);
});

test('Loop L back/forward step moves request audible tone preview', async () => {
    const moveContext = {
        auditionOptions: null,
        bastardLoopLEditStepIndex: 4,
        console: { error() {} },
        setBastardLoopLEditStepIndex(index) {
            moveContext.bastardLoopLEditStepIndex = index;
        },
        auditionBastardLoopLCurrentStepWithReady(options) {
            moveContext.auditionOptions = options;
            return Promise.resolve(true);
        },
        updateBastardLoopLStatus() {}
    };
    vm.runInNewContext(`${extractFunctionSource('moveBastardLoopLStep')}\nglobalThis.moveBastardLoopLStep = moveBastardLoopLStep;`, moveContext);

    moveContext.moveBastardLoopLStep(1);
    await Promise.resolve();

    assert.equal(moveContext.bastardLoopLEditStepIndex, 5);
    assert.deepEqual(plain(moveContext.auditionOptions), {
        silentWhenEmpty: true,
        forceTone: true
    });
});
