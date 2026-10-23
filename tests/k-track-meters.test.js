const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../k-track-meters.js');

function fixture(options = {}) {
    let now = 0, reads = 0, writes = 0, callback;
    const timers = new Set(), windowEvents = new Map(), documentEvents = new Map();
    const styles = () => new Proxy({}, { set(target, key, value) { writes++; target[key] = value; return true; } });
    const rows = Array.from({ length: 5 }, (_, index) => {
        const children = Object.fromEntries(['fill', 'peak', 'value'].map(key => [key, { style: styles() }]));
        return { dataset: { kTrackMeter: String(index) }, attributes: {}, children,
            classList: { toggle() { writes++; } },
            setAttribute(key, value) { writes++; this.attributes[key] = value; },
            querySelector(selector) { return children[selector.match(/vu-(\w+)/)[1]]; } };
    });
    const doc = { hidden: false, querySelectorAll: () => rows,
        addEventListener: (key, fn) => documentEvents.set(key, fn), removeEventListener: key => documentEvents.delete(key) };
    const win = { document: doc, performance: { now: () => now },
        setTimeout(fn, interval) { assert.equal(interval, 50); const timer = { fn }; timers.add(timer); return timer; },
        clearTimeout(timer) { timers.delete(timer); },
        addEventListener: (key, fn) => windowEvents.set(key, fn), removeEventListener: key => windowEvents.delete(key),
        IntersectionObserver: class { constructor(fn) { callback = fn; } observe() {} disconnect() { callback = null; } },
        ...options };
    function node() { return { outputs: new Set(), connect(n) { this.outputs.add(n); }, disconnect(n) { if (n) this.outputs.delete(n); else this.outputs.clear(); } }; }
    function makeContext() {
        let channel = 0;
        return { state: 'running', left: .1, right: .1, listeners: new Set(), nodes: [],
            addEventListener(key, fn) { this.listeners.add(fn); }, removeEventListener(key, fn) { this.listeners.delete(fn); },
            createChannelSplitter() { const n = node(); this.nodes.push(n); return n; },
            createAnalyser() { const context = this, side = channel++ % 2;
                const n = { ...node(), getFloatTimeDomainData(data) { reads++; data.fill(side ? context.right : context.left); } };
                this.nodes.push(n); return n;
            }, change(state) { this.state = state; for (const fn of this.listeners) fn(); } };
    }
    let context = makeContext();
    const voices = new Map(Array.from({ length: 5 }, (_, index) => {
        const output = node(), destination = node(); output.connect(destination);
        return [index, { filters: [output], destination }];
    }));
    const meter = create({ window: win, context: () => context });
    meter?.sync(voices);
    return { meter, doc, rows, timers, win, voices, windowEvents, documentEvents, node, makeContext,
        get context() { return context; }, replaceContext(next) { context = next; meter.sync(voices); },
        visible(indices) { callback(rows.map((target, index) => ({ target, isIntersecting: indices.includes(index), intersectionRatio: indices.includes(index) ? 1 : 0 }))); },
        frame() { now += 50; const pending = [...timers]; for (const t of pending) { timers.delete(t); t.fn(); } },
        counts: () => ({ reads, writes }) };
}

test('only visible tracks connect taps; a single timer serves all five and hiding does no reads or drawing', () => {
    const f = fixture(); assert.equal(f.meter.activeCount, 0); assert.equal(f.timers.size, 0);
    f.visible([0, 1]); assert.equal(f.meter.activeCount, 2); assert.equal(f.timers.size, 1);
    f.frame(); assert.equal(f.counts().reads, 4);
    f.visible([0, 1, 2, 3, 4]); assert.equal(f.timers.size, 1); f.frame(); assert.equal(f.counts().reads, 14);
    f.visible([]); const before = f.counts(); f.frame(); f.frame(); assert.deepEqual(f.counts(), before);
    assert.equal(f.timers.size, 0);
    for (const voice of f.voices.values()) assert.deepEqual([...voice.filters[0].outputs], [voice.destination]);
});
test('stereo RMS does not cancel opposite-phase channels and constant-power pan does not change balance', () => {
    const f = fixture(); f.context.left = .1; f.context.right = -.1; f.visible([0]); f.frame();
    assert.equal(f.rows[0].attributes['aria-valuenow'], '-20');
    f.context.left = Math.SQRT2 * .1; f.context.right = 0;
    for (let i = 0; i < 6; i++) f.frame();
    assert.equal(f.rows[0].attributes['aria-valuenow'], '-20');
});
test('clipping has a peak hold; mute/zero decay to silence rather than retaining stale readings', () => {
    const f = fixture(); f.context.left = f.context.right = 1.1; f.visible([0]); f.frame();
    assert.equal(f.rows[0].attributes['aria-valuenow'], '0');
    f.context.left = f.context.right = 0;
    for (let i = 0; i < 30; i++) f.frame();
    assert.equal(f.rows[0].attributes['aria-valuetext'], 'Silent');
    assert.equal(f.rows[0].children.fill.style.transform, 'scaleX(1)');
});
test('tab hiding, page lifecycle and audio suspension disconnect taps and stop the timer', () => {
    const f = fixture(); f.visible([2]); f.frame();
    f.doc.hidden = true; f.documentEvents.get('visibilitychange')(); const before = f.counts(); f.frame();
    assert.deepEqual(f.counts(), before); assert.equal(f.meter.activeCount, 0); assert.equal(f.meter.running, false);
    f.doc.hidden = false; f.documentEvents.get('visibilitychange')(); assert.equal(f.meter.activeCount, 1);
    f.context.change('suspended'); assert.equal(f.meter.activeCount, 0); assert.equal(f.timers.size, 0);
    f.context.change('running'); assert.equal(f.meter.activeCount, 1);
    f.windowEvents.get('pagehide')(); assert.equal(f.meter.activeCount, 0); assert.equal(f.timers.size, 0);
    f.windowEvents.get('pageshow')(); assert.equal(f.meter.activeCount, 1);
});
test('voice and context replacement release old taps while keeping the audible destination connected', () => {
    const f = fixture(); f.visible([0]); const old = f.voices.get(0), originalContext = f.context;
    const next = { filters: [f.node()] }; f.voices.set(0, next); f.meter.sync(f.voices);
    assert.deepEqual([...old.filters[0].outputs], [old.destination]); assert.equal(next.filters[0].outputs.size, 1);
    f.replaceContext(f.makeContext()); assert.equal(originalContext.listeners.size, 0);
    assert.equal(f.meter.activeCount, 1); assert.equal(next.filters[0].outputs.size, 1);
    f.meter.sync(new Map()); assert.equal(f.meter.activeCount, 0); assert.equal(f.timers.size, 0);
    assert.equal(next.filters[0].outputs.size, 0);
});
test('partial allocation failure does not throw into transport and destroys all allocated branches', () => {
    const f = fixture(); let calls = 0;
    const original = f.context.createAnalyser.bind(f.context);
    f.context.createAnalyser = () => { if (++calls === 2) throw Error('allocation'); return original(); };
    assert.doesNotThrow(() => f.visible([0])); assert.equal(f.meter.activeCount, 0); assert.equal(f.timers.size, 0);
    assert.equal(f.context.nodes[0].outputs.size, 0);
    assert.deepEqual([...f.voices.get(0).filters[0].outputs], [f.voices.get(0).destination]);
});
test('account-lock teardown removes listeners/timers/taps and hidden Song renderers never mount meters', () => {
    const f = fixture(); f.visible([0, 1, 2, 3, 4]); f.meter.destroy();
    assert.equal(f.meter.activeCount, 0); assert.equal(f.timers.size, 0); assert.equal(f.context.listeners.size, 0);
    assert.equal(f.documentEvents.size, 0); assert.equal(f.windowEvents.size, 0);
    f.meter.sync(f.voices); assert.equal(f.meter.activeCount, 0);
    assert.equal(fixture({ __mygrainSongRenderDeck: true }).meter, null);
    assert.equal(fixture({ IntersectionObserver: undefined }).meter, null);
});
