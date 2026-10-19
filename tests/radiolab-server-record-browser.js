const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium, webkit } = require('playwright-core');

const base = process.env.RADIOLAB_TEST_URL || 'http://127.0.0.1:18840/mygrain/';
const origin = new URL(base).origin;
const local = /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base);
const engine = process.env.RADIOLAB_TEST_ENGINE || 'chromium';
const username = process.env.RADIOLAB_TEST_USERNAME || 'dan';
const password = process.env.RADIOLAB_TEST_PASSWORD || (local ? 'charged' : '');
const evidence = process.env.RADIOLAB_EVIDENCE;
const expectedBuild = process.env.RADIOLAB_TEST_BUILD || 'v2026.10.17.R.10';
const stations = (process.env.RADIOLAB_CAPTURE_STATIONS || 'rthk-radio1,resonance-fm').split(',');
const timeout = Number(process.env.RADIOLAB_RECORD_TIMEOUT || 35000);
const baselineErrors = process.env.RADIOLAB_BASELINE_ERRORS
    ? JSON.parse(fs.readFileSync(process.env.RADIOLAB_BASELINE_ERRORS, 'utf8')).errorDetails || [] : [];
const results = { base, engine, checks: [], stations: [], errors: [], blockedWrites: [], streams: [] };
if (!password || !evidence || !['chromium', 'webkit'].includes(engine)) throw new Error('Provide evidence, credentials and a supported engine.');

function checked(name, condition = true) {
    assert.ok(condition, name);
    results.checks.push(name);
}

function pcmStats(bytes) {
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert.equal(bytes.readUInt16LE(20), 1);
    assert.equal(bytes.readUInt16LE(34), 16);
    const channels = bytes.readUInt16LE(22);
    const sampleRate = bytes.readUInt32LE(24);
    let peak = 0;
    let energy = 0;
    for (let offset = 44; offset + 1 < bytes.length; offset += 2) {
        const sample = bytes.readInt16LE(offset) / 32768;
        peak = Math.max(peak, Math.abs(sample));
        energy += sample * sample;
    }
    return { channels, sampleRate, duration: (bytes.length - 44) / (channels * 2 * sampleRate),
        peak, rms: Math.sqrt(energy / ((bytes.length - 44) / 2)) };
}

async function installSilentTap(context) {
    await context.addInitScript(() => {
        window.__radiolabSilentTapChunks = 0;
        const OriginalWorklet = window.AudioWorkletNode;
        if (OriginalWorklet) {
            window.AudioWorkletNode = class extends OriginalWorklet {
                constructor(...args) {
                    super(...args);
                    if (args[1] !== 'mygrain-radiolab-tap') return;
                    this.port.addEventListener('message', event => {
                        if (event.data?.type !== 'pcm') return;
                        for (const channel of event.data.channels || []) channel.fill(0);
                        window.__radiolabSilentTapChunks += 1;
                    });
                }
            };
        }
        const Context = window.AudioContext || window.webkitAudioContext;
        const createProcessor = Context?.prototype.createScriptProcessor;
        if (!createProcessor) return;
        Context.prototype.createScriptProcessor = function (...args) {
            const processor = createProcessor.apply(this, args);
            const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(processor), 'onaudioprocess');
            Object.defineProperty(processor, 'onaudioprocess', {
                configurable: true,
                set(handler) {
                    descriptor.set.call(processor, handler && (event => {
                        window.__radiolabSilentTapChunks += 1;
                        handler({ outputBuffer: event.outputBuffer, inputBuffer: {
                            numberOfChannels: event.inputBuffer.numberOfChannels,
                            getChannelData: channel => new Float32Array(event.inputBuffer.getChannelData(channel).length)
                        } });
                    }));
                },
                get() { return descriptor.get.call(processor); }
            });
            return processor;
        };
    });
}

(async () => {
    const browser = await (engine === 'webkit' ? webkit : chromium).launch(engine === 'webkit'
        ? { headless: true }
        : { executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    let page;
    let companion;
    try {
        await installSilentTap(context);
        if (!local) await context.route('**/*', route => {
            const request = route.request();
            if (!['GET', 'HEAD'].includes(request.method())
                && new URL(request.url()).pathname !== '/mygrain/api/radiolab/stream/release') {
                results.blockedWrites.push(new URL(request.url()).pathname);
                return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Read-only verification"}' });
            }
            return route.continue();
        });
        const login = await context.request.post(origin + '/mygrain/api/auth/login', {
            headers: { Origin: origin }, data: { username, password }
        });
        checked('Authenticated verification session', login.status() === 200);
        page = await context.newPage();
        page.on('pageerror', error => results.errors.push({ message: error.message, stack: error.stack }));
        page.on('response', response => {
            const url = new URL(response.url());
            if (!url.pathname.startsWith('/mygrain/radiolab/stream/')) return;
            results.streams.push({ station: url.pathname.split('/').pop(), format: url.searchParams.get('_radiolab_format'),
                status: response.status() });
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.locator('#start-btn').tap();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended
            && window.mygrainRadiolab && !window.mygrainRadiolab.state.busy);
        checked('Expected build active', await page.evaluate(() => window.mygrainRadiolab.state.build) === expectedBuild);
        results.servedHashes = {};
        for (const asset of ['radiolab.js', 'radiolab.css']) {
            const response = await context.request.get(new URL(asset, base).href);
            assert.equal(response.status(), 200);
            const served = crypto.createHash('sha256').update(await response.body()).digest('hex');
            const source = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', asset))).digest('hex');
            results.servedHashes[asset] = served;
            checked(`${asset}: served bytes match the deployed source`, served === source);
        }
        checked('Rewind and rewind audition are removed from the UI',
            !await page.locator('#radiolabRewind').isVisible() && !await page.locator('#radiolabAudition').isVisible());
        for (const station of stations) {
            const item = { station, targets: [] };
            results.stations.push(item);
            await page.locator('#radiolabStation').selectOption(station);
            await page.locator('#radiolabListen').tap();
            await page.waitForFunction(() => window.mygrainRadiolab.state.listening
                && !window.mygrainRadiolab.state.busy && window.mygrainRadiolab.diagnostics.media?.currentTime > 0.3,
            null, { timeout });
            const before = await page.evaluate(() => window.mygrainRadiolab.diagnostics.media.currentTime);
            await page.waitForFunction(previous => window.mygrainRadiolab.diagnostics.media.currentTime > previous + 0.3,
                before, { timeout: 5000 });
            checked(`${station}: native station playback advances`);
            checked(`${station}: Web Audio tap has no signal`, !await page.evaluate(() => window.mygrainRadiolab.diagnostics.hasSignal));
            if (local && process.env.RADIOLAB_TWO_LISTENERS !== '0' && !companion) {
                companion = await context.newPage();
                companion.on('pageerror', error => results.errors.push({ message: error.message, stack: error.stack }));
                await companion.goto(base, { waitUntil: 'load' });
                await companion.locator('#start-btn').tap();
                await companion.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended
                    && window.mygrainRadiolab && !window.mygrainRadiolab.state.busy);
                await companion.locator('#radiolabStation').selectOption('resonance-fm');
                await companion.locator('#radiolabListen').tap();
                await companion.waitForFunction(() => window.mygrainRadiolab.state.listening
                    && !window.mygrainRadiolab.state.busy, null, { timeout });
                checked('Second same-account station listener remains active during recording tests');
            }
            await page.locator('#radiolabRecord').tap();
            await page.waitForFunction(() => window.mygrainRadiolab.state.recording
                && window.mygrainRadiolab.state.recordedSeconds >= 2, null, { timeout });
            checked(`${station}: records despite silent browser tap`);
            item.recording = await page.evaluate(() => window.mygrainRadiolab.diagnostics);
            checked(`${station}: recording is not using browser-tap samples`, !item.recording.hasSignal);
            if (companion && !results.companionCaptured) {
                await companion.locator('#radiolabRecord').tap();
                await companion.waitForFunction(() => window.mygrainRadiolab.state.recording
                    && window.mygrainRadiolab.state.recordedSeconds >= 1, null, { timeout });
                checked('Two listeners and their recorders can run concurrently on one account',
                    await page.evaluate(() => window.mygrainRadiolab.state.recording));
                await companion.locator('#radiolabStop').tap();
                checked('Stopping another tab does not interrupt this recording',
                    await page.evaluate(() => window.mygrainRadiolab.state.recording));
                await companion.locator('#radiolabListen').tap();
                await companion.waitForFunction(() => window.mygrainRadiolab.state.listening
                    && !window.mygrainRadiolab.state.busy, null, { timeout });
                results.companionCaptured = true;
            }
            await page.locator('#radiolabStop').tap();
            checked(`${station}: Stop leaves an audible take`, await page.locator('#radiolabSave').isEnabled());
            checked(`${station}: Stop releases active capture`, !await page.evaluate(() => window.mygrainRadiolab.state.recording || window.mygrainRadiolab.state.armed));
            checked(`${station}: finished take exposes main-panel Preview and Normalize`, await page.locator('#radiolabPreview').isEnabled()
                && await page.locator('#radiolabNormalize').isEnabled());
            await page.locator('#radiolabPreview').tap();
            await page.waitForFunction(() => window.mygrainRadiolab.state.previewingTake, null, { timeout });
            await page.locator('#radiolabPreview').tap();
            checked(`${station}: main-panel preview stops without discarding the take`, await page.evaluate(() =>
                !window.mygrainRadiolab.state.previewing && window.mygrainRadiolab.state.hasTake));
            await page.locator('#radiolabNormalize').tap();
            await page.waitForFunction(() => window.mygrainRadiolab.state.normalized, null, { timeout });
            checked(`${station}: manual Normalize retains the stopped server take`, await page.evaluate(() => window.mygrainRadiolab.state.hasTake));
            for (let repeat = 1; repeat <= 3; repeat += 1) {
                if (repeat === 2) {
                    await page.locator('#radiolabListen').tap();
                    await page.waitForFunction(() => window.mygrainRadiolab.state.listening
                        && !window.mygrainRadiolab.state.busy, null, { timeout });
                }
                await page.locator('#radiolabRecord').tap();
                await page.waitForFunction(() => window.mygrainRadiolab.state.recording
                    && window.mygrainRadiolab.state.recordedSeconds >= 2, null, { timeout });
                await page.locator('#radiolabStop').tap();
                checked(`${station}: immediate repeat ${repeat} captures an audible take`,
                    await page.locator('#radiolabSave').isEnabled());
                checked(`${station}: repeat ${repeat} starts with fresh normalization state`, !await page.evaluate(() => window.mygrainRadiolab.state.normalized));
            }
            if (!local) continue;
            await page.locator('#radiolabName').fill(`Server capture regression ${station}`);
            const savedResponse = page.waitForResponse(response => response.url().includes('/api/radiolab/samples')
                && response.request().method() === 'POST');
            await page.locator('#radiolabSave').tap();
            const response = await savedResponse;
            const saved = await response.json();
            assert.equal(response.status(), 201, JSON.stringify(saved));
            item.filename = saved.sample.filename;
            const file = await context.request.get(origin + '/mygrain/api/radiolab/file?'
                + new URLSearchParams({ name: item.filename }), { headers: { 'X-Mygrain-User': username } });
            assert.equal(file.status(), 200);
            item.pcm = pcmStats(await file.body());
            checked(`${station}: saved WAV contains nonzero server PCM`, item.pcm.rms > 0.00001 && item.pcm.duration >= 2);
            checked(`${station}: saved WAV has server PCM format`, item.pcm.sampleRate === 44100 && item.pcm.channels === 2);
            checked(`${station}: Save normalizes the stored stereo WAV automatically`, item.pcm.peak >= 0.9999
                && item.pcm.peak <= 1 && await page.evaluate(() => window.mygrainRadiolab.state.normalized));
            await page.locator('#radiolabBrowser').tap();
            await page.waitForFunction(() => !window.mygrainRadiolab.state.busy);
            const savedRow = page.locator(`.radiolab-sample-row[data-filename=${JSON.stringify(item.filename)}]`);
            checked(`${station}: saved recording has its own browser row`, await savedRow.count() === 1);
            for (const action of ['play', 'load', 'delete']) {
                checked(`${station}: recording row exposes ${action}`, await savedRow.locator(`[data-action="${action}"]`).isVisible());
            }
            await savedRow.locator('[data-action="play"]').tap();
            await page.waitForFunction(() => window.mygrainRadiolab.state.previewing);
            checked(`${station}: saved recording previews`);
            await savedRow.locator('[data-action="play"]').tap();
            for (const target of ['grainMain', 'grainA', 'grainB', 'V']) {
                await page.locator('#radiolabLoadTarget').selectOption(target);
                await savedRow.locator('[data-action="load"]').tap();
                await page.waitForFunction(expected => document.querySelector('#radiolabBrowserStatus').textContent
                    .includes(`into ${expected === 'V' ? 'Loop V' : expected}.`), target);
                const loaded = await page.evaluate(target => {
                    const buffer = target === 'grainMain' ? grainMainSampleBuffer : target === 'grainA' ? grainASampleBuffer
                        : target === 'grainB' ? grainBSampleBuffer : bastardLoopVBuffer;
                    let peak = 0;
                    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
                        for (const sample of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
                    }
                    return { target, duration: buffer.duration, peak };
                }, target);
                assert.ok(Math.abs(loaded.duration - item.pcm.duration) < 0.1);
                assert.ok(Math.abs(loaded.peak - item.pcm.peak) < 0.002);
                item.targets.push(loaded);
                checked(`${station}: full recording loads into ${target}`);
            }
            if (station === stations[0]) {
                for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
                    await page.setViewportSize(viewport);
                    const layout = await savedRow.evaluate(element => {
                        const dialog = element.closest('dialog');
                        const controls = Array.from(element.querySelectorAll('button')).map(button => {
                            const bounds = button.getBoundingClientRect();
                            return { width: bounds.width, height: bounds.height };
                        });
                        return { fits: dialog.scrollWidth <= dialog.clientWidth + 1, controls };
                    });
                    checked(`${station}: recording browser fits ${viewport.width}x${viewport.height}`,
                        layout.fits && layout.controls.every(control => control.width >= 44 && control.height >= 44));
                    await page.screenshot({ path: evidence.replace(/\.json$/, `-browser-${viewport.width}.png`) });
                }
                await page.setViewportSize({ width: 390, height: 844 });
            }
            const beforeDelete = (await (await context.request.get(origin + '/mygrain/api/radiolab/samples',
                { headers: { 'X-Mygrain-User': username } })).json()).samples.map(sample => sample.filename);
            page.once('dialog', dialog => dialog.dismiss());
            await savedRow.locator('[data-action="delete"]').tap();
            checked(`${station}: cancelling Delete preserves the recording`, await savedRow.count() === 1);
            await savedRow.locator('[data-action="play"]').tap();
            await page.waitForFunction(() => window.mygrainRadiolab.state.previewing);
            page.once('dialog', dialog => dialog.accept());
            const deletedResponse = page.waitForResponse(response => response.url().includes('/api/radiolab/samples')
                && response.request().method() === 'DELETE');
            await savedRow.locator('[data-action="delete"]').tap();
            assert.equal((await deletedResponse).status(), 200);
            await savedRow.waitFor({ state: 'detached' });
            checked(`${station}: deleting the playing row stops preview`, !await page.evaluate(() => window.mygrainRadiolab.state.previewing));
            const afterDelete = (await (await context.request.get(origin + '/mygrain/api/radiolab/samples',
                { headers: { 'X-Mygrain-User': username } })).json()).samples.map(sample => sample.filename);
            assert.deepEqual(afterDelete.sort(), beforeDelete.filter(filename => filename !== item.filename).sort());
            checked(`${station}: Delete removes only the selected recording`);
            await page.locator('#radiolabBrowserClose').tap();
        }
        const previous = await page.evaluate(() => window.mygrainRadiolab.state.recordedSeconds);
        await context.route('**/radiolab/stream/*', route => new URL(route.request().url()).searchParams.get('_radiolab_format') === 'pcm'
            ? route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"Deliberate capture failure"}' }) : route.continue());
        await page.locator('#radiolabRecord').tap();
        await page.waitForFunction(() => !window.mygrainRadiolab.state.busy && !window.mygrainRadiolab.state.armed,
            null, { timeout });
        checked('Capture failure preserves previous take', await page.evaluate(() => window.mygrainRadiolab.state.recordedSeconds) === previous);
        checked('Capture failure permits retry', await page.locator('#radiolabRecord').isEnabled());
        await context.unroute('**/radiolab/stream/*');
        if (await page.locator('#radiolabStop').isEnabled()) await page.locator('#radiolabStop').tap();
        await page.locator('#radiolabRecord').tap();
        await page.waitForFunction(() => window.mygrainRadiolab.state.recording
            && window.mygrainRadiolab.state.recordedSeconds >= 1, null, { timeout });
        await page.locator('#radiolabStop').tap();
        checked('Record from idle recovers after capture failure', await page.locator('#radiolabSave').isEnabled());
        await page.locator('#radiolabNormalize').tap();
        await page.waitForFunction(() => window.mygrainRadiolab.state.normalized, null, { timeout });
        for (const width of [390, 844]) {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 390 });
            for (const id of ['radiolabPreview', 'radiolabNormalize']) {
                const control = page.locator(`#${id}`);
                await control.scrollIntoViewIfNeeded();
                const box = await control.boundingBox();
                checked(`${id}: ${width}px touch target fits the viewport`, box && box.height >= 44
                    && box.width >= 44 && box.x >= 0 && box.x + box.width <= width + 1);
            }
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#radiolabCard').screenshot({ path: evidence.replace(/\.json$/, '-main-panel.png') });
        await page.screenshot({ path: evidence.replace(/\.json$/, '-portrait.png') });
        await page.setViewportSize({ width: 844, height: 390 });
        await page.locator('#radiolabCard').scrollIntoViewIfNeeded();
        await page.screenshot({ path: evidence.replace(/\.json$/, '-landscape.png') });
        results.silentTapChunks = await page.evaluate(() => window.__radiolabSilentTapChunks);
        const comparableStack = stack => local ? stack.replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://127.0.0.1:<test-port>') : stack;
        const unexpected = results.errors.filter(error => !baselineErrors.some(baseline => baseline.message === error.message
            && comparableStack(baseline.stack) === comparableStack(error.stack)));
        checked('No new uncaught application errors against recorded baseline', unexpected.length === 0);
        checked('No 409 or 429 stream lock errors', !results.streams.some(stream => [409, 429].includes(stream.status)));
        if (!local) checked('No production sample or state writes attempted', results.blockedWrites.length === 0);
    } catch (error) {
        results.failure = error.stack;
        if (page) results.lastState = await page.evaluate(() => ({ state: window.mygrainRadiolab?.state,
            diagnostics: window.mygrainRadiolab?.diagnostics, status: document.querySelector('#radiolabStatus')?.textContent })).catch(() => null);
        process.exitCode = 1;
    } finally {
        if (companion) {
            await companion.locator('#radiolabStop').tap().catch(() => {});
            await companion.close().catch(() => {});
        }
        results.logoutStatus = (await context.request.post(origin + '/mygrain/api/auth/logout', { headers: { Origin: origin } }).catch(() => null))?.status();
        await context.close();
        await browser.close();
        fs.writeFileSync(evidence, JSON.stringify(results, null, 2));
        console.log(JSON.stringify(results, null, 2));
    }
})();
