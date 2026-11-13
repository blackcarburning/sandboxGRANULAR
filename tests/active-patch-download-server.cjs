'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:19281/mygrain/';
const out = process.env.MYGRAIN_TEST_OUTPUT || '/tmp/mygrain-active-patch-download';
const files = process.env.MYGRAIN_PATCH_FIXTURES || path.join(out, 'staged');
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
fs.mkdirSync(out, { recursive: true });
(async () => {
    const original = fs.readFileSync(path.join(files, 'chromium-desktop-original.zip'));
    const trimmed = fs.readFileSync(path.join(files, 'chromium-desktop-download.zip'));
    const browser = await chromium.launch({ executablePath: '/snap/chromium/current/usr/lib/chromium-browser/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const context = await browser.newContext(), page = await context.newPage(), errors = [], jobs = [];
        page.setDefaultTimeout(90000);
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/server-arm?')) jobs.push(request.url()); });
        await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
        assert.equal((await context.request.post(base + 'api/auth/login', {
            data: { username: 'admin', password: 'isolated-vst3-test' }
        })).status(), 200);
        await page.goto(base);
        await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready' && window.mygrainSongBetaAdapter);
        await page.evaluate(() => mygrainCardHistory.ready); await page.locator('#start-btn').click();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
        const initial = await page.evaluate(async ({ original, trimmed }) => {
            const song = mygrainSongBeta;
            async function load(bytes) {
                const decoded = await mygrainSongBetaAdapter.decode(new Uint8Array(bytes).buffer,
                    { buffers: new Map(), bytes: 0, reservedBytes: 0, limitBytes: 256 * 1048576 });
                mygrainSongBetaAdapter.recall(decoded, { start: false });
                await mygrainSongBetaAdapter.whenPersisted();
                await Promise.all([mygrainWasp.whenReady(), mygrainTurntable.whenReady(), mygrainResonator.whenReady()]);
            }
            await load(original);
            document.getElementById('songBetaName').value = 'Active patch download isolated';
            await song.newSong(); await song.newPart({ name: 'Existing complete snapshot', repeats: 1 });
            await load(trimmed); await song.newPart({ name: 'Downloaded drums only', repeats: 1 });
            await load(original); await song.newPart({ name: 'Complete snapshot repeat control', repeats: 1 });
            await song.finishEditing(); song.serverPreparation = true; song.phonePreparation = true;
            return { hashes: song.song.parts.map(part => part.sha256), revision: song.song.revision };
        }, { original: [...original], trimmed: [...trimmed] });
        const result = await page.evaluate(async () => {
            const song = mygrainSongBeta; await song.arm();
            if (!song.armed) throw Error(document.getElementById('songBetaStatus').textContent);
            const buffers = [], renders = [];
            for (const part of song.song.parts) {
                const buffer = await song.loadRender(part); buffers.push(buffer); let sum = 0;
                for (const sample of buffer.getChannelData(0)) {
                    if (!Number.isFinite(sample)) throw Error('Invalid rendered PCM'); sum += sample * sample;
                }
                renders.push({ name: part.name, frames: buffer.length, rms: Math.sqrt(sum / buffer.length), sha: part.render.sha256 });
            }
            if (buffers[0].length !== buffers[1].length) throw Error('Trimmed render length changed');
            const differences = [1, 2].map(index => {
                let difference = 0, maxDifference = 0;
                for (let channel = 0; channel < 2; channel++) {
                    const a = buffers[0].getChannelData(channel), b = buffers[index].getChannelData(channel);
                    for (let i = 0; i < a.length; i++) { const error = a[i] - b[i]; difference += error * error; maxDifference = Math.max(maxDifference, Math.abs(error)); }
                }
                return { rms: Math.sqrt(difference / (buffers[0].length * 2)), maxDifference };
            });
            await song.arm(); await song.playSong(); await new Promise(resolve => setTimeout(resolve, 180));
            const playing = song.playing; song.stop();
            return { renders, differences, playing,
                hashes: song.song.parts.map(part => part.sha256), revision: song.song.revision, reserved: song.memoryBudget.bytes };
        });
        fs.writeFileSync(path.join(out, 'server.json'), JSON.stringify({ initial, result, jobs: jobs.length, errors }, null, 2));
        assert.equal(jobs.length, 3, 'warm re-arm must reuse all renders');
        assert(result.renders.every(render => render.frames > 0 && render.rms > 1e-5));
        // Realtime server capture is not bit-deterministic at its first attack.
        // Compare trimming against a second unchanged-source render as a control.
        assert(result.differences[0].rms <= Math.max(1 / 32768, result.differences[1].rms * 1.5), JSON.stringify(result));
        assert(Math.abs(result.renders[0].rms - result.renders[1].rms) / result.renders[0].rms < .01);
        assert(result.playing); assert.equal(result.reserved, 0);
        assert.deepEqual(result.hashes, initial.hashes); assert.equal(result.revision, initial.revision); assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(out, 'server.json'), JSON.stringify({ initial, result, jobs: jobs.length, errors }, null, 2));
        console.log('PASS full/trimmed/control real server jobs, drum render comparison, warm reuse, phone playback, source hashes/revisions unchanged');
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
