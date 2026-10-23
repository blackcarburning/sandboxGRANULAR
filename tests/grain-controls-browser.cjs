// Actual app controls + native PCM: no mocked source-window or envelope function.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18930/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/, 'Disposable accounts only');
const evidence = process.env.MYGRAIN_GRAIN_EVIDENCE || '/tmp/mygrain-grain-controls';
fs.mkdirSync(evidence, { recursive: true });
(async () => {
    const results = [];
    for (const [engine, kind] of Object.entries({ chromium, webkit })) {
        const browser = await kind.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            const registration = await context.request.post(base + 'api/auth/register', { data: { username: `gc_${engine[0]}_${Date.now()}`, password: 'disposable-grain-controls' } });
            assert.equal(registration.status(), 200);
            const page = await context.newPage(), errors = [];
            page.setDefaultTimeout(45000); page.on('pageerror', e => errors.push(e.message));
            if (process.env.MYGRAIN_CONTROL_BASELINE) await page.route(base, route => route.fulfill({ contentType: 'text/html', body: fs.readFileSync(process.env.MYGRAIN_CONTROL_BASELINE, 'utf8') }));
            await page.goto(base);
            await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
            await page.evaluate(() => mygrainCardHistory.ready);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(async () => {
                stopAllPerformancePlayback({ silent: true });
                const source = audioContext.createBuffer(1, audioContext.sampleRate * 4, audioContext.sampleRate);
                for (let i = 0, data = source.getChannelData(0); i < data.length; i++) {
                    const t = i / source.sampleRate;
                    data[i] = t < .75 ? 0 : .15 * Math.sin(2 * Math.PI * (t < 2 ? 130.81 : 261.62) * t);
                }
                grainASampleBuffer = source; grainBSampleBuffer = source;
                grainSynthAMicBuffer = source; grainSynthBMicBuffer = source;
                await prepareGranularKeyboardFromUi(); setKeyboardDecay(0, { skipSave: true }); setHoldEnabled(true);
                window.controlInput = (id, value) => {
                    const slider = document.getElementById(id); clearModulationForParam(id);
                    slider.value = String(value); slider.dispatchEvent(new Event('input', { bubbles: true }));
                };
                window.controlDefaults = () => {
                    setGranularLayerMuted('A', false, { silent: true, skipSave: true });
                    setGranularLayerMuted('B', true, { silent: true, skipSave: true });
                    document.getElementById('grainSynthASource').value = 'grainASample';
                    document.getElementById('grainSynthBSource').value = 'grainBSample';
                    for (const [id, value] of Object.entries({ grainSynthATune: 0, grainSynthBTune: 0, grainSynthAStart: 0,
                        grainSynthASize: 150, grainSynthBSize: 150, grainSynthBStart: 0, grainBSampleLoopStart: 0, grainBSampleLoopEnd: 100, grainBMicLoopStart: 0, grainBMicLoopEnd: 100, grainASampleLoopStart: 0, grainASampleLoopEnd: 100, grainAMicLoopStart: 0, grainAMicLoopEnd: 100,
                        grainAMicGrainPosition: 0, grainAMicGrainScale: 100, grainAMicGrainAttackScale: 100, grainAMicGrainReleaseScale: 100,
                        grainBMicGrainPosition: 0, grainBMicGrainScale: 100, grainBMicGrainAttackScale: 100, grainBMicGrainReleaseScale: 100,
                        grainSynthAMix: 36, grainSynthASmoothing: 48, grainSynthAWidth: 0, noiseMix: 0, panSpread: 0 })) controlInput(id, value);
                };
                controlDefaults();
                // Render ONE real production grain. Preserve the live graph around offline checks.
                window.renderControlGrain = async (kind, overrides) => {
                    stopAllPerformancePlayback({ silent: true }); controlDefaults();
                    const key = kind.startsWith('grainB') ? 'B' : 'A';
                    setGranularLayerMuted(key, false, { silent: true, skipSave: true });
                    setGranularLayerMuted(key === 'A' ? 'B' : 'A', true, { silent: true, skipSave: true });
                    document.getElementById(`grainSynth${key}Source`).value = kind;
                    for (const [id, value] of Object.entries(overrides)) controlInput(id, value);
                    const online = audioContext, output = granularOutputGain;
                    const offline = new OfflineAudioContext(2, 24000, 48000);
                    audioContext = offline; granularOutputGain = offline.createGain(); granularOutputGain.connect(offline.destination);
                    const random = Math.random; Math.random = () => .5;
                    try {
                        const layer = getGranularLayerSettings(65.41).find(layer => layer.key === key);
                        const source = getAvailableGranularSources({ mode: layer.sourceMode, layer: key })[0];
                        const window = resolveGranularLayerSampleWindow(source, layer, .04, .04);
                        playGrain('C2', .04, 1, { role: 'control-test', streamStartTime: .04, layerSettings: [layer] });
                        const audio = await offline.startRendering(), pcm = Array.from(audio.getChannelData(0));
                        return { window, interval: layer.intervalSeconds, pcm };
                    } finally { Math.random = random; audioContext = online; granularOutputGain = output; }
                };
                window.captureControlTransport = async (mode, changes = false) => {
                    stopAllPerformancePlayback({ silent: true }); heldNotes.clear(); controlDefaults();
                    arpEnabled = mode === 'arp'; keyboardArpTransportPlaying = mode === 'arp';
                    const starts = [], original = startTransportSource;
                    startTransportSource = function (node, time, offset, duration) {
                        if (node.buffer === grainASampleBuffer) starts.push({ time, offset, duration });
                        return original(node, time, offset, duration);
                    };
                    await MygrainSongClock.prepareCapture(audioContext);
                    const at = audioContext.currentTime + .35; setTransportEpoch(at);
                    const frames = Math.round(audioContext.sampleRate * 2.8);
                    const capture = new AudioWorkletNode(audioContext, 'mygrain-song-capture-v1', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { startFrame: Math.round(at * audioContext.sampleRate), frames } });
                    const recorded = new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => reject(Error('PCM capture timed out')), 10000);
                        capture.port.onmessage = event => { clearTimeout(timeout); resolve(event.data.channels); };
                    });
                    granularOutputGain.connect(capture); capture.connect(audioContext.destination);
                    let changeTimer = null, changedAt = null;
                    try {
                        heldNotes.add('C2');
                        if (mode === 'sequencer') {
                            sequencerSteps.forEach(step => { step.enabled = true; step.pitch = 'C2'; step.volume = 80; });
                            startSequencer(at, { force: true });
                        } else if (mode === 'arp') startArpeggiatorPlayback(at);
                        else startHeldKeyboardPlayback(at);
                        if (changes) changeTimer = setTimeout(() => {
                            changedAt = audioContext.currentTime;
                            controlInput('grainAMicGrainScale', 25); controlInput('grainAMicGrainPosition', 25);
                            controlInput('grainAMicGrainAttackScale', 25); controlInput('grainAMicGrainReleaseScale', 25);
                        }, 1450);
                        const channels = await recorded, pcm = new Float32Array(channels[0]);
                        const rms = (start, end) => {
                            let sum = 0; for (let i = Math.round(start * audioContext.sampleRate); i < Math.round(end * audioContext.sampleRate); i++) sum += pcm[i] ** 2;
                            return Math.sqrt(sum / ((end - start) * audioContext.sampleRate));
                        };
                        return { mode, starts, changedAt, earlyRms: rms(.1, .4), lateRms: rms(1.5, 2.6), pool: getConcurrentGrainSourceCount() };
                    } finally {
                        if (changeTimer) clearTimeout(changeTimer);
                        startTransportSource = original; stopAllPerformancePlayback({ silent: true }); heldNotes.clear(); arpEnabled = false;
                        granularOutputGain.disconnect(capture); capture.disconnect(); capture.port.close();
                    }
                };
            });
            await page.evaluate(value => { window.grainBaselineMode = value; }, Boolean(process.env.MYGRAIN_CONTROL_BASELINE));
            const boundsAndRecall = await page.evaluate(() => {
                controlDefaults();
                const saved = {};
                for (const layer of ['A', 'B']) {
                    for (const [role, suffix, value] of [['position', 'Position', 23], ['scale', 'Scale', 73], ['attack', 'AttackScale', 41], ['release', 'ReleaseScale', 187]]) {
                        const id = `grain${layer}MicGrain${suffix}`; controlInput(id, value); saved[id] = String(value);
                        for (const kind of [`grain${layer}Sample`, `grain${layer}Mic`]) {
                            if (getSourceGrainControlValue(kind, role, -999) !== value && !window.grainBaselineMode) throw Error(`${kind} ${role} bypassed its visible control`);
                        }
                    }
                }
                saveState(); const snapshot = readStoredStateSnapshot();
                for (const id of Object.keys(saved)) controlInput(id, 100);
                if (!restoreState({ state: snapshot, songSnapshot: true, throwOnError: true })) throw Error('Saved grain controls did not restore');
                for (const [id, value] of Object.entries(saved)) if (document.getElementById(id).value !== value) throw Error(`${id} failed saved recall`);
                let checked = 0;
                for (const kind of ['grainASample', 'grainAMic', 'grainBSample', 'grainBMic']) {
                    const config = getSourceSlotConfig(kind);
                    controlInput(config.startId, 10); controlInput(config.endId, 30);
                    const source = makeGranularSource(kind);
                    for (const rate of [.0625, .5, 1, 4, 16]) for (const preserveDuration of [false, true]) for (const elapsed of [0, .2, 3, 30]) {
                        const layer = { startPct: .8, sizeSeconds: .2, pitchRatio: rate, preserveDuration, smoothing: .5, jitterSeconds: .01, attackSeconds: .04, releaseSeconds: 1.25 };
                        const win = resolveGranularLayerSampleWindow(source, layer, elapsed, 0);
                        if (win.playOffset < .4 - 1e-6 || win.playOffset >= 1.2 + 1e-6 || win.loopStart < .4 - 1e-6 || win.loopEnd > 1.2 + 1e-6) throw Error('Grain escaped source Start/End selection');
                        if (!(win.sourceDuration > 0 && win.grainDuration > 0)) throw Error('Invalid grain duration');
                        checked++;
                    }
                }
                controlDefaults(); return { checked, saved };
            });
            const offline = [];
            for (const kind of ['grainASample', 'grainAMic', 'grainBSample', 'grainBMic']) {
                for (const [role, id, low, high] of [
                    ['position', 'grainAMicGrainPosition', 0, 50],
                    ['size', 'grainAMicGrainScale', 25, 250],
                    ['attack', 'grainAMicGrainAttackScale', 25, 250],
                    ['release', 'grainAMicGrainReleaseScale', 25, 250]
                ]) {
                    const captures = [];
                    for (const value of [low, role === 'position' ? 25 : 100, high]) captures.push(await page.evaluate(({ kind, role, id, value }) => {
                        const key = kind.startsWith('grainB') ? 'B' : 'A';
                        return renderControlGrain(kind, { [`grainSynth${key}Start`]: role === 'position' ? 0 : 50, [id.replace('grainA', `grain${key}`)]: value });
                    }, { kind, role, id, value }));
                    const [a, m, b] = captures;
                    const diff = (x, y) => Math.sqrt(x.pcm.reduce((sum, v, i) => sum + (v - y.pcm[i]) ** 2, 0) / x.pcm.length);
                    const result = { kind, role, lowHighPcmDifference: diff(a, b), lowMidPcmDifference: diff(a, m), midHighPcmDifference: diff(m, b), lowWindow: a.window, highWindow: b.window, lowInterval: a.interval, highInterval: b.interval };
                    if (!process.env.MYGRAIN_CONTROL_BASELINE) {
                        assert.ok(result.lowHighPcmDifference > .002, JSON.stringify(result));
                        assert.ok(result.lowMidPcmDifference > .0001 && result.midHighPcmDifference > .0001, JSON.stringify(result));
                        if (role === 'size') assert.ok(a.interval < a.window.grainDuration && b.interval < b.window.grainDuration);
                    }
                    offline.push(result);
                }
            }
            const transports = [];
            for (const mode of (process.env.MYGRAIN_CONTROLS_ONLY ? [] : ['held', 'sequencer', 'arp'])) {
                const result = await page.evaluate(mode => captureControlTransport(mode), mode);
                if (!process.env.MYGRAIN_CONTROL_BASELINE) {
                    assert.ok(result.starts.length > 10, JSON.stringify(result));
                    assert.ok(Math.max(...result.starts.map(s => s.offset)) > 1.8, 'Sample scan must progress beyond the lead-in, not repeat an opening fragment');
                    assert.ok(result.earlyRms < .00001 && result.lateRms > .005, JSON.stringify({ mode, earlyRms: result.earlyRms, lateRms: result.lateRms, sources: result.starts.length }));
                }
                transports.push(result);
            }
            const live = process.env.MYGRAIN_CONTROLS_ONLY ? null : await page.evaluate(() => captureControlTransport('held', true));
            if (!process.env.MYGRAIN_CONTROL_BASELINE && live) {
                const fresh = live.starts.find(s => s.time > live.changedAt && s.duration < .04);
                assert.ok(fresh && fresh.time - live.changedAt < .4, 'Held controls must change the real scheduled source within 400 ms');
                assert.equal(await page.evaluate(() => getConcurrentGrainSourceCount()), 0);
                assert.deepEqual(errors, []);
            }
            const result = { engine, boundsAndRecall, offline, transports, live, errors };
            results.push(result); console.log(JSON.stringify({ engine, controls: offline.map(({ kind, role, lowHighPcmDifference }) => ({ kind, role, lowHighPcmDifference })), transports: transports.map(({ mode, earlyRms, lateRms, starts }) => ({ mode, earlyRms, lateRms, sources: starts.length })), liveChange: live?.changedAt }));
            await page.screenshot({ path: `${evidence}/${engine}-grain-controls.png` });
            await context.close();
        } finally { await browser.close(); }
    }
    fs.writeFileSync(`${evidence}/${process.env.MYGRAIN_CONTROL_BASELINE ? 'baseline' : process.env.MYGRAIN_CONTROLS_ONLY ? 'offline' : 'fixed'}-results.json`, JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
