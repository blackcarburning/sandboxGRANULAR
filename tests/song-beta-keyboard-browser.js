const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) {
    throw new Error('Set SONG_BETA_TEST_URL to an isolated localhost test server /mygrain/ route.');
}

(async () => {
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        const grainErrors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error' && message.text().includes('Error playing grain:')) grainErrors.push(message.text()); });
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        await page.evaluate(() => {
            syncPatternLengthControls(8, { skipSave: true });
            applyGlobalBpm(120);
            lfoEnabled = {};
            lfo2Enabled = {};
            lfo3Enabled = {};
            setGeneratedLoopTransportEnabled(false, { silent: true, skipSave: true });
            setOscillatorsEnabled(false, { silent: true, skipSave: true });
            setGranularLayersEnabled(true, { silent: true, skipSave: true });
            setGranularLayerMuted('main', true, { silent: true, skipSave: true });
            setGranularLayerMuted('A', false, { silent: true, skipSave: true });
            setGranularLayerMuted('B', false, { silent: true, skipSave: true });
            setHoldEnabled(true);
            setArpeggiatorEnabled(false);
            setGrainTimingMode('synth', { silent: true, skipSave: true });
            seqGrainsEnabled = false;
            document.getElementById('seqGrainsEnabled').checked = false;
            for (const voice of ['kick', 'snare', 'hat', 'perc']) setDrumMachinePattern(voice, Array(8).fill(false), { skipSave: true });
            for (const [key, frequency] of [['A', 220], ['B', 370]]) {
                const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
                const channel = buffer.getChannelData(0);
                for (let index = 0; index < channel.length; index += 1) channel[index] = Math.sin(2 * Math.PI * frequency * index / buffer.sampleRate) * .35;
                if (key === 'A') grainASampleBuffer = buffer;
                else grainBSampleBuffer = buffer;
                const source = document.getElementById(`grainSynth${key}Source`);
                source.value = `grain${key}Sample`;
                source.dispatchEvent(new Event('change', { bubbles: true }));
                for (const [suffix, value] of [['Volume', '100'], ['Size', '180'], ['Mix', '75'], ['Tune', '0'], ['FineTune', '0']]) {
                    const control = document.getElementById(`grainSynth${key}${suffix}`);
                    control.value = value;
                    control.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
            grainASampleMetadata = { fileName: 'Keyboard A fixture.wav', summary: 'Keyboard A fixture' };
            grainBSampleMetadata = { fileName: 'Keyboard B fixture.wav', summary: 'Keyboard B fixture' };
            saveState();
        });
        const notes = ['C3', 'E3', 'G3'];
        for (const note of notes) {
            await page.locator(`#keyboardContainer .key[data-note="${note}"]`).click();
            await page.waitForFunction(note => heldNotes.has(note), note);
        }
        assert.deepEqual(await page.evaluate(() => [...heldNotes].sort()), notes);
        assert.equal(await page.evaluate(() => [...activeGrains.values()].filter(stream => stream.role === 'keyboard' && !stream.releasing).length), 3, `Keyboard grain errors: ${JSON.stringify(grainErrors)}`);
        await page.fill('#songBetaName', 'Keyboard grain regression');
        await page.click('#songBetaNewSong');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song);
        await page.fill('#songBetaPartName', 'A and B chord');
        await page.click('#songBetaNewPart');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts.length === 1);
        await page.click('#songBetaArm');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.armed);
        const rendered = await page.evaluate(() => {
            const part = mygrainSongBeta.song.parts[0];
            const decoded = mygrainSongBeta.snapshots.get(part.id);
            const buffer = mygrainSongBeta.renders.get(part.id);
            const samples = buffer.getChannelData(0);
            let power = 0;
            for (const sample of samples) power += sample * sample;
            return { notes: decoded.snapshot.extra.heldNotes, sources: decoded.snapshot.assets.map(asset => asset.key), rms: Math.sqrt(power / samples.length), duration: buffer.duration };
        });
        assert.deepEqual(rendered.notes, notes);
        assert.deepEqual(rendered.sources.sort(), ['grainASample', 'grainBSample']);
        assert.equal(rendered.duration, 1);
        assert.ok(rendered.rms > .001, `Saved keyboard chord was not rendered: ${JSON.stringify(rendered)}`);
        console.log(`PASS: A/B polyphonic keyboard chord is saved with both source samples and rendered at ${rendered.rms.toFixed(4)} RMS.`);

        await page.evaluate(() => {
            mygrainSongBeta.stop();
            setHoldEnabled(false);
            setGranularLayerMuted('A', true, { silent: true, skipSave: true });
            setGranularLayerMuted('B', true, { silent: true, skipSave: true });
            grainASampleBuffer.getChannelData(0).fill(0);
            grainBSampleBuffer.getChannelData(0).fill(0);
            document.getElementById('grainSynthASource').value = 'grainAMic';
            document.getElementById('grainSynthBSource').value = 'grainBMic';
            document.getElementById('grainSynthATune').value = '7';
        });
        await page.locator('.song-beta-toggle').first().click();
        await page.locator('.song-beta-load').first().click();
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        assert.deepEqual(await page.evaluate(() => ({ notes: [...heldNotes], keys: getKeyboardActiveNotes(), playing: activeGrains.size, sources: [document.getElementById('grainSynthASource').value, document.getElementById('grainSynthBSource').value], muted: [grainAMuted, grainBMuted], hold: holdEnabled, tune: document.getElementById('grainSynthATune').value, samples: [Math.abs(grainASampleBuffer.getChannelData(0)[10]) > .01, Math.abs(grainBSampleBuffer.getChannelData(0)[10]) > .01], metadata: [grainASampleMetadata.fileName, grainBSampleMetadata.fileName] })), { notes, keys: notes, playing: 0, sources: ['grainASample', 'grainBSample'], muted: [false, false], hold: true, tune: '0', samples: [true, true], metadata: ['Keyboard A fixture.wav', 'Keyboard B fixture.wav'] });
        await page.locator('.song-beta-recall').first().click();
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        assert.equal(await page.evaluate(() => [...activeGrains.values()].filter(stream => stream.role === 'keyboard' && !stream.releasing).length), 3);
        await page.click('#songBetaStop');
        assert.equal(await page.evaluate(() => activeGrains.size), 0);
        console.log('PASS: Recall restores all three highlighted keys, A/B configuration, metadata and original samples without starting audio; Audition starts the full chord and Stop clears it.');

        const migration = await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            const part = controller.song.parts[0];
            const originalBytes = controller.renderBytes;
            const silence = audioContext.createBuffer(2, audioContext.sampleRate, audioContext.sampleRate);
            const legacy = await controller.request(`/${controller.song.id}/parts/${part.id}/render?sha256=${part.sha256}`, {
                method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: mygrainSongBetaAdapter.encodeRender(silence)
            });
            controller.acceptSong(legacy.song);
            const legacyMarked = Boolean(controller.song.parts[0].render.keyboardVersion);
            await controller.run(() => controller.arm());
            const samples = controller.renders.get(part.id).getChannelData(0);
            let power = 0;
            for (const sample of samples) power += sample * sample;
            return { legacyMarked, marked: controller.song.parts[0].render.keyboardVersion, unchangedBytes: originalBytes === controller.renderBytes, rms: Math.sqrt(power / samples.length) };
        });
        assert.equal(migration.legacyMarked, false);
        assert.equal(migration.marked, 1);
        assert.equal(migration.unchangedBytes, true);
        assert.ok(migration.rms > .001);
        console.log('PASS: A legacy silent keyboard render is replaced automatically on re-arm without losing the snapshot or double-counting cache memory.');

        for (const [name, muteA, muteB] of [['A only', false, true], ['All grains muted', true, true]]) {
            await page.evaluate(([muteA, muteB]) => {
                setGranularLayerMuted('A', muteA, { silent: true });
                setGranularLayerMuted('B', muteB, { silent: true });
            }, [muteA, muteB]);
            await page.fill('#songBetaPartName', name);
            await page.click('#songBetaNewPart');
            await page.waitForFunction(() => !mygrainSongBeta.busy);
        }
        await page.evaluate(() => {
            setHoldEnabled(false);
            setGranularLayerMuted('B', false, { silent: true });
            grainSynthBMicBuffer = cloneAudioBufferForCurrentContext(grainBSampleBuffer);
            const source = document.getElementById('grainSynthBSource');
            source.value = 'grainBMic';
            source.dispatchEvent(new Event('change', { bubbles: true }));
        });
        for (const [index, note] of notes.entries()) {
            await page.locator(`#keyboardContainer .key[data-note="${note}"]`).evaluate((key, pointerId) => key.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId, pointerType: 'touch' })), index + 77);
            await page.waitForFunction(note => getKeyboardActiveNotes().includes(note), note);
        }
        assert.equal(await page.evaluate(() => heldNotes.size), 0);
        await page.evaluate(async () => {
            document.getElementById('songBetaPartName').value = 'B mic pressed keys';
            await mygrainSongBeta.run(() => mygrainSongBeta.newPart());
        });
        for (const [index, note] of notes.entries()) {
            await page.locator(`#keyboardContainer .key[data-note="${note}"]`).evaluate((key, pointerId) => key.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId, pointerType: 'touch' })), index + 77);
        }
        await page.click('#songBetaArm');
        await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.armed);
        const layers = await page.evaluate(() => mygrainSongBeta.song.parts.map(part => {
            const decoded = mygrainSongBeta.snapshots.get(part.id);
            const buffer = mygrainSongBeta.renders.get(part.id);
            let power = 0;
            for (const sample of buffer.getChannelData(0)) power += sample * sample;
            return { name: part.name, rms: Math.sqrt(power / buffer.length), notes: decoded.snapshot.extra.heldNotes, hold: decoded.snapshot.state.modes.holdEnabled, sources: decoded.snapshot.assets.map(asset => asset.key), sourceB: decoded.snapshot.state.selects.grainSynthBSource, muted: [decoded.snapshot.state.modes.grainAMuted, decoded.snapshot.state.modes.grainBMuted] };
        }));
        assert.equal(layers.length, 4);
        assert.ok(layers[1].rms > .001, `A-only render: ${JSON.stringify(layers)}`);
        assert.equal(layers[2].rms, 0);
        assert.deepEqual(layers[2].notes, notes);
        assert.deepEqual(layers[2].sources.sort(), ['grainASample', 'grainBSample']);
        assert.ok(layers[3].rms > .001, `B-mic render: ${JSON.stringify(layers)}`);
        assert.deepEqual(layers[3].notes, notes);
        assert.equal(layers[3].hold, false);
        assert.equal(layers[3].sourceB, 'grainBMic');
        assert.deepEqual(layers[3].muted, [true, false]);
        assert.ok(layers[3].sources.includes('grainBMic'));
        console.log('PASS: A-only and B-mic keyboard parts render audibly; both muted layers render silence while retaining samples/keys; pressed polyphonic keys are saved with Hold off.');

        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy && mygrainSongBeta.song?.parts.length === 4);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        await page.locator('.song-beta-toggle').nth(3).click();
        await page.locator('.song-beta-load').nth(3).click();
        await page.waitForFunction(() => !mygrainSongBeta.busy);
        assert.deepEqual(await page.evaluate(() => ({ notes: [...heldNotes], keys: getKeyboardActiveNotes(), sourceB: document.getElementById('grainSynthBSource').value, muted: [grainAMuted, grainBMuted], hold: holdEnabled, mic: Boolean(grainSynthBMicBuffer), streams: activeGrains.size })), { notes, keys: notes, sourceB: 'grainBMic', muted: [true, false], hold: false, mic: true, streams: 0 });
        assert.equal(await page.evaluate(async () => {
            const render = mygrainSongBetaAdapter.renderPart;
            mygrainSongBetaAdapter.renderPart = () => { throw new Error('Keyboard-aware server renders should be reused after reload'); };
            try { await mygrainSongBeta.run(() => mygrainSongBeta.arm()); }
            finally { mygrainSongBetaAdapter.renderPart = render; }
            return mygrainSongBeta.armed;
        }), true);
        const amendment = await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            const part = controller.song.parts[3];
            await controller.amendPart(part);
            document.getElementById('grainSynthBTune').value = '5';
            document.getElementById('grainSynthBTune').dispatchEvent(new Event('input', { bubbles: true }));
            await controller.savePart();
            const updated = controller.song.parts[3];
            const decoded = await controller.loadPart(updated);
            return { id: updated.id === part.id, hashChanged: updated.sha256 !== part.sha256, notes: decoded.snapshot.extra.heldNotes, tuning: decoded.snapshot.state.sliders.grainSynthBTune, mic: decoded.buffers.has('grainBMic') };
        });
        assert.deepEqual(amendment, { id: true, hashChanged: true, notes, tuning: '5', mic: true });
        await page.evaluate(() => mygrainSongBeta.run(() => mygrainSongBeta.recall(mygrainSongBeta.song.parts[0], { start: false })));
        assert.equal(await page.evaluate(() => grainSynthBMicBuffer), null);
        console.log('PASS: Fresh-page Recall restores pressed-key chords and B mic; amendments retain the chord and sample with new tuning; missing mic sources are cleared on the next recall.');
        assert.deepEqual(grainErrors, []);
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
