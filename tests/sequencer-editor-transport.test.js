const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function extractFunction(name) {
    const start = html.indexOf(`function ${name}(`);
    assert.notEqual(start, -1);
    const body = html.indexOf('{', start);
    let depth = 0;
    for (let index = body; index < html.length; index += 1) {
        if (html[index] === '{') depth += 1;
        if (html[index] === '}') depth -= 1;
        if (depth === 0) return `${html.slice(start - 6, start) === 'async ' ? 'async ' : ''}${html.slice(start, index + 1)}`;
    }
    throw new Error(`Missing function body: ${name}`);
}

function fixture(overrides = {}) {
    const calls = [];
    const context = {
        window: {},
        audioContext: { currentTime: 7 },
        updateBastardLoopLStatus: message => calls.push(['statusL', message]),
        updateBastardLoopXStatus: message => calls.push(['statusX', message]),
        hasPlayableBastardLoopLSequence: () => true,
        hasPlayableBastardLoopXSequence: () => true,
        ensureAudioReadyForKeyInteraction: async () => true,
        isBastardLoopLUsingSynth: () => false,
        ensureBastardLoopLSynthReady: () => { calls.push(['synthReady']); return true; },
        ensureBastardLoopLSampleBufferReady: async () => { calls.push(['loadL']); return true; },
        ensureBastardLoopXSampleBufferReady: async () => { calls.push(['loadX']); return true; },
        setBastardLoopPlaying: enabled => { calls.push(['shared', enabled]); vm.runInContext('sequencerEditorPlaybackGeneration += 1', context); },
        clearLoopLayerSoloForBastardLoop: layer => calls.push(['clearSolo', layer]),
        ensureBastardLoopLReadyForTransport: () => calls.push(['readyL']),
        ensureBastardLoopXReadyForTransport: () => calls.push(['readyX']),
        startBastardLoopL: time => { calls.push(['startL', time]); return true; },
        startBastardLoopX: time => { calls.push(['startX', time]); return true; },
        stopBastardLoopL: () => calls.push(['stopL']),
        stopBastardLoopX: () => calls.push(['stopX']),
        syncPerformanceControlState: () => calls.push(['sync']),
        ...overrides
    };
    vm.createContext(context);
    vm.runInContext(`let sequencerEditorPlaybackGeneration = 0;\n${extractFunction('playSequencerEditorOnly')}\n${extractFunction('stopSequencerEditorOnly')}`, context);
    return { context, calls };
}

for (const layer of ['L', 'X']) {
    test(`${layer} editor Play starts only that layer from step one, not the shared transport`, async () => {
        const { context, calls } = fixture();
        await context.playSequencerEditorOnly(layer);
        assert.deepEqual(calls.filter(call => call[0] === 'shared'), [['shared', false]]);
        assert.deepEqual(calls.filter(call => call[0].startsWith('start')), [[`start${layer}`, 7.02]]);
        assert.ok(calls.findIndex(call => call[0] === 'shared') < calls.findIndex(call => call[0] === `start${layer}`));
        context.stopSequencerEditorOnly(layer);
        assert.deepEqual(calls.filter(call => call[0].startsWith('stop')), [[`stop${layer}`]]);
    });

    test(`${layer} editor Stop cancels pending sample loading`, async () => {
        let finish;
        const { context, calls } = fixture({ [`ensureBastardLoop${layer}SampleBufferReady`]: () => new Promise(resolve => { finish = resolve; }) });
        const pending = context.playSequencerEditorOnly(layer);
        await new Promise(resolve => setImmediate(resolve));
        context.stopSequencerEditorOnly(layer);
        finish(true);
        await pending;
        assert.equal(calls.some(call => call[0].startsWith('start')), false);
    });

    test(`${layer} empty sequence does not stop or start existing playback`, async () => {
        const { context, calls } = fixture({ window: { mygrainSongBeta: { playing: true, stop: () => assert.fail('An empty sequence must not stop the song') } }, [`hasPlayableBastardLoop${layer}Sequence`]: () => false });
        await context.playSequencerEditorOnly(layer);
        assert.equal(calls.some(call => call[0] === 'shared' || call[0].startsWith('start')), false);
        assert.match(calls[0][1], /at least one/);
    });
}

test('L synth playback prepares the synth without loading a sample', async () => {
    const { context, calls } = fixture({ isBastardLoopLUsingSynth: () => true });
    await context.playSequencerEditorOnly('L');
    assert.equal(calls.some(call => call[0] === 'loadL'), false);
    assert.equal(calls.some(call => call[0] === 'synthReady'), true);
    assert.equal(calls.some(call => call[0] === 'startL'), true);
});

test('another editor start supersedes a pending Play', async () => {
    let finish;
    const { context, calls } = fixture({ ensureBastardLoopLSampleBufferReady: () => new Promise(resolve => { finish = resolve; }) });
    const pending = context.playSequencerEditorOnly('L');
    await new Promise(resolve => setImmediate(resolve));
    await context.playSequencerEditorOnly('X');
    finish(true);
    await pending;
    assert.deepEqual(calls.filter(call => call[0].startsWith('start')).map(call => call[0]), ['startX']);
});

test('unready audio and missing samples do not start playback', async () => {
    for (const overrides of [{ ensureAudioReadyForKeyInteraction: async () => false }, { ensureBastardLoopXSampleBufferReady: async () => false }]) {
        const { context, calls } = fixture(overrides);
        await context.playSequencerEditorOnly('X');
        assert.equal(calls.some(call => call[0].startsWith('start')), false);
    }
});
