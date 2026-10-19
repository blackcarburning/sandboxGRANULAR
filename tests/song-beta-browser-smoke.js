const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) {
    throw new Error('Set SONG_BETA_TEST_URL to an isolated localhost test server /mygrain/ route.');
}

(async () => {
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
    });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const page = await context.newPage();
        const expandPart = async index => {
            const toggle = page.locator('.song-beta-toggle').nth(index);
            if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
        };
        const clickPartControl = async (selector, index = 0) => {
            await expandPart(index);
            await page.locator('.song-beta-part-controls').nth(index).locator(selector).click();
        };
        const setPartColour = async (index, value) => {
            await expandPart(index);
            await page.locator('.song-beta-part-colour input').nth(index).evaluate((input, colour) => {
                input.value = colour;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }, value);
            await page.waitForFunction(() => !mygrainSongBeta.busy);
            assert.equal(await page.locator('.song-beta-part-colour input').nth(index).inputValue(), value);
            assert.equal(await page.evaluate(index => mygrainSongBeta.song.parts[index].colour, index), value);
        };
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !window.mygrainSongBeta.busy);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        await page.evaluate(() => {
            syncPatternLengthControls(8, { skipSave: true });
            applyGlobalBpm(300);
            const buffer = audioContext.createBuffer(1, 4410, 44100);
            const channel = buffer.getChannelData(0);
            for (let index = 0; index < channel.length; index += 1) channel[index] = Math.sin(index * 0.1) * 0.2;
            generatedLoopBuffer = buffer;
            generatedLoopBaseBuffer = buffer;
            micAudioBuffer = buffer;
            grainMainSampleBuffer = buffer;
            grainASampleBuffer = buffer;
            grainBSampleBuffer = buffer;
            grainSynthAMicBuffer = buffer;
            grainSynthBMicBuffer = buffer;
            bastardLoopBuffer = audioContext.createBuffer(1, 44100 * 3, 44100);
            bastardLoopBuffer.getChannelData(0).fill(.1);
            bastardLoopEnabled = true;
            bastardLoopSourceBpm = 300;
            bastardLoopMetadata = { summary: 'Overlength render fixture', durationSeconds: 3, bpm: 300 };
            bastardLoop2Buffer = buffer;
            bastardLoop3Buffer = buffer;
            bastardLoopVBuffer = buffer;
            bastardLoopPBuffer = buffer;
            bastardLoopOBuffer = buffer;
            bastardLoopLSampleBuffer = buffer;
            bastardLoopXSampleBuffer = buffer;
            bastardLoopMRawBuffer = buffer;
            bastardLoopMBuffer = buffer;
            dropboxSampleLayerRawBuffer = buffer;
            dropboxSampleLayerBuffer = buffer;
            drumMachineKickBuffer = buffer;
            drumMachineSnareBuffer = buffer;
            drumMachineHatBuffer = buffer;
            drumMachinePercBuffer = buffer;
            bastardLoopLSampleMetadata = { sourceKey: 'samples_leads', fileName: 'fixture-C4.wav', rootNote: 'C4' };
            bastardLoopXSampleMetadata = { sourceKey: 'samples_bass', fileName: 'fixture-C2.wav', rootNote: 'C2' };
            bastardLoopMMetadata = { sourceLabel: 'MIC', summary: 'Fixture mic', durationSeconds: .1, bpm: 300 };
            bastardLoopLSequence[0] = normalizeBastardLoopLStep({ note: 'C4', accent: true, ratchet: 2 });
            bastardLoopXSequence[0] = normalizeBastardLoopXStep({ note: 'C2', slide: true });
            bastardLoopLEnabled = true;
            bastardLoopXEnabled = true;
            bastardLoopMEnabled = true;
            setBastardLoopLLevelPercent(42, { skipSave: true });
            setBastardLoopXLevelPercent(31, { skipSave: true });
            grainAMuted = true;
            seqGrainsEnabled = false;
            document.getElementById('seqGrainsEnabled').checked = false;
            sequencerSteps = Array.from({ length: 8 }, (_, index) => ({ enabled: index !== 3, pitch: 'C4', volume: 63 }));
            sequencerSteps.forEach((step, index) => updateSequencerStepUI(index + 1));
            drumMachineKickPattern = [true, false, false, false, true, false, false, false];
            saveState();
            window.__firstSongState = JSON.parse(JSON.stringify(readStoredStateSnapshot()));
        });
        await page.fill('#songBetaName', 'Song beta automated smoke');
        await page.click('#songBetaNewSong');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song);
        await page.fill('#songBetaPartName', 'Intro');
        await page.click('#songBetaNewPart');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts.length === 1);
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts[0].audioAssets), 24);
        console.log('PASS: New Song creates server folder; New Part captures all 24 audio bindings.');

        await page.evaluate(() => {
            applyGlobalBpm(240);
            bastardLoopXSampleBuffer = null;
            bastardLoopXEnabled = false;
            bastardLoopLSequence[0] = normalizeBastardLoopLStep({ note: 'D4' });
            grainAMuted = false;
            seqGrainsEnabled = true;
            document.getElementById('seqGrainsEnabled').checked = true;
            sequencerSteps[3].enabled = true;
            sequencerSteps[0].pitch = 'D4';
            sequencerSteps.forEach((step, index) => updateSequencerStepUI(index + 1));
            saveState();
        });
        await page.fill('#songBetaPartName', 'Verse');
        await page.click('#songBetaNewPart');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts.length === 2);
        assert.equal(await page.locator('.song-beta-part-controls:visible').count(), 0);
        assert.equal(await page.locator('.song-beta-part-header .song-beta-part-repeats input:visible').count(), 2);
        assert.deepEqual(await page.locator('.song-beta-part-header').evaluateAll(headers => headers.map(header => [...header.querySelectorAll('button')].map(button => button.querySelector('.song-beta-part-name')?.textContent || button.textContent))), [['1. Intro', '↑', '↓'], ['2. Verse', '↑', '↓']]);
        const activeBeforeExpand = await page.evaluate(() => mygrainSongBeta.active);
        await page.locator('.song-beta-toggle').first().press('Enter');
        assert.equal(await page.locator('.song-beta-part-controls:visible').count(), 1);
        assert.equal(await page.locator('.song-beta-toggle').first().getAttribute('aria-expanded'), 'true');
        assert.equal(await page.evaluate(() => mygrainSongBeta.active), activeBeforeExpand);
        await setPartColour(0, '#e89c45');
        assert.equal(await page.locator('.song-beta-part').first().evaluate(row => getComputedStyle(row).borderLeftColor), 'rgb(232, 156, 69)');
        await page.getByRole('button', { name: 'Move Intro down', exact: true }).click();
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts[1].name === 'Intro');
        assert.equal(await page.locator('.song-beta-toggle').nth(1).getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('.song-beta-toggle').first().getAttribute('aria-expanded'), 'false');
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts[1].colour), '#e89c45');
        assert.equal(await page.locator('.song-beta-part').nth(1).evaluate(row => getComputedStyle(row).borderLeftColor), 'rgb(232, 156, 69)');
        await page.getByRole('button', { name: 'Move Intro up', exact: true }).click();
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts[0].name === 'Intro');
        await page.locator('.song-beta-toggle').first().press('Space');
        assert.equal(await page.locator('.song-beta-part-controls:visible').count(), 0);
        console.log('PASS: Parts start compact; keyboard disclosure does not start audio; move arrows work and expanded state follows the part.');
        const beforeArm = await page.evaluate(() => JSON.stringify(gatherPreset()));
        await page.evaluate(() => {
            const render = mygrainSongBetaAdapter.renderPart;
            window.__songRenderMetrics = { active: 0, peak: 0, started: performance.now() };
            mygrainSongBetaAdapter.renderPart = async (...args) => {
                const metrics = window.__songRenderMetrics;
                metrics.peak = Math.max(metrics.peak, ++metrics.active);
                try { return await render(...args); }
                finally { metrics.active -= 1; }
            };
            const decode = audioContext.decodeAudioData.bind(audioContext);
            window.__songDecodeCounts = new Map();
            audioContext.decodeAudioData = async bytes => {
                const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
                __songDecodeCounts.set(digest, (__songDecodeCounts.get(digest) || 0) + 1);
                return decode(bytes);
            };
        });
        await page.click('#songBetaArm');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.armed);
        assert.deepEqual(await page.evaluate(() => ({ peak: __songRenderMetrics.peak, active: __songRenderMetrics.active, bridges: __mygrainSongRenderBridges.size, reserved: mygrainSongBeta.memoryBudget.bytes, sourceBytes: mygrainSongBeta.audioCache.bytes, sources: mygrainSongBeta.cache.size })), { peak: 2, active: 0, bridges: 0, reserved: 0, sourceBytes: 0, sources: 0 });
        const afterArm = await page.evaluate(() => JSON.stringify(gatherPreset()));
        assert.deepEqual(JSON.parse(afterArm).sliders, JSON.parse(beforeArm).sliders);
        assert.equal(await page.evaluate(() => mygrainSongBeta.audioCache.buffers.size), 0);
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts.every(part => !Object.hasOwn(mygrainSongBeta.snapshots.get(part.id).snapshot.state.selects || {}, 'songBetaArmConcurrency'))), true);
        const renders = await page.evaluate(() => mygrainSongBeta.song.parts.map(part => {
            const buffer = mygrainSongBeta.renders.get(part.id);
            const samples = buffer.getChannelData(0);
            let peak = 0;
            for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
            return { duration: buffer.duration, peak, cached: Boolean(part.render), frames: buffer.length };
        }));
        assert.equal(renders[0].duration, .4);
        assert.equal(renders[1].duration, .5);
        assert.ok(renders.every(render => render.cached && render.peak > .001), `Song renders are empty: ${JSON.stringify(renders)}`);
        console.log('PASS: Arm prepares both renders, releases original sources, and leaves live sliders unchanged.');
        const reuse = await page.evaluate(async () => {
            const snapshot = mygrainSongBeta.snapshots.get(mygrainSongBeta.song.parts[0].id);
            const buffer = mygrainSongBeta.renders.get(mygrainSongBeta.song.parts[0].id);
            const fetch = mygrainSongBeta.fetch;
            mygrainSongBeta.fetch = () => { throw new Error('Unchanged re-arm should not request the server'); };
            const started = performance.now();
            try { await mygrainSongBeta.run(() => mygrainSongBeta.arm()); }
            finally { mygrainSongBeta.fetch = fetch; }
            return { armed: mygrainSongBeta.armed, same: snapshot === mygrainSongBeta.snapshots.get(mygrainSongBeta.song.parts[0].id) && buffer === mygrainSongBeta.renders.get(mygrainSongBeta.song.parts[0].id), milliseconds: performance.now() - started };
        });
        assert.equal(reuse.armed && reuse.same, true);
        console.log(`PASS: Two renderers overlap with bounded source memory; warm re-arm takes ${reuse.milliseconds.toFixed(1)}ms without network/decoding.`);
        await page.selectOption('#songBetaArmConcurrency', '1');
        await setPartColour(1, '#65c9e8');
        assert.equal(await page.evaluate(() => mygrainSongBeta.armed && mygrainSongBeta.renders.size === 2), true);
        assert.ok(await page.evaluate(() => mygrainSongBeta.song.parts.every(part => Boolean(part.render))));
        await clickPartControl('.song-beta-clear-colour', 1);
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts[1].colour), null);
        assert.equal(await page.evaluate(() => mygrainSongBeta.armed), true);
        console.log('PASS: Colour follows the part when moved; retrospective recolouring/clearing leaves armed audio intact.');

        await clickPartControl('.song-beta-recall');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.active === mygrainSongBeta.song.parts[0].id);
        const restored = await page.evaluate(() => ({
            bpm: sequencerBPM,
            sequence: sequencerSteps,
            lead: bastardLoopLSequence[0],
            bass: bastardLoopXSequence[0],
            mute: grainAMuted,
            grains: seqGrainsEnabled,
            leadLevel: bastardLoopLLevel,
            bassLevel: bastardLoopXLevel,
            mic: Boolean(bastardLoopMRawBuffer && bastardLoopMBuffer),
            bassAudio: Boolean(bastardLoopXSampleBuffer),
            sample: Boolean(generatedLoopBuffer && grainASampleBuffer && grainSynthBMicBuffer && dropboxSampleLayerRawBuffer),
            playing: sequencerPlaying || bastardLoopPlaying,
            kick: drumMachineKickPattern
        }));
        assert.equal(restored.bpm, 300);
        assert.equal(restored.sequence[3].enabled, false);
        assert.equal(restored.sequence[0].pitch, 'C4');
        assert.equal(restored.lead.note, 'C4');
        assert.equal(restored.lead.ratchet, 2);
        assert.equal(restored.bass.note, 'C2');
        assert.equal(restored.mute, true);
        assert.equal(restored.grains, false);
        assert.equal(restored.leadLevel, .42);
        assert.equal(restored.bassLevel, .31);
        assert.equal(restored.mic, true);
        assert.equal(restored.bassAudio, true);
        assert.equal(restored.sample, true);
        assert.equal(restored.playing, true);
        assert.deepEqual(restored.kick, [true, false, false, false, true, false, false, false]);
        console.log('PASS: Recall restores tempo, sequence/rests, L/X notes, mutes, levels, mic and sample sounds; starts automatically.');

        await page.evaluate(() => bastardLoopXSampleBuffer.getChannelData(0).fill(0));
        await clickPartControl('.song-beta-recall');
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        assert.ok(await page.evaluate(() => Math.abs(bastardLoopXSampleBuffer.getChannelData(0)[10]) > .01));
        await clickPartControl('.song-beta-recall', 1);
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.active === mygrainSongBeta.song.parts[1].id);
        assert.equal(await page.evaluate(() => bastardLoopXSampleBuffer), null);
        assert.equal(await page.evaluate(() => sequencerSteps[0].pitch), 'D4');
        console.log('PASS: Cached sounds stay immutable after live edits; absent audio is cleared on the next recall.');

        await page.click('#songBetaStop');
        const patternRestore = await page.evaluate(async () => {
            const decoded = await mygrainSongBeta.loadPart(mygrainSongBeta.song.parts[0]);
            const prepared = mygrainSongBetaAdapter.prepare(decoded);
            prepared.snapshot.state.patternLength = 32;
            prepared.snapshot.extra.sequencerSteps = Array.from({ length: 32 }, (_, index) => ({
                enabled: index % 2 === 0, pitch: index === 31 ? 'E4' : 'C4', volume: 65
            }));
            prepared.snapshot.state.sliders.seqStep32Pitch = String(noteNames.indexOf('E4'));
            prepared.snapshot.state.sliders.seqStep32Vol = '65';
            const patternControl = prepared.snapshot.extra.controls.find(control => control.id === 'globalPatternLength');
            if (patternControl) patternControl.value = '32';
            for (const length of [8, 64, 16, 8]) {
                syncPatternLengthControls(length, { skipSave: true });
                mygrainSongBetaAdapter.recall(decoded, { prepared, start: false });
                if (sequencerSteps.length !== 32 || sequencerSteps[31].pitch !== 'E4') return false;
            }
            syncPatternLengthControls(8, { skipSave: true });
            saveState({ force: true });
            const previousSaveSuspended = stateSaveSuspended;
            stateSaveSuspended = true;
            try {
                if (!restoreState({ throwOnError: true }) || sequencerSteps.length !== 8) return false;
            } finally {
                stateSaveSuspended = previousSaveSuspended;
            }
            return true;
        });
        assert.equal(patternRestore, true);
        assert.deepEqual(errors, []);
        await clickPartControl('.song-beta-recall', 1);
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        console.log('PASS: Repeated longer/shorter live-pattern restores retain all saved steps without sequencer-control errors.');

        await page.click('#songBetaStop');
        await page.evaluate(() => {
            window.__songLiveRecalls = 0;
            const recall = mygrainSongBetaAdapter.recall.bind(mygrainSongBetaAdapter);
            const schedule = mygrainSongBetaAdapter.scheduleSong.bind(mygrainSongBetaAdapter);
            window.__songOriginalSchedule = schedule;
            mygrainSongBetaAdapter.recall = (...args) => { window.__songLiveRecalls += 1; return recall(...args); };
            mygrainSongBetaAdapter.scheduleSong = (parts, buffers, onEnded) => {
                const tap = audioContext.createGain();
                tap.connect(audioContext.destination);
                const plan = schedule(parts, buffers, onEnded, tap);
                window.__songPlan = plan;
                const frames = Math.round((plan.endTime - plan.startTime) * audioContext.sampleRate);
                const capture = new AudioWorkletNode(audioContext, 'mygrain-song-capture-v1', {
                    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
                    processorOptions: { startFrame: Math.round(plan.startTime * audioContext.sampleRate), frames }
                });
                tap.connect(capture);
                capture.connect(audioContext.destination);
                window.__songCaptured = new Promise(resolve => {
                    capture.port.onmessage = event => {
                        resolve(event.data.channels.map(channel => new Float32Array(channel)));
                        capture.port.close();
                        capture.disconnect();
                        tap.disconnect();
                    };
                });
                return plan;
            };
        });
        await page.click('#songBetaPlay');
        await page.waitForFunction(() => mygrainSongBeta.playing);
        assert.ok(await page.locator('.song-beta-part-repeats input').evaluateAll(inputs => inputs.every(input => input.disabled)));
        await page.evaluate(async () => {
            while (audioContext.currentTime < window.__songPlan.startTime + .05) await new Promise(resolve => setTimeout(resolve, 5));
            const until = performance.now() + 650;
            while (performance.now() < until) {}
        });
        await page.waitForFunction(() => !mygrainSongBeta.playing && document.getElementById('songBetaStatus').textContent.startsWith('Song finished'), { timeout: 15000 });
        assert.equal(await page.evaluate(() => sequencerPlaying || bastardLoopPlaying || drumMachinePlaying), false);
        const timing = await page.evaluate(async () => {
            const capture = (await window.__songCaptured)[0];
            const parts = mygrainSongBeta.song.parts;
            const first = mygrainSongBeta.renders.get(parts[0].id).getChannelData(0);
            const second = mygrainSongBeta.renders.get(parts[1].id).getChannelData(0);
            const boundary = first.length;
            let error = 0;
            for (let offset = -128; offset < 128; offset += 1) {
                const expected = offset < 0 ? first[boundary + offset] : second[offset];
                error = Math.max(error, Math.abs(capture[boundary + offset] - expected));
            }
            return { entries: window.__songPlan.entries, error, recalls: window.__songLiveRecalls, frames: capture.length };
        });
        assert.equal(timing.entries[0].end, timing.entries[1].start);
        assert.ok(timing.error < .00001, `Audio has a gap or overlap at the exact beat: ${JSON.stringify(timing)}`);
        assert.equal(timing.recalls, 0);
        console.log('PASS: Native scheduled audio is sample-contiguous at the pattern boundary, even during a 650ms main-thread stall; no live-engine recall.');

        await page.evaluate(() => { mygrainSongBetaAdapter.scheduleSong = window.__songOriginalSchedule; });

        await page.click('#songBetaPlay');
        await page.waitForFunction(() => mygrainSongBeta.playing);
        await page.click('#songBetaStop');
        await page.waitForTimeout(1000);
        assert.equal(await page.evaluate(() => mygrainSongBeta.playing || sequencerPlaying || bastardLoopPlaying), false);
        assert.equal(await page.evaluate(() => finalAmplifierNode.gain.value), 1);
        console.log('PASS: Stop cancels queued part transitions.');

        await page.click('#songBetaPlay');
        await page.waitForFunction(() => mygrainSongBeta.playing);
        await page.click('#performanceMainStopAllBtn');
        assert.equal(await page.evaluate(() => mygrainSongBeta.playing), false);
        assert.equal(await page.evaluate(() => finalAmplifierNode.gain.value), 1);
        console.log('PASS: Global Stop All cancels scheduled song audio and restores ordinary live output.');

        const cleanup = await page.evaluate(async () => {
            const originals = new Map(['syncPerformanceControlState', 'syncPerformanceSoundControls', 'syncDrumMachineUi', 'drawWaveforms', 'updateEffects'].map(name => [name, window[name]]));
            const previousSaveSuspended = stateSaveSuspended;
            const stop = window.stopAllPerformancePlayback;
            let interrupted = false;
            window.stopAllPerformancePlayback = (...args) => {
                if (!interrupted) {
                    interrupted = true;
                    throw new Error('Interrupted recall fixture');
                }
                return stop(...args);
            };
            let message;
            try {
                mygrainSongBetaAdapter.recall(await mygrainSongBeta.loadPart(mygrainSongBeta.song.parts[0]));
            } catch (error) {
                message = error.message;
            } finally {
                window.stopAllPerformancePlayback = stop;
            }
            return { message, restored: [...originals].every(([name, original]) => window[name] === original), saveRestored: stateSaveSuspended === previousSaveSuspended };
        });
        assert.deepEqual(cleanup, { message: 'Interrupted recall fixture', restored: true, saveRestored: true });
        console.log('PASS: Interrupted recall restores all temporarily batched helpers and persistence state.');

        const restoreFailure = await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            const part = controller.song.parts[0];
            const original = window.setFinalReverbEnabled;
            const previousState = localStorage.getItem(STATE_STORAGE_KEY);
            const previousSaveSuspended = stateSaveSuspended;
            const failure = new Error('Reverb configuration failed');
            window.setFinalReverbEnabled = () => { throw failure; };
            try {
                await controller.run(() => controller.recall(part));
                return {
                    status: document.getElementById('songBetaStatus').textContent,
                    previousStateRetained: localStorage.getItem(STATE_STORAGE_KEY) === previousState,
                    saveRestored: stateSaveSuspended === previousSaveSuspended,
                    playing: controller.adapter.running(),
                    busy: controller.busy
                };
            } finally {
                window.setFinalReverbEnabled = original;
            }
        });
        assert.match(restoreFailure.status, /could not be restored \(Reverb configuration failed\)/);
        assert.equal(restoreFailure.previousStateRetained, true);
        assert.equal(restoreFailure.saveRestored, true);
        assert.equal(restoreFailure.playing, false);
        assert.equal(restoreFailure.busy, false);
        await clickPartControl('.song-beta-recall');
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        assert.equal(await page.evaluate(() => mygrainSongBetaAdapter.running()), true);
        await page.click('#songBetaStop');
        console.log('PASS: Failed settings restoration shows the actual error, retains the previous browser patch, stops audio, and allows a successful retry.');

        const lateFailure = await page.evaluate(async () => {
            const decoded = await mygrainSongBeta.loadPart(mygrainSongBeta.song.parts[0]);
            const prepared = mygrainSongBetaAdapter.prepare(decoded);
            const toggle = document.querySelector('.lfo-toggle[data-lfo="1"]');
            prepared.snapshot.state.toggles.lfo[toggle.dataset.param] = !toggle.classList.contains('active');
            const previousState = localStorage.getItem(STATE_STORAGE_KEY);
            const original = window.syncFinalPanControlDisplays;
            window.syncFinalPanControlDisplays = () => { throw new Error('Late settings restore failure'); };
            let message;
            try {
                mygrainSongBetaAdapter.recall(decoded, { prepared, start: false });
            } catch (error) {
                message = error.message;
            } finally {
                window.syncFinalPanControlDisplays = original;
            }
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return { message, retained: localStorage.getItem(STATE_STORAGE_KEY) === previousState, suspended: stateSaveSuspended };
        });
        assert.match(lateFailure.message, /Late settings restore failure/);
        assert.equal(lateFailure.retained, true);
        assert.equal(lateFailure.suspended, false);
        await clickPartControl('.song-beta-recall');
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        await page.click('#songBetaStop');
        console.log('PASS: Deferred toggle autosaves cannot overwrite failure recovery on the next animation frame; retry succeeds.');

        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy && mygrainSongBeta.song?.parts.length === 2);
        assert.equal(await page.locator('#songBetaArmConcurrency').inputValue(), '1');
        assert.equal(await page.locator('.song-beta-recall').count(), 2);
        assert.equal(await page.locator('.song-beta-part-controls:visible').count(), 0);
        console.log('PASS: Song and named parts survive page reload.');

        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        await page.evaluate(() => { mygrainSongBetaAdapter.renderPart = () => { throw new Error('Server render should have been reused'); }; });
        await page.click('#songBetaArm');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.armed);
        console.log('PASS: Reloaded songs reuse verified server renders rather than rerendering.');

        const originalId = await page.evaluate(() => mygrainSongBeta.song.parts[0].id);
        await clickPartControl('.song-beta-amend');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.editing);
        assert.ok(await page.locator('.song-beta-part-repeats input').evaluateAll(inputs => inputs.every(input => input.disabled)));
        await setPartColour(0, '#c77dff');
        assert.equal(await page.evaluate(() => mygrainSongBeta.editing.id), originalId);
        assert.equal(await page.evaluate(() => sequencerPlaying || bastardLoopPlaying || drumMachinePlaying), false);
        await page.evaluate(() => {
            sequencerSteps[0].pitch = 'E4';
            sequencerSteps[0].volume = 43;
            updateSequencerStepUI(1);
            grainAMuted = false;
        });
        await page.fill('#songBetaPartName', 'Intro amended');
        await page.click('#songBetaSavePart');
        await page.waitForFunction(() => !mygrainSongBeta.busy && !mygrainSongBeta.editing && mygrainSongBeta.song.parts[0].revision === 2);
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts[0].id), originalId);
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts[0].colour), '#c77dff');
        assert.equal(await page.evaluate(() => Boolean(mygrainSongBeta.song.parts[0].render)), false);
        await clickPartControl('.song-beta-load');
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        assert.equal(await page.evaluate(() => sequencerSteps[0].pitch), 'E4');
        assert.equal(await page.evaluate(() => sequencerSteps[0].volume), 43);
        assert.equal(await page.evaluate(() => sequencerPlaying || bastardLoopPlaying), false);
        console.log('PASS: Amend/Save replaces the full existing pattern, retains its identity/order, invalidates old audio, and Recall loads it stopped for editing.');

        await clickPartControl('.song-beta-amend');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.editing);
        await page.evaluate(() => { sequencerSteps[0].pitch = 'G4'; updateSequencerStepUI(1); });
        await page.click('#songBetaCancelEdit');
        await clickPartControl('.song-beta-load');
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        assert.equal(await page.evaluate(() => sequencerSteps[0].pitch), 'E4');
        console.log('PASS: Cancelling an amendment does not alter the saved pattern.');

        await page.evaluate(() => { sequencerSteps[0].pitch = 'F4'; updateSequencerStepUI(1); });
        await page.fill('#songBetaPartName', 'Editable recalled copy');
        await page.click('#songBetaNewPart');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts.length === 3);
        await clickPartControl('.song-beta-load');
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        assert.equal(await page.evaluate(() => sequencerSteps[0].pitch), 'E4');
        await clickPartControl('.song-beta-load', 2);
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        assert.equal(await page.evaluate(() => sequencerSteps[0].pitch), 'F4');
        page.once('dialog', dialog => dialog.accept());
        await clickPartControl('.song-beta-delete', 2);
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts.length === 2);
        console.log('PASS: Recall/edit/New Part creates an independent copy; Delete removes only that part.');

        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy && mygrainSongBeta.song?.parts.length === 2);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        await clickPartControl('.song-beta-load');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.active === mygrainSongBeta.song.parts[0].id);
        assert.equal(await page.evaluate(() => sequencerSteps[0].pitch), 'E4');
        console.log('PASS: Amended parts remain recallable and editable after a fresh song/page load, without arming.');

        const cancelled = await page.evaluate(async () => {
            const snapshot = await mygrainSongBetaAdapter.decode(await (await mygrainSongBetaAdapter.capture()).arrayBuffer(), { buffers: new Map(), bytes: 0 });
            const before = JSON.stringify(gatherPreset().sliders);
            const abort = new AbortController();
            setTimeout(() => abort.abort(), 150);
            const results = await Promise.allSettled(mygrainSongBeta.song.parts.map(part => mygrainSongBetaAdapter.renderPart(snapshot, part, abort.signal)));
            return { errors: results.map(result => result.reason?.name), bridges: __mygrainSongRenderBridges.size, frames: document.querySelectorAll('iframe[title="Isolated song audio renderer"]').length, context: audioContext.state, unchanged: JSON.stringify(gatherPreset().sliders) === before };
        });
        assert.deepEqual(cancelled, { errors: ['AbortError', 'AbortError'], bridges: 0, frames: 0, context: 'running', unchanged: true });
        console.log('PASS: Cancelling concurrent preparation releases both renderers without closing audio or changing the live patch.');

        const savedParts = await page.evaluate(() => mygrainSongBeta.song.parts.map(part => ({ id: part.id, sha256: part.sha256, render: part.render })));
        for (const index of [0, 1]) {
            const toggle = page.locator('.song-beta-toggle').nth(index);
            if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
        }
        await page.getByRole('spinbutton', { name: 'Repeats for Intro amended', exact: true }).fill('3');
        await page.getByRole('spinbutton', { name: 'Repeats for Intro amended', exact: true }).press('Enter');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts[0].repeats === 3);
        await page.locator('.song-beta-part-repeats input').nth(1).fill('4');
        await page.locator('.song-beta-part-repeats input').nth(1).press('Tab');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts[1].repeats === 4);
        assert.equal(await page.locator('.song-beta-part-controls:visible').count(), 0);
        assert.deepEqual(await page.evaluate(() => mygrainSongBeta.song.parts.map(part => ({ id: part.id, sha256: part.sha256, render: part.render }))), savedParts);
        await page.locator('.song-beta-part-repeats input').first().fill('0');
        await page.locator('.song-beta-part-repeats input').first().press('Tab');
        await page.waitForFunction(() => !mygrainSongBeta.busy && document.getElementById('songBetaStatus').classList.contains('song-beta-error'));
        assert.equal(await page.locator('.song-beta-part-repeats input').first().inputValue(), '3');
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy && mygrainSongBeta.song?.parts.length === 2);
        assert.deepEqual(await page.locator('.song-beta-part-repeats input').evaluateAll(inputs => inputs.map(input => input.value)), ['3', '4']);
        assert.equal(await page.evaluate(() => mygrainSongBeta.song.parts[0].colour), '#c77dff');
        assert.equal(await page.locator('.song-beta-part').first().evaluate(row => getComputedStyle(row).borderLeftColor), 'rgb(199, 125, 255)');
        assert.equal(await page.locator('.song-beta-part-colour input:visible').count(), 0);
        assert.match(await page.locator('.song-beta-part-detail').first().textContent(), /1\.2s/);
        assert.match(await page.locator('.song-beta-part-detail').nth(1).textContent(), /2\.0s/);
        console.log('PASS: Inline repeats save on Enter/blur, reject invalid counts, retain snapshots/renders, and survive reload.');

        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);

        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => {
            document.activeElement?.blur();
            document.getElementById('sectionJumpDrawer').classList.remove('is-open');
            window.scrollTo(0, 0);
        });
        const tabs = await page.evaluate(() => {
            const jump = document.getElementById('sectionJumpHandle').getBoundingClientRect();
            const song = document.getElementById('sectionJumpSongBtn');
            const quick = song.getBoundingClientRect();
            return { jump: { left: jump.left, top: jump.top, bottom: jump.bottom }, song: { left: quick.left, top: quick.top }, colour: getComputedStyle(song).backgroundColor, target: song.dataset.jumpTarget };
        });
        assert.ok(tabs.jump.top < 25, `Jump has not moved up: ${JSON.stringify(tabs)}`);
        assert.ok(tabs.jump.left < tabs.song.left - 8, `Jump does not project further: ${JSON.stringify(tabs)}`);
        assert.ok(tabs.song.top >= tabs.jump.bottom, `Song overlaps Jump: ${JSON.stringify(tabs)}`);
        assert.equal(tabs.colour, 'rgb(184, 239, 190)');
        assert.equal(tabs.target, '#songBetaCard');
        await page.click('#sectionJumpSongBtn');
        await page.waitForFunction(() => Math.abs(document.getElementById('songBetaCard').getBoundingClientRect().top) < 40);
        await page.evaluate(() => document.activeElement?.blur());
        console.log('PASS: Higher/protruding Jump and light-green Song quick tab navigate to the arrangement.');
        await page.locator('#songBetaCard').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('.song-beta-part-controls:visible').count(), 0);
        assert.equal(await page.locator('.song-beta-part-header .song-beta-part-repeats input:visible').count(), 2);
        const compactHeights = await page.locator('.song-beta-part').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
        assert.ok(compactHeights.every(height => height <= 60), `Collapsed mobile rows are not compact: ${compactHeights}`);
        for (const index of [0, 1]) await expandPart(index);
        const mobile = await page.locator('#songBetaCard').evaluate(card => ({ scroll: card.scrollWidth, client: card.clientWidth }));
        assert.ok(mobile.scroll <= mobile.client + 1, `Song card overflows on mobile: ${JSON.stringify(mobile)}`);
        assert.deepEqual(errors, []);
        if (process.env.SONG_BETA_SCREENSHOT_DIR) await page.locator('#songBetaCard').screenshot({ path: `${process.env.SONG_BETA_SCREENSHOT_DIR}/song-clock-mobile.png` });
        console.log('PASS: 390px mobile card layout fits, with no page errors.');
        await page.evaluate(() => {
            mygrainSongBeta.song.parts[1].name = 'Verse with a very long part name that must not push the move arrows off the screen';
            mygrainSongBeta.render();
        });
        await page.setViewportSize({ width: 320, height: 844 });
        for (const expanded of [false, true]) {
            const toggle = page.locator('.song-beta-toggle').nth(1);
            if (await toggle.getAttribute('aria-expanded') !== String(expanded)) await toggle.click();
            const narrow = await page.locator('#songBetaCard').evaluate(card => ({ scroll: card.scrollWidth, client: card.clientWidth }));
            assert.ok(narrow.scroll <= narrow.client + 1, `Long part name overflows at 320px: ${JSON.stringify(narrow)}`);
            assert.equal(await page.locator('.song-beta-part-header .song-beta-part-repeats input:visible').count(), 2);
        }
        console.log('PASS: Long names remain compact with visible move arrows, collapsed and expanded at 320px.');
        await context.close();
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
