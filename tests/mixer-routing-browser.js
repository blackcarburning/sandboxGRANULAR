const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18765/mygrain/';
const output = process.env.MYGRAIN_SCREENSHOT_DIR;
const expectedBuild = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/Build <strong>(v[^<]+)<\/strong>/)[1];

(async () => {
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
    });
    const errors = [];
    const results = [];
    try {
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1365, height: 900 }]) {
            for (const sampleRate of [44100, 48000]) {
                const context = await browser.newContext({ viewport, isMobile: viewport.width < 1000, hasTouch: true, reducedMotion: 'reduce' });
                await context.addInitScript(rate => {
                    const NativeAudioContext = window.AudioContext;
                    window.AudioContext = class extends NativeAudioContext {
                        constructor(options = {}) { super({ ...options, sampleRate: rate }); }
                    };
                }, sampleRate);
                const page = await context.newPage();
                page.setDefaultTimeout(30000);
                page.on('pageerror', error => errors.push(error.stack));
                await page.route('**/*', route => {
                    const request = route.request();
                    if (!['GET', 'HEAD'].includes(request.method()) || new URL(request.url()).origin !== new URL(base).origin) return route.abort();
                    return route.continue();
                });
                await page.goto(base, { waitUntil: 'load' });
                await page.locator('#start-btn').click();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                assert.equal(await page.evaluate(() => audioContext.sampleRate), sampleRate);
                assert.equal(await page.locator('[data-performance-module-jump]').count(), 25);
                assert.equal(await page.locator('#performanceMixerSliderJumps button').count(), 25);
                assert.equal(await page.locator('#performanceMixerCard .performance-mixer-stack > :first-child').getAttribute('id'), 'performanceMixerJumpCard');
                const levelsBefore = await page.evaluate(() => Array.from(document.querySelectorAll('#performanceMixerCard input[type="range"]'), control => [control.id, control.value]));
                const shortcuts = await page.locator('[data-performance-module-jump]').evaluateAll(buttons => buttons.map(button => ({ id: button.id, control: button.dataset.performanceModuleJump })));
                for (const shortcut of shortcuts) {
                    const button = page.locator(`#${shortcut.id}`);
                    assert.equal(await button.evaluate(element => !element.parentElement.querySelector('.performance-mixer-solo-btn') || element.previousElementSibling.matches('.performance-mixer-solo-btn')), true);
                    await button.click();
                    if (shortcut.control === 'performanceOscVolume') {
                        assert.equal(await page.locator('#synthPopupOverlay').isVisible(), true);
                        await page.locator('#oscPopupCloseBtn').click();
                    } else {
                        const bounds = await page.evaluate(control => {
                            const target = document.querySelector(PERFORMANCE_MIXER_MODULE_JUMPS[control]);
                            const rect = target.getBoundingClientRect();
                            return { top: rect.top, bottom: rect.bottom, display: getComputedStyle(target).display };
                        }, shortcut.control);
                        assert.notEqual(bounds.display, 'none');
                        assert.ok(bounds.top >= -1 && bounds.top < viewport.height, `${shortcut.control}: ${JSON.stringify(bounds)}`);
                    }
                }
                assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#performanceMixerCard input[type="range"]'), control => [control.id, control.value])), levelsBefore);
                await page.evaluate(() => { syncPerformanceMixerVuVisibility(); syncPerformanceMixerVuVisibility(); });
                assert.equal(await page.locator('[data-performance-module-jump]').count(), 25);
                assert.equal(await page.evaluate(() => new Set(Array.from(document.querySelectorAll('[id]'), element => element.id)).size === document.querySelectorAll('[id]').length), true);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

                await page.evaluate(() => {
                    panicAllNotes({ preserveStatus: true, immediate: true });
                    clearAllPerformanceSoloStates({ silent: true, skipSave: true });
                    const tone = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                    const samples = tone.getChannelData(0);
                    for (let index = 0; index < samples.length; index += 1) samples[index] = 0.18 * Math.sin(2 * Math.PI * 164.81 * index / audioContext.sampleRate);
                    generatedLoopBuffer = tone;
                    grainASampleBuffer = tone;
                    grainBSampleBuffer = tone;
                    syncLegacyAudioBuffer();
                    bastardLoopBuffer = tone;
                    bastardLoopEnabled = true;
                    bastardLoop2Enabled = false;
                    bastardLoop3Enabled = false;
                    bastardLoopVEnabled = false;
                    bastardLoopPEnabled = false;
                    bastardLoopOEnabled = false;
                    bastardLoopLEnabled = false;
                    bastardLoopXEnabled = false;
                    bastardLoopMEnabled = false;
                    bastardLoopMPlusEnabled = false;
                    dropboxSampleLayerEnabled = false;
                    mygrainQ.state.enabled = false;
                    drumMachineEnabled = true;
                    drumMachineKickBuffer = tone;
                    drumMachineKickPattern = Array.from({ length: 16 }, (_, index) => index % 4 === 0);
                    drumMachineSnarePattern = Array(16).fill(false);
                    drumMachineHatPattern = Array(16).fill(false);
                    drumMachinePercPattern = Array(16).fill(false);
                    Object.values(drumMachineExtraTracks).forEach(track => { track.pattern = Array(16).fill(false); });
                    setOscillatorsEnabled(true, { silent: true, skipSave: true });
                    setGranularLayersEnabled(true, { silent: true, skipSave: true });
                    setGeneratedSampleLayerEnabled(true, { silent: true, skipSave: true });
                    setGeneratedDryLoopEnabled(true, { silent: true, skipSave: true });
                    setGranularLayerMuted('A', false, { silent: true, skipSave: true });
                    setGranularLayerMuted('B', false, { silent: true, skipSave: true });
                    for (const [control, value] of [['performanceBastardLoopLevel', 30], ['performanceDrumMachineLevel', 30], ['performanceGeneratedDryMix', 30], ['performanceSampleVolume', 80], ['grainMixerAmp', 85], ['grainSynthAVolume', 62], ['grainSynthBVolume', 58], ['noiseMix', 0], ['volume', 60], ['lpfCutoff', 12000], ['hpfCutoff', 20]]) {
                        clearModulationForParam(control);
                        setSliderValue(control, value);
                    }
                    updateEffects();
                    startAllBastardLoopLayers(audioContext.currentTime + 0.05, { skipUi: true });
                    startGeneratedDryLoop();
                    window.routingTestAnalyser = audioContext.createAnalyser();
                    routingTestAnalyser.fftSize = 2048;
                    finalAmplifierNode.connect(routingTestAnalyser);
                });
                const solos = [
                    ['performanceLayerOscSoloBtn', 'osc'], ['performanceLayerGranularSoloBtn', 'granular'],
                    ['performanceGeneratedLayerQuickSoloBtn', 'sample'], ['performanceDryLoopLayerQuickSoloBtn', 'loop']
                ];
                const peaks = {};
                for (const [buttonId, source] of solos) {
                    await page.locator(`#${buttonId}`).click();
                    await page.waitForFunction(source => {
                        const granularExpected = ['granular', 'sample'].includes(source);
                        return Math.abs(bastardLoopGainNode?.gain.value ?? 0) < 0.000001
                            && Math.abs(drumMachineBusGainNode?.gain.value ?? 0) < 0.000001
                            && (granularExpected ? granularOutputGain.gain.value > 0.0001 : Math.abs(granularOutputGain.gain.value) < 0.000001)
                            && (source === 'loop' ? generatedDryGainNode?.gain.value > 0.0001 : Math.abs(generatedDryGainNode?.gain.value ?? 0) < 0.000001);
                    }, source);
                    const gates = await page.evaluate(() => ({
                        loops: bastardLoopGainNode?.gain.value ?? 0,
                        drums: drumMachineBusGainNode?.gain.value ?? 0,
                        dry: generatedDryGainNode?.gain.value ?? 0,
                        osc: oscOutputGain.gain.value, granular: granularOutputGain.gain.value, granularLayersEnabled,
                        selections: performanceSourceLayerSolo,
                        oscAllowed: isOscillatorVoiceAudibleUnderSolo('keyboard'),
                        sampleSources: getAvailableGranularSources({ mode: 'grainASample', layer: 'A' }).map(item => item.kind)
                    }));
                    assert.equal(gates.loops, 0, `${source} must mute A`);
                    assert.equal(gates.drums, 0, `${source} must mute direct-output drums`);
                    assert.equal(gates.oscAllowed, source === 'osc');
                    assert.equal(gates.granular > 0.000001, ['granular', 'sample'].includes(source), JSON.stringify({ viewport, sampleRate, source, gates }));
                    assert.equal(gates.dry > 0, source === 'loop');
                    if (source === 'sample') assert.deepEqual(gates.sampleSources, ['generated']);
                    if (source !== 'loop') await page.evaluate(() => { startGrainStream('C3'); playOscillatorNote('C3'); });
                    const peak = await page.evaluate(async () => {
                        const samples = new Float32Array(routingTestAnalyser.fftSize);
                        let peak = 0;
                        for (let index = 0; index < 12; index += 1) {
                            await new Promise(resolve => setTimeout(resolve, 40));
                            routingTestAnalyser.getFloatTimeDomainData(samples);
                            peak = Math.max(peak, ...samples.map(Math.abs));
                        }
                        return peak;
                    });
                    assert.ok(peak > 0.0001, `${source} solo silent at ${sampleRate}: ${peak}`);
                    peaks[source] = peak;
                    await page.evaluate(() => { stopGrainStream('C3', { immediate: true }); stopOscillatorNote('C3', null, { instant: true }); });
                    await page.locator(`#${buttonId}`).click();
                    await page.waitForTimeout(100);
                    assert.equal(await page.evaluate(() => bastardLoopGainNode.gain.value > 0 && drumMachineBusGainNode.gain.value > 0 && oscillatorsEnabled && granularLayersEnabled && generatedSampleLayerEnabled && generatedDryLoopEnabled), true);
                }
                await page.evaluate(() => {
                    setPerformanceSourceLayerSolo('osc', { toggle: true, silent: true });
                    setLoopLayerSolo('drums', { toggle: true, silent: true, skipSave: true });
                    setGrainLayerSolo('A', { toggle: true, silent: true, skipSave: true });
                });
                await page.waitForTimeout(100);
                assert.equal(await page.evaluate(() => drumMachineBusGainNode.gain.value > 0 && (bastardLoopGainNode?.gain.value ?? 0) === 0 && getGrainLayerSoloGain('A') === 1 && getGrainLayerSoloGain('B') === 0 && isOscillatorVoiceAudibleUnderSolo('keyboard')), true);
                await page.evaluate(() => {
                    clearAllPerformanceSoloStates({ silent: true, skipSave: true });
                    startGrainStream('C3');
                    playOscillatorNote('C3');
                    setPerformanceSourceLayerSolo('osc', { toggle: true, silent: true });
                });
                await page.waitForTimeout(180);
                assert.equal(await page.evaluate(() => activeGrains.has(makePerformanceStreamId('keyboard', 'C3'))), true);
                await page.evaluate(() => {
                    setPerformanceSourceLayerSolo('osc', { toggle: true, silent: true });
                    setPerformanceSourceLayerSolo('granular', { toggle: true, silent: true });
                });
                await page.waitForTimeout(100);
                assert.equal(await page.evaluate(() => activeGrains.has(makePerformanceStreamId('keyboard', 'C3')) && !activeOscVoices.has(makePerformanceStreamId('keyboard', 'C3'))), true);
                await page.evaluate(() => setPerformanceSourceLayerSolo('granular', { toggle: true, silent: true }));
                assert.equal(await page.evaluate(() => activeOscVoices.has(makePerformanceStreamId('keyboard', 'C3'))), true);
                await page.evaluate(() => {
                    stopGrainStream('C3', { immediate: true });
                    stopOscillatorNote('C3', null, { instant: true });
                    clearAllPerformanceSoloStates({ silent: true, skipSave: true });
                    stopAllBastardLoopLayers({ skipUi: true, fade: false });
                    stopGeneratedDryLoop();
                    bastardLoopBuffer = null;
                    bastardLoop2Buffer = null;
                    bastardLoop3Buffer = null;
                    bastardLoopVBuffer = null;
                    bastardLoopPBuffer = null;
                    bastardLoopOBuffer = null;
                    bastardLoopXSampleBuffer = null;
                    bastardLoopMBuffer = null;
                    bastardLoopMPlusBuffer = null;
                    dropboxSampleLayerBuffer = null;
                    bastardLoopLSequence = Array.from({ length: getPatternLengthSteps() }, () => createEmptyBastardLoopLStep());
                    mygrainQ.state.pattern = Array.from({ length: getPatternLengthSteps() }, () => null);
                    syncPerformanceControlState();
                });
                assert.equal(await page.locator('#performanceBastardLoopPlayBtn').isEnabled(), true);
                const drumLevelsBefore = await page.evaluate(() => ({ level: drumMachineLevel, kick: drumMachineKickTrackLevel, enabled: drumMachineEnabled }));
                await page.locator('#performanceBastardLoopPlayBtn').click();
                assert.equal(await page.evaluate(() => bastardLoopPlaying && drumMachinePlaying && bastardLoopTransportStartTime === drumMachineTransportStartTime), true);
                const firstOrigin = await page.evaluate(() => drumMachineTransportStartTime);
                await page.evaluate(() => startDrumMachine(drumMachineTransportStartTime, { silent: true, skipSave: true }));
                assert.equal(await page.evaluate(() => drumMachineTransportStartTime), firstOrigin);
                assert.deepEqual(await page.evaluate(() => ({ level: drumMachineLevel, kick: drumMachineKickTrackLevel, enabled: drumMachineEnabled })), drumLevelsBefore);
                await page.locator('#performanceBastardLoopStopBtn').click();
                assert.equal(await page.evaluate(() => !bastardLoopPlaying && !drumMachinePlaying && drumMachineTransportStartTime === null), true);
                await page.evaluate(() => {
                    setDrumMachineEnabled(false, { silent: true, skipSave: true });
                    startAllBastardLoopLayers(audioContext.currentTime + 0.05, { skipUi: true });
                });
                assert.equal(await page.evaluate(() => drumMachinePlaying), false);

                await page.evaluate(() => {
                    panicAllNotes({ preserveStatus: true, immediate: true });
                    generatedLoopBuffer = null;
                    grainMainSampleBuffer = null;
                    grainASampleBuffer = null;
                    grainBSampleBuffer = null;
                    micAudioBuffer = null;
                    grainSynthAMicBuffer = null;
                    grainSynthBMicBuffer = null;
                    audioBuffer = null;
                    setGranularLayersEnabled(false, { silent: true, skipSave: true });
                    setGeneratedSampleLayerEnabled(false, { silent: true, skipSave: true });
                    setGranularLayerMuted('A', true, { silent: true, skipSave: true });
                    setGranularLayerMuted('B', true, { silent: true, skipSave: true });
                    for (const [control, value] of [['grainSynthAVolume', 0], ['grainSynthBVolume', 0], ['grainMixerAmp', 0], ['performanceSampleVolume', 0], ['volume', 0], ['performanceGranularTrim', -24], ['performanceInputTrim', -24], ['performancePostFilterTrim', -24], ['performanceMasterTrim', -24], ['lpfCutoff', 80], ['hpfCutoff', 5000], ['oscMix', 100], ['noiseMix', 100], ['generatedGrainLevel', 0]]) setSliderValue(control, value);
                    setLoopLayerSolo('drums', { toggle: true, silent: true, skipSave: true });
                    lfoEnabled.volume = true;
                    lfoEnabled.grainMixerAmp = true;
                });
                if (viewport.width < 1000) await page.locator('#performanceGranularKeysBtn').tap();
                else await page.locator('#performanceGranularKeysBtn').click();
                await page.waitForFunction(() => !document.getElementById('performanceGranularKeysBtn').disabled);
                assert.equal(await page.evaluate(() => granularLayersEnabled && generatedSampleLayerEnabled && !grainAMuted && !grainBMuted && !oscillatorsEnabled && !hasAnyPerformanceLayerSoloSelection() && getAllGranularSources().length > 0 && !lfoEnabled.volume && !lfoEnabled.grainMixerAmp), true);
                const setup = await page.evaluate(() => ({
                    sample: generatedLoopBuffer.duration, sourceA: document.getElementById('grainSynthASource').value,
                    sourceB: document.getElementById('grainSynthBSource').value, keyboardTop: document.querySelector('.performance-keyboard-card').getBoundingClientRect().top,
                    status: document.getElementById('status').textContent
                }));
                assert.equal(setup.sourceA, 'grainASample');
                assert.equal(setup.sourceB, 'grainBSample');
                assert.ok(setup.keyboardTop >= -1 && setup.keyboardTop < viewport.height, JSON.stringify(setup));
                assert.match(setup.status, /Granular ready/);
                const key = page.locator('.performance-keyboard-card .key[data-note="C3"]');
                await key.scrollIntoViewIfNeeded();
                const keyBounds = await key.boundingBox();
                const touchClient = viewport.width < 1000 ? await context.newCDPSession(page) : null;
                if (touchClient) {
                    await touchClient.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: keyBounds.x + keyBounds.width / 2, y: keyBounds.y + keyBounds.height / 2 }] });
                } else {
                    await page.mouse.move(keyBounds.x + keyBounds.width / 2, keyBounds.y + keyBounds.height / 2);
                    await page.mouse.down();
                }
                const granularPeak = await page.evaluate(async () => {
                    const samples = new Float32Array(routingTestAnalyser.fftSize);
                    let peak = 0;
                    for (let index = 0; index < 16; index += 1) {
                        await new Promise(resolve => setTimeout(resolve, 40));
                        routingTestAnalyser.getFloatTimeDomainData(samples);
                        peak = Math.max(peak, ...samples.map(Math.abs));
                    }
                    return peak;
                });
                if (touchClient) await touchClient.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                else await page.mouse.up();
                assert.ok(granularPeak > 0.0001, `Granular keyboard still silent: ${granularPeak}`);
                await page.evaluate(() => { window.readyTestBuffers = [generatedLoopBuffer, grainASampleBuffer, grainBSampleBuffer]; });
                if (viewport.width < 1000) {
                    await page.locator('#sectionJumpHandle').tap();
                    await page.locator('#sectionJumpGranularKeysBtn').tap();
                    await page.waitForFunction(() => !document.getElementById('sectionJumpGranularKeysBtn').disabled);
                    assert.equal(await page.locator('#sectionJumpHandle').getAttribute('aria-expanded'), 'false');
                } else await page.evaluate(() => prepareGranularKeyboardFromUi());
                const existingBufferPreserved = await page.evaluate(() => generatedLoopBuffer === readyTestBuffers[0] && grainASampleBuffer === readyTestBuffers[1] && grainBSampleBuffer === readyTestBuffers[2]);
                assert.equal(existingBufferPreserved, true);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
                if (output) await page.screenshot({ path: path.join(output, `granular-ready-${viewport.width}-${sampleRate}.png`) });
                assert.equal(await page.locator('.build-badge').evaluateAll((badges, build) => badges.every(badge => badge.textContent.includes(build)), expectedBuild), true);
                assert.equal(await page.evaluate(() => Boolean(window.mygrainSongBeta && window.MygrainSongLocks)), true);
                const savedLevels = await page.evaluate(() => {
                    saveState();
                    return ['grainMixerAmp', 'grainSynthAVolume', 'grainSynthBVolume', 'volume'].map(id => [id, document.getElementById(id).value]);
                });
                await page.reload({ waitUntil: 'load' });
                await page.locator('#start-btn').click();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                assert.deepEqual(await page.evaluate(() => ['grainMixerAmp', 'grainSynthAVolume', 'grainSynthBVolume', 'volume'].map(id => [id, document.getElementById(id).value])), savedLevels);
                assert.equal(await page.evaluate(() => granularLayersEnabled && generatedSampleLayerEnabled && !grainAMuted && !grainBMuted && !oscillatorsEnabled && grainASampleBuffer?.duration === 1.75 && grainBSampleBuffer?.duration === 1.75), true);
                results.push({ viewport, sampleRate, moduleJumps: shortcuts.length, soloPeaks: peaks, drumsOnlySharedTransport: true, granularKeyboardPeak: granularPeak, savedStateRestored: true, nativeKeyboardTouch: Boolean(touchClient) });
                await context.close();
            }
        }
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ base, results, errors }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
