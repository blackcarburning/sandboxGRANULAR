// Real saved ZIPs and server-side merges; disposable localhost accounts only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18916/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        if (process.env.MYGRAIN_TEST_ENGINE && process.env.MYGRAIN_TEST_ENGINE !== engine) continue;
        const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            for (const mobile of [false, true]) {
                const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile });
                assert.equal((await context.request.post(base + 'api/auth/register', { data: { username: `multicopy_${engine[0]}_${+mobile}_${Date.now()}`, password: 'isolated-multi-copy' } })).status(), 200);
                const page = await context.newPage(), errors = [], writes = [];
                page.setDefaultTimeout(60000);
                page.on('pageerror', error => errors.push(error.message));
                page.on('request', request => { if (request.method() === 'POST' && request.url().startsWith(base + 'api/songs')) writes.push(new URL(request.url()).pathname); });
                await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
                const press = selector => mobile ? page.locator(selector).tap() : page.locator(selector).click();
                await page.goto(base);
                await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy && document.documentElement.dataset.mygrainStartup === 'ready');
                await press('#start-btn');
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                await page.evaluate(async () => {
                    stopAllPerformancePlayback({ silent: true });
                    setGeneratedLoopTransportEnabled(false, { silent: true, skipSave: true });
                    setOscillatorsEnabled(false, { silent: true, skipSave: true });
                    setGranularLayersEnabled(false, { silent: true, skipSave: true });
                    setArpeggiatorEnabled(false); mygrainQ.setEnabled(false);
                    seqGrainsEnabled = false; document.getElementById('seqGrainsEnabled').checked = false;
                    setLoopLayerSolo('none', { silent: true, skipSave: true });
                    document.getElementById('songBetaName').value = 'Multi-copy acceptance';
                    const c = mygrainSongBeta; await c.newSong();
                    const tone = hz => {
                        const buffer = audioContext.createBuffer(1, audioContext.sampleRate / 4, audioContext.sampleRate);
                        for (let i = 0; i < buffer.length; i++) buffer.getChannelData(0)[i] = .1 * Math.sin(2 * Math.PI * hz * i / buffer.sampleRate);
                        return buffer;
                    };
                    for (const tag of [1, 2, 3]) {
                        applyGlobalBpm(tag === 1 ? 300 : 240); syncPatternLengthControls(16, { skipSave: true });
                        bastardLoopVBuffer = tone(220 * tag); bastardLoopVMetadata = { bpm: 240, durationSeconds: .25, sampleNames: [`v-${tag}.wav`] };
                        setBastardLoopVEnabled(true, { silent: true, skipSave: true });
                        bastardLoopMRawBuffer = tone(330 * tag); bastardLoopMBuffer = tone(440 * tag); bastardLoopMMetadata = { durationSeconds: .25, summary: `M ${tag}` };
                        setBastardLoopMEnabled(true, { silent: true, skipSave: true });
                        for (const [i, kind] of ['kick', 'snare', 'hat', 'perc', 'clap', 'cymbals', 'etc'].entries()) {
                            await applyLoadedDrumMachineSampleBuffer(kind, tone(150 + tag * 200 + i * 30), { fileName: `${kind}-${tag}.wav`, sourceKey: DRUM_MACHINE_SOURCE_KEYS[kind] });
                            const pattern = Array(16).fill(false); pattern[(i + tag) % 16] = true;
                            setDrumMachinePattern(kind, pattern, { skipSave: true });
                            const id = `drumMachine${kind === 'hat' ? 'HatTune' : kind[0].toUpperCase() + kind.slice(1) + 'Pitch'}`;
                            const slider = document.getElementById(id); if (slider) { slider.value = String(tag); slider.dispatchEvent(new Event('input', { bubbles: true })); }
                        }
                        setDrumMachineDirectOutput(true, { silent: true, skipSave: true });
                        setDrumMachineEnabled(true, { silent: true, skipSave: true });
                        document.getElementById('performanceDrumMachineLevel').value = String(tag * 20);
                        drumSendFxState.delay.send = tag;
                        drumMachineRoll = MygrainDrumRoll.normalize({ length: 24, pattern: [] });
                        await c.newPart({ name: tag === 1 ? 'Source' : 'Target', repeats: tag + 1 });
                    }
                    window.readMultiCopy = async part => {
                        const bytes = await c.request(`/${c.song.id}/parts/${part.id}`, { binary: true });
                        const entries = parseStoredZipEntries(bytes), snapshot = JSON.parse(getZipText(entries, 'song-part.json'));
                        const audio = {};
                        for (const asset of snapshot.assets) audio[asset.key] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', entries.get(asset.path)))).join(',');
                        return { snapshot, audio };
                    };
                    window.multiCopyBefore = await Promise.all(c.song.parts.map(readMultiCopy));
                    window.multiCopySourceHash = c.song.parts[0].sha256;
                    for (const part of c.song.parts) c.expandedParts.add(`${c.song.id}:${part.id}`);
                    await c.arm(); c.render();
                });
                const rows = page.locator('.song-beta-part'), source = rows.nth(0), target = rows.nth(1);
                const open = async () => { if (mobile) await source.locator('.song-beta-copy').tap(); else await source.locator('.song-beta-copy').click(); await page.locator('.song-beta-copy-dialog').waitFor(); };
                const choose = id => page.locator(`.song-beta-copy-dialog input[data-layer="${id}"]`);
                await open();
                assert.equal(await page.locator('.song-beta-copy-dialog input[type="checkbox"]').count(), 20);
                assert.equal(await page.locator('.song-beta-copy-selected').isDisabled(), true);
                await choose('drums').check();
                assert.equal(await page.locator('.song-beta-copy-drums input:checked').count(), 9);
                await choose('drumKick').uncheck();
                assert.equal(await choose('drums').evaluate(input => input.indeterminate && !input.checked), true);
                assert.equal(await choose('drumSnare').isChecked(), true);
                await page.locator('.song-beta-copy-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
                await page.locator('.song-beta-copy-dialog').waitFor({ state: 'detached' });
                assert.equal(await page.evaluate(() => mygrainSongBeta.loopClipboard), null);
                await open();
                await choose('V').focus(); await page.keyboard.press('Space');
                assert.equal(await choose('V').isChecked(), true);
                await choose('M').check(); await choose('drumKick').check();
                assert.equal(await page.locator('.song-beta-copy-dialog').isVisible(), true);
                assert.equal(await page.locator('.song-beta-copy-selected').textContent(), 'Copy selected (3)');
                for (const viewport of mobile ? [{ width: 390, height: 844 }, { width: 320, height: 640 }, { width: 844, height: 390 }] : [{ width: 1280, height: 900 }]) {
                    await page.setViewportSize(viewport);
                    assert.equal(await page.locator('.song-beta-copy-dialog').evaluate(element => { const b = element.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 1 && b.top >= 0 && b.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1; }), true);
                }
                if (mobile) await page.setViewportSize({ width: 390, height: 844 });
                await page.screenshot({ path: `/tmp/song-multi-copy-${engine}-${mobile ? 'phone' : 'desktop'}.png` });
                const countBeforeCopy = writes.length;
                await press('.song-beta-copy-selected');
                await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.loopClipboard?.layers?.length === 3);
                assert.equal(writes.length, countBeforeCopy);
                assert.match(await page.locator('#songBetaClipboard').textContent(), /Bastardloop V, Bastardloop M, Kick drum lane/);
                const beforePaste = await page.evaluate(() => ({ revision: mygrainSongBeta.song.revision, parts: mygrainSongBeta.song.parts }));
                page.once('dialog', dialog => dialog.dismiss()); await target.locator('.song-beta-paste').click();
                await page.waitForFunction(() => !mygrainSongBeta.busy);
                assert.equal(await page.evaluate(() => mygrainSongBeta.song.revision), beforePaste.revision);
                const renderCount = writes.filter(url => url.endsWith('/render')).length, pasteCount = writes.filter(url => url.endsWith('/paste-loop')).length;
                page.once('dialog', dialog => { assert.match(dialog.message(), /Bastardloop V, Bastardloop M, Kick drum lane/); dialog.accept(); });
                await target.locator('.song-beta-paste').click();
                await page.waitForFunction(() => !mygrainSongBeta.busy);
                assert.equal(await page.evaluate(() => mygrainSongBeta.armed), false);
                assert.equal(writes.filter(url => url.endsWith('/render')).length, renderCount);
                page.once('dialog', dialog => dialog.accept());
                await rows.nth(2).locator('.song-beta-paste').click();
                await page.waitForFunction(() => !mygrainSongBeta.busy);
                assert.equal(await page.evaluate(() => mygrainSongBeta.armed), false);
                assert.equal(writes.filter(url => url.endsWith('/render')).length, renderCount);
                const armCount = await page.evaluate(() => { const c = mygrainSongBeta; window.batchArmCalls = 0; const arm = c.arm.bind(c); c.arm = async (...args) => { batchArmCalls++; return arm(...args); }; return batchArmCalls; });
                assert.equal(armCount, 0);
                await press('#songBetaArm');
                await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.armed, null, { timeout: 90000 });
                assert.equal(await page.evaluate(() => batchArmCalls), 1);
                assert.equal(writes.filter(url => url.endsWith('/paste-loop')).length - pasteCount, 2);
                assert.equal(writes.filter(url => url.endsWith('/render')).length - renderCount, 2);
                const mixed = await page.evaluate(async () => {
                    const c = mygrainSongBeta, saved = await Promise.all(c.song.parts.map(readMultiCopy));
                    const render = c.renders.get(c.song.parts[1].id), data = render.getChannelData(0);
                    return { before: multiCopyBefore, saved, parts: c.song.parts, revision: c.song.revision, peak: data.reduce((peak, x) => Math.max(peak, Math.abs(x)), 0) };
                });
                assert.deepEqual(mixed.saved[0], mixed.before[0]);
                assert.equal(mixed.parts[0].sha256, beforePaste.parts[0].sha256);
                assert.equal(mixed.revision, beforePaste.revision + 2);
                assert.ok(mixed.peak > .001);
                for (const [key, hash] of Object.entries(mixed.saved[1].audio)) assert.equal(hash, mixed.before[['bastardV', 'bastardM', 'bastardMRender', 'drumKick'].includes(key) ? 0 : 1].audio[key], key);
                assert.deepEqual(mixed.saved[1].snapshot.state.modes.drumMachineKickPattern, mixed.before[0].snapshot.state.modes.drumMachineKickPattern);
                assert.deepEqual(mixed.saved[1].snapshot.state.modes.drumMachineExtraTracks, mixed.before[1].snapshot.state.modes.drumMachineExtraTracks);
                assert.equal(mixed.saved[1].snapshot.state.globalBpm, mixed.before[1].snapshot.state.globalBpm);
                assert.equal(mixed.parts[1].repeats, beforePaste.parts[1].repeats);
                await page.evaluate(async () => { const c = mygrainSongBeta; await c.recall(c.song.parts[1], { start: false }); c.cancel(true); c.render(); });
                assert.deepEqual(await page.evaluate(() => drumMachineKickPattern), mixed.before[0].snapshot.state.modes.drumMachineKickPattern);
                // Copy a subset of nested extra lanes; ETC must remain untouched.
                await open(); await choose('drumClap').check(); await choose('drumHat').check(); await press('.song-beta-copy-selected');
                await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.loopClipboard?.layers?.includes('drumClap'));
                page.once('dialog', dialog => dialog.accept()); await target.locator('.song-beta-paste').click(); await page.waitForFunction(() => !mygrainSongBeta.busy);
                const subset = await page.evaluate(() => readMultiCopy(mygrainSongBeta.song.parts[1]));
                assert.deepEqual(subset.snapshot.state.modes.drumMachineExtraTracks.clap, mixed.before[0].snapshot.state.modes.drumMachineExtraTracks.clap);
                assert.deepEqual(subset.snapshot.state.modes.drumMachineExtraTracks.etc, mixed.before[1].snapshot.state.modes.drumMachineExtraTracks.etc);
                assert.equal(subset.audio.drumHat, mixed.before[0].audio.drumHat);
                await open(); await choose('drums').check(); await press('.song-beta-copy-selected');
                await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.loopClipboard?.layer === 'drums');
                page.once('dialog', dialog => dialog.accept()); await target.locator('.song-beta-paste').click(); await page.waitForFunction(() => !mygrainSongBeta.busy);
                const all = await page.evaluate(() => readMultiCopy(mygrainSongBeta.song.parts[1]));
                for (const [key, hash] of Object.entries(all.audio)) assert.equal(hash, key.startsWith('drum') ? mixed.before[0].audio[key] : subset.audio[key], key);
                assert.deepEqual(all.snapshot.state.modes.drumSendFx, mixed.before[0].snapshot.state.modes.drumSendFx);
                assert.deepEqual(all.snapshot.state.modes.drumMachineRoll, mixed.before[0].snapshot.state.modes.drumMachineRoll);
                assert.equal(all.snapshot.state.sliders.performanceDrumMachineLevel, mixed.before[0].snapshot.state.sliders.performanceDrumMachineLevel);
                const savedSong = await page.evaluate(() => mygrainSongBeta.song);
                await page.reload(); await page.waitForFunction(() => window.mygrainSongBeta?.song && !mygrainSongBeta.busy);
                assert.deepEqual(await page.evaluate(() => mygrainSongBeta.song), savedSong);
                assert.deepEqual(errors, []);
                results.push({ engine, mobile, checkboxSelection: true, mixedV_M_Kick: true, oneAtomicPaste: true, batchTwoDestinationsOneArm: true, onlyChangedPartsRendered: true, audibleRender: true, subsetDrums: true, wholeDrumMachine: true, sourceAndUnselectedPreserved: true, editableRecall: true, persistsReload: true });
                console.log('PASS', engine, mobile ? 'phone' : 'desktop');
                await context.close();
            }
        } finally { await browser.close(); }
    }
    fs.writeFileSync('/tmp/song-multi-copy-results.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
