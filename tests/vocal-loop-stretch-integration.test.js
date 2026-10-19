const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cut = require('../vocal-loop-cut.js');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = name => {
    const expression = new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n        \\}`);
    const match = html.match(expression);
    assert.ok(match, name);
    return match[0];
};

test('playhead cycle lookups never render a cut or stretch preview', () => {
    let uncutLookups = 0;
    const context = {
        getBastardLoopVPlaybackBuffer(options) {
            assert.equal(options?.uncut, true);
            uncutLookups += 1;
            return { duration: 2 };
        },
        resolveLoopDurationSeconds: duration => duration,
        getBastardLoopVPlaybackRate: () => 2,
        bastardLoopVMetadata: null,
        bastardLoopVSourceBpm: 120
    };
    vm.runInNewContext(source('getResolvedBastardLoopVDuration') + '\n' + source('getBastardLoopVCycleDuration'), context);
    for (let frame = 0; frame < 120; frame += 1) assert.equal(context.getBastardLoopVCycleDuration(), 1);
    assert.equal(uncutLookups, 120);
});

test('replacing a V source clears stale stretch mapping while retaining legacy cut fields', async () => {
    const previous = { duration: 2 };
    const replacement = { duration: 3 };
    const settings = cut.normalize({ enabled: true, start: .375, end: .625, stretch: true, targetStart: .1, targetDuration: .5 });
    let saveCompleted = false;
    const context = {
        bastardLoopVBuffer: previous,
        bastardLoopVMetadata: null,
        bastardLoopVSourceBpm: 120,
        bastardLoopVCut: settings,
        MAX_SAMPLE_DURATION_SECONDS: 180,
        BASTARD_LOOP_V_AUDIO_BUFFER_KEY: 'isolated-test',
        MygrainVocalCut: cut,
        clampBpmValue: value => value,
        async saveAudioBufferToDB() {
            assert.equal(context.bastardLoopVCut.stretch, true);
            saveCompleted = true;
        },
        syncBastardLoopVUi() { assert.equal(saveCompleted, true); },
        syncBastardLoopPUi() {},
        syncBastardLoopOUi() {},
        appendBastardLoopTrace() {},
        setStatus() {}
    };
    vm.runInNewContext(source('applyLoadedBastardLoopVBuffer'), context);
    await context.applyLoadedBastardLoopVBuffer(replacement, 'Replacement');
    assert.equal(context.bastardLoopVBuffer, replacement);
    assert.equal(context.bastardLoopVCut.stretch, false);
    assert.equal(context.bastardLoopVCut.targetStart, null);
    assert.equal(context.bastardLoopVCut.targetDuration, null);
    assert.equal(context.bastardLoopVCut.enabled, true);
    assert.equal(context.bastardLoopVCut.start, settings.start);
    assert.equal(context.bastardLoopVCut.end, settings.end);
    context.bastardLoopVCut = settings;
    await context.applyLoadedBastardLoopVBuffer(replacement, 'Same source');
    assert.equal(context.bastardLoopVCut, settings);
    context.saveAudioBufferToDB = async () => { throw new Error('Storage unavailable'); };
    await assert.rejects(context.applyLoadedBastardLoopVBuffer(previous, 'Failed replacement'), /Storage unavailable/);
    assert.equal(context.bastardLoopVCut, settings);
});
