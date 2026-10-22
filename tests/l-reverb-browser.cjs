// Real engine, routing reachability, audio and portable snapshots on disposable stores.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = 'http://127.0.0.1:18891/mygrain/';
const evidence = process.env.L_REVERB_EVIDENCE || '/tmp/mygrain-l-reverb';
fs.mkdirSync(evidence, { recursive: true });
(async () => {
    const results = [];
    for (const engine of (process.env.L_REVERB_ENGINE ? [process.env.L_REVERB_ENGINE] : ['chromium', 'webkit'])) {
        const browser = await ({ chromium, webkit }[engine]).launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try { for (const mobile of (process.env.L_REVERB_DESKTOP_ONLY ? [false] : [false, true])) {
            const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile });
            assert.equal((await context.request.post(base + 'api/auth/register', { data: { username: `lr_${engine[0]}_${+mobile}_${Date.now()}`, password: 'isolated-l-reverb-test' } })).status(), 200);
            await context.addInitScript(() => {
                window.testAudioEdges = new Map();
                window.testCurveWrites = 0;
                const curve = Object.getOwnPropertyDescriptor(WaveShaperNode.prototype, 'curve');
                Object.defineProperty(WaveShaperNode.prototype, 'curve', { ...curve, set(value) { testCurveWrites++; curve.set.call(this, value); } });
                const connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
                AudioNode.prototype.connect = function (...args) {
                    const result = connect.apply(this, args);
                    if (!testAudioEdges.has(this)) testAudioEdges.set(this, new Set());
                    testAudioEdges.get(this).add(args[0]);
                    return result;
                };
                AudioNode.prototype.disconnect = function (...args) {
                    const result = disconnect.apply(this, args);
                    if (!args.length) testAudioEdges.delete(this);
                    else if (typeof args[0] !== 'number') testAudioEdges.get(this)?.delete(args[0]);
                    return result;
                };
                window.testReaches = (from, to, seen = new Set()) => {
                    if (from === to) return true;
                    if (seen.has(from)) return false;
                    seen.add(from);
                    return [...(testAudioEdges.get(from) || [])].some(node => testReaches(node, to, seen));
                };
            });
            const page = await context.newPage(), errors = [];
            page.setDefaultTimeout(35000);
            page.on('pageerror', error => { errors.push(error.message); console.error('PAGE', error.message); });
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
            const load = async () => {
                await page.goto(base);
                await page.waitForFunction(() => window.MygrainLReverbLane && window.mygrainSongBeta && document.documentElement.dataset.mygrainStartup === 'ready');
                await page.locator('#start-btn').click();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
            };
            await load();
            console.log(`READY ${engine}/${mobile}`);
            await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true }); resetStemIsolationState();
                window.setTestSlider = (id, value) => { const el = document.getElementById(id); el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); };
                for (const [id, value] of Object.entries({ performanceBastardLoopLLevel: 70, performanceBastardLoopLDecay: 100, performanceBastardLoopLStartTrim: 0, performanceBastardLoopLAttack: 1, performanceBastardLoopLFilterCutoff: 18000, performanceBastardLoopLFilterEnvelope: 0, performanceBastardLoopLDelayMix: 0, finalDelayDepth: 0, finalReverbMix: 100, finalReverbSize: 0, finalReverbDecay: 0, finalDriveSoft: 0, finalDriveHard: 0, finalDriveFold: 0, finalDriveCrush: 0, distortion: 0, phaserDepth: 0, tremoloDepth: 0, finalCompressorAmount: 0, volume: 80 })) setTestSlider(id, value);
                finalReverbEnabled = true; updateEffects();
                const buffer = audioContext.createBuffer(1, Math.round(.16 * audioContext.sampleRate), audioContext.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < data.length; i++) data[i] = .2 * Math.sin(2 * Math.PI * 440 * i / audioContext.sampleRate) * Math.min(1, i / 100, (data.length - i) / 100);
                bastardLoopLSampleBuffer = buffer; bastardLoopLRootNote = 'A4'; bastardLoopLSourceMode = 'sample'; bastardLoopLEnabled = true;
                window.testLNote = { note: 'A4', rest: false, ratchet: 1, slide: false };
                const lane = ensureBastardLoopLReverbLane();
                const tap = node => { const a = audioContext.createAnalyser(); a.fftSize = 2048; node.connect(a); return a; };
                window.testMeters = { main: tap(finalReverbPreDelay), output: tap(finalAmplifierNode), room: tap(lane.roomWet) };
                window.readTestMeters = () => Object.fromEntries(Object.entries(testMeters).map(([key, meter]) => { const data = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(data); return [key, Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length)]; }));
            });
            const routes = [];
            for (const placement of ['pre', 'post']) {
                routes.push(await page.evaluate(placement => {
                    setFinalFxPlacement(placement, { silent: true }); updateEffects();
                    const lane = mygrainLReverb.lane;
                    return { placement, mainRoom: testReaches(lane.input, finalReverbPreDelay), output: testReaches(lane.input, finalAmplifierNode), otherTracks: testReaches(preFilterGainNode, finalReverbPreDelay) };
                }, placement));
            }
            for (const route of routes) { assert(!route.mainRoom); assert(route.output); assert(route.otherTracks); }
            console.log('ROUTES', JSON.stringify(routes));
            await page.evaluate(() => previewBastardLoopLStep(testLNote));
            await page.waitForTimeout(90);
            const dry = await page.evaluate(() => readTestMeters());
            assert(dry.output > .0001, JSON.stringify(dry)); assert(dry.main < 1e-8, JSON.stringify(dry)); assert(dry.room < 1e-8);
            await page.waitForTimeout(650);
            assert((await page.evaluate(() => readTestMeters())).output < 1e-6);
            // Trusted range keyboard input changes the actual L controls.
            const mix = page.locator('#performanceBastardLoopLReverbMix');
            await mix.focus(); await page.keyboard.press('End');
            await page.evaluate(() => { setTestSlider('performanceBastardLoopLReverbSize', 35); setTestSlider('performanceBastardLoopLReverbDecay', 40); });
            await page.waitForTimeout(180);
            await page.evaluate(() => previewBastardLoopLStep(testLNote));
            await page.waitForTimeout(700);
            const wet = await page.evaluate(() => ({ ...readTestMeters(), idle: shouldIdleBypassFinalBusCompressor(), duration: mygrainLReverb.lane.room.buffer.duration, dryLane: mygrainLReverb.lane.mirrors.size }));
            assert(wet.output > 1e-6 && wet.room > 1e-6 && wet.main < 1e-8 && !wet.idle, JSON.stringify(wet));
            const volume = await page.evaluate(async () => {
                const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
                setTestSlider('volume', 0); await sleep(140);
                const firstMuted = { ...readTestMeters(), master: masterGain.gain.value, mirrored: mygrainLReverb.lane.mirror(masterGain).gain.value };
                for (let i = 0; i < 30 && readTestMeters().output > 1e-8; i++) await sleep(25);
                const muted = readTestMeters(); setTestSlider('volume', 80); await sleep(140);
                setBastardLoopLEnabled(false, { skipSave: true }); syncBastardLoopLReverbLane();
                // Auditions intentionally work with transport disabled; use another layer's solo to mute them.
                setLoopLayerSolo('bastardx', { silent: true, skipSave: true }); syncBastardLoopLReverbLane(); await sleep(100);
                const soloMuted = readTestMeters(); setLoopLayerSolo('none', { silent: true, skipSave: true });
                return { firstMuted, muted, soloMuted };
            });
            assert(volume.muted.output < 1e-7 && volume.soloMuted.output < 1e-7, JSON.stringify(volume));
            // Shared-room positive control: main sources still feed it.
            await page.evaluate(() => { const osc = audioContext.createOscillator(), gain = audioContext.createGain(); gain.gain.value = .1; osc.connect(gain); gain.connect(preFilterGainNode); osc.start(); osc.stop(audioContext.currentTime + .2); osc.onended = () => { osc.disconnect(); gain.disconnect(); }; });
            await page.waitForTimeout(100);
            assert((await page.evaluate(() => readTestMeters())).main > .001);
            await page.waitForTimeout(700);
            const synth = await page.evaluate(() => {
                setBastardLoopLEnabled(true, { skipSave: true }); bastardLoopLSourceMode = 'synth';
                ensureBastardLoopLSynthReady({ forceMinimumMix: true });
                const id = 'l-reverb-synth-proof'; playOscillatorNote('C4', null, .6, { role: 'bastardloopl-preview', voiceId: id });
                const voice = activeOscVoices.get(id); window.testSynthId = id;
                return { mainRoom: testReaches(voice.oscMixer, finalReverbPreDelay), ownRoom: testReaches(voice.oscMixer, mygrainLReverb.lane.room), output: testReaches(voice.oscMixer, finalAmplifierNode) };
            });
            assert(!synth.mainRoom && synth.ownRoom && synth.output, JSON.stringify(synth));
            await page.waitForTimeout(300);
            assert((await page.evaluate(() => readTestMeters())).output > 1e-5);
            await page.evaluate(() => stopOscillatorNote('C4', null, { role: 'bastardloopl-preview', voiceId: testSynthId }));
            const lifecycle = await page.evaluate(() => {
                const lane = mygrainLReverb.lane, count = lane.mirrors.size, modCount = lane.modulationEdges.length, curvesBefore = testCurveWrites;
                const nodes = [...lane.mirrors.values()].map(binding => binding.node).concat(lane.owned);
                for (let i = 0; i < 250; i++) syncBastardLoopLReverbLane();
                const stable = lane.mirrors.size === count && lane.modulationEdges.length === modCount;
                const curveRebuilds = testCurveWrites - curvesBefore;
                panicAllNotes({ immediate: true });
                const disconnected = nodes.every(node => !(testAudioEdges.get(node)?.size));
                return { stable, curveRebuilds, disconnected, cleared: mygrainLReverb.lane === null, tail: mygrainLReverb.tailUntil };
            });
            assert(lifecycle.stable && lifecycle.disconnected && lifecycle.cleared && lifecycle.tail === 0, JSON.stringify(lifecycle));
            assert.equal(lifecycle.curveRebuilds, 0);
            const rendered = !mobile ? await page.evaluate(async () => {
                stopAllPerformancePlayback({ silent: true }); resetStemIsolationState();
                applyGlobalBpm(300); syncPatternLengthControls(16, { skipSave: true }); syncPerformanceExportBars(1, { skipSave: true });
                bastardLoopLSourceMode = 'sample'; bastardLoopLEnabled = true; bastardLoopLTimingIndex = 3;
                bastardLoopLSequence = Array.from({ length: 64 }, (_, index) => index === 0 ? { ...testLNote } : createEmptyBastardLoopLStep());
                for (const [key, value] of Object.entries({ Mix: 0, Size: 35, Decay: 40, Tone: 6400 })) setTestSlider('performanceBastardLoopLReverb' + key, value);
                const measure = buffer => {
                    const data = buffer.getChannelData(0), tail = data.subarray(Math.floor(data.length * .65));
                    return { seconds: buffer.duration, rms: Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length), tail: Math.sqrt(tail.reduce((sum, x) => sum + x * x, 0) / tail.length) };
                };
                const exportSupported = typeof MediaRecorder !== 'undefined';
                panicAllNotes({ immediate: true });
                const dry = exportSupported ? measure((await renderLiveOutputBarsBuffer({ forceBastardLoops: true })).audioBuffer) : null;
                panicAllNotes({ immediate: true }); setTestSlider('performanceBastardLoopLReverbMix', 100);
                const wet = exportSupported ? measure((await renderLiveOutputBarsBuffer({ forceBastardLoops: true })).audioBuffer) : null;
                panicAllNotes({ immediate: true });
                const part = await mygrainSongBetaAdapter.capture({ liveOnly: true });
                const freezeSupported = Boolean(audioContext.audioWorklet && window.AudioWorkletNode);
                const freeze = freezeSupported ? measure(await mygrainSongBetaAdapter.renderPart(part, { bpm: 300, patternSteps: 16, repeats: 1, patternCycleMultiplier: 1 }, new AbortController().signal)) : null;
                setTestSlider('performanceBastardLoopLReverbMix', 0);
                mygrainSongBetaAdapter.recall(part, { start: false });
                const recalled = document.getElementById('performanceBastardLoopLReverbMix').value;
                const contextBefore = audioContext;
                await rebuildAudioEngineGraph({ silent: true });
                const lane = ensureBastardLoopLReverbLane();
                return { exportSupported, dry, wet, freezeSupported, freeze, recalled, reset: contextBefore !== audioContext && lane.context === audioContext && testReaches(lane.input, finalAmplifierNode) && !testReaches(lane.input, finalReverbPreDelay) };
            }) : null;
            if (rendered) {
                if (rendered.exportSupported) {
                    assert(rendered.dry.rms > 1e-5 && rendered.dry.tail < 1e-6, JSON.stringify(rendered));
                    assert(rendered.wet.tail > 1e-6 && rendered.wet.tail > rendered.dry.tail * 10, JSON.stringify(rendered));
                }
                if (rendered.freezeSupported) assert(rendered.freeze.tail > 1e-6, JSON.stringify(rendered));
                assert.equal(rendered.recalled, '100'); assert(rendered.reset);
            }
            const portable = await page.evaluate(async () => {
                for (const [key, value] of Object.entries({ Mix: 63, Size: 72, Decay: 38, Tone: 4200 })) setTestSlider('performanceBastardLoopLReverb' + key, value);
                window.testSavedPart = await mygrainSongBetaAdapter.capture();
                const snapshot = mygrainSongBetaAdapter.inspectPart(await testSavedPart.arrayBuffer()).snapshot;
                window.testSavedSliders = snapshot.state.sliders;
                saveState({ force: true });
                return Object.fromEntries(Object.entries(snapshot.state.sliders).filter(([key]) => key.startsWith('performanceBastardLoopLReverb')));
            });
            assert.deepEqual(portable, { performanceBastardLoopLReverbMix: '63', performanceBastardLoopLReverbSize: '72', performanceBastardLoopLReverbDecay: '38', performanceBastardLoopLReverbTone: '4200' });
            const oldDefaults = await page.evaluate(() => {
                const state = saveState({ force: true, snapshotOnly: true });
                for (const key of Object.keys(state.sliders)) if (key.startsWith('performanceBastardLoopLReverb')) delete state.sliders[key];
                restoreState({ state, strict: true });
                return Object.fromEntries(Object.keys(L_REVERB_DEFAULTS).map(key => [key, document.getElementById('performanceBastardLoopLReverb' + key).value]));
            });
            assert.deepEqual(oldDefaults, { Mix: '0', Size: '45', Decay: '55', Tone: '6400' });
            await page.evaluate(() => { for (const key of Object.keys(L_REVERB_DEFAULTS)) setTestSlider('performanceBastardLoopLReverb' + key, testSavedSliders['performanceBastardLoopLReverb' + key]); saveState({ force: true }); });
            await load();
            assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.keys(L_REVERB_DEFAULTS).map(key => [key, document.getElementById('performanceBastardLoopLReverb' + key).value]))), { Mix: '63', Size: '72', Decay: '38', Tone: '4200' });
            assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.keys(L_REVERB_DEFAULTS).map(key => [key, document.getElementById('performanceBastardLoopLReverb' + key + 'Value').textContent]))), { Mix: '63%', Size: '72%', Decay: '38%', Tone: '4.2 kHz' });
            await page.locator('#performanceBastardLoopLReverbMix').scrollIntoViewIfNeeded();
            await page.screenshot({ path: `${evidence}/${engine}-${mobile ? 'phone' : 'desktop'}.png` });
            assert.deepEqual(errors, []);
            results.push({ engine, mobile, routes, dry, wet, volume, synth, lifecycle, rendered, portable, oldDefaults, reload: true });
            fs.writeFileSync(`${evidence}/results.json`, JSON.stringify(results, null, 2));
            console.log(`PASS ${engine}/${mobile ? 'phone' : 'desktop'}`);
            await context.close();
        } } finally { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
