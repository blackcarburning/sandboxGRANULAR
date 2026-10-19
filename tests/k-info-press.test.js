const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function extractFunction(name) {
    const signature = `function ${name}(`;
    let start = html.indexOf(signature);
    assert.notEqual(start, -1, `Missing ${name}`);
    if (html.slice(start - 6, start) === 'async ') start -= 6;
    let parentheses = 0;
    let bodyStart = -1;
    for (let index = html.indexOf('(', start); index < html.length; index += 1) {
        if (html[index] === '(') parentheses += 1;
        if (html[index] === ')') parentheses -= 1;
        if (html[index] === '{' && parentheses === 0) { bodyStart = index; break; }
    }
    let braces = 0;
    for (let index = bodyStart; index < html.length; index += 1) {
        if (html[index] === '{') braces += 1;
        if (html[index] === '}') braces -= 1;
        if (braces === 0) return html.slice(start, index + 1);
    }
    throw new Error(`Unclosed ${name}`);
}

function load(context, names) {
    vm.createContext(context);
    vm.runInContext(names.map(extractFunction).join('\n'), context);
    return context;
}

class Target {
    constructor() { this.listeners = new Map(); }
    addEventListener(name, callback, options) {
        if (!this.listeners.has(name)) this.listeners.set(name, []);
        this.listeners.get(name).push({ callback, options });
    }
    removeEventListener(name, callback) {
        this.listeners.set(name, (this.listeners.get(name) || []).filter(entry => entry.callback !== callback));
    }
    emit(name, details = {}) {
        const event = {
            type: name, target: this,
            preventDefault: () => assert.fail('Press feedback must not prevent default behavior'),
            stopPropagation: () => assert.fail('Press feedback must not stop propagation'),
            stopImmediatePropagation: () => assert.fail('Press feedback must not stop propagation'),
            ...details
        };
        for (const listener of this.listeners.get(name) || []) listener.callback(event);
        return event;
    }
}

class Control extends Target {
    constructor(tagName = 'button', attributes = {}, parent = null) {
        super();
        this.tagName = tagName.toUpperCase();
        this.attributes = new Map(Object.entries(attributes));
        this.parent = parent;
        this.isConnected = true;
        this.disabled = false;
        this.style = { transform: 'translateX(12px)' };
        this.classes = new Set(['active']);
        this.classList = {
            toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
            contains: name => this.classes.has(name)
        };
        this.writes = [];
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, value); this.writes.push(name); }
    removeAttribute(name) { this.attributes.delete(name); this.writes.push(name); }
    contains(target) {
        for (let candidate = target; candidate; candidate = candidate.parent) if (candidate === this) return true;
        return false;
    }
    matches(selector) {
        if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
        if (selector === ':disabled') return this.disabled || Boolean(this.parent?.matches(':disabled'));
        if (selector === '[aria-disabled="true"]') return this.getAttribute('aria-disabled') === 'true';
        if (selector === '[inert]') return this.attributes.has('inert');
        if (selector === '[role="button"]') return this.getAttribute('role') === 'button';
        if (selector === 'a[href]') return this.tagName === 'A' && this.attributes.has('href');
        const inputType = selector.match(/^input\[type="(\w+)"\]$/);
        if (inputType) return this.tagName === 'INPUT' && this.getAttribute('type') === inputType[1];
        return selector.toUpperCase() === this.tagName;
    }
    closest(selector) {
        for (let candidate = this; candidate; candidate = candidate.parent) if (candidate.matches(selector)) return candidate;
        return null;
    }
}

function infoFixture() {
    const elements = new Map([
        ['globalBpmSlider', Object.assign(new Target(), { value: '120' })],
        ['globalPatternLength', Object.assign(new Target(), { value: '16' })],
        ['globalPatternLengthValue', {}],
        ['performanceBastardLoopKRecordLength', { value: '8' }]
    ]);
    const meta = new Control('div');
    meta.textContent = '';
    elements.set('performanceBastardLoopKMeta', meta);
    const buffer = { duration: 4, sampleRate: 48000 };
    const context = {
        document: { getElementById: id => elements.get(id) || null }, window: {},
        bastardLoopKBuffer: buffer, bastardLoopKRawBuffer: buffer,
        bastardLoopKMetadata: { durationSeconds: 4, summary: '4.00s grain loop · 120 BPM' },
        bastardLoopKSourceBpm: 120, sequencerBPM: 120,
        bastardLoopKPreserveDuration: true, bastardLoopKPitchSemitones: 0, bastardLoopKFineCents: 0,
        bastardLoopKReverse: false, bastardLoopKRecordingState: 'idle', bastardLoopKRecordStatus: '',
        PATTERN_STEPS_PER_BAR: 16, DEFAULT_REMEMBERED_PATTERN_LENGTH_STEPS: 16, DEFAULT_PATTERN_LENGTH_STEPS: 16,
        MIN_PATTERN_LENGTH_STEPS: 8, MAX_PATTERN_LENGTH_STEPS: 64,
        GLOBAL_BPM_MIN: 40, GLOBAL_BPM_MAX: 300,
        getBastardLoopPitchRatioFromParts: (octave, semitone, cents) => 2 ** ((semitone + cents / 100) / 12),
        formatBastardLoopPitchSemitones: value => `${value} st`, formatBastardLoopFineCents: value => `${value} c`,
        saveState() {}, setStatus() {}
    };
    load(context, [
        'clampBpmValue', 'clampPatternLengthSteps', 'getPatternLengthSteps', 'getLoopBarDurationSeconds',
        'getBastardLoopTempoRate', 'resolveLoopDurationSeconds', 'getResolvedBastardLoopKDuration',
        'getBastardLoopKPitchRatio', 'getBastardLoopKPlaybackRate', 'getBastardLoopKLoopDurationSeconds',
        'getBastardLoopKSongCutWarning', 'describeBastardLoopKMeta', 'syncBastardLoopKInfo', 'syncPatternLengthControls'
    ]);
    return { context, elements, meta };
}

test('K warning compares the loaded effective duration to the pattern, not the record-length slider', () => {
    const { context, elements } = infoFixture();
    assert.match(context.getBastardLoopKSongCutWarning(), /4\.00s.*2\.00s.*Song mode cuts K at pattern end/);
    elements.get('performanceBastardLoopKRecordLength').value = '1';
    assert.match(context.getBastardLoopKSongCutWarning(), /Song mode cuts/);
    elements.get('globalPatternLength').value = '32';
    assert.equal(context.getBastardLoopKSongCutWarning(), '');
    elements.get('globalPatternLength').value = '8';
    assert.match(context.getBastardLoopKSongCutWarning(), /1\.00s pattern/);
    context.bastardLoopKBuffer = { duration: .5, sampleRate: 48000 };
    assert.equal(context.getBastardLoopKSongCutWarning(), '');
});

test('K warning follows resolved loop bounds, tempo-rate caps, sampler pitch, fine tune and preserve-duration', () => {
    const { context, elements } = infoFixture();
    context.bastardLoopKPitchSemitones = 12;
    context.bastardLoopKPreserveDuration = false;
    assert.equal(context.getBastardLoopKSongCutWarning(), '');
    context.bastardLoopKPreserveDuration = true;
    assert.match(context.getBastardLoopKSongCutWarning(), /4\.00s/);
    context.bastardLoopKPreserveDuration = false;
    context.bastardLoopKFineCents = -100;
    assert.match(context.getBastardLoopKSongCutWarning(), /Song mode cuts/);
    context.bastardLoopKFineCents = 0;
    context.bastardLoopKPitchSemitones = 0;
    context.bastardLoopKMetadata.durationSeconds = 2;
    assert.equal(context.getBastardLoopKSongCutWarning(), '');
    context.bastardLoopKMetadata.durationSeconds = 8;
    assert.match(context.getBastardLoopKSongCutWarning(), /4\.00s/);
    context.bastardLoopKMetadata.durationSeconds = 4;
    context.bastardLoopKSourceBpm = 40;
    assert.equal(context.getBastardLoopKSongCutWarning(), '');
    elements.get('globalBpmSlider').value = '300';
    assert.match(context.getBastardLoopKSongCutWarning(), /1\.00s.*0\.80s/);
});

test('one-frame rounding does not falsely warn at a pattern boundary', () => {
    const { context } = infoFixture();
    context.bastardLoopKMetadata.durationSeconds = 8;
    context.bastardLoopKBuffer = { duration: 2 + 1 / 48000, sampleRate: 48000 };
    assert.equal(context.getBastardLoopKSongCutWarning(), '');
    context.bastardLoopKBuffer.duration += .001;
    assert.match(context.getBastardLoopKSongCutWarning(), /Song mode cuts/);
});

test('K info retains recording status, explains truncation in words, and clears its warning for empty audio', () => {
    const { context, meta } = infoFixture();
    for (const state of ['idle', 'countin', 'recording', 'processing']) {
        context.bastardLoopKRecordingState = state;
        context.bastardLoopKRecordStatus = 'Taking keyboard grains';
        context.syncBastardLoopKInfo();
        assert.match(meta.textContent, /Song mode cuts K at pattern end/);
        assert.equal(meta.classList.contains('k-song-cut-warning'), true);
        if (state !== 'idle') assert.match(meta.textContent, /Taking keyboard grains/);
    }
    context.bastardLoopKRecordingState = 'idle';
    context.bastardLoopKBuffer = null;
    context.syncBastardLoopKInfo();
    assert.match(meta.textContent, /Song mode cuts/);
    context.bastardLoopKRawBuffer = null;
    context.syncBastardLoopKInfo();
    assert.doesNotMatch(meta.textContent, /Song mode cuts/);
    assert.equal(meta.classList.contains('k-song-cut-warning'), false);
});

test('pattern input/change and programmatic recall refresh K info without touching audio playback', () => {
    const { context, elements, meta } = infoFixture();
    const start = html.indexOf("        document.getElementById('globalPatternLength')?.addEventListener('input'");
    const end = html.indexOf('        function getSourceSlotConfig(', start);
    assert.ok(start > 0 && end > start);
    vm.runInContext(html.slice(start, end), context);
    const pattern = elements.get('globalPatternLength');
    pattern.value = '32';
    pattern.emit('input', { target: pattern });
    assert.equal(meta.classList.contains('k-song-cut-warning'), false);
    pattern.value = '8';
    pattern.emit('change', { target: pattern });
    assert.match(meta.textContent, /1\.00s pattern/);
    context.syncPatternLengthControls(32, { skipSave: true });
    assert.equal(meta.classList.contains('k-song-cut-warning'), false);
    context.syncPatternLengthControls(16, { skipSave: true });
    assert.equal(meta.classList.contains('k-song-cut-warning'), true);
});

test('tempo synchronization and restored waveform refresh update K info even without a live K source', () => {
    const { context, elements, meta } = infoFixture();
    const tempoSource = extractFunction('syncAllBastardLoopTempos');
    for (const match of tempoSource.matchAll(/\b(sync\w+)\(/g)) {
        if (match[1] !== 'syncBastardLoopKInfo') context[match[1]] = () => {};
    }
    load(context, ['syncAllBastardLoopTempos', 'syncBastardLoopKTempo', 'drawBastardLoopKWaveform']);
    context.bastardLoopKSourceBpm = 40;
    context.syncAllBastardLoopTempos();
    assert.equal(meta.classList.contains('k-song-cut-warning'), false);
    elements.get('globalBpmSlider').value = '300';
    context.syncAllBastardLoopTempos();
    assert.equal(meta.classList.contains('k-song-cut-warning'), true);
    context.bastardLoopKSource = null;
    context.bastardLoopKMetadata.durationSeconds = .5;
    context.syncBastardLoopKTempo();
    assert.equal(meta.classList.contains('k-song-cut-warning'), false);
    context.bastardLoopKMetadata.durationSeconds = 4;
    context.drawBastardLoopKWaveform();
    assert.equal(meta.classList.contains('k-song-cut-warning'), true);
});

test('K info does not rewrite its polite live region when the text has not changed', () => {
    const { context, meta } = infoFixture();
    let writes = 0;
    let text = '';
    Object.defineProperty(meta, 'textContent', { get: () => text, set: value => { text = value; writes += 1; } });
    context.syncBastardLoopKInfo();
    context.syncBastardLoopKInfo();
    assert.equal(writes, 1);
    assert.match(html, /id="performanceBastardLoopKMeta"[^>]*role="status"[^>]*aria-live="polite"/);
});

function pressFixture(pointerEvents = true) {
    const root = new Target();
    root.hidden = false;
    const host = new Target();
    const timers = new Map();
    const observers = [];
    let clock = 0;
    let timerId = 0;
    host.performance = { now: () => clock };
    host.setTimeout = (callback, delay) => { timerId += 1; timers.set(timerId, { callback, due: clock + delay }); return timerId; };
    host.clearTimeout = id => timers.delete(id);
    if (pointerEvents) host.PointerEvent = class {};
    const context = {
        MutationObserver: class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe() {} disconnect() { this.disconnected = true; }
        }
    };
    load(context, ['installControlPressFeedback']);
    const destroy = context.installControlPressFeedback(root, host);
    const advance = elapsed => {
        const until = clock + elapsed;
        while (timers.size) {
            const [id, timer] = [...timers].sort((left, right) => left[1].due - right[1].due)[0];
            if (timer.due > until) break;
            timers.delete(id); clock = timer.due; timer.callback();
        }
        clock = until;
    };
    const pointer = (name, control, details = {}) => root.emit(name, { target: control, pointerId: 1, button: 0, clientX: 10, clientY: 10, ...details });
    return { root, host, timers, observers, advance, pointer, destroy };
}

test('shared pointer feedback covers dynamic native, input, ARIA, link and disclosure controls without changing semantics or layout', () => {
    const { root, pointer, advance } = pressFixture();
    for (const [tag, attributes] of [
        ['button', {}], ['input', { type: 'button' }], ['input', { type: 'submit' }],
        ['input', { type: 'reset' }], ['input', { type: 'image' }],
        ['div', { role: 'button', 'aria-pressed': 'true' }], ['a', { href: '/manual' }], ['summary', {}]
    ]) {
        const control = new Control(tag, attributes);
        const child = new Control('span', {}, control);
        pointer('pointerdown', child);
        assert.equal(control.getAttribute('data-ui-pressed'), 'true', tag);
        assert.equal(control.style.transform, 'translateX(12px)');
        assert.equal(control.classList.contains('active'), true);
        pointer('pointerup', child);
        root.emit('click', { target: child });
        advance(139);
        assert.equal(control.getAttribute('data-ui-pressed'), 'true');
        advance(1);
        assert.equal(control.getAttribute('data-ui-pressed'), null);
        assert.ok(control.writes.every(name => name === 'data-ui-pressed'));
        assert.equal(control.getAttribute('aria-pressed'), attributes['aria-pressed'] ?? null);
    }
    const textInput = new Control('input', { type: 'text' });
    pointer('pointerdown', textInput);
    assert.equal(textInput.getAttribute('data-ui-pressed'), null);
});

test('Enter and Space give temporary keyboard feedback while keyup, focusout and pointer holds stay independent', () => {
    const { root, pointer, advance } = pressFixture();
    const control = new Control('button', { 'aria-pressed': 'false' });
    for (const key of ['Enter', ' ']) {
        root.emit('keydown', { target: control, key });
        assert.equal(control.getAttribute('data-ui-pressed'), 'true');
        root.emit('keydown', { target: control, key, repeat: true });
        advance(200);
        root.emit('keyup', { target: control, key });
        assert.equal(control.getAttribute('data-ui-pressed'), null);
    }
    pointer('pointerdown', control);
    root.emit('keydown', { target: control, key: ' ' });
    pointer('pointerup', control);
    advance(200);
    assert.equal(control.getAttribute('data-ui-pressed'), 'true');
    root.emit('focusout', { target: control });
    assert.equal(control.getAttribute('data-ui-pressed'), null);
    assert.equal(control.getAttribute('aria-pressed'), 'false');
    root.emit('keydown', { target: control, key: 'C' });
    assert.equal(control.getAttribute('data-ui-pressed'), null);
});

test('disabled, ARIA-disabled, inherited disabled and inert controls never enter the pressed state', () => {
    const { root, pointer } = pressFixture();
    const disabled = new Control(); disabled.disabled = true;
    const disabledParent = new Control('fieldset'); disabledParent.disabled = true;
    const controls = [disabled, new Control('div', { role: 'button', 'aria-disabled': 'true' }), new Control('button', {}, disabledParent), new Control('button', {}, new Control('div', { inert: '' }))];
    for (const control of controls) {
        pointer('pointerdown', control);
        root.emit('keydown', { target: control, key: 'Enter' });
        root.emit('click', { target: control });
        assert.equal(control.getAttribute('data-ui-pressed'), null);
    }
});

test('pointer cancellation, scroll movement, leaving the control, blur and hidden pages clear feedback safely', () => {
    const { root, host, pointer, timers } = pressFixture();
    const control = new Control();
    for (const cancel of [
        () => pointer('pointercancel', control),
        () => pointer('pointermove', control, { clientY: 40 }),
        () => pointer('pointerout', control, { relatedTarget: null }),
        () => host.emit('blur'),
        () => { root.hidden = true; root.emit('visibilitychange'); root.hidden = false; }
    ]) {
        pointer('pointerdown', control);
        cancel();
        assert.equal(control.getAttribute('data-ui-pressed'), null);
        assert.equal(timers.size, 0);
    }
    pointer('pointerdown', control, { button: 2 });
    assert.equal(control.getAttribute('data-ui-pressed'), null);
});

test('captured descendant blur does not cancel a new pointer press, but actual window blur clears it', () => {
    const { root, host, pointer, timers } = pressFixture();
    const newlyPressed = new Control('button');
    for (const previouslyFocused of [new Control('button'), new Control('input', { type: 'text' })]) {
        pointer('pointerdown', newlyPressed);
        host.emit('blur', { target: previouslyFocused });
        root.emit('focusout', { target: previouslyFocused });
        assert.equal(newlyPressed.getAttribute('data-ui-pressed'), 'true');
        assert.equal(timers.size, 0);
        host.emit('blur');
        assert.equal(newlyPressed.getAttribute('data-ui-pressed'), null);
        pointer('pointerup', newlyPressed);
        assert.equal(timers.size, 0);
    }
});

test('multi-touch and quick repeated taps do not leave stale pressed states or growing timer references', () => {
    const { pointer, advance, timers } = pressFixture();
    const control = new Control();
    pointer('pointerdown', control, { pointerId: 1 });
    pointer('pointerdown', control, { pointerId: 2 });
    pointer('pointerup', control, { pointerId: 1 });
    advance(200);
    assert.equal(control.getAttribute('data-ui-pressed'), 'true');
    pointer('pointerup', control, { pointerId: 2 });
    assert.equal(control.getAttribute('data-ui-pressed'), null);
    for (let cycle = 0; cycle < 50; cycle += 1) {
        pointer('pointerdown', control);
        pointer('pointerup', control);
        pointer('lostpointercapture', control);
        advance(5);
    }
    advance(200);
    assert.equal(control.getAttribute('data-ui-pressed'), null);
    assert.equal(timers.size, 0);
});

test('dynamic removal or disabling clears feedback, and teardown removes delegated listeners and pending work', () => {
    const { root, host, pointer, observers, destroy, timers } = pressFixture();
    const control = new Control();
    pointer('pointerdown', control);
    control.disabled = true;
    observers[0].callback();
    assert.equal(control.getAttribute('data-ui-pressed'), null);
    control.disabled = false;
    pointer('pointerdown', control);
    control.isConnected = false;
    observers[0].callback();
    assert.equal(control.getAttribute('data-ui-pressed'), null);
    control.isConnected = true;
    pointer('pointerdown', control);
    pointer('pointerup', control);
    destroy();
    assert.equal(control.getAttribute('data-ui-pressed'), null);
    assert.equal(timers.size, 0);
    assert.ok([...root.listeners.values(), ...host.listeners.values()].every(listeners => listeners.length === 0));
    assert.equal(observers[0].disconnected, true);
});

test('legacy touch/mouse and assistive click paths get feedback without blocking default actions', () => {
    const { root, advance } = pressFixture(false);
    const control = new Control();
    const touch = { identifier: 4, target: control, clientX: 0, clientY: 0 };
    root.emit('touchstart', { changedTouches: [touch] });
    assert.equal(control.getAttribute('data-ui-pressed'), 'true');
    root.emit('touchend', { changedTouches: [touch] });
    advance(150);
    assert.equal(control.getAttribute('data-ui-pressed'), null);
    root.emit('touchstart', { changedTouches: [touch] });
    root.emit('touchcancel', { changedTouches: [touch] });
    assert.equal(control.getAttribute('data-ui-pressed'), null);
    root.emit('mousedown', { target: control, button: 0, clientX: 0, clientY: 0 });
    root.emit('mouseup', { target: control });
    advance(150);
    root.emit('click', { target: control });
    assert.equal(control.getAttribute('data-ui-pressed'), 'true');
    advance(150);
    assert.equal(control.getAttribute('data-ui-pressed'), null);
    assert.ok([...root.listeners.values()].flat().every(entry => entry.options.capture && entry.options.passive));
});

test('K purple and universal pressed CSS do not alter transforms or semantic toggle classes, and inline scripts parse', () => {
    const purpleRule = html.match(/#bastardLoopKCard\.performance-feature-card\.performance-vocal-card\s*\{([^}]+)\}/);
    assert.ok(purpleRule);
    assert.match(purpleRule[1], /background:\s*#482568/);
    const pressedRule = html.match(/\[data-ui-pressed="true"\][^{]*\{([^}]+)\}/);
    assert.ok(pressedRule);
    assert.match(pressedRule[1], /outline:.*!important/);
    assert.match(pressedRule[1], /box-shadow:.*!important/);
    assert.doesNotMatch(pressedRule[1], /transform|width|animation|transition/);
    assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
    let parsed = 0;
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/\bsrc\s*=/.test(script[1]) || /\btype\s*=\s*["']application\//.test(script[1])) continue;
        new vm.Script(script[2], { filename: `index-inline-${parsed}.js` });
        parsed += 1;
    }
    assert.ok(parsed > 0);
});
