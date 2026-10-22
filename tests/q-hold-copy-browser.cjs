// Isolated localhost accounts, genuine controls, real sampled audio and Song freezes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.SONG_BETA_TEST_URL || 'http://127.0.0.1:18891/mygrain/';
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/.test(base)) throw Error('Isolated localhost required.');
const evidence = process.env.Q_HOLD_EVIDENCE || '/tmp/mygrain-q-hold-copy';
fs.mkdirSync(evidence, { recursive: true });
(async () => {
    const results = [];
    for (const engine of ['chromium', 'webkit']) {
        const browser = await ({ chromium, webkit }[engine]).launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try { for (const mobile of [false, true]) {
            const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile });
            const auth = await context.request.post(base + 'api/auth/register', { data: { username: `hc_${engine[0]}_${+mobile}_${Date.now()}`, password: 'isolated-hold-copy-test' } });
            assert.equal(auth.status(), 200);
            const page = await context.newPage(), errors = [];
            page.setDefaultTimeout(60000);
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
            const tap = selector => mobile ? page.locator(selector).tap() : page.locator(selector).click();
            const load = async () => {
                await page.goto(base);
                await page.waitForFunction(() => window.mygrainQ && document.documentElement.dataset.mygrainStartup === 'ready');
                await tap('#start-btn');
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
            };
            await load();
            console.log(`${engine}/${mobile}: loaded.`);
            assert.equal(await page.evaluate(() => mygrainQ.state.enabled), true, 'fresh Q participates without having to play Q once');
            await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true }); resetStemIsolationState(); applyGlobalBpm(150); syncPatternLengthControls(16, { skipSave: true });
                setOscillatorsEnabled(false, { skipSave: true, silent: true }); setGranularLayersEnabled(false, { skipSave: true, silent: true });
                const q = MygrainQTheory.defaults();
                q.sequence[0] = MygrainQTheory.normalizeStep({ root: 60, type: 'major', notes: [60, 64, 67], velocity: 71, gate: .5, accent: true, inversion: 1, voicing: 'open' });
                q.sequence[8] = MygrainQTheory.normalizeStep({ root: 48, notes: [48, 52, 55], gate: .5 });
                mygrainQ.restore(q); window.qHoldVoices = [];
                const voice = mygrainQ.voice.bind(mygrainQ);
                mygrainQ.voice = (...args) => { voice(...args); qHoldVoices.push({ pitch: args[0], start: args[2], duration: args[3], hold: args[4]?.hold, eventStart: args[4]?.eventStart, origin: mygrainQ.origin }); };
                saveState();
            });
            assert.equal(await page.evaluate(() => mygrainQ.piano.cache?.size || 0), 0);
            await tap('#performanceBastardLoopPlayBtn');
            await page.waitForFunction(() => mygrainQ.running && qHoldVoices.length > 0);
            const first = await page.evaluate(() => ({ running: mygrainQ.running, origin: mygrainQ.origin, shared: bastardLoopTransportStartTime, voices: qHoldVoices.slice(0, 3) }));
            assert(first.running); assert(first.voices.every(v => Math.abs(v.start - first.origin) < .002), JSON.stringify(first));
            await tap('#performanceBastardLoopStopBtn');
            assert.equal(await page.evaluate(() => mygrainQ.running || mygrainQ.voices.size > 0), false);
            // Main Start must not override an intentional layer mute.
            await page.evaluate(() => { mygrainQ.setEnabled(false); drumMachineEnabled = true; drumMachineHatPattern[0] = true; syncPerformanceControlState(); });
            await tap('#performanceBastardLoopPlayBtn');
            assert.equal(await page.evaluate(() => mygrainQ.running), false);
            await tap('#performanceBastardLoopStopBtn'); await page.evaluate(() => { drumMachineEnabled = false; drumMachineHatPattern.fill(false); mygrainQ.setEnabled(true); });
            await tap('#performanceBastardLoopQEditBtn');
            // Edit a note before copying, proving this is not the original major template.
            const cell = page.locator('[data-q-step="0"]');
            if (mobile) { await cell.tap(); if (!await page.evaluate(() => mygrainQ.chordEditor.opened)) await cell.tap(); } else await cell.dblclick();
            await page.waitForFunction(() => mygrainQ.chordEditor.preview?.running && !mygrainQ.chordEditor.loading);
            await tap('[data-q-note-index="1"]'); await tap('[data-q-note-action="up"]');
            await page.waitForFunction(() => !mygrainQ.chordEditor.loading);
            await tap('#qChordEditorClose');
            const edited = await page.evaluate(() => MygrainQTheory.copy(mygrainQ.state.sequence[0]));
            assert.deepEqual(edited.notes, [60, 65, 67]);
            await tap('#bastardLoopQCopyChordBtn');
            await tap('[data-q-step="4"]'); await tap('#bastardLoopQPasteChordBtn');
            assert.deepEqual(await page.evaluate(() => mygrainQ.state.sequence[4]), edited);
            await page.evaluate(() => mygrainCardHistory.flush());
            await page.evaluate(() => mygrainCardHistory.undo()); await page.waitForFunction(() => !mygrainCardHistory.busy);
            assert.equal(await page.evaluate(() => mygrainQ.state.sequence[4]), null);
            await page.evaluate(() => mygrainCardHistory.redo()); await page.waitForFunction(() => !mygrainCardHistory.busy);
            assert.deepEqual(await page.evaluate(() => mygrainQ.state.sequence[4]), edited);
            await tap('[data-q-step="12"]'); await tap('#bastardLoopQPasteChordBtn');
            assert.deepEqual(await page.evaluate(() => mygrainQ.state.sequence[12]), edited);
            await tap('#bastardLoopQPlaybackSettings > summary'); await tap('#bastardLoopQChordHoldBtn');
            assert.equal(await page.locator('#bastardLoopQChordHoldBtn').getAttribute('aria-pressed'), 'true');
            assert.deepEqual(await page.evaluate(() => MygrainQTheory.playbackEvents(mygrainQ.state,16).map(e => e.gate)), [4,4,4,4]);
            // The normal layout exposes Copy/Paste without opening any detail panel.
            const layouts = [];
            for (const viewport of mobile ? [{ width: 390, height: 844 }, { width: 320, height: 640 }, { width: 844, height: 390 }] : [{ width: 1280, height: 900 }]) {
                await page.setViewportSize(viewport);
                const layout = await page.evaluate(() => { const shell = document.querySelector('#bastardLoopQOverlay .q-shell'), r = shell.getBoundingClientRect(); return { inside: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1, overflow: shell.scrollWidth > shell.clientWidth + 1, controls: [...document.querySelectorAll('.q-session-controls button')].every(b => b.scrollWidth <= b.clientWidth + 1) }; });
                assert(layout.inside && !layout.overflow && layout.controls, JSON.stringify(layout)); layouts.push(layout);
            }
            await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
            await page.screenshot({ path: `${evidence}/${engine}-${mobile ? 'phone' : 'desktop'}.png` });
            await tap('#bastardLoopQCloseBtn');
            if (mobile) await page.evaluate(() => mygrainQ.setInstrument('strings'));
            await tap('#performanceBastardLoopPlayBtn');
            await page.waitForFunction(() => mygrainQ.running && [...mygrainQ.voices].some(v => v.grid));
            const audio = await page.evaluate(async () => {
                const analyser = audioContext.createAnalyser(); analyser.fftSize = 2048; mygrainQ.graph.level.connect(analyser);
                await new Promise(resolve => setTimeout(resolve, 180));
                const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data); analyser.disconnect(); mygrainQ.graph.level.disconnect(analyser);
                return { power: data.reduce((s,x) => s+x*x,0)/data.length, voices: [...mygrainQ.voices].filter(v => v.grid).map(v => ({ end: v.end, start: v.start, release: v.release, looped: v.source.loop })) };
            });
            assert(audio.power > 1e-8, JSON.stringify(audio)); assert(audio.voices.some(v => Math.abs(v.end - v.start - .4) < .01), JSON.stringify(audio));
            if (mobile) assert(audio.voices.some(v => v.looped));
            await tap('#performanceBastardLoopStopBtn');
            await page.evaluate(() => { saveState(); mygrainCardHistory.flush(); }); await load();
            assert.equal(await page.evaluate(() => mygrainQ.state.chordHold), true);
            assert.deepEqual(await page.evaluate(() => mygrainQ.state.sequence[4]), edited);
            console.log(`${engine}/${mobile}: transport, edit, copy, hold, audio and reload passed; freezing Song.`);
            // Capture and recall the actual edited chord and hold setting, then render with v8.
            const song = await page.evaluate(async () => {
                document.getElementById('songBetaName').value = 'Q held edited chords'; await mygrainSongBeta.newSong();
                document.getElementById('songBetaPartName').value = 'Exact edited voicing'; await mygrainSongBeta.newPart();
                const saved = MygrainQTheory.copy(mygrainQ.getState());
                mygrainQ.state.chordHold = false; mygrainQ.state.sequence[4] = null;
                await mygrainSongBeta.recall(mygrainSongBeta.song.parts[0], { start: false });
                const recalled = MygrainQTheory.copy(mygrainQ.getState());
                await mygrainSongBeta.arm();
                const part = mygrainSongBeta.song.parts[0];
                const wav = await mygrainSongBeta.readRender(part), buffer = await audioContext.decodeAudioData(wav.slice(0));
                const pcm = buffer.getChannelData(0);
                return { saved, recalled, qVersion: part.qVersion, renderedVersion: part.render.qVersion, armed: mygrainSongBeta.armed, power: pcm.reduce((s,x) => s+x*x,0)/pcm.length };
            });
            assert.deepEqual(song.recalled, song.saved); assert.equal(song.qVersion,8); assert.equal(song.renderedVersion,8); assert(song.armed && song.power > 1e-8);
            assert.deepEqual(errors, []);
            results.push({ engine, mobile, firstStart: first, edited, layouts, audio, song: { qVersion: song.qVersion, renderedVersion: song.renderedVersion, power: song.power, exactRecall: true } });
            console.log(`${engine} ${mobile ? 'phone' : 'desktop'}: first start, edited copy/paste, hold, reload and Song freeze passed.`);
            await context.close();
        } } finally { await browser.close(); }
    }
    fs.writeFileSync(`${evidence}/results.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
