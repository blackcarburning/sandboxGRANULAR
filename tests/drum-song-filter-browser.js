const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use the isolated localhost test server.');

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    try {
        const page = await browser.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://openclaw.blackcarburning.com/**', route => {
            if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort(); }
            return route.continue();
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainSongBeta.busy);
        await page.evaluate(() => {
            stopAllPerformancePlayback({ silent: true });
            const options = { silent: true, skipSave: true };
            setGeneratedLoopTransportEnabled(false, options);
            setOscillatorsEnabled(false, options);
            setGranularLayersEnabled(false, options);
            setDropboxSampleLayerEnabled(false, options);
            for (const setter of [setBastardLoopEnabled, setBastardLoop2Enabled, setBastardLoop3Enabled, setBastardLoopVEnabled, setBastardLoopPEnabled, setBastardLoopOEnabled, setBastardLoopMEnabled, setBastardLoopMPlusEnabled, setBastardLoopLEnabled, setBastardLoopXEnabled]) setter(false, options);
            setLoopLayerSolo('none', options);
            setArpeggiatorEnabled(false);
            seqGrainsEnabled = false;
            document.getElementById('seqGrainsEnabled').checked = false;
            setFxMuted(true, options);
            resetFinalPanLab();
            setDrumMachineEnabled(true, options);
            setDrumMachineDirectOutput(true, options);
            applyGlobalBpm(300);
            syncPatternLengthControls(8, options);
            const buffer = audioContext.createBuffer(1, Math.round(audioContext.sampleRate * .15), audioContext.sampleRate);
            const data = buffer.getChannelData(0);
            for (let frame = 0; frame < data.length; frame += 1) data[frame] = .2 * Math.sin(2 * Math.PI * 4000 * frame / buffer.sampleRate);
            drumMachineHatBuffer = buffer;
            drumMachineExtraTracks.cymbals.buffer = buffer;
            for (const kind of ['kick', 'snare', 'hat', 'perc', 'clap', 'cymbals']) setDrumMachinePattern(kind, Array.from({ length: 8 }, (unused, index) => ['hat', 'cymbals'].includes(kind) && index === 0), options);
            mygrainSongBeta.armConcurrency = 1;
        });
        await page.fill('#songBetaName', 'Drum filter frozen renders');
        await page.click('#songBetaNewSong');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song);
        for (const [name, cutoff, accent, envelope] of [['Open', 100, false, 0], ['Closed', 30, false, 0], ['Accent opens', 30, true, 100]]) {
            await page.evaluate(({ cutoff, accent, envelope }) => {
                for (const prefix of ['drumMachineHat', 'drumMachineCymbals']) {
                    for (const [suffix, value] of [['FilterCutoff', cutoff], ['FilterEnv', envelope]]) setSliderValue(`${prefix}${suffix}`, value);
                }
                drumMachineHatAccentPattern = Array.from({ length: 8 }, (unused, index) => accent && index === 0);
                drumMachineExtraTracks.cymbals.accents = drumMachineHatAccentPattern.slice();
                saveState({ force: true });
            }, { cutoff, accent, envelope });
            await page.fill('#songBetaPartName', name);
            await page.click('#songBetaNewPart');
            await page.waitForFunction(name => !mygrainSongBeta.busy && mygrainSongBeta.song.parts.some(part => part.name === name), name);
        }
        await page.click('#songBetaArm');
        await page.waitForFunction(() => mygrainSongBeta.armed && !mygrainSongBeta.busy, null, { timeout: 120000 });
        const energy = await page.evaluate(async () => {
            const energy = {};
            for (const part of mygrainSongBeta.song.parts) {
                const rendered = await mygrainSongBeta.loadRender(part);
                energy[part.name] = rendered.getChannelData(0).reduce((sum, sample) => sum + sample * sample, 0);
            }
            return energy;
        });
        assert.ok(energy.Open > .01, JSON.stringify(energy));
        assert.ok(energy.Closed < energy.Open / 100, JSON.stringify(energy));
        assert.ok(energy['Accent opens'] > energy.Closed * 10, JSON.stringify(energy));
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ frozenFilterAndEnvelope: true, energy, productionWrites: writes, errors }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
