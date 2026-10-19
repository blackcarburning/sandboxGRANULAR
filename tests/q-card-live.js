const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const samples = [];
    const layouts = [];
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        page.on('pageerror', error => errors.push(error.stack));
        await page.route('**/*', route => {
            const request = route.request();
            const url = new URL(request.url());
            if (request.method() !== 'GET' || url.origin !== new URL(base).origin || url.pathname.startsWith('/mygrain-bastardloops/')) return route.abort();
            if (url.pathname.includes('/SAMPLES_Q/') && url.pathname.endsWith('.wav')) samples.push(url.pathname);
            return route.continue();
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainQ && window.mygrainSongBeta && !mygrainSongBeta.busy && document.querySelectorAll('#bastardLoopQScale option').length === 86);
        assert.equal(samples.length, 0);
        assert.ok((await page.locator('.build-badge').first().textContent()).includes('v2026.10.14.Q.6'));
        const features = await page.evaluate(async () => (await mygrainSongBeta.request('')).features);
        assert.equal(features.qPianoRenders, 3);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        await page.click('#performanceDrumMachineOpenBtn');
        await page.evaluate(() => {
            for (const lane of ['kick', 'snare', 'hat', 'perc']) setDrumMachinePattern(lane, Array(16).fill(false), { skipSave: true });
            drumMachineKickRatchetPattern.fill(0);
            drumMachinePercRatchetPattern.fill(0);
            renderDrumMachineStepGrid('kick'); renderDrumMachineStepGrid('perc');
        });
        await page.click('#drumMachinePercGrid .drum-machine-step-btn[data-step-index="3"]');
        await page.click('#drumMachinePercGrid .drum-machine-ratchet-btn[data-step-index="7"]');
        assert.deepEqual(await page.evaluate(() => ({ percNote: drumMachinePercPattern[3], percRatchetNote: drumMachinePercPattern[7], percRatchet: drumMachinePercRatchetPattern[7], kickNotes: drumMachineKickPattern.some(Boolean), kickRatchets: drumMachineKickRatchetPattern.some(Boolean) })), { percNote: true, percRatchetNote: true, percRatchet: 2, kickNotes: false, kickRatchets: false });
        await page.click('#drumMachineCloseBtn');
        await page.evaluate(() => {
            setOscillatorsEnabled(false, { skipSave: true, silent: true });
            setGranularLayersEnabled(false, { skipSave: true, silent: true });
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            finalAmplifierNode.connect(analyser);
            window.qLiveAnalyser = analyser;
        });
        await page.locator('#bastardLoopQCard').scrollIntoViewIfNeeded();
        await page.screenshot({ path: '/tmp/mygrain-q-live-card-desktop.png' });
        await page.click('#performanceBastardLoopQEditBtn');
        const auditionState = await page.evaluate(() => ({ enabled: mygrainQ.state.enabled, roots: document.querySelector('#bastardLoopQRoot').options.length }));
        assert.equal(auditionState.enabled, false);
        assert.equal(auditionState.roots, 7);
        await page.click('[data-q-degree="0"]');
        await page.waitForFunction(() => {
            const audio = new Float32Array(qLiveAnalyser.fftSize);
            qLiveAnalyser.getFloatTimeDomainData(audio);
            return audio.some(sample => Math.abs(sample) > .001);
        });
        const audition = await page.evaluate(() => ({ simultaneousNotes: [...mygrainQ.voices].map(voice => voice.pitch), enabled: mygrainQ.state.enabled }));
        assert.deepEqual(audition.simultaneousNotes, [48, 52, 55]);
        assert.equal(audition.enabled, false);
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 844 }]) {
            await page.setViewportSize(viewport);
            await page.waitForFunction(() => Math.abs(document.getElementById('bastardLoopQOverlay').getBoundingClientRect().height - visualViewport.height) < 1);
            const layout = await page.locator('#bastardLoopQOverlay').evaluate(overlay => {
                const shell = overlay.querySelector('.q-shell');
                const bounds = shell.getBoundingClientRect();
                const palette = overlay.querySelector('#bastardLoopQPalette').getBoundingClientRect();
                const grid = overlay.querySelector('.q-grid-scroll').getBoundingClientRect();
                const toolbar = overlay.querySelector('.q-session-controls').getBoundingClientRect();
                return { width: innerWidth, height: innerHeight, visible: getComputedStyle(overlay).display, left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, horizontalOverflow: shell.scrollWidth > shell.clientWidth + 1, chords: overlay.querySelectorAll('.q-chord').length, paletteBottom: palette.bottom, gridTop: grid.top, gridBottom: grid.bottom, transportBottom: toolbar.bottom };
            });
            assert.equal(layout.visible, 'flex');
            assert.equal(layout.horizontalOverflow, false);
            assert.ok(layout.left >= 0 && layout.right <= viewport.width && layout.top >= 0 && layout.bottom <= viewport.height);
            assert.ok(layout.chords > 50 && layout.paletteBottom <= layout.gridTop && layout.gridBottom < viewport.height && layout.transportBottom < viewport.height);
            layouts.push(layout);
            if (viewport.width === 390) await page.screenshot({ path: '/tmp/mygrain-q-live-sequencer-mobile.png' });
        }
        await page.click('#bastardLoopQCloseBtn');
        await page.evaluate(() => mygrainQ.stop());
        const transport = await page.evaluate(() => {
            const status = document.getElementById('songBetaStatus');
            const parts = document.getElementById('songBetaParts');
            const measurements = ['Song stopped.', 'Playing 3/5: Piano verse · audio-clock scheduled.', 'Song stopped. '.repeat(100)].map(message => {
                status.textContent = message;
                return { height: status.getBoundingClientRect().height, partTop: parts.getBoundingClientRect().top };
            });
            return { title: document.getElementById('songBetaTransportInfoTitle').textContent, lineHeight: Number.parseFloat(getComputedStyle(status).lineHeight), measurements };
        });
        assert.equal(transport.title, 'TRANSPORT INFO');
        assert.equal(transport.measurements[0].height, transport.lineHeight * 3);
        assert.equal(new Set(transport.measurements.map(item => item.height)).size, 1);
        assert.equal(new Set(transport.measurements.map(item => item.partTop)).size, 1);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ readOnlyPublicVerification: true, percTargetsOwnLane: true, initialAudioRequests: 0, loadedPianoFiles: [...new Set(samples)].length, audition, layouts, transport, errors }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
