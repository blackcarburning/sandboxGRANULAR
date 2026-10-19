const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cut = require('../vocal-loop-cut.js');

function audioBuffer(channels = 2, length = 1600, sampleRate = 1000) {
    const samples = Array.from({ length: channels }, () => new Float32Array(length).fill(.5));
    return { length, sampleRate, duration: length / sampleRate, numberOfChannels: channels, getChannelData: channel => samples[channel] };
}

const audioContext = { createBuffer(channels, length, sampleRate) {
    const buffer = audioBuffer(channels, length, sampleRate);
    for (let channel = 0; channel < channels; channel += 1) buffer.getChannelData(channel).fill(0);
    return buffer;
} };

test('legacy, absent and invalid cut settings default to the full uncut loop', () => {
    const defaults = { enabled: false, repeat: false, fromStart: false, start: 0, end: 1, stretch: false, targetStart: null, targetDuration: null, snap: true, grid: 1 / 16 };
    assert.deepEqual(cut.normalize(), defaults);
    assert.deepEqual(cut.normalize(null), defaults);
    for (const range of [[.7, .3], [0, 0], [-.1, 1], [0, 1.1], [NaN, 1]]) {
        assert.deepEqual(cut.normalize({ enabled: true, start: range[0], end: range[1] }), defaults);
    }
});

test('from-start is opt-in, strictly boolean and disabled for invalid ranges', () => {
    for (const fromStart of [undefined, null, false, 0, 1, 'true', 'false', [], {}]) {
        assert.equal(cut.normalize({ enabled: true, start: .25, end: .5, fromStart }).fromStart, false);
    }
    assert.equal(cut.normalize({ fromStart: true }).fromStart, true);
    assert.equal(cut.normalize({ fromStart: true, start: .8, end: .2 }).fromStart, false);
    const original = cut.normalize({ enabled: true, fromStart: true, repeat: true, start: .25, end: .5 });
    assert.deepEqual(cut.normalize(JSON.parse(JSON.stringify(original))), original);
    assert.equal(cut.moveBoundary(original, 'end', .75).fromStart, true);
});

for (const channels of [1, 2]) {
    for (const [first, last] of [[6, 13], [17, 24]]) {
        for (const fromStart of [false, true]) {
            for (const repeat of [false, true]) {
                test(`${channels}-channel varying PCM ${first}–${last}: fromStart=${fromStart}, repeat=${repeat}`, () => {
                    const source = audioBuffer(channels, 32, 16);
                    for (let channel = 0; channel < channels; channel += 1) {
                        source.getChannelData(channel).set(Array.from({ length: 32 }, (unused, index) => (index + 1) * (channel ? -1 : 1) / 64));
                    }
                    const originals = Array.from({ length: channels }, (unused, channel) => source.getChannelData(channel).slice());
                    const settings = { enabled: true, fromStart, repeat, start: first / 24, end: last / 24 };
                    const result = cut.gate(audioContext, source, settings, 1.5, 0);
                    assert.equal(result.length, source.length);
                    assert.equal(result.duration, source.duration);
                    assert.equal(result.sampleRate, source.sampleRate);
                    assert.equal(result.numberOfChannels, channels);
                    const placement = fromStart ? 0 : first;
                    const end = repeat ? 24 : placement + last - first;
                    for (let channel = 0; channel < channels; channel += 1) {
                        const expected = new Float32Array(32);
                        for (let frame = placement; frame < end; frame += 1) expected[frame] = originals[channel][first + (frame - placement) % (last - first)];
                        assert.deepEqual(result.getChannelData(channel), expected);
                        assert.deepEqual(source.getChannelData(channel), originals[channel]);
                    }
                });
            }
        }
    }
}

test('placement and repeat have four independent derived-buffer cache identities', () => {
    const source = audioBuffer();
    const results = [];
    for (const fromStart of [false, true]) {
        for (const repeat of [false, true]) {
            const settings = { enabled: true, start: .25, end: .5, fromStart, repeat };
            const result = cut.gate(audioContext, source, settings);
            assert.equal(cut.gate(audioContext, source, { ...settings, snap: false, grid: 1 }), result);
            assert.equal(cut.gate(audioContext, source, { ...settings, enabled: false }), source);
            results.push(result);
        }
    }
    assert.equal(new Set(results).size, 4);
    assert.equal(cut.gate(audioContext, source, { enabled: true, fromStart: true, repeat: true, start: 0, end: 1 }), source);
});

test('both placements fade every section and truncated repeat inside the resolved loop duration', () => {
    for (const fromStart of [false, true]) {
        for (const repeat of [false, true]) {
            const source = audioBuffer(2, 1600, 1000);
            const result = cut.gate(audioContext, source, { enabled: true, fromStart, repeat, start: .5, end: .875 }, 1.2);
            const placement = fromStart ? 0 : 600;
            const end = repeat ? 1200 : placement + 450;
            for (let channel = 0; channel < 2; channel += 1) {
                const samples = result.getChannelData(channel);
                assert.ok(samples.slice(0, placement).every(value => value === 0));
                assert.ok(samples.slice(end).every(value => value === 0));
                for (let first = placement; first < end; first += 450) {
                    const last = Math.min(first + 450, end) - 1;
                    assert.equal(samples[first], 0);
                    assert.equal(samples[last], 0);
                    assert.equal(samples[first + 1], .125);
                    assert.equal(samples[first + 4], .5);
                    assert.equal(samples[last - 4], .5);
                }
                assert.ok(source.getChannelData(channel).every(value => value === .5));
            }
        }
    }
});

test('the source cursor follows relocated and repeated audio and hides in silence', () => {
    const settings = { enabled: true, start: .375, end: .5 };
    assert.equal(cut.sourcePhase(settings, null), null);
    assert.equal(cut.sourcePhase(settings, .125), null);
    assert.equal(cut.sourcePhase(settings, .4375), .4375);
    assert.equal(cut.sourcePhase(settings, .5), null);
    assert.equal(cut.sourcePhase({ ...settings, repeat: true }, .9375), .4375);
    assert.equal(cut.sourcePhase({ ...settings, fromStart: true }, 0), .375);
    assert.equal(cut.sourcePhase({ ...settings, fromStart: true }, .0625), .4375);
    assert.equal(cut.sourcePhase({ ...settings, fromStart: true }, .125), null);
    assert.equal(cut.sourcePhase({ ...settings, fromStart: true, repeat: true }, .75), .375);
    assert.equal(cut.sourcePhase({ ...settings, fromStart: true, repeat: true, enabled: false }, .75), .75);
});

test('editor toggles stay independent, describe source placement and reset both playback options', () => {
    const previousDocument = globalThis.document;
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            hidden: true, style: {}, attributes: {}, listeners: {}, classes: new Set(),
            addEventListener(event, handler) { this.listeners[event] = handler; },
            setAttribute(name, value) { this.attributes[name] = value; },
            append() {},
            classList: { toggle(name, active) { if (active) elements.get(id).classes.add(name); else elements.get(id).classes.delete(name); } }
        });
        return elements.get(id);
    };
    globalThis.document = { getElementById: element, createElement: () => ({}) };
    let settings = cut.normalize({ enabled: true, start: .375, end: .5 });
    try {
        const editor = new cut.Editor({
            settings: () => settings,
            set: value => { settings = value; },
            timing: () => ({ cycle: 1.6, bar: .8 }),
            buffer: () => ({})
        });
        editor.draw = () => {};
        element('bastardLoopVCutOverlay').hidden = false;
        element('bastardLoopVCutFromStart').listeners.click();
        assert.equal(settings.fromStart, true);
        assert.equal(settings.repeat, false);
        assert.equal(settings.start, .375);
        assert.equal(element('bastardLoopVCutFromStart').textContent, 'From Start On');
        assert.equal(element('bastardLoopVCutFromStart').attributes['aria-pressed'], 'true');
        assert.equal(element('bastardLoopVCutFromStart').classes.has('active'), true);
        assert.match(element('bastardLoopVCutRange').textContent, /source 0.600–0.800s.*plays at 0.000s.*once, then silence/);
        element('bastardLoopVCutRepeat').listeners.click();
        assert.equal(settings.fromStart, true);
        assert.equal(settings.repeat, true);
        assert.match(element('bastardLoopVCutRange').textContent, /repeats to full loop end/);
        element('bastardLoopVCutFromStart').listeners.click();
        assert.equal(settings.fromStart, false);
        assert.equal(settings.repeat, true);
        assert.match(element('bastardLoopVCutRange').textContent, /plays at 0.600s/);
        element('bastardLoopVCutReset').listeners.click();
        assert.deepEqual(settings, cut.normalize());
        assert.equal(element('bastardLoopVCutFromStart').textContent, 'From Start Off');
        assert.equal(element('bastardLoopVCutFromStart').attributes['aria-pressed'], 'false');
    } finally { globalThis.document = previousDocument; }
});

test('grid options include 1/32 and every sixteenth up to one bar', () => {
    assert.deepEqual(cut.grids, [1 / 32, ...Array.from({ length: 16 }, (unused, index) => (index + 1) / 16)]);
    assert.equal(cut.normalize({ grid: .3 }).grid, 1 / 16);
    assert.equal(cut.normalize({ grid: '0.03125', snap: false }).grid, 1 / 32);
});

test('section repeat fills sixteen steps as five, five, five and one without extending the loop', () => {
    const source = audioBuffer(2, 16, 16);
    for (let channel = 0; channel < 2; channel += 1) source.getChannelData(channel).set(Array.from({ length: 16 }, (unused, index) => (index + 1) * (channel + 1)));
    const repeated = cut.gate(audioContext, source, { enabled: true, repeat: true, start: 0, end: 5 / 16 }, 1, 0);
    assert.equal(repeated.length, 16);
    assert.equal(repeated.duration, source.duration);
    for (let channel = 0; channel < 2; channel += 1) {
        assert.deepEqual([...repeated.getChannelData(channel)], [1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1].map(value => value * (channel + 1)));
        assert.deepEqual([...source.getChannelData(channel)], Array.from({ length: 16 }, (unused, index) => (index + 1) * (channel + 1)));
    }
});

test('a middle section stays at its original start then repeats only to the original loop end', () => {
    const source = audioBuffer(1, 16, 16);
    source.getChannelData(0).set(Array.from({ length: 16 }, (unused, index) => index + 1));
    const repeated = cut.gate(audioContext, source, { enabled: true, repeat: true, start: 4 / 16, end: 9 / 16 }, 1, 0);
    assert.deepEqual([...repeated.getChannelData(0)], [0, 0, 0, 0, 5, 6, 7, 8, 9, 5, 6, 7, 8, 9, 5, 6]);
});

test('repeated sections including the truncated last segment fade within each section', () => {
    const repeated = cut.gate(audioContext, audioBuffer(1, 1600, 1000), { enabled: true, repeat: true, start: 0, end: 5 / 16 });
    const samples = repeated.getChannelData(0);
    for (const first of [0, 500, 1000, 1500]) {
        const last = Math.min(first + 500, 1600) - 1;
        assert.equal(samples[first], 0);
        assert.equal(samples[last], 0);
        assert.equal(samples[first + 4], .5);
    }
});

test('repeat obeys the resolved loop duration and leaves audio after the loop silent', () => {
    const repeated = cut.gate(audioContext, audioBuffer(1, 2000, 1000), { enabled: true, repeat: true, start: 0, end: 5 / 16 }, 1.6, 0);
    assert.equal(repeated.length, 2000);
    assert.ok(repeated.getChannelData(0).slice(0, 1600).every(value => value === .5));
    assert.ok(repeated.getChannelData(0).slice(1600).every(value => value === 0));
});

test('repeated and gated buffers have distinct cache identities and switching off restores the original', () => {
    const source = audioBuffer();
    const settings = { enabled: true, start: .25, end: .5 };
    const gated = cut.gate(audioContext, source, settings);
    const repeated = cut.gate(audioContext, source, { ...settings, repeat: true });
    assert.notEqual(gated, repeated);
    assert.equal(cut.gate(audioContext, source, { ...settings, repeat: true }), repeated);
    assert.equal(cut.gate(audioContext, source, { ...settings, repeat: true, enabled: false }), source);
    assert.equal(cut.normalize({ ...settings, repeat: 'true' }).repeat, false);
    assert.equal(cut.normalize({ ...settings, repeat: true, start: 2 }).repeat, false);
});

test('dragging snaps without crossing the opposite handle or leaving the full loop', () => {
    const settings = cut.normalize({ start: 0, end: 1 });
    const first = cut.moveBoundary(settings, 'start', .37, 1 / 16);
    assert.equal(first.start, 6 / 16);
    assert.equal(first.enabled, true);
    assert.equal(cut.moveBoundary(first, 'end', .51, 1 / 16).end, 8 / 16);
    assert.equal(cut.moveBoundary(first, 'start', 2, 1 / 16).start, 15 / 16);
    assert.equal(cut.moveBoundary(first, 'end', -1, 1 / 16).end, 7 / 16);
    assert.equal(settings.enabled, false);
});

test('snap-off movement is continuous and tiny existing windows remain valid', () => {
    const settings = cut.normalize({ start: .4, end: .401 });
    assert.equal(cut.moveBoundary(settings, 'start', .3999, 0, .00001).start, .3999);
    const next = cut.moveBoundary(settings, 'start', .8, 1 / 16);
    assert.ok(next.start < next.end);
    assert.equal(cut.normalize(next).enabled, true);
});

test('the middle two sixteenths retain their original position and full buffer duration', () => {
    const original = audioBuffer();
    const expected = original.getChannelData(0).slice();
    const result = cut.gate(audioContext, original, { enabled: true, start: 6 / 16, end: 8 / 16 }, original.duration, 0);
    assert.notEqual(result, original);
    assert.equal(result.duration, original.duration);
    assert.equal(result.length, original.length);
    for (let channel = 0; channel < result.numberOfChannels; channel += 1) {
        const samples = result.getChannelData(channel);
        assert.ok(samples.slice(0, 600).every(value => value === 0));
        assert.ok(samples.slice(600, 800).every(value => value === .5));
        assert.ok(samples.slice(800).every(value => value === 0));
        assert.deepEqual(original.getChannelData(channel), expected);
    }
});

test('cutting the last eighth keeps timing and fades the wrap into the silent tail', () => {
    const original = audioBuffer();
    const result = cut.gate(audioContext, original, { enabled: true, start: 0, end: 14 / 16 });
    assert.equal(result.getChannelData(0)[0], 0);
    assert.equal(result.getChannelData(0)[4], .5);
    assert.equal(result.getChannelData(0)[1399], 0);
    assert.ok(result.getChannelData(0).slice(1400).every(value => value === 0));
});

test('a window reaching the source end fades before wrapping to its silent beginning', () => {
    const original = audioBuffer();
    const result = cut.gate(audioContext, original, { enabled: true, start: .75, end: 1 });
    assert.equal(result.getChannelData(0)[1599], 0);
    assert.equal(result.getChannelData(0)[1595], .5);
    assert.equal(original.getChannelData(0)[1599], .5);
});

test('short fades lie inside the window and do not extend its duration', () => {
    const result = cut.gate(audioContext, audioBuffer(), { enabled: true, start: .25, end: .5 });
    const samples = result.getChannelData(0);
    assert.equal(samples[400], 0);
    assert.ok(samples[401] > 0 && samples[401] < .5);
    assert.equal(samples[404], .5);
    assert.equal(samples[799], 0);
    assert.equal(samples[800], 0);
});

test('resolved metadata duration defines the cut without shortening the original source asset', () => {
    const original = audioBuffer();
    const result = cut.gate(audioContext, original, { enabled: true, start: .5, end: .75 }, .8, 0);
    assert.equal(result.length, 1600);
    assert.equal(result.getChannelData(0)[400], .5);
    assert.equal(result.getChannelData(0)[599], .5);
    assert.equal(result.getChannelData(0)[600], 0);
});

test('unchanged playback reuses one derived buffer; range/context changes replace it', () => {
    const original = audioBuffer();
    const settings = { enabled: true, start: .2, end: .8 };
    const result = cut.gate(audioContext, original, settings);
    assert.equal(cut.gate(audioContext, original, { ...settings, snap: false, grid: 1 }), result);
    assert.notEqual(cut.gate(audioContext, original, { ...settings, end: .7 }), result);
    assert.notEqual(cut.gate({ createBuffer: audioBuffer }, original, settings), result);
    assert.equal(cut.gate(audioContext, original, { enabled: false }), original);
    assert.equal(cut.gate(audioContext, original, { enabled: true, start: 0, end: 1 }), original);
    assert.equal(cut.gate(audioContext, null, settings), null);
});

test('waveform buckets preserve low/high points across channels and ignore cut state', () => {
    const original = audioBuffer(2, 16, 16);
    original.getChannelData(0).set([-.8, .9, -.2, .3]);
    original.getChannelData(1).set([-1, .4, -.6, .7]);
    const values = cut.peaks(original, 4);
    assert.ok(Math.abs(values[0].low + 1) < .000001);
    assert.ok(Math.abs(values[0].high - .9) < .000001);
    assert.equal(cut.peaks(original, 4), values);
    assert.notEqual(cut.peaks(original, 2), values);
});

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function extractFunction(name) {
    const start = html.indexOf(`function ${name}(`);
    const body = html.indexOf(') {', start) + 2;
    let depth = 0;
    for (let index = body; index < html.length; index += 1) {
        if (html[index] === '{') depth += 1;
        if (html[index] === '}') depth -= 1;
        if (depth === 0) return `${html.slice(start - 6, start) === 'async ' ? 'async ' : ''}${html.slice(start, index + 1)}`;
    }
    throw new Error(`Missing function body: ${name}`);
}

test('cut changes restart only V at the existing phase; drag previews do not restart or save', () => {
    const calls = [];
    const context = {
        MygrainVocalCut: cut, bastardLoopVCut: cut.normalize(), bastardLoopVSource: {}, bastardLoopVCutPreview: { origin: 4 },
        startBastardLoopV: (origin, options) => calls.push(['start', origin, options]),
        syncBastardLoopVUi: () => {}, saveState: () => calls.push(['save'])
    };
    vm.createContext(context);
    vm.runInContext(extractFunction('setBastardLoopVCut'), context);
    context.setBastardLoopVCut({ enabled: true, start: .2, end: .5, fromStart: true }, { preview: true });
    assert.equal(context.bastardLoopVCut.fromStart, true);
    assert.equal(calls.length, 0);
    context.setBastardLoopVCut(context.bastardLoopVCut);
    assert.equal(calls[0][1], 4);
    assert.equal(calls[0][2].preserveCutPreview, true);
    assert.equal(calls[0][2].audition, true);
    assert.equal(calls[1][0], 'save');
    context.bastardLoopVCutPreview = null;
    context.setBastardLoopVCut({ enabled: false });
    assert.equal(context.bastardLoopVCut.fromStart, false);
    assert.equal(calls[2][1], null);
});

test('stopping clears pending metronome timers and scheduled audio nodes', () => {
    const calls = [];
    const context = {
        bastardLoopVCutPreviewGeneration: 2,
        bastardLoopVCutPreview: { timer: 5 },
        bastardLoopVCutMetronomeNodes: new Set([{ oscillator: { stop: () => calls.push('stop'), disconnect: () => calls.push('oscDisconnect') }, gain: { disconnect: () => calls.push('gainDisconnect') } }]),
        clearTimeout: id => calls.push(id)
    };
    vm.createContext(context);
    vm.runInContext(extractFunction('clearBastardLoopVCutPreview'), context);
    context.clearBastardLoopVCutPreview();
    assert.equal(context.bastardLoopVCutPreviewGeneration, 3);
    assert.equal(context.bastardLoopVCutPreview, null);
    assert.equal(context.bastardLoopVCutMetronomeNodes.size, 0);
    assert.deepEqual(calls, [5, 'stop', 'oscDisconnect', 'gainDisconnect']);
});

test('closing or stopping during audio startup cancels the pending audition', async () => {
    let finish;
    const context = {
        bastardLoopVCutPreviewGeneration: 0, bastardLoopVBuffer: {},
        ensureAudioReadyForKeyInteraction: () => new Promise(resolve => { finish = resolve; })
    };
    vm.createContext(context);
    vm.runInContext(extractFunction('auditionBastardLoopVCut'), context);
    const pending = context.auditionBastardLoopVCut('metronome');
    context.bastardLoopVCutPreviewGeneration += 1;
    finish(true);
    await pending;
});
