const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const base = process.env.RADIOLAB_SMOKE_URL || 'http://127.0.0.1:18840/mygrain/';
const origin = new URL(base).origin;
const username = process.env.RADIOLAB_SMOKE_USERNAME || 'admin';
const password = process.env.RADIOLAB_SMOKE_PASSWORD;
if (!password) throw new Error('Set RADIOLAB_SMOKE_PASSWORD for the radio playback smoke account.');
const evidence = process.env.RADIOLAB_SMOKE_EVIDENCE || '/tmp/mygrain-radiolab-acceptance/real-stations.json';
const results = { base, stations: [], errors: [] };

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
        await context.addInitScript(() => {
            const AudioElement = window.Audio;
            window.__radioSmokeMedia = [];
            window.Audio = class extends AudioElement {
                constructor(...args) {
                    super(...args);
                    window.__radioSmokeMedia.push(this);
                }
            };
        });
        const page = await context.newPage();
        page.on('pageerror', error => results.errors.push(error.message));
        const login = await context.request.post(origin + '/mygrain/api/auth/login', {
            headers: { Origin: origin }, data: { username, password }
        });
        assert.equal(login.status(), 200);
        await page.goto(base, { waitUntil: 'load' });
        await page.locator('#start-btn').click();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        await page.waitForFunction(() => window.mygrainRadiolab && !window.mygrainRadiolab.state.busy);
        for (const station of ['vesti-fm', 'shanghai-news', 'jbreeze-global']) {
            await page.locator('#radiolabStation').selectOption(station);
            await page.locator('#radiolabListen').click();
            await page.waitForFunction(() => window.mygrainRadiolab.state.bufferSeconds > 2
                && window.__radioSmokeMedia.at(-1)?.currentTime > 1, null, { timeout: 30000 });
            const state = await page.evaluate(() => ({ ...window.mygrainRadiolab.state,
                mediaTime: window.__radioSmokeMedia.at(-1).currentTime,
                mediaError: window.__radioSmokeMedia.at(-1).error?.message || null }));
            assert.equal(state.station, station);
            assert.equal(state.tap, 'AudioWorklet');
            assert.equal(state.mediaError, null);
            results.stations.push(state);
            await page.locator('#radiolabStop').click();
            assert.equal(await page.evaluate(() => window.mygrainRadiolab.state.listening), false);
        }
        assert.deepEqual(results.errors, []);
        const logout = await context.request.post(origin + '/mygrain/api/auth/logout', { headers: { Origin: origin } });
        assert.equal(logout.status(), 200);
    } catch (error) {
        results.failure = error.stack;
        process.exitCode = 1;
    } finally {
        await context.close();
        await browser.close();
        fs.writeFileSync(evidence, JSON.stringify(results, null, 2));
        console.log(JSON.stringify(results, null, 2));
    }
})();
