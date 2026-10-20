const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const theory = require('../q-theory.js');
const { createKeyboardPlayer } = require('../q-card.js');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const manifests = Object.fromEntries(['piano', 'strings'].map(instrument => [instrument,
    JSON.parse(fs.readFileSync(path.join(__dirname, '..', theory.instruments[instrument].repository, 'manifest.json'), 'utf8'))]));

function extract(name, source = html) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const body = source.indexOf(') {', start) + 2;
    let depth = 0;
    for (let index = body; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unclosed ${name}`);
}

function fixture() {
    const calls = [];
    const controls = new Map();
    for (const [instrument, value] of [['piano', '63'], ['strings', '38']]) {
        const controlId = `performanceKeyboard${instrument === 'piano' ? 'Piano' : 'Strings'}Volume`;
        const card = {
            mounted: false,
            querySelector() { return this.mounted ? {} : null; },
            insertAdjacentHTML(position, markup) {
                this.mounted = true;
                const id = /id="([^"]+SoloBtn)"/.exec(markup)[1];
                const attributes = { 'aria-pressed': 'false' };
                const classes = new Set();
                const events = {};
                controls.set(id, {
                    attributes, classes,
                    classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } },
                    setAttribute(name, next) { attributes[name] = next; },
                    addEventListener(name, handler) { events[name] = handler; },
                    click() { events.click(); }
                });
            }
        };
        controls.set(controlId, { value, closest: () => card });
        controls.set(`${controlId}Value`, { textContent: '' });
    }
    const node = extra => ({
        connections: [],
        connect(destination) { this.connections.push(destination); return destination; },
        disconnect() { this.connections = []; },
        ...extra
    });
    const audioContext = {
        currentTime: 1, sampleRate: 48000,
        createGain() {
            return node({ gain: {
                value: 1, calls: [],
                cancelScheduledValues(time) { this.calls.push(['cancel', time]); },
                setValueAtTime(value, time) { this.value = value; this.calls.push(['set', value, time]); },
                linearRampToValueAtTime(value, time) { this.value = value; this.calls.push(['ramp', value, time]); }
            } });
        },
        createBufferSource() {
            return node({ playbackRate: {}, starts: [], stops: [],
                start(...args) { this.starts.push(args); }, stop(time) { this.stops.push(time); }
            });
        }
    };
    const refreshNames = ['updateSourceMixGains', 'updateGeneratedDryLoopMix', 'updateBastardLoopMix',
        'updateBastardLoop2Mix', 'updateBastardLoop3Mix', 'updateBastardLoopVMix', 'updateBastardLoopPMix',
        'updateBastardLoopOMix', 'updateBastardLoopLMix', 'updateBastardLoopXMix', 'updateBastardLoopMMix',
        'updateBastardLoopMPlusMix', 'updateBastardLoopKMix', 'updateDropboxSampleLayerMix', 'updateDrumMachineMix',
        'syncActiveOscillatorSoloIsolation', 'restoreSoloKeyboardVoices', 'rescheduleActiveGrainsFromNow'];
    const context = vm.createContext({
        performanceSourceLayerSolo: [], grainLayerSolo: [], loopLayerSolo: [], performanceSourceLayerSoloSnapshot: null,
        oscillatorsEnabled: false, granularLayersEnabled: true, generatedSampleLayerEnabled: false, generatedDryLoopEnabled: true,
        generatedSampleSolo: false, sourceWaveformSoloKinds: new Set(),
        keyboardSoundSource: 'piano', keyboardSoundPreparation: null, keyboardSoundReadiness: 'ready',
        holdEnabled: true, arpEnabled: true, keyboardArpTransportPlaying: true, keyboardInteractionEpoch: 7,
        heldNotes: new Set(['C4', 'E4']), activeGrains: new Map(),
        keyboardSamplePlayer: null, keyboardSamplePlayerContext: null,
        keyboardSampleOutputBuses: new Map(),
        audioContext, preFilterGainNode: node(), keyboardGrainCaptureGain: node(),
        document: { getElementById: id => controls.get(id) || null },
        setStatus: (...args) => calls.push(['status', ...args]), saveState: () => calls.push(['save']),
        syncPerformanceSourceLayerSoloButtons() {}, syncGrainLayerSoloButtons() {}, syncLoopLayerSoloButtons() {},
        ...Object.fromEntries(refreshNames.map(name => [name, () => calls.push([name])]))
    });
    context.window = {
        MygrainQ: { createKeyboardPlayer },
        mygrainQ: { state: { enabled: true, instrument: 'strings', sequence: [{ notes: [60, 64] }] },
            updateEffects() { calls.push(['Q', context.getLoopLayerSoloGain('bastardq')]); }
        }
    };
    context.setOscillatorsEnabled = value => { context.oscillatorsEnabled = value; };
    context.setGranularLayersEnabled = value => { context.granularLayersEnabled = value; };
    context.setGeneratedSampleLayerEnabled = value => { context.generatedSampleLayerEnabled = value; };
    context.setGeneratedDryLoopEnabled = value => { context.generatedDryLoopEnabled = value; };
    context.syncPerformanceControlState = () => context.syncPerformanceMixerSoloButtons();
    const names = ['normalizePerformanceSourceLayerSolo', 'normalizeGrainLayerSolo', 'normalizeLoopLayerSolo',
        'hasPerformanceSourceLayerSolo', 'hasGrainLayerSolo', 'hasLoopLayerSolo', 'hasAnyPerformanceLayerSoloSelection',
        'capturePerformanceSourceLayerSoloState', 'restorePerformanceSourceLayerSoloState', 'updatePerformanceSoloMixGains',
        'syncPerformanceLayerSoloIsolation', 'restorePerformanceSourceLayerSolo', 'setPerformanceSourceLayerSolo',
        'setGrainLayerSolo', 'setLoopLayerSolo', 'getLoopLayerSoloGain', 'getGrainLayerSoloGain',
        'getKeyboardSampleVolume', 'getKeyboardSampleSoloGain', 'syncKeyboardSampleMixControls', 'getKeyboardSampleOutputNode', 'getKeyboardSamplePlayer',
        'getPerformanceMixerSoloButtonId', 'ensurePerformanceMixerSoloButtonsMounted', 'syncPerformanceMixerSoloButtons',
        'clearAllPerformanceSoloStates'];
    names.forEach(name => vm.runInContext(extract(name), context));
    vm.runInContext(html.match(/const PERFORMANCE_MIXER_SOLO_BUTTONS = \[[\s\S]*?\n        \];/)[0], context);
    context.ensurePerformanceMixerSoloButtonsMounted();
    const player = context.getKeyboardSamplePlayer();
    for (const [instrument, entry] of player.samplers) {
        const samples = manifests[instrument].samples.map(sample => ({ ...sample, offset: 44100, frames: 441000 }));
        entry.piano.restored({ sampleRate: 48000, length: 528000, numberOfChannels: 2 },
            { version: 1, instrument: theory.instruments[instrument].id, sampleRate: 44100, samples });
    }
    return { context, controls, player, calls };
}

test('keyboard solo keys normalize and mount once with the central source handlers and accessible state', () => {
    const { context, controls } = fixture();
    assert.deepEqual(Array.from(context.normalizePerformanceSourceLayerSolo(' PIANO,strings,piano,osc,invalid ')), ['piano', 'strings', 'osc']);
    const piano = controls.get('performanceKeyboardPianoVolumeSoloBtn');
    const strings = controls.get('performanceKeyboardStringsVolumeSoloBtn');
    context.ensurePerformanceMixerSoloButtonsMounted();
    assert.equal(controls.get('performanceKeyboardPianoVolumeSoloBtn'), piano);
    assert.equal(piano.attributes['aria-label'], 'Solo Piano');
    assert.equal(strings.attributes['aria-label'], 'Solo Strings');
    piano.click();
    assert.deepEqual(Array.from(context.performanceSourceLayerSolo), ['piano']);
    assert.equal(piano.attributes['aria-pressed'], 'true');
    assert.equal(piano.classes.has('active'), true);
    assert.equal(strings.attributes['aria-pressed'], 'false');
    strings.click();
    assert.deepEqual(Array.from(context.performanceSourceLayerSolo), ['piano', 'strings']);
    assert.equal(strings.attributes['aria-pressed'], 'true');
    piano.click();
    strings.click();
    assert.equal(piano.attributes['aria-pressed'], 'false');
    assert.equal(strings.attributes['aria-pressed'], 'false');
    assert.equal(piano.classes.has('active'), false);
});

for (const instrument of ['piano', 'strings']) {
    test(`${instrument} solo excludes all backing buses without changing the selected keyboard source or levels`, () => {
        const { context, controls, calls } = fixture();
        const baseline = { ...context.capturePerformanceSourceLayerSoloState() };
        const qState = JSON.stringify(context.window.mygrainQ.state);
        context.keyboardSoundSource = instrument === 'piano' ? 'strings' : 'grain';
        const selected = context.keyboardSoundSource;
        context.setPerformanceSourceLayerSolo(instrument);
        assert.equal(context.getKeyboardSampleSoloGain(instrument), 1);
        assert.equal(context.getKeyboardSampleSoloGain(instrument === 'piano' ? 'strings' : 'piano'), 0);
        for (const key of ['bastarda', 'bastardb', 'bastardc', 'bastardv', 'bastardp', 'bastardo', 'bastardl',
            'bastardx', 'bastardq', 'bastardm', 'bastardmplus', 'bastardk', 'dropbox', 'drums']) {
            assert.equal(context.getLoopLayerSoloGain(key), 0, key);
        }
        for (const key of ['A', 'B']) assert.equal(context.getGrainLayerSoloGain(key), 0);
        assert.equal(context.oscillatorsEnabled, false);
        assert.equal(context.generatedDryLoopEnabled, false);
        assert.equal(context.granularLayersEnabled, false);
        assert.equal(context.keyboardSoundSource, selected);
        assert.equal(JSON.stringify(context.window.mygrainQ.state), qState);
        assert.equal(calls.filter(call => call[0] === 'Q').at(-1)[1], 0);
        assert.ok(calls.some(call => call[0] === 'status' && call[1].includes(instrument === 'piano' ? 'Piano' : 'Strings')));
        context.setPerformanceSourceLayerSolo(instrument);
        assert.deepEqual({ ...context.capturePerformanceSourceLayerSoloState() }, baseline);
        assert.equal(context.performanceSourceLayerSoloSnapshot, null);
        assert.equal(context.getKeyboardSampleVolume('piano'), .63);
        assert.equal(context.getKeyboardSampleVolume('strings'), .38);
        assert.equal(controls.get('performanceKeyboardPianoVolume').value, '63');
        assert.equal(controls.get('performanceKeyboardStringsVolume').value, '38');
    });
}

test('every existing source, grain and loop solo excludes samples unless the keyboard channel also joins', () => {
    const { context } = fixture();
    for (const [setter, key] of [['setPerformanceSourceLayerSolo', 'osc'], ['setPerformanceSourceLayerSolo', 'granular'],
        ['setPerformanceSourceLayerSolo', 'sample'], ['setPerformanceSourceLayerSolo', 'loop'],
        ['setGrainLayerSolo', 'A'], ['setLoopLayerSolo', 'drums'], ['setLoopLayerSolo', 'bastardq']]) {
        context[setter](key, { silent: true });
        assert.equal(context.getKeyboardSampleSoloGain('piano'), 0, key);
        assert.equal(context.getKeyboardSampleSoloGain('strings'), 0, key);
        context.setPerformanceSourceLayerSolo('piano', { silent: true });
        assert.equal(context.getKeyboardSampleSoloGain('piano'), 1, key);
        assert.equal(context.getKeyboardSampleSoloGain('strings'), 0, key);
        context.setPerformanceSourceLayerSolo('strings', { silent: true });
        assert.equal(context.getKeyboardSampleSoloGain('strings'), 1, key);
        context.clearAllPerformanceSoloStates({ silent: true, skipSave: true });
        assert.equal(context.hasAnyPerformanceLayerSoloSelection(), false);
        assert.equal(context.getKeyboardSampleSoloGain('piano'), 1);
        assert.equal(context.getKeyboardSampleSoloGain('strings'), 1);
    }
});

test('Clear solos restores the original mix even while source, grain and loop selections overlap', () => {
    const { context, controls } = fixture();
    const baseline = { ...context.capturePerformanceSourceLayerSoloState() };
    context.setPerformanceSourceLayerSolo('piano', { silent: true });
    context.setLoopLayerSolo('drums', { silent: true });
    context.setGrainLayerSolo('B', { silent: true });
    assert.equal(context.getLoopLayerSoloGain('drums'), 1);
    assert.equal(context.getLoopLayerSoloGain('bastardq'), 0);
    assert.equal(context.getGrainLayerSoloGain('B'), 1);
    assert.equal(context.getGrainLayerSoloGain('A'), 0);
    assert.equal(context.clearAllPerformanceSoloStates({ silent: true, skipSave: true }), true);
    assert.deepEqual({ ...context.capturePerformanceSourceLayerSoloState() }, baseline);
    assert.equal(context.performanceSourceLayerSoloSnapshot, null);
    assert.equal(controls.get('performanceKeyboardPianoVolumeSoloBtn').attributes['aria-pressed'], 'false');
    assert.equal(context.getKeyboardSampleVolume('piano'), .63);
    assert.equal(context.getKeyboardSampleVolume('strings'), .38);
});

test('sounding held samples retain envelopes and transport while their shared audible/capture gains refresh', async () => {
    const { context, player } = fixture();
    const voices = await Promise.all(['piano', 'strings'].map(instrument => player.noteOn(`keyboard:${instrument}`, 60, { instrument })));
    const envelopes = voices.map(voice => JSON.stringify(voice.gain.gain.calls));
    const heldNotes = context.heldNotes;
    const qState = JSON.stringify(context.window.mygrainQ.state);
    context.setPerformanceSourceLayerSolo('piano', { silent: true });
    assert.deepEqual(voices.map(voice => voice.mixGain.gain.value), [.63, 0]);
    context.setPerformanceSourceLayerSolo('strings', { silent: true });
    assert.deepEqual(voices.map(voice => voice.mixGain.gain.value), [.63, .38]);
    context.setPerformanceSourceLayerSolo('piano', { silent: true });
    assert.deepEqual(voices.map(voice => voice.mixGain.gain.value), [0, .38]);
    context.clearAllPerformanceSoloStates({ silent: true, skipSave: true });
    assert.deepEqual(voices.map(voice => voice.mixGain.gain.value), [.63, .38]);
    for (const [index, voice] of voices.entries()) {
        assert.deepEqual(voice.gain.connections, [voice.mixGain]);
        const output = context.keyboardSampleOutputBuses.get(voice.instrument).node;
        assert.deepEqual(voice.mixGain.connections, [output, context.keyboardGrainCaptureGain]);
        assert.deepEqual(output.connections, [context.preFilterGainNode]);
        assert.equal(JSON.stringify(voice.gain.gain.calls), envelopes[index]);
        assert.equal(voice.source.stops.length, Number.isFinite(voice.end) ? 1 : 0);
        assert.equal(player.activeVoices.has(voice), true);
        assert.ok(voice.mixGain.gain.calls.some(call => call[0] === 'ramp' && call[2] === 1.015));
    }
    assert.equal(context.heldNotes, heldNotes);
    assert.deepEqual(Array.from(context.heldNotes), ['C4', 'E4']);
    assert.equal(context.holdEnabled, true);
    assert.equal(context.arpEnabled, true);
    assert.equal(context.keyboardArpTransportPlaying, true);
    assert.equal(context.keyboardInteractionEpoch, 7);
    assert.equal(context.keyboardSoundSource, 'piano');
    assert.equal(JSON.stringify(context.window.mygrainQ.state), qState);
});

test('new direct, scheduled arp and releasing notes use current solo gates without changing their envelopes', async () => {
    const { context, player, controls } = fixture();
    context.setPerformanceSourceLayerSolo('osc', { silent: true });
    const direct = await player.noteOn('keyboard:C4', 60, { instrument: 'piano' });
    const arp = await player.noteOn('arp:E4', 64, { instrument: 'strings', startTime: 3, duration: .125 });
    assert.equal(direct.mixGain.gain.value, 0);
    assert.equal(arp.mixGain.gain.value, 0);
    const scheduledEnd = arp.end;
    context.audioContext.currentTime = 1.05;
    player.noteOff('keyboard:C4');
    const release = JSON.stringify(direct.gain.gain.calls);
    context.setPerformanceSourceLayerSolo('piano', { silent: true });
    assert.equal(direct.mixGain.gain.value, .63);
    assert.equal(JSON.stringify(direct.gain.gain.calls), release);
    controls.get('performanceKeyboardPianoVolume').value = '21';
    context.syncKeyboardSampleMixControls();
    assert.equal(direct.mixGain.gain.value, .21);
    assert.equal(controls.get('performanceKeyboardPianoVolumeValue').textContent, '21%');
    assert.equal(controls.get('performanceKeyboardStringsVolumeValue').textContent, '38%');
    assert.equal(arp.mixGain.gain.value, 0);
    context.setPerformanceSourceLayerSolo('strings', { silent: true });
    assert.equal(arp.mixGain.gain.value, .38);
    assert.equal(arp.start, 3);
    assert.equal(arp.end, scheduledEnd);
    assert.equal(arp.source.stops.length, 1);
});

test('a sample that finishes loading after solo changes takes the current gate, not its requested mix', async () => {
    const { context, player } = fixture();
    const piano = player.samplers.get('piano').piano;
    const segment = piano.segment.bind(piano);
    let finish;
    piano.segment = () => null;
    piano.ensure = () => new Promise(resolve => { finish = () => { piano.segment = segment; resolve(); }; });
    const pending = player.noteOn('keyboard:C4', 60, { instrument: 'piano' });
    context.setLoopLayerSolo('bastardq', { silent: true });
    finish();
    const voice = await pending;
    assert.equal(voice.mixGain.gain.value, 0);
    context.setPerformanceSourceLayerSolo('piano', { silent: true });
    assert.equal(voice.mixGain.gain.value, .63);
});

test('zero-volume channels stay silent when selected and restored; solo changes do not alter raw mix labels', async () => {
    const { context, player, controls } = fixture();
    controls.get('performanceKeyboardPianoVolume').value = '0';
    const voice = await player.noteOn('keyboard:C4', 60, { instrument: 'piano' });
    context.setPerformanceSourceLayerSolo('piano', { silent: true });
    context.syncKeyboardSampleMixControls();
    assert.equal(voice.mixGain.gain.value, 0);
    assert.equal(controls.get('performanceKeyboardPianoVolumeValue').textContent, '0%');
    assert.equal(controls.get('performanceKeyboardStringsVolumeValue').textContent, '38%');
    context.clearAllPerformanceSoloStates({ silent: true, skipSave: true });
    assert.equal(voice.mixGain.gain.value, 0);
    assert.equal(controls.get('performanceKeyboardPianoVolume').value, '0');
});

test('raw mixer levels retain existing persistence, reset and randomization guards; source solos stay transient', () => {
    assert.match(extract('saveState'), /state.sliders\[slider.id\] = slider.value/);
    assert.doesNotMatch(extract('saveState'), /performanceSourceLayerSolo/);
    assert.match(extract('restoreState'), /slider.value = normalizedStateSliders\[id\]/);
    assert.match(extract('restoreState'), /slider.dispatchEvent\(new Event\('input'\)\)/);
    const skipStart = html.indexOf('const RANDOMIZE_SKIP_SLIDERS');
    const skip = html.slice(skipStart, html.indexOf(']);', skipStart));
    for (const id of ['performanceKeyboardPianoVolume', 'performanceKeyboardStringsVolume']) {
        assert.ok(skip.includes(`'${id}'`));
        assert.match(html, new RegExp(`${id}: 100`));
    }
    assert.equal((html.match(/v2026\.10\.20\.TOUCH\.3/g) || []).length, 2);
    assert.match(html, /q-card\.js\?v=20261020-touch-3/);
});
