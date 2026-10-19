const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';
const build = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').match(/Build <strong>([^<]+)<\/strong>/)[1];
if (!/^https?:\/\/[^/]+\/mygrain\/$/.test(base)) throw new Error('Use the MYGRAIN app route. This check never writes server data.');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    const results = [];
    let accessFile;
    try {
        for (const blocked of [false, true]) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
            if (blocked) await context.addInitScript(() => {
                for (const name of ['localStorage', 'indexedDB']) Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
            });
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => {
                const request = route.request();
                if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.method()); return route.abort(); }
                return new URL(request.url()).origin === new URL(base).origin ? route.continue() : route.abort();
            });
            await page.goto(`${base}?song-access-check=20261015`, { waitUntil: 'load' });
            await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
            await page.locator('#start-btn').click();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            assert.ok((await page.locator('body').textContent()).includes(build));
            assert.equal(await page.evaluate(() => mygrainSongBeta.songs.length), 0);
            if (!blocked) {
                const pending = page.waitForEvent('download');
                await page.locator('#songBetaBackupAccess').click();
                const download = await pending;
                assert.equal(download.suggestedFilename(), 'MYGRAIN-Song-Access.json');
                const downloadPath = await download.path();
                accessFile = fs.readFileSync(fs.existsSync(downloadPath) ? downloadPath : `/tmp/snap-private-tmp/snap.chromium${downloadPath}`);
                assert.equal(JSON.parse(accessFile.toString()).key, await page.evaluate(() => mygrainSongBeta.key));
                await page.waitForFunction(() => !mygrainSongBeta.busy);
            } else {
                const chooser = page.waitForEvent('filechooser');
                await page.locator('#songBetaOpenAccess').click();
                await (await chooser).setFiles({ name: 'MYGRAIN-Song-Access.json', mimeType: 'application/json', buffer: accessFile });
                await page.waitForFunction(() => !mygrainSongBeta.busy && document.getElementById('songBetaStatus').textContent.startsWith('Opened server library:'));
                assert.equal(await page.evaluate(() => mygrainSongBeta.key), JSON.parse(accessFile.toString()).key);
                assert.equal(await page.evaluate(() => mygrainSongBeta.storage.persistent), false);
                assert.match(await page.locator('#songBetaAccessStatus').textContent(), /storage is unavailable/);
            }
            for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
                await page.setViewportSize(viewport);
                await page.locator('#songBetaOpenAccess').scrollIntoViewIfNeeded();
                const bounds = await page.locator('#songBetaOpenAccess').boundingBox();
                assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1, JSON.stringify(bounds));
                assert.ok(bounds.height >= 28);
                results.push({ blockedStorage: blocked, viewport, accessControlsVisible: true });
            }
            await context.close();
        }
        assert.deepEqual(writes, []);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ build, results, serverWrites: writes.length, errors, physicalSafari: 'not tested' }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
