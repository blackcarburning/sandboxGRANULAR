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

test('keyboard lives in its own simplified feature card instead of a loose edge-to-edge block', () => {
    assert.ok(
        /class="performance-feature-card performance-keyboard-card" aria-label="Keyboard controls"[\s\S]*<div class="keyboard-section">/i.test(indexHtml),
        'keyboard should sit inside its own simplified feature card'
    );
});

test('mobile performance controls expose loop generation and playback', () => {
    assert.match(indexHtml, /id="performanceGenerateLoopBtn"/);
    assert.match(indexHtml, /setPerformanceGenerateButtonState\('generating'\)/);
    assert.match(indexHtml, /setPerformanceGenerateButtonState\('generated'\)/);
    assert.match(indexHtml, /#performanceGenerateLoopBtn\.generating/);
    assert.match(indexHtml, /id="performanceSeqPlayBtn"/);
    assert.match(indexHtml, /function generateInterestingLoop\(options = \{\}\)/);
    assert.match(indexHtml, /await generateSourceWithPlaybackRestart\(\{ refreshSequencerPattern: true \}\);/);
});

test('main panel actions stay two-up on phone and restart all starts the full rig', () => {
    assert.match(indexHtml, /\.simplified-ui \.performance-actions \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    assert.match(indexHtml, /@media \(max-width: 640px\) \{[\s\S]*\.simplified-ui \.performance-actions \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    assert.match(indexHtml, /function restartAllTransport\(options = \{\}\) \{/);
    assert.match(indexHtml, /restartInternalEffectOscillators\(restartTime\);/);
    assert.match(indexHtml, /const shouldStartBastardLoop = Boolean\([\s\S]*dropboxSampleLayerBuffer[\s\S]*\);/);
    assert.match(indexHtml, /const shouldStartDrumMachine = Boolean\([\s\S]*drumMachineKickPattern\.some\(Boolean\)[\s\S]*drumMachineHatPattern\.some\(Boolean\)[\s\S]*\);/);
    assert.match(indexHtml, /if \(shouldStartSequencer\) \{[\s\S]*startSequencer\(restartTime\);/);
    assert.match(indexHtml, /if \(shouldStartBastardLoop\) \{[\s\S]*startAllBastardLoopLayers\(restartTime, \{ skipUi: true, silent: true \}\);/);
    assert.match(indexHtml, /if \(shouldStartDrumMachine\) \{[\s\S]*startDrumMachine\(restartTime, \{ skipUi: true, silent: true \}\);/);
});

test('simplified performance controls are grouped into labelled cards', () => {
    assert.match(indexHtml, /class="performance-feature-card performance-actions-card" aria-label="Main panel controls"/);
    assert.match(indexHtml, />Performance Actions<\/h3>/);
    assert.match(indexHtml, /class="performance-feature-card performance-export-card" aria-label="Export controls"/);
    assert.match(indexHtml, />Export Length<\/h3>/);
    assert.match(indexHtml, /class="performance-feature-card performance-keyboard-card" aria-label="Keyboard controls"/);
    assert.match(indexHtml, />Play Surface<\/h3>/);
    assert.match(indexHtml, />Granular Layer Controls<\/h3>/);
    assert.match(indexHtml, />Mix & Trim<\/h3>/);
    assert.match(indexHtml, />LFO & Motion<\/h3>/);
    assert.match(indexHtml, /class="performance-feature-card internal-effects-panel" id="internalEffectsPanel"/);
});

test('final shimmer branch is removed from the simplified output chain', () => {
    assert.doesNotMatch(indexHtml, /finalShimmerDepth/);
    assert.doesNotMatch(indexHtml, /createFinalShimmerImpulse/);
    assert.doesNotMatch(indexHtml, /finalShimmerNode/);
    assert.doesNotMatch(indexHtml, /Delay and shimmer/);
});

test('generate and randomize actions show a two second settle popup', () => {
    assert.match(indexHtml, /id="settlePopup"[\s\S]*>let it settle<\/div>/);
    assert.match(indexHtml, /function showSettlePopup\(\)/);
    assert.match(indexHtml, /settlePopup\.classList\.add\('visible'\)/);
    assert.match(indexHtml, /settlePopupTimer = setTimeout\(\(\) => \{[\s\S]*\}, 2000\);/);
    assert.match(indexHtml, /document\.getElementById\('randomizeBtn'\)\.addEventListener\('click', async \(\) => \{\s*showSettlePopup\(\);/);
    assert.match(indexHtml, /performanceGenerateLoopBtn\?\.addEventListener\('click', async \(\) => \{[\s\S]*showSettlePopup\(\);[\s\S]*setPerformanceGenerateButtonState\('generating'\)/);
});

test('shared BPM controls allow 1 BPM and restore remembered tempo into the live clock', () => {
    assert.match(indexHtml, /id="globalBpmSlider" min="1" max="300" value="120" step="1"/);
    assert.match(indexHtml, /id="globalBpmNumber" min="1" max="300" value="120" step="1"/);
    assert.match(indexHtml, /id="seqBpm" min="1" max="300" value="120" step="1"/);
    assert.match(indexHtml, /id="delayBpm" min="1" max="300" value="120" step="1"/);
    assert.match(indexHtml, /const GLOBAL_BPM_MIN = 1;/);
    assert.match(indexHtml, /const INTERNAL_LFO_BPM_MIN = 1;/);
    assert.match(indexHtml, /document\.getElementById\('seqBpm'\)\.addEventListener\('input', \(e\) => \{[\s\S]*const value = clampBpmValue\(e\.target\.value\);[\s\S]*syncGlobalBpmControls\(value\);[\s\S]*\}\);/);
    assert.match(indexHtml, /document\.getElementById\('seqBpm'\)\.addEventListener\('change', \(e\) => \{[\s\S]*let value = clampBpmValue\(e\.target\.value\);[\s\S]*e\.target\.value = value;[\s\S]*syncGlobalBpmControls\(value\);[\s\S]*\}\);/);
    assert.match(indexHtml, /restoreRememberedBpmFromStorage\(\{ applySharedClock: true \}\);/);
});

test('focus return can rebuild the audio engine without a full reload', () => {
    assert.match(indexHtml, /let foregroundAudioRecoveryPromise = null;/);
    assert.match(indexHtml, /function rebuildContextBoundAudioState\(\)/);
    assert.match(indexHtml, /async function rebuildAudioEngineGraph\(options = \{\}\)/);
    assert.match(indexHtml, /async function ensureForegroundAudioReady\(options = \{\}\)/);
    assert.match(indexHtml, /await rebuildAudioEngineGraph\(\{ silent: true \}\);/);
    assert.match(indexHtml, /async function resumePerformanceAfterFocusReturn\(\)/);
    assert.match(indexHtml, /await ensureForegroundAudioReady\(\{ silent: true \}\);/);
    assert.match(indexHtml, /document\.addEventListener\('visibilitychange', \(\) => \{[\s\S]*resumePerformanceAfterFocusReturn\(\)\.catch/);
    assert.match(indexHtml, /window\.addEventListener\('focus', \(\) => \{[\s\S]*resumePerformanceAfterFocusReturn\(\)\.catch/);
    assert.match(indexHtml, /window\.addEventListener\('pageshow', \(\) => \{[\s\S]*resumePerformanceAfterFocusReturn\(\)\.catch/);
    assert.match(indexHtml, /if \(!audioContext \|\| audioContext\.state === 'closed' \|\| !isAudioGraphReady\(\)\) \{[\s\S]*await rebuildAudioEngineGraph\(\{ silent: true \}\);/);
});

test('mobile performance controls expose mix and tame filter controls', () => {
    assert.match(indexHtml, /id="performanceSourceMix"/);
    assert.match(indexHtml, />Granular\/Osc</);
    assert.match(indexHtml, /id="performanceGeneratedSourceMix"/);
    assert.match(indexHtml, />Gen Loop Mix</);
    assert.match(indexHtml, /id="performanceGeneratedDryMix"/);
    assert.match(indexHtml, />Gen Dry</);
    assert.match(indexHtml, /id="performanceBastardLoopLevel" min="0" max="100" value="60" step="1"/);
    assert.match(indexHtml, /id="performanceBastardLoopFilterCutoff" min="300" max="18000" value="18000" step="10"/);
    assert.match(indexHtml, />Bastardloop</);
    assert.match(indexHtml, /id="performanceBastardLoopMeta">Empty<\/div>/);
    assert.match(indexHtml, /id="performanceGeneratedDryTrim" min="-24" max="6" value="-6"/);
    assert.match(indexHtml, />Dry Trim</);
    assert.match(indexHtml, /id="performanceGranularTrim" min="-24" max="6" value="-3"/);
    assert.match(indexHtml, />Grain Trim</);
    assert.match(indexHtml, /id="performanceGeneratedSwing"/);
    assert.match(indexHtml, />Gen Swing</);
    assert.match(indexHtml, /id="performanceGeneratedTranspose" min="-3" max="3" value="0" step="1"/);
    assert.match(indexHtml, />Loop Transpose</);
    assert.match(indexHtml, /id="performanceGrainPlaybackSpeed" min="25" max="400" value="100" step="1"/);
    assert.match(indexHtml, />Playback Speed</);
    assert.match(indexHtml, /id="performanceModAmount" min="0" max="100" value="55" step="1"/);
    assert.match(indexHtml, />Mod Amount</);
    assert.match(indexHtml, /id="performanceGrainModAmount" min="0" max="100" value="75" step="1"/);
    assert.match(indexHtml, />Grain Mod</);
    assert.match(indexHtml, /id="performanceLpfCutoff"/);
    assert.match(indexHtml, /id="performanceLpfResonance"/);
    assert.match(indexHtml, /id="performanceHpfCutoff"/);
    assert.match(indexHtml, /id="performanceHpfResonance"/);
    assert.match(indexHtml, /function clampPostFilterQ\(value\)\s*\{\s*return clampFilterQ\(value\);\s*\}/);
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
    assert.match(indexHtml, /id="performanceGenerateBastardLoopBtn">Generate Bastardloop<\/button>/);
    assert.match(indexHtml, /id="performanceBastardLoopBrowserBtn">Bastardloop Browser<\/button>/);
    assert.match(indexHtml, /id="performanceBastardLoopSoloBtn" aria-pressed="false">Solo Off<\/button>/);
    assert.match(indexHtml, /id="performanceBastardLoopPlayBtn">Play Bastardloop<\/button>/);
    assert.match(indexHtml, /id="performanceBastardLoopStopBtn">Stop Bastardloop<\/button>/);
    assert.match(indexHtml, /id="performanceBastardDivisionQuarter" value="1\/4"/);
    assert.match(indexHtml, /id="performanceBastardDivisionEighth" value="1\/8"/);
    assert.match(indexHtml, /id="performanceBastardDivisionSixteenth" value="1\/16" checked/);
    assert.match(indexHtml, /id="performanceBastardDivisionThirtySecond" value="1\/32"/);
    assert.match(indexHtml, /id="performanceFxMuteBtn"/);
    assert.match(indexHtml, /id="performanceDryFilterBtn"/);
    assert.match(indexHtml, /id="performanceNoiseOffBtn"/);
    assert.match(indexHtml, /id="performanceLowNoiseSourceBtn"/);
    assert.match(indexHtml, /function setFxMuted\(muted, options = \{\}\)/);
    assert.match(indexHtml, /function setGeneratedDryThroughFilters\(enabled, options = \{\}\)/);
    assert.match(indexHtml, /async function generateBastardLoopWithPlaybackRestart\(\)/);
    assert.match(indexHtml, /function createBastardLoopLowpassFilters\(cutoffHz\)/);
    assert.match(indexHtml, /Array\.from\(\{ length: 4 \}, \(\) => \{/);
    assert.match(indexHtml, /filter\.type = 'lowpass';/);
    assert.match(indexHtml, /function normalizeLoopLayerSolo\(value\)/);
    assert.match(indexHtml, /function setLoopLayerSolo\(layer, options = \{\}\)/);
    assert.match(indexHtml, /function getLoopLayerSoloGain\(layer\)/);
    assert.match(indexHtml, /function startBastardLoop\(startTime = null\)/);
    assert.match(indexHtml, /function updateBastardLoopMix\(\)/);
    assert.match(indexHtml, /const BASTARD_LOOP_REPOSITORY_BASE_URL = 'https:\/\/openclaw\.blackcarburning\.com\/mygrain-bastardloops'/);
    assert.match(indexHtml, /body: JSON\.stringify\(\{[\s\S]*divisions[\s\S]*\}\)/);
    assert.match(indexHtml, /performanceBastardLoopLevel\?\.addEventListener\('input'/);
    assert.match(indexHtml, /performanceBastardLoopFilterCutoff\?\.addEventListener\('input'/);
    assert.match(indexHtml, /performanceBastardLoopSoloBtn\?\.addEventListener\('click', \(\) => \{\s*setLoopLayerSolo\('bastarda', \{ toggle: true \}\);/);
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
    assert.match(indexHtml, /function buildGeneratedSourceDrumBlueprint\(profile = null\)/);
    assert.match(indexHtml, /buildGeneratedSourceDrumBlueprint\(generationProfile\)/);
    assert.match(indexHtml, /const rootChoices = lowNoiseOnly \? \[29, 31, 34, 36\] : \[34, 38, 42, 46, 50\]/);
    assert.match(indexHtml, /const rootFrequency = rootChoices\[Math\.floor\(renderRandom\(\) \* rootChoices\.length\)\]/);
    assert.match(indexHtml, /durationSeconds = Math\.max\([\s\S]*lowNoiseOnly \? 0\.045 : 0\.03/);
    assert.match(indexHtml, /noiseTone: Math\.max\(0, lowNoiseOnly \? Number\(recipe\.noiseTone \?\? 0\.2\) \* 0\.78 : Number\(recipe\.noiseTone \?\? 0\.2\)\)/);
    assert.match(indexHtml, /event\.category === 'kick'/);
    assert.match(indexHtml, /event\.category === 'shaker'/);
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

test('dropbox sample layer can browse and preview source samples before loading', () => {
    assert.match(indexHtml, /id="performanceDropboxSampleBrowseBtn">Browse Samples<\/button>/);
    assert.match(indexHtml, /id="dropboxSampleBrowserOverlay"/);
    assert.match(indexHtml, /id="dropboxSampleBrowserList"/);
    assert.match(indexHtml, /const DROPBOX_SAMPLE_SOURCE_FILES_API_URL = `\$\{BASTARD_LOOP_REPOSITORY_BASE_URL\}\/api\/source-files`/);
    assert.match(indexHtml, /function buildDropboxSampleSourcePreviewUrl\(sourceKey, relativePath\)/);
    assert.match(indexHtml, /function openDropboxSampleBrowser\(target = SAMPLE_BROWSER_TARGETS\.dropboxSampleLayer\)/);
    assert.match(indexHtml, /function refreshDropboxSampleBrowser\(options = \{\}\)/);
    assert.match(indexHtml, /audio\.controls = true/);
    assert.match(indexHtml, /audio\.src = file\.previewUrl/);
    assert.match(indexHtml, /performanceDropboxSampleBrowseBtn\?\.addEventListener\('click', \(\) => \{\s*openDropboxSampleBrowser\(\);/);
});

test('mobile keyboard keeps the legacy two-octave layout while preserving widened touch targets', () => {
    const keyMatches = indexHtml.match(/class="key /g) || [];
    const whiteKeyMatches = indexHtml.match(/class="key white"/g) || [];
    assert.equal(keyMatches.length, 24);
    assert.equal(whiteKeyMatches.length, 14);
    assert.match(indexHtml, /data-note="C1"/);
    assert.match(indexHtml, /data-note="C2"/);
    assert.doesNotMatch(indexHtml, /One octave, transposed by the octave buttons/);
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
    assert.match(indexHtml, /SOURCE_LOOP_CONTROL_DEFINITIONS\.forEach\(\(definition\) => \{/);
    assert.match(indexHtml, /document\.getElementById\(id\)\?\.addEventListener\('input', \(\) => handleSourceLoopChange\(definition\.kind\)\);/);
    assert.match(indexHtml, /if \(audioContext && activeGrains\.size > 0\) \{\s*rescheduleActiveGrainsFromNow\(\);\s*\}/);
    assert.doesNotMatch(indexHtml, /if \(audioContext && activeGrains\.size > 0\) \{\s*const now = audioContext\.currentTime;/);
});

test('patch randomize does not move manual source loop points', () => {
    assert.match(indexHtml, /const RANDOMIZE_SKIP_SLIDERS = new Set/);
    assert.match(indexHtml, /'generatedLoopStart'/);
    assert.match(indexHtml, /'generatedLoopEnd'/);
    assert.match(indexHtml, /'grainMainSampleLoopStart'/);
    assert.match(indexHtml, /'grainMainSampleLoopEnd'/);
    assert.match(indexHtml, /'micLoopStart'/);
    assert.match(indexHtml, /'micLoopEnd'/);
    assert.match(indexHtml, /'grainAMicLoopStart'/);
    assert.match(indexHtml, /'grainAMicLoopEnd'/);
    assert.match(indexHtml, /'grainASampleLoopStart'/);
    assert.match(indexHtml, /'grainASampleLoopEnd'/);
    assert.match(indexHtml, /'grainBMicLoopStart'/);
    assert.match(indexHtml, /'grainBMicLoopEnd'/);
    assert.match(indexHtml, /'grainBSampleLoopStart'/);
    assert.match(indexHtml, /'grainBSampleLoopEnd'/);
    assert.match(indexHtml, /'outputLoopStart'/);
    assert.match(indexHtml, /'outputLoopEnd'/);
    assert.match(indexHtml, /RANDOMIZE_SKIP_SLIDERS\.has\(id\)/);
});

test('patch randomize leaves instrument mix and balance controls alone', () => {
    const experimentalPatch = indexHtml.match(/function applyExperimentalLoopPatch\(options = \{\}\) \{[\s\S]*?\n        \}/)?.[0] || '';
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
    assert.match(indexHtml, /function getAvailableGranularSources\(options = \{\}\)/);
    assert.match(indexHtml, /makeGranularSource\('grainAMic'\)/);
    assert.match(indexHtml, /makeGranularSource\('grainBMic'\)/);
    assert.match(indexHtml, /makeGranularSource\('output'\)/);
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
    assert.match(indexHtml, /setFilterEnabled\('hpf', profile\.id !== 'sparse'\)/);
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
    assert.match(indexHtml, /await generateRandomSourceSample\(\{ profile: options\.profile, blueprint: options\.blueprint, sourceBlueprint: options\.sourceBlueprint \}\);[\s\S]*if \(options\.refreshSequencerPattern\) \{\s*generateInterestingLoop\(\{ profile: options\.profile, blueprint: options\.blueprint \}\);/);
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
    assert.match(indexHtml, /function applyRandomizeFinalCompressorDefaults\(\)/);
    assert.match(indexHtml, /setSliderValue\('finalCompressorAmount', 0\);/);
    assert.match(indexHtml, /setSliderValue\('finalSidechainAmount', 0\);/);
    assert.match(indexHtml, /setFinalCompressorSidechainSource\('off', \{ silent: true, skipSave: true \}\);/);
    assert.match(indexHtml, /async function runPatchRandomization\(\) \{\s*applyRandomizeFinalCompressorDefaults\(\);/);
    assert.match(indexHtml, /setPerformanceGenerateButtonState\('generating'\);[\s\S]*await generateSourceWithPlaybackRestart\(\{[\s\S]*refreshSequencerPattern: true,[\s\S]*profile: generationProfile,[\s\S]*blueprint: loopBlueprint[\s\S]*\}\);[\s\S]*setPerformanceGenerateButtonState\('generated'\);/);
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

test('export bars field stays editable until commit', () => {
    assert.match(indexHtml, /function parseEditableExportBars\(value\)/);
    assert.match(indexHtml, /function previewPerformanceExportBars\(value\)/);
    assert.match(indexHtml, /if \(text === ''\) \{\s*return \{ bars: null, empty: true, valid: false \};\s*\}/);
    assert.match(indexHtml, /performanceExportBars\?\.\s*addEventListener\('input', \(event\) => \{\s*previewPerformanceExportBars\(event\.target\.value\);/);
    assert.match(indexHtml, /performanceExportBars\?\.\s*addEventListener\('change', \(event\) => \{\s*syncPerformanceExportBars\(event\.target\.value\);/);
    assert.match(indexHtml, /performanceExportBars\?\.\s*addEventListener\('blur', \(event\) => \{\s*syncPerformanceExportBars\(event\.target\.value\);/);
});

test('performance layer switches can mute sample-drums, dry loop, and bastardloop without moving the mixer sliders', () => {
    assert.match(indexHtml, /id="performanceGeneratedLayerBtn"/);
    assert.match(indexHtml, /id="performanceDryLoopLayerBtn"/);
    assert.match(indexHtml, /id="performanceBastardLoopToggleBtn"/);
    assert.match(indexHtml, /let generatedSampleLayerEnabled = true/);
    assert.match(indexHtml, /let generatedDryLoopEnabled = true/);
    assert.match(indexHtml, /let bastardLoopEnabled = true/);
    assert.match(indexHtml, /function setGeneratedSampleLayerEnabled\(enabled, options = \{\}\)/);
    assert.match(indexHtml, /function setGeneratedDryLoopEnabled\(enabled, options = \{\}\)/);
    assert.match(indexHtml, /function setBastardLoopEnabled\(enabled, options = \{\}\)/);
    assert.match(indexHtml, /performanceGeneratedLayerBtn\?\.addEventListener\('click', \(\) => \{\s*setGeneratedSampleLayerEnabled\(!generatedSampleLayerEnabled\);/);
    assert.match(indexHtml, /performanceDryLoopLayerBtn\?\.addEventListener\('click', \(\) => \{\s*setGeneratedDryLoopEnabled\(!generatedDryLoopEnabled\);/);
    assert.match(indexHtml, /performanceBastardLoopToggleBtn\?\.addEventListener\('click', \(\) => \{\s*setBastardLoopEnabled\(!bastardLoopEnabled\);/);
    assert.match(indexHtml, /generatedSampleLayerEnabled: generatedSampleLayerEnabled/);
    assert.match(indexHtml, /generatedDryLoopEnabled: generatedDryLoopEnabled/);
    assert.match(indexHtml, /bastardLoopEnabled: bastardLoopEnabled/);
});

test('bastardloop has octave pitch steps and resyncs its loop cycle when retuned', () => {
    assert.match(indexHtml, /id="performanceBastardLoopPitch"/);
    assert.match(indexHtml, /min="-2" max="2" value="0" step="1"/);
    assert.match(indexHtml, /let bastardLoopPitchOctaves = 0/);
    assert.match(indexHtml, /function clampBastardLoopPitchOctaves\(value\)/);
    assert.match(indexHtml, /function getBastardLoopPitchRatio\(\)/);
    assert.match(indexHtml, /function getBastardLoopTempoRate\(sourceBpm\)/);
    assert.match(indexHtml, /function getBastardLoopCycleDuration\(playbackRate = getBastardLoopPlaybackRate\(\)\)/);
    assert.match(indexHtml, /const pitchRate = getBastardLoopPitchAffectsDuration\(\) \? getBastardLoopPitchRatio\(\) : 1;/);
    assert.match(indexHtml, /const cycleDuration = getBastardLoopCycleDuration\(playbackRate\);/);
    assert.match(indexHtml, /const cycleElapsed = cycleDuration > 0 \? elapsed % cycleDuration : 0;/);
    assert.match(indexHtml, /function setBastardLoopPitchOctaves\(value, options = \{\}\)/);
    assert.match(indexHtml, /if \(bastardLoopPlaying && bastardLoopBuffer\) \{\s*startBastardLoop\(null, \{ skipUi: true \}\);\s*\} else \{\s*syncAllBastardLoopTempos\(\);\s*\}/);
    assert.match(indexHtml, /performanceBastardLoopPitch\?\.addEventListener\('input', \(event\) => \{\s*setBastardLoopPitchOctaves\(event\.target\.value\);/);
});

test('all bastardloop layers can switch between duration-preserved and sampler-style pitch', () => {
    assert.match(indexHtml, /id="performanceBastardLoopPitchAffectsDuration"/);
    assert.match(indexHtml, /id="performanceBastardLoop2PitchAffectsDuration"/);
    assert.match(indexHtml, /id="performanceBastardLoop3PitchAffectsDuration"/);
    assert.match(indexHtml, /let bastardLoopPitchAffectsDuration = false/);
    assert.match(indexHtml, /let bastardLoop2PitchAffectsDuration = false/);
    assert.match(indexHtml, /let bastardLoop3PitchAffectsDuration = false/);
    assert.match(indexHtml, /function getBastardLoopPlaybackBufferForMode\(sourceBuffer, pitchRatio = 1, options = \{\}\)/);
    assert.match(indexHtml, /function getBastardLoopPitchAffectsDuration\(\)/);
    assert.match(indexHtml, /function getBastardLoop2PitchAffectsDuration\(\)/);
    assert.match(indexHtml, /function getBastardLoop3PitchAffectsDuration\(\)/);
    assert.match(indexHtml, /function setBastardLoopPitchAffectsDuration\(enabled, options = \{\}\)/);
    assert.match(indexHtml, /function setBastardLoop2PitchAffectsDuration\(enabled, options = \{\}\)/);
    assert.match(indexHtml, /function setBastardLoop3PitchAffectsDuration\(enabled, options = \{\}\)/);
    assert.match(indexHtml, /preserveDuration: !getBastardLoopPitchAffectsDuration\(\)/);
    assert.match(indexHtml, /preserveDuration: !getBastardLoop2PitchAffectsDuration\(\)/);
    assert.match(indexHtml, /preserveDuration: !getBastardLoop3PitchAffectsDuration\(\)/);
    assert.match(indexHtml, /performanceBastardLoopPitchAffectsDuration\?\.addEventListener\('change', \(event\) => \{\s*setBastardLoopPitchAffectsDuration\(event\.target\.checked\);/);
    assert.match(indexHtml, /performanceBastardLoop2PitchAffectsDuration\?\.addEventListener\('change', \(event\) => \{\s*setBastardLoop2PitchAffectsDuration\(event\.target\.checked\);/);
    assert.match(indexHtml, /performanceBastardLoop3PitchAffectsDuration\?\.addEventListener\('change', \(event\) => \{\s*setBastardLoop3PitchAffectsDuration\(event\.target\.checked\);/);
});

test('bastardloop has independent transport controls and is not owned by the sequencer stop path', () => {
    assert.match(indexHtml, /let bastardLoopPlaying = false/);
    assert.match(indexHtml, /let bastardLoopTransportStartTime = null/);
    assert.match(indexHtml, /function setBastardLoopPlaying\(enabled, options = \{\}\)/);
    assert.match(indexHtml, /performanceBastardLoopPlayBtn\?\.addEventListener\('click', \(\) => \{\s*setBastardLoopPlaying\(true\);/);
    assert.match(indexHtml, /performanceBastardLoopStopBtn\?\.addEventListener\('click', \(\) => \{\s*setBastardLoopPlaying\(false\);/);
    assert.match(indexHtml, /if \(bastardLoopPlaying && bastardLoopBuffer\) \{/);

    const startSequencerBlock = indexHtml.match(/function startSequencer\(startTime = null\) \{[\s\S]*?\n        \}/);
    assert.ok(startSequencerBlock, 'startSequencer block should exist');
    assert.doesNotMatch(startSequencerBlock[0], /startBastardLoop\(startAt\);/);

    const stopSequencerBlock = indexHtml.match(/function stopSequencer\(\) \{[\s\S]*?\n        \}/);
    assert.ok(stopSequencerBlock, 'stopSequencer block should exist');
    assert.doesNotMatch(stopSequencerBlock[0], /stopBastardLoop\(\);/);
});

test('bastardloop uses its own browser route and selectable note sizes', () => {
    assert.match(indexHtml, /id="performanceBastardLoopBrowserBtn">Bastardloop Browser<\/button>/);
    assert.match(indexHtml, /const BASTARD_LOOP_REPOSITORY_BASE_URL = 'https:\/\/openclaw\.blackcarburning\.com\/mygrain-bastardloops'/);
    assert.match(indexHtml, /const BASTARD_LOOP_API_URL = `\$\{BASTARD_LOOP_REPOSITORY_BASE_URL\}\/api\/bastardloop`/);
    assert.match(indexHtml, /id="performanceBastardDivisionQuarter" value="1\/4"/);
    assert.match(indexHtml, /id="performanceBastardDivisionEighth" value="1\/8"/);
    assert.match(indexHtml, /id="performanceBastardDivisionSixteenth" value="1\/16" checked/);
    assert.match(indexHtml, /id="performanceBastardDivisionThirtySecond" value="1\/32"/);
    assert.match(indexHtml, /function getSelectedBastardLoopDivisions\(options = \{\}\)/);
    assert.match(indexHtml, /function applyBastardLoopDivisionSelection\(divisions, options = \{\}\)/);
    assert.match(indexHtml, /body: JSON\.stringify\(\{[\s\S]*divisions[\s\S]*\}\)/);
});

test('second bastardloop layer uses SAMPLEDROP_2 and has its own pitch, level, resolutions, mute, and reverse controls', () => {
    assert.match(indexHtml, /id="performanceGenerateBastardLoop2Btn">Generate Bastardloop B<\/button>/);
    assert.match(indexHtml, /id="performanceBastardLoop2BrowserBtn">Bastardloop Browser<\/button>/);
    assert.match(indexHtml, /id="performanceBastardLoop2SoloBtn" aria-pressed="false">Solo Off<\/button>/);
    assert.match(indexHtml, /SAMPLEDROP_2/);
    assert.match(indexHtml, /id="performanceBastard2DivisionQuarter" value="1\/4"/);
    assert.match(indexHtml, /id="performanceBastard2DivisionEighth" value="1\/8"/);
    assert.match(indexHtml, /id="performanceBastard2DivisionSixteenth" value="1\/16" checked/);
    assert.match(indexHtml, /id="performanceBastard2DivisionThirtySecond" value="1\/32"/);
    assert.match(indexHtml, /id="performanceBastardLoop2Pitch" min="-2" max="2" value="0" step="1"/);
    assert.match(indexHtml, /id="performanceBastardLoop2PitchAffectsDuration"/);
    assert.match(indexHtml, /id="performanceBastardLoop2Level" min="0" max="100" value="55" step="1"/);
    assert.match(indexHtml, /id="performanceBastardLoop2FilterCutoff" min="300" max="18000" value="18000" step="10"/);
    assert.match(indexHtml, /id="performanceBastardLoop2ReverseBtn"/);
    assert.match(indexHtml, /id="performanceBastardLoop2ToggleBtn"/);
    assert.match(indexHtml, /let bastardLoop2Level = 0\.55/);
    assert.match(indexHtml, /let bastardLoop2PitchOctaves = 0/);
    assert.match(indexHtml, /let bastardLoop2Enabled = true/);
    assert.match(indexHtml, /let bastardLoop2Reverse = false/);
    assert.match(indexHtml, /function getSelectedBastardLoop2Divisions\(options = \{\}\)/);
    assert.match(indexHtml, /function applyBastardLoop2DivisionSelection\(divisions, options = \{\}\)/);
    assert.match(indexHtml, /function setBastardLoop2Enabled\(enabled, options = \{\}\)/);
    assert.match(indexHtml, /function setBastardLoop2Reverse\(enabled, options = \{\}\)/);
    assert.match(indexHtml, /function setBastardLoop2PitchOctaves\(value, options = \{\}\)/);
    assert.match(indexHtml, /function getReversedAudioBuffer\(buffer\)/);
    assert.match(indexHtml, /performanceBastardLoop2ReverseBtn\?\.addEventListener\('click', \(\) => \{\s*setBastardLoop2Reverse\(!bastardLoop2Reverse\);/);
    assert.match(indexHtml, /performanceBastardLoop2Pitch\?\.addEventListener\('input', \(event\) => \{\s*setBastardLoop2PitchOctaves\(event\.target\.value\);/);
    assert.match(indexHtml, /performanceBastardLoop2SoloBtn\?\.addEventListener\('click', \(\) => \{\s*setLoopLayerSolo\('bastardb', \{ toggle: true \}\);/);
    assert.match(indexHtml, /performanceBastardLoop2ToggleBtn\?\.addEventListener\('click', \(\) => \{\s*setBastardLoop2Enabled\(!bastardLoop2Enabled\);/);
    assert.match(indexHtml, /source: 'sampledrop2'/);
});

test('third bastardloop layer uses SPLICE_CLAW and has its own pitch, level, resolutions, mute, and reverse controls', () => {
    assert.match(indexHtml, /id="performanceGenerateBastardLoop3Btn">Generate Bastardloop C<\/button>/);
    assert.match(indexHtml, /id="performanceBastardLoop3BrowserBtn">Bastardloop Browser<\/button>/);
    assert.match(indexHtml, /id="performanceBastardLoop3SoloBtn" aria-pressed="false">Solo Off<\/button>/);
    assert.match(indexHtml, /SPLICE_CLAW/);
    assert.match(indexHtml, /id="performanceBastard3DivisionQuarter" value="1\/4"/);
    assert.match(indexHtml, /id="performanceBastard3DivisionEighth" value="1\/8"/);
    assert.match(indexHtml, /id="performanceBastard3DivisionSixteenth" value="1\/16" checked/);
    assert.match(indexHtml, /id="performanceBastard3DivisionThirtySecond" value="1\/32"/);
    assert.match(indexHtml, /id="performanceBastardLoop3Pitch" min="-2" max="2" value="0" step="1"/);
    assert.match(indexHtml, /id="performanceBastardLoop3PitchAffectsDuration"/);
    assert.match(indexHtml, /id="performanceBastardLoop3Level" min="0" max="100" value="50" step="1"/);
    assert.match(indexHtml, /id="performanceBastardLoop3FilterCutoff" min="300" max="18000" value="18000" step="10"/);
    assert.match(indexHtml, /id="performanceBastardLoop3ReverseBtn"/);
    assert.match(indexHtml, /id="performanceBastardLoop3ToggleBtn"/);
    assert.match(indexHtml, /let bastardLoop3Level = 0\.5/);
    assert.match(indexHtml, /let bastardLoop3PitchOctaves = 0/);
    assert.match(indexHtml, /let bastardLoop3Enabled = true/);
    assert.match(indexHtml, /let bastardLoop3Reverse = false/);
    assert.match(indexHtml, /function getSelectedBastardLoop3Divisions\(options = \{\}\)/);
    assert.match(indexHtml, /function applyBastardLoop3DivisionSelection\(divisions, options = \{\}\)/);
    assert.match(indexHtml, /function setBastardLoop3Enabled\(enabled, options = \{\}\)/);
    assert.match(indexHtml, /function setBastardLoop3Reverse\(enabled, options = \{\}\)/);
    assert.match(indexHtml, /function setBastardLoop3PitchOctaves\(value, options = \{\}\)/);
    assert.match(indexHtml, /performanceBastardLoop3ReverseBtn\?\.addEventListener\('click', \(\) => \{\s*setBastardLoop3Reverse\(!bastardLoop3Reverse\);/);
    assert.match(indexHtml, /performanceBastardLoop3Pitch\?\.addEventListener\('input', \(event\) => \{\s*setBastardLoop3PitchOctaves\(event\.target\.value\);/);
    assert.match(indexHtml, /performanceBastardLoop3SoloBtn\?\.addEventListener\('click', \(\) => \{\s*setLoopLayerSolo\('bastardc', \{ toggle: true \}\);/);
    assert.match(indexHtml, /performanceBastardLoop3ToggleBtn\?\.addEventListener\('click', \(\) => \{\s*setBastardLoop3Enabled\(!bastardLoop3Enabled\);/);
    assert.match(indexHtml, /source: 'splice_claw'/);
});

test('dropbox sample layer card has a solo button tied to the shared loop-layer solo state', () => {
    assert.match(indexHtml, /id="performanceDropboxSampleSoloBtn" aria-pressed="false">Solo Off<\/button>/);
    assert.match(indexHtml, /performanceDropboxSampleSoloBtn\?\.addEventListener\('click', \(\) => \{\s*setLoopLayerSolo\('dropbox', \{ toggle: true \}\);/);
    assert.match(indexHtml, /return dropboxSampleLayerEnabled \? dropboxSampleLayerLevel \* getLoopLayerSoloGain\('dropbox'\) : 0;/);
});

test('bastardloop transport can start three loop layers together', () => {
    assert.match(indexHtml, /function stopAllBastardLoopLayers\(options = \{\}\)/);
    assert.match(indexHtml, /function startAllBastardLoopLayers\(startTime = null, options = \{\}\)/);
    assert.match(indexHtml, /const startedA = startBastardLoop\(resolvedStartTime, \{ skipUi: true \}\);/);
    assert.match(indexHtml, /const startedB = startBastardLoop2\(resolvedStartTime, \{ skipUi: true \}\);/);
    assert.match(indexHtml, /const startedC = startBastardLoop3\(resolvedStartTime, \{ skipUi: true \}\);/);
    assert.match(indexHtml, /performanceBastardLoopPlayBtn\?\.addEventListener\('click', \(\) => \{\s*setBastardLoopPlaying\(true\);/);
    assert.match(indexHtml, /performanceBastardLoopStopBtn\?\.addEventListener\('click', \(\) => \{\s*setBastardLoopPlaying\(false\);/);
    assert.match(indexHtml, /if \(!bastardLoopBuffer && !bastardLoop2Buffer && !bastardLoop3Buffer\) \{/);
});

test('tempo-locked keyboard pitch reads source buffers in the non-reversed direction', () => {
    assert.match(indexHtml, /function getTempoLockedSourceReadRatio\(musicalPitchRatio = 1\)/);
    assert.match(indexHtml, /return 1 \/ safePitchRatio;/);
    assert.match(indexHtml, /getTempoLockedPitchBuffer\(\s*sourceInfo\.buffer,\s*getTempoLockedSourceReadRatio\(sourcePitchRate\)\s*\)/);
    assert.match(indexHtml, /pitchShiftBufferByRatioKeepDuration\(\s*sourceInfo\.buffer,\s*getTempoLockedSourceReadRatio\(sourcePlaybackRate\),\s*ctx\s*\)/);
    assert.match(indexHtml, /const sourceAdvanceRate = Math\.max\(\s*0\.05,\s*Math\.min\(12, rawAdvanceRate \* getGrainPlaybackSpeedMultiplier\(\) \* Math\.max\(0\.25, Math\.min\(4, sourcePitchRate\)\)\)\s*\);/);
});

test('oscillators can be disabled for granular-only playback', () => {
    assert.match(indexHtml, /id="performanceOscToggleBtn"/);
    assert.match(indexHtml, /let oscillatorsEnabled = true/);
    assert.match(indexHtml, /function setOscillatorsEnabled\(enabled\)/);
    assert.match(indexHtml, /if \(!oscillatorsEnabled\) return/);
});

test('generated source and sequencer are experimental on a strict sixteenth grid', () => {
    assert.match(indexHtml, /generateDrumLoopBlueprint/);
    assert.match(indexHtml, /const loopSteps = 16/);
    assert.match(indexHtml, /drumBlueprint\.events\.forEach\(\(hit\) => addGridEvent\(hit\)\)/);
    assert.doesNotMatch(indexHtml, /triplet/i);
    assert.doesNotMatch(indexHtml, /ratchet/i);
    assert.doesNotMatch(indexHtml, /subHits/);
    assert.doesNotMatch(indexHtml, /offset: 1 \/ 3/);
    assert.doesNotMatch(indexHtml, /offset: 2 \/ 3/);
    assert.match(indexHtml, /const MUSICAL_RANDOMIZE_ARCHETYPES = \[/);
    assert.match(indexHtml, /function buildLoopBlueprint\(profile = null\)/);
    assert.match(indexHtml, /generateRhythmicStepBlueprint/);
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
    assert.match(indexHtml, /const ratioPool = Array\.isArray\(profile\?\.bpmMultipliers\)/);
    assert.match(indexHtml, /const baseMultiplier = ratioPool\[Math\.floor\(Math\.random\(\) \* ratioPool\.length\)\] \|\| 1/);
    assert.match(indexHtml, /setInternalLfoRateBpm\(id, baseBpm \* multiplier\)/);
    assert.match(indexHtml, /INTERNAL_BPM_CLOCK_RATE_IDS\.forEach\(\(id\) => \{/);
    assert.match(indexHtml, /const bpm = getSharedBpmClockValue\(\);[\s\S]*const division = document\.getElementById\('delayDivision'\)\?\.value \|\| '4'/);
    assert.match(indexHtml, /restoreRandomizeProtectedSliders\(protectedRandomizeSliders\);\s*randomizeInternalLfoTempoRatios\(\{ profile: generationProfile \}\);/);
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
    assert.match(indexHtml, /const DISABLED_LOOP_START_LFO_PARAMS = new Set\(\['sampleStart', 'generatedLoopStart', 'micLoopStart'\]\)/);
    assert.match(indexHtml, /generatedLoopEnd: 0\.12/);
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
    assert.match(indexHtml, /'sampleEnd'/);
    assert.match(indexHtml, /'generatedLoopEnd'/);
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
    assert.match(indexHtml, /'micLoopEnd'/);
    assert.match(indexHtml, /function randomizeLfoDepths\(options = \{\}\)/);
    assert.match(indexHtml, /const INTERNAL_RANDOMIZE_SLIDER_RANGES = \{/);
    assert.match(indexHtml, /performanceGeneratedSwing: \{ min: 0, max: 18 \}/);
    assert.match(indexHtml, /filterEnvAmount: \{ min: 8, max: 64 \}/);
    assert.match(indexHtml, /noiseMix: \{ min: 0, max: 24 \}/);
    assert.match(indexHtml, /function randomizeInternalParameters\(options = \{\}\)/);
    assert.match(indexHtml, /const generationProfile = randomizeInternalParameters\(\{ profile: createMusicalGenerationProfile\(\) \}\);/);
    assert.match(indexHtml, /function randomizeLfoRoutingMatrix\(options = \{\}\)/);
    assert.match(indexHtml, /const targetLimit = Math\.max\(5, Math\.min\(12, profile\?\.lfoRouteLimit \|\| 8\)\)/);
    assert.match(indexHtml, /randomizeLfoRoutingMatrix\(\{ profile: generationProfile \}\);/);
});

test('grain scheduling and generated loops are BPM-grid rhythmic and bright again', () => {
    assert.match(indexHtml, /const BPM_CLOCK_GRAIN_DIVISIONS = \[0\.5, 1, 2, 4, 8, 16\]/);
    assert.match(indexHtml, /function getRhythmicGrainIntervalSeconds\(densityValue = null\)/);
    assert.match(indexHtml, /getRhythmicGrainIntervalSeconds\(density\)/);
    assert.match(indexHtml, /function quantizePitchOffsetToScale\(offset, scaleIntervals\)/);
    assert.match(indexHtml, /const LOOP_SCALE_FAMILIES = \[/);
    assert.match(indexHtml, /const volume = enabled[\s\S]*Math\.max\(32, Math\.min\(98/);
    assert.match(indexHtml, /generateDrumLoopBlueprint/);
    assert.match(indexHtml, /event\.category === 'snare'/);
    assert.match(indexHtml, /event\.category === 'closedHat' \|\| event\.category === 'openHat' \|\| event\.category === 'cymbal'/);
    assert.match(indexHtml, /voice = Math\.tanh\(\(wash \+ \(\(metallicA \* metallicB\) \+ metallicC \* 0\.42\) \* event\.metallic \+ transient \* 0\.6\) \* event\.drive\) \* basicEnv/);
});

test('granular UI presents three direct sample layers instead of the discarded string mode', () => {
    assert.match(indexHtml, /<body class="simplified-ui granular-sampler-mode">/);
    assert.match(indexHtml, /body\.granular-sampler-mode \.source-grain-mode-control,/);
    assert.match(indexHtml, /body\.granular-sampler-mode \.source-waveform-control-grid \{/);
    assert.doesNotMatch(indexHtml, /body\.granular-sampler-mode \.source-loop-controls,/);
    assert.doesNotMatch(indexHtml, /body\.granular-sampler-mode \.trim-source-btn \{/);
    assert.doesNotMatch(indexHtml, /id="auditionBtn"/);
    assert.match(indexHtml, /data-tab="grain">Grain<\/button>/);
    assert.match(indexHtml, />Granular Layer Controls<\/h3>/);
    assert.match(indexHtml, /<span>Main Grain<\/span>/);
    assert.match(indexHtml, /<span>Grain A<\/span>/);
    assert.match(indexHtml, /<span>Grain B<\/span>/);
    assert.match(indexHtml, /id="grainMainSource"/);
    assert.match(indexHtml, /<option value="grainMainSample">Main Grain Sample<\/option>/);
    assert.doesNotMatch(indexHtml, /id="grainMainBrowseBtn"/);
    assert.match(indexHtml, /id="grainMainSampleBrowseBtn"/);
    assert.match(indexHtml, /id="grainMainStart"/);
    assert.match(indexHtml, /id="grainSize"/);
    assert.match(indexHtml, /id="grainMainTune"/);
    assert.match(indexHtml, /id="grainMainFineTune"/);
    assert.match(indexHtml, /id="attack"/);
    assert.match(indexHtml, /id="grainMainDecay"/);
    assert.match(indexHtml, /id="release"/);
    assert.match(indexHtml, /id="grainMainBlend"/);
    assert.match(indexHtml, /id="grainMainSmoothing"/);
    assert.match(indexHtml, /id="grainMainWidth"/);
    assert.match(indexHtml, /id="grainMainVolume"/);
    assert.match(indexHtml, /id="grainSynthASource"/);
    assert.match(indexHtml, /<option value="grainASample">Grain A Sample<\/option>/);
    assert.doesNotMatch(indexHtml, /id="grainSynthABrowseBtn"/);
    assert.match(indexHtml, /id="grainASampleBrowseBtn"/);
    assert.match(indexHtml, /id="grainSynthAStart"/);
    assert.match(indexHtml, /id="grainSynthASize"/);
    assert.match(indexHtml, /id="grainSynthATune"/);
    assert.match(indexHtml, /id="grainSynthAFineTune"/);
    assert.match(indexHtml, /id="grainSynthAAttack"/);
    assert.match(indexHtml, /id="grainSynthADecay"/);
    assert.match(indexHtml, /id="grainSynthARelease"/);
    assert.match(indexHtml, /id="grainSynthAMix"/);
    assert.match(indexHtml, /id="grainSynthASmoothing"/);
    assert.match(indexHtml, /id="grainSynthAWidth"/);
    assert.match(indexHtml, /id="grainSynthAVolume"/);
    assert.match(indexHtml, /id="grainSynthBSource"/);
    assert.match(indexHtml, /<option value="grainBSample">Grain B Sample<\/option>/);
    assert.doesNotMatch(indexHtml, /id="grainSynthBBrowseBtn"/);
    assert.match(indexHtml, /id="grainBSampleBrowseBtn"/);
    assert.match(indexHtml, /id="grainSynthBStart"/);
    assert.match(indexHtml, /id="grainSynthBSize"/);
    assert.match(indexHtml, /id="grainSynthBTune"/);
    assert.match(indexHtml, /id="grainSynthBFineTune"/);
    assert.match(indexHtml, /id="grainSynthBAttack"/);
    assert.match(indexHtml, /id="grainSynthBDecay"/);
    assert.match(indexHtml, /id="grainSynthBRelease"/);
    assert.match(indexHtml, /id="grainSynthBMix"/);
    assert.match(indexHtml, /id="grainSynthBSmoothing"/);
    assert.match(indexHtml, /id="grainSynthBWidth"/);
    assert.match(indexHtml, /id="grainSynthBVolume"/);
    assert.match(indexHtml, /id="grainMainSampleWaveformCanvas"/);
    assert.match(indexHtml, /id="grainMainSampleLoopStart"/);
    assert.match(indexHtml, /id="grainMainSampleLoopEnd"/);
    assert.match(indexHtml, /id="grainMainSampleBrowseBtn"/);
    assert.match(indexHtml, /data-grain-browser-target="grainMain"/);
    assert.match(indexHtml, /data-source-card-audition="grainMainSample"/);
    assert.match(indexHtml, /data-source-kind="grainMainSample">Trim to Selection<\/button>/);
    assert.match(indexHtml, /id="grainASampleWaveformCanvas"/);
    assert.match(indexHtml, /id="grainASampleLoopStart"/);
    assert.match(indexHtml, /id="grainASampleLoopEnd"/);
    assert.match(indexHtml, /id="grainASampleBrowseBtn"/);
    assert.match(indexHtml, /data-grain-browser-target="grainA"/);
    assert.match(indexHtml, /data-source-card-audition="grainASample"/);
    assert.match(indexHtml, /data-source-kind="grainASample">Trim to Selection<\/button>/);
    assert.match(indexHtml, /id="grainBSampleWaveformCanvas"/);
    assert.match(indexHtml, /id="grainBSampleLoopStart"/);
    assert.match(indexHtml, /id="grainBSampleLoopEnd"/);
    assert.match(indexHtml, /id="grainBSampleBrowseBtn"/);
    assert.match(indexHtml, /data-grain-browser-target="grainB"/);
    assert.match(indexHtml, /data-source-card-audition="grainBSample"/);
    assert.match(indexHtml, /data-source-kind="grainBSample">Trim to Selection<\/button>/);
    assert.match(indexHtml, /class="grain-inline-sample-strip" aria-label="Grain A inline sample controls"/);
    assert.match(indexHtml, /class="grain-inline-sample-strip" aria-label="Grain B inline sample controls"/);
    assert.match(indexHtml, /id="grainMixerAmp"/);
    assert.match(indexHtml, /<select id="mainWaveformGrainTimingMode" data-grain-mode-selector>\s*<option value="synth" selected>Playable<\/option>/);
    assert.match(indexHtml, /<select id="grainAWaveformGrainTimingMode" data-grain-mode-selector>\s*<option value="synth" selected>Playable<\/option>/);
    assert.match(indexHtml, /<select id="grainBWaveformGrainTimingMode" data-grain-mode-selector>\s*<option value="synth" selected>Playable<\/option>/);
    assert.doesNotMatch(indexHtml, /granular-oscillator-mode/);
    assert.doesNotMatch(indexHtml, /data-tab="grain">Strings<\/button>/);
    assert.doesNotMatch(indexHtml, />String Grain Controls<\/h3>/);
    assert.doesNotMatch(indexHtml, /id="grainPlaybackSpeed"/);
    assert.doesNotMatch(indexHtml, /id="performanceGrainPlaybackSpeed"/);
});

test('grain sample waveform cards can audition raw previews individually', () => {
    assert.match(indexHtml, /const SOURCE_CARD_AUDITION_KINDS = new Set\(\['grainMainSample', 'grainASample', 'grainBSample'\]\);/);
    assert.match(indexHtml, /function syncSourceCardAuditionButtons\(\)/);
    assert.match(indexHtml, /function stopSourceCardAudition\(options = \{\}\)/);
    assert.match(indexHtml, /async function auditionSourceCard\(kind, options = \{\}\)/);
    assert.match(indexHtml, /document\.querySelectorAll\('\[data-source-card-audition\]'\)\.forEach\(\(button\) => \{/);
    assert.match(indexHtml, /await auditionSourceCard\(button\.dataset\.sourceCardAudition\);/);
    assert.match(indexHtml, /audioReady = await ensureAudioReadyForKeyInteraction\(\);/);
    assert.match(indexHtml, /const boundedLoopEnd = Math\.min\(buffer\.duration, Math\.max\(offset \+ 0\.01, buffer\.duration \* endPct\)\);/);
    assert.match(indexHtml, /source\.start\(now, offset, duration\);/);
    assert.match(indexHtml, /button\.textContent = active \? 'Stop' : 'Audition';/);
});

test('mobile performance surface exposes granular tune width smoothing and lfo depth controls', () => {
    assert.match(indexHtml, />Granular Layer Quick Controls<\/h3>/);
    assert.match(indexHtml, /id="performanceGrainQuickControlsCard"/);
    assert.match(indexHtml, /id="performanceGrainControlsCard"/);
    assert.match(indexHtml, /id="performanceGrainMainTune"/);
    assert.match(indexHtml, /id="performanceGrainMainFineTune"/);
    assert.match(indexHtml, /id="performanceGrainMainWidth"/);
    assert.match(indexHtml, /id="performanceGrainMainSmoothing"/);
    assert.match(indexHtml, /id="performanceGrainATune"/);
    assert.match(indexHtml, /id="performanceGrainAFineTune"/);
    assert.match(indexHtml, /id="performanceGrainAWidth"/);
    assert.match(indexHtml, /id="performanceGrainASmoothing"/);
    assert.match(indexHtml, /id="performanceGrainBTune"/);
    assert.match(indexHtml, /id="performanceGrainBFineTune"/);
    assert.match(indexHtml, /id="performanceGrainBWidth"/);
    assert.match(indexHtml, /id="performanceGrainBSmoothing"/);
    assert.match(indexHtml, /id="performanceLfo1Depth"/);
    assert.match(indexHtml, /id="performanceLfo2Depth"/);
    assert.match(indexHtml, /id="performanceLfo3Depth"/);
    assert.match(indexHtml, /function mountPerformanceGrainControlCards\(\)/);
    assert.match(indexHtml, /const grainControlsCard = document\.getElementById\('performanceGrainControlsCard'\);/);
    assert.match(indexHtml, /const grainWaveformGrid = document\.querySelector\('\.legacy-grain-source-browser'\);/);
    assert.match(indexHtml, /\[grainControlsCard, grainQuickControlsCard\]\.forEach\(\(card\) => \{/);
    assert.match(indexHtml, /insertionPoint\.insertAdjacentElement\('afterend', card\);/);
    assert.doesNotMatch(indexHtml, /id="performanceGrainMainBrowseBtn"/);
    assert.doesNotMatch(indexHtml, /id="performanceGrainABrowseBtn"/);
    assert.doesNotMatch(indexHtml, /id="performanceGrainBBrowseBtn"/);
    assert.match(indexHtml, /function syncPerformanceGrainQuickControls\(\)/);
    assert.match(indexHtml, /'performanceLfo1DepthValue'/);
    assert.match(indexHtml, /'performanceLfo2DepthValue'/);
    assert.match(indexHtml, /'performanceLfo3DepthValue'/);
    assert.match(indexHtml, /bindPerformanceLinkedSlider\(performanceLfo1Depth, 'performanceLfo1DepthValue', 'lfoDepth'\);/);
    assert.match(indexHtml, /bindPerformanceLinkedSlider\(performanceLfo2Depth, 'performanceLfo2DepthValue', 'lfo2Depth'\);/);
    assert.match(indexHtml, /bindPerformanceLinkedSlider\(performanceLfo3Depth, 'performanceLfo3DepthValue', 'lfo3Depth'\);/);
    assert.match(indexHtml, /lfoDepth: 50,/);
    assert.match(indexHtml, /lfo2Depth: 50,/);
    assert.match(indexHtml, /lfo3Depth: 50,/);
});

test('granular engine plays raw sample buffers with per-layer pitch start and envelope scanning', () => {
    assert.match(indexHtml, /const GRANULAR_LAYER_DEFINITIONS = \[/);
    assert.match(indexHtml, /sourceId: 'grainMainSource'/);
    assert.match(indexHtml, /sourceId: 'grainSynthASource'/);
    assert.match(indexHtml, /sourceId: 'grainSynthBSource'/);
    assert.match(indexHtml, /fineTuneId: 'grainMainFineTune'/);
    assert.match(indexHtml, /smoothingId: 'grainMainSmoothing'/);
    assert.match(indexHtml, /fineTuneId: 'grainSynthAFineTune'/);
    assert.match(indexHtml, /smoothingId: 'grainSynthASmoothing'/);
    assert.match(indexHtml, /fineTuneId: 'grainSynthBFineTune'/);
    assert.match(indexHtml, /smoothingId: 'grainSynthBSmoothing'/);
    assert.match(indexHtml, /widthId: 'grainMainWidth'/);
    assert.match(indexHtml, /widthId: 'grainSynthAWidth'/);
    assert.match(indexHtml, /widthId: 'grainSynthBWidth'/);
    assert.match(indexHtml, /function normalizeGranularLayerSourceMode\(value, options = \{\}\)/);
    assert.match(indexHtml, /grainmainsample: 'grainMainSample'/);
    assert.match(indexHtml, /grainasample: 'grainASample'/);
    assert.match(indexHtml, /grainbsample: 'grainBSample'/);
    assert.match(indexHtml, /grainamic: 'grainAMic'/);
    assert.match(indexHtml, /grainbmic: 'grainBMic'/);
    assert.match(indexHtml, /warm: 'generated'/);
    assert.match(indexHtml, /air: layer === 'B' \? 'grainBMic' : 'grainAMic'/);
    assert.match(indexHtml, /function getGranularLayerSettings\(noteFreq, velocity = 1\)/);
    assert.match(indexHtml, /const coarseTuneSemitones = Number\(getModulatedValue\(definition\.pitchId\)\) \|\| 0;/);
    assert.match(indexHtml, /const fineTuneCents = Number\(getModulatedValue\(definition\.fineTuneId\)\) \|\| 0;/);
    assert.match(indexHtml, /const pitchSemitones = coarseTuneSemitones \+ \(fineTuneCents \/ 100\);/);
    assert.match(indexHtml, /const smoothing = Math\.max\(0, Math\.min\(1, \(Number\(getModulatedValue\(definition\.smoothingId\)\) \|\| 0\) \/ 100\)\);/);
    assert.match(indexHtml, /const width = Math\.max\(0, Math\.min\(1, \(Number\(getModulatedValue\(definition\.widthId\)\) \|\| 0\) \/ 100\)\);/);
    assert.match(indexHtml, /pitchRatio = Math\.max\(0\.0625, Math\.min\(16, \(noteFreq \/ baseFrequency\) \* Math\.pow\(2, pitchSemitones \/ 12\)\)\)/);
    assert.match(indexHtml, /intervalSeconds: getGranularLayerIntervalSeconds\(sizeSeconds, blend, smoothing\),/);
    assert.match(indexHtml, /jitterSeconds: getGranularLayerJitterSeconds\(sizeSeconds, blend, smoothing\)/);
    assert.match(indexHtml, /function resolveGranularLayerSampleWindow\(sourceInfo, layer, scheduledTime, streamStartTime, modeProfile = getGrainModeProfile\(\)\)/);
    assert.match(indexHtml, /const sourceDuration = Math\.max\(0\.001, Math\.min\(loopDuration, sourceShape\.sizeSeconds \* playbackRate\)\);/);
    assert.match(indexHtml, /const scanOffset = maxOffsetSpan > 0 && streamStartTime !== undefined && streamStartTime !== null/);
    assert.match(indexHtml, /const jitterOffset = maxOffsetSpan > 0/);
    assert.match(indexHtml, /function findNearestZeroCrossingOffset\(buffer, targetOffsetSeconds, options = \{\}\)/);
    assert.match(indexHtml, /const playOffset = findNearestZeroCrossingOffset\(sourceInfo\.buffer, rawPlayOffset, \{/);
    assert.match(indexHtml, /const adjustedGrainDuration = Math\.max\(minimumFadeSeconds \* 2, adjustedSourceDuration \/ playbackRate\);/);
    assert.match(indexHtml, /function playGrain\(note, scheduledTime = null, velocity = 1, options = \{\}\)/);
    assert.match(indexHtml, /const weightedPanBias = layer\.panBias \* \(0\.2 \+ \(width \* 0\.8\)\);/);
    assert.match(indexHtml, /source\.buffer = sourceInfo\.buffer;/);
    assert.match(indexHtml, /source\.playbackRate\.value = sampleWindow\.playbackRate;/);
    assert.match(indexHtml, /applyEqualPowerGainRamp\(sampleGain\.gain, 0\.0001, sourcePeakGain, now, Math\.max\(0\.001, attackEnd - now\)\);/);
    assert.doesNotMatch(indexHtml, /makeGranularStringSource/);
    assert.doesNotMatch(indexHtml, /getGranularStringMainSources/);
});

test('grain sample browsers reuse the repo sample overlay with dedicated layer targets and folder selection', () => {
    assert.match(indexHtml, /grainMain: 'grainMain'/);
    assert.match(indexHtml, /grainA: 'grainA'/);
    assert.match(indexHtml, /grainB: 'grainB'/);
    assert.match(indexHtml, /const GRAIN_SAMPLE_BROWSER_SOURCE_LABELS = \{/);
    assert.match(indexHtml, /sampledrop: 'SAMPLEDROP'/);
    assert.match(indexHtml, /sampledrop2: 'SAMPLEDROP_2'/);
    assert.match(indexHtml, /splice_claw: 'SAMPLEDROP_CLAW'/);
    assert.match(indexHtml, /const GRAIN_SAMPLE_BROWSER_DEFAULT_SOURCE_KEYS = \{/);
    assert.match(indexHtml, /\[SAMPLE_BROWSER_TARGETS\.grainMain\]: 'sampledrop'/);
    assert.match(indexHtml, /\[SAMPLE_BROWSER_TARGETS\.grainA\]: 'sampledrop2'/);
    assert.match(indexHtml, /\[SAMPLE_BROWSER_TARGETS\.grainB\]: 'splice_claw'/);
    assert.match(indexHtml, /const GRAIN_SAMPLE_BROWSER_TARGET_DETAILS = \{/);
    assert.match(indexHtml, /slotKind: 'grainMainSample'/);
    assert.match(indexHtml, /slotKind: 'grainASample'/);
    assert.match(indexHtml, /slotKind: 'grainBSample'/);
    assert.match(indexHtml, /\{ kind: 'grainMainSample', label: 'Main Grain Sample', startId: 'grainMainSampleLoopStart', endId: 'grainMainSampleLoopEnd' \}/);
    assert.match(indexHtml, /\{ kind: 'grainASample', label: 'Grain A Sample', startId: 'grainASampleLoopStart', endId: 'grainASampleLoopEnd' \}/);
    assert.match(indexHtml, /\{ kind: 'grainBSample', label: 'Grain B Sample', startId: 'grainBSampleLoopStart', endId: 'grainBSampleLoopEnd' \}/);
    assert.match(indexHtml, /id="dropboxSampleBrowserSourceSelect"/);
    assert.match(indexHtml, /function isGrainSampleBrowserTarget\(target\)/);
    assert.match(indexHtml, /function normalizeGrainSampleBrowserSourceKey\(sourceKey, fallback = 'sampledrop'\)/);
    assert.match(indexHtml, /normalized === 'sampledrop_claw' \? 'splice_claw' : normalized/);
    assert.match(indexHtml, /function getGrainSampleBrowserSourceLabel\(sourceKey\)/);
    assert.match(indexHtml, /function getGrainSampleBrowserSourceOptions\(\)/);
    assert.match(indexHtml, /return GRAIN_SAMPLE_BROWSER_SOURCE_OPTIONS\.map\(\(option\) => \(\{ \.\.\.option \}\)\);/);
    assert.match(indexHtml, /title: `\$\{details\.layerLabel\} Sample Browser`/);
    assert.match(indexHtml, /subtitle: `Preview Dropbox samples and load one directly into \$\{details\.layerLabel\}\.`/);
    assert.match(indexHtml, /async function loadGranularBrowserSampleFromSourceRelativePath\(target, sourceKey, relativePath, fileName = ''\)/);
    assert.match(indexHtml, /await applyLoadedAudioBuffer\(decoded, `\$\{config\.layerLabel\} sample · \$\{sourceName\}`, config\.slotKind\);/);
    assert.match(indexHtml, /canvas: grainMainSampleWaveformCanvas,/);
    assert.match(indexHtml, /metaId: 'grainMainSampleWaveformMeta',/);
    assert.match(indexHtml, /canvas: grainASampleWaveformCanvas,/);
    assert.match(indexHtml, /metaId: 'grainASampleWaveformMeta',/);
    assert.match(indexHtml, /canvas: grainBSampleWaveformCanvas,/);
    assert.match(indexHtml, /metaId: 'grainBSampleWaveformMeta',/);
    assert.match(indexHtml, /sourceSelect\.value = config\.sourceMode;/);
    assert.match(indexHtml, /setGrainSampleBrowserSourceKey\(target, responseSourceKey\);/);
    assert.match(indexHtml, /setGrainSampleMetadata\(config\.slotKind, \{/);
    assert.match(indexHtml, /drawSourceWaveform\(config\.slotKind\);/);
    assert.match(indexHtml, /updateSourceAvailability\(\);/);
    assert.match(indexHtml, /syncPerformanceControlState\(\);/);
    assert.match(indexHtml, /requestAnimationFrame\(\(\) => \{\s*drawSourceWaveform\(config\.slotKind\);/);
    assert.match(indexHtml, /restartActiveGrainStreamsFromNow\(\);/);
    assert.match(indexHtml, /const showFeedback = !isGrainSampleBrowserTarget\(config\.target\);/);
    assert.match(indexHtml, /document\.querySelectorAll\('\[data-grain-browser-target\]'\)\.forEach\(\(button\) => \{/);
    assert.match(indexHtml, /const target = button\.dataset\.grainBrowserTarget;/);
    assert.match(indexHtml, /openDropboxSampleBrowser\(target\);/);
    assert.match(indexHtml, /id="grainMainSampleBrowseBtn" data-grain-browser-target="grainMain"/);
    assert.match(indexHtml, /id="grainASampleBrowseBtn" data-grain-browser-target="grainA"/);
    assert.match(indexHtml, /id="grainBSampleBrowseBtn" data-grain-browser-target="grainB"/);
    assert.doesNotMatch(indexHtml, /id="grainMainBrowseBtn"/);
    assert.doesNotMatch(indexHtml, /id="grainSynthABrowseBtn"/);
    assert.doesNotMatch(indexHtml, /id="grainSynthBBrowseBtn"/);
});

test('grain sample browser selections and cached metadata survive refresh state restores', () => {
    assert.match(indexHtml, /let grainMainSampleMetadata = null;/);
    assert.match(indexHtml, /let grainASampleMetadata = null;/);
    assert.match(indexHtml, /let grainBSampleMetadata = null;/);
    assert.match(indexHtml, /const GRAIN_SAMPLE_SLOT_TARGETS = \{/);
    assert.match(indexHtml, /function setGrainSampleMetadata\(kind, metadata = null\)/);
    assert.match(indexHtml, /function getSourceWaveformMetaText\(kind, buffer\)/);
    assert.match(indexHtml, /grainMainSampleBrowserSourceKey: getGrainSampleBrowserSourceKey\(SAMPLE_BROWSER_TARGETS\.grainMain\),/);
    assert.match(indexHtml, /grainASampleBrowserSourceKey: getGrainSampleBrowserSourceKey\(SAMPLE_BROWSER_TARGETS\.grainA\),/);
    assert.match(indexHtml, /grainBSampleBrowserSourceKey: getGrainSampleBrowserSourceKey\(SAMPLE_BROWSER_TARGETS\.grainB\),/);
    assert.match(indexHtml, /grainMainSampleFileName: grainMainSampleMetadata\?\.fileName \|\| '',/);
    assert.match(indexHtml, /grainASampleFileName: grainASampleMetadata\?\.fileName \|\| '',/);
    assert.match(indexHtml, /grainBSampleFileName: grainBSampleMetadata\?\.fileName \|\| '',/);
    assert.match(indexHtml, /setGrainSampleBrowserSourceKey\(SAMPLE_BROWSER_TARGETS\.grainMain, state\.modes\.grainMainSampleBrowserSourceKey\);/);
    assert.match(indexHtml, /setGrainSampleMetadata\('grainMainSample', \{/);
    assert.match(indexHtml, /setGrainSampleMetadata\('grainASample', \{/);
    assert.match(indexHtml, /setGrainSampleMetadata\('grainBSample', \{/);
    assert.match(indexHtml, /if \(!grainMainSampleMetadata\?\.fileName\) \{\s*setGrainSampleMetadata\('grainMainSample', \{/);
    assert.match(indexHtml, /if \(!grainASampleMetadata\?\.fileName\) \{\s*setGrainSampleMetadata\('grainASample', \{/);
    assert.match(indexHtml, /if \(!grainBSampleMetadata\?\.fileName\) \{\s*setGrainSampleMetadata\('grainBSample', \{/);
    assert.match(indexHtml, /setGrainSampleBrowserSourceKey\(dropboxSampleBrowserTarget, dropboxSampleBrowserSourceSelect\.value\);\s*saveState\(\);\s*refreshDropboxSampleBrowser\(\)/);
    assert.doesNotMatch(indexHtml, /dropboxSampleBrowserSourceSelect\?\.addEventListener\('change'[\s\S]*?syncDropboxSampleBrowserTargetUi\(\);[\s\S]*?\}\);/);
});

test('dropbox sample browser shows only the active overlay and uses a robust close handler', () => {
    assert.match(indexHtml, /body\.dropbox-sample-browser-open #dropboxSampleBrowserOverlay,/);
    assert.match(indexHtml, /body\.wav-repository-browser-open #wavRepositoryBrowserOverlay \{/);
    assert.match(indexHtml, /const DROPBOX_SAMPLE_BROWSER_RENDER_LIMIT = 80;/);
    assert.match(indexHtml, /const visibleFiles = matchingFiles\.slice\(0, DROPBOX_SAMPLE_BROWSER_RENDER_LIMIT\);/);
    assert.match(indexHtml, /let dropboxSampleBrowserRefreshAbortController = null;/);
    assert.match(indexHtml, /let dropboxSampleBrowserRefreshToken = 0;/);
    assert.match(indexHtml, /dropboxSampleBrowserRefreshAbortController\.abort\(\);/);
    assert.match(indexHtml, /signal: abortController\.signal/);
    assert.match(indexHtml, /function handleDropboxSampleBrowserClose\(event\)/);
    assert.match(indexHtml, /\['pointerdown', \{ capture: true \}\]/);
    assert.match(indexHtml, /\['touchend', \{ capture: true, passive: false \}\]/);
    assert.match(indexHtml, /dropboxSampleBrowserCloseBtn\?\.addEventListener\(eventName, handleDropboxSampleBrowserClose, options\);/);
});

test('drum machine transport buttons recover audio before starting playback', () => {
    assert.match(indexHtml, /async function toggleDrumMachinePlaybackFromUi\(\)/);
    assert.match(indexHtml, /audioReady = await ensureAudioReadyForKeyInteraction\(\);/);
    assert.match(indexHtml, /await ensureForegroundAudioReady\(\{ silent: true \}\);/);
    assert.match(indexHtml, /await audioContext\.resume\(\);/);
    assert.match(indexHtml, /if \(!drumMachineEnabled\) \{\s*setDrumMachineEnabled\(true, \{ silent: true, skipSave: true \}\);/);
    assert.match(indexHtml, /const drumBus = ensureDrumMachineBus\(\);/);
    assert.match(indexHtml, /performanceDrumMachineStartBtn\?\.addEventListener\('click', async \(\) => \{/);
    assert.match(indexHtml, /performanceDrumMachineMainStartBtn\?\.addEventListener\('click', async \(\) => \{/);
    assert.match(indexHtml, /drumMachinePlayBtn\?\.addEventListener\('click', async \(\) => \{/);
    assert.match(indexHtml, /await toggleDrumMachinePlaybackFromUi\(\);/);
});

test('granular restore and arp stay on the rebuilt synth path', () => {
    assert.match(indexHtml, /if \(id === 'grainMainSource'\) \{\s*select\.value = normalizeGranularLayerSourceMode\(state\.selects\[id\], \{ layer: 'main' \}\);/);
    assert.match(indexHtml, /if \(id === 'grainSynthASource'\) \{\s*select\.value = normalizeGranularLayerSourceMode\(state\.selects\[id\], \{ layer: 'A' \}\);/);
    assert.match(indexHtml, /if \(id === 'grainSynthBSource'\) \{\s*select\.value = normalizeGranularLayerSourceMode\(state\.selects\[id\], \{ layer: 'B' \}\);/);
    assert.match(indexHtml, /if \(select\.hasAttribute\('data-grain-mode-selector'\)\) \{\s*select\.value = 'synth';/);
    assert.match(indexHtml, /normalizeGranularLayerSourceSelects\(\);/);
    assert.match(indexHtml, /setGrainTimingMode\('synth', \{ silent: true, skipSave: true, skipRestart: true \}\);/);
    assert.match(indexHtml, /streamStartTime: playTime,/);
    assert.match(indexHtml, /continuousLoop: false/);
    assert.match(indexHtml, /loopOriginTime: options\.streamStartTime\s*\?\? \(scheduledStartTime !== null \? scheduledStartTime : audioContext\.currentTime\),/);
    assert.doesNotMatch(indexHtml, /arp:cloud/);
});

test('all source grain engines expose dedicated volume controls in the shared source path', () => {
    assert.match(indexHtml, /level: \{ id: 'generatedGrainLevel', label: 'Volume', min: 0, max: 200, value: 100, step: 1 \}/);
    assert.match(indexHtml, /level: \{ id: 'micGrainLevel', label: 'Volume', min: 0, max: 200, value: 100, step: 1 \}/);
    assert.match(indexHtml, /level: \{ id: 'grainAMicGrainLevel', label: 'Volume', min: 0, max: 200, value: 100, step: 1 \}/);
    assert.match(indexHtml, /level: \{ id: 'grainBMicGrainLevel', label: 'Volume', min: 0, max: 200, value: 100, step: 1 \}/);
    assert.match(indexHtml, /level: \{ id: 'outputGrainLevel', label: 'Volume', min: 0, max: 200, value: 100, step: 1 \}/);
    assert.match(indexHtml, /const SOURCE_GRAIN_LEVEL_CONTROL_IDS = new Set\(/);
    assert.match(indexHtml, /function getGranularSourceLevelMultiplier\(sourceInfo\)/);
    assert.match(indexHtml, /const levelPercent = getSourceGrainControlValue\(kind, 'level', 100\);/);
    assert.match(indexHtml, /return Math\.max\(0, Math\.min\(2, levelPercent \/ 100\)\);/);
    assert.match(indexHtml, /role === 'level'\s*\?\s*\{ min: 70, max: 130 \}/);
    assert.match(indexHtml, /const setSourceGain = \(source, gainAmount\) => \{\s*gains\.set\(source, Math\.max\(0, gainAmount \* getGranularSourceLevelMultiplier\(source\)\)\);\s*\};/);
    assert.match(indexHtml, /Math\.min\(1, perSourceGain \* getGranularSourceLevelMultiplier\(sourceInfo\)\)/);
    assert.match(indexHtml, /if \(SOURCE_GRAIN_LEVEL_CONTROL_IDS\.has\(e\.target\.id\)\) \{\s*syncSourceWaveformSoloAudition\(\);/);
});

test('granular layer sliders expose lfo routing for start size pitch envelope blend and level controls', () => {
    assert.match(indexHtml, /const GRANULAR_LAYER_LFO_TARGET_IDS = \[/);
    assert.match(indexHtml, /grainMainStart: 0\.1,/);
    assert.match(indexHtml, /grainMainFineTune: 0\.08,/);
    assert.match(indexHtml, /grainMainBlend: 0\.18,/);
    assert.match(indexHtml, /grainMainSmoothing: 0\.18,/);
    assert.match(indexHtml, /grainMainWidth: 0\.18,/);
    assert.match(indexHtml, /grainSynthAAttack: 0\.05,/);
    assert.match(indexHtml, /grainSynthAFineTune: 0\.08,/);
    assert.match(indexHtml, /grainSynthASmoothing: 0\.16,/);
    assert.match(indexHtml, /grainSynthAWidth: 0\.18,/);
    assert.match(indexHtml, /grainSynthBRelease: 0\.06,/);
    assert.match(indexHtml, /grainSynthBFineTune: 0\.08,/);
    assert.match(indexHtml, /grainSynthBSmoothing: 0\.16,/);
    assert.match(indexHtml, /grainSynthBWidth: 0\.18/);
    assert.match(indexHtml, /'grainMainStart'/);
    assert.match(indexHtml, /'grainSize'/);
    assert.match(indexHtml, /'grainMainTune'/);
    assert.match(indexHtml, /'grainMainFineTune'/);
    assert.match(indexHtml, /'grainMainDecay'/);
    assert.match(indexHtml, /'grainMainBlend'/);
    assert.match(indexHtml, /'grainMainSmoothing'/);
    assert.match(indexHtml, /'grainMainWidth'/);
    assert.match(indexHtml, /'grainSynthAStart'/);
    assert.match(indexHtml, /'grainSynthASize'/);
    assert.match(indexHtml, /'grainSynthATune'/);
    assert.match(indexHtml, /'grainSynthAFineTune'/);
    assert.match(indexHtml, /'grainSynthASmoothing'/);
    assert.match(indexHtml, /'grainSynthAAttack'/);
    assert.match(indexHtml, /'grainSynthADecay'/);
    assert.match(indexHtml, /'grainSynthARelease'/);
    assert.match(indexHtml, /'grainSynthAWidth'/);
    assert.match(indexHtml, /'grainSynthBStart'/);
    assert.match(indexHtml, /'grainSynthBSize'/);
    assert.match(indexHtml, /'grainSynthBTune'/);
    assert.match(indexHtml, /'grainSynthBFineTune'/);
    assert.match(indexHtml, /'grainSynthBSmoothing'/);
    assert.match(indexHtml, /'grainSynthBAttack'/);
    assert.match(indexHtml, /'grainSynthBDecay'/);
    assert.match(indexHtml, /'grainSynthBRelease'/);
    assert.match(indexHtml, /'grainSynthBWidth'/);
    assert.match(indexHtml, /'grainMixerAmp'/);
    assert.match(indexHtml, /function addGranularLayerLfoControls\(\)/);
    assert.match(indexHtml, /sliderLine\.setAttribute\('data-granular-layer-lfo', paramId\);/);
    assert.match(indexHtml, /sliderLine\.append\(slider, createSourceGrainLfoButtons\(paramId\)\);/);
    assert.match(indexHtml, /addGranularLayerLfoControls\(\);/);
});

test('panic reset rebuilds the audio engine and grain note release tails stay musical', () => {
    assert.match(indexHtml, /let audioEngineResetPromise = null;/);
    assert.match(indexHtml, /function setEngineResetButtonState\(isResetting\) \{/);
    assert.match(indexHtml, /async function resetEngineRoutine\(options = \{\}\) \{/);
    assert.match(indexHtml, /await rebuildAudioEngineGraph\(\{ silent: true \}\);/);
    assert.match(indexHtml, /document\.getElementById\('panicBtn'\)\.addEventListener\('click', \(\) => \{\s*resetEngineRoutine\(\{ reason: 'panic' \}\)\.catch\(\(\) => \{\}\);/);
    assert.match(indexHtml, /performancePanicBtn\?\.addEventListener\('click', \(\) => \{\s*resetEngineRoutine\(\{ reason: 'panic' \}\)/);
    assert.match(indexHtml, /document\.getElementById\('panicUtilityBtn'\)\.addEventListener\('click', \(\) => panicAllNotes\(\{ immediate: true \}\)\);/);
    assert.match(indexHtml, /panicAllNotes\(\{ preserveStatus: true, immediate: true \}\);/);
    assert.match(indexHtml, /function getGranularStreamReleaseSeconds\(grainInfo\) \{/);
    assert.match(indexHtml, /releasing: false,/);
    assert.match(indexHtml, /releaseStartTime: null,/);
    assert.match(indexHtml, /releaseEndTime: null,/);
    assert.match(indexHtml, /grainInfo\.releasing = true;/);
    assert.match(indexHtml, /grainInfo\.releaseEndTime = now \+ releaseSeconds;/);
    assert.match(indexHtml, /const remainingRatio = Math\.max\(0, Math\.min\(1, \(releaseEndTime - grainInfo\.nextTime\) \/ releaseDuration\)\);/);
    assert.match(indexHtml, /grainVelocity = Math\.max\(0, \(grainInfo\.releaseVelocity \?\? grainInfo\.velocity\) \* Math\.pow\(remainingRatio, 1\.35\)\);/);
});

test('granular live control refresh and keyboard interaction paths stay resilient', () => {
    assert.match(indexHtml, /let pendingGranularRefreshFrame = null;/);
    assert.match(indexHtml, /async function ensureAudioReadyForKeyInteraction\(\)/);
    assert.match(indexHtml, /const duplicateInputSuppressMs = 180;/);
    assert.match(indexHtml, /if \(isKeyPressed && !holdEnabled && !heldNotes\.has\(note\)\) \{\s*releaseKey\(pointerId\);\s*\}/);
    assert.match(indexHtml, /if \(pendingGranularRefreshFrame !== null\) return;/);
    assert.match(indexHtml, /pendingGranularRefreshFrame = requestAnimationFrame\(\(\) => \{/);
    assert.match(indexHtml, /const refreshFloor = now \+ Math\.max\(0\.01, Math\.min\(0\.05, getClickGuardSeconds\(\) \* 1\.25\)\);/);
    assert.match(indexHtml, /grainInfo\.nextTime = scheduledNextTime < now \? refreshFloor : scheduledNextTime;/);
    assert.match(indexHtml, /console\.warn\('Max grain nodes reached, rebuilding audio engine to recover granular playback'\);/);
    assert.match(indexHtml, /resetEngineRoutine\(\{ reason: 'panic', silent: true \}\)\.catch\(\(\) => \{\}\);/);
});

test('granular loop endpoints keep start manual while end remains lfo-routable for playback', () => {
    assert.doesNotMatch(indexHtml, /data-param="generatedLoopStart" data-lfo="1"/);
    assert.match(indexHtml, /data-param="generatedLoopEnd" data-lfo="2"/);
    assert.doesNotMatch(indexHtml, /data-param="micLoopStart" data-lfo="1"/);
    assert.match(indexHtml, /data-param="micLoopEnd" data-lfo="2"/);
    assert.match(indexHtml, /generatedLoopStart: \{ min: 0, max: 100 \}/);
    assert.match(indexHtml, /micLoopEnd: \{ min: 0, max: 100 \}/);
    assert.match(indexHtml, /function getLoopRange\(startId, endId, options = \{\}\)/);
    assert.match(indexHtml, /if \(DISABLED_LOOP_START_LFO_PARAMS\.has\(paramId\)\) \{\s*return baseValue;\s*\}/);
    assert.match(indexHtml, /const rawStart = options\.modulated \? getModulatedValue\(startId\) : Number\(startSlider\?\.value \?\? 0\)/);
    assert.match(indexHtml, /getLoopRange\(sourceInfo\.startId, sourceInfo\.endId, \{ modulated: true \}\)/);
});

test('arpeggiator exposes up/down/updown/random mode control', () => {
    assert.match(indexHtml, /id="arpModeBtn"/);
    assert.match(indexHtml, /const ARP_MODE_OPTIONS = \[/);
    assert.match(indexHtml, /value: 'up'/);
    assert.match(indexHtml, /value: 'down'/);
    assert.match(indexHtml, /value: 'updown'/);
    assert.match(indexHtml, /value: 'random'/);
    assert.match(indexHtml, /function normalizeArpMode\(value\)/);
    assert.match(indexHtml, /function getNextArpeggiatorNote\(notes\)/);
    assert.match(indexHtml, /document\.getElementById\('arpModeBtn'\)\.addEventListener\('click', \(\) => \{/);
});

test('dropbox sample layer can load a random source sample and join bastardloop transport', () => {
    assert.match(indexHtml, /id="performanceDropboxSampleLoadBtn"/);
    assert.match(indexHtml, /id="performanceDropboxSampleSource"/);
    assert.match(indexHtml, /id="performanceDropboxSampleStretchToLoop"/);
    assert.match(indexHtml, /id="performanceDropboxSampleLevel"/);
    assert.match(indexHtml, /id="performanceDropboxSampleLayerBtn"/);
    assert.match(indexHtml, /const DROPBOX_SAMPLE_SOURCE_API_URL = `\$\{BASTARD_LOOP_REPOSITORY_BASE_URL\}\/api\/source-sample`/);
    assert.match(indexHtml, /async function loadDropboxSampleLayerFromSource\(\)/);
    assert.match(indexHtml, /source: sourceKey/);
    assert.match(indexHtml, /response\.headers\.get\('X-Mygrain-Source-Name'\)/);
    assert.match(indexHtml, /function startDropboxSampleLayer\(startTime = null, options = \{\}\)/);
    assert.match(indexHtml, /const startedSample = startDropboxSampleLayer\(resolvedStartTime, \{ skipUi: true \}\)/);
});

test('sample browser exposes repo-backed comments and like love reactions', () => {
    assert.match(indexHtml, /const DROPBOX_SAMPLE_SOURCE_FEEDBACK_API_URL = `\$\{BASTARD_LOOP_REPOSITORY_BASE_URL\}\/api\/source-file-feedback`/);
    assert.match(indexHtml, /function normalizeDropboxSampleBrowserFeedback\(feedback = \{\}, file = \{\}\)/);
    assert.match(indexHtml, /function ensureDropboxSampleBrowserFeedbackDraft\(file\)/);
    assert.match(indexHtml, /async function saveDropboxSampleBrowserFeedback\(file, controls, options = \{\}\)/);
    assert.match(indexHtml, /feedbackLabel\.textContent = 'Repo Notes';/);
    assert.match(indexHtml, /textarea\.className = 'sample-browser-feedback-textarea';/);
    assert.match(indexHtml, /textarea\.placeholder = 'Add a permanent comment for this sample…';/);
    assert.match(indexHtml, /likeButton\.textContent = 'Like';/);
    assert.match(indexHtml, /loveButton\.textContent = 'Love';/);
    assert.match(indexHtml, /saveButton\.textContent = 'Save Notes';/);
    assert.match(indexHtml, /source: file\.sourceKey,/);
    assert.match(indexHtml, /path: file\.relativePath,/);
    assert.match(indexHtml, /reaction: draft\.reaction/);
    assert.match(indexHtml, /comment: draft\.comment/);
    assert.match(indexHtml, /Saved note for \$\{file\.name\}\./);
});

test('existing wav browser exposes repo-backed comments and like love reactions for saved wavs', () => {
    assert.match(indexHtml, /id="wavRepositoryBrowserOverlay"/);
    assert.match(indexHtml, /id="wavRepositoryBrowserList"/);
    assert.match(indexHtml, /const WAV_REPOSITORY_LIST_API_URL = `\$\{WAV_REPOSITORY_BASE_URL\}\/api\/list`/);
    assert.match(indexHtml, /const WAV_REPOSITORY_FEEDBACK_API_URL = `\$\{WAV_REPOSITORY_BASE_URL\}\/api\/file-feedback`/);
    assert.match(indexHtml, /function normalizeWavRepositoryBrowserFeedback\(feedback = \{\}, file = \{\}\)/);
    assert.match(indexHtml, /async function saveWavRepositoryBrowserFeedback\(file, controls\)/);
    assert.match(indexHtml, /textarea\.placeholder = 'Add a permanent comment for this WAV…';/);
    assert.match(indexHtml, /openButton\.textContent = 'Open WAV';/);
    assert.match(indexHtml, /filename: file\.name,/);
    assert.match(indexHtml, /setWavRepositoryBrowserStatus\(`Saved note for \$\{file\.name\}\.`\);/);
    assert.match(indexHtml, /function openWavRepositoryBrowser\(\)/);
    assert.doesNotMatch(indexHtml, /window\.open\(`\$\{WAV_REPOSITORY_BASE_URL\}\/`, '_blank', 'noopener'\);/);
});

test('mega random button warns and randomizes loops, dropbox sample, and drums together', () => {
    assert.match(indexHtml, /id="performanceMegaRandomBtn">Mega Random<\/button>/);
    assert.match(indexHtml, /let settlePopupPersistent = false;/);
    assert.match(indexHtml, /function hideSettlePopup\(\)/);
    assert.match(indexHtml, /function randomizeMegaBastardLoopSettings\(\)/);
    assert.match(indexHtml, /function randomizeMegaDropboxSampleLayerSettings\(\)/);
    assert.match(indexHtml, /function randomizeMegaDrumMachineSettings\(\)/);
    assert.match(indexHtml, /async function waitForMegaRandomLoadsToSettle\(options = \{\}\)/);
    assert.match(indexHtml, /async function runPatchRandomization\(\)/);
    assert.match(indexHtml, /async function runMegaRandomization\(\)/);
    assert.match(indexHtml, /megaRandomizeInFlight = true;\s*stopAllPerformancePlayback\(\{ silent: true \}\);/);
    assert.match(indexHtml, /setMegaRandomAudioSuppressed\(true\);/);
    assert.match(indexHtml, /showSettlePopup\('Mega Random is loading samples\. This can take a little while\.', \{ persistent: true \}\)/);
    assert.match(indexHtml, /if \(!megaRandomizeInFlight\) \{\s*restartAllTransport\(\{ silent: true \}\);/);
    assert.match(indexHtml, /generateBastardLoopWithPlaybackRestart\(\)/);
    assert.match(indexHtml, /generateBastardLoop2WithPlaybackRestart\(\)/);
    assert.match(indexHtml, /generateBastardLoop3WithPlaybackRestart\(\)/);
    assert.match(indexHtml, /loadDropboxSampleLayerFromSource\(\)/);
    assert.match(indexHtml, /loadRandomDrumMachineSamples\(\)/);
    assert.match(indexHtml, /await waitForMegaRandomLoadsToSettle\(\)/);
    assert.match(indexHtml, /stopAllPerformancePlayback\(\{ silent: true \}\);\s*hideSettlePopup\(\);\s*setMegaRandomAudioSuppressed\(false\);/);
    assert.match(indexHtml, /hideSettlePopup\(\);/);
    assert.match(indexHtml, /performanceMegaRandomBtn\?\.addEventListener\('click', async \(\) => \{/);
});

test('main panel exposes a dedicated red stop-all control beside restart all', () => {
    assert.match(indexHtml, /\.simplified-ui #performanceMainStopAllBtn \{/);
    assert.match(indexHtml, /id="performanceRestartAllBtn">Restart All<\/button>\s*<button class="performance-btn" id="performanceMainStopAllBtn">Stop All<\/button>/);
    assert.match(indexHtml, /const performanceMainStopAllBtn = document.getElementById\('performanceMainStopAllBtn'\);/);
    assert.match(indexHtml, /function stopAllPerformancePlayback\(options = \{\}\)/);
    assert.match(indexHtml, /performanceMainStopAllBtn\?\.addEventListener\('click', \(\) => \{\s*stopAllPerformancePlayback\(\);/);
});

test('randomize controls use the green action styling', () => {
    assert.match(indexHtml, /\.simplified-ui #performanceRandomizeBtn,[\s\S]*#performanceMegaRandomBtn,[\s\S]*#performanceDrumMachineRandomBtn,[\s\S]*#performanceDrumMachineSamplesOnlyBtn,[\s\S]*#drumMachineRandomizeBtn,[\s\S]*#drumMachineSamplesOnlyBtn \{/);
    assert.match(indexHtml, /background: linear-gradient\(135deg, #98ff9f 0%, #38d96b 52%, #0db44a 100%\);/);
});

test('mix and trim card exposes an analyser-driven output vu meter', () => {
    assert.match(indexHtml, /class="performance-sound-card performance-vu-card"/);
    assert.match(indexHtml, /id="performanceOutputVuShell"/);
    assert.match(indexHtml, /id="performanceOutputVuFill"/);
    assert.match(indexHtml, /id="performanceOutputVuPeak"/);
    assert.match(indexHtml, /id="performanceOutputVuValue">-inf dB<\/span>/);
    assert.match(indexHtml, /id="performanceMixerVuShell"/);
    assert.match(indexHtml, /id="performanceMixerVuFill"/);
    assert.match(indexHtml, /id="performanceMixerVuPeak"/);
    assert.match(indexHtml, /id="performanceMixerVuValue">-inf dB<\/span>/);
    assert.match(indexHtml, /\.simplified-ui \.performance-vu-shell \{/);
    assert.match(indexHtml, /\.simplified-ui \.performance-vu-fill \{/);
    assert.match(indexHtml, /\.simplified-ui \.performance-vu-peak \{/);
    assert.match(indexHtml, /function updatePerformanceVuDisplay\(shell, fill, peak, value, levelPercent, peakPercent, db\)/);
    assert.match(indexHtml, /function updatePerformanceVuMeter\(rms = 0\)/);
    assert.match(indexHtml, /const db = safeRms > 0\.00001 \? \(20 \* Math\.log10\(safeRms\)\) : Number\.NEGATIVE_INFINITY;/);
    assert.match(indexHtml, /updatePerformanceVuDisplay\(\s*performanceOutputVuShell,/);
    assert.match(indexHtml, /updatePerformanceVuDisplay\(\s*performanceMixerVuShell,/);
    assert.match(indexHtml, /updatePerformanceVuMeter\(finalPanTrackedRms\);/);
});

test('final effects expose a master compressor with lfo1 or kick sidechain routing', () => {
    assert.match(indexHtml, /id="finalCompressorAmount" min="0" max="100" value="0" step="1"/);
    assert.match(indexHtml, /id="finalCompressorRelease" min="20" max="1000" value="260" step="1"/);
    assert.doesNotMatch(indexHtml, /id="finalCompressorMakeup"/);
    assert.match(indexHtml, /id="performanceFinalSidechainBtn">SC Off<\/button>/);
    assert.match(indexHtml, /id="finalSidechainAmount" min="0" max="100" value="0" step="1"/);
    assert.match(indexHtml, /const FINAL_COMPRESSOR_SIDECHAIN_OPTIONS = \[/);
    assert.match(indexHtml, /value: 'off', label: 'SC Off'/);
    assert.match(indexHtml, /value: 'lfo1', label: 'SC LFO1'/);
    assert.match(indexHtml, /value: 'kick', label: 'SC Kick'/);
    assert.match(indexHtml, /let finalCompressorNode = null;/);
    assert.match(indexHtml, /let finalCompressorDriveGain = null;/);
    assert.doesNotMatch(indexHtml, /let finalCompressorMakeupGain = null;/);
    assert.doesNotMatch(indexHtml, /let finalCompressorReductionGain = null;/);
    assert.match(indexHtml, /let finalKickBypassMasterGain = null;/);
    assert.match(indexHtml, /let finalKickBypassPanner = null;/);
    assert.match(indexHtml, /let finalSidechainGain = null;/);
    assert.match(indexHtml, /let finalCompressorSidechainSource = 'off';/);
    assert.match(indexHtml, /finalCompressorDriveGain = audioContext\.createGain\(\);/);
    assert.match(indexHtml, /finalCompressorNode = audioContext\.createDynamicsCompressor\(\);/);
    assert.doesNotMatch(indexHtml, /finalCompressorMakeupGain = audioContext\.createGain\(\);/);
    assert.doesNotMatch(indexHtml, /finalCompressorReductionGain = audioContext\.createGain\(\);/);
    assert.match(indexHtml, /finalKickBypassMasterGain = audioContext\.createGain\(\);/);
    assert.match(indexHtml, /finalKickBypassPanner = audioContext\.createStereoPanner\(\);/);
    assert.match(indexHtml, /finalOutputPanner\.connect\(finalCompressorDriveGain\);/);
    assert.match(indexHtml, /finalCompressorDriveGain\.connect\(finalCompressorNode\);/);
    assert.match(indexHtml, /finalCompressorNode\.connect\(finalSidechainGain\);/);
    assert.doesNotMatch(indexHtml, /finalCompressorNode\.connect\(finalCompressorMakeupGain\);/);
    assert.doesNotMatch(indexHtml, /finalCompressorMakeupGain\.connect\(finalSidechainGain\);/);
    assert.doesNotMatch(indexHtml, /finalCompressorReductionGain\.connect\(finalSidechainGain\);/);
    assert.match(indexHtml, /finalSidechainGain\.connect\(finalAmplifierNode\);/);
    assert.match(indexHtml, /finalKickBypassMasterGain\.connect\(finalKickBypassPanner\);/);
    assert.match(indexHtml, /finalKickBypassPanner\.connect\(finalAmplifierNode\);/);
    assert.match(indexHtml, /function getFinalCompressorReleaseSeconds\(\)/);
    assert.doesNotMatch(indexHtml, /function getFinalCompressorManualMakeupGain\(\)/);
    assert.match(indexHtml, /function getFinalCompressorSettings\(amount = 0\)/);
    assert.match(indexHtml, /const subtleAmount = Math\.min\(1, safeAmount \/ 0\.4\);/);
    assert.match(indexHtml, /const effectAmount = safeAmount > 0\.4/);
    assert.match(indexHtml, /const effectDrive = 1 \+ \(subtleAmount \* 8\) \+ \(effectAmount \* 72\);/);
    assert.match(indexHtml, /function shouldIdleBypassFinalBusCompressor\(\)/);
    assert.match(indexHtml, /activeGrains\.size > 0/);
    assert.match(indexHtml, /sourceWaveformSoloKinds\.size > 0/);
    assert.match(indexHtml, /\(Array\.isArray\(auditionSources\) && auditionSources\.length > 0\)/);
    assert.match(indexHtml, /threshold: safeAmount > 0\.001 \? -10 - \(subtleAmount \* 20\) - \(effectAmount \* 78\) : 0,/);
    assert.match(indexHtml, /ratio: 1 \+ \(subtleAmount \* 8\) \+ \(effectAmount \* 20\),/);
    assert.match(indexHtml, /release: getFinalCompressorReleaseSeconds\(\)/);
    assert.match(indexHtml, /drive: effectDrive/);
    assert.doesNotMatch(indexHtml, /makeup: 1/);
    assert.doesNotMatch(indexHtml, /function getFinalCompressorReductionFollowGain\(amount = 0\)/);
    assert.doesNotMatch(indexHtml, /const reductionDb = Math\.max\(0, -Number\(finalCompressorNode\.reduction\) \|\| 0\);/);
    assert.doesNotMatch(indexHtml, /const reductionWeight = 0\.18 \+ \(Math\.pow\(safeAmount, 0\.9\) \* 1\.45\);/);
    assert.match(indexHtml, /function getFinalCompressorSidechainDetector\(now = audioContext\?\.currentTime \|\| 0\)/);
    assert.match(indexHtml, /function shouldRouteKickAroundFinalCompressor\(\)/);
    assert.match(indexHtml, /registerFinalSidechainKickTrigger\(scheduledTime, kickLevel\);/);
    assert.match(indexHtml, /bypassFinalCompressor: shouldRouteKickAroundFinalCompressor\(\)/);
    assert.match(indexHtml, /const release = getFinalCompressorReleaseSeconds\(\);/);
    assert.match(indexHtml, /const compressorIdleBypass = shouldIdleBypassFinalBusCompressor\(\);/);
    assert.match(indexHtml, /const compressorAmount = fxMuted \|\| compressorIdleBypass \? 0 : getFinalCompressorAmount\(\);/);
    assert.match(indexHtml, /smoothRamp\(finalCompressorDriveGain\?\.gain, compressorIdleBypass \? 0 : compressorSettings\.drive\);/);
    assert.match(indexHtml, /smoothRamp\(finalCompressorNode\?\.threshold, compressorSettings\.threshold\);/);
    assert.doesNotMatch(indexHtml, /smoothRamp\(finalCompressorMakeupGain\?\.gain/);
    assert.doesNotMatch(indexHtml, /smoothRamp\(finalCompressorReductionGain\?\.gain, getFinalCompressorReductionFollowGain\(compressorAmount\)\);/);
    assert.match(indexHtml, /smoothRamp\(finalKickBypassMasterGain\.gain, postBusGain\);/);
    assert.match(indexHtml, /const sidechainAmount = fxMuted \|\| compressorIdleBypass \? 0 : getFinalCompressorSidechainAmount\(\);/);
    assert.match(indexHtml, /Math\.max\(0, 1 - \(Math\.pow\(detector, 0\.62\) \* sidechainAmount \* 1\.32\)\)/);
    assert.match(indexHtml, /smoothRamp\(finalSidechainGain\?\.gain, duckGain\);/);
    assert.match(indexHtml, /performanceFinalSidechainBtn\?\.addEventListener\('click', \(\) => \{\s*cycleFinalCompressorSidechainSource\(\);/);
    assert.match(indexHtml, /finalCompressorSidechainSource: finalCompressorSidechainSource/);
    assert.doesNotMatch(indexHtml, /'finalCompressorMakeup',/);
    assert.doesNotMatch(indexHtml, /finalCompressorMakeup: 100,/);
});

test('repo export restarts only the live loop layers instead of broad transport restart', () => {
    assert.match(indexHtml, /async function renderDawReadyBarsExport\(\)/);
    assert.match(indexHtml, /const EXPORT_RENDER_LEAD_IN_SECONDS = 0\.18;/);
    assert.match(indexHtml, /const EXPORT_RENDER_TAIL_SECONDS = 0\.06;/);
    assert.match(indexHtml, /const EXPORT_RENDER_SETTLE_MS = 90;/);
    assert.match(indexHtml, /const wasBastardLoopALive = Boolean\(bastardLoopSource\)/);
    assert.match(indexHtml, /const wasBastardLoopBLive = Boolean\(bastardLoop2Source\)/);
    assert.match(indexHtml, /const wasBastardLoopCLive = Boolean\(bastardLoop3Source\)/);
    assert.match(indexHtml, /const wasDropboxSampleLayerLive = Boolean\(dropboxSampleLayerSource\)/);
    assert.match(indexHtml, /const shouldRestartFreshPlayback = wasSequencerPlaying \|\| wasArpPlaying \|\| wasBastardLoopPlaying \|\| wasDrumMachinePlaying/);
    assert.match(indexHtml, /await delayMs\(EXPORT_RENDER_SETTLE_MS\);/);
    assert.match(indexHtml, /const captureStartTime = audioContext\.currentTime;/);
    assert.match(indexHtml, /const restartTime = getBufferedTransportStartTime\(captureStartTime \+ EXPORT_RENDER_LEAD_IN_SECONDS\);/);
    assert.match(indexHtml, /const captureSeconds = \(restartTime - captureStartTime\) \+ durationSeconds \+ EXPORT_RENDER_TAIL_SECONDS \+ 0\.1;/);
    assert.match(indexHtml, /const recordingPromise = recordLiveOutputBuffer\(captureSeconds, \{ captureStartTime \}\);/);
    assert.match(indexHtml, /const \{ audioBuffer: fullMix, captureStartTime: actualCaptureStartTime \} = await recordingPromise;/);
    assert.match(indexHtml, /const exactStart = Math\.max\(0, restartTime - actualCaptureStartTime\);/);
    assert.match(indexHtml, /const exactDuration = Math\.max\(0\.01, durationSeconds\);/);
    assert.match(indexHtml, /const exportMix = sliceAudioBuffer\(fullMix, exactStart, exactDuration\);/);
    assert.doesNotMatch(indexHtml, /const trimmedStart = Math\.max\(0, findAudioBufferStart\(fullMix\) - 0\.01\);/);
    assert.match(indexHtml, /if \(wasBastardLoopALive\) \{\s*startBastardLoop\(restartTime, \{ skipUi: true \}\);/);
    assert.match(indexHtml, /if \(wasBastardLoopBLive\) \{\s*startBastardLoop2\(restartTime, \{ skipUi: true \}\);/);
    assert.match(indexHtml, /if \(wasBastardLoopCLive\) \{\s*startBastardLoop3\(restartTime, \{ skipUi: true \}\);/);
    assert.match(indexHtml, /if \(wasDropboxSampleLayerLive\) \{\s*startDropboxSampleLayer\(restartTime, \{ skipUi: true \}\);/);
    assert.doesNotMatch(indexHtml, /async function renderDawReadyBarsExport\(\)[\s\S]*restartAllTransport\(\{ silent: true \}\)/);
});

test('bastardloops resolve loop length from musical duration instead of raw tail length', () => {
    assert.match(indexHtml, /function getLoopBarDurationSeconds\(sourceBpm = null\)/);
    assert.match(indexHtml, /function resolveLoopDurationSeconds\(bufferDurationSeconds, options = \{\}\)/);
    assert.match(indexHtml, /durationSeconds: Number\(metadata\?\.durationSeconds\) \|\| buffer\.duration/);
    assert.match(indexHtml, /bastardLoopSourceBpm: bastardLoopSourceBpm/);
    assert.match(indexHtml, /bastardLoop2SourceBpm: bastardLoop2SourceBpm/);
    assert.match(indexHtml, /bastardLoop3SourceBpm: bastardLoop3SourceBpm/);
    assert.match(indexHtml, /dropboxSampleLayerSourceBpm: dropboxSampleLayerSourceBpm/);
    assert.match(indexHtml, /const loopDuration = getResolvedBastardLoopDuration\(playbackBuffer\);/);
    assert.match(indexHtml, /const loopDuration = getResolvedBastardLoop2Duration\(playbackBuffer\);/);
    assert.match(indexHtml, /const loopDuration = getResolvedBastardLoop3Duration\(playbackBuffer\);/);
    assert.match(indexHtml, /const loopDuration = getResolvedDropboxSampleLayerDuration\(dropboxSampleLayerBuffer\);/);
});

test('drum machine exposes synced kick, snare, and hi-hat sequencing with popup controls', () => {
    assert.match(indexHtml, /\.sample-browser-overlay\s*\{[\s\S]*z-index:\s*2147483300;/);
    assert.match(indexHtml, /\.drum-machine-overlay\s*\{[\s\S]*z-index:\s*2147483200;/);
    assert.match(indexHtml, /@media \(max-width: 640px\) \{[\s\S]*\.sample-browser-controls\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*align-items:\s*stretch;/);
    assert.match(indexHtml, /id="performanceDrumMachineOpenBtn">Open Drum Machine<\/button>/);
    assert.match(indexHtml, /id="performanceDrumMachineRandomBtn">Random Drums<\/button>/);
    assert.match(indexHtml, /id="performanceDrumMachineSamplesOnlyBtn">Random Samples<\/button>/);
    assert.match(indexHtml, /id="performanceDrumMachineStartBtn">Start Drums<\/button>/);
    assert.match(indexHtml, /id="performanceDrumMachineMainStartBtn">Start Drums<\/button>/);
    assert.match(indexHtml, /id="performanceDrumMachineLayerBtn"/);
    assert.match(indexHtml, /id="performanceDrumMachineLevel"/);
    assert.match(indexHtml, /id="drumMachineOverlay"/);
    assert.match(indexHtml, /id="drumMachineSamplesOnlyBtn" type="button">Random Samples<\/button>/);
    assert.match(indexHtml, /id="drumMachineKickBrowseBtn" type="button">Browse Kicks<\/button>/);
    assert.match(indexHtml, /id="drumMachineSnareBrowseBtn" type="button">Browse Snares<\/button>/);
    assert.match(indexHtml, /id="drumMachineHatBrowseBtn" type="button">Browse Hats<\/button>/);
    assert.match(indexHtml, /id="drumMachineKickGrid"/);
    assert.match(indexHtml, /id="drumMachineSnareGrid"/);
    assert.match(indexHtml, /id="drumMachineHatGrid"/);
    assert.match(indexHtml, /id="drumMachineKickPitch" min="-12" max="12" value="0" step="1"/);
    assert.match(indexHtml, /id="drumMachineSnarePitch" min="-12" max="12" value="0" step="1"/);
    assert.match(indexHtml, /id="drumMachineHatTune" min="-12" max="12" value="0" step="1"/);
    assert.match(indexHtml, /id="drumMachineHatAccentAmount" min="0" max="100" value="35" step="1"/);
    assert.match(indexHtml, /id="drumMachineHatTimingModeBtn" type="button">Straight Hats<\/button>/);
    assert.match(indexHtml, /id="drumMachineKickLevel" min="0" max="100" value="100" step="1"/);
    assert.match(indexHtml, /id="drumMachineSnareLevel" min="0" max="100" value="100" step="1"/);
    assert.match(indexHtml, /id="drumMachineHatLevel" min="0" max="100" value="100" step="1"/);
    assert.match(indexHtml, /id="drumMachineSnareDistortion" min="0" max="100" value="0" step="1"/);
    assert.match(indexHtml, /const DRUM_MACHINE_SOURCE_KEYS = \{/);
    assert.match(indexHtml, /kick: 'samples_kicks'/);
    assert.match(indexHtml, /snare: 'samples_snares'/);
    assert.match(indexHtml, /hat: 'samples_hats'/);
    assert.match(indexHtml, /function loadRandomDrumMachineSamples\(\)/);
    assert.match(indexHtml, /function loadRandomDrumMachineSamplesOnly\(\)/);
    assert.match(indexHtml, /function loadDrumMachineSampleFromSourceRelativePath\(kind, sourceKey, relativePath, fileName = ''\)/);
    assert.match(indexHtml, /function startDrumMachine\(startTime = null, options = \{\}\)/);
    assert.match(indexHtml, /function scheduleDrumMachine\(\)/);
    assert.match(indexHtml, /function getDrumMachineKickLevelValue\(\)/);
    assert.match(indexHtml, /function getDrumMachineSnareLevelValue\(\)/);
    assert.match(indexHtml, /function getDrumMachineHatLevelValue\(\)/);
    assert.match(indexHtml, /function getDrumMachineSnareDistortionAmount\(\)/);
    assert.match(indexHtml, /function getDrumMachineHatAccentAmount\(\)/);
    assert.match(indexHtml, /function cycleDrumMachineHatTimingMode\(options = \{\}\)/);
    assert.match(indexHtml, /function playDrumMachineHit\(buffer, scheduledTime, pitchRatio = 1, options = \{\}\)/);
    assert.match(indexHtml, /function playDrumMachineHatHit\(scheduledTime, options = \{\}\)/);
    assert.match(indexHtml, /if \(drumMachineHatBuffer\) \{/);
    assert.match(indexHtml, /shaper\.curve = makeDistortionCurve\(distortionAmount\)/);
    assert.match(indexHtml, /Double tap = 1\/32 ratchet/);
    assert.match(indexHtml, /stepButton\.classList\.toggle\('ratchet', ratchet\)/);
    assert.match(indexHtml, /function getSharedLoopTransportOriginTime\(\)/);
    assert.match(indexHtml, /performanceDrumMachineOpenBtn\?\.addEventListener\('click', \(\) => \{\s*openDrumMachineOverlay\(\);/);
    assert.match(indexHtml, /drumMachineKickBrowseBtn\?\.addEventListener\('click', \(\) => \{\s*openDropboxSampleBrowser\(SAMPLE_BROWSER_TARGETS\.drumMachineKick\);/);
    assert.match(indexHtml, /drumMachineSnareBrowseBtn\?\.addEventListener\('click', \(\) => \{\s*openDropboxSampleBrowser\(SAMPLE_BROWSER_TARGETS\.drumMachineSnare\);/);
    assert.match(indexHtml, /drumMachineHatBrowseBtn\?\.addEventListener\('click', \(\) => \{\s*openDropboxSampleBrowser\(SAMPLE_BROWSER_TARGETS\.drumMachineHat\);/);
    assert.match(indexHtml, /drumMachineHatTimingModeBtn\?\.addEventListener\('click', \(\) => \{\s*cycleDrumMachineHatTimingMode\(\);/);
});

test('drum transport uses a single toggle button on each surface instead of separate stop controls', () => {
    assert.doesNotMatch(indexHtml, /id="performanceDrumMachineStopBtn"/);
    assert.doesNotMatch(indexHtml, /id="performanceDrumMachineMainStopBtn"/);
    assert.doesNotMatch(indexHtml, /id="drumMachineStopBtn"/);
    assert.match(indexHtml, /\[cardStartBtn, mainStartBtn, popupPlayBtn\]\.forEach\(\(button\) => \{[\s\S]*button\.classList\.toggle\('active', drumMachinePlaying\);[\s\S]*button\.setAttribute\('aria-pressed', String\(drumMachinePlaying\)\);[\s\S]*button\.textContent = drumMachinePlaying \? 'Stop Drums' : 'Start Drums';/);
    assert.match(indexHtml, /performanceDrumMachineStartBtn\?\.addEventListener\('click', \(\) => \{[\s\S]*if \(drumMachinePlaying\) \{[\s\S]*stopDrumMachine\(\);[\s\S]*\} else \{[\s\S]*startDrumMachine\(\);[\s\S]*\}/);
    assert.match(indexHtml, /performanceDrumMachineMainStartBtn\?\.addEventListener\('click', \(\) => \{[\s\S]*if \(drumMachinePlaying\) \{[\s\S]*stopDrumMachine\(\);[\s\S]*\} else \{[\s\S]*startDrumMachine\(\);[\s\S]*\}/);
    assert.match(indexHtml, /drumMachinePlayBtn\?\.addEventListener\('click', \(\) => \{[\s\S]*if \(drumMachinePlaying\) \{[\s\S]*stopDrumMachine\(\);[\s\S]*\} else \{[\s\S]*startDrumMachine\(\);[\s\S]*\}/);
});

test('random drums also generates a playable beat pattern', () => {
    assert.match(indexHtml, /function buildRandomDrumMachinePattern\(track, options = \{\}\)/);
    assert.match(indexHtml, /function randomizeDrumMachinePatterns\(options = \{\}\)/);
    assert.match(indexHtml, /const hatPattern = buildRandomDrumMachinePattern\('hat', \{ force: true \}\);/);
    assert.match(indexHtml, /drumMachineHatAccentPattern = accentPattern;/);
    assert.match(indexHtml, /drumMachineHatRatchetPattern = ratchetPattern;/);
    assert.match(indexHtml, /function loadDrumMachineSampleSet\(options = \{\}\)/);
    assert.match(indexHtml, /pattern\[0\] = true;/);
    assert.match(indexHtml, /pattern\[8\] = true;/);
    assert.match(indexHtml, /pattern\[4\] = true;/);
    assert.match(indexHtml, /pattern\[12\] = true;/);
    assert.match(indexHtml, /randomizeDrumMachinePatterns\(\);/);
    assert.match(indexHtml, /const successMessage = randomizePattern[\s\S]*`Beat ready: \$\{describeDrumMachineSummary\(\)\}\.`[\s\S]*`Drum samples ready: \$\{describeDrumMachineSummary\(\)\}\. Pattern kept\.`/);
});
