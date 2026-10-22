// Real audio + disposable localhost stores. Never use a production Song library.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18894/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
(async () => {
    const results = [];
    for (const [engine, browserType] of Object.entries({chromium, webkit})) {
        const browser = await browserType.launch(engine === 'chromium' ? {executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']} : {});
        try {
            for (const mobile of [false, true]) {
                const context = await browser.newContext({viewport: mobile ? {width: 390, height: 844} : {width: 1280, height: 900}, isMobile: mobile, hasTouch: mobile, ...(mobile ? {userAgent: iphone} : {})});
                assert.equal((await context.request.post(base + 'api/auth/register', {data: {username: `amend_${engine[0]}_${+mobile}_${Date.now()}`, password: 'isolated-amend-regression'}})).status(), 200);
                const page = await context.newPage(), errors = [];
                page.on('pageerror', error => errors.push(error.message));
                await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
                await page.goto(base);
                await page.waitForFunction(() => window.mygrainSongBeta && document.documentElement.dataset.mygrainStartup === 'ready');
                if (mobile) await page.locator('#start-btn').tap(); else await page.locator('#start-btn').click();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                const result = await page.evaluate(async () => {
                    const c = mygrainSongBeta, a = mygrainSongBetaAdapter;
                    stopAllPerformancePlayback({silent: true}); applyGlobalBpm(300); syncPatternLengthControls(16, {skipSave: true});
                    setLoopLayerSolo('none', {silent: true, skipSave: true}); setOscillatorsEnabled(false, {silent: true, skipSave: true});
                    setGranularLayersEnabled(false, {silent: true, skipSave: true}); mygrainQ.setEnabled(false);
                    const mono = audioContext.createBuffer(1, audioContext.sampleRate * 8, audioContext.sampleRate);
                    for (let i = 0; i < mono.sampleRate * .055; i++) mono.getChannelData(0)[i] = .2 * Math.sin(2 * Math.PI * 433 * i / mono.sampleRate) * (1 - i / (mono.sampleRate * .055));
                    await applyLoadedDrumMachineSampleBuffer('snare', mono, {sourceKey: 'samples_snare', fileName: 'amend-fixture.wav'});
                    // A stereo source proves both channels retain signed PCM, not just mono drums.
                    const stereo = audioContext.createBuffer(2, audioContext.sampleRate, audioContext.sampleRate);
                    for (let channel = 0; channel < 2; channel++) for (let i = 0; i < stereo.length; i++) stereo.getChannelData(channel)[i] = .08 * Math.sin(2 * Math.PI * (channel ? 330 : 220) * i / stereo.sampleRate);
                    bastardLoopBuffer = stereo; bastardLoopSourceBpm = 300;
                    setBastardLoopEnabled(true, {silent: true, skipSave: true});
                    drumMachineKickPattern.fill(false); drumMachineSnarePattern.fill(false); drumMachineHatPattern.fill(false); drumMachinePercPattern.fill(false);
                    setDrumMachineDirectOutput(true, {silent: true, skipSave: true}); setDrumMachineEnabled(true, {silent: true, skipSave: true});
                    restoreDrumMachineRoll({length: 32}); drumMachineRoll.pattern[0] = drumMachineRoll.pattern[31] = true;
                    document.getElementById('songBetaName').value = 'Amend round-trip regression'; await c.newSong();
                    for (const name of ['First', 'Other']) await c.newPart({name, repeats: 1});
                    const events = [], requests = [], originalStage = c.armStage.bind(c), request = c.request.bind(c), render = a.renderPart;
                    let phase = '', origin = 0, rendered = 0;
                    c.armStage = (generation, stage, part) => {events.push({phase, ms: performance.now() - origin, stage, id: part?.id}); return originalStage(generation, stage, part);};
                    c.request = async (path, options = {}) => {requests.push({phase, path, method: options.method || 'GET'}); return request(path, options);};
                    a.renderPart = async (...args) => {rendered++; return render(...args);};
                    const arms = [];
                    async function arm(label) {
                        phase = label; origin = performance.now(); const before = rendered; await c.arm();
                        const entry = {label, ms: performance.now() - origin, rendered: rendered - before, armed: c.armed}; arms.push(entry); phase = ''; return entry;
                    }
                    await arm('cold');
                    const initial = c.song.parts.map(part => ({id: part.id, content: part.contentSha256, render: part.render.sha256}));
                    const untouchedBuffer = c.renders.get(c.song.parts[1].id);
                    const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), v => v.toString(16).padStart(2, '0')).join('');
                    const originalZip = await request(`/${c.song.id}/parts/${c.song.parts[0].id}`, {binary: true});
                    const originalEntries = parseStoredZipEntries(originalZip), originalSnapshot = JSON.parse(getZipText(originalEntries, 'song-part.json'));
                    const originalAudio = Object.fromEntries(await Promise.all(originalSnapshot.assets.map(async asset => [asset.key, await hash(originalEntries.get(asset.path))])));
                    const noops = [];
                    for (let pass = 0; pass < 2; pass++) {
                        const before = c.song.parts[0]; await c.recall(before, {start: false, amend: true}); await c.savePart();
                        const saved = c.song.parts[0]; const savedZip = await request(`/${c.song.id}/parts/${saved.id}`, {binary: true});
                        const entries = parseStoredZipEntries(savedZip), snapshot = JSON.parse(getZipText(entries, 'song-part.json'));
                        const audio = Object.fromEntries(await Promise.all(snapshot.assets.map(async asset => [asset.key, await hash(entries.get(asset.path))])));
                        noops.push({content: saved.contentSha256, render: saved.render?.sha256, audio}); await arm('unchanged-' + pass);
                    }
                    // An actual mix edit MUST invalidate this part, never its other source.
                    await c.recall(c.song.parts[0], {start: false, amend: true});
                    document.getElementById('drumMachineSnareLevel').value = '37';
                    document.getElementById('drumMachineSnareLevel').dispatchEvent(new Event('input', {bubbles: true}));
                    await c.savePart(); const changedNeedsRender = !c.hasSavedRender(c.song.parts[0]);
                    await arm('changed');
                    const changed = {content: c.song.parts[0].contentSha256, render: c.song.parts[0].render.sha256};
                    const other = c.song.parts[1];
                    await arm('warm');
                    const audio = [...c.renders.values()].map(buffer => {
                        let sum = 0; for (const value of buffer.getChannelData(0)) sum += value * value;
                        return {seconds: buffer.duration, rms: Math.sqrt(sum / buffer.length)};
                    });
                    const leaks = {bridges: __mygrainSongRenderBridges.size, sourceBytes: c.audioCache.bytes, cachedParts: c.cache.size};
                    return {arms, initial, noops, originalAudio, changed, changedNeedsRender, other: {content: other.contentSha256, render: other.render.sha256}, sameOtherBuffer: c.renders.get(other.id) === untouchedBuffer,
                        phone: c.phonePreparation, workers: c.preparationConcurrency(), audio, leaks, requests, events};
                });
                assert.equal(result.phone, mobile); assert.equal(result.workers, mobile ? 1 : 2);
                assert.equal(result.arms[0].rendered, 2);
                for (const noop of result.noops) {
                    assert.equal(noop.content, result.initial[0].content); assert.equal(noop.render, result.initial[0].render); assert.deepEqual(noop.audio, result.originalAudio);
                }
                for (const arm of result.arms) assert.equal(arm.armed, true);
                assert.deepEqual(result.arms.slice(1).map(arm => arm.rendered), [0, 0, 1, 0]);
                assert.equal(result.changedNeedsRender, true); assert.notEqual(result.changed.content, result.initial[0].content); assert.notEqual(result.changed.render, result.initial[0].render);
                assert.deepEqual(result.other, {content: result.initial[1].content, render: result.initial[1].render}); assert.equal(result.sameOtherBuffer, true);
                for (const audio of result.audio) {assert.ok(Math.abs(audio.seconds - 1.6) < .001); assert.ok(audio.rms > .001);}
                assert.deepEqual(result.leaks, {bridges: 0, sourceBytes: 0, cachedParts: 0});
                for (const phase of ['unchanged-0', 'unchanged-1', 'warm']) assert.equal(result.requests.filter(request => request.phase === phase && request.method === 'POST').length, 0);
                assert.deepEqual(errors, []);
                results.push({engine, mobile, ...result});
                fs.writeFileSync(process.env.AMEND_ARM_EVIDENCE || '/tmp/mygrain-amend-roundtrip-results.json', JSON.stringify(results, null, 2));
                console.log('PASS', engine, mobile ? 'phone' : 'desktop', JSON.stringify(result.arms));
                await context.close();
            }
        } finally {await browser.close();}
    }
})().catch(error => {console.error(error); process.exitCode = 1;});
