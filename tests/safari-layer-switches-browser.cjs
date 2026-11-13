'use strict';
const fs = require('node:fs'), assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:19241/mygrain/';
const out = process.env.MYGRAIN_TEST_OUTPUT || '/tmp/mygrain-safari-layers';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
fs.mkdirSync(out, { recursive: true });
const ids = ['performanceBastardLoopDToggleBtn', 'performanceBastardLoopMToggleBtn', 'performanceBastardLoopMPlusToggleBtn', 'performanceBastardLoopKToggleBtn'];
const powers = ['Turntable', 'Wasp', 'Playground', 'Resonator'];
async function states(page) { return page.evaluate(ids => ids.map(id => document.getElementById(id).getAttribute('aria-pressed')), ids); }
async function settled(page) { await page.waitForFunction(() => !mygrainCardHistory.busy && !mygrainLayerControls.snapshot().dragging); }
async function tap(page, selector, phone) {
    const button = page.locator(selector);
    await button.scrollIntoViewIfNeeded();
    await page.waitForTimeout(180);
    if (phone) await button.tap(); else await button.click();
    await settled(page);
}
async function pairedRows(page) {
    await page.evaluate(() => mygrainDisplay.reveal(document.getElementById('performanceLayerSwitchesCard')));
    return page.evaluate(keys => keys.map(key => {
        const power = document.getElementById('performanceLayer' + key + 'OnBtn'), jump = document.getElementById('performanceLayer' + key + 'JumpBtn');
        const row = power?.parentElement, a = power?.getBoundingClientRect(), b = jump?.getBoundingClientRect();
        return { key, powers: document.querySelectorAll('#' + power?.id).length, jumps: document.querySelectorAll('#' + jump?.id).length,
            paired: !!row && row === jump?.parentElement && row.classList.contains('performance-layer-switch-row--effect'),
            children: row?.children.length, label: jump?.textContent.trim(), aria: jump?.getAttribute('aria-label'),
            columns: row ? getComputedStyle(row).gridTemplateColumns.split(/\s+/).length : 0, transform: jump && getComputedStyle(jump).textTransform,
            powerRect: a && { x: a.x, y: a.y, width: a.width, height: a.height }, jumpRect: b && { x: b.x, y: b.y, width: b.width, height: b.height },
            overflow: row && row.scrollWidth > row.clientWidth + 1 };
    }), powers);
}
function assertRows(rows) {
    for (const r of rows) {
        assert(r.paired && r.powers === 1 && r.jumps === 1 && r.children === 2 && r.columns === 2, JSON.stringify(r));
        assert.equal(r.label, 'Jump'); assert.equal(r.transform, 'uppercase'); assert.match(r.aria, /^Jump to /); assert(!r.overflow);
        assert(r.powerRect.width > 80 && r.jumpRect.width >= 44, JSON.stringify(r));
        assert(Math.abs(r.powerRect.y - r.jumpRect.y) < 1 && Math.abs(r.powerRect.height - r.jumpRect.height) < 1, JSON.stringify(r));
        assert(r.jumpRect.x >= r.powerRect.x + r.powerRect.width && r.jumpRect.x - r.powerRect.x - r.powerRect.width <= 9, JSON.stringify(r));
    }
}
(async () => {
    const results = [];
    for (const [name, type, phone] of [['webkit-phone', webkit, true], ['webkit-desktop', webkit, false], ['chromium-phone', chromium, true], ['chromium-desktop', chromium, false]]) {
        if (process.env.MYGRAIN_TEST_CASES && !process.env.MYGRAIN_TEST_CASES.split(',').includes(name)) continue;
        const browser = await type.launch(type === chromium ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1400, height: 1000 }, isMobile: phone, hasTouch: phone,
                ...(phone ? { userAgent: type === webkit
                    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
                    : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/142.0.0.0 Mobile/15E148 Safari/604.1' } : {}) });
            assert.equal((await context.request.post(base + 'api/auth/login', { data: { username: 'admin', password: 'isolated-vst3-test' } })).status(), 200);
            const page = await context.newPage(), errors = [];
            page.setDefaultTimeout(30000);
            page.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR', e.stack); });
            await page.route('**/*', r => new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort());
            await page.goto(base);
            await page.waitForFunction(() => window.mygrainLayerControls && document.documentElement.dataset.mygrainStartup === 'ready');
            await page.locator('#start-btn').click();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
            await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true }); clearAllPerformanceSoloStates({ silent: true, skipSave: true });
                mygrainD.enable(false); setBastardLoopMEnabled(false); setBastardLoopMPlusEnabled(false); setBastardLoopKEnabled(false);
                mygrainDisplay.reveal(document.getElementById('performanceLayerSwitchesCard'));
            });
            const taps = [];
            for (const id of ids) for (let n = 0; n < 4; n++) {
                const before = await states(page);
                await tap(page, '#' + id, phone);
                const expected = before.map((value, i) => ids[i] === id ? String(value !== 'true') : value), after = await states(page);
                assert.deepEqual(after, expected, id + ' must change exactly one layer');
                taps.push({ id, before, after });
            }
            let releaseCases;
            if (type === webkit) {
                // Fault injection supplements, not replaces, the native taps above.
                releaseCases = await page.evaluate(async () => {
                    const D = document.getElementById('performanceBastardLoopDToggleBtn'), M = document.getElementById('performanceBastardLoopMToggleBtn'), K = document.getElementById('performanceBastardLoopKToggleBtn');
                    const pointer = (el, type, pointerId) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId, isPrimary: true, pointerType: 'touch', button: 0, clientX: 30, clientY: 30 }));
                    setBastardLoopMEnabled(true); setBastardLoopKEnabled(false);
                    pointer(M, 'pointerdown', 41); // The old release is deliberately omitted.
                    pointer(K, 'pointerdown', 41); pointer(K, 'pointerup', 41);
                    K.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
                    await new Promise(resolve => setTimeout(resolve, 40));
                    const independent = { m: bastardLoopMEnabled, k: bastardLoopKEnabled };
                    mygrainD.enable(true);
                    D.addEventListener('pointerup', () => D.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 42, isPrimary: true, pointerType: 'touch' })), { once: true });
                    pointer(D, 'pointerdown', 42); pointer(D, 'pointerup', 42);
                    await new Promise(resolve => setTimeout(resolve, 50));
                    return { independent, dAfterTap: mygrainD.state.enabled };
                });
                assert.deepEqual(releaseCases, { independent: { m: true, k: true }, dAfterTap: false });
            }
            // Rows must survive the real lazy editor navigation, not only initial construction.
            const coldRows = await pairedRows(page); assertRows(coldRows);
            const destinations = { Turntable: 'turntableCard', Wasp: 'waspCard', Playground: 'filterPlaygroundCard', Resonator: 'resonatorCard' };
            for (const key of powers) {
                await page.locator('#performanceLayer' + key + 'JumpBtn').click();
                await page.waitForFunction(() => document.documentElement.dataset.mygrainJumping !== 'true');
                if (key === 'Wasp') await page.waitForSelector('#waspPower');
                const card = page.locator('#' + destinations[key]); await card.waitFor({ state: 'visible' });
                const rect = await card.boundingBox(); assert(rect.y < (phone ? 844 : 1000) && rect.y + rect.height > 0, JSON.stringify({ key, rect }));
                await page.keyboard.press('Escape'); await page.waitForTimeout(300);
                assertRows(await pairedRows(page));
            }
            const hydratedRows = await pairedRows(page); assertRows(hydratedRows);
            const powerResults = [];
            for (const key of powers) {
                const button = page.locator('#performanceLayer' + key + 'OnBtn');
                assert.equal(await button.count(), 1);
                const before = await page.evaluate(() => ({ r: mygrainResonator.settings().enabled, w: mygrainWasp.settings().enabled, p: mygrainWasp.settings().playground.enabled, t: mygrainTurntable.settings().enabled, undo: mygrainCardHistory.counts.undo }));
                await tap(page, '#performanceLayer' + key + 'OnBtn', phone);
                await page.waitForFunction(key => document.getElementById('performanceLayer' + key + 'OnBtn').getAttribute('aria-pressed') === 'true', key);
                const after = await page.evaluate(() => ({ r: mygrainResonator.settings().enabled, w: mygrainWasp.settings().enabled, p: mygrainWasp.settings().playground.enabled, t: mygrainTurntable.settings().enabled, undo: mygrainCardHistory.counts.undo }));
                const field = { Resonator: 'r', Wasp: 'w', Playground: 'p', Turntable: 't' }[key];
                const limit = await page.evaluate(() => MygrainSongStorage.historyLimit);
                assert.deepEqual(after, { ...before, [field]: true, undo: Math.min(limit, before.undo + 1) });
                assert.match(await page.evaluate(() => mygrainCardHistory.undoLabel), / power$/);
                await page.evaluate(() => mygrainCardHistory.undo()); await settled(page);
                await page.waitForFunction(key => document.getElementById('performanceLayer' + key + 'OnBtn').getAttribute('aria-pressed') === 'false', key);
                await page.evaluate(() => mygrainCardHistory.redo()); await settled(page);
                await page.waitForFunction(key => document.getElementById('performanceLayer' + key + 'OnBtn').getAttribute('aria-pressed') === 'true', key);
                await tap(page, '#performanceLayer' + key + 'OnBtn', phone);
                await page.waitForFunction(key => document.getElementById('performanceLayer' + key + 'OnBtn').getAttribute('aria-pressed') === 'false', key);
                powerResults.push({ key, before, after, undoRedo: true });
            }
            // Enabling one Wasp-based instrument must preserve the other's power.
            await tap(page, '#performanceLayerTurntableOnBtn', phone);
            await tap(page, '#performanceLayerWaspOnBtn', phone);
            await tap(page, '#performanceLayerPlaygroundOnBtn', phone);
            await tap(page, '#performanceLayerResonatorOnBtn', phone);
            const archive = await page.evaluate(async () => {
                const blob = await mygrainSongBetaAdapter.capture(), bytes = await blob.arrayBuffer(), info = mygrainSongBetaAdapter.inspectPart(bytes);
                await mygrainWasp.restore({ ...mygrainWasp.settings(), enabled: false, playground: { ...mygrainWasp.settings().playground, enabled: false } });
                await mygrainResonator.off();
                await mygrainTurntable.off();
                const part = await mygrainSongBetaAdapter.decode(bytes, { buffers: new Map(), bytes: 0, reservedBytes: 0, limitBytes: 96 * 1048576 });
                mygrainSongBetaAdapter.recall(part, { start: false });
                await Promise.all([mygrainWasp.whenReady(), mygrainResonator.whenReady(), mygrainTurntable.whenReady()]);
                return { bytes: bytes.byteLength, r: info.snapshot.state.modes.resonatorR.enabled, w: info.snapshot.state.modes.wasp.enabled, p: info.snapshot.state.modes.wasp.playground.enabled, t: info.snapshot.state.modes.turntable.enabled, proxySerialized: /performanceLayer(?:Resonator|Wasp|Playground|Turntable)OnBtn/.test(JSON.stringify(info.snapshot)) };
            });
            assert(archive.r && archive.w && archive.p && archive.t && !archive.proxySerialized);
            for (const key of powers) await page.waitForFunction(key => document.getElementById('performanceLayer' + key + 'OnBtn').getAttribute('aria-pressed') === 'true', key);
            if (phone) {
                await page.setViewportSize({ width: 844, height: 390 });
                await page.locator('#performanceLayerWaspOnBtn').scrollIntoViewIfNeeded();
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
                assertRows(await pairedRows(page));
                await page.screenshot({ path: out + '/' + name + '-landscape.png' });
                await page.setViewportSize({ width: 390, height: 844 });
            }
            await page.locator('#performanceLayerWaspOnBtn').scrollIntoViewIfNeeded();
            await page.screenshot({ path: out + '/' + name + '.png' });
            let lockedPower;
            if (process.env.MYGRAIN_TEST_POWER_LOCK) {
                await page.evaluate(async () => {
                    await mygrainWasp.restore({ ...mygrainWasp.settings(), enabled: false, playground: { ...mygrainWasp.settings().playground, enabled: false } });
                    const original = ensurePatchZipAudioReady;
                    window.powerTestRelease = null;
                    ensurePatchZipAudioReady = () => new Promise(resolve => { powerTestRelease = () => { ensurePatchZipAudioReady = original; resolve(); }; });
                });
                await page.locator('#performanceLayerWaspOnBtn').click();
                await page.waitForFunction(() => typeof powerTestRelease === 'function');
                await page.evaluate(() => { window.dispatchEvent(new Event('mygrain-account-lock')); powerTestRelease(); });
                await page.waitForFunction(() => !mygrainCardHistory.busy);
                lockedPower = await page.evaluate(() => ({ enabled: mygrainWasp.settings().enabled, disabled: document.getElementById('performanceLayerWaspOnBtn').disabled }));
                assert.deepEqual(lockedPower, { enabled: false, disabled: true });
            }
            assert.deepEqual(errors, []);
            const result = { name, taps, releaseCases, coldRows, hydratedRows, powerResults, archive, lockedPower, errors };
            results.push(result); fs.writeFileSync(out + '/safari-layer-switches.json', JSON.stringify(results, null, 2));
            console.log('PASS', name, '16 independent taps, effect power/history/ZIP, release cases', JSON.stringify(releaseCases));
            await context.close();
        } finally { await browser.close(); }
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
