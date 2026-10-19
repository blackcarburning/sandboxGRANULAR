const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Library } = require('../vocal-takes.js');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const adapter = fs.readFileSync(path.join(__dirname, '../song-beta-adapter.js'), 'utf8');

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, name);
    const body = source.indexOf(') {', start) + 2;
    let depth = 0;
    for (let index = body; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Missing body: ${name}`);
}

test('M+ duplicates every M card control without duplicate element IDs', () => {
    const card = html.slice(html.indexOf('aria-label="Bastardloop M controls"'), html.indexOf('aria-label="Bastardloop M+ controls"'));
    const controls = [...card.matchAll(/id="(performanceBastardLoopM\w+)"/g)].map(match => match[1]);
    assert.ok(controls.length > 35);
    for (const control of controls) assert.ok(html.includes(`id="${control.replace('LoopM', 'LoopMPlus')}"`), control);
    const ids = [...html.matchAll(/\bid="([^"\s]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(html.includes('>Loop M+</button>'));
});

test('vocal cards have distinct dark colours and clear titles while retaining their lane hooks', () => {
    for (const [lane, variant, title, colour] of [
        ['M', 'main', 'MAIN VOCAL', '#214532'],
        ['M+', 'backing', 'BACKING VOCAL', '#623c23']
    ]) {
        const cardStart = html.indexOf(`aria-label="Bastardloop ${lane} controls"`);
        const cardHeader = html.slice(html.lastIndexOf('<div class=', cardStart), html.indexOf('<p class="performance-feature-note">', cardStart));
        assert.ok(cardHeader.includes(`performance-vocal-card--${variant}`));
        assert.ok(cardHeader.includes(`<h3 class="performance-feature-title">${title}</h3>`));
        if (lane === 'M') assert.ok(cardHeader.includes('<div class="performance-chip">Main Vocal Loop</div>'));
        assert.ok(html.includes(`.simplified-ui .performance-vocal-card--${variant} {\n            --vocal-card-background: ${colour};`));
    }
    assert.match(html, /\.simplified-ui \.performance-vocal-card \{\s+background: var\(--vocal-card-background\)/);
    assert.doesNotMatch(html, /--vocal-card-ink/);
    assert.match(html, /\.performance-vocal-card \.performance-btn:not\(\.recording\) \{\s+color: var\(--accent\);\s+background: linear-gradient\(180deg, #303640 0%, #20262e 100%\)/);
});

test('M+ retains M signal processing and recording algorithms apart from its output pan', () => {
    const names = [...html.matchAll(/function (\w*BastardLoopMPlus\w*)\(/g)].map(match => match[1]);
    assert.equal(names.length, 83);
    const panFunctions = new Set(['syncBastardLoopMPlusPanUi', 'setBastardLoopMPlusPanPercent', 'syncBastardLoopMPlusUi', 'destroyBastardLoopMPlusFxBus', 'updateBastardLoopMPlusFxBusSettings', 'ensureBastardLoopMPlusFxBus']);
    for (const name of names.filter(name => name !== 'beginBastardLoopMPlusRecording' && !panFunctions.has(name))) {
        const backing = extractFunction(html, name).replaceAll('BastardLoopMPlus', 'BastardLoopM').replaceAll('bastardLoopMPlus', 'bastardLoopM').replaceAll('BASTARD_LOOP_M_PLUS', 'BASTARD_LOOP_M').replaceAll('bastardmplus', 'bastardm').replaceAll('Bastardloop M+', 'Bastardloop M').replaceAll("'M+'", "'M'");
        const primary = extractFunction(html, name.replace('BastardLoopMPlus', 'BastardLoopM'));
        const normalize = source => source.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
        assert.equal(normalize(backing), normalize(primary), name);
    }
});

test('M+ level and solo gating never alter M', () => {
    const elements = new Map([['performanceBastardLoopMPlusLevel', { value: '27' }]]);
    const context = { document: { getElementById: id => elements.get(id) }, bastardLoopMPlusLevel: .5, bastardLoopMPlusEnabled: true, bastardLoopMLevel: .64, getLoopLayerSoloGain: key => key === 'bastardmplus' ? 1 : 0 };
    vm.createContext(context);
    vm.runInContext(extractFunction(html, 'getBastardLoopMPlusLevelValue'), context);
    assert.equal(context.getBastardLoopMPlusLevelValue(), .27);
    assert.equal(context.bastardLoopMLevel, .64);
    context.bastardLoopMPlusEnabled = false;
    assert.equal(context.getBastardLoopMPlusLevelValue(), 0);
    assert.equal(context.getBastardLoopMPlusLevelValue({ applyLayerToggle: false }), .27);
});

test('both vocal lanes refuse recording while the other records', async () => {
    for (const [lane, other] of [['M', 'MPlus'], ['MPlus', 'M']]) {
        const messages = [];
        const context = { [`bastardLoop${other}RecordingState`]: 'countin', setStatus: message => messages.push(message) };
        vm.createContext(context);
        vm.runInContext('async ' + extractFunction(html, `beginBastardLoop${lane}Recording`), context);
        assert.equal(await context[`beginBastardLoop${lane}Recording`](), false);
        assert.match(messages[0], /Finish.*recording/);
    }
});

test('old song snapshots get an empty, neutral M+ state without losing existing modes', () => {
    const context = { cloneJson: value => JSON.parse(JSON.stringify(value)) };
    vm.createContext(context);
    vm.runInContext(extractFunction(adapter, 'prepareSongState'), context);
    const original = { patternLength: 16, modes: { bastardLoopMEnabled: true, bastardLoopMLevel: .7 }, sliders: {} };
    const prepared = context.prepareSongState(original);
    assert.equal(prepared.modes.bastardLoopMPlusEnabled, false);
    assert.equal(prepared.modes.bastardLoopMPlusPan, 0);
    assert.equal(prepared.sliders.performanceBastardLoopMPlusPan, '0');
    assert.equal(prepared.modes.bastardLoopMPlusDelayMix, 0);
    assert.equal(prepared.modes.bastardLoopMPlusPitchSemitones, 0);
    assert.equal(prepared.sliders.performanceBastardLoopMPlusDelayMix, '0');
    assert.equal(prepared.sliders.performanceBastardLoopMPlusInputGain, '100');
    assert.equal(prepared.selects.performanceBastardLoopMPlusFilterMode, 'lowpass-48');
    assert.equal(prepared.modes.bastardLoopMLevel, .7);
    assert.equal(original.modes.bastardLoopMPlusEnabled, undefined);
    assert.equal(context.prepareSongState({ modes: { bastardLoopMPlusEnabled: true, bastardLoopMPlusLevel: 0 } }).modes.bastardLoopMPlusLevel, 0);
    const panned = context.prepareSongState({ modes: { bastardLoopMPlusPan: -.45 } });
    assert.equal(panned.modes.bastardLoopMPlusPan, -.45);
    assert.equal(panned.sliders.performanceBastardLoopMPlusPan, '-45');
});

test('M+ pan clamps, smooths and persists independently with an accessible centre reset', () => {
    const slider = { setAttribute: (name, value) => { slider[name] = value; } };
    const label = {};
    const ramps = [];
    let saves = 0;
    const pan = {};
    const context = {
        document: { getElementById: id => id === 'performanceBastardLoopMPlusPan' ? slider : label },
        bastardLoopMPlusPan: 0, bastardLoopMPlusPanNode: { pan }, bastardLoopMLevel: .67,
        rampBastardLoopMPlusFxParam: (...args) => ramps.push(args), saveState: () => { saves += 1; }
    };
    vm.createContext(context);
    vm.runInContext(extractFunction(html, 'syncBastardLoopMPlusPanUi') + '\n' + extractFunction(html, 'setBastardLoopMPlusPanPercent'), context);
    for (const [input, expected, text] of [[-130, -1, '100% Left'], [35, .35, '35% Right'], [180, 1, '100% Right'], [NaN, 0, 'Centre'], [Infinity, 0, 'Centre'], [0, 0, 'Centre']]) {
        context.setBastardLoopMPlusPanPercent(input);
        assert.equal(context.bastardLoopMPlusPan, expected);
        assert.equal(slider.value, String(expected * 100));
        assert.equal(label.textContent, text);
        assert.equal(slider['aria-valuetext'], text);
        assert.deepEqual(ramps.at(-1), [pan, expected, .03]);
    }
    assert.equal(saves, 6);
    context.bastardLoopMPlusPanNode = null;
    context.setBastardLoopMPlusPanPercent(-25, { skipSave: true });
    assert.equal(context.bastardLoopMPlusPan, -.25);
    assert.equal(saves, 6);
    assert.equal(context.bastardLoopMLevel, .67);
    assert.match(html, /performanceBastardLoopMPlusPanCentreBtn\?\.addEventListener\('click', \(\) => \{\s+setBastardLoopMPlusPanPercent\(0\)/);
    assert.match(html, /if \(e\.target\.id === 'performanceBastardLoopMPlusPan'\) \{\s+syncBastardLoopMPlusPanUi\(\);\s+return;/);
});

test('M+ pans its entire effects output after compression and cleans up the pan node', () => {
    const bus = extractFunction(html, 'ensureBastardLoopMPlusFxBus');
    assert.match(bus, /bastardLoopMPlusPanNode = typeof audioContext\.createStereoPanner/);
    assert.match(bus, /bastardLoopMPlusPanNode\.pan\.value = bastardLoopMPlusPan/);
    assert.match(bus, /bastardLoopMPlusCompressorNode\.connect\(bastardLoopMPlusPanNode\)/);
    assert.match(bus, /bastardLoopMPlusPanNode\.connect\(destination\)/);
    assert.doesNotMatch(bus, /bastardLoopMPlusCompressorNode\.connect\(destination\)/);
    const cleanup = extractFunction(html, 'destroyBastardLoopMPlusFxBus');
    assert.match(cleanup, /bastardLoopMPlusCompressorNode,\s+bastardLoopMPlusPanNode/);
    assert.match(cleanup, /bastardLoopMPlusPanNode = null/);
    assert.match(extractFunction(html, 'updateBastardLoopMPlusFxBusSettings'), /rampBastardLoopMPlusFxParam\(bastardLoopMPlusPanNode\?\.pan, bastardLoopMPlusPan, 0\.03\)/);
    assert.match(extractFunction(html, 'syncBastardLoopMPlusUi'), /syncBastardLoopMPlusPanUi\(\)/);
    assert.match(extractFunction(html, 'saveState'), /bastardLoopMPlusPan: bastardLoopMPlusPan/);
    assert.match(extractFunction(html, 'applyPreset'), /setBastardLoopMPlusPanPercent\(normalizedSliders\?\.performanceBastardLoopMPlusPan \?\? 0/);
    assert.doesNotMatch(extractFunction(html, 'randomizeMegaBastardLoopSettings'), /setBastardLoopMPlusPanPercent|performanceBastardLoopMPlusPan/);
});

test('M+ raw/rendered song audio and reload persistence have separate keys', () => {
    assert.match(adapter, /\['bastardMPlus',.*BASTARD_LOOP_M_PLUS_AUDIO_BUFFER_KEY/);
    assert.match(adapter, /\['bastardMPlusRender',.*bastardLoopMPlusBuffer/);
    assert.match(html, /BASTARD_LOOP_M_PLUS_AUDIO_BUFFER_KEY = 'bastardLoopBufferMPlus'/);
    assert.match(html, /loadAudioBufferFromDB\(BASTARD_LOOP_M_PLUS_AUDIO_BUFFER_KEY\)/);
    assert.match(adapter, /bastardLoopMPlusRecordingState !== 'idle'/);
});

test('shared transport treats a loaded M+ as a playable standalone layer', () => {
    const source = extractFunction(html, 'startAllBastardLoopLayers');
    assert.match(source, /startedMPlus = startBastardLoopMPlus\(resolvedStartTime/);
    assert.match(source, /startedM \|\| startedMPlus/);
    assert.match(extractFunction(html, 'stopAllBastardLoopLayers'), /stopBastardLoopMPlus/);
    assert.match(extractFunction(html, 'restartAllTransport'), /bastardLoopMPlusBuffer/);
});

test('randomisation leaves M+ muted without requesting microphone capture', () => {
    const mega = extractFunction(html, 'randomizeMegaBastardLoopSettings');
    assert.doesNotMatch(mega, /setBastardLoopMPlusEnabled\(true/);
    assert.doesNotMatch(mega, /beginBastardLoopMPlusRecording/);
    assert.match(html, /key: 'bastardmplus', label: 'Bastardloop M\+', setEnabled:/);
    assert.match(html, /RANDOMIZE_MUTED_LOOP_LAYER_KEYS = new Set\(\['bastardm', 'bastardmplus', 'bastardq', 'bastardk'\]\)/);
});

test('Jump releases button focus so its closing drawer cannot obscure M+', () => {
    assert.match(extractFunction(html, 'initSectionJumpDrawer'), /button\.blur\(\);\s+target\.scrollIntoView/);
});

test('opening the shared browser selects its lane without changing user or folder', async () => {
    const primary = {}, backing = {};
    const label = {};
    const library = Object.create(Library.prototype);
    Object.assign(library, { targets: { M: primary, 'M+': backing }, adapter: primary, targetLane: 'M', userId: 'vocalist', folderId: 'harmonies', busy: false, dialog: { open: true, querySelector: () => label }, group: () => ({}), run: async action => action(), refresh: async () => {} });
    await library.open(false, 'M+');
    assert.equal(library.adapter, backing);
    assert.equal(library.targetLane, 'M+');
    assert.match(label.textContent, /M\+ \(backing vocals\)/);
    assert.equal(library.userId, 'vocalist');
    assert.equal(library.folderId, 'harmonies');
    library.busy = true;
    await library.open(false, 'M');
    assert.equal(library.adapter, backing);
});

test('vocal stems and portable patch assets use distinct lane IDs', () => {
    assert.match(html, /key: 'bastardMPlus'.*path: 'bastardloops\/bastardloop-mplus.wav'/);
    assert.match(html, /key: 'bastardMPlus'.*stemBase: 'bastardloop-mplus'/);
    assert.match(extractFunction(html, 'applyStemIsolation'), /case 'bastardMPlus':\s+setBastardLoopMPlusEnabled\(true/);
    assert.match(extractFunction(html, 'resetStemIsolationState'), /setBastardLoopMPlusEnabled\(false/);
});

test('preset recall restores explicit vocal modes without changing lanes absent from an old preset', () => {
    const calls = [];
    const context = { normalizeBastardLoopFilterMode: value => value, normalizeBastardLoopMDelayDivision: value => value, normalizeBastardLoopMPlusDelayDivision: value => value, setSelectValue: (...args) => calls.push(args) };
    for (const lane of ['M', 'MPlus']) for (const field of ['Enabled', 'PreserveDuration', 'Reverse']) context[`setBastardLoop${lane}${field}`] = value => calls.push([`${lane}${field}`, value]);
    vm.createContext(context);
    vm.runInContext(extractFunction(html, 'applyVocalLoopPresetSettings'), context);
    context.applyVocalLoopPresetSettings({ sliders: {} });
    assert.equal(calls.length, 0);
    context.applyVocalLoopPresetSettings({ bastardLoopMPlusEnabled: false, bastardLoopMPlusReverse: true, bastardLoopMPlusFilterMode: 'highpass-24', bastardLoopMPlusDelayDivision: '1d' });
    assert.deepEqual(calls, [['MPlusEnabled', false], ['MPlusReverse', true], ['performanceBastardLoopMPlusFilterMode', 'highpass-24'], ['performanceBastardLoopMPlusDelayDivision', '1d']]);
    assert.match(extractFunction(html, 'gatherPreset'), /bastardLoopMPlusPreserveDuration/);
});

test('manual includes song design, long-vocal limits, library and Pan Lab guidance', () => {
    const manual = fs.readFileSync(path.join(__dirname, '../manual.html'), 'utf8');
    for (const id of ['song-mode', 'v-loop', 'm-loop', 'vocal-workflows', 'pan-lab']) assert.ok(manual.includes(`id="${id}"`));
    assert.match(manual, /5 \+ 5 \+ 5 \+ 1/);
    assert.match(manual, /Increasing the part's Repeats does not/);
    assert.match(manual, /Reset Pan Lab/);
    assert.match(manual, /one-pattern final mixes/);
});
