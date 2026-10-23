const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18919/mygrain/';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Use isolated local test accounts only');
(async () => {
    const results = [];
    for (const [engine, name] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
        const browser = await engine.launch(name === 'chromium' ? { executablePath: '/snap/bin/chromium',
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
          for (const phone of [false, true]) {
            const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: phone, isMobile: phone });
            await context.route('**/*', r => new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort());
            const response = await context.request.post(base + 'api/auth/register', { data: {
                username: `bus_${name}_${phone}_${Date.now()}`, password: 'isolated-compressor-fixture' } });
            assert.equal(response.status(), 200);
            await context.addInitScript(() => {
                const edges = new Map(); window.__busEdges = edges;
                const connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
                AudioNode.prototype.connect = function (...args) {
                    const result = connect.apply(this, args);
                    if (!edges.has(this)) edges.set(this, new Set()); edges.get(this).add(args[0]);
                    return result;
                };
                AudioNode.prototype.disconnect = function (...args) {
                    const result = disconnect.apply(this, args);
                    if (!args.length) edges.delete(this); else edges.get(this)?.delete(args[0]);
                    return result;
                };
            });
            const page = await context.newPage(); const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            page.setDefaultTimeout(45000);
            await page.goto(base, { waitUntil: 'load' });
            await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready' && window.mygrainSongBeta && !mygrainSongBeta.busy);
            await page.locator('#start-btn').click();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            const result = await page.evaluate(async () => {
                stopAllPerformancePlayback({ silent: true }); stateSaveSuspended = true;
                await ensureTransportLatencyReady(audioContext);
                const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
                const check = (condition, label) => { if (!condition) throw new Error(label); };
                const paths = (source, target, visited = new Set()) => {
                    if (source === target) return [[source]];
                    if (visited.has(source)) return [];
                    const seen = new Set(visited).add(source);
                    return [...(window.__busEdges.get(source) || [])].flatMap(next => paths(next, target, seen).map(path => [source, ...path]));
                };
                const rows = [];
                activeKeyCount = 1;
                for (const placement of ['pre', 'post']) {
                  finalFxPlacement = placement; rebuildFinalFxRouting();
                  for (const direct of [false, true]) {
                    setDrumMachineDirectOutput(direct, { silent: true, skipSave: true });
                    for (const key of ['off', 'lfo1', 'kick']) {
                      setFinalCompressorSidechainSource(key, { silent: true, skipSave: true });
                      const main = ensureDrumMachineBus(), kick = ensureDrumMachineKickBypassBus();
                      for (const source of [finalOutputPanner, main, kick, drumSendFxGraph.returnPanner]) {
                        const routes = paths(source, finalAmplifierNode);
                        check(routes.length > 0, 'Missing output route');
                        check(routes.every(path => path.filter(node => node === finalCompressorNode).length === 1), 'Every output path must share exactly one Bus Comp');
                      }
                      check(paths(finalKickBypassPanner, finalSidechainGain).length === 0, 'Kick/direct drums must not enter ducking gain');
                      check(paths(drumSendFxGraph.returnPanner, preFilterGainNode).length === 0, 'No drum FX return feedback');
                      rows.push({ placement, direct, key });
                    }
                  }
                }
                const settings = [];
                for (const amount of [0, 30, 100]) {
                    const slider = document.getElementById('finalCompressorAmount');
                    slider.value = amount; slider.dispatchEvent(new Event('input', { bubbles: true }));
                    await delay(650);
                    const expected = getFinalCompressorSettings(amount / 100);
                    check(Math.abs(finalCompressorDriveGain.gain.value - expected.drive) < .001, 'Drive slider');
                    check(Math.abs(finalCompressorNode.ratio.value - expected.ratio) < .001, `Ratio slider: ${amount} ${finalCompressorNode.ratio.value} expected ${expected.ratio}`);
                    settings.push({ amount, drive: finalCompressorDriveGain.gain.value, ratio: finalCompressorNode.ratio.value });
                }
                fxMuted = true; updateFinalCompressorDynamics(); await delay(650);
                check(Math.abs(finalCompressorDriveGain.gain.value - 1) < .001 && Math.abs(finalCompressorNode.ratio.value - 1) < .001, 'FX mute unity');
                check(document.getElementById('finalCompressorAmount').value === '100', 'Mute preserves control');
                fxMuted = false;
                setDrumMachineKickLevelPercent(80, { skipSave: true }); setFinalSidechainKickLevelPercent(25, { skipSave: true });
                check(getDrumMachineKickPlaybackLevel() === .2, 'Independent kick trim');
                const compDelay = getTransportCompressorLatencySeconds();
                check(Math.abs(finalKickBypassDelay.delayTime.value - getTransportPreCompressorLatencySeconds()) < 1e-6, 'No double lookahead in bypass delay');
                setSliderValue('finalSidechainAmount', 100, { dispatch: false });
                finalSidechainKickEvents = [{ time: audioContext.currentTime + compDelay - .004, intensity: 1 }];
                updateFinalCompressorDynamics(); await delay(15);
                check(finalSidechainGain.gain.value < .99, 'Kick still ducks music');
                finalSidechainKickEvents = []; setSliderValue('finalSidechainAmount', 0, { dispatch: false });
                // Real high-wet returns: independent worker-built room plus feedback delay.
                setDrumMachineEnabled(true, { silent: true, skipSave: true });
                Object.assign(drumSendFxState.delay, { enabled: true, amount: 100, send: 200, feedback: 100, timeMode: 'free', time: 90 });
                Object.assign(drumSendFxState.reverb, { enabled: true, amount: 100, send: 200, size: 70, decay: 70 });
                updateDrumSendEffects();
                check(await waitForDrumSendImpulse(drumSendFxGraph), 'Drum room prepares');
                const source = audioContext.createBufferSource();
                const buffer = audioContext.createBuffer(1, Math.ceil(audioContext.sampleRate * .08), audioContext.sampleRate);
                const pcm = buffer.getChannelData(0);
                for (let i = 0; i < pcm.length; i++) pcm[i] = .02 * Math.sin(2 * Math.PI * 440 * i / audioContext.sampleRate);
                source.buffer = buffer; source.connect(drumSendFxGraph.delayInput); source.connect(drumSendFxGraph.reverbInput);
                const analyser = audioContext.createAnalyser(); analyser.fftSize = 4096;
                finalAmplifierNode.connect(analyser); const signal = new Float32Array(4096);
                source.start(audioContext.currentTime + .03); let peak = 0, tail = 0;
                for (let tick = 0; tick < 12; tick++) {
                    await delay(90); analyser.getFloatTimeDomainData(signal);
                    for (const value of signal) { check(Number.isFinite(value), 'Finite high-wet PCM'); peak = Math.max(peak, Math.abs(value)); if (tick > 5) tail = Math.max(tail, Math.abs(value)); }
                }
                source.disconnect(); finalAmplifierNode.disconnect(analyser); analyser.disconnect();
                check(peak > .0001 && peak < 1 && tail > .00001, `Audible bounded wet output ${peak}, ${tail}`);
                activeKeyCount = 0; updateFinalCompressorDynamics(); await delay(180);
                check(finalCompressorDriveGain.gain.value > .99, 'Idle must not silence independent drum tails');
                return { rows, settings, highWet: { peak, tail }, latency: getTransportTimingDebug().latency, compDelay };
            });
            assert.deepEqual(errors, []);
            results.push({ engine: name, phone, ...result });
            await context.close();
          }
        } finally { await browser.close(); }
    }
    console.log(JSON.stringify({ physicalDeviceTested: false, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
