const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const transportStartBufferSeconds = Number(indexHtml.match(/const TRANSPORT_START_BUFFER_SECONDS = ([\d.]+);/)[1]);

function installRestartTransportFixture(restartContext) {
    Object.assign(restartContext, {
        window: {}, sequencerBPM: 120, sequencerTimerId: null,
        TRANSPORT_START_BUFFER_SECONDS: transportStartBufferSeconds,
        transportLoopStartTime: null, bastardLoopTransportStartTime: null,
        drumMachineTransportStartTime: null, generatedDryLoopStartTime: null,
        bastardLoopLTransportActive: false, bastardLoopXTransportActive: false,
        generatedDrySource: null, keyboardArpTransportPlaying: false,
        bastardLoopMPlusBuffer: null, bastardLoopKBuffer: null,
        activeGrains: new Map(), activeOscVoices: new Map(),
        retiringOscillatorVoices: new Set(), scheduledGrainVoices: new Set(),
        prewarmTransportBuffers() {}, hasSharedRhythmClockWork: () => false,
        ensureSharedRhythmClockRunning() {}, scheduleSequencer() {},
        stopGrainScheduler() {}, clearTimeout() {}
    });
    vm.runInNewContext([
        indexHtml.match(/const transportSync = [\s\S]*?;/)[0].replace('const transportSync =', 'globalThis.transportSync ='),
        ...[
            'getBufferedTransportStartTime', 'getTransportGridPosition', 'setTransportEpoch',
            'getSharedLoopTransportOriginTime', 'withBufferedTransportStart', 'restartAllTransport',
            'getTransportPreparationLeadSeconds', 'startTransportSource',
            'cancelPreparedTransportStarts', 'startTransportChordLayer'
        ].map(extractFunctionSource),
        'globalThis.restartAllTransport = restartAllTransport;'
    ].join('\n'), restartContext);
}

function extractFunctionSource(name) {
    const asyncSignature = `async function ${name}(`;
    const syncSignature = `function ${name}(`;
    const asyncStart = indexHtml.indexOf(asyncSignature);
    const syncStart = indexHtml.indexOf(syncSignature);
    const start = asyncStart !== -1 ? asyncStart : syncStart;
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
    BASTARD_LOOP_X_STEP_DOUBLE_TAP_MS: 320,
    BASTARD_LOOP_SOURCE_LABELS: {
        samples_leads: 'SAMPLES_LEADS'
    },
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
    extractFunctionSource('parseNoteName'),
    extractFunctionSource('resolveLeadSampleRootNote'),
    extractFunctionSource('createEmptyBastardLoopLStep'),
    extractFunctionSource('normalizeBastardLoopLStep'),
    extractFunctionSource('buildStoredBastardLoopLSampleMetadata'),
    extractFunctionSource('computeBastardLoopLStepTapState'),
    extractFunctionSource('computeBastardLoopXStepTapState'),
    extractFunctionSource('computeBastardLoopLMobileTapState'),
    extractFunctionSource('computeBastardLoopLAccentGainMultiplier'),
    extractFunctionSource('normalizeBastardLoopLDelayDivision'),
    extractFunctionSource('computeBastardLoopLDelayMixLevels'),
    extractFunctionSource('computeBastardLoopLFilterEnvelopePeakCutoff'),
    `globalThis.loopLExports = {
        normalizeLeadSamplePitchClass,
        detectLeadSampleRootNote,
        parseNoteName,
        resolveLeadSampleRootNote,
        createEmptyBastardLoopLStep,
        normalizeBastardLoopLStep,
        buildStoredBastardLoopLSampleMetadata,
        computeBastardLoopLStepTapState,
        computeBastardLoopXStepTapState,
        computeBastardLoopLMobileTapState,
        computeBastardLoopLAccentGainMultiplier,
        normalizeBastardLoopLDelayDivision,
        computeBastardLoopLDelayMixLevels,
        computeBastardLoopLFilterEnvelopePeakCutoff
    };`
].join('\n\n'), context);

const {
    normalizeLeadSamplePitchClass,
    detectLeadSampleRootNote,
    parseNoteName,
    resolveLeadSampleRootNote,
    createEmptyBastardLoopLStep,
    normalizeBastardLoopLStep,
    buildStoredBastardLoopLSampleMetadata,
    computeBastardLoopLStepTapState,
    computeBastardLoopXStepTapState,
    computeBastardLoopLMobileTapState,
    computeBastardLoopLAccentGainMultiplier,
    normalizeBastardLoopLDelayDivision,
    computeBastardLoopLDelayMixLevels,
    computeBastardLoopLFilterEnvelopePeakCutoff
} = context.loopLExports;

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

const TEST_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const TEST_NOTE_SEMITONE_OFFSETS = Object.freeze({
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
});

function testNoteNameToMidi(note) {
    const parsed = parseNoteName(note);
    assert.ok(parsed, `Expected parseable note: ${note}`);
    return ((parsed.octave + 1) * 12) + TEST_NOTE_SEMITONE_OFFSETS[parsed.pitchClass];
}

function testMidiToNoteName(midi) {
    const safeMidi = Math.max(0, Math.min(127, Math.round(Number(midi) || 0)));
    return `${TEST_NOTE_NAMES[safeMidi % 12]}${Math.floor(safeMidi / 12) - 1}`;
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

test('Loop L remembered sample metadata can be rebuilt from stored browser state without the buffer', () => {
    assert.deepEqual(plain(buildStoredBastardLoopLSampleMetadata({
        bastardLoopLSourceKey: 'samples_leads',
        bastardLoopLFileName: 'OS_MS_C4_80s_Lead.wav',
        bastardLoopLRelativePath: 'SAMPLES_LEADS/OS_MS_C4_80s_Lead.wav',
        bastardLoopLRootNote: ''
    })), {
        sourceKey: 'samples_leads',
        sourceLabel: 'SAMPLES_LEADS',
        fileName: 'OS_MS_C4_80s_Lead.wav',
        relativePath: 'SAMPLES_LEADS/OS_MS_C4_80s_Lead.wav',
        rootNote: 'C4',
        summary: 'OS_MS_C4_80s_Lead.wav · root C4'
    });
    assert.equal(buildStoredBastardLoopLSampleMetadata({ bastardLoopLRootNote: 'D3' }), null);
    assert.equal(resolveLeadSampleRootNote('OS_MS_C4_80s_Lead.wav', ''), 'C4');
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

test('Loop L and X step double-tap state treats step 1 as a valid remembered step', () => {
    const firstLTap = plain(computeBastardLoopLStepTapState(-1, 0, 0, 1000));
    assert.deepEqual(firstLTap, {
        isDoubleTap: false,
        nextIndex: 0,
        nextAt: 1000
    });
    assert.deepEqual(plain(computeBastardLoopLStepTapState(firstLTap.nextIndex, firstLTap.nextAt, 0, 1210)), {
        isDoubleTap: true,
        nextIndex: -1,
        nextAt: 0
    });

    const firstXTap = plain(computeBastardLoopXStepTapState(-1, 0, 0, 1000));
    assert.deepEqual(firstXTap, {
        isDoubleTap: false,
        nextIndex: 0,
        nextAt: 1000
    });
    assert.deepEqual(plain(computeBastardLoopXStepTapState(firstXTap.nextIndex, firstXTap.nextAt, 0, 1210)), {
        isDoubleTap: true,
        nextIndex: -1,
        nextAt: 0
    });
});

test('Loop L copy section captures a chosen range and repeats it from the insert point to the pattern end', () => {
    const sourceSequence = [
        { note: 'C3' },
        { note: 'D3' },
        { note: 'E3', accent: true },
        { note: 'F3', slide: true },
        { note: 'G3', ratchet: 2 },
        { note: 'A3' },
        { note: 'B3', rest: true },
        { note: 'C4' }
    ].map((step) => plain(normalizeBastardLoopLStep(step)));
    const originalSequence = plain(sourceSequence);

    const copyContext = {
        bastardLoopLTransposeStartIndex: -1,
        bastardLoopLTransposeEndIndex: -1,
        bastardLoopLCopyMode: 'idle',
        bastardLoopLCopyVariant: 'range',
        bastardLoopLCopyStartIndex: -1,
        bastardLoopLCopyEndIndex: -1,
        bastardLoopLCopyBuffer: [],
        bastardLoopLEditStepIndex: 0,
        bastardLoopLSequence: sourceSequence,
        normalizeBastardLoopLStep,
        getBastardLoopLPatternLength() {
            return copyContext.bastardLoopLSequence.length;
        },
        setBastardLoopLStep(index, step) {
            copyContext.bastardLoopLSequence[index] = plain(step);
        },
        setBastardLoopLEditStepIndex(index) {
            copyContext.bastardLoopLEditStepIndex = index;
        },
        resetBastardLoopLStepTapMemory() {
            copyContext.tapReset = (copyContext.tapReset || 0) + 1;
        },
        getBastardLoopLTransposeSectionBounds() {
            return null;
        },
        resetBastardLoopLTransposeSectionState() {
            copyContext.transposeReset = (copyContext.transposeReset || 0) + 1;
        },
        syncBastardLoopLEditorUi() {
            copyContext.syncs = (copyContext.syncs || 0) + 1;
        },
        updateBastardLoopLStatus(message) {
            copyContext.status = message;
        },
        restartBastardLoopLPlaybackIfNeeded() {
            copyContext.restarted = true;
        },
        saveState() {
            copyContext.saved = true;
        }
    };

    vm.runInNewContext([
        extractFunctionSource('normalizeBastardLoopCopyVariant'),
        extractFunctionSource('resetBastardLoopLCopyState'),
        extractFunctionSource('getBastardLoopLCopyPrompt'),
        extractFunctionSource('beginBastardLoopLCopyFlow'),
        extractFunctionSource('pasteBastardLoopLCopiedRangeAt'),
        extractFunctionSource('handleBastardLoopLCopyStepSelection'),
        'globalThis.beginBastardLoopLCopyFlow = beginBastardLoopLCopyFlow;',
        'globalThis.handleBastardLoopLCopyStepSelection = handleBastardLoopLCopyStepSelection;'
    ].join('\n\n'), copyContext);

    copyContext.beginBastardLoopLCopyFlow('section');
    assert.equal(copyContext.bastardLoopLCopyMode, 'selectStart');
    assert.equal(copyContext.bastardLoopLCopyVariant, 'section');
    assert.equal(copyContext.status, 'Loop L copy section: press section start step.');

    assert.equal(copyContext.handleBastardLoopLCopyStepSelection(2), true);
    assert.equal(copyContext.bastardLoopLCopyMode, 'selectEnd');
    assert.equal(copyContext.bastardLoopLCopyStartIndex, 2);
    assert.equal(copyContext.bastardLoopLEditStepIndex, 2);
    assert.equal(copyContext.status, 'Loop L copy section: start step 3. Press section end step.');

    assert.equal(copyContext.handleBastardLoopLCopyStepSelection(4), true);
    assert.equal(copyContext.bastardLoopLCopyMode, 'selectPaste');
    assert.equal(copyContext.bastardLoopLCopyStartIndex, 2);
    assert.equal(copyContext.bastardLoopLCopyEndIndex, 4);
    assert.equal(copyContext.bastardLoopLEditStepIndex, 4);
    assert.equal(copyContext.status, 'Loop L copy section: 3-5 ready. Press insert step.');
    assert.deepEqual(
        plain(copyContext.bastardLoopLCopyBuffer),
        plain(originalSequence.slice(2, 5))
    );

    assert.equal(copyContext.handleBastardLoopLCopyStepSelection(0), true);
    assert.equal(copyContext.bastardLoopLCopyMode, 'idle');
    assert.equal(copyContext.bastardLoopLCopyVariant, 'range');
    assert.equal(copyContext.bastardLoopLEditStepIndex, 0);
    assert.equal(copyContext.status, 'Loop L copied section 3-5 from step 1 to 8 (8 steps).');
    assert.equal(copyContext.saved, true);
    assert.equal(copyContext.restarted, true);
    assert.deepEqual(
        plain(copyContext.bastardLoopLSequence),
        plain([
            originalSequence[2],
            originalSequence[3],
            originalSequence[4],
            originalSequence[2],
            originalSequence[3],
            originalSequence[4],
            originalSequence[2],
            originalSequence[3]
        ])
    );
});

test('Loop X copy section captures a chosen range and repeats it from the insert point to the pattern end', () => {
    const sourceSequence = [
        { note: 'C2' },
        { note: 'D2', accent: true },
        { note: 'E2' },
        { note: 'F2', slide: true },
        { note: 'G2', ratchet: 2 },
        { note: 'A2' },
        { note: 'B2', rest: true },
        { note: 'C3' }
    ].map((step) => plain(normalizeBastardLoopLStep(step)));
    const originalSequence = plain(sourceSequence);

    const copyContext = {
        bastardLoopXTransposeStartIndex: -1,
        bastardLoopXTransposeEndIndex: -1,
        bastardLoopXCopyMode: 'idle',
        bastardLoopXCopyVariant: 'range',
        bastardLoopXCopyStartIndex: -1,
        bastardLoopXCopyEndIndex: -1,
        bastardLoopXCopyBuffer: [],
        bastardLoopXEditStepIndex: 0,
        bastardLoopXSequence: sourceSequence,
        normalizeBastardLoopXStep(step) {
            return plain(normalizeBastardLoopLStep(step));
        },
        getBastardLoopXPatternLength() {
            return copyContext.bastardLoopXSequence.length;
        },
        setBastardLoopXStep(index, step) {
            copyContext.bastardLoopXSequence[index] = plain(step);
        },
        setBastardLoopXEditStepIndex(index) {
            copyContext.bastardLoopXEditStepIndex = index;
        },
        resetBastardLoopXStepTapMemory() {
            copyContext.tapReset = (copyContext.tapReset || 0) + 1;
        },
        getBastardLoopXTransposeSectionBounds() {
            return null;
        },
        resetBastardLoopXTransposeSectionState() {
            copyContext.transposeReset = (copyContext.transposeReset || 0) + 1;
        },
        syncBastardLoopXEditorUi() {
            copyContext.syncs = (copyContext.syncs || 0) + 1;
        },
        updateBastardLoopXStatus(message) {
            copyContext.status = message;
        },
        restartBastardLoopXPlaybackIfNeeded() {
            copyContext.restarted = true;
        },
        saveState() {
            copyContext.saved = true;
        }
    };

    vm.runInNewContext([
        extractFunctionSource('normalizeBastardLoopCopyVariant'),
        extractFunctionSource('resetBastardLoopXCopyState'),
        extractFunctionSource('getBastardLoopXCopyPrompt'),
        extractFunctionSource('beginBastardLoopXCopyFlow'),
        extractFunctionSource('pasteBastardLoopXCopiedRangeAt'),
        extractFunctionSource('handleBastardLoopXCopyStepSelection'),
        'globalThis.beginBastardLoopXCopyFlow = beginBastardLoopXCopyFlow;',
        'globalThis.handleBastardLoopXCopyStepSelection = handleBastardLoopXCopyStepSelection;'
    ].join('\n\n'), copyContext);

    copyContext.beginBastardLoopXCopyFlow('section');
    assert.equal(copyContext.bastardLoopXCopyMode, 'selectStart');
    assert.equal(copyContext.bastardLoopXCopyVariant, 'section');
    assert.equal(copyContext.status, 'Loop X copy section: press section start step.');

    assert.equal(copyContext.handleBastardLoopXCopyStepSelection(1), true);
    assert.equal(copyContext.bastardLoopXCopyMode, 'selectEnd');
    assert.equal(copyContext.bastardLoopXCopyStartIndex, 1);
    assert.equal(copyContext.bastardLoopXEditStepIndex, 1);
    assert.equal(copyContext.status, 'Loop X copy section: start step 2. Press section end step.');

    assert.equal(copyContext.handleBastardLoopXCopyStepSelection(2), true);
    assert.equal(copyContext.bastardLoopXCopyMode, 'selectPaste');
    assert.equal(copyContext.bastardLoopXCopyEndIndex, 2);
    assert.equal(copyContext.bastardLoopXEditStepIndex, 2);
    assert.equal(copyContext.status, 'Loop X copy section: 2-3 ready. Press insert step.');
    assert.deepEqual(
        plain(copyContext.bastardLoopXCopyBuffer),
        plain(originalSequence.slice(1, 3))
    );

    assert.equal(copyContext.handleBastardLoopXCopyStepSelection(4), true);
    assert.equal(copyContext.bastardLoopXCopyMode, 'idle');
    assert.equal(copyContext.bastardLoopXCopyVariant, 'range');
    assert.equal(copyContext.bastardLoopXEditStepIndex, 4);
    assert.equal(copyContext.status, 'Loop X copied section 2-3 from step 5 to 8 (4 steps).');
    assert.equal(copyContext.saved, true);
    assert.equal(copyContext.restarted, true);
    assert.deepEqual(
        plain(copyContext.bastardLoopXSequence.slice(4, 8)),
        plain([
            originalSequence[1],
            originalSequence[2],
            originalSequence[1],
            originalSequence[2]
        ])
    );
});

test('Loop L transpose section marking limits SEQ +/- to the marked steps', () => {
    const sourceSequence = [
        { note: 'C3' },
        { note: 'D3' },
        { note: 'E3', accent: true },
        { note: 'F3', slide: true },
        { note: 'G3' },
        { rest: true },
        {},
        { note: 'A3' }
    ].map((step) => plain(normalizeBastardLoopLStep(step)));

    const transposeContext = {
        bastardLoopLTransposeMode: 'idle',
        bastardLoopLTransposeStartIndex: -1,
        bastardLoopLTransposeEndIndex: -1,
        bastardLoopLCopyMode: 'idle',
        bastardLoopLEditStepIndex: 0,
        bastardLoopLSequence: sourceSequence,
        normalizeBastardLoopLStep,
        noteNameToMidi: testNoteNameToMidi,
        midiToNoteName: testMidiToNoteName,
        getBastardLoopLPatternLength() {
            return transposeContext.bastardLoopLSequence.length;
        },
        ensureBastardLoopLSequenceCapacity() {},
        setBastardLoopLEditStepIndex(index) {
            transposeContext.bastardLoopLEditStepIndex = index;
        },
        resetBastardLoopLCopyState() {
            transposeContext.copyReset = (transposeContext.copyReset || 0) + 1;
            transposeContext.bastardLoopLCopyMode = 'idle';
        },
        resetBastardLoopLStepTapMemory() {
            transposeContext.tapReset = (transposeContext.tapReset || 0) + 1;
        },
        syncBastardLoopLEditorUi() {
            transposeContext.editorSyncs = (transposeContext.editorSyncs || 0) + 1;
        },
        syncBastardLoopLUi() {
            transposeContext.uiSyncs = (transposeContext.uiSyncs || 0) + 1;
        },
        updateBastardLoopLStatus(message) {
            transposeContext.status = message;
        },
        saveState() {
            transposeContext.saved = (transposeContext.saved || 0) + 1;
        },
        auditionBastardLoopLCurrentStep() {
            transposeContext.auditioned = true;
        },
        restartBastardLoopLPlaybackIfNeeded() {
            transposeContext.restarted = true;
        }
    };

    vm.runInNewContext([
        extractFunctionSource('getNormalizedBastardLoopSectionBounds'),
        extractFunctionSource('getBastardLoopLTransposeSectionBounds'),
        extractFunctionSource('resetBastardLoopLTransposeSectionState'),
        extractFunctionSource('getBastardLoopLTransposeSectionPrompt'),
        extractFunctionSource('beginBastardLoopLTransposeSectionFlow'),
        extractFunctionSource('handleBastardLoopLTransposeSectionStepSelection'),
        extractFunctionSource('transposeBastardLoopLSequence'),
        'globalThis.beginBastardLoopLTransposeSectionFlow = beginBastardLoopLTransposeSectionFlow;',
        'globalThis.handleBastardLoopLTransposeSectionStepSelection = handleBastardLoopLTransposeSectionStepSelection;',
        'globalThis.transposeBastardLoopLSequence = transposeBastardLoopLSequence;'
    ].join('\n\n'), transposeContext);

    transposeContext.beginBastardLoopLTransposeSectionFlow();
    assert.equal(transposeContext.bastardLoopLTransposeMode, 'selectStart');
    assert.equal(transposeContext.status, 'Loop L transpose section: press section start step.');

    assert.equal(transposeContext.handleBastardLoopLTransposeSectionStepSelection(1), true);
    assert.equal(transposeContext.bastardLoopLTransposeMode, 'selectEnd');
    assert.equal(transposeContext.bastardLoopLTransposeStartIndex, 1);
    assert.equal(transposeContext.bastardLoopLEditStepIndex, 1);
    assert.equal(transposeContext.status, 'Loop L transpose section: start step 2. Press section end step.');

    assert.equal(transposeContext.handleBastardLoopLTransposeSectionStepSelection(3), true);
    assert.equal(transposeContext.bastardLoopLTransposeMode, 'idle');
    assert.equal(transposeContext.bastardLoopLTransposeStartIndex, 1);
    assert.equal(transposeContext.bastardLoopLTransposeEndIndex, 3);
    assert.equal(transposeContext.bastardLoopLEditStepIndex, 3);
    assert.equal(transposeContext.status, 'Loop L transpose section 2-4 marked. Seq +/- now affect only that section.');
    assert.equal(transposeContext.saved, 1);

    transposeContext.transposeBastardLoopLSequence(1);
    assert.deepEqual(
        plain(transposeContext.bastardLoopLSequence.map((step) => step.note || '')),
        ['C3', 'D#3', 'F3', 'F#3', 'G3', '', '', 'A3']
    );
    assert.equal(transposeContext.status, 'Shifted 3 Loop L steps in section 2-4 up 1 semitone.');
    assert.equal(transposeContext.saved, 2);
    assert.equal(transposeContext.restarted, true);
    assert.equal(transposeContext.auditioned, true);

    transposeContext.beginBastardLoopLTransposeSectionFlow();
    assert.equal(transposeContext.bastardLoopLTransposeStartIndex, -1);
    assert.equal(transposeContext.bastardLoopLTransposeEndIndex, -1);
    assert.equal(transposeContext.status, 'Loop L transpose section cleared. Seq +/- now affect the full pattern.');
    assert.equal(transposeContext.saved, 3);
});

test('Loop X transpose section marking limits SEQ +/- to the marked steps', () => {
    const sourceSequence = [
        { note: 'C2' },
        { note: 'D2' },
        { note: 'E2', accent: true },
        { note: 'F2', slide: true },
        { note: 'G2' },
        { rest: true },
        {},
        { note: 'A2' }
    ].map((step) => plain(normalizeBastardLoopLStep(step)));

    const transposeContext = {
        bastardLoopXTransposeMode: 'idle',
        bastardLoopXTransposeStartIndex: -1,
        bastardLoopXTransposeEndIndex: -1,
        bastardLoopXCopyMode: 'idle',
        bastardLoopXEditStepIndex: 0,
        bastardLoopXSequence: sourceSequence,
        normalizeBastardLoopXStep(step) {
            return plain(normalizeBastardLoopLStep(step));
        },
        noteNameToMidi: testNoteNameToMidi,
        midiToNoteName: testMidiToNoteName,
        getBastardLoopXPatternLength() {
            return transposeContext.bastardLoopXSequence.length;
        },
        ensureBastardLoopXSequenceCapacity() {},
        setBastardLoopXEditStepIndex(index) {
            transposeContext.bastardLoopXEditStepIndex = index;
        },
        resetBastardLoopXCopyState() {
            transposeContext.copyReset = (transposeContext.copyReset || 0) + 1;
            transposeContext.bastardLoopXCopyMode = 'idle';
        },
        resetBastardLoopXStepTapMemory() {
            transposeContext.tapReset = (transposeContext.tapReset || 0) + 1;
        },
        syncBastardLoopXEditorUi() {
            transposeContext.editorSyncs = (transposeContext.editorSyncs || 0) + 1;
        },
        syncBastardLoopXUi() {
            transposeContext.uiSyncs = (transposeContext.uiSyncs || 0) + 1;
        },
        updateBastardLoopXStatus(message) {
            transposeContext.status = message;
        },
        saveState() {
            transposeContext.saved = (transposeContext.saved || 0) + 1;
        },
        auditionBastardLoopXCurrentStep() {
            transposeContext.auditioned = true;
        },
        restartBastardLoopXPlaybackIfNeeded() {
            transposeContext.restarted = true;
        }
    };

    vm.runInNewContext([
        extractFunctionSource('getNormalizedBastardLoopSectionBounds'),
        extractFunctionSource('getBastardLoopXTransposeSectionBounds'),
        extractFunctionSource('resetBastardLoopXTransposeSectionState'),
        extractFunctionSource('getBastardLoopXTransposeSectionPrompt'),
        extractFunctionSource('beginBastardLoopXTransposeSectionFlow'),
        extractFunctionSource('handleBastardLoopXTransposeSectionStepSelection'),
        extractFunctionSource('transposeBastardLoopXSequence'),
        'globalThis.beginBastardLoopXTransposeSectionFlow = beginBastardLoopXTransposeSectionFlow;',
        'globalThis.handleBastardLoopXTransposeSectionStepSelection = handleBastardLoopXTransposeSectionStepSelection;',
        'globalThis.transposeBastardLoopXSequence = transposeBastardLoopXSequence;'
    ].join('\n\n'), transposeContext);

    transposeContext.beginBastardLoopXTransposeSectionFlow();
    assert.equal(transposeContext.bastardLoopXTransposeMode, 'selectStart');
    assert.equal(transposeContext.status, 'Loop X transpose section: press section start step.');

    assert.equal(transposeContext.handleBastardLoopXTransposeSectionStepSelection(2), true);
    assert.equal(transposeContext.bastardLoopXTransposeMode, 'selectEnd');
    assert.equal(transposeContext.bastardLoopXTransposeStartIndex, 2);
    assert.equal(transposeContext.bastardLoopXEditStepIndex, 2);
    assert.equal(transposeContext.status, 'Loop X transpose section: start step 3. Press section end step.');

    assert.equal(transposeContext.handleBastardLoopXTransposeSectionStepSelection(4), true);
    assert.equal(transposeContext.bastardLoopXTransposeMode, 'idle');
    assert.equal(transposeContext.bastardLoopXTransposeStartIndex, 2);
    assert.equal(transposeContext.bastardLoopXTransposeEndIndex, 4);
    assert.equal(transposeContext.bastardLoopXEditStepIndex, 4);
    assert.equal(transposeContext.status, 'Loop X transpose section 3-5 marked. Seq +/- now affect only that section.');
    assert.equal(transposeContext.saved, 1);

    transposeContext.transposeBastardLoopXSequence(-1);
    assert.deepEqual(
        plain(transposeContext.bastardLoopXSequence.map((step) => step.note || '')),
        ['C2', 'D2', 'D#2', 'E2', 'F#2', '', '', 'A2']
    );
    assert.equal(transposeContext.status, 'Shifted 3 Loop X steps in section 3-5 down 1 semitone.');
    assert.equal(transposeContext.saved, 2);
    assert.equal(transposeContext.restarted, true);
    assert.equal(transposeContext.auditioned, true);

    transposeContext.beginBastardLoopXTransposeSectionFlow();
    assert.equal(transposeContext.bastardLoopXTransposeStartIndex, -1);
    assert.equal(transposeContext.bastardLoopXTransposeEndIndex, -1);
    assert.equal(transposeContext.status, 'Loop X transpose section cleared. Seq +/- now affect the full pattern.');
    assert.equal(transposeContext.saved, 3);
});

test('Loop L accent multiplier can both cut and strongly boost accented notes', () => {
    assert.equal(computeBastardLoopLAccentGainMultiplier(0), 1);
    assert.ok(computeBastardLoopLAccentGainMultiplier(-1) <= 0.08);
    assert.ok(computeBastardLoopLAccentGainMultiplier(-0.5) < 1);
    assert.ok(computeBastardLoopLAccentGainMultiplier(0.35) > 1.35);
    assert.ok(computeBastardLoopLAccentGainMultiplier(1) >= 3.3);
});

test('Loop L mobile tap state suppresses delayed synthetic click after touchstart', () => {
    const firstTouch = plain(computeBastardLoopLMobileTapState(0, 0, 'touchstart', 1000));
    assert.deepEqual(firstTouch, {
        handled: true,
        nextLastHandledAt: 1000,
        nextSuppressClickUntil: 1650
    });

    const delayedClick = plain(computeBastardLoopLMobileTapState(
        firstTouch.nextLastHandledAt,
        firstTouch.nextSuppressClickUntil,
        'click',
        1300
    ));
    assert.deepEqual(delayedClick, {
        handled: false,
        nextLastHandledAt: 1000,
        nextSuppressClickUntil: 1650
    });

    const freshClick = plain(computeBastardLoopLMobileTapState(
        firstTouch.nextLastHandledAt,
        firstTouch.nextSuppressClickUntil,
        'click',
        1760
    ));
    assert.equal(freshClick.handled, true);
    assert.equal(freshClick.nextLastHandledAt, 1760);
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

test('Loop L delay division normalizer accepts new straight dotted and triplet values', () => {
    assert.equal(normalizeBastardLoopLDelayDivision('0.5'), '0.5');
    assert.equal(normalizeBastardLoopLDelayDivision('1d'), '1d');
    assert.equal(normalizeBastardLoopLDelayDivision('4t'), '4t');
    assert.equal(normalizeBastardLoopLDelayDivision('weird'), '2');
});

test('Loop L source-mode normalizer only preserves synth as the alternate source', () => {
    const sourceModeContext = {};
    vm.runInNewContext([
        extractFunctionSource('normalizeBastardLoopLSourceMode'),
        'globalThis.normalizeBastardLoopLSourceMode = normalizeBastardLoopLSourceMode;'
    ].join('\n\n'), sourceModeContext);

    assert.equal(sourceModeContext.normalizeBastardLoopLSourceMode('synth'), 'synth');
    assert.equal(sourceModeContext.normalizeBastardLoopLSourceMode(' SYNTH '), 'synth');
    assert.equal(sourceModeContext.normalizeBastardLoopLSourceMode('sample'), 'sample');
    assert.equal(sourceModeContext.normalizeBastardLoopLSourceMode('mic'), 'sample');
    assert.equal(sourceModeContext.normalizeBastardLoopLSourceMode(''), 'sample');
});

test('Loop L synth readiness avoids redundant path refresh once the shared synth is already audible', () => {
    const synthReadyContext = {
        audioContext: {},
        oscillatorsEnabled: true,
        generatedSampleSolo: false,
        oscMix: 0.5,
        oscOutputGain: {},
        ensureSynthVoicePathAudibleCalls: 0,
        ensureSynthVoicePathAudible() {
            synthReadyContext.ensureSynthVoicePathAudibleCalls += 1;
        }
    };

    vm.runInNewContext([
        extractFunctionSource('ensureBastardLoopLSynthReady'),
        'globalThis.ensureBastardLoopLSynthReady = ensureBastardLoopLSynthReady;'
    ].join('\n\n'), synthReadyContext);

    assert.equal(synthReadyContext.ensureBastardLoopLSynthReady(), true);
    assert.equal(synthReadyContext.ensureSynthVoicePathAudibleCalls, 0);

    synthReadyContext.oscMix = 0.1;
    assert.equal(synthReadyContext.ensureBastardLoopLSynthReady({ forceMinimumMix: true, minOscMix: 0.35 }), true);
    assert.equal(synthReadyContext.ensureSynthVoicePathAudibleCalls, 1);
});

test('Loop L delay mix levels keep dry at zero mix and favor wet/send at high mix', () => {
    assert.deepEqual(plain(computeBastardLoopLDelayMixLevels(0)), {
        dryGain: 1,
        sendGain: 0,
        wetGain: 0,
        feedbackGain: 0
    });
    const heavyMix = computeBastardLoopLDelayMixLevels(1);
    assert.ok(heavyMix.dryGain < 0.001);
    assert.ok(heavyMix.sendGain > 0.99);
    assert.ok(heavyMix.wetGain > 0.9);
    assert.ok(heavyMix.feedbackGain >= 0.34);
});

test('Loop L filter envelope peak cutoff opens upward from the chosen cutoff and stays clamped', () => {
    assert.equal(computeBastardLoopLFilterEnvelopePeakCutoff(1200, 0), 1200);
    assert.equal(computeBastardLoopLFilterEnvelopePeakCutoff(18000, 1), 18000);
    assert.equal(computeBastardLoopLFilterEnvelopePeakCutoff(1200, 0.5), 4800);
    assert.equal(computeBastardLoopLFilterEnvelopePeakCutoff(50, 1), 4800);
});

test('Loop X transport helpers stay cloned from Loop L for delay and filter scheduling', () => {
    const xContext = {};
    vm.runInNewContext([
        extractFunctionSource('computeBastardLoopLDelayMixLevels'),
        extractFunctionSource('computeBastardLoopXDelayMixLevels'),
        extractFunctionSource('computeBastardLoopLFilterEnvelopePeakCutoff'),
        extractFunctionSource('computeBastardLoopXFilterEnvelopePeakCutoff'),
        `globalThis.loopXExports = {
            computeBastardLoopLDelayMixLevels,
            computeBastardLoopXDelayMixLevels,
            computeBastardLoopLFilterEnvelopePeakCutoff,
            computeBastardLoopXFilterEnvelopePeakCutoff
        };`
    ].join('\n\n'), xContext);

    const exported = xContext.loopXExports;
    assert.deepEqual(
        plain(exported.computeBastardLoopXDelayMixLevels(0.65)),
        plain(exported.computeBastardLoopLDelayMixLevels(0.65))
    );
    assert.equal(
        exported.computeBastardLoopXFilterEnvelopePeakCutoff(1200, 0.5),
        exported.computeBastardLoopLFilterEnvelopePeakCutoff(1200, 0.5)
    );
});

test('Loop L and X keyboard bindings retain independent layer and playback callbacks', () => {
    const calls = [];
    const bindings = {
        bindSequencerSampleKeyboardKey: (...args) => calls.push(args),
        previewBastardLoopLNoteFromInput() {}, previewBastardLoopXNoteFromInput() {},
        updateBastardLoopLStatus() {}, updateBastardLoopXStatus() {}
    };
    vm.runInNewContext(['bindBastardLoopLKeyboardKey', 'bindBastardLoopXKeyboardKey'].map(extractFunctionSource).join('\n'), bindings);
    const l = {}, x = {};
    bindings.bindBastardLoopLKeyboardKey(l);
    bindings.bindBastardLoopXKeyboardKey(x);
    assert.deepEqual(calls, [
        [l, 'L', bindings.previewBastardLoopLNoteFromInput, bindings.updateBastardLoopLStatus],
        [x, 'X', bindings.previewBastardLoopXNoteFromInput, bindings.updateBastardLoopXStatus]
    ]);
});

test('Loop L and X performance start buttons use layer-specific mobile transport wiring', () => {
    const lButtonMarkup = indexHtml.match(/<button class="performance-btn" id="performanceBastardLoopLStartBtn"[^>]*>/)?.[0] || '';
    const xButtonMarkup = indexHtml.match(/<button class="performance-btn" id="performanceBastardLoopXStartBtn"[^>]*>/)?.[0] || '';

    assert.match(lButtonMarkup, /type="button"/);
    assert.match(xButtonMarkup, /type="button"/);
    assert.doesNotMatch(lButtonMarkup, /data-bastardloop-start/);
    assert.doesNotMatch(xButtonMarkup, /data-bastardloop-start/);

    assert.match(indexHtml, /const performanceBastardLoopLStartBtn = document\.getElementById\('performanceBastardLoopLStartBtn'\);/);
    assert.match(indexHtml, /const performanceBastardLoopXStartBtn = document\.getElementById\('performanceBastardLoopXStartBtn'\);/);
    assert.match(indexHtml, /bindBastardLoopLMobileTap\(performanceBastardLoopLStartBtn,\s*async \(\) => \{\s*await toggleBastardLoopLTransportFromUi\(\);\s*\}\);/s);
    assert.match(indexHtml, /bindBastardLoopLMobileTap\(performanceBastardLoopXStartBtn,\s*async \(\) => \{\s*await toggleBastardLoopXTransportFromUi\(\);\s*\}\);/s);
    assert.match(extractFunctionSource('syncBastardLoopLUi'), /performanceBastardLoopLStartBtn/);
    assert.match(extractFunctionSource('syncBastardLoopXUi'), /performanceBastardLoopXStartBtn/);
});

test('Loop L and X sequencers expose copy section buttons wired to the section-copy flow', () => {
    assert.match(indexHtml, /id="bastardLoopLCopySectionBtn"[^>]*>Copy Sec</);
    assert.match(indexHtml, /id="bastardLoopXCopySectionBtn"[^>]*>Copy Sec</);
    assert.match(indexHtml, /const bastardLoopLCopySectionBtn = document\.getElementById\('bastardLoopLCopySectionBtn'\);/);
    assert.match(indexHtml, /const bastardLoopXCopySectionBtn = document\.getElementById\('bastardLoopXCopySectionBtn'\);/);
    assert.match(indexHtml, /bindBastardLoopLMobileTap\(bastardLoopLCopySectionBtn,\s*\(\) => \{\s*beginBastardLoopLCopyFlow\('section'\);/s);
    assert.match(indexHtml, /bindBastardLoopLMobileTap\(bastardLoopXCopySectionBtn,\s*\(\) => \{\s*beginBastardLoopXCopyFlow\('section'\);/s);
});

test('Loop L and X sequencers expose transpose section buttons wired to the marking flow', () => {
    assert.match(indexHtml, /id="bastardLoopLTransposeSectionBtn"[^>]*>Mark Trans</);
    assert.match(indexHtml, /id="bastardLoopXTransposeSectionBtn"[^>]*>Mark Trans</);
    assert.match(indexHtml, /const bastardLoopLTransposeSectionBtn = document\.getElementById\('bastardLoopLTransposeSectionBtn'\);/);
    assert.match(indexHtml, /const bastardLoopXTransposeSectionBtn = document\.getElementById\('bastardLoopXTransposeSectionBtn'\);/);
    assert.match(indexHtml, /bindBastardLoopLMobileTap\(bastardLoopLTransposeSectionBtn,\s*\(\) => \{\s*beginBastardLoopLTransposeSectionFlow\(\);/s);
    assert.match(indexHtml, /bindBastardLoopLMobileTap\(bastardLoopXTransposeSectionBtn,\s*\(\) => \{\s*beginBastardLoopXTransposeSectionFlow\(\);/s);
});

test('Mega Randomize includes coordinated Loop L/X preparation and random sample loads', () => {
    const megaRandomSource = extractFunctionSource('runMegaRandomization');

    assert.match(megaRandomSource, /randomizeMegaBastardLoopLeadAndBassSettings\(patchResult\?\.generationProfile \|\| createMusicalGenerationProfile\(\)\);/);
    assert.match(megaRandomSource, /\{ label: 'Loop L', run: \(\) => loadBastardLoopLSampleFromSource\(\) \}/);
    assert.match(megaRandomSource, /\{ label: 'Loop X', run: \(\) => loadBastardLoopXSampleFromSource\(\) \}/);
    assert.match(indexHtml, /function randomizeMegaBastardLoopLeadAndBassSettings\(profile = \{\}\)/);
});

test('Loop L and X transpose section state is persisted for app restore', () => {
    const saveStateSource = extractFunctionSource('saveState');

    assert.match(saveStateSource, /bastardLoopLTransposeStartIndex:/);
    assert.match(saveStateSource, /bastardLoopLTransposeEndIndex:/);
    assert.match(saveStateSource, /bastardLoopXTransposeStartIndex:/);
    assert.match(saveStateSource, /bastardLoopXTransposeEndIndex:/);
    assert.match(indexHtml, /state\.modes\.bastardLoopLTransposeStartIndex !== undefined \|\| state\.modes\.bastardLoopLTransposeEndIndex !== undefined/);
    assert.match(indexHtml, /state\.modes\.bastardLoopXTransposeStartIndex !== undefined \|\| state\.modes\.bastardLoopXTransposeEndIndex !== undefined/);
});

test('Loop L and X cards expose random sample and random pattern buttons plus filter mode selects', () => {
    assert.match(indexHtml, /id="performanceBastardLoopLRandomBtn"[^>]*>Load Random Sample</);
    assert.match(indexHtml, /id="performanceBastardLoopLRandomPatternBtn"[^>]*>Random Pattern</);
    assert.match(indexHtml, /id="performanceBastardLoopXRandomBtn"[^>]*>Load Random Sample</);
    assert.match(indexHtml, /id="performanceBastardLoopXRandomPatternBtn"[^>]*>Random Pattern</);
    assert.match(indexHtml, /id="performanceBastardLoopLFilterMode"/);
    assert.match(indexHtml, /id="performanceBastardLoopXFilterMode"/);
    for (const value of ['lowpass-12', 'lowpass-24', 'lowpass-48', 'lowpass-96', 'highpass-12', 'highpass-24', 'highpass-48', 'highpass-96']) {
        assert.match(indexHtml, new RegExp(`<option value="${value}"[^>]*>`), `${value} should be offered in the filter dropdowns`);
    }
});

test('Loop L and X random pattern helpers reuse the existing sequence builders and sync state', () => {
    const randomPatternContext = {
        LOOP_SCALE_FAMILIES: [{ intervals: [0, 2, 3, 5, 7, 10] }],
        bastardLoopLEditStepIndex: 5,
        bastardLoopLRatchetEditStepIndex: 2,
        bastardLoopLSequence: [],
        bastardLoopXEditStepIndex: 4,
        bastardLoopXRatchetEditStepIndex: 3,
        bastardLoopXSequence: [{ note: 'C2' }, { note: 'G2' }],
        createMusicalGenerationProfile() {
            return {
                energy: 0.82,
                scale: { intervals: [0, 3, 5, 7, 10] }
            };
        },
        getBastardLoopLPatternLength() {
            return 8;
        },
        getBastardLoopXPatternLength() {
            return 8;
        },
        getBastardLoopLRootNote() {
            return 'D4';
        },
        getBastardLoopXRootNote() {
            return 'C2';
        },
        buildMegaRandomBastardLoopLSequence(options) {
            randomPatternContext.lOptions = plain(options);
            return [{ note: 'D4' }, { note: 'F4' }];
        },
        buildMegaRandomBastardLoopXSequence(options) {
            randomPatternContext.xOptions = plain(options);
            return [{ note: 'C2' }, { note: 'E2' }];
        },
        resetBastardLoopLStepTapMemory() {
            randomPatternContext.lTapReset = true;
        },
        resetBastardLoopXStepTapMemory() {
            randomPatternContext.xTapReset = true;
        },
        syncBastardLoopLEditorUi() {
            randomPatternContext.lEditorSynced = true;
        },
        syncBastardLoopLUi() {
            randomPatternContext.lUiSynced = true;
        },
        syncBastardLoopXEditorUi() {
            randomPatternContext.xEditorSynced = true;
        },
        syncBastardLoopXUi() {
            randomPatternContext.xUiSynced = true;
        },
        restartBastardLoopLPlaybackIfNeeded() {
            randomPatternContext.lRestarted = true;
        },
        restartBastardLoopXPlaybackIfNeeded() {
            randomPatternContext.xRestarted = true;
        },
        updateBastardLoopLStatus(message) {
            randomPatternContext.lStatus = message;
        },
        updateBastardLoopXStatus(message) {
            randomPatternContext.xStatus = message;
        },
        setStatus(message) {
            randomPatternContext.globalStatus = message;
        },
        saveState() {
            randomPatternContext.saved = (randomPatternContext.saved || 0) + 1;
        }
    };

    vm.runInNewContext([
        extractFunctionSource('randomizeBastardLoopLPattern'),
        extractFunctionSource('randomizeBastardLoopXPattern'),
        'globalThis.randomizeBastardLoopLPattern = randomizeBastardLoopLPattern;',
        'globalThis.randomizeBastardLoopXPattern = randomizeBastardLoopXPattern;'
    ].join('\n\n'), randomPatternContext);

    assert.deepEqual(
        plain(randomPatternContext.randomizeBastardLoopLPattern()),
        [{ note: 'D4' }, { note: 'F4' }]
    );
    assert.deepEqual(randomPatternContext.lOptions, {
        stepCount: 8,
        rootNote: 'D4',
        scaleIntervals: [0, 3, 5, 7, 10],
        energy: 0.82,
        bassSequence: [{ note: 'C2' }, { note: 'G2' }]
    });
    assert.equal(randomPatternContext.bastardLoopLEditStepIndex, 0);
    assert.equal(randomPatternContext.bastardLoopLRatchetEditStepIndex, -1);
    assert.equal(randomPatternContext.lTapReset, true);
    assert.equal(randomPatternContext.lEditorSynced, true);
    assert.equal(randomPatternContext.lUiSynced, true);
    assert.equal(randomPatternContext.lRestarted, true);
    assert.equal(randomPatternContext.lStatus, 'Loop L pattern randomized across 8 steps.');

    assert.deepEqual(
        plain(randomPatternContext.randomizeBastardLoopXPattern()),
        [{ note: 'C2' }, { note: 'E2' }]
    );
    assert.deepEqual(randomPatternContext.xOptions, {
        stepCount: 8,
        rootNote: 'C2',
        scaleIntervals: [0, 3, 5, 7, 10],
        energy: 0.82
    });
    assert.equal(randomPatternContext.bastardLoopXEditStepIndex, 0);
    assert.equal(randomPatternContext.bastardLoopXRatchetEditStepIndex, -1);
    assert.equal(randomPatternContext.xTapReset, true);
    assert.equal(randomPatternContext.xEditorSynced, true);
    assert.equal(randomPatternContext.xUiSynced, true);
    assert.equal(randomPatternContext.xRestarted, true);
    assert.equal(randomPatternContext.xStatus, 'Loop X pattern randomized across 8 steps.');
    assert.equal(randomPatternContext.globalStatus, 'Loop X pattern randomized across 8 steps.');
    assert.equal(randomPatternContext.saved, 2);
});

test('Loop L and X mega-random motif length prefers 16 steps when available', () => {
    const motifContext = {};

    vm.runInNewContext([
        extractFunctionSource('getMegaRandomBastardLoopMotifLength'),
        'globalThis.getMegaRandomBastardLoopMotifLength = getMegaRandomBastardLoopMotifLength;'
    ].join('\n\n'), motifContext);

    assert.equal(motifContext.getMegaRandomBastardLoopMotifLength(64), 16);
    assert.equal(motifContext.getMegaRandomBastardLoopMotifLength(32), 16);
    assert.equal(motifContext.getMegaRandomBastardLoopMotifLength(24), 16);
    assert.equal(motifContext.getMegaRandomBastardLoopMotifLength(16), 16);
    assert.equal(motifContext.getMegaRandomBastardLoopMotifLength(8), 8);
    assert.equal(motifContext.getMegaRandomBastardLoopMotifLength(4), 4);
    assert.equal(motifContext.getMegaRandomBastardLoopMotifLength(3), 3);
});

test('Loop L keeps its lead library and X random samples honour its protected repository', async () => {
    for (const [prefix, expectedSource, expectedLabel] of [
        ['L', 'samples_leads', 'SAMPLES_LEADS'],
        ['X', 'samples_bass', 'SAMPLES_BASS'],
        ['X', 'samples_altbass', 'SAMPLES_ALTBASS']
    ]) {
        const loaderContext = {
            audioContext: {},
            bastardLoopXRepository: expectedSource,
            DROPBOX_SAMPLE_SOURCE_API_URL: 'https://example.invalid/api/source-sample',
            BASTARD_LOOP_SOURCE_LABELS: {
                samples_leads: 'SAMPLES_LEADS',
                samples_bass: 'SAMPLES_BASS',
                samples_altbass: 'SAMPLES_ALTBASS'
            },
            Date: {
                now() {
                    return 1234567890;
                }
            },
            Math: {
                random() {
                    return 0.123456789;
                }
            },
            setStatus(message) {
                loaderContext.status = message;
            },
            async fetch(url, options) {
                loaderContext.request = {
                    url,
                    options: {
                        ...plain(options),
                        body: JSON.parse(options.body)
                    }
                };
                return { ok: true, headers: { get: () => null } };
            }
        };
        loaderContext[`loadBastardLoop${prefix}SampleFromResponse`] = async (_response, fallback) => {
            loaderContext.fallback = plain(fallback);
        };
        vm.runInNewContext(`${extractFunctionSource(`loadBastardLoop${prefix}SampleFromSource`)}\nglobalThis.loadBastardLoop${prefix}SampleFromSource = loadBastardLoop${prefix}SampleFromSource;`, loaderContext);

        await loaderContext[`loadBastardLoop${prefix}SampleFromSource`]();

        assert.equal(loaderContext.request.url, 'https://example.invalid/api/source-sample');
        assert.equal(loaderContext.request.options.method, 'POST');
        assert.equal(loaderContext.request.options.body.source, expectedSource);
        assert.equal(loaderContext.fallback.sourceKey, expectedSource);
        assert.equal(loaderContext.fallback.sourceLabel, expectedLabel);
    }
});

test('Loop L and X filter mode is persisted and used by preview and scheduled voices', () => {
    assert.match(extractFunctionSource('saveState'), /bastardLoopLFilterMode:\s*getBastardLoopLFilterMode\(\)/);
    assert.match(extractFunctionSource('saveState'), /bastardLoopXFilterMode:\s*getBastardLoopXFilterMode\(\)/);
    assert.match(indexHtml, /state\.modes\.bastardLoopLFilterMode !== undefined/);
    assert.match(indexHtml, /state\.modes\.bastardLoopXFilterMode !== undefined/);
    assert.match(extractFunctionSource('scheduleBastardLoopLSingleVoice'), /createBastardLoopConfigurableFilters\(getBastardLoopLFilterCutoff\(\), getBastardLoopLFilterMode\(\)\)/);
    assert.match(extractFunctionSource('previewBastardLoopLStep'), /createBastardLoopConfigurableFilters\(getBastardLoopLFilterCutoff\(\), getBastardLoopLFilterMode\(\)\)/);
    assert.match(extractFunctionSource('scheduleBastardLoopXSingleVoice'), /createBastardLoopConfigurableFilters\(getBastardLoopXFilterCutoff\(\), getBastardLoopXFilterMode\(\)\)/);
    assert.match(extractFunctionSource('previewBastardLoopXStep'), /createBastardLoopConfigurableFilters\(getBastardLoopXFilterCutoff\(\), getBastardLoopXFilterMode\(\)\)/);
});

test('Loop L and X ready prep preserves a playable level through UI sync', () => {
    for (const prefix of ['L', 'X']) {
        const elements = {
            [`performanceBastardLoop${prefix}Level`]: { value: '0' },
            [`performanceBastardLoop${prefix}LevelMixer`]: { value: '0' },
            [`performanceBastardLoop${prefix}LevelValue`]: { textContent: '0%' },
            [`performanceBastardLoop${prefix}LevelMixerValue`]: { textContent: '0%' }
        };
        const readyContext = {
            MIX_HEADROOM: 1,
            document: {
                getElementById(id) {
                    return elements[id] || null;
                }
            },
            getLoopLayerSoloGain() {
                return 1;
            },
            syncPerformanceControlState() {
                readyContext.synced = (readyContext.synced || 0) + 1;
            },
            saveState() {
                readyContext.saved = true;
            }
        };
        readyContext[`bastardLoop${prefix}Enabled`] = true;
        readyContext[`bastardLoop${prefix}Level`] = 0.5;
        if (prefix === 'L') {
            readyContext.isBastardLoopLUsingSynth = () => false;
            readyContext.ensureBastardLoopLSynthReady = () => true;
        }
        readyContext[`syncBastardLoop${prefix}Ui`] = () => {
            readyContext.levelAfterSync = readyContext[`getBastardLoop${prefix}LevelValue`]({ applyLayerToggle: false });
        };

        vm.runInNewContext([
            extractFunctionSource(`getBastardLoop${prefix}LevelValue`),
            extractFunctionSource(`setBastardLoop${prefix}ReadyLevelForTransport`),
            extractFunctionSource(`ensureBastardLoop${prefix}ReadyForTransport`),
            `globalThis.getBastardLoop${prefix}LevelValue = getBastardLoop${prefix}LevelValue;`,
            `globalThis.ensureBastardLoop${prefix}ReadyForTransport = ensureBastardLoop${prefix}ReadyForTransport;`
        ].join('\n\n'), readyContext);

        assert.equal(readyContext[`ensureBastardLoop${prefix}ReadyForTransport`](), true);
        assert.equal(readyContext[`bastardLoop${prefix}Level`], 0.5);
        assert.equal(readyContext.levelAfterSync, 0.5);
        assert.equal(elements[`performanceBastardLoop${prefix}Level`].value, '50');
        assert.equal(elements[`performanceBastardLoop${prefix}LevelMixer`].value, '50');
        assert.equal(elements[`performanceBastardLoop${prefix}LevelValue`].textContent, '50%');
        assert.equal(elements[`performanceBastardLoop${prefix}LevelMixerValue`].textContent, '50%');
        assert.equal(readyContext.saved, true);
        assert.ok(readyContext.synced >= 1);
    }
});

test('Bastardloop M ready prep preserves a playable level through UI sync', () => {
    const elements = {
        performanceBastardLoopMLevel: { value: '0' },
        performanceBastardLoopMLevelMixer: { value: '0' },
        performanceBastardLoopMLevelValue: { textContent: '0%' },
        performanceBastardLoopMLevelMixerValue: { textContent: '0%' }
    };
    const readyContext = {
        MIX_HEADROOM: 1,
        document: {
            getElementById(id) {
                return elements[id] || null;
            }
        },
        getLoopLayerSoloGain() {
            return 1;
        },
        updateBastardLoopMMix() {
            readyContext.mixUpdates = (readyContext.mixUpdates || 0) + 1;
        },
        syncPerformanceControlState() {
            readyContext.synced = (readyContext.synced || 0) + 1;
        },
        syncBastardLoopMUi() {
            readyContext.levelAfterSync = readyContext.getBastardLoopMLevelValue({ applyLayerToggle: false });
        },
        saveState() {
            readyContext.saved = true;
        },
        bastardLoopMEnabled: false,
        bastardLoopMLevel: 0
    };
    vm.runInNewContext([
        extractFunctionSource('getBastardLoopMLevelValue'),
        extractFunctionSource('setBastardLoopMLevelPercent'),
        extractFunctionSource('setBastardLoopMReadyLevelForTransport'),
        extractFunctionSource('ensureBastardLoopMReadyForTransport'),
        'globalThis.getBastardLoopMLevelValue = getBastardLoopMLevelValue;',
        'globalThis.ensureBastardLoopMReadyForTransport = ensureBastardLoopMReadyForTransport;'
    ].join('\n\n'), readyContext);

    assert.equal(readyContext.ensureBastardLoopMReadyForTransport(), true);
    assert.equal(readyContext.bastardLoopMEnabled, true);
    assert.equal(readyContext.bastardLoopMLevel, 0.5);
    assert.equal(readyContext.levelAfterSync, 0.5);
    assert.equal(elements.performanceBastardLoopMLevel.value, '50');
    assert.equal(elements.performanceBastardLoopMLevelMixer.value, '50');
    assert.equal(elements.performanceBastardLoopMLevelValue.textContent, '50%');
    assert.equal(elements.performanceBastardLoopMLevelMixerValue.textContent, '50%');
    assert.equal(readyContext.saved, true);
    assert.ok(readyContext.synced >= 1);
    assert.ok(readyContext.mixUpdates >= 1);
});

test('Global Bastardloop start clears loop solo and refreshes shared transport when already running', async () => {
    const startContext = {
        loopLayerSolo: 'bastardb',
        bastardLoopPlaying: true,
        bastardLoopLSampleBuffer: { id: 'loop-l' },
        bastardLoopXSampleBuffer: { id: 'loop-x' },
        ensureAudioReadyForKeyInteraction() {
            return Promise.resolve(true);
        },
        syncPerformanceControlState() {
            startContext.synced = (startContext.synced || 0) + 1;
        },
        setStatus() {},
        hasPlayableBastardLoopLSequence() {
            return true;
        },
        isBastardLoopLUsingSynth() {
            return false;
        },
        hasPlayableBastardLoopLTransportSource() {
            return Boolean(startContext.bastardLoopLSampleBuffer) && startContext.hasPlayableBastardLoopLSequence();
        },
        hasPlayableBastardLoopXSequence() {
            return true;
        },
        ensureBastardLoopLReadyForTransport() {
            startContext.preparedL = true;
            return true;
        },
        ensureBastardLoopXReadyForTransport() {
            startContext.preparedX = true;
            return true;
        },
        setLoopLayerSolo(layer, options) {
            startContext.loopLayerSolo = layer;
            startContext.soloCall = { layer, options: plain(options) };
        },
        startAllBastardLoopLayers(startTime, options) {
            startContext.restartCall = { startTime, options: plain(options) };
            return true;
        },
        saveState() {
            startContext.saved = true;
        },
        setBastardLoopPlaying() {
            throw new Error('Expected running transport to refresh in place.');
        }
    };
    vm.runInNewContext(`${extractFunctionSource('startAllBastardLoopsFromUi')}\nglobalThis.startAllBastardLoopsFromUi = startAllBastardLoopsFromUi;`, startContext);

    const started = await startContext.startAllBastardLoopsFromUi();

    assert.equal(started, true);
    assert.deepEqual(startContext.soloCall, {
        layer: 'none',
        options: {
            silent: true,
            skipSave: true
        }
    });
    assert.equal(startContext.preparedL, true);
    assert.equal(startContext.preparedX, true);
    assert.deepEqual(startContext.restartCall, {
        startTime: null,
        options: {
            skipUi: true
        }
    });
    assert.equal(startContext.saved, true);
    assert.ok(startContext.synced >= 1);
});

test('Global Bastardloop start reloads a remembered Loop L sample before transport start', async () => {
    const startContext = {
        loopLayerSolo: 'none',
        bastardLoopPlaying: false,
        bastardLoopLSampleBuffer: null,
        bastardLoopXSampleBuffer: null,
        ensureAudioReadyForKeyInteraction() {
            return Promise.resolve(true);
        },
        syncPerformanceControlState() {
            startContext.synced = (startContext.synced || 0) + 1;
        },
        setStatus() {},
        hasPlayableBastardLoopLSequence() {
            return true;
        },
        isBastardLoopLUsingSynth() {
            return false;
        },
        hasPlayableBastardLoopLTransportSource() {
            return Boolean(startContext.bastardLoopLSampleBuffer) && startContext.hasPlayableBastardLoopLSequence();
        },
        hasPlayableBastardLoopXSequence() {
            return false;
        },
        hasRestorableBastardLoopLSampleReference() {
            return true;
        },
        async ensureBastardLoopLSampleBufferReady() {
            startContext.reloadedL = true;
            startContext.bastardLoopLSampleBuffer = { id: 'reloaded-l' };
            return true;
        },
        ensureBastardLoopLReadyForTransport() {
            startContext.preparedL = true;
            return true;
        },
        ensureBastardLoopXReadyForTransport() {
            throw new Error('Loop X should not be prepared in this scenario.');
        },
        setLoopLayerSolo() {
            throw new Error('Solo state should already be clear.');
        },
        setBastardLoopPlaying(nextValue, options) {
            startContext.restartCall = {
                nextValue,
                options: plain(options),
                bufferReadyAtStart: Boolean(startContext.bastardLoopLSampleBuffer)
            };
            startContext.syncPerformanceControlState();
            if (!options?.skipSave) {
                startContext.saved = true;
            }
            return true;
        },
        saveState() {
            startContext.saved = true;
        }
    };
    vm.runInNewContext(`${extractFunctionSource('startAllBastardLoopsFromUi')}\nglobalThis.startAllBastardLoopsFromUi = startAllBastardLoopsFromUi;`, startContext);

    const started = await startContext.startAllBastardLoopsFromUi();

    assert.equal(started, true);
    assert.equal(startContext.reloadedL, true);
    assert.equal(startContext.preparedL, true);
    assert.deepEqual(startContext.restartCall, {
        nextValue: true,
        options: {},
        bufferReadyAtStart: true
    });
    assert.equal(startContext.saved, true);
    assert.ok(startContext.synced >= 1);
});

test('Bastardloop M transport button arms the shared Bastardloop transport when a mic loop is ready', async () => {
    const startContext = {
        bastardLoopPlaying: false,
        bastardLoopMBuffer: { id: 'm-loop' },
        bastardLoopMSource: null,
        ensureAudioReadyForKeyInteraction() {
            return Promise.resolve(true);
        },
        setLoopLayerSolo(layer, options) {
            startContext.soloCall = { layer, options: plain(options) };
        },
        ensureBastardLoopMReadyForTransport() {
            startContext.prepared = true;
            return true;
        },
        startAllBastardLoopsFromUi(options) {
            startContext.startCall = plain(options);
            return Promise.resolve(true);
        },
        setStatus(message) {
            startContext.status = message;
        },
        syncBastardLoopMUi() {
            startContext.synced = (startContext.synced || 0) + 1;
        }
    };
    vm.runInNewContext([
        extractFunctionSource('isBastardLoopMRunning'),
        extractFunctionSource('toggleBastardLoopMTransportFromUi'),
        'globalThis.toggleBastardLoopMTransportFromUi = toggleBastardLoopMTransportFromUi;'
    ].join('\n\n'), startContext);

    const started = await startContext.toggleBastardLoopMTransportFromUi();

    assert.equal(started, undefined);
    assert.deepEqual(startContext.soloCall, {
        layer: 'none',
        options: {
            silent: true,
            skipSave: true
        }
    });
    assert.equal(startContext.prepared, true);
    assert.deepEqual(startContext.startCall, { silent: true });
    assert.equal(startContext.status, 'Bastardloops started with Bastardloop M.');
    assert.ok(startContext.synced >= 1);
});

test('Bastardloop M transport button stops the shared Bastardloop transport when M is already running', async () => {
    const stopContext = {
        bastardLoopPlaying: true,
        bastardLoopMSource: { id: 'running-m' },
        setBastardLoopPlaying(enabled, options) {
            stopContext.stopCall = {
                enabled,
                options: plain(options)
            };
        },
        setStatus(message) {
            stopContext.status = message;
        },
        syncBastardLoopMUi() {
            stopContext.synced = (stopContext.synced || 0) + 1;
        }
    };
    vm.runInNewContext([
        extractFunctionSource('isBastardLoopMRunning'),
        extractFunctionSource('toggleBastardLoopMTransportFromUi'),
        'globalThis.toggleBastardLoopMTransportFromUi = toggleBastardLoopMTransportFromUi;'
    ].join('\n\n'), stopContext);

    const stopped = await stopContext.toggleBastardLoopMTransportFromUi();

    assert.equal(stopped, undefined);
    assert.deepEqual(stopContext.stopCall, {
        enabled: false,
        options: {
            silent: true
        }
    });
    assert.equal(stopContext.status, 'Bastardloops stopped.');
    assert.ok(stopContext.synced >= 1);
});

test('Bastardloop M Record + Loop control is wired into the live card UI', () => {
    assert.match(indexHtml, /id="performanceBastardLoopMRecordLoopBtn"[^>]*>Record \+ Loop</);
    assert.match(indexHtml, /id="performanceBastardLoopMRecordLength"[^>]*min="1"[^>]*max="8"[^>]*value="1"/);
    assert.match(indexHtml, /id="performanceBastardLoopMInputGain"[^>]*min="0"[^>]*max="200"[^>]*value="100"/);
    assert.match(indexHtml, /id="performanceBastardLoopMNormalizeBtn"[^>]*>Normalize</);
    assert.match(
        indexHtml,
        /performanceBastardLoopMRecordLoopBtn\?\.(?:addEventListener)\('click', async \(\) => \{\s*try \{\s*await handleBastardLoopMRecordButtonPress\(\{ startFullLoop: true \}\);/s
    );
    assert.match(
        indexHtml,
        /performanceBastardLoopMRecordLength\?\.(?:addEventListener)\('input', \(event\) => \{\s*bastardLoopMRecordingLoopCount = clampBastardLoopMRecordingLoopCount\(event\.target\.value, bastardLoopMRecordingLoopCount\);/s
    );
    assert.match(
        indexHtml,
        /performanceBastardLoopMInputGain\?\.(?:addEventListener)\('input', \(event\) => \{\s*setBastardLoopMInputGainPercent\(event\.target\.value\);/s
    );
    assert.match(
        indexHtml,
        /performanceBastardLoopMNormalizeBtn\?\.(?:addEventListener)\('click', async \(\) => \{\s*try \{\s*await normalizeBastardLoopMBuffer\(\);/s
    );
});

test('Bastardloop M record plus loop arms the take with a continuous metronome and immediate clock-scheduled transport restart', async () => {
    class FakeMediaRecorder {
        constructor(stream) {
            this.stream = stream;
            this.state = 'inactive';
            this.mimeType = 'audio/webm';
        }
        start() {
            this.state = 'recording';
        }
        stop() {
            this.state = 'inactive';
        }
    }

    const timers = [];
    const statuses = [];
    const beginContext = {
        window: {
            isSecureContext: true,
            setTimeout(fn, delay) {
                const timer = { fn, delay };
                timers.push(timer);
                return timer;
            }
        },
        clearTimeout() {},
        navigator: {
            mediaDevices: {
                getUserMedia() {
                    beginContext.requestedMic = true;
                    return Promise.resolve({
                        getTracks() {
                            return [{ stop() {} }];
                        }
                    });
                }
            }
        },
        MediaRecorder: FakeMediaRecorder,
        audioContext: {
            currentTime: 10,
            state: 'running',
            resume() {
                return Promise.resolve();
            }
        },
        document: {
            getElementById(id) {
                if (id === 'globalBpmSlider') {
                    return { value: '120' };
                }
                return null;
            }
        },
        bastardLoopMRecordingToken: 0,
        bastardLoopMRecordingCancelled: false,
        bastardLoopMRecordedChunks: [],
        bastardLoopMRecordingState: 'idle',
        bastardLoopMPlusRecordingState: 'idle',
        bastardLoopMCountInBeatsRemaining: 0,
        bastardLoopMRecordStatus: '',
        bastardLoopMRecordingStartsFullLoop: false,
        bastardLoopMMicStream: null,
        bastardLoopMMediaRecorder: null,
        bastardLoopMRecordStartTimerId: null,
        bastardLoopMRecordStopTimerId: null,
        bastardLoopMRecordLoopTransportTimerId: null,
        bastardLoopMCountInTimerIds: [],
        ensureAudioReadyForKeyInteraction() {
            return Promise.resolve(true);
        },
        clampBpmValue(value) {
            return Number(value) || 120;
        },
        getBastardLoopMRecordingLoopCount() {
            return 1;
        },
        formatBastardLoopMRecordingLoopCount() {
            return '1 loop';
        },
        getBastardLoopMLoopDurationSeconds() {
            return 8;
        },
        getBastardLoopMRecordingDurationSeconds() {
            return 8;
        },
        chooseRecordingMimeType() {
            return '';
        },
        stopBastardLoopM() {
            beginContext.stoppedExistingM = true;
        },
        stopAllPerformancePlayback(options) {
            beginContext.stopAllCall = plain(options);
        },
        ensureBastardLoopMReadyForTransport() {
            beginContext.preparedM = true;
            return true;
        },
        startBastardLoopMMetronome(startTime, beatIntervalSeconds) {
            beginContext.metronomeStart = { startTime, beatIntervalSeconds };
        },
        syncBastardLoopMUi() {
            beginContext.syncs = (beginContext.syncs || 0) + 1;
        },
        restartAllTransport(options) {
            beginContext.restartCall = plain(options);
            return true;
        },
        setStatus(message) {
            statuses.push(message);
        },
        console,
        TRANSPORT_START_BUFFER_SECONDS: 0.08
    };

    vm.runInNewContext([
        extractFunctionSource('beginBastardLoopMRecording'),
        'globalThis.beginBastardLoopMRecording = beginBastardLoopMRecording;'
    ].join('\n\n'), beginContext);

    const started = await beginContext.beginBastardLoopMRecording({ startFullLoop: true });

    assert.equal(started, true);
    assert.equal(beginContext.requestedMic, true);
    assert.equal(beginContext.preparedM, true);
    assert.deepEqual(beginContext.stopAllCall, { silent: true });
    assert.deepEqual(beginContext.metronomeStart, {
        startTime: 10.08,
        beatIntervalSeconds: 0.5
    });
    assert.equal(beginContext.bastardLoopMRecordingState, 'countin');
    assert.equal(beginContext.bastardLoopMRecordingStartsFullLoop, true);
    assert.equal(beginContext.bastardLoopMRecordStatus, 'Count-in: 4 · loop starts on 1');
    assert.match(statuses[0], /full loop starts with the take/i);
    assert.equal(beginContext.restartCall?.silent, true);
    assert.ok(Math.abs(beginContext.restartCall?.startTime - 12.08) < 1e-9);
    assert.ok(!timers.some((timer) => timer.delay === 2000), 'transport should no longer depend on a late JS timer');
});

test('Bastardloop M multi-loop recording extends the capture window beyond one shared cycle', async () => {
    class FakeMediaRecorder {
        constructor(stream) {
            this.stream = stream;
            this.state = 'inactive';
            this.mimeType = 'audio/webm';
        }
        start() {
            this.state = 'recording';
        }
        stop() {
            this.state = 'inactive';
        }
    }

    const timers = [];
    const statuses = [];
    const beginContext = {
        window: {
            isSecureContext: true,
            setTimeout(fn, delay) {
                const timer = { fn, delay };
                timers.push(timer);
                return timer;
            }
        },
        clearTimeout() {},
        navigator: {
            mediaDevices: {
                getUserMedia() {
                    return Promise.resolve({
                        getTracks() {
                            return [{ stop() {} }];
                        }
                    });
                }
            }
        },
        MediaRecorder: FakeMediaRecorder,
        audioContext: {
            currentTime: 10,
            state: 'running',
            resume() {
                return Promise.resolve();
            }
        },
        document: {
            getElementById(id) {
                if (id === 'globalBpmSlider') {
                    return { value: '120' };
                }
                return null;
            }
        },
        bastardLoopMRecordingToken: 0,
        bastardLoopMRecordingCancelled: false,
        bastardLoopMRecordedChunks: [],
        bastardLoopMRecordingState: 'idle',
        bastardLoopMPlusRecordingState: 'idle',
        bastardLoopMCountInBeatsRemaining: 0,
        bastardLoopMRecordStatus: '',
        bastardLoopMRecordingStartsFullLoop: false,
        bastardLoopMMicStream: null,
        bastardLoopMMediaRecorder: null,
        bastardLoopMRecordStartTimerId: null,
        bastardLoopMRecordStopTimerId: null,
        bastardLoopMRecordLoopTransportTimerId: null,
        bastardLoopMCountInTimerIds: [],
        ensureAudioReadyForKeyInteraction() {
            return Promise.resolve(true);
        },
        clampBpmValue(value) {
            return Number(value) || 120;
        },
        getBastardLoopMRecordingLoopCount() {
            return 2;
        },
        formatBastardLoopMRecordingLoopCount() {
            return '2 loops';
        },
        getBastardLoopMLoopDurationSeconds() {
            return 8;
        },
        getBastardLoopMRecordingDurationSeconds() {
            return 16;
        },
        chooseRecordingMimeType() {
            return '';
        },
        stopBastardLoopM() {},
        startBastardLoopMMetronome() {},
        syncBastardLoopMUi() {},
        setStatus(message) {
            statuses.push(message);
        },
        console
    };

    vm.runInNewContext([
        extractFunctionSource('beginBastardLoopMRecording'),
        'globalThis.beginBastardLoopMRecording = beginBastardLoopMRecording;'
    ].join('\n\n'), beginContext);

    const started = await beginContext.beginBastardLoopMRecording();

    assert.equal(started, true);
    assert.equal(beginContext.bastardLoopMRecordingState, 'countin');
    assert.equal(beginContext.bastardLoopMRecordStatus, 'Count-in: 4 · 2 loops');
    assert.match(statuses[0], /for 2 loops of recording/i);
    assert.ok(timers.some((timer) => timer.delay === 18080), 'expected a longer stop timer for the multi-loop take');
});

test('Bastardloop M trims the finished take from the real recorder arm time', async () => {
    class FakeBlob {
        constructor(parts, options) {
            this.parts = parts;
            this.type = options?.type || 'audio/webm';
        }
        async arrayBuffer() {
            return new ArrayBuffer(16);
        }
    }

    class FakeMediaRecorder {
        constructor(stream) {
            this.stream = stream;
            this.state = 'inactive';
            this.mimeType = 'audio/webm';
        }
        start() {
            this.state = 'recording';
        }
        stop() {
            this.state = 'inactive';
        }
    }

    const timers = [];
    const beginContext = {
        Blob: FakeBlob,
        window: {
            isSecureContext: true,
            setTimeout(fn, delay) {
                const timer = { fn, delay };
                timers.push(timer);
                return timer;
            }
        },
        clearTimeout() {},
        navigator: {
            mediaDevices: {
                getUserMedia() {
                    return Promise.resolve({
                        getTracks() {
                            return [{ stop() {} }];
                        }
                    });
                }
            }
        },
        MediaRecorder: FakeMediaRecorder,
        audioContext: {
            currentTime: 10,
            state: 'running',
            resume() {
                return Promise.resolve();
            },
            decodeAudioData() {
                return Promise.resolve({ id: 'decoded-buffer' });
            }
        },
        document: {
            getElementById(id) {
                if (id === 'globalBpmSlider') {
                    return { value: '120' };
                }
                return null;
            }
        },
        bastardLoopMRecordingToken: 0,
        bastardLoopMRecordingCancelled: false,
        bastardLoopMRecordedChunks: [Buffer.from([1, 2, 3])],
        bastardLoopMRecordingState: 'idle',
        bastardLoopMPlusRecordingState: 'idle',
        bastardLoopMCountInBeatsRemaining: 0,
        bastardLoopMRecordStatus: '',
        bastardLoopMRecordingStartsFullLoop: false,
        bastardLoopMMicStream: null,
        bastardLoopMMediaRecorder: null,
        bastardLoopMRecordStartTimerId: null,
        bastardLoopMRecordStopTimerId: null,
        bastardLoopMRecordLoopTransportTimerId: null,
        bastardLoopMCountInTimerIds: [],
        bastardLoopMRecorderStartTime: 0,
        ensureAudioReadyForKeyInteraction() {
            return Promise.resolve(true);
        },
        clampBpmValue(value) {
            return Number(value) || 120;
        },
        getBastardLoopMRecordingLoopCount() {
            return 1;
        },
        formatBastardLoopMRecordingLoopCount() {
            return '1 loop';
        },
        getBastardLoopMLoopDurationSeconds() {
            return 8;
        },
        getBastardLoopMRecordingDurationSeconds() {
            return 8;
        },
        chooseRecordingMimeType() {
            return '';
        },
        stopBastardLoopM() {},
        startBastardLoopMMetronome() {},
        syncBastardLoopMUi() {},
        setStatus() {},
        collapseAudioBufferToCenteredMono(decoded) {
            return decoded;
        },
        getBastardLoopMInputGainPercent() {
            return 100;
        },
        applyLinearGainToAudioBuffer(buffer, gain, options) {
            beginContext.appliedGain = { gain, options: plain(options) };
            return buffer;
        },
        createFixedLengthAudioBufferFromSource(buffer, startSeconds, durationSeconds) {
            beginContext.trimmedTake = { buffer, startSeconds, durationSeconds };
            return { duration: durationSeconds, numberOfChannels: 1, sampleRate: 44100 };
        },
        applyRecordedBastardLoopMBuffer(buffer, options) {
            beginContext.appliedTake = { buffer, options: plain(options) };
            return Promise.resolve(true);
        },
        stopBastardLoopMMicCapture() {
            beginContext.stoppedMic = true;
        },
        finalizeBastardLoopMRecordingSession() {
            beginContext.finalized = true;
        },
        syncPerformanceControlState() {},
        saveState() {},
        console
    };

    vm.runInNewContext([
        extractFunctionSource('beginBastardLoopMRecording'),
        'globalThis.beginBastardLoopMRecording = beginBastardLoopMRecording;'
    ].join('\n\n'), beginContext);

    const started = await beginContext.beginBastardLoopMRecording();
    assert.equal(started, true);
    await beginContext.bastardLoopMMediaRecorder.onstop();

    assert.equal(beginContext.stoppedMic, true);
    assert.ok(Math.abs(beginContext.trimmedTake.startSeconds - 2.08) < 1e-9);
    assert.equal(beginContext.trimmedTake.durationSeconds, 8);
    assert.deepEqual(beginContext.appliedGain, {
        gain: 1,
        options: {
            clamp: true
        }
    });
});

test('Cancelling Bastardloop M count-in stops the armed full-loop restart', () => {
    const cancelContext = {
        bastardLoopMRecordingState: 'countin',
        bastardLoopMRecordingStartsFullLoop: true,
        bastardLoopMRecordingToken: 2,
        bastardLoopMRecordingCancelled: false,
        bastardLoopMRecordStatus: 'Count-in: 4 · loop starts on 1',
        bastardLoopMCountInBeatsRemaining: 4,
        bastardLoopMMediaRecorder: {
            state: 'inactive'
        },
        clearBastardLoopMRecordTimers() {
            cancelContext.clearedTimers = true;
        },
        finalizeBastardLoopMRecordingSession() {
            cancelContext.finalized = true;
        },
        stopAllPerformancePlayback(options) {
            cancelContext.stopAllCall = plain(options);
        },
        syncBastardLoopMUi() {
            cancelContext.synced = true;
        },
        setStatus(message) {
            cancelContext.status = message;
        },
        console
    };

    vm.runInNewContext([
        extractFunctionSource('cancelBastardLoopMRecording'),
        'globalThis.cancelBastardLoopMRecording = cancelBastardLoopMRecording;'
    ].join('\n\n'), cancelContext);

    assert.equal(cancelContext.cancelBastardLoopMRecording(), true);
    assert.deepEqual(cancelContext.stopAllCall, { silent: true });
    assert.equal(cancelContext.finalized, true);
    assert.equal(cancelContext.status, 'Bastardloop M recording cancelled.');
});

test('Bastardloop M is rebuilt and resynced after audio engine recovery', () => {
    const rebuildSource = extractFunctionSource('rebuildContextBoundAudioState');
    assert.match(rebuildSource, /if \(bastardLoopMRawBuffer\) \{\s*rerenderBastardLoopMFromRaw\(\{ skipUi: true \}\);\s*\}/);
    assert.match(rebuildSource, /syncBastardLoopMUi\(\);/);
});

test('Restart All treats Loop L and Loop X sample buffers as Bastardloop layers', () => {
    for (const bufferKey of ['bastardLoopLSampleBuffer', 'bastardLoopXSampleBuffer']) {
        const restartContext = {
            audioContext: { currentTime: 10 },
            sequencerPlaying: false,
            arpEnabled: false,
            holdEnabled: false,
            bastardLoopPlaying: false,
            drumMachinePlaying: false,
            bastardLoopBuffer: null,
            bastardLoop2Buffer: null,
            bastardLoop3Buffer: null,
            bastardLoopVBuffer: null,
            bastardLoopPBuffer: null,
            bastardLoopOBuffer: null,
            bastardLoopLSampleBuffer: null,
            bastardLoopXSampleBuffer: null,
            bastardLoopMBuffer: null,
            dropboxSampleLayerBuffer: null,
            drumMachineKickPattern: [],
            drumMachineSnarePattern: [],
            drumMachineHatPattern: [],
            drumMachinePercPattern: [],
            drumMachineExtraTracks: {},
            finalFxPlacementLfoEnabled: false,
            isAudioGraphReady() {
                return true;
            },
            startSequencer(startTime) {
                restartContext.startedSequencerAt = startTime;
                restartContext.sequencerPlaying = true;
            },
            stopSequencer() {},
            stopArpeggiatorPlayback() {},
            stopAllBastardLoopLayers() {},
            stopDrumMachine() {},
            restartInternalEffectOscillators(startTime) {
                restartContext.restartedEffectsAt = startTime;
                return true;
            },
            updateFinalFxPlacementLfo() {},
            updateEffects() {},
            syncPerformanceControlState() {
                restartContext.synced = (restartContext.synced || 0) + 1;
            },
            startAllBastardLoopLayers(startTime, options) {
                restartContext.startedBastardLoop = { startTime, options: plain(options) };
                return true;
            },
            startDrumMachine() {
                throw new Error('Drum machine should not start for Loop L/X-only restart.');
            },
            startArpeggiatorPlayback() {},
            isArpeggiatorPlaying() {
                return false;
            },
            hasPlayableBastardLoopLTransportSource() {
                return Boolean(restartContext.bastardLoopLSampleBuffer);
            },
            setStatus() {}
        };
        restartContext[bufferKey] = { id: bufferKey };
        installRestartTransportFixture(restartContext);

        assert.equal(restartContext.restartAllTransport(), true);
        const expectedStart = restartContext.audioContext.currentTime + transportStartBufferSeconds;
        assert.equal(restartContext.restartedEffectsAt, expectedStart);
        assert.equal(restartContext.startedSequencerAt, expectedStart);
        assert.equal(restartContext.transportSync.origin, expectedStart);
        assert.equal(restartContext.transportSync.depth, 0);
        assert.deepEqual(restartContext.startedBastardLoop, {
            startTime: expectedStart,
            options: {
                skipUi: true,
                silent: true
            }
        }, `${bufferKey} should enter the shared Bastardloop restart path`);
        assert.ok(restartContext.synced >= 1);
    }
});

test('Restart All honors an explicit scheduled start time', () => {
    const restartContext = {
        audioContext: { currentTime: 10 },
        sequencerPlaying: false,
        arpEnabled: false,
        holdEnabled: false,
        bastardLoopPlaying: false,
        drumMachinePlaying: false,
        bastardLoopBuffer: null,
        bastardLoop2Buffer: null,
        bastardLoop3Buffer: null,
        bastardLoopVBuffer: null,
        bastardLoopPBuffer: null,
        bastardLoopOBuffer: null,
        bastardLoopLSampleBuffer: null,
        bastardLoopXSampleBuffer: null,
        bastardLoopMBuffer: { id: 'm-loop' },
        dropboxSampleLayerBuffer: null,
        drumMachineKickPattern: [],
        drumMachineSnarePattern: [],
        drumMachineHatPattern: [],
        drumMachinePercPattern: [],
        drumMachineExtraTracks: {},
        finalFxPlacementLfoEnabled: false,
        isAudioGraphReady() {
            return true;
        },
        stopSequencer() {},
        stopArpeggiatorPlayback() {},
        stopAllBastardLoopLayers() {},
        stopDrumMachine() {},
        restartInternalEffectOscillators(startTime) {
            restartContext.restartedEffectsAt = startTime;
            return true;
        },
        updateFinalFxPlacementLfo() {},
        updateEffects() {},
        syncPerformanceControlState() {
            restartContext.synced = (restartContext.synced || 0) + 1;
        },
        startSequencer(startTime) {
            restartContext.startedSequencerAt = startTime;
            restartContext.sequencerPlaying = true;
        },
        startAllBastardLoopLayers(startTime, options) {
            restartContext.startedBastardLoop = { startTime, options: plain(options) };
            return true;
        },
        startDrumMachine() {
            throw new Error('Drum machine should not start in this scheduled-start check.');
        },
        startArpeggiatorPlayback() {},
        isArpeggiatorPlaying() {
            return false;
        },
        hasPlayableBastardLoopLTransportSource() {
            return Boolean(restartContext.bastardLoopLSampleBuffer);
        },
        setStatus() {}
    };
    installRestartTransportFixture(restartContext);

    assert.equal(restartContext.restartAllTransport({ startTime: 24.5 }), true);
    assert.equal(restartContext.restartedEffectsAt, 24.5);
    assert.equal(restartContext.startedSequencerAt, 24.5);
    assert.equal(restartContext.transportSync.origin, 24.5);
    assert.equal(restartContext.transportSync.depth, 0);
    assert.deepEqual(restartContext.startedBastardLoop, {
        startTime: 24.5,
        options: {
            skipUi: true,
            silent: true
        }
    });
    assert.ok(restartContext.synced >= 1);
});
