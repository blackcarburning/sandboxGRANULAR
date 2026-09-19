const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('portrait CSS does not hide synth container', () => {
    const portraitBlocks = indexHtml.match(/@media\s+screen\s+and\s*\(orientation:\s*portrait\)\s*\{[\s\S]*?\}/gi) || [];

    for (const block of portraitBlocks) {
        assert.equal(
            /\.synth-container\s*\{[^}]*display\s*:\s*none\s*!important/i.test(block),
            false,
            'portrait media query must not hide .synth-container with !important'
        );
    }
});

test('stale orientation-overlay css selectors are removed', () => {
    assert.equal(
        /#orientation-overlay\b/i.test(indexHtml),
        false,
        'stale #orientation-overlay CSS should not remain after responsive redesign'
    );
});

test('keyboard is not nested inside the hidden simplified controls panel', () => {
    assert.ok(
        /<\/div>\s*<\/div>\s*<div class="keyboard-section">/i.test(indexHtml),
        'keyboard should be a direct mobile performance section, outside .controls-section/.top-section'
    );
});

test('mobile performance controls expose loop generation and playback', () => {
    assert.match(indexHtml, /id="performanceGenerateLoopBtn"/);
    assert.match(indexHtml, /id="performanceSeqPlayBtn"/);
    assert.match(indexHtml, /function generateInterestingLoop\(\)/);
});

test('mobile performance controls expose mix and tame filter controls', () => {
    assert.match(indexHtml, /id="performanceSourceMix"/);
    assert.match(indexHtml, /id="performanceCutoff"/);
    assert.match(indexHtml, /id="performanceResonance"/);
    assert.match(indexHtml, /id="oscMix" min="0" max="100" value="50"/);
    assert.match(indexHtml, /id="lpfQ" min="0\.1" max="2\.5" value="0\.6"/);
});

test('generated source and sequencer are bass percussion oriented', () => {
    assert.match(indexHtml, /setStatus\('Generating beat source/);
    assert.match(indexHtml, /kickSteps/);
    assert.match(indexHtml, /snareSteps/);
    assert.match(indexHtml, /const roots = \['C2', 'D2', 'E2', 'F2', 'G2', 'A2'\]/);
    assert.match(indexHtml, /applyPercussiveLoopPatch\(\)/);
});
