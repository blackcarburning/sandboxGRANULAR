const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');

const evidence = process.env.TRANSPORT_SYNC_EVIDENCE;
if (!evidence || !path.isAbsolute(evidence)) throw new Error('Set TRANSPORT_SYNC_EVIDENCE to the isolated verification directory.');
const configuration = JSON.parse(fs.readFileSync(path.join(evidence, 'private/connection.json')));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(configuration.origin)) throw new Error('Use an isolated localhost server.');
const engineName = process.env.TRANSPORT_SYNC_ENGINE || 'chromium';
const baseline = process.env.TRANSPORT_SYNC_BASELINE === '1';
const rates = process.env.TRANSPORT_SYNC_RATES ? process.env.TRANSPORT_SYNC_RATES.split(',').map(Number) : [44100, 48000];
const results = { engine: engineName, baseline, productionWrites: false, sourceHashes: [], checks: [], errors: [], baselineErrors: [], blockedRequests: [] };

async function verify(name, callback) {
    try {
        const details = await callback();
        results.checks.push({ name, passed: true, details });
    } catch (error) {
        results.checks.push({ name, passed: false, error: error.stack });
        if (!baseline) throw error;
    }
}

async function scheduledEvents(page) {
    return page.evaluate(() => window.timingEvents.filter(event => event.stopAt > event.when + .00001).map(event => ({ ...event })));
}

function alignment(events, sampleRate, earliest = -Infinity) {
    const drums = events.filter(event => event.kind === 'drum' && event.when >= earliest);
    const notes = events.filter(event => event.kind === 'X' && event.when >= earliest);
    assert.ok(drums.length >= 3 && notes.length >= 3, JSON.stringify({ drums, notes }));
    const covered = notes.filter(note => note.when >= drums[0].when - 1 / sampleRate && note.when <= drums.at(-1).when + 1 / sampleRate);
    assert.ok(covered.length >= 3, JSON.stringify({ drums, notes }));
    const errors = covered.map(note => Math.min(...drums.map(drum => Math.abs(drum.when - note.when))) * sampleRate);
    const worstFrames = Math.max(...errors);
    assert.ok(worstFrames <= 1.01, JSON.stringify({ worstFrames, drums, notes }));
    return { drumEvents: drums.length, notes: covered.length, worstFrames };
}

function transitionCoverage(events, sampleRate, changedAt, previousStepSeconds, nextStepSeconds) {
    const maximumGapSeconds = Math.max(previousStepSeconds, nextStepSeconds);
    const coverage = {};
    for (const kind of ['drum', 'X']) {
        const times = events.filter(event => event.kind === kind && event.when >= changedAt - maximumGapSeconds * 2 && event.when <= changedAt + 1.1)
            .map(event => event.when).sort((previous, next) => previous - next);
        assert.ok(times.some(time => time <= changedAt) && times.some(time => time >= changedAt + .8), JSON.stringify({ kind, changedAt, times }));
        const largestGap = Math.max(...times.slice(1).map((time, index) => time - times[index]));
        assert.ok(largestGap <= maximumGapSeconds * 1.05 + 1 / sampleRate, JSON.stringify({ kind, largestGap, maximumGapSeconds, changedAt, times }));
        coverage[kind] = { largestGapSeconds: largestGap, maximumGapSeconds };
    }
    return coverage;
}

(async () => {
    const browser = await (engineName === 'webkit' ? webkit : chromium).launch(engineName === 'webkit'
        ? { headless: true }
        : { executablePath: '/snap/chromium/current/usr/lib/chromium-browser/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        for (const sampleRate of rates) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
            await context.addCookies([{ name: configuration.cookieName, value: configuration.token, url: configuration.origin, httpOnly: true, sameSite: 'Lax' }]);
            await context.addInitScript(rate => {
                const NativeAudioContext = window.AudioContext;
                window.AudioContext = class extends NativeAudioContext {
                    constructor(options = {}) { super({ ...options, sampleRate: rate }); }
                };
            }, sampleRate);
            await context.route('**/*', route => {
                const request = route.request();
                if (new URL(request.url()).origin !== configuration.origin) {
                    results.blockedRequests.push({ method: request.method(), origin: new URL(request.url()).origin });
                    return route.abort();
                }
                if (baseline && new URL(request.url()).pathname === '/mygrain/') return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(evidence, 'before/index.html'), 'utf8') });
                return route.continue();
            });
            const page = await context.newPage();
            page.setDefaultTimeout(60000);
            if (engineName === 'chromium' && Number(process.env.TRANSPORT_SYNC_CPU_RATE) > 1) {
                const debugging = await context.newCDPSession(page);
                await debugging.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.TRANSPORT_SYNC_CPU_RATE) });
            }
            page.on('pageerror', error => results.errors.push({ sampleRate, message: error.message }));
            const sourceResponse = await context.request.get(configuration.origin + '/mygrain/');
            assert.equal(sourceResponse.status(), 200);
            assert.equal(new URL(sourceResponse.url()).origin, configuration.origin);
            const sourceBody = baseline ? fs.readFileSync(path.join(evidence, 'before/index.html')) : await sourceResponse.body();
            results.sourceHashes.push({ sampleRate, sha256: crypto.createHash('sha256').update(sourceBody).digest('hex') });
            await page.goto(configuration.origin + '/mygrain/', { waitUntil: 'load' });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            assert.equal(await page.evaluate(() => audioContext.sampleRate), sampleRate);
            await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true });
                setLoopLayerSolo('none', { silent: true, skipSave: true });
                arpEnabled = false;
                holdEnabled = false;
                seqGrainsEnabled = false;
                setFxMuted(true, { silent: true });
                applyGlobalBpm(120);
                syncPatternLengthControls(16, { skipSave: true });
                const makeBuffer = (seconds, frequency) => {
                    const buffer = audioContext.createBuffer(1, Math.round(seconds * audioContext.sampleRate), audioContext.sampleRate);
                    const samples = buffer.getChannelData(0);
                    for (let frame = 0; frame < samples.length; frame += 1) samples[frame] = .12 * Math.sin(2 * Math.PI * frequency * frame / buffer.sampleRate);
                    return buffer;
                };
                window.timingFixtures = { kick: makeBuffer(.04, 880), loopX: makeBuffer(.08, 220), loopA: makeBuffer(2.01, 330), generated: makeBuffer(2, 440) };
                window.timingEvents = [];
                const createSource = audioContext.createBufferSource.bind(audioContext);
                audioContext.createBufferSource = () => {
                    const source = createSource();
                    const start = source.start.bind(source);
                    const stop = source.stop.bind(source);
                    let record;
                    let stopAt = Infinity;
                    source.start = (...argumentsList) => {
                        const kind = source.buffer === window.timingFixtures.kick ? 'drum'
                            : source.buffer === window.timingFixtures.loopX ? 'X'
                                : source.buffer === window.timingFixtures.loopA ? 'A'
                                    : source.buffer === window.timingFixtures.generated ? 'generated' : null;
                        if (kind) {
                            record = { kind, when: argumentsList[0] ?? audioContext.currentTime, calledAt: audioContext.currentTime, offset: argumentsList[1] ?? 0, stopAt, loop: source.loop, rate: source.playbackRate.value };
                            window.timingEvents.push(record);
                        }
                        return start(...argumentsList);
                    };
                    source.stop = (...argumentsList) => {
                        stopAt = argumentsList[0] ?? audioContext.currentTime;
                        if (record) record.stopAt = stopAt;
                        return stop(...argumentsList);
                    };
                    return source;
                };
                bastardLoopXSampleBuffer = window.timingFixtures.loopX;
                bastardLoopXSampleMetadata = { fileName: 'timing-C3.wav', sourceLabel: 'TIMING_FIXTURE' };
                bastardLoopXRootNote = 'C3';
                bastardLoopXEnabled = true;
                bastardLoopXTimingIndex = 3;
                bastardLoopXPitchSemitones = 0;
                bastardLoopXSequence = Array.from({ length: 64 }, () => normalizeBastardLoopXStep({ note: 'C3' }));
                setSliderValue('performanceBastardLoopXLevel', 50);
                setSliderValue('performanceBastardLoopXAttack', 4);
                setSliderValue('performanceBastardLoopXStartTrim', 0);
                drumMachineEnabled = true;
                drumMachineKickBuffer = window.timingFixtures.kick;
                drumMachineKickPattern = Array(64).fill(true);
                drumMachineSnarePattern = Array(64).fill(false);
                drumMachineHatPattern = Array(64).fill(false);
                drumMachinePercPattern = Array(64).fill(false);
                drumMachineKickRatchetPattern = Array(64).fill(1);
                for (const track of Object.values(drumMachineExtraTracks)) track.pattern = Array(64).fill(false);
                setSliderValue('performanceDrumMachineLevel', 50);
                setDrumMachineDirectOutput(true, { silent: true, skipSave: true });
                generatedLoopBuffer = window.timingFixtures.generated;
                generatedLoopBaseBuffer = generatedLoopBuffer;
                generatedLoopTransportEnabled = true;
                setSliderValue('performanceGeneratedDryMix', 30);
            });
            await verify(`${sampleRate}: calibration is measured and bounded`, async () => {
                const calibration = await page.evaluate(() => ({ seconds: typeof getTransportOutputLatencySeconds === 'function' ? getTransportOutputLatencySeconds() : 0, state: typeof transportSync === 'object' ? JSON.parse(JSON.stringify(transportSync.latency)) : null }));
                assert.ok(calibration.seconds > .02 && calibration.seconds < .05, JSON.stringify(calibration));
                return calibration;
            });
            await verify(`${sampleRate}: cold start is buffered and drum/X timestamps match`, async () => {
                const requestedAt = await page.evaluate(() => {
                    window.timingEvents = [];
                    const requestedAt = audioContext.currentTime;
                    startAllBastardLoopLayers(null, { skipUi: true });
                    return requestedAt;
                });
                await page.waitForTimeout(1100);
                const events = await scheduledEvents(page);
                const first = ['drum', 'X'].map(kind => events.find(event => event.kind === kind));
                const minimumSchedulingLead = Number(process.env.TRANSPORT_SYNC_CPU_RATE) > 1 ? .02 : .19;
                assert.ok(first.every(event => event && event.when - requestedAt >= .3 - 1 / sampleRate), JSON.stringify({ requestedAt, first }));
                assert.ok(first.every(event => event.when - event.calledAt >= minimumSchedulingLead), JSON.stringify(first));
                return { ...alignment(events, sampleRate), minimumBufferMs: Math.min(...first.map(event => event.when - requestedAt)) * 1000,
                    minimumLeadMs: Math.min(...first.map(event => event.when - event.calledAt)) * 1000 };
            });
            await verify(`${sampleRate}: a 180ms UI stall preserves drum/X coverage`, async () => {
                const previous = await page.evaluate(() => ({ ...audioSchedulingStats }));
                await page.evaluate(() => { const deadline = performance.now() + 180; while (performance.now() < deadline) {} });
                await page.waitForTimeout(850);
                const current = await page.evaluate(() => ({ ...audioSchedulingStats }));
                assert.equal(current.skippedSteps, previous.skippedSteps, JSON.stringify({ previous, current }));
                return { ...alignment(await scheduledEvents(page), sampleRate), previous, current };
            });
            if (process.env.TRANSPORT_SYNC_DRUM_SEND_FX === '1') {
                await verify(`${sampleRate}: dedicated drum FX changes preserve running dry timing`, async () => {
                    const transition = await page.evaluate(() => {
                        const changedAt = audioContext.currentTime;
                        const step = getBastardLoopXStepDurationSeconds();
                        const drumBus = drumMachineBusGainNode;
                        const kickBus = drumMachineKickBypassGainNode;
                        const skippedStepsBefore = audioSchedulingStats.skippedSteps;
                        const startedAt = performance.now();
                        const changeControl = (identifier, value) => {
                            const control = document.getElementById(identifier);
                            control.value = String(value);
                            control.dispatchEvent(new Event(control.type === 'range' ? 'input' : 'change', { bubbles: true }));
                        };
                        document.getElementById('drumSendDelayEnabledBtn').click();
                        document.getElementById('drumSendReverbEnabledBtn').click();
                        changeControl('drumSendDelayTimeMode', 'free');
                        changeControl('drumSendDelayTime', 170);
                        changeControl('drumSendReverbRoom', 'cathedral');
                        changeControl('drumSendReverbDecay', 100);
                        document.getElementById('drumSendReverbShimmerEnabledBtn').click();
                        changeControl('drumSendReverbShimmerShift', '24');
                        changeControl('drumSendReverbShimmerMix', 65);
                        return { changedAt, step, elapsedMs: performance.now() - startedAt, skippedStepsBefore,
                            sameDrumBus: drumBus === drumMachineBusGainNode,
                            sameKickBus: kickBus === drumMachineKickBypassGainNode };
                    });
                    await page.waitForTimeout(1500);
                    assert.equal(transition.sameDrumBus, true);
                    assert.equal(transition.sameKickBus, true);
                    const events = await scheduledEvents(page);
                    const observed = await page.evaluate(() => ({ now: audioContext.currentTime, state: audioContext.state,
                        drumEnabled: drumMachineEnabled, drumPlaying: drumMachinePlaying,
                        stats: { ...audioSchedulingStats } }));
                    assert.ok(transition.elapsedMs < 200, JSON.stringify({ transition, observed }));
                    assert.equal(observed.stats.skippedSteps, transition.skippedStepsBefore, JSON.stringify({ transition, observed }));
                    let coverage;
                    try {
                        coverage = transitionCoverage(events, sampleRate, transition.changedAt, transition.step, transition.step);
                    } catch (error) {
                        throw new Error(`${error.message}; ${JSON.stringify({ transition, observed })}`);
                    }
                    const prepared = await page.evaluate(async () => {
                        let timer;
                        const ready = await Promise.race([waitForDrumSendImpulse(),
                            new Promise(resolve => { timer = setTimeout(() => resolve(false), 30000); })]);
                        clearTimeout(timer);
                        return { ready, now: audioContext.currentTime,
                            status: drumSendFxGraph.impulseStatus, error: drumSendFxGraph.impulseError,
                            key: drumSendFxGraph.impulseKey, requestedKey: drumSendFxGraph.requestedImpulseKey,
                            reverbFrames: drumSendFxGraph.reverb.buffer?.length || 0,
                            shimmerFrames: drumSendFxGraph.shimmer.buffer?.length || 0,
                            skippedSteps: audioSchedulingStats.skippedSteps };
                    });
                    assert.equal(prepared.ready, true, JSON.stringify(prepared));
                    assert.equal(prepared.key, prepared.requestedKey, JSON.stringify(prepared));
                    assert.ok(prepared.reverbFrames > 0 && prepared.shimmerFrames > 0, JSON.stringify(prepared));
                    assert.equal(prepared.skippedSteps, transition.skippedStepsBefore, JSON.stringify({ transition, prepared }));
                    const preparedEvents = await scheduledEvents(page);
                    const preparationCoverage = {};
                    for (const kind of ['drum', 'X']) {
                        const times = preparedEvents.filter(event => event.kind === kind && event.when >= transition.changedAt - transition.step * 2
                            && event.when <= prepared.now).map(event => event.when).sort((previous, next) => previous - next);
                        assert.ok(times.length >= 5 && times.at(-1) >= prepared.now - transition.step * 2, JSON.stringify({ kind, times, prepared }));
                        const intervals = times.slice(1).map((time, index) => time - times[index]);
                        const largestGap = Math.max(...intervals);
                        const smallestGap = Math.min(...intervals);
                        assert.ok(largestGap <= transition.step * 1.05 + 1 / sampleRate, JSON.stringify({ kind, largestGap, transition }));
                        assert.ok(smallestGap > 1 / sampleRate, JSON.stringify({ kind, smallestGap }));
                        preparationCoverage[kind] = { largestGapSeconds: largestGap, smallestGapSeconds: smallestGap };
                    }
                    return { ...transition, ...alignment(preparedEvents, sampleRate, transition.changedAt + .8),
                        observed, coverage, prepared, preparationCoverage };
                });
            }
            await verify(`${sampleRate}: global BPM transition remains locked`, async () => {
                const transition = await page.evaluate(() => { const previousStep = getBastardLoopXStepDurationSeconds(); const changedAt = audioContext.currentTime; applyGlobalBpm(125); return { changedAt, previousStep, nextStep: getBastardLoopXStepDurationSeconds() }; });
                await page.waitForTimeout(1700);
                const events = await scheduledEvents(page);
                return { ...alignment(events, sampleRate, transition.changedAt + .8), coverage: transitionCoverage(events, sampleRate, transition.changedAt, transition.previousStep, transition.nextStep) };
            });
            await verify(`${sampleRate}: SEQ BPM input uses the same transition`, async () => {
                const transition = await page.evaluate(() => {
                    const previousStep = getBastardLoopXStepDurationSeconds();
                    const changedAt = audioContext.currentTime;
                    const input = document.getElementById('seqBpm');
                    input.value = '131';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    return { changedAt, previousStep, nextStep: getBastardLoopXStepDurationSeconds() };
                });
                await page.waitForTimeout(1700);
                const events = await scheduledEvents(page);
                return { ...alignment(events, sampleRate, transition.changedAt + .8), coverage: transitionCoverage(events, sampleRate, transition.changedAt, transition.previousStep, transition.nextStep) };
            });
            await verify(`${sampleRate}: rapid tempo changes settle on one grid`, async () => {
                const changedAt = await page.evaluate(() => { for (const tempo of [119, 127, 113]) applyGlobalBpm(tempo); return audioContext.currentTime; });
                await page.waitForTimeout(1800);
                const tempo = await page.evaluate(() => sequencerBPM);
                assert.equal(tempo, 113);
                return { ...alignment(await scheduledEvents(page), sampleRate, changedAt + .9), tempo };
            });
            if (Number(process.env.TRANSPORT_SYNC_SOAK_SECONDS) > 0) {
                await verify(`${sampleRate}: sustained fractional-tempo playback stays locked`, async () => {
                    const changedAt = await page.evaluate(() => { applyGlobalBpm(127); return audioContext.currentTime; });
                    await page.waitForTimeout(Number(process.env.TRANSPORT_SYNC_SOAK_SECONDS) * 1000);
                    return { ...alignment(await scheduledEvents(page), sampleRate, changedAt + 1), seconds: Number(process.env.TRANSPORT_SYNC_SOAK_SECONDS) };
                });
            }
            await verify(`${sampleRate}: adding generated playback preserves the running epoch`, async () => {
                const before = await page.evaluate(() => getSharedLoopTransportOriginTime());
                await page.evaluate(() => playLoopAndHeldKeys({ silent: true }));
                await page.waitForTimeout(900);
                const after = await page.evaluate(() => getSharedLoopTransportOriginTime());
                assert.ok(Math.abs(after - before) * sampleRate <= 1.01, JSON.stringify({ before, after }));
                return { ...alignment(await scheduledEvents(page), sampleRate), before, after };
            });
            await verify(`${sampleRate}: late X joins use a safe grid boundary`, async () => {
                await page.evaluate(() => { stopAllPerformancePlayback({ silent: true }); applyGlobalBpm(120); window.timingEvents = []; startDrumMachine(null, { silent: true, skipSave: true }); });
                await page.waitForTimeout(700);
                const joined = await page.evaluate(() => {
                    const stepDuration = getBastardLoopXStepDurationSeconds();
                    const origin = getSharedLoopTransportOriginTime();
                    const boundary = origin + Math.ceil((audioContext.currentTime - origin) / stepDuration) * stepDuration;
                    while (audioContext.currentTime < boundary + .005) {}
                    const now = audioContext.currentTime;
                    startBastardLoopX(null, { skipUi: true });
                    return { origin, now, next: bastardLoopXNextStepTime };
                });
                await page.waitForTimeout(1200);
                const events = await scheduledEvents(page);
                const first = events.find(event => event.kind === 'X');
                assert.ok(first && first.when - first.calledAt >= .10, JSON.stringify({ first, joined }));
                return { ...alignment(events, sampleRate, joined.now), joined, leadMs: (first.when - first.calledAt) * 1000 };
            });
            await verify(`${sampleRate}: synchronized sample periods ignore fractional metadata excess`, async () => {
                await page.evaluate(() => {
                    stopAllPerformancePlayback({ silent: true });
                    applyGlobalBpm(120);
                    bastardLoopBuffer = window.timingFixtures.loopA;
                    bastardLoopMetadata = { durationSeconds: 2.01, patternSteps: 16, bpm: 120 };
                    bastardLoopSourceBpm = 120;
                    bastardLoopEnabled = true;
                    document.getElementById('performanceBastardLoopPitchAffectsDuration').checked = false;
                    setSliderValue('performanceBastardLoopLevel', 40);
                    window.timingEvents = [];
                    startAllBastardLoopLayers(null, { skipUi: true });
                });
                const period = await page.evaluate(() => ({ seconds: (bastardLoopSource.loopEnd - bastardLoopSource.loopStart) / bastardLoopSource.playbackRate.value, sourceDuration: bastardLoopBuffer.duration, expected: 60 / sequencerBPM * 4 }));
                assert.ok(Math.abs(period.seconds - period.expected) * sampleRate <= 1.01, JSON.stringify(period));
                assert.equal(period.sourceDuration, 2.01);
                return period;
            });
            if (!baseline) {
                await verify(`${sampleRate}: live export trims buffering and processing latency`, async () => {
                    const supported = await page.evaluate(() => {
                        if (typeof MediaRecorder === 'undefined') return false;
                        const destination = audioContext.createMediaStreamDestination();
                        try {
                            const mimeType = chooseRecordingMimeType();
                            new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);
                            return true;
                        } catch { return false; }
                        finally { for (const track of destination.stream.getTracks()) track.stop(); }
                    });
                    if (!supported) return { skipped: 'MediaRecorder unsupported by this browser runtime' };
                    const exported = await page.evaluate(async () => {
                        syncPerformanceExportBars(1, { skipSave: true });
                        const rendered = await renderLiveOutputBarsBuffer({ forceBastardLoops: true, forceDrumMachine: true });
                        const samples = rendered.audioBuffer.getChannelData(0);
                        let peak = 0;
                        let firstPeak = 0;
                        let lastPeak = 0;
                        const windowFrames = Math.round(rendered.audioBuffer.sampleRate * .05);
                        for (let frame = 0; frame < samples.length; frame += 1) {
                            const amplitude = Math.abs(samples[frame]);
                            peak = Math.max(peak, amplitude);
                            if (frame < windowFrames) firstPeak = Math.max(firstPeak, amplitude);
                            if (frame >= samples.length - windowFrames) lastPeak = Math.max(lastPeak, amplitude);
                        }
                        return { frames: rendered.audioBuffer.length, sampleRate: rendered.audioBuffer.sampleRate, durationSeconds: rendered.durationSeconds, channels: rendered.audioBuffer.numberOfChannels, peak, firstPeak, lastPeak };
                    });
                    assert.ok(Math.abs(exported.frames - exported.durationSeconds * sampleRate) <= 1, JSON.stringify(exported));
                    assert.ok(exported.peak > .0001 && exported.firstPeak > .00001 && exported.lastPeak > .00001, JSON.stringify(exported));
                    return exported;
                });
            }
            await verify(`${sampleRate}: stop cancels queued voices and rhythm timers`, async () => {
                await page.evaluate(() => stopAllPerformancePlayback({ silent: true }));
                await page.waitForTimeout(400);
                const stopped = await page.evaluate(() => ({ drums: drumMachinePlaying, loops: bastardLoopPlaying, X: isBastardLoopXRunning(), voicesX: bastardLoopXActiveVoices.size, voicesDrums: drumMachineActiveVoices.size, timer: sharedRhythmClockTimerId, sourceA: Boolean(bastardLoopSource) }));
                assert.ok(!stopped.drums && !stopped.loops && !stopped.X && !stopped.voicesX && !stopped.voicesDrums && !stopped.timer && !stopped.sourceA, JSON.stringify(stopped));
                return stopped;
            });
            if (!baseline) {
                await verify(`${sampleRate}: stopping a pending tempo change cannot restart playback`, async () => {
                    await page.evaluate(() => { startAllBastardLoopLayers(null, { skipUi: true }); applyGlobalBpm(129); stopAllPerformancePlayback({ silent: true }); });
                    await page.waitForTimeout(1100);
                    const stopped = await page.evaluate(() => ({ drums: drumMachinePlaying, loops: bastardLoopPlaying, X: isBastardLoopXRunning(), voicesX: bastardLoopXActiveVoices.size, voicesDrums: drumMachineActiveVoices.size, timer: sharedRhythmClockTimerId }));
                    assert.ok(!stopped.drums && !stopped.loops && !stopped.X && !stopped.voicesX && !stopped.voicesDrums && !stopped.timer, JSON.stringify(stopped));
                    return stopped;
                });
                await verify(`${sampleRate}: engine recovery rebuilds calibrated nodes in the new context`, async () => {
                    const recovered = await page.evaluate(async () => {
                        const previous = audioContext;
                        await audioContext.close();
                        await ensureForegroundAudioReady({ silent: true });
                        return { changed: audioContext !== previous, ready: isAudioGraphReady(), state: audioContext.state, latency: getTransportOutputLatencySeconds(), delayContextMatches: finalKickBypassDelay?.context === audioContext, delay: finalKickBypassDelay?.delayTime.value, voicesX: bastardLoopXActiveVoices.size, voicesDrums: drumMachineActiveVoices.size };
                    });
                    assert.ok(recovered.changed && recovered.ready && recovered.state === 'running' && recovered.delayContextMatches, JSON.stringify(recovered));
                    assert.ok(recovered.latency > .02 && Math.abs(recovered.delay - recovered.latency) * sampleRate < 1, JSON.stringify(recovered));
                    assert.equal(recovered.voicesX + recovered.voicesDrums, 0);
                    return recovered;
                });
            }
            for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
                await page.setViewportSize(viewport);
                await verify(`${sampleRate}: mobile layout ${viewport.width}x${viewport.height}`, async () => {
                    const layout = await page.evaluate(() => ({ width: innerWidth, pageWidth: document.documentElement.scrollWidth }));
                    assert.ok(layout.pageWidth <= layout.width + 1, JSON.stringify(layout));
                    return layout;
                });
            }
            await context.close();
        }
    } finally {
        await browser.close();
        console.log(JSON.stringify(results, null, 2));
    }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
