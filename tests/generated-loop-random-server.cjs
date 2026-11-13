'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:19271/mygrain/';
const out = process.env.MYGRAIN_TEST_OUTPUT || '/tmp/mygrain-generated-loop-random';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
fs.mkdirSync(out, { recursive: true });
(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const context = await browser.newContext(), page = await context.newPage(), errors = [], jobs = [];
        page.setDefaultTimeout(90000);
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => {
            if (request.method() === 'POST' && request.url().includes('/server-arm?')) jobs.push(request.url());
        });
        await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin
            ? route.continue() : route.abort());
        assert.equal((await context.request.post(base + 'api/auth/login', {
            data: { username: 'admin', password: 'isolated-vst3-test' }
        })).status(), 200);
        await page.goto(base);
        await page.waitForFunction(() => window.mygrainSongBetaAdapter && document.documentElement.dataset.mygrainStartup === 'ready');
        await page.evaluate(() => mygrainCardHistory.ready);
        await page.locator('#start-btn').click();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
        const initial = await page.evaluate(async () => {
            stopAllPerformancePlayback({ silent: true }); clearAllPerformanceSoloStates({ silent: true });
            setFxMuted(true, { silent: true }); setFilterEnabled('lpf', false); setFilterEnabled('hpf', false);
            for (const id of ['reverb', 'distortion', 'noiseMix', 'finalDriveSoft', 'finalDriveHard', 'finalDriveFold',
                'finalDriveCrush', 'finalCompressorAmount', 'finalSidechainAmount', 'delayMix', 'delayFeedback',
                'finalDelayDepth', 'finalReverbMix', 'oscNoiseLevel']) setSliderValue(id, 0);
            for (const layer of SPARSE_RANDOM_LAYER_DEFINITIONS) layer.setEnabled(false, { silent: true, skipSave: true });
            setDrumMachineEnabled(false, { silent: true, skipSave: true });
            await mygrainWasp.restore(null); await mygrainTurntable.off(); await mygrainResonator.off();
            mygrainNoise.restore({ enabled: false }); mygrainChannelEq.restore();
            applyGlobalBpm(240); syncPatternLengthControls(16, { skipSave: true });
            // Use actual generated PCM, then save the established On/Off flags unchanged.
            await generateRandomSourceSample();
            setSliderValue('performanceGeneratedDryMix', 50);
            setGeneratedDryLoopEnabled(true, { silent: true, skipSave: true });
            document.getElementById('songBetaName').value = 'Generated loop gate isolated';
            const song = mygrainSongBeta;
            await song.newSong(); await song.newPart({ name: 'Saved Loop On', repeats: 1 });
            setGeneratedDryLoopEnabled(false, { silent: true, skipSave: true });
            await song.newPart({ name: 'Saved Loop Off', repeats: 1 }); await song.finishEditing();
            song.serverPreparation = true; song.phonePreparation = true;
            return { hashes: song.song.parts.map(part => part.sha256), revision: song.song.revision };
        });
        const result = await page.evaluate(async () => {
            const song = mygrainSongBeta; await song.arm();
            if (!song.armed) throw Error(document.getElementById('songBetaStatus').textContent);
            const renders = [];
            for (const part of song.song.parts) {
                const buffer = await song.loadRender(part); let sum = 0;
                for (const sample of buffer.getChannelData(0)) {
                    if (!Number.isFinite(sample)) throw Error('Invalid rendered PCM'); sum += sample * sample;
                }
                renders.push({ name: part.name, frames: buffer.length, rms: Math.sqrt(sum / buffer.length), sha: part.render.sha256 });
            }
            await song.arm(); await song.playSong();
            await new Promise(resolve => setTimeout(resolve, 180));
            const playing = song.playing; song.stop();
            return { renders, playing, hashes: song.song.parts.map(part => part.sha256),
                revision: song.song.revision, reserved: song.memoryBudget.bytes };
        });
        assert.equal(jobs.length, 2, 'warm reuse must not start more jobs');
        assert(result.renders[0].rms > 1e-5, 'saved On is audible');
        assert(result.renders[1].rms < 1e-7, 'saved Off stays silent');
        assert(result.renders.every(render => render.frames > 0)); assert(result.playing);
        assert.equal(result.reserved, 0); assert.deepEqual(result.hashes, initial.hashes);
        assert.equal(result.revision, initial.revision); assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(out, 'generated-loop-server.json'), JSON.stringify({ initial, result, jobs: jobs.length, errors }, null, 2));
        console.log('PASS generated-loop On/Off real server jobs, PCM gate, warm reuse, phone playback, unchanged source hashes/revision');
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
