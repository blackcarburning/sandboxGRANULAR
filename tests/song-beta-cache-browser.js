const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
const workers = Number(process.env.SONG_BETA_CACHE_WORKERS || 10);
assert.ok(Number.isInteger(workers) && workers >= 1 && workers <= 10);
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) {
    throw new Error('Set SONG_BETA_TEST_URL to an isolated localhost test server /mygrain/ route.');
}

(async () => {
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        await page.selectOption('#songBetaArmConcurrency', String(workers));
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        assert.equal(await page.locator('#songBetaArmConcurrency').inputValue(), String(workers));
        assert.equal(await page.evaluate(() => mygrainSongBeta.armConcurrency), workers);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        const prepared = await page.evaluate(async () => {
            syncPatternLengthControls(8, { skipSave: true });
            applyGlobalBpm(300);
            const source = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
            const samples = source.getChannelData(0);
            for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(2 * Math.PI * 220 * index / source.sampleRate) * .2;
            bastardLoopBuffer = source;
            bastardLoopSourceBpm = 300;
            bastardLoopEnabled = true;
            setGranularLayersEnabled(false, { silent: true, skipSave: true });
            seqGrainsEnabled = false;
            document.getElementById('seqGrainsEnabled').checked = false;
            saveState();
            const body = await mygrainSongBetaAdapter.capture();
            let song = (await mygrainSongBeta.request('', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ten-worker cache fixture' })
            })).song;
            for (let index = 0; index < 12; index += 1) {
                song = (await mygrainSongBeta.request(`/${song.id}/parts?name=Part-${index}&repeats=1`, {
                    method: 'POST', headers: { 'Content-Type': 'application/zip' }, body
                })).song;
            }
            mygrainSongBeta.acceptSong(song);
            const original = mygrainSongBetaAdapter.renderPart;
            window.cacheFixture = { active: 0, peak: 0, renders: [], body };
            mygrainSongBetaAdapter.renderPart = async (...args) => {
                cacheFixture.peak = Math.max(cacheFixture.peak, ++cacheFixture.active);
                cacheFixture.renders.push(args[1].id);
                try { return await original(...args); }
                finally { cacheFixture.active -= 1; }
            };
            const started = performance.now();
            await mygrainSongBeta.arm();
            mygrainSongBeta.render();
            return {
                id: song.id,
                peak: cacheFixture.peak,
                rendered: cacheFixture.renders.length,
                milliseconds: performance.now() - started,
                armed: mygrainSongBeta.armed,
                frame: document.querySelectorAll('iframe[title="Isolated song audio renderer"]').length,
                bridges: __mygrainSongRenderBridges.size,
                memory: mygrainSongBeta.audioCache.bytes + mygrainSongBeta.renderBytes,
                audio: [...mygrainSongBeta.renders.values()].map(buffer => {
                    const samples = buffer.getChannelData(0);
                    let power = 0;
                    let silent = 0;
                    let longestSilence = 0;
                    for (const sample of samples) {
                        power += sample ** 2;
                        silent = Math.abs(sample) < .00001 ? silent + 1 : 0;
                        longestSilence = Math.max(longestSilence, silent);
                    }
                    return { duration: buffer.duration, rms: Math.sqrt(power / samples.length), silenceSeconds: longestSilence / buffer.sampleRate };
                })
            };
        });
        assert.equal(prepared.peak, workers);
        assert.equal(prepared.rendered, 12);
        assert.equal(prepared.armed, true);
        assert.equal(prepared.frame, 0);
        assert.equal(prepared.bridges, 0);
        assert.ok(prepared.memory < 256 * 1024 * 1024);
        assert.ok(prepared.audio.every(audio => Math.abs(audio.duration - .4) < .001 && audio.rms > .001), JSON.stringify(prepared));
        if (workers <= 2) assert.ok(prepared.audio.every(audio => audio.silenceSeconds < .05), JSON.stringify(prepared));
        const longSilences = prepared.audio.filter(audio => audio.silenceSeconds >= .05).length;
        if (longSilences) console.warn(`EXPERIMENTAL: ${longSilences} renders contained >=50ms silence with ${workers} workers. Lower the worker count if playback has gaps.`);
        assert.equal(await page.locator('.song-beta-cache-state').filter({ hasText: /^Ready$/ }).count(), 12);
        assert.match(await page.locator('#songBetaCacheSummary').textContent(), /12 ready · 0 to prepare/);
        page.once('dialog', dialog => dialog.accept('Renamed fixture'));
        await page.click('#songBetaRenameSong');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.name === 'Renamed fixture');
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.id), prepared.id);
        assert.equal(await page.evaluate(() => mygrainSongBeta.armed), true);
        const partsRequests = [];
        page.on('request', request => { if (request.url().includes('/parts/')) partsRequests.push(request.url()); });
        const metadata = await page.evaluate(async () => {
            await mygrainSongBeta.setRepeats(mygrainSongBeta.song.parts[0], 3);
            await mygrainSongBeta.arrange(mygrainSongBeta.song.parts[1], -1);
            await mygrainSongBeta.arm();
            return { renders: cacheFixture.renders.length, armed: mygrainSongBeta.armed };
        });
        assert.equal(metadata.renders, 12);
        assert.equal(metadata.armed, true);
        assert.deepEqual(partsRequests, []);
        const unchanged = await page.evaluate(async () => {
            const part = mygrainSongBeta.song.parts[0];
            const decoded = mygrainSongBeta.cache.get(part.id);
            const rendered = mygrainSongBeta.renders.get(part.id);
            const entries = parseStoredZipEntries(new Uint8Array(await cacheFixture.body.arrayBuffer()));
            const snapshot = JSON.parse(getZipText(entries, 'song-part.json'));
            snapshot.createdAt = new Date().toISOString();
            snapshot.state.timestamp += 1000;
            const body = await createStoredZip([...entries].map(([path, data]) => ({ path, data: path === 'song-part.json' ? JSON.stringify(snapshot) : data })));
            const result = await mygrainSongBeta.request(`/${mygrainSongBeta.song.id}/parts/${part.id}/save?sha256=${part.sha256}`, {
                method: 'POST', headers: { 'Content-Type': 'application/zip' }, body
            });
            mygrainSongBeta.acceptSong(result.song);
            await mygrainSongBeta.arm();
            return { sameDecoded: mygrainSongBeta.cache.get(part.id) === decoded, sameRender: mygrainSongBeta.renders.get(part.id) === rendered, renders: cacheFixture.renders.length };
        });
        assert.deepEqual(unchanged, { sameDecoded: true, sameRender: true, renders: 12 });
        const changed = await page.evaluate(async () => {
            const part = mygrainSongBeta.song.parts[0];
            const entries = parseStoredZipEntries(new Uint8Array(await cacheFixture.body.arrayBuffer()));
            const snapshot = JSON.parse(getZipText(entries, 'song-part.json'));
            snapshot.state.globalBpm = '240';
            const body = await createStoredZip([...entries].map(([path, data]) => ({ path, data: path === 'song-part.json' ? JSON.stringify(snapshot) : data })));
            const result = await mygrainSongBeta.request(`/${mygrainSongBeta.song.id}/parts/${part.id}/save?sha256=${part.sha256}`, {
                method: 'POST', headers: { 'Content-Type': 'application/zip' }, body
            });
            mygrainSongBeta.acceptSong(result.song);
            mygrainSongBeta.render();
            const pending = document.getElementById('songBetaCacheSummary').textContent;
            const label = document.querySelector('.song-beta-cache-state').textContent;
            await mygrainSongBeta.arm();
            mygrainSongBeta.render();
            return { pending, label, lastRender: cacheFixture.renders.at(-1), id: part.id, renders: cacheFixture.renders.length, armed: mygrainSongBeta.armed };
        });
        assert.match(changed.pending, /11 ready · 1 to prepare/);
        assert.equal(changed.label, 'Changed');
        assert.equal(changed.renders, 13);
        assert.equal(changed.lastRender, changed.id);
        assert.equal(changed.armed, true);
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        assert.equal(await page.locator('#songBetaArmConcurrency').inputValue(), String(workers));
        assert.equal(await page.locator('#songBetaSongs option:checked').textContent(), 'Renamed fixture');
        assert.equal(await page.locator('.song-beta-cache-state').filter({ hasText: /^Saved$/ }).count(), 12);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        await page.evaluate(async () => {
            mygrainSongBetaAdapter.renderPart = () => { throw new Error('Reload should load existing server renders'); };
            await mygrainSongBeta.arm();
            mygrainSongBeta.render();
        });
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            await page.locator('#songBetaCard').scrollIntoViewIfNeeded();
            const overflowing = await page.locator('#songBetaCard').evaluate(card => card.scrollWidth > card.clientWidth + 2);
            assert.equal(overflowing, false, `${width}px song card overflows`);
        }
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ workers, preparation: prepared, longSilences, unchanged, changed, reloadReuse: true, layouts: [1440, 390, 320] }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
