const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
const arpFixture = process.env.Q_TEST_ARP === '1';
const arpRepeat = process.env.Q_TEST_ARP_REPEAT || 'until-next';
const delayBeats = Number(process.env.Q_TEST_DELAY_BEATS || .75);
const instrument = process.env.Q_TEST_INSTRUMENT || 'piano';
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost song test server.');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const contexts = [];
    const errors = [];
    const repositoryRequests = [];
    async function openPhone(sampleRate, key, blockSamples = false) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        contexts.push(context);
        await context.addInitScript(({ sampleRate, key }) => {
            const NativeContext = window.AudioContext || window.webkitAudioContext;
            window.AudioContext = class extends NativeContext { constructor(options) { super({ ...options, sampleRate }); } };
            window.webkitAudioContext = window.AudioContext;
            if (key) localStorage.setItem('mygrain-song-library-key-v1', key);
        }, { sampleRate, key });
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        page.on('pageerror', error => errors.push(error.stack));
        await page.route('**/*', route => {
            const url = new URL(route.request().url());
            if (/\/SAMPLES_Q(?:_STRINGS)?\//.test(url.pathname)) {
                repositoryRequests.push({ sampleRate, path: url.pathname, blocked: blockSamples });
                if (blockSamples) return route.abort();
            }
            if (url.pathname.startsWith('/mygrain-bastardloops/')) return route.abort();
            return url.origin === new URL(base).origin ? route.continue() : route.abort();
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainQ && window.mygrainSongBeta && !mygrainSongBeta.busy && document.querySelectorAll('#bastardLoopQScale option').length === 86);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        return page;
    }
    try {
        const page = await openPhone(48000);
        assert.equal(repositoryRequests.length, 0);
        await page.selectOption('#performanceBastardLoopQInstrument', instrument);
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
        await page.click('#performanceBastardLoopQEditBtn');
        const layouts = [];
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 844 }]) {
            await page.setViewportSize(viewport);
            await page.waitForFunction(() => Math.abs(document.getElementById('bastardLoopQOverlay').getBoundingClientRect().height - visualViewport.height) < 1);
            const layout = await page.locator('#bastardLoopQOverlay').evaluate(overlay => {
                const shell = overlay.querySelector('.q-shell');
                const rect = shell.getBoundingClientRect();
                return { width: innerWidth, parent: overlay.parentElement.tagName, visible: getComputedStyle(overlay).display, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, overflow: shell.scrollWidth > shell.clientWidth + 1, scrollable: shell.scrollHeight > shell.clientHeight, height: innerHeight };
            });
            assert.equal(layout.parent, 'BODY');
            assert.equal(layout.visible, 'flex');
            assert.equal(layout.overflow, false);
            assert.ok(layout.left >= 0 && layout.right <= viewport.width);
            assert.ok(layout.top >= 0 && layout.bottom <= viewport.height);
            layouts.push(layout);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => {
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            finalAmplifierNode.connect(analyser);
            window.qAuditionAnalyser = analyser;
        });
        await page.locator('.q-chord[data-root="2"][data-type="minor"]').click();
        await page.waitForFunction(() => mygrainQ.voices.size >= 3);
        const audition = await page.evaluate(() => ({ pitches: [...mygrainQ.voices].map(voice => voice.pitch), starts: [...mygrainQ.voices].map(voice => voice.start), selected: mygrainQ.state.selection.notes }));
        await page.waitForFunction(() => {
            const samples = new Float32Array(qAuditionAnalyser.fftSize);
            qAuditionAnalyser.getFloatTimeDomainData(samples);
            return samples.some(sample => Math.abs(sample) > .001);
        });
        assert.deepEqual(audition.pitches, [50, 53, 57]);
        assert.equal(new Set(audition.starts).size, 1);
        await page.locator('#bastardLoopQEditTools summary').click();
        await page.click('#bastardLoopQInsertBtn');
        assert.deepEqual(await page.evaluate(() => mygrainQ.state.sequence[0].notes), [50, 53, 57]);
        await page.locator('#bastardLoopQTonalSettings summary').click();
        await page.locator('#bastardLoopQRoot').selectOption('0');
        await page.locator('#bastardLoopQQuality').selectOption('major7');
        await page.locator('#bastardLoopQInversion').selectOption('1');
        await page.click('#bastardLoopQInsertBtn');
        assert.deepEqual(await page.evaluate(() => mygrainQ.state.sequence[1].notes), [52, 55, 59, 60]);
        await page.locator('[data-q-action="transpose-range"]').click();
        await page.locator('[data-q-step="0"]').click();
        await page.locator('[data-q-step="0"]').click();
        await page.locator('[data-q-action="transpose-up"]').click();
        assert.deepEqual(await page.evaluate(() => mygrainQ.state.sequence.slice(0, 2).map(step => step.notes)), [[51, 54, 58], [52, 55, 59, 60]]);
        await page.locator('#bastardLoopQScale').selectOption('custom');
        assert.equal(await page.locator('#bastardLoopQCustomScale').isVisible(), true);
        await page.locator('[data-q-pitch="1"]').click();
        assert.ok(await page.evaluate(() => mygrainQ.state.customScale.includes(1)));
        await page.evaluate(instrument => {
            mygrainQ.restore({ ...MygrainQTheory.defaults(), instrument });
            mygrainQ.state.record = true;
            mygrainQ.sync();
        }, instrument);
        await page.click('.q-chord[data-root="0"][data-type="major"]');
        await page.click('.q-chord[data-root="7"][data-type="major"]');
        assert.deepEqual(await page.evaluate(() => mygrainQ.state.sequence.slice(0, 2).map(step => step.notes)), [[48, 52, 55], [55, 59, 62]]);
        assert.equal(await page.evaluate(() => mygrainQ.cursor), 2);
        await page.waitForFunction(() => mygrainQ.piano.pending.size === 0);
        await page.click('#bastardLoopQCloseBtn');
        await page.locator('#performanceBastardLoopQLevelMixer').evaluate(input => { input.value = '37'; input.dispatchEvent(new Event('input', { bubbles: true })); });
        assert.equal(await page.evaluate(() => mygrainQ.state.level), .37);
        assert.equal(await page.locator('#performanceBastardLoopQLevel').inputValue(), '0.37');
        const fixture = await page.evaluate(async ({ arpFixture, arpRepeat, delayBeats, instrument }) => {
            stopAllPerformancePlayback({ silent: true });
            generatedDryLoopEnabled = false;
            generatedSampleLayerEnabled = false;
            granularLayersEnabled = false;
            oscillatorsEnabled = false;
            for (const setEnabled of [setBastardLoopEnabled, setBastardLoop2Enabled, setBastardLoop3Enabled, setBastardLoopVEnabled, setBastardLoopPEnabled, setBastardLoopOEnabled, setBastardLoopLEnabled, setBastardLoopXEnabled, setBastardLoopMEnabled, setBastardLoopMPlusEnabled, setDropboxSampleLayerEnabled, setDrumMachineEnabled]) setEnabled(false, { skipSave: true, silent: true });
            syncPatternLengthControls(8, { skipSave: true });
            applyGlobalBpm(300);
            const state = MygrainQTheory.defaults();
            Object.assign(state, { instrument, enabled: true, recordMode: 'live', level: .6, lowpass: 7400, highpass: 75, room: .28, delay: .22, feedback: .3, delayBeats });
            if (arpFixture) Object.assign(state, { arpEnabled: true, arpPattern: 'down', arpRepeat, arpDivision: .125 });
            state.sequence[0] = MygrainQTheory.normalizeStep({ root: 48, notes: [48, 52, 55], gate: 3.8, velocity: 96 });
            state.sequence[4] = MygrainQTheory.normalizeStep({ root: 53, notes: [53, 57, 60], gate: 3.8, velocity: instrument === 'strings' ? 32 : 96 });
            mygrainQ.restore(state);
            mygrainQ.nudgeStep(1);
            await mygrainQ.preparePlayback();
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            finalAmplifierNode.connect(analyser);
            window.qFixtureAnalyser = analyser;
            mygrainQ.start(audioContext.currentTime + .04);
            return { sampleRate: audioContext.sampleRate, notes: mygrainQ.state.sequence.filter(Boolean).flatMap(step => step.notes) };
        }, { arpFixture, arpRepeat, delayBeats, instrument });
        assert.equal(fixture.sampleRate, 48000);
        await page.waitForFunction(() => mygrainQ.voices.size >= 3);
        await page.waitForFunction(() => {
            const samples = new Float32Array(qFixtureAnalyser.fftSize);
            qFixtureAnalyser.getFloatTimeDomainData(samples);
            return samples.some(sample => Math.abs(sample) > .001);
        });
        await page.waitForFunction(() => Math.abs(mygrainQ.graph.highpass.frequency.value - 75) < 1 && Math.abs(mygrainQ.graph.lowpass.frequency.value - 7400) < 1);
        const live = await page.waitForFunction(() => {
            const samples = new Float32Array(qFixtureAnalyser.fftSize);
            qFixtureAnalyser.getFloatTimeDomainData(samples);
            const power = samples.reduce((total, sample) => total + sample * sample, 0) / samples.length;
            return power > .000001 && mygrainQ.voices.size >= 3 ? { power, highpass: mygrainQ.graph.highpass.frequency.value, lowpass: mygrainQ.graph.lowpass.frequency.value, delay: mygrainQ.graph.delay.delayTime.value, feedback: mygrainQ.graph.feedback.gain.value, room: mygrainQ.graph.roomWet.gain.value, voices: mygrainQ.voices.size } : false;
        }).then(handle => handle.jsonValue());
        assert.ok(live.power > .000001, `Q should be audible: ${live.power}`);
        assert.ok(live.voices >= 3);
        assert.ok(Math.abs(live.highpass - 75) < 1 && Math.abs(live.lowpass - 7400) < 1);
        assert.ok(Math.abs(live.delay - .2 * delayBeats) < .01 && Math.abs(live.room - .224) < .01);
        await page.click('#performanceBastardLoopQStopBtn');
        assert.equal(await page.evaluate(() => mygrainQ.running || mygrainQ.voices.size > 0), false);
        await page.click('#performanceBastardLoopQStartBtn');
        await page.waitForFunction(() => bastardLoopPlaying && mygrainQ.running);
        await page.evaluate(() => setBastardLoopPlaying(false));
        assert.equal(await page.evaluate(() => mygrainQ.running), false);
        await page.click('#performanceBastardLoopQLayerSoloBtn');
        const stems = await page.evaluate(() => {
            const snapshot = captureStemExportState();
            applyStemIsolation('bastardX');
            const otherStemMutesQ = !mygrainQ.state.enabled;
            applyStemIsolation('bastardQ');
            const qStem = mygrainQ.state.enabled && !bastardLoopXEnabled && !granularLayersEnabled && !drumMachineEnabled;
            restoreStemExportState(snapshot);
            return { otherStemMutesQ, qStem, restored: mygrainQ.state.enabled === snapshot.bastardLoopQEnabled };
        });
        assert.deepEqual(stems, { otherStemMutesQ: true, qStem: true, restored: true });
        assert.deepEqual(await page.evaluate(() => ({ q: getLoopLayerSoloGain('bastardq'), x: getLoopLayerSoloGain('bastardx') })), { q: 1, x: 0 });
        await page.click('#performanceBastardLoopQLayerSoloBtn');
        const saved = await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            controller.acceptSong((await controller.request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Isolated Q piano fixture' }) })).song);
            const body = await mygrainSongBetaAdapter.capture();
            const inspected = mygrainSongBetaAdapter.inspectPart(await body.arrayBuffer());
            controller.acceptSong((await controller.request(`/${controller.song.id}/parts?name=Q%20Chords&repeats=2`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body })).song);
            await controller.arm();
            const part = controller.song.parts[0];
            const render = controller.renders.get(part.id);
            const power = render.getChannelData(0).reduce((total, sample) => total + sample * sample, 0) / render.length;
            return { id: controller.song.id, key: controller.key, state: inspected.snapshot.state.q, asset: inspected.snapshot.assets.find(asset => asset.key === 'bastardQ'), inventory: inspected.snapshot.extra.audioSlots.bastardQ, qVersion: part.qVersion, renderVersion: part.render.qVersion, power, hash: part.render.sha256, bytes: body.size };
        });
        assert.equal(saved.inventory, true);
        assert.equal(saved.state.recordMode, 'live');
        assert.equal(saved.state.sequence[0], null);
        assert.deepEqual(saved.state.sequence[1].notes, [48, 52, 55]);
        assert.equal(saved.asset.channels, 2);
        assert.equal(saved.state.delayBeats, delayBeats);
        assert.equal(saved.state.instrument, instrument);
        if (instrument === 'strings') assert.deepEqual([...new Set(saved.state.bank.samples.map(sample => sample.velocity))].sort((first, second) => first - second), [32, 96]);
        assert.equal(saved.qVersion, instrument === 'strings' ? 5 : 4);
        assert.equal(saved.renderVersion, instrument === 'strings' ? 5 : 4);
        assert.ok(saved.power > .000001, `Q song freeze should be audible: ${saved.power}`);
        const mixedParts = instrument === 'strings' ? await page.evaluate(async () => {
            const controller = mygrainSongBeta;
            await mygrainQ.setInstrument('piano');
            const body = await mygrainSongBetaAdapter.capture();
            controller.acceptSong((await controller.request(`/${controller.song.id}/parts?name=Piano%20Comparison&repeats=1`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body })).song);
            await controller.arm();
            return controller.song.parts.map(part => ({ qVersion: part.qVersion, renderVersion: part.render.qVersion, power: controller.renders.get(part.id).getChannelData(0).reduce((sum, sample) => sum + sample * sample, 0) / controller.renders.get(part.id).length }));
        }) : [];
        if (instrument === 'strings') {
            assert.deepEqual(mixedParts.map(part => [part.qVersion, part.renderVersion]), [[5, 5], [4, 4]]);
            assert.ok(mixedParts.every(part => part.power > .000001));
        }
        const recalls = [];
        for (const sampleRate of [44100, 48000]) {
            const phone = await openPhone(sampleRate, saved.key, true);
            const recalled = await phone.evaluate(async ({ id }) => {
                const controller = mygrainSongBeta;
                controller.acceptSong((await controller.request(`/${id}`)).song);
                const decoded = await controller.loadPart(controller.song.parts[0]);
                mygrainQ.state.level = .01;
                mygrainQ.state.sequence[0] = MygrainQTheory.normalizeStep({ root: 21, notes: [21, 24, 28], velocity: 32 });
                mygrainQ.piano.cache.set('C3v12', audioContext.createBuffer(2, 441, audioContext.sampleRate));
                Storage.prototype.getItem = () => { throw new Error('Browser storage disabled by Q portability test'); };
                Storage.prototype.setItem = () => { throw new Error('Browser storage disabled by Q portability test'); };
                mygrainSongBetaAdapter.recall(decoded, { start: false });
                const state = mygrainQ.getState();
                return { state, sampleRate: audioContext.sampleRate, pinned: mygrainQ.piano.pinned, atlasRate: mygrainQ.getAudioBuffer().sampleRate, noCache: mygrainQ.piano.cache.size === 0 };
            }, { id: saved.id });
            assert.deepEqual(recalled.state, saved.state);
            assert.equal(recalled.sampleRate, sampleRate);
            assert.equal(recalled.atlasRate, sampleRate);
            assert.equal(recalled.pinned, true);
            assert.equal(recalled.noCache, true);
            await phone.click('#performanceBastardLoopQPlayBtn');
            await phone.waitForFunction(() => mygrainQ.voices.size >= 3);
            assert.equal(await phone.evaluate(() => mygrainQ.piano.pinned), true);
            await phone.evaluate(() => mygrainQ.stop());
            const warmed = await phone.evaluate(async () => {
                await mygrainSongBeta.arm();
                const part = mygrainSongBeta.song.parts[0];
                return { hash: part.render.sha256, rate: mygrainSongBeta.renders.get(part.id).sampleRate };
            });
            assert.equal(warmed.hash, saved.hash);
            recalls.push({ sampleRate, embeddedSamples: recalled.state.bank.samples.length, pinned: recalled.pinned, serverFreezeUnchanged: warmed.hash === saved.hash });
        }
        assert.equal(repositoryRequests.filter(request => request.blocked).length, 0);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ instrument, initialSampleRequests: 0, namedScales: 85, customTwelveToneScales: true, layouts, audition, live, stems, snapshotBytes: saved.bytes, embeddedSamples: saved.state.bank.samples.length, renderPower: saved.power, mixedParts, recalls, repositoryFallbackRequests: 0, errors }, null, 2));
    } finally {
        for (const context of contexts) await context.close();
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
