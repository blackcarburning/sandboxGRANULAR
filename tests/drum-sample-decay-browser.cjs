// Disposable localhost stores; no production accounts, Songs or sample requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18891/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
const repro = process.env.DRUM_DECAY_REPRO === '1';
const evidence = process.env.DRUM_DECAY_EVIDENCE || '/tmp/mygrain-drum-decay';
fs.mkdirSync(evidence, { recursive: true });

(async () => {
    const results = [];
    for (const engine of ['chromium', 'webkit']) {
        const browser = await ({ chromium, webkit }[engine]).launch(engine === 'chromium'
            ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            assert.equal((await context.request.post(base + 'api/auth/register', { data: { username: `decay_${engine}_${Date.now()}`, password: 'isolated-drum-decay' } })).status(), 200);
            const page = await context.newPage(), errors = [];
            page.setDefaultTimeout(45000);
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
            await page.goto(base);
            await page.waitForFunction(() => window.mygrainSongBeta && document.documentElement.dataset.mygrainStartup === 'ready');
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
            await page.evaluate(async () => {
                stopAllPerformancePlayback({ silent: true });
                applyGlobalBpm(120); syncPatternLengthControls(16, { skipSave: true });
                setDrumMachineDirectOutput(true, { skipSave: true, silent: true });
                setDrumMachineEnabled(true, { skipSave: true, silent: true });
                setOscillatorsEnabled(false, { skipSave: true, silent: true });
                setGranularLayersEnabled(false, { skipSave: true, silent: true });
                const buffer = audioContext.createBuffer(2, Math.round(audioContext.sampleRate * 1.6), audioContext.sampleRate);
                for (let channel = 0; channel < 2; channel++) {
                    const data = buffer.getChannelData(channel);
                    for (let i = 0; i < data.length; i++) data[i] = .17 * Math.sin(2 * Math.PI * (301 + channel * 102) * i / buffer.sampleRate);
                }
                await applyLoadedDrumMachineSampleBuffer('etc', buffer, { sourceKey: 'samples_crash', fileName: 'full-tail-fixture.wav' });
                for (const pattern of [drumMachineKickPattern, drumMachineSnarePattern, drumMachineHatPattern, drumMachinePercPattern]) pattern.fill(false);
                for (const track of Object.values(drumMachineExtraTracks)) { track.pattern.fill(false); track.accents.fill(false); track.ratchets.fill(0); }
                drumMachineExtraTracks.etc.pattern[0] = true;
                openDrumMachineOverlay();
            });
            await page.locator('[data-drum-jump="etc"]').tap();
            for (const suffix of ['Decay', 'Length']) await page.locator('#drumMachineEtc' + suffix).fill('100');
            const live = await page.evaluate(async () => {
                const when = audioContext.currentTime + .08;
                scheduleExtraDrumMachineRepeats('etc', 0, when, .125);
                const first = [...drumMachineActiveVoices][0];
                scheduleExtraDrumMachineRepeats('etc', 0, when + .35, .125);
                const analyser = audioContext.createAnalyser(); analyser.fftSize = 2048; first.gain.connect(analyser);
                await new Promise(resolve => setTimeout(resolve, 1280));
                const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values);
                const result = { gain: first.gain.gain.value, power: values.reduce((sum, x) => sum + x * x, 0) / values.length, overlap: drumMachineActiveVoices.size, duration: first.source.buffer.duration };
                first.gain.disconnect(analyser); analyser.disconnect();
                stopAllPerformancePlayback({ silent: true });
                result.stopped = drumMachineActiveVoices.size === 0;
                return result;
            });
            console.log(engine, 'live ETC', JSON.stringify(live));
            if (!repro) { assert(live.gain > .95, '100% decay must not fade the entire sample'); assert(live.power > .004, 'stereo sample downmixed by the analyser must retain its tail'); assert.equal(live.overlap, 2, 'retriggering must not choke the previous sample'); assert(live.stopped); }

            // Render the exact production hit function with real Web Audio PCM.
            const pcm = await page.evaluate(async () => {
                const cases = [];
                for (const [rate, length, decay] of [[1, 1, 1], [.5, 1, 1], [2, 1, 1], [1, .5, 1], [1, 1, .5], [1, 1, .05]]) {
                    const duration = 1.6 / rate * length;
                    const offline = new OfflineAudioContext(1, Math.ceil((1.6 / rate + .2) * 12000), 12000);
                    const input = offline.createBuffer(1, 19200, 12000), data = input.getChannelData(0);
                    for (let i = 0; i < data.length; i++) data[i] = .2 * Math.sin(2 * Math.PI * 301 * i / 12000);
                    const names = ['audioContext', 'ensureDrumMachineBus', 'ensureDrumMachineKickBypassBus', 'getFadeSecondsForDuration', 'drumMachineActiveVoices', 'scheduleTransportSourceStop', 'registerDrumMachineReverbTail'];
                    const play = new Function(...names, `return (${playDrumMachineHit.toString()});`)(offline, () => offline.destination, () => offline.destination, getFadeSecondsForDuration, new Set(), (source, end) => source.stop(end), () => {});
                    play(input, 0, rate, { level: .5, lengthRatio: length, decayRatio: decay });
                    const rendered = await offline.startRendering(), values = rendered.getChannelData(0);
                    const rms = (start, end) => { const clip = values.slice(Math.round(start * 12000), Math.round(end * 12000)); return Math.sqrt(clip.reduce((sum, x) => sum + x * x, 0) / clip.length); };
                    cases.push({ rate, length, decay, early: rms(duration * .2, duration * .3), late: rms(duration * .7, duration * .8), after: rms(duration + .03, duration + .09) });
                }
                return cases;
            });
            if (!repro) for (const item of pcm) {
                if (item.decay === 1) assert(item.late / item.early > .97 && item.late / item.early < 1.03, JSON.stringify(item));
                else assert(item.late < .001, JSON.stringify(item));
                assert(item.after < .00001, JSON.stringify(item));
            }
            let song;
            if (!repro) {
                song = await page.evaluate(async () => {
                    saveState({ force: true });
                    const archive = await mygrainSongBetaAdapter.capture();
                    const decoded = await mygrainSongBetaAdapter.decode(await archive.arrayBuffer(), { buffers: new Map(), bytes: 0, limitBytes: 128 * 1024 * 1024 });
                    const rendered = await MygrainSongClock.render(audioContext, decoded, { bpm: 120, patternSteps: 16 });
                    const values = rendered.getChannelData(0), rate = rendered.sampleRate;
                    const power = (start, end) => { const clip = values.slice(start * rate, end * rate); return clip.reduce((sum, x) => sum + x * x, 0) / clip.length; };
                    return { early: power(.3, .5), late: power(1.15, 1.35), decay: decoded.snapshot.state.modes.drumMachineExtraTracks.etc.decay, length: decoded.snapshot.state.modes.drumMachineExtraTracks.etc.length, sampleDuration: decoded.buffers.get('drumEtc').duration };
                });
                assert.equal(song.decay, 1); assert.equal(song.length, 1); assert(Math.abs(song.sampleDuration - 1.6) < .001); assert(song.late > song.early * .8 && song.late > 1e-6, JSON.stringify(song));
                const freeze = await page.evaluate(async () => {
                    document.getElementById('songBetaName').value = 'Full-decay drum regression';
                    await mygrainSongBeta.newSong();
                    document.getElementById('songBetaPartName').value = 'Natural ETC tail';
                    await mygrainSongBeta.newPart(); await mygrainSongBeta.arm();
                    const part = mygrainSongBeta.song.parts[0];
                    return { armed: mygrainSongBeta.armed, version: part.render?.drumSampleVersion, lanes: part.render?.drumLanesVersion };
                });
                assert.deepEqual(freeze, { armed: true, version: 1, lanes: 1 });
                song.freeze = freeze;
                await page.evaluate(async () => { await mygrainSongBetaAdapter.whenPersisted(); saveState({ force: true }); });
                await page.reload();
                await page.waitForFunction(() => window.mygrainSongBeta && document.documentElement.dataset.mygrainStartup === 'ready');
                await page.locator('#start-btn').tap();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                const restored = await page.evaluate(() => ({ sample: drumMachineExtraTracks.etc.buffer?.duration, decay: drumMachineExtraTracks.etc.decay, length: drumMachineExtraTracks.etc.length }));
                assert(Math.abs(restored.sample - 1.6) < .001); assert.equal(restored.decay, 1); assert.equal(restored.length, 1);
                song.restored = restored;
                await page.evaluate(() => openDrumMachineOverlay()); await page.locator('[data-drum-jump="etc"]').tap();
            }
            assert.deepEqual(errors, []);
            await page.screenshot({ path: `${evidence}/${repro ? 'before' : 'after'}-${engine}.png` });
            results.push({ engine, live, pcm, song });
            console.log('PASS', engine, repro ? 'baseline recorded' : 'full sample tails, shortened decay/length, pitch, overlap and Song PCM');
            await context.close();
        } finally { await browser.close(); }
    }
    fs.writeFileSync(`${evidence}/${repro ? 'before' : 'after'}-results.json`, JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
