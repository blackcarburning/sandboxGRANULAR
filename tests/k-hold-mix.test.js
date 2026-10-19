const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(process.env.MYGRAIN_HOLD_SOURCE || path.join(__dirname, '../index.html'), 'utf8');

function extract(name) {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    let parentheses = 0;
    let body = -1;
    for (let index = html.indexOf('(', start); index < html.length; index += 1) {
        if (html[index] === '(') parentheses += 1;
        if (html[index] === ')') parentheses -= 1;
        if (html[index] === '{' && parentheses === 0) { body = index; break; }
    }
    let braces = 0;
    for (let index = body; index < html.length; index += 1) {
        if (html[index] === '{') braces += 1;
        if (html[index] === '}') braces -= 1;
        if (braces === 0) return html.slice(start, index + 1);
    }
    throw new Error(name);
}

function idleFixture() {
    const context = vm.createContext({
        sequencerPlaying: false, isArpeggiatorPlaying: () => false,
        bastardLoopPlaying: false, isBastardLoopLRunning: () => false,
        isBastardLoopXRunning: () => false, window: {},
        isBastardLoopVCutPreviewRunning: () => false, drumMachinePlaying: false,
        drumMachineActiveVoices: new Map(), finalReverbEnabled: false,
        activeKeyCount: 0, activeGrains: new Map(), activeOscVoices: new Map(),
        keyboardSamplePlayer: { activeVoices: new Set() }, sourceWaveformSoloKinds: new Set(),
        auditionSources: [], heldNotes: new Set(['C4']), holdEnabled: true, arpEnabled: false
    });
    vm.runInContext(extract('shouldIdleBypassFinalBusCompressor'), context);
    return context;
}

test('latched oscillator and sampled voices keep the final bus awake after physical key release', () => {
    const context = idleFixture();
    assert.equal(context.shouldIdleBypassFinalBusCompressor(), true);
    context.activeOscVoices.set('keyboard:C4', { role: 'keyboard' });
    assert.equal(context.shouldIdleBypassFinalBusCompressor(), false);
    context.activeOscVoices.clear();
    for (const instrument of ['piano', 'strings']) {
        context.keyboardSamplePlayer.activeVoices.add({ instrument });
        assert.equal(context.shouldIdleBypassFinalBusCompressor(), false);
        context.keyboardSamplePlayer.activeVoices.clear();
        assert.equal(context.shouldIdleBypassFinalBusCompressor(), true);
    }
});

test('an unplayed arp Hold chord cannot keep the bus awake merely by retaining heldNotes', () => {
    const context = idleFixture();
    context.arpEnabled = true;
    assert.equal(context.heldNotes.size, 1);
    assert.equal(context.shouldIdleBypassFinalBusCompressor(), true);
    context.keyboardSamplePlayer = null;
    assert.equal(context.shouldIdleBypassFinalBusCompressor(), true);
});

function oscillatorFixture({ hold, arp, sustain }) {
    const parameter = () => ({
        value: 0, calls: [],
        setValueAtTime(value, time) { this.calls.push(['set', value, time]); },
        linearRampToValueAtTime(value, time) { this.calls.push(['ramp', value, time]); }
    });
    const node = extra => ({ connections: [], connect(destination) { this.connections.push(destination); }, ...extra });
    const config = () => ({ level: 1, attack: 10, decay: 50, sustain });
    const context = vm.createContext({
        keyboardSoundSource: 'osc', holdEnabled: hold, arpEnabled: arp,
        isKeyboardSoundRole: role => role === 'keyboard' || role === 'arp',
        audioContext: {
            currentTime: 1,
            createGain: () => node({ gain: parameter() }),
            createOscillator: () => node({ start() {}, frequency: {} }),
            createBufferSource: () => node({ start() {} })
        },
        ensureSynthVoicePathAudible() {}, oscillatorsEnabled: true, oscOutputGain: {},
        isOscillatorVoiceAudibleUnderSolo: () => true,
        activeOscVoices: new Map(), makePerformanceStreamId: (role, note) => `${role}:${note}`,
        getKeyboardNoteFrequency: () => 440, resolveOscRouteModeForVoice: () => 'blend',
        getClickGuardSeconds: () => .005, getSynthModulatedValue: (id, value) => value,
        getOscillatorVoiceFrequencies: () => ({ osc1Frequency: 440, osc2Frequency: 440, osc3Frequency: 440 }),
        synthStereoWidth: 0, synthFmAmount: 0,
        osc1Config: config(), osc2Config: config(), osc3Config: config(), oscNoiseConfig: config(),
        configureOscillatorWaveAndPitch() {}, whiteNoiseBuffer: {}, pinkNoiseBuffer: {},
        oscSynthDriveGain: null, oscSynthFilter: null, keyboardGrainCaptureGain: {}
    });
    vm.runInContext(extract('playOscillatorNote'), context);
    return context;
}

for (const settings of [
    { hold: true, arp: false, role: 'keyboard', sustain: 0, expected: 1 },
    { hold: false, arp: false, role: 'keyboard', sustain: 0, expected: 0 },
    { hold: true, arp: true, role: 'arp', sustain: 0, expected: 0 },
    { hold: true, arp: false, role: 'loopL', sustain: 0, expected: 0 },
    { hold: true, arp: false, role: 'keyboard', sustain: .35, expected: .35 }
]) {
    test(`zero-sustain fallback is limited to direct Hold, without editing envelopes: ${JSON.stringify(settings)}`, () => {
        const context = oscillatorFixture(settings);
        const outputs = new Map();
        context.playOscillatorNote('A4', null, .8, { role: settings.role, voiceOutputs: outputs });
        const voice = context.activeOscVoices.get(`${settings.role}:A4`);
        for (const [gain, multiplier] of [[voice.osc1Gain, 1], [voice.osc2Gain, .92], [voice.osc3Gain, .74], [voice.noiseGain, 1]]) {
            assert.equal(gain.gain.calls.at(-1)[1], settings.expected * .8 * multiplier);
        }
        assert.equal(context.osc1Config.sustain, settings.sustain);
        assert.equal(context.oscNoiseConfig.sustain, settings.sustain);
    });
}

test('keyboard sample mixer defaults, zero, clamping and labels stay independent of Q', () => {
    const controls = new Map();
    let refreshes = 0;
    const context = vm.createContext({
        document: { getElementById: id => controls.get(id) },
        keyboardSamplePlayer: { refreshVolumes: () => { refreshes += 1; } }
    });
    vm.runInContext(`${extract('getKeyboardSampleVolume')}\n${extract('syncKeyboardSampleMixControls')}`, context);
    assert.equal(context.getKeyboardSampleVolume('piano'), 1);
    assert.equal(context.getKeyboardSampleVolume('strings'), 1);
    controls.set('performanceKeyboardPianoVolume', { value: '0' });
    controls.set('performanceKeyboardStringsVolume', { value: '38' });
    controls.set('performanceKeyboardPianoVolumeValue', {});
    controls.set('performanceKeyboardStringsVolumeValue', {});
    context.syncKeyboardSampleMixControls();
    assert.equal(context.getKeyboardSampleVolume('piano'), 0);
    assert.equal(context.getKeyboardSampleVolume('strings'), .38);
    assert.equal(controls.get('performanceKeyboardPianoVolumeValue').textContent, '0%');
    assert.equal(controls.get('performanceKeyboardStringsVolumeValue').textContent, '38%');
    assert.equal(refreshes, 1);
    for (const [value, expected] of [['-5', 0], ['120', 1], ['invalid', 1]]) {
        controls.get('performanceKeyboardPianoVolume').value = value;
        assert.equal(context.getKeyboardSampleVolume('piano'), expected);
    }
});

test('sample mixer sliders join existing mixer jumps, persistence and randomization protection', () => {
    const mixer = html.slice(html.indexOf('id="performanceMixerCard"'), html.indexOf('id="performanceMixerCard"') + 22000);
    const skip = html.slice(html.indexOf('const RANDOMIZE_SKIP_SLIDERS'), html.indexOf(']);', html.indexOf('const RANDOMIZE_SKIP_SLIDERS')));
    for (const [id, label] of [['performanceKeyboardPianoVolume', 'Piano Volume'], ['performanceKeyboardStringsVolume', 'Strings Volume']]) {
        assert.match(mixer, new RegExp(`<label for="${id}">\\s*<span>${label}</span>`));
        assert.match(mixer, new RegExp(`<input type="range" id="${id}" min="0" max="100" value="100"`));
        assert.ok(skip.includes(`'${id}'`));
        assert.match(html, new RegExp(`${id}: 100`));
    }
    assert.match(extract('ensurePerformanceMixerJumpButtonsMounted'), /querySelectorAll\('input\[type="range"\]'\)/);
    assert.match(extract('saveState'), /state.sliders\[slider.id\] = slider.value/);
    assert.match(extract('restoreState'), /slider.value = normalizedStateSliders\[id\]/);
    assert.match(extract('restoreState'), /slider.dispatchEvent\(new Event\('input'\)\)/);
});
