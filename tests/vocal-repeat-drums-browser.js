const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost song test server.');
const origin = new URL(base).origin;

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
        const errors = [];
        const remoteWrites = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://openclaw.blackcarburning.com/**', async route => {
            const url = new URL(route.request().url());
            if (url.pathname.startsWith('/mygrain-bastardloops/api/')) return route.fulfill({ response: await route.fetch({ url: `${origin}${url.pathname}${url.search}` }) });
            if (!['GET', 'HEAD'].includes(route.request().method())) { remoteWrites.push(url.pathname); return route.abort(); }
            return route.continue();
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        await page.evaluate(() => {
            stopAllPerformancePlayback({ silent: true });
            syncPatternLengthControls(16, { skipSave: true });
            applyGlobalBpm(300);
            setOscillatorsEnabled(false, { silent: true, skipSave: true });
            setGranularLayersEnabled(false, { silent: true, skipSave: true });
            setGeneratedLoopTransportEnabled(false, { silent: true, skipSave: true });
            setDropboxSampleLayerEnabled(false, { silent: true, skipSave: true });
            setArpeggiatorEnabled(false);
            setDrumMachineEnabled(false, { silent: true, skipSave: true });
            setFxMuted(true, { silent: true });
            seqGrainsEnabled = false;
            document.getElementById('seqGrainsEnabled').checked = false;
            for (const kind of ['kick', 'snare', 'hat', 'perc']) setDrumMachinePattern(kind, Array(16).fill(false), { skipSave: true });
            openDrumMachineOverlay();
        });
        assert.equal(await page.locator('#drumMachineOverlay .drum-machine-track-card').count(), 6);
        for (const [id, source] of [['drumMachineClap', 'SAMPLES_CLAP'], ['drumMachineCymbals', 'SAMPLES_CRASH']]) {
            await page.click(`#${id}BrowseBtn`);
            await page.waitForFunction(() => document.querySelectorAll('#dropboxSampleBrowserList .sample-browser-card').length > 0 && !dropboxSampleBrowserLoading);
            assert.match(await page.locator('#dropboxSampleBrowserSubtitle').textContent(), /local sample repository/);
            const count = await page.evaluate(() => dropboxSampleBrowserFiles.length);
            assert.ok(count > 100, `${source}: ${count}`);
            await page.locator('#dropboxSampleBrowserList .sample-browser-card button').first().click();
            await page.waitForFunction(() => document.getElementById('dropboxSampleBrowserOverlay').hidden && !drumMachineLoadInFlight);
            assert.match(await page.locator(`#${id}Meta`).textContent(), new RegExp(source));
            await page.click(`#${id}RandomBtn`);
            await page.waitForFunction(() => !drumMachineLoadInFlight);
        }
        await page.locator('#drumMachineClapGrid .drum-machine-step-btn').nth(0).click();
        await page.locator('#drumMachineCymbalsGrid .drum-machine-step-btn').nth(8).click();
        await page.locator('#drumMachineClapGrid .drum-machine-ratchet-btn').nth(0).click();
        const drumState = await page.evaluate(() => {
            setSliderValue('drumMachineClapPitch', -5);
            setSliderValue('drumMachineClapLevel', 70);
            setSliderValue('drumMachineCymbalsDecay', 85);
            setSliderValue('drumMachineCymbalsLength', 90);
            const buffers = Object.values(drumMachineExtraTracks).map(track => ({ kind: track.kind, duration: track.buffer.duration, frames: track.buffer.length }));
            const saved = captureExtraDrumMachineTracks();
            normalizeAllDrumMachinePatterns(32, { skipSave: true });
            const extended = Object.values(drumMachineExtraTracks).every(track => track.pattern.length === 32 && track.ratchets.length === 32);
            normalizeAllDrumMachinePatterns(16, { skipSave: true });
            restoreExtraDrumMachineTracks(saved);
            return { saved, buffers, extended, kickEmpty: drumMachineKickPattern.every(value => !value) };
        });
        assert.equal(drumState.extended, true);
        assert.equal(drumState.kickEmpty, true);
        assert.equal(drumState.saved.clap.ratchets[0], 2);
        await page.click('#drumMachinePlayBtn');
        await page.waitForFunction(() => drumMachinePlaying && drumMachineActiveVoices.size > 0);
        assert.equal(await page.evaluate(() => drumMachineKickPattern.every(value => !value) && drumMachineSnarePattern.every(value => !value) && drumMachineHatPattern.every(value => !value)), true);
        await page.click('#drumMachinePlayBtn');
        await page.waitForFunction(() => !drumMachinePlaying && drumMachineActiveVoices.size === 0);
        const midi = await page.evaluate(() => { const file = buildDrumMachineMidiBlob(); return file.size; });
        assert.ok(midi > 150);
        console.log('PASS: Local Clap/Cymbals browser and random loading, independent steps/ratchets/controls, pattern length, drum-only playback, stop and MIDI.');

        for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            for (const id of ['drumMachineClapGrid', 'drumMachineCymbalsGrid']) {
                await page.locator(`#${id}`).scrollIntoViewIfNeeded();
                const bounds = await page.locator(`#${id}`).boundingBox();
                assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1, JSON.stringify(bounds));
            }
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
            if (viewport.width === 390) await page.screenshot({ path: '/tmp/mygrain-cymbals-mobile.png' });
        }
        await page.evaluate(() => closeDrumMachineOverlay());
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.evaluate(async () => {
            setDrumMachineEnabled(false, { silent: true, skipSave: true });
            const buffer = audioContext.createBuffer(2, Math.round(audioContext.sampleRate * .8), audioContext.sampleRate);
            for (let channel = 0; channel < 2; channel += 1) {
                const samples = buffer.getChannelData(channel);
                for (let frame = 0; frame < samples.length; frame += 1) samples[frame] = Math.sin(2 * Math.PI * 440 * frame / buffer.sampleRate) * .25;
            }
            window.repeatOriginalBuffer = buffer;
            await applyLoadedBastardLoopVBuffer(buffer, 'repeat-tone.wav', { bpm: 300, durationSeconds: .8, patternSteps: 16, sourceLabel: 'SAMPLES_VOCAL' });
            setBastardLoopEnabled(false, { silent: true, skipSave: true });
            setBastardLoopVEnabled(true, { silent: true, skipSave: true });
            setSliderValue('performanceBastardLoopVLevel', 80);
            setBastardLoopVCut({ enabled: true, start: 0, end: 5 / 16 });
            bastardLoopVCutEditor.open();
        });
        await page.click('#bastardLoopVCutRepeat');
        assert.equal(await page.locator('#bastardLoopVCutRepeat').getAttribute('aria-pressed'), 'true');
        await page.click('#bastardLoopVCutAuditionMetro');
        await page.waitForFunction(() => isBastardLoopVCutPreviewRunning() && bastardLoopVSource);
        const repeatAudio = await page.evaluate(() => {
            const buffer = bastardLoopVSource.buffer;
            const length = Math.round(buffer.sampleRate * .25);
            let difference = 0;
            for (let frame = 300; frame < length - 300; frame += 1) difference = Math.max(difference, Math.abs(buffer.getChannelData(0)[frame] - buffer.getChannelData(0)[length + frame]));
            return { difference, duration: buffer.duration, loopEnd: bastardLoopVSource.loopEnd, originalPreserved: bastardLoopVBuffer === repeatOriginalBuffer, othersStopped: !bastardLoopPlaying && !drumMachinePlaying, end: Math.abs(buffer.getChannelData(0).at(-1)) };
        });
        assert.deepEqual(repeatAudio, { difference: 0, duration: .8, loopEnd: .8, originalPreserved: true, othersStopped: true, end: 0 });
        await page.click('#bastardLoopVCutStop');
        await page.click('#bastardLoopVCutAuditionLoops');
        await page.waitForFunction(() => isBastardLoopVCutPreviewRunning() && bastardLoopPlaying && bastardLoopVSource);
        await page.click('#bastardLoopVCutStop');
        await page.click('#bastardLoopVCutRepeat');
        assert.equal(await page.evaluate(() => getBastardLoopVPlaybackBuffer().getChannelData(0).slice(Math.round(audioContext.sampleRate * .3)).every(value => value === 0)), true);
        await page.click('#bastardLoopVCutRepeat');
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.screenshot({ path: '/tmp/mygrain-vocal-repeat-mobile.png' });
        await page.click('#bastardLoopVCutClose');
        console.log('PASS: Section Repeat button and mobile layout; 5+5+5+1 PCM, full duration, unchanged original sample, metronome/Bastardloops auditions.');

        await page.setViewportSize({ width: 1440, height: 1000 });
        const song = await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            const song = (await controller.request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Section repeat and new drum lanes fixture' }) })).song;
            controller.acceptSong(song);
            for (const [name, drums] of [['V repeat', false], ['Clap and Cymbals', true]]) {
                setBastardLoopVEnabled(!drums, { silent: true, skipSave: true });
                setDrumMachineEnabled(drums, { silent: true, skipSave: true });
                const body = await mygrainSongBetaAdapter.capture();
                const snapshot = mygrainSongBetaAdapter.inspectPart(await body.arrayBuffer()).snapshot;
                if (!snapshot.state.modes.bastardLoopVCut.repeat || !snapshot.assets.some(asset => asset.key === 'drumClap') || !snapshot.assets.some(asset => asset.key === 'drumCymbals')) throw new Error('Repeat or new sample assets were not captured.');
                controller.acceptSong((await controller.request(`/${song.id}/parts?name=${encodeURIComponent(name)}&repeats=1`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body })).song);
            }
            controller.render();
            return controller.song;
        });
        await page.click('#songBetaArm');
        await page.waitForFunction(() => mygrainSongBeta.armed && !mygrainSongBeta.busy, undefined, { timeout: 60000 });
        const rendered = await page.evaluate(() => mygrainSongBeta.song.parts.map(part => {
            const buffer = mygrainSongBeta.renders.get(part.id);
            const samples = buffer.getChannelData(0);
            const rms = (start, end) => { const region = samples.slice(Math.round(start * buffer.sampleRate), Math.round(end * buffer.sampleRate)); return Math.sqrt(region.reduce((total, value) => total + value * value, 0) / region.length); };
            return { duration: buffer.duration, render: part.render, sections: [[.05, .20], [.30, .45], [.55, .7], [.755, .79]].map(range => rms(...range)) };
        }));
        console.log('Rendered repeat/drum sections', JSON.stringify(rendered.map(part => part.sections)));
        for (const part of rendered) {
            assert.equal(part.render.vocalRepeatVersion, 1);
            assert.equal(part.render.drumLanesVersion, 1);
            assert.ok(Math.abs(part.duration - .8) < .001);
        }
        assert.ok(rendered[0].sections.every(level => level > .0001));
        assert.ok(rendered[1].sections[0] > .0001 && rendered[1].sections[2] > .0001);
        await page.evaluate(async () => {
            await mygrainSongBeta.recall(mygrainSongBeta.song.parts[0], { start: false });
            const captured = gatherPreset();
            const legacy = structuredClone(captured);
            delete legacy.drumMachineExtraTracks;
            delete legacy.bastardLoopVCut.repeat;
            applyPreset(legacy);
            if (bastardLoopVCut.repeat || Object.values(drumMachineExtraTracks).some(track => track.pattern.some(Boolean))) throw new Error('Legacy patch did not default to silent new features.');
            applyPreset(captured);
        });
        assert.deepEqual(await page.evaluate(() => [bastardLoopVCut.repeat, captureExtraDrumMachineTracks().clap.pitch, captureExtraDrumMachineTracks().cymbals.length]), [true, -5, .9]);
        const patchRoundtrip = await page.evaluate(async () => {
            const original = { settings: captureExtraDrumMachineTracks(), repeat: bastardLoopVCut.repeat, frames: Object.values(drumMachineExtraTracks).map(track => track.buffer.length) };
            const zip = await buildPatchZipBlob('section-repeat-new-drums-fixture.zip');
            restoreExtraDrumMachineTracks();
            setBastardLoopVCut({ enabled: false });
            for (const track of Object.values(drumMachineExtraTracks)) track.buffer = null;
            await openPatchZipFromArrayBuffer(await zip.arrayBuffer(), 'section-repeat-new-drums-fixture.zip');
            return { original, restored: { settings: captureExtraDrumMachineTracks(), repeat: bastardLoopVCut.repeat, frames: Object.values(drumMachineExtraTracks).map(track => track.buffer.length) } };
        });
        assert.deepEqual(patchRoundtrip.restored, patchRoundtrip.original);
        await page.evaluate(async () => { await mygrainSongBeta.recall(mygrainSongBeta.song.parts[1], { start: false }); });
        const recalled = await page.evaluate(() => ({ settings: captureExtraDrumMachineTracks(), vocalRepeat: bastardLoopVCut.repeat, sizes: Object.values(drumMachineExtraTracks).map(track => track.buffer.length) }));
        assert.deepEqual(recalled.settings, drumState.saved);
        assert.deepEqual(recalled.sizes, drumState.buffers.map(buffer => buffer.frames));
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        assert.deepEqual(await page.evaluate(() => ({ settings: captureExtraDrumMachineTracks(), vocalRepeat: bastardLoopVCut.repeat, sizes: Object.values(drumMachineExtraTracks).map(track => track.buffer.length) })), recalled);
        await page.evaluate(async () => {
            const render = mygrainSongBetaAdapter.renderPart;
            mygrainSongBetaAdapter.renderPart = () => { throw new Error('Saved renders must be reused after reload.'); };
            try { await mygrainSongBeta.arm(); } finally { mygrainSongBetaAdapter.renderPart = render; }
            mygrainSongBeta.loopSong = true;
            await mygrainSongBeta.playSong();
        });
        await page.waitForTimeout(2000);
        assert.equal(await page.evaluate(() => mygrainSongBeta.playing), true);
        await page.evaluate(() => mygrainSongBeta.stop());
        assert.deepEqual(errors, []);
        assert.deepEqual(remoteWrites, []);
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.id), song.id);
        console.log('PASS: Saved parts, audible exact-length cache renders, recall, legacy defaults, presets and patch ZIP roundtrip, IndexedDB reload, saved-cache reuse and Loop Song; no page errors or production writes.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
