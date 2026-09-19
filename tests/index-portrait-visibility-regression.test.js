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

test('generate and randomize actions show a two second settle popup', () => {
    assert.match(indexHtml, /id="settlePopup"[\s\S]*>let it settle<\/div>/);
    assert.match(indexHtml, /function showSettlePopup\(\)/);
    assert.match(indexHtml, /settlePopup\.classList\.add\('visible'\)/);
    assert.match(indexHtml, /settlePopupTimer = setTimeout\(\(\) => \{[\s\S]*\}, 2000\);/);
    assert.match(indexHtml, /document\.getElementById\('randomizeBtn'\)\.addEventListener\('click', \(\) => \{\s*showSettlePopup\(\);/);
    assert.match(indexHtml, /performanceGenerateLoopBtn\?\.addEventListener\('click', async \(\) => \{[\s\S]*showSettlePopup\(\);[\s\S]*setPerformanceGenerateButtonState\('generating'\)/);
});

test('mobile performance controls expose mix and tame filter controls', () => {
    assert.match(indexHtml, /id="performanceSourceMix"/);
    assert.match(indexHtml, />Granular\/Osc</);
    assert.match(indexHtml, /id="performanceGeneratedSourceMix"/);
    assert.match(indexHtml, />Gen Loop Mix</);
    assert.match(indexHtml, /id="performanceGeneratedDryMix"/);
    assert.match(indexHtml, />Gen Dry</);
    assert.match(indexHtml, /id="performanceGeneratedSwing"/);
    assert.match(indexHtml, />Gen Swing</);
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
    assert.match(indexHtml, /id="performanceLfoSquareBtn"/);
    assert.match(indexHtml, /id="performancePulseWidth"/);
    assert.match(indexHtml, /id="performanceExportBars"/);
    assert.match(indexHtml, /id="performanceExportBtn"/);
    assert.match(indexHtml, /id="oscMix" min="0" max="100" value="35"/);
    assert.match(indexHtml, /id="lpfQ" min="0\.1" max="2\.5" value="0\.6"/);
});

test('mobile keyboard presents one octave with widened touch targets', () => {
    const keyMatches = indexHtml.match(/class="key /g) || [];
    const whiteKeyMatches = indexHtml.match(/class="key white"/g) || [];
    assert.equal(keyMatches.length, 12);
    assert.equal(whiteKeyMatches.length, 7);
    assert.doesNotMatch(indexHtml, /data-note="C1"/);
    assert.match(indexHtml, /data-note="C2"/);
    assert.match(indexHtml, /One octave, transposed by the octave buttons/);
    assert.doesNotMatch(indexHtml, /\.simplified-ui \.keyboard-section \.octave-controls,\s*\n\s*\.simplified-ui \.keyboard-section \.volume-bias-container/);
    assert.match(indexHtml, /\.simplified-ui \.keyboard-section \.octave-controls/);
    assert.match(indexHtml, /performance-sound-card performance-octave-card/);
    assert.match(indexHtml, /\.simplified-ui \.performance-octave-card\s*\{\s*display: none;/);
});

test('keyboard octave transposes labels, granular, and oscillator pitch', () => {
    assert.match(indexHtml, /function transposeNoteName\(note, octaveShift = 0\)/);
    assert.match(indexHtml, /function getKeyboardNoteFrequency\(note\)/);
    assert.match(indexHtml, /function updateKeyboardNoteLabels\(\)/);
    assert.match(indexHtml, /key\.textContent = transposeNoteName\(key\.dataset\.note, octaveOffset \|\| 0\)/);
    assert.match(indexHtml, /const noteFreq = getKeyboardNoteFrequency\(note\)/);
    assert.match(indexHtml, /const baseFreq = getKeyboardNoteFrequency\(note\)/);
    assert.match(indexHtml, /updateKeyboardNoteLabels\(\);[\s\S]*document\.getElementById\('octaveUpBtn'\)\.addEventListener/);
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
    assert.match(indexHtml, /let generatedDryMix = 0/);
    assert.match(indexHtml, /function startGeneratedDryLoop\(startTime = null\)/);
    assert.match(indexHtml, /function stopGeneratedDryLoop\(\)/);
    assert.match(indexHtml, /generatedLoopBuffer/);
    assert.match(indexHtml, /micAudioBuffer/);
    assert.match(indexHtml, /sourceGainMap\.get\(sourceInfo\) \?\? 0/);
    assert.match(indexHtml, /resetSourceLoopPoints\(kind\)/);
    assert.match(indexHtml, /oscMix: 8/);
    assert.match(indexHtml, /performanceGeneratedSourceMix: 100/);
    assert.match(indexHtml, /performanceGeneratedDryMix: 78/);
    assert.match(indexHtml, /setFilterEnabled\('hpf', false\)/);
});

test('generated source swing is controllable and defaults to straight timing', () => {
    assert.match(indexHtml, /let generatedSourceSwing = 0/);
    assert.match(indexHtml, /function getGeneratedSourceSwingValue\(\)/);
    assert.match(indexHtml, /id="performanceGeneratedSwing" min="0" max="60" value="0"/);
    assert.match(indexHtml, /const grooveSwing = getGeneratedSourceSwingValue\(\) \* stepDuration \* 0\.5/);
    assert.doesNotMatch(indexHtml, /Math\.random\(\) \* stepDuration \* 0\.18/);
    assert.match(indexHtml, /performanceGeneratedSwing: 0/);
});

test('daw export renders from time zero with generated dry stem', () => {
    assert.match(indexHtml, /function exportDawReadyBars\(\)/);
    assert.match(indexHtml, /renderDawReadyBuffer\(\{ bars, includeDryGenerated: true, dryOnly: false \}\)/);
    assert.match(indexHtml, /renderDawReadyBuffer\(\{ bars, includeDryGenerated: true, dryOnly: true \}\)/);
    assert.match(indexHtml, /mygrain-mix-\$\{bpm\}bpm-\$\{bars\}bars/);
    assert.match(indexHtml, /mygrain-generated-dry-\$\{bpm\}bpm-\$\{bars\}bars/);
    assert.match(indexHtml, /setStatus\(`Exporting \$\{bars\} bar/);
});

test('oscillators can be disabled for granular-only playback', () => {
    assert.match(indexHtml, /id="performanceOscToggleBtn"/);
    assert.match(indexHtml, /let oscillatorsEnabled = true/);
    assert.match(indexHtml, /function setOscillatorsEnabled\(enabled\)/);
    assert.match(indexHtml, /if \(!oscillatorsEnabled\) return/);
});

test('generated source and sequencer are experimental and triplet aware', () => {
    assert.match(indexHtml, /experimentalTonePalette/);
    assert.match(indexHtml, /tripletBursts/);
    assert.match(indexHtml, /ratchetBursts/);
    assert.match(indexHtml, /subHits/);
    assert.match(indexHtml, /offset: 1 \/ 3/);
    assert.match(indexHtml, /offset: 2 \/ 3/);
    assert.match(indexHtml, /playGrain\(subPitch, hitTime, subVelocity\)/);
    assert.match(indexHtml, /const roots = \['C1', 'D1', 'F1', 'G1', 'A1', 'C2', 'D#2'\]/);
    assert.match(indexHtml, /applyExperimentalLoopPatch\(\)/);
});

test('lfo waveforms include pulse width and stepped shapes', () => {
    assert.match(indexHtml, /id="lfoPulseWidth"/);
    assert.match(indexHtml, /id="lfo2PulseWidth"/);
    assert.match(indexHtml, /id="lfo3PulseWidth"/);
    assert.match(indexHtml, /<option value="pulse">Pulse<\/option>/);
    assert.match(indexHtml, /<option value="stepped">Stepped<\/option>/);
    assert.match(indexHtml, /function evaluateLfoWaveform\(waveform, phase, pulseWidth = 0\.5\)/);
});

test('all internal lfos can be forced to square until randomize clears it', () => {
    assert.match(indexHtml, /let allLfosSquareForced = false/);
    assert.match(indexHtml, /function setAllInternalLfoWaveforms\(waveform, options = \{\}\)/);
    assert.match(indexHtml, /\['lfoWaveform', 'lfo2Waveform', 'lfo3Waveform'\]/);
    assert.match(indexHtml, /setAllInternalLfoWaveforms\('square', \{ forcedSquare: true \}\)/);
    assert.match(indexHtml, /clearAllLfoSquareForce\(\);[\s\S]*\/\/ Randomize oscillator octave buttons/);
    assert.match(indexHtml, /performanceLfoSquareBtn\.classList\.toggle\('active', allLfosSquareForced\)/);
});
