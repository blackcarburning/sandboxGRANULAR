const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost test server.');

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://openclaw.blackcarburning.com/**', route => {
            if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort(); }
            return route.continue();
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && window.mygrainSongBetaAdapter);
        const setPan = async value => page.locator('#performanceBastardLoopMPlusPan').evaluate((slider, next) => {
            slider.value = String(next);
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
        await setPan(-37);
        await setPan(60);
        await setPan(-37);
        await page.waitForTimeout(100);
        assert.equal(await page.locator('#performanceBastardLoopMPlusPanValue').textContent(), '37% Left');
        await page.reload({ waitUntil: 'load' });
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        assert.equal(await page.locator('#performanceBastardLoopMPlusPan').inputValue(), '-37');
        assert.equal(await page.evaluate(() => bastardLoopMPlusPan), -.37);

        const persistence = await page.evaluate(async () => {
            stopAllPerformancePlayback({ silent: true });
            const makeBuffer = frequency => {
                const buffer = audioContext.createBuffer(1, Math.round(audioContext.sampleRate * .2), audioContext.sampleRate);
                const data = buffer.getChannelData(0);
                for (let frame = 0; frame < data.length; frame += 1) data[frame] = .2 * Math.sin(2 * Math.PI * frequency * frame / buffer.sampleRate);
                return buffer;
            };
            await applyRecordedBastardLoopMBuffer(makeBuffer(220), { bpm: 120 });
            await applyRecordedBastardLoopMPlusBuffer(makeBuffer(330), { bpm: 120 });
            const lead = bastardLoopMRawBuffer;
            const backing = bastardLoopMPlusRawBuffer;
            setBastardLoopMPlusPanPercent(48);
            const preset = gatherPreset();
            setBastardLoopMPlusPanPercent(-80);
            applyPreset(preset);
            const patchPan = bastardLoopMPlusPan;
            const oldPreset = JSON.parse(JSON.stringify(preset));
            delete oldPreset.sliders.performanceBastardLoopMPlusPan;
            applyPreset(oldPreset);
            const oldPatchPan = bastardLoopMPlusPan;
            setBastardLoopMPlusPanPercent(-62);
            randomizeMegaBastardLoopSettings();
            const megaPan = bastardLoopMPlusPan;
            applySparseRandomLayerSelection({ silent: true });
            const sparsePan = bastardLoopMPlusPan;
            const rawUnchanged = lead === bastardLoopMRawBuffer && backing === bastardLoopMPlusRawBuffer;
            const blob = await mygrainSongBetaAdapter.capture();
            const part = await mygrainSongBetaAdapter.decode(await blob.arrayBuffer(), { buffers: new Map(), bytes: 0, limitBytes: 64 * 1024 * 1024 });
            setBastardLoopMPlusPanPercent(85);
            mygrainSongBetaAdapter.recall(part, { start: false });
            const songPan = bastardLoopMPlusPan;
            const oldSnapshot = JSON.parse(JSON.stringify(part.snapshot));
            delete oldSnapshot.state.modes.bastardLoopMPlusPan;
            delete oldSnapshot.state.sliders.performanceBastardLoopMPlusPan;
            mygrainSongBetaAdapter.recall({ snapshot: oldSnapshot, buffers: part.buffers }, { start: false });
            return { patchPan, oldPatchPan, megaPan, sparsePan, rawUnchanged, songPan, oldSongPan: bastardLoopMPlusPan };
        });
        assert.deepEqual(persistence, { patchPan: .48, oldPatchPan: 0, megaPan: -.62, sparsePan: -.62, rawUnchanged: true, songPan: -.62, oldSongPan: 0 });

        await page.evaluate(() => {
            for (const layer of SPARSE_RANDOM_LAYER_DEFINITIONS) layer.setEnabled(false, { silent: true, skipSave: true });
            setDrumMachineEnabled(false, { silent: true, skipSave: true });
            setBastardLoopMPlusEnabled(true, { silent: true, skipSave: true });
            setBastardLoopMPlusLevelPercent(50);
            setLoopLayerSolo('none', { silent: true, skipSave: true });
            setFxMuted(true, { silent: true });
            resetFinalPanLab();
            setBastardLoopMPlusPanPercent(-100);
            for (const control of ['DelayMix', 'ChorusMix', 'RoomReverbMix']) {
                const slider = document.getElementById(`performanceBastardLoopMPlus${control}`);
                slider.value = '0';
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }
            document.getElementById('globalBpmSlider').value = '300';
            document.getElementById('globalBpmSlider').dispatchEvent(new Event('input', { bubbles: true }));
            syncPatternLengthControls(8);
        });
        await page.fill('#songBetaName', 'M+ pan regression');
        await page.click('#songBetaNewSong');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song);
        await page.fill('#songBetaPartName', 'Backing left');
        await page.click('#songBetaNewPart');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts.length === 1);
        await page.click('#songBetaArm');
        await page.waitForFunction(() => mygrainSongBeta.armed && !mygrainSongBeta.busy, null, { timeout: 120000 });
        const cached = await page.evaluate(async () => {
            const buffer = await mygrainSongBeta.loadRender(mygrainSongBeta.song.parts[0]);
            const energy = channel => buffer.getChannelData(channel).reduce((sum, sample) => sum + sample * sample, 0);
            return { left: energy(0), right: energy(1) };
        });
        assert.ok(cached.left > .01, `Cached M+ left channel is silent: ${JSON.stringify(cached)}`);
        assert.ok(cached.right < cached.left * 1e-6, `Song rendering lost M+ pan: ${JSON.stringify(cached)}`);

        const audio = await page.evaluate(async () => {
            stopAllPerformancePlayback({ silent: true });
            const liveContext = audioContext;
            const results = [];
            try {
                for (const wet of [false, true]) {
                    for (const percent of [-100, 0, 100]) {
                        for (const control of ['DelayMix', 'ChorusMix', 'RoomReverbMix']) {
                            document.getElementById(`performanceBastardLoopMPlus${control}`).value = wet ? '70' : '0';
                        }
                        destroyBastardLoopMPlusFxBus();
                        const offline = new OfflineAudioContext(2, 12000, 24000);
                        audioContext = offline;
                        setBastardLoopMPlusPanPercent(percent, { skipSave: true });
                        const input = ensureBastardLoopMPlusFxBus(offline.destination);
                        const buffer = offline.createBuffer(1, 2400, 24000);
                        const data = buffer.getChannelData(0);
                        for (let frame = 0; frame < data.length; frame += 1) data[frame] = .2 * Math.sin(2 * Math.PI * 330 * frame / buffer.sampleRate);
                        const source = offline.createBufferSource();
                        source.buffer = buffer;
                        source.connect(input);
                        source.start();
                        const rendered = await offline.startRendering();
                        const energy = channel => rendered.getChannelData(channel).reduce((sum, sample) => sum + sample * sample, 0);
                        results.push({ wet, percent, left: energy(0), right: energy(1) });
                    }
                }
            } finally {
                destroyBastardLoopMPlusFxBus();
                audioContext = liveContext;
                setBastardLoopMPlusPanPercent(0);
            }
            return results;
        });
        for (const result of audio) {
            if (result.percent === -100) { assert.ok(result.left > .01); assert.ok(result.right < result.left * 1e-6); }
            if (result.percent === 100) { assert.ok(result.right > .01); assert.ok(result.left < result.right * 1e-6); }
            if (result.percent === 0) { assert.ok(result.left > .01 && result.right > .01); }
            if (!result.wet && result.percent === 0) assert.ok(Math.abs(result.left - result.right) < 1e-6);
        }
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            await page.locator('#performanceBastardLoopMPlusPan').scrollIntoViewIfNeeded();
            const fits = await page.locator('#performanceBastardLoopMPlusPan').evaluate(slider => {
                const bounds = slider.getBoundingClientRect();
                return bounds.left >= 0 && bounds.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1;
            });
            assert.equal(fits, true);
            await setPan(30);
            await page.locator('#performanceBastardLoopMPlusPanCentreBtn').click();
            assert.equal(await page.locator('#performanceBastardLoopMPlusPanValue').textContent(), 'Centre');
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log('PASS: M+ left/centre/right audio, dry and complete wet effects; raw/lead isolation; reload, patch, legacy, song recall, frozen song rendering and Mega/Sparse persistence; 390/320px controls. Zero production mutations.', JSON.stringify({ cached, audio }));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
