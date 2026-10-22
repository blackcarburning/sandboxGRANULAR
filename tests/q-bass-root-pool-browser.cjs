// Isolated accounts and stores only; no writes to production user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.SONG_BETA_TEST_URL || 'http://127.0.0.1:18891/mygrain/';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost song test server.');
const evidence = process.env.Q_BASS_EVIDENCE || '/tmp/mygrain-q-bass-pool';
fs.mkdirSync(evidence, { recursive: true });
(async () => {
    const results = [];
    for (const engine of ['chromium', 'webkit']) {
        const browser = await ({ chromium, webkit }[engine]).launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try { for (const mobile of [false, true]) {
            const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile });
            const response = await context.request.post(base + 'api/auth/register', { data: { username: `bp_${engine[0]}_${+mobile}_${Date.now()}`, password: 'isolated-bass-pool-test' } });
            assert.equal(response.status(), 200);
            const page = await context.newPage(), errors = [];
            page.on('pageerror', error => errors.push(error.message));
            page.setDefaultTimeout(30000);
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
            const load = async () => {
                await page.goto(base);
                await page.waitForFunction(() => window.mygrainQ && window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
                await page.locator('#start-btn').click();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
                await page.locator('#performanceBastardLoopQEditBtn').click();
            };
            const tap = async selector => mobile ? page.locator(selector).tap() : page.locator(selector).click();
            await load();
            await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true });
                syncPatternLengthControls(16, { skipSave: true });
                mygrainQ.restore(MygrainQTheory.defaults());
                mygrainQ.state.sequence[7] = MygrainQTheory.normalizeStep({ root: 48, notes: [48, 52, 55] });
                bastardLoopXSequence = Array.from({ length: 64 }, createEmptyBastardLoopXStep);
                mygrainQ.sync();
            });
            const original = await page.evaluate(() => JSON.stringify(mygrainQ.state));
            await tap('#bastardLoopQPoolFromBassBtn');
            assert.match(await page.locator('#bastardLoopQStatus').textContent(), /no playable notes/);
            assert.equal(await page.evaluate(() => JSON.stringify(mygrainQ.state)), original);
            await page.evaluate(() => {
                for (const [index, note] of [[0, 'G1'], [2, 'C#2'], [4, 'G2'], [15, 'E2'], [40, 'B1']]) bastardLoopXSequence[index].note = note;
                bastardLoopXSequence[6] = { ...createEmptyBastardLoopXStep(), note: 'A2', rest: true };
                saveState();
                window.bassPoolBefore = JSON.stringify({ x: bastardLoopXSequence, q: mygrainQ.state.sequence });
            });
            const beforeUndo = await page.evaluate(() => mygrainCardHistory.counts.undo);
            await tap('#bastardLoopQPoolFromBassBtn');
            assert.deepEqual(await page.evaluate(() => mygrainQ.state.paletteBassRoots), [7, 1, 4]);
            assert.deepEqual(await page.evaluate(() => [...new Set(mygrainQ.paletteChords.map(c => c.root % 12))]), [7, 1, 4]);
            assert.equal(await page.evaluate(() => JSON.stringify({ x: bastardLoopXSequence, q: mygrainQ.state.sequence }) === bassPoolBefore), true);
            assert.equal(await page.evaluate(() => mygrainCardHistory.counts.undo), beforeUndo + 1);
            await page.evaluate(() => mygrainCardHistory.undo());
            assert.equal(await page.evaluate(() => mygrainQ.state.paletteBassRoots), null);
            await page.evaluate(() => mygrainCardHistory.redo());
            assert.deepEqual(await page.evaluate(() => mygrainQ.state.paletteBassRoots), [7, 1, 4]);
            await page.evaluate(() => mygrainCardHistory.flush());
            await load();
            assert.deepEqual(await page.evaluate(() => mygrainQ.state.paletteBassRoots), [7, 1, 4]);
            await tap('#bastardLoopQTonalSettings summary');
            await page.selectOption('#bastardLoopQFamilies', 'sevenths');
            assert.equal(await page.evaluate(() => mygrainQ.paletteChords.every(c => MygrainQTheory.qualities[c.type].length === 4)), true);
            await page.selectOption('#bastardLoopQFamilies', 'all');
            await tap('#bastardLoopQTonalSettings summary');
            await tap('#bastardLoopQPalette [data-root="1"][data-type="major"]');
            await page.waitForFunction(() => mygrainQ.voices.size > 0);
            assert.equal(await page.evaluate(() => mygrainQ.state.sequence.filter(Boolean).length), 1, 'practice does not write chords');
            await tap('#bastardLoopQRecordBtn');
            await tap('#bastardLoopQPalette [data-root="1"][data-type="major"]');
            assert.deepEqual(await page.evaluate(() => mygrainQ.state.sequence[0].notes), [49, 53, 56]);
            await page.evaluate(() => mygrainQ.stop());
            const layouts = [];
            for (const viewport of mobile ? [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 640 }] : [{ width: 1280, height: 900 }]) {
                await page.setViewportSize(viewport);
                const layout = await page.evaluate(() => {
                    const controls = document.querySelector('.q-pool-controls'), rect = controls.getBoundingClientRect();
                    const grid = document.querySelector('.q-grid-scroll').getBoundingClientRect();
                    return { width: innerWidth, inside: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && grid.bottom <= innerHeight, overflow: controls.scrollWidth > controls.clientWidth };
                });
                assert(layout.inside && !layout.overflow, JSON.stringify(layout));
                layouts.push(layout);
            }
            await page.screenshot({ path: `${evidence}/${engine}-${mobile ? 'phone' : 'desktop'}.png` });
            await page.evaluate(() => { bastardLoopXSequence[0].note = 'F#2'; });
            await tap('#bastardLoopQPoolFromBassBtn');
            assert.deepEqual(await page.evaluate(() => mygrainQ.state.paletteBassRoots), [6, 1, 7, 4]);
            await tap('#bastardLoopQPoolFromScaleBtn');
            assert.equal(await page.evaluate(() => mygrainQ.state.paletteBassRoots), null);
            assert.equal(await page.evaluate(() => mygrainQ.paletteChords.every(c => c.notes.every(p => [0, 2, 4, 5, 7, 9, 11].includes(p % 12)))), true);
            await page.evaluate(() => { syncPatternLengthControls(64, { skipSave: true }); bastardLoopXSequence[63].note = 'D#2'; });
            await tap('#bastardLoopQPoolFromBassBtn');
            assert.deepEqual(await page.evaluate(() => mygrainQ.state.paletteBassRoots), [6, 1, 7, 4, 11, 3]);
            assert.deepEqual(errors, []);
            results.push({ engine, mobile, layouts, roots: [7, 1, 4], chromatic: true, emptyNoOp: true, history: true, reload: true, audio: true, recording: true, refresh: true, lastStep64: true });
            console.log('PASS', engine, mobile ? 'phone' : 'desktop', 'empty/repeated/rest/hidden/chromatic roots, practice audio, Step recording, Undo/Redo, reload, refresh, Scale Pool and responsive layout');
            await context.close();
        } } finally { await browser.close(); }
    }
    fs.writeFileSync(evidence + '/results.json', JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
