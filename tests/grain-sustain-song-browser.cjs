const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18930/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/, 'Disposable Songs only');
const evidence = process.env.MYGRAIN_GRAIN_EVIDENCE || '/tmp/mygrain-grain-controls';
fs.mkdirSync(evidence, { recursive: true });
(async () => {
    const results = [];
    for (const [engine, kind] of Object.entries(process.env.MYGRAIN_GRAIN_SERVER ? { chromium } : { chromium, webkit })) {
        const browser = await kind.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            const registration = await context.request.post(base + 'api/auth/register', { data: { username: `gs_song_${engine[0]}_${Date.now()}`, password: 'disposable-grain-song' } });
            assert.equal(registration.status(), 200);
            const page = await context.newPage(), errors = [];
            page.setDefaultTimeout(45000); page.on('pageerror', e => errors.push(e.message));
            await page.goto(base);
            await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
            await page.evaluate(() => mygrainCardHistory.ready);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            const result = await page.evaluate(async forceServer => {
                stopAllPerformancePlayback({ silent: true });
                const source = audioContext.createBuffer(1, audioContext.sampleRate * 4, audioContext.sampleRate);
                for (let i = 0, data = source.getChannelData(0); i < data.length; i++) data[i] = .15 * Math.sin(2 * Math.PI * 65.41 * i / audioContext.sampleRate);
                grainASampleBuffer = source; grainBSampleBuffer = source;
                await prepareGranularKeyboardFromUi(); setKeyboardDecay(0, { skipSave: true }); setHoldEnabled(true);
                const savedControls = { grainAMicGrainPosition: 17, grainAMicGrainScale: 73, grainAMicGrainAttackScale: 41, grainAMicGrainReleaseScale: 187, grainBMicGrainPosition: -13, grainBMicGrainScale: 132, grainBMicGrainAttackScale: 163, grainBMicGrainReleaseScale: 58 };
                Object.entries(savedControls).forEach(([id, value]) => setSliderValue(id, value));
                heldNotes.add('C3'); syncPatternLengthControls(16, { skipSave: true }); applyGlobalBpm(120); saveState();
                const c = mygrainSongBeta;
                document.getElementById('songBetaName').value = 'Disposable smooth-grain cache refresh';
                await c.newSong(); await c.newPart({ name: 'Held granular note', repeats: 1 }); await c.finishEditing();
                let part = c.song.parts[0]; const before = { revision: c.song.revision, sha256: part.sha256 };
                const old = audioContext.createBuffer(2, Math.round(MygrainSongBeta.sourcePartDurationSeconds(part) * audioContext.sampleRate), audioContext.sampleRate);
                old.getChannelData(0).fill(.01); old.getChannelData(1).fill(.01);
                const reply = await c.request(`/${encodeURIComponent(c.song.id)}/parts/${part.id}/render?sha256=${part.sha256}&grain=3&keyboard=1&portable=1`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: c.adapter.encodeRender(old) });
                c.acceptSong(reply.song);
                if (forceServer) { c.abort = new AbortController(); await c.prepareOnServer(c.song.parts[0], c.generation); }
                await c.arm();
                part = c.song.parts[0]; if (!c.armed || part.render.grainVersion !== 4) throw Error('Manual Arm did not upgrade the stale grain render');
                const buffer = await c.loadRender(part), samples = buffer.getChannelData(0), size = Math.round(buffer.sampleRate * .01);
                let silent = 0, blocks = 0, minRms = Infinity;
                for (let at = Math.round(buffer.sampleRate * .4); at + size < samples.length; at += size) {
                    let sum = 0; for (let i = at; i < at + size; i++) sum += samples[i] ** 2;
                    const rms = Math.sqrt(sum / size); minRms = Math.min(minRms, rms); if (rms < .00001) silent++; blocks++;
                }
                const renderHash = part.render.sha256; await c.arm();
                if (c.song.parts[0].render.sha256 !== renderHash) throw Error('A current render was unnecessarily regenerated');
                Object.keys(savedControls).forEach(id => setSliderValue(id, 100));
                await c.recall(part, { start: false });
                for (const [id, value] of Object.entries(savedControls)) if (Number(document.getElementById(id).value) !== value) throw Error(`${id} was not recalled from the saved Song part`);
                return { armed: c.armed, savedControls, grainVersion: part.render.grainVersion, unchangedSource: before.sha256 === part.sha256,
                    unchangedRevision: before.revision === c.song.revision, minRms, silent, blocks, reserved: c.memoryBudget.bytes, serverPrepared: forceServer };
            }, Boolean(process.env.MYGRAIN_GRAIN_SERVER));
            assert.ok(result.armed && result.unchangedSource && result.unchangedRevision && result.grainVersion === 4);
            assert.ok(result.silent === 0 && result.minRms > .00001, JSON.stringify(result));
            assert.equal(result.reserved, 0); assert.deepEqual(errors, []);
            console.log(JSON.stringify({ engine, ...result })); results.push({ engine, ...result });
            await context.close();
        } finally { await browser.close(); }
    }
    fs.writeFileSync(`${evidence}/${process.env.MYGRAIN_GRAIN_SERVER ? 'server-song' : 'song'}-results.json`, JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
