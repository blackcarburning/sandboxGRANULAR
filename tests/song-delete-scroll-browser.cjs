const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi).join('\n');
const cardStart = html.indexOf('<div class="performance-feature-card" id="songBetaCard"');
const cardEnd = html.indexOf('<div class="performance-feature-card performance-export-card"', cardStart);
assert.ok(cardStart > 0 && cardEnd > cardStart);
const card = html.slice(cardStart, cardEnd);
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">${styles}<style>${fs.readFileSync(path.join(root, 'song-beta.css'), 'utf8')}</style></head><body class="simplified-ui"><div style="height:1600px"></div><main class="synth-container"><div class="performance-controls">${card}<section style="height:1800px"><h3>Export Length</h3></section></div></main></body></html>`;

async function check(browser, viewport, before) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url() === 'http://mygrain-delete.test/'
        ? route.fulfill({ contentType: 'text/html', body: fixture }) : route.abort());
    await page.goto('http://mygrain-delete.test/');
    for (const filename of ['song-beta-storage.js', 'song-beta-locks.js', 'song-beta.js']) {
        const source = before && filename === 'song-beta.js' ? before : path.join(root, filename);
        await page.addScriptTag({ content: fs.readFileSync(source, 'utf8') });
    }
    await page.evaluate(() => {
        const controller = window.controller = new MygrainSongBeta.Controller({ stop() {} }, { renderStore: { warning: '' } });
        controller.canEditSong = () => true;
        controller.renderLockUi = () => {};
        controller.lease.watch = async () => {};
        const scrollIntoView = Element.prototype.scrollIntoView;
        window.songScrolls = [];
        Element.prototype.scrollIntoView = function (options) {
            if (this.id === 'songBetaCard') songScrolls.push({ options, busy: controller.busy });
            return scrollIntoView.call(this, options);
        };
    });
    const results = [];
    try {
        for (const scenario of before ? ['last'] : ['first', 'middle', 'last', 'only', 'cancelled', 'failed', 'locked']) {
            const count = scenario === 'only' ? 1 : 8;
            const index = scenario === 'first' || scenario === 'only' ? 0 : scenario === 'middle' ? 3 : 7;
            await page.evaluate(({ count, index, scenario }) => {
                const parts = Array.from({ length: count }, (_, position) => ({ id: String(position + 1).padStart(32, '0'), name: `Part ${position + 1}`, sha256: 'a'.repeat(64), bpm: 120, patternSteps: 16, repeats: 1 }));
                controller.song = { id: 'fixture-song', name: 'Scroll fixture', revision: 1, parts };
                controller.songs = [controller.song];
                controller.expandedParts = new Set(parts.map(part => `fixture-song:${part.id}`));
                controller.ensureEditing = async () => { if (scenario === 'locked') throw new Error('Other device holds editing'); };
                controller.request = async (endpoint, options) => {
                    if (scenario === 'failed') throw new Error('Fixture deletion failed');
                    if (options.method !== 'POST' || !endpoint.includes(`/parts/${parts[index].id}/delete?`)) throw new Error('Unexpected request');
                    return { song: { ...controller.song, revision: 2, parts: controller.song.parts.filter(part => part.id !== parts[index].id) } };
                };
                controller.render();
                window.songScrolls = [];
            }, { count, index, scenario });
            page.once('dialog', dialog => scenario === 'cancelled' ? dialog.dismiss() : dialog.accept());
            await page.locator('.song-beta-delete').nth(index).click();
            await page.waitForFunction(() => !controller.busy);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const result = await page.evaluate(() => ({ top: document.getElementById('songBetaCard').getBoundingClientRect().top, remaining: controller.song.parts.length, scrolls: songScrolls, overflow: document.documentElement.scrollWidth > innerWidth }));
            const succeeded = !['cancelled', 'failed', 'locked'].includes(scenario);
            assert.equal(result.remaining, succeeded ? count - 1 : count);
            assert.equal(result.overflow, false);
            if (succeeded && !before) {
                assert.equal(result.scrolls.length, 1);
                assert.equal(result.scrolls[0].busy, false);
                assert.deepEqual(result.scrolls[0].options, { behavior: 'instant', block: 'start', inline: 'nearest' });
                assert.ok(Math.abs(result.top) <= 1, JSON.stringify(result));
                await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)));
                assert.ok(Math.abs(await page.locator('#songBetaCard').evaluate(element => element.getBoundingClientRect().top)) <= 1);
            } else {
                assert.equal(result.scrolls.length, 0);
                if (before) assert.ok(Math.abs(result.top) > 40, 'Baseline should reproduce the missing return to Song top');
            }
            results.push({ scenario, top: result.top, remaining: result.remaining });
        }
        assert.deepEqual(errors, []);
        return results;
    } finally {
        await context.close();
    }
}

(async () => {
    for (const engine of [chromium, webkit]) {
        const browser = await engine.launch(engine === chromium ? { executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : { headless: true });
        try {
            for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
                if (process.env.SONG_DELETE_BASELINE) console.log(JSON.stringify({ engine: engine.name(), viewport, baseline: await check(browser, viewport, process.env.SONG_DELETE_BASELINE) }));
                console.log(JSON.stringify({ engine: engine.name(), viewport, checks: await check(browser, viewport) }));
            }
        } finally {
            await browser.close();
        }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
