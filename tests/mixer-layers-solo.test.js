const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extract(name) {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const body = html.indexOf(') {', start) + 2;
    let depth = 0;
    for (let index = body; index < html.length; index += 1) {
        if (html[index] === '{') depth += 1;
        if (html[index] === '}') depth -= 1;
        if (depth === 0) return html.slice(start, index + 1);
    }
    throw new Error(name);
}

const sources = [
    ['performanceLayerOscSoloBtn', 'osc', 'oscillator'],
    ['performanceLayerGranularSoloBtn', 'granular', 'granular'],
    ['performanceGeneratedLayerQuickSoloBtn', 'sample', 'sample'],
    ['performanceDryLoopLayerQuickSoloBtn', 'loop', 'loop']
];
const loops = Array.from(extract('syncLoopLayerSoloButtons').matchAll(/id: '([^']+)', key: '([^']+)', label: '([^']+)'/g),
    match => match.slice(1));
const mixerDefinition = html.match(/const PERFORMANCE_MIXER_SOLO_BUTTONS = \[[\s\S]*?\n        \];/)[0];
const mixerConfigs = vm.runInNewContext(`${mixerDefinition}\nPERFORMANCE_MIXER_SOLO_BUTTONS`);

function button(id, dataset = {}) {
    const classes = new Set();
    const attributes = new Map();
    return {
        id, dataset, textContent: '', title: '', hidden: false,
        classList: {
            toggle(name, active) { if (active) classes.add(name); else classes.delete(name); },
            contains(name) { return classes.has(name); }
        },
        setAttribute(name, value) { attributes.set(name, value); },
        getAttribute(name) { return attributes.get(name); }
    };
}

function fixture() {
    const nodes = new Map([...sources, ...loops].map(([id]) => [id, button(id)]));
    mixerConfigs.forEach(({ controlId }) => nodes.set(`${controlId}SoloBtn`, button(`${controlId}SoloBtn`)));
    if (html.includes('id="performanceGrainLayerSoloStatus"')) {
        const status = button('performanceGrainLayerSoloStatus');
        status.hidden = true;
        nodes.set(status.id, status);
    }
    const grains = ['main', 'A', 'B'].map(key => button('', { grainLayerSolo: key }));
    const context = vm.createContext({
        document: { getElementById: id => nodes.get(id) || null, querySelectorAll: () => grains },
        performanceSourceLayerSolo: [], grainLayerSolo: [], loopLayerSolo: [], performanceSourceLayerSoloSnapshot: null,
        oscillatorsEnabled: true, granularLayersEnabled: true, generatedSampleLayerEnabled: true, generatedDryLoopEnabled: true,
        generatedSampleSolo: false, sourceWaveformSoloKinds: new Set(), audioContext: null, activeGrains: new Map(),
        setStatus() {}, saveState() {}, updatePerformanceSoloMixGains() {}, rescheduleActiveGrainsFromNow() {}
    });
    sources.forEach(([id]) => { context[id] = nodes.get(id); });
    vm.runInContext(`
        function setOscillatorsEnabled(value) { oscillatorsEnabled = value; }
        function setGranularLayersEnabled(value) { granularLayersEnabled = value; }
        function setGeneratedSampleLayerEnabled(value) { generatedSampleLayerEnabled = value; }
        function setGeneratedDryLoopEnabled(value) { generatedDryLoopEnabled = value; }
        function syncPerformanceControlState() {
            syncPerformanceSourceLayerSoloButtons();
            syncLoopLayerSoloButtons();
            syncGrainLayerSoloButtons();
            syncPerformanceMixerSoloButtons();
        }
        ${mixerDefinition}
    `, context);
    for (const name of [
        'normalizePerformanceSourceLayerSolo', 'normalizeLoopLayerSolo', 'normalizeGrainLayerSolo',
        'hasPerformanceSourceLayerSolo', 'hasLoopLayerSolo', 'hasGrainLayerSolo', 'hasAnyPerformanceLayerSoloSelection',
        'capturePerformanceSourceLayerSoloState', 'restorePerformanceSourceLayerSoloState', 'syncPerformanceLayerSoloIsolation',
        'restorePerformanceSourceLayerSolo', 'setPerformanceSourceLayerSolo', 'setLoopLayerSolo', 'setGrainLayerSolo',
        'syncPerformanceSourceLayerSoloButtons', 'syncLoopLayerSoloButtons', 'syncGrainLayerSoloButtons',
        'getPerformanceMixerSoloButtonId', 'syncPerformanceMixerSoloButtons', 'clearAllPerformanceSoloStates'
    ]) vm.runInContext(extract(name), context);
    return { context, nodes, grains };
}

function assertButton(control, active, label) {
    assert.equal(control.classList.contains('active'), active, control.id || label);
    assert.equal(control.getAttribute('aria-pressed'), String(active), control.id || label);
    assert.equal(control.textContent, label, control.id || label);
}

function assertSynchronized({ context, nodes, grains }) {
    sources.forEach(([id, key]) => {
        assertButton(nodes.get(id), context.hasPerformanceSourceLayerSolo(key), context.hasPerformanceSourceLayerSolo(key) ? 'Solo On' : 'Solo Off');
    });
    loops.forEach(([id, key, label]) => {
        const active = context.hasLoopLayerSolo(key);
        assertButton(nodes.get(id), active, active ? 'Solo On' : 'Solo Off');
        assert.equal(nodes.get(id).title, active ? `${label} soloed.` : `Solo ${label}.`);
    });
    grains.filter(control => control.dataset.grainLayerSolo !== 'main').forEach(control => {
        const key = control.dataset.grainLayerSolo;
        const active = context.hasGrainLayerSolo(key);
        assertButton(control, active, active ? `${key} Solo On` : `Solo ${key}`);
    });
    mixerConfigs.forEach(({ controlId, group, key, label }) => {
        const active = group === 'source' ? context.hasPerformanceSourceLayerSolo(key)
            : group === 'grain' ? context.hasGrainLayerSolo(key) : context.hasLoopLayerSolo(key);
        const control = nodes.get(`${controlId}SoloBtn`);
        assert.equal(control.classList.contains('active'), active, control.id);
        assert.equal(control.getAttribute('aria-pressed'), String(active), control.id);
        assert.equal(control.title, active ? `${label} soloed.` : `Solo ${label}.`);
    });
}

function assertGrainStatus(state, text) {
    const status = state.nodes.get('performanceGrainLayerSoloStatus');
    assert.ok(status, 'Layers has a grain solo status');
    assert.equal(status.hidden, !text);
    assert.equal(status.textContent, text);
    assertSynchronized(state);
}

test('Layers has exactly one read-only polite status immediately after the Granular quick-layer row', () => {
    assert.equal((html.match(/id="performanceGrainLayerSoloStatus"/g) || []).length, 1);
    assert.match(html, /id="performanceLayerGranularSoloBtn"[^>]*>Solo Off<\/button>\s*<\/div>\s*<div class="performance-feature-meta" id="performanceGrainLayerSoloStatus" role="status" aria-live="polite" hidden><\/div>\s*<button[^>]*id="performanceGranularKeysBtn"/);
});

test('grain solo status follows A, A+B, B and clearing without pressing the Granular source solo', () => {
    const state = fixture();
    state.context.syncPerformanceControlState();
    assertGrainStatus(state, '');
    for (const [key, text] of [['A', 'Grain A solo'], ['B', 'Grain A + B solo'], ['A', 'Grain B solo'], ['B', '']]) {
        state.context.setGrainLayerSolo(key, { toggle: true, silent: true, skipSave: true });
        assertGrainStatus(state, text);
        assert.equal(state.context.hasPerformanceSourceLayerSolo('granular'), false);
    }
});

test('grain status orders A+B consistently when B is selected first', () => {
    const state = fixture();
    state.context.setGrainLayerSolo('B', { toggle: true, silent: true, skipSave: true });
    assertGrainStatus(state, 'Grain B solo');
    state.context.setGrainLayerSolo('A', { toggle: true, silent: true, skipSave: true });
    assertGrainStatus(state, 'Grain A + B solo');
    assert.deepEqual(Array.from(state.context.grainLayerSolo), ['B', 'A']);
});

test('grain status remains independent of additive source solos and hides when only source solos remain', () => {
    const state = fixture();
    state.context.setGrainLayerSolo('A', { silent: true, skipSave: true });
    state.context.setPerformanceSourceLayerSolo('osc', { toggle: true, silent: true });
    state.context.setPerformanceSourceLayerSolo('granular', { toggle: true, silent: true });
    assertGrainStatus(state, 'Grain A solo');
    state.context.setGrainLayerSolo([], { silent: true, skipSave: true });
    assertGrainStatus(state, '');
    assert.equal(state.context.hasPerformanceSourceLayerSolo('granular'), true);
    state.context.setGrainLayerSolo(['A', 'B'], { silent: true, skipSave: true });
    assertGrainStatus(state, 'Grain A + B solo');
    state.context.clearAllPerformanceSoloStates({ silent: true, skipSave: true });
    assertGrainStatus(state, '');
});

test('restoring existing grain selections refreshes the status and clearing hides its stale text', () => {
    const state = fixture();
    state.context.grainLayerSolo = ['B', 'A'];
    state.context.performanceSourceLayerSolo = ['osc', 'granular'];
    state.context.syncPerformanceControlState();
    assertGrainStatus(state, 'Grain A + B solo');
    state.context.grainLayerSolo = ['B'];
    state.context.syncPerformanceControlState();
    assertGrainStatus(state, 'Grain B solo');
    state.context.grainLayerSolo = [];
    state.context.syncPerformanceControlState();
    assertGrainStatus(state, '');
});

test('solo synchronization tolerates a missing optional status element', () => {
    const state = fixture();
    state.nodes.delete('performanceGrainLayerSoloStatus');
    state.context.setGrainLayerSolo('A', { silent: true, skipSave: true });
    assertSynchronized(state);
});

for (const { controlId, group, key } of mixerConfigs) {
    test(`${controlId}: solo on, additive toggle off and reverse state synchronization`, () => {
        const state = fixture();
        const setter = group === 'source' ? state.context.setPerformanceSourceLayerSolo
            : group === 'grain' ? state.context.setGrainLayerSolo : state.context.setLoopLayerSolo;
        setter(key, { toggle: true, silent: true, skipSave: true });
        assertSynchronized(state);
        setter(key, { toggle: true, silent: true, skipSave: true });
        assertSynchronized(state);
    });
}

for (const [id, key] of sources) {
    test(`${id}: synchronize the replacement node, not its detached cached reference`, () => {
        const state = fixture();
        state.context.syncPerformanceControlState();
        const detached = state.nodes.get(id);
        state.nodes.set(id, button(id));
        state.context.setPerformanceSourceLayerSolo(key, { toggle: true, silent: true });
        assertSynchronized(state);
        assertButton(detached, false, 'Solo Off');
        state.context.setPerformanceSourceLayerSolo(key, { toggle: true, silent: true });
        assertSynchronized(state);
    });
}

test('missing source controls can mount later and synchronize from existing state', () => {
    const state = fixture();
    sources.forEach(([id]) => { state.context[id] = null; state.nodes.delete(id); });
    state.context.setPerformanceSourceLayerSolo(['osc', 'granular', 'sample', 'loop'], { toggle: false, silent: true });
    sources.forEach(([id]) => state.nodes.set(id, button(id)));
    state.context.syncPerformanceControlState();
    assertSynchronized(state);
});

test('restored multi-solo state and clear refresh every UI without changing the solo schema', () => {
    const state = fixture();
    state.context.performanceSourceLayerSolo = ['osc', 'granular', 'sample', 'loop', 'piano', 'strings'];
    state.context.grainLayerSolo = ['A', 'B'];
    state.context.loopLayerSolo = [...new Set(loops.map(([, key]) => key))];
    state.context.syncPerformanceControlState();
    assertSynchronized(state);
    assert.equal(state.context.clearAllPerformanceSoloStates({ silent: true, skipSave: true }), true);
    assertSynchronized(state);
    assert.equal(state.context.hasAnyPerformanceLayerSoloSelection(), false);
    assert.equal(state.context.clearAllPerformanceSoloStates({ silent: true, skipSave: true }), false);
});

test('main grain remains outside the existing A/B solo selection and never activates a mixer solo', () => {
    const state = fixture();
    state.context.setGrainLayerSolo('main', { toggle: true, silent: true, skipSave: true });
    assert.equal(state.context.grainLayerSolo.length, 0);
    assert.equal(state.grains[0].classList.contains('active'), false);
    assertSynchronized(state);
});

test('UI synchronization leaves selection arrays, enable flags and the isolation snapshot untouched', () => {
    const state = fixture();
    state.context.performanceSourceLayerSolo = ['osc', 'granular'];
    state.context.grainLayerSolo = ['A', 'B'];
    state.context.loopLayerSolo = ['bastardk', 'bastardq'];
    state.context.performanceSourceLayerSoloSnapshot = { oscillatorsEnabled: false, granularLayersEnabled: true,
        generatedSampleLayerEnabled: false, generatedDryLoopEnabled: true };
    const keys = ['performanceSourceLayerSolo', 'grainLayerSolo', 'loopLayerSolo', 'performanceSourceLayerSoloSnapshot',
        'oscillatorsEnabled', 'granularLayersEnabled', 'generatedSampleLayerEnabled', 'generatedDryLoopEnabled'];
    const references = keys.map(key => state.context[key]);
    const values = JSON.stringify(references);
    state.context.syncPerformanceControlState();
    assertSynchronized(state);
    keys.forEach((key, index) => assert.equal(state.context[key], references[index], key));
    assert.equal(JSON.stringify(keys.map(key => state.context[key])), values);
});
