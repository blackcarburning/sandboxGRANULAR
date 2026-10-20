const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function source(name) {
    const start = html.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, name);
    const body = html.indexOf(') {', start) + 2;
    let depth = 0;
    for (let i = body; i < html.length; i++) {
        if (html[i] === '{') depth++;
        if (html[i] === '}') depth--;
        if (!depth) return html.slice(start, i + 1);
    }
    throw new Error(`Missing body: ${name}`);
}
function fixture(overrides = {}) {
    const played = [], stopped = [], ramps = [], anchors = [];
    const context = {
        audioContext: { currentTime: 10 }, activeOscVoices: new Map(),
        noteSemitoneOffsets: { C:0, 'C#':1, D:2, 'D#':3, E:4, F:5, 'F#':6, G:7, 'G#':8, A:9, 'A#':10, B:11 },
        bastardLoopXSourceMode: 'sample', bastardLoopXSampleBuffer: null,
        ensureBastardLoopLSynthReady: () => true,
        hasRestorableBastardLoopXSampleReference: () => false,
        hasPlayableBastardLoopXSequence: () => true,
        getBastardLoopXPitchSemitones: () => 12,
        getBastardLoopXLevelValue: () => .4,
        getBastardLoopXAccentAmount: () => .35,
        getBastardLoopXStepLengthRatio: () => .9,
        getBastardLoopXDecayRatio: () => .75,
        playOscillatorNote: (note, start, velocity, options) => {
            played.push({ note, start, velocity, ...options });
            const osc = () => ({ frequency: { value: 55, setValueAtTime: (frequency, time) => anchors.push({ frequency, time }), linearRampToValueAtTime: (frequency, time) => ramps.push({ frequency, time }) } });
            context.activeOscVoices.set(options.voiceId, { osc1: osc(), osc2: osc(), osc3: osc(), synthModContext: {} });
        },
        stopOscillatorNote: (note, time, options) => stopped.push({ note, time, ...options }),
        getOscillatorVoiceFrequencies: () => ({ osc1Frequency: 110, osc2Frequency: 220, osc3Frequency: 440 }),
        ...overrides
    };
    vm.createContext(context);
    for (const name of ['normalizeBastardLoopLSourceMode', 'normalizeBastardLoopXSourceMode', 'isBastardLoopXUsingSynth',
        'hasBastardLoopXPlaybackSource', 'hasPlayableBastardLoopXTransportSource', 'parseNoteName', 'noteNameToMidi', 'midiToNoteName',
        'computeBastardLoopLAccentGainMultiplier', 'playBastardLoopXSynthVoice', 'getOscillatorVoiceSoloTarget']) vm.runInContext(source(name), context);
    return { context, played, stopped, ramps, anchors };
}

test('OSC3 is a playable X source without a sample; old/unknown source values remain Sample', () => {
    const { context: c } = fixture();
    assert.equal(c.hasPlayableBastardLoopXTransportSource(), false);
    c.bastardLoopXSourceMode = 'synth';
    assert.equal(c.hasPlayableBastardLoopXTransportSource(), true);
    c.hasPlayableBastardLoopXSequence = () => false;
    assert.equal(c.hasPlayableBastardLoopXTransportSource(), false);
    for (const mode of [undefined, null, '', 'osc3', 'other']) assert.equal(c.normalizeBastardLoopXSourceMode(mode), 'sample');
});

test('X synth uses transposed notes, X gain and accent, its own role and a bounded scheduled release', () => {
    const { context: c, played, stopped } = fixture();
    assert.equal(c.playBastardLoopXSynthVoice({ note: 'C2', accent: true }, 11, .125, null), true);
    assert.equal(played[0].note, 'C3');
    assert.equal(played[0].start, 11);
    assert.equal(played[0].role, 'bastardloopx');
    assert(played[0].velocity > .4 && played[0].velocity <= 1);
    assert.equal(stopped[0].voiceId, played[0].voiceId);
    assert(stopped[0].time > 11 && stopped[0].time <= 11.125);
});

test('muted, rest, empty and unavailable-engine X synth notes never create a voice', () => {
    for (const [overrides, step] of [[{ getBastardLoopXLevelValue: () => 0 }, { note: 'C2' }], [{}, { note: 'C2', rest: true }], [{}, {}], [{ ensureBastardLoopLSynthReady: () => false }, { note: 'C2' }]]) {
        const { context: c, played } = fixture(overrides);
        assert.equal(c.playBastardLoopXSynthVoice(step, 11, .125, null), false);
        assert.equal(played.length, 0);
    }
});

test('slides ramp all three oscillators and sustain through the carried step; ratchet slices do not glide', () => {
    const { context: c, stopped, ramps, anchors } = fixture();
    c.playBastardLoopXSynthVoice({ note: 'C2', slide: true }, 11, .125, { note: 'D2' });
    assert.deepEqual(ramps, [{ frequency: 110, time: 11.125 }, { frequency: 220, time: 11.125 }, { frequency: 440, time: 11.125 }]);
    assert(stopped[0].time > 11.24);
    assert.deepEqual(anchors, Array.from({ length: 3 }, () => ({ frequency: 55, time: 11 })));
    ramps.length = 0;
    c.playBastardLoopXSynthVoice({ note: 'C2', slide: true }, 12, .125, { note: 'D2' }, { stepWindow: .03 });
    assert.equal(ramps.length, 0);
    assert(stopped[1].time >= 12.025 && stopped[1].time <= 12.03);
});

test('preview and sequenced X oscillator voices follow X solo rather than keyboard or L', () => {
    const { context: c } = fixture();
    for (const role of ['bastardloopx', 'bastardloopx-preview']) {
        const target = c.getOscillatorVoiceSoloTarget(role);
        assert.equal(target.group, 'loop'); assert.equal(target.key, 'bastardx');
    }
    assert.equal(c.getOscillatorVoiceSoloTarget('bastardloopl').key, 'bastardl');
    assert.equal(c.getOscillatorVoiceSoloTarget('keyboard').key, 'osc');
});


test('slides preserve hard-sync master frequencies rather than retuning synced oscillators to their own pitches', () => {
    const { context: c, ramps } = fixture({ getOscillatorVoiceFrequencies: () => ({ osc1Frequency: 110, osc2Frequency: 220, osc3Frequency: 440, osc2MasterFrequency: 110, osc3MasterFrequency: 220 }) });
    c.playBastardLoopXSynthVoice({ note: 'C2', slide: true }, 11, .125, { note: 'D2' });
    assert.deepEqual(ramps.map(ramp => ramp.frequency), [110, 110, 220]);
});
