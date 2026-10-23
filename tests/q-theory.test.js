const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const theory = require('../q-theory.js');
const { Controller, Piano } = require('../q-card.js');

function controller() {
    const instance = new Controller({ length: () => 16, bpm: () => 120, save: () => {}, context: () => ({ currentTime: 0 }) });
    instance.status = () => {};
    return instance;
}

test('Q dotted and triplet delay beat values survive normalization and JSON recall', () => {
    for (const beats of [.125, .25, .5, 1, 2, 4]) for (const multiplier of [1, 1.5, 2 / 3]) {
        const delayBeats = beats * multiplier;
        assert.equal(theory.normalizeState(JSON.parse(JSON.stringify({ delayBeats }))).delayBeats, delayBeats);
    }
    assert.equal(theory.normalizeState({ delayBeats: -1 }).delayBeats, 1 / 12);
    assert.equal(theory.normalizeState({ delayBeats: 9 }).delayBeats, 6);
    assert.equal(theory.normalizeState({}).delayBeats, .5);
});

test('Q plays simultaneous major, minor, extended and inverted chords', () => {
    assert.deepEqual(theory.chord(60), [60, 64, 67]);
    assert.deepEqual(theory.chord(60, 'minor'), [60, 63, 67]);
    assert.deepEqual(theory.chord(60, 'major7', 1), [64, 67, 71, 72]);
    assert.deepEqual(theory.chord(60, 'dominant13'), [60, 64, 67, 70, 74, 81]);
    assert.deepEqual(theory.chord(60, 'major', 0, 'octave-bass'), [48, 60, 64, 67]);
    for (const quality of Object.keys(theory.qualities)) assert.ok(theory.chord(48, quality).every(Number.isInteger));
});

test('all scale degrees generate correctly stacked diatonic triads and sevenths', () => {
    const chords = theory.scaleChords(0, [0, 2, 4, 5, 7, 9, 11], 3);
    assert.deepEqual(chords.map(chord => chord.type), ['major', 'minor', 'minor', 'major', 'major', 'minor', 'diminished']);
    assert.deepEqual(chords[6].notes, [59, 62, 65]);
    assert.deepEqual(theory.scaleChords(0, [0, 2, 4, 5, 7, 9, 11], 3, 4)[0].notes, [48, 52, 55, 59]);
});

test('large palette contains only scale notes and chord-root focus changes the shown order', () => {
    const state = theory.defaults();
    const intervals = [0, 2, 4, 5, 7, 9, 11];
    const palette = theory.chordPalette(state, intervals);
    assert.ok(palette.length > 50);
    assert.ok(palette.every(chord => chord.notes.every(note => intervals.includes(note % 12))));
    assert.ok(palette.some(chord => chord.type === 'major9'));
    state.chordRoot = 7;
    assert.equal(theory.chordPalette(state, intervals)[0].root, 55);
    state.inversion = 1;
    assert.deepEqual(theory.chordPalette(state, intervals)[0].notes, [59, 62, 67]);
    state.paletteFamilies = 'triads';
    assert.ok(theory.chordPalette(state, intervals).every(chord => theory.qualities[chord.type].length === 3));
});

test('every named scale and tonic has a valid scale-matched palette', () => {
    const scales = JSON.parse(fs.readFileSync(path.join(__dirname, '../q-scales.json'), 'utf8')).scales;
    for (const scale of scales) for (let tonic = 0; tonic < 12; tonic += 1) {
        const state = { ...theory.defaults(), tonic, chordRoot: tonic };
        const classes = scale.intervals.map(interval => (interval + tonic) % 12);
        for (const chord of theory.chordPalette(state, scale.intervals)) {
            assert.ok(chord.notes.every(note => note >= 21 && note <= 108 && classes.includes(note % 12)), `${tonic} ${scale.name}`);
        }
    }
});

test('arpeggiator orders retain every chord note and bounce without duplicate endpoints', () => {
    const pitches = [48, 52, 55, 59];
    assert.deepEqual(theory.arpOrder(pitches, 'up'), pitches);
    assert.deepEqual(theory.arpOrder(pitches, 'down'), [59, 55, 52, 48]);
    assert.deepEqual(theory.arpOrder(pitches, 'updown'), [48, 52, 55, 59, 55, 52]);
    assert.deepEqual(theory.arpOrder(pitches, 'odds'), [48, 55, 52, 59]);
    assert.deepEqual(theory.arpOrder(pitches, 'evens'), [52, 59, 48, 55]);
    assert.deepEqual(theory.arpOrder([48], 'updown'), [48]);
});

test('once arp plays one cycle; repeating arp continues only until the next chord or explicit rest', () => {
    const state = theory.defaults();
    state.arpEnabled = true;
    state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55], gate: 4 });
    state.sequence[8] = theory.normalizeStep({ notes: [53, 57, 60], gate: 4 });
    assert.deepEqual(theory.playbackEvents(state, 16).map(event => event.start), [0, 1, 2, 8, 9, 10]);
    state.arpRepeat = 'until-next';
    assert.equal(theory.playbackEvents(state, 16).length, 16);
    state.sequence[4] = theory.normalizeStep({ notes: [48], rest: true });
    const events = theory.playbackEvents(state, 16);
    assert.ok(events.filter(event => event.index === 0).every(event => event.start < 4));
    assert.ok(events.every(event => event.start < 4 || event.start >= 8));
    assert.deepEqual(events.find(event => event.start === 8).notes, [53]);
});

test('arp time division is independent of grid rate and supports triplets', () => {
    for (const rate of [.25, 1, 4]) {
        const state = { ...theory.defaults(), rate, arpEnabled: true, arpDivision: 1 / 6 };
        state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55], gate: 64 });
        const events = theory.playbackEvents(state, 64);
        assert.ok(Math.abs(events[1].start / rate / 4 - 1 / 6) < .000001);
    }
});

test('a once-only extended arpeggio completes its order beyond the block-chord gate', () => {
    const state = { ...theory.defaults(), arpEnabled: true, arpDivision: .5 };
    state.sequence[0] = theory.normalizeStep({ root: 48, notes: [48, 52, 55, 58, 62, 69], gate: .1 });
    const events = theory.playbackEvents(state, 16);
    assert.deepEqual(events.map(event => event.notes[0]), [48, 52, 55, 58, 62, 69]);
    assert.deepEqual(events.map(event => event.start), [0, 2, 4, 6, 8, 10]);
});

test('one-cycle grid arpeggios finish through adjacent chords in chronological order', () => {
    for (const pattern of ['up', 'down', 'updown', 'odds', 'evens']) {
        const state = { ...theory.defaults(), arpEnabled: true, arpPattern: pattern };
        state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55] });
        state.sequence[1] = theory.normalizeStep({ notes: [53, 57, 60] });
        const events = theory.playbackEvents(state, 16);
        for (const index of [0, 1]) {
            assert.deepEqual(events.filter(event => event.index === index).map(event => event.notes[0]), theory.arpOrder(state.sequence[index].notes, pattern));
        }
        assert.ok(events.every((event, index) => index === 0 || event.start >= events[index - 1].start));
    }
});

test('explicit rests and pattern restarts stop one-cycle arpeggios, but empty cells do not', () => {
    const state = { ...theory.defaults(), arpEnabled: true };
    state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55] });
    state.sequence[1] = theory.normalizeStep({ notes: [53, 57, 60] });
    state.sequence[2] = theory.normalizeStep({ notes: [48], rest: true });
    assert.deepEqual(theory.playbackEvents(state, 16).map(event => event.start), [0, 1, 1]);
    state.sequence[2] = null;
    assert.deepEqual(theory.playbackEvents(state, 16).filter(event => event.index === 0).map(event => event.start), [0, 1, 2]);
    state.sequence[15] = theory.normalizeStep({ notes: [55, 59, 62] });
    assert.ok(theory.playbackEvents(state, 16).every(event => event.start < 16));
});

test('Play saves Q enabled without seeking past early arpeggiator pulses', async () => {
    const instance = controller();
    instance.state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55] });
    instance.preparePlayback = async () => {};
    instance.piano.ensure = async () => {};
    instance.host.stopAll = () => instance.stop();
    instance.start = () => { instance.running = true; };
    let seeks = 0;
    instance.seek = () => { seeks += 1; };
    await instance.action('play');
    assert.equal(instance.state.enabled, true);
    assert.equal(instance.running, true);
    assert.equal(seeks, 0);
});

test('tapping a grid chord auditions it without recording, advancing or changing other cells', () => {
    const instance = controller();
    instance.state.record = true;
    instance.state.sequence[3] = theory.normalizeStep({ root: 50, notes: [50, 53, 57], velocity: 70 });
    const sequence = theory.copy(instance.state.sequence);
    const auditions = [];
    instance.audition = async chord => { auditions.push(theory.copy(chord)); };
    instance.stepClicked(3);
    assert.deepEqual(auditions, [sequence[3]]);
    assert.equal(instance.cursor, 3);
    assert.deepEqual(instance.state.sequence, sequence);
    assert.deepEqual(instance.state.selection, sequence[3]);
});

test('empty and Rest grid taps stop preview without auditioning or writing a chord', () => {
    const instance = controller();
    instance.state.sequence[1] = theory.normalizeStep({ notes: [48], rest: true });
    let stopped = 0;
    let played = 0;
    instance.stopPreview = () => { stopped += 1; };
    instance.audition = async () => { played += 1; };
    instance.stepClicked(0);
    instance.stepClicked(1);
    assert.equal(stopped, 2);
    assert.equal(played, 0);
    assert.equal(instance.state.sequence[0], null);
});

test('single-chord transpose changes and auditions only the selected grid chord', async () => {
    const instance = controller();
    instance.cursor = 3;
    instance.state.transpose = 2;
    instance.state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55] });
    instance.state.sequence[3] = theory.normalizeStep({ root: 53, notes: [53, 57, 60], velocity: 70, gate: 3, ratchet: 2, accent: true, tie: true });
    const sequence = theory.copy(instance.state.sequence);
    const auditions = [];
    instance.audition = async chord => { auditions.push(theory.copy(chord)); };
    await instance.action('transpose-step-up');
    assert.deepEqual(instance.state.sequence[3], { ...sequence[3], root: 54, notes: [54, 58, 61] });
    assert.deepEqual(instance.state.selection, instance.state.sequence[3]);
    assert.deepEqual(instance.state.sequence.filter((step, index) => index !== 3), sequence.filter((step, index) => index !== 3));
    assert.equal(instance.state.transpose, 2);
    assert.equal(instance.cursor, 3);
    await instance.action('transpose-step-down');
    assert.deepEqual(instance.state.sequence, sequence);
    assert.equal(auditions.length, 2);
});

test('single-chord transpose rejects empty, Rest and out-of-range edits atomically', async () => {
    const instance = controller();
    instance.audition = async () => {};
    for (const step of [null, theory.normalizeStep({ notes: [48], rest: true })]) {
        instance.state.sequence[0] = step;
        await assert.rejects(instance.action('transpose-step-up'), /Select a grid chord/);
    }
    for (const [pitch, transpose, action] of [[108, 0, 'transpose-step-up'], [21, 0, 'transpose-step-down'], [107, 1, 'transpose-step-up'], [22, -1, 'transpose-step-down']]) {
        instance.state.transpose = transpose;
        instance.state.sequence[0] = theory.normalizeStep({ root: pitch, notes: [pitch] });
        const before = theory.copy(instance.state);
        await assert.rejects(instance.action(action), /piano range/);
        assert.deepEqual(instance.state, before);
    }
});

test('Q follows the visible viewport instead of putting lower controls behind browser chrome', context => {
    const previous = { document: global.document, visualViewport: global.visualViewport };
    context.after(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete global[key];
            else global[key] = value;
        }
    });
    const properties = new Map();
    global.document = { getElementById: () => ({ hidden: false, style: { setProperty: (key, value) => properties.set(key, value) } }) };
    global.visualViewport = { height: 640, width: 390, offsetTop: 32, offsetLeft: 0 };
    const instance = controller();
    instance.revealCursor = () => {};
    instance.syncViewport();
    assert.equal(properties.get('--q-viewport-height'), '640px');
    assert.equal(properties.get('--q-viewport-top'), '32px');
    assert.equal(properties.get('--q-viewport-width'), '390px');
});

test('Record cycles Step and Live, with Practice disarming both modes', async () => {
    const instance = controller();
    await instance.action('record');
    assert.equal(instance.state.record, true);
    assert.equal(instance.state.recordMode, 'step');
    await instance.action('record');
    assert.equal(instance.state.recordMode, 'live');
    await instance.action('record');
    assert.equal(instance.state.recordMode, 'step');
    await instance.action('practice');
    assert.equal(instance.state.record, false);
});

test('legacy recording defaults to Step; Live mode survives the unchanged version-one schema', () => {
    assert.equal(theory.normalizeState({ record: true }).recordMode, 'step');
    assert.equal(theory.normalizeState({ recordMode: 'invalid' }).recordMode, 'step');
    const state = { ...theory.defaults(), record: true, recordMode: 'live' };
    assert.deepEqual(theory.normalizeState(state), state);
    assert.equal(state.version, 1);
});

test('Live writes at the audio playhead, not the edit cursor, and wraps without advancing', () => {
    const instance = controller();
    let time = 2.49;
    instance.host.context = () => ({ currentTime: time });
    instance.changed = () => {};
    instance.running = true;
    instance.origin = 2;
    instance.state.record = true;
    instance.state.recordMode = 'live';
    instance.cursor = 9;
    const chord = theory.normalizeStep({ notes: [48, 52, 55] });
    assert.equal(instance.recordChord(chord), true);
    assert.deepEqual(instance.state.sequence[3], chord);
    assert.equal(instance.state.sequence[9], null);
    assert.equal(instance.cursor, 3);
    time = 4.01;
    instance.recordChord(chord);
    assert.equal(instance.cursor, 0);
    instance.state.rate = 2;
    time = 2.32;
    instance.recordChord(chord);
    assert.equal(instance.cursor, 5);
});

test('Live never falls back to step entry while stopped or awaiting its transport origin', () => {
    const instance = controller();
    instance.state.record = true;
    instance.state.recordMode = 'live';
    const chord = theory.normalizeStep({ notes: [48, 52, 55] });
    assert.equal(instance.recordChord(chord), false);
    instance.running = true;
    instance.origin = .5;
    assert.equal(instance.recordChord(chord), false);
    assert.equal(instance.state.sequence.some(Boolean), false);
    assert.equal(instance.cursor, 0);
});

test('Live captures tap timing before asynchronous audition sample loading', async () => {
    const instance = controller();
    let time = 1.31;
    let finish;
    instance.host.context = () => ({ currentTime: time });
    instance.changed = () => {};
    instance.running = true;
    instance.origin = 1;
    instance.state.record = true;
    instance.state.recordMode = 'live';
    instance.audition = () => new Promise(resolve => { finish = resolve; });
    const pending = instance.playChord({ notes: [48, 52, 55] });
    time = 1.95;
    finish();
    await pending;
    assert.deepEqual(instance.state.sequence[2].notes, [48, 52, 55]);
    assert.equal(instance.state.sequence[7], null);
    assert.equal(instance.cursor, 2);
});

test('an empty Q can start and keep its clock running when Live is armed', context => {
    const previous = global.document;
    global.document = { querySelectorAll: () => [], getElementById: () => null };
    context.after(() => { if (previous === undefined) delete global.document; else global.document = previous; });
    const instance = controller();
    instance.host.context = () => ({ currentTime: 1, state: 'running' });
    instance.ensureGraph = () => {};
    instance.revealCursor = () => {};
    instance.state.enabled = true;
    instance.state.record = true;
    instance.state.recordMode = 'live';
    assert.equal(instance.playable(), true);
    assert.equal(instance.start(1), true);
    assert.equal(instance.running, true);
    instance.tick();
    assert.equal(instance.running, true);
    instance.stop();
});

test('Live updates cancel queued old notes and reschedule without restarting the origin', async () => {
    const instance = controller();
    instance.running = true;
    instance.origin = -1;
    instance.piano.ensure = async () => {};
    instance.sync = () => {};
    instance.tick = () => {};
    const removed = [];
    instance.removeVoice = voice => { removed.push(voice); instance.voices.delete(voice); };
    const future = { start: .05, preview: false };
    const current = { start: -.01, preview: false };
    const audition = { start: .05, preview: true };
    instance.voices = new Set([future, current, audition]);
    let seekTime;
    instance.seek = time => { seekTime = time; };
    instance.changed({ live: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(removed, [future]);
    assert.equal(seekTime, .001);
    assert.equal(instance.origin, -1);
});

test('All Play starts the whole host transport without requiring a Q chord; Stop stops it all', async () => {
    const instance = controller();
    let started = 0;
    let stopped = 0;
    instance.host.ready = async () => true;
    instance.host.allPlay = () => { started += 1; };
    instance.host.stopAll = () => { stopped += 1; };
    await instance.action('play-all');
    assert.equal(started, 1);
    await instance.action('stop-all');
    assert.equal(stopped, 1);
});

test('quick Delete clears only the selected cell without moving the cursor', async () => {
    const instance = controller();
    instance.state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55] });
    instance.state.sequence[2] = theory.normalizeStep({ notes: [50, 53, 57] });
    instance.cursor = 2;
    await instance.action('clear-step');
    assert.equal(instance.state.sequence[2], null);
    assert.deepEqual(instance.state.sequence[0].notes, [48, 52, 55]);
    assert.equal(instance.cursor, 2);
});

test('All Stop cancels a pending whole-pattern start while piano notes load', async () => {
    const instance = controller();
    instance.state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55] });
    instance.host.ready = async () => true;
    let finish;
    let started = false;
    instance.preparePlayback = () => new Promise(resolve => { finish = resolve; });
    instance.host.allPlay = () => { started = true; };
    instance.host.stopAll = () => instance.stop();
    const pending = instance.action('play-all');
    await new Promise(resolve => setImmediate(resolve));
    await instance.action('stop-all');
    finish();
    await pending;
    assert.equal(started, false);
    assert.equal(instance.running, false);
});

test('live audition cutoff follows next chord for repeating arp and next Rest for one cycle', async () => {
    const instance = controller();
    instance.running = true;
    instance.origin = 0;
    instance.host.context = () => ({ currentTime: .1 });
    instance.changed = () => {};
    instance.state.record = true;
    instance.state.recordMode = 'live';
    instance.state.arpEnabled = true;
    instance.state.sequence[4] = theory.normalizeStep({ notes: [50, 53, 57] });
    instance.state.sequence[8] = theory.normalizeStep({ notes: [48], rest: true });
    let options;
    instance.audition = async (chord, value) => { options = value; };
    await instance.playChord({ notes: [48, 52, 55] });
    assert.equal(options.endPosition, 8);
    instance.state.arpRepeat = 'until-next';
    await instance.playChord({ notes: [48, 52, 55] });
    assert.equal(options.endPosition, 4);
});

test('a live audition loaded after its cutoff never creates a timer or stops the transport', async () => {
    const instance = controller();
    instance.host.context = () => ({ currentTime: 1, state: 'running' });
    instance.host.ready = async () => true;
    instance.piano.ensure = async () => {};
    instance.ensureGraph = () => {};
    instance.running = true;
    instance.origin = 0;
    await instance.audition(theory.normalizeStep({ notes: [48, 52, 55] }), { endPosition: 1 });
    assert.equal(instance.preview, null);
    assert.equal(instance.previewTimer, null);
    assert.equal(instance.running, true);
});

test('Practice does not discard an in-flight Live playback update or seek a running grid', async () => {
    const instance = controller();
    let finish;
    instance.piano.ensure = () => new Promise(resolve => { finish = resolve; });
    instance.running = true;
    instance.state.record = true;
    instance.state.recordMode = 'live';
    instance.tick = () => {};
    instance.seek = () => {};
    instance.state.sequence[2] = theory.normalizeStep({ notes: [48, 52, 55] });
    instance.changed({ live: true });
    await instance.action('practice');
    finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(instance.playbackState.sequence[2].notes, [48, 52, 55]);
    assert.equal(instance.state.record, false);
});

test('Left 1 and Right 1 move the selected chord with its full metadata and selection', async () => {
    const instance = controller();
    instance.state.sequence[4] = theory.normalizeStep({ root: 53, type: 'major', notes: [53, 57, 60], velocity: 70, gate: 3, ratchet: 2, accent: true, tie: true });
    instance.state.sequence[12] = theory.normalizeStep({ notes: [48, 52, 55] });
    instance.cursor = 4;
    const before = theory.copy(instance.state.sequence);
    await instance.action('nudge-left');
    assert.equal(instance.cursor, 3);
    assert.deepEqual(instance.state.sequence[3], before[4]);
    assert.equal(instance.state.sequence[4], null);
    assert.deepEqual(instance.state.sequence[12], before[12]);
    assert.deepEqual(instance.state.selection, before[4]);
    await instance.action('nudge-right');
    assert.equal(instance.cursor, 4);
    assert.deepEqual(instance.state.sequence, before);
});

test('nudging onto an occupied chord or Rest swaps cells rather than losing either step', async () => {
    const instance = controller();
    instance.state.sequence[2] = theory.normalizeStep({ root: 48, notes: [48, 52, 55] });
    instance.state.sequence[3] = theory.normalizeStep({ root: 50, notes: [50, 53, 57], velocity: 72 });
    instance.state.sequence[4] = theory.normalizeStep({ notes: [48], rest: true });
    instance.cursor = 2;
    const before = theory.copy(instance.state.sequence);
    await instance.action('nudge-right');
    assert.deepEqual(instance.state.sequence[2], before[3]);
    assert.deepEqual(instance.state.sequence[3], before[2]);
    await instance.action('nudge-right');
    assert.deepEqual(instance.state.sequence[3], before[4]);
    assert.deepEqual(instance.state.sequence[4], before[2]);
    await instance.action('nudge-left');
    await instance.action('nudge-left');
    assert.deepEqual(instance.state.sequence, before);
});

test('nudging wraps within active pattern length and never edits dormant steps', async () => {
    const instance = controller();
    instance.host.length = () => 8;
    instance.state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55] });
    instance.state.sequence[63] = theory.normalizeStep({ notes: [60, 64, 67] });
    const before = theory.copy(instance.state.sequence);
    await instance.action('nudge-left');
    assert.equal(instance.cursor, 7);
    assert.deepEqual(instance.state.sequence[7], before[0]);
    assert.deepEqual(instance.state.sequence[63], before[63]);
    await instance.action('nudge-right');
    assert.equal(instance.cursor, 0);
    assert.deepEqual(instance.state.sequence, before);
    instance.cursor = 63;
    await assert.rejects(instance.action('nudge-left'), /Select a grid chord/);
    assert.deepEqual(instance.state.sequence, before);
});

test('empty and Rest cells cannot be nudged and remain unchanged', async () => {
    const instance = controller();
    for (const step of [null, theory.normalizeStep({ notes: [48], rest: true })]) {
        instance.state.sequence[0] = step;
        const before = theory.copy(instance.state);
        await assert.rejects(instance.action('nudge-left'), /Select a grid chord/);
        await assert.rejects(instance.action('nudge-right'), /Select a grid chord/);
        assert.deepEqual(instance.state, before);
        assert.equal(instance.cursor, 0);
    }
});

test('live nudge updates queued playback without restarting its origin or changing record mode', async () => {
    const instance = controller();
    instance.piano.ensure = async () => {};
    instance.tick = () => {};
    instance.running = true;
    instance.origin = -2;
    instance.state.record = true;
    instance.state.recordMode = 'live';
    instance.state.sequence[9] = theory.normalizeStep({ root: 48, notes: [48, 52, 55] });
    instance.cursor = 9;
    const generation = instance.generation;
    let seekTime;
    instance.seek = time => { seekTime = time; };
    const stale = { start: .1, preview: false };
    instance.voices.add(stale);
    instance.removeVoice = voice => instance.voices.delete(voice);
    await instance.action('nudge-right');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(instance.running, true);
    assert.equal(instance.origin, -2);
    assert.equal(instance.generation, generation);
    assert.equal(instance.state.recordMode, 'live');
    assert.equal(instance.state.record, true);
    assert.equal(instance.voices.has(stale), false);
    assert.equal(seekTime, .001);
    assert.equal(instance.playbackState.sequence[9], null);
    assert.deepEqual(instance.playbackState.sequence[10].notes, [48, 52, 55]);
});

test('nudged timings survive normalisation and feed the existing export/playback timeline', async () => {
    const instance = controller();
    instance.cursor = 2;
    instance.state.sequence[2] = theory.normalizeStep({ root: 48, notes: [48, 52, 55], gate: 1 });
    await instance.action('nudge-right');
    const restored = theory.normalizeState(instance.getState());
    assert.equal(restored.version, 1);
    assert.equal(restored.sequence[2], null);
    assert.equal(theory.playbackEvents(restored, 16)[0].start, 3);
    assert.deepEqual(theory.playbackEvents(restored, 16)[0].notes, [48, 52, 55]);
});

test('legacy Q settings default to block chords; new arp and palette settings round-trip', () => {
    const old = { version: 1, sequence: [] };
    assert.equal(theory.normalizeState(old).arpEnabled, false);
    const state = { ...theory.defaults(), arpEnabled: true, arpPattern: 'evens', arpRepeat: 'until-next', arpDivision: .125, paletteFamilies: 'extended' };
    assert.deepEqual(theory.normalizeState(state), state);
});

test('Practice never records and Rest writes a silent step then advances', async () => {
    const instance = controller();
    await instance.action('record');
    assert.equal(instance.state.record, true);
    await instance.action('rest');
    assert.equal(instance.state.sequence[0].rest, true);
    assert.equal(instance.cursor, 1);
    await instance.action('practice');
    assert.equal(instance.state.record, false);
});

test('Rest cancels practice arpeggiation without stopping a running grid', async () => {
    const instance = controller();
    instance.changed = () => {};
    instance.running = true;
    instance.preview = { repeat: true };
    instance.previewTimer = setInterval(() => {}, 1000);
    const previousGeneration = instance.generation;
    await instance.action('rest');
    assert.equal(instance.preview, null);
    assert.equal(instance.previewTimer, null);
    assert.equal(instance.running, true);
    assert.equal(instance.generation, previousGeneration);
});

test('arp MIDI export writes single-note pulses rather than simultaneous block chords', () => {
    const state = { ...theory.defaults(), arpEnabled: true };
    state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55], gate: 4 });
    const midi = theory.midiFile(state, 16, 120);
    assert.equal([...midi].filter(byte => byte === 144).length, 3);
    assert.equal(theory.playbackEvents(state, 16).every(event => event.notes.length === 1), true);
});

test('the complete local named-scale dictionary is valid, with no external runtime dependencies', () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../q-scales.json'), 'utf8'));
    assert.equal(catalog.scales.length, 85);
    for (const scale of catalog.scales) {
        assert.equal(scale.intervals[0], 0);
        assert.equal(new Set(scale.intervals).size, scale.intervals.length);
        assert.ok(scale.intervals.every(pitch => Number.isInteger(pitch) && pitch >= 0 && pitch < 12));
    }
    for (const name of ['major', 'minor', 'harmonic minor', 'melodic minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian', 'chromatic']) assert.ok(catalog.scales.some(scale => scale.name === name));
});

test('custom pitch sets cover every rooted twelve-tone scale', () => {
    for (let mask = 0; mask < 2048; mask += 1) {
        const pitches = [0, ...Array.from({ length: 11 }, (_, index) => index + 1).filter(pitch => mask & (1 << (pitch - 1)))];
        assert.deepEqual(theory.normalizeState({ customScale: pitches }).customScale, pitches);
    }
});

test('normalization bounds effects, strips invalid chords and never auto-enables legacy parts', () => {
    const state = theory.normalizeState({ feedback: 4, level: -1, octave: 8, sequence: [{ notes: [0, 500] }] });
    assert.equal(state.feedback, .8);
    assert.equal(state.level, 0);
    assert.equal(state.sequence.length, 64);
    assert.equal(state.sequence[0], null);
    assert.equal(theory.normalizeState().enabled, true);
    assert.equal(state.enabled, false);
    assert.equal(theory.normalizeState({ enabled: false }).enabled, false);
    assert.equal(state.octave, 8);
});

test('every piano pitch and velocity selects the exact local zone deterministically', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../SAMPLES_Q/manifest.json'), 'utf8'));
    assert.equal(manifest.samples.length, 120);
    for (let midi = 21; midi <= 108; midi += 1) for (let velocity = 1; velocity <= 127; velocity += 1) {
        const sample = theory.sampleFor(manifest.samples, midi, velocity);
        assert.equal(sample.midi, theory.sampleMidi(midi));
        assert.equal(sample.velocity, theory.sampleVelocity(velocity));
    }
});

test('Q sequencer rest, accent, ratchet and tie retain full chord polyphony', () => {
    const state = theory.defaults();
    const chord = { root: 48, notes: [48, 52, 55], type: 'major', gate: 1, velocity: 80 };
    state.sequence[0] = theory.normalizeStep({ ...chord, ratchet: 2, accent: true });
    state.sequence[1] = theory.normalizeStep({ ...chord, rest: true });
    state.sequence[2] = theory.normalizeStep(chord);
    state.sequence[3] = theory.normalizeStep({ ...chord, tie: true });
    const events = theory.events(state, 16);
    assert.equal(events.length, 3);
    assert.deepEqual(events.map(event => event.start), [0, .5, 2]);
    assert.equal(events[0].velocity, 100);
    assert.equal(events[2].gate, 2);
    assert.ok(events.every(event => event.notes.length === 3));
});

test('section transpose changes only marked steps and refuses out-of-range changes atomically', () => {
    const instance = controller();
    for (let index = 0; index < 4; index += 1) instance.state.sequence[index] = theory.normalizeStep({ root: 48, notes: [48, 52, 55] });
    instance.range = [1, 2];
    instance.transpose(2);
    assert.deepEqual(instance.state.sequence.slice(0, 4).map(step => step.notes[0]), [48, 50, 50, 48]);
    instance.state.sequence[2].notes = [108];
    const before = theory.copy(instance.state);
    assert.throws(() => instance.transpose(1), /piano range/);
    assert.deepEqual(instance.state, before);
});

test('Copy overwrites a range; Copy Sec repeats that section through the destination tail like L/X', async () => {
    const instance = controller();
    instance.state.sequence[0] = theory.normalizeStep({ root: 48, notes: [48, 52, 55] });
    instance.state.sequence[1] = theory.normalizeStep({ root: 50, notes: [50, 53, 57] });
    await instance.action('copy');
    instance.stepClicked(0);
    instance.stepClicked(1);
    instance.paste(4);
    assert.deepEqual(instance.state.sequence[4], instance.state.sequence[0]);
    assert.equal(instance.state.sequence[6], null);
    await instance.action('copy-range');
    instance.stepClicked(0);
    instance.stepClicked(1);
    instance.paste(8);
    assert.deepEqual(instance.state.sequence[14], instance.state.sequence[0]);
    assert.deepEqual(instance.state.sequence[15], instance.state.sequence[1]);
    assert.notEqual(instance.state.sequence[15], instance.state.sequence[1]);
});

test('MIDI export includes simultaneous note-on/off events and saved tempo', () => {
    const state = theory.defaults();
    state.sequence[0] = theory.normalizeStep({ root: 60, notes: [60, 64, 67], gate: 4, velocity: 96 });
    const midi = theory.midiFile(state, 16, 120);
    assert.equal(Buffer.from(midi.subarray(0, 4)).toString(), 'MThd');
    assert.equal([...midi].filter(byte => byte === 144).length, 3);
    assert.equal([...midi].filter(byte => byte === 128).length, 3);
    assert.ok(Buffer.from(midi).includes(Buffer.from([255, 81, 3, 7, 161, 32])));
});

test('embedded sample validation rejects missing pitches, wrong layers and overlapping atlas segments', () => {
    const state = theory.defaults();
    state.sequence[0] = theory.normalizeStep({ root: 48, notes: [48, 52, 55], velocity: 96 });
    state.bank = { version: 1, sampleRate: 44100, samples: [{ id: 'C3v12', midi: 48, velocity: 95, offset: 0, frames: 100 }, { id: 'Ds3v12', midi: 51, velocity: 95, offset: 100, frames: 100 }, { id: 'Fs3v12', midi: 54, velocity: 95, offset: 200, frames: 100 }] };
    const asset = { channels: 2, frames: 300, sampleRate: 44100 };
    assert.doesNotThrow(() => theory.validateBank(state, asset));
    for (const mutate of [copy => { copy.bank.samples.pop(); }, copy => { copy.bank.samples[1].velocity = 64; }, copy => { copy.bank.samples[2].offset = 100; }, copy => { copy.bank.samples[0].id = 'C4v12'; }, copy => { copy.sequence.pop(); }, copy => { copy.sequence[0].notes = [200]; }]) {
        const altered = theory.copy(state);
        mutate(altered);
        assert.throws(() => theory.validateBank(altered, asset));
    }
    assert.throws(() => theory.validateBank(state));
    assert.throws(() => theory.validateBank(state, { ...asset, channels: 1 }));
});

test('portable banks do not silently borrow another sampled pitch or velocity from phone memory', () => {
    const piano = new Piano({});
    piano.atlas = { sampleRate: 48000 };
    piano.bank = { sampleRate: 44100, samples: [{ id: 'C3v12', midi: 48, velocity: 95, offset: 44100, frames: 44100 }] };
    piano.pinned = true;
    const sample = piano.segment(48, 96);
    assert.equal(sample.offset, 1);
    assert.equal(sample.duration, 1);
    assert.equal(piano.segment(50, 96), null);
    assert.equal(piano.segment(48, 32), null);
    assert.throws(() => piano.source(50, 96), /Saved Q audio/);
});

test('fresh state arms Q for shared transport without starting it or retaining stale buffers', () => {
    const instance = controller();
    instance.state.enabled = true;
    instance.piano.atlas = {};
    instance.restore();
    assert.equal(instance.state.enabled, true);
    assert.equal(instance.running, false);
    assert.equal(instance.piano.atlas, null);
});

test('Stop while piano samples are loading cancels a pending Q play request', async () => {
    const instance = controller();
    instance.state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55] });
    let finishLoading;
    let started = false;
    instance.preparePlayback = () => new Promise(resolve => { finishLoading = resolve; });
    instance.start = () => { started = true; };
    instance.host.stopAll = () => {};
    const pending = instance.action('play');
    instance.stop();
    finishLoading();
    await pending;
    assert.equal(started, false);
    assert.equal(instance.state.enabled, true);
});

test('Stop resets the tempo horizon so a fresh play does not skip its first chord', () => {
    const instance = controller();
    instance.lastStepSeconds = .125;
    instance.stop();
    assert.equal(instance.lastStepSeconds, 0);
});

test('capture includes velocity layers from tied steps so later section edits stay portable', async () => {
    const state = theory.defaults();
    state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55], gate: 4, velocity: 32 });
    state.sequence[1] = theory.normalizeStep({ notes: [48, 52, 55], tie: true, velocity: 96 });
    const context = { sampleRate: 1000, createBuffer: (channels, frames) => ({ getChannelData: () => new Float32Array(frames) }) };
    const piano = new Piano({ context: () => context });
    let requested;
    piano.ensure = async events => { requested = events; };
    piano.source = (midi, velocity) => ({ sample: { id: `${midi}-${velocity}`, midi, velocity }, duration: .01, offset: 0, buffer: { sampleRate: 1000, getChannelData: () => new Float32Array(10) } });
    await piano.capture(state);
    assert.deepEqual(requested.map(event => event.velocity), [32, 96]);
    assert.equal(piano.bank.samples.length, 6);
});

test('the final bus never idle-mutes Q-only playback or a chord audition', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const start = html.indexOf('function shouldIdleBypassFinalBusCompressor()');
    const end = html.indexOf('function pruneFinalSidechainKickEvents', start);
    let audible = false;
    const context = {
        window: { mygrainQ: { hasAudio: () => audible } }, sequencerPlaying: false, bastardLoopPlaying: false,
        drumMachinePlaying: false, activeKeyCount: 0, activeGrains: new Set(), sourceWaveformSoloKinds: new Set(), auditionSources: [],
        activeOscVoices: new Map(), keyboardSamplePlayer: null,
        drumMachineActiveVoices: new Set(), finalReverbEnabled: false, drumMachineDirectReverbSendEnabled: false,
        drumMachineReverbTailUntil: 0, audioContext: null,
        isArpeggiatorPlaying: () => false, isBastardLoopLRunning: () => false, isBastardLoopXRunning: () => false, isBastardLoopVCutPreviewRunning: () => false
    };
    vm.createContext(context);
    vm.runInContext(html.slice(start, end), context);
    assert.equal(context.shouldIdleBypassFinalBusCompressor(), true);
    audible = true;
    assert.equal(context.shouldIdleBypassFinalBusCompressor(), false);
});
