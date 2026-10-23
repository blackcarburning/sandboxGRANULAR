// Real audio/teardown stress, disposable localhost account and storage only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.SONG_BETA_TEST_URL;
assert.match(base || '', /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
            assert.equal((await context.request.post(base + 'api/auth/register', { data: { username: `armmemory_${engine[0]}_${Date.now()}`, password: 'isolated-memory-stress' } })).status(), 200);
            const page = await context.newPage(), errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
            await page.goto(base);
            await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy && document.documentElement.dataset.mygrainStartup === 'ready');
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            const result = await page.evaluate(async () => {
                const c = mygrainSongBeta;
                stopAllPerformancePlayback({ silent: true });
                setOscillatorsEnabled(false, { silent: true, skipSave: true });
                setGranularLayersEnabled(false, { silent: true, skipSave: true });
                setArpeggiatorEnabled(false); mygrainQ.setEnabled(false);
                setGeneratedLoopTransportEnabled(false, { silent: true, skipSave: true });
                seqGrainsEnabled = false; document.getElementById('seqGrainsEnabled').checked = false;
                applyGlobalBpm(120); syncPatternLengthControls(64, { skipSave: true });
                for (const [i, kind] of ['kick', 'snare', 'hat', 'perc', 'clap', 'cymbals', 'etc'].entries()) {
                    const sample = audioContext.createBuffer(1, audioContext.sampleRate / 8, audioContext.sampleRate);
                    for (let frame = 0; frame < sample.length; frame++) sample.getChannelData(0)[frame] = .02 * Math.sin(2 * Math.PI * (100 + 70 * i) * frame / sample.sampleRate);
                    await applyLoadedDrumMachineSampleBuffer(kind, sample, { fileName: `${kind}-stress.wav`, sourceKey: DRUM_MACHINE_SOURCE_KEYS[kind] });
                    setDrumMachinePattern(kind, Array(64).fill(true), { skipSave: true });
                }
                setDrumMachineDirectOutput(true, { silent: true, skipSave: true });
                setDrumMachineEnabled(true, { silent: true, skipSave: true });
                document.getElementById('songBetaName').value = 'Memory stress'; await c.newSong();
                await c.newPart({ name: 'Dense 8 second drums', repeats: 1 });
                const listeners = new Set(), nativeAdd = audioContext.addEventListener.bind(audioContext), nativeRemove = audioContext.removeEventListener.bind(audioContext);
                audioContext.addEventListener = (type, fn, options) => { listeners.add(fn); return nativeAdd(type, fn, options); };
                audioContext.removeEventListener = (type, fn, options) => { listeners.delete(fn); return nativeRemove(type, fn, options); };
                const memory = [], nodes = [];
                const monitor = setInterval(() => {
                    memory.push({ reserved: c.memoryBudget.bytes, hot: c.renderBytes });
                    for (const bridge of __mygrainSongRenderBridges.values()) nodes.push(bridge.nodes.size);
                }, 50);
                let abortName;
                const pending = c.arm();
                for (let i = 0; i < 1000 && !__mygrainSongRenderBridges.size; i++) await new Promise(resolve => setTimeout(resolve, 10));
                if (!__mygrainSongRenderBridges.size) throw new Error('No renderer reached for cancellation');
                await new Promise(resolve => setTimeout(resolve, 350));
                c.cancel(true, { hardCut: true });
                try { await pending; } catch (error) { abortName = error.name; }
                const afterCancel = { bridges: __mygrainSongRenderBridges.size, listeners: listeners.size, memory: c.memoryBudget.bytes, download: c.downloadBudget.bytes };
                await c.arm();
                const buffer = await c.loadRender(c.song.parts[0]);
                let peak = 0; for (const value of buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(value));
                const actualSong = c.song, beforeRevision = c.song.revision;
                // Deliberately unsafe dimensions must fail before any original
                // GET/decode; never mutate the saved part to create the fixture.
                c.renderSources.clear(); c.renders.clear(); c.renderBytes = 0;
                c.song = { ...actualSong, parts: [{ ...actualSong.parts[0], bytes: 100 * 1048576, render: null }] };
                let originalReads = 0, unsafeMessage;
                const read = c.readPart.bind(c); c.readPart = async (...args) => { originalReads++; return read(...args); };
                try { await c.arm(); } catch (error) { unsafeMessage = error.message; }
                const afterReject = { originalReads, revision: c.song.revision, memory: c.memoryBudget.bytes, download: c.downloadBudget.bytes, bridges: __mygrainSongRenderBridges.size, listeners: listeners.size };
                c.readPart = read; c.acceptSong(actualSong);
                await c.arm(); await c.playSong(); const playing = c.playing;
                c.cancel(true, { hardCut: true }); clearInterval(monitor);
                return { abortName, afterCancel, afterReject, unsafeMessage, beforeRevision, peak, duration: buffer.duration,
                    playing, armed: c.armed, peakNodes: Math.max(...nodes), samples: nodes.length,
                    budget: c.memoryBudget.limitBytes, peakManaged: Math.max(...memory.map(x => x.reserved + x.hot)),
                    bridges: __mygrainSongRenderBridges.size, frames: document.querySelectorAll('iframe[title="Isolated song audio renderer"]').length,
                    memory: c.memoryBudget.bytes, download: c.downloadBudget.bytes, listeners: listeners.size };
            });
            assert.equal(result.abortName, 'AbortError');
            assert.deepEqual(result.afterCancel, { bridges: 0, listeners: 0, memory: 0, download: 0 });
            assert.equal(result.afterReject.originalReads, 0);
            assert.equal(result.afterReject.revision, result.beforeRevision);
            for (const key of ['memory', 'download', 'bridges', 'listeners']) assert.equal(result.afterReject[key], 0);
            assert.match(result.unsafeMessage, /safety budget/);
            assert.ok(result.peak > .001); assert.ok(Math.abs(result.duration - 8) < .001);
            assert.ok(result.samples > 10); assert.ok(result.peakNodes < 1500, JSON.stringify(result));
            assert.ok(result.peakManaged <= result.budget, JSON.stringify(result));
            assert.equal(result.playing, true); assert.equal(result.armed, true);
            for (const key of ['bridges', 'frames', 'memory', 'download', 'listeners']) assert.equal(result[key], 0);
            assert.deepEqual(errors, []);
            results.push({ engine, ...result }); console.log('PASS', engine, JSON.stringify(result));
            await context.close();
        } finally { await browser.close(); }
    }
    fs.writeFileSync('/tmp/mygrain-batch-arm-memory-results.json', JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
