const { chromium, webkit } = require('playwright-core');
const assert = require('node:assert/strict');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18833/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);

(async () => {
    for (const [name, engine] of Object.entries({ chromium, webkit })) {
        const browser = await engine.launch(name === 'chromium' ? {
            executablePath: '/snap/bin/chromium',
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
        } : {});
        try {
            const errors = [];
            const credentials = { username: `historylock${name}${Date.now()}`, password: 'isolated-history-device-fixture' };
            async function device(register) {
                const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
                const auth = await ctx.request.post(base + `api/auth/${register ? 'register' : 'login'}`, { data: credentials });
                assert.equal(auth.ok(), true);
                const page = await ctx.newPage();
                page.on('pageerror', error => errors.push(error.message));
                await page.goto(base);
                await page.waitForFunction(() => window.mygrainCardHistory && window.mygrainSongBeta && !mygrainSongBeta.busy && document.documentElement.dataset.mygrainStartup === 'ready');
                await page.locator('#start-btn').tap();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                return { ctx, page };
            }
            const a = await device(true), b = await device(false);
            assert.equal(await a.page.evaluate(() => mygrainAccounts.user.username), await b.page.evaluate(() => mygrainAccounts.user.username));
            assert.notEqual(await a.page.evaluate(() => mygrainSongBeta.lease.device.id), await b.page.evaluate(() => mygrainSongBeta.lease.device.id));
            await a.page.locator('#songBetaDeviceName').fill('Studio Mac');
            await a.page.locator('#songBetaName').fill('History reservation fixture');
            await a.page.locator('#songBetaNewSong').tap();
            await a.page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.canEditSong());
            const library = await a.page.evaluate(() => ({ key: mygrainSongBeta.key, id: mygrainSongBeta.song.id }));
            const pattern = page => page.evaluate(() => JSON.stringify(bastardLoopXSequence));
            const counts = page => page.evaluate(() => mygrainCardHistory.counts);
            async function travel(page, direction) {
                await page.locator(direction === 'undo' ? '#sectionJumpUndoBtn' : '#sectionJumpRedoBtn').tap();
                await page.waitForFunction(() => !mygrainCardHistory.busy);
            }
            await a.page.locator('#performanceBastardLoopXRandomPatternBtn').tap();
            await a.page.locator('#performanceBastardLoopXRandomPatternBtn').tap();
            await a.page.evaluate(() => mygrainSongBeta.finishEditing());
            await b.page.evaluate(async ({ key, id }) => {
                mygrainSongBeta.key = key;
                mygrainSongBeta.storage.setItem('mygrain-song-selected-v1', id);
                await mygrainSongBeta.refresh();
            }, library);
            await b.page.locator('#songBetaDeviceName').fill('iPhone');
            await b.page.locator('#performanceBastardLoopXRandomPatternBtn').tap();
            const bFirst = await pattern(b.page);
            await b.page.locator('#performanceBastardLoopXRandomPatternBtn').tap();
            await travel(b.page, 'undo');
            assert.equal(await pattern(b.page), bFirst);
            assert.equal(await b.page.evaluate(() => mygrainSongBeta.canEditSong()), true);
            assert.deepEqual(await counts(b.page), { undo: 1, redo: 1 });
            await b.page.evaluate(() => mygrainSongBeta.finishEditing());
            await a.page.evaluate(() => mygrainSongBeta.beginEditing());
            for (const direction of ['undo', 'redo']) {
                await travel(b.page, direction);
                assert.equal(await pattern(b.page), bFirst);
                assert.deepEqual(await counts(b.page), { undo: 1, redo: 1 });
                assert.match(await b.page.locator('#status').textContent(), /Studio Mac/);
                assert.equal(await b.page.locator('#settlePopup').getAttribute('aria-hidden'), 'false');
                assert.equal(await b.page.evaluate(() => mygrainSongBeta.canEditSong()), false);
            }
            console.log('PASS', name, 'same account: foreign device blocks Undo AND Redo, names reservation holder, retains state/history');
            // Device labels are display names, never the authority: matching labels cannot bypass the token/session lock.
            await b.page.locator('#songBetaDeviceName').fill('Studio Mac');
            await travel(b.page, 'redo');
            assert.equal(await pattern(b.page), bFirst);
            assert.deepEqual(await counts(b.page), { undo: 1, redo: 1 });
            const aAfter = await pattern(a.page);
            let renewals = 0;
            a.page.on('request', request => { if (request.url().endsWith('/lock/renew')) renewals++; });
            await travel(a.page, 'undo');
            await travel(a.page, 'redo');
            assert.equal(await pattern(a.page), aAfter);
            assert.ok(renewals >= 2);
            const beforeOffline = await counts(a.page);
            await a.ctx.setOffline(true);
            await travel(a.page, 'undo');
            assert.equal(await pattern(a.page), aAfter);
            assert.deepEqual(await counts(a.page), beforeOffline);
            assert.match(await a.page.locator('#status').textContent(), /Connection lost|paused|verified/i);
            await a.ctx.setOffline(false);
            await travel(a.page, 'undo');
            assert.equal((await counts(a.page)).redo, 1);
            console.log('PASS', name, 'owner freshly verified each travel; identical labels cannot bypass locking; offline history unchanged; reconnect resumes');
            // Switch selection while a reservation check is in flight: it must not apply the captured entry.
            const raceBefore = await pattern(a.page), raceCounts = await counts(a.page);
            await a.page.evaluate(() => {
                window.__check = mygrainSongBeta.lease.check.bind(mygrainSongBeta.lease);
                mygrainSongBeta.lease.check = () => new Promise(resolve => { window.__finishCheck = resolve; });
                window.__travel = mygrainCardHistory.redo();
            });
            await a.page.evaluate(async () => {
                const selected = mygrainSongBeta.song;
                mygrainSongBeta.song = null;
                __finishCheck();
                await __travel;
                mygrainSongBeta.song = selected;
                mygrainSongBeta.lease.check = __check;
            });
            assert.equal(await pattern(a.page), raceBefore);
            assert.deepEqual(await counts(a.page), raceCounts);
            assert.match(await a.page.locator('#status').textContent(), /selection changed/);
            // Releasing on A allows B to obtain the existing Song reservation, with its history still intact.
            await a.page.evaluate(() => mygrainSongBeta.finishEditing());
            await travel(b.page, 'redo');
            assert.deepEqual(await counts(b.page), { undo: 2, redo: 0 });
            assert.equal(await b.page.evaluate(() => mygrainSongBeta.canEditSong()), true);
            assert.equal(await b.page.evaluate(() => mygrainSongBeta.song.revision), 1); // No Song part writes.
            console.log('PASS', name, 'selection-race safe; release transfers access without consuming blocked history or saving a Song part');
            await a.page.evaluate(() => hideSettlePopup());
            await a.page.waitForFunction(() => getComputedStyle(document.getElementById('settlePopup')).opacity === '0');
            for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 900 }]) {
                await a.page.setViewportSize(viewport);
                await a.page.locator('.mygrain-app-brand').scrollIntoViewIfNeeded();
                const layout = await a.page.evaluate(() => {
                    const root = document.querySelector('.mygrain-app-brand'), parent = root.parentElement.getBoundingClientRect();
                    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, center: r.x + r.width / 2, bottom: r.bottom }; };
                    return { parentCenter: parent.x + parent.width / 2, header: rect(root), logo: rect(root.querySelector('img')), title: rect(root.querySelector('h2 span')), build: rect(root.querySelector('.build-badge')), chip: [...document.querySelectorAll('.performance-chip')].some(e => /Play.*Source.*BPM/.test(e.textContent)), overflow: document.documentElement.scrollWidth > innerWidth };
                });
                for (const key of ['header', 'logo', 'title', 'build']) assert.ok(Math.abs(layout[key].center - layout.parentCenter) < 2, JSON.stringify({ viewport, key, layout }));
                assert.ok(layout.logo.w >= 112);
                assert.ok(layout.logo.bottom <= layout.title.y && layout.title.bottom < layout.build.y);
                assert.equal(layout.chip, false); assert.equal(layout.overflow, false);
                await a.page.screenshot({ path: `/tmp/mygrain-touch4-brand-${name}-${viewport.width}.png` });
            }
            assert.deepEqual(errors, []);
            console.log('PASS', name, 'larger brain/title/build centred and stacked at all three sizes; no overflow or page errors');
        } finally { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
