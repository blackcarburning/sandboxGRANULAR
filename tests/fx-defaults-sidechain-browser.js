const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';
const zeroControls = ['finalRingDepth', 'finalDriveSoft', 'finalDriveHard', 'finalDriveFold', 'finalDriveCrush', 'distortion', 'drumMachineSnareDistortion'];

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    const results = [];
    try {
        for (const sampleRate of [44100, 48000]) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            await context.addInitScript(rate => {
                const NativeAudioContext = window.AudioContext;
                window.AudioContext = class extends NativeAudioContext { constructor(options = {}) { super({ ...options, sampleRate: rate }); } };
            }, sampleRate);
            const page = await context.newPage();
            page.setDefaultTimeout(60000);
            page.on('pageerror', error => errors.push(error.stack));
            await page.route('**/*', route => {
                const request = route.request();
                if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
                return new URL(request.url()).origin === new URL(base).origin ? route.continue() : route.abort();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            async function dirtyTrims() {
                await page.evaluate(() => {
                    setGeneratedDryTrimDb(-9);
                    setPreFilterGainDb(-12);
                    setPostFilterGainDb(-10);
                    document.getElementById('autoMakeupGain').checked = true;
                    for (const param of ['preFilterGain', 'postFilterGain']) {
                        for (const lfo of ['1', '2', '3']) setLfoRouteState(param, lfo, true);
                    }
                });
            }
            async function checkDefaults(label) {
                await page.waitForFunction(() => Math.abs(finalRingDepthGain.gain.value) < 1e-6
                    && Math.abs(finalCompressorNode.release.value - .1) < 1e-5
                    && Math.abs(preFilterGainNode.gain.value - 1) < 1e-6 && Math.abs(makeupGain.gain.value - 1) < 1e-6);
                const state = await page.evaluate(ids => ({
                    values: Object.fromEntries([...ids, 'finalCompressorAmount', 'finalCompressorRelease'].map(id => [id, Number(document.getElementById(id).value)])),
                    routes: [lfoEnabled.distortion, lfo2Enabled.distortion, lfo3Enabled.distortion],
                    ring: finalRingDepthGain.gain.value,
                    release: finalCompressorNode.release.value,
                    trims: Object.fromEntries(['performanceGeneratedDryTrim', 'performanceInputTrim', 'performancePostFilterTrim',
                        'preFilterGain', 'postFilterGain'].map(id => [id, Number(document.getElementById(id).value)])),
                    autoMakeup: document.getElementById('autoMakeupGain').checked,
                    filterRoutes: ['preFilterGain', 'postFilterGain'].flatMap(param =>
                        [lfoEnabled[param], lfo2Enabled[param], lfo3Enabled[param], lfoInverted[param], lfo2Inverted[param], lfo3Inverted[param]]),
                    filterGains: [preFilterGainNode.gain.value, makeupGain.gain.value],
                    dryTrimGain: dbToLinear(getGeneratedDryTrimDb())
                }), zeroControls);
                for (const id of zeroControls) assert.equal(state.values[id], 0, `${label}: ${id}`);
                assert.equal(state.values.finalCompressorAmount, 30, label);
                assert.equal(state.values.finalCompressorRelease, 100, label);
                assert.deepEqual(state.routes, [false, false, false], label);
                assert.ok(Math.abs(state.ring) < 1e-6, `${label}: ${JSON.stringify(state)}`);
                assert.ok(Math.abs(state.release - .1) < 1e-5, `${label}: ${JSON.stringify(state)}`);
                for (const [id, value] of Object.entries(state.trims)) assert.equal(value, 0, `${label}: ${id}`);
                assert.equal(state.autoMakeup, false, label);
                assert.ok(state.filterRoutes.every(value => !value), label);
                assert.equal(state.dryTrimGain, 1, label);
                return { label, ...state };
            }
            const defaults = [await checkDefaults('fresh startup')];
            await page.evaluate(() => {
                setGeneratedDryTrimDb(-6);
                setPreFilterGainDb(-12);
                setPostFilterGainDb(-10);
            });
            await page.waitForFunction(() => Math.abs(preFilterGainNode.gain.value - 10 ** (-12 / 20)) < 1e-6
                && Math.abs(makeupGain.gain.value - 10 ** (-10 / 20)) < 1e-6);
            assert.equal(await page.locator('#performanceGeneratedDryTrim').inputValue(), '-6');
            await dirtyTrims();
            await page.evaluate(ids => {
                stopAllPerformancePlayback({ silent: true });
                ids.forEach(id => setSliderValue(id, 70));
                setSliderValue('finalCompressorAmount', 91);
                setSliderValue('finalCompressorRelease', 850);
                ['1', '2', '3'].forEach(lfo => setLfoRouteState('distortion', lfo, true));
                setDrumMachineKickLevelPercent(72);
                setFinalSidechainKickLevelPercent(13);
                saveState({ force: true });
            }, zeroControls);
            await page.reload({ waitUntil: 'load' });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            defaults.push(await checkDefaults('saved-state reload'));
            assert.equal(await page.locator('#drumMachineKickLevel').inputValue(), '72');
            assert.equal(await page.locator('#finalSidechainKickLevel').inputValue(), '13');
            await page.evaluate(() => setFinalCompressorSidechainSource('off', { silent: true, skipSave: true }));
            await page.locator('#finalSidechainKickLevel').evaluate(slider => {
                slider.value = '0';
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await page.waitForFunction(() => document.getElementById('finalSidechainKickLevelValue').textContent === '0%');
            assert.equal(await page.locator('#drumMachineKickLevel').inputValue(), '72');
            assert.equal(await page.evaluate(() => getDrumMachineKickPlaybackLevel()), .72);
            await page.locator('#drumMachineKickLevel').evaluate(slider => {
                slider.value = '41';
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await page.waitForFunction(() => document.getElementById('drumMachineKickLevelValue').textContent === '41%');
            assert.equal(await page.locator('#finalSidechainKickLevel').inputValue(), '0');
            await dirtyTrims();
            await page.evaluate(ids => {
                const preset = gatherPreset();
                ids.forEach(id => { preset.sliders[id] = '85'; });
                preset.sliders.finalCompressorAmount = '95';
                preset.sliders.finalCompressorRelease = '700';
                applyPreset(preset);
            }, zeroControls);
            defaults.push(await checkDefaults('preset load'));

            await dirtyTrims();
            await page.evaluate(ids => {
                ids.forEach(id => setSliderValue(id, 60));
                document.getElementById('resetDefaultBtn').click();
            }, zeroControls);
            defaults.push(await checkDefaults('Reset Patch'));

            await page.evaluate(() => {
                generateSourceWithPlaybackRestart = async () => {};
                buildMegaRandomBastardLoopTaskSpecs = () => [];
                loadBastardLoopLSampleFromSource = async () => {};
                loadBastardLoopXSampleFromSource = async () => {};
                loadDropboxSampleLayerFromSource = async () => {};
                loadRandomDrumMachineSamples = async () => {};
                restartAllTransport = () => {};
                startSequencer = () => {};
            });
            await dirtyTrims();
            await page.evaluate(async () => { await runPatchRandomization(); stopAllPerformancePlayback({ silent: true }); });
            defaults.push(await checkDefaults('ordinary Randomize'));
            for (const sparseMode of [false, true]) {
                await dirtyTrims();
                await page.evaluate(async ({ sparseMode, ids }) => {
                    ids.forEach(id => setSliderValue(id, 65));
                    setSliderValue('finalCompressorAmount', 98);
                    setSliderValue('finalCompressorRelease', 900);
                    await runMegaRandomization({ sparseMode });
                }, { sparseMode, ids: zeroControls });
                defaults.push(await checkDefaults(sparseMode ? 'Sparse' : 'Mega'));
                assert.equal(await page.evaluate(() => /failed|warnings/i.test(statusDiv.textContent)), false);
            }

            await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true });
                setGeneratedDryTrimDb(-6);
                setPreFilterGainDb(-12);
                setPostFilterGainDb(-10);
                const snapshot = saveState({ snapshotOnly: true, force: true });
                applyUnityTrimDefaults();
                if (!restoreState({ state: snapshot })) throw new Error('Exact snapshot restore failed');
            });
            await page.waitForFunction(() => document.getElementById('performanceGeneratedDryTrim').value === '-6'
                && document.getElementById('performanceInputTrim').value === '-12'
                && document.getElementById('performancePostFilterTrim').value === '-10');
            const restoredTrims = await page.evaluate(() => ({
                dry: getGeneratedDryTrimDb(), input: Number(document.getElementById('preFilterGain').value),
                output: Number(document.getElementById('postFilterGain').value)
            }));
            assert.deepEqual(restoredTrims, { dry: -6, input: -12, output: -10 });
            await page.evaluate(() => applyFinalBusDefaults());
            defaults.push(await checkDefaults('after exact Song-style snapshot recall'));

            const audio = await page.evaluate(async rate => {
                stopAllPerformancePlayback({ silent: true });
                stateSaveSuspended = true;
                const originalContext = audioContext;
                const mainBus = ensureDrumMachineBus;
                const bypassBus = ensureDrumMachineKickBypassBus;
                const directOutput = shouldRouteDrumMachineDirectToOutput;
                const output = [];
                let reference = null;
                try {
                    for (const source of ['off', 'lfo1', 'kick']) {
                        for (const percent of [0, 25, 100]) {
                            const offline = new OfflineAudioContext(1, Math.ceil(rate * .4), rate);
                            audioContext = offline;
                            ensureDrumMachineBus = () => offline.destination;
                            ensureDrumMachineKickBypassBus = () => offline.destination;
                            shouldRouteDrumMachineDirectToOutput = () => false;
                            finalCompressorSidechainSource = source;
                            setDrumMachineKickLevelPercent(80, { skipSave: true });
                            setFinalSidechainKickLevelPercent(percent, { skipSave: true });
                            document.getElementById('drumMachineKickPitch').value = '0';
                            document.getElementById('drumMachineKickDecay').value = '100';
                            document.getElementById('drumMachineKickLength').value = '100';
                            drumMachineKickBuffer = offline.createBuffer(1, Math.ceil(rate * .3), rate);
                            const signal = drumMachineKickBuffer.getChannelData(0);
                            for (let frame = 0; frame < signal.length; frame += 1) signal[frame] = .8 * Math.sin(2 * Math.PI * 75 * frame / rate);
                            drumMachineKickPattern[0] = true;
                            drumMachineKickRatchetPattern[0] = 1;
                            finalSidechainKickEvents = [];
                            scheduleDrumMachineRepeats('kick', 0, .01, .125);
                            const playbackLevel = getDrumMachineKickPlaybackLevel();
                            const rendered = await offline.startRendering();
                            const pcm = rendered.getChannelData(0);
                            if (!reference) reference = pcm.slice();
                            let peak = 0;
                            let difference = 0;
                            for (let frame = 0; frame < pcm.length; frame += 1) {
                                if (!Number.isFinite(pcm[frame])) throw new Error('Non-finite kick PCM');
                                peak = Math.max(peak, Math.abs(pcm[frame]));
                                difference = Math.max(difference, Math.abs(pcm[frame] - reference[frame]));
                            }
                            output.push({ source, percent, playbackLevel, peak, difference, kick: document.getElementById('drumMachineKickLevel').value,
                                sc: document.getElementById('finalSidechainKickLevel').value });
                        }
                    }
                } finally {
                    drumMachineActiveVoices.clear();
                    audioContext = originalContext;
                    ensureDrumMachineBus = mainBus;
                    ensureDrumMachineKickBypassBus = bypassBus;
                    shouldRouteDrumMachineDirectToOutput = directOutput;
                }
                return output;
            }, sampleRate);
            const referencePeak = audio[0].peak;
            assert.ok(referencePeak > .2 && referencePeak < 1);
            for (const result of audio) {
                assert.equal(result.kick, '80');
                assert.equal(result.sc, String(result.percent));
                assert.equal(result.playbackLevel, .8 * (result.source === 'kick' ? result.percent / 100 : 1));
                if (result.source !== 'kick') assert.ok(result.difference < 1e-6, JSON.stringify(result));
                else if (result.percent === 0) assert.ok(result.peak < .00011, JSON.stringify(result));
                else if (result.percent === 100) assert.ok(Math.abs(result.peak - referencePeak) < 1e-6, JSON.stringify(result));
                else assert.ok(result.peak > referencePeak * .2 && result.peak < referencePeak * .3, JSON.stringify(result));
            }
            results.push({ sampleRate, defaults, restoredTrims, audio, randomGenerationJobsStubbed: true });
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ base, results, errors, writes }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
