const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost song test server.');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://openclaw.blackcarburning.com/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        await page.evaluate(() => {
            syncPatternLengthControls(16, { skipSave: true });
            setGeneratedLoopTransportEnabled(false, { silent: true, skipSave: true });
            setOscillatorsEnabled(false, { silent: true, skipSave: true });
            setGranularLayersEnabled(false, { silent: true, skipSave: true });
            setArpeggiatorEnabled(false);
            setDrumMachineEnabled(false, { silent: true, skipSave: true });
            setDropboxSampleLayerEnabled(false, { silent: true, skipSave: true });
            setFxMuted(true, { silent: true });
            seqGrainsEnabled = false;
            document.getElementById('seqGrainsEnabled').checked = false;
            applyGlobalBpm(300);
            window.cutTestTone = () => {
                const buffer = audioContext.createBuffer(1, Math.round(audioContext.sampleRate * .8), audioContext.sampleRate);
                const samples = buffer.getChannelData(0);
                for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(2 * Math.PI * 220 * index / audioContext.sampleRate) * (.15 + .12 * Math.sin(2 * Math.PI * index / samples.length));
                return buffer;
            };
            bastardLoopVBuffer = cutTestTone();
            bastardLoopVSourceBpm = 300;
            bastardLoopVMetadata = { durationSeconds: .8, label: 'Vocal cut fixture' };
            setBastardLoopVPitchOctaves(0, { skipSave: true });
            setBastardLoopVReverse(false, { skipSave: true });
            setBastardLoopShiftSteps('V', 0, { skipSave: true });
            setBastardLoopVEnabled(true, { skipSave: true, silent: true });
            document.getElementById('performanceBastardLoopVLevel').value = '75';
            bastardLoopVLevel = .75;
            performanceSourceLayerSolo = [];
            for (const setter of [setBastardLoopEnabled, setBastardLoop2Enabled, setBastardLoop3Enabled, setBastardLoopPEnabled, setBastardLoopOEnabled, setBastardLoopLEnabled, setBastardLoopXEnabled, setBastardLoopMEnabled]) setter(false, { skipSave: true, silent: true });
            setBastardLoopVCut(undefined, { skipSave: true });
            window.cutOriginalSamples = Array.from(bastardLoopVBuffer.getChannelData(0));
            syncBastardLoopVUi();
            window.cutSourceStarts = [];
            const create = audioContext.createBufferSource.bind(audioContext);
            audioContext.createBufferSource = () => {
                const source = create();
                const start = source.start.bind(source);
                source.start = (...args) => { cutSourceStarts.push({ time: args[0], offset: args[1] || 0, loopEnd: source.loopEnd, duration: source.buffer.duration }); start(...args); };
                return source;
            };
            window.cutMetroStarts = [];
            const metro = playKeyboardRepositoryMetronomeClick;
            playKeyboardRepositoryMetronomeClick = (...args) => { cutMetroStarts.push(args[0]); return metro(...args); };
        });
        await page.click('#performanceBastardLoopVCutBtn');
        assert.equal(await page.locator('#bastardLoopVCutOverlay').isVisible(), true);
        assert.equal(await page.locator('#bastardLoopVCutGrid option').count(), 17);
        assert.equal(await page.locator('#bastardLoopVCutFromStart').getAttribute('aria-pressed'), 'false');
        assert.equal(await page.evaluate(() => bastardLoopVCut.fromStart), false);
        const canvas = await page.evaluate(() => {
            const waveform = document.getElementById('bastardLoopVCutWaveform');
            const pixels = waveform.getContext('2d').getImageData(0, 0, waveform.width, waveform.height).data;
            let cyan = 0;
            for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 1] > 130 && pixels[index + 2] > 140 && pixels[index + 2] > pixels[index] * 1.5) cyan += 1;
            return cyan;
        });
        assert.ok(canvas > 100);
        const drag = async (boundary, fraction) => {
            await page.locator('#bastardLoopVCutTimeline').scrollIntoViewIfNeeded();
            const handle = await page.locator(boundary === 'start' ? '#bastardLoopVCutStart' : '#bastardLoopVCutEnd').boundingBox();
            const timeline = await page.locator('#bastardLoopVCutTimeline').boundingBox();
            await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
            await page.mouse.down();
            await page.mouse.move(timeline.x + timeline.width * fraction, handle.y + handle.height / 2, { steps: 8 });
            await page.mouse.up();
        };
        await drag('start', .37);
        await drag('end', .51);
        assert.deepEqual(await page.evaluate(() => [bastardLoopVCut.start, bastardLoopVCut.end]), [6 / 16, 8 / 16]);
        const gated = await page.evaluate(() => {
            const buffer = getBastardLoopVPlaybackBuffer();
            const samples = buffer.getChannelData(0);
            const start = Math.round(samples.length * 6 / 16);
            const end = Math.round(samples.length * 8 / 16);
            return { duration: buffer.duration, original: cutOriginalSamples.every((value, index) => value === bastardLoopVBuffer.getChannelData(0)[index]), before: samples.slice(0, start).some(value => value !== 0), after: samples.slice(end).some(value => value !== 0), selected: samples.slice(start, end).some(value => Math.abs(value) > .01) };
        });
        assert.equal(gated.duration, .8);
        assert.equal(gated.original, true);
        assert.equal(gated.before, false);
        assert.equal(gated.after, false);
        assert.equal(gated.selected, true);
        for (const fromStart of [false, true]) {
            for (const repeat of [false, true]) {
                if (await page.evaluate(() => bastardLoopVCut.fromStart) !== fromStart) {
                    await page.locator('#bastardLoopVCutFromStart').focus();
                    await page.keyboard.press('Space');
                }
                if (await page.evaluate(() => bastardLoopVCut.repeat) !== repeat) await page.click('#bastardLoopVCutRepeat');
                assert.equal(await page.locator('#bastardLoopVCutFromStart').getAttribute('aria-pressed'), String(fromStart));
                const playback = await page.evaluate(async () => {
                    const buffer = getBastardLoopVPlaybackBuffer();
                    const offline = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
                    const source = offline.createBufferSource();
                    source.buffer = buffer;
                    source.connect(offline.destination);
                    source.start(0);
                    const rendered = await offline.startRendering();
                    const samples = rendered.getChannelData(0);
                    const audible = (start, end) => samples.slice(Math.round(start * buffer.sampleRate), Math.round(end * buffer.sampleRate)).some(value => Math.abs(value) > .001);
                    await auditionBastardLoopVCut('metronome');
                    const liveMatches = bastardLoopVSource.buffer === buffer;
                    stopBastardLoopVCutAudition();
                    return {
                        duration: rendered.duration,
                        windows: [audible(.02, .08), audible(.325, .375), audible(.6, .68)],
                        offlineMatches: samples.every((value, index) => Math.abs(value - buffer.getChannelData(0)[index]) < .000001),
                        liveMatches,
                        original: cutOriginalSamples.every((value, index) => value === bastardLoopVBuffer.getChannelData(0)[index]),
                        range: [bastardLoopVCut.start, bastardLoopVCut.end],
                        status: document.getElementById('bastardLoopVCutRange').textContent
                    };
                });
                assert.equal(playback.duration, .8);
                assert.deepEqual(playback.windows, fromStart ? [true, repeat, repeat] : [false, true, repeat]);
                assert.equal(playback.offlineMatches, true);
                assert.equal(playback.liveMatches, true);
                assert.equal(playback.original, true);
                assert.deepEqual(playback.range, [6 / 16, 8 / 16]);
                assert.ok(playback.status.includes(`plays at ${fromStart ? '0.000' : '0.300'}s`));
            }
        }
        await page.click('#bastardLoopVCutFromStart');
        await page.click('#bastardLoopVCutRepeat');
        await page.evaluate(() => { cutSourceStarts.length = 0; cutMetroStarts.length = 0; });
        console.log('PASS: All four placement/repeat combinations through UI, live source and OfflineAudioContext; source PCM and timing unchanged.');
        await page.selectOption('#bastardLoopVCutGrid', String(1 / 32));
        await page.locator('#bastardLoopVCutStart').focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.evaluate(() => bastardLoopVCut.start), 13 / 32);
        await page.uncheck('#bastardLoopVCutSnap');
        await page.fill('#bastardLoopVCutStartSeconds', '.313');
        await page.locator('#bastardLoopVCutStartSeconds').press('Tab');
        assert.ok(Math.abs(await page.evaluate(() => bastardLoopVCut.start * .8) - .313) < .0001);
        await page.check('#bastardLoopVCutSnap');
        await page.selectOption('#bastardLoopVCutGrid', String(1 / 16));
        await drag('start', 6 / 16);
        await page.click('#bastardLoopVCutAuditionMetro');
        await page.waitForFunction(() => isBastardLoopVCutPreviewRunning() && cutMetroStarts.length >= 2);
        const metro = await page.evaluate(() => ({ origin: bastardLoopVCutPreview.origin, starts: cutSourceStarts, metro: cutMetroStarts, onlyV: Boolean(bastardLoopVSource && !bastardLoopPlaying && !bastardLoopSource && !isBastardLoopLRunning() && !isBastardLoopXRunning()), playing: !document.getElementById('performanceMainStopAllBtn').disabled }));
        assert.equal(metro.onlyV, true);
        assert.equal(metro.playing, true);
        assert.equal(metro.starts.at(-1).time, metro.origin);
        assert.equal(metro.starts.at(-1).offset, 0);
        assert.equal(metro.metro[0], metro.origin);
        assert.ok(Math.abs(metro.metro[1] - metro.metro[0] - .2) < .000001);
        await page.waitForTimeout(350);
        await drag('end', 10 / 16);
        const changed = await page.evaluate(() => ({ origin: bastardLoopVCutPreview.origin, last: cutSourceStarts.at(-1), current: audioContext.currentTime, nodes: bastardLoopVCutMetronomeNodes.size }));
        assert.equal(changed.origin, metro.origin);
        assert.ok(changed.last.offset > .01);
        assert.equal(changed.last.loopEnd, .8);
        assert.ok(changed.nodes <= 3);
        await page.click('#bastardLoopVCutStop');
        assert.equal(await page.evaluate(() => Boolean(bastardLoopVCutPreview || bastardLoopVSource || bastardLoopVCutMetronomeNodes.size)), false);
        const metroCount = await page.evaluate(() => cutMetroStarts.length);
        await page.waitForTimeout(300);
        assert.equal(await page.evaluate(() => cutMetroStarts.length), metroCount);
        console.log('PASS: Waveform, snap, continuous fields, original PCM, full duration, phase-preserving cut edits and metronome start/stop.');

        await page.evaluate(() => {
            bastardLoopBuffer = cutTestTone();
            bastardLoopSourceBpm = 300;
            setBastardLoopEnabled(true, { silent: true, skipSave: true });
            cutSourceStarts.length = 0;
        });
        await page.click('#bastardLoopVCutAuditionLoops');
        await page.waitForFunction(() => bastardLoopPlaying && bastardLoopSource && bastardLoopVSource);
        const together = await page.evaluate(() => ({ origin: bastardLoopVCutPreview.origin, starts: cutSourceStarts, mode: bastardLoopVCutPreview.mode }));
        assert.equal(together.mode, 'loops');
        assert.ok(together.starts.length >= 2);
        assert.ok(together.starts.every(source => source.time === together.origin && source.offset === 0));
        await page.click('#bastardLoopVCutClose');
        assert.equal(await page.evaluate(() => Boolean(bastardLoopPlaying || bastardLoopVSource || bastardLoopSource || bastardLoopVCutPreview)), false);
        console.log('PASS: Bastardloops and vocal audition start together; closing stops the audition.');

        for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            await page.locator('#performanceBastardLoopVCutBtn').tap();
            const geometry = await page.evaluate(() => {
                const shell = document.querySelector('#bastardLoopVCutOverlay .vocal-cut-shell');
                const canvas = document.getElementById('bastardLoopVCutWaveform');
                return { width: shell.clientWidth, scroll: shell.scrollWidth, canvas: canvas.clientWidth };
            });
            assert.ok(geometry.scroll <= geometry.width + 1);
            assert.ok(geometry.canvas > 150);
            await page.locator('#bastardLoopVCutFromStart').tap();
            assert.equal(await page.locator('#bastardLoopVCutFromStart').getAttribute('aria-pressed'), 'true');
            await page.locator('#bastardLoopVCutFromStart').tap();
            await page.selectOption('#bastardLoopVCutGrid', String(1 / 16));
            await drag('start', 5 / 16);
            assert.equal(await page.evaluate(() => bastardLoopVCut.start), 5 / 16);
            await page.locator('#bastardLoopVCutClose').tap();
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#performanceBastardLoopVCutBtn').tap();
        const touch = await page.context().newCDPSession(page);
        await page.locator('#bastardLoopVCutTimeline').scrollIntoViewIfNeeded();
        const handle = await page.locator('#bastardLoopVCutStart').boundingBox();
        const timeline = await page.locator('#bastardLoopVCutTimeline').boundingBox();
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: timeline.x + timeline.width * 4 / 16, y: handle.y + handle.height / 2 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.equal(await page.evaluate(() => bastardLoopVCut.start), 4 / 16);
        await touch.detach();
        assert.equal(await page.evaluate(() => {
            const close = document.getElementById('bastardLoopVCutClose');
            const rect = close.getBoundingClientRect();
            return close.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }), true);
        await page.screenshot({ path: '/tmp/mygrain-vocal-cut-mobile.png' });
        await page.click('#bastardLoopVCutClose');
        console.log('PASS: Mobile, narrow-screen and landscape layout, drag/touch controls.');

        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.evaluate(async () => {
            setBastardLoopEnabled(false, { silent: true, skipSave: true });
            const controller = mygrainSongBeta;
            const song = (await controller.request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Vocal cut writing fixture' }) })).song;
            controller.acceptSong(song);
            for (const [name, range] of [['Middle', [6 / 16, 8 / 16]], ['Last eighth cut', [0, 14 / 16]]]) {
                setBastardLoopVCut({ enabled: true, start: range[0], end: range[1], snap: true, grid: 1 / 16 });
                const body = await mygrainSongBetaAdapter.capture();
                const snapshot = mygrainSongBetaAdapter.inspectPart(await body.arrayBuffer()).snapshot;
                if (snapshot.extra.controls.some(control => control.id.startsWith('bastardLoopVCut'))) throw new Error('Transient editor controls were captured');
                controller.acceptSong((await controller.request(`/${song.id}/parts?name=${encodeURIComponent(name)}&repeats=1`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body })).song);
            }
            window.cutSongId = song.id;
            controller.render();
        });
        await page.click('#songBetaArm');
        await page.waitForFunction(() => mygrainSongBeta.armed && !mygrainSongBeta.busy, undefined, { timeout: 60000 });
        const renders = await page.evaluate(() => {
            const controller = mygrainSongBeta;
            const first = controller.renders.get(controller.song.parts[0].id);
            const samples = first.getChannelData(0);
            const rms = (start, end) => Math.sqrt(samples.slice(Math.round(start * first.sampleRate), Math.round(end * first.sampleRate)).reduce((sum, value) => sum + value * value, 0) / ((end - start) * first.sampleRate));
            return { parts: controller.song.parts, duration: first.duration, before: rms(.05, .2), inside: rms(.325, .375), after: rms(.5, .7) };
        });
        assert.ok(renders.parts.every(part => part.render.vocalCutVersion === 1));
        assert.ok(Math.abs(renders.duration - .8) < .001);
        console.log('Rendered vocal RMS', renders.before, renders.inside, renders.after);
        assert.ok(renders.inside > .0001);
        assert.ok(renders.before < renders.inside / 20);
        assert.ok(renders.after < renders.inside / 20);
        await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            await controller.recall(controller.song.parts[0], { start: false });
        });
        assert.deepEqual(await page.evaluate(() => [bastardLoopVCut.enabled, bastardLoopVCut.start, bastardLoopVCut.end]), [true, 6 / 16, 8 / 16]);
        assert.equal(await page.evaluate(() => bastardLoopVBuffer.duration), .8);
        assert.equal(await page.evaluate(() => Boolean(bastardLoopVSource || bastardLoopVCutPreview)), false);
        const legacy = await page.evaluate(async () => {
            const body = await mygrainSongBetaAdapter.capture();
            const decoded = await mygrainSongBetaAdapter.decode(await body.arrayBuffer(), { buffers: new Map(), pending: new Map(), bytes: 0 });
            delete decoded.snapshot.state.modes.bastardLoopVCut;
            mygrainSongBetaAdapter.recall(decoded, { start: false });
            return bastardLoopVCut;
        });
        assert.equal(legacy.enabled, false);
        assert.equal(legacy.start, 0);
        assert.equal(legacy.end, 1);
        await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            await controller.recall(controller.song.parts[1], { start: false });
            await controller.reusePart(controller.song.parts[0]);
            controller.render();
        });
        assert.equal(await page.evaluate(() => bastardLoopVCut.end), 14 / 16);
        await page.evaluate(async () => { await mygrainSongBeta.loopPart(mygrainSongBeta.song.parts[0].id); });
        await page.waitForTimeout(1800);
        assert.equal(await page.evaluate(() => mygrainSongBeta.playing), true);
        await page.click('#songBetaStop');
        await page.evaluate(async () => {
            const result = await MygrainSongExport.wav(mygrainSongBeta.song.parts, mygrainSongBeta.renders, audioContext.sampleRate);
            window.cutExportBuffer = await audioContext.decodeAudioData(await result.blob.arrayBuffer());
        });
        assert.ok(Math.abs(await page.evaluate(() => cutExportBuffer.duration) - 2.4) < .001);
        const exportWindows = await page.evaluate(() => {
            const samples = cutExportBuffer.getChannelData(0);
            const audible = (start, end) => samples.slice(Math.round(start * cutExportBuffer.sampleRate), Math.round(end * cutExportBuffer.sampleRate)).some(value => Math.abs(value) > .001);
            return [audible(.05, .2), audible(.325, .375), audible(.5, .7), audible(1.65, 1.8), audible(1.925, 1.975), audible(2.1, 2.3)];
        });
        assert.deepEqual(exportWindows, [false, true, false, false, true, false]);
        const songId = await page.evaluate(() => mygrainSongBeta.song.id);
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.id), songId);
        assert.deepEqual(await page.evaluate(() => [bastardLoopVCut.enabled, bastardLoopVCut.start, bastardLoopVCut.end]), [true, 0, 14 / 16]);
        await page.evaluate(async () => { await mygrainSongBeta.recall(mygrainSongBeta.song.parts[0], { start: false }); });
        assert.deepEqual(await page.evaluate(() => [bastardLoopVCut.enabled, bastardLoopVCut.start, bastardLoopVCut.end]), [true, 6 / 16, 8 / 16]);
        const amendment = await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            const original = controller.song.parts[0];
            const otherRender = controller.song.parts[1].render.sha256;
            const decoded = await controller.loadPart(original, controller.generation);
            const sourceWav = audioBufferToWav(decoded.buffers.get('bastardV'));
            const digest = async body => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', body)), value => value.toString(16).padStart(2, '0')).join('');
            const hash = await digest(sourceWav);
            await controller.amendPart(original);
            setBastardLoopVCut({ enabled: true, start: 7 / 16, end: 9 / 16, snap: true, grid: 1 / 16 });
            await controller.savePart();
            const shared = controller.song.parts.filter(part => (part.sourcePartId || part.id) === original.id);
            const originalStillFull = bastardLoopVBuffer.duration;
            const unchangedPcm = await digest(audioBufferToWav(bastardLoopVBuffer));
            return { shared: shared.length, allInvalidated: shared.every(part => !part.render), unrelatedPreserved: controller.song.parts[1].render.sha256 === otherRender, originalStillFull, samePcm: unchangedPcm === hash };
        });
        assert.deepEqual(amendment, { shared: 2, allInvalidated: true, unrelatedPreserved: true, originalStillFull: .8, samePcm: true });
        await page.click('#songBetaArm');
        await page.waitForFunction(() => mygrainSongBeta.armed && !mygrainSongBeta.busy, undefined, { timeout: 60000 });
        await page.evaluate(async () => { await mygrainSongBeta.recall(mygrainSongBeta.song.parts[2], { start: false }); });
        assert.deepEqual(await page.evaluate(() => [bastardLoopVCut.start, bastardLoopVCut.end]), [7 / 16, 9 / 16]);
        await page.evaluate(() => { mygrainSongBeta.loopSong = true; });
        await page.click('#songBetaPlay');
        await page.waitForFunction(() => mygrainSongBeta.playing && !mygrainSongBeta.busy);
        await page.waitForTimeout(2600);
        assert.equal(await page.evaluate(() => mygrainSongBeta.playing), true);
        await page.click('#songBetaStop');
        const preset = await page.evaluate(() => {
            const saved = gatherPreset();
            const legacy = structuredClone(saved);
            delete legacy.bastardLoopVCut;
            applyPreset(legacy);
            const oldCutOff = !bastardLoopVCut.enabled && bastardLoopVCut.start === 0 && bastardLoopVCut.end === 1;
            applyPreset(saved);
            return { oldCutOff, restored: [bastardLoopVCut.enabled, bastardLoopVCut.start, bastardLoopVCut.end] };
        });
        assert.deepEqual(preset, { oldCutOff: true, restored: [true, 7 / 16, 9 / 16] });
        const fromStartState = await page.evaluate(async () => {
            setBastardLoopVCut({ enabled: true, start: 6 / 16, end: 8 / 16, fromStart: true, repeat: true });
            const saved = gatherPreset();
            const state = saveState({ force: true, snapshotOnly: true });
            const legacy = structuredClone(saved);
            delete legacy.bastardLoopVCut.fromStart;
            applyPreset(legacy);
            const legacyOff = bastardLoopVCut.fromStart === false;
            applyPreset(saved);
            const restored = bastardLoopVCut.fromStart === true && bastardLoopVCut.repeat === true;
            const invalid = structuredClone(saved);
            invalid.bastardLoopVCut.fromStart = 'true';
            applyPreset(invalid);
            const invalidOff = bastardLoopVCut.fromStart === false;
            applyPreset(saved);
            const controller = mygrainSongBeta;
            const song = (await controller.request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'From-start render fixture' }) })).song;
            controller.acceptSong(song);
            const captured = [];
            for (const repeat of [false, true]) {
                setBastardLoopVCut({ enabled: true, start: 6 / 16, end: 8 / 16, fromStart: true, repeat });
                const body = await mygrainSongBetaAdapter.capture();
                const snapshot = mygrainSongBetaAdapter.inspectPart(await body.arrayBuffer()).snapshot;
                captured.push({ fromStart: snapshot.state.modes.bastardLoopVCut.fromStart, repeat: snapshot.state.modes.bastardLoopVCut.repeat, sourceFrames: snapshot.assets.find(asset => asset.key === 'bastardV').frames });
                controller.acceptSong((await controller.request(`/${song.id}/parts?name=${repeat ? 'From-start repeat' : 'From-start once'}&repeats=1`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body })).song);
            }
            controller.render();
            return { preset: saved.bastardLoopVCut.fromStart, state: state.modes.bastardLoopVCut.fromStart, legacyOff, invalidOff, restored, captured, hashesDiffer: controller.song.parts[0].sha256 !== controller.song.parts[1].sha256 };
        });
        assert.equal(fromStartState.preset, true);
        assert.equal(fromStartState.state, true);
        assert.equal(fromStartState.legacyOff, true);
        assert.equal(fromStartState.invalidOff, true);
        assert.equal(fromStartState.restored, true);
        assert.equal(fromStartState.hashesDiffer, true);
        assert.deepEqual(fromStartState.captured.map(value => [value.fromStart, value.repeat]), [[true, false], [true, true]]);
        assert.ok(fromStartState.captured.every(value => value.sourceFrames === fromStartState.captured[0].sourceFrames));
        await page.click('#songBetaArm');
        await page.waitForFunction(() => mygrainSongBeta.armed && !mygrainSongBeta.busy, undefined, { timeout: 60000 });
        const fromStartSong = await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            const audible = (buffer, start, end) => buffer.getChannelData(0).slice(Math.round(start * buffer.sampleRate), Math.round(end * buffer.sampleRate)).some(value => Math.abs(value) > .0001);
            const windows = controller.song.parts.map(part => {
                const buffer = controller.renders.get(part.id);
                return [buffer.duration, audible(buffer, .02, .08), audible(buffer, .325, .375), audible(buffer, .6, .68)];
            });
            await controller.recall(controller.song.parts[0], { start: false });
            const recalled = [bastardLoopVCut.fromStart, bastardLoopVCut.repeat];
            const exported = await MygrainSongExport.wav(controller.song.parts, controller.renders, audioContext.sampleRate);
            const buffer = await audioContext.decodeAudioData(await exported.blob.arrayBuffer());
            return { windows, recalled, exportDuration: buffer.duration, exportWindows: [audible(buffer, .02, .08), audible(buffer, .325, .375), audible(buffer, .82, .88), audible(buffer, 1.4, 1.48)] };
        });
        assert.ok(fromStartSong.windows.every(value => Math.abs(value[0] - .8) < .001));
        assert.deepEqual(fromStartSong.windows.map(value => value.slice(1)), [[true, false, false], [true, true, true]]);
        assert.deepEqual(fromStartSong.recalled, [true, false]);
        assert.ok(Math.abs(fromStartSong.exportDuration - 1.6) < .001);
        assert.deepEqual(fromStartSong.exportWindows, [true, false, true, true]);
        assert.deepEqual(errors, []);
        console.log('PASS: Saved cuts, from-start once/repeat Song renders and WAV export, strict legacy defaults, preset/state persistence, shared amendments, unchanged PCM, Loop Part/Song and reload/recall. No page errors.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
