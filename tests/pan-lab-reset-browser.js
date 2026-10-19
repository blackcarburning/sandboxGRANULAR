const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';
const controls = ['finalPanCenter', 'finalPanWidth', 'finalPanLfoDepth', 'finalPanAudioDepth', 'finalPanOrbit', 'finalPanGravity'];

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
        const errors = [];
        const writes = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
            if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().method()); return route.abort(); }
            return route.continue();
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        await page.evaluate(controls => {
            saveState({ force: true });
            const state = readStoredStateSnapshot();
            state.sliders.cutoff = '4321';
            for (const id of controls) { state.sliders[id] = '77'; document.getElementById(id).value = '77'; }
            localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
            document.getElementById('performancePanLabResetBtn').click();
        }, controls);
        const beforeStart = await page.evaluate(controls => ({ neutral: controls.every(id => readStoredStateSnapshot().sliders[id] === '0'), preserved: readStoredStateSnapshot().sliders.cutoff, suspended: stateSaveSuspended }), controls);
        assert.deepEqual(beforeStart, { neutral: true, preserved: '4321', suspended: true });
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        assert.equal(await page.evaluate(controls => controls.every(id => document.getElementById(id).value === '0'), controls), true);
        await page.evaluate(() => {
            applyGlobalBpm(120);
            setGeneratedLoopTransportEnabled(false, { silent: true, skipSave: true });
            setOscillatorsEnabled(false, { silent: true, skipSave: true });
            setGranularLayersEnabled(false, { silent: true, skipSave: true });
            setArpeggiatorEnabled(false);
            setDrumMachineEnabled(false, { silent: true, skipSave: true });
            setDropboxSampleLayerEnabled(false, { silent: true, skipSave: true });
            setFxMuted(true, { silent: true });
            const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
            const samples = buffer.getChannelData(0);
            for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(index / audioContext.sampleRate * Math.PI * 2 * 220) * .2;
            bastardLoopBuffer = buffer;
            bastardLoopSourceBpm = 120;
            bastardLoopMetadata = { durationSeconds: 2 };
            setBastardLoopEnabled(true, { silent: true, skipSave: true });
            setBastardLoopVCut({ enabled: true, start: .25, end: .5 }, { skipSave: true });
            startAllBastardLoopLayers(audioContext.currentTime + .05);
            window.panResetOriginalSource = bastardLoopSource;
            window.panResetOriginalContext = audioContext;
            window.panResetSavedSongs = JSON.stringify(mygrainSongBeta.song);
        });

        const armMotion = () => page.evaluate(controls => {
            controls.forEach(id => { const element = document.getElementById(id); element.value = id === 'finalPanCenter' ? '-85' : '90'; element.dispatchEvent(new Event('input', { bubbles: true })); });
            document.getElementById('finalPanLfoRate').value = '180';
            document.getElementById('finalPanLfoWaveform').value = 'pulse';
            updateFinalOutputPanning();
        }, controls);
        const verifyReset = async () => {
            await page.waitForFunction(() => Math.abs(finalPanBaseOffsetSource.offset.value) < .0001 && Math.abs(finalPanAudioDepthGain.gain.value) < .0001);
            const state = await page.evaluate(controls => ({
                values: controls.map(id => document.getElementById(id).value),
                labels: controls.map(id => document.getElementById(id + 'Value').textContent),
                persisted: controls.map(id => readStoredStateSnapshot().sliders[id]),
                liveSourcePreserved: bastardLoopSource === panResetOriginalSource && bastardLoopPlaying,
                contextPreserved: audioContext === panResetOriginalContext,
                cut: [bastardLoopVCut.enabled, bastardLoopVCut.start, bastardLoopVCut.end],
                rate: document.getElementById('finalPanLfoRate').value,
                waveform: document.getElementById('finalPanLfoWaveform').value,
                fx: fxMuted,
                songsUnchanged: JSON.stringify(mygrainSongBeta.song) === panResetSavedSongs,
                status: document.getElementById('status').textContent
            }), controls);
            assert.deepEqual(state.values, controls.map(() => '0'));
            assert.deepEqual(state.labels, controls.map(() => '0%'));
            assert.deepEqual(state.persisted, controls.map(() => '0'));
            assert.equal(state.liveSourcePreserved, true);
            assert.equal(state.contextPreserved, true);
            assert.deepEqual(state.cut, [true, .25, .5]);
            assert.equal(state.rate, '180');
            assert.equal(state.waveform, 'pulse');
            assert.equal(state.fx, true);
            assert.equal(state.songsUnchanged, true);
            assert.match(state.status, /all pan motion off; final output centered/);
        };

        await armMotion();
        await page.click('#performancePanLabResetBtn');
        await verifyReset();
        console.log('PASS: Actions reset centers actual panner, disables all motion, persists and leaves playback, vocal cut, effects and saved songs unchanged.');

        assert.equal(await page.locator('#sectionJumpHandle').isVisible(), false);
        for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            await armMotion();
            await page.locator('#sectionJumpHandle').tap();
            await page.locator('#sectionJumpPanLabResetBtn').tap();
            await verifyReset();
            await page.waitForFunction(() => {
                const drawer = document.getElementById('sectionJumpDrawer');
                const title = document.querySelector('#finalPanSection h3').getBoundingClientRect();
                return !drawer.classList.contains('is-open') && !drawer.classList.contains('is-settling') && drawer.getBoundingClientRect().left >= innerWidth - 35 && title.top >= -2 && title.top < innerHeight - 30;
            });
            const position = await page.evaluate(() => {
                const section = document.getElementById('finalPanSection').getBoundingClientRect();
                const title = document.querySelector('#finalPanSection h3').getBoundingClientRect();
                return { titleTop: title.top, titleBottom: title.bottom, sectionBottom: section.bottom, height: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
            });
            assert.ok(position.titleTop >= -2 && position.titleTop < position.height - 30, JSON.stringify(position));
            assert.equal(position.horizontalOverflow, false);
            if (viewport.width === 390) await page.screenshot({ path: '/tmp/mygrain-pan-lab-reset-mobile.png' });
        }
        console.log('PASS: Jump executes Reset Pan Lab and then lands at Pan Lab on mobile, narrow-screen and landscape, closing the drawer; existing desktop visibility is unchanged.');

        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        assert.equal(await page.evaluate(controls => controls.every(id => document.getElementById(id).value === '0'), controls), true);
        await page.evaluate(() => stopAllPerformancePlayback({ silent: true }));
        await page.click('#performancePanLabResetBtn');
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        if (base.startsWith('https://openclaw.blackcarburning.com/')) {
            const live = await page.request.get(base + 'index.html');
            assert.equal(live.status(), 200);
            assert.equal(await live.text(), fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'));
        }
        console.log('PASS: Reload retains neutral pan; reset works while stopped. Live HTML matches, no page errors or server writes.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
