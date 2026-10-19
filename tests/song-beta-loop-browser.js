const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost song test server.');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
        const errors = [];
        const writes = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => {
            if (request.method() === 'POST' && request.url().startsWith(base + 'api/songs')) writes.push(new URL(request.url()).pathname);
        });
        await page.route('https://openclaw.blackcarburning.com/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        await page.evaluate(() => {
            syncPatternLengthControls(8, { skipSave: true });
            setGeneratedLoopTransportEnabled(false, { silent: true, skipSave: true });
            setOscillatorsEnabled(false, { silent: true, skipSave: true });
            setGranularLayersEnabled(false, { silent: true, skipSave: true });
            setArpeggiatorEnabled(false);
            seqGrainsEnabled = false;
            document.getElementById('seqGrainsEnabled').checked = false;
            applyGlobalBpm(300);
            window.loopTestTone = frequency => {
                const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                const samples = buffer.getChannelData(0);
                for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(2 * Math.PI * frequency * index / audioContext.sampleRate) * .2;
                return buffer;
            };
            bastardLoopLSampleBuffer = loopTestTone(220);
            bastardLoopXSampleBuffer = loopTestTone(110);
            bastardLoopBuffer = loopTestTone(330);
            bastardLoopSourceBpm = 300;
            bastardLoopLSequence = Array.from({ length: 64 }, () => ({ note: 'C3', rest: false, accent: false, slide: false, ratchet: 1 }));
            bastardLoopXSequence = Array.from({ length: 64 }, () => ({ note: 'C2', rest: false, accent: false, slide: false, ratchet: 1 }));
            bastardLoopLRootNote = 'C3';
            bastardLoopXRootNote = 'C2';
            bastardLoopLSourceMode = 'sample';
            setBastardLoopLLevelPercent(60, { skipSave: true });
            setBastardLoopXLevelPercent(60, { skipSave: true });
            window.editorMonitor = audioContext.createAnalyser();
            const editorChannels = audioContext.createChannelSplitter(2);
            finalAmplifierNode.connect(editorChannels);
            editorChannels.connect(editorMonitor, 0);
        });
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
            for (const layer of ['L', 'X']) {
                await page.evaluate(layer => (layer === 'L' ? openBastardLoopLOverlay : openBastardLoopXOverlay)(), layer);
                const geometry = await page.evaluate(layer => {
                    const play = document.getElementById(`bastardLoop${layer}SoloPlayBtn`);
                    const stop = document.getElementById(`bastardLoop${layer}SoloStopBtn`);
                    const row = play.parentElement;
                    const grid = document.getElementById(`bastardLoop${layer}StepGrid`);
                    return { play: getComputedStyle(play).color, stop: getComputedStyle(stop).color, font: getComputedStyle(play).fontSize, stopLabel: getComputedStyle(row.lastElementChild).color, precedesGrid: row.nextElementSibling === grid, width: row.getBoundingClientRect().width, scrollWidth: row.scrollWidth };
                }, layer);
                assert.equal(geometry.play, 'rgb(54, 239, 105)');
                assert.equal(geometry.stop, 'rgb(255, 54, 54)');
                assert.equal(geometry.font, '22px');
                assert.equal(geometry.stopLabel, 'rgb(220, 236, 255)');
                assert.equal(geometry.precedesGrid, true);
                assert.ok(geometry.scrollWidth <= geometry.width + 1);
                const play = page.locator(`#bastardLoop${layer}SoloPlayBtn`);
                if (width === 390) await play.tap(); else await play.click();
                await page.waitForFunction(layer => !bastardLoopPlaying && (layer === 'L' ? isBastardLoopLRunning() && !isBastardLoopXRunning() : isBastardLoopXRunning() && !isBastardLoopLRunning()), layer);
                assert.equal(await page.locator('#performanceMainStopAllBtn').isDisabled(), false);
                await page.waitForFunction(() => {
                    const samples = new Float32Array(editorMonitor.fftSize);
                    editorMonitor.getFloatTimeDomainData(samples);
                    return samples.some(value => Math.abs(value) > .0001);
                }, undefined, { timeout: 3000 }).catch(async error => {
                    console.error('Solo audio diagnostics', await page.evaluate(layer => ({ layer, context: audioContext.state, time: audioContext.currentTime, step: bastardLoopLCurrentStepIndex, voicesL: bastardLoopLActiveVoices.size, voicesX: bastardLoopXActiveVoices.size, levelL: getBastardLoopLLevelValue(), levelX: getBastardLoopXLevelValue(), master: masterGain.gain.value, pre: preFilterGainNode.gain.value, final: finalAmplifierNode.gain.value, status: document.getElementById(`bastardLoop${layer}Status`).textContent }), layer));
                    throw error;
                });
                assert.equal(await page.evaluate(() => Boolean(bastardLoopSource || bastardLoop2Source || bastardLoop3Source || bastardLoopVSource || bastardLoopPSource || bastardLoopOSource || bastardLoopMSource)), false);
                await page.locator(`#bastardLoop${layer}SoloStopBtn`).click();
                await page.waitForFunction(() => !isBastardLoopLRunning() && !isBastardLoopXRunning());
                assert.equal(await play.getAttribute('aria-pressed'), 'false');
                await page.evaluate(async () => { await startAllBastardLoopsFromUi({ silent: true }); });
                await page.waitForFunction(() => bastardLoopPlaying);
                await page.locator(`#bastardLoop${layer}StopBastardloopsBtn`).click();
                await page.waitForFunction(() => !bastardLoopPlaying && !isBastardLoopLRunning() && !isBastardLoopXRunning() && !bastardLoopSource);
                await page.locator(`#bastardLoop${layer}CloseBtn`).click();
            }
        }
        console.log('PASS: L/X solo audio, sequence Stop, Stop Bastardloops, desktop and mobile touch controls.');
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.evaluate(() => {
            openBastardLoopLOverlay();
            setBastardLoopLSourceMode('synth', { skipSave: true, silent: true });
        });
        await page.click('#bastardLoopLSoloPlayBtn');
        await page.waitForFunction(() => isBastardLoopLRunning() && !bastardLoopPlaying && !isBastardLoopXRunning());
        await page.click('#bastardLoopLCloseBtn');
        await page.click('#performanceMainStopAllBtn');
        await page.waitForFunction(() => !isBastardLoopLRunning() && !isBastardLoopXRunning());
        console.log('PASS: L synth starts without the shared transport; global Stop recognizes solo playback.');

        await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            setBastardLoopLSourceMode('sample', { skipSave: true, silent: true });
            setBastardLoopLEnabled(false, { skipSave: true, silent: true });
            setBastardLoopXEnabled(false, { skipSave: true, silent: true });
            bastardLoopEnabled = true;
            const song = (await controller.request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Writing loops fixture' }) })).song;
            controller.acceptSong(song);
            for (const [name, frequency] of [['Intro', 220], ['Verse', 330]]) {
                bastardLoopBuffer = loopTestTone(frequency);
                saveState();
                const body = await mygrainSongBetaAdapter.capture();
                controller.acceptSong((await controller.request(`/${song.id}/parts?name=${name}&repeats=1`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body })).song);
            }
            controller.render();
        });
        await page.click('#songBetaArm');
        await page.waitForFunction(() => mygrainSongBeta.armed && !mygrainSongBeta.busy);
        await page.evaluate(async () => { await mygrainSongBeta.reusePart(mygrainSongBeta.song.parts[0]); mygrainSongBeta.render(); });
        const saved = await page.evaluate(() => JSON.stringify(mygrainSongBeta.song.parts));
        const writeCount = writes.length;
        await page.evaluate(() => {
            window.songLoopStarts = [];
            window.songLoopAudio = audioContext.createGain();
            songLoopAudio.connect(audioContext.destination);
            window.songLoopMonitor = audioContext.createAnalyser();
            const songChannels = audioContext.createChannelSplitter(2);
            songLoopAudio.connect(songChannels);
            songChannels.connect(songLoopMonitor, 0);
            const create = audioContext.createBufferSource.bind(audioContext);
            audioContext.createBufferSource = () => {
                const source = create();
                const record = {};
                const start = source.start.bind(source);
                const stop = source.stop.bind(source);
                source.start = time => { record.start = time; record.duration = source.buffer.duration; songLoopStarts.push(record); start(time); };
                source.stop = time => { if (Number.isFinite(time)) record.end = time; else record.stopped = true; stop(time); };
                return source;
            };
            const schedule = mygrainSongBetaAdapter.scheduleStoredSong.bind(mygrainSongBetaAdapter);
            mygrainSongBetaAdapter.scheduleStoredSong = async (parts, load, ended, signal, destination, options) => {
                window.songLoopOptions = options;
                const playback = await schedule(parts, load, ended, signal, songLoopAudio, options);
                window.songLoopFirstEntries = playback.entries.map(entry => entry.id);
                return playback;
            };
        });
        await page.click('#songBetaLoop');
        assert.equal(await page.locator('#songBetaLoop').getAttribute('aria-pressed'), 'true');
        await page.click('#songBetaPlay');
        await page.waitForFunction(() => mygrainSongBeta.playing && songLoopStarts.length >= 8 && !mygrainSongBeta.busy);
        await page.waitForFunction(() => {
            const samples = new Float32Array(songLoopMonitor.fftSize);
            songLoopMonitor.getFloatTimeDomainData(samples);
            return samples.some(value => Math.abs(value) > .001);
        });
        const loop = await page.evaluate(() => ({ starts: songLoopStarts, entries: mygrainSongBeta.playback.entries.length, options: songLoopOptions, status: document.getElementById('songBetaStatus').textContent }));
        for (let index = 1; index < loop.starts.length; index += 1) assert.equal(loop.starts[index - 1].end, loop.starts[index].start);
        assert.ok(loop.entries <= 2);
        assert.equal(loop.options.loop, true);
        assert.match(loop.status, /Looping song/);
        await page.click('#songBetaStop');
        assert.equal(await page.evaluate(() => mygrainSongBeta.playing), false);
        const stoppedCount = await page.evaluate(() => songLoopStarts.length);
        await page.waitForTimeout(650);
        assert.equal(await page.evaluate(() => songLoopStarts.length), stoppedCount);
        console.log('PASS: Whole-song wraparound is boundary-contiguous, bounded and cancellable.');

        await page.locator('.song-beta-toggle').nth(1).click();
        await page.evaluate(() => { songLoopStarts.length = 0; });
        await page.locator('.song-beta-part').nth(1).locator('.song-beta-loop-part').click();
        await page.waitForFunction(() => !mygrainSongBeta.busy && songLoopStarts.length >= 5);
        assert.equal(await page.evaluate(() => mygrainSongBeta.loopPartId), await page.evaluate(() => mygrainSongBeta.song.parts[1].id));
        assert.equal(await page.locator('.song-beta-part').nth(1).locator('.song-beta-loop-part').textContent(), 'Stop Part Loop');
        assert.equal(await page.evaluate(() => new Set(mygrainSongBeta.playback.entries.map(entry => entry.id)).size), 1);
        await page.locator('.song-beta-part').nth(1).locator('.song-beta-loop-part').click();
        await page.waitForFunction(() => !mygrainSongBeta.playing && !mygrainSongBeta.busy);
        console.log('PASS: Loop Part overrides Loop Song and its own button stops the loop.');

        await page.evaluate(() => { songLoopStarts.length = 0; });
        await page.locator('.song-beta-part').nth(1).locator('.song-beta-play-from').click();
        await page.waitForFunction(() => !mygrainSongBeta.busy && songLoopStarts.length >= 6);
        assert.equal(await page.evaluate(() => songLoopOptions.startIndex), 1);
        assert.deepEqual(await page.evaluate(() => songLoopFirstEntries), await page.evaluate(() => mygrainSongBeta.song.parts.slice(1).map(part => part.id)));
        await page.evaluate(() => openBastardLoopXOverlay());
        await page.click('#bastardLoopXSoloPlayBtn');
        await page.waitForFunction(() => !mygrainSongBeta.playing && isBastardLoopXRunning() && !bastardLoopPlaying);
        assert.ok(await page.evaluate(() => finalAmplifierNode.gain.value > 0));
        await page.click('#bastardLoopXSoloStopBtn');
        await page.click('#bastardLoopXCloseBtn');
        console.log('PASS: Play From Here wraps to the beginning; editor Solo Play cancels cached song playback and restores live audio.');

        await page.evaluate(() => {
            mygrainSongBeta.renderLimitBytes = 1;
            mygrainSongBeta.renders.clear();
            mygrainSongBeta.renderBytes = 0;
            songLoopStarts.length = 0;
            window.loopDecodes = 0;
            const decode = mygrainSongBetaAdapter.decodeRender;
            mygrainSongBetaAdapter.decodeRender = (...args) => { loopDecodes += 1; return decode(...args); };
        });
        await page.click('#songBetaPlay');
        await page.waitForFunction(() => !mygrainSongBeta.busy && songLoopStarts.length >= 7);
        assert.ok(await page.evaluate(() => loopDecodes > 0));
        await page.click('#songBetaStop');
        await page.evaluate(() => { songLoopStarts.length = 0; loopDecodes = 0; mygrainSongBeta.renders.clear(); mygrainSongBeta.renderBytes = 0; });
        await page.locator('.song-beta-part').nth(1).locator('.song-beta-loop-part').click();
        await page.waitForFunction(() => !mygrainSongBeta.busy && songLoopStarts.length >= 6);
        assert.equal(await page.evaluate(() => loopDecodes), 1);
        await page.click('#songBetaStop');
        assert.equal(await page.evaluate(() => JSON.stringify(mygrainSongBeta.song.parts)), saved);
        assert.equal(writes.length, writeCount);
        console.log('PASS: Storage-backed song/part loops work; one-part looping decodes once and does not write songs or renders.');

        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: '/tmp/mygrain-song-loop-mobile.png', fullPage: true });
        await page.evaluate(() => openBastardLoopXOverlay());
        await page.screenshot({ path: '/tmp/mygrain-sequencer-loop-mobile.png' });
        assert.deepEqual(errors, []);
        console.log('PASS: No page errors; mobile layout has no horizontal overflow.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
