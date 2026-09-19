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
    assert.match(indexHtml, /await generateSourceWithPlaybackRestart\(\{ refreshSequencerPattern: true \}\);/);
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
    assert.match(indexHtml, /id="performanceModAmount" min="0" max="100" value="55" step="1"/);
    assert.match(indexHtml, />Mod Amount</);
    assert.match(indexHtml, /id="performanceGrainModAmount" min="0" max="100" value="75" step="1"/);
    assert.match(indexHtml, />Grain Mod</);
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
    assert.match(indexHtml, /id="performanceNoiseOffBtn"/);
    assert.match(indexHtml, /id="performanceLowNoiseSourceBtn"/);
    assert.match(indexHtml, /function setFxMuted\(muted, options = \{\}\)/);
    assert.match(indexHtml, /function setGeneratedDryThroughFilters\(enabled, options = \{\}\)/);
    assert.match(indexHtml, /const reverbAmt = fxMuted \? 0 : getModulatedValue\('reverb'\) \/ 100/);
    assert.match(indexHtml, /const mix = fxMuted \? 0 : getModulatedValue\('delayMix'\) \/ 100/);
    assert.match(indexHtml, /id="oscMix" min="0" max="100" value="35"/);
    assert.match(indexHtml, /id="lpfQ" min="0\.1" max="2\.5" value="0\.6"/);
});

test('mobile controls can remove the noise oscillator and its modulation', () => {
    assert.match(indexHtml, /id="performanceNoiseOffBtn">Noise Off<\/button>/);
    assert.match(indexHtml, /function isNoiseOscillatorActive\(\)/);
    assert.match(indexHtml, /function clearModulationForParam\(param\)/);
    assert.match(indexHtml, /function removeNoiseOscillator\(options = \{\}\)/);
    assert.match(indexHtml, /setSelectValue\('noiseType', 'none'\)/);
    assert.match(indexHtml, /setSliderValue\('noiseMix', 0\)/);
    assert.match(indexHtml, /clearModulationForParam\('noiseMix'\)/);
    assert.match(indexHtml, /performanceNoiseOffBtn\.classList\.toggle\('noise-active', noiseActive\)/);
    assert.match(indexHtml, /performanceNoiseOffBtn\?\.addEventListener\('click', \(\) => \{[\s\S]*removeNoiseOscillator\(\);/);
    assert.match(indexHtml, /document\.getElementById\('noiseType'\)\?\.addEventListener\('change', syncPerformanceControlState\)/);
});

test('generate source has a low-frequency noise-only mode without clicky transient events', () => {
    assert.match(indexHtml, /id="performanceLowNoiseSourceBtn">Low Noise Source<\/button>/);
    assert.match(indexHtml, /let generatedSourceLowNoiseMode = false/);
    assert.match(indexHtml, /function setGeneratedSourceLowNoiseMode\(enabled, options = \{\}\)/);
    assert.match(indexHtml, /const lowNoiseOnly = generatedSourceLowNoiseMode/);
    assert.match(indexHtml, /addExperimentalEvent\(lowNoiseOnly \? 'lowNoiseHit' : 'subPulse'/);
    assert.match(indexHtml, /addExperimentalEvent\(lowNoiseOnly \? 'noiseBody' : \(Math\.random\(\) < 0\.5 \? 'fmKnock' : 'vowelBlip'\)/);
    assert.match(indexHtml, /addExperimentalEvent\('softNoisePush'/);
    assert.match(indexHtml, /event\.type === 'lowNoiseHit'/);
    assert.match(indexHtml, /event\.type === 'noiseBody'/);
    assert.match(indexHtml, /event\.type === 'softNoisePush'/);
    assert.match(indexHtml, /attack: Math\.max\(options\.attack \?\? 0\.018, lowNoiseOnly \? 0\.022 : 0\.014\)/);
    assert.doesNotMatch(indexHtml, /gridZap/);
    assert.doesNotMatch(indexHtml, /dustTick/);
    assert.doesNotMatch(indexHtml, /metalShard/);
    assert.match(indexHtml, /performanceLowNoiseSourceBtn\?\.addEventListener\('click', \(\) => \{[\s\S]*setGeneratedSourceLowNoiseMode\(!generatedSourceLowNoiseMode\);/);
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

test('held keyboard grains loop continuously while sequencer grains play separately', () => {
    assert.match(indexHtml, /function makePerformanceStreamId\(role, note\)/);
    assert.match(indexHtml, /function resolveContinuousLoopPosition\(sampleWindow, positionPct, scheduledTime, streamStartTime, playbackRate\)/);
    assert.match(indexHtml, /resolveLoopedPlayPosition/);
    assert.match(indexHtml, /sprayAmount: options\.continuousLoop \? 0 : spray/);
    assert.match(indexHtml, /const playPosition = options\.continuousLoop[\s\S]*resolveContinuousLoopPosition/);
    assert.match(indexHtml, /activeGrains\.set\(streamId, \{[\s\S]*note,[\s\S]*role,[\s\S]*continuousLoop: options\.continuousLoop \?\? role === 'keyboard'/);
    assert.match(indexHtml, /playGrain\(grainInfo\.note, grainInfo\.nextTime, grainInfo\.velocity, \{[\s\S]*streamStartTime: grainInfo\.startTime,[\s\S]*continuousLoop: grainInfo\.continuousLoop/);
    assert.match(indexHtml, /stopAllGrains\(\{ role: 'sequencer' \}\)/);
    assert.match(indexHtml, /startGrainStream\(step\.pitch, scheduledTime, stepVelocity, \{[\s\S]*role: 'sequencer',[\s\S]*continuousLoop: false/);
    assert.doesNotMatch(indexHtml, /currentGrainNote !== null && currentGrainNote !== note/);
});

test('keyboard and sequencer oscillator voices are independent', () => {
    assert.match(indexHtml, /const voiceId = options\.voiceId \|\| makePerformanceStreamId\(role, note\)/);
    assert.match(indexHtml, /activeOscVoices\.set\(voiceId, \{[\s\S]*note,[\s\S]*role,/);
    assert.match(indexHtml, /function stopOscillatorsByRole\(role, scheduledTime = null\)/);
    assert.match(indexHtml, /stopOscillatorsByRole\('sequencer', Math\.max\(0, scheduledTime - 0\.02\)\)/);
    assert.match(indexHtml, /playOscillatorNote\(step\.pitch, scheduledTime, stepVelocity, \{ role: 'sequencer' \}\)/);
    assert.match(indexHtml, /stopOscillatorsByRole\('sequencer'\);/);
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
        'performanceModAmount',
        'performanceGrainModAmount',
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

test('sequencer and grain schedulers use tighter audio lookahead', () => {
    assert.match(indexHtml, /const GRAIN_SCHEDULER_LOOKAHEAD = 0\.12/);
    assert.match(indexHtml, /const GRAIN_SCHEDULER_INTERVAL = 10/);
    assert.match(indexHtml, /const SCHEDULE_AHEAD_TIME = 0\.12/);
    assert.match(indexHtml, /const SCHEDULER_INTERVAL = 10/);
    assert.match(indexHtml, /sequencerNextStepTime = audioContext\.currentTime \+ 0\.04/);
    assert.match(indexHtml, /startGeneratedDryLoop\(sequencerNextStepTime\)/);
});

test('generating a new performance loop restarts active playback', () => {
    assert.match(indexHtml, /async function generateSourceWithPlaybackRestart\(options = \{\}\)/);
    assert.match(indexHtml, /const shouldRestartSequencer = sequencerPlaying/);
    assert.match(indexHtml, /const shouldRestartDryLoop = Boolean\(generatedDrySource\)/);
    assert.match(indexHtml, /if \(shouldRestartSequencer\) \{\s*stopSequencer\(\);/);
    assert.match(indexHtml, /await generateRandomSourceSample\(\);[\s\S]*if \(options\.refreshSequencerPattern\) \{\s*generateInterestingLoop\(\);/);
    assert.match(indexHtml, /if \(shouldRestartSequencer\) \{\s*startSequencer\(\);/);
    assert.match(indexHtml, /else if \(shouldRestartDryLoop\) \{\s*startGeneratedDryLoop\(\);/);
});

test('generate source restarts active loop playback after replacing the source', () => {
    assert.match(indexHtml, /async function generateStandaloneSource\(\)/);
    assert.match(indexHtml, /generateSourceBtn\?\.addEventListener\('click', async \(\) => \{[\s\S]*await generateStandaloneSource\(\);/);
    assert.match(indexHtml, /generateSourceWithPlaybackRestart\(\{ refreshSequencerPattern: false \}\)/);
    assert.match(indexHtml, /setStatus\('Generated source and restarted loop playback\.'\)/);
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
    assert.match(indexHtml, /addExperimentalEvent\('softNoisePush', step \* stepDuration/);
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

test('all internal lfos can be forced to square and waveform controls stay manual through randomize', () => {
    assert.match(indexHtml, /let allLfosSquareForced = false/);
    assert.match(indexHtml, /let allLfosSquarePreviousWaveforms = null/);
    assert.match(indexHtml, /const INTERNAL_LFO_WAVEFORM_IDS = \['lfoWaveform', 'lfo2Waveform', 'lfo3Waveform'\]/);
    assert.match(indexHtml, /const RANDOMIZE_SKIP_SELECTS = new Set\(\[/);
    assert.match(indexHtml, /'lfoWaveform'/);
    assert.match(indexHtml, /'lfo2Waveform'/);
    assert.match(indexHtml, /'lfo3Waveform'/);
    assert.match(indexHtml, /'osc1Wave'/);
    assert.match(indexHtml, /'osc2Wave'/);
    assert.match(indexHtml, /function getInternalLfoWaveformSnapshot\(\)/);
    assert.match(indexHtml, /function setAllInternalLfoWaveforms\(waveform, options = \{\}\)/);
    assert.match(indexHtml, /function setAllInternalLfoPulseWidths\(value, options = \{\}\)/);
    assert.match(indexHtml, /allLfosSquarePreviousWaveforms = getInternalLfoWaveformSnapshot\(\)/);
    assert.match(indexHtml, /setAllInternalLfoWaveforms\('square', \{ forcedSquare: true \}\)/);
    assert.match(indexHtml, /if \(allLfosSquareForced\) \{\s*clearAllLfoSquareForce\(\{ restoreWaveforms: true \}\);/);
    assert.match(indexHtml, /Object\.entries\(previousWaveforms\)\.forEach\(\(\[id, value\]\) => \{/);
    assert.doesNotMatch(indexHtml, /clearAllLfoSquareForce\(\);[\s\S]*\/\/ Randomize oscillator octave buttons/);
    assert.match(indexHtml, /setAllInternalLfoWaveforms\(event\.target\.value\)/);
    assert.match(indexHtml, /setAllInternalLfoPulseWidths\(event\.target\.value\)/);
    assert.match(indexHtml, /performanceLfoSquareBtn\.classList\.toggle\('active', allLfosSquareForced\)/);
});

test('randomize snaps internal lfo rates to musical BPM ratios', () => {
    assert.match(indexHtml, /const INTERNAL_LFO_RATE_IDS = \['lfoRate', 'lfo2Rate', 'lfo3Rate', 'phaserRate', 'tremoloRate'\]/);
    assert.match(indexHtml, /const INTERNAL_BPM_CLOCK_RATE_IDS = \['delayBpm', \.\.\.INTERNAL_LFO_RATE_IDS\]/);
    assert.match(indexHtml, /const INTERNAL_LFO_BPM_MULTIPLIERS = \[0\.25, 0\.5, 1, 2, 4, 8\]/);
    assert.match(indexHtml, /function clampInternalLfoBpmValue\(value, fallback = 120\)/);
    assert.match(indexHtml, /function getSharedBpmClockValue\(\)/);
    assert.match(indexHtml, /function setInternalLfoRateBpm\(id, bpm\)/);
    assert.match(indexHtml, /function randomizeInternalLfoTempoRatios\(options = \{\}\)/);
    assert.match(indexHtml, /const multiplier = INTERNAL_LFO_BPM_MULTIPLIERS\[Math\.floor\(Math\.random\(\) \* INTERNAL_LFO_BPM_MULTIPLIERS\.length\)\]/);
    assert.match(indexHtml, /setInternalLfoRateBpm\(id, baseBpm \* multiplier\)/);
    assert.match(indexHtml, /INTERNAL_BPM_CLOCK_RATE_IDS\.forEach\(\(id\) => \{/);
    assert.match(indexHtml, /const bpm = getSharedBpmClockValue\(\);[\s\S]*const division = document\.getElementById\('delayDivision'\)\?\.value \|\| '4'/);
    assert.match(indexHtml, /restoreRandomizeProtectedSliders\(protectedRandomizeSliders\);\s*randomizeInternalLfoTempoRatios\(\);/);
    assert.match(indexHtml, /phaserLFO\.frequency\.value = clampInternalLfoBpmValue\(document\.getElementById\('phaserRate'\)\?\.value \|\| 30\) \/ 60/);
    assert.match(indexHtml, /tremoloLFO\.frequency\.value = clampInternalLfoBpmValue\(document\.getElementById\('tremoloRate'\)\?\.value \|\| 120\) \/ 60/);
});

test('randomize tames lfo depth and routes modulation broadly', () => {
    assert.match(indexHtml, /const RANDOMIZE_LFO_DEPTH_RANGES = \{/);
    assert.match(indexHtml, /lfoDepth: \{ min: 6, max: 32 \}/);
    assert.match(indexHtml, /lfo2Depth: \{ min: 4, max: 28 \}/);
    assert.match(indexHtml, /lfo3Depth: \{ min: 0, max: 22 \}/);
    assert.match(indexHtml, /phaserDepth: \{ min: 0, max: 18 \}/);
    assert.match(indexHtml, /tremoloDepth: \{ min: 0, max: 16 \}/);
    assert.match(indexHtml, /const GRANULAR_LFO_MODULATION_SCALES = \{/);
    assert.match(indexHtml, /generatedLoopStart: 0\.12/);
    assert.match(indexHtml, /generatedLoopEnd: 0\.12/);
    assert.match(indexHtml, /micLoopStart: 0\.12/);
    assert.match(indexHtml, /micLoopEnd: 0\.12/);
    assert.match(indexHtml, /grainSize: 0\.14/);
    assert.match(indexHtml, /attack: 0\.05/);
    assert.match(indexHtml, /let globalModulationAmount = 0\.55/);
    assert.match(indexHtml, /let granularModulationAmount = 0\.75/);
    assert.match(indexHtml, /function getGlobalModulationAmountValue\(\)/);
    assert.match(indexHtml, /function setGlobalModulationAmount\(value, options = \{\}\)/);
    assert.match(indexHtml, /function getGranularModulationAmountValue\(\)/);
    assert.match(indexHtml, /function setGranularModulationAmount\(value, options = \{\}\)/);
    assert.match(indexHtml, /function getLfoModulationScale\(paramId\)/);
    assert.match(indexHtml, /return baseScale \* getGlobalModulationAmountValue\(\) \* grainScale/);
    assert.match(indexHtml, /const RANDOMIZE_GRANULAR_LFO_TARGET_PARAMS = new Set\(\[/);
    assert.match(indexHtml, /'sampleStart'/);
    assert.match(indexHtml, /'sampleEnd'/);
    assert.match(indexHtml, /'generatedLoopStart'/);
    assert.match(indexHtml, /'generatedLoopEnd'/);
    assert.match(indexHtml, /'micLoopStart'/);
    assert.match(indexHtml, /'micLoopEnd'/);
    assert.match(indexHtml, /'grainSize'/);
    assert.match(indexHtml, /'density'/);
    assert.match(indexHtml, /'position'/);
    assert.match(indexHtml, /'attack'/);
    assert.match(indexHtml, /'release'/);
    assert.match(indexHtml, /const PRIORITY_RANDOM_LFO_TARGET_PARAMS = new Set\(\[/);
    assert.match(indexHtml, /'lpfCutoff'/);
    assert.match(indexHtml, /'lpfQ'/);
    assert.match(indexHtml, /'hpfCutoff'/);
    assert.match(indexHtml, /'hpfQ'/);
    assert.match(indexHtml, /'generatedLoopStart'/);
    assert.match(indexHtml, /'micLoopEnd'/);
    assert.match(indexHtml, /function randomizeLfoDepths\(\)/);
    assert.match(indexHtml, /const INTERNAL_RANDOMIZE_SLIDER_RANGES = \{/);
    assert.match(indexHtml, /performanceGeneratedSwing: \{ min: 0, max: 18 \}/);
    assert.match(indexHtml, /filterEnvAmount: \{ min: 8, max: 64 \}/);
    assert.match(indexHtml, /noiseMix: \{ min: 0, max: 24 \}/);
    assert.match(indexHtml, /function randomizeInternalParameters\(\)/);
    assert.match(indexHtml, /randomizeInternalParameters\(\);/);
    assert.match(indexHtml, /function randomizeLfoRoutingMatrix\(\)/);
    assert.match(indexHtml, /const probability = isPriorityTarget \? 0\.78 : \(isGranularTarget \? 0\.42 : 0\.52\)/);
    assert.match(indexHtml, /if \(isPriorityTarget && enabledCount === 0\) \{/);
    assert.match(indexHtml, /randomizeLfoRoutingMatrix\(\);/);
});

test('grain scheduling and generated loops are BPM-grid rhythmic and bright again', () => {
    assert.match(indexHtml, /const BPM_CLOCK_GRAIN_DIVISIONS = \[0\.5, 1, 2, 4, 8, 16\]/);
    assert.match(indexHtml, /function getRhythmicGrainIntervalSeconds\(densityValue = null\)/);
    assert.match(indexHtml, /getRhythmicGrainIntervalSeconds\(density\)/);
    assert.match(indexHtml, /const backbeatSteps = new Set\(\[4, 12\]\)/);
    assert.match(indexHtml, /const isHatGrid = index % 2 === 1 && Math\.random\(\) < 0\.72/);
    assert.match(indexHtml, /'snareNoise'/);
    assert.match(indexHtml, /'hatNoise'/);
    assert.match(indexHtml, /'rimSnap'/);
    assert.match(indexHtml, /voice = Math\.tanh\(\(highNoise \* event\.color \+ metallic \* 0\.24\) \* 1\.8\) \* basicEnv/);
});

test('granular loop endpoints are lfo routable and used by grain playback', () => {
    assert.match(indexHtml, /data-param="generatedLoopStart" data-lfo="1"/);
    assert.match(indexHtml, /data-param="generatedLoopEnd" data-lfo="2"/);
    assert.match(indexHtml, /data-param="micLoopStart" data-lfo="1"/);
    assert.match(indexHtml, /data-param="micLoopEnd" data-lfo="2"/);
    assert.match(indexHtml, /generatedLoopStart: \{ min: 0, max: 100 \}/);
    assert.match(indexHtml, /micLoopEnd: \{ min: 0, max: 100 \}/);
    assert.match(indexHtml, /function getLoopRange\(startId, endId, options = \{\}\)/);
    assert.match(indexHtml, /const rawStart = options\.modulated \? getModulatedValue\(startId\) : Number\(startSlider\?\.value \?\? 0\)/);
    assert.match(indexHtml, /getLoopRange\(sourceInfo\.startId, sourceInfo\.endId, \{ modulated: true \}\)/);
});
