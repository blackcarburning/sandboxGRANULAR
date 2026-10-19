const test = require('node:test');
const assert = require('node:assert/strict');
const cut = require('../vocal-loop-cut.js');

const context = { createBuffer(channels, length, sampleRate) {
    const samples = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, sampleRate, duration: length / sampleRate, numberOfChannels: channels, getChannelData: channel => samples[channel] };
} };

function tone(sampleRate, frequencies = [440, 440], seconds = 2) {
    const buffer = context.createBuffer(frequencies.length, Math.round(seconds * sampleRate), sampleRate);
    frequencies.forEach((frequency, channel) => {
        const samples = buffer.getChannelData(channel);
        for (let frame = 0; frame < samples.length; frame += 1) samples[frame] = .6 * Math.sin(2 * Math.PI * frequency * frame / sampleRate);
    });
    return buffer;
}

function frequency(samples, sampleRate, start, end) {
    const crossings = [];
    for (let frame = Math.round(start * sampleRate) + 1; frame < Math.round(end * sampleRate); frame += 1) {
        if (samples[frame - 1] <= 0 && samples[frame] > 0) crossings.push(frame - 1 + -samples[frame - 1] / (samples[frame] - samples[frame - 1]));
    }
    return (crossings.length - 1) * sampleRate / (crossings.at(-1) - crossings[0]);
}

function assertSilent(samples, start, end) {
    for (let frame = start; frame < end; frame += 1) assert.equal(samples[frame], 0, `silence at ${frame}`);
}

test('stretch is strictly opt-in; old cuts and invalid sources retain backward defaults', () => {
    for (const stretch of [undefined, null, false, 0, 1, 'true', 'false', [], {}]) {
        const settings = cut.normalize({ start: .375, end: .625, stretch });
        assert.equal(settings.stretch, false);
        assert.equal(settings.targetStart, null);
        assert.equal(settings.targetDuration, null);
    }
    assert.deepEqual(cut.normalize({ start: .9, end: .1, stretch: true, targetStart: .3, targetDuration: .2 }), cut.normalize());
});

test('turning stretch on captures effective placement and duration in every legacy mode', () => {
    for (const fromStart of [false, true]) for (const repeat of [false, true]) {
        const original = cut.normalize({ enabled: true, start: .375, end: .625, fromStart, repeat });
        const enabled = cut.setStretch(original, true);
        assert.equal(enabled.start, original.start);
        assert.equal(enabled.end, original.end);
        assert.equal(enabled.targetStart, fromStart ? 0 : .375);
        assert.equal(enabled.targetDuration, .25);
        assert.equal(enabled.repeat, repeat);
        assert.deepEqual(cut.normalize(JSON.parse(JSON.stringify(enabled))), enabled);
    }
});

test('persisted destination coordinates are finite, positive and clamped within the loop', () => {
    const original = { enabled: true, stretch: true, start: .375, end: .625 };
    for (const invalid of [NaN, Infinity, -Infinity, null, '', 'bad', [], {}, true]) {
        const settings = cut.normalize({ ...original, targetStart: invalid, targetDuration: invalid });
        assert.equal(settings.targetStart, .375);
        assert.equal(settings.targetDuration, .25);
    }
    for (const targetDuration of [0, -.1]) {
        assert.equal(cut.normalize({ ...original, targetStart: 0, targetDuration }).targetDuration, .25);
    }
    const whole = cut.normalize({ ...original, targetStart: 9, targetDuration: 3 });
    assert.deepEqual(cut.region(whole), { start: 0, end: 1, duration: 1 });
    assert.equal(cut.normalize({ ...original, targetStart: -3, targetDuration: .2 }).targetStart, 0);
    assert.equal(cut.normalize({ ...original, targetStart: .99, targetDuration: .2 }).targetStart, .8);
    assert.equal(cut.normalize({ ...original, targetStart: .5, targetDuration: .2, fromStart: true }).targetStart, 0);
});

test('move, end resize, snap and from-start change only destination coordinates', () => {
    const settings = cut.normalize({ enabled: true, stretch: true, start: .375, end: .625, fromStart: true });
    const moved = cut.moveBoundary(settings, 'start', .28, 1 / 16);
    assert.deepEqual(cut.region(moved), { start: .25, end: .5, duration: .25 });
    assert.equal(moved.fromStart, false);
    const right = cut.moveBoundary(moved, 'start', 2);
    assert.deepEqual(cut.region(right), { start: .75, end: 1, duration: .25 });
    const left = cut.moveBoundary(right, 'start', -2);
    assert.deepEqual(cut.region(left), { start: 0, end: .25, duration: .25 });
    const expanded = cut.moveBoundary(left, 'end', .51, 1 / 16);
    assert.deepEqual(cut.region(expanded), { start: 0, end: .5, duration: .5 });
    const shrunk = cut.moveBoundary(expanded, 'end', -1, 0, 1 / 48000);
    assert.equal(shrunk.targetDuration, 1 / 48000);
    const pinned = cut.setFromStart(right, true);
    assert.equal(pinned.targetStart, 0);
    assert.equal(pinned.targetDuration, .25);
    for (const state of [settings, moved, right, left, expanded, shrunk, pinned]) {
        assert.equal(state.start, .375);
        assert.equal(state.end, .625);
    }
    assert.deepEqual(cut.moveBoundary(settings, 'start', NaN), settings);
});

test('stretch off retains mapping for intentional reuse; source edits and Reset clear it', () => {
    const edited = cut.moveBoundary(cut.normalize({ enabled: true, stretch: true, start: .375, end: .625 }), 'end', .875);
    const off = cut.setStretch(edited, false);
    assert.deepEqual(cut.region(off), { start: .375, end: .625, duration: .25 });
    assert.deepEqual(cut.setStretch(off, true), edited);
    const changedSource = cut.moveBoundary(off, 'start', .25);
    assert.equal(changedSource.targetStart, null);
    assert.equal(changedSource.targetDuration, null);
    const recaptured = cut.setStretch(changedSource, true);
    assert.equal(recaptured.targetStart, .25);
    assert.equal(recaptured.targetDuration, .375);
    assert.equal(cut.normalize().targetStart, null);
    assert.equal(cut.normalize().stretch, false);
});

for (const sampleRate of [44100, 48000]) {
    for (const ratio of [.5, 2]) {
        for (const frequencies of [[440, 440], [220, 330]]) {
            test(`${sampleRate} Hz stereo ${frequencies.join('/')} Hz retains pitch at ${ratio}x duration`, () => {
                const source = tone(sampleRate, frequencies);
                const originals = frequencies.map((unused, channel) => source.getChannelData(channel).slice());
                const settings = cut.normalize({ enabled: true, stretch: true, start: .375, end: .625, targetStart: .125, targetDuration: .25 * ratio });
                const result = cut.gate(context, source, settings);
                const start = .25;
                const end = start + .5 * ratio;
                assert.equal(result.length, source.length);
                assert.equal(result.duration, source.duration);
                assert.equal(result.sampleRate, sampleRate);
                assert.equal(result.numberOfChannels, 2);
                frequencies.forEach((expected, channel) => {
                    const samples = result.getChannelData(channel);
                    const measured = frequency(samples, sampleRate, start + .03, end - .03);
                    assert.ok(Math.abs(measured - expected) < 6, `${measured} Hz, expected ${expected} Hz`);
                    assertSilent(samples, 0, Math.round(start * sampleRate));
                    assertSilent(samples, Math.round(end * sampleRate), source.length);
                    assert.ok(samples.every(sample => Number.isFinite(sample) && Math.abs(sample) <= .60001));
                    assert.deepEqual(source.getChannelData(channel), originals[channel]);
                });
            });
        }
    }
}

test('stereo anti-phase alignment is shared, with no mono cancellation or independent channel drift', () => {
    const source = tone(48000);
    for (let frame = 0; frame < source.length; frame += 1) source.getChannelData(1)[frame] = -source.getChannelData(0)[frame];
    const result = cut.gate(context, source, { enabled: true, stretch: true, start: .375, end: .625, targetStart: 0, targetDuration: .5 });
    const left = result.getChannelData(0);
    const right = result.getChannelData(1);
    assert.ok(left.some(sample => Math.abs(sample) > .5));
    for (let frame = 0; frame < result.length; frame += 1) assert.equal(left[frame] + right[frame], 0);
});

test('same-ratio movement is an exact PCM copy; repeat uses edited duration and fades each section', () => {
    const source = context.createBuffer(2, 32, 16);
    for (let channel = 0; channel < 2; channel += 1) source.getChannelData(channel).set(Array.from({ length: 32 }, (unused, frame) => (frame + 1) * (channel ? -1 : 1)));
    const settings = { enabled: true, stretch: true, start: .375, end: .625, targetStart: 0, targetDuration: .25 };
    const result = cut.gate(context, source, settings, source.duration, 0);
    assert.deepEqual([...result.getChannelData(0).subarray(0, 8)], [...source.getChannelData(0).subarray(12, 20)]);
    assertSilent(result.getChannelData(0), 8, 32);
    const resized = cut.gate(context, source, { ...settings, targetStart: .125, targetDuration: .5, repeat: true }, source.duration, 0);
    assert.deepEqual([...resized.getChannelData(0).subarray(4, 20)], [13, 14, 15, 16, 17, 18, 19, 20, 13, 14, 15, 16, 17, 18, 19, 20]);
    assert.deepEqual([...resized.getChannelData(0).subarray(20)], [...resized.getChannelData(0).subarray(4, 16)]);
    const constant = context.createBuffer(1, 48000, 48000);
    constant.getChannelData(0).fill(.5);
    const faded = cut.gate(context, constant, { ...settings, repeat: true, targetStart: .125, targetDuration: .25 }).getChannelData(0);
    for (const first of [6000, 18000, 30000, 42000]) {
        assert.equal(faded[first], 0);
        assert.equal(faded[Math.min(first + 12000, 48000) - 1], 0);
        assert.ok(Math.abs(faded[first + 192] - .5) < .000001);
    }
});

test('silence, tiny selections, extreme ratios and metadata-limited loops remain finite and bounded', () => {
    for (const sampleRate of [44100, 48000]) {
        const source = context.createBuffer(2, sampleRate, sampleRate);
        source.getChannelData(1).fill(.25);
        for (const [start, end, targetDuration] of [[.5, .50001, .8], [0, 1, 1 / sampleRate], [.25, .3, .9]]) {
            const result = cut.gate(context, source, { enabled: true, stretch: true, start, end, targetStart: 0, targetDuration }, .5);
            assert.equal(result.length, sampleRate);
            for (let channel = 0; channel < 2; channel += 1) {
                const samples = result.getChannelData(channel);
                assert.ok(samples.every(sample => Number.isFinite(sample) && sample >= 0 && sample <= .25001));
                assertSilent(samples, Math.round(sampleRate * .5), sampleRate);
            }
            assertSilent(result.getChannelData(0), 0, sampleRate);
        }
    }
});

test('derived cache separates source, destination, duration, mode, repeat, context and reset', () => {
    const source = tone(1000);
    const settings = cut.normalize({ enabled: true, stretch: true, start: .375, end: .625 });
    const original = cut.gate(context, source, settings);
    assert.equal(cut.gate(context, source, { ...settings, snap: false, grid: 1 }), original);
    for (const patch of [{ start: .25 }, { end: .75 }, { targetStart: 0 }, { targetDuration: .5 }, { stretch: false }, { repeat: true }, { fromStart: true }]) {
        assert.notEqual(cut.gate(context, source, { ...settings, ...patch }), original);
    }
    assert.notEqual(cut.gate({ ...context }, source, settings), original);
    assert.equal(cut.gate(context, source, cut.normalize()), source);
    assert.equal(cut.gate(context, source, { ...settings, enabled: false }), source);
});

test('source cursor maps destination timing back to selected PCM and hides during one-shot silence', () => {
    const settings = { enabled: true, stretch: true, start: .375, end: .625, targetStart: .125, targetDuration: .5 };
    assert.equal(cut.sourcePhase(settings, .1), null);
    assert.equal(cut.sourcePhase(settings, .125), .375);
    assert.equal(cut.sourcePhase(settings, .375), .5);
    assert.equal(cut.sourcePhase(settings, .625), null);
    assert.equal(cut.sourcePhase({ ...settings, repeat: true }, .625), .375);
    assert.equal(cut.sourcePhase({ ...settings, enabled: false }, .75), .75);
});

function editorHarness(run) {
    const previousDocument = globalThis.document;
    const previousCancel = globalThis.cancelAnimationFrame;
    const elements = new Map();
    const calls = [];
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            hidden: true, style: {}, attributes: {}, listeners: {}, classList: { toggle() {} },
            addEventListener(name, listener) { this.listeners[name] = listener; },
            setAttribute(name, value) { this.attributes[name] = value; },
            getBoundingClientRect() { return { left: 0, width: 1000 }; },
            setPointerCapture() {}, append() {}, focus() {}
        });
        return elements.get(id);
    };
    globalThis.document = { getElementById: element, createElement: () => ({}) };
    globalThis.cancelAnimationFrame = () => {};
    let settings = cut.normalize({ enabled: true, start: .375, end: .625, snap: false });
    const editor = new cut.Editor({
        settings: () => settings,
        set(value, options = {}) { settings = cut.normalize(value); calls.push({ settings, preview: Boolean(options.preview) }); },
        timing: () => ({ cycle: 2, bar: 1, frames: 96000 }),
        buffer: () => ({}), stop: () => calls.push('stop')
    });
    editor.draw = () => {};
    element('bastardLoopVCutOverlay').hidden = false;
    const fire = (id, name, patch = {}) => element(id).listeners[name]({ button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {}, ...patch });
    try { run({ editor, element, fire, calls, settings: () => settings }); }
    finally { globalThis.document = previousDocument; globalThis.cancelAnimationFrame = previousCancel; }
}

test('editor uses destination fields, accessible keyboard moves, independent toggles and reset', () => editorHarness(({ element, fire, settings }) => {
    fire('bastardLoopVCutStretch', 'click');
    assert.equal(element('bastardLoopVCutStretch').attributes['aria-pressed'], 'true');
    assert.equal(element('bastardLoopVCutStartSeconds').attributes['aria-label'], 'Destination start in seconds');
    fire('bastardLoopVCutStartSeconds', 'change', { target: { value: '0' } });
    fire('bastardLoopVCutEndSeconds', 'change', { target: { value: '1' } });
    assert.deepEqual(cut.region(settings()), { start: 0, end: .5, duration: .5 });
    fire('bastardLoopVCutStart', 'keydown', { key: 'ArrowRight' });
    assert.equal(settings().targetStart, .001);
    assert.equal(settings().targetDuration, .5);
    fire('bastardLoopVCutEnd', 'keydown', { key: 'ArrowRight' });
    assert.equal(settings().targetDuration, .501);
    fire('bastardLoopVCutStart', 'keydown', { key: 'End' });
    assert.equal(cut.region(settings()).end, 1);
    fire('bastardLoopVCutFromStart', 'click');
    assert.equal(settings().targetStart, 0);
    fire('bastardLoopVCutRepeat', 'click');
    assert.equal(settings().repeat, true);
    assert.equal(settings().fromStart, true);
    fire('bastardLoopVCutStart', 'keydown', { key: 'ArrowRight', shiftKey: true });
    assert.equal(settings().fromStart, false);
    assert.equal(settings().targetStart, .01);
    assert.equal(settings().start, .375);
    assert.equal(settings().end, .625);
    fire('bastardLoopVCutStretch', 'click');
    assert.equal(element('bastardLoopVCutStartSeconds').attributes['aria-label'], 'Source start in seconds');
    fire('bastardLoopVCutStretch', 'click');
    assert.equal(settings().targetStart, .01);
    fire('bastardLoopVCutReset', 'click');
    assert.deepEqual(settings(), cut.normalize({ snap: false }));
}));

for (const finish of ['pointerup', 'pointercancel', 'lostpointercapture', 'close']) {
    test(`pointer ${finish} commits exactly once after body previews, without source edits`, () => editorHarness(({ editor, fire, calls, settings }) => {
        fire('bastardLoopVCutStretch', 'click');
        calls.length = 0;
        fire('bastardLoopVCutTimeline', 'pointerdown', { clientX: 450 });
        for (const clientX of [400, 350, 300, 200, 75]) fire('bastardLoopVCutTimeline', 'pointermove', { clientX });
        assert.equal(settings().targetStart, 0);
        assert.equal(settings().targetDuration, .25);
        assert.equal(settings().start, .375);
        assert.equal(settings().end, .625);
        assert.equal(calls.length, 5);
        assert.ok(calls.every(call => call.preview));
        if (finish === 'close') editor.close();
        else fire('bastardLoopVCutTimeline', finish);
        fire('bastardLoopVCutTimeline', 'lostpointercapture');
        assert.equal(calls.filter(call => typeof call === 'object' && !call.preview).length, 1);
    }));
}

test('end pointer resizing preserves captured source and only previews until release', () => editorHarness(({ fire, calls, settings }) => {
    fire('bastardLoopVCutStretch', 'click');
    calls.length = 0;
    fire('bastardLoopVCutEnd', 'pointerdown', { clientX: 625 });
    fire('bastardLoopVCutEnd', 'pointermove', { clientX: 875 });
    assert.equal(settings().targetStart, .375);
    assert.equal(settings().targetDuration, .5);
    assert.equal(settings().start, .375);
    assert.equal(settings().end, .625);
    assert.equal(calls[0].preview, true);
    fire('bastardLoopVCutEnd', 'pointerup');
    assert.equal(calls[1].preview, false);
}));
