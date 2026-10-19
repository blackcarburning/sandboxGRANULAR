const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const base = process.env.RADIOLAB_SMOKE_URL;
const username = process.env.RADIOLAB_SMOKE_USERNAME || 'admin';
const password = process.env.RADIOLAB_SMOKE_PASSWORD;
const evidence = process.env.RADIOLAB_SMOKE_EVIDENCE;
const stations = (process.env.RADIOLAB_CAPTURE_STATIONS || 'vesti-fm').split(',');
if (!base || !password || !evidence) throw new Error('Provide the smoke URL, password and evidence path.');
const origin = new URL(base).origin;
const results = { base, stations: [], errors: [], blockedWrites: [] };

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    try {
        await context.route('**/*', route => {
            if (!['GET', 'HEAD'].includes(route.request().method())
                && new URL(route.request().url()).pathname !== '/mygrain/api/radiolab/stream/release') {
                results.blockedWrites.push(new URL(route.request().url()).pathname);
                return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Read-only verification"}' });
            }
            return route.continue();
        });
        const login = await context.request.post(origin + '/mygrain/api/auth/login', {
            headers: { Origin: origin }, data: { username, password }
        });
        assert.equal(login.status(), 200);
        const page = await context.newPage();
        page.on('pageerror', error => results.errors.push(error.message));
        await page.goto(base, { waitUntil: 'load' });
        await page.locator('#start-btn').click();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended
            && window.mygrainRadiolab && !window.mygrainRadiolab.state.busy);
        assert.equal(await page.evaluate(() => window.mygrainRadiolab.state.build), 'v2026.10.17.R.9');
        results.stationCount = await page.locator('#radiolabStation option').count();
        assert.ok(results.stationCount >= 21, 'The expanded catalogue must be active.');
        for (const station of stations) {
            await page.locator('#radiolabStation').selectOption(station);
            assert.equal(await page.locator('#radiolabRecord').isEnabled(), true);
            await page.locator('#radiolabRecord').tap();
            assert.equal(await page.locator('#radiolabStop').isEnabled(), true);
            await page.waitForFunction(() => window.mygrainRadiolab.state.recording
                && window.mygrainRadiolab.state.recordedSeconds >= 2, null, { timeout: 40000 });
            await page.locator('#radiolabStop').tap();
            const state = await page.evaluate(() => window.mygrainRadiolab.state);
            assert.equal(state.recording, false);
            assert.equal(state.listening, false);
            assert.equal(state.hasTake, true);
            assert.equal(await page.locator('#radiolabSave').isEnabled(), true, 'Take must contain non-silent audio.');
            assert.equal(await page.locator('#radiolabRewind').isVisible(), false);
            assert.equal(await page.locator('#radiolabAudition').isVisible(), false);
            results.stations.push({ station, state, take: await page.locator('#radiolabTake').textContent(),
                status: await page.locator('#radiolabStatus').textContent() });
        }
        await page.screenshot({ path: evidence.replace(/\.json$/, '.png') });
        assert.deepEqual(results.errors, []);
        assert.equal(results.blockedWrites.some(path => path.includes('/radiolab/samples')), false);
    } catch (error) {
        results.failure = error.stack;
        process.exitCode = 1;
    } finally {
        const logout = await context.request.post(origin + '/mygrain/api/auth/logout', { headers: { Origin: origin } });
        results.logoutStatus = logout.status();
        await context.close();
        await browser.close();
        fs.writeFileSync(evidence, JSON.stringify(results, null, 2));
        console.log(JSON.stringify(results, null, 2));
    }
})();
