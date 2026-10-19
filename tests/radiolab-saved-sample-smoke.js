const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const base = process.env.RADIOLAB_SMOKE_URL;
const username = process.env.RADIOLAB_SMOKE_USERNAME || 'admin';
const password = process.env.RADIOLAB_SMOKE_PASSWORD;
const evidence = process.env.RADIOLAB_SMOKE_EVIDENCE;
if (!base || !password || !evidence) throw new Error('Provide the smoke URL, password and evidence path.');
const origin = new URL(base).origin;
const expectSilence = process.env.RADIOLAB_EXPECT_SILENCE === '1';
const results = { base, errors: [], blockedWrites: [], targets: [] };

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
        await context.route('**/*', route => {
            const request = route.request();
            if (!['GET', 'HEAD'].includes(request.method())) {
                results.blockedWrites.push(new URL(request.url()).pathname);
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
        await page.locator('#radiolabBrowser').click();
        await page.waitForFunction(() => !window.mygrainRadiolab.state.busy
            && document.querySelectorAll('.radiolab-sample-row').length > 0);
        const row = page.locator('.radiolab-sample-row').first();
        results.filename = await row.getAttribute('data-filename');
        await row.locator('[data-action="play"]').click();
        await page.waitForFunction(() => !window.mygrainRadiolab.state.busy);
        results.previewStarted = await page.evaluate(() => window.mygrainRadiolab.state.previewing);
        results.previewStatus = await page.locator('#radiolabBrowserStatus').textContent();
        if (expectSilence) {
            assert.equal(results.previewStarted, false);
            assert.match(results.previewStatus, /digital silence/i);
        } else {
            assert.equal(results.previewStarted, true);
        }
        if (results.previewStarted) await row.locator('[data-action="play"]').click();
        for (const target of ['grainMain', 'grainA', 'grainB', 'V']) {
            await page.locator('#radiolabLoadTarget').selectOption(target);
            await row.locator('[data-action="load"]').click();
            if (expectSilence) {
                await page.waitForFunction(() => !window.mygrainRadiolab.state.busy);
                const status = await page.locator('#radiolabBrowserStatus').textContent();
                assert.match(status, /digital silence/i);
                results.targets.push({ target, status, rejectedSilentSample: true });
                continue;
            }
            await page.waitForFunction(expected => document.querySelector('#radiolabBrowserStatus').textContent
                .includes(`into ${expected === 'V' ? 'Loop V' : expected}.`), target);
            results.targets.push(await page.evaluate(target => {
                const buffer = target === 'grainMain' ? grainMainSampleBuffer : target === 'grainA' ? grainASampleBuffer
                    : target === 'grainB' ? grainBSampleBuffer : bastardLoopVBuffer;
                return { target, duration: buffer.duration,
                    nonzero: buffer.getChannelData(0).some(sample => sample !== 0),
                    status: document.querySelector('#radiolabBrowserStatus').textContent };
            }, target));
        }
        await page.screenshot({ path: evidence.replace(/\.json$/, '.png') });
        assert.deepEqual(results.errors, []);
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
