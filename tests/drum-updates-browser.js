const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use the isolated localhost test server.');

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
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
        await page.evaluate(() => {
            const buffer = audioContext.createBuffer(1, audioContext.sampleRate / 5, audioContext.sampleRate);
            const samples = buffer.getChannelData(0);
            for (let frame = 0; frame < samples.length; frame += 1) samples[frame] = .2 * Math.sin(frame * 2 * Math.PI * 440 / buffer.sampleRate);
            drumMachineKickBuffer = buffer;
            drumMachineSnareBuffer = buffer;
            drumMachineHatBuffer = buffer;
            drumMachinePercBuffer = buffer;
            for (const track of Object.values(drumMachineExtraTracks)) track.buffer = buffer;
            for (const kind of ['kick', 'snare', 'hat', 'perc', 'clap', 'cymbals']) {
                setDrumMachinePattern(kind, Array.from({ length: getDrumMachinePatternLength() }, (unused, index) => index % 4 === 0), { skipSave: true });
            }
        });
        await page.click('#performanceDrumMachineOpenBtn');
        assert.equal(await page.locator('[data-drum-jump]').count(), 6);
        assert.equal(await page.locator('#drumMachineCymbalsGrid .drum-machine-accent-btn').count(), 16);
        await page.locator('#drumMachineCymbalsGrid .drum-machine-accent-btn').nth(4).click();
        assert.equal(await page.evaluate(() => drumMachineExtraTracks.cymbals.accents[4]), true);
        assert.equal(await page.evaluate(() => drumMachineHatAccentPattern[4]), false);
        await page.click('#drumMachinePlayBtn');
        await page.waitForFunction(() => {
            const visible = [...document.querySelectorAll('#drumMachineOverlay .drum-machine-step-grid')].filter(grid => isPerformanceElementVisible(grid));
            return visible.length > 0 && visible.every(grid => grid.querySelector('.drum-machine-step-btn.current'));
        });
        const playhead = await page.evaluate(() => [...document.querySelectorAll('#drumMachineOverlay .drum-machine-step-grid')].filter(grid => isPerformanceElementVisible(grid)).map(grid => ({ index: grid.querySelector('.current').dataset.stepIndex, border: getComputedStyle(grid.querySelector('.current')).borderColor })));
        assert.equal(new Set(playhead.map(entry => entry.index)).size, 1);
        assert.ok(playhead.every(entry => entry.border === 'rgb(255, 172, 69)'), JSON.stringify(playhead));
        await page.click('#drumMachinePlayBtn');
        assert.equal(await page.locator('#drumMachineOverlay .drum-machine-step-btn.current').count(), 0);
        const setSlider = async (id, value) => page.locator(`#${id}`).evaluate((slider, next) => { slider.value = String(next); slider.dispatchEvent(new Event('input', { bubbles: true })); }, value);
        await setSlider('drumMachineHatFilterCutoff', 38);
        await setSlider('drumMachineHatFilterEnv', 72);
        await setSlider('drumMachineCymbalsFilterCutoff', 44);
        await setSlider('drumMachineCymbalsFilterEnv', 64);
        await setSlider('drumMachineCymbalsAccentAmount', 80);
        const recall = await page.evaluate(async () => {
            const preset = gatherPreset();
            const snapshot = await mygrainSongBetaAdapter.capture();
            const decoded = await mygrainSongBetaAdapter.decode(await snapshot.arrayBuffer(), { buffers: new Map(), bytes: 0, limitBytes: 128 * 1024 * 1024 });
            const settings = () => [document.getElementById('drumMachineHatFilterCutoff').value, document.getElementById('drumMachineCymbalsFilterCutoff').value, document.getElementById('drumMachineCymbalsAccentAmount').value, drumMachineExtraTracks.cymbals.accents[4]];
            applyPreset(preset);
            const patch = settings();
            const legacy = JSON.parse(JSON.stringify(preset));
            for (const prefix of ['drumMachineHat', 'drumMachineCymbals']) for (const suffix of ['FilterCutoff', 'FilterEnv']) delete legacy.sliders[`${prefix}${suffix}`];
            delete legacy.drumMachineExtraTracks.cymbals.accents;
            delete legacy.drumMachineExtraTracks.cymbals.accentAmount;
            delete legacy.sliders.drumMachineCymbalsAccentAmount;
            applyPreset(legacy);
            const oldPatch = settings();
            await mygrainSongBetaAdapter.recall(decoded, { start: false });
            const song = settings();
            saveState();
            return { patch, oldPatch, song };
        });
        assert.deepEqual(recall.patch, ['38', '44', '80', true]);
        assert.deepEqual(recall.oldPatch, ['100', '100', '35', false]);
        assert.deepEqual(recall.song, recall.patch);
        await page.click('#drumMachineCloseBtn');
        const response = await page.evaluate(async () => {
            const context = new OfflineAudioContext(1, 24000, 48000);
            const input = context.createGain();
            const desiredCutoff = 500;
            const percent = 100 * Math.log(desiredCutoff / 20) / Math.log(1000);
            const filters = MygrainDrumTone.connect(context, input, context.destination, { cutoff: percent, start: 0, duration: .2 });
            await context.startRendering();
            const frequencies = new Float32Array([100, 500, 1000, 2000]);
            const combined = [1, 1, 1, 1];
            for (const filter of filters) {
                const magnitude = new Float32Array(4);
                filter.getFrequencyResponse(frequencies, magnitude, new Float32Array(4));
                magnitude.forEach((value, index) => { combined[index] *= value; });
            }
            const db = combined.map(value => 20 * Math.log10(value));
            const measure = async (accent, synthetic) => {
                const offline = new OfflineAudioContext(1, 24000, 48000);
                const oscillator = offline.createOscillator();
                oscillator.frequency.value = 4000;
                const source = synthetic ? oscillator : offline.createBufferSource();
                if (!synthetic) {
                    source.buffer = offline.createBuffer(1, 24000, 48000);
                    const data = source.buffer.getChannelData(0);
                    for (let frame = 0; frame < data.length; frame += 1) data[frame] = Math.sin(2 * Math.PI * 4000 * frame / 48000);
                }
                MygrainDrumTone.connect(offline, source, offline.destination, { cutoff: 40, envAmount: 1, accent, start: 0, duration: .4 });
                source.start(0);
                const rendered = await offline.startRendering();
                const data = rendered.getChannelData(0);
                let energy = 0;
                for (let frame = 1000; frame < 5000; frame += 1) energy += data[frame] * data[frame];
                return Math.sqrt(energy / 4000);
            };
            return { db, samples: [await measure(false, false), await measure(true, false)], synth: [await measure(false, true), await measure(true, true)] };
        });
        assert.ok(Math.abs(response.db[1] + 3.0103) < .04, JSON.stringify(response));
        assert.ok(response.db[3] - response.db[2] < -47, JSON.stringify(response));
        assert.ok(response.samples[1] > response.samples[0] * 10);
        assert.ok(response.synth[1] > response.synth[0] * 10);
        await page.reload({ waitUntil: 'load' });
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        assert.equal(await page.locator('#drumMachineHatFilterCutoff').inputValue(), '38');
        assert.equal(await page.evaluate(() => drumMachineExtraTracks.cymbals.accents[4]), true);
        for (const width of [1440, 390, 320, 844]) {
            await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
            await page.evaluate(() => openDrumMachineOverlay());
            for (const kind of ['kick', 'snare', 'hat', 'perc', 'clap', 'cymbals']) {
                await page.click(`[data-drum-jump="${kind}"]`);
                const position = await page.locator(`#drumMachineLane-${kind}`).evaluate(card => {
                    const bounds = card.getBoundingClientRect();
                    const layout = card.parentElement.getBoundingClientRect();
                    return { top: bounds.top, bottom: bounds.bottom, start: layout.top, end: layout.bottom, width: card.clientWidth, scroll: card.scrollWidth };
                });
                assert.ok(position.top < position.end && position.bottom > position.start, JSON.stringify({ width, kind, position }));
                assert.ok(position.scroll <= position.width + 1, JSON.stringify({ width, kind, position }));
            }
            if (width === 390) await page.screenshot({ path: '/tmp/mygrain-drum-updates-mobile.png' });
            await page.click('#drumMachineCloseBtn');
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ playheads: playhead.length, independentCrashAccent: true, patchAndSongRecall: recall, reload: true, filterResponse: response, jumpTabs: true, responsive: [1440, 390, 320, 844], errors, productionWrites: writes }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
