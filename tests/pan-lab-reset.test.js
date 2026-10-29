const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const controls = ['finalPanCenter', 'finalPanWidth', 'finalPanLfoDepth', 'finalPanAudioDepth', 'finalPanOrbit', 'finalPanGravity'];

function extractFunction(name) {
    const start = html.indexOf(`function ${name}(`);
    assert.notEqual(start, -1);
    const body = html.indexOf(') {', start) + 2;
    let depth = 0;
    for (let index = body; index < html.length; index += 1) {
        if (html[index] === '{') depth += 1;
        if (html[index] === '}') depth -= 1;
        if (depth === 0) return html.slice(start, index + 1);
    }
    throw new Error(`Missing function body: ${name}`);
}

function resetFixture(overrides = {}) {
    const elements = new Map(controls.flatMap(id => [[id, { value: '87' }], [`${id}Value`, { textContent: '87%' }]]));
    elements.set('finalPanLfoRate', { value: '180' });
    const calls = [];
    const context = {
        document: { getElementById: id => elements.get(id) },
        engineStarting: false, stateSaveSuspended: false,
        audioContext: { currentTime: 12 }, finalPanLfoStartTime: 1,
        updateFinalOutputPanning: () => calls.push(['panning']),
        saveState: options => { calls.push(['save', options]); return true; },
        readStoredStateSnapshot: () => null,
        STATE_STORAGE_KEY: 'state',
        localStorage: { setItem: (key, value) => calls.push(['stored', key, JSON.parse(value)]) },
        setStatus: (message, severity) => calls.push(['status', message, severity]),
        console: { warn: (...args) => calls.push(['warning', ...args]) },
        ...overrides
    };
    vm.createContext(context);
    vm.runInContext(extractFunction('resetFinalPanMotion'), context);
    vm.runInContext(extractFunction('resetFinalPanLab'), context);
    return { context, elements, calls };
}

test('reset zeros all pan-motion amounts and centers output without changing unrelated controls', () => {
    const { context, elements, calls } = resetFixture();
    assert.equal(context.resetFinalPanLab(), true);
    for (const id of controls) {
        assert.equal(elements.get(id).value, '0');
        assert.equal(elements.get(`${id}Value`).textContent, '0%');
    }
    assert.equal(elements.get('finalPanLfoRate').value, '180');
    assert.equal(context.finalPanLfoStartTime, 12);
    assert.deepEqual(calls.map(call => call[0]), ['panning', 'save', 'status']);
});

test('reset works when audio is stopped or not initialized', () => {
    const { context, elements } = resetFixture({ audioContext: null });
    assert.equal(context.resetFinalPanLab(), true);
    assert.equal(context.finalPanLfoStartTime, 0);
    assert.equal(elements.get('finalPanCenter').value, '0');
});

test('pre-start reset patches only persisted pan sliders and keeps the rest of the saved patch', () => {
    const stored = { sliders: { finalPanCenter: '-100', cutoff: '4567' }, selects: { finalPanLfoWaveform: 'pulse' }, modes: { bastardLoopVCut: { enabled: true, start: .3, end: .6 } } };
    const { context, calls } = resetFixture({ stateSaveSuspended: true, saveState: () => false, readStoredStateSnapshot: () => structuredClone(stored) });
    assert.equal(context.resetFinalPanLab(), true);
    const saved = calls.find(call => call[0] === 'stored')[2];
    assert.equal(saved.sliders.cutoff, '4567');
    assert.deepEqual(saved.selects, stored.selects);
    assert.deepEqual(saved.modes, { ...stored.modes, finalPanEnabled: false });
    for (const id of controls) assert.equal(saved.sliders[id], '0');
    assert.equal(stored.sliders.finalPanCenter, '-100');
});

test('pre-start reset without a previous patch saves the current settings safely', () => {
    const saves = [];
    const { context } = resetFixture({ stateSaveSuspended: true, saveState: options => { saves.push(options); return options?.force === true; } });
    context.resetFinalPanLab();
    assert.equal(saves.length, 2);
    assert.equal(saves[1].force, true);
});

test('storage failure does not prevent centering but reports that the settings were not saved', () => {
    const { context, elements, calls } = resetFixture({ stateSaveSuspended: true, saveState: () => false, readStoredStateSnapshot: () => ({ sliders: {} }), localStorage: { setItem: () => { throw new Error('Quota'); } } });
    assert.equal(context.resetFinalPanLab(), true);
    assert.equal(elements.get('finalPanCenter').value, '0');
    assert.ok(calls.some(call => call[0] === 'warning'));
    assert.match(calls.at(-1)[1], /Browser settings could not be saved/);
});

test('reset does not race an in-progress engine restore', () => {
    const { context, elements, calls } = resetFixture({ engineStarting: true });
    assert.equal(context.resetFinalPanLab(), false);
    assert.equal(elements.get('finalPanCenter').value, '87');
    assert.deepEqual(calls.map(call => call[0]), ['status']);
});

test('shared randomizer reset changes DSP and labels without saving an intermediate patch or emitting status', () => {
    const { context, elements, calls } = resetFixture();
    assert.deepEqual(Array.from(context.resetFinalPanMotion()), controls);
    assert.ok(controls.every(id => elements.get(id).value === '0' && elements.get(`${id}Value`).textContent === '0%'));
    assert.equal(elements.get('finalPanLfoRate').value, '180');
    assert.deepEqual(calls.map(call => call[0]), ['panning']);
});

test('the shared patch randomizer clears Pan Lab and never randomizes its rate, shape or tracking preferences', () => {
    const randomizer = extractFunction('randomizeFullPatchPerformanceState');
    assert.match(randomizer, /resetFinalPanMotion\(\)/);
    assert.doesNotMatch(randomizer, /set(?:Slider|Select)Value\('finalPan/);
    assert.match(extractFunction('runPatchRandomization'), /randomizeFullPatchPerformanceState\(/);
    assert.match(extractFunction('runMegaRandomization'), /await runPatchRandomization\(\)/);
    assert.match(html, /await runMegaRandomization\(\{ sparseMode: true \}\)/);
});

function jumpFixture() {
    const calls = [];
    const element = dataset => ({ dataset, handlers: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener: function (type, handler) { this.handlers[type] = handler; }, setAttribute() {}, blur: () => calls.push(['blur']) });
    const drawer = element({});
    const handle = element({});
    const shortcut = element({ jumpClick: '#performancePanLabResetBtn', jumpTarget: '#finalPanSection' });
    const legacy = element({ jumpClick: '#existingAction' });
    const pan = { classList: { add() {}, remove() {} }, scrollIntoView: options => calls.push(['pan', options]) };
    const elements = { sectionJumpDrawer: drawer, sectionJumpHandle: handle };
    const selectors = { '#performancePanLabResetBtn': { click: () => calls.push(['reset']) }, '#existingAction': { click: () => calls.push(['legacy']) }, '#finalPanSection': pan };
    const context = {
        document: { getElementById: id => elements[id], querySelector: selector => selectors[selector], querySelectorAll: () => [shortcut, legacy], addEventListener() {} },
        window: { clearTimeout() {}, setTimeout: () => 1, matchMedia: () => ({ matches: false }) }
    };
    vm.createContext(context);
    vm.runInContext(extractFunction('initSectionJumpDrawer'), context);
    context.initSectionJumpDrawer();
    return { calls, shortcut, legacy };
}

test('Jump reset executes the action before scrolling straight to Pan Lab', () => {
    const { calls, shortcut } = jumpFixture();
    shortcut.handlers.click();
    assert.deepEqual(calls.map(call => call[0]), ['reset', 'blur', 'pan']);
    assert.equal(calls[2][1].block, 'start');
});

test('existing click-only Jump actions still execute without navigation', () => {
    const { calls, legacy } = jumpFixture();
    legacy.handlers.click();
    assert.deepEqual(calls, [['legacy']]);
});

test('Actions and Jump expose a single shared reset action with the Pan Lab target', () => {
    assert.match(html, /id="performancePanLabResetBtn"[^>]*>Reset Pan Lab<\/button>/);
    assert.match(html, /id="sectionJumpPanLabResetBtn"[^>]*data-jump-click="#performancePanLabResetBtn"[^>]*data-jump-target="#finalPanSection"/);
    assert.match(html, /getElementById\('performancePanLabResetBtn'\)\?\.addEventListener\('click', resetFinalPanLab\)/);
});

test('Pan power gate bypasses zero depths and preserves legacy render-only static pan', () => {
    const values = {finalPanWidth:100,finalPanLfoDepth:0,finalPanAudioDepth:0,finalPanOrbit:0,finalPanCenter:60};
    const context = vm.createContext({finalPanEnabled:false,finalPanLegacyRender:false,getSliderPercent:id=>(values[id]||0)/100,document:{getElementById:id=>({value:values[id]||0})}});
    vm.runInContext(`${extractFunction('panLabHasMotion')}\n${extractFunction('panLabActive')}`, context);
    assert.equal(vm.runInContext('panLabActive()',context),false);
    context.finalPanEnabled=true;
    assert.equal(vm.runInContext('panLabActive()',context),false);
    values.finalPanAudioDepth=25;
    assert.equal(vm.runInContext('panLabActive()',context),true);
    values.finalPanWidth=0;
    assert.equal(vm.runInContext('panLabActive()',context),false);
    values.finalPanAudioDepth=0;context.finalPanLegacyRender=true;
    assert.equal(vm.runInContext('panLabActive()',context),true);
    context.finalPanEnabled=false;
    assert.equal(vm.runInContext('panLabActive()',context),false);
});
