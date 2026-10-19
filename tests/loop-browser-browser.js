const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.LOOP_BROWSER_TEST_URL || 'http://127.0.0.1:8765/mygrain-bastardloops/';
const source = fs.readFileSync(path.join(__dirname, '../../fs7300-documenter/mygrain-bastardloops-browser.html'), 'utf8');
const wave = Buffer.alloc(44 + 1600);
wave.write('RIFF');
wave.writeUInt32LE(wave.length - 8, 4);
wave.write('WAVEfmt ', 8);
wave.writeUInt32LE(16, 16);
wave.writeUInt16LE(1, 20);
wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(8000, 24);
wave.writeUInt32LE(16000, 28);
wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34);
wave.write('data', 36);
wave.writeUInt32LE(1600, 40);

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const errors = [];
    const writes = [];
    const listRequests = [];
    const audioRequests = [];
    let failList = false;
    let fixtures = Array.from({ length: 12000 }, (_, index) => ({ name: `loop-${String(index).padStart(5, '0')}.wav`, size: 1644, modified: 1792000000, url: `/mygrain-bastardloops/loop-${String(index).padStart(5, '0')}.wav` }));
    try {
        const page = await browser.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', async route => {
            const request = route.request();
            const url = new URL(request.url());
            if (request.method() === 'POST' || request.method() === 'DELETE') {
                writes.push({ method: request.method(), path: url.pathname });
                if (url.pathname.endsWith('/api/rename')) {
                    const payload = request.postDataJSON();
                    const file = fixtures.find(entry => entry.name === payload.from);
                    file.name = `${payload.to}.wav`;
                    file.url = `/mygrain-bastardloops/${encodeURIComponent(file.name)}`;
                    return route.fulfill({ json: { ok: true, savedName: file.name } });
                }
                if (url.pathname.endsWith('/api/delete')) {
                    fixtures = fixtures.filter(entry => entry.name !== url.searchParams.get('filename'));
                    return route.fulfill({ json: { ok: true } });
                }
                throw new Error('Unexpected mutation');
            }
            if (url.pathname.endsWith('/api/list')) {
                listRequests.push(url.search);
                if (failList) return route.fulfill({ status: 503, json: { ok: false, error: 'fixture unavailable' } });
                const limit = Number(url.searchParams.get('limit'));
                assert.equal(limit, 50);
                const query = (url.searchParams.get('q') || '').toLowerCase();
                const matches = fixtures.filter(file => file.name.toLowerCase().includes(query));
                const offset = Math.min(Number(url.searchParams.get('offset')), Math.max(0, Math.floor((matches.length - 1) / limit) * limit));
                if (query === 'stale') await new Promise(resolve => setTimeout(resolve, 300));
                return route.fulfill({ json: { ok: true, files: matches.slice(offset, offset + limit), offset, total: matches.length, repositoryTotal: fixtures.length, limit } });
            }
            if (url.pathname.endsWith('.wav')) {
                audioRequests.push(url.pathname);
                return route.fulfill({ contentType: 'audio/wav', body: wave });
            }
            if (url.pathname.endsWith('/mygrain-bastardloops/')) return route.fulfill({ contentType: 'text/html', body: source });
            return route.abort();
        });
        await page.goto(base);
        await page.waitForFunction(() => document.getElementById('stats').textContent.includes('12000'));
        const rows = page.locator('#grid .card');
        assert.equal(await rows.count(), 50);
        assert.equal(await page.locator('audio').count(), 0);
        assert.equal(audioRequests.length, 0);
        assert.equal(listRequests.length, 1);
        await page.click('#next');
        await page.waitForFunction(() => document.getElementById('pageLabel').textContent === 'Page 2 of 240');
        assert.match(await rows.first().textContent(), /loop-00050/);
        await rows.first().getByRole('button').click();
        await page.waitForFunction(() => document.querySelector('#preview audio')?.readyState >= 1);
        await rows.nth(1).getByRole('button').click();
        await page.waitForFunction(() => document.querySelector('#preview audio')?.src.endsWith('loop-00051.wav'));
        assert.equal(await page.locator('audio').count(), 1);
        assert.match(await page.locator('#preview a.download').getAttribute('href'), /loop-00051/);
        await page.locator('#preview audio').evaluate(audio => audio.play());
        await page.getByRole('button', { name: 'Close preview' }).click();
        assert.equal(await page.locator('audio').count(), 0);
        await page.fill('#filter', 'loop-11999');
        await page.waitForFunction(() => document.querySelector('#grid .name')?.textContent === 'loop-11999.wav');
        assert.equal(await rows.count(), 1);
        assert.equal(await page.locator('#next').isDisabled(), true);
        assert.equal(await page.locator('#previous').isDisabled(), true);
        await page.fill('#filter', 'stale');
        await page.waitForTimeout(240);
        await page.fill('#filter', 'loop-00002');
        await page.waitForFunction(() => document.querySelector('#grid .name')?.textContent === 'loop-00002.wav');
        await page.waitForTimeout(350);
        assert.match(await rows.first().textContent(), /loop-00002/);
        await page.fill('#filter', 'absent');
        await page.waitForFunction(() => document.getElementById('stats').textContent.startsWith('No matching'));
        assert.equal(await rows.count(), 0);
        failList = true;
        await page.click('#refresh');
        await page.waitForFunction(() => document.getElementById('stats').textContent.includes('fixture unavailable'));
        failList = false;
        await page.fill('#filter', 'loop-00002');
        await page.waitForFunction(() => document.querySelector('#grid .name')?.textContent === 'loop-00002.wav');
        await rows.first().getByRole('button').click();
        page.once('dialog', dialog => dialog.accept('renamed-loop'));
        await page.getByRole('button', { name: 'Rename', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('Renamed to renamed-loop.wav'));
        await page.fill('#filter', 'renamed-loop');
        await page.waitForFunction(() => document.querySelector('#grid .name')?.textContent === 'renamed-loop.wav');
        await rows.first().getByRole('button').click();
        page.once('dialog', dialog => dialog.dismiss());
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        assert.equal(writes.length, 1);
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('stats').textContent.includes('11999 stored'));
        assert.equal(writes.length, 2);
        await page.fill('#filter', '');
        await page.waitForFunction(() => document.querySelectorAll('#grid .card').length === 50);
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            await rows.first().getByRole('button').click();
            const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, players: document.querySelectorAll('audio').length }));
            assert.ok(layout.scroll <= layout.width + 1, JSON.stringify(layout));
            assert.equal(layout.players, 1);
            await page.getByRole('button', { name: 'Close preview' }).click();
            if (viewport.width === 390) await page.screenshot({ path: '/tmp/mygrain-lightweight-loop-browser-mobile.png' });
        }
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ fixtureFiles: 12000, initialRows: 50, initialAudioRequests: 0, singleExplicitPlayer: true, searchAllPages: true, staleRequestsCancelled: true, renameDeleteMocksOnly: writes, listRequests: listRequests.length, audioRequests: audioRequests.length, viewports: [1440, 390, 320, 844], errors }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
