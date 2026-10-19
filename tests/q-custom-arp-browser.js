const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost test server; this check saves test arps and Songs.');
const screenshotDir = process.env.Q_SCREENSHOT_DIR;

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const requestsBlocked = [];
    const contexts = [];
    const results = [];
    async function device(rate = 48000, clean = false) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
        contexts.push(context);
        await context.addInitScript(({ rate, clean }) => {
            const NativeContext = window.AudioContext;
            window.AudioContext = class extends NativeContext { constructor(options = {}) { super({ ...options, sampleRate: rate }); } };
            window.webkitAudioContext = window.AudioContext;
            if (clean) for (const name of ['localStorage', 'indexedDB']) Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
        }, { rate, clean });
        const page = await context.newPage();
        page.setDefaultTimeout(60000);
        page.on('pageerror', error => errors.push(error.stack));
        await page.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin !== new URL(base).origin) return route.abort();
            if (clean && /\/SAMPLES_Q(?:_STRINGS)?\/|\/api\/arps$/.test(url.pathname)) { requestsBlocked.push(url.pathname); return route.abort(); }
            return route.continue();
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainQ && window.mygrainSongBeta && !mygrainSongBeta.busy && document.querySelectorAll('#bastardLoopQScale option').length === 86);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        return page;
    }
    try {
        const page = await device();
        await page.click('#performanceBastardLoopQEditBtn');
        await page.evaluate(() => { document.getElementById('bastardLoopQEditTools').open = true; });
        await page.click('[data-q-step="1"]');
        await page.click('[data-q-action="accent"]');
        assert.deepEqual(await page.evaluate(() => mygrainQ.state.sequence[1]), { kind: 'accent', notes: [], accent: true });
        assert.match(await page.locator('[data-q-step="1"]').textContent(), /— !/);
        await page.click('[data-q-step="1"]');
        assert.equal(await page.evaluate(() => mygrainQ.preview), null);
        await page.click('#bastardLoopQCloseBtn');
        await page.click('#performanceBastardLoopQArpBuilderBtn');
        await page.waitForFunction(() => !mygrainQ.arpBuilder.busy);
        const presetCount = await page.evaluate(() => mygrainQ.arpBuilder.presets.length);
        await page.fill('#qArpLength', '6');
        await page.locator('#qArpLength').press('Tab');
        for (const [column, rank] of [3, 0, 1, 8, 0, 2].entries()) {
            const cell = page.locator(`[data-arp-column="${column}"][data-arp-rank="${rank}"]`);
            if (await cell.getAttribute('aria-pressed') !== 'true') await cell.click();
        }
        await page.selectOption('#qArpDivision', '0.25');
        await page.selectOption('#qArpRepeat', 'until-next');
        await page.click('#qArpApply');
        assert.deepEqual(await page.evaluate(() => ({ enabled: mygrainQ.state.arpEnabled, pattern: mygrainQ.state.arpPattern, steps: mygrainQ.state.arpSteps })), { enabled: true, pattern: 'custom', steps: [3, 0, 1, 8, 0, 2] });
        const presetName = `Browser grid ${Date.now()}`;
        await page.fill('#qArpName', presetName);
        await page.click('#qArpSave');
        await page.waitForFunction(name => document.getElementById('qArpStatus').textContent.includes(`Saved “${name}”`), presetName);
        const saved = await page.evaluate(() => mygrainQ.arpBuilder.presets.find(preset => preset.id === document.getElementById('qArpPresets').value));
        assert.equal(saved.name, presetName);
        assert.deepEqual(saved.pattern.steps, [3, 0, 1, 8, 0, 2]);
        await page.click('#qArpSave');
        await page.waitForFunction(() => !mygrainQ.arpBuilder.busy && document.getElementById('qArpStatus').textContent.startsWith('Not saved:'));
        assert.equal(await page.evaluate(() => mygrainQ.arpBuilder.presets.length), presetCount + 1);
        for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            await page.locator('#qArpApply').scrollIntoViewIfNeeded();
            const bounds = await page.locator('#qArpOverlay').boundingBox();
            assert.ok(bounds && bounds.width <= viewport.width + 1 && bounds.height <= viewport.height + 1);
            assert.ok(await page.evaluate(() => document.querySelector('.q-arp-shell').scrollWidth <= document.querySelector('.q-arp-shell').clientWidth + 1));
            assert.ok(await page.locator('#qArpApply').isVisible());
            if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `custom-arp-${viewport.width}x${viewport.height}.png`) });
        }
        await page.locator('#qArpClose').scrollIntoViewIfNeeded();
        await page.locator('#qArpClose').focus();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#qArpOverlay').getAttribute('aria-hidden'), 'true');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'performanceBastardLoopQArpBuilderBtn');
        console.log('Grid UI, preset save and duplicate protection pass.');

        const audio = await page.evaluate(async () => {
            const readings = [];
            for (const sampleRate of [44100, 48000]) for (const instrument of ['piano', 'strings']) {
                async function render(accent) {
                    const context = new OfflineAudioContext(2, sampleRate, sampleRate);
                    const controller = new MygrainQ.Controller({ context: () => context, destination: () => context.destination, length: () => 16, bpm: () => 120, soloGain: () => 1 });
                    Object.assign(controller.state, { enabled: true, instrument, accentAmount: .5, room: 0, delay: 0 });
                    controller.origin = .05;
                    if (accent) controller.state.sequence[1] = MygrainQTheory.normalizeStep({ kind: 'accent', notes: [], accent: true });
                    const buffer = context.createBuffer(2, sampleRate * 2, sampleRate);
                    for (let channel = 0; channel < 2; channel += 1) for (let frame = 0; frame < buffer.length; frame += 1) buffer.getChannelData(channel)[frame] = .2 * Math.sin(2 * Math.PI * 440 * frame / sampleRate);
                    controller.piano.source = () => ({ sample: { midi: 48 }, buffer, offset: 0, duration: 2, loopStart: .1, loopEnd: .9 });
                    controller.voice(48, 127, .05, .5, { grid: true, stepSeconds: .125, baseVelocity: 127 });
                    const rendered = await context.startRendering();
                    const pcm = rendered.getChannelData(0);
                    function rms(start) {
                        let power = 0;
                        const count = Math.round(sampleRate * .04);
                        for (let frame = Math.round(start * sampleRate); frame < Math.round(start * sampleRate) + count; frame += 1) power += pcm[frame] ** 2;
                        return Math.sqrt(power / count);
                    }
                    return { before: rms(.1), accent: rms(.2), after: rms(.35), peak: pcm.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0) };
                }
                const dry = await render(false);
                const accented = await render(true);
                const gapContext = new OfflineAudioContext(2, sampleRate, sampleRate);
                Object.defineProperty(gapContext, 'state', { value: 'running' });
                const gapController = new MygrainQ.Controller({ context: () => gapContext, destination: () => gapContext.destination, length: () => 16, bpm: () => 120, soloGain: () => 1 });
                Object.assign(gapController.state, { enabled: true, instrument, arpEnabled: true, arpPattern: 'custom', arpSteps: [1, 0], room: 0, delay: 0 });
                gapController.state.sequence[0] = MygrainQTheory.normalizeStep({ notes: [48], velocity: 127 });
                gapController.running = true;
                gapController.playbackState = MygrainQTheory.copy(gapController.state);
                gapController.origin = .05;
                const gapSource = gapContext.createBuffer(2, sampleRate * 2, sampleRate);
                for (let channel = 0; channel < 2; channel += 1) for (let frame = 0; frame < gapSource.length; frame += 1) gapSource.getChannelData(channel)[frame] = .2 * Math.sin(2 * Math.PI * 440 * frame / sampleRate);
                gapController.piano.source = () => ({ sample: { midi: 48 }, buffer: gapSource, offset: 0, duration: 2, loopStart: .1, loopEnd: .9 });
                gapController.tick();
                const gapRendered = await gapContext.startRendering();
                const gapPcm = gapRendered.getChannelData(0);
                const energyAt = start => {
                    const count = Math.round(sampleRate * .03);
                    let power = 0;
                    for (let frame = Math.round(start * sampleRate); frame < Math.round(start * sampleRate) + count; frame += 1) power += gapPcm[frame] ** 2;
                    return power / count;
                };
                readings.push({ sampleRate, instrument, sustainedGain: accented.accent / dry.accent, beforeGain: accented.before / dry.before, afterGain: accented.after / dry.after, peak: accented.peak, gapToNotePower: energyAt(.21) / energyAt(.1) });
            }
            return readings;
        });
        for (const reading of audio) {
            assert.ok(Math.abs(reading.sustainedGain - 2) < .01, JSON.stringify(reading));
            assert.ok(Math.abs(reading.beforeGain - 1) < .01);
            assert.ok(Math.abs(reading.afterGain - 1) < .01);
            assert.ok(reading.peak < 1);
            assert.ok(reading.gapToNotePower < .0004, JSON.stringify(reading));
        }
        results.push({ gainAtVelocity127: audio });
        console.log('Sustained blank-cell gain is 2x at 44.1/48 kHz for both instruments.');

        const other = await device(44100);
        await other.evaluate(() => {
            for (const name of ['localStorage', 'indexedDB']) Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
        });
        await other.click('#performanceBastardLoopQArpBuilderBtn');
        await other.waitForFunction(() => !mygrainQ.arpBuilder.busy);
        await other.selectOption('#qArpPresets', saved.id);
        await other.click('#qArpLoad');
        await other.click('#qArpApply');
        assert.deepEqual(await other.evaluate(() => mygrainQ.state.arpSteps), saved.pattern.steps);
        await other.click('#qArpClose');
        results.push({ globalPresetFreshDeviceStorageBlocked: true });
        console.log('Shared arp reload passes with storage blocked.');

        for (const instrument of ['piano', 'strings']) {
            const source = await page.evaluate(async instrument => {
                stopAllPerformancePlayback({ silent: true });
                syncPatternLengthControls(16, { skipSave: true });
                applyGlobalBpm(300);
                setOscillatorsEnabled(false, { skipSave: true, silent: true });
                setGranularLayersEnabled(false, { skipSave: true, silent: true });
                const state = { ...MygrainQTheory.defaults(), instrument, enabled: true, arpEnabled: true, arpPattern: 'custom', arpSteps: [3, 0, 1, 2, 0, 1], arpRepeat: 'until-next', arpDivision: .25, accentAmount: .5 };
                state.sequence[0] = MygrainQTheory.normalizeStep({ notes: [48, 52, 55], velocity: 96, gate: 4 });
                state.sequence[2] = MygrainQTheory.normalizeStep({ kind: 'accent', notes: [], accent: true });
                state.sequence[10] = MygrainQTheory.normalizeStep({ notes: [48], rest: true });
                mygrainQ.restore(state);
                document.getElementById('songBetaName').value = `Custom arp ${instrument}`;
                await mygrainSongBeta.newSong();
                document.getElementById('songBetaPartName').value = 'Gaps and blank accents';
                document.getElementById('songBetaRepeats').value = '1';
                await mygrainSongBeta.newPart();
                const access = JSON.stringify({ format: 'mygrain-song-library-access', version: 1, key: mygrainSongBeta.key, songId: mygrainSongBeta.song.id });
                const part = await mygrainSongBeta.readPart(mygrainSongBeta.song.parts[0]);
                if (Object.keys(part.snapshot.state.selects).some(id => id.startsWith('qArp')) || part.snapshot.extra.controls.some(control => control.id.startsWith('qArp'))) throw new Error('Popup drafts leaked into a Song snapshot.');
                return { access, q: mygrainQ.getState(), qVersion: mygrainSongBeta.song.parts[0].qVersion };
            }, instrument);
            assert.equal(source.qVersion, 6);
            console.log(`Saved ${instrument} custom arp source; testing clean recalls.`);
            for (const sampleRate of [44100, 48000]) {
                const fresh = await device(sampleRate, true);
                await fresh.locator('#songBetaAccessFile').setInputFiles({ name: 'MYGRAIN-Song-Access.json', mimeType: 'application/json', buffer: Buffer.from(source.access) });
                await fresh.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song?.parts.length > 0);
                const recalled = await fresh.evaluate(async () => {
                    const part = mygrainSongBeta.song.parts[0];
                    await mygrainSongBeta.recall(part, { start: false });
                    const state = mygrainQ.getState();
                    await mygrainSongBeta.arm();
                    const bytes = await mygrainSongBeta.readRender(mygrainSongBeta.song.parts[0]);
                    const rendered = await audioContext.decodeAudioData(bytes.slice(0));
                    const pcm = rendered.getChannelData(0);
                    return { state, bankPinned: mygrainQ.piano.pinned, armed: mygrainSongBeta.armed, renderVersion: mygrainSongBeta.song.parts[0].render.qVersion, power: pcm.reduce((total, value) => total + value * value, 0) / pcm.length };
                });
                assert.deepEqual(recalled.state, source.q);
                assert.equal(recalled.bankPinned, true);
                assert.equal(recalled.armed, true);
                assert.equal(recalled.renderVersion, 6);
                assert.ok(recalled.power > 1e-7);
                results.push({ instrument, sampleRate, freshSongRecall: true, storageAndRepositoriesBlocked: true, renderVersion: 6, power: recalled.power });
                console.log(`${instrument} clean Song recall/render passes at ${sampleRate} Hz.`);
            }
        }
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ isolatedServer: true, results, errors, blockedSampleRequests: requestsBlocked, physicalSafari: 'not tested' }, null, 2));
    } finally {
        for (const context of contexts) await context.close();
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
