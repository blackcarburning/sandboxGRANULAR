// Real audio, disposable localhost accounts only. ARM_BASELINE=1 records old behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18891/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
const baseline = process.env.ARM_BASELINE === '1';
const evidence = process.env.ARM_EVIDENCE || '/tmp/mygrain-arm-metadata.json';
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
(async () => {
    const results = [];
    for (const engine of process.env.ARM_ENGINE ? [process.env.ARM_ENGINE] : ['chromium', 'webkit']) {
        const browser = await ({ chromium, webkit }[engine]).launch(engine === 'chromium'
            ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            for (const mobile of process.env.ARM_MODE ? [process.env.ARM_MODE === 'phone'] : [false, true]) {
                const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
                    isMobile: mobile, hasTouch: mobile, ...(mobile ? { userAgent: iphone } : {}) });
                assert.equal((await context.request.post(base + 'api/auth/register', { data: {
                    username: `arm_${engine[0]}_${+mobile}_${Date.now()}`, password: 'isolated-arm-check'
                } })).status(), 200);
                const page = await context.newPage(), errors = [], transfers = [];
                page.setDefaultTimeout(90000);
                page.on('pageerror', error => errors.push(error.message));
                await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
                let phase = '';
                page.on('response', response => {
                    const path = new URL(response.url()).pathname;
                    if (phase && /\/parts\/[a-f0-9]{32}(?:\/manifest|\/render)?$/.test(path)) {
                        transfers.push({ phase, path, method: response.request().method(), status: response.status(), bytes: Number(response.headers()['content-length']) || 0 });
                    }
                });
                const start = async () => {
                    await page.waitForFunction(() => window.mygrainSongBeta && document.documentElement.dataset.mygrainStartup === 'ready' && !mygrainSongBeta.busy);
                    if (mobile) await page.locator('#start-btn').tap(); else await page.locator('#start-btn').click();
                    await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
                };
                console.log('START', engine, mobile ? 'iPhone' : 'desktop', baseline ? 'baseline' : 'patched');
                await page.goto(base); await start();
                const fixture = await page.evaluate(async () => {
                    stopAllPerformancePlayback({ silent: true });
                    setLoopLayerSolo('none', { silent: true, skipSave: true });
                    applyGlobalBpm(300); syncPatternLengthControls(16, { skipSave: true });
                    setOscillatorsEnabled(false, { silent: true, skipSave: true });
                    setGranularLayersEnabled(false, { silent: true, skipSave: true });
                    window.mygrainQ.setState?.({ enabled: false });
                    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 8, audioContext.sampleRate);
                    const values = buffer.getChannelData(0);
                    for (let i = 0; i < Math.round(buffer.sampleRate * .055); i++) values[i] = .25 * Math.sin(2 * Math.PI * 433 * i / buffer.sampleRate) * (1 - i / (buffer.sampleRate * .055));
                    await applyLoadedDrumMachineSampleBuffer('snare', buffer, { sourceKey: 'samples_snare', fileName: 'arm-fixture.wav' });
                    drumMachineKickPattern.fill(false); drumMachineSnarePattern.fill(false);
                    drumMachineHatPattern.fill(false); drumMachinePercPattern.fill(false);
                    setDrumMachineDirectOutput(true, { silent: true, skipSave: true });
                    setDrumMachineEnabled(true, { silent: true, skipSave: true });
                    restoreDrumMachineRoll({ length: 32 }); drumMachineRoll.pattern[0] = drumMachineRoll.pattern[31] = true;
                    document.getElementById('songBetaName').value = 'Arm performance fixture';
                    await mygrainSongBeta.newSong();
                    for (const name of ['Intro', 'Ending']) {
                        document.getElementById('songBetaPartName').value = name;
                        await mygrainSongBeta.newPart();
                    }
                    return { id: mygrainSongBeta.song.id, parts: mygrainSongBeta.song.parts.map(p => ({ id: p.id, sha256: p.sha256, bytes: p.bytes })), phone: mygrainSongBeta.phonePreparation };
                });
                assert.equal(fixture.phone, mobile);
                const arm = async label => {
                    phase = label;
                    const result = await page.evaluate(async () => {
                        const before = performance.now(); await mygrainSongBeta.arm();
                        return { ms: performance.now() - before, armed: mygrainSongBeta.armed, workers: mygrainSongBeta.preparationConcurrency(),
                            parts: mygrainSongBeta.song.parts.map(p => ({ id: p.id, sha256: p.sha256, renderHash: p.render.sha256, cycle: p.patternCycleMultiplier,
                                roll: p.render.drumRollVersion, sample: p.render.drumSampleVersion })),
                            audio: [...mygrainSongBeta.renders.values()].map(buffer => {
                                const data = buffer.getChannelData(0), begin = Math.floor(buffer.sampleRate * 1.55), end = Math.floor(buffer.sampleRate * 1.59);
                                let power = 0; for (let i = begin; i < end; i++) power += data[i] ** 2;
                                return { duration: buffer.duration, ending: power / (end - begin) };
                            }) };
                    });
                    phase = '';
                    assert.equal(result.armed, true); assert.equal(result.workers, mobile ? 1 : 2);
                    assert.equal(result.audio.length, 2);
                    for (const audio of result.audio) { assert(Math.abs(audio.duration - 1.6) < .001); assert(audio.ending > 1e-7, JSON.stringify(audio)); }
                    for (const p of result.parts) { assert.equal(p.cycle, 2); assert.equal(p.roll, 1); assert.equal(p.sample, 1); }
                    return result;
                };
                const cold = await arm('cold');
                const warm = await arm('warm');
                assert.deepEqual(warm.parts, cold.parts);
                await page.evaluate(async () => { await mygrainSongBeta.finishEditing(); await mygrainSongBetaAdapter.whenPersisted(); saveState({ force: true }); });
                await page.reload(); await start();
                const reload = await arm('reload');
                assert.deepEqual(reload.parts, cold.parts);
                const requestCount = (label, kind) => transfers.filter(t => t.phase === label && t.method === 'GET' && (kind === 'source' ? /\/parts\/[a-f0-9]{32}$/.test(t.path) : t.path.endsWith('/' + kind))).length;
                const counts = Object.fromEntries(['cold', 'warm', 'reload'].map(label => [label, {
                    sources: requestCount(label, 'source'), manifests: requestCount(label, 'manifest'), renders: requestCount(label, 'render'),
                    bytes: transfers.filter(t => t.phase === label && t.method === 'GET').reduce((n, t) => n + t.bytes, 0)
                }]));
                if (!baseline) {
                    assert.equal(counts.cold.sources, 2); assert.equal(counts.cold.manifests, 2);
                    assert.equal(counts.reload.sources, 0); assert.equal(counts.reload.manifests, 2);
                }
                assert.equal(counts.warm.sources, 0); assert.equal(counts.warm.manifests, 0);
                assert(!transfers.some(t => t.phase === 'reload' && t.method === 'POST'), 'Reload must not regenerate or mutate saved parts');
                let legacy;
                if (!baseline && engine === 'chromium' && mobile) {
                    legacy = await page.evaluate(async () => {
                        const controller = mygrainSongBeta, source = controller.song.parts[0];
                        const body = await controller.request(`/${controller.song.id}/parts/${source.id}`, { binary: true });
                        const entries = parseStoredZipEntries(body), snapshot = JSON.parse(getZipText(entries, 'song-part.json'));
                        if (snapshot.assets.some(a => /^bastardK/.test(a.key))) throw new Error('Legacy fixture must have an empty K lane');
                        for (const group of ['modes', 'sliders', 'selects']) {
                            for (const key of Object.keys(snapshot.state[group] || {})) if (/bastard(?:Loop)?K/i.test(key)) delete snapshot.state[group][key];
                        }
                        delete snapshot.extra.audioSlots.bastardK; delete snapshot.extra.audioSlots.bastardKRender;
                        delete snapshot.extra.metadata.bastardK;
                        snapshot.extra.controls = snapshot.extra.controls.filter(control => !/bastard(?:Loop)?K/i.test(control.id));
                        const legacyZip = await createStoredZip([...entries].map(([path, data]) => ({ path, data: path === 'song-part.json' ? JSON.stringify(snapshot) : data })));
                        document.getElementById('songBetaName').value = 'Legacy Arm fixture';
                        await controller.newSong(); await controller.ensureEditing();
                        const result = await controller.request(`/${controller.song.id}/parts?name=Legacy&repeats=1`, {
                            method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: legacyZip
                        });
                        controller.acceptSong(result.song);
                        const before = controller.song.parts[0].sha256;
                        const info = await controller.readPartMetadata(controller.song.parts[0]);
                        if (!info.upgrade?.lanes.includes('K')) throw new Error('Metadata did not discover the legacy K upgrade');
                        await controller.arm();
                        const part = controller.song.parts[0];
                        const after = await controller.request(`/${controller.song.id}/parts/${part.id}`, { binary: true });
                        const upgraded = mygrainSongBetaAdapter.inspectPart(after), savedEntries = parseStoredZipEntries(after);
                        const audioUnchanged = snapshot.assets.every(asset => {
                            const a = entries.get(asset.path), b = savedEntries.get(asset.path);
                            return a.length === b.length && a.every((value, i) => value === b[i]);
                        });
                        return { armed: controller.armed, changed: before !== part.sha256, audioUnchanged,
                            upgradePending: Boolean(upgraded.upgrade), emptyK: upgraded.snapshot.extra.audioSlots.bastardK === false };
                    });
                    assert.deepEqual(legacy, { armed: true, changed: true, audioUnchanged: true, upgradePending: false, emptyK: true });
                }
                assert.deepEqual(errors, []);
                results.push({ engine, mobile, baseline, fixture, cold, warm, reload, counts, transfers, legacy });
                fs.writeFileSync(evidence, JSON.stringify(results, null, 2));
                console.log('PASS', engine, mobile ? 'iPhone' : 'desktop', JSON.stringify({ cold: cold.ms, warm: warm.ms, reload: reload.ms, counts }));
                await context.close();
            }
        } finally { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
