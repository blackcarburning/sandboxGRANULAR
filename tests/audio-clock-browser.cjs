// Real Web Audio + synthetic visibility. This does NOT emulate an actual iOS screen lock.
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18948/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        if (process.env.BG_ENGINE && process.env.BG_ENGINE !== engine) continue;
        const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try { for (const viewport of (process.env.IDLE_NATIVE_ONLY ? [{width:390,height:844}] : [{ width: 390, height: 844 }, { width: 844, height: 390 }])) {
            const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
            assert.equal((await context.request.post(base + 'api/auth/login', { data: { username: 'admin', password: 'isolated-page-scroll' } })).status(), 200);
            const page = await context.newPage(), errors = [];
            page.on('pageerror', e => errors.push(e.message));
            await page.route('**/*', r => new URL(r.request().url()).origin === new URL(base).origin || r.request().url().startsWith('blob:') ? r.continue() : r.abort());
            await page.goto(base); await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
            await page.evaluate(() => {
                window.__idleBookkeeping = [];
                const interval = window.setInterval;
                window.setInterval = function(callback, delay, ...args) {
                    const id = interval(callback, delay, ...args);
                    if (typeof callback === 'function' && callback.name === 'sync' && callback.toString().includes('checkIdle')) __idleBookkeeping.push(id);
                    return id;
                };
                window.__pumpCalls = 0;
                const pump = tickBackgroundAudio;
                tickBackgroundAudio = () => { __pumpCalls++; pump(); };
                window.__disableUiTimers = false;
                const NativeWorklet = window.AudioWorkletNode;
                window.AudioWorkletNode = new Proxy(NativeWorklet, { construct(target, args) {
                    const node = Reflect.construct(target, args);
                    if(args[1] === 'mygrain-background-clock-v1') window.__nativeScheduler = node;
                    return node;
                }});
                window.__hidden = false;
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => __hidden });
                Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => __hidden ? 'hidden' : 'visible' });
                const timeout = window.setTimeout;
                window.__droppedTimers = 0;
                window.setTimeout = function (callback, delay, ...args) {
                    if ((__hidden || __disableUiTimers) && typeof callback === 'function' && /scheduleActiveGrains|scheduleSequencer|scheduleArpeggiatorPlayback|runSharedRhythmClock/.test(callback.toString())) { __droppedTimers++; return -777; }
                    return timeout(callback, delay, ...args);
                };
                window.__setHidden = value => { __hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
            });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.waitForFunction(() => backgroundAudioController?.diagnostics.clockReady);
            await page.evaluate(async () => {
                stopAllPerformancePlayback({ silent: true });
                window.__originalContext = audioContext;
                window.__fixture = audioContext.createBuffer(1, 48000 * 8, 48000);
                const data = __fixture.getChannelData(0);
                for (let i = 0; i < data.length; i++) data[i] = .2 * Math.sin(2 * Math.PI * 261.625565 * i / 48000);
                setKeyboardSampleBuffer(__fixture);
                await applyLoadedAudioBuffer(__fixture, 'isolated grain A', 'grainASample');
                await applyLoadedAudioBuffer(__fixture, 'isolated grain B', 'grainBSample');
                const code = `class Witness extends AudioWorkletProcessor {
                    constructor() { super(); this.sum=0; this.count=0; }
                    process(inputs) { for(const value of inputs[0]?.[0] || []) { this.sum += value*value; this.count++; }
                        if(this.count >= sampleRate*.25) { this.port.postMessage(Math.sqrt(this.sum/this.count)); this.sum=0; this.count=0; } return true; }
                } registerProcessor('background-test-witness', Witness);`;
                const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
                await audioContext.audioWorklet.addModule(url); URL.revokeObjectURL(url);
                window.__witness = new AudioWorkletNode(audioContext, 'background-test-witness');
                window.__rms = []; __witness.port.onmessage = e => __rms.push(e.data);
                finalAmplifierNode.connect(__witness); __witness.connect(audioContext.destination);
            });
            const cases = [];
            for (const sound of (process.env.IDLE_NATIVE_ONLY ? ['sample'] : ['sample', 'grain', 'arp-rhythm'])) {
                await page.evaluate(async sound => {
                    __rms = []; stopAllPerformancePlayback({ silent: true }); setHoldEnabled(false); setArpeggiatorEnabled(false, { skipSave: true });
                    if (sound === 'grain') {
                        await prepareGranularKeyboardFromUi(); setKeyboardSoundSource('grain', { skipSave: true });
                        setGranularLayerMuted('B', true, { skipSave: true, silent: true });
                        setSliderValue('grainSynthASize', 200); setSliderValue('grainSynthABlend', 50);
                    } else setKeyboardSoundSource('sample', { skipSave: true });
                    heldNotes = new Set(['C3', 'E3']); setHoldEnabled(true);
                    if (sound === 'arp-rhythm') {
                        setArpeggiatorEnabled(true, { skipSave: true }); playLoopAndHeldKeys({ silent: true });
                        startDrumMachine(null, { silent: true }); startSequencer();
                    } else startHeldKeyboardPlayback();
                }, sound);
                await page.waitForFunction(() => __rms.slice(-2).some(rms => rms > .00001));
                const initial = await page.evaluate(() => ({ rms: Math.max(...__rms.slice(-2)), grains: activeGrains.size, arp: isArpeggiatorPlaying(), recent: __rms.slice(-5), activeKeyCount, nodes: getConcurrentGrainSourceCount(), aSource: document.getElementById('grainSynthASource').value, aPeak: getBufferPeak(grainASampleBuffer), master: masterGain.gain.value, output: finalAmplifierNode.gain.value, granular: granularOutputGain.gain.value }));
                assert(initial.rms > .00001, JSON.stringify({ engine, sound, initial }));
                if(sound==='sample') await page.evaluate(()=>startSequencer());
                await page.waitForFunction(() => backgroundAudioController.driving);
                await page.evaluate(() => { __disableUiTimers=true; __rms=[]; __pumpCalls=0; });
                await page.waitForTimeout(2500);
                const foreground=await page.evaluate(()=>({driving:backgroundAudioController.driving,calls:__pumpCalls,rms:__rms.slice(2),skipped:audioSchedulingStats.skippedSteps,modulation:capturePhoneDiagnosticState().processing.modulation}));
                assert(foreground.driving&&foreground.calls>40);
                assert(foreground.rms.length>=5&&foreground.rms.every(value=>value>.00001),JSON.stringify({engine,sound,foreground}));
                assert.equal(foreground.skipped,0);
                await page.evaluate(() => { __disableUiTimers=false; });
                cases.push({sound:sound+'-foreground-native',foreground});
                await page.evaluate(() => { __rms = []; __pumpCalls = 0; __droppedTimers = 0; window.__t0 = audioContext.currentTime; __setHidden(true); });
                await page.waitForTimeout(sound === 'sample' ? 9500 : 2500);
                const hidden = await page.evaluate(() => ({ clock: backgroundAudioController.diagnostics,
                    seconds: audioContext.currentTime - __t0, calls: __pumpCalls, dropped: __droppedTimers,
                    rms: __rms.slice(2), arp: isArpeggiatorPlaying(), grains: activeGrains.size,
                    sequencer: sequencerPlaying, drums: drumMachinePlaying,
                    resumeFlags: [restartPerformanceOnFocusReturn, restartBastardLoopOnFocusReturn, restartDrumMachineOnFocusReturn] }));
                assert.equal(hidden.clock.contextState, 'running'); assert(hidden.calls > 20); assert(hidden.seconds > 2);
                assert(hidden.rms.length >= 5 && hidden.rms.every(rms => rms > .00001), JSON.stringify({ engine, sound, hidden }));
                assert.deepEqual(hidden.resumeFlags, [false, false, false]);
                if (sound === 'grain') assert(hidden.grains > 0 && hidden.dropped > 0);
                if (sound === 'arp-rhythm') assert(hidden.arp && hidden.sequencer && hidden.drums && hidden.dropped > 0);
                await page.evaluate(() => __setHidden(false)); await page.waitForTimeout(300);
                assert.equal(await page.evaluate(() => audioContext === __originalContext), true);
                cases.push({ sound, hidden });
                if(sound==='sample'){
                    await page.evaluate(()=>{__nativePulse=__nativeScheduler.port.onmessage;__nativeScheduler.port.onmessage=null;__rms=[];__watchdogNext=sequencerNextStepTime;});
                    await page.waitForTimeout(700);
                    const fallback=await page.evaluate(()=>({driving:backgroundAudioController.driving,rms:__rms.slice(-2),skipped:audioSchedulingStats.skippedSteps,advanced:sequencerNextStepTime-__watchdogNext}));
                    assert.equal(fallback.driving,false);assert(fallback.rms.length&&fallback.rms.every(value=>value>.00001));assert.equal(fallback.skipped,0);assert(fallback.advanced>.4,'Watchdog must keep scheduling, not just replay an existing native loop');
                    await page.evaluate(()=>{__nativeScheduler.port.onmessage=__nativePulse;__nativeScheduler.port.postMessage('ack');});
                    await page.waitForFunction(()=>backgroundAudioController.driving);
                    cases.push({sound:'native-clock-watchdog',fallback});
                }
            }
            await page.evaluate(() => { __setHidden(true); stopAllPerformancePlayback({ silent: true }); });
            await page.waitForTimeout(400); await page.evaluate(() => __setHidden(false)); await page.waitForTimeout(300);
            assert.deepEqual(await page.evaluate(() => [sequencerPlaying, isArpeggiatorPlaying(), drumMachinePlaying, activeGrains.size]), [false, false, false, 0]);
            await page.evaluate(async () => { __setHidden(true); await audioContext.suspend(); });
            await page.waitForTimeout(400);
            assert.equal(await page.evaluate(() => audioContext.state), 'suspended', 'No background auto-resume after interruption');
            await page.evaluate(async () => { __setHidden(false); await audioContext.resume(); });
            await page.waitForTimeout(250);
            assert.deepEqual(await page.evaluate(() => [sequencerPlaying, isArpeggiatorPlaying(), drumMachinePlaying, activeGrains.size]), [false, false, false, 0]);
            // The real context must freeze after Stop, not merely output zero.
            await page.evaluate(() => { stopAllPerformancePlayback({silent:true}); __setHidden(true); if(__idleBookkeeping.length!==1)throw Error('Missing idle bookkeeping fixture'); __idleBookkeeping.forEach(clearInterval); });
            await page.waitForFunction(() => audioContext.state === 'suspended' && backgroundAudioController.idleSuspended, null, {timeout:20000});
            const asleep = await page.evaluate(() => ({time:audioContext.currentTime, modulation:modulationIntervalId,
                idle:backgroundAudioController.diagnostics, contextSame:audioContext===__originalContext}));
            assert.equal(asleep.modulation,null);assert.equal(asleep.idle.clockEnabled,false);assert(asleep.contextSame);
            await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>audioContext.currentTime),asleep.time);
            await page.evaluate(() => __setHidden(false));await page.waitForTimeout(500);
            assert.equal(await page.evaluate(()=>audioContext.state),'suspended','focus must preserve idle sleep');
            // Real gesture wakes the same graph; no forced reset or lost buffers.
            await page.locator('#performanceSeqPlayBtn').tap();
            await page.waitForFunction(()=>audioContext.state==='running'&&!backgroundAudioController.idleSuspended);
            await page.evaluate(()=>{__rms=[];heldNotes=new Set(['C3']);setArpeggiatorEnabled(false,{skipSave:true});setKeyboardSoundSource('sample',{skipSave:true});startHeldKeyboardPlayback();});
            await page.waitForFunction(()=>__rms.slice(-2).some(rms=>rms>.00001));
            assert.equal(await page.evaluate(()=>audioContext===__originalContext&&modulationIntervalId!==null),true);
            await page.evaluate(()=>stopAllPerformancePlayback({silent:true}));
            assert.equal(await page.locator('.build-badge strong').first().textContent(),'v2026.10.29.AUDIO-CLOCK.1');
            cases.push({sound:'idle-sleep-wake',asleep});
            assert.deepEqual(errors, []);
            results.push({ engine, viewport, cases }); await context.close();
        } } finally { await browser.close(); }
    }
    console.log(JSON.stringify({ passed: results.length, results }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
