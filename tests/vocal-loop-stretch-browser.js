const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');

const evidence = process.env.LOOP_V_STRETCH_EVIDENCE;
if (!evidence || !path.isAbsolute(evidence)) throw new Error('Set LOOP_V_STRETCH_EVIDENCE to the isolated verification directory.');
const configuration = JSON.parse(fs.readFileSync(path.join(evidence, 'private/connection.json')));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(configuration.origin)) throw new Error('Use an isolated localhost test server.');
const engineName = process.env.LOOP_V_ENGINE || 'chromium';
const results = { engine: engineName, isolated: true, productionWrites: false, errors: [], baselineErrors: [], audio: [], viewports: [] };

(async () => {
    const engine = engineName === 'webkit' ? webkit : chromium;
    const browser = await engine.launch(engineName === 'webkit' ? { headless: true } : { executablePath: '/snap/chromium/current/usr/lib/chromium-browser/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
        await context.addCookies([{ name: configuration.cookieName, value: configuration.token, url: configuration.origin, httpOnly: true, sameSite: 'Lax' }]);
        if (engineName === 'webkit') {
            const baseline = await context.newPage();
            baseline.on('pageerror', error => results.baselineErrors.push(error.message));
            await baseline.route(configuration.origin + '/mygrain/', route => route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(evidence, 'before/index.html'), 'utf8') }));
            await baseline.route('**/mygrain/vocal-loop-cut.js?*', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(evidence, 'before/vocal-loop-cut.js'), 'utf8') }));
            await baseline.goto(configuration.origin + '/mygrain/', { waitUntil: 'load' });
            await baseline.waitForFunction(() => window.mygrainRadiolab);
            await baseline.close();
        }
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        page.on('pageerror', error => results.errors.push(error.message));
        await page.route('https://openclaw.blackcarburning.com/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
        await page.goto(configuration.origin + '/mygrain/', { waitUntil: 'load' });
        await page.locator('#start-btn').tap();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        results.setup = await page.evaluate(async () => {
            stopAllPerformancePlayback({ silent: true });
            setFxMuted(true, { silent: true });
            syncPatternLengthControls(16, { skipSave: true });
            applyGlobalBpm(240);
            const buffer = audioContext.createBuffer(2, audioContext.sampleRate, audioContext.sampleRate);
            for (let channel = 0; channel < 2; channel += 1) {
                const samples = buffer.getChannelData(channel);
                for (let frame = 0; frame < samples.length; frame += 1) samples[frame] = (.17 + channel * .04) * Math.sin(2 * Math.PI * (220 + channel * 110) * frame / buffer.sampleRate);
            }
            window.stretchOriginal = buffer;
            window.stretchOriginalSamples = Array.from({ length: 2 }, (unused, channel) => Array.from(buffer.getChannelData(channel)));
            await applyLoadedBastardLoopVBuffer(buffer, 'stretch-fixture.wav', { bpm: 240, durationSeconds: 1, patternSteps: 16, sourceLabel: 'SAMPLES_VOCAL' });
            setBastardLoopVEnabled(true, { silent: true, skipSave: true });
            setSliderValue('performanceBastardLoopVLevel', 70);
            setBastardLoopVPitchOctaves(0, { skipSave: true });
            setBastardLoopVReverse(false, { skipSave: true });
            setBastardLoopVCut({ enabled: true, start: .375, end: .625, fromStart: false, repeat: false }, { skipSave: true });
            bastardLoopVCutEditor.open();
            return { sampleRate: audioContext.sampleRate, originalLength: buffer.length };
        });
        const stretchButton = page.locator('#bastardLoopVCutStretch');
        assert.equal(await stretchButton.getAttribute('aria-pressed'), 'false');
        await stretchButton.tap();
        assert.equal(await stretchButton.getAttribute('aria-pressed'), 'true');
        const bounds = async () => page.evaluate(() => {
            const timeline = document.getElementById('bastardLoopVCutTimeline').getBoundingClientRect();
            return { start: Number.parseFloat(document.getElementById('bastardLoopVCutStart').style.left) / 100, end: Number.parseFloat(document.getElementById('bastardLoopVCutEnd').style.left) / 100, timeline: { x: timeline.x, y: timeline.y, width: timeline.width, height: timeline.height }, source: [bastardLoopVCut.start, bastardLoopVCut.end] };
        });
        const expectBounds = async (start, end) => {
            const current = await bounds();
            assert.ok(Math.abs(current.start - start) < .002, JSON.stringify(current));
            assert.ok(Math.abs(current.end - end) < .002, JSON.stringify(current));
            assert.deepEqual(current.source, [.375, .625]);
        };
        const dragRegion = async destination => {
            await page.locator('#bastardLoopVCutWaveform').scrollIntoViewIfNeeded();
            const current = await bounds();
            const center = (current.start + current.end) / 2;
            const vertical = current.timeline.y + current.timeline.height * .5;
            await page.mouse.move(current.timeline.x + center * current.timeline.width, vertical);
            await page.mouse.down();
            await page.mouse.move(current.timeline.x + (destination + (current.end - current.start) / 2) * current.timeline.width, vertical, { steps: 12 });
            await page.mouse.up();
        };
        const dragEnd = async destination => {
            await page.locator('#bastardLoopVCutEnd').scrollIntoViewIfNeeded();
            const handle = await page.locator('#bastardLoopVCutEnd').boundingBox();
            const current = await bounds();
            await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
            await page.mouse.down();
            await page.mouse.move(current.timeline.x + destination * current.timeline.width, handle.y + handle.height / 2, { steps: 14 });
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await page.mouse.up();
        };
        const audio = async (label, start, end, repeat) => {
            const measured = await page.evaluate(async ({ label, start, end, repeat }) => {
                const buffer = getBastardLoopVPlaybackBuffer();
                const offline = new OfflineAudioContext(2, buffer.length, buffer.sampleRate);
                const source = offline.createBufferSource();
                source.buffer = buffer;
                source.connect(offline.destination);
                source.start();
                const rendered = await offline.startRendering();
                const part = { id: 'stretch-proof', bpm: 240, patternSteps: 16, repeats: 1 };
                const exported = await MygrainSongExport.wav([part], new Map([[part.id, rendered]]), buffer.sampleRate);
                const wav = await audioContext.decodeAudioData(await exported.blob.arrayBuffer());
                const frequencies = [];
                let silentMismatch = 0;
                let peak = 0;
                for (let channel = 0; channel < 2; channel += 1) {
                    const samples = rendered.getChannelData(channel);
                    const first = Math.round(start * buffer.sampleRate);
                    const last = Math.round(end * buffer.sampleRate);
                    for (let frame = 0; frame < samples.length; frame += 1) {
                        if ((frame < first || (!repeat && frame >= last)) && Math.abs(samples[frame]) > 1e-6) silentMismatch += 1;
                        peak = Math.max(peak, Math.abs(samples[frame]));
                    }
                    const skip = Math.min(Math.round(.012 * buffer.sampleRate), Math.floor((last - first) / 8));
                    const segment = samples.slice(first + skip, last - skip);
                    let bestFrequency = 0;
                    let bestPower = 0;
                    for (let frequency = 100; frequency <= 700; frequency += 1) {
                        let real = 0;
                        let imaginary = 0;
                        for (let frame = 0; frame < segment.length; frame += 3) {
                            const weight = .5 - .5 * Math.cos(2 * Math.PI * frame / (segment.length - 1));
                            const phase = 2 * Math.PI * frequency * frame / buffer.sampleRate;
                            real += segment[frame] * weight * Math.cos(phase);
                            imaginary += segment[frame] * weight * Math.sin(phase);
                        }
                        const power = real * real + imaginary * imaginary;
                        if (power > bestPower) { bestPower = power; bestFrequency = frequency; }
                    }
                    frequencies.push(bestFrequency);
                }
                const preserved = bastardLoopVBuffer === stretchOriginal && stretchOriginalSamples.every((samples, channel) => samples.every((value, frame) => value === bastardLoopVBuffer.getChannelData(channel)[frame]));
                return { label, duration: rendered.duration, wavDuration: wav.duration, frequencies, silentMismatch, peak, preserved, cut: { ...bastardLoopVCut } };
            }, { label, start, end, repeat });
            assert.equal(measured.duration, 1);
            assert.equal(measured.wavDuration, 1);
            assert.equal(measured.silentMismatch, 0);
            assert.equal(measured.preserved, true);
            assert.ok(measured.peak > .02 && measured.peak < .5, JSON.stringify(measured));
            assert.ok(Math.abs(measured.frequencies[0] - 220) <= 6, JSON.stringify(measured));
            assert.ok(Math.abs(measured.frequencies[1] - 330) <= 6, JSON.stringify(measured));
            results.audio.push(measured);
        };
        await expectBounds(.375, .625);
        await dragRegion(0);
        await expectBounds(0, .25);
        assert.match(await page.locator('#bastardLoopVCutStart').getAttribute('aria-valuetext'), /^0\.000 seconds, 0\.00 sixteenths/);
        assert.match(await page.locator('#bastardLoopVCutEnd').getAttribute('aria-valuetext'), /^0\.250 seconds, 4\.00 sixteenths/);
        await audio('middle moved to loop start once', 0, .25, false);
        await dragEnd(.5);
        await expectBounds(0, .5);
        await audio('twice as long without repitch', 0, .5, false);
        await dragEnd(.125);
        await expectBounds(0, .125);
        await audio('half as long without repitch', 0, .125, false);
        await page.locator('#bastardLoopVCutRepeat').tap();
        await audio('shortened selection repeats', 0, .125, true);
        await page.locator('#bastardLoopVCutRepeat').tap();
        await dragRegion(.5);
        await expectBounds(.5, .625);
        await audio('shortened selection moved later', .5, .625, false);
        await page.locator('#bastardLoopVCutFromStart').tap();
        await expectBounds(0, .125);
        assert.equal(await page.evaluate(() => bastardLoopVCut.fromStart), true);
        await dragRegion(.25);
        await expectBounds(.25, .375);
        assert.equal(await page.evaluate(() => bastardLoopVCut.fromStart), false);
        await page.locator('#bastardLoopVCutEnd').focus();
        await page.keyboard.press('ArrowRight');
        await expectBounds(.25, .4375);
        await page.locator('#bastardLoopVCutStart').focus();
        await page.keyboard.press('ArrowLeft');
        await expectBounds(.1875, .375);
        await page.locator('#bastardLoopVCutAuditionMetro').tap();
        await page.waitForFunction(() => bastardLoopVCutPreview && bastardLoopVSource);
        await page.evaluate(() => {
            window.stretchPreviewProof = { previews: 0, generatedDuringPreview: 0, generatedWhileDragging: 0, sourceChangesDuringPreview: 0, origin: bastardLoopVCutPreview.origin };
            window.stretchOriginalSet = bastardLoopVCutEditor.adapter.set;
            window.stretchOriginalCreateBuffer = audioContext.createBuffer;
            window.stretchCreatedBuffers = 0;
            audioContext.createBuffer = function (...argumentsList) {
                stretchCreatedBuffers += 1;
                if (bastardLoopVCutEditor.drag) stretchPreviewProof.generatedWhileDragging += 1;
                return stretchOriginalCreateBuffer.apply(this, argumentsList);
            };
            bastardLoopVCutEditor.adapter.set = (settings, options) => {
                const buffersBefore = stretchCreatedBuffers;
                const sourceBefore = bastardLoopVSource;
                stretchOriginalSet(settings, options);
                if (options?.preview) {
                    stretchPreviewProof.previews += 1;
                    stretchPreviewProof.generatedDuringPreview += stretchCreatedBuffers - buffersBefore;
                    stretchPreviewProof.sourceChangesDuringPreview += Number(sourceBefore !== bastardLoopVSource);
                }
            };
        });
        await dragEnd(.5);
        results.liveAudition = await page.evaluate(() => {
            const proof = { ...stretchPreviewProof, originPreserved: bastardLoopVCutPreview.origin === stretchPreviewProof.origin, committedBuffers: stretchCreatedBuffers };
            bastardLoopVCutEditor.adapter.set = stretchOriginalSet;
            audioContext.createBuffer = stretchOriginalCreateBuffer;
            stopBastardLoopVCutAudition();
            return proof;
        });
        assert.ok(results.liveAudition.previews >= 5);
        assert.equal(results.liveAudition.generatedDuringPreview, 0);
        assert.equal(results.liveAudition.generatedWhileDragging, 0);
        assert.equal(results.liveAudition.sourceChangesDuringPreview, 0);
        assert.equal(results.liveAudition.originPreserved, true);
        assert.ok(results.liveAudition.committedBuffers >= 1);
        results.persistence = await page.evaluate(async () => {
            const settings = { ...bastardLoopVCut };
            const preset = gatherPreset();
            setBastardLoopVCut(undefined, { skipSave: true });
            applyPreset(preset);
            const presetRestored = JSON.stringify(bastardLoopVCut) === JSON.stringify(settings);
            const captured = await mygrainSongBetaAdapter.capture();
            const decoded = await mygrainSongBetaAdapter.decode(await captured.arrayBuffer(), { buffers: new Map(), pending: new Map(), bytes: 0 });
            setBastardLoopVCut(undefined, { skipSave: true });
            await mygrainSongBetaAdapter.recall(decoded, { start: false });
            const songRestored = JSON.stringify(bastardLoopVCut) === JSON.stringify(settings);
            return { presetRestored, songRestored, settings };
        });
        assert.equal(results.persistence.presetRestored, true);
        assert.equal(results.persistence.songRestored, true);
        await page.evaluate(() => bastardLoopVCutEditor.open());
        for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            await stretchButton.scrollIntoViewIfNeeded();
            const layout = await page.evaluate(() => {
                const button = document.getElementById('bastardLoopVCutStretch');
                const rectangle = button.getBoundingClientRect();
                const hit = document.elementFromPoint(rectangle.x + rectangle.width / 2, rectangle.y + rectangle.height / 2);
                const shell = document.querySelector('.vocal-cut-shell');
                return { overflow: document.documentElement.scrollWidth > innerWidth + 1, shellOverflow: shell.scrollWidth > shell.clientWidth + 1, hit: hit === button || button.contains(hit), buttonWidth: rectangle.width, buttonHeight: rectangle.height };
            });
            assert.equal(layout.overflow, false);
            assert.equal(layout.shellOverflow, false);
            assert.equal(layout.hit, true);
            assert.ok(layout.buttonWidth >= 44 && layout.buttonHeight >= 40);
            await page.locator('#bastardLoopVCutWaveform').scrollIntoViewIfNeeded();
            const initial = await bounds();
            await dragRegion(.0625);
            await expectBounds(.0625, .0625 + initial.end - initial.start);
            await page.screenshot({ path: path.join(evidence, `${engineName}-${viewport.width}x${viewport.height}.png`) });
            results.viewports.push({ ...viewport, ...layout });
        }
        if (engineName === 'chromium') {
            await page.setViewportSize({ width: 390, height: 844 });
            await page.locator('#bastardLoopVCutWaveform').scrollIntoViewIfNeeded();
            const current = await bounds();
            const center = (current.start + current.end) / 2;
            const vertical = current.timeline.y + current.timeline.height / 2;
            await page.evaluate(() => {
                document.getElementById('bastardLoopVCutWaveform').parentElement.addEventListener('pointerdown', event => { window.stretchPointerType = event.pointerType; }, { once: true });
            });
            const session = await context.newCDPSession(page);
            const start = current.timeline.x + center * current.timeline.width;
            const finish = current.timeline.x + (.25 + (current.end - current.start) / 2) * current.timeline.width;
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y: vertical }] });
            for (let step = 1; step <= 12; step += 1) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start + (finish - start) * step / 12, y: vertical }] });
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await expectBounds(.25, .25 + current.end - current.start);
            const handle = await page.locator('#bastardLoopVCutEnd').boundingBox();
            const endStart = handle.x + handle.width / 2;
            const endFinish = current.timeline.x + .75 * current.timeline.width;
            const endVertical = handle.y + handle.height / 2;
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: endStart, y: endVertical }] });
            for (let step = 1; step <= 12; step += 1) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: endStart + (endFinish - endStart) * step / 12, y: endVertical }] });
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await session.detach();
            await expectBounds(.25, .75);
            results.touch = { pointerType: await page.evaluate(() => stretchPointerType), moved: true, endResized: true };
            assert.equal(results.touch.pointerType, 'touch');
        }
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.locator('#bastardLoopVCutReset').tap();
        await page.waitForFunction(() => !bastardLoopVCut.stretch && !bastardLoopVCut.enabled);
        assert.equal(await stretchButton.getAttribute('aria-pressed'), 'false');
        assert.equal(await page.evaluate(() => bastardLoopVCut.enabled), false);
        assert.equal(await page.evaluate(() => getBastardLoopVPlaybackBuffer() === bastardLoopVBuffer), true);
        assert.deepEqual(results.errors.filter(error => !results.baselineErrors.includes(error)), []);
        fs.writeFileSync(path.join(evidence, `browser-${engineName}.json`), JSON.stringify(results, null, 2));
        console.log(JSON.stringify(results, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { fs.writeFileSync(path.join(evidence, `browser-${engineName}-failure.json`), JSON.stringify({ ...results, failure: error.stack }, null, 2)); console.error(error); process.exitCode = 1; });
