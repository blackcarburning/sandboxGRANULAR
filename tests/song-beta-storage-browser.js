const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost song test server.');

(async () => {
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://openclaw.blackcarburning.com/mygrain-wavs/**', async route => {
            const url = new URL(route.request().url());
            const response = await route.fetch({ url: `${new URL(base).origin}${url.pathname}${url.search}` });
            await route.fulfill({ response });
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        const result = await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            syncPatternLengthControls(8, { skipSave: true });
            applyGlobalBpm(300);
            setGeneratedLoopTransportEnabled(false, { silent: true, skipSave: true });
            setOscillatorsEnabled(false, { silent: true, skipSave: true });
            setGranularLayersEnabled(false, { silent: true, skipSave: true });
            setArpeggiatorEnabled(false);
            seqGrainsEnabled = false;
            document.getElementById('seqGrainsEnabled').checked = false;
            for (const voice of ['kick', 'snare', 'hat', 'perc']) setDrumMachinePattern(voice, Array(8).fill(false), { skipSave: true });
            bastardLoopBuffer = audioContext.createBuffer(1, 12 * 1024 * 1024, audioContext.sampleRate);
            const samples = bastardLoopBuffer.getChannelData(0);
            for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(2 * Math.PI * 220 * index / audioContext.sampleRate) * .15;
            bastardLoopSourceBpm = 300;
            bastardLoopEnabled = true;
            saveState();
            const song = (await controller.request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Large source storage fixture' }) })).song;
            controller.acceptSong(song);
            for (let index = 0; index < 6; index += 1) {
                samples[0] = .01 * (index + 1);
                const body = await mygrainSongBetaAdapter.capture();
                const result = await controller.request(`/${song.id}/parts?name=Part-${index + 1}&repeats=2`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body });
                controller.acceptSong(result.song);
            }
            let sourceDecodes = 0;
            let renderCount = 0;
            let peakSourceBytes = 0;
            const decode = mygrainSongBetaAdapter.decode;
            const renderPart = mygrainSongBetaAdapter.renderPart;
            mygrainSongBetaAdapter.decode = async (...args) => { sourceDecodes += 1; return decode(...args); };
            mygrainSongBetaAdapter.renderPart = async (...args) => { renderCount += 1; peakSourceBytes = Math.max(peakSourceBytes, controller.audioCache.bytes); return renderPart(...args); };
            controller.renderLimitBytes = Math.ceil(.4 * audioContext.sampleRate * 8 * 1.25);
            controller.armConcurrency = 10;
            await controller.arm();
            controller.render();
            const preparation = { armed: controller.armed, originalDecodedBytes: 6 * samples.byteLength, sources: controller.cache.size, sourceBytes: controller.audioCache.bytes, hotRenders: controller.renders.size, hotBytes: controller.renderBytes, ready: controller.song.parts.every(part => controller.isPartReady(part)), sourceDecodes, renderCount, peakSourceBytes, budget: controller.memoryBudget.bytes, downloadBudget: controller.downloadBudget.bytes, warning: controller.renderStore.warning };
            await controller.arm();
            const rearm = { sourceDecodes, renderCount };
            const analyser = audioContext.createAnalyser();
            const mute = audioContext.createGain();
            mute.gain.value = 0;
            analyser.connect(mute);
            mute.connect(audioContext.destination);
            const loaded = [];
            const played = [];
            const playback = await MygrainSongClock.scheduleStored(audioContext, controller.song.parts, async part => {
                loaded.push(part.id);
                return controller.loadRender(part);
            }, reason => played.push(reason), undefined, analyser);
            const adjacent = playback.entries.slice(1).every((entry, index) => entry.start === playback.entries[index].end);
            const powers = [];
            while (!played.length) {
                const data = new Float32Array(analyser.fftSize);
                analyser.getFloatTimeDomainData(data);
                powers.push({ time: audioContext.currentTime, power: data.reduce((power, sample) => power + sample ** 2, 0) / data.length });
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            const audible = playback.entries.map(entry => powers.filter(sample => sample.time > entry.start + .1 && sample.time < entry.end - .05).some(sample => sample.power > .000001));
            analyser.disconnect();
            mute.disconnect();
            mygrainSongBetaAdapter.chooseSongExportFilename = async () => 'Storage-fixture.song.300.wav';
            await controller.exportSong();
            const response = await fetch(`${location.origin}/mygrain-wavs/Storage-fixture.song.300.wav`);
            const bytes = await response.arrayBuffer();
            const wav = new DataView(bytes);
            return { preparation, rearm, loaded: loaded.length, played, adjacent, audible, finalHotBytes: controller.renderBytes, export: { status: response.status, frames: wav.getUint32(40, true) / 6, rate: wav.getUint32(24, true), bits: wav.getUint16(34, true) }, sourcesAfterPlayback: controller.cache.size };
        });
        assert.equal(result.preparation.armed, true);
        assert.ok(result.preparation.originalDecodedBytes > 256 * 1024 * 1024);
        assert.equal(result.preparation.sources, 0);
        assert.equal(result.preparation.sourceBytes, 0);
        assert.equal(result.preparation.hotRenders, 1);
        assert.equal(result.preparation.ready, true);
        assert.equal(result.preparation.sourceDecodes, 6);
        assert.equal(result.preparation.renderCount, 6);
        assert.ok(result.preparation.peakSourceBytes <= 96 * 1024 * 1024);
        assert.equal(result.preparation.budget, 0);
        assert.equal(result.preparation.downloadBudget, 0);
        assert.equal(result.preparation.warning, '');
        assert.deepEqual(result.rearm, { sourceDecodes: 6, renderCount: 6 });
        assert.equal(result.loaded, 6);
        assert.deepEqual(result.played, ['finished']);
        assert.equal(result.adjacent, true);
        assert.ok(result.audible.every(Boolean), JSON.stringify(result));
        assert.equal(result.export.status, 200);
        assert.equal(result.export.frames, Math.round(4.8 * result.export.rate));
        assert.equal(result.export.bits, 24);
        assert.equal(result.sourcesAfterPlayback, 0);
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        const requests = [];
        page.on('request', request => { if (request.url().includes('/parts/')) requests.push(request.url()); });
        await page.evaluate(async () => {
            mygrainSongBetaAdapter.decode = () => { throw new Error('Saved renders must not decode source snapshots.'); };
            mygrainSongBetaAdapter.renderPart = () => { throw new Error('Saved renders must not be rendered again.'); };
            mygrainSongBeta.renderLimitBytes = 1;
            await mygrainSongBeta.arm();
        });
        assert.equal(requests.filter(url => url.endsWith('/render')).length, 0);
        assert.equal(requests.length, 6);
        assert.equal(await page.evaluate(() => mygrainSongBeta.armed && mygrainSongBeta.cache.size === 0), true);
        const largeRenders = await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            bastardLoopBuffer = null;
            syncPatternLengthControls(64, { skipSave: true });
            applyGlobalBpm(40);
            saveState();
            const body = await mygrainSongBetaAdapter.capture();
            const song = (await controller.request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Large stored render fixture' }) })).song;
            controller.acceptSong(song);
            const buffer = audioContext.createBuffer(2, audioContext.sampleRate * 24, audioContext.sampleRate);
            for (let channel = 0; channel < 2; channel += 1) {
                const samples = buffer.getChannelData(channel);
                for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(2 * Math.PI * 220 * index / audioContext.sampleRate) * .15;
            }
            const wav = mygrainSongBetaAdapter.encodeRender(buffer);
            for (let index = 0; index < 40; index += 1) {
                const result = await controller.request(`/${song.id}/parts?name=Stored-${index + 1}&repeats=1`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body });
                controller.acceptSong(result.song);
                const part = controller.song.parts.at(-1);
                const rendered = await controller.request(`/${song.id}/parts/${part.id}/render?sha256=${part.sha256}&keyboard=1&grain=1`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
                controller.acceptSong(rendered.song);
            }
            controller.renderLimitBytes = 96 * 1024 * 1024;
            controller.armConcurrency = 10;
            await controller.arm();
            const prepared = { totalDecodedBytes: 40 * buffer.length * 8, hotBytes: controller.renderBytes, ready: controller.song.parts.every(part => controller.isPartReady(part)), sources: controller.cache.size, parts: controller.song.parts.length };
            const analyser = audioContext.createAnalyser();
            const mute = audioContext.createGain();
            mute.gain.value = 0;
            analyser.connect(mute);
            mute.connect(audioContext.destination);
            const schedule = mygrainSongBetaAdapter.scheduleStoredSong;
            let storedPlayback = false;
            mygrainSongBetaAdapter.scheduleStoredSong = (...args) => { storedPlayback = true; return schedule(...args, analyser); };
            const gain = finalAmplifierNode.gain.value;
            await controller.playSong();
            await new Promise(resolve => setTimeout(resolve, 450));
            const samples = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(samples);
            const power = samples.reduce((power, sample) => power + sample ** 2, 0) / samples.length;
            const playing = controller.playing;
            controller.stop();
            const stopped = !controller.playing && !controller.playback && !controller.abort;
            const restoredGain = finalAmplifierNode.gain.value === gain;
            analyser.disconnect();
            mute.disconnect();
            mygrainSongBetaAdapter.scheduleStoredSong = schedule;
            return { ...prepared, storedPlayback, playing, power, stopped, restoredGain, hotBytesAfterPlay: controller.renderBytes, budget: controller.memoryBudget.bytes };
        });
        assert.ok(largeRenders.totalDecodedBytes > 256 * 1024 * 1024);
        assert.ok(largeRenders.hotBytes <= 96 * 1024 * 1024);
        assert.ok(largeRenders.hotBytesAfterPlay <= 96 * 1024 * 1024);
        assert.equal(largeRenders.parts, 40);
        assert.equal(largeRenders.ready, true);
        assert.equal(largeRenders.sources, 0);
        assert.equal(largeRenders.storedPlayback, true);
        assert.equal(largeRenders.playing, true);
        assert.ok(largeRenders.power > .000001);
        assert.equal(largeRenders.stopped, true);
        assert.equal(largeRenders.restoredGain, true);
        assert.equal(largeRenders.budget, 0);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ ...result, reloadFromLocalStorage: true, largeRenders }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
