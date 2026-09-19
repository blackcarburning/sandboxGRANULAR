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
    assert.match(indexHtml, /document\.getElementById\('randomizeBtn'\)\.addEventListener\('click', async \(\) => \{\s*showSettlePopup\(\);/);
    assert.match(indexHtml, /performanceGenerateLoopBtn\?\.addEventListener\('click', async \(\) => \{[\s\S]*showSettlePopup\(\);[\s\S]*setPerformanceGenerateButtonState\('generating'\)/);
});

test('mobile performance controls expose mix and tame filter controls', () => {
    assert.match(indexHtml, /id="performanceSourceMix"/);
    assert.match(indexHtml, />Granular\/Osc</);
    assert.match(indexHtml, /id="performanceGeneratedSourceMix"/);
    assert.match(indexHtml, />Gen Loop Mix</);
    assert.match(indexHtml, /id="performanceGeneratedDryMix"/);
    assert.match(indexHtml, />Gen Dry</);
    assert.match(indexHtml, /id="performanceGeneratedDryTrim" min="-24" max="6" value="-6"/);
    assert.match(indexHtml, />Dry Trim</);
    assert.match(indexHtml, /id="performanceGranularTrim" min="-24" max="6" value="-3"/);
    assert.match(indexHtml, />Grain Trim</);
    assert.match(indexHtml, /id="performanceGeneratedSwing"/);
    assert.match(indexHtml, />Gen Swing</);
    assert.match(indexHtml, /id="performanceGeneratedTranspose" min="-3" max="3" value="0" step="1"/);
    assert.match(indexHtml, />Loop Transpose</);
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
    assert.match(indexHtml, /id="performanceInputTrim" min="-24" max="6" value="0"/);
    assert.match(indexHtml, />Filter In</);
    assert.match(indexHtml, /id="performancePostFilterTrim" min="-24" max="12" value="0"/);
    assert.match(indexHtml, />Filter Out</);
    assert.match(indexHtml, /id="performanceMasterTrim" min="-24" max="0" value="-3"/);
    assert.match(indexHtml, />Master Trim</);
    assert.match(indexHtml, /id="performanceClickGuard" min="1" max="30" value="8"/);
    assert.match(indexHtml, />Click Guard</);
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
    assert.match(indexHtml, /id="performanceFxMuteBtn"/);
    assert.match(indexHtml, /id="performanceDryFilterBtn"/);
    assert.match(indexHtml, /function setFxMuted\(muted, options = \{\}\)/);
    assert.match(indexHtml, /function setGeneratedDryThroughFilters\(enabled, options = \{\}\)/);
    assert.match(indexHtml, /const reverbAmt = fxMuted \? 0 : getModulatedValue\('reverb'\) \/ 100/);
    assert.match(indexHtml, /const mix = fxMuted \? 0 : getModulatedValue\('delayMix'\) \/ 100/);
    assert.match(indexHtml, /id="oscMix" min="0" max="100" value="35"/);
    assert.match(indexHtml, /id="lpfQ" min="0\.1" max="2\.5" value="0\.6"/);
});

test('gain staging trims are outside randomize and wired into the audio path', () => {
    assert.match(indexHtml, /let generatedDryTrimDb = -6/);
    assert.match(indexHtml, /let granularTrimDb = -3/);
    assert.match(indexHtml, /let masterTrimDb = -3/);
    assert.match(indexHtml, /let clickGuardMs = 8/);
    assert.match(indexHtml, /function dbToLinear\(dbValue\)/);
    assert.match(indexHtml, /function getGeneratedDryOutputGain\(mix = getGeneratedDryMixValue\(\)\)/);
    assert.match(indexHtml, /mix\) \* MIX_HEADROOM \* dbToLinear\(getGeneratedDryTrimDb\(\)\)/);
    assert.match(indexHtml, /granularLevel = Math\.sqrt\(oscillatorsEnabled \? \(1 - oscMix\) : 1\) \* MIX_HEADROOM \* dbToLinear\(getGranularTrimDb\(\)\)/);
    assert.match(indexHtml, /volAmt = \(getModulatedValue\('volume'\) \/ 100\) \* dbToLinear\(getMasterTrimDb\(\)\)/);
    assert.match(indexHtml, /'performanceGeneratedDryTrim'/);
    assert.match(indexHtml, /'performanceGranularTrim'/);
    assert.match(indexHtml, /'performanceInputTrim'/);
    assert.match(indexHtml, /'performancePostFilterTrim'/);
    assert.match(indexHtml, /'performanceMasterTrim'/);
    assert.match(indexHtml, /'performanceClickGuard'/);
});

test('click guard applies minimum fades to grains, oscillators, dry loop, and auditions', () => {
    assert.match(indexHtml, /function getClickGuardSeconds\(\)/);
    assert.match(indexHtml, /function getFadeSecondsForDuration\(durationSeconds\)/);
    assert.match(indexHtml, /const minimumFadeSeconds = getFadeSecondsForDuration\(grainSize\)/);
    assert.match(indexHtml, /Math\.max\(attackRaw \/ 1000, minimumFadeSeconds\)/);
    assert.match(indexHtml, /Math\.max\(releaseRaw \/ 1000, minimumFadeSeconds\)/);
    assert.match(indexHtml, /const voiceClickGuard = getClickGuardSeconds\(\)/);
    assert.match(indexHtml, /const fadeSeconds = getFadeSecondsForDuration\(boundedLoopEnd - offset\)/);
    assert.match(indexHtml, /gain\.gain\.linearRampToValueAtTime\(outputGain, safeStartTime \+ fadeSeconds\)/);
    assert.match(indexHtml, /const fadeSeconds = getFadeSecondsForDuration\(duration\)/);
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
    assert.doesNotMatch(indexHtml, /\.simplified-ui \.keyboard-section #holdBtn,\s*\n\s*\.simplified-ui \.keyboard-section #panicBtn/);
    assert.match(indexHtml, /\.simplified-ui \.keyboard-section #holdBtn\s*\{/);
    assert.match(indexHtml, /grid-column: 2;[\s\S]*grid-row: 2;[\s\S]*display: flex !important;/);
    assert.match(indexHtml, /@media \(max-width: 640px\) \{[\s\S]*\.simplified-ui \.performance-controls \{[\s\S]*order: 2;/);
    assert.match(indexHtml, /@media \(max-width: 640px\) \{[\s\S]*\.simplified-ui \.keyboard-section \{[\s\S]*order: 1;/);
    assert.match(indexHtml, /@media screen and \(max-height: 430px\) and \(orientation: landscape\) \{[\s\S]*\.simplified-ui \.keyboard-section \{[\s\S]*order: 1;/);
    assert.match(indexHtml, /@media screen and \(max-height: 430px\) and \(orientation: landscape\) \{[\s\S]*\.simplified-ui \.performance-controls \{[\s\S]*order: 2;/);
});

test('keyboard keys release cleanly so they can be pressed repeatedly', () => {
    assert.match(indexHtml, /let isKeyPressed = false/);
    assert.match(indexHtml, /const pressKey = \(pointerId = null\) => \{\s*if \(isKeyPressed\) return;/);
    assert.match(indexHtml, /const releaseKey = \(pointerId = null\) => \{\s*if \(!isKeyPressed\) return;/);
    assert.match(indexHtml, /isKeyPressed = false;\s*activeKeyCount = Math\.max\(0, activeKeyCount - 1\);/);
    assert.match(indexHtml, /key\.addEventListener\('pointerup', \(e\) => \{\s*releaseKey\(e\.pointerId\);/);
    assert.match(indexHtml, /key\.addEventListener\('lostpointercapture', \(e\) => \{[\s\S]*releaseKey\(e\.pointerId\);/);
    assert.match(indexHtml, /key\.addEventListener\('keydown', \(e\) => \{[\s\S]*pressKey\(\);/);
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

test('patch randomize leaves instrument mix and balance controls alone', () => {
    const experimentalPatch = indexHtml.match(/function applyExperimentalLoopPatch\(\) \{[\s\S]*?\n        \}/)?.[0] || '';
    assert.ok(experimentalPatch, 'applyExperimentalLoopPatch should be present');

    [
        'oscMix',
        'performanceSourceMix',
        'performanceGeneratedSourceMix',
        'performanceGeneratedDryMix',
        'performanceGeneratedDryTrim',
        'performanceGranularTrim',
        'performanceGeneratedTranspose',
        'performanceInputTrim',
        'performancePostFilterTrim',
        'performanceMasterTrim',
        'performanceClickGuard',
        'osc1Level',
        'osc2Level',
        'noiseMix',
        'reverb',
        'delayMix',
        'volume',
        'preFilterGain',
        'postFilterGain'
    ].forEach((id) => {
        assert.match(indexHtml, new RegExp(`'${id}'`));
    });
    assert.match(indexHtml, /const RANDOMIZE_SKIP_PARAMS = new Set/);
    assert.match(indexHtml, /RANDOMIZE_SKIP_PARAMS\.has\(param\)/);
    assert.match(indexHtml, /Patch randomized and new loop generated; source loop points and mix balances kept\./);
    assert.doesNotMatch(experimentalPatch, /oscMix:/);
    assert.doesNotMatch(experimentalPatch, /performanceGeneratedSourceMix:/);
    assert.doesNotMatch(experimentalPatch, /performanceGeneratedDryMix:/);
    assert.doesNotMatch(experimentalPatch, /performanceGeneratedDryTrim:/);
    assert.doesNotMatch(experimentalPatch, /performanceGranularTrim:/);
    assert.doesNotMatch(experimentalPatch, /noiseMix:/);
    assert.doesNotMatch(experimentalPatch, /reverb:/);
    assert.doesNotMatch(experimentalPatch, /delayMix:/);
    assert.doesNotMatch(experimentalPatch, /volume:/);
    assert.doesNotMatch(experimentalPatch, /preFilterGain:/);
    assert.doesNotMatch(experimentalPatch, /postFilterGain:/);
    assert.doesNotMatch(experimentalPatch, /performanceInputTrim:/);
    assert.doesNotMatch(experimentalPatch, /performancePostFilterTrim:/);
    assert.doesNotMatch(experimentalPatch, /performanceMasterTrim:/);
    assert.doesNotMatch(experimentalPatch, /performanceClickGuard:/);
});

test('granular engine routes generated and mic buffers as separate sources', () => {
    assert.match(indexHtml, /let generatedLoopBuffer = null/);
    assert.match(indexHtml, /let generatedLoopBaseBuffer = null/);
    assert.match(indexHtml, /let micAudioBuffer = null/);
    assert.match(indexHtml, /function getAvailableGranularSources\(\)/);
    assert.match(indexHtml, /let generatedSourceMix = 1/);
    assert.match(indexHtml, /function getGranularSourceGainMap\(sources, availableGain = 1\)/);
    assert.match(indexHtml, /let generatedDryMix = 0/);
    assert.match(indexHtml, /function startGeneratedDryLoop\(startTime = null\)/);
    assert.match(indexHtml, /function stopGeneratedDryLoop\(options = \{\}\)/);
    assert.match(indexHtml, /let generatedDryThroughFilters = false/);
    assert.match(indexHtml, /gain\.connect\(generatedDryThroughFilters && preFilterGainNode \? preFilterGainNode : masterGain\)/);
    assert.match(indexHtml, /performanceDryFilterBtn\.classList\.toggle\('dry-filtered', generatedDryThroughFilters\)/);
    assert.match(indexHtml, /setGeneratedDryThroughFilters\(!generatedDryThroughFilters\)/);
    assert.match(indexHtml, /generatedLoopBuffer/);
    assert.match(indexHtml, /micAudioBuffer/);
    assert.match(indexHtml, /sourceGainMap\.get\(sourceInfo\) \?\? 0/);
    assert.match(indexHtml, /resetSourceLoopPoints\(kind\)/);
    assert.match(indexHtml, /setFilterEnabled\('hpf', false\)/);
});

test('generated loop transpose keeps tempo length independent of keyboard octave', () => {
    assert.match(indexHtml, /let generatedLoopTransposeOctaves = 0/);
    assert.match(indexHtml, /function clampGeneratedLoopTransposeOctaves\(value\)/);
    assert.match(indexHtml, /return Math\.max\(-3, Math\.min\(3, Math\.round\(numeric\)\)\)/);
    assert.match(indexHtml, /function pitchShiftBufferKeepDuration\(sourceBuffer, octaves\)/);
    assert.match(indexHtml, /sourceBuffer\.length/);
    assert.match(indexHtml, /audioContext\.createBuffer\(\s*sourceBuffer\.numberOfChannels,\s*sourceBuffer\.length,\s*sourceBuffer\.sampleRate\s*\)/);
    assert.match(indexHtml, /function renderGeneratedLoopBufferWithTranspose\(sourceBuffer = generatedLoopBaseBuffer\)/);
    assert.match(indexHtml, /generatedLoopBuffer = renderGeneratedLoopBufferWithTranspose\(generatedLoopBaseBuffer\)/);
    assert.match(indexHtml, /performanceGeneratedTranspose\?\.addEventListener\('input', async \(event\) => \{/);
    assert.match(indexHtml, /formatGeneratedLoopTranspose\(e\.target\.value\)/);
    assert.match(indexHtml, /generatedLoopTransposeOctaves: getGeneratedLoopTransposeOctaves\(\)/);
    assert.match(indexHtml, /octave: octaveOffset/);
});

test('generated source uses strict straight grid timing', () => {
    assert.match(indexHtml, /let generatedSourceSwing = 0/);
    assert.match(indexHtml, /function getGeneratedSourceSwingValue\(\)/);
    assert.match(indexHtml, /id="performanceGeneratedSwing" min="0" max="60" value="0"/);
    assert.match(indexHtml, /const stepDuration = \(60 \/ bpm\) \/ 4/);
    assert.match(indexHtml, /const loopSteps = 16/);
    assert.match(indexHtml, /const duration = stepDuration \* loopSteps/);
    assert.doesNotMatch(indexHtml, /grooveSwing/);
    assert.doesNotMatch(indexHtml, /Math\.random\(\) \* stepDuration \* 0\.18/);
    assert.doesNotMatch(indexHtml, /stepDuration \/ repeats/);
    assert.match(indexHtml, /performanceGeneratedSwing: 0/);
});

test('generating a new performance loop restarts active playback', () => {
    assert.match(indexHtml, /const shouldRestartSequencer = sequencerPlaying/);
    assert.match(indexHtml, /const shouldRestartDryLoop = Boolean\(generatedDrySource\)/);
    assert.match(indexHtml, /if \(shouldRestartSequencer\) \{\s*stopSequencer\(\);/);
    assert.match(indexHtml, /await generateRandomSourceSample\(\);\s*generateInterestingLoop\(\);/);
    assert.match(indexHtml, /if \(shouldRestartSequencer\) \{\s*startSequencer\(\);/);
    assert.match(indexHtml, /else if \(shouldRestartDryLoop\) \{\s*startGeneratedDryLoop\(\);/);
});

test('randomize patch automatically generates a new performance loop', () => {
    assert.match(indexHtml, /document\.getElementById\('randomizeBtn'\)\.addEventListener\('click', async \(\) => \{/);
    assert.match(indexHtml, /setPerformanceGenerateButtonState\('generating'\);[\s\S]*await generatePerformanceLoop\(\);[\s\S]*setPerformanceGenerateButtonState\('generated'\);/);
    assert.match(indexHtml, /Patch randomized and new loop generated; source loop points and mix balances kept\./);
    assert.match(indexHtml, /Patch randomized; start MYGRAIN to generate the source loop\./);
});

test('daw export renders from time zero with generated dry stem', () => {
    assert.match(indexHtml, /function exportDawReadyBars\(\)/);
    assert.match(indexHtml, /renderDawReadyBuffer\(\{ bars, includeDryGenerated: true, dryOnly: false \}\)/);
    assert.match(indexHtml, /renderDawReadyBuffer\(\{ bars, includeDryGenerated: true, dryOnly: true \}\)/);
    assert.match(indexHtml, /generatedDryThroughFilters \? filterInput : master/);
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

test('generated source and sequencer are experimental on a strict sixteenth grid', () => {
    assert.match(indexHtml, /experimentalTonePalette/);
    assert.match(indexHtml, /const anchorSteps = \[0, 4, 8, 12/);
    assert.match(indexHtml, /addExperimentalEvent\('gridZap', step \* stepDuration/);
    assert.doesNotMatch(indexHtml, /triplet/i);
    assert.doesNotMatch(indexHtml, /ratchet/i);
    assert.doesNotMatch(indexHtml, /subHits/);
    assert.doesNotMatch(indexHtml, /offset: 1 \/ 3/);
    assert.doesNotMatch(indexHtml, /offset: 2 \/ 3/);
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

test('all internal lfos can be forced to square, toggled off, and cleared by randomize', () => {
    assert.match(indexHtml, /let allLfosSquareForced = false/);
    assert.match(indexHtml, /let allLfosSquarePreviousWaveforms = null/);
    assert.match(indexHtml, /const INTERNAL_LFO_WAVEFORM_IDS = \['lfoWaveform', 'lfo2Waveform', 'lfo3Waveform'\]/);
    assert.match(indexHtml, /function getInternalLfoWaveformSnapshot\(\)/);
    assert.match(indexHtml, /function setAllInternalLfoWaveforms\(waveform, options = \{\}\)/);
    assert.match(indexHtml, /allLfosSquarePreviousWaveforms = getInternalLfoWaveformSnapshot\(\)/);
    assert.match(indexHtml, /setAllInternalLfoWaveforms\('square', \{ forcedSquare: true \}\)/);
    assert.match(indexHtml, /if \(allLfosSquareForced\) \{\s*clearAllLfoSquareForce\(\{ restoreWaveforms: true \}\);/);
    assert.match(indexHtml, /Object\.entries\(previousWaveforms\)\.forEach\(\(\[id, value\]\) => \{/);
    assert.match(indexHtml, /clearAllLfoSquareForce\(\);[\s\S]*\/\/ Randomize oscillator octave buttons/);
    assert.match(indexHtml, /performanceLfoSquareBtn\.classList\.toggle\('active', allLfosSquareForced\)/);
});
