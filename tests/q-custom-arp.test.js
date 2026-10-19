const test = require('node:test');
const assert = require('node:assert/strict');
const theory = require('../q-theory.js');
const { Controller } = require('../q-card.js');

function controller() {
    const instance = new Controller({ length: () => 16, bpm: () => 120, save: () => {}, context: () => ({ currentTime: 0 }) });
    instance.status = () => {};
    return instance;
}

test('Accent toggles on an empty cell without adding notes, advancing the cursor or triggering an audition', async () => {
    const instance = controller();
    let auditions = 0;
    instance.audition = async () => { auditions += 1; };
    instance.cursor = 3;
    await instance.action('accent');
    assert.deepEqual(instance.state.sequence[3], { kind: 'accent', notes: [], accent: true });
    assert.equal(instance.cursor, 3);
    assert.equal(instance.hasSequence(), false);
    instance.stepClicked(3);
    assert.equal(auditions, 0);
    assert.equal(instance.state.selection, null);
    await instance.action('accent');
    assert.equal(instance.state.sequence[3], null);
});

test('Accent-only cells normalize and travel with copies without interrupting a hanging arp', () => {
    const state = theory.defaults();
    Object.assign(state, { arpEnabled: true, arpRepeat: 'until-next', accentAmount: .5 });
    state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55], velocity: 127 });
    state.sequence[1] = theory.normalizeStep({ kind: 'accent', notes: [], accent: true });
    state.sequence[3] = theory.normalizeStep({ notes: [48], rest: true });
    const restored = theory.normalizeState(JSON.parse(JSON.stringify(state)));
    assert.deepEqual(restored.sequence[1], state.sequence[1]);
    assert.equal(theory.events(restored, 16).length, 1);
    assert.deepEqual(theory.playbackEvents(restored, 16).map(event => event.start), [0, 1, 2]);
    assert.equal(theory.accentGain(restored, 1.5, 16), 2);
    assert.equal(theory.accentGain(restored, 17, 16), 2);
    assert.equal(theory.accentGain(restored, 2, 16), 1);
});

test('An accent on a later empty cell updates arp MIDI velocity without changing required sample layers', () => {
    const state = { ...theory.defaults(), arpEnabled: true, accentAmount: .5 };
    state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55], velocity: 80 });
    state.sequence[1] = theory.normalizeStep({ kind: 'accent', notes: [], accent: true });
    const events = theory.playbackEvents(state, 16);
    assert.deepEqual(events.map(event => event.velocity), [80, 120, 80]);
    assert.deepEqual(events.map(event => event.sampleVelocity), [80, 80, 80]);
});

test('Custom note-order grid ranks wrap to the chord size and gap pulses are not collapsed', () => {
    const state = { ...theory.defaults(), arpEnabled: true, arpPattern: 'custom', arpSteps: [3, 0, 1, 8, 0, 2] };
    state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55] });
    assert.deepEqual(theory.arpOrder([55, 48, 52], 'custom', state.arpSteps), [55, null, 48, 52, null, 52]);
    const events = theory.playbackEvents(state, 16);
    assert.deepEqual(events.map(event => event.start), [0, 2, 3, 5]);
    assert.deepEqual(events.map(event => event.notes[0]), [55, 48, 52, 52]);
    state.arpRepeat = 'until-next';
    state.sequence[8] = theory.normalizeStep({ notes: [53, 57, 60] });
    assert.deepEqual(theory.playbackEvents(state, 16).filter(event => event.index === 0).map(event => event.start), [0, 2, 3, 5, 6]);
});

test('Gap-only patterns, triplet divisions and explicit rests remain safe and portable', () => {
    const state = { ...theory.defaults(), arpEnabled: true, arpPattern: 'custom', arpSteps: [0, 0], arpRepeat: 'until-next', arpDivision: 1 / 6 };
    state.sequence[0] = theory.normalizeStep({ notes: [48, 52, 55] });
    assert.deepEqual(theory.playbackEvents(state, 16), []);
    state.arpSteps = [1, 0, 3];
    state.sequence[2] = theory.normalizeStep({ notes: [48], rest: true });
    const events = theory.playbackEvents(state, 16);
    assert.deepEqual(events.map(event => event.notes[0]), [48, 55]);
    assert.ok(events.every(event => event.start < 2));
    assert.deepEqual(theory.normalizeState(JSON.parse(JSON.stringify(state))).arpSteps, state.arpSteps);
});

test('Malformed saved custom patterns are rejected instead of silently becoming an Up arp', () => {
    for (const arpSteps of [[], Array(33).fill(1), [9], [-1], [true], [1.5], '1,2,3']) {
        const state = { ...theory.defaults(), arpPattern: 'custom', arpSteps };
        assert.throws(() => theory.validateBank(state), /arpeggiator/);
    }
    assert.doesNotThrow(() => theory.validateBank({ ...theory.defaults(), sequence: [theory.normalizeStep({ kind: 'accent', notes: [], accent: true }), ...Array(63).fill(null)] }));
});

test('Gain automation boosts already-sustaining voices at cell boundaries and is not limited by velocity 127', () => {
    const instance = controller();
    instance.origin = 0;
    instance.state.accentAmount = .5;
    instance.state.sequence[1] = theory.normalizeStep({ kind: 'accent', notes: [], accent: true });
    const calls = [];
    const voice = { start: 0, end: .8, peak: .32, release: .16, stepSeconds: .125, grid: true,
        gain: { gain: { cancelScheduledValues: time => calls.push(['cancel', time]), setValueAtTime: (value, time) => calls.push(['set', value, time]), linearRampToValueAtTime: (value, time) => calls.push(['ramp', value, time]) } } };
    instance.applyVoiceEnvelope(voice, instance.state);
    assert.ok(calls.some(([kind, value, time]) => kind === 'ramp' && value === .64 && time === .125));
    assert.ok(calls.some(([kind, value, time]) => kind === 'ramp' && value === .32 && time === .25));
    assert.deepEqual(calls.at(-1), ['ramp', 0, .8]);
    calls.length = 0;
    instance.state.sequence[1] = null;
    instance.applyVoiceEnvelope(voice, instance.state, .13);
    assert.deepEqual(calls[1], ['set', .32, .13]);
});

test('Inserting or live-recording a chord keeps the previously set cell accent', () => {
    const instance = controller();
    instance.state.sequence[0] = theory.normalizeStep({ kind: 'accent', notes: [], accent: true });
    instance.insert({ notes: [48, 52, 55] });
    assert.equal(instance.state.sequence[0].accent, true);
    instance.state.record = true;
    instance.state.recordMode = 'live';
    instance.running = true;
    instance.origin = 0;
    instance.changed = () => {};
    instance.recordChord({ notes: [53, 57, 60] });
    assert.equal(instance.state.sequence[0].accent, true);
});

test('Accented chord auditions and amount edits use the same uncapped gain boost', () => {
    const instance = controller();
    instance.state.accentAmount = .5;
    instance.preview = { chord: { notes: [48], accent: true } };
    const ramps = [];
    const voice = { start: 0, end: .8, peak: .32, release: .16, grid: false, preview: true,
        gain: { gain: { cancelScheduledValues: () => {}, setValueAtTime: () => {}, linearRampToValueAtTime: (value, time) => ramps.push([value, time]) } } };
    instance.voices.add(voice);
    instance.changed({ preserveSamples: true, reschedule: false });
    assert.equal(voice.accentBoost, 2);
    assert.ok(ramps.some(([value]) => value === .64));
    instance.state.accentAmount = 0;
    instance.changed({ preserveSamples: true, reschedule: false });
    assert.equal(voice.accentBoost, 1);
});
