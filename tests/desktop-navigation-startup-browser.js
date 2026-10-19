const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const evidence = process.env.NAV_STARTUP_EVIDENCE || '/tmp/mygrain-desktop-navigation';
fs.mkdirSync(evidence, { recursive: true });
const original = fs.readFileSync(process.env.NAV_STARTUP_HTML || path.join(root, 'index.html'), 'utf8');
// Exercise an early refresh at the real binding boundary. Both direct and
// lifecycle-driven refreshes must be harmless until all controls are bound.
const html = original.replace("        const performanceOscVolume = document.getElementById('performanceOscVolume');", `
        try {
            syncPerformanceControlState();
            syncPerformanceSoundControls();
            window.__earlyRefresh = { ok: true };
        } catch (error) { window.__earlyRefresh = { ok: false, message: error.message, stack: error.stack }; }
        window.__earlyAudioLifecycle = [];
        for (const state of ['running', 'suspended', 'interrupted']) {
            const previousContext = audioContext;
            try {
                audioContext = { state, sampleRate: 48000, currentTime: 0 };
                bindAudioContextLifecycle(audioContext);
                updatePerformanceVuMeter(0);
                syncPerformanceMixerVuVisibility();
                window.__earlyAudioLifecycle.push({ state, ok: true });
            } catch (error) {
                window.__earlyAudioLifecycle.push({ state, ok: false, message: error.message, stack: error.stack });
            } finally { audioContext = previousContext; }
        }
        const performanceOscVolume = document.getElementById('performanceOscVolume');`);
assert.notEqual(html, original);
const identity = { ok: true, user: { username: 'admin' } };
const api = { ...identity, stations: [], samples: [], files: [], songs: [], folders: [], sources: [], favourites: [], patches: [] };
const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://local');
    if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405).end();
    if (url.pathname.endsWith('/account-context.js')) {
        response.setHeader('Content-Type', 'text/javascript');
        return response.end('window.mygrainAccountContext=' + JSON.stringify(identity));
    }
    if (url.pathname.includes('/api/')) {
        response.setHeader('Content-Type', 'application/json');
        return response.end(JSON.stringify(api));
    }
    const filename = path.resolve(root, url.pathname.replace(/^\/mygrain\//, '') || 'index.html');
    if (!filename.startsWith(root + path.sep)) return response.writeHead(403).end();
    try {
        const body = filename.endsWith('/index.html') ? html : fs.readFileSync(filename);
        response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wav': 'audio/wav' })[path.extname(filename)] || 'application/octet-stream');
        response.end(body);
    } catch { response.writeHead(404).end(); }
});

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = process.env.NAV_STARTUP_LIVE || `http://127.0.0.1:${server.address().port}/mygrain/`;
    const results = [];
    try {
        for (const [engine, type] of Object.entries({ webkit, chromium })) {
            if (process.env.NAV_ENGINES && !process.env.NAV_ENGINES.split(',').includes(engine)) continue;
            const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : { headless: true });
            try {
                for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }, { width: 1920, height: 1080 }, { width: 1024, height: 600 }]) {
                    if (process.env.NAV_WIDTHS && !process.env.NAV_WIDTHS.split(',').includes(String(viewport.width))) continue;
                    const desktop = viewport.width > 960;
                    const context = await browser.newContext({ viewport, isMobile: !desktop, hasTouch: !desktop });
                    const page = await context.newPage();
                    page.setDefaultTimeout(20000);
                    const errors = [], writes = [], navigations = [];
                    page.on('pageerror', error => errors.push(error.message));
                    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
                    await page.route('**/*', route => {
                        const request = route.request();
                        const url = new URL(request.url());
                        if (url.origin !== new URL(base).origin) return route.abort();
                        if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.method() + ' ' + url.pathname); return route.abort(); }
                        if (url.pathname.endsWith('/account-context.js')) return route.fulfill({ contentType: 'text/javascript', body: 'window.mygrainAccountContext=' + JSON.stringify(identity) });
                        if (url.pathname.includes('/api/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(api) });
                        return route.continue();
                    });
                    await page.goto(base, { waitUntil: 'load' });
                    await page.waitForFunction(() => window.mygrainQ && window.mygrainSongBeta);
                    const early = await page.evaluate(() => window.__earlyRefresh);
                    const earlyAudio = await page.evaluate(() => window.__earlyAudioLifecycle);
                    if (process.env.NAV_STARTUP_BASELINE) {
                        console.log(JSON.stringify({ engine, viewport, early, earlyAudio, errors }));
                        await context.close();
                        break;
                    }
                    if (!process.env.NAV_STARTUP_LIVE) {
                        assert.deepEqual(early, { ok: true });
                        assert.deepEqual(earlyAudio, ['running', 'suspended', 'interrupted'].map(state => ({ state, ok: true })));
                    }
                    await page.locator('#start-btn').click();
                    await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                    assert.equal(await page.evaluate(() => performanceControlsReady), true);
                    assert.equal(await page.locator('#performanceOscVolume').inputValue(), '100');
                    await page.evaluate(() => {
                        const control = document.getElementById('performanceOscVolume');
                        control.value = '37';
                        control.dispatchEvent(new Event('input', { bubbles: true }));
                        syncPerformanceControlState();
                    });
                    assert.equal(await page.locator('#performanceOscVolume').inputValue(), '37');
                    assert.equal(await page.locator('#performanceOscVolumeValue').textContent(), '37%');
                    if (viewport.width === 1280) {
                        await page.evaluate(() => {
                            const controller = window.mygrainSongBeta;
                            window.__feedbackSong = controller.song;
                            controller.song = { parts: [{ id: 'feedback-part', name: 'Synthetic part' }] };
                            controller.startArmFeedback(controller.generation, controller.song.parts);
                            controller.armStage(controller.generation, 'Rendering exact beat playback', controller.song.parts[0]);
                        });
                        await page.waitForFunction(() => document.querySelector('.song-beta-arm-feedback p:last-child').textContent.includes('0:01 elapsed'));
                        assert.match(await page.locator('.song-beta-arm-feedback').textContent(), /Rendering exact beat playback/);
                        assert.equal(await page.locator('#songBetaArm').getAttribute('aria-busy'), 'true');
                        await page.evaluate(() => {
                            const controller = window.mygrainSongBeta;
                            controller.finishArmFeedback(controller.generation, 'failure', 'Synthetic failure clearly reported');
                            if (controller.armFeedback.timer !== null) throw new Error('Feedback timer did not stop');
                            controller.song = window.__feedbackSong;
                        });
                        assert.equal(await page.locator('.song-beta-arm-feedback').getAttribute('data-state'), 'failure');
                        assert.equal(await page.locator('#songBetaArm').getAttribute('aria-busy'), 'false');
                        assert.match(await page.locator('.song-beta-arm-feedback').textContent(), /Synthetic failure clearly reported/);
                        await page.evaluate(() => {
                            const controller = window.mygrainSongBeta;
                            controller.armFeedbackView.panel.remove();
                            controller.armFeedbackView = null;
                            controller.armFeedback = null;
                        });
                    }
                    if (desktop) {
                        const bounds = await page.evaluate(() => {
                            const drawer = document.getElementById('sectionJumpDrawer').getBoundingClientRect();
                            const content = document.querySelector('.synth-container').getBoundingClientRect();
                            return { drawer: drawer.toJSON(), content: content.toJSON(), scrollWidth: document.documentElement.scrollWidth, width: innerWidth };
                        });
                        assert.ok(bounds.drawer.x >= bounds.content.right, JSON.stringify(bounds));
                        assert.ok(bounds.drawer.right <= viewport.width && bounds.drawer.bottom <= viewport.height);
                        assert.ok(bounds.scrollWidth <= viewport.width + 1);
                        for (const name of ['Song', 'MegaRandom', 'SparseRandom', 'Keyboard', 'LayerSwitch', 'BastardMixer', 'Actions', 'Transport']) {
                            const button = page.locator('#sectionJump' + name + 'Btn');
                            assert.equal(await button.isVisible(), true, name);
                            assert.ok((await button.boundingBox()).height >= 40);
                            assert.equal(await button.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true, name + ' hit target');
                        }
                        await page.locator('#sectionJumpHandle').click();
                        assert.equal(await page.locator('#desktopNavSearch').evaluate(el => el === document.activeElement), true);
                        await page.locator('#desktopNavSearch').fill('radio');
                        assert.equal(await page.locator('#sectionJumpPanel .section-jump-option:visible').count(), 1);
                        await page.locator('#desktopNavSearch').press('Enter');
                        await page.waitForTimeout(900);
                        assert.equal(await page.locator('#radiolabCard').evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= -5 && r.top < innerHeight; }), true);
                        assert.equal(await page.locator('#sectionJumpHandle').getAttribute('aria-expanded'), 'true');
                        await page.locator('#desktopNavSearch').fill('zzzz-no-match');
                        assert.equal(await page.locator('.desktop-nav-empty').isVisible(), true);
                        await page.locator('#desktopNavSearch').press('Escape');
                        assert.ok(await page.locator('#sectionJumpPanel .section-jump-option:visible').count() > 30);
                        for (const id of ['sectionJumpKeyboardBtn', 'sectionJumpLayerSwitchBtn', 'sectionJumpBastardMixerBtn', 'sectionJumpActionsBtn', 'sectionJumpSongBtn']) {
                            await page.locator('#' + id).click();
                            const target = await page.locator('#' + id).getAttribute('data-jump-target');
                            try {
                                await page.waitForFunction(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return r.top >= -5 && r.top < innerHeight; }, target, { timeout: 5000 });
                            } catch (error) {
                                await page.screenshot({ path: path.join(evidence, `${engine}-${viewport.width}-failure.png`) });
                                throw new Error(id + ' scroll destination: ' + JSON.stringify(await page.locator(target).evaluate(el => el.getBoundingClientRect().toJSON())));
                            }
                        }
                        // Verify shared transport state without creating server audio.
                        await page.evaluate(() => {
                            window.__dockCalls = [];
                            restartAllTransport = () => { window.__dockCalls.push('start'); sequencerPlaying = true; syncPerformanceControlState(); };
                            stopAllPerformancePlayback = () => { window.__dockCalls.push('stop'); sequencerPlaying = false; syncPerformanceControlState(); };
                        });
                        await page.locator('#sectionJumpTransportBtn').click();
                        assert.equal(await page.locator('#sectionJumpTransportBtn').textContent(), 'Stop');
                        await page.locator('#sectionJumpTransportBtn').click();
                        assert.equal(await page.locator('#sectionJumpTransportBtn').textContent(), 'Start');
                        assert.deepEqual(await page.evaluate(() => window.__dockCalls), ['start', 'stop']);
                        await page.screenshot({ path: path.join(evidence, `${engine}-${viewport.width}.png`) });
                        // A filtered desktop panel must become the full phone drawer.
                        await page.locator('#desktopNavSearch').fill('radio');
                        await page.setViewportSize({ width: 390, height: 844 });
                        await page.waitForTimeout(100);
                        assert.equal(await page.locator('.desktop-nav-tools').isVisible(), false);
                        assert.equal(await page.locator('#sectionJumpPanel .section-jump-option[hidden]').count(), 0);
                    } else {
                        assert.equal(await page.locator('.desktop-nav-tools').isVisible(), false);
                        const geometry = await page.locator('#sectionJumpSongBtn').evaluate(el => ({ width: el.getBoundingClientRect().width, writingMode: getComputedStyle(el).writingMode }));
                        assert.equal(geometry.width, 34);
                        assert.equal(geometry.writingMode, 'vertical-rl');
                        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
                    }
                    assert.deepEqual(errors, []);
                    assert.deepEqual(writes, []);
                    // replaceState may emit a same-document navigation event; it
                    // must not produce a second document or reset page startup.
                    assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation').length), 1);
                    results.push({ engine, viewport, startup: true, desktop, errors, writes });
                    console.log('PASS', engine, viewport.width, viewport.height);
                    await context.close();
                }
            } finally { await browser.close(); }
        }
        fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
    } finally { server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
