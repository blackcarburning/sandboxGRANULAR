const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function functionSource(name, asynchronous = false) {
    const start = html.indexOf(`        ${asynchronous ? 'async ' : ''}function ${name}(`);
    assert.notEqual(start, -1, name);
    return html.slice(start, html.indexOf('\n        }', start) + '\n        }'.length);
}

function fixture() {
    const shown = [];
    const timers = new Map();
    const classes = new Set();
    let now = 0;
    const context = {
        performance: { now: () => now },
        showSettlePopup: (text, options) => shown.push({ text, options }),
        settlePopup: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } },
        setInterval: (callback, delay) => { timers.set(1, { callback, delay }); return 1; },
        clearInterval: timer => timers.delete(timer)
    };
    vm.createContext(context);
    vm.runInContext(functionSource('createMegaRandomCommentary'), context);
    const commentary = context.createMegaRandomCommentary('Sparse Randomise');
    return { context, commentary, shown, timers, classes, advance(value) { now = value; timers.get(1)?.callback(); } };
}

test('the popup starts immediately and reports elapsed time without inventing completed work', () => {
    const { commentary, shown, timers, advance } = fixture();
    assert.match(shown.at(-1).text, /Sparse Randomise · 0s elapsed/);
    assert.match(shown.at(-1).text, /Shuffling the musical furniture/);
    assert.equal(shown.at(-1).options.persistent, true);
    assert.equal(timers.get(1).delay, 3000);
    commentary.addTasks(['Loop L', 'Loop X']);
    advance(12000);
    assert.match(shown.at(-1).text, /12s elapsed/);
    assert.match(shown.at(-1).text, /0\/2 layers finished/);
    assert.match(shown.at(-1).text, /Still working: Loop L \(waiting\), Loop X \(waiting\)/);
});

test('downloaded audio is not counted as ready until decoding and application finish', () => {
    const { commentary, shown } = fixture();
    commentary.addTasks(['Bastardloop A', 'Loop X']);
    for (const stage of ['building', 'downloading', 'downloaded', 'decoding']) {
        commentary.task('Bastardloop A', stage, `Bastardloop A: ${stage} real-sample.wav`);
        assert.match(shown.at(-1).text, /0\/2 layers finished/);
    }
    commentary.task('Bastardloop A', 'ready', 'Bastardloop A ready: real-sample.wav.');
    assert.match(shown.at(-1).text, /1\/2 layers finished/);
    assert.match(shown.at(-1).text, /Still working: Loop X/);
    commentary.task('Loop X', 'warning', 'Loop X: sample request failed.');
    assert.match(shown.at(-1).text, /2\/2 layers finished · 1 warning/);
    assert.doesNotMatch(shown.at(-1).text, /Still working/);
});

test('parallel completions and repeated updates do not inflate finished counts', () => {
    const { commentary, shown } = fixture();
    commentary.addTasks(['A', 'B', 'C', 'D', 'E']);
    commentary.task('E', 'ready', 'E ready.');
    commentary.task('B', 'ready', 'B ready.');
    commentary.task('E', 'ready', 'E ready.');
    assert.match(shown.at(-1).text, /2\/5 layers finished/);
    assert.match(shown.at(-1).text, /Still working: A \(waiting\), C \(waiting\), D \(waiting\)/);
});

test('recent messages and filenames remain bounded, deduplicated and plain text', () => {
    const { commentary, shown } = fixture();
    for (const message of ['first.wav', 'second.wav', 'third.wav', 'fourth.wav']) commentary.message(message);
    commentary.message('fourth.wav');
    assert.doesNotMatch(shown.at(-1).text, /first.wav/);
    assert.equal(shown.at(-1).text.split('› ').length - 1, 3);
    commentary.message(`<img src=x>\n${'sample'.repeat(80)}`);
    assert.match(shown.at(-1).text, /<img src=x>/);
    assert.ok(shown.at(-1).text.split('\n').at(-1).length <= 142);
});

test('completion cleanup stops the heartbeat and ignores late loading callbacks', () => {
    const { commentary, shown, timers, classes, advance } = fixture();
    assert.equal(classes.has('randomise-commentary'), true);
    commentary.stop();
    const count = shown.length;
    advance(30000);
    commentary.message('Late sample');
    commentary.addTasks(['Late task']);
    commentary.task('Late task', 'ready', 'Late task ready');
    assert.equal(shown.length, count);
    assert.equal(timers.size, 0);
    assert.equal(classes.has('randomise-commentary'), false);
});

test('existing loader status messages reach commentary only while it is active', () => {
    const { context, commentary, shown } = fixture();
    context.statusDiv = { dataset: {} };
    context.megaRandomCommentary = commentary;
    context.appendDebugConsoleEvent = () => {};
    vm.runInContext(functionSource('setStatus'), context);
    context.setStatus('Kick sample loaded: real-kick.wav.');
    assert.match(shown.at(-1).text, /real-kick.wav/);
    context.setStatus('Bass sample unavailable.', 'error');
    assert.match(shown.at(-1).text, /Warning: Bass sample unavailable/);
    context.megaRandomCommentary = null;
    const count = shown.length;
    context.setStatus('Ordinary operation');
    assert.equal(shown.length, count);
    assert.equal(context.statusDiv.textContent, 'Ordinary operation');
});

test('server audio reports chosen filenames before waiting for its response body', async () => {
    const messages = [];
    const metadata = { sampleNames: ['real-piano.wav'] };
    const context = {
        BASTARD_LOOP_API_URL: '/generate', BASTARD_LOOP_SOURCE_LABELS: {}, ArrayBuffer,
        fetch: async () => ({ ok: true, arrayBuffer: async () => { messages.push('body'); return new ArrayBuffer(12); } }),
        readBastardLoopBuildResponseMetadata: () => metadata,
        appendBastardLoopTrace: () => {}
    };
    vm.createContext(context);
    vm.runInContext(functionSource('requestGeneratedBastardLoopAudio', true), context);
    const result = await context.requestGeneratedBastardLoopAudio({}, { onProgress: value => messages.push(value.sampleNames[0]) });
    assert.deepEqual(messages, ['real-piano.wav', 'body']);
    assert.equal(result.arrayBuffer.byteLength, 12);
});
