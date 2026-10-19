const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost song test server.');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        const writes = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => {
            if (request.method() === 'POST' && request.url().startsWith(base + 'api/songs')) writes.push(new URL(request.url()).pathname);
        });
        await page.route('https://openclaw.blackcarburning.com/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            syncPatternLengthControls(8, { skipSave: true });
            setGeneratedLoopTransportEnabled(false, { silent: true, skipSave: true });
            setOscillatorsEnabled(false, { silent: true, skipSave: true });
            setGranularLayersEnabled(false, { silent: true, skipSave: true });
            setArpeggiatorEnabled(false);
            seqGrainsEnabled = false;
            document.getElementById('seqGrainsEnabled').checked = false;
            applyGlobalBpm(300);
            bastardLoopSourceBpm = 300;
            bastardLoopEnabled = true;
            const song = (await controller.request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Reuse fixture' }) })).song;
            controller.acceptSong(song);
            await controller.lease.watch(song.id);
            await controller.beginEditing();
            for (const [name, frequency] of [['Intro', 220], ['Verse', 330], ['Outro', 440]]) {
                bastardLoopBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                const samples = bastardLoopBuffer.getChannelData(0);
                for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(2 * Math.PI * frequency * index / audioContext.sampleRate) * .2;
                saveState();
                const body = await mygrainSongBetaAdapter.capture();
                const result = await controller.request(`/${song.id}/parts?name=${name}&repeats=1`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body });
                controller.acceptSong(result.song);
            }
            controller.armConcurrency = 1;
            controller.render();
        });
        await page.click('#songBetaArm');
        await page.waitForFunction(() => mygrainSongBeta.armed && !mygrainSongBeta.busy);
        const initial = await page.evaluate(async () => ({ bytes: mygrainSongBeta.renderBytes, storage: await mygrainSongBeta.renderStore.transaction('readonly', store => store.count()), source: mygrainSongBeta.song.parts[1].id }));
        assert.equal(initial.storage, 3);
        await page.locator('.song-beta-toggle').nth(1).click();
        await page.locator('.song-beta-part').nth(1).getByRole('button', { name: 'Reuse Part Verse', exact: true }).click();
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts.length === 4);
        const reused = await page.evaluate(async () => ({ armed: mygrainSongBeta.armed, bytes: mygrainSongBeta.renderBytes, sources: mygrainSongBeta.renders.size, storage: await mygrainSongBeta.renderStore.transaction('readonly', store => store.count()), part: mygrainSongBeta.song.parts.at(-1) }));
        assert.equal(reused.armed, true);
        assert.equal(reused.bytes, initial.bytes);
        assert.equal(reused.sources, 3);
        assert.equal(reused.storage, 3);
        assert.equal(reused.part.sourcePartId, initial.source);
        assert.equal(writes.filter(path => path.endsWith('/parts')).length, 3);
        assert.equal(writes.filter(path => path.endsWith('/render')).length, 3);
        await page.locator('.song-beta-toggle').nth(3).click();
        assert.match(await page.locator('.song-beta-part').nth(3).locator('.song-beta-part-detail').textContent(), /Shared: 2 uses/);
        await page.locator('.song-beta-part').nth(3).getByRole('spinbutton', { name: 'Repeats for Verse' }).fill('3');
        await page.locator('.song-beta-part').nth(3).getByRole('spinbutton', { name: 'Repeats for Verse' }).press('Tab');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts[3].repeats === 3);
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts[1].repeats), 1);
        await page.evaluate(() => { window.prompt = () => 'verse1'; });
        await page.locator('.song-beta-part').nth(3).getByRole('button', { name: 'Rename Verse', exact: true }).click();
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts[3].name === 'verse1');
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts[1].name), 'verse1');
        await page.locator('.song-beta-part').nth(3).getByRole('button', { name: 'Move verse1 up', exact: true }).click();
        await page.waitForFunction(id => !mygrainSongBeta.busy && mygrainSongBeta.song.parts[2].id === id, reused.part.id);
        await page.click('#songBetaArm');
        await page.waitForFunction(() => mygrainSongBeta.armed && !mygrainSongBeta.busy);
        assert.equal(writes.filter(path => path.endsWith('/render')).length, 3);
        await page.evaluate(() => {
            const analyser = audioContext.createAnalyser();
            const mute = audioContext.createGain();
            mute.gain.value = 0;
            analyser.connect(mute);
            mute.connect(audioContext.destination);
            const schedule = mygrainSongBetaAdapter.scheduleSong;
            const stored = mygrainSongBetaAdapter.scheduleStoredSong;
            mygrainSongBetaAdapter.scheduleSong = (parts, renders, ended) => schedule(parts, renders, ended, analyser);
            mygrainSongBetaAdapter.scheduleStoredSong = (parts, load, ended, signal) => stored(parts, load, ended, signal, analyser);
            window.reuseAnalyser = analyser;
        });
        await page.locator('.song-beta-part').nth(2).getByRole('button', { name: 'Play song from verse1', exact: true }).click();
        await page.waitForFunction(() => mygrainSongBeta.playing && !mygrainSongBeta.busy);
        const hot = await page.evaluate(() => mygrainSongBeta.playback.entries.map(entry => ({ id: entry.id, start: entry.start, end: entry.end })));
        assert.equal(hot[0].id, reused.part.id);
        assert.equal(hot.length, 2);
        assert.equal(hot[0].end, hot[1].start);
        const audible = [];
        for (const entry of hot) {
            audible.push(await page.evaluate(async start => {
                await new Promise(resolve => setTimeout(resolve, Math.max(0, (start + .1 - audioContext.currentTime) * 1000)));
                const samples = new Float32Array(reuseAnalyser.fftSize);
                reuseAnalyser.getFloatTimeDomainData(samples);
                return samples.reduce((power, value) => power + value * value, 0) / samples.length;
            }, entry.start));
        }
        assert.ok(audible.every(power => power > .000001));
        await page.waitForFunction(() => !mygrainSongBeta.playing);
        await page.evaluate(() => { mygrainSongBeta.renders.clear(); mygrainSongBeta.renderBytes = 0; mygrainSongBeta.renderLimitBytes = 1; });
        await page.click('#songBetaPlay');
        await page.waitForFunction(() => mygrainSongBeta.playing && !mygrainSongBeta.busy);
        assert.equal(await page.evaluate(() => mygrainSongBeta.playback.entries.length), 4);
        await page.waitForFunction(() => !mygrainSongBeta.playing);
        const exported = await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            const result = await MygrainSongExport.wav(controller.song.parts, part => controller.loadRender(part), 8000);
            return { frames: result.frames, bytes: result.blob.size };
        });
        assert.equal(exported.frames, 19200);
        await page.evaluate(() => { window.confirm = () => true; });
        await page.locator('.song-beta-part').nth(1).getByRole('button', { name: 'Delete verse1', exact: true }).click();
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts.length === 3);
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts[1].sourcePartId), initial.source);
        await page.locator('.song-beta-part').nth(1).getByRole('button', { name: 'Reuse Part verse1', exact: true }).click();
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts.length === 4);
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts[3].sourcePartId), initial.source);
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy && mygrainSongBeta.song?.parts.length === 4);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        await page.click('#songBetaArm');
        await page.waitForFunction(() => mygrainSongBeta.armed && !mygrainSongBeta.busy);
        assert.equal(writes.filter(path => path.endsWith('/render')).length, 3);
        assert.equal(await page.evaluate(() => mygrainSongBeta.renders.size), 3);
        await page.locator('.song-beta-toggle').nth(1).click();
        await page.locator('.song-beta-part').nth(1).getByRole('button', { name: 'Recall verse1', exact: true }).click();
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        assert.equal(await page.evaluate(() => mygrainSongBeta.cache.size), 1);
        assert.equal(await page.evaluate(source => mygrainSongBeta.cache.has(source), initial.source), true);
        assert.equal(await page.evaluate(() => mygrainSongBeta.canEditSong()), false);
        await page.click('#songBetaEditSong');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.canEditSong());
        await page.locator('.song-beta-part').nth(1).getByRole('button', { name: 'Amend verse1', exact: true }).click();
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.editing);
        await page.evaluate(() => { applyGlobalBpm(240); saveState(); });
        await page.click('#songBetaSavePart');
        await page.waitForFunction(() => !mygrainSongBeta.busy && !mygrainSongBeta.editing && mygrainSongBeta.song.parts[1].bpm === 240);
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts[3].bpm), 240);
        assert.equal(await page.evaluate(() => mygrainSongBeta.renders.size), 2);
        await page.click('#songBetaArm');
        await page.waitForFunction(() => mygrainSongBeta.armed && !mygrainSongBeta.busy);
        assert.equal(writes.filter(path => path.endsWith('/render')).length, 4);
        assert.equal(await page.evaluate(() => mygrainSongBeta.renders.size), 3);
        const layouts = [];
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 844 }]) {
            await page.setViewportSize(viewport);
            await page.locator('#songBetaCard').scrollIntoViewIfNeeded();
            assert.equal(await page.locator('#songBetaCard').evaluate(card => card.scrollWidth > card.clientWidth + 2), false);
            assert.equal(await page.locator('.song-beta-part').nth(1).getByRole('button', { name: 'Reuse Part verse1', exact: true }).isVisible(), true);
            layouts.push(viewport.width);
            if (viewport.width === 390) await page.locator('#songBetaCard').screenshot({ path: '/tmp/mygrain-reuse-mobile.png' });
        }
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ referenceOnly: true, uniqueSources: 3, placements: 4, noNewRendersOnReuse: true, noNewBrowserStorageOnReuse: true, independentRepeats: true, sharedNames: true, exactPlayFromOccurrence: true, contiguous: true, audible, storagePlayback: true, exportFrames: exported.frames, originalRemoval: true, referenceReuse: true, reload: true, recall: true, sharedAmendment: true, changedSourceRendersOnce: true, layouts, errors }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
