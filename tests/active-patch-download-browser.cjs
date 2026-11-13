'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:19281/mygrain/';
const out = process.env.MYGRAIN_TEST_OUTPUT || '/tmp/mygrain-active-patch-download';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function unzip(bytes) {
    const entries = new Map(); let offset = 0;
    while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
        assert.equal(bytes.readUInt16LE(offset + 8), 0);
        const size = bytes.readUInt32LE(offset + 18), names = bytes.readUInt16LE(offset + 26), extras = bytes.readUInt16LE(offset + 28);
        const name = bytes.toString('utf8', offset + 30, offset + 30 + names), start = offset + 30 + names + extras;
        entries.set(name, bytes.subarray(start, start + size)); offset = start + size;
    }
    assert(entries.size); return entries;
}
(async () => {
    for (const [name, type, phone] of [
        ['chromium-desktop', chromium, false], ['webkit-phone', webkit, true],
        ['chromium-phone', chromium, true], ['webkit-desktop', webkit, false]
    ]) {
        if (process.env.CASE && !process.env.CASE.split(',').includes(name)) continue;
        const browser = await type.launch(type === chromium ? { executablePath: '/snap/chromium/current/usr/lib/chromium-browser/chrome',
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            const context = await browser.newContext({ acceptDownloads: true,
                viewport: phone ? { width: 390, height: 844 } : { width: 1365, height: 900 }, isMobile: phone, hasTouch: phone });
            await context.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }));
            const page = await context.newPage(), errors = [], mutations = [];
            page.setDefaultTimeout(60000);
            page.on('pageerror', error => errors.push(error.message));
            page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) mutations.push(new URL(request.url()).pathname); });
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
            assert.equal((await context.request.post(base + 'api/auth/login', {
                data: { username: 'admin', password: 'isolated-vst3-test' }
            })).status(), 200);
            const ready = async () => {
                await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready' && window.mygrainSongBetaAdapter);
                await page.evaluate(() => mygrainCardHistory.ready);
            };
            await page.goto(base); await ready(); await page.locator('#start-btn').click();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
            const saved = await page.evaluate(async name => {
                const quiet = { silent: true, skipSave: true, skipRestart: true };
                stopAllPerformancePlayback(quiet); clearAllPerformanceSoloStates(quiet);
                for (const layer of SPARSE_RANDOM_LAYER_DEFINITIONS) layer.setEnabled(false, quiet);
                setDrumMachineEnabled(true, quiet); applyGlobalBpm(240); syncPatternLengthControls(16, { skipSave: true });
                setFxMuted(true, quiet); setFilterEnabled('lpf', false); setFilterEnabled('hpf', false);
                for (const id of ['reverb', 'distortion', 'noiseMix', 'finalDriveSoft', 'finalDriveHard', 'finalDriveFold',
                    'finalDriveCrush', 'finalCompressorAmount', 'finalSidechainAmount', 'delayMix', 'delayFeedback',
                    'finalDelayDepth', 'finalReverbMix', 'oscNoiseLevel']) setSliderValue(id, 0);
                await mygrainWasp.restore(null); await mygrainTurntable.off(); await mygrainResonator.off(); mygrainChannelEq.restore();
                const buffer = audioContext.createBuffer(2, 2400, 48000);
                for (let ch = 0; ch < 2; ch++) for (let i = 0; i < buffer.length; i++) buffer.getChannelData(ch)[i] = .12 * Math.sin(2 * Math.PI * 100 * i / buffer.sampleRate) * (1 - i / buffer.length);
                for (const suffix of ['', '2', '3', 'V', 'W', 'P', 'O', 'M', 'MPlus']) eval(`bastardLoop${suffix}Buffer=buffer`);
                bastardLoopMRawBuffer = buffer; bastardLoopMPlusRawBuffer = buffer;
                bastardLoopDBuffer = buffer; bastardLoopLSampleBuffer = buffer; bastardLoopXSampleBuffer = buffer;
                generatedLoopBuffer = buffer; generatedLoopBaseBuffer = buffer; micAudioBuffer = buffer;
                grainMainSampleBuffer = buffer; grainASampleBuffer = buffer; grainBSampleBuffer = buffer;
                grainSynthAMicBuffer = buffer; grainSynthBMicBuffer = buffer;
                dropboxSampleLayerRawBuffer = buffer; dropboxSampleLayerBuffer = buffer; setKeyboardSampleBuffer(buffer);
                for (let i = 0; i < 5; i++) { mygrainKMultitrack.setBuffer(i, buffer); mygrainKMultitrack.setBuffer(i, buffer, true); }
                drumMachineKickBuffer = buffer; drumMachineSnareBuffer = buffer; drumMachineHatBuffer = buffer; drumMachinePercBuffer = buffer;
                for (const track of Object.values(drumMachineExtraTracks)) track.buffer = buffer;
                for (const kind of ['kick', 'snare', 'hat', 'perc', ...Object.keys(drumMachineExtraTracks)])
                    setDrumMachinePattern(kind, Array.from({ length: 16 }, (_, i) => kind === 'kick' && i % 4 === 0), quiet);
                restoreDrumMachineLaneSolos([]); restoreDrumMachineRoll(null);
                const q = MygrainQTheory.defaults(); q.enabled = false; q.soundSource = 'sample';
                q.sequence[0] = MygrainQTheory.normalizeStep({ notes: [60], velocity: 100 });
                mygrainQ.restore(q); qSourceSampleBuffer = buffer;
                syncLegacyAudioBuffer(); syncPerformanceControlState();
                const blob = await buildPatchZipBlob(name + '-drums.zip');
                mygrainSongBetaAdapter.inspectPart(await blob.arrayBuffer());
                const reader = new FileReader(), body = await new Promise((resolve, reject) => { reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
                const upload = await uploadPatchZipToRepository(blob, name + '-drums.zip');
                const legacyAssets = [], legacyEntries = [];
                for (const definition of PATCH_REPOSITORY_AUDIO_ENTRIES) {
                    const source = definition.getBuffer(); if (!source) continue;
                    legacyAssets.push({ key: definition.key, path: definition.path, role: definition.role, label: definition.label });
                    legacyEntries.push({ path: definition.path, data: audioBufferToWav(source) });
                }
                const legacy = await createStoredZip([{ path: 'manifest.json', data: JSON.stringify({ version: 1, assets: legacyAssets }) },
                    { path: 'preset.json', data: JSON.stringify(gatherPreset()) }, ...legacyEntries]);
                window.__legacyPatch = legacy;
                // A contrasting live patch must not alter what is downloaded from the saved row.
                setBastardLoopEnabled(true, quiet); setDrumMachineEnabled(false, quiet);
                window.__downloadFingerprint = () => { const state = saveState({ force: true, snapshotOnly: true }); delete state.timestamp; return JSON.stringify(state); };
                if (typeof buildEnabledPatchDownload !== 'function') {
                    // Old code opens the raw URL. Keep that packaging behaviour but
                    // route it to this page's observable browser download event.
                    window.open = url => { const a = document.createElement('a'); a.href = url; a.download = name + '-drums.zip'; a.click(); };
                }
                return { body, upload, state: __downloadFingerprint(), history: mygrainCardHistory.counts };
            }, name);
            const original = Buffer.from(saved.body, 'base64'), originalEntries = unzip(original);
            fs.writeFileSync(path.join(out, name + '-original.zip'), original);
            await page.evaluate(() => openPatchRepositoryBrowser());
            const row = page.locator('#patchRepositoryBrowserList .sample-browser-card').filter({ has: page.getByText(saved.upload.savedName, { exact: true }) });
            await row.waitFor(); const downloadButton = row.getByRole('button', { name: 'Download ZIP', exact: true });
            const downloadEvent = page.waitForEvent('download');
            await downloadButton.click(); const download = await downloadEvent;
            const downloadedPath = path.join(out, name + '-download.zip'); await download.saveAs(downloadedPath);
            await page.waitForFunction(() => [...document.querySelectorAll('#patchRepositoryBrowserList button')].some(button => button.textContent === 'Download ZIP' && !button.disabled));
            const downloaded = fs.readFileSync(downloadedPath), entries = unzip(downloaded);
            const manifest = JSON.parse(entries.get('song-part.json').toString());
            const keys = manifest.assets.map(asset => asset.key).sort();
            assert.deepEqual(keys, ['drumClap', 'drumCymbals', 'drumEtc', 'drumHat', 'drumKick', 'drumPerc', 'drumSnare']);
            assert.equal(entries.size, 8);
            for (const asset of manifest.assets) assert(originalEntries.get(asset.path).equals(entries.get(asset.path)), asset.key + ' exact PCM bytes');
            for (const [key, included] of Object.entries(manifest.extra.audioSlots)) assert.equal(included, keys.includes(key));
            assert.equal(manifest.state.q.enabled, false); assert.equal(manifest.state.q.bank, null);
            assert(manifest.state.q.sequence.every(step => step === null));
            assert.equal(await page.evaluate(() => __downloadFingerprint()), saved.state, 'download must not change the live patch');
            assert.deepEqual(await page.evaluate(() => mygrainCardHistory.counts), saved.history, 'download must not change history');
            const stored = await context.request.get(new URL(saved.upload.url, base).href);
            assert.equal(stored.status(), 200); assert((await stored.body()).equals(original), 'stored original remains byte-identical');
            const savedUrl = new URL(saved.upload.url, base).href;
            let unexpectedDownloads = 0;
            const observeDownload = () => unexpectedDownloads++;
            page.on('download', observeDownload);
            await page.route(savedUrl, route => route.fulfill({ status: 500, body: 'isolated download failure' }));
            await downloadButton.click();
            await page.waitForFunction(() => document.getElementById('patchRepositoryBrowserStatus').textContent.includes('Download failed:'));
            assert.equal(await downloadButton.isEnabled(), true);
            assert.equal(unexpectedDownloads, 0, 'failed trimming must never fall back to the full archive');
            assert.equal(await page.evaluate(() => __downloadFingerprint()), saved.state);
            assert.deepEqual(await page.evaluate(() => mygrainCardHistory.counts), saved.history);
            await page.unroute(savedUrl); page.off('download', observeDownload);
            await page.evaluate(() => closePatchRepositoryBrowser());
            const recalled = await page.evaluate(async bytes => {
                const body = new Uint8Array(bytes).buffer;
                const decoded = await mygrainSongBetaAdapter.decode(body, { buffers: new Map(), bytes: 0, reservedBytes: 0, limitBytes: 256 * 1048576 });
                mygrainSongBetaAdapter.recall(decoded, { start: false }); await mygrainSongBetaAdapter.whenPersisted();
                return { drums: drumMachineEnabled, a: bastardLoopEnabled, aBuffer: !!bastardLoopBuffer,
                    grains: granularLayersEnabled, q: mygrainQ.state.enabled, keys: [...decoded.buffers].filter(([, buffer]) => buffer).map(([key]) => key).sort() };
            }, [...downloaded]);
            assert(recalled.drums); assert(!recalled.a && !recalled.aBuffer && !recalled.grains && !recalled.q); assert.deepEqual(recalled.keys, keys);
            const legacy = await page.evaluate(async () => {
                const legacyEntries = parseStoredZipEntries(await __legacyPatch.arrayBuffer());
                const preset = JSON.parse(getZipText(legacyEntries, 'preset.json'));
                // Older presets can omit K's global gate. Do not infer Off from
                // absence and lose a track; test that conservative case separately.
                const ambiguous = await buildEnabledPatchDownload(await __legacyPatch.arrayBuffer());
                const ambiguousEntries = parseStoredZipEntries(await ambiguous.blob.arrayBuffer());
                const ambiguousKeys = JSON.parse(getZipText(ambiguousEntries, 'manifest.json')).assets.map(asset => asset.key);
                if (preset.bastardLoopKEnabled === undefined && !['bastardKTrack2', 'bastardKTrack3', 'bastardKTrack4', 'bastardKTrack5'].every(key => ambiguousKeys.includes(key))) throw Error('Missing legacy gates must not delete uncertain audio');
                preset.bastardLoopKEnabled = false;
                legacyEntries.set('preset.json', new TextEncoder().encode(JSON.stringify(preset)));
                const explicitLegacy = await createStoredZip([...legacyEntries].map(([path, data]) => ({ path, data })));
                const result = await buildEnabledPatchDownload(await explicitLegacy.arrayBuffer());
                const entries = parseStoredZipEntries(await result.blob.arrayBuffer());
                const manifest = JSON.parse(getZipText(entries, 'manifest.json'));
                await openPatchZipFromArrayBuffer(await result.blob.arrayBuffer(), 'legacy-drums.zip');
                return { keys: manifest.assets.map(asset => asset.key).sort(), drums: drumMachineEnabled, a: bastardLoopEnabled,
                    excluded: result.excluded, ambiguousKeys };
            });
            assert.deepEqual(legacy.keys, keys); assert(legacy.drums && !legacy.a); assert(legacy.excluded > 0);
            const piano = await page.evaluate(async bytes => {
                const originalEntries = parseStoredZipEntries(new Uint8Array(bytes).buffer);
                const manifest = JSON.parse(getZipText(originalEntries, 'song-part.json'));
                const q = MygrainQTheory.defaults(); q.enabled = false; q.soundSource = 'piano';
                q.sequence[0] = MygrainQTheory.normalizeStep({ notes: [60], velocity: 95 });
                q.bank = { version: 1, instrument: MygrainQTheory.instruments.piano.id, sampleRate: 48000,
                    samples: [{ id: 'C4v12', midi: 60, velocity: 95, offset: 0, frames: 2400 }] };
                manifest.state.q = q; manifest.extra.audioSlots.bastardQ = true;
                manifest.assets.push({ key: 'bastardQ', path: 'audio/bastardQ.wav', channels: 2, frames: 2400, sampleRate: 48000 });
                originalEntries.set('audio/bastardQ.wav', originalEntries.get('audio/drumKick.wav'));
                async function build() {
                    originalEntries.set('song-part.json', new TextEncoder().encode(JSON.stringify(manifest)));
                    const input = await createStoredZip([...originalEntries].map(([path, data]) => ({ path, data })));
                    mygrainSongBetaAdapter.inspectPart(await input.arrayBuffer());
                    const result = await buildEnabledPatchDownload(await input.arrayBuffer());
                    mygrainSongBetaAdapter.inspectPart(await result.blob.arrayBuffer());
                    return parseStoredZipEntries(await result.blob.arrayBuffer());
                }
                const disabled = await build(), disabledQ = JSON.parse(getZipText(disabled, 'song-part.json')).state.q;
                if (disabled.has('audio/bastardQ.wav') || disabledQ.bank || disabledQ.sequence.some(Boolean)) throw Error('Disabled piano bank was not fully removed');
                q.enabled = true;
                const enabled = await build(), enabledQ = JSON.parse(getZipText(enabled, 'song-part.json')).state.q;
                if (JSON.stringify(enabledQ) !== JSON.stringify(q) || !enabled.has('audio/bastardQ.wav')) throw Error('Enabled piano changed');
                if (enabled.has('audio/qSourceSample.wav')) throw Error('Unused Q sample retained');
                const same = [...enabled.get('audio/bastardQ.wav')].every((value, i) => value === originalEntries.get('audio/bastardQ.wav')[i]);
                if (!same) throw Error('Enabled piano PCM changed');
                return { disabledRemoved: true, enabledPreserved: true };
            }, [...original]);
            // A cold download does not start audio or hydrate the stored sources.
            await page.reload(); await ready();
            const cold = await page.evaluate(async url => {
                const response = await fetch(url), result = await buildEnabledPatchDownload(await response.arrayBuffer());
                const entries = parseStoredZipEntries(await result.blob.arrayBuffer());
                return { context: !!audioContext, keys: JSON.parse(getZipText(entries, 'song-part.json')).assets.map(asset => asset.key).sort() };
            }, saved.upload.url);
            assert.equal(cold.context, false); assert.deepEqual(cold.keys, keys);
            assert.deepEqual(errors, []);
            fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify({ originalSha: hash(original), downloadSha: hash(downloaded),
                originalAssets: originalEntries.size - 1, keys, recalled, legacy, piano, failureNoFallback: true, cold, errors, mutations }, null, 2));
            console.log('PASS', name, 'actual ZIP click, drums only, exact retained WAVs, original/live/history unchanged, recall, legacy, Q bank, failure, cold download');
            await context.close();
        } finally { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
