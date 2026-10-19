const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18765/mygrain/';
const legacyDirectory = process.env.MYGRAIN_LEGACY_DIR;
const sampleSeconds = Number(process.env.MYGRAIN_PERF_SECONDS || 4);
const observeMutations = process.env.MYGRAIN_PERF_OBSERVE !== '0';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    const results = [];
    try {
        for (const legacy of legacyDirectory ? [true, false] : [false]) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            const page = await context.newPage();
            page.setDefaultTimeout(45000);
            page.on('pageerror', error => errors.push(error.stack));
            await page.route('**/*', route => {
                const request = route.request();
                if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
                const url = new URL(request.url());
                if (url.origin !== new URL(base).origin) return route.abort();
                if (legacy && url.pathname === new URL(base).pathname) return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(legacyDirectory, 'index.html')) });
                if (legacy && url.pathname.endsWith('/q-card.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(legacyDirectory, 'q-card.js')) });
                return route.continue();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.waitForFunction(() => window.mygrainQ && document.querySelectorAll('#bastardLoopQScale option').length === 86);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            const build = await page.locator('.build-badge').first().textContent();
            await page.evaluate(observeMutations => {
                stopAllPerformancePlayback({ silent: true });
                applyGlobalBpm(120);
                syncPatternLengthControls(64, { silent: true, skipSave: true });
                const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                const data = buffer.getChannelData(0);
                for (let frame = 0; frame < data.length; frame += 1) data[frame] = .12 * Math.sin(frame * Math.PI * 2 * 261.6256 / buffer.sampleRate);
                grainMainSampleBuffer = buffer;
                grainASampleBuffer = buffer;
                grainBSampleBuffer = buffer;
                drumMachineKickBuffer = buffer;
                drumMachineSnareBuffer = buffer;
                drumMachineHatBuffer = buffer;
                drumMachinePercBuffer = buffer;
                for (const track of Object.values(drumMachineExtraTracks)) track.buffer = buffer;
                for (const kind of ['kick', 'snare', 'hat', 'perc', 'clap', 'cymbals']) setDrumMachinePattern(kind, Array.from({ length: 64 }, (unused, index) => kind === 'hat' || index % 2 === 0), { skipSave: true });
                bastardLoopXSampleBuffer = buffer;
                bastardLoopXSequence = Array.from({ length: 64 }, (unused, index) => ({ ...createEmptyBastardLoopXStep(), note: index % 4 ? 'G2' : 'C2' }));
                setBastardLoopXEnabled(true, { silent: true, skipSave: true });
                Object.assign(mygrainQ.state, { instrument: 'piano', enabled: true, rate: 1,
                    sequence: Array.from({ length: 64 }, (unused, index) => index % 2 ? null : MygrainQTheory.normalizeStep({ root: 48, notes: [48, 52, 55, 60], gate: 2 })) });
                mygrainQ.piano.source = () => ({ sample: { midi: 60 }, duration: 1, buffer, offset: 0 });
                mygrainQ.sync();
                const origin = audioContext.currentTime + .15;
                if (!startDrumMachine(origin, { silent: true, skipSave: true })) throw new Error('Drums did not start');
                if (!startBastardLoopX(origin)) throw new Error('X did not start');
                if (!mygrainQ.start(origin)) throw new Error('Q did not start');
                startSequencer(origin, { force: true, silent: true, skipSave: true });
                window.perfTransport = { q: mygrainQ.origin, drums: drumMachineTransportStartTime, modulation: modulationIntervalId };
                window.perfCounts = { curves: 0, ramps: 0, fft: 0, channelReads: 0, outputReads: 0, drumRenderCalls: 0, drumMutations: 0, qMutations: 0 };
                const descriptor = Object.getOwnPropertyDescriptor(WaveShaperNode.prototype, 'curve');
                Object.defineProperty(WaveShaperNode.prototype, 'curve', { ...descriptor, set(value) { if (finalDistortionNodes.includes(this)) perfCounts.curves += 1; descriptor.set.call(this, value); } });
                const ramp = AudioParam.prototype.linearRampToValueAtTime;
                AudioParam.prototype.linearRampToValueAtTime = function (...args) { perfCounts.ramps += 1; return ramp.apply(this, args); };
                const frequency = AnalyserNode.prototype.getFloatFrequencyData;
                AnalyserNode.prototype.getFloatFrequencyData = function (...args) { perfCounts.fft += 1; return frequency.apply(this, args); };
                const time = AnalyserNode.prototype.getFloatTimeDomainData;
                AnalyserNode.prototype.getFloatTimeDomainData = function (...args) { perfCounts[this === finalPanAnalyser ? 'outputReads' : 'channelReads'] += 1; return time.apply(this, args); };
                const render = renderDrumMachineStepGrid;
                renderDrumMachineStepGrid = function (...args) { perfCounts.drumRenderCalls += 1; return render(...args); };
                if (observeMutations) for (const [selector, field] of [['#drumMachineOverlay .drum-machine-step-grid', 'drumMutations'], ['#bastardLoopQStepGrid', 'qMutations']]) {
                    for (const element of document.querySelectorAll(selector)) new MutationObserver(entries => { perfCounts[field] += entries.length; }).observe(element, { subtree: true, attributes: true, characterData: true, childList: true });
                }
            }, observeMutations);
            await page.waitForTimeout(2000);
            const session = await context.newCDPSession(page);
            await session.send('Performance.enable');
            const metrics = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(entry => [entry.name, entry.value]));
            async function measure(label) {
                await page.evaluate(() => { for (const key of Object.keys(perfCounts)) perfCounts[key] = 0; });
                const before = await metrics();
                await page.waitForTimeout(sampleSeconds * 1000);
                const after = await metrics();
                const counts = await page.evaluate(() => ({ ...perfCounts }));
                const seconds = after.Timestamp - before.Timestamp;
                return { label, seconds, mainThreadMsPerSecond: (after.TaskDuration - before.TaskDuration) * 1000 / seconds,
                    scriptMsPerSecond: (after.ScriptDuration - before.ScriptDuration) * 1000 / seconds,
                    layoutMsPerSecond: (after.LayoutDuration - before.LayoutDuration) * 1000 / seconds, counts };
            }
            const hiddenEditors = await measure('busy pattern, editors closed, initial phone viewport');
            if (!legacy) {
                assert.equal(hiddenEditors.counts.curves, 0);
                assert.equal(hiddenEditors.counts.drumMutations, 0);
                assert.equal(hiddenEditors.counts.qMutations, 0);
                assert.equal(hiddenEditors.counts.fft, 0);
            }
            await page.evaluate(() => document.getElementById(`${PERFORMANCE_MIXER_VU_CHANNELS[0].controlId}VuShell`).scrollIntoView({ block: 'center' }));
            await page.waitForTimeout(500);
            const visibleMeters = await measure('one meter group in viewport');
            assert.ok(visibleMeters.counts.channelReads > 0);
            if (!legacy) assert.ok(visibleMeters.counts.channelReads <= sampleSeconds * 20 * 5 + 10);
            await page.evaluate(() => { setPerformanceMixerVuMetersEnabled(false); });
            await page.waitForTimeout(100);
            const metersOff = await measure('meters switched off');
            assert.equal(metersOff.counts.channelReads, 0);
            const controls = await page.evaluate(async legacy => {
                const setSlider = (id, value) => { const slider = document.getElementById(id); slider.value = String(value); slider.dispatchEvent(new Event('input', { bubbles: true })); };
                const beforeCurves = perfCounts.curves;
                setSlider('finalDriveSoft', 35);
                updateEffects();
                const changedCurves = perfCounts.curves - beforeCurves;
                const depthCurve = Array.from(finalDistortionNodes[0].curve);
                fxMuted = true;
                updateEffects();
                const mutedCurve = Array.from(finalDistortionNodes[0].curve);
                fxMuted = false;
                updateEffects();
                const restoredCurve = Array.from(finalDistortionNodes[0].curve);
                if (depthCurve.every((value, index) => value === mutedCurve[index])) throw new Error('Drive mute did not change the curve');
                if (!depthCurve.every((value, index) => value === restoredCurve[index])) throw new Error('Drive did not restore');
                setSlider('finalDriveSoft', 0);
                setSlider('finalPanWidth', 100);
                setSlider('finalPanAudioDepth', 70);
                setSlider('finalPanGravity', 35);
                const beforeFft = perfCounts.fft;
                await new Promise(resolve => setTimeout(resolve, 350));
                const activeFftReads = perfCounts.fft - beforeFft;
                if (activeFftReads === 0) throw new Error('Active Pan Lab analysis stopped');
                const transportPreserved = mygrainQ.origin === perfTransport.q && drumMachineTransportStartTime === perfTransport.drums && bastardLoopXTransportActive && modulationIntervalId === perfTransport.modulation;
                if (!transportPreserved) throw new Error('A control change restarted transport or modulation');
                for (const id of ['finalPanAudioDepth', 'finalPanGravity']) setSlider(id, 0);
                openDrumMachineOverlay();
                const grid = document.getElementById('drumMachineKickGrid');
                grid.scrollIntoView({ block: 'center' });
                await new Promise(resolve => setTimeout(resolve, 250));
                const initial = grid.querySelector('.current')?.dataset.stepIndex;
                await new Promise(resolve => setTimeout(resolve, 160));
                const next = grid.querySelector('.current')?.dataset.stepIndex;
                if (initial === undefined || next === undefined || initial === next) throw new Error('Visible drum playhead did not advance');
                closeDrumMachineOverlay();
                mygrainQ.open();
                const qGrid = document.getElementById('bastardLoopQStepGrid');
                qGrid.scrollIntoView({ block: 'center' });
                await new Promise(resolve => setTimeout(resolve, 200));
                const qInitial = qGrid.querySelector('.playing')?.dataset.qStep;
                await new Promise(resolve => setTimeout(resolve, 160));
                const qNext = qGrid.querySelector('.playing')?.dataset.qStep;
                if (qInitial === undefined || qNext === undefined || qInitial === qNext) throw new Error('Visible Q playhead did not advance');
                mygrainQ.close();
                if (!legacy && changedCurves !== 1) throw new Error(`One drive edit rebuilt ${changedCurves} curves`);
                return { changedCurves, activeFftReads, transportPreserved, drumPlayhead: [initial, next], qPlayhead: [qInitial, qNext] };
            }, legacy);
            const layouts = [];
            if (!legacy) {
                for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
                    await page.setViewportSize(viewport);
                    await page.evaluate(() => { setPerformanceMixerVuMetersEnabled(true); openDrumMachineOverlay(); });
                    await page.locator('#drumMachineKickGrid').scrollIntoViewIfNeeded();
                    await page.waitForTimeout(400);
                    const visible = await page.evaluate(() => [...document.querySelectorAll('#drumMachineOverlay .drum-machine-step-grid')].filter(grid => isPerformanceElementVisible(grid)).map(grid => ({ id: grid.id, playing: Boolean(grid.querySelector('.current')) })));
                    assert.ok(visible.length > 0 && visible.every(grid => grid.playing));
                    layouts.push({ viewport, visible });
                    await page.evaluate(() => closeDrumMachineOverlay());
                }
            }
            results.push({ legacy, build, hiddenEditors, visibleMeters, metersOff, controls, layouts });
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ results, observeMutations, errors, writes }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
