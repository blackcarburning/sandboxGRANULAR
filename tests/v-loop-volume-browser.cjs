// Disposable localhost account; real linked controls, live gain and legacy state recall.
const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18893/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
(async () => {
    for (const [name, engine] of Object.entries({chromium, webkit})) {
        const browser = await engine.launch(name === 'chromium' ? {executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']} : {});
        try {
            const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
            assert.equal((await context.request.post(base + 'api/auth/register', {data: {username: 'vvolume_' + name + Date.now(), password: 'isolated-v-volume'}})).status(), 200);
            const page = await context.newPage(), errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
            async function start() {
                await page.goto(base);
                await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
                await page.locator('#start-btn').tap();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            }
            async function set(id, value) {
                await page.locator('#' + id).evaluate((e, v) => {e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true}));}, String(value));
            }
            async function check(value) {
                await page.waitForFunction(v => ['performanceBastardLoopVCardLevel', 'performanceBastardLoopVLevel'].every(id => document.getElementById(id).value === String(v)) && ['performanceBastardLoopVCardLevelValue', 'performanceBastardLoopVLevelValue'].every(id => document.getElementById(id).textContent === `${v}%`), value);
            }
            await start(); await check(50);
            await set('performanceBastardLoopVCardLevel', 23); await check(23);
            await set('performanceBastardLoopVLevel', 71); await check(71);
            // Native touch on the real card slider at phone and desktop-sized layouts.
            for (const viewport of [{width: 390, height: 844}, {width: 844, height: 390}, {width: 1280, height: 900}]) {
                await page.setViewportSize(viewport);
                const control = page.locator('#performanceBastardLoopVCardLevel');
                await control.scrollIntoViewIfNeeded();
                const box = await control.boundingBox(); assert.ok(box.width > 100 && box.x >= 0 && box.x + box.width <= viewport.width);
                const point = {x: box.x + box.width * .35, y: box.y + box.height / 2};
                if (viewport.width === 1280) await page.mouse.click(point.x, point.y); else await page.touchscreen.tap(point.x, point.y);
                const value = Number(await control.inputValue()); assert.ok(value > 20 && value < 50); await check(value);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            }
            await page.evaluate(() => {
                stopAllPerformancePlayback({silent: true});
                const b = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
                const data = b.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = .15 * Math.sin(2 * Math.PI * 220 * i / b.sampleRate);
                bastardLoopVBuffer = b; bastardLoopVSourceBpm = 120; bastardLoopVMetadata = {durationSeconds: 2, bpm: 120};
                setBastardLoopVEnabled(true, {silent: true, skipSave: true});
                bastardLoopPlaying = true; startBastardLoopV(); window.vVolumeSource = bastardLoopVSource; window.vVolumeBuffer = b;
            });
            for (const [id, value] of [['performanceBastardLoopVCardLevel', 25], ['performanceBastardLoopVLevel', 80]]) {
                await set(id, value); await check(value); await page.waitForTimeout(100);
                const state = await page.evaluate(() => ({actual: bastardLoopVGainNode.gain.value, expected: getBastardLoopVOutputGain(), sameSource: bastardLoopVSource === vVolumeSource, sameBuffer: bastardLoopVBuffer === vVolumeBuffer}));
                assert.ok(Math.abs(state.actual - state.expected) < .0001, JSON.stringify(state)); assert.equal(state.sameSource, true); assert.equal(state.sameBuffer, true);
            }
            await set('performanceBastardLoopVCardLevel', 0); await check(0);
            assert.equal(await page.evaluate(() => bastardLoopVSource === null), true);
            await set('performanceBastardLoopVLevel', 63); await check(63);
            assert.equal(await page.evaluate(() => Boolean(bastardLoopVSource) && bastardLoopVBuffer === vVolumeBuffer), true);
            // Old exports do not contain the added mirror: the canonical mixer value still wins.
            await page.evaluate(() => {
                stopAllPerformancePlayback({silent: true}); saveState();
                const state = JSON.parse(localStorage.getItem(STATE_STORAGE_KEY));
                delete state.sliders.performanceBastardLoopVCardLevel;
                state.sliders.performanceBastardLoopVLevel = '37';
                if (!restoreState({state, throwOnError: true})) throw new Error('Legacy restore failed');
            });
            await check(37);
            await set('performanceBastardLoopVCardLevel', 46); await check(46);
            assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(STATE_STORAGE_KEY)).sliders.performanceBastardLoopVLevel), '46');
            await start(); await check(46);
            assert.deepEqual(errors, []);
            console.log('PASS', name, 'two-way sync, phone portrait/landscape and desktop native input, live gain/no source restart, mute/resume, legacy recall and reload');
            await context.close();
        } finally {await browser.close();}
    }
})().catch(error => {console.error(error); process.exitCode = 1;});
