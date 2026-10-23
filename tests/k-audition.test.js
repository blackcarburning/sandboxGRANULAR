const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function extract(name) {
    let start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    if (html.slice(start - 6, start) === 'async ') start -= 6;
    let parentheses = 0, body;
    for (let i = html.indexOf('(', start); i < html.length; i++) {
        if (html[i] === '(') parentheses++;
        if (html[i] === ')') parentheses--;
        if (!parentheses && html[i] === '{') { body = i; break; }
    }
    let depth = 0;
    for (let i = body; i < html.length; i++) {
        if (html[i] === '{') depth++;
        if (html[i] === '}') depth--;
        if (!depth) return html.slice(start, i + 1);
    }
    throw new Error(name);
}
function fixture() {
    const classes = new Set(), attributes = new Map(), created = [], statuses = [];
    const button = { classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } }, setAttribute(name, value) { attributes.set(name, value); } };
    function node() { return { connected: [], starts: [], stops: 0, disconnected: 0,
        playbackRate: {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect(destination) { this.connected.push(destination); },
        disconnect() { this.disconnected++; this.connected.length = 0; },
        start(...args) { this.starts.push(args); }, stop() { this.stops++; }
    }; }
    const context = vm.createContext({ console, Math, window: {},
        document: { getElementById: id => id === 'performanceBastardLoopKAuditionBtn' ? button : null, querySelectorAll: () => [] },
        bastardLoopKBuffer: { duration: 2 }, bastardLoopKRecordingState: 'idle',
        bastardLoopKAuditionToken: 0, bastardLoopKAuditionPreparing: false,
        auditionSources: [], activeSourceCardAuditionKind: 'none',
        audioContext: { currentTime: 10, destination: {}, createBufferSource() { const s = node(); created.push(s); return s; }, createGain: node },
        masterGain: {}, ensureAudioReadyForKeyInteraction: async () => true,
        getBastardLoopKPlaybackRate: () => 2, getFadeSecondsForDuration: () => .02,
        getBastardLoopKOutputGain: level => level * .9 * .88,
        getBastardLoopKLevelValue: options => { assert.equal(options.applyLayerToggle, false); return .5; },
        setStatus: (...args) => statuses.push(args),
        bastardLoopPlaying: true, sequencerPlaying: true, drumMachinePlaying: true
    });
    vm.runInContext(['syncBastardLoopKAuditionButton', 'syncSourceCardAuditionButtons', 'stopSourceCardAudition', 'auditionBastardLoopK'].map(extract).join('\n'), context);
    return { context, button, attributes, classes, created, statuses };
}
test('K waveform audition disables for empty/busy takes and never starts backing transport', async () => {
    const { context: c, button } = fixture();
    c.bastardLoopKBuffer = null; c.syncBastardLoopKAuditionButton(); assert.equal(button.disabled, true);
    assert.equal(await c.auditionBastardLoopK(), false);
    c.bastardLoopKBuffer = { duration: 2 };
    for (const state of ['countin', 'recording', 'processing']) {
        c.bastardLoopKRecordingState = state; c.syncBastardLoopKAuditionButton(); assert.equal(button.disabled, true);
        assert.equal(await c.auditionBastardLoopK(), false);
    }
});
test('K preview is one-shot rendered audio at current rate and fader, toggles stop, and does not mutate audio/backing', async () => {
    const { context: c, created, attributes } = fixture();
    const buffer = c.bastardLoopKBuffer;
    assert.equal(await c.auditionBastardLoopK(), true);
    const source = created[0];
    assert.equal(source.buffer, buffer); assert.equal(source.loop, false); assert.equal(source.playbackRate.value, 2);
    assert.deepEqual(source.starts[0], [10, 0, 2]);
    assert.equal(c.auditionSources.length, 1); assert.equal(attributes.get('aria-pressed'), 'true');
    assert.equal(await c.auditionBastardLoopK(), false);
    assert.equal(source.stops, 1); assert.equal(source.disconnected, 1); assert.equal(c.auditionSources.length, 0);
    assert.equal(c.bastardLoopKBuffer, buffer);
    assert.ok(c.bastardLoopPlaying && c.sequencerPlaying && c.drumMachinePlaying);
});
test('natural completion releases both nodes; an old ended callback cannot stop a newer preview', async () => {
    const { context: c, created, button } = fixture();
    await c.auditionBastardLoopK(); const old = created[0];
    c.stopSourceCardAudition();
    await c.auditionBastardLoopK(); const current = created[1];
    old.onended(); assert.equal(c.auditionSources[0].source, current);
    const gain = c.auditionSources[0].gain;
    current.onended();
    assert.equal(c.auditionSources.length, 0); assert.equal(c.activeSourceCardAuditionKind, 'none');
    assert.equal(current.buffer, null); assert.ok(current.disconnected); assert.ok(gain.disconnected);
    assert.equal(button.textContent, 'Audition');
});
test('Stop All during audio recovery invalidates pending K preview; replaced buffers and capture arming also fail closed', async () => {
    for (const action of ['stop', 'replace', 'record']) {
        const { context: c, created, button } = fixture();
        let release;
        c.ensureAudioReadyForKeyInteraction = () => new Promise(resolve => { release = resolve; });
        const pending = c.auditionBastardLoopK(); assert.equal(button.disabled, true);
        if (action === 'stop') c.stopSourceCardAudition();
        if (action === 'replace') c.bastardLoopKBuffer = { duration: 1 };
        if (action === 'record') c.bastardLoopKRecordingState = 'countin';
        release(true); assert.equal(await pending, false); assert.equal(created.length, 0);
        assert.equal(c.auditionSources.length, 0); assert.equal(c.bastardLoopKAuditionPreparing, false);
    }
});
test('audio recovery failure restores the button and never changes the stored take', async () => {
    const { context: c, button, statuses } = fixture(); const buffer = c.bastardLoopKBuffer;
    c.ensureAudioReadyForKeyInteraction = async () => { throw new Error('Audio unavailable'); };
    assert.equal(await c.auditionBastardLoopK(), false);
    assert.equal(c.bastardLoopKBuffer, buffer); assert.equal(button.disabled, false); assert.equal(button.textContent, 'Audition');
    assert.match(statuses.at(-1)[0], /Audio unavailable/);
});
