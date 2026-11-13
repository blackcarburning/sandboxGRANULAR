'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:19343/mygrain/';
const out = process.env.MYGRAIN_TEST_OUTPUT || '/tmp';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);

(async () => {
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            const context = await browser.newContext({ viewport: { width: engine === 'webkit' ? 390 : 1280, height: 844 }, ...(engine === 'webkit' ? { isMobile: true, hasTouch: true } : {}) });
            const page = await context.newPage(), errors = [], jobs = [];
            page.setDefaultTimeout(120000);
            page.on('pageerror', error => errors.push(error.message));
            page.on('dialog', dialog => dialog.accept());
            page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/server-arm?')) jobs.push(request.url()); });
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
            assert((await context.request.post(base + 'api/auth/login', { data: { username: 'admin', password: 'isolated-render-refresh-fixture' } })).ok());
            await page.goto(base);
            await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready' && window.mygrainCookingPot);
            await page.evaluate(() => mygrainCardHistory.ready);
            await page.locator('#start-btn').click();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
            await page.locator('#cookingPotCard').evaluate(el => { mygrainDisplay.reveal(el); el.scrollIntoView({ block: 'start' }); });
            const ready = async () => { await page.waitForFunction(() => !mygrainCardHistory.busy && !document.querySelector('[data-pot-power]').disabled); await page.evaluate(() => mygrainCookingPot.whenReady()); };
            const click = async () => { await page.locator('[data-pot-power]').click(); await ready(); };
            const read = () => {
                const effects = { mutilator: mygrainD.settings().mutilator, bassFace: mygrainBassFace.settings(), turntable: mygrainTurntable.settings(), resonator: mygrainResonator.settings(), ...mygrainAcousticFx.settings(), wasp: mygrainWasp.settings(), playground: mygrainWasp.settings().playground, masterBaker: mygrainMasterBaker.settings() };
                return { effects, pot: mygrainCookingPot.settings(), powers: Object.fromEntries(Object.entries(effects).map(([key, value]) => [key, value.enabled])), buttons: [...document.querySelectorAll('[data-pot-effect-power],[data-master-baker-final] [data-master-baker-power]')].map(el => ({ pressed: el.getAttribute('aria-pressed'), text: el.textContent.trim() })), pressed: document.querySelector('[data-pot-power]').getAttribute('aria-pressed') };
            };
            await page.evaluate(async () => {
                stopAllPerformancePlayback({ silent: true });
                await mygrainCookingPot.restore({ enabled: false });
                mygrainD.setMutilator({ ...mygrainD.settings().mutilator, enabled: false }, { skipSave: true });
                mygrainBassFace.restore({ ...mygrainBassFace.settings(), enabled: true });
                await mygrainTurntable.off(); await mygrainResonator.off();
                await mygrainAcousticFx.off();
                await mygrainAcousticFx.set('wireWorld', { ...mygrainAcousticFx.settings('wireWorld'), enabled: true, source: 'D', level: .08 });
                await mygrainAcousticFx.set('bubbleChamber', { ...mygrainAcousticFx.settings('bubbleChamber'), enabled: true, source: 'D', level: .05 });
                await mygrainWasp.restore({ ...mygrainWasp.settings(), enabled: false, playground: { ...mygrainWasp.settings().playground, enabled: false } });
                await mygrainMasterBaker.restore({ enabled: true, preset: 'level', settings: { ...MygrainMasterDSP.PRESETS.level, drive: -12 } });
                await mygrainCookingPot.whenReady(); saveState();
            });
            const original = await page.evaluate(read);
            assert.equal(original.pressed, 'true'); assert.equal(original.buttons.length, 10);
            await click();
            const off = await page.evaluate(read);
            assert(Object.values(off.powers).every(value => !value)); assert.equal(off.pressed, 'false');
            assert(off.buttons.every(button => button.pressed === 'false' && /Off/i.test(button.text)));
            assert.equal(off.pot.enabled, original.pot.enabled, 'power must not change native/serial routing');
            assert.deepEqual(off.pot.order, original.pot.order);
            assert.deepEqual(off.pot.power.remembered, original.powers);
            for (const [key, effect] of Object.entries(off.effects)) {
                const expected = structuredClone(original.effects[key]); expected.enabled = false;
                if (key === 'wasp') expected.playground.enabled = false;
                assert.deepEqual(effect, expected, key + ' recipe changed');
            }
            await page.evaluate(() => mygrainCardHistory.undo()); await ready();
            assert.deepEqual((await page.evaluate(read)).effects, original.effects);
            await page.evaluate(() => mygrainCardHistory.redo()); await ready();
            assert.deepEqual((await page.evaluate(read)).effects, off.effects);
            for (let i = 0; i < 2; i++) {
                await click(); assert.deepEqual((await page.evaluate(read)).effects, original.effects);
                await click(); assert.deepEqual((await page.evaluate(read)).effects, off.effects);
            }
            const recalled = await page.evaluate(async () => {
                const zip = await mygrainSongBetaAdapter.capture(), bytes = await zip.arrayBuffer();
                const decoded = await mygrainSongBetaAdapter.decode(bytes, { buffers: new Map(), bytes: 0, limitBytes: 256 * 1024 * 1024 });
                await mygrainCookingPot.setPower(true);
                await mygrainSongBetaAdapter.recall(decoded, { start: false });
                await mygrainCookingPot.whenReady();
                return mygrainCookingPot.settings();
            });
            assert.deepEqual(recalled, off.pot);
            assert.deepEqual((await page.evaluate(read)).effects, off.effects);
            await click(); assert.deepEqual((await page.evaluate(read)).effects, original.effects);
            // All ten enabled, not just the original mixed selection; native and
            // serial routes are both kept intact by the same group operation.
            const all = await page.evaluate(async () => {
                await mygrainCookingPot.restore({ enabled: true });
                mygrainD.setMutilator({ ...mygrainD.settings().mutilator, enabled: true }, { skipSave: true });
                mygrainBassFace.restore({ ...mygrainBassFace.settings(), enabled: true });
                await mygrainTurntable.restore({ ...mygrainTurntable.settings(), enabled: true });
                await mygrainResonator.restore({ ...mygrainResonator.settings(), enabled: true });
                for (const key of MygrainAcousticFx.KEYS) await mygrainAcousticFx.set(key, { ...mygrainAcousticFx.settings(key), enabled: true });
                await mygrainWasp.restore({ ...mygrainWasp.settings(), enabled: true, playground: { ...mygrainWasp.settings().playground, enabled: true } });
                await mygrainMasterBaker.setEnabled(true); await mygrainCookingPot.whenReady();
                return mygrainCookingPot.settings();
            });
            await click(); assert(Object.values((await page.evaluate(read)).powers).every(value => !value));
            await click(); assert(Object.values((await page.evaluate(read)).powers).every(Boolean));
            assert.equal((await page.evaluate(read)).pot.enabled, all.enabled);
            // Native command 6 must use exactly the same remembered group switch.
            await page.evaluate(() => mygrainCookingPot.remoteControl(6, 0, 0)); await ready();
            assert(Object.values((await page.evaluate(read)).powers).every(value => !value));
            await page.evaluate(() => mygrainCookingPot.remoteControl(6, 0, 1)); await ready();
            assert(Object.values((await page.evaluate(read)).powers).every(Boolean));
            const pcm = await page.evaluate(async () => {
                for (const layer of SPARSE_RANDOM_LAYER_DEFINITIONS) layer.setEnabled(false, { silent: true, skipSave: true });
                clearAllPerformanceSoloStates({ silent: true, skipSave: true });
                setFxMuted(true, { silent: true }); setFilterEnabled('lpf', false); setFilterEnabled('hpf', false);
                for (const id of ['reverb','distortion','noiseMix','finalDriveSoft','finalDriveHard','finalDriveFold','finalDriveCrush','finalCompressorAmount','finalSidechainAmount','delayMix','delayFeedback','finalDelayDepth','finalReverbMix','oscNoiseLevel']) setSliderValue(id, 0);
                await mygrainCookingPot.setPower(false); await mygrainCookingPot.restore({ enabled: false });
                mygrainEffectOutput.restore(); mygrainLoopFx.restore(); mygrainChannelEq.restore(); mygrainNoise.restore();
                setSliderValue('performanceMasterTrim', 0); setSliderValue('volume', 100); applyGlobalBpm(240); syncPatternLengthControls(16, { skipSave: true });
                const ctx = audioContext, source = ctx.createBuffer(2, ctx.sampleRate, ctx.sampleRate);
                for (let ch = 0; ch < 2; ch++) for (let i = 0; i < source.length; i++) source.getChannelData(ch)[i] = .2 * Math.sin(2 * Math.PI * 1100 * i / source.sampleRate);
                await mygrainD.apply(source, 'Power switch fixture', { sourceKey: 'import', fileName: 'pot-power.wav', bpm: 240, durationSeconds: 1 });
                mygrainD.enable(true, { silent: true, skipSave: true }); setSliderValue('performanceBastardLoopDLevel', 80);
                await mygrainMasterBaker.restore({ enabled: true, preset: 'level', settings: { ...MygrainMasterDSP.PRESETS.level, drive: -18 } });
                updateEffects(); restartAllTransport({ silent: true, startTime: ctx.currentTime + .3 });
                const analyser = ctx.createAnalyser(); analyser.fftSize = 8192; finalAmplifierNode.connect(analyser);
                const measure = async () => { await new Promise(resolve => setTimeout(resolve, 650)); const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples); return Math.sqrt(samples.reduce((n, x) => n + x*x, 0) / samples.length); };
                try {
                    const on = await measure();
                    await mygrainCardHistory.runDraftEdit('Cooking pot on/off', () => mygrainCookingPot.setPower(false));
                    const off = await measure();
                    await mygrainCardHistory.runDraftEdit('Cooking pot on/off', () => mygrainCookingPot.setPower(true));
                    const restored = await measure();
                    stopAllPerformancePlayback({ silent: true }); return { on, off, restored };
                } finally { finalAmplifierNode.disconnect(analyser); analyser.disconnect(); }
            });
            assert(pcm.on > 1e-5 && pcm.off > pcm.on * 6 && Math.abs(pcm.restored / pcm.on - 1) < .03, JSON.stringify(pcm));
            let song = null;
            if (engine === 'chromium') {
                song = await page.evaluate(async () => {
                    const c = mygrainSongBeta; document.getElementById('songBetaName').value = 'Cooking pot remembered power'; await c.newSong();
                    // An actual legacy snapshot with no new metadata.
                    await mygrainMasterBaker.setEnabled(false); await mygrainCookingPot.restore({ enabled: false });
                    await c.newPart({ name: 'Legacy dry', repeats: 1 });
                    await mygrainMasterBaker.setEnabled(true); await c.newPart({ name: 'Original master On', repeats: 1 });
                    await mygrainCardHistory.runDraftEdit('Cooking pot on/off', () => mygrainCookingPot.setPower(false));
                    await c.newPart({ name: 'Remembered group Off', repeats: 1 });
                    await mygrainCardHistory.runDraftEdit('Cooking pot on/off', () => mygrainCookingPot.setPower(true));
                    await c.newPart({ name: 'Restored group On', repeats: 1 });
                    const hashes = c.song.parts.map(p => p.sha256), revision = c.song.revision;
                    await c.finishEditing(); c.serverPreparation = true; c.phonePreparation = true; await c.arm();
                    if (!c.armed) throw Error(document.getElementById('songBetaStatus').textContent);
                    const rows = [];
                    for (const part of c.song.parts) { const b = await c.loadRender(part), a = b.getChannelData(0); rows.push({ name: part.name, rms: Math.sqrt(a.reduce((sum, x) => sum + x*x, 0) / a.length), identity: part.contentSha256, frames: b.length }); }
                    await c.arm(); await c.playSong(); const playing = c.playing; c.stop();
                    if (JSON.stringify(hashes) !== JSON.stringify(c.song.parts.map(p => p.sha256)) || c.song.revision !== revision) throw Error('Rendering rewrote source archives');
                    // A real saved-part amendment must allow the same control while
                    // stopped and while the live loop runs, without Song playback.
                    await c.amendPart(c.song.parts[2]);
                    await mygrainCardHistory.runDraftEdit('Cooking pot on/off', () => mygrainCookingPot.setPower(true));
                    restartAllTransport({ silent: true });
                    await mygrainCardHistory.runDraftEdit('Cooking pot on/off', () => mygrainCookingPot.setPower(false));
                    stopAllPerformancePlayback({ silent: true }); await c.savePart(); c.cancelAmendment(); await c.finishEditing();
                    await c.recall(c.song.parts[2], { start: false });
                    if (!mygrainCookingPot.settings().power?.remembered.masterBaker || mygrainMasterBaker.settings().enabled) throw Error('Amendment lost remembered group state');
                    await mygrainCardHistory.runDraftEdit('Cooking pot on/off', () => mygrainCookingPot.setPower(true));
                    if (!mygrainMasterBaker.settings().enabled) throw Error('Saved amendment did not restore Master Baker');
                    return { rows, playing, savedAmendment: true, memory: c.memoryBudget.bytes };
                });
                assert.equal(song.rows[0].identity, song.rows[2].identity);
                assert.equal(song.rows[1].identity, song.rows[3].identity);
                assert(song.rows.every(row => row.rms > 1e-5));
                assert(Math.abs(song.rows[0].rms / song.rows[2].rms - 1) < .01);
                assert(Math.abs(song.rows[1].rms / song.rows[3].rms - 1) < .01);
                assert(song.playing && song.savedAmendment); assert.equal(song.memory, 0); assert.equal(jobs.length, 4);
            }
            assert.deepEqual(errors, []);
            fs.writeFileSync(path.join(out, 'cooking-pot-power-' + engine + '.json'), JSON.stringify({ mixedAndAllTen: true, linkedButtons: true, undoRedo: true, zipRecall: true, nativeCommands: true, pcm, song, jobs: jobs.length, errors }, null, 2));
            console.log('PASS', engine, 'remembered selection, ten linked powers, recipes/routing, repeat, Undo/Redo, ZIP, native command, playing PCM', JSON.stringify({ pcm, song, jobs: jobs.length }));
            await context.close();
        } finally { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
