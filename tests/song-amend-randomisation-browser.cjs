// Real saved-Song amendment; disposable localhost accounts only. Audio HTTP
// fixtures exercise the actual fetch/decode/apply path without private libraries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18895/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
function wav(hz, seconds = 2) {
    const rate = 48000, frames = rate * seconds, out = Buffer.alloc(44 + frames * 2);
    out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8);
    out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
    out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28);
    out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(frames * 2, 40);
    for (let i = 0; i < frames; i++) out.writeInt16LE(Math.round(4000 * Math.sin(2 * Math.PI * hz * i / rate)), 44 + i * 2);
    return out;
}
(async () => {
    const results = [];
    for (const [engine, browserType] of Object.entries({chromium, webkit})) {
        const browser = await browserType.launch(engine === 'chromium' ? {executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']} : {});
        try {
            for (const mobile of [false, true]) {
                const context = await browser.newContext({viewport: mobile ? {width: 390, height: 844} : {width: 1280, height: 900}, isMobile: mobile, hasTouch: mobile});
                assert.equal((await context.request.post(base + 'api/auth/register', {data: {username: `amrand_${engine[0]}_${+mobile}_${Date.now()}`, password: 'isolated-amend-randomisation'}})).status(), 200);
                const page = await context.newPage(), errors = [], requests = [];
                page.on('pageerror', error => errors.push(error.message));
                await page.route('**/*', async route => {
                    const url = new URL(route.request().url());
                    if (process.env.MYGRAIN_ADAPTER_OVERRIDE && url.pathname.endsWith('/song-beta-adapter.js')) return route.fulfill({path: process.env.MYGRAIN_ADAPTER_OVERRIDE, contentType: 'text/javascript'});
                    if (route.request().method() === 'POST' && /\/api\/(bastardloop|source-sample)$/.test(url.pathname)) {
                        const payload = route.request().postDataJSON(), generated = url.pathname.endsWith('/bastardloop');
                        requests.push({generated, ...payload});
                        const name = `replacement-${requests.length}.wav`;
                        return route.fulfill({status: 200, contentType: 'audio/wav', body: wav(generated ? 550 + requests.length : 880, generated ? 2 : .2), headers: {
                            'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': '*',
                            'X-Mygrain-Source-Name': name, 'X-Mygrain-Source-Path': name, 'X-Mygrain-Source-Key': payload.source,
                            'X-Mygrain-Bastardloop-Meta': Buffer.from(JSON.stringify({sourceKey: payload.source, sourceLabel: payload.source, bpm: 120, durationSeconds: 2, sampleNames: [name], samplePaths: [name], savedName: name})).toString('base64url')
                        }});
                    }
                    return url.origin === new URL(base).origin ? route.continue() : route.abort();
                });
                const press = selector => mobile ? page.locator(selector).tap() : page.locator(selector).click();
                const cut = () => page.evaluate(() => JSON.parse(JSON.stringify(bastardLoopVCut)));
                await page.goto(base);
                await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
                await page.evaluate(() => mygrainCardHistory.ready);
                await press('#start-btn');
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
                await page.evaluate(async () => {
                    stopAllPerformancePlayback({silent: true}); applyGlobalBpm(120); syncPatternLengthControls(16, {skipSave: true});
                    setLoopLayerSolo('none', {silent: true, skipSave: true}); setOscillatorsEnabled(false, {silent: true, skipSave: true});
                    setGranularLayersEnabled(false, {silent: true, skipSave: true}); mygrainQ.setEnabled(false);
                    const source = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
                    for (let i = 0; i < source.length; i++) source.getChannelData(0)[i] = .1 * Math.sin(2 * Math.PI * 220 * i / source.sampleRate);
                    await applyLoadedBastardLoopVBuffer(source, 'original V', {bpm: 120, durationSeconds: 2, sourceKey: 'samples_vocal', sampleNames: ['original.wav'], samplePaths: ['original.wav']});
                    setBastardLoopVEnabled(true, {silent: true, skipSave: true}); setBastardLoopVCut(undefined, {skipSave: true});
                    await applyLoadedDrumMachineSampleBuffer('snare', source, {fileName: 'original-snare.wav'});
                    setDrumMachineDirectOutput(true, {silent: true, skipSave: true}); setDrumMachineEnabled(true, {silent: true, skipSave: true});
                    drumMachineSnarePattern.fill(false); drumMachineSnarePattern[0] = true;
                    const c = mygrainSongBeta;
                    document.getElementById('songBetaName').value = 'Amend randomisation regression'; await c.newSong();
                    await c.newPart({name: 'Draft target', repeats: 1}); await c.newPart({name: 'Untouched', repeats: 1});
                    window.amendBaseline = c.song.parts.map(p => p.contentSha256);
                    await c.recall(c.song.parts[0], {start: false, amend: true});
                    window.amendToken = c.lease.token; window.amendId = c.editing.id;
                    window.originalV = bastardLoopVBuffer; window.originalSnare = drumMachineSnareBuffer;
                });
                const originalCut = await cut();
                await press('#performanceBastardLoopVCutRandomizeBtn');
                assert.notDeepEqual(await cut(), originalCut, 'Card randomisation was blocked during Amend');
                assert.equal(await page.evaluate(() => bastardLoopVBuffer === originalV), true);
                await press('#performanceBastardLoopVCutBtn');
                await press('#bastardLoopVCutReset');
                const beforePopup = await cut(); await press('#bastardLoopVCutRandomize');
                assert.notDeepEqual(await cut(), beforePopup, 'Popup randomisation was blocked during Amend');
                await press('#bastardLoopVCutReset');
                await page.locator('#bastardLoopVCutStartSeconds').fill('0.25'); await page.locator('#bastardLoopVCutStartSeconds').press('Tab');
                await page.locator('#bastardLoopVCutEndSeconds').fill('1.5'); await page.locator('#bastardLoopVCutEndSeconds').press('Tab');
                assert.equal((await cut()).start, .125); assert.equal((await cut()).end, .75);
                await press('#bastardLoopVCutClose');
                const guards = await page.evaluate(async () => {
                    const h = mygrainCardHistory, c = mygrainSongBeta, messages = [];
                    function blocked(prepare, cleanup, action = () => randomizeBastardLoopVCut()) {
                        const before = JSON.stringify(bastardLoopVCut); prepare();
                        try { action(); throw new Error('Guard unexpectedly permitted mutation'); }
                        catch (error) { if (error.message === 'Guard unexpectedly permitted mutation') throw error; messages.push(error.message); }
                        finally { cleanup(); }
                        if (JSON.stringify(bastardLoopVCut) !== before || h.busy) throw new Error('Rejected action changed state');
                    }
                    blocked(() => isRecording = true, () => isRecording = false);
                    blocked(() => isOutputRecordingArmed = true, () => isOutputRecordingArmed = false);
                    blocked(() => c.busy = true, () => c.busy = false);
                    blocked(() => c.playing = true, () => c.playing = false);
                    blocked(() => megaRandomizeInFlight = true, () => megaRandomizeInFlight = false);
                    blocked(() => drumMachineLoadInFlight = true, () => drumMachineLoadInFlight = false);
                    blocked(() => bastardLoopVGenerationInFlight = true, () => bastardLoopVGenerationInFlight = false);
                    blocked(() => c.revisionConflict = true, () => c.revisionConflict = false);
                    const token = c.lease.token;
                    blocked(() => c.lease.token = '', () => c.lease.token = token);
                    blocked(() => {}, () => {}, () => runPatchRandomization());
                    const count = JSON.stringify(h.counts), before = JSON.stringify(bastardLoopVCut);
                    await h.undo(); await h.redo();
                    if (count !== JSON.stringify(h.counts) || before !== JSON.stringify(bastardLoopVCut)) throw new Error('History travel escaped amendment guard');
                    return messages;
                });
                assert.equal(guards.length, 10);
                // Native generator and recut handlers, stopped then real live playback.
                for (const [selector, running] of [['#performanceGenerateBastardLoopVBtn', false], ['#performanceBastardLoopVRecutBtn', true]]) {
                    if (running) {
                        await press('#performanceBastardLoopPlayBtn');
                        await page.waitForFunction(() => bastardLoopPlaying);
                    }
                    const n = requests.length;
                    await press(selector);
                    await page.waitForFunction(() => !mygrainCardHistory.busy && !bastardLoopVGenerationInFlight);
                    assert.equal(requests.length, n + 1); assert.equal(requests.at(-1).generated, true);
                    assert.equal(await page.evaluate(() => bastardLoopVBuffer !== originalV && bastardLoopVMetadata.sampleNames[0].startsWith('replacement-')), true);
                    if (running) {
                        assert.equal(requests.at(-1).sourceFiles.length, 1);
                        assert.equal(await page.evaluate(() => bastardLoopPlaying && Boolean(bastardLoopVSource)), true);
                    }
                    await page.evaluate(() => stopAllPerformancePlayback({silent: true}));
                }
                await page.evaluate(() => openDrumMachineOverlay());
                const n = requests.length; await press('#drumMachineSnareRandomBtn');
                await page.waitForFunction(() => !mygrainCardHistory.busy && !drumMachineLoadInFlight);
                assert.equal(requests.length, n + 1); assert.equal(requests.at(-1).source, 'samples_snares');
                assert.equal(await page.evaluate(() => drumMachineSnareBuffer !== originalSnare && drumMachineSnareMetadata.fileName.startsWith('replacement-')), true);
                await page.evaluate(() => { drumMachineExtraTracks.clap.pattern.fill(false); window.amendClapBuffer = drumMachineExtraTracks.clap.buffer; });
                await press('#drumMachineClapPatternBtn');
                assert.equal(await page.evaluate(() => drumMachineExtraTracks.clap.pattern.some(Boolean) && drumMachineExtraTracks.clap.buffer === amendClapBuffer), true);
                await page.evaluate(() => closeDrumMachineOverlay());
                await press('#performanceBastardLoopVCutRandomizeBtn');
                const savedCut = await cut();
                const result = await page.evaluate(async () => {
                    const c = mygrainSongBeta;
                    if (!c.canEditSong() || c.lease.token !== amendToken || c.editing.id !== amendId) throw new Error('Draft lost its editing reservation');
                    if (c.song.parts.some((p, i) => p.contentSha256 !== amendBaseline[i])) throw new Error('Draft unexpectedly overwrote saved part');
                    const expected = JSON.parse(JSON.stringify(bastardLoopVCut)), vName = bastardLoopVMetadata.sampleNames[0], snareName = drumMachineSnareMetadata.fileName;
                    await c.savePart();
                    const changed = c.song.parts[0].contentSha256 !== amendBaseline[0], unchangedOther = c.song.parts[1].contentSha256 === amendBaseline[1];
                    await c.recall(c.song.parts[0], {start: false});
                    return {changed, unchangedOther, recalledCut: bastardLoopVCut, expected, vName, snareName,
                        recalledV: bastardLoopVMetadata.sampleNames[0], recalledSnare: drumMachineSnareMetadata.fileName,
                        leaseRetained: c.canEditSong() && c.lease.token === amendToken, draftFinished: !c.editing};
                });
                assert.equal(result.changed, true); assert.equal(result.unchangedOther, true);
                assert.deepEqual(result.recalledCut, savedCut); assert.deepEqual(result.recalledCut, result.expected);
                assert.equal(result.recalledV, result.vName); assert.equal(result.recalledSnare, result.snareName);
                assert.equal(result.leaseRetained, true); assert.equal(result.draftFinished, true); assert.deepEqual(errors, []);
                results.push({engine, mobile, guards, requests, ...result});
                fs.writeFileSync('/tmp/mygrain-amend-randomisation-results.json', JSON.stringify(results, null, 2));
                console.log('PASS', engine, mobile ? 'phone' : 'desktop', 'card/popup cuts, generated/recut V, random snare, 10 guards, saved recall, same editing lease');
                await context.close();
            }
        } finally {await browser.close();}
    }
})().catch(error => {console.error(error); process.exitCode = 1;});
