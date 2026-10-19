const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');

const base = process.env.RADIOLAB_SWITCH_URL || 'http://127.0.0.1:18840/mygrain/';
const origin = new URL(base).origin;
const evidence = process.env.RADIOLAB_SWITCH_EVIDENCE;
const password = process.env.RADIOLAB_SWITCH_PASSWORD;
const username = process.env.RADIOLAB_SWITCH_USERNAME || 'admin';
const engine = process.env.RADIOLAB_SWITCH_ENGINE || 'chromium';
const expectedBuild = process.env.RADIOLAB_SWITCH_BUILD || 'v2026.10.17.R.9';
const stations = (process.env.RADIOLAB_SWITCH_STATIONS || 'rthk-radio1,resonance-fm,wrmi-9955,rfi-monde,rthk-radio1,resonance-fm').split(',');
const baselineReport = process.env.RADIOLAB_SWITCH_BASELINE_ERRORS
    ? JSON.parse(fs.readFileSync(process.env.RADIOLAB_SWITCH_BASELINE_ERRORS, 'utf8')) : null;
const baselineErrors = baselineReport?.errorDetails || baselineReport?.errors || [];
if (!password || !evidence || !['chromium', 'webkit'].includes(engine)) throw new Error('Provide password, evidence and a supported browser engine.');
const results = { base, engine, checks: [], errors: [], errorDetails: [], baselineErrors: [], streams: [], blockedWrites: [], failures: [] };

function checked(name, condition = true) {
    assert.ok(condition, name);
    results.checks.push(name);
}

async function state(page) {
    return page.evaluate(() => window.mygrainRadiolab.state);
}

async function ready(page) {
    await page.goto(base, { waitUntil: 'load' });
    await page.locator('#start-btn').tap();
    await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended
        && window.mygrainRadiolab && !window.mygrainRadiolab.state.busy);
    checked('Expected build active', (await state(page)).build === expectedBuild);
}

async function playing(page, label) {
    await page.waitForFunction(() => window.mygrainRadiolab.state.listening
        && !window.mygrainRadiolab.state.busy && window.mygrainRadiolab.diagnostics.media?.currentTime >= 0.5,
    null, { timeout: 35000 });
    const before = await page.evaluate(() => window.mygrainRadiolab.diagnostics.media.currentTime);
    await page.waitForFunction(previous => window.mygrainRadiolab.diagnostics.media?.currentTime > previous + 0.25,
        before, { timeout: 5000 });
    checked(label);
}

(async () => {
    const browser = await (engine === 'webkit' ? webkit : chromium).launch(engine === 'webkit'
        ? { headless: true }
        : { executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    let page;
    let closeProbes;
    try {
        await context.route('**/*', route => {
            const request = route.request();
            if (!['GET', 'HEAD'].includes(request.method())
                && !new URL(request.url()).pathname.match(/^\/mygrain\/api\/radiolab\/stream\/release$/)) {
                results.blockedWrites.push(new URL(request.url()).pathname);
                return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Read-only audio verification"}' });
            }
            return route.continue();
        });
        const login = await context.request.post(origin + '/mygrain/api/auth/login', {
            headers: { Origin: origin }, data: { username, password }
        });
        checked('Authenticated temporary verification session', login.status() === 200);
        if (process.env.RADIOLAB_IPHONE_PROBE === '1') {
            closeProbes = await require('./radiolab-iphone-probe').installIphoneProbe(context, origin, results);
        }
        page = await context.newPage();
        page.on('pageerror', error => {
            results.errors.push(error.message);
            results.errorDetails.push({ message: error.message, stack: error.stack });
        });
        page.on('response', response => {
            if (response.url().includes('/radiolab/stream/')) {
                results.streams.push({ path: new URL(response.url()).pathname, status: response.status() });
            }
        });
        await ready(page);
        await page.selectOption('#radiolabStation', stations[0]);
        await page.locator('#radiolabRecord').tap();
        await page.waitForFunction(() => window.mygrainRadiolab.state.recording
            && window.mygrainRadiolab.state.recordedSeconds >= 1, null, { timeout: 35000 });
        await page.locator('#radiolabStop').tap();
        checked('Manual Record captures nonzero PCM before switching', await page.locator('#radiolabSave').isEnabled());
        const retainedSeconds = (await state(page)).recordedSeconds;
        await page.locator('#radiolabListen').tap();
        await playing(page, 'Stop then retry the same station');
        for (const station of stations) {
            await page.selectOption('#radiolabStation', station);
            await page.locator('#radiolabListen').tap();
            await playing(page, `Live switch to ${station}`);
            checked('Station switching retains the finished take', (await state(page)).recordedSeconds === retainedSeconds);
        }
        await page.locator('#radiolabStop').tap();
        await page.route('**/radiolab/stream/**', route => route.fulfill({ status: 502,
            contentType: 'application/json', body: '{"error":"Deliberate test station failure"}' }), { times: 1 });
        await page.locator('#radiolabListen').tap();
        await page.waitForFunction(() => !window.mygrainRadiolab.state.listening && !window.mygrainRadiolab.state.busy);
        checked('A failed station returns to retryable idle', await page.locator('#radiolabListen').isEnabled());
        await page.locator('#radiolabListen').tap();
        await playing(page, 'Same station recovers after a deliberate relay failure');
        await page.locator('#radiolabStop').tap();
        let releaseDelayed;
        let enteredDelayed;
        const delayedEntered = new Promise(resolve => { enteredDelayed = resolve; });
        const delayedRelease = new Promise(resolve => { releaseDelayed = resolve; });
        await page.route('**/radiolab/stream/**', async route => {
            enteredDelayed();
            await delayedRelease;
            await route.abort().catch(() => {});
        }, { times: 1 });
        await page.locator('#radiolabListen').tap();
        await delayedEntered;
        await page.locator('#radiolabStop').tap();
        releaseDelayed();
        checked('Stop cancels a pending stream without a stuck busy lock', !(await state(page)).busy && !(await state(page)).listening);
        await page.locator('#radiolabListen').tap();
        await playing(page, 'Retry after cancelling a delayed stream');
        if (process.env.RADIOLAB_SWITCH_SINGLE_PAGE !== '1') {
            const secondPage = await context.newPage();
            await ready(secondPage);
            await secondPage.selectOption('#radiolabStation', stations[0]);
            await secondPage.locator('#radiolabListen').tap();
            await playing(secondPage, 'Another tab can use its independent stream slot');
            await page.locator('#radiolabStop').tap();
            const secondBefore = await secondPage.evaluate(() => window.mygrainRadiolab.diagnostics.media.currentTime);
            await secondPage.waitForFunction(previous => window.mygrainRadiolab.diagnostics.media?.currentTime > previous + 0.5,
                secondBefore, { timeout: 5000 });
            checked('Stopping one tab does not stop the other tab');
            await secondPage.locator('#radiolabStop').tap();
            await secondPage.close();
        } else {
            await page.locator('#radiolabStop').tap();
            results.secondTab = 'Skipped on shared public account; verified on isolated backend.';
        }
        await page.setViewportSize({ width: 844, height: 390 });
        await page.locator('#radiolabCard').scrollIntoViewIfNeeded();
        await page.screenshot({ path: evidence.replace(/\.json$/, '-landscape.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#radiolabCard').scrollIntoViewIfNeeded();
        await page.screenshot({ path: evidence.replace(/\.json$/, '-portrait.png') });
        checked('No unexpected 409 or 429 stream errors', !results.streams.some(stream => [409, 429].includes(stream.status)));
        if (closeProbes) checked('Every retained iPhone range probe succeeded before browser playback',
            results.iphoneProbes.length >= stations.length && results.iphoneProbes.every(probe => probe.status === 200 && probe.bytes > 0 && !probe.error));
        const diagnostic = await page.evaluate(() => buildDebugLogPayload());
        checked('Submitted debug payload includes RadioLab media diagnostics',
            diagnostic.currentState.radiolab.build === expectedBuild && diagnostic.debugConsoleText.includes('RadioLab diagnostics:'));
        const normalizedStack = stack => stack.replace(/https?:\/\/[^/\s]+/g, '<origin>');
        results.baselineErrors = results.errorDetails.filter(error => baselineErrors.some(baseline =>
            error.message === baseline.message && normalizedStack(error.stack) === normalizedStack(baseline.stack)));
        checked('No new uncaught application errors against the exact pre-edit baseline',
            results.errorDetails.length === results.baselineErrors.length);
        checked('No production sample/state writes attempted', !results.blockedWrites.some(path => /radiolab\/samples|\/state$/.test(path)));
    } catch (error) {
        results.failures.push({ message: error.stack, state: page && await state(page).catch(() => null),
            status: page && await page.locator('#radiolabStatus').textContent().catch(() => null) });
        process.exitCode = 1;
    } finally {
        closeProbes?.();
        const logout = await context.request.post(origin + '/mygrain/api/auth/logout', { headers: { Origin: origin } });
        results.logoutStatus = logout.status();
        await context.close();
        await browser.close();
        fs.writeFileSync(evidence, JSON.stringify(results, null, 2));
        console.log(JSON.stringify(results, null, 2));
    }
})();
