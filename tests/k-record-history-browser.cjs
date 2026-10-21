const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18837/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/, 'Disposable local accounts only');
const evidence = process.env.MYGRAIN_RECORD_HISTORY_EVIDENCE || '/tmp/mygrain-k-record-history';
fs.mkdirSync(evidence, { recursive: true });

async function take(page) {
    return page.evaluate(async () => {
        async function describe(buffer) {
            if (!buffer) return null;
            return { rate: buffer.sampleRate, frames: buffer.length, channels: buffer.numberOfChannels,
                hashes: await Promise.all(Array.from({ length: buffer.numberOfChannels }, async (_, channel) =>
                    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer.getChannelData(channel)))).join(','))) };
        }
        return { raw: await describe(bastardLoopKRawBuffer), rendered: await describe(bastardLoopKBuffer),
            metadata: bastardLoopKMetadata, bpm: bastardLoopKSourceBpm };
    });
}
async function setup(page) {
    await page.evaluate(async () => {
        stateSaveSuspended = true;
        stopAllPerformancePlayback({ silent: true });
        panicAllNotes({ immediate: true, preserveStatus: true });
        setArpeggiatorEnabled(false, { skipSave: true });
        setHoldEnabled(false);
        for (const layer of SPARSE_RANDOM_LAYER_DEFINITIONS) layer.setEnabled(false, { silent: true, skipSave: true });
        setDrumMachineEnabled(false, { silent: true, skipSave: true });
        clearAllPerformanceSoloStates({ silent: true, skipSave: true });
        setFxMuted(true, { silent: true });
        applyGlobalBpm(180);
        syncPatternLengthControls(8, { skipSave: true });
        const source = audioContext.createBuffer(1, Math.round(audioContext.sampleRate * 2 / 3), audioContext.sampleRate);
        for (let i = 0; i < source.length; i++) source.getChannelData(0)[i] = .2 * Math.sin(2 * Math.PI * 220 * i / source.sampleRate);
        bastardLoopBuffer = source; bastardLoopEnabled = true; bastardLoopSourceBpm = 180;
        grainASampleBuffer = source; grainBSampleBuffer = source;
        document.getElementById('grainSynthASource').value = 'grainASample';
        document.getElementById('grainSynthBSource').value = 'grainBSample';
        syncLegacyAudioBuffer();
        document.getElementById('performanceBastardLoopKRecordLength').value = '2';
        await clearBastardLoopK({ silent: true, skipSave: true });
        syncBastardLoopUi(); syncBastardLoopKUi();
        stateSaveSuspended = false;
    });
    await page.locator('#performanceKeyboardSoundSwitch [data-keyboard-sound="osc"]').tap();
    await page.waitForFunction(() => keyboardSoundSource === 'osc' && keyboardSoundReadiness !== 'loading');
    await page.evaluate(async () => {
        await prepareKeyboardSound(keyboardSoundSource);
        setArpMode('updown', { skipSave: true });
        setArpClockMultiplier(1, { skipSave: true });
        setArpeggiatorEnabled(true, { skipSave: true });
    });
    await page.locator('#keyboardContainer').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const notes = await page.evaluate(() => [...document.querySelectorAll('#keyboardContainer .key:not(.black)')].filter(key => {
        const b = key.getBoundingClientRect();
        return document.elementFromPoint(b.x + b.width / 2, b.y + b.height * .8)?.closest('.key') === key;
    }).slice(1, 4).map(key => key.dataset.note));
    assert.equal(notes.length, 3);
    for (const note of notes) {
        const key = page.locator(`#keyboardContainer .key[data-note="${note}"]`), b = await key.boundingBox();
        await key.tap({ position: { x: b.width / 2, y: b.height * .8 } });
    }
    await page.waitForFunction(() => heldNotes.size === 3 && isArpeggiatorPlaying());
}

(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        if (process.env.MYGRAIN_RECORD_HISTORY_ENGINE && process.env.MYGRAIN_RECORD_HISTORY_ENGINE !== engine) continue;
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), `mygrain-k-history-${engine}-`));
        let context, page;
        const errors = [];
        async function launch() {
            context = await type.launchPersistentContext(profile, {
                ...(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {}),
                viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce'
            });
            page = context.pages()[0] || await context.newPage();
            page.setDefaultTimeout(30000);
            page.on('pageerror', error => errors.push(error.message));
        }
        async function start() {
            await page.goto(base);
            await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
            await page.evaluate(() => mygrainCardHistory.ready);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        }
        const counts = () => page.evaluate(() => mygrainCardHistory.counts);
        async function travel(direction) {
            await page.locator(direction === 'undo' ? '#sectionJumpUndoBtn' : '#sectionJumpRedoBtn').tap();
            await page.waitForFunction(() => !mygrainCardHistory.busy);
            assert.equal(await page.evaluate(() => mygrainCardHistory.warning), '');
        }
        async function record() {
            await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
            await page.waitForFunction(() => bastardLoopKRecordingState === 'countin');
            await page.waitForFunction(() => bastardLoopKRecordingState === 'idle' && !mygrainCardHistory.busy);
            const rms = await page.evaluate(() => {
                const pcm = bastardLoopKRawBuffer.getChannelData(0);
                return Math.sqrt(pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length);
            });
            assert.ok(rms > .001, `Actual take must contain audio: ${rms}`);
            return rms;
        }
        try {
            await launch();
            const credentials = { username: `k_history_${engine}_${Date.now()}`, password: 'isolated-k-history-test' };
            assert.equal((await context.request.post(base + 'api/auth/register', { data: credentials })).status(), 200);
            await start(); await setup(page);
            const device = await page.evaluate(() => mygrainSongBeta.lease.device.id);
            assert.deepEqual(await counts(), { undo: 0, redo: 0 });
            const arpRms = await record(), first = await take(page);
            assert.deepEqual(await counts(), { undo: 1, redo: 0 }, 'Finished arp take must be one history step');
            assert.match(await page.locator('#sectionJumpUndoBtn').getAttribute('aria-label'), /Record to K/);
            await travel('undo');
            assert.equal((await take(page)).raw, null, 'Undo first recording restores empty K');
            assert.equal((await take(page)).rendered, null);
            assert.equal((await take(page)).metadata, null);
            await travel('redo'); assert.deepEqual(await take(page), first, 'Redo restores exact stereo arp PCM and metadata');
            console.log('PASS', engine, 'portrait arp record → Undo empty → Redo exact PCM', arpRms);

            await page.setViewportSize({ width: 844, height: 390 });
            await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true });
                setArpeggiatorEnabled(false, { skipSave: true });
                panicAllNotes({ immediate: true, preserveStatus: true });
                window.historyTone = audioContext.createOscillator();
                const gain = audioContext.createGain(); gain.gain.value = .07;
                historyTone.frequency.value = 733; historyTone.connect(gain); gain.connect(keyboardGrainCaptureGain); historyTone.start();
            });
            const manualRms = await record();
            await page.evaluate(() => { historyTone.stop(); historyTone.disconnect(); });
            const second = await take(page);
            assert.notDeepEqual(first.raw.hashes, second.raw.hashes);
            assert.deepEqual(await counts(), { undo: 2, redo: 0 });
            await travel('undo'); assert.deepEqual(await take(page), first);
            await travel('redo'); assert.deepEqual(await take(page), second);
            await page.locator('#performanceKeyboardKLevel').fill('63');
            await travel('undo'); assert.deepEqual(await take(page), first);
            assert.equal(await page.locator('#performanceKeyboardKLevel').inputValue(), '63', 'Unrelated fader edit survives');
            await page.evaluate(() => mygrainCardHistory.flush());
            await context.close(); await launch(); await start();
            assert.equal(await page.evaluate(() => mygrainSongBeta.lease.device.id), device);
            assert.deepEqual(await counts(), { undo: 1, redo: 1 });
            await travel('redo'); assert.deepEqual(await take(page), second, 'Redo after real browser restart restores recorded PCM');
            await travel('undo'); assert.deepEqual(await take(page), first);
            console.log('PASS', engine, 'replacement take, exact two-way restoration and browser restart', manualRms);

            // An abandoned take must not consume a step or destroy the existing Redo.
            const beforeCancel = await counts();
            for (const state of ['countin', 'recording']) {
                await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
                await page.waitForFunction(state => bastardLoopKRecordingState === state, state);
                await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
                await page.waitForFunction(() => bastardLoopKRecordingState === 'idle');
                assert.deepEqual(await counts(), beforeCancel);
                assert.deepEqual(await take(page), first);
            }
            await page.evaluate(() => {
                window.savedCapture = recordKeyboardKAtTime;
                recordKeyboardKAtTime = () => Promise.reject(new Error('isolated capture failure'));
            });
            await page.locator('#performanceKeyboardToKRecordSurfaceBtn').tap();
            await page.waitForFunction(() => bastardLoopKRecordingState === 'idle' && document.getElementById('status').textContent.includes('isolated capture failure'));
            await page.evaluate(() => { recordKeyboardKAtTime = savedCapture; });
            assert.deepEqual(await counts(), beforeCancel);
            assert.deepEqual(await take(page), first);
            await travel('redo'); assert.deepEqual(await take(page), second);
            await page.locator('#performanceKeyboardClearKBtn').tap();
            assert.equal((await take(page)).raw, null);
            await travel('undo'); assert.deepEqual(await take(page), second, 'Existing Clear K history remains compatible');
            // The same completed-take entry still obeys the Song device lease.
            await page.locator('#songBetaDeviceName').fill('Recording phone');
            await page.locator('#songBetaName').fill('K recording history reservation');
            await page.locator('#songBetaNewSong').tap();
            await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.canEditSong());
            const library = await page.evaluate(() => ({ key: mygrainSongBeta.key, id: mygrainSongBeta.song.id }));
            await page.evaluate(() => mygrainSongBeta.finishEditing());
            const other = await context.browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            try {
                assert.equal((await other.request.post(base + 'api/auth/login', { data: credentials })).status(), 200);
                const foreign = await other.newPage();
                await foreign.goto(base);
                await foreign.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
                await foreign.evaluate(async ({ key, id }) => {
                    mygrainSongBeta.key = key;
                    mygrainSongBeta.storage.setItem('mygrain-song-selected-v1', id);
                    await mygrainSongBeta.refresh();
                }, library);
                await foreign.locator('#songBetaDeviceName').fill('Other admin device');
                await foreign.evaluate(() => mygrainSongBeta.beginEditing());
                const reservedCounts = await counts();
                await travel('undo'); assert.deepEqual(await take(page), second);
                assert.deepEqual(await counts(), reservedCounts);
                assert.match(await page.locator('#status').textContent(), /Other admin device/);
                await foreign.evaluate(() => mygrainSongBeta.finishEditing());
                await page.evaluate(() => hideSettlePopup());
                await travel('undo'); assert.deepEqual(await take(page), first);
                await travel('redo'); assert.deepEqual(await take(page), second);
            } finally { await other.close(); }
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await page.locator('#performanceBastardLoopKAuditionBtn').scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(evidence, `${engine}-restored-k.png`) });
            assert.deepEqual(errors, []);
            results.push({ engine, device, arpRms, manualRms, first, second, counts: await counts() });
            console.log('PASS', engine, 'cancelled/failed takes preserve Redo; Clear Undo exact; foreign Song device blocks recording history; release restores access');
        } finally { await context?.close(); }
    }
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
