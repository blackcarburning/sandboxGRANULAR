const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const theory = require('../q-theory.js');
const { createSeededRandom } = require('../mygrain-utils.js');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function functionSource(name) {
    const start = html.indexOf(`        function ${name}(`);
    assert.notEqual(start, -1, name);
    return html.slice(start, html.indexOf('\n        }', start) + '\n        }'.length);
}

function fixture(length = 64) {
    const calls = { saves: 0, restarts: 0, profiles: 0, resets: 0 };
    const buttons = new Map();
    const random = createSeededRandom(1337);
    const context = {
        window: {}, document: { getElementById: id => buttons.get(id) },
        Math: Object.assign(Object.create(Math), { random }),
        noteSemitoneOffsets: Object.fromEntries(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((name, index) => [name, index])),
        LOOP_SCALE_FAMILIES: [{ intervals: [0, 2, 4, 5, 7, 9, 11] }],
        bastardLoopXSequence: Array.from({ length: 64 }, () => ({ note: '', rest: false, accent: false, slide: false, ratchet: 1 })),
        bastardLoopXEditStepIndex: 0, bastardLoopXRatchetEditStepIndex: -1,
        getBastardLoopXPatternLength: () => length,
        getBastardLoopXRootNote: () => 'C3',
        saveState: () => { calls.saves += 1; },
        restartBastardLoopXPlaybackIfNeeded: () => { calls.restarts += 1; },
        resetBastardLoopXCopyState() {}, resetBastardLoopXTransposeSectionState() {},
        resetBastardLoopXStepTapMemory: () => { calls.resets += 1; },
        syncBastardLoopXEditorUi() {}, syncBastardLoopXUi() {},
        updateBastardLoopXStatus: message => { calls.status = message; }, setStatus() {},
        chooseRandom: choices => choices[Math.floor(random() * choices.length)], maybe: probability => random() < probability,
        createMusicalGenerationProfile: () => { calls.profiles += 1; return { scaleIntervals: [0, 2, 4, 5, 7, 9, 11], energy: .6 }; }
    };
    vm.createContext(context);
    for (const name of ['parseNoteName', 'noteNameToMidi', 'midiToNoteName', 'createEmptyBastardLoopXStep', 'normalizeBastardLoopXStep',
        'ensureBastardLoopXSequenceCapacity', 'syncBastardLoopXQRootButton', 'buildBastardLoopXQRootSequence', 'copyQRootsToBastardLoopX',
        'getBastardLoopXExistingNote', 'randomizeBastardLoopXAroundNote', 'randomizeBastardLoopXPattern', 'quantizePitchOffsetToScale',
        'getMegaRandomBastardLoopMotifLength', 'buildMegaRandomBastardLoopNoteChoices', 'buildMegaRandomBastardLoopXSequence']) {
        vm.runInContext(functionSource(name), context);
    }
    return { context, calls, buttons };
}

test('Q root copy uses actual chord roots, not the lowest inverted or octave-bass pitch, and includes Q transpose', () => {
    const { context } = fixture();
    const state = theory.defaults();
    state.transpose = 2;
    state.sequence[0] = theory.normalizeStep({ root: 60, notes: [64, 67, 72], accent: true, tie: true, ratchet: 3 });
    state.sequence[5] = theory.normalizeStep({ root: 55, notes: [43, 55, 59, 62] });
    state.sequence[12] = theory.normalizeStep({ root: 57, notes: [57, 60, 64], rest: true });
    state.sequence[14] = { kind: 'accent', notes: [], accent: true };
    const roots = context.buildBastardLoopXQRootSequence(state, 16);
    assert.equal(roots.length, 16);
    assert.equal(roots[0].note, 'D4');
    assert.equal(roots[0].accent, true);
    assert.equal(roots[0].slide, true);
    assert.equal(roots[0].ratchet, 3);
    assert.equal(roots[5].note, 'A3');
    assert.equal(roots[12].rest, true);
    assert.equal(roots[12].note, '');
    assert.equal(roots[14].note, '');
    assert.equal(roots[14].accent, true);
    assert.equal(roots[15].note, '');
});

test('copy transfers all 64 steps from Q step one regardless of both cursors or ARP mode', () => {
    for (const arpEnabled of [false, true]) {
        const { context, calls } = fixture();
        const state = theory.defaults();
        state.arpEnabled = arpEnabled;
        state.sequence = Array.from({ length: 64 }, (_, index) => theory.normalizeStep({ root: 48 + index % 12, notes: [60, 64, 67] }));
        const original = JSON.stringify(state);
        context.window.mygrainQ = { state, cursor: 37, hasSequence: () => true };
        context.bastardLoopXEditStepIndex = 63;
        assert.equal(context.copyQRootsToBastardLoopX(), true);
        assert.equal(context.bastardLoopXSequence.length, 64);
        for (let index = 0; index < 64; index += 1) assert.equal(context.bastardLoopXSequence[index].note, context.midiToNoteName(48 + index % 12));
        assert.equal(JSON.stringify(state), original);
        assert.equal(context.bastardLoopXEditStepIndex, 0);
        assert.equal(calls.saves, 1);
        assert.equal(calls.restarts, 1);
        assert.match(calls.status, /64 Q chord roots across all 64 steps/);
    }
});

test('shorter root copies keep hidden X steps and unavailable Q leaves X unchanged', () => {
    const { context, calls, buttons } = fixture(16);
    buttons.set('performanceBastardLoopXCopyQRootsBtn', {});
    context.bastardLoopXSequence[40].note = 'G2';
    const original = JSON.stringify(context.bastardLoopXSequence);
    assert.equal(context.copyQRootsToBastardLoopX(), false);
    assert.equal(JSON.stringify(context.bastardLoopXSequence), original);
    assert.equal(calls.saves, 0);
    assert.equal(buttons.get('performanceBastardLoopXCopyQRootsBtn').disabled, true);
    const state = theory.defaults();
    state.sequence[15] = theory.normalizeStep({ root: 48, notes: [48, 52, 55] });
    context.window.mygrainQ = { state, hasSequence: () => true };
    context.syncBastardLoopXQRootButton();
    assert.equal(buttons.get('performanceBastardLoopXCopyQRootsBtn').disabled, false);
    assert.equal(context.copyQRootsToBastardLoopX(), true);
    assert.equal(context.bastardLoopXSequence[15].note, 'C3');
    assert.equal(context.bastardLoopXSequence[40].note, 'G2');
});

test('anchored randomise chooses the selected note or first playable active note and never invents an empty-sequence key', () => {
    const { context, calls } = fixture(16);
    context.bastardLoopXSequence[48].note = 'C4';
    assert.equal(context.randomizeBastardLoopXAroundNote(), false);
    assert.equal(calls.saves, 0);
    context.bastardLoopXSequence[3].note = 'D#2';
    context.bastardLoopXSequence[7] = { note: 'F#2', rest: true };
    context.bastardLoopXSequence[9].note = 'A2';
    context.bastardLoopXEditStepIndex = 7;
    assert.equal(context.getBastardLoopXExistingNote(), 'D#2');
    context.bastardLoopXEditStepIndex = 9;
    assert.equal(context.getBastardLoopXExistingNote(), 'A2');
    assert.equal(context.randomizeBastardLoopXAroundNote(), true);
    assert.equal(context.bastardLoopXSequence[0].note, 'A2');
    assert.equal(calls.profiles, 0);
    assert.equal(calls.saves, 1);
    assert.equal(calls.restarts, 1);
    assert.match(calls.status, /around A2/);
});

test('anchored bass patterns stay within one octave and root/fifth pitch classes for every register and pattern length', () => {
    for (const anchor of ['C0', 'D#1', 'F#2', 'A3', 'C5', 'G8', 'B8']) {
        for (const length of [1, 8, 16, 32, 64]) {
            const { context } = fixture(length);
            context.bastardLoopXSequence[0].note = anchor;
            const root = context.noteNameToMidi(anchor);
            assert.equal(context.randomizeBastardLoopXAroundNote(), true);
            assert.equal(context.bastardLoopXSequence[0].note, anchor);
            for (const step of context.bastardLoopXSequence.slice(0, length).filter(step => step.note && !step.rest)) {
                const midi = context.noteNameToMidi(step.note);
                assert.ok(Math.abs(midi - root) <= 12);
                assert.ok([0, 7].includes(((midi - root) % 12 + 12) % 12));
            }
            assert.ok(context.bastardLoopXSequence.slice(length).every(step => !step.note));
        }
    }
});

test('the existing Random Pattern still uses its normal profile and both new buttons exist only on X main card', () => {
    const { context, calls } = fixture();
    context.randomizeBastardLoopXPattern();
    assert.equal(calls.profiles, 1);
    for (const id of ['performanceBastardLoopXCopyQRootsBtn', 'performanceBastardLoopXRandomAroundNoteBtn']) {
        assert.equal(html.split(`id="${id}"`).length - 1, 1);
        assert.ok(html.indexOf(`id="${id}"`) > html.indexOf('aria-label="Bastardloop X controls"'));
        assert.ok(html.indexOf(`id="${id}"`) < html.indexOf('id="performanceBastardLoopXLevel"'));
        assert.match(html, new RegExp(`bindBastardLoopLMobileTap\\(${id},`));
    }
    assert.doesNotMatch(html, /id="performanceBastardLoopL(?:CopyQRoots|RandomAroundNote)Btn"/);
});
