const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18797/mygrain/';
const baseline = process.env.MYGRAIN_K_INFO_BASELINE;
const evidence = process.env.MYGRAIN_K_INFO_EVIDENCE || '/tmp/mygrain-k-info-browser';
const warningPattern = /song.{0,90}(?:cut|truncat)|(?:cut|truncat).{0,90}song/i;

async function setInput(page, identifier, value) {
    await page.evaluate(({ identifier, value }) => {
        const input = document.getElementById(identifier);
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }, { identifier, value });
}

async function style(locator) {
    return locator.evaluate(element => {
        const computed = getComputedStyle(element);
        return { filter: computed.filter, shadow: computed.boxShadow, background: computed.backgroundImage,
            color: computed.backgroundColor, transform: computed.transform, translate: computed.translate,
            outline: computed.outline, opacity: computed.opacity };
    });
}

async function fixture(page, kind = 'button') {
    await page.evaluate(kind => {
        document.getElementById('kPressFixture')?.remove();
        const container = document.createElement('div');
        container.id = 'kPressFixture';
        container.style.cssText = 'position:fixed;left:40px;top:120px;z-index:2147483647;background:#161020;padding:12px';
        const element = document.createElement(kind === 'role' ? 'div' : kind === 'link' ? 'a' : kind === 'input' ? 'input' : 'button');
        element.id = 'kPressProbe';
        element.className = 'performance-btn';
        element.tabIndex = 0;
        if (kind === 'input') { element.type = 'button'; element.value = 'Press feedback'; }
        else element.textContent = 'Press feedback';
        if (kind === 'role') element.setAttribute('role', 'button');
        if (kind === 'link') element.href = '#press-fixture';
        element.setAttribute('aria-pressed', 'true');
        element.classList.add('active');
        window.kPressClicks = 0;
        element.addEventListener('click', event => { event.preventDefault(); kPressClicks += 1; });
        container.append(element);
        document.body.append(container);
    }, kind);
    return page.locator('#kPressProbe');
}

(async () => {
    fs.mkdirSync(evidence, { recursive: true });
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const blockedWrites = [];
    const results = [];
    try {
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
            const page = await context.newPage();
            await page.emulateMedia({ reducedMotion: 'reduce' });
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => {
                if (!['GET', 'HEAD'].includes(route.request().method())) {
                    blockedWrites.push(route.request().url());
                    return route.abort();
                }
                if (baseline && route.request().isNavigationRequest() && new URL(route.request().url()).pathname === new URL(base).pathname) {
                    return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(baseline, 'utf8') });
                }
                return route.continue();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(async () => {
                stateSaveSuspended = true;
                stopAllPerformancePlayback({ silent: true });
                document.getElementById('globalBpmSlider').value = '120';
                document.getElementById('globalBpmSlider').dispatchEvent(new Event('input', { bubbles: true }));
                syncPatternLengthControls(16, { skipSave: true });
                const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 4, audioContext.sampleRate);
                const samples = buffer.getChannelData(0);
                for (let frame = 0; frame < samples.length; frame += 1) samples[frame] = .2 * Math.sin(2 * Math.PI * 220 * frame / buffer.sampleRate);
                await applyRecordedBastardLoopKBuffer(buffer, { bpm: 120 });
            });
            const meta = page.locator('#performanceBastardLoopKMeta');
            const longInfo = await meta.textContent();
            assert.match(longInfo, warningPattern, 'Longer loaded K warns about Song cut-off');
            await setInput(page, 'globalPatternLength', 32);
            assert.doesNotMatch(await meta.textContent(), warningPattern, 'Equal-length K has no cut-off warning');
            await setInput(page, 'globalPatternLength', 8);
            assert.match(await meta.textContent(), warningPattern, 'Shrinking the pattern refreshes the warning');
            await setInput(page, 'globalPatternLength', 16);
            await page.locator('#performanceBastardLoopKPreserveDurationBtn').tap();
            await setInput(page, 'performanceBastardLoopKSemitone', 12);
            assert.doesNotMatch(await meta.textContent(), warningPattern, 'Sampler octave-up now fits the pattern');
            await page.locator('#performanceBastardLoopKPreserveDurationBtn').tap();
            assert.match(await meta.textContent(), warningPattern, 'Preserved duration restores the warning');
            await setInput(page, 'globalBpmSlider', 240);
            assert.match(await meta.textContent(), warningPattern, 'Tempo update keeps correct relative cut-off warning');
            const purple = await page.locator('#bastardLoopKCard').evaluate(element => getComputedStyle(element).backgroundColor);
            const channels = purple.match(/[\d.]+/g).map(Number);
            assert.ok(channels[0] > channels[1] * 1.2 && channels[2] > channels[1] * 1.2, `K card is purple: ${purple}`);
            await page.locator('#performanceBastardLoopKMeta').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
            await page.screenshot({ path: path.join(evidence, `k-warning-${viewport.width}.png`) });

            const pressResults = [];
            for (const kind of ['button', 'input', 'role', 'link']) {
                const probe = await fixture(page, kind);
                const initial = await style(probe);
                const bounds = await probe.boundingBox();
                await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
                await page.waitForTimeout(50);
                const hovered = await style(probe);
                await page.mouse.down();
                await page.waitForTimeout(50);
                const held = await style(probe);
                if (JSON.stringify(held) === JSON.stringify(hovered)) {
                    await page.screenshot({ path: path.join(evidence, 'press-failure.png') });
                    console.error(await probe.evaluate(element => ({ marker: element.getAttribute('data-ui-pressed'),
                        bounds: element.getBoundingClientRect().toJSON(), width: innerWidth, scrollX, scrollY,
                        hit: document.elementFromPoint(element.getBoundingClientRect().x + element.offsetWidth / 2,
                            element.getBoundingClientRect().y + element.offsetHeight / 2)?.outerHTML.slice(0, 180) })));
                    console.error({ hovered, held });
                }
                assert.notDeepEqual(held, hovered, `${kind}: visible mouse press feedback beyond hover`);
                await page.mouse.up();
                await page.mouse.move(4, 4);
                await page.waitForTimeout(400);
                assert.deepEqual(await style(probe), initial, `${kind}: mouse press clears`);
                assert.equal(await probe.getAttribute('aria-pressed'), 'true');
                assert.equal(await probe.evaluate(element => element.classList.contains('active')), true);
                const beforeTouch = await page.evaluate(() => kPressClicks);
                await probe.tap();
                const touched = await style(probe);
                await page.waitForTimeout(400);
                assert.notDeepEqual(touched, await style(probe), `${kind}: quick touch visibly registers and clears`);
                await page.mouse.move(4, 4);
                await page.waitForTimeout(100);
                assert.deepEqual(await style(probe), initial, `${kind}: touch press returns to baseline`);
                assert.equal(await page.evaluate(() => kPressClicks), beforeTouch + 1, `${kind}: no duplicate touch activation`);
                if (kind === 'button' || kind === 'input') {
                    for (const key of ['Enter', 'Space']) {
                        await probe.focus();
                        await page.waitForTimeout(30);
                        const beforeKey = await style(probe);
                        const beforeClicks = await page.evaluate(() => kPressClicks);
                        await page.keyboard.down(key);
                        assert.notDeepEqual(await style(probe), beforeKey, `${kind}: ${key} press visible`);
                        await page.keyboard.up(key);
                        await page.waitForTimeout(400);
                        assert.equal(await page.evaluate(() => kPressClicks), beforeClicks + 1, `${kind}: native ${key} activation is not duplicated`);
                        assert.equal(await probe.getAttribute('data-ui-pressed'), null, `${kind}: ${key} release clears`);
                        assert.equal((await style(probe)).shadow, beforeKey.shadow, `${kind}: temporary press shadow clears without hiding the focus ring`);
                    }
                }
                pressResults.push({ kind, initial, held });
            }
            const buttonCoverage = await page.evaluate(() => {
                const failures = [];
                let checked = 0;
                for (const button of document.querySelectorAll('button,input[type="button"],input[type="submit"],input[type="reset"],[role="button"]')) {
                    if (!button.getClientRects().length || button.matches(':disabled') || button.closest('[aria-disabled="true"],[inert]')) continue;
                    const before = getComputedStyle(button).boxShadow;
                    button.setAttribute('data-ui-pressed', 'true');
                    const during = getComputedStyle(button).boxShadow;
                    button.removeAttribute('data-ui-pressed');
                    checked += 1;
                    if (before === during) failures.push({ id: button.id, className: button.className });
                }
                return { checked, failures };
            });
            assert.ok(buttonCoverage.checked > 50, 'Survey covers native buttons throughout the actual app');
            assert.deepEqual(buttonCoverage.failures, [], 'All enabled app button families visibly depress');
            const cancelProbe = await fixture(page);
            await cancelProbe.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 77, button: 0 });
            assert.equal(await cancelProbe.getAttribute('data-ui-pressed'), 'true');
            await cancelProbe.dispatchEvent('blur');
            assert.equal(await cancelProbe.getAttribute('data-ui-pressed'), 'true', 'Descendant focus changes do not clear a held pointer press');
            await cancelProbe.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 77 });
            assert.equal(await cancelProbe.getAttribute('data-ui-pressed'), null, 'Cancelled presses clear immediately');
            await cancelProbe.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 78, button: 0 });
            await page.evaluate(() => window.dispatchEvent(new Event('blur')));
            assert.equal(await cancelProbe.getAttribute('data-ui-pressed'), null, 'Window blur clears held press');
            const disabled = await fixture(page);
            await disabled.evaluate(element => { element.disabled = true; });
            const disabledStyle = await style(disabled);
            await disabled.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 42, button: 0 });
            assert.deepEqual(await style(disabled), disabledStyle, 'Disabled button does not show press feedback');
            await page.evaluate(() => document.getElementById('kPressFixture').remove());
            await page.locator('#performanceBastardLoopKClearBtn').tap();
            await page.waitForFunction(() => !bastardLoopKRawBuffer && !bastardLoopKBuffer);
            await page.waitForFunction(() => document.getElementById('performanceBastardLoopKMeta').textContent.includes('Record'));
            assert.doesNotMatch(await meta.textContent(), warningPattern, 'Clearing K removes the cut-off warning');
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
            results.push({ viewport, longInfo, purple, pressResults, buttonCoverage });
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(blockedWrites, []);
        fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
        console.log(JSON.stringify({ passed: results.length, errors, blockedWrites, evidence, results }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
