const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const base = process.env.RADIOLAB_TEST_URL || 'http://127.0.0.1:18840/mygrain/';
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) {
    throw new Error('RADIOLAB acceptance writes require a disposable loopback backend.');
}
const origin = new URL(base).origin;
const evidence = process.env.RADIOLAB_EVIDENCE || '/tmp/mygrain-radiolab-acceptance/browser.json';
const results = { base, checks: [], errors: [], external: [] };

function checked(name, condition = true) {
    assert.ok(condition, name);
    results.checks.push(name);
}

function recordingAction(page, filename, action) {
    return page.locator(`.radiolab-sample-row[data-filename=${JSON.stringify(filename)}] [data-action=${JSON.stringify(action)}]`);
}

function radioFixture(seconds = 25) {
    const sampleRate = 24000;
    const frames = sampleRate * seconds;
    const bytes = Buffer.alloc(44 + frames * 2);
    bytes.write('RIFF');
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(sampleRate, 24);
    bytes.writeUInt32LE(sampleRate * 2, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(frames * 2, 40);
    for (let frame = 0; frame < frames; frame += 1) {
        const frequency = frame < sampleRate * 12 ? 220 : 660;
        bytes.writeInt16LE(Math.round(Math.sin(frame * 2 * Math.PI * frequency / sampleRate) * 8000), 44 + frame * 2);
    }
    return bytes;
}

function captureFixture() {
    const sampleRate = 44100;
    const bytes = Buffer.alloc(sampleRate * 3 * 4);
    for (let frame = 0; frame < sampleRate * 3; frame += 1) {
        const frequency = frame < sampleRate * 1.5 ? 220 : 660;
        const sample = Math.round(Math.sin(frame * 2 * Math.PI * frequency / sampleRate) * 8000);
        bytes.writeInt16LE(sample, frame * 4);
        bytes.writeInt16LE(sample, frame * 4 + 2);
    }
    return bytes;
}

function inspectWav(bytes) {
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    let format;
    let data;
    for (let offset = 12; offset + 8 <= bytes.length;) {
        const name = bytes.toString('ascii', offset, offset + 4);
        const size = bytes.readUInt32LE(offset + 4);
        if (name === 'fmt ') {
            format = { codec: bytes.readUInt16LE(offset + 8), channels: bytes.readUInt16LE(offset + 10),
                sampleRate: bytes.readUInt32LE(offset + 12), bits: bytes.readUInt16LE(offset + 22) };
        }
        if (name === 'data') data = bytes.subarray(offset + 8, offset + 8 + size);
        offset += 8 + size + (size % 2);
    }
    assert.ok(format && data, 'PCM WAV has format and data chunks');
    assert.equal(format.codec, 1);
    assert.equal(format.bits, 16);
    const frames = data.length / (format.channels * 2);
    let peak = 0;
    for (let offset = 0; offset < data.length; offset += 2) peak = Math.max(peak, Math.abs(data.readInt16LE(offset)));
    const frequencyAt = startSeconds => {
        const start = Math.max(0, Math.round(startSeconds * format.sampleRate));
        const count = Math.min(Math.round(format.sampleRate * 0.25), frames - start - 1);
        let crossings = 0;
        let energy = 0;
        for (let index = start + 1; index < start + count; index += 1) {
            const previous = data.readInt16LE((index - 1) * format.channels * 2);
            const sample = data.readInt16LE(index * format.channels * 2);
            if (previous <= 0 && sample > 0) crossings += 1;
            energy += sample * sample;
        }
        return { frequency: crossings * format.sampleRate / count, rms: Math.sqrt(energy / count) / 32768 };
    };
    return { ...format, frames, duration: frames / format.sampleRate, peak, frequencyAt };
}

async function api(context, username, path, options = {}) {
    const response = await context.request.fetch(origin + path, {
        ...options, headers: { 'X-Mygrain-User': username, ...options.headers }
    });
    return response;
}

async function login(page, username, password) {
    await page.goto(base, { waitUntil: 'load' });
    await page.locator('#mygrainLoginUsername').fill(username);
    await page.locator('#mygrainLoginPassword').fill(password);
    await page.locator('#mygrainLoginBtn').click();
    await page.waitForFunction(expected => window.mygrainAccountContext?.user?.username === expected, username);
    await page.waitForLoadState('load');
    await page.locator('#start-btn').click();
    await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
}

async function fits(page, selectors) {
    for (const selector of selectors) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        const bounds = await control.boundingBox();
        checked(`${selector}: accessible at ${page.viewportSize().width}px`, bounds && bounds.width > 0
            && bounds.x >= -1 && bounds.x + bounds.width <= page.viewportSize().width + 1);
        checked(`${selector}: unobscured at ${page.viewportSize().width}px`, await control.evaluate(element => {
            const bounds = element.getBoundingClientRect();
            const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            return element === target || element.contains(target);
        }));
    }
}

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const contexts = [];
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        contexts.push(context);
        const fixture = radioFixture();
        let streamDelay = 0;
        await context.route('**/*', async route => {
            const address = new URL(route.request().url());
            if (address.origin === origin && address.pathname.startsWith('/mygrain/radiolab/stream/')) {
                const delay = streamDelay;
                streamDelay = 0;
                if (delay) await new Promise(resolve => setTimeout(resolve, delay));
                if (address.searchParams.get('_radiolab_format') === 'pcm') {
                    return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: captureFixture(),
                        headers: { 'Cache-Control': 'no-store', 'X-Radiolab-Sample-Rate': '44100', 'X-Radiolab-Channels': '2' } }).catch(() => {});
                }
                return route.fulfill({ status: 200, contentType: 'audio/wav', body: fixture,
                    headers: { 'Cache-Control': 'no-store', 'Accept-Ranges': 'none' } }).catch(() => {});
            }
            if (['http:', 'https:'].includes(address.protocol) && address.origin !== origin) {
                results.external.push(address.origin + address.pathname);
                return route.abort();
            }
            return route.continue();
        });
        const page = await context.newPage();
        page.on('pageerror', error => results.errors.push(error.message));
        await login(page, 'admin', 'snowpeas');
        const stationResponse = await api(context, 'admin', '/mygrain/api/radiolab/stations');
        assert.equal(stationResponse.status(), 200);
        const catalog = await stationResponse.json();
        checked('station list covers Russian, Chinese and Japanese', ['Russian', 'Chinese', 'Japanese'].every(language =>
            catalog.stations.some(station => station.language.includes(language))));
        checked('station URLs stay on the authenticated same origin', catalog.stations.every(station =>
            new URL(station.streamUrl, base).origin === origin));
        await page.waitForFunction(() => window.mygrainRadiolab && !window.mygrainRadiolab.state.busy);
        await page.locator('#radiolabStation').selectOption('shanghai-news');
        checked('Record is available before Listen or decoded signal', await page.locator('#radiolabRecord').isEnabled());
        streamDelay = 1500;
        await page.locator('#radiolabRecord').click();
        checked('Stop remains available while manual Record starts the relay', await page.locator('#radiolabStop').isEnabled());
        await page.locator('#radiolabStop').click();
        await page.waitForTimeout(2000);
        checked('Stop cancels a pending Record without a late background recording', await page.evaluate(() =>
            !window.mygrainRadiolab.state.recording && !window.mygrainRadiolab.state.listening));
        checked('manual Stop does not produce a stale account-session error', !/account session ended|action failed/i
            .test(await page.locator('#radiolabStatus').textContent()));
        await page.waitForFunction(() => !window.mygrainRadiolab.state.busy);
        await page.locator('#radiolabRecord').click();
        await page.waitForFunction(() => window.mygrainRadiolab.state.recordedSeconds >= 1, null, { timeout: 10000 });
        if (await page.locator('#radiolabStop').isEnabled()) await page.locator('#radiolabStop').click();
        checked('a second manual Record starts reception and produces a savable take', await page.evaluate(() =>
            window.mygrainRadiolab.state.hasTake) && await page.locator('#radiolabSave').isEnabled());
        checked('finished take has main-panel Preview and Normalize controls', await page.locator('#radiolabPreview').isEnabled()
            && await page.locator('#radiolabNormalize').isEnabled());
        await page.locator('#radiolabNormalize').click();
        await page.waitForFunction(() => window.mygrainRadiolab.state.normalized);
        checked('manual Normalize updates the current take without saving', await page.evaluate(() => window.mygrainRadiolab.state.hasTake));
        await page.locator('#radiolabStation').selectOption('bbc-world');
        await page.locator('#radiolabStation').selectOption('shanghai-news');
        await page.locator('#radiolabListen').click();
        await page.waitForFunction(() => window.mygrainRadiolab.state.listening && !window.mygrainRadiolab.state.busy);
        checked('rewind controls are removed from live recording', !await page.locator('#radiolabWheel').isVisible()
            && !await page.locator('#radiolabAudition').isVisible());
        await page.locator('#radiolabRecord').click();
        await page.waitForFunction(() => window.mygrainRadiolab.state.recordedSeconds >= 3, null, { timeout: 10000 });
        if (await page.locator('#radiolabStop').isEnabled()) await page.locator('#radiolabStop').click();
        checked('a fresh take resets the normalization state', !await page.evaluate(() => window.mygrainRadiolab.state.normalized));
        await page.locator('#radiolabPreview').click();
        await page.waitForFunction(() => window.mygrainRadiolab.state.previewingTake);
        checked('current unsaved take previews in the main panel without opening Browser', !await page.locator('#radiolabSamplesDialog').isVisible());
        await page.locator('#radiolabPreview').click();
        await page.waitForFunction(() => !window.mygrainRadiolab.state.previewing);
        checked('main-panel Preview toggles off without losing the take', await page.evaluate(() => window.mygrainRadiolab.state.hasTake));
        const automaticName = await page.locator('#radiolabName').inputValue();
        checked('default take name retains the multilingual station label', automaticName.includes('上海') && automaticName.includes('Shanghai'));
        const automaticSaveResponse = page.waitForResponse(response => response.url().includes('/api/radiolab/samples')
            && response.request().method() === 'POST');
        await page.locator('#radiolabSave').click();
        const automaticResponse = await automaticSaveResponse;
        const automaticSaved = await automaticResponse.json();
        checked('unchanged auto-generated Chinese station name saves successfully', automaticResponse.status() === 201
            && automaticSaved.sample?.name === automaticName);
        await page.waitForFunction(() => window.mygrainRadiolab.state.normalized && !window.mygrainRadiolab.state.busy);
        const automaticFile = await api(context, 'admin', `/mygrain/api/radiolab/file?name=${encodeURIComponent(automaticSaved.sample.filename)}`);
        const automaticBytes = await automaticFile.body();
        checked('Save automatically normalizes the actual stored WAV when Normalize was skipped', inspectWav(automaticBytes).peak >= 32767);
        await page.locator('#radiolabPreview').click();
        await page.waitForFunction(() => window.mygrainRadiolab.state.previewingTake);
        await page.waitForFunction(() => !window.mygrainRadiolab.state.previewing, null, { timeout: 10000 });
        checked('normalized main-panel preview ends naturally and restores Preview label', /preview/i.test(await page.locator('#radiolabPreview').textContent()));
        await page.locator('#radiolabName').fill('Acceptance Radio Speech');
        const savedResponse = page.waitForResponse(response => response.url().includes('/api/radiolab/samples')
            && response.request().method() === 'POST');
        await page.locator('#radiolabSave').click();
        const saved = await (await savedResponse).json();
        checked('named capture saves through the actual browser', saved.sample && !saved.error);
        const filename = saved.sample.filename || saved.sample.name;
        results.saved = saved.sample;
        const fileResponse = await api(context, 'admin', `/mygrain/api/radiolab/file?name=${encodeURIComponent(filename)}`);
        assert.equal(fileResponse.status(), 200);
        const recording = inspectWav(await fileResponse.body());
        checked('repeated Save preserves the exact normalized payload', (await fileResponse.body()).equals(automaticBytes));
        checked('normalized saved audio reaches full scale without length changes', recording.peak >= 32767);
        results.recording = { duration: recording.duration, sampleRate: recording.sampleRate,
            start: recording.frequencyAt(0.3), end: recording.frequencyAt(recording.duration - 0.5) };
        checked('capture contains only the live server PCM with no pre-roll', Math.abs(recording.duration - 3) < 0.01);
        checked('live capture starts with the 220Hz server PCM', Math.abs(results.recording.start.frequency - 220) < 18
            && results.recording.start.rms > 0.02);
        checked('recording continues into the later 660Hz server PCM', Math.abs(results.recording.end.frequency - 660) < 18
            && results.recording.end.rms > 0.02);
        const sourceResponse = await api(context, 'admin', '/mygrain-bastardloops/api/source-files?source=samples_radiolab');
        const source = await sourceResponse.json();
        checked('saved capture appears in the regular grain-source folder', source.files?.some(file => file.name === filename));
        await page.locator('#radiolabBrowser').click();
        await recordingAction(page, filename, 'play').click();
        await page.waitForFunction(() => window.mygrainRadiolab.state.previewing);
        await recordingAction(page, filename, 'play').click();
        checked('sample-browser one-shot playback stops on command', await page.evaluate(() => !window.mygrainRadiolab.state.previewing));
        await page.locator('#radiolabLoadTarget').selectOption('grainMain');
        await recordingAction(page, filename, 'load').click();
        await page.waitForFunction(() => document.querySelector('#radiolabBrowserStatus').textContent.includes('Loaded'));
        checked('grain browser offers the RADIOLAB source folder', await page.evaluate(() =>
            getGrainSampleBrowserSourceOptions().some(option => option.value === 'samples_radiolab')));
        checked('complete sample is loaded into the main grain engine', await page.evaluate(duration =>
            Boolean(grainMainSampleBuffer) && Math.abs(grainMainSampleBuffer.duration - duration) < 0.1
            && grainMainSampleMetadata.sourceKey === 'samples_radiolab', recording.duration));
        for (const target of ['grainA', 'grainB']) {
            await page.locator('#radiolabLoadTarget').selectOption(target);
            await recordingAction(page, filename, 'load').click();
            await page.waitForFunction(expected => document.querySelector('#radiolabBrowserStatus').textContent.includes(`into ${expected}.`), target);
            checked(`complete sample loads into ${target}`, await page.evaluate(({ target, duration }) => {
                const buffer = target === 'grainA' ? grainASampleBuffer : grainBSampleBuffer;
                const metadata = target === 'grainA' ? grainASampleMetadata : grainBSampleMetadata;
                return Boolean(buffer) && Math.abs(buffer.duration - duration) < 0.1 && metadata.sourceKey === 'samples_radiolab';
            }, { target, duration: recording.duration }));
        }
        await page.locator('#radiolabBrowserClose').click();
        await page.locator('#performanceBastardLoopVUseRadiolabBtn').click();
        checked('Use RADIOLAB opens browser targeting Loop V', await page.locator('#radiolabLoadTarget').inputValue() === 'V');
        await recordingAction(page, filename, 'load').click();
        await page.waitForFunction(() => document.querySelector('#radiolabBrowserStatus').textContent.includes('Loaded'));
        checked('Loop V accepts the complete saved recording', await page.evaluate(duration => Boolean(bastardLoopVBuffer)
            && Math.abs(bastardLoopVBuffer.duration - duration) < 0.1, recording.duration).catch(() => false));
        await page.locator('#radiolabBrowserClose').click();
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            await fits(page, ['#radiolabStation', '#radiolabListen', '#radiolabMonitor', '#radiolabRecord', '#radiolabStop', '#radiolabPreview', '#radiolabNormalize', '#radiolabName', '#radiolabSave', '#radiolabBrowser']);
            await page.locator('#radiolabBrowser').click();
            await page.waitForFunction(() => !window.mygrainRadiolab.state.busy);
            await fits(page, ['#radiolabSampleList', '.radiolab-sample-row:first-child [data-action="play"]', '.radiolab-sample-row:first-child [data-action="delete"]', '#radiolabLoadTarget', '.radiolab-sample-row:first-child [data-action="load"]', '#radiolabBrowserClose']);
            await page.locator('#radiolabBrowserClose').click();
            await page.locator('#radiolabListen').scrollIntoViewIfNeeded();
            await page.screenshot({ path: evidence.replace(/\.json$/, `-${viewport.width}.png`) });
        }
        const dan = await browser.newContext();
        contexts.push(dan);
        const loginResponse = await dan.request.post(origin + '/mygrain/api/auth/login', {
            headers: { Origin: origin }, data: { username: 'dan', password: 'charged' }
        });
        assert.equal(loginResponse.status(), 200);
        const danSamples = await (await api(dan, 'dan', '/mygrain/api/radiolab/samples')).json();
        checked('another user cannot list admin recordings', !danSamples.samples.some(sample => (sample.filename || sample.name) === filename));
        const denied = await api(dan, 'dan', `/mygrain/api/radiolab/file?name=${encodeURIComponent(filename)}`);
        checked('another user cannot fetch a guessed admin filename', denied.status() === 404);
        const danPage = await dan.newPage();
        danPage.on('pageerror', error => results.errors.push(error.message));
        await danPage.goto(base, { waitUntil: 'load' });
        await danPage.locator('#start-btn').click();
        await danPage.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        await danPage.waitForFunction(() => window.mygrainRadiolab && !window.mygrainRadiolab.state.busy);
        const danCapture = await danPage.evaluate(async () => {
            const controller = window.mygrainRadiolab;
            const catalog = await fetch('/mygrain/api/radiolab/stations').then(response => response.json());
            return { stations: catalog.stations?.length || 0, ready: Boolean(controller) };
        });
        checked('regular-account browser can access the private recorder', danCapture.ready && danCapture.stations > 0);
        const danName = 'Japanese radio — 日本語 / Russian русский';
        const danSavedResponse = await api(dan, 'dan', `/mygrain/api/radiolab/samples?${new URLSearchParams({ name: danName, station: 'jbreeze-global' })}`, {
            method: 'POST', headers: { 'Content-Type': 'audio/wav', Origin: origin }, data: await fileResponse.body()
        });
        const danSaved = await danSavedResponse.json();
        checked('regular account saves browser-generated PCM with a multilingual name', danSavedResponse.status() === 201 && danSaved.sample?.name === danName);
        const danFilename = danSaved.sample.filename;
        const danFile = await api(dan, 'dan', `/mygrain/api/radiolab/file?name=${encodeURIComponent(danFilename)}`);
        checked('regular-account save retains the exact recorded WAV', danFile.status() === 200 && (await danFile.body()).equals(await fileResponse.body()));
        const adminCannotRead = await api(context, 'admin', `/mygrain/api/radiolab/file?name=${encodeURIComponent(danFilename)}`);
        checked('regular-account recording remains inaccessible to another account', adminCannotRead.status() === 404);
        await danPage.locator('#radiolabBrowser').click();
        await danPage.waitForFunction(() => document.querySelectorAll('.radiolab-sample-row').length > 0);
        checked('regular-account browser lists its own named take', (await danPage.locator('#radiolabSampleList').textContent()).includes(danName));
        await recordingAction(danPage, danFilename, 'play').click();
        await danPage.waitForFunction(() => window.mygrainRadiolab.state.previewing);
        checked('regular account previews its saved recording through the real file endpoint');
        await recordingAction(danPage, danFilename, 'play').click();
        for (const target of ['grainMain', 'grainA', 'grainB', 'V']) {
            await danPage.locator('#radiolabLoadTarget').selectOption(target);
            await recordingAction(danPage, danFilename, 'load').click();
            await danPage.waitForFunction(expected => document.querySelector('#radiolabBrowserStatus').textContent
                .includes(`into ${expected === 'V' ? 'Loop V' : expected}.`), target);
            checked(`regular-account ${target} receives audible complete PCM`, await danPage.evaluate(({ target, duration }) => {
                const buffer = target === 'grainMain' ? grainMainSampleBuffer : target === 'grainA' ? grainASampleBuffer
                    : target === 'grainB' ? grainBSampleBuffer : bastardLoopVBuffer;
                return Boolean(buffer) && Math.abs(buffer.duration - duration) < 0.1
                    && buffer.getChannelData(0).some(sample => Math.abs(sample) > 0.01);
            }, { target, duration: recording.duration }));
        }
        await danPage.locator('#radiolabBrowserClose').click();
        await danPage.reload({ waitUntil: 'load' });
        await danPage.locator('#start-btn').click();
        await danPage.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended
            && window.mygrainRadiolab && !window.mygrainRadiolab.state.busy);
        await danPage.locator('#radiolabBrowser').click();
        await danPage.waitForFunction(() => document.querySelectorAll('.radiolab-sample-row').length > 0);
        await recordingAction(danPage, danFilename, 'play').click();
        await danPage.waitForFunction(() => window.mygrainRadiolab.state.previewing);
        checked('regular-account recording persists and previews after a full page reload');
        await recordingAction(danPage, danFilename, 'play').click();
        await danPage.locator('#radiolabBrowserClose').click();
        const anonymous = await browser.newContext();
        contexts.push(anonymous);
        const privateListing = await anonymous.request.get(origin + '/mygrain/api/radiolab/samples');
        checked('anonymous requests cannot list recordings', privateListing.status() === 401);
        const privateStream = await anonymous.request.get(origin + '/mygrain/radiolab/stream/vesti-fm?_mygrain_user=admin');
        checked('anonymous requests cannot start radio relays', privateStream.status() === 401);
        await page.evaluate(() => window.dispatchEvent(new Event('mygrain-account-lock')));
        checked('account lock releases every radio media source', await page.evaluate(() =>
            [...document.querySelectorAll('#radiolabCard audio')].every(audio => audio.paused && !audio.getAttribute('src'))));
        checked('no uncaught browser errors', results.errors.length === 0);
    } catch (error) {
        results.failure = error.stack;
        process.exitCode = 1;
    } finally {
        for (const context of contexts) await context.close();
        await browser.close();
        fs.writeFileSync(evidence, JSON.stringify(results, null, 2));
        console.log(JSON.stringify(results, null, 2));
    }
})();
