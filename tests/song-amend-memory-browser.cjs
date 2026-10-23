// Real sequential WAV decoding + IndexedDB Float32 rollback, local disposable accounts only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18919/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        if (process.env.AMEND_ENGINE && process.env.AMEND_ENGINE !== engine) continue;
        const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
            assert.equal((await context.request.post(base + 'api/auth/register', { data: { username: `amendedit_${engine[0]}_${Date.now()}`, password: 'isolated-editor-checkpoint' } })).status(), 200);
            const page = await context.newPage(), errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
            await page.goto(base);
            await page.waitForFunction(() => window.mygrainSongBeta && window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
            await page.evaluate(() => mygrainCardHistory.ready);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
            const report = await page.evaluate(async () => {
                const c = mygrainSongBeta, k = mygrainKMultitrack;
                stopAllPerformancePlayback({ silent: true });
                await mygrainQ.prepareCapture();
                document.getElementById('songBetaName').value = 'Bounded editing fixture'; await c.newSong();
                // Lower than the production 96 MiB guard: force the checkpoint
                // branch with modest real buffers, without relying on process OOM.
                c.memoryBudget.limitBytes = 38 * 1048576;
                const fill = seed => {
                    for (let track = 0; track < 3; track++) {
                        const buffer = audioContext.createBuffer(2, 524288, 48000);
                        for (let channel = 0; channel < 2; channel++) {
                            const pcm = buffer.getChannelData(channel);
                            for (let frame = 0; frame < pcm.length; frame++) pcm[frame] = .1234567 * Math.sin((frame + seed) * (track + 1) * .007 + channel * .15);
                        }
                        k.setBuffer(track, buffer);
                        Object.assign(k.tracks[track], { steps: 87 + track, sourceBpm: 120, level: .6 - track * .1, pan: (track - 1) * .5 });
                    }
                    k.refreshBuffers();
                };
                fill(0); await c.newPart({ name: 'Native-rate K tracks', repeats: 1 });
                const expectedUndo = await hashLive();
                await mygrainCardHistory.runDraftEdit('Unsaved exact Float32 sources', () => fill(700));
                await mygrainCardHistory.flush();
                async function hashLive() {
                    const result = [];
                    for (let track = 0; track < 3; track++) {
                        const buffer = k.getBuffer(track);
                        const hashes = [];
                        for (let channel = 0; channel < 2; channel++) hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer.getChannelData(channel))), x => x.toString(16).padStart(2, '0')).join(''));
                        result.push({ sampleRate: buffer.sampleRate, length: buffer.length, hashes, level: k.tracks[track].level, pan: k.tracks[track].pan, steps: k.tracks[track].steps });
                    }
                    return result;
                };
                const before = await hashLive(), counts = mygrainCardHistory.counts;
                let checkpoints = 0, restores = 0, originalGets = 0;
                const detach = c.adapter.detachEditingSources.bind(c.adapter);
                c.adapter.detachEditingSources = () => { checkpoints++; return detach(); };
                const restore = MygrainSongStorage.EditCheckpoint.prototype.restore;
                MygrainSongStorage.EditCheckpoint.prototype.restore = async function (...args) { restores++; return restore.apply(this, args); };
                const request = c.request.bind(c), samples = [];
                const monitor = setInterval(() => samples.push(c.memoryBudget.bytes + c.renderBytes), 5);
                const failures = [];
                for (const mode of ['corrupt', 'cancel', 'quota']) {
                    const save = MygrainSongStorage.EditCheckpoint.prototype.save;
                    let reads = 0;
                    if (mode === 'quota') MygrainSongStorage.EditCheckpoint.prototype.save = async () => { throw new Error('Injected checkpoint storage quota failure'); };
                    c.request = async (path, options) => {
                        if (/\/parts\/[a-f0-9]{32}$/.test(path)) originalGets++;
                        const result = await request(path, options);
                        if (path.includes('/audio?') && ++reads === 1) {
                            if (mode === 'corrupt') new Uint8Array(result)[44] ^= 1;
                            if (mode === 'cancel') c.cancel(true, { hardCut: true });
                        }
                        return result;
                    };
                    c.active = null;
                    let error;
                    try { await c.amendPart(c.song.parts[0]); } catch (failure) { error = { name: failure.name, message: failure.message }; }
                    MygrainSongStorage.EditCheckpoint.prototype.save = save; c.request = request;
                    if (!error) throw new Error(`${mode} failed to interrupt loading`);
                    const after = await hashLive();
                    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`${mode} changed unsaved PCM/settings`);
                    if (c.memoryBudget.bytes || c.cache.size || c.audioCache.bytes || c.editing) throw new Error(`${mode} leaked state`);
                    failures.push({ mode, error, reads });
                }
                c.active = null; await c.amendPart(c.song.parts[0]);
                const part = c.song.parts[0];
                const manifest = await c.request(`/${c.song.id}/parts/${part.id}/manifest?sha256=${part.sha256}`);
                const captured = await c.adapter.capture(), entries = parseStoredZipEntries(await captured.arrayBuffer());
                for (const asset of manifest.audioAssets) {
                    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', entries.get(asset.path))), x => x.toString(16).padStart(2, '0')).join('');
                    if (hash !== asset.sha256) throw new Error(`Source PCM changed for ${asset.key}`);
                }
                const voices = [];
                k.restoreSettings(c.adapter.inspectSnapshot(manifest.snapshot).snapshot.state.modes);
                bastardLoopKEnabled = true; bastardLoopPlaying = true;
                startBastardLoopK(audioContext.currentTime + .1);
                for (const [index, voice] of k.voices) voices.push({ index, sampleRate: voice.source.buffer.sampleRate, loop: voice.source.loop, end: voice.source.loopEnd });
                stopBastardLoopK();
                await c.savePart(); c.active = null; await c.amendPart(c.song.parts[0]); c.cancelAmendment();
                clearInterval(monitor);
                const databases = await indexedDB.databases();
                return { expectedUndo, failures, checkpoints, restores, originalGets, voices, countsBefore: counts, countsAfter: mygrainCardHistory.counts,
                    budget: c.memoryBudget.limitBytes, peak: Math.max(...samples), memory: c.memoryBudget.bytes, cache: c.cache.size,
                    audioCache: c.audioCache.bytes, temporaryDatabases: databases.filter(db => db.name.includes('mygrain-edit-checkpoint-')).length,
                    revision: c.song.revision, sourceCount: manifest.audioAssets.length };
            });
            assert.equal(report.restores, 2); assert.ok(report.checkpoints >= 5, JSON.stringify(report));
            assert.equal(report.originalGets, 0); assert.ok(report.peak <= report.budget, JSON.stringify(report));
            assert.deepEqual(report.countsAfter, report.countsBefore);
            for (const key of ['memory', 'cache', 'audioCache', 'temporaryDatabases']) assert.equal(report[key], 0, key);
            assert.equal(report.voices.length, 3); assert.ok(report.voices.every(voice => voice.loop && voice.sampleRate === 48000));
            assert.equal(report.failures[1].error.name, 'AbortError');
            // Exercise the actual mobile Amend/Cancel buttons as well as the
            // controller failure paths above, then hydrate the parked Undo PCM.
            await page.evaluate(() => { mygrainSongBeta.active = null; mygrainSongBeta.render(); });
            await page.locator('.song-beta-amend').first().tap();
            await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.editing);
            await page.locator('#songBetaCancelEdit').tap();
            const undo = await page.evaluate(async () => {
                await mygrainCardHistory.undo();
                const pcm = [];
                for (let track = 0; track < 3; track++) {
                    const buffer = mygrainKMultitrack.getBuffer(track), hashes = [];
                    for (let channel = 0; channel < 2; channel++) hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer.getChannelData(channel))), x => x.toString(16).padStart(2, '0')).join(''));
                    const t = mygrainKMultitrack.tracks[track];
                    pcm.push({ sampleRate: buffer.sampleRate, length: buffer.length, hashes, level: t.level, pan: t.pan, steps: t.steps });
                }
                return { pcm, counts: mygrainCardHistory.counts, memory: mygrainSongBeta.memoryBudget.bytes };
            });
            assert.deepEqual(undo.pcm, report.expectedUndo);
            assert.deepEqual(undo.counts, { undo: 0, redo: 1 }); assert.equal(undo.memory, 0);
            report.uiAmendAndUndo = true; delete report.expectedUndo;
            assert.deepEqual(errors, []);
            results.push({ engine, ...report }); console.log('PASS', engine, JSON.stringify(report));
            await context.close();
        } finally { await browser.close(); }
    }
    fs.writeFileSync('/tmp/mygrain-amend-memory-browser-results.json', JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
