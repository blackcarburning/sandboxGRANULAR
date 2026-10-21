const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('        function getBastardLoopVBuildPlan(');
const code = html.slice(start, html.indexOf('        async function generateBastardLoopVWithPlaybackRestart(', start));
function plan(source, divisions, steps, refs = ['original.wav']) {
    const context = { bastardLoopVMetadata: { sourceKey: source }, bastardLoopVBuffer: {},
        getBastardLoopSampleRefs: () => refs, getSelectedBastardLoopVDivisions: () => divisions,
        getBastardLoopPatternLengthPayload: () => steps };
    vm.runInNewContext(code, context);
    return options => JSON.parse(JSON.stringify(context.getBastardLoopVBuildPlan(options)));
}
test('RadioLab / VideoLab re-cut uses only the original library and deduplicated original paths', () => {
    for (const source of ['samples_radiolab', 'samples_videolab']) {
        const get = plan(source, ['1/16'], 16, ['folder/original.wav', 'folder/original.wav']);
        const result = get({ reuseSamples: true });
        assert.equal(result.source, source);
        assert.deepEqual(result.sourceFiles, ['folder/original.wav']);
        assert.deepEqual(result.divisions, ['1/16']);
        assert.equal(result.privateRecut, true);
        assert.equal(get({}).source, 'samples_vocal', 'normal Generate still builds vocals');
        assert.deepEqual(get({}).sourceFiles, []);
    }
    assert.equal(plan('samples_vocal', ['uncut'], 16)({ reuseSamples: true }).privateRecut, false);
    assert.deepEqual(plan('samples_vocal', ['uncut'], 16)({ reuseSamples: true }).divisions, ['uncut']);
});
test('single-file re-cut always fits at least two chops without mutating saved resolutions', () => {
    const selections = [['uncut'], ['4'], ['1'], ['4', '1/8'], ['1/16', '1/32']];
    for (const steps of [1, 2, 4, 8, 16, 20, 32, 64, 128, 256]) for (const selected of selections) {
        const copy = selected.slice();
        const result = plan('samples_radiolab', selected, steps)({ reuseSamples: true });
        assert.ok(result.divisions.length);
        for (const value of result.divisions) {
            const [n, d = 1] = value.split('/').map(Number), slots = 32 * n / d;
            assert.ok(slots <= steps && (steps * 2) % slots === 0);
        }
        assert.deepEqual(selected, copy);
    }
});
test('missing original references refuse re-cut rather than selecting random library files', () => {
    for (const refs of [[], ['', null, ' ']]) assert.throws(() => plan('samples_videolab', ['1/16'], 16, refs)({ reuseSamples: true }), /Load a RadioLab/);
});
