const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
const evidence = process.env.MYGRAIN_COMPATIBILITY_EVIDENCE || '/tmp/mygrain-k16-compatibility.json';
const baseline = process.env.MYGRAIN_COMPATIBILITY_BASELINE === '1';
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) {
    throw new Error('Use an isolated localhost song test server.');
}

(async () => {
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
    });
    const results = [];
    const failures = [];
    try {
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
            const page = await context.newPage();
            page.setDefaultTimeout(120000);
            const result = { viewport, baseline, errors: [], writes: [] };
            results.push(result);
            page.on('pageerror', error => result.errors.push(error.message));
            page.on('request', request => {
                if (!['GET', 'HEAD'].includes(request.method())) {
                    result.writes.push({ method: request.method(), path: new URL(request.url()).pathname });
                }
            });
            await page.route('**/*', route => {
                const url = new URL(route.request().url());
                if (url.origin !== new URL(base).origin) return route.abort();
                if (baseline && url.pathname.endsWith('/song-beta-adapter.js')) {
                    return route.fulfill({ path: '/tmp/mygrain-k16-baseline-adapter.js', contentType: 'text/javascript' });
                }
                if (baseline && url.pathname.endsWith('/song-beta.js')) {
                    return route.fulfill({ path: '/tmp/mygrain-k16-baseline-controller.js', contentType: 'text/javascript' });
                }
                if (url.pathname.startsWith('/mygrain-bastardloops/')) return route.abort();
                return route.continue();
            });
            try {
                await page.goto(base, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
                await page.locator('#start-btn').click();
                await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
                result.fixture = await page.evaluate(async () => {
                    applyGlobalBpm(300);
                    syncPatternLengthControls(8, { skipSave: true });
                    setGranularLayersEnabled(false, { silent: true, skipSave: true });
                    seqGrainsEnabled = false;
                    document.getElementById('seqGrainsEnabled').checked = false;
                    const source = audioContext.createBuffer(1, audioContext.sampleRate / 2, audioContext.sampleRate);
                    const samples = source.getChannelData(0);
                    for (let index = 0; index < samples.length; index += 1) {
                        samples[index] = Math.sin(2 * Math.PI * 220 * index / source.sampleRate) * .15;
                    }
                    bastardLoopBuffer = source;
                    bastardLoopSourceBpm = 300;
                    bastardLoopEnabled = true;
                    bastardLoopKRawBuffer = null;
                    bastardLoopKBuffer = null;
                    const captured = await mygrainSongBetaAdapter.capture();
                    const entries = parseStoredZipEntries(await captured.arrayBuffer());
                    const snapshot = JSON.parse(getZipText(entries, 'song-part.json'));
                    delete snapshot.extra.audioSlots.bastardK;
                    delete snapshot.extra.audioSlots.bastardKRender;
                    for (const key of Object.keys(snapshot.state.modes)) {
                        if (key.startsWith('bastardLoopK')) delete snapshot.state.modes[key];
                    }
                    for (const group of ['sliders', 'selects']) {
                        for (const key of Object.keys(snapshot.state[group] || {})) {
                            if (key.startsWith('performanceBastardLoopK')) delete snapshot.state[group][key];
                        }
                    }
                    snapshot.extra.controls = snapshot.extra.controls.filter(control => !/bastardloopk/i.test(control.id));
                    delete snapshot.extra.metadata.bastardK;
                    snapshot.extra.metadata.bastardA = { ...snapshot.extra.metadata.bastardA, summary: 'K' };
                    const originalAudio = {};
                    const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
                    for (const [name, bytes] of entries) {
                        if (name.startsWith('audio/')) originalAudio[name] = await digest(bytes);
                    }
                    entries.set('song-part.json', JSON.stringify(snapshot));
                    const legacy = await createStoredZip([...entries].map(([path, data]) => ({ path, data })));
                    window.compatibilityFixture = { snapshot, originalAudio, legacy };
                    let inspectionError = null;
                    try { mygrainSongBetaAdapter.inspectPart(await legacy.arrayBuffer()); }
                    catch (error) { inspectionError = error.message; }
                    document.getElementById('songBetaName').value = 'Legacy missing K inventory';
                    await mygrainSongBeta.newSong();
                    const saved = await mygrainSongBeta.request(`/${mygrainSongBeta.song.id}/parts?name=Legacy%20verse&repeats=2`, {
                        method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: legacy
                    });
                    mygrainSongBeta.acceptSong(saved.song);
                    await mygrainSongBeta.reusePart(mygrainSongBeta.song.parts[0]);
                    const before = JSON.parse(JSON.stringify(mygrainSongBeta.song));
                    bastardLoopKRawBuffer = source;
                    bastardLoopKBuffer = source;
                    bastardLoopKEnabled = true;
                    return { inspectionError, before, originalAudio, sourceFrames: source.length };
                });
                if (baseline) {
                    assert.match(result.fixture.inspectionError, /inventory is incomplete for bastardK/i);
                    result.armError = await page.evaluate(async () => {
                        try { await mygrainSongBeta.arm(); return null; }
                        catch (error) { return error.message; }
                    });
                    assert.match(result.armError, /inventory is incomplete for bastardK/i);
                    result.pass = true;
                    continue;
                }
                assert.equal(result.fixture.inspectionError, null, 'A genuinely pre-K snapshot must normalize successfully');
                result.corruptSnapshots = await page.evaluate(async () => {
                    const failures = [];
                    for (const kind of ['existing-slot-missing', 'recording-declared-missing', 'active-lane-missing', 'solo-lane-missing', 'solo-list-lane-missing', 'solo-padded-lane-missing']) {
                        const entries = parseStoredZipEntries(await compatibilityFixture.legacy.arrayBuffer());
                        const snapshot = JSON.parse(getZipText(entries, 'song-part.json'));
                        if (kind === 'existing-slot-missing') delete snapshot.extra.audioSlots.bastardA;
                        if (kind === 'recording-declared-missing') snapshot.extra.audioSlots.bastardK = true;
                        if (kind === 'active-lane-missing') snapshot.state.modes.bastardLoopKEnabled = true;
                        if (kind === 'solo-lane-missing') snapshot.state.modes.loopLayerSolo = ['bastardk'];
                        if (kind === 'solo-list-lane-missing') snapshot.state.modes.loopLayerSolo = 'bastarda, bastardk';
                        if (kind === 'solo-padded-lane-missing') snapshot.state.modes.loopLayerSolo = ' bastardk ';
                        entries.set('song-part.json', JSON.stringify(snapshot));
                        const body = await createStoredZip([...entries].map(([path, data]) => ({ path, data })));
                        let message = null;
                        try { mygrainSongBetaAdapter.inspectPart(await body.arrayBuffer()); }
                        catch (error) { message = error.message; }
                        failures.push({ kind, message });
                    }
                    return failures;
                });
                assert.ok(result.corruptSnapshots.every(snapshot => snapshot.message), 'Real missing audio must still be rejected');
                if (viewport.width === 390) {
                    const access = await page.evaluate(() => ({ key: mygrainSongBeta.key, songId: mygrainSongBeta.song.id }));
                    const readerContext = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
                    try {
                        await readerContext.addInitScript(({ key, songId }) => {
                            localStorage.setItem('mygrain-song-library-key-v1', key);
                            localStorage.setItem('mygrain-song-selected-v1', songId);
                        }, access);
                        const reader = await readerContext.newPage();
                        reader.setDefaultTimeout(120000);
                        reader.on('pageerror', error => result.errors.push(error.message));
                        const readerWrites = [];
                        reader.on('request', request => {
                            if (!['GET', 'HEAD'].includes(request.method())) readerWrites.push(new URL(request.url()).pathname);
                        });
                        await reader.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
                        await reader.goto(base, { waitUntil: 'domcontentloaded' });
                        await reader.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy && mygrainSongBeta.song?.parts.length === 2);
                        await reader.locator('#start-btn').click();
                        await reader.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
                        result.readOnly = await reader.evaluate(async () => {
                            const revision = mygrainSongBeta.song.revision;
                            const sha256 = mygrainSongBeta.song.parts[0].sha256;
                            await mygrainSongBeta.arm();
                            const saved = (await mygrainSongBeta.request(`/${mygrainSongBeta.song.id}`)).song;
                            return {
                                armed: mygrainSongBeta.armed, writable: mygrainSongBeta.canEditSong(),
                                before: { revision, sha256 }, after: { revision: saved.revision, sha256: saved.parts[0].sha256 }
                            };
                        });
                        assert.equal(result.readOnly.armed, true, 'Another editor must not block read-only cache preparation');
                        assert.equal(result.readOnly.writable, false);
                        assert.deepEqual(result.readOnly.after, result.readOnly.before, 'A read-only upgrade cannot mutate saved content');
                        assert.equal(readerWrites.filter(path => /\/save$|\/upgrade$|\/migrate$/.test(path)).length, 0);
                    } finally {
                        await readerContext.close();
                    }
                }
                result.writesBeforeArm = result.writes.length;
                result.armed = await page.evaluate(async () => {
                    await mygrainSongBeta.arm();
                    const audio = [...mygrainSongBeta.renders.values()].map(buffer => {
                        const samples = buffer.getChannelData(0);
                        let power = 0;
                        for (const sample of samples) power += sample * sample;
                        return { duration: buffer.duration, rms: Math.sqrt(power / samples.length) };
                    });
                    return { armed: mygrainSongBeta.armed, song: mygrainSongBeta.song, audio };
                });
                assert.equal(result.armed.armed, true);
                assert.ok(result.armed.audio.length > 0);
                assert.ok(result.armed.audio.every(audio => Math.abs(audio.duration - .4) < .002 && audio.rms > .001));
                const before = result.fixture.before;
                const after = result.armed.song;
                assert.equal(after.id, before.id);
                assert.equal(after.name, before.name);
                assert.deepEqual(after.parts.map(part => [part.id, part.sourceId, part.name, part.repeats, part.colour]),
                    before.parts.map(part => [part.id, part.sourceId, part.name, part.repeats, part.colour]));
                assert.ok(after.revision > before.revision, 'Compatibility upgrade persists through a normal content revision');
                assert.notEqual(after.parts[0].sha256, before.parts[0].sha256);
                assert.equal(after.parts[0].sha256, after.parts[1].sha256, 'Shared occurrences remain shared');
                assert.equal(result.writes.slice(result.writesBeforeArm).filter(request => /\/save$/.test(request.path)).length, 1,
                    'Shared occurrences require only one persisted compatibility upgrade');
                result.saved = await page.evaluate(async () => {
                    const body = await mygrainSongBeta.request(`/${mygrainSongBeta.song.id}/parts/${mygrainSongBeta.song.parts[0].id}`, { binary: true });
                    const entries = parseStoredZipEntries(body);
                    const snapshot = JSON.parse(getZipText(entries, 'song-part.json'));
                    const audio = {};
                    for (const [name, bytes] of entries) {
                        if (name.startsWith('audio/')) audio[name] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
                    }
                    await mygrainSongBeta.recall(mygrainSongBeta.song.parts[0], { start: false });
                    return { snapshot, audio, kEnabled: bastardLoopKEnabled, rawK: Boolean(bastardLoopKRawBuffer), renderedK: Boolean(bastardLoopKBuffer) };
                });
                assert.equal(result.saved.snapshot.extra.audioSlots.bastardK, false);
                assert.equal(result.saved.snapshot.extra.audioSlots.bastardKRender, false);
                assert.equal(result.saved.snapshot.state.modes.bastardLoopKEnabled, false);
                assert.equal(result.saved.snapshot.extra.metadata.bastardA.summary, 'K');
                assert.equal(result.saved.kEnabled, false);
                assert.equal(result.saved.rawK, false);
                assert.equal(result.saved.renderedK, false);
                assert.deepEqual(result.saved.audio, result.fixture.originalAudio, 'All saved WAV bytes remain unchanged');
                const revision = after.revision;
                const postUpgradeWrites = result.writes.length;
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy && mygrainSongBeta.song?.parts.length === 2);
                await page.locator('#start-btn').click();
                await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
                result.reloaded = await page.evaluate(async () => {
                    await mygrainSongBeta.arm();
                    return { armed: mygrainSongBeta.armed, revision: mygrainSongBeta.song.revision, sha256: mygrainSongBeta.song.parts[0].sha256 };
                });
                assert.equal(result.reloaded.armed, true);
                assert.equal(result.reloaded.revision, revision, 'Reload/re-arm must not perform another migration');
                assert.equal(result.reloaded.sha256, after.parts[0].sha256);
                result.reloadWrites = result.writes.slice(postUpgradeWrites);
                assert.equal(result.reloadWrites.filter(request => /\/save$|\/upgrade$|\/migrate$/.test(request.path)).length, 0);
                result.status = await page.locator('#songBetaStatus').textContent();
                if (process.env.MYGRAIN_COMPATIBILITY_SCREENSHOTS) {
                    await page.locator('#songBetaCard').screenshot({ path: `${process.env.MYGRAIN_COMPATIBILITY_SCREENSHOTS}-${viewport.width}.png` });
                }
                assert.deepEqual(result.errors, []);
                result.pass = true;
            } catch (error) {
                result.error = error.stack;
                failures.push({ viewport, error: error.message });
            } finally {
                await context.close();
                fs.writeFileSync(evidence, JSON.stringify({ baseline, results, failures }, null, 2));
            }
        }
    } finally {
        await browser.close();
        fs.writeFileSync(evidence, JSON.stringify({ baseline, results, failures }, null, 2));
    }
    assert.deepEqual(failures, []);
    console.log(JSON.stringify({ baseline, cases: results.length, failures, evidence }));
})().catch(error => { console.error(error); process.exitCode = 1; });
