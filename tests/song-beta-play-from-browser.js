const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost song test server.');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
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
            bastardLoopBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
            const samples = bastardLoopBuffer.getChannelData(0);
            for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(2 * Math.PI * 220 * index / audioContext.sampleRate) * .2;
            bastardLoopEnabled = true;
            const song = (await controller.request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Play from here fixture' }) })).song;
            controller.acceptSong(song);
            for (const [name, bpm, repeats] of [['Intro', 300, 2], ['Verse', 240, 2], ['Outro', 200, 1]]) {
                applyGlobalBpm(bpm);
                bastardLoopSourceBpm = bpm;
                saveState();
                const body = await mygrainSongBetaAdapter.capture();
                const result = await controller.request(`/${song.id}/parts?name=${name}&repeats=${repeats}`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body });
                controller.acceptSong(result.song);
            }
            controller.armConcurrency = 1;
            controller.render();
        });
        assert.equal(await page.locator('.song-beta-play-from').count(), 3);
        assert.equal(await page.locator('.song-beta-play-from:disabled').count(), 0);
        assert.equal(await page.locator('.song-beta-part-play').count(), 3);
        assert.equal(await page.getByRole('button', { name: 'Play song at Verse', exact: true }).isVisible(), true);
        page.once('dialog', async dialog => {
            assert.equal(dialog.type(), 'confirm');
            assert.match(dialog.message(), /Arm Cache\?/);
            await dialog.dismiss();
        });
        await page.getByRole('button', { name: 'Play song at Verse', exact: true }).click();
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        assert.deepEqual(await page.evaluate(() => ({ armed: mygrainSongBeta.armed, playing: mygrainSongBeta.playing, renders: mygrainSongBeta.renders.size })), { armed: false, playing: false, renders: 0 });
        await page.evaluate(() => {
            window.partTransportOriginalReady = mygrainSongBeta.adapter.ready;
            mygrainSongBeta.adapter.ready = () => new Promise(resolve => { window.partTransportReleaseReady = resolve; });
        });
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Play song at Verse', exact: true }).click();
        await page.waitForFunction(() => mygrainSongBeta.abort && window.partTransportReleaseReady);
        assert.equal(await page.locator('.song-beta-part-stop').count(), 3);
        await page.getByRole('button', { name: 'Stop song from Intro', exact: true }).click();
        await page.evaluate(() => {
            mygrainSongBeta.adapter.ready = window.partTransportOriginalReady;
            partTransportReleaseReady();
        });
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        assert.equal(await page.evaluate(() => !mygrainSongBeta.abort && !mygrainSongBeta.armed && !mygrainSongBeta.playing), true);
        await page.locator('.song-beta-toggle').nth(1).click();
        page.once('dialog', async dialog => {
            assert.equal(dialog.type(), 'confirm');
            assert.match(dialog.message(), /Verse/);
            await dialog.accept();
        });
        await page.getByRole('button', { name: 'Play song from Verse', exact: true }).click();
        await page.waitForFunction(() => mygrainSongBeta.busy);
        assert.equal(await page.locator('.song-beta-play-from:disabled').count(), 3);
        assert.equal(await page.locator('.song-beta-part-stop').count(), 3);
        assert.equal(await page.locator('.song-beta-part-stop:disabled').count(), 0);
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.armed && mygrainSongBeta.playing);
        assert.equal(await page.evaluate(() => mygrainSongBeta.playback.entries[0].id === mygrainSongBeta.song.parts[1].id), true);
        await page.click('#songBetaStop');
        assert.equal(await page.locator('.song-beta-play-from:disabled').count(), 0);
        const unexpectedDialogs = [];
        page.on('dialog', async dialog => { unexpectedDialogs.push(dialog.message()); await dialog.dismiss(); });
        await page.evaluate(() => {
            const analyser = audioContext.createAnalyser();
            const mute = audioContext.createGain();
            mute.gain.value = 0;
            analyser.connect(mute);
            mute.connect(audioContext.destination);
            window.playFromFixture = { calls: [], loads: [], analyser, original: JSON.stringify(mygrainSongBeta.song), gain: finalAmplifierNode.gain.value };
            const schedule = mygrainSongBetaAdapter.scheduleSong;
            const stored = mygrainSongBetaAdapter.scheduleStoredSong;
            mygrainSongBetaAdapter.scheduleSong = (parts, renders, ended) => {
                const playback = schedule(parts, renders, ended, analyser);
                playFromFixture.calls.push({ mode: 'hot', ids: parts.map(part => part.id), entries: playback.entries });
                return playback;
            };
            mygrainSongBetaAdapter.scheduleStoredSong = async (parts, load, ended, signal) => {
                const playback = await stored(parts, load, ended, signal, analyser);
                playFromFixture.calls.push({ mode: 'stored', ids: parts.map(part => part.id), entries: playback.entries });
                return playback;
            };
            const load = mygrainSongBeta.loadRender.bind(mygrainSongBeta);
            mygrainSongBeta.loadRender = (part, ...args) => { playFromFixture.loads.push(part.id); return load(part, ...args); };
        });
        await page.getByRole('button', { name: 'Play song from Verse', exact: true }).click();
        await page.waitForFunction(() => mygrainSongBeta.playing && !mygrainSongBeta.busy);
        const warm = await page.evaluate(() => {
            const call = playFromFixture.calls.at(-1);
            return { ...call, expected: mygrainSongBeta.song.parts.slice(1).map(part => part.id), active: mygrainSongBeta.active, status: document.getElementById('songBetaStatus').textContent, duration: call.entries.at(-1).end - call.entries[0].start };
        });
        assert.equal(warm.mode, 'hot');
        assert.deepEqual(warm.ids, warm.expected);
        assert.equal(warm.active, warm.expected[0]);
        assert.match(warm.status, /Playing 2\/3: Verse/);
        assert.equal(warm.entries[0].end, warm.entries[1].start);
        assert.ok(Math.abs(warm.duration - 1.6) < .001);
        const audible = [];
        for (const index of [1, 2]) {
            await page.waitForFunction(index => mygrainSongBeta.active === mygrainSongBeta.song.parts[index].id && audioContext.currentTime > playFromFixture.calls.at(-1).entries[index - 1].start + .1, index);
            audible.push(await page.evaluate(() => {
                const samples = new Float32Array(playFromFixture.analyser.fftSize);
                playFromFixture.analyser.getFloatTimeDomainData(samples);
                return samples.reduce((power, sample) => power + sample ** 2, 0) / samples.length;
            }));
        }
        await page.waitForFunction(() => !mygrainSongBeta.playing);
        assert.ok(audible.every(power => power > .000001));
        assert.match(await page.locator('#songBetaStatus').textContent(), /Played from Verse through the last part/);
        await page.evaluate(() => { mygrainSongBeta.renders.clear(); mygrainSongBeta.renderBytes = 0; mygrainSongBeta.renderLimitBytes = 1; });
        await page.getByRole('button', { name: 'Play song from Verse', exact: true }).click();
        await page.waitForFunction(() => mygrainSongBeta.playing && !mygrainSongBeta.busy);
        const stored = await page.evaluate(() => ({ call: playFromFixture.calls.at(-1), loads: playFromFixture.loads, expected: mygrainSongBeta.song.parts.slice(1).map(part => part.id) }));
        assert.equal(stored.call.mode, 'stored');
        assert.deepEqual(stored.call.ids, stored.expected);
        assert.deepEqual(stored.loads, stored.expected);
        assert.equal(stored.call.entries[0].end, stored.call.entries[1].start);
        await page.click('#songBetaStop');
        assert.equal(await page.evaluate(() => !mygrainSongBeta.playing && !mygrainSongBeta.abort && finalAmplifierNode.gain.value === playFromFixture.gain), true);
        await page.locator('.song-beta-toggle').nth(2).click();
        await page.getByRole('button', { name: 'Play song from Outro', exact: true }).click();
        await page.waitForFunction(() => mygrainSongBeta.playing && !mygrainSongBeta.busy);
        assert.equal(await page.evaluate(() => mygrainSongBeta.playback.entries.length), 1);
        await page.waitForFunction(() => !mygrainSongBeta.playing);
        await page.click('#songBetaPlay');
        await page.waitForFunction(() => mygrainSongBeta.playing && !mygrainSongBeta.busy);
        assert.equal(await page.evaluate(() => mygrainSongBeta.playback.entries.length), 3);
        await page.getByRole('button', { name: 'Play song from Verse', exact: true }).click();
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.playback?.entries.length === 2);
        assert.equal(await page.evaluate(() => mygrainSongBeta.active === mygrainSongBeta.song.parts[1].id), true);
        await page.click('#songBetaStop');
        assert.equal(await page.evaluate(() => JSON.stringify(mygrainSongBeta.song) === playFromFixture.original), true);
        await page.getByRole('button', { name: 'Play song at Outro', exact: true }).click();
        await page.waitForFunction(() => mygrainSongBeta.playing && !mygrainSongBeta.busy);
        assert.equal(await page.evaluate(() => mygrainSongBeta.playback.entries[0].id === mygrainSongBeta.song.parts[2].id), true);
        assert.equal(await page.locator('.song-beta-part-stop').count(), 3);
        await page.getByRole('button', { name: 'Stop song from Intro', exact: true }).click();
        assert.equal(await page.evaluate(() => !mygrainSongBeta.playing && !mygrainSongBeta.abort), true);
        assert.equal(await page.locator('.song-beta-part-play').count(), 3);
        await page.evaluate(() => { mygrainSongBeta.editing = { id: mygrainSongBeta.song.parts[0].id }; mygrainSongBeta.render(); });
        assert.equal(await page.locator('.song-beta-play-from:disabled').count(), 3);
        assert.equal(await page.locator('.song-beta-part-play:disabled').count(), 3);
        await page.evaluate(() => { mygrainSongBeta.editing = null; mygrainSongBeta.render(); });
        const layouts = [];
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 844 }]) {
            await page.setViewportSize(viewport);
            await page.locator('#songBetaCard').scrollIntoViewIfNeeded();
            const overflow = await page.locator('#songBetaCard').evaluate(card => card.scrollWidth > card.clientWidth + 2);
            assert.equal(overflow, false, JSON.stringify(viewport));
            assert.equal(await page.getByRole('button', { name: 'Play song from Verse', exact: true }).isVisible(), true);
            layouts.push(viewport.width);
        }
        assert.deepEqual(unexpectedDialogs, []);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ armPromptAccepted: true, armPromptCancelled: true, noPromptWhenArmed: true, hotPlayback: true, storedPlayback: true, contiguous: true, audible, lastPartOnly: true, jumpDuringPlayback: true, fullSongUnchanged: true, arrangementUnchanged: true, layouts, errors }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
