const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const theory = require('../q-theory.js');
const { Controller } = require('../q-card.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const chord = { notes: [49, 53, 56], velocity: 96 };

function state(values = {}) {
    return { ...theory.defaults(), arpEnabled: true, ...values };
}

function controller(length = 16) {
    const instance = new Controller({ length: () => length, bpm: () => 120, save: () => {}, context: () => null });
    instance.status = message => { instance.message = message; };
    return instance;
}

function functionSource(name) {
    const start = html.indexOf(`        function ${name}(`);
    assert.notEqual(start, -1, name);
    return html.slice(start, html.indexOf('\n        function ', start + 1));
}

function pasteHarness(steps) {
    const values = { clipboard: steps ? { steps: theory.copy(steps), pattern: 'custom' } : null, saved: 0, restarted: [], statuses: {}, edits: [], metas: {}, resets: [] };
    const context = {
        window: { mygrainQ: { getArpClipboard: () => theory.copy(values.clipboard) } },
        document: { getElementById: id => values.metas[id] ||= { textContent: '' }, querySelectorAll: () => [] },
        saveState: () => { values.saved += 1; }
    };
    for (const layer of ['L', 'X']) {
        const sequence = Array.from({ length: 64 }, () => ({ note: 'A2', rest: false, accent: true, slide: true, ratchet: 3 }));
        values[layer] = sequence;
        context[`bastardLoop${layer}EditStepIndex`] = 4;
        context[`getBastardLoop${layer}PatternLength`] = () => 16;
        context[`setBastardLoop${layer}Step`] = (index, step, options) => {
            sequence[index] = step;
            values.edits.push({ layer, index, options });
        };
        context[`setBastardLoop${layer}EditStepIndex`] = index => { context[`bastardLoop${layer}EditStepIndex`] = index; };
        context[`resetBastardLoop${layer}CopyState`] = options => values.resets.push({ layer, options });
        context[`resetBastardLoop${layer}TransposeSectionState`] = () => {};
        context[`restartBastardLoop${layer}PlaybackIfNeeded`] = () => values.restarted.push(layer);
        context[`updateBastardLoop${layer}Status`] = message => { values.statuses[layer] = message; };
    }
    vm.createContext(context);
    vm.runInContext(functionSource('syncBastardLoopArpPasteButtons') + functionSource('pasteBastardLoopArpAtCursor'), context);
    return { context, values, paste: layer => context.pasteBastardLoopArpAtCursor(layer) };
}

test('All built-in orders copy pitched monophonic pulses with ASCII note names', () => {
    for (const [pattern, names] of Object.entries({ up: ['C#3', 'F3', 'G#3'], down: ['G#3', 'F3', 'C#3'], updown: ['C#3', 'F3', 'G#3', 'F3'], odds: ['C#3', 'G#3', 'F3'], evens: ['F3', 'C#3', 'G#3'] })) {
        const steps = theory.arpPhrase(state({ arpPattern: pattern }), chord);
        assert.deepEqual(steps.map(step => step.note), names);
        assert.ok(steps.every(step => !step.rest && !step.accent && !step.slide && step.ratchet === 1));
    }
});

test('Custom order keeps initial, internal and trailing gaps, wrapping ranks to chord size', () => {
    const source = state({ arpPattern: 'custom', arpSteps: [0, 3, 0, 8, 1, 0], transpose: 12 });
    const steps = theory.arpPhrase(source, chord);
    assert.deepEqual(steps.map(step => step.note), ['', 'G#4', '', 'F4', 'C#4', '']);
    assert.deepEqual(steps.map(step => step.rest), [true, false, true, false, false, true]);
    assert.deepEqual(source.arpSteps, [0, 3, 0, 8, 1, 0]);
});

test('Empty-cell Q accents map to hanging arp pulses using its cursor, division and grid rate', () => {
    const source = state({ arpPattern: 'custom', arpSteps: [1, 2, 0, 3, 1], arpDivision: .25, rate: 2, accentAmount: .5 });
    source.sequence[4] = theory.normalizeStep({ ...chord, accent: true });
    source.sequence[6] = theory.normalizeStep({ kind: 'accent', notes: [], accent: true });
    source.sequence[12] = theory.normalizeStep({ kind: 'accent', notes: [], accent: true });
    assert.deepEqual(theory.arpPhrase(source, chord, 4, 16).map(step => step.accent), [true, true, false, false, true]);
    source.accentAmount = 0;
    assert.ok(theory.arpPhrase(source, chord, 4, 16).every(step => !step.accent));
});

test('Copy starts at Q step one instead of its cursor or builder and never advances or auditions', async () => {
    const instance = controller();
    instance.state = state({ arpPattern: 'down', arpRepeat: 'until-next' });
    instance.cursor = 5;
    instance.state.sequence[5] = theory.normalizeStep(chord);
    instance.state.selection = theory.normalizeStep({ notes: [60, 64, 67] });
    instance.clipboard = [{ notes: [72] }];
    instance.audition = () => assert.fail('Copy must not audition');
    const before = JSON.stringify(instance.state);
    await instance.action('copy-arp');
    const copied = instance.getArpClipboard();
    assert.equal(copied.sourceLength, 16);
    assert.equal(copied.steps.length, 16);
    assert.deepEqual(copied.steps.slice(5, 8).map(step => step.note), ['G#3', 'F3', 'C#3']);
    assert.equal(copied.steps[15].note, 'F3');
    assert.equal(instance.cursor, 5);
    assert.equal(JSON.stringify(instance.state), before);
    assert.deepEqual(instance.clipboard, [{ notes: [72] }]);
    assert.match(instance.message, /entire 16-step Q pattern from step 1/);
});

test('An empty Q sequence copies the complete silence without substituting the selected/builder chord', () => {
    const instance = controller();
    instance.state = state({ arpPattern: 'up', chordRoot: 1, octave: 3 });
    assert.equal(instance.piano.bank, null);
    instance.state.selection = theory.normalizeStep(chord);
    const copied = instance.copyArp();
    assert.equal(copied.steps.length, 16);
    assert.ok(copied.steps.every(step => step.rest && !step.note && !step.accent));
});

test('Block mode cannot overwrite the clipboard, rests can copy, and returned snapshots cannot mutate it', async () => {
    const instance = controller();
    instance.state = state();
    const saved = instance.copyArp();
    saved.steps[0].note = 'A9';
    assert.notEqual(instance.getArpClipboard().steps[0].note, 'A9');
    const original = instance.getArpClipboard();
    instance.state.arpEnabled = false;
    await assert.rejects(instance.action('copy-arp'), /block chords/);
    assert.deepEqual(instance.getArpClipboard(), original);
    instance.state.arpEnabled = true;
    instance.state.sequence[0] = theory.normalizeStep({ ...chord, rest: true });
    assert.ok(instance.copyArp().steps.every(step => step.rest));
    assert.throws(() => theory.arpPhrase(state(), { notes: [] }), /playable/);
});

test('Full-pattern copy includes all 16, 32 and 64 cells, repeated arps and the final chord change', () => {
    for (const length of [16, 32, 64]) {
        const instance = controller(length);
        instance.state = state({ arpRepeat: 'until-next' });
        instance.state.sequence[0] = theory.normalizeStep(chord);
        instance.state.sequence[length / 2] = theory.normalizeStep({ notes: [60, 64, 67] });
        instance.state.sequence[length - 1] = theory.normalizeStep({ notes: [72], accent: true });
        instance.state.sequence[length - 2] = theory.normalizeStep({ kind: 'accent', notes: [], accent: true });
        instance.cursor = length / 2;
        const copied = instance.copyArp();
        assert.equal(copied.sourceLength, length);
        assert.equal(copied.steps.length, length);
        assert.deepEqual(copied.steps.slice(0, 6).map(step => step.note), ['C#3', 'F3', 'G#3', 'C#3', 'F3', 'G#3']);
        assert.deepEqual(copied.steps.slice(length / 2, length / 2 + 3).map(step => step.note), ['C4', 'E4', 'G4']);
        assert.equal(copied.steps[length - 1].note, 'C5');
        assert.ok(copied.steps[length - 2].accent);
        assert.ok(copied.steps[length - 1].accent);
    }
});

test('The complete sequence preserves custom gaps, explicit rests, leading silence and once-only tails', () => {
    const source = state({ arpPattern: 'custom', arpSteps: [0, 3, 1, 0], transpose: 12 });
    source.sequence[4] = theory.normalizeStep(chord);
    source.sequence[12] = theory.normalizeStep({ notes: [60, 64, 67] });
    let copied = theory.arpSequence(source, 16);
    assert.equal(copied.length, 16);
    assert.deepEqual(copied.map(step => step.note), ['', '', '', '', '', 'G#4', 'C#4', '', '', '', '', '', '', 'G5', 'C5', '']);
    source.arpRepeat = 'until-next';
    source.sequence[0] = theory.normalizeStep({ notes: [72], rest: true });
    source.sequence[9] = theory.normalizeStep({ notes: [72], rest: true });
    copied = theory.arpSequence(source, 16);
    assert.equal(copied.length, 16);
    assert.ok(copied.slice(0, 4).every(step => step.rest));
    assert.ok(copied.slice(9, 12).every(step => step.rest));
    assert.equal(copied[15].rest, true);
    source.accentAmount = 0;
    source.sequence[14] = theory.normalizeStep({ kind: 'accent', notes: [], accent: true });
    assert.ok(theory.arpSequence(source, 16).every(step => !step.accent));
});

test('Full copy expands every arp pulse at fast, slow and triplet divisions without truncating the clipboard', () => {
    for (const [division, rate] of [[.125, 1], [.5, 1], [1 / 6, 1], [.25, .5], [.25, 2]]) {
        const source = state({ arpRepeat: 'until-next', arpDivision: division, rate });
        source.sequence[0] = theory.normalizeStep(chord);
        const copied = theory.arpSequence(source, 64);
        const expected = theory.playbackEvents(source, 64);
        assert.equal(copied.length, Math.ceil(64 / (division * 4 * rate)));
        assert.deepEqual(copied.filter(step => !step.rest).map(step => step.note), expected.map(event => theory.noteName(event.notes[0]).replaceAll('♯', '#')));
    }
});

test('Chords on fractional pulse offsets and ratchets are all copied rather than dropping later notes', () => {
    const source = state({ arpRepeat: 'until-next', arpDivision: 1 / 6 });
    source.sequence[0] = theory.normalizeStep({ ...chord, ratchet: 2 });
    source.sequence[9] = theory.normalizeStep({ notes: [60, 64, 67] });
    const copied = theory.arpSequence(source, 16);
    const expected = theory.playbackEvents(source, 16);
    assert.deepEqual(copied.filter(step => !step.rest).map(step => step.note), expected.map(event => theory.noteName(event.notes[0]).replaceAll('♯', '#')));
});

test('Loop carry-over is copied once, while dormant chords beyond the active pattern are excluded', () => {
    const source = state({ arpRepeat: 'until-next' });
    source.sequence[4] = theory.normalizeStep(chord);
    source.sequence[15] = theory.normalizeStep({ notes: [60, 64, 67] });
    source.sequence[16] = theory.normalizeStep({ notes: [84] });
    const copied = theory.arpSequence(source, 16);
    assert.equal(copied.length, 16);
    assert.deepEqual(copied.slice(0, 4).map(step => step.note), ['E4', 'G4', 'C4', 'E4']);
    assert.equal(copied[4].note, 'C#3');
    assert.equal(copied[15].note, 'C4');
    assert.ok(copied.every(step => step.note !== 'C6'));
    source.arpEnabled = false;
    assert.throws(() => theory.arpSequence(source, 16), /block chords/);
});

test('Both X and L receive all 64 copied pulses including the last cell when pasting at step one', () => {
    const instance = controller(64);
    instance.state = state({ arpRepeat: 'until-next', arpPattern: 'custom', arpSteps: [3, 0, 1, 2] });
    instance.state.sequence[0] = theory.normalizeStep(chord);
    instance.state.sequence[32] = theory.normalizeStep({ notes: [60, 64, 67] });
    instance.state.sequence[63] = theory.normalizeStep({ notes: [72], accent: true });
    instance.cursor = 48;
    const copied = instance.copyArp();
    const harness = pasteHarness(copied.steps);
    for (const layer of ['L', 'X']) {
        harness.context[`getBastardLoop${layer}PatternLength`] = () => 64;
        harness.context[`bastardLoop${layer}EditStepIndex`] = 0;
        harness.paste(layer);
        assert.deepEqual(theory.copy(harness.values[layer]), copied.steps);
        assert.equal(harness.values[layer][63].note, 'C5');
        assert.ok(harness.values[layer][63].accent);
        assert.match(harness.values.statuses[layer], /pasted 64 arp pulses/);
        assert.doesNotMatch(harness.values.statuses[layer], /not pasted/);
    }
});

test('Both target loops paste at their cursor, preserve neighboring cells, and keep the clipboard reusable', () => {
    const steps = theory.arpPhrase(state({ arpPattern: 'custom', arpSteps: [3, 0, 1, 2] }), chord);
    steps[2].accent = true;
    const harness = pasteHarness(steps);
    for (const layer of ['L', 'X']) {
        const before = theory.copy(harness.values[layer]);
        assert.equal(harness.paste(layer), true);
        const sequence = theory.copy(harness.values[layer]);
        assert.deepEqual(sequence.slice(4, 8), steps);
        assert.deepEqual(sequence.slice(0, 4), before.slice(0, 4));
        assert.deepEqual(sequence.slice(8), before.slice(8));
        assert.equal(harness.context[`bastardLoop${layer}EditStepIndex`], 4);
        assert.match(harness.values.statuses[layer], /Rate unchanged/);
        assert.equal(harness.values.metas[`performanceBastardLoop${layer}Meta`].textContent, harness.values.statuses[layer]);
    }
    assert.equal(harness.values.saved, 2);
    assert.deepEqual(harness.values.restarted, ['L', 'X']);
    assert.ok(harness.values.edits.every(edit => edit.options.skipSave));
    harness.values.L[4].note = 'C0';
    assert.deepEqual(harness.values.clipboard.steps, steps);
    assert.deepEqual(theory.copy(harness.values.X.slice(4, 8)), steps);
});

test('Paste stops at the visible pattern end without wrapping, extending or touching hidden steps', () => {
    const steps = theory.arpPhrase(state({ arpPattern: 'custom', arpSteps: Array(32).fill(1) }), chord);
    for (const layer of ['L', 'X']) {
        const harness = pasteHarness(steps);
        harness.context[`bastardLoop${layer}EditStepIndex`] = 14;
        const before = theory.copy(harness.values[layer]);
        harness.paste(layer);
        const after = theory.copy(harness.values[layer]);
        assert.deepEqual(after.slice(0, 14), before.slice(0, 14));
        assert.deepEqual(after.slice(14, 16), steps.slice(0, 2));
        assert.deepEqual(after.slice(16), before.slice(16));
        assert.match(harness.values.statuses[layer], /30 pulses not pasted \(no wrap\)/);
        assert.equal(harness.values.clipboard.steps.length, 32);
    }
});

test('Gap-only arp copies intentionally clear destination notes to explicit rests', () => {
    const steps = theory.arpPhrase(state({ arpPattern: 'custom', arpSteps: [0, 0, 0] }), chord);
    const harness = pasteHarness(steps);
    harness.paste('L');
    assert.ok(harness.values.L.slice(4, 7).every(step => step.rest && step.note === '' && !step.accent));
});

test('An empty clipboard and invalid target never alter notes or save state', () => {
    const harness = pasteHarness(null);
    assert.equal(harness.paste('L'), false);
    assert.equal(harness.paste('X'), false);
    assert.equal(harness.paste('Q'), false);
    assert.equal(harness.values.saved, 0);
    assert.equal(harness.values.edits.length, 0);
    assert.match(harness.values.statuses.L, /Copy an arp from Q first/);
});

test('Paste controls exist on both cards and both editors and start disabled', () => {
    for (const layer of ['L', 'X']) for (const prefix of ['performanceBastardLoop', 'bastardLoop']) {
        assert.match(html, new RegExp(`id="${prefix}${layer}PasteArpBtn"[^>]*data-arp-paste="${layer}"[^>]*disabled>Paste from Arp`));
    }
});
