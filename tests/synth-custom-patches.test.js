const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { scopedStorage } = require('../mygrain-accounts.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const moduleStart = html.indexOf('<div class="source-seed-group" aria-label="3-voice synth controls">');
const moduleHtml = html.slice(moduleStart, html.indexOf('<!--', html.indexOf('id="oscRouteMode"', moduleStart)));
const helpers = html.slice(html.indexOf('        function getSynthCustomPatchControls()'), html.indexOf('        function populateSynthPresetSelect()'));
const expectedControls = [
    'synthWaveShape', 'synthStereoWidth', 'synthFmAmount',
    'synthMacro1', 'synthMacro2', 'synthMacro3', 'synthMacro4',
    ...[1, 2, 3, 4].flatMap(slot => [`synthMod${slot}Source`, `synthMod${slot}Target`, `synthMod${slot}Amount`]),
    ...[1, 2, 3].flatMap(osc => ['Wave', 'Semitone', 'Detune', 'DetuneLfoDepth', 'Level', 'Sync', 'Attack', 'Decay', 'Sustain', 'Release'].map(suffix => `osc${osc}${suffix}`)),
    ...['Type', 'Level', 'Attack', 'Decay', 'Sustain', 'Release'].map(suffix => `oscNoise${suffix}`),
    'oscSynthFilterType', 'oscSynthCutoff', 'oscSynthCutoffLfoDepth', 'oscSynthResonance', 'oscSynthResonanceLfoDepth', 'oscSynthDrive', 'oscRouteMode'
];
const routeTargets = ['osc1Detune', 'osc2Detune', 'osc3Detune', 'oscSynthCutoff', 'oscSynthResonance'];
const storageKey = 'mygrainSynthCustomPatches.v1';

function functionSource(name) {
    const start = html.indexOf(`        function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist`);
    return html.slice(start, html.indexOf('\n        function ', start + 1));
}

function memoryStorage() {
    const entries = new Map();
    return {
        entries,
        failReads: false,
        failWrites: false,
        dropWrites: false,
        get length() { return entries.size; },
        key(index) { return [...entries.keys()][index] ?? null; },
        getItem(key) {
            if (this.failReads) throw new Error('Storage access denied.');
            return entries.get(String(key)) ?? null;
        },
        setItem(key, value) {
            if (this.failWrites) throw new Error('Browser storage quota exceeded.');
            if (!this.dropWrites) entries.set(String(key), String(value));
        },
        removeItem(key) { entries.delete(String(key)); }
    };
}

class Element {
    constructor(tagName, attrs = '') {
        this.tagName = tagName.toUpperCase();
        this.attrs = Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
        this.id = this.attrs.id || '';
        this.value = this.attrs.value || '';
        this.type = this.attrs.type || '';
        this.min = this.attrs.min || '';
        this.max = this.attrs.max || '';
        this.options = [];
        this.textContent = '';
        this.disabled = /\bdisabled\b/.test(attrs);
        this.dataset = {};
        for (const [key, value] of Object.entries(this.attrs)) {
            if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
        }
        this.listeners = new Map();
        const classes = new Set((this.attrs.class || '').split(/\s+/));
        this.classList = {
            contains: value => classes.has(value),
            add: value => classes.add(value),
            remove: value => classes.delete(value),
            toggle(value, force = !classes.has(value)) { if (force) classes.add(value); else classes.delete(value); }
        };
    }
    addEventListener(type, callback) { this.listeners.set(type, [...(this.listeners.get(type) || []), callback]); }
    dispatchEvent(event) { event.target = this; for (const callback of this.listeners.get(event.type) || []) callback(event); }
    click() { this.dispatchEvent({ type: 'click' }); }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    closest(selector) { return this.browser && ['#synthCustomPatchBrowser', '[data-mygrain-workspace]'].includes(selector) ? this : null; }
    matches(selector) { return selector === 'select' ? this.tagName === 'SELECT' : selector === 'input[type="range"]' && this.type === 'range'; }
    appendChild(option) { this.options.push(option); }
    replaceChildren() { this.options = []; }
}

function fixture({ storage = memoryStorage(), username, writable } = {}) {
    const elements = new Map();
    const buttons = [];
    const controls = [];
    const browserStart = moduleHtml.indexOf('<section class="synth-custom-patches"');
    const browserEnd = moduleHtml.indexOf('</section>', browserStart);
    for (const match of moduleHtml.matchAll(/<(input|select|button|span|p)\b([^>]*)>/g)) {
        const element = new Element(match[1], match[2]);
        element.browser = match.index >= browserStart && match.index < browserEnd;
        if (element.tagName === 'SELECT') {
            const body = moduleHtml.slice(match.index + match[0].length, moduleHtml.indexOf('</select>', match.index));
            for (const optionMatch of body.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)) {
                const option = new Element('option', optionMatch[1]);
                option.textContent = optionMatch[2];
                element.appendChild(option);
                if (/\bselected\b/.test(optionMatch[1])) element.value = option.value;
            }
            if (!element.value) element.value = element.options[0]?.value || '';
        }
        if (element.id) elements.set(element.id, element);
        if (element.tagName === 'BUTTON') buttons.push(element);
        if (['INPUT', 'SELECT'].includes(element.tagName)) controls.push(element);
    }
    const selectButtons = selector => buttons.filter(button => selector.split(',').some(part => {
        const className = part.match(/\.([\w-]+)/)?.[1];
        return (!className || button.classList.contains(className)) && [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(match => Object.hasOwn(button.attrs, match[1]) && (match[2] === undefined || button.attrs[match[1]] === match[2]));
    }));
    const module = {
        querySelectorAll(selector) {
            if (selector === 'input[type="range"], select') return controls.filter(control => control.type === 'range' || control.tagName === 'SELECT');
            if (selector === 'input, select') return controls;
            return selectButtons(selector);
        }
    };
    const calls = [];
    const context = vm.createContext({
        document: {
            getElementById: id => elements.get(id) || null,
            createElement: tagName => new Element(tagName),
            querySelector: selector => selector.startsWith('.source-seed-group') ? module : selectButtons(selector)[0] || null,
            querySelectorAll: selectButtons
        },
        localStorage: username === undefined ? storage : scopedStorage(storage, username, writable),
        Event: class { constructor(type) { this.type = type; } },
        SYNTH_LFO_TARGET_PARAMS: routeTargets,
        SYNTH_POPUP_PRESETS: [{ id: 'factory-one', name: 'Factory One', settings: { osc1Wave: 'square' } }],
        syncPerformanceControlState: () => calls.push('performance'),
        saveState: () => { calls.push('saveState'); return true; },
        refreshActiveOscillatorVoices: () => calls.push('voices'),
        refreshActiveOscillatorLevels: () => calls.push('levels'),
        retriggerActiveOscillatorVoices: () => {},
        syncSynthLfoDepthLabel: () => {},
        syncSynthLfoDepthLabels: () => calls.push('depthLabels'),
        syncSynthDetuneLabels: () => {},
        syncOscSynthFilterControls: () => {},
        syncSynthComplexControls: () => {},
        refreshSynthComplexState: options => calls.push(['complex', options]),
        ensureSynthVoicePathAudible: () => { throw new Error('Must not touch mixer/solo/dry routing.'); },
        updateSourceMixGains: () => calls.push('sourceGains'),
        stopAllOscillators: () => calls.push('stopVoices'),
        setStatus: message => calls.push(message)
    });
    const declarations = ['osc1Config', 'osc2Config', 'osc3Config', 'oscNoiseConfig'].map(name => html.match(new RegExp(`        let ${name} = \\{[\\s\\S]*?\\n        \\};`))[0]).join('\n');
    vm.runInContext(`${declarations}
        let oscRouteMode = 'random';
        let oscMix = .35;
        let oscillatorsEnabled = true;
        let applyingSynthPopupPreset = false;
        let synthCustomPatches = [];
        let loadedSynthCustomPatchId = '';
        const SYNTH_CUSTOM_PATCH_STORAGE_KEY = '${storageKey}';
        const SYNTH_POPUP_PRESET_MAP = new Map(SYNTH_POPUP_PRESETS.map(preset => [preset.id, preset]));
        let lfoEnabled = { grainSize: true };
        let lfoInverted = { grainSize: true };
        let lfo2Enabled = { drumVolume: true };
        let lfo2Inverted = { drumVolume: true };
        let lfo3Enabled = { volume: true };
        let lfo3Inverted = { volume: true };
        ${helpers}
        ${['getLfoRouteMap', 'syncLfoRouteButtons', 'setSliderValue', 'setSelectValue', 'setOscillatorOctave', 'setOscillatorsEnabled', 'syncOscNoiseTypeLabel', 'syncOscRouteModeUI', 'getOscRouteModeLabel'].map(functionSource).join('\n')}
    `, context);
    const listenersStart = html.indexOf('        // Oscillator 1\n');
    vm.runInContext(html.slice(listenersStart, html.indexOf('        syncOscRouteModeUI();', listenersStart)), context);
    const customListenersStart = html.indexOf('        const synthPopupModule =');
    vm.runInContext(html.slice(customListenersStart, html.indexOf('\n        function updateSourceMixGains()', customListenersStart)), context);
    vm.runInContext('initializeSynthCustomPatchBrowser();', context);
    return {
        context, elements, storage, calls,
        evaluate: source => vm.runInContext(source, context),
        snapshot: () => JSON.parse(JSON.stringify(context.captureSynthCustomPatch())),
        input(id, value) { const control = elements.get(id); control.value = String(value); control.dispatchEvent({ type: control.tagName === 'SELECT' ? 'change' : 'input' }); },
        save(name) { elements.get('synthCustomPatchName').value = name; return context.saveSynthCustomPatchAs(); },
        select(id) { elements.get('synthCustomPatchSelect').value = id; elements.get('synthCustomPatchSelect').dispatchEvent({ type: 'change' }); },
        status: () => elements.get('synthCustomPatchStatus').textContent
    };
}

test('capture includes every sound control, all octaves, enable state and all 30 routing flags, not mixer/UI/global state', () => {
    const synth = fixture();
    const patch = synth.snapshot();
    assert.deepEqual(Object.keys(patch.controls).sort(), expectedControls.sort());
    assert.equal(Object.keys(patch.controls).length, 62);
    assert.equal(patch.controls.osc1Sync, 'master');
    assert.deepEqual(patch.octaves, { 1: 8, 2: 16, 3: 8 });
    assert.equal(patch.oscillatorsEnabled, true);
    assert.equal(Object.values(patch.lfo).flatMap(route => Object.values(route).flatMap(Object.values)).length, 30);
    assert.equal(patch.controls.oscMix, undefined);
    assert.equal(patch.controls.synthPresetSelect, undefined);
    assert.equal(patch.controls.synthCustomPatchSelect, undefined);
    assert.equal(patch.controls.globalBpmSlider, undefined);
    assert.equal(patch.lfo[1].enabled.grainSize, undefined);
});

test('restore round-trips all sound controls, octave switches, enable and routing state through actual oscillator listeners', () => {
    const synth = fixture();
    const patch = synth.snapshot();
    for (const id of expectedControls) {
        const control = synth.elements.get(id);
        patch.controls[id] = control.tagName === 'SELECT' ? control.options.at(-1).value : String(Number(control.max));
    }
    patch.octaves = { 1: 32, 2: 4, 3: 16 };
    patch.oscillatorsEnabled = false;
    for (const [number, routes] of Object.entries(patch.lfo)) {
        for (const [index, param] of routeTargets.entries()) {
            routes.enabled[param] = (index + Number(number)) % 2 === 0;
            routes.inverted[param] = (index + Number(number)) % 2 !== 0;
        }
    }
    synth.input('oscMix', '17');
    synth.evaluate('oscMix = .17');
    assert.equal(synth.context.restoreSynthCustomPatch(patch), true);
    assert.deepEqual(synth.snapshot(), patch);
    assert.equal(synth.elements.get('oscMix').value, '17');
    assert.equal(synth.evaluate('oscMix'), .17);
    assert.equal(synth.evaluate('osc1Config.attack'), Number(patch.controls.osc1Attack));
    assert.equal(synth.evaluate('osc2Config.sync'), patch.controls.osc2Sync);
    assert.equal(synth.evaluate('osc3Config.waveform'), patch.controls.osc3Wave);
    assert.equal(synth.evaluate('oscNoiseConfig.release'), Number(patch.controls.oscNoiseRelease));
    assert.equal(synth.evaluate('lfoEnabled.grainSize && lfo2Enabled.drumVolume && lfo3Inverted.volume'), true);
    assert.equal(synth.evaluate('osc1Config.octave'), 32);
    assert.equal(synth.evaluate('document.querySelector(\'.slope-toggle[data-osc="2"][data-octave="4"]\').classList.contains("active")'), true);
    assert.equal(synth.evaluate('document.querySelector(\'.lfo-toggle[data-param="osc1Detune"][data-lfo="2"]\').attrs["aria-pressed"]'), 'true');
    assert.equal(synth.calls.find(call => Array.isArray(call) && call[0] === 'complex')[1].skipRetrigger, true);
});

test('Save As persists a named patch across reload and browsing never implicitly loads', () => {
    const storage = memoryStorage();
    const first = fixture({ storage });
    first.input('osc1Attack', '777');
    first.evaluate('getLfoRouteMap("3", true).oscSynthCutoff = true');
    const saved = first.snapshot();
    const id = first.save('  Long Glass  ');
    assert.match(id, /^synth-custom-/);
    assert.equal(JSON.parse(storage.getItem(storageKey)).patches[0].name, 'Long Glass');
    const reloaded = fixture({ storage });
    reloaded.input('osc1Attack', '12');
    reloaded.select(id);
    assert.equal(reloaded.elements.get('osc1Attack').value, '12');
    assert.equal(reloaded.elements.get('synthCustomPatchName').value, 'Long Glass');
    assert.equal(reloaded.elements.get('synthCustomPatchLoadBtn').disabled, false);
    assert.equal(reloaded.context.loadSynthCustomPatch(), true);
    assert.deepEqual(reloaded.snapshot(), saved);
    assert.equal(reloaded.elements.get('synthPresetValue').textContent, 'Saved: Long Glass');
});

test('actual accounts wrapper isolates identical names and patch libraries across accounts and admin', () => {
    const storage = memoryStorage();
    const alice = fixture({ storage, username: 'alice' });
    const bob = fixture({ storage, username: 'bob' });
    const admin = fixture({ storage, username: 'admin' });
    assert.ok(alice.save('My pad'));
    assert.equal(bob.elements.get('synthCustomPatchSelect').options.length, 1);
    assert.equal(admin.elements.get('synthCustomPatchSelect').options.length, 1);
    assert.ok(bob.save('My pad'));
    assert.ok(admin.save('My pad'));
    assert.equal(storage.entries.size, 3);
    assert.equal(fixture({ storage, username: 'alice' }).elements.get('synthCustomPatchSelect').options.length, 2);
    assert.deepEqual([...storage.entries.keys()].sort(), [`mygrain-account:alice:${storageKey}`, `mygrain-account:bob:${storageKey}`, storageKey].sort());
});

test('renaming selected patch keeps stable ID and saved sound, does not save current edits, and survives reload', () => {
    const synth = fixture();
    const id = synth.save('Original');
    const before = JSON.parse(synth.storage.getItem(storageKey)).patches[0];
    synth.input('osc2Release', '2100');
    const current = synth.snapshot();
    synth.elements.get('synthCustomPatchName').value = 'Renamed';
    assert.equal(synth.context.renameSynthCustomPatch(), true);
    const renamed = JSON.parse(synth.storage.getItem(storageKey)).patches[0];
    assert.equal(renamed.id, id);
    assert.equal(renamed.name, 'Renamed');
    assert.deepEqual(renamed.settings, before.settings);
    assert.deepEqual(synth.snapshot(), current);
    assert.equal(synth.elements.get('synthPresetValue').textContent, 'Custom');
    assert.equal(fixture({ storage: synth.storage }).elements.get('synthCustomPatchSelect').options[1].textContent, 'Renamed');
});

test('rename of loaded patch updates label while renaming another browsed patch leaves loaded sound and label alone', () => {
    const synth = fixture();
    const firstId = synth.save('First');
    synth.elements.get('synthCustomPatchName').value = 'First renamed';
    assert.equal(synth.context.renameSynthCustomPatch(), true);
    assert.equal(synth.elements.get('synthPresetValue').textContent, 'Saved: First renamed');
    const secondId = synth.save('Second');
    synth.select(firstId);
    synth.context.loadSynthCustomPatch();
    const current = synth.snapshot();
    synth.select(secondId);
    synth.elements.get('synthCustomPatchName').value = 'Second renamed';
    assert.equal(synth.context.renameSynthCustomPatch(), true);
    assert.deepEqual(synth.snapshot(), current);
    assert.equal(synth.elements.get('synthPresetValue').textContent, 'Saved: First renamed');
});

test('factory records cannot be loaded or renamed through the custom browser and are never changed', () => {
    const synth = fixture();
    const factoryBefore = synth.evaluate('JSON.stringify(SYNTH_POPUP_PRESETS)');
    synth.elements.get('synthCustomPatchSelect').value = 'factory-one';
    synth.elements.get('synthCustomPatchName').value = 'Hijack';
    assert.equal(synth.context.renameSynthCustomPatch(), false);
    assert.match(synth.status(), /factory presets cannot be renamed/);
    assert.equal(synth.context.loadSynthCustomPatch(), false);
    assert.equal(synth.evaluate('JSON.stringify(SYNTH_POPUP_PRESETS)'), factoryBefore);
    assert.equal(synth.storage.getItem(storageKey), null);
    synth.context.setSynthPresetSelectValue('factory-one');
    assert.equal(synth.elements.get('synthPresetValue').textContent, 'Factory One');
});

test('editing after load marks sound Custom including LFO/INV and octave changes; browsing/name/actions are not sound edits', () => {
    const synth = fixture();
    const id = synth.save('Stable');
    for (const edit of [
        () => synth.input('osc1Decay', '987'),
        () => synth.evaluate('document.querySelector(\'.lfo-toggle[data-param="osc1Detune"][data-lfo="1"]\').click()'),
        () => synth.evaluate('document.querySelector(\'.inv-toggle[data-param="oscSynthCutoff"][data-lfo="3"]\').click()'),
        () => synth.context.setOscillatorOctave(3, 32),
        () => synth.context.setOscillatorsEnabled(false, { silent: true, skipSave: true })
    ]) {
        synth.select(id);
        synth.context.loadSynthCustomPatch();
        assert.equal(synth.elements.get('synthPresetValue').textContent, 'Saved: Stable');
        synth.input('synthCustomPatchName', 'Typed only');
        synth.select(id);
        assert.equal(synth.elements.get('synthPresetValue').textContent, 'Saved: Stable');
        edit();
        assert.equal(synth.elements.get('synthPresetValue').textContent, 'Custom');
    }
});

test('empty, overlong and multiline names fail and case/whitespace/Unicode duplicate names never overwrite', () => {
    const synth = fixture();
    for (const name of ['', '   ', 'x'.repeat(81), 'Two\nLines']) assert.equal(synth.save(name), false);
    const firstId = synth.save('Warm Pad');
    const stored = synth.storage.getItem(storageKey);
    for (const name of ['warm pad', ' Warm Pad ', 'Ｗａｒｍ Ｐａｄ']) {
        assert.equal(synth.save(name), false);
        assert.match(synth.status(), /already saved/);
        assert.equal(synth.storage.getItem(storageKey), stored);
    }
    assert.notEqual(synth.save('Warm Pad 2'), firstId);
    synth.elements.get('synthCustomPatchName').value = 'WARM PAD';
    const twoPatches = synth.storage.getItem(storageKey);
    assert.equal(synth.context.renameSynthCustomPatch(), false);
    assert.equal(synth.storage.getItem(storageKey), twoPatches);
});

test('names containing HTML remain literal text in options, status and saved label', () => {
    const synth = fixture();
    const name = '<img src=x onerror=alert(1)> & "Pad"';
    const id = synth.save(name);
    assert.ok(id);
    assert.equal(synth.elements.get('synthCustomPatchSelect').options[1].textContent, name);
    assert.equal(synth.elements.get('synthPresetValue').textContent, `Saved: ${name}`);
    assert.match(synth.status(), /<img src=x/);
    assert.doesNotMatch(helpers, /\.innerHTML\s*=/);
    synth.elements.get('synthCustomPatchName').value = '<svg onload=alert(2)>';
    assert.equal(synth.context.renameSynthCustomPatch(), true);
    assert.equal(synth.elements.get('synthCustomPatchSelect').options[1].textContent, '<svg onload=alert(2)>');
});

test('malformed storage never crashes startup or overwrites existing bytes on Save As', () => {
    for (const raw of ['{bad json', 'null', '[]', '{"version":99,"patches":[]}', '{"version":1,"patches":[null]}']) {
        const storage = memoryStorage();
        storage.setItem(storageKey, raw);
        const synth = fixture({ storage });
        assert.match(synth.status(), /Could not read saved patches/);
        assert.equal(synth.elements.get('synthCustomPatchLoadBtn').disabled, true);
        assert.equal(synth.save('Do not overwrite'), false);
        assert.equal(storage.getItem(storageKey), raw);
    }
});

test('malformed settings, duplicate IDs/names and factory IDs in storage are rejected without partial recall', () => {
    const seed = fixture();
    seed.save('Valid');
    const pristine = JSON.parse(seed.storage.getItem(storageKey));
    const mutate = [
        library => { delete library.patches[0].settings.controls.osc1Sync; },
        library => { library.patches[0].settings.controls.oscSynthCutoff = 'NaN'; },
        library => { library.patches[0].settings.controls.oscSynthCutoff = '99999999'; },
        library => { library.patches[0].settings.controls.osc2Wave = '<bad>'; },
        library => { library.patches[0].settings.octaves[2] = 999; },
        library => { library.patches[0].settings.lfo[1].enabled.osc1Detune = 'true'; },
        library => { library.patches[0].settings.oscillatorsEnabled = 1; },
        library => { library.patches[0].id = 'factory-one'; },
        library => { library.patches.push({ ...library.patches[0], name: 'Other' }); },
        library => { library.patches.push({ ...library.patches[0], id: 'synth-custom-other' }); }
    ];
    for (const modify of mutate) {
        const library = structuredClone(pristine);
        modify(library);
        const storage = memoryStorage();
        const raw = JSON.stringify(library);
        storage.setItem(storageKey, raw);
        const synth = fixture({ storage });
        const before = synth.snapshot();
        synth.elements.get('synthCustomPatchSelect').value = pristine.patches[0].id;
        assert.equal(synth.context.loadSynthCustomPatch(), false);
        assert.deepEqual(synth.snapshot(), before);
        assert.equal(storage.getItem(storageKey), raw);
    }
});

test('direct restore validates entire patch before applying any control or routing flag', () => {
    const synth = fixture();
    const before = synth.snapshot();
    const invalid = structuredClone(before);
    invalid.controls.osc1Wave = 'square';
    invalid.octaves[3] = 64;
    assert.throws(() => synth.context.restoreSynthCustomPatch(invalid), /Invalid synth patch octave/);
    assert.deepEqual(synth.snapshot(), before);
    assert.equal(synth.evaluate('applyingSynthPopupPreset'), false);
});

test('storage quota, access errors, locked account and silently dropped writes never report success', () => {
    for (const failure of ['failWrites', 'failReads', 'dropWrites', 'locked']) {
        const storage = memoryStorage();
        const synth = fixture({ storage, username: 'alice', writable: () => failure !== 'locked' });
        if (failure !== 'locked') storage[failure] = true;
        assert.equal(synth.save('Unsaved'), false);
        assert.match(synth.status(), /^Could not save patch\./);
        assert.equal(synth.elements.get('synthCustomPatchStatus').dataset.error, 'true');
        assert.equal(synth.elements.get('synthCustomPatchSelect').options.length, 1);
        assert.equal(synth.elements.get('synthPresetValue').textContent, '');
        assert.equal(storage.entries.size, 0);
    }
    const storage = memoryStorage();
    storage.failReads = true;
    assert.match(fixture({ storage }).status(), /^Could not read saved patches\./);
});

test('failed rename keeps selected option, label and persisted record unchanged', () => {
    const synth = fixture();
    synth.save('Keep me');
    const before = synth.storage.getItem(storageKey);
    synth.storage.failWrites = true;
    synth.elements.get('synthCustomPatchName').value = 'Not saved';
    assert.equal(synth.context.renameSynthCustomPatch(), false);
    assert.equal(synth.storage.getItem(storageKey), before);
    assert.equal(synth.elements.get('synthCustomPatchSelect').options[1].textContent, 'Keep me');
    assert.equal(synth.elements.get('synthPresetValue').textContent, 'Saved: Keep me');
    assert.match(synth.status(), /^Could not rename patch\./);
});

test('Save As creates a distinct version, never overwrites selected patch, and rereads newer library writes', () => {
    const storage = memoryStorage();
    const first = fixture({ storage });
    const other = fixture({ storage });
    const firstId = first.save('Version 1');
    first.input('osc3Attack', '1000');
    const secondId = first.save('Version 2');
    assert.notEqual(firstId, secondId);
    assert.ok(other.save('Other tab'));
    const records = JSON.parse(storage.getItem(storageKey)).patches;
    assert.equal(records.length, 3);
    assert.equal(records[0].settings.controls.osc3Attack, '12');
    assert.equal(records[1].settings.controls.osc3Attack, '1000');
    assert.deepEqual(records.map(patch => patch.name), ['Version 1', 'Version 2', 'Other tab']);
});

test('browser uses existing workspace exclusion from main state, has explicit actions, no delete or implicit update', () => {
    assert.match(moduleHtml, /id="synthCustomPatchBrowser"[^>]*data-mygrain-workspace="synth-custom-patches"/);
    assert.match(html, /if \(select\.closest\('\[data-mygrain-workspace\]'\)\) return;/);
    for (const id of ['synthCustomPatchSelect', 'synthCustomPatchName', 'synthCustomPatchSaveAsBtn', 'synthCustomPatchLoadBtn', 'synthCustomPatchRenameBtn', 'synthCustomPatchStatus']) {
        assert.equal((moduleHtml.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
    }
    assert.match(moduleHtml, /id="synthCustomPatchStatus" role="status" aria-live="polite"/);
    assert.match(moduleHtml, /Saved in this browser for your account only/);
    assert.doesNotMatch(moduleHtml, /synthCustomPatch(?:Delete|Update)Btn/);
});
