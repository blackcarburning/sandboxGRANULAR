const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function extract(name) {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const body = html.indexOf(') {', start) + 2;
    let depth = 0;
    for (let index = body; index < html.length; index += 1) {
        if (html[index] === '{') depth += 1;
        if (html[index] === '}') depth -= 1;
        if (depth === 0) return `${html.slice(start - 6, start) === 'async ' ? 'async ' : ''}${html.slice(start, index + 1)}`;
    }
    throw new Error(name);
}

function fixture() {
    const tracks = Object.fromEntries(['clap', 'cymbals', 'etc'].map(kind => [kind, { kind, id: kind === 'etc' ? 'drumMachineEtc' : kind === 'clap' ? 'drumMachineClap' : 'drumMachineCymbals', label: kind === 'etc' ? 'ETC' : kind === 'clap' ? 'Clap' : 'Cymbals', buffer: null, metadata: null, pattern: Array(16).fill(false), ratchets: Array(16).fill(0), pitch: 0, level: 1, decay: 1, length: 1 }]));
    const elements = new Map();
    const hits = [];
    const calls = [];
    const context = {
        document: { getElementById: id => elements.get(id) },
        drumMachineExtraTracks: tracks,
        drumMachineKickPattern: Array(16).fill(false), drumMachineSnarePattern: [], drumMachineHatPattern: [], drumMachinePercPattern: [],
        drumMachineKickBuffer: {}, drumMachineSnareBuffer: {},
        DRUM_MACHINE_SOURCE_KEYS: { clap: 'samples_clap', cymbals: 'samples_crash', etc: 'samples_crash' },
        BASTARD_LOOP_SOURCE_LABELS: { samples_clap: 'SAMPLES_CLAP', samples_crash: 'SAMPLES_CRASH' },
        MAX_SAMPLE_DURATION_SECONDS: 300,
        PATTERN_STEPS_PER_BAR: 16,
        audioContext: {},
        clampDrumMachinePitchSemitones: value => Math.max(-12, Math.min(12, Number.isFinite(Number(value)) ? Number(value) : 0)),
        normalizeDrumMachinePattern: (pattern, length = 16) => Array.from({ length }, (unused, index) => Boolean(pattern?.[index % pattern.length])),
        normalizeDrumMachineRatchetPattern: (pattern, length = 16) => Array.from({ length }, (unused, index) => Math.max(0, Math.min(8, Number(pattern?.[index % pattern.length]) || 0))),
        getPatternLengthSteps: () => 16, getDrumMachinePatternLength: () => 16,
        getDrumMachineToneOptions: (kind, accent) => ({ cutoff: 100, envAmount: 0, accent }),
        setSliderValue: (id, value) => elements.set(id, { value: String(value) }),
        syncExtraDrumMachineUi: () => calls.push(['sync']),
        syncDrumMachineUi: () => calls.push(['sync']),
        renderDrumMachineStepGrid: kind => calls.push(['grid', kind]),
        saveState: () => calls.push(['save']),
        saveAudioBufferToDB: async (buffer, key) => calls.push(['audio', key, buffer]),
        playDrumMachineHit: (buffer, time, ratio, options) => hits.push({ buffer, time, ratio, ...options })
    };
    vm.createContext(context);
    for (const name of ['readExtraDrumMachineControls', 'captureExtraDrumMachineTracks', 'restoreExtraDrumMachineTracks', 'scheduleExtraDrumMachineRepeats', 'cycleDrumMachineRatchetStep', 'getDrumMachinePattern', 'setDrumMachinePattern', 'getDrumMachineTrackMetadata', 'getDrumMachineTrackLabel', 'applyLoadedDrumMachineSampleBuffer', 'buildRandomDrumMachinePattern']) vm.runInContext(extract(name), context);
    return { context, tracks, elements, hits, calls };
}

test('new lanes own independent patterns, ratchets and metadata and never fall through to kick', () => {
    const { context, tracks } = fixture();
    context.setDrumMachinePattern('clap', [true, false]);
    context.setDrumMachinePattern('cymbals', [false, true]);
    context.cycleDrumMachineRatchetStep('clap', 3);
    assert.equal(tracks.clap.pattern[3], true);
    assert.equal(tracks.clap.ratchets[3], 2);
    assert.equal(tracks.cymbals.ratchets[3], 0);
    assert.ok(context.drumMachineKickPattern.every(value => !value));
    assert.equal(context.getDrumMachineTrackLabel('cymbals'), 'Cymbals');
});

test('crash accent steps raise their own gain and drive only the crash filter envelope', () => {
    const { context, tracks, hits } = fixture();
    tracks.cymbals.buffer = {};
    tracks.cymbals.pattern[0] = true;
    tracks.cymbals.pattern[1] = true;
    tracks.cymbals.accents = Array(16).fill(false);
    tracks.cymbals.accents[1] = true;
    tracks.cymbals.accentAmount = .8;
    context.scheduleExtraDrumMachineRepeats('cymbals', 0, 1, .125);
    context.scheduleExtraDrumMachineRepeats('cymbals', 1, 2, .125);
    assert.equal(hits[0].level, 1);
    assert.equal(hits[0].tone.accent, false);
    assert.equal(hits[1].level, 1.4);
    assert.equal(hits[1].tone.accent, true);
    tracks.cymbals.accentAmount = 0;
    context.scheduleExtraDrumMachineRepeats('cymbals', 1, 3, .125);
    assert.equal(hits[2].level, 1);
    assert.equal(tracks.clap.level, 1);
});

test('legacy extra lanes recall empty accent grids and the neutral accent amount', () => {
    const { context, tracks } = fixture();
    context.restoreExtraDrumMachineTracks({ cymbals: { pattern: [true], level: 1 } });
    assert.equal(tracks.cymbals.accents.length, 16);
    assert.ok(tracks.cymbals.accents.every(value => !value));
    assert.equal(tracks.cymbals.accentAmount, .35);
    tracks.cymbals.accents[3] = true;
    tracks.cymbals.accentAmount = 0;
    const saved = context.captureExtraDrumMachineTracks();
    context.restoreExtraDrumMachineTracks(saved);
    assert.equal(tracks.cymbals.accents[3], true);
    assert.equal(tracks.cymbals.accentAmount, 0);
});

test('new sample loads save the correct independent buffers and metadata in IndexedDB and state', async () => {
    const { context, tracks, calls } = fixture();
    for (const kind of ['clap', 'cymbals', 'etc']) {
        const buffer = { duration: 2 };
        await context.applyLoadedDrumMachineSampleBuffer(kind, buffer, { fileName: `${kind}.wav`, relativePath: `folder/${kind}.wav` });
        assert.equal(tracks[kind].buffer, buffer);
        assert.equal(tracks[kind].metadata.sourceKey, kind === 'clap' ? 'samples_clap' : 'samples_crash');
        assert.ok(calls.some(call => call[0] === 'audio' && call[1] === `${tracks[kind].id}Buffer`));
    }
    assert.equal(calls.filter(call => call[0] === 'save').length, 3);
});

test('new lanes schedule independently at the shared grid with pitch, envelope, level and ratchets', () => {
    const { context, tracks, hits } = fixture();
    const track = tracks.clap;
    track.buffer = {};
    track.pattern[4] = true;
    track.ratchets[4] = 3;
    track.pitch = 12;
    track.level = .5;
    track.decay = .7;
    track.length = .6;
    context.scheduleExtraDrumMachineRepeats('clap', 4, 2, .12);
    assert.deepEqual(hits.map(hit => hit.time), [2, 2.04, 2.08]);
    assert.ok(hits.every(hit => hit.buffer === track.buffer && hit.ratio === 2 && hit.decayRatio === .7 && hit.lengthRatio === .6 && !hit.bypassFinalCompressor));
    assert.deepEqual(hits.map(hit => hit.level), [.5, .34, .34]);
    context.scheduleExtraDrumMachineRepeats('cymbals', 4, 2, .12);
    assert.equal(hits.length, 3);
    track.level = 0;
    context.scheduleExtraDrumMachineRepeats('clap', 4, 3, .12);
    assert.equal(hits.length, 3);
});

test('capture saves lane settings without serializing or copying audio buffers', () => {
    const { context, tracks } = fixture();
    tracks.clap.buffer = { enormous: true };
    tracks.clap.pattern[4] = true;
    tracks.clap.metadata = { fileName: 'clap.wav' };
    const saved = context.captureExtraDrumMachineTracks();
    assert.equal(saved.clap.pattern[4], true);
    assert.equal('buffer' in saved.clap, false);
    saved.clap.pattern[4] = false;
    saved.clap.metadata.fileName = 'changed';
    assert.equal(tracks.clap.pattern[4], true);
    assert.equal(tracks.clap.metadata.fileName, 'clap.wav');
});

test('recall restores patterns and controls; older parts default both lanes to silent', () => {
    const { context, tracks, elements } = fixture();
    const buffer = tracks.clap.buffer = {};
    context.restoreExtraDrumMachineTracks({ clap: { pattern: [true], ratchets: [2], pitch: -7, level: .3, decay: .4, length: .5, metadata: { fileName: 'saved.wav' } } });
    assert.ok(tracks.clap.pattern.every(Boolean));
    assert.equal(tracks.clap.buffer, buffer);
    assert.equal(elements.get('drumMachineClapPitch').value, '-7');
    assert.equal(elements.get('drumMachineClapLevel').value, '30');
    context.restoreExtraDrumMachineTracks();
    assert.ok(tracks.clap.pattern.every(value => !value));
    assert.ok(tracks.cymbals.pattern.every(value => !value));
    assert.equal(tracks.clap.metadata, null);
    assert.equal(tracks.clap.level, 1);
});

test('out-of-range restored controls are clamped and unrecognized lanes cannot leak into saved state', () => {
    const { context, tracks } = fixture();
    context.restoreExtraDrumMachineTracks({ clap: { pitch: 100, level: -20, decay: 50, length: 'bad' }, cymbals: { pitch: -100, decay: -10 }, unknown: { pattern: [true] } });
    assert.equal(tracks.clap.pitch, 12);
    assert.equal(tracks.clap.level, 0);
    assert.equal(tracks.clap.decay, 1);
    assert.equal(tracks.clap.length, 1);
    assert.equal(tracks.cymbals.pitch, -12);
    assert.equal(tracks.cymbals.decay, .05);
    assert.deepEqual(Object.keys(context.captureExtraDrumMachineTracks()), ['clap', 'cymbals', 'etc']);
});

test('random patterns stay empty without samples unless requested and cymbals start on the downbeat', () => {
    const { context, tracks } = fixture();
    assert.ok(context.buildRandomDrumMachinePattern('clap').every(value => !value));
    assert.equal(context.buildRandomDrumMachinePattern('clap', { force: true })[4], true);
    tracks.cymbals.buffer = {};
    assert.equal(context.buildRandomDrumMachinePattern('cymbals')[0], true);
});

test('song and patch audio entries include both new lanes while retaining all old slots', () => {
    const adapter = fs.readFileSync(path.join(__dirname, '../song-beta-adapter.js'), 'utf8');
    assert.match(adapter, /drumClap.*drumCymbals/);
    assert.match(html, /path: `drums\/\$\{track.kind\}\.wav`/);
    assert.match(html, /restoreExtraDrumMachineTracks\(state.modes.drumMachineExtraTracks\)/);
    // Check the drum player itself, not a retired X sample-envelope helper.
    assert.match(extract('playDrumMachineHit'), /source\.buffer = buffer/);
});

test('ETC has independent crash-style accent, ratchet, pitch and sample routing', async () => {
    const { context, tracks, hits } = fixture();
    const buffer = { duration: 2 };
    await context.applyLoadedDrumMachineSampleBuffer('etc', buffer, { fileName: 'manual.wav' });
    tracks.etc.pattern[2] = true; tracks.etc.accents = Array(16).fill(false); tracks.etc.accents[2] = true;
    tracks.etc.accentAmount = .8; tracks.etc.pitch = 12; tracks.etc.ratchets[2] = 3;
    context.scheduleExtraDrumMachineRepeats('etc', 2, 1, .12);
    assert.equal(hits.length, 3); assert(hits.every(hit => hit.buffer === buffer && hit.ratio === 2 && hit.tone.accent));
    assert.equal(hits[0].level, 1.4);
    assert(tracks.cymbals.pattern.every(value => !value)); assert.equal(tracks.cymbals.buffer, null);
    const saved = context.captureExtraDrumMachineTracks();
    context.restoreExtraDrumMachineTracks(saved); assert.equal(tracks.etc.accents[2], true);
    context.restoreExtraDrumMachineTracks({ cymbals: { pattern: [true] } });
    assert(tracks.etc.pattern.every(value => !value)); assert.equal(tracks.etc.metadata, null);
});

test('all random drum entry points preserve the entire manual ETC lane', async () => {
    const { context: c, tracks, elements } = fixture();
    Object.assign(tracks.etc, { buffer: {}, metadata: { fileName: 'keep.wav' }, pattern: Array.from({ length: 16 }, (_, i) => i === 7), accents: Array(16).fill(true), ratchets: Array(16).fill(3), accentAmount: .8, pitch: 7, level: .61, decay: .23, length: .45 });
    const before = JSON.stringify(tracks.etc), original = tracks.etc.buffer;
    const loads = [];
    Object.assign(c, { drumMachineLoadInFlight: false, drumMachineHatBuffer: {}, randomIntegerInRange: () => 77,
        loadDrumMachineSample: async kind => { loads.push(kind); },
        forceDrumMachineRandomLevel() {}, forceFinalSidechainKickRandomLevel() {}, setDrumMachineDirectOutput() {},
        describeDrumMachineSummary: () => 'fixture', syncPerformanceControlState() {}, setStatus() {} });
    for (const name of ['randomizeDrumMachinePatterns', 'randomizeDrumMachineEnvelopeShape', 'loadDrumMachineSampleSet']) vm.runInContext(extract(name), c);
    assert.deepEqual([...c.buildRandomDrumMachinePattern('etc', { force: true })], tracks.etc.pattern);
    c.randomizeDrumMachinePatterns(); c.randomizeDrumMachineEnvelopeShape();
    await c.loadDrumMachineSampleSet({ randomizePattern: true });
    await c.loadDrumMachineSampleSet({ randomizePattern: false });
    assert.deepEqual(loads, ['kick', 'snare', 'hat', 'clap', 'cymbals', 'kick', 'snare', 'hat', 'clap', 'cymbals']);
    assert.equal(JSON.stringify(tracks.etc), before); assert.equal(tracks.etc.buffer, original);
    assert(![...elements.keys()].some(key => key.startsWith('drumMachineEtc')));
    for (const name of ['loadDrumMachineSample', 'loadRandomSingleDrumMachineSample']) vm.runInContext(extract(name), c);
    c.fetch = () => assert.fail('ETC cannot request a random sample');
    assert.equal(await c.loadDrumMachineSample('etc'), false); assert.equal(await c.loadRandomSingleDrumMachineSample('etc'), false);
    assert.equal(JSON.stringify(tracks.etc), before);
});
