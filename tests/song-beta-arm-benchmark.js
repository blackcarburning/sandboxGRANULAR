const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
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
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        const results = await page.evaluate(async () => {
            syncPatternLengthControls(8, { skipSave: true });
            applyGlobalBpm(60);
            const source = audioContext.createBuffer(1, audioContext.sampleRate * 4, audioContext.sampleRate);
            const samples = source.getChannelData(0);
            for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(2 * Math.PI * 220 * index / source.sampleRate) * .2;
            bastardLoopBuffer = source;
            bastardLoopSourceBpm = 60;
            bastardLoopEnabled = true;
            seqGrainsEnabled = false;
            document.getElementById('seqGrainsEnabled').checked = false;
            saveState();
            const body = await mygrainSongBetaAdapter.capture();
            const results = [];
            const render = mygrainSongBetaAdapter.renderPart;
            let active = 0;
            let peak = 0;
            mygrainSongBetaAdapter.renderPart = async (...args) => {
                peak = Math.max(peak, ++active);
                try { return await render(...args); }
                finally { active -= 1; }
            };
            for (const concurrency of [1, 2, 1, 2]) {
                const created = await mygrainSongBeta.request('', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Arm benchmark ${concurrency} ${results.length}` })
                });
                let song = created.song;
                for (const name of ['Intro', 'Verse']) {
                    song = (await mygrainSongBeta.request(`/${song.id}/parts?name=${name}&repeats=1`, {
                        method: 'POST', headers: { 'Content-Type': 'application/zip' }, body
                    })).song;
                }
                mygrainSongBeta.acceptSong(song);
                mygrainSongBeta.armConcurrency = concurrency;
                peak = 0;
                const started = performance.now();
                await mygrainSongBeta.arm();
                const milliseconds = performance.now() - started;
                const audio = [...mygrainSongBeta.renders.values()].map(buffer => {
                    const channel = buffer.getChannelData(0);
                    let power = 0;
                    let silent = 0;
                    let longestSilence = 0;
                    for (const sample of channel) {
                        power += sample * sample;
                        silent = Math.abs(sample) < .00001 ? silent + 1 : 0;
                        longestSilence = Math.max(longestSilence, silent);
                    }
                    return { duration: buffer.duration, rms: Math.sqrt(power / channel.length), silenceSeconds: longestSilence / buffer.sampleRate };
                });
                const memory = mygrainSongBeta.audioCache.bytes + mygrainSongBeta.renderBytes;
                const warmStarted = performance.now();
                await mygrainSongBeta.arm();
                const warmMilliseconds = performance.now() - warmStarted;
                results.push({ concurrency, milliseconds, warmMilliseconds, peak, audio, memory, sources: mygrainSongBeta.audioCache.buffers.size, bridges: __mygrainSongRenderBridges.size });
            }
            return results;
        });
        for (const result of results) {
            assert.equal(result.peak, result.concurrency);
            assert.equal(result.sources, 1);
            assert.equal(result.bridges, 0);
            assert.equal(result.audio.length, 2);
            for (const audio of result.audio) {
                assert.equal(audio.duration, 2);
                assert.ok(audio.rms > .001, `Silent render: ${JSON.stringify(result)}`);
                assert.ok(audio.silenceSeconds < .05, `Render gap: ${JSON.stringify(result)}`);
            }
        }
        assert.deepEqual(errors, []);
        console.log(JSON.stringify(results, null, 2));
        const sequential = results[2].milliseconds;
        const parallel = results[3].milliseconds;
        console.log(`PASS: Warmed-engine comparison: sequential ${(sequential / 1000).toFixed(2)}s, parallel ${(parallel / 1000).toFixed(2)}s (${(100 * (1 - parallel / sequential)).toFixed(1)}% faster); exact 2s non-silent renders with no >50ms gaps.`);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
