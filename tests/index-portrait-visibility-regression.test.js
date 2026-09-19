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
    assert.match(indexHtml, /setPerformanceGenerateButtonState\('generating'\)/);
    assert.match(indexHtml, /setPerformanceGenerateButtonState\('generated'\)/);
    assert.match(indexHtml, /#performanceGenerateLoopBtn\.generating/);
    assert.match(indexHtml, /id="performanceSeqPlayBtn"/);
    assert.match(indexHtml, /function generateInterestingLoop\(\)/);
    assert.match(indexHtml, /await generateRandomSourceSample\(\);\s*generateInterestingLoop\(\);/);
});

test('mobile performance controls expose mix and tame filter controls', () => {
    assert.match(indexHtml, /id="performanceSourceMix"/);
    assert.match(indexHtml, />Granular\/Osc</);
    assert.match(indexHtml, /id="performanceGeneratedSourceMix"/);
    assert.match(indexHtml, />Gen Loop Mix</);
    assert.match(indexHtml, /id="performanceLpfCutoff"/);
    assert.match(indexHtml, /id="performanceLpfResonance"/);
    assert.match(indexHtml, /id="performanceHpfCutoff"/);
    assert.match(indexHtml, /id="performanceHpfResonance"/);
    assert.match(indexHtml, /setSliderValue\('hpfCutoff', event\.target\.value\)/);
    assert.match(indexHtml, /setSliderValue\('hpfQ', value\)/);
    assert.match(indexHtml, /data-performance-filter-power="lpf"/);
    assert.match(indexHtml, /data-performance-filter-power="hpf"/);
    assert.match(indexHtml, /id="performanceLpfPolesValue"/);
    assert.match(indexHtml, /id="performanceHpfPolesValue"/);
    assert.match(indexHtml, /data-performance-filter="lpf" data-poles="2"/);
    assert.match(indexHtml, /data-performance-filter="lpf" data-poles="4"/);
    assert.match(indexHtml, /function setFilterEnabled\(filter, enabled\)/);
    assert.match(indexHtml, /function rebuildFilterChain\(\)/);
    assert.match(indexHtml, /function setFilterPoles\(filter, poles\)/);
    assert.match(indexHtml, /id="performanceOctaveUpBtn"/);
    assert.match(indexHtml, /id="performanceOctaveDownBtn"/);
    assert.match(indexHtml, /id="performanceLfoWaveform"/);
    assert.match(indexHtml, /id="performancePulseWidth"/);
    assert.match(indexHtml, /id="oscMix" min="0" max="100" value="35"/);
    assert.match(indexHtml, /id="lpfQ" min="0\.1" max="2\.5" value="0\.6"/);
});

test('source UI has separate generated and mic waveform loop controls', () => {
    assert.match(indexHtml, /id="generatedWaveformCanvas"/);
    assert.match(indexHtml, /id="micWaveformCanvas"/);
    assert.match(indexHtml, /id="generatedLoopStart"/);
    assert.match(indexHtml, /id="generatedLoopEnd"/);
    assert.match(indexHtml, /id="micLoopStart"/);
    assert.match(indexHtml, /id="micLoopEnd"/);
    assert.match(indexHtml, /function handleSourceLoopChange\(kind\)/);
    assert.match(indexHtml, /grainInfo\.nextTime = now/);
});

test('patch randomize does not move manual source loop points', () => {
    assert.match(indexHtml, /const RANDOMIZE_SKIP_SLIDERS = new Set/);
    assert.match(indexHtml, /'generatedLoopStart'/);
    assert.match(indexHtml, /'generatedLoopEnd'/);
    assert.match(indexHtml, /'micLoopStart'/);
    assert.match(indexHtml, /'micLoopEnd'/);
    assert.match(indexHtml, /RANDOMIZE_SKIP_SLIDERS\.has\(slider\.id\)/);
});

test('granular engine routes generated and mic buffers as separate sources', () => {
    assert.match(indexHtml, /let generatedLoopBuffer = null/);
    assert.match(indexHtml, /let micAudioBuffer = null/);
    assert.match(indexHtml, /function getAvailableGranularSources\(\)/);
    assert.match(indexHtml, /let generatedSourceMix = 1/);
    assert.match(indexHtml, /function getGranularSourceGainMap\(sources, availableGain = 1\)/);
    assert.match(indexHtml, /generatedLoopBuffer/);
    assert.match(indexHtml, /micAudioBuffer/);
    assert.match(indexHtml, /sourceGainMap\.get\(sourceInfo\) \?\? 0/);
    assert.match(indexHtml, /resetSourceLoopPoints\(kind\)/);
    assert.match(indexHtml, /oscMix: 12/);
    assert.match(indexHtml, /performanceGeneratedSourceMix: 100/);
    assert.match(indexHtml, /setFilterEnabled\('hpf', false\)/);
});

test('oscillators can be disabled for granular-only playback', () => {
    assert.match(indexHtml, /id="performanceOscToggleBtn"/);
    assert.match(indexHtml, /let oscillatorsEnabled = true/);
    assert.match(indexHtml, /function setOscillatorsEnabled\(enabled\)/);
    assert.match(indexHtml, /if \(!oscillatorsEnabled\) return/);
});

test('generated source and sequencer are bass percussion oriented', () => {
    assert.match(indexHtml, /setStatus\('Generating beat source/);
    assert.match(indexHtml, /kickSteps/);
    assert.match(indexHtml, /snareSteps/);
    assert.match(indexHtml, /const roots = \['C2', 'D2', 'E2', 'F2', 'G2', 'A2'\]/);
    assert.match(indexHtml, /applyPercussiveLoopPatch\(\)/);
});

test('lfo waveforms include pulse width and stepped shapes', () => {
    assert.match(indexHtml, /id="lfoPulseWidth"/);
    assert.match(indexHtml, /id="lfo2PulseWidth"/);
    assert.match(indexHtml, /id="lfo3PulseWidth"/);
    assert.match(indexHtml, /<option value="pulse">Pulse<\/option>/);
    assert.match(indexHtml, /<option value="stepped">Stepped<\/option>/);
    assert.match(indexHtml, /function evaluateLfoWaveform\(waveform, phase, pulseWidth = 0\.5\)/);
});
