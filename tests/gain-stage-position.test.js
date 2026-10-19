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
        if (depth === 0) return html.slice(start, index + 1);
    }
    throw new Error(name);
}

function fixture() {
    const scrolls = [];
    class Input {
        constructor(type = 'range') {
            this.type = type;
            this.isConnected = true;
            this.value = '50';
            this.bounds = { top: 400, bottom: 420, left: 20, right: 320, width: 300, height: 20 };
        }
        getBoundingClientRect() { return { ...this.bounds }; }
        focus() { assert.fail('Gain warnings must not change focus'); }
        scrollIntoView() { assert.fail('Gain warnings must not navigate to another control'); }
    }
    const slider = new Input();
    const context = vm.createContext({
        HTMLInputElement: Input,
        performanceGainStageEditedSlider: null,
        performanceGainStageSliderAnchor: null,
        document: { activeElement: slider },
        window: { innerHeight: 844, innerWidth: 390, scrollBy: options => scrolls.push({ ...options }) }
    });
    for (const name of ['rememberPerformanceGainStageSlider', 'preservePerformanceGainStageSliderPosition']) vm.runInContext(extract(name), context);
    return { context, slider, scrolls, Input };
}

for (const displacement of [1700, -1700]) {
    test(`compensates report ${displacement > 0 ? 'expansion' : 'collapse'} without moving focus or changing the level`, () => {
        const { context, slider, scrolls } = fixture();
        const result = context.preservePerformanceGainStageSliderPosition(() => {
            slider.bounds.top += displacement;
            return 'updated';
        });
        assert.equal(result, 'updated');
        assert.deepEqual(scrolls, [{ top: displacement, left: 0, behavior: 'instant' }]);
        assert.equal(slider.value, '50');
        assert.equal(context.document.activeElement, slider);
    });
}

test('remembered touch input works without requiring browser focus', () => {
    const { context, slider, scrolls } = fixture();
    context.rememberPerformanceGainStageSlider({ target: slider });
    context.document.activeElement = {};
    context.preservePerformanceGainStageSliderPosition(() => { slider.bounds.top += 100; });
    assert.deepEqual(scrolls, [{ top: 100, left: 0, behavior: 'instant' }]);
    assert.deepEqual(context.document.activeElement, {});
});

test('tracking follows the newly edited or keyboard-focused range and ignores non-ranges', () => {
    const { context, slider, Input, scrolls } = fixture();
    const next = new Input();
    context.rememberPerformanceGainStageSlider({ target: slider });
    context.rememberPerformanceGainStageSlider({ target: new Input('text') });
    context.rememberPerformanceGainStageSlider({ target: {} });
    assert.equal(context.performanceGainStageEditedSlider, slider);
    context.rememberPerformanceGainStageSlider({ target: next });
    context.preservePerformanceGainStageSliderPosition(() => { next.bounds.top += 80; });
    assert.deepEqual(scrolls, [{ top: 80, left: 0, behavior: 'instant' }]);
});

test('unchanged positions, including already browser-anchored layouts, need no scrolling', () => {
    const { context, slider, scrolls } = fixture();
    context.preservePerformanceGainStageSliderPosition(() => {});
    context.preservePerformanceGainStageSliderPosition(() => { slider.bounds.top += 0.25; });
    assert.deepEqual(scrolls, []);
});

test('fractional browser scroll rounding cannot accumulate drift across repeated warnings', () => {
    const { context, slider } = fixture();
    context.window.scrollBy = options => { slider.bounds.top -= Math.round(options.top); };
    for (let cycle = 0; cycle < 50; cycle += 1) {
        for (const displacement of [0.515625, -0.25, -0.265625, 0]) {
            context.preservePerformanceGainStageSliderPosition(() => { slider.bounds.top += displacement; });
            assert.ok(Math.abs(slider.bounds.top - 400) <= 0.5);
        }
    }
});

test('intentional scrolling while the slider remains visible establishes a new anchor', () => {
    const { context, slider } = fixture();
    context.window.scrollBy = options => { slider.bounds.top -= Math.round(options.top); };
    context.preservePerformanceGainStageSliderPosition(() => { slider.bounds.top += 50; });
    slider.bounds.top = 250;
    context.preservePerformanceGainStageSliderPosition(() => { slider.bounds.top += 200; });
    assert.equal(slider.bounds.top, 250);
});

test('manual scrolling off the edited slider is not undone', () => {
    for (const bounds of [{ top: -30, bottom: -10 }, { top: 844, bottom: 864 }, { left: 390, right: 690 }, { right: 0, left: -300 }, { width: 0 }, { height: 0 }]) {
        const { context, slider, scrolls } = fixture();
        Object.assign(slider.bounds, bounds);
        let updates = 0;
        context.preservePerformanceGainStageSliderPosition(() => { updates += 1; slider.bounds.top += 1000; });
        assert.equal(updates, 1);
        assert.deepEqual(scrolls, []);
    }
});

test('missing, disconnected and non-range controls never cause navigation', () => {
    for (const mode of ['missing', 'disconnected', 'non-range']) {
        const { context, slider, scrolls } = fixture();
        if (mode === 'missing') context.document.activeElement = null;
        if (mode === 'disconnected') slider.isConnected = false;
        if (mode === 'non-range') slider.type = 'text';
        assert.equal(context.preservePerformanceGainStageSliderPosition(() => 42), 42);
        assert.deepEqual(scrolls, []);
    }
});

test('removed or hidden sliders are not scrolled back after an update', () => {
    for (const mode of ['removed', 'hidden']) {
        const { context, slider, scrolls } = fixture();
        context.preservePerformanceGainStageSliderPosition(() => {
            slider.bounds.top += 100;
            if (mode === 'removed') slider.isConnected = false;
            else slider.bounds.height = 0;
        });
        assert.deepEqual(scrolls, []);
    }
});

test('an update error still preserves the slider and propagates unchanged', () => {
    const { context, slider, scrolls } = fixture();
    const error = new Error('failed update');
    assert.throws(() => context.preservePerformanceGainStageSliderPosition(() => { slider.bounds.top += 90; throw error; }), caught => caught === error);
    assert.deepEqual(scrolls, [{ top: 90, left: 0, behavior: 'instant' }]);
});

test('warning rendering and resets both preserve the visible edited slider', () => {
    const { context, slider, scrolls } = fixture();
    context.performanceGainStageAuditStatus = { textContent: '' };
    context.performanceGainStageAuditList = {
        set innerHTML(value) { slider.bounds.top = value ? 1000 : 300; }
    };
    const graphs = [];
    context.renderPerformanceGainStageGraph = result => graphs.push(result);
    for (const name of ['renderPerformanceGainStageAudit', 'resetPerformanceGainStageAudit']) vm.runInContext(extract(name), context);
    const report = { suggestions: [{ label: 'Master Trim', controlId: 'performanceMasterTrim', details: ['Leave more headroom.', 'Reduce the trim.'] }] };
    context.renderPerformanceGainStageAudit(report);
    slider.bounds.top = 400;
    context.renderPerformanceGainStageAudit({ debugAvailable: true, suggestions: [] });
    slider.bounds.top = 400;
    context.resetPerformanceGainStageAudit('Mixer changed.');
    assert.deepEqual(scrolls.map(options => options.top), [600, -100, -100]);
    assert.equal(context.performanceGainStageAuditStatus.textContent, 'Mixer changed.');
    assert.deepEqual(graphs, [report, null, null]);
});

test('tracking is captured before mixer input, and stopped playback remains protected', () => {
    const tracking = html.indexOf("document.addEventListener('input', rememberPerformanceGainStageSlider, true)");
    assert.ok(tracking > 0 && tracking < html.indexOf("performanceMixerCard?.addEventListener('input'"));
    assert.match(html, /document\.addEventListener\('pointerdown', rememberPerformanceGainStageSlider, true\)/);
    assert.match(html, /document\.addEventListener\('focusin', rememberPerformanceGainStageSlider, true\)/);
    assert.match(extract('runPerformanceGainStageAudit'), /resetPerformanceGainStageAudit\('Press Play/);
    assert.match(extract('startPerformanceGainStageAuditMonitor'), /preservePerformanceGainStageSliderPosition\(/);
    assert.match(extract('jumpToGainStageControl'), /scrollIntoView\(/);
    assert.doesNotMatch(extract('jumpToGainStageControl'), /preservePerformanceGainStageSliderPosition\(/);
});
