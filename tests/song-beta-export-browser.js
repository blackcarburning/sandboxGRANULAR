const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost SONG_BETA_TEST_URL.');
const origin = new URL(base).origin;

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://openclaw.blackcarburning.com/mygrain-wavs/**', async route => {
            const request = route.request();
            const url = new URL(request.url());
            const response = await route.fetch({ url: `${origin}${url.pathname}${url.search}` });
            await route.fulfill({ response });
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        assert.equal(await page.locator('#songBetaExport').isDisabled(), true);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        await page.evaluate(() => {
            syncPatternLengthControls(8, { skipSave: true });
            applyGlobalBpm(120);
            lfoEnabled = {};
            lfo2Enabled = {};
            lfo3Enabled = {};
            setGeneratedLoopTransportEnabled(false, { silent: true, skipSave: true });
            setOscillatorsEnabled(false, { silent: true, skipSave: true });
            setArpeggiatorEnabled(false);
            setGrainTimingMode('synth', { silent: true, skipSave: true });
            setGranularLayersEnabled(true, { silent: true, skipSave: true });
            setGranularLayerMuted('main', true, { silent: true, skipSave: true });
            setGranularLayerMuted('A', false, { silent: true, skipSave: true });
            setGranularLayerMuted('B', true, { silent: true, skipSave: true });
            setHoldEnabled(true, { silent: true, skipSave: true });
            seqGrainsEnabled = false;
            document.getElementById('seqGrainsEnabled').checked = false;
            for (const voice of ['kick', 'snare', 'hat', 'perc']) setDrumMachinePattern(voice, Array(8).fill(false), { skipSave: true });
            grainASampleBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
            const samples = grainASampleBuffer.getChannelData(0);
            for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(2 * Math.PI * 220 * index / audioContext.sampleRate) * .25;
            const source = document.getElementById('grainSynthASource');
            source.value = 'grainASample';
            source.dispatchEvent(new Event('change', { bubbles: true }));
            saveState();
        });
        await page.locator('#keyboardContainer .key[data-note="C3"]').click();
        await page.fill('#songBetaName', 'Export arrangement');
        await page.click('#songBetaNewSong');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song);
        await page.fill('#songBetaPartName', 'First');
        await page.fill('#songBetaRepeats', '2');
        await page.click('#songBetaNewPart');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts.length === 1);
        await page.evaluate(() => applyGlobalBpm(90));
        await page.fill('#songBetaPartName', 'Second');
        await page.fill('#songBetaRepeats', '1');
        await page.click('#songBetaNewPart');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts.length === 2);
        page.once('dialog', dialog => dialog.dismiss());
        await page.click('#songBetaExport');
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        assert.equal(await page.evaluate(() => mygrainSongBeta.armed), false);
        const before = await page.evaluate(() => mygrainSongBeta.song.parts.map(part => part.sha256));
        page.once('dialog', dialog => dialog.accept('Renamed take.wav'));
        await page.click('#songBetaExport');
        await page.waitForFunction(() => !mygrainSongBeta.busy && document.getElementById('songBetaStatus').textContent.includes('Saved Renamed-take.song.120-90.wav'), null, { timeout: 60000 });
        const result = await page.evaluate(async origin => {
            const response = await fetch(`${origin}/mygrain-wavs/Renamed-take.song.120-90.wav`);
            const bytes = await response.arrayBuffer();
            const view = new DataView(bytes);
            const rate = view.getUint32(24, true);
            const frames = view.getUint32(40, true) / 6;
            const decoded = await audioContext.decodeAudioData(bytes.slice(0));
            const intervals = [[0, rate], [rate, rate * 2], [rate * 2, frames]];
            const powers = intervals.map(([start, end]) => {
                const samples = decoded.getChannelData(0);
                let power = 0;
                for (let index = start; index < end; index += 1) power += samples[index] ** 2;
                return Math.sqrt(power / (end - start));
            });
            return { frames, rate, channels: view.getUint16(22, true), bits: view.getUint16(34, true), powers, marked: mygrainSongBeta.song.parts.every(part => part.render.grainVersion === 1), hashes: mygrainSongBeta.song.parts.map(part => part.sha256) };
        }, origin);
        assert.equal(result.frames, Math.round((2 + 60 / 90 * 2) * result.rate));
        assert.equal(result.channels, 2);
        assert.equal(result.bits, 24);
        assert.ok(result.powers.every(power => power > .001), JSON.stringify(result));
        assert.equal(result.marked, true);
        assert.deepEqual(result.hashes, before);
        const requests = [];
        page.on('request', request => { if (request.url().includes('/parts/')) requests.push(request.url()); });
        page.once('dialog', dialog => dialog.accept('Warm take'));
        await page.click('#songBetaExport');
        await page.waitForFunction(() => !mygrainSongBeta.busy && document.getElementById('songBetaStatus').textContent.includes('Saved Warm-take.song.120-90.wav'));
        assert.deepEqual(requests, []);
        await page.evaluate(async () => {
            mygrainSongBeta.adapter.stop({ hardCut: true });
            await audioContext.close();
            mygrainSongBeta.invalidate(true);
        });
        page.once('dialog', dialog => dialog.accept('Restarted engine'));
        await page.click('#songBetaExport');
        await page.waitForFunction(() => !mygrainSongBeta.busy && document.getElementById('songBetaStatus').textContent.includes('Saved Restarted-engine.song.120-90.wav'), null, { timeout: 60000 });
        assert.equal(await page.evaluate(() => audioContext.state), 'running');
        console.log('PASS: Rename/cancel, auto-arm, audible stereo PCM24, ordered repeats/mixed tempos, immutable snapshots and warm-cache export to isolated existing WAV folder.');
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            await page.locator('#songBetaExport').scrollIntoViewIfNeeded();
            assert.equal(await page.locator('#songBetaExport').isVisible(), true);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        }
        assert.deepEqual(errors, []);
        console.log('PASS: Song export control fits 390px and 320px mobile layouts with no page errors.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
