const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const base = process.env.AI_PATCH_TEST_URL || 'http://127.0.0.1:18876/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const controls = require('../ai-patch-controls.json').controls;
const evidence = process.env.AI_PATCH_EVIDENCE || '/tmp/mygrain-ai-evidence';
fs.mkdirSync(evidence, { recursive: true });
const recipe = { title: 'Soft Pink', description: 'A smoother, wider direction for the existing granular sounds.', parameters: { grainSize: 320, attack: 1400, release: 3900, grainMainSmoothing: 78, grainMainWidth: 80, lpfCutoff: 3900, hpfCutoff: 60 } };
const results = [];
(async () => {
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        if (process.env.AI_PATCH_ENGINES && !process.env.AI_PATCH_ENGINES.split(',').includes(engine)) continue;
        const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
                if (process.env.AI_PATCH_WIDTHS && !process.env.AI_PATCH_WIDTHS.split(',').includes(String(viewport.width))) continue;
                const context = await browser.newContext({ viewport, isMobile: viewport.width < 960, hasTouch: viewport.width < 960 });
                const page = await context.newPage();
                page.setDefaultTimeout(30000);
                const errors = [];
                page.on('pageerror', error => errors.push(error.message));
                page.on('response', response => { if (response.status() >= 400 && response.url().includes('ai-patch')) console.error('AI asset response', response.status(), response.url()); });
                let mode = 'normal', release, received = 0;
                await page.route('**/*', async route => {
                    const url = new URL(route.request().url());
                    if (url.origin !== new URL(base).origin) return route.abort();
                    if (url.pathname.endsWith('/api/ai-patch-direction')) {
                        received++;
                        const data = route.request().postDataJSON();
                        assert.equal(Object.keys(data.current).length, 21);
                        assert.equal(data.model, undefined);
                        const responseMode = mode;
                        if (responseMode === 'hold') await new Promise(resolve => release = resolve);
                        const payload = responseMode === 'error' ? { ok: false, error: 'AI temporarily unavailable.' } : { ok: true, model: 'openai/gpt-6.1-sol', recipe: responseMode === 'invalid' ? { ...recipe, parameters: { volume: 150 } } : recipe };
                        try { await route.fulfill({ status: responseMode === 'error' ? 503 : 200, contentType: 'application/json', body: JSON.stringify(payload) }); } catch {}
                        return;
                    }
                    return route.continue();
                });
                try {
                    const user = 'aibeta' + Date.now();
                    const registration = await context.request.post(new URL('api/auth/register', base).href, { data: { username: user, password: 'isolated-ai-test-fixture' } });
                    assert.equal(registration.status(), 200);
                    await page.goto(base, { waitUntil: 'load' });
                    await page.waitForFunction(() => window.mygrainAiPatch?.ready && window.mygrainSongBeta && !mygrainSongBeta.busy);
                    await page.evaluate(async () => { document.getElementById('aiPatchPrompt').value = 'Warm, soft and wide, with a gentle slow attack.'; await mygrainAiPatch.generate(); });
                    await page.waitForFunction(() => document.getElementById('aiPatchStatus').textContent.includes('Start MYGRAIN'));
                    assert.equal(received, 0);
                    await page.locator('#start-btn').click();
                    await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                    await page.evaluate(() => { setSliderValue('hpfCutoff', 1250); syncPerformanceControlState(); });
                    console.log('Started', engine, viewport.width);
                    const baseline = await page.evaluate(() => mygrainAiPatchAdapter.fingerprint());
                    if (viewport.width < 960) {
                        await page.locator('#sectionJumpHandle').click();
                        await page.locator('#sectionJumpPanel [data-jump-target="#aiPatchCard"]').waitFor({ state: 'visible' });
                        const tile = await page.locator('#sectionJumpPanel [data-jump-target="#aiPatchCard"]').evaluate(el => ({ col: getComputedStyle(el).gridColumn, height: el.getBoundingClientRect().height }));
                        assert.equal(tile.col, '1 / -1'); assert(tile.height >= 60);
                        await page.screenshot({ path: path.join(evidence, `${engine}-${viewport.width}-jump.png`) });
                        await page.locator('#sectionJumpPanel [data-jump-target="#aiPatchCard"]').click();
                    } else {
                        const tile = await page.locator('#sectionJumpAiBtn').evaluate(el => ({ col: getComputedStyle(el).gridColumn, height: el.getBoundingClientRect().height }));
                        assert.equal(tile.col, '1 / -1'); assert(tile.height >= 60);
                        await page.screenshot({ path: path.join(evidence, `${engine}-${viewport.width}-jump.png`) });
                        await page.locator('#sectionJumpAiBtn').click();
                    }
                    await page.waitForFunction(() => document.getElementById('aiPatchCard').getBoundingClientRect().top > -40 && document.getElementById('aiPatchCard').getBoundingClientRect().top < innerHeight);
                    const layout = await page.locator('#aiPatchCard').evaluate(el => {
                        const rect = el.getBoundingClientRect(); const style = getComputedStyle(el);
                        return { background: style.backgroundImage, left: rect.left, right: rect.right, width: innerWidth, overflow: el.scrollWidth > el.clientWidth + 1 };
                    });
                    assert.match(layout.background, /255, 77, 170/); assert(!layout.overflow); assert(layout.left >= -1 && layout.right <= layout.width + 1, JSON.stringify(layout));
                    await page.locator('#aiPatchGenerate').click();
                    await page.waitForFunction(() => document.getElementById('aiPatchStatus').textContent.includes('Proposal ready'));
                    assert.equal(await page.evaluate(() => mygrainAiPatchAdapter.fingerprint()), baseline, 'generation never applies');
                    await page.screenshot({ path: path.join(evidence, `${engine}-${viewport.width}-proposal.png`), fullPage: false });
                    await page.evaluate(() => { window.__aiAudioContext = audioContext; });
                    await page.locator('#aiPatchApply').click();
                    assert.equal(await page.evaluate(() => audioContext === window.__aiAudioContext && audioContext.state === 'running'), true);
                    const applied = await page.evaluate(() => gatherPreset());
                    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem(STATE_STORAGE_KEY)).sliders);
                    for (const [key, value] of Object.entries(recipe.parameters)) assert.equal(Number(persisted[key]), value, 'autosaved control ' + key);
                    for (const [key, value] of Object.entries(recipe.parameters)) assert.equal(Number(applied.sliders[key]), value);
                    assert.equal(applied.sliders.performanceLpfCutoff, applied.sliders.lpfCutoff);
                    assert.equal(applied.sliders.performanceHpfCutoff, applied.sliders.hpfCutoff);
                    const beforePreset = JSON.parse(baseline).preset;
                    for (const [key, value] of Object.entries(beforePreset.sliders)) if (!Object.hasOwn(recipe.parameters, key) && !['performanceLpfCutoff', 'performanceHpfCutoff'].includes(key)) assert.equal(applied.sliders[key], value, 'protected slider ' + key);
                    const other = value => { const copy = structuredClone(value); delete copy.timestamp; delete copy.sliders; return copy; };
                    assert.deepEqual(other(applied), other(beforePreset), 'samples, toggles, arrangement and source selection are unchanged');
                    await page.locator('#aiPatchUndo').click();
                    assert.equal(await page.evaluate(() => mygrainAiPatchAdapter.fingerprint()), baseline, 'Undo restores exact prior patch state');
                    // A stale proposal cannot overwrite any intervening control edit.
                    await page.locator('#aiPatchGenerate').click();
                    await page.waitForFunction(() => document.getElementById('aiPatchStatus').textContent.includes('Proposal ready'));
                    await page.evaluate(() => setSliderValue('grainSize', 123));
                    await page.locator('#aiPatchApply').click();
                    assert.equal(await page.locator('#grainSize').inputValue(), '123');
                    assert.match(await page.locator('#aiPatchStatus').textContent(), /patch changed/);
                    // Cancel and late response handling.
                    mode = 'hold'; const count = received;
                    await page.locator('#aiPatchGenerate').click();
                    await page.waitForFunction(() => mygrainAiPatch.busy);
                    while (received === count) await new Promise(resolve => setTimeout(resolve, 20));
                    await page.locator('#aiPatchCancel').click(); release();
                    await page.waitForFunction(() => !mygrainAiPatch.busy);
                    assert.equal(await page.locator('#aiPatchApply').isVisible(), false);
                    assert.equal(await page.locator('#grainSize').inputValue(), '123');
                    // A patch edit during generation invalidates its result too.
                    const count2 = received;
                    await page.locator('#aiPatchGenerate').click();
                    while (received === count2) await new Promise(resolve => setTimeout(resolve, 20));
                    await page.evaluate(() => setSliderValue('grainSize', 124)); release();
                    await page.waitForFunction(() => !mygrainAiPatch.busy);
                    assert.match(await page.locator('#aiPatchStatus').textContent(), /changed while/);
                    mode = 'error'; await page.locator('#aiPatchGenerate').click();
                    await page.waitForFunction(() => !mygrainAiPatch.busy);
                    assert.match(await page.locator('#aiPatchStatus').textContent(), /temporarily unavailable/);
                    assert.equal(await page.evaluate(() => mygrainAccounts.authenticated), true);
                    mode = 'invalid'; await page.locator('#aiPatchGenerate').click();
                    await page.waitForFunction(() => !mygrainAiPatch.busy);
                    assert.match(await page.locator('#aiPatchStatus').textContent(), /Unsupported/);
                    mode = 'normal';
                    await page.evaluate(() => mygrainSongBeta.busy = true);
                    const busyCount = received; await page.locator('#aiPatchGenerate').click();
                    assert.equal(received, busyCount);
                    assert.match(await page.locator('#aiPatchStatus').textContent(), /Finish recording/);
                    await page.evaluate(() => mygrainSongBeta.busy = false);
                    // Keep leaves the applied patch in ordinary persisted/exported controls.
                    await page.locator('#aiPatchGenerate').click();
                    await page.waitForFunction(() => document.getElementById('aiPatchStatus').textContent.includes('Proposal ready'));
                    await page.locator('#aiPatchApply').click();
                    assert.equal(Number(await page.locator('#grainSize').inputValue()), 320);
                    await page.locator('#aiPatchKeep').click();
                    assert.equal(await page.locator('#aiPatchUndo').isVisible(), false);
                    assert.equal(await page.locator('#aiPatchGenerate').isEnabled(), true);
                    // Account lock cancels work; late model results never enter another session.
                    mode = 'hold'; const count3 = received;
                    await page.locator('#aiPatchGenerate').click();
                    while (received === count3) await new Promise(resolve => setTimeout(resolve, 20));
                    await page.evaluate(() => window.dispatchEvent(new Event('mygrain-account-lock'))); release();
                    await page.waitForFunction(() => !mygrainAiPatch.busy);
                    assert.equal(await page.locator('#aiPatchGenerate').isDisabled(), true);
                    assert.equal(await page.locator('#aiPatchApply').isVisible(), false);
                    assert.deepEqual(errors, []);
                    results.push({ engine, viewport, checks: ['pink-card', 'two-column-jump', 'start-guard', 'proposal-only', 'apply', 'protected-state', 'exact-undo', 'stale-apply', 'cancel', 'stale-response', 'provider-error-no-logout', 'invalid-recipe', 'song-busy', 'keep', 'account-lock'], errors });
                    console.log(JSON.stringify(results.at(-1)));
                } catch (error) {
                    console.error('DIAGNOSTIC', await page.evaluate(() => ({ ready: window.mygrainAiPatch?.ready, account: window.mygrainAccounts?.authenticated, status: document.getElementById('aiPatchStatus')?.textContent, errors: window.__errors })), errors);
                    await page.screenshot({ path: path.join(evidence, `${engine}-${viewport.width}-failure.png`) });
                    throw error;
                } finally { release?.(); await context.close(); }
            }
        } finally { await browser.close(); }
    }
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
