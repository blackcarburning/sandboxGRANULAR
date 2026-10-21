// Local-only: real authenticated backend, original files, generated WAV and native phone taps.
const { chromium, webkit } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18840/mygrain/';
const root = process.env.MYGRAIN_TEST_ROOT || '/tmp/mygrain-v-recut-store';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
assert.ok(path.resolve(root).startsWith(os.tmpdir() + '/mygrain-'));
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
function wave(decoy = false) {
    const rate = 44100, frames = rate * 4, out = Buffer.alloc(44 + frames * 4);
    out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8);
    out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
    out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 4, 28); out.writeUInt16LE(4, 32);
    out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(frames * 4, 40);
    for (let i = 0; i < frames; i++) for (let c = 0; c < 2; c++) {
        const hz = decoy ? 1700 : [110, 220, 440, 880][Math.floor(i / rate)] + c * 37;
        out.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * hz * i / rate)), 44 + i * 4 + c * 2);
    }
    return out;
}
async function fingerprint(page) {
    return page.evaluate(() => {
        const b = bastardLoopVBuffer; let hash = 2166136261, sum = 0;
        for (let c = 0; c < b.numberOfChannels; c++) {
            const data = b.getChannelData(c);
            for (const v of data) sum += v * v;
            for (const byte of new Uint8Array(data.buffer, data.byteOffset, data.byteLength)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
        }
        return { hash, frames: b.length, channels: b.numberOfChannels, rate: b.sampleRate,
            rms: Math.sqrt(sum / (b.length * b.numberOfChannels)), cut: JSON.parse(JSON.stringify(bastardLoopVCut)),
            source: bastardLoopVMetadata.sourceKey, refs: getBastardLoopSampleRefs('V'), bpm: bastardLoopVSourceBpm,
            summary: bastardLoopVMetadata.summary };
    });
}
(async () => {
    for (const [name, engine] of Object.entries({ chromium, webkit })) {
        if (process.env.MYGRAIN_RECUT_ENGINE && process.env.MYGRAIN_RECUT_ENGINE !== name) continue;
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mygrain-recut-' + name + '-'));
        const errors = []; let context, page;
        async function launch() {
            context = await engine.launchPersistentContext(profile, { ...(name === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {}), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
            page = context.pages()[0]; page.setDefaultTimeout(40000); page.on('pageerror', e => errors.push(e.message));
            if (process.env.MYGRAIN_RECUT_BASELINE) await page.route(/\/mygrain\/\?/, route => route.fulfill({ contentType: 'text/html', body: fs.readFileSync(process.env.MYGRAIN_RECUT_BASELINE, 'utf8') }));
        }
        async function open() {
            await page.goto(base + '?recut-test=1');
            await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
            await page.evaluate(() => mygrainCardHistory.ready);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        }
        async function travel(direction) {
            await page.locator(direction === 'undo' ? '#sectionJumpUndoBtn' : '#sectionJumpRedoBtn').tap();
            await page.waitForFunction(() => !mygrainCardHistory.busy);
            assert.equal(await page.evaluate(() => mygrainCardHistory.warning), '');
        }
        try {
            await launch();
            const username = 'recut_' + name[0] + '_' + Date.now();
            const registered = await context.request.post(base + 'api/auth/register', { data: { username, password: 'isolated-recut-test' } });
            assert.equal(registered.status(), 200);
            const id = execFileSync('python3', ['-c', 'import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("select id from users where username=?",(sys.argv[2],)).fetchone()[0])', path.join(root, 'auth/accounts.sqlite3'), username], { encoding: 'utf8' }).trim();
            assert.match(id, /^[a-f0-9]{32}$/);
            const privateRoot = path.join(root, 'users', id), original = wave(), originalHash = sha(original);
            for (const folder of ['SAMPLES_RADIOLAB', 'SAMPLES_VIDEOLAB']) {
                fs.mkdirSync(path.join(privateRoot, 'source_mirrors', folder), { recursive: true });
                fs.writeFileSync(path.join(privateRoot, 'source_mirrors', folder, 'original.wav'), original);
                fs.writeFileSync(path.join(privateRoot, 'source_mirrors', folder, 'decoy.wav'), wave(true));
            }
            await open();
            await page.evaluate(() => { stopAllPerformancePlayback({ silent: true }); applyGlobalBpm(120); syncPatternLengthControls(16, { skipSave: true }); });
            for (const source of ['samples_radiolab', 'samples_videolab']) {
                const video = source === 'samples_videolab';
                await page.setViewportSize(video ? { width: 844, height: 390 } : { width: 390, height: 844 });
                await page.evaluate(async ({ source, video }) => {
                    stopAllPerformancePlayback({ silent: true });
                    const response = await fetch(buildDropboxSampleSourcePreviewUrl(source, 'original.wav'));
                    if (!response.ok) throw new Error('Fixture load ' + response.status);
                    await (video ? mygrainVideolabAdapter : mygrainRadiolabAdapter).load(await response.arrayBuffer(), { name: 'Original', filename: 'original.wav' }, 'V', () => {});
                    setBastardLoopVCut({ enabled: true, start: .2, end: .8, stretch: true }, { skipSave: true });
                    applyBastardLoopVDivisionSelection(['uncut'], { save: false });
                    saveState({ force: true });
                }, { source, video });
                if (!process.env.MYGRAIN_RECUT_BASELINE) assert.equal(await page.locator('#performanceBastardLoopVRecutBtn').textContent(), 'Re-cut Loaded Sample');
                const before = await fingerprint(page), initialCounts = await page.evaluate(() => mygrainCardHistory.counts);
                const buildResponse = page.waitForResponse(r => r.url().includes('/api/bastardloop') && r.request().method() === 'POST');
                await page.locator('#performanceBastardLoopVRecutBtn').tap();
                const response = await buildResponse, request = response.request().postDataJSON();
                if (process.env.MYGRAIN_RECUT_BASELINE) {
                    assert.equal(request.source, 'samples_vocal'); assert.equal(response.status(), 400);
                    console.log('BASELINE reproduced: single RadioLab re-cut requests wrong vocal library; HTTP', response.status());
                    return;
                }
                assert.equal(response.status(), 201);
                assert.equal(request.source, source); assert.deepEqual(request.sourceFiles, ['original.wav']);
                assert.deepEqual(request.divisions, ['1/16']);
                await page.waitForFunction(() => !bastardLoopVGenerationInFlight && !mygrainCardHistory.busy);
                const after = await fingerprint(page), meta = await page.evaluate(() => ({ ...bastardLoopVMetadata }));
                assert.equal(after.source, source); assert.deepEqual([...new Set(after.refs)], ['original.wav']);
                assert.ok(after.rms > .02); assert.notEqual(after.hash, before.hash); assert.ok(Math.abs(after.frames / after.rate - 2) < .005);
                assert.equal(after.cut.enabled, false); assert.equal(after.cut.start, 0); assert.equal(after.cut.end, 1);
                assert.match(after.summary, /16 cuts/); assert.equal(after.channels, 2);
                assert.deepEqual(await page.evaluate(() => mygrainCardHistory.counts), { undo: initialCounts.undo + 1, redo: 0 });
                assert.equal(await page.evaluate(() => bastardLoopPlaying || sequencerPlaying), false);
                assert.equal(sha(fs.readFileSync(path.join(privateRoot, 'source_mirrors', source.toUpperCase(), 'original.wav'))), originalHash);
                const saved = await context.request.get(new URL('/mygrain-bastardloops/' + encodeURIComponent(meta.savedName), base).href, { headers: { 'X-Mygrain-User': username } });
                assert.equal(saved.status(), 200); assert.equal(sha(await saved.body()), sha(await response.body()));
                assert.notEqual(meta.savedName, 'original.wav');
                await travel('undo'); assert.deepEqual(await fingerprint(page), before);
                await travel('redo'); assert.deepEqual(await fingerprint(page), after);
                console.log('PASS', name, source, 'one source → 16 shuffled chops; separate saved WAV; untouched original; exact stereo Undo/Redo; stopped stays stopped');
                await page.evaluate(() => { startAllBastardLoopLayers(null, { skipUi: true }); });
                const nextResponse = page.waitForResponse(r => r.url().includes('/api/bastardloop') && r.request().method() === 'POST');
                await page.locator('#performanceBastardLoopVRecutBtn').tap(); const next = await nextResponse;
                assert.equal(next.status(), 201); assert.deepEqual(next.request().postDataJSON().sourceFiles, ['original.wav']);
                assert.notEqual(sha(await next.body()), sha(await response.body()), 'repeat produces a fresh shuffled loop');
                const library = path.join(privateRoot, 'source_mirrors', source.toUpperCase());
                assert.deepEqual(fs.readdirSync(library).sort(), ['decoy.wav', 'original.wav']);
                assert.equal(sha(fs.readFileSync(path.join(library, 'original.wav'))), originalHash);
                await page.waitForFunction(() => !mygrainCardHistory.busy && Boolean(bastardLoopVSource));
                assert.equal(await page.evaluate(() => bastardLoopPlaying), true);
                // Buffered transport may intentionally schedule beyond the next 320 ms.
                await page.waitForFunction(() => audioContext.currentTime >= transportSync.startTime + .05);
                const audible = await page.evaluate(async () => {
                    const analyser = audioContext.createAnalyser(); analyser.fftSize = 2048; bastardLoopVGainNode.connect(analyser);
                    let peak = 0; const data = new Float32Array(2048);
                    for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 40)); analyser.getFloatTimeDomainData(data); for (const v of data) peak = Math.max(peak, Math.abs(v)); }
                    bastardLoopVGainNode.disconnect(analyser); analyser.disconnect(); return peak;
                });
                const audioState = await page.evaluate(() => ({ state: audioContext.state, time: audioContext.currentTime,
                    playing: bastardLoopPlaying, enabled: bastardLoopVEnabled, level: bastardLoopVLevel,
                    gain: bastardLoopVGainNode?.gain.value, source: !!bastardLoopVSource, cut: bastardLoopVCut, transport: transportSync }));
                assert.ok(audible > .001, 'real live V audio ' + audible + ' ' + JSON.stringify(audioState));
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
                if (process.env.MYGRAIN_RECUT_EVIDENCE) {
                    await page.locator('#performanceBastardLoopVRecutBtn').scrollIntoViewIfNeeded();
                    await page.screenshot({ path: path.join(process.env.MYGRAIN_RECUT_EVIDENCE, `${name}-${video ? 'landscape' : 'portrait'}.png`) });
                }
                await page.evaluate(() => stopAllPerformancePlayback({ silent: true }));
                console.log('PASS', name, source, 'repeated re-cut still uses original; playing transport restarts with audible new audio; phone layout');
            }
            // Cold browser process: exact PCM survives, and future re-cuts still find the original source.
            await page.evaluate(() => mygrainCardHistory.flush());
            const persisted = await fingerprint(page), counts = await page.evaluate(() => mygrainCardHistory.counts);
            await context.close(); await launch(); await open();
            assert.deepEqual(await page.evaluate(() => mygrainCardHistory.counts), counts);
            await travel('undo'); await travel('redo'); assert.deepEqual(await fingerprint(page), persisted);
            const unchanged = await fingerprint(page), oldCounts = await page.evaluate(() => mygrainCardHistory.counts);
            // Missing original must not fall back to the decoy / any public library.
            fs.renameSync(path.join(privateRoot, 'source_mirrors/SAMPLES_VIDEOLAB/original.wav'), path.join(privateRoot, 'source_mirrors/SAMPLES_VIDEOLAB/original.missing'));
            const failed = page.waitForResponse(r => r.url().includes('/api/bastardloop') && r.request().method() === 'POST');
            await page.locator('#performanceBastardLoopVRecutBtn').tap(); assert.equal((await failed).status(), 400);
            await page.waitForFunction(() => !mygrainCardHistory.busy && !bastardLoopVGenerationInFlight);
            assert.deepEqual(await fingerprint(page), unchanged); assert.deepEqual(await page.evaluate(() => mygrainCardHistory.counts), oldCounts);
            fs.renameSync(path.join(privateRoot, 'source_mirrors/SAMPLES_VIDEOLAB/original.missing'), path.join(privateRoot, 'source_mirrors/SAMPLES_VIDEOLAB/original.wav'));
            console.log('PASS', name, 'cold restart exact history + provenance; missing original fails without replacement or history consumption');
            assert.deepEqual(errors, []);
        } finally { await context?.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
