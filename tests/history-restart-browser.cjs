const { chromium, webkit } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18833/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);

(async () => {
    for (const [name, engine] of Object.entries(process.env.WEBKIT ? { webkit } : { chromium, webkit })) {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), `mygrain-history-${name}-`));
        const errors = [], password = 'isolated-restart-history-fixture';
        let context, page;
        async function launch() {
            context = await engine.launchPersistentContext(profile, {
                ...(name === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {}),
                viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true
            });
            page = context.pages()[0] || await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
        }
        async function open(start = true) {
            await page.goto(base);
            await page.waitForFunction(() => window.mygrainCardHistory && window.mygrainSongBeta && document.documentElement.dataset.mygrainStartup === 'ready');
            await page.evaluate(() => mygrainCardHistory.ready);
            if (start) {
                await page.locator('#start-btn').tap();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            }
        }
        const counts = () => page.evaluate(() => mygrainCardHistory.counts);
        const sequence = () => page.evaluate(() => JSON.stringify(bastardLoopXSequence));
        const flush = () => page.evaluate(() => mygrainCardHistory.flush());
        async function travel(direction) {
            await page.locator(direction === 'undo' ? '#sectionJumpUndoBtn' : '#sectionJumpRedoBtn').tap();
            await page.waitForFunction(() => !mygrainCardHistory.busy);
            assert.equal(await page.evaluate(() => mygrainCardHistory.warning), '');
        }
        async function bass() {
            return page.evaluate(async () => {
                const b = bastardLoopXSampleBuffer;
                return { rate: b.sampleRate, length: b.length, channels: b.numberOfChannels, meta: JSON.stringify(bastardLoopXSampleMetadata),
                    hashes: await Promise.all(Array.from({ length: b.numberOfChannels }, async (_, c) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b.getChannelData(c)))).join(','))) };
            });
        }
        try {
            await launch();
            assert.equal((await context.request.post(base + 'api/auth/register', { data: { username: `restart${name}${Date.now()}`, password } })).ok(), true);
            await open();
            const device = await page.evaluate(() => mygrainSongBeta.lease.device.id);
            await page.locator('#performanceBastardLoopXRandomPatternBtn').tap();
            const first = await sequence();
            await page.locator('#performanceBastardLoopXRandomPatternBtn').tap();
            const second = await sequence();
            await travel('undo'); await flush();
            await open();
            assert.deepEqual(await counts(), { undo: 1, redo: 1 });
            assert.equal(await sequence(), first);
            await travel('redo'); assert.equal(await sequence(), second);
            console.log('PASS', name, 'reload retains exact pattern, Undo AND Redo stacks; fresh reservation session accepts stable device history');

            await page.evaluate(() => setBastardLoopXRepository('samples_altbass'));
            await page.locator('#performanceBastardLoopXRandomBtn').tap();
            await page.waitForFunction(() => !mygrainCardHistory.busy && !!bastardLoopXSampleBuffer);
            const bass1 = await bass();
            await page.locator('#performanceBastardLoopXRandomBtn').tap();
            await page.waitForFunction(() => !mygrainCardHistory.busy);
            const bass2 = await bass();
            await travel('undo'); assert.deepEqual(await bass(), bass1); await flush();
            const beforeClose = await counts();
            await context.close(); await launch(); await open(false);
            assert.deepEqual(await counts(), beforeClose);
            assert.equal(await page.evaluate(() => mygrainSongBeta.lease.device.id), device);
            assert.equal(await page.evaluate(() => !!window.audioContext), false);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            let downloads = 0;
            page.on('request', request => { if (/sample-source|sample-audio/.test(request.url())) downloads++; });
            await travel('redo'); assert.deepEqual(await bass(), bass2);
            await travel('undo'); assert.deepEqual(await bass(), bass1);
            assert.equal(downloads, 0);
            console.log('PASS', name, 'real browser-process restart preserves original bass PCM hashes, rate/channels/metadata; no redo downloads or eager history audio graph');

            // Maps, shared audio references and a pinned Q bank also survive the history codec.
            await page.evaluate(async () => {
                const owner = JSON.stringify([mygrainAccounts.user.username, mygrainSongBeta.lease.device.id]);
                const s = new MygrainSongStorage.HistoryStore(owner + ':codec', mygrainSongBeta.lease.device.id + '-codec');
                await s.open();
                const b = audioContext.createBuffer(2, 32, 44100); b.getChannelData(0).fill(.125); b.getChannelData(1).fill(-.25);
                const bank = { atlas: b, cache: new Map([['tone', b]]), bank: { samples: [] }, manifest: { id: 'fixture' }, pinned: true };
                const e = { owner: s.owner, label: 'codec', json: [{ path: ['optional'], before: undefined, after: null }], buffers: [{ index: 0, before: null, after: b }], piano: { before: null, after: bank } };
                await s.save([e], []); const raw = await s.read('journals', s.device);
                if (raw.references.length !== 1) throw new Error('Shared PCM was duplicated.');
                const hydrated = await s.hydrate(raw.undo[0], audioContext);
                if (hydrated.buffers[0].after !== hydrated.piano.after.atlas || hydrated.piano.after.cache.get('tone') !== hydrated.piano.after.atlas || !hydrated.piano.after.pinned || hydrated.json[0].before !== undefined || hydrated.piano.after.atlas.getChannelData(1)[0] !== -.25) throw new Error('History audio/Map/undefined codec mismatch.');
                const transaction = s.database.transaction.bind(s.database);
                Object.defineProperty(s.database, 'transaction', { configurable: true, value: (stores, mode) => { const tx = transaction(stores, mode); if (mode === 'readwrite') queueMicrotask(() => tx.abort()); return tx; } });
                let aborted = false;
                try { await s.save([], []); } catch { aborted = true; }
                Object.defineProperty(s.database, 'transaction', { configurable: true, value: transaction });
                if (!aborted || (await s.read('journals', s.device)).revision !== raw.revision || !(await s.read('audio', raw.references[0]))) throw new Error('Aborted write corrupted the previous journal/audio.');
                await s.save([], []);
                if ((await s.read('audio', raw.references[0])) !== undefined) throw new Error('Unreferenced sound was not collected.');
                s.close();
            });
            console.log('PASS', name, 'single-copy stereo PCM, Q bank/Map/pinned state and undefined values round-trip; aborted writes atomic; unreferenced PCM collected');

            const snapshots = [await sequence()];
            for (let i = 0; i < 12; i++) { await page.locator('#performanceBastardLoopXRandomPatternBtn').tap(); snapshots.push(await sequence()); }
            for (let i = 11; i >= 10; i--) { await travel('undo'); assert.equal(await sequence(), snapshots[i]); }
            assert.deepEqual(await counts(), { undo: 0, redo: 2 }); await flush();
            await context.close(); await launch(); await open();
            assert.deepEqual(await counts(), { undo: 0, redo: 2 });
            for (let i = 11; i <= 12; i++) { await travel('redo'); assert.equal(await sequence(), snapshots[i]); }
            assert.deepEqual(await counts(), { undo: 2, redo: 0 });
            console.log('PASS', name, 'both Redo levels survive process restart and restore exact sequences');

            const otherTab = await context.newPage();
            otherTab.on('pageerror', error => errors.push(error.message));
            await otherTab.goto(base);
            await otherTab.waitForFunction(() => window.mygrainCardHistory);
            await otherTab.evaluate(() => mygrainCardHistory.ready);
            await otherTab.locator('#start-btn').tap();
            await otherTab.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            const otherBefore = await otherTab.evaluate(() => JSON.stringify(bastardLoopXSequence));
            await otherTab.evaluate(() => mygrainCardHistory.undo());
            assert.equal(await otherTab.evaluate(() => JSON.stringify(bastardLoopXSequence)), otherBefore);
            assert.match(await otherTab.locator('#status').textContent(), /another tab/);
            await otherTab.close();
            console.log('PASS', name, 'same-device second tab cannot overwrite or travel the active history');

            await flush();
            await page.evaluate(() => localStorage.setItem('mygrain-song-device-v1', 'b'.repeat(32)));
            await open(); assert.deepEqual(await counts(), { undo: 0, redo: 0 });
            await page.locator('#performanceBastardLoopXRandomPatternBtn').tap(); await flush();
            await page.evaluate(id => localStorage.setItem('mygrain-song-device-v1', id), device);
            await open(); assert.deepEqual(await counts(), { undo: 2, redo: 0 });
            assert.equal((await context.request.post(base + 'api/auth/register', { data: { username: `other${name}${Date.now()}`, password } })).ok(), true);
            await open(); assert.deepEqual(await counts(), { undo: 0, redo: 0 });
            for (const failure of ['save', 'open']) {
                // Keep one page alive: WebKit closes its persistent browser with the last tab.
                const previousPage = page; page = await context.newPage();
                page.on('pageerror', error => errors.push(error.message));
                await previousPage.close();
                await context.request.post(base + 'api/auth/register', { data: { username: `quota${failure}${name}${Date.now()}`, password } });
                await context.route('**/song-beta-storage.js*', async route => {
                    const response = await route.fetch();
                    await route.fulfill({ response, body: (await response.text()) + `\nMygrainSongStorage.HistoryStore.prototype.${failure} = async function () { throw new DOMException('fixture unavailable', 'QuotaExceededError'); };` });
                });
                await open(); const beforeFailure = await sequence();
                await page.locator('#performanceBastardLoopXRandomPatternBtn').tap(); await flush();
                assert.deepEqual(await counts(), { undo: 1, redo: 0 });
                assert.match(await page.evaluate(() => mygrainCardHistory.warning), /session|saved|opened/);
                await page.evaluate(() => mygrainCardHistory.undo());
                assert.equal(await sequence(), beforeFailure); assert.deepEqual(await counts(), { undo: 0, redo: 1 });
                await context.unroute('**/song-beta-storage.js*');
            }
            console.log('PASS', name, 'unavailable/quota-failed storage warns and keeps normal card taps and in-session Undo working');
            assert.deepEqual(errors, []);
            console.log('PASS', name, 'different device IDs keep separate journals; original history recovers; another account sees no history; no page errors');
        } finally { await context?.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
