const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18798/mygrain/';
const baseline = process.env.MYGRAIN_READINESS_BASELINE;
const evidence = process.env.MYGRAIN_READINESS_EVIDENCE || '/tmp/mygrain-k-readiness-browser.json';
const results = [];
const failures = [];

async function tapKey(page, selector, duration = 45) {
    await page.locator(selector).focus();
    await page.keyboard.down('Enter');
    await page.waitForTimeout(duration);
    await page.keyboard.up('Enter');
    await page.waitForTimeout(30);
}

async function touchKey(page, session, selector, duration = 45) {
    const point = await page.locator(selector).evaluate(key => {
        key.scrollIntoView({ block: 'center', behavior: 'instant' });
        const bounds = key.getBoundingClientRect();
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * .85 };
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
    await page.waitForTimeout(duration);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(30);
}

async function snapshot(page) {
    return page.evaluate(() => ({
        starts: window.readinessStarts.slice(),
        metrics: getKeyboardSamplePlayer().metrics,
        pressed: [...document.querySelectorAll('.key.active')].map(key => key.dataset.note),
        status: document.getElementById('status').textContent
    }));
}

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
            const page = await context.newPage();
            const errors = [];
            const requests = [];
            let delaySamples = false;
            page.setDefaultTimeout(20000);
            page.on('pageerror', error => errors.push(error.message));
            page.on('request', request => {
                if (/SAMPLES_Q.*\.(wav|mp3)/.test(request.url())) requests.push({ url: request.url(), time: Date.now() });
            });
            await page.route('**/*', async route => {
                const request = route.request();
                if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
                const pathname = new URL(request.url()).pathname;
                if (baseline && (pathname === '/mygrain/' || pathname.endsWith('/index.html') || pathname.endsWith('/q-card.js'))) {
                    const filename = pathname.endsWith('/q-card.js') ? 'q-card.js' : 'index.html';
                    return route.fulfill({ path: path.join(baseline, filename), contentType: filename.endsWith('.js') ? 'application/javascript' : 'text/html' });
                }
                if (delaySamples && /SAMPLES_Q.*\.(wav|mp3)/.test(pathname)) await new Promise(resolve => setTimeout(resolve, 1100));
                return route.continue();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(() => {
                stateSaveSuspended = true;
                stopAllPerformancePlayback({ silent: true });
                panicAllNotes({ immediate: true, preserveStatus: true });
                setHoldEnabled(false);
                setArpeggiatorEnabled(false, { skipSave: true });
                setFxMuted(true, { silent: true });
                window.readinessStarts = [];
                const player = getKeyboardSamplePlayer();
                const startVoice = player.startVoice.bind(player);
                player.startVoice = (request, selected) => {
                    const voice = startVoice(request, selected);
                    if (voice) readinessStarts.push({ midi: request.midi, instrument: request.options.instrument, time: performance.now() });
                    return voice;
                };
            });
            const qBefore = await page.evaluate(() => JSON.stringify(mygrainQ.getState()));
            const session = await context.newCDPSession(page);
            for (const instrument of ['piano', 'strings']) {
                const selectionStarted = Date.now();
                await page.locator(`#performanceKeyboardSoundSwitch [data-keyboard-sound="${instrument}"]`).tap();
                await page.waitForFunction(sound => keyboardSoundSource === sound && document.getElementById('status').textContent.startsWith('Keyboard and K sound:'), instrument);
                const loadingMs = Date.now() - selectionStarted;
                if (!baseline) {
                    const readiness = await page.evaluate(() => ({
                        labels: [...document.querySelectorAll('[data-keyboard-sound-status]')].map(label => ({ state: label.dataset.keyboardSoundReadiness, text: label.textContent })),
                        busy: [...document.querySelectorAll('[data-keyboard-sound][aria-pressed="true"]')].map(button => button.getAttribute('aria-busy'))
                    }));
                    assert.equal(readiness.labels.length, 2);
                    assert.ok(readiness.labels.every(label => label.state === 'ready' && label.text.includes('ready for visible keys')));
                    assert.deepEqual(readiness.busy, ['false', 'false']);
                }
                const note = await page.evaluate(() => {
                    document.querySelector('#keyboardContainer').scrollIntoView({ block: 'center', behavior: 'instant' });
                    return [...document.querySelectorAll('#keyboardContainer .key:not(.black)')].map(key => {
                        const bounds = key.getBoundingClientRect();
                        return { key, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * .85 };
                    }).filter(item => document.elementFromPoint(item.x, item.y)?.closest('.key') === item.key)
                        .sort((first, second) => Math.abs(first.x - innerWidth / 2) - Math.abs(second.x - innerWidth / 2))[0]?.key.dataset.note;
                });
                assert.ok(note, 'A playable white key is visible and hit-testable');
                const selector = `#keyboardContainer .key[data-note="${note}"]`;
                await page.locator(selector).focus();
                await page.waitForTimeout(150);
                await page.evaluate(() => { readinessStarts.length = 0; });
                for (let repeat = 0; repeat < 8; repeat += 1) await tapKey(page, selector);
                const keyboard = await snapshot(page);
                await page.evaluate(() => { readinessStarts.length = 0; });
                for (let repeat = 0; repeat < 8; repeat += 1) await touchKey(page, session, selector);
                const touch = await snapshot(page);
                await page.evaluate(() => { readinessStarts.length = 0; });
                const beforeRequests = requests.length;
                const backgroundHits = {};
                for (const [input, midi] of [['keyboard', 36], ['touch', 90]]) {
                    await page.evaluate(() => { readinessStarts.length = 0; });
                    const requestCount = requests.length;
                    delaySamples = true;
                    await page.evaluate(({ sound, midi }) => {
                        const player = getKeyboardSamplePlayer();
                        window.readinessPending = player.prepare(sound, midi, 1).catch(error => ({ error: error.message }));
                    }, { sound: instrument, midi });
                    await page.waitForTimeout(90);
                    for (let repeat = 0; repeat < 6; repeat += 1) {
                        if (input === 'keyboard') await tapKey(page, selector);
                        else await touchKey(page, session, selector);
                    }
                    backgroundHits[input] = (await snapshot(page)).starts.length;
                    await page.evaluate(() => readinessPending);
                    delaySamples = false;
                    await page.waitForTimeout(150);
                    if (requests.length === requestCount) failures.push(`${viewport.width}/${instrument}/${input}: no cold sample requested`);
                }
                const afterLoading = await snapshot(page);
                const item = { viewport, instrument, loadingMs, keyboardHits: keyboard.starts.length,
                    touchHits: touch.starts.length, whileLoadingHits: backgroundHits.keyboard,
                    touchWhileLoadingHits: backgroundHits.touch,
                    newRequests: requests.length - beforeRequests, afterLoading, errors };
                results.push(item);
                console.log(JSON.stringify(item));
                for (const [name, actual, expected] of [['keyboard', item.keyboardHits, 8], ['touch', item.touchHits, 8], ['while loading', item.whileLoadingHits, 6], ['touch while loading', item.touchWhileLoadingHits, 6]]) {
                    if (actual !== expected) failures.push(`${viewport.width}/${instrument}/${name}: ${actual}/${expected}`);
                }
                if (afterLoading.pressed.length || afterLoading.metrics.pending) failures.push(`${viewport.width}/${instrument}: stuck key or pending note`);
            }
            assert.equal(await page.evaluate(() => JSON.stringify(mygrainQ.getState())), qBefore, 'Q state is unchanged');
            assert.deepEqual(errors, [], 'No browser page errors');
            await page.screenshot({ path: evidence.replace(/\.json$/, `-${viewport.width}.png`) });
            await context.close();
        }
    } finally {
        fs.writeFileSync(evidence, JSON.stringify({ results, failures }, null, 2));
        await browser.close();
    }
    if (!baseline) assert.deepEqual(failures, [], 'Every warm key triggers, including while another sample loads');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
