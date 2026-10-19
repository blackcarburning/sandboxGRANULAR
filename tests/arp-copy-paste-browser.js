const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const isolated = Boolean(process.env.SONG_BETA_TEST_URL);
const base = process.env.SONG_BETA_TEST_URL || process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';
if (isolated && !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Song writes require an isolated localhost server.');
const build = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/Build <strong>(v[^<]+)<\/strong>/)[1];
const screenshots = process.env.Q_SCREENSHOT_DIR;

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const contexts = [];
    const errors = [];
    const writes = [];
    const results = [];
    async function device(sampleRate = 48000, blocked = false) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        contexts.push(context);
        await context.addInitScript(({ sampleRate, blocked }) => {
            const NativeContext = window.AudioContext;
            window.AudioContext = class extends NativeContext { constructor(options = {}) { super({ ...options, sampleRate }); } };
            window.webkitAudioContext = window.AudioContext;
            if (blocked) for (const name of ['localStorage', 'indexedDB']) Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
        }, { sampleRate, blocked });
        const page = await context.newPage();
        page.setDefaultTimeout(45000);
        page.on('pageerror', error => errors.push(error.stack));
        await page.route('**/*', route => {
            const request = route.request();
            const url = new URL(request.url());
            if (!isolated && !['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
            if (url.origin !== new URL(base).origin || (blocked && /\/SAMPLES_Q(?:_STRINGS)?\/|\/mygrain-bastardloops\//.test(url.pathname))) return route.abort();
            return route.continue();
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainQ && window.mygrainSongBeta && !mygrainSongBeta.busy && document.querySelectorAll('#bastardLoopQScale option').length === 86);
        assert.ok((await page.locator('.build-badge').first().textContent()).includes(build));
        await page.locator('#start-btn').tap();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        return page;
    }
    try {
        for (const blocked of [false, true]) {
            const page = await device(48000, blocked);
            console.log(`Touch device ready; browser storage blocked: ${blocked}.`);
            for (const id of ['performanceBastardLoopQCopyArpBtn', 'bastardLoopQCopyArpBtn', 'performanceBastardLoopLPasteArpBtn', 'performanceBastardLoopXPasteArpBtn', 'bastardLoopLPasteArpBtn', 'bastardLoopXPasteArpBtn']) assert.equal(await page.locator(`#${id}`).isDisabled(), true);
            await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true });
                syncPatternLengthControls(16, { skipSave: true });
                const state = { ...MygrainQTheory.defaults(), arpEnabled: true, arpPattern: 'custom', arpSteps: [3, 0, 1, 2, 0, 1], transpose: 12, accentAmount: .5 };
                state.sequence[0] = MygrainQTheory.normalizeStep({ notes: [49, 53, 56], velocity: 96 });
                state.sequence[2] = MygrainQTheory.normalizeStep({ kind: 'accent', notes: [], accent: true });
                mygrainQ.restore(state);
                const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                const pcm = buffer.getChannelData(0);
                for (let index = 0; index < pcm.length; index += 1) pcm[index] = .2 * Math.sin(2 * Math.PI * 130.81278265 * index / buffer.sampleRate);
                bastardLoopLSampleBuffer = buffer;
                bastardLoopXSampleBuffer = buffer;
                bastardLoopLSampleMetadata = { fileName: 'Arp-fixture-C3.wav', rootNote: 'C3' };
                bastardLoopXSampleMetadata = { fileName: 'Arp-fixture-C3.wav', rootNote: 'C3' };
                bastardLoopLRootNote = 'C3';
                bastardLoopXRootNote = 'C3';
                bastardLoopLSourceMode = 'sample';
                bastardLoopLSequence = Array.from({ length: 64 }, createEmptyBastardLoopLStep);
                bastardLoopXSequence = Array.from({ length: 64 }, createEmptyBastardLoopXStep);
                setBastardLoopLStep(1, { note: 'A2', accent: true, slide: true, ratchet: 3 });
                setBastardLoopXStep(1, { note: 'A2', accent: true, slide: true, ratchet: 3 });
                bastardLoopLTimingIndex = 2;
                bastardLoopXTimingIndex = 3;
            });
            await page.locator('#performanceBastardLoopQCopyArpBtn').tap();
            console.log('Card Copy Arp tapped.');
            const phrase = await page.evaluate(() => mygrainQ.getArpClipboard().steps);
            assert.equal(phrase.length, 16);
            assert.deepEqual(phrase.slice(0, 6).map(step => step.note), ['G#4', '', 'C#4', 'F4', '', 'C#4']);
            assert.equal(phrase[2].accent, true);
            assert.deepEqual(phrase.slice(0, 6).map(step => step.rest), [false, true, false, false, true, false]);
            assert.ok(phrase.slice(6).every(step => step.rest));
            for (const layer of ['L', 'X']) {
                console.log(`Testing ${layer} paste buttons and cursor.`);
                await page.locator(`#performanceBastardLoop${layer}EditBtn`).tap();
                await page.locator(`#bastardLoop${layer}StepGrid [data-step-index="4"]`).tap();
                await page.locator(`#bastardLoop${layer}PasteArpBtn`).tap();
                const pasted = await page.evaluate(layer => ({ sequence: layer === 'L' ? bastardLoopLSequence : bastardLoopXSequence, cursor: layer === 'L' ? bastardLoopLEditStepIndex : bastardLoopXEditStepIndex, rate: layer === 'L' ? bastardLoopLTimingIndex : bastardLoopXTimingIndex }), layer);
                assert.deepEqual(pasted.sequence.slice(4, 16), phrase.slice(0, 12));
                assert.deepEqual(pasted.sequence[1], { note: 'A2', rest: false, accent: true, slide: true, ratchet: 3 });
                assert.equal(pasted.cursor, 4);
                assert.equal(pasted.rate, layer === 'L' ? 2 : 3);
                await page.locator(`#bastardLoop${layer}StepGrid [data-step-index="14"]`).tap();
                await page.locator(`#bastardLoop${layer}PasteArpBtn`).tap();
                assert.match(await page.locator(`#bastardLoop${layer}Status`).textContent(), /14 pulses not pasted \(no wrap\)/);
                await page.locator(`#bastardLoop${layer}CloseBtn`).tap();
                await page.evaluate(layer => {
                    if (layer === 'L') setBastardLoopLEditStepIndex(10);
                    else setBastardLoopXEditStepIndex(10);
                }, layer);
                await page.locator(`#performanceBastardLoop${layer}PasteArpBtn`).tap();
                assert.deepEqual(await page.evaluate(layer => (layer === 'L' ? bastardLoopLSequence : bastardLoopXSequence).slice(10, 16), layer), phrase.slice(0, 6));
            }
            await page.locator('#performanceBastardLoopQEditBtn').tap();
            await page.evaluate(() => { document.getElementById('bastardLoopQPlaybackSettings').open = true; });
            await page.selectOption('#bastardLoopQArpEnabled', '0');
            assert.equal(await page.locator('#bastardLoopQCopyArpBtn').isDisabled(), true);
            assert.equal(await page.locator('#performanceBastardLoopQCopyArpBtn').isDisabled(), true);
            assert.deepEqual(await page.evaluate(() => mygrainQ.getArpClipboard().steps), phrase);
            await page.selectOption('#bastardLoopQArpEnabled', '1');
            await page.locator('#bastardLoopQCopyArpBtn').tap();
            for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
                await page.setViewportSize(viewport);
                await page.locator('#bastardLoopQCopyArpBtn').scrollIntoViewIfNeeded();
                assert.ok(await page.evaluate(() => { const shell = document.querySelector('#bastardLoopQOverlay .q-shell'); return shell.scrollWidth <= shell.clientWidth + 1; }));
                if (screenshots && !blocked) await page.screenshot({ path: path.join(screenshots, `q-copy-${viewport.width}.png`) });
            }
            await page.locator('#bastardLoopQCloseBtn').tap();
            const copiedBeforeEdit = await page.evaluate(() => mygrainQ.getArpClipboard());
            await page.evaluate(() => { mygrainQ.state.arpSteps = [1, 1]; mygrainQ.state.transpose = -12; mygrainQ.sync(); });
            assert.deepEqual(await page.evaluate(() => mygrainQ.getArpClipboard()), copiedBeforeEdit);
            results.push({ blockedStorage: blocked, customGapsAndSharps: true, accents: true, cardAndEditorTouch: true, blockCopyDisabled: true, cursorAndRatePreserved: true, noWrap: true, portraitLandscape: true, snapshotReusable: true });

            console.log('Checking the entire 64-step Q pattern, including its last chord.');
            await page.evaluate(() => {
                syncPatternLengthControls(64, { skipSave: true });
                const state = { ...MygrainQTheory.defaults(), arpEnabled: true, arpRepeat: 'until-next', arpPattern: 'custom', arpSteps: [3, 0, 1, 2] };
                state.sequence[0] = MygrainQTheory.normalizeStep({ notes: [49, 53, 56] });
                state.sequence[16] = MygrainQTheory.normalizeStep({ notes: [60, 64, 67] });
                state.sequence[24] = MygrainQTheory.normalizeStep({ notes: [60], rest: true });
                state.sequence[28] = MygrainQTheory.normalizeStep({ notes: [60, 64, 67] });
                state.sequence[32] = MygrainQTheory.normalizeStep({ notes: [65, 69, 72] });
                state.sequence[48] = MygrainQTheory.normalizeStep({ notes: [67, 71, 74] });
                state.sequence[62] = MygrainQTheory.normalizeStep({ kind: 'accent', notes: [], accent: true });
                state.sequence[63] = MygrainQTheory.normalizeStep({ notes: [74], accent: true });
                mygrainQ.restore(state);
                mygrainQ.cursor = 47;
                mygrainQ.sync();
                setBastardLoopLEditStepIndex(0);
                setBastardLoopXEditStepIndex(0);
            });
            await page.locator('#performanceBastardLoopQCopyArpBtn').tap();
            const fullCopy = await page.evaluate(() => mygrainQ.getArpClipboard());
            assert.equal(fullCopy.sourceLength, 64);
            assert.equal(fullCopy.steps.length, 64);
            assert.deepEqual(fullCopy.steps.slice(0, 4).map(step => step.note), ['G#3', '', 'C#3', 'F3']);
            assert.equal(fullCopy.steps[16].note, 'G4');
            assert.ok(fullCopy.steps.slice(24, 28).every(step => step.rest));
            assert.equal(fullCopy.steps[32].note, 'C5');
            assert.equal(fullCopy.steps[48].note, 'D5');
            assert.ok(fullCopy.steps[62].accent);
            assert.deepEqual(fullCopy.steps[63], { note: 'D5', rest: false, accent: true, slide: false, ratchet: 1 });
            assert.match(await page.locator('#performanceBastardLoopQMeta').textContent(), /entire 64-step Q pattern from step 1: 64 arp pulses/);
            for (const layer of ['L', 'X']) {
                await page.locator(`#performanceBastardLoop${layer}PasteArpBtn`).tap();
                const pasted = await page.evaluate(layer => ({ sequence: layer === 'L' ? bastardLoopLSequence : bastardLoopXSequence, cursor: layer === 'L' ? bastardLoopLEditStepIndex : bastardLoopXEditStepIndex, rate: layer === 'L' ? bastardLoopLTimingIndex : bastardLoopXTimingIndex }), layer);
                assert.deepEqual(pasted.sequence, fullCopy.steps);
                assert.equal(pasted.cursor, 0);
                assert.equal(pasted.rate, layer === 'L' ? 2 : 3);
                assert.match(await page.locator(`#performanceBastardLoop${layer}Meta`).textContent(), /pasted 64 arp pulses/);
                assert.doesNotMatch(await page.locator(`#performanceBastardLoop${layer}Meta`).textContent(), /not pasted/);
            }
            await page.locator('#performanceBastardLoopQEditBtn').tap();
            await page.evaluate(() => { document.getElementById('bastardLoopQPlaybackSettings').open = true; });
            await page.locator('#bastardLoopQCopyArpBtn').tap();
            assert.deepEqual(await page.evaluate(() => mygrainQ.getArpClipboard()), fullCopy);
            await page.locator('#bastardLoopQCloseBtn').tap();
            results.push({ blockedStorage: blocked, sourceLength: 64, copiedPulses: 64, pastedAll64ToXAndL: true, finalChordAndAccents: true, allChordChangesAndRests: true, cursorIndependent: true, cardAndEditorCopyMatch: true });

            if (isolated && !blocked) {
                console.log('Saving pasted X/L Song into isolated server storage.');
                const saved = await page.evaluate(async () => {
                    stopAllPerformancePlayback({ silent: true });
                    applyGlobalBpm(120, { preserveRates: true });
                    setOscillatorsEnabled(false, { skipSave: true, silent: true });
                    setGranularLayersEnabled(false, { skipSave: true, silent: true });
                    mygrainQ.restore(MygrainQTheory.defaults());
                    const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                    const pcm = buffer.getChannelData(0);
                    for (let index = 0; index < pcm.length; index += 1) pcm[index] = .2 * Math.sin(2 * Math.PI * 130.81278265 * index / buffer.sampleRate);
                    bastardLoopLSampleBuffer = buffer;
                    bastardLoopXSampleBuffer = buffer;
                    bastardLoopLSampleMetadata = { fileName: 'Arp-fixture-C3.wav', rootNote: 'C3' };
                    bastardLoopXSampleMetadata = { fileName: 'Arp-fixture-C3.wav', rootNote: 'C3' };
                    bastardLoopLRootNote = 'C3';
                    bastardLoopXRootNote = 'C3';
                    bastardLoopLSourceMode = 'sample';
                    setBastardLoopLEnabled(true, { skipSave: true, silent: true });
                    setBastardLoopXEnabled(true, { skipSave: true, silent: true });
                    document.getElementById('songBetaName').value = 'Arp clipboard portability';
                    await mygrainSongBeta.newSong();
                    document.getElementById('songBetaPartName').value = 'Pasted X and L';
                    await mygrainSongBeta.newPart();
                    const part = await mygrainSongBeta.readPart(mygrainSongBeta.song.parts[0]);
                    return { access: JSON.stringify({ format: 'mygrain-song-library-access', version: 1, key: mygrainSongBeta.key, songId: mygrainSongBeta.song.id }), modes: part.snapshot.state.modes };
                });
                for (const sampleRate of [44100, 48000]) {
                    console.log(`Restoring pasted X/L Song on a fresh ${sampleRate} Hz device.`);
                    const fresh = await device(sampleRate, true);
                    assert.equal(await fresh.locator('#performanceBastardLoopXPasteArpBtn').isDisabled(), true);
                    await fresh.locator('#songBetaAccessFile').setInputFiles({ name: 'MYGRAIN-Song-Access.json', mimeType: 'application/json', buffer: Buffer.from(saved.access) });
                    await fresh.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song?.parts.length === 1);
                    const restored = await fresh.evaluate(async () => {
                        await mygrainSongBeta.recall(mygrainSongBeta.song.parts[0], { start: false });
                        await mygrainSongBeta.arm();
                        const bytes = await mygrainSongBeta.readRender(mygrainSongBeta.song.parts[0]);
                        const audio = await audioContext.decodeAudioData(bytes.slice(0));
                        const pcm = audio.getChannelData(0);
                        return { sequences: [bastardLoopLSequence, bastardLoopXSequence], rates: [bastardLoopLTimingIndex, bastardLoopXTimingIndex], clipboard: mygrainQ.getArpClipboard(), audioSlots: [Boolean(bastardLoopLSampleBuffer), Boolean(bastardLoopXSampleBuffer)], power: pcm.reduce((total, value) => total + value * value, 0) / pcm.length, armed: mygrainSongBeta.armed };
                    });
                    assert.deepEqual(restored.sequences, [saved.modes.bastardLoopLSequence, saved.modes.bastardLoopXSequence]);
                    assert.deepEqual(restored.rates, [saved.modes.bastardLoopLTimingIndex, saved.modes.bastardLoopXTimingIndex]);
                    assert.equal(restored.clipboard, null);
                    assert.deepEqual(restored.audioSlots, [true, true]);
                    assert.equal(restored.armed, true);
                    assert.ok(restored.power > 1e-7);
                    results.push({ freshServerRecall: true, sampleRate, clipboardAbsent: true, browserStorageAndSourceRepositoriesBlocked: true, notesGapsAccentsAndRatesRestored: true, power: restored.power });
                }
            }
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ build, isolatedServer: isolated, publicReadOnly: !isolated, results, errors, writes, physicalSafari: 'not tested' }, null, 2));
    } catch (error) {
        if (screenshots) for (const [index, context] of contexts.entries()) for (const page of context.pages()) {
            await page.screenshot({ path: path.join(screenshots, `failure-${index}.png`) }).catch(() => {});
            console.error(await page.evaluate(() => ({ title: document.title, engineStarting, stateSaveSuspended, status: document.getElementById('status')?.textContent, q: document.getElementById('performanceBastardLoopQMeta')?.textContent })).catch(() => ({})));
        }
        throw error;
    } finally {
        for (const context of contexts) await context.close();
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
