const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Controller } = require('../q-card.js');

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

function drawerFixture() {
    const classes = new Set(['is-open', 'is-settling']);
    const listeners = new Map();
    const attributes = new Map();
    const timers = new Map();
    let nextTimer = 0;
    const document = { activeElement: null, querySelectorAll: () => [], addEventListener() {} };
    const handle = { setAttribute: (key, value) => attributes.set(key, value), addEventListener() {}, blur: () => { document.activeElement = null; } };
    const drawer = {
        classList: { contains: value => classes.has(value), add: value => classes.add(value), remove: value => classes.delete(value), toggle: (value, active) => active ? classes.add(value) : classes.delete(value) },
        addEventListener: (type, listener, options) => listeners.set(type, { listener, options }),
        contains: target => target === handle
    };
    document.getElementById = id => ({ sectionJumpDrawer: drawer, sectionJumpHandle: handle })[id];
    const context = vm.createContext({ document, window: { clearTimeout: timer => timers.delete(timer), setTimeout: (handler, delay) => { const timer = ++nextTimer; timers.set(timer, { handler, delay }); return timer; } } });
    vm.runInContext(extract('initSectionJumpDrawer'), context);
    context.initSectionJumpDrawer();
    return { context, classes, listeners, attributes, timers, document, handle };
}

test('closing a sequencer collapses the drawer and guards it for 450 ms without polling', () => {
    const { context, classes, attributes, timers, document, handle } = drawerFixture();
    document.activeElement = handle;
    context.window.guardSectionJumpAfterOverlayClose();
    assert.deepEqual([...classes], ['is-close-guarded']);
    assert.equal(attributes.get('aria-expanded'), 'false');
    assert.equal(document.activeElement, null);
    assert.equal(timers.size, 1);
    const timer = [...timers.values()][0];
    assert.equal(timer.delay, 450);
    timer.handler();
    assert.equal(classes.has('is-close-guarded'), false);
});

test('the close guard captures delayed touch, pointer, mouse, click and focus events only while active', () => {
    const { context, listeners, timers, document, handle } = drawerFixture();
    context.window.guardSectionJumpAfterOverlayClose();
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'focusin']) {
        const { listener, options } = listeners.get(type);
        assert.equal(options.capture, true);
        assert.equal(options.passive, false);
        const calls = [];
        document.activeElement = handle;
        listener({ preventDefault: () => calls.push('prevent'), stopImmediatePropagation: () => calls.push('stop') });
        assert.deepEqual(calls, ['prevent', 'stop']);
        assert.equal(document.activeElement, null);
    }
    [...timers.values()][0].handler();
    listeners.get('click').listener({ preventDefault: () => assert.fail('Normal navigation blocked'), stopImmediatePropagation: () => assert.fail('Normal navigation blocked') });
});

test('a second editor close restarts the cooldown and clears the older timeout', () => {
    const { context, timers } = drawerFixture();
    context.window.guardSectionJumpAfterOverlayClose();
    const first = [...timers.keys()][0];
    context.window.guardSectionJumpAfterOverlayClose();
    assert.equal(timers.size, 1);
    assert.equal(timers.has(first), false);
    assert.equal([...timers.values()][0].delay, 450);
});

for (const pointerEvents of [true, false]) {
    test(`L/X touch Close waits for the completed click (not touch release) (${pointerEvents ? 'pointer' : 'touch fallback'})`, () => {
        const handlers = new Map();
        let closed = 0;
        const context = vm.createContext({ Date, window: { PointerEvent: pointerEvents ? function PointerEvent() {} : undefined } });
        for (const name of ['computeBastardLoopLMobileTapState', 'bindBastardLoopOverlayClose']) vm.runInContext(extract(name), context);
        context.bindBastardLoopOverlayClose({ addEventListener: (type, handler) => handlers.set(type, handler) }, () => { closed += 1; });
        assert.equal(handlers.has('pointerdown'), false);
        assert.equal(handlers.has('touchstart'), false);
        const event = { button: 0, pointerType: 'touch', preventDefault() {}, stopPropagation() {} };
        assert.equal(closed, 0);
        assert.equal(handlers.has('pointerup'), false);
        assert.equal(handlers.has('touchend'), false);
        handlers.get('click')(event);
        assert.equal(closed, 1);
    });
}

test('L/X mouse close remains click-driven, not mouse-down or pointer-up driven', () => {
    const handlers = new Map();
    let closed = 0;
    const context = vm.createContext({ Date, window: { PointerEvent: function PointerEvent() {} } });
    for (const name of ['computeBastardLoopLMobileTapState', 'bindBastardLoopOverlayClose']) vm.runInContext(extract(name), context);
    context.bindBastardLoopOverlayClose({ addEventListener: (type, handler) => handlers.set(type, handler) }, () => { closed += 1; });
    const event = { button: 0, pointerType: 'mouse', preventDefault() {}, stopPropagation() {} };
    assert.equal(handlers.has('pointerup'), false);
    assert.equal(handlers.has('touchend'), false);
    assert.equal(closed, 0);
    handlers.get('click')(event);
    assert.equal(closed, 1);
});

for (const name of ['closeBastardLoopLOverlay', 'closeBastardLoopXOverlay', 'closeDrumMachineOverlay', 'closeSynthPopup']) {
    test(`${name} guards only a visible editor, without changing transport`, () => {
        const overlay = { hidden: false, setAttribute() {} };
        let guards = 0;
        const context = vm.createContext({
            window: { guardSectionJumpAfterOverlayClose: () => { guards += 1; } }, synthPopupOverlay: overlay,
            document: { getElementById: id => id.endsWith('Overlay') ? overlay : null, querySelector: () => null, body: { classList: { remove() {} } } },
            releaseSequencerKeyboardHolds() {},
            resetBastardLoopLStepTapMemory() {}, resetBastardLoopLCopyState() {}, resetBastardLoopLTransposeSectionState() {},
            resetBastardLoopXStepTapMemory() {}, resetBastardLoopXCopyState() {}, resetBastardLoopXTransposeSectionState() {}
        });
        vm.runInContext(extract(name), context);
        context[name]();
        assert.equal(overlay.hidden, true);
        assert.equal(guards, 1);
        context[name]();
        assert.equal(guards, 1);
    });
}

test('Q closing uses the same guard and retains focus restoration and running state', () => {
    const previousDocument = global.document;
    const previousGuard = global.guardSectionJumpAfterOverlayClose;
    const overlay = { hidden: false, setAttribute() {} };
    let guards = 0;
    let focusRestored = false;
    try {
        global.document = { getElementById: () => overlay, body: { classList: { remove() {} } } };
        global.guardSectionJumpAfterOverlayClose = () => { guards += 1; };
        const controller = new Controller({ context: () => null });
        controller.running = true;
        controller.returnFocus = { focus: () => { focusRestored = true; } };
        controller.close();
        assert.equal(guards, 1);
        assert.equal(overlay.hidden, true);
        assert.equal(controller.running, true);
        assert.equal(focusRestored, true);
        controller.close();
        assert.equal(guards, 1);
    } finally {
        if (previousDocument === undefined) delete global.document;
        else global.document = previousDocument;
        if (previousGuard === undefined) delete global.guardSectionJumpAfterOverlayClose;
        else global.guardSectionJumpAfterOverlayClose = previousGuard;
    }
});
