const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Controller } = require('../song-beta.js');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
}

function element() {
    const classes = new Set();
    return {
        textContent: '', value: '', children: [], attributes: {},
        classList: {
            toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
            contains(name) { return classes.has(name); }
        },
        style: { setProperty() {} },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener() {},
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; }
    };
}

function fixture() {
    const elements = new Map();
    const document = {
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, element());
            return elements.get(id);
        },
        createElement: element
    };
    const ready = deferred();
    const loads = [deferred(), deferred()];
    const renders = [deferred(), deferred()];
    const calls = [];
    const parts = ['Intro', 'Verse'].map((name, index) => ({
        id: `part-${index}`, name, sha256: `hash-${index}`, bpm: 120, patternSteps: 16, repeats: 1
    }));
    const controller = Object.assign(Object.create(Controller.prototype), {
        document, adapter: { ready: () => ready.promise, stop: () => calls.push('stop') },
        song: { id: 'inert-fixture', name: 'Status fixture', parts: [parts[0], { ...parts[0], id: 'reuse', sourcePartId: parts[0].id }, parts[1]] },
        songs: [], cache: new Map(), snapshots: new Map(parts.map(part => [part.id, { snapshot: {}, contentSha256: part.sha256 }])),
        renders: new Map(), renderSources: new Map(), renderLoads: new Map(), renderBytes: 0,
        audioCache: { buffers: new Map(), bytes: 0 },
        renderStore: { warning: '' }, storage: { persistent: true },
        lease: { device: { label: 'Inert fixture' }, canWrite: false },
        expandedParts: new Set(), armConcurrency: 1, armed: false, playing: false,
        busy: false, generation: 0, timer: null, abort: null, editing: null,
        loopPartId: null, loopSong: false, active: null, prepared: null
    });
    controller.request = async () => { throw new Error('Fixture must never access a backend.'); };
    controller.loadPart = async (part, generation) => {
        calls.push(`load:${part.name}`);
        await loads[parts.indexOf(part)].promise;
        if (generation !== controller.generation) throw new DOMException('Cancelled', 'AbortError');
        return { snapshot: {} };
    };
    controller.prepareRender = async (part, decoded, generation) => {
        calls.push(`render:${part.name}`);
        await renders[parts.indexOf(part)].promise;
        if (generation !== controller.generation) throw new DOMException('Cancelled', 'AbortError');
        controller.renderSources.set(part.id, part.sha256);
    };
    const status = () => document.getElementById('songBetaStatus');
    const summary = () => document.getElementById('songBetaCacheSummary').textContent;
    const start = () => controller.run(() => controller.arm());
    return { controller, document, ready, loads, renders, calls, parts, status, summary, start };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('Transport Info owns both unique live status IDs outside collapsed notes', () => {
    const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const transport = source.match(/<section id="songBetaTransportInfo"[\s\S]*?<\/section>/)[0];
    const notes = source.match(/<details class="song-beta-notes"[\s\S]*?<\/details>/)[0];
    for (const id of ['songBetaStatus', 'songBetaCacheSummary']) {
        assert.equal(source.match(new RegExp(`id="${id}"`, 'g')).length, 1);
        assert.match(transport, new RegExp(`id="${id}"[^>]*aria-live="polite"`));
        assert.doesNotMatch(notes, new RegExp(`id="${id}"`));
    }
    assert.match(transport, /aria-labelledby="songBetaTransportInfoTitle"/);
    assert.match(transport, /id="songBetaStatus"[^>]*role="status"[^>]*tabindex="0"/);
    assert.doesNotMatch(transport, /\bhidden\b|<details/);
    const css = fs.readFileSync(path.join(__dirname, '../song-beta.css'), 'utf8');
    assert.match(css, /#songBetaCard \.song-beta-help, #songBetaStatus\s*\{[^}]*overflow-wrap: anywhere/);
    assert.match(css, /#songBetaTransportInfo\s*\{[^}]*min-width: 0/);
    assert.match(css, /#songBetaStatus\s*\{[^}]*overflow-y: auto/);
});

test('arming is visible during deferred readiness/load and counts refresh at intermediate progress and completion', async () => {
    const current = fixture();
    const operation = current.start();
    assert.match(current.status().textContent, /Arming.*audio.*ready/i);
    assert.match(current.summary(), /0 unique parts ready · 2 to prepare · 3 placements/);
    assert.deepEqual(current.calls, []);
    current.ready.resolve();
    await settle();
    assert.match(current.status().textContent, /Arming 0\/2 pending.*Intro/);
    assert.deepEqual(current.calls, ['load:Intro']);
    current.loads[0].resolve();
    await settle();
    assert.deepEqual(current.calls, ['load:Intro', 'render:Intro']);
    current.renders[0].resolve();
    await settle();
    assert.match(current.status().textContent, /Arming 1\/2 pending.*Verse/);
    assert.match(current.summary(), /1 unique parts ready · 1 to prepare · 3 placements/);
    current.loads[1].resolve();
    await settle();
    current.renders[1].resolve();
    await operation;
    assert.match(current.status().textContent, /Armed 3 parts.*2 prepared, 0 unchanged reused/);
    assert.match(current.summary(), /2 unique parts ready · 0 to prepare · 3 placements/);
    assert.equal(current.controller.armed, true);
    assert.equal(current.document.getElementById('songBetaPlay').disabled, false);
    assert.equal(current.status().classList.contains('song-beta-error'), false);
});

test('ready cached parts still show the initial wait and finish without loading or rendering', async () => {
    const current = fixture();
    for (const part of current.parts) current.controller.renderSources.set(part.id, part.sha256);
    const operation = current.start();
    assert.match(current.status().textContent, /Arming.*audio.*ready/i);
    assert.match(current.summary(), /2 unique parts ready · 0 to prepare/);
    current.ready.resolve();
    await operation;
    assert.deepEqual(current.calls, []);
    assert.match(current.status().textContent, /0 prepared, 2 unchanged reused/);
});

for (const phase of ['ready', 'load', 'render']) {
    test(`${phase} failure reaches the actual status element and leaves the cache unarmed`, async () => {
        const current = fixture();
        const operation = current.start();
        if (phase !== 'ready') { current.ready.resolve(); await settle(); }
        if (phase === 'render') { current.loads[0].resolve(); await settle(); }
        const gate = phase === 'ready' ? current.ready : phase === 'load' ? current.loads[0] : current.renders[0];
        gate.reject(new Error(`${phase} fixture failure`));
        await operation;
        assert.equal(current.status().textContent, `${phase} fixture failure`);
        assert.equal(current.status().classList.contains('song-beta-error'), true);
        assert.equal(current.controller.armed, false);
        assert.equal(current.controller.busy, false);
        assert.match(current.summary(), /0 unique parts ready · 2 to prepare/);
    });

    test(`Stop during ${phase} does not permit late completion to overwrite stopped status`, async () => {
        const current = fixture();
        const operation = current.start();
        if (phase !== 'ready') { current.ready.resolve(); await settle(); }
        if (phase === 'render') { current.loads[0].resolve(); await settle(); }
        const signal = current.controller.abort.signal;
        current.controller.stop();
        const stopped = current.status().textContent;
        const gate = phase === 'ready' ? current.ready : phase === 'load' ? current.loads[0] : current.renders[0];
        gate.resolve();
        await operation;
        assert.equal(signal.aborted, true);
        assert.equal(current.status().textContent, stopped);
        assert.match(stopped, /Song stopped/);
        assert.equal(current.status().classList.contains('song-beta-error'), false);
        assert.equal(current.controller.armed, false);
        assert.equal(current.controller.busy, false);
        assert.equal(current.controller.abort, null);
    });
}

test('abort rejection after Stop does not replace the stopped status with an error', async () => {
    const current = fixture();
    const operation = current.start();
    current.controller.stop();
    current.ready.reject(new DOMException('Cancelled', 'AbortError'));
    await operation;
    assert.match(current.status().textContent, /Song stopped/);
    assert.equal(current.status().classList.contains('song-beta-error'), false);
});

test('custom synth inputs, select and actions retain only the requested 44px touch refinement', () => {
    const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    assert.ok(/\.synth-custom-patches input, \.synth-custom-patches select \{[^}]*min-height: 44px/.test(source));
    assert.ok(/\.synth-custom-patch-actions button \{[^}]*min-height: 44px/.test(source));
});
