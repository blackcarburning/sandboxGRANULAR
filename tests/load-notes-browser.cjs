const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');

const base = process.env.LOAD_NOTES_URL || 'https://openclaw.blackcarburning.com/mygrain/';
const evidence = process.env.LOAD_NOTES_EVIDENCE || '/tmp/mygrain-random-change-highlights';
const origin = new URL(base).origin;
fs.mkdirSync(evidence, { recursive: true });

async function inspect(page, selector) {
    const panel = page.locator(selector);
    await panel.waitFor({ state: 'visible' });
    await panel.scrollIntoViewIfNeeded();
    return panel.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const texts = [...element.querySelectorAll('.mygrain-load-notes__text')].map(node => node.textContent);
        return {
            text: element.textContent,
            tip: texts[0],
            latest: texts[1],
            changeId: element.dataset.changeId,
            fits: rect.left >= 0 && rect.right <= innerWidth + 1,
            overflow: element.scrollWidth > element.clientWidth + 1
        };
    });
}

(async () => {
    const results = [];
    for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
        if (process.env.LOAD_NOTES_ENGINE && process.env.LOAD_NOTES_ENGINE !== engine) continue;
        const browser = await browserType.launch(engine === 'chromium'
            ? { executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] }
            : { headless: true });
        try {
            for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
                for (const remembered of [false, true]) {
                    const mobile = viewport.width < 960;
                    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
                    const page = await context.newPage();
                    const errors = [];
                    const blockedWrites = [];
                    const scriptStatuses = [];
                    const identity = remembered ? { ok: true, user: { username: 'notes-fixture' } } : { ok: true, user: null };
                    page.on('pageerror', error => errors.push(error.message));
                    page.on('response', response => {
                        if (response.url().includes('/mygrain-load-notes.js')) scriptStatuses.push(response.status());
                    });
                    await page.route('**/*', route => {
                        const request = route.request();
                        const url = new URL(request.url());
                        if (url.origin !== origin) return route.abort();
                        if (!['GET', 'HEAD'].includes(request.method())) {
                            blockedWrites.push(request.method() + ' ' + url.pathname);
                            return route.abort();
                        }
                        if (remembered && url.pathname.endsWith('/account-context.js')) {
                            return route.fulfill({ contentType: 'text/javascript', body: 'window.mygrainAccountContext=' + JSON.stringify(identity) });
                        }
                        if (url.pathname.includes('/api/')) {
                            return route.fulfill({ json: { ...identity, files: [], songs: [], folders: [], stations: [], samples: [], favourites: [], sources: [], patches: [] } });
                        }
                        return route.continue();
                    });
                    await page.goto(base, { waitUntil: 'load' });
                    await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
                    const startup = await inspect(page, '#mygrain-load-notes');
                    assert.match(startup.text, /Random tip/);
                    assert.match(startup.text, /Latest feature changes/);
                    const latest = await page.evaluate(() => mygrainLoadNotes.latestChanges());
                    assert.equal(latest.length, 5);
                    assert.deepEqual(await page.locator('#mygrain-load-notes .mygrain-load-notes__latest li').evaluateAll(nodes => nodes.map(node => node.dataset.changeId)), latest.map(change => change.id));
                    assert.ok(startup.text.indexOf('Latest feature changes') < startup.text.indexOf('Random tip'));
                    const pool = await page.evaluate(() => mygrainLoadNotes.recentChanges());
                    assert.equal(pool.length, 10);
                    assert.ok(pool.every(change => !latest.some(item => item.id === change.id)));
                    assert.equal(new Set(pool.map(change => change.id)).size, 10);
                    assert.ok(pool.some(change => change.id === startup.changeId));
                    assert.ok(startup.tip && startup.latest);
                    assert.ok(startup.fits && !startup.overflow, JSON.stringify(startup));
                    assert.ok(scriptStatuses.length && scriptStatuses.every(status => status === 200));
                    const history = await page.evaluate(() => mygrainLoadNotes.changes());
                    assert.ok(history.length >= 10);
                    await page.evaluate(() => { mygrainLoadNotes.refresh(); mygrainLoadNotes.refresh(); });
                    assert.equal((await inspect(page, '#mygrain-load-notes')).tip, startup.tip);
                    assert.equal((await inspect(page, '#mygrain-load-notes')).changeId, startup.changeId);
                    const prefix = `${engine}-${viewport.width}-${remembered ? 'remembered' : 'guest'}`;
                    await page.screenshot({ path: path.join(evidence, prefix + '-opening.png') });

                    let performanceNotes;
                    if (remembered) {
                        await page.locator('#start-btn').click();
                        await page.waitForFunction(() => audioContext?.state === 'running' && !engineStarting && !stateSaveSuspended);
                        await page.locator('#start-overlay').waitFor({ state: 'hidden' });
                        performanceNotes = await inspect(page, '#mygrain-performance-load-notes');
                        assert.equal(performanceNotes.tip, startup.tip);
                        assert.equal(performanceNotes.latest, startup.latest);
                        assert.ok(performanceNotes.fits && !performanceNotes.overflow, JSON.stringify(performanceNotes));
                        await page.screenshot({ path: path.join(evidence, prefix + '-started.png') });
                    } else {
                        assert.equal(await page.evaluate(() => mygrainAccounts.authenticated), false);
                        assert.equal(await page.locator('.synth-container').count(), 0);
                    }

                    await page.reload({ waitUntil: 'load' });
                    await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
                    const reloaded = await inspect(page, '#mygrain-load-notes');
                    assert.notEqual(reloaded.tip, startup.tip);
                    assert.notEqual(reloaded.changeId, startup.changeId);
                    assert.ok(pool.some(change => change.id === reloaded.changeId));

                    if (viewport.width === 1440 && !remembered) {
                        const seen = [startup.changeId, reloaded.changeId];
                        for (let load = 2; load < 10; load += 1) {
                            await page.reload({ waitUntil: 'load' });
                            await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
                            seen.push((await inspect(page, '#mygrain-load-notes')).changeId);
                        }
                        assert.equal(new Set(seen).size, 10);
                        assert.deepEqual([...seen].sort(), pool.map(change => change.id).sort());
                        await page.reload({ waitUntil: 'load' });
                        await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
                        assert.notEqual((await inspect(page, '#mygrain-load-notes')).changeId, seen[9]);
                    }

                    if (viewport.width === 390 && remembered) {
                        await context.addInitScript(() => {
                            Storage.prototype.getItem = () => { throw new DOMException('Fixture storage blocked', 'SecurityError'); };
                            Storage.prototype.setItem = () => { throw new DOMException('Fixture storage blocked', 'SecurityError'); };
                        });
                        await page.reload({ waitUntil: 'load' });
                        await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
                        const blocked = await inspect(page, '#mygrain-load-notes');
                        assert.ok(pool.some(change => change.id === blocked.changeId));
                        assert.ok(blocked.tip && blocked.fits);
                    }
                    assert.deepEqual(errors, [], prefix);
                    const result = { engine, viewport, remembered, startup, afterStart: Boolean(performanceNotes), reloadTipChanged: true, reloadChangeChanged: true, fullCycleVerified: viewport.width === 1440 && !remembered, blockedWrites };
                    results.push(result);
                    console.log(JSON.stringify(result));
                    await context.close();
                }
            }
        } finally {
            await browser.close();
        }
    }
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
