const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const base = process.env.WAV_BROWSER_TEST_URL || 'http://127.0.0.1:8765/mygrain/';
const evidence = process.env.WAV_RESPONSIVENESS_EVIDENCE || '/tmp/mygrain-wav-responsiveness.json';
const baselineHtml = process.env.WAV_RESPONSIVENESS_BASELINE_HTML;
const headers = { 'Access-Control-Allow-Origin': '*' };
const fixtureCount = Number(process.env.WAV_RESPONSIVENESS_COUNT || 2000);
const lastIndex = fixtureCount - 1;
const lastName = `fixture-${String(lastIndex).padStart(5, '0')}.wav`;
const previousName = `fixture-${String(lastIndex - 1).padStart(5, '0')}.wav`;
const fixtures = Array.from({ length: fixtureCount }, (_, index) => ({
    name: `fixture-${String(index).padStart(5, '0')}.wav`,
    size: 64000000,
    modified: 1792000000,
    url: `https://openclaw.blackcarburning.com/mygrain-wavs/responsiveness-fixture-${index}.wav`,
    feedback: { comment: index === lastIndex ? 'Existing saved note' : '', reaction: index === lastIndex ? 'love' : '' }
}));

function waitForRelease() {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    return { promise, release };
}

(async () => {
    assert.match(base, /^https?:\/\/(?:127\.0\.0\.1:\d+|localhost:\d+|openclaw\.blackcarburning\.com)\/mygrain\/$/);
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const results = [];
    const errors = [];
    const writes = [];
    const failures = [];
    const check = (condition, message) => { if (!condition) failures.push(message); };
    try {
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true });
            page.setDefaultTimeout(30000);
            const result = { viewport, mediaRequests: 0, listRequests: 0, abortedRequests: [], checks: {} };
            results.push(result);
            const heldList = waitForRelease();
            const heldPreview = waitForRelease();
            let delayList = false;
            let retryPreview = false;
            let retryStarted = false;
            page.on('pageerror', error => errors.push(error.message));
            page.on('requestfailed', request => {
                if (request.url().includes('/mygrain-wavs/')) result.abortedRequests.push(request.url());
            });
            await page.route('**/*', async route => {
                const request = route.request();
                const url = new URL(request.url());
                if (!['GET', 'HEAD'].includes(request.method())) {
                    writes.push({ method: request.method(), url: request.url() });
                    return route.abort();
                }
                if (baselineHtml && url.pathname === '/mygrain/') {
                    return route.fulfill({ path: baselineHtml, contentType: 'text/html' });
                }
                if (url.pathname === '/mygrain-wavs/api/list') {
                    result.listRequests += 1;
                    const delayed = delayList;
                    if (delayed) await heldList.promise;
                    else await new Promise(resolve => setTimeout(resolve, 100));
                    return route.fulfill({ headers, json: { ok: true, files: delayed ? [{ ...fixtures[0], name: 'stale-response.wav' }] : fixtures } }).catch(() => {});
                }
                if (url.pathname.startsWith('/mygrain-wavs/responsiveness-fixture-')) {
                    result.mediaRequests += 1;
                    if (url.searchParams.has('mygrain-preview-retry')) {
                        retryStarted = true;
                        await heldPreview.promise;
                    }
                    return route.fulfill({ headers, status: retryPreview ? 503 : 404, body: 'Synthetic preview failure' }).catch(() => {});
                }
                if (url.origin !== new URL(base).origin) return route.abort();
                return route.continue();
            });
            try {
                await page.goto(base, { waitUntil: 'load' });
                await page.locator('#start-btn').tap();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                await page.evaluate(() => {
                    const buffer = audioContext.createBuffer(1, audioContext.sampleRate / 10, audioContext.sampleRate);
                    const samples = buffer.getChannelData(0);
                    for (let frame = 0; frame < samples.length; frame += 1) samples[frame] = .02 * Math.sin(frame * Math.PI * 2 * 120 / buffer.sampleRate);
                    drumMachineKickBuffer = buffer;
                    setDrumMachinePattern('kick', Array.from({ length: 16 }, (unused, index) => index % 4 === 0), { skipSave: true });
                    if (!startDrumMachine(audioContext.currentTime + .1, { silent: true, skipSave: true })) throw new Error('Drum transport failed to start');
                    window.wavRepositoryTransport = { origin: drumMachineTransportStartTime, modulation: modulationIntervalId };
                    window.wavResponsiveness = { largestGap: 0, lastTick: performance.now(), ticks: 0 };
                    window.wavResponsivenessTimer = setInterval(() => {
                        const now = performance.now();
                        wavResponsiveness.largestGap = Math.max(wavResponsiveness.largestGap, now - wavResponsiveness.lastTick);
                        wavResponsiveness.lastTick = now;
                        wavResponsiveness.ticks += 1;
                    }, 20);
                });
                const opening = Date.now();
                await page.evaluate(() => openWavRepositoryBrowser());
                await page.waitForFunction(() => document.querySelector('#wavRepositoryBrowserList .sample-browser-card'));
                await page.waitForTimeout(150);
                result.openMs = Date.now() - opening;
                result.initialCards = await page.locator('#wavRepositoryBrowserList .sample-browser-card').count();
                result.initialAudioControls = await page.locator('#wavRepositoryBrowserList audio').count();
                result.idleMediaRequests = result.mediaRequests;
                result.initialLargestGapMs = await page.evaluate(() => wavResponsiveness.largestGap);
                check(result.initialCards > 0 && result.initialCards <= 50, `${viewport.width}: initial DOM must contain at most 50 cards, got ${result.initialCards}`);
                check(result.initialAudioControls <= 50, `${viewport.width}: native audio controls must be bounded`);
                check(result.idleMediaRequests === 0, `${viewport.width}: opening must not download unplayed WAVs`);
                check(result.initialLargestGapMs < 500, `${viewport.width}: opening blocked the main thread for ${result.initialLargestGapMs} ms`);

                await page.waitForFunction(() => document.querySelectorAll('#wavRepositoryBrowserList .sample-browser-card').length === 40);
                await page.locator('#wavRepositoryBrowserList textarea').first().fill('Unsaved first-page draft');
                await page.locator('#wavRepositoryBrowserNextBtn').tap();
                await page.waitForFunction(() => document.querySelectorAll('#wavRepositoryBrowserList .sample-browser-card').length === 40 && document.querySelector('#wavRepositoryBrowserList .sample-browser-name')?.textContent === 'fixture-00040.wav');
                result.checks.nextPageWorks = true;
                await page.locator('#wavRepositoryBrowserPreviousBtn').tap();
                await page.waitForFunction(() => document.querySelectorAll('#wavRepositoryBrowserList .sample-browser-card').length === 40 && document.querySelector('#wavRepositoryBrowserList .sample-browser-name')?.textContent === 'fixture-00000.wav');
                result.checks.draftRetainedAcrossPages = await page.locator('#wavRepositoryBrowserList textarea').first().inputValue() === 'Unsaved first-page draft';
                check(result.checks.draftRetainedAcrossPages, `${viewport.width}: paging lost the unsaved note draft`);
                await page.evaluate(async () => {
                    window.wavRepositoryOriginalControl = document.querySelector('#wavRepositoryBrowserList audio');
                    await refreshWavRepositoryBrowser({ forceRefresh: true });
                });
                result.checks.unchangedRefreshRetainsControls = await page.evaluate(() => window.wavRepositoryOriginalControl === document.querySelector('#wavRepositoryBrowserList audio'));
                check(result.checks.unchangedRefreshRetainsControls, `${viewport.width}: unchanged refresh rebuilt preview controls`);

                await page.locator('#wavRepositoryBrowserFilter').fill(lastName);
                await page.waitForFunction(name => document.querySelectorAll('#wavRepositoryBrowserList .sample-browser-card').length === 1 && document.querySelector('#wavRepositoryBrowserList .sample-browser-name')?.textContent === name, lastName);
                result.checks.searchAcrossWholeRepository = true;
                check(await page.locator('#wavRepositoryBrowserList textarea').inputValue() === 'Existing saved note', `${viewport.width}: saved note missing after search`);
                await page.locator('#wavRepositoryBrowserList textarea').fill('Unsaved local fixture draft');
                await page.locator('#wavRepositoryBrowserFilter').fill(previousName);
                await page.waitForFunction(name => document.querySelector('#wavRepositoryBrowserList .sample-browser-name')?.textContent === name, previousName);
                await page.locator('#wavRepositoryBrowserFilter').fill(lastName);
                await page.waitForFunction(name => document.querySelector('#wavRepositoryBrowserList .sample-browser-name')?.textContent === name, lastName);
                result.checks.draftRetainedAcrossFilter = await page.locator('#wavRepositoryBrowserList textarea').inputValue() === 'Unsaved local fixture draft';
                check(result.checks.draftRetainedAcrossFilter, `${viewport.width}: filtering lost the unsaved note draft`);

                retryPreview = true;
                await page.locator('#wavRepositoryBrowserList audio').evaluate(audio => { audio.play().catch(() => {}); });
                await new Promise((resolve, reject) => {
                    const deadline = Date.now() + 5000;
                    const poll = () => retryStarted ? resolve() : Date.now() > deadline ? reject(new Error('Preview recovery did not start')) : setTimeout(poll, 20);
                    poll();
                });
                const closingPreview = Date.now();
                await page.locator('#wavRepositoryBrowserCloseBtn').tap();
                await page.locator('#wavRepositoryBrowserOverlay').waitFor({ state: 'hidden' });
                result.previewCloseMs = Date.now() - closingPreview;
                await page.waitForTimeout(80);
                result.retainedMediaAfterClose = await page.locator('#wavRepositoryBrowserList audio[src]').count();
                result.checks.previewRetryAborted = result.abortedRequests.some(url => url.includes('mygrain-preview-retry='));
                check(result.previewCloseMs < 500, `${viewport.width}: close took ${result.previewCloseMs} ms`);
                check(result.retainedMediaAfterClose === 0, `${viewport.width}: close retained native media sources`);
                check(result.checks.previewRetryAborted, `${viewport.width}: close did not abort the full-WAV retry`);
                heldPreview.release();
                await page.waitForTimeout(80);

                await page.evaluate(() => openWavRepositoryBrowser());
                await page.waitForFunction(() => !wavRepositoryBrowserLoading && document.querySelector('#wavRepositoryBrowserList .sample-browser-card'));
                delayList = true;
                const requestsBefore = result.listRequests;
                await page.locator('#wavRepositoryBrowserRefreshBtn').tap();
                await page.waitForFunction(() => wavRepositoryBrowserLoading);
                const closingList = Date.now();
                await page.locator('#wavRepositoryBrowserCloseBtn').tap();
                await page.locator('#wavRepositoryBrowserOverlay').waitFor({ state: 'hidden' });
                result.listCloseMs = Date.now() - closingList;
                result.checks.loadingResetOnClose = await page.evaluate(() => !wavRepositoryBrowserLoading);
                check(result.listCloseMs < 500, `${viewport.width}: close during listing took ${result.listCloseMs} ms`);
                check(result.checks.loadingResetOnClose, `${viewport.width}: close left list loading active`);
                await page.waitForTimeout(80);
                result.checks.listRequestAborted = result.listRequests > requestsBefore && result.abortedRequests.some(url => url.includes('/api/list'));
                check(result.checks.listRequestAborted, `${viewport.width}: close did not abort the pending listing`);
                heldList.release();
                await page.waitForTimeout(150);
                result.checks.staleResponseIgnored = await page.evaluate(() => !document.querySelector('#wavRepositoryBrowserList .sample-browser-name')?.textContent.includes('stale-response') && !document.body.classList.contains('wav-repository-browser-open'));
                check(result.checks.staleResponseIgnored, `${viewport.width}: cancelled listing repainted after close`);
                delayList = false;
                retryPreview = false;
                await page.evaluate(() => openWavRepositoryBrowser());
                await page.waitForFunction(() => !wavRepositoryBrowserLoading && document.querySelector('#wavRepositoryBrowserList .sample-browser-name')?.textContent === 'fixture-00000.wav');
                result.reopenedCards = await page.locator('#wavRepositoryBrowserList .sample-browser-card').count();
                check(result.reopenedCards <= 50, `${viewport.width}: reopening rendered an unbounded list`);
                await page.screenshot({ path: evidence.replace(/\.json$/, `-${viewport.width}.png`) });
                await page.locator('#wavRepositoryBrowserCloseBtn').tap();
                result.checks.audioContextStillRunning = await page.evaluate(() => audioContext.state === 'running');
                check(result.checks.audioContextStillRunning, `${viewport.width}: repository closing suspended the app audio context`);
                result.checks.transportUnchanged = await page.evaluate(() => drumMachinePlaying && drumMachineTransportStartTime === wavRepositoryTransport.origin && modulationIntervalId === wavRepositoryTransport.modulation);
                check(result.checks.transportUnchanged, `${viewport.width}: repository operations restarted or stopped playback`);
                check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${viewport.width}: page overflow`);
                await page.evaluate(() => clearInterval(window.wavResponsivenessTimer));
            } catch (error) {
                failures.push(`${viewport.width}: ${error.message}`);
            } finally {
                heldList.release();
                heldPreview.release();
                await page.close();
                fs.writeFileSync(evidence, JSON.stringify({ results, errors, writes, failures }, null, 2));
            }
        }
        check(errors.length === 0, `Uncaught browser errors: ${errors.join('; ')}`);
        check(writes.length === 0, `Unexpected network writes: ${JSON.stringify(writes)}`);
        fs.writeFileSync(evidence, JSON.stringify({ results, errors, writes, failures }, null, 2));
        console.log(JSON.stringify({ evidence, results, errors, writes, failures }, null, 2));
        assert.deepEqual(failures, []);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
