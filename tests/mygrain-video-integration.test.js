const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const htmlPath = process.env.MYGRAIN_VIDEO_HTML || path.resolve(__dirname, '../index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const adapterScript = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).find(script => script.includes('window.mygrainVideolabAdapter'));

test('Video Lab shell includes the complete panel between RadioLab and V with ordered account-aware assets', () => {
    const panel = fs.readFileSync(path.resolve(__dirname, '../videolab-panel.html'), 'utf8').trim();
    const compact = content => content.split('\n').map(line => line.trim()).join('\n');
    assert.ok(compact(html).includes(compact(panel)));
    assert.ok(html.indexOf('id="radiolabCard"') < html.indexOf('id="performanceVideoLabCard"'));
    assert.ok(html.indexOf('id="performanceVideoLabCard"') < html.indexOf('aria-label="Bastardloop V controls"'));
    assert.ok(html.indexOf("loadScript('radiolab.js?") < html.indexOf("loadScript('videolab.js?"));
    assert.ok(html.indexOf('window.mygrainVideolabAdapter') < html.indexOf("loadScript('videolab.js?"));
    assert.match(html, /loadStyle\('videolab\.css\?v=v2026\.10\.18\.V\.1'\)/);
    assert.match(html, /navigation-palette\.js\?v=20261018-navigation-r5/);
    assert.match(html, /navigation-palette\.css\?v=20261018-navigation-r5/);
    assert.doesNotMatch(html, /navigation-r4/);
});

test('section navigation reopens Video Lab and clears private capture state when leaving it', () => {
    const body = html.match(/const jumpToButtonTarget = \(button\) => \{([\s\S]*?)if \(button\.dataset\.granularKeyboardReady\)/)[1];
    const calls = [];
    const sandbox = { button: { dataset: { jumpTarget: '#performanceVideoLabCard' } }, window: { mygrainVideolab: { open: () => calls.push('open'), close: () => calls.push('close') } } };
    vm.runInNewContext(body, sandbox);
    sandbox.button.dataset.jumpTarget = '#radiolabCard';
    vm.runInNewContext(body, sandbox);
    assert.deepEqual(calls, ['open', 'close']);
});

function makeHarness(overrides = {}) {
    const calls = [];
    const buffer = { duration: 2.5 };
    const context = { state: 'running', decodeAudioData: async body => {
        calls.push(['decode', body.byteLength]);
        return buffer;
    } };
    const sandbox = {
        window: {}, audioContext: context, engineStarting: false, stateSaveSuspended: false,
        bastardLoopVGenerationInFlight: false, sequencerBPM: 123, Response,
        document: { getElementById: () => ({ value: '123' }) },
        isAudioGraphReady: () => true,
        clampBpmValue: value => Number(value),
        stopBastardLoopV: options => calls.push(['stopV', options]),
        setBastardLoopVCut: (cut, options) => calls.push(['cutV', cut, options]),
        applyLoadedBastardLoopVBuffer: async (...args) => calls.push(['loadV', ...args]),
        saveState: () => calls.push(['save']),
        loadGranularBrowserSampleFromResponse: async (response, target, options) => {
            options.guard();
            calls.push(['loadGrain', target, options, await response.arrayBuffer()]);
        },
        ...overrides
    };
    assert.ok(adapterScript, 'Video Lab has a dedicated loading adapter');
    vm.runInNewContext(adapterScript, sandbox);
    let guards = 0;
    return { adapter: sandbox.window.mygrainVideolabAdapter, sandbox, calls, buffer,
        guard: () => { guards += 1; }, guardCount: () => guards };
}

test('Apply, Grain A and Grain B retain the Video Lab source and do not start playback', async () => {
    for (const target of ['grainMain', 'grainA', 'grainB']) {
        const harness = makeHarness();
        const body = new Uint8Array([1, 2, 3, 4]).buffer;
        await harness.adapter.load(body, { filename: 'test.wav', name: 'Test clip' }, target, harness.guard);
        assert.deepEqual(harness.calls.map(call => call[0]), ['loadGrain']);
        const loaded = harness.calls[0];
        assert.equal(loaded[1], target);
        assert.equal(loaded[2].sourceKey, 'samples_videolab');
        assert.equal(loaded[2].sourceLabel, 'SAMPLES_VIDEOLAB');
        assert.deepEqual(new Uint8Array(loaded[3]), new Uint8Array(body));
        assert.equal(harness.guardCount(), 3);
    }
});

test('V receives the complete file, resets prior cuts and keeps Video Lab metadata', async () => {
    const harness = makeHarness();
    await harness.adapter.load(new ArrayBuffer(8), { filename: 'test.wav', name: 'Test clip' }, 'V', harness.guard);
    assert.deepEqual(harness.calls.map(call => call[0]), ['decode', 'stopV', 'cutV', 'loadV', 'save']);
    const loaded = harness.calls.find(call => call[0] === 'loadV');
    assert.equal(loaded[1], harness.buffer);
    assert.equal(loaded[2], 'VIDEO LAB · Test clip');
    assert.equal(loaded[3].sourceKey, 'samples_videolab');
    assert.equal(loaded[3].durationSeconds, 2.5);
    assert.equal(harness.calls.find(call => call[0] === 'cutV')[1].enabled, false);
    assert.equal(harness.guardCount(), 3);
});

test('Loading rejects unavailable audio, song activity and invalid destinations', async () => {
    for (const overrides of [
        { engineStarting: true }, { stateSaveSuspended: true },
        { isAudioGraphReady: () => false },
        { window: { mygrainSongBeta: { busy: true } } },
        { window: { mygrainSongBeta: { playing: true } } }
    ]) {
        const harness = makeHarness(overrides);
        await assert.rejects(harness.adapter.load(new ArrayBuffer(8), { filename: 'test.wav' }, 'grainMain', harness.guard));
        assert.equal(harness.calls.length, 0);
    }
    const harness = makeHarness();
    await assert.rejects(harness.adapter.load(new ArrayBuffer(8), { filename: 'test.wav' }, 'unknown', harness.guard), /Choose Apply/);
});

test('Account guards and context changes block stale decoding', async () => {
    const harness = makeHarness();
    harness.sandbox.audioContext.decodeAudioData = async () => {
        harness.sandbox.audioContext = { state: 'running' };
        return harness.buffer;
    };
    await assert.rejects(harness.adapter.load(new ArrayBuffer(8), { filename: 'test.wav' }, 'V', harness.guard), /Audio state changed/);
    assert.equal(harness.calls.length, 0);
    const locked = makeHarness();
    await assert.rejects(locked.adapter.load(new ArrayBuffer(8), { filename: 'test.wav' }, 'V', () => {
        throw new Error('Account changed');
    }), /Account changed/);
    assert.equal(locked.calls.length, 0);
});
