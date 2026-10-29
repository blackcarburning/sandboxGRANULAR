const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, webkit } = require('playwright-core');
const { encodeWav } = require('../radiolab.js');

const root = path.join(__dirname, '..');
const markup = fs.readFileSync(path.join(root, 'videolab-panel.html'), 'utf8');
const sampleRate = 48000;
const channels = Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length: sampleRate * 2 }, (_, frame) => {
    const selected = frame >= sampleRate / 2 && frame < sampleRate * 1.5;
    const amplitude = selected ? channel ? 0.125 : 0.25 : 0.9;
    return amplitude * Math.sin(frame * 2 * Math.PI * (channel ? 880 : 440) / sampleRate);
}));
const tone = Buffer.from(encodeWav([channels], sampleRate, 2));

async function fixture() {
    const state = { mode: 'ready', requests: [], uploads: [], jobs: new Map(), bookmarks: new Map(), samples: new Map(), deletes: [], nextId: 0 };
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="radiolab.css"><link rel="stylesheet" href="videolab.css"><style>body{margin:8px;background:#090d14;color:#eee;font:16px sans-serif}.performance-feature-card{padding:12px;border:1px solid #cf8653;border-radius:12px}.performance-chip{color:#ffc281}.performance-feature-title{font-size:1.25rem}.performance-feature-note{line-height:1.5;color:#c7c4ce}.performance-btn{font:inherit}#testStart{min-height:44px;margin-bottom:12px}</style></head><body><button id="testStart">MYGRAIN Start (fixture)</button><main>${markup}</main><script>
        window.mygrainAccounts={authenticated:true,user:{username:'alice'}};
        document.cookie='videolab_fixture=1; path=/';
        window.fixtureLoads=[];window.fixtureAuditions=[];window.fixtureSources=[];
        const nativeFetch=window.fetch.bind(window);
        window.fetch=(url,options)=>nativeFetch(url,window.ignoreCaptureAbort&&options?.method==='POST'&&String(url).endsWith('/captures')?{...options,signal:undefined}:options);
        document.getElementById('testStart').addEventListener('click',async()=>{
            if(!window.fixtureContext){
                window.fixtureContext=new (window.AudioContext||window.webkitAudioContext)({sampleRate:48000});
                const create=fixtureContext.createBufferSource.bind(fixtureContext);
                fixtureContext.createBufferSource=()=>{const source=create();const start=source.start.bind(source);source.start=(...args)=>{fixtureAuditions.push({frames:source.buffer.length,rate:source.buffer.sampleRate,channels:Array.from({length:source.buffer.numberOfChannels},(_,channel)=>Array.from(source.buffer.getChannelData(channel)))});fixtureSources.push(source);return start(...args);};return source;};
                const decode=fixtureContext.decodeAudioData.bind(fixtureContext);
                fixtureContext.decodeAudioData=async bytes=>{const buffer=await decode(bytes);if(window.holdDecode){window.decodeWaiting=true;await new Promise(resolve=>window.releaseDecode=resolve);window.decodeWaiting=false;}return buffer;};
            }
            await fixtureContext.resume();
        });
        window.mygrainVideolabAdapter={getContext:()=>window.fixtureContext||null,async load(body,sample,target,guard){guard();const buffer=await fixtureContext.decodeAudioData(body);guard();fixtureLoads.push({target,frames:buffer.length,name:sample.name});}};
    </script><script src="radiolab.js"></script><script src="videolab.js"></script><script>window.testController=MygrainVideolab.boot();</script></body></html>`;
    const server = http.createServer(async (request, response) => {
        const url = new URL(request.url, 'http://localhost');
        const json = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
        if (url.pathname === '/mygrain/') {
            response.writeHead(200, { 'Content-Type': 'text/html' });
            const late = html.replace('<script src="radiolab.js"></script><script src="videolab.js"></script><script>window.testController=MygrainVideolab.boot();</script>', '<script>window.pendingAdapter=window.mygrainVideolabAdapter;delete window.mygrainVideolabAdapter;</script><script src="videolab.js"></script>');
            return response.end(url.searchParams.has('late') ? late : html);
        }
        const filename = path.basename(url.pathname);
        if (['radiolab.js', 'radiolab.css', 'videolab.js', 'videolab.css'].includes(filename)) { response.writeHead(200, { 'Content-Type': filename.endsWith('.css') ? 'text/css' : 'application/javascript' }); return response.end(fs.readFileSync(path.join(root, filename))); }
        if (url.pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
        if (!url.pathname.startsWith('/mygrain/api/videolab/')) return json({ error: 'Not found' }, 404);
        const username = request.headers['x-mygrain-user'];
        state.requests.push({ method: request.method, path: url.pathname, username, cookie: request.headers.cookie });
        if (!username) return json({ ok: false, error: 'Account header missing' }, 401);
        const readBody = async () => { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks); };
        const route = url.pathname.slice('/mygrain/api/videolab/'.length);
        if (route === 'bookmarks') {
            if (request.method === 'POST') { const entry = JSON.parse(await readBody()); state.bookmarks.set(username, [...(state.bookmarks.get(username) || []), { ...entry, id: 'bookmark-1' }]); return json({ ok: true, bookmark: entry }); }
            return json({ ok: true, bookmarks: state.bookmarks.get(username) || [] });
        }
        if (route === 'captures' && request.method === 'POST') {
            const settings = JSON.parse(await readBody());
            const id = String(++state.nextId);
            const job = { id, mode: state.mode, polls: 0, settings, username };
            state.jobs.set(id, job);
            if (job.mode === 'late') await new Promise(resolve => setTimeout(resolve, 300));
            return json({ ok: true, capture: { id, status: 'queued' } }, 202);
        }
        const capture = route.match(/^captures\/([^/]+)(\/audio)?$/);
        if (capture) {
            const job = state.jobs.get(capture[1]);
            if (!job || job.username !== username) return json({ ok: false, error: 'No job' }, 404);
            if (request.method === 'DELETE') { state.deletes.push(job.id); return json({ ok: true }); }
            if (capture[2]) { response.writeHead(200, { 'Content-Type': 'audio/wav' }); return response.end(job.mode === 'bad' ? Buffer.from('not a wav') : tone); }
            job.polls++;
            const status = job.mode === 'error' ? 'error' : job.mode === 'cancelled' ? 'cancelled' : job.mode === 'slow' || job.polls === 1 ? 'working' : 'ready';
            return json({ ok: true, capture: { id: job.id, status, progress: status === 'working' ? 0.4 : 1, error: status === 'error' ? 'Licensed source unavailable' : undefined, source: { title: 'Fixture sine tone' }, audioUrl: 'https://untrusted.invalid/never-fetch-this' } });
        }
        if (route === 'samples') {
            if (request.method === 'POST') { const body = await readBody(); const sample = { filename: 'trim.wav', name: url.searchParams.get('name') }; state.uploads.push(body); state.samples.set(username, [sample]); return json({ ok: true, sample }); }
            return json({ ok: true, samples: state.samples.get(username) || [] });
        }
        if (route === 'samples/trim.wav') {
            if (request.method === 'DELETE') { state.samples.set(username, []); return json({ ok: true }); }
            response.writeHead(200, { 'Content-Type': 'audio/wav' }); return response.end(state.uploads.at(-1) || tone);
        }
        return json({ ok: false, error: 'Unknown fixture API' }, 404);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { state, url: `http://127.0.0.1:${server.address().port}/mygrain/`, close: () => new Promise(resolve => server.close(resolve)) };
}

async function launch() {
    return process.env.VIDEOLAB_BROWSER_ENGINE === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=user-gesture-required'] });
}

async function ready(page) { await page.waitForFunction(() => window.mygrainVideolab && !mygrainVideolab.state.busy); }
async function start(page) { await page.locator('#testStart').click(); await page.waitForFunction(() => fixtureContext?.state === 'running'); }
async function setVideo(page) { await page.locator('#videolabURL').fill('https://youtu.be/abcdefghijk'); }
async function fetchTake(page) { await setVideo(page); await page.locator('#videolabFetch').click(); await page.waitForFunction(() => mygrainVideolab.state.hasTake && !mygrainVideolab.state.capturing); }
async function trim(page, startTime = 0.5, endTime = 1.5) {
    await page.locator('#videolabTrimStart').evaluate((element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }, startTime);
    await page.locator('#videolabTrimEnd').evaluate((element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }, endTime);
}
async function noOverflow(page) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); }
async function screenshot(page, name, fullPage = false) {
    const selected = process.env.VIDEOLAB_SCREENSHOTS;
    if (!selected || (selected !== 'all' && !selected.split(',').includes(name))) return;
    console.log(`VIDEOLAB_SCREENSHOT ${name} ${await page.screenshot({ fullPage, type: 'jpeg', quality: 55, scale: 'css' }).then(buffer => buffer.toString('base64'))}`);
}

test('iPhone-primary finite WAV import, exact trim/audition/normalised Save and four guarded destinations with real Web Audio', { timeout: 90000 }, async () => {
    const app = await fixture();
    const browser = await launch();
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(app.url);
        await ready(page);
        assert.equal(await page.locator('#videolabDuration').inputValue(), '120');
        assert.equal(await page.locator('#videolabStart').inputValue(), '00:00');
        assert.equal(await page.locator('#videolabStart').getAttribute('type'), 'text');
        assert.match(await page.locator('label[for="videolabStart"]').textContent(), /mm:ss \(minutes:seconds\)/);
        assert.match(await page.locator('#videolabStartHelp').textContent(), /02:30 = 2 minutes 30 seconds/);
        assert.match(await page.locator('#videolabURLHelp').textContent(), /Channel bookmark/);
        assert.equal(await page.locator('#videolabFetch').isDisabled(), true);
        await setVideo(page);
        await page.locator('#videolabFetch').click();
        await page.waitForFunction(() => document.getElementById('videolabStatus').textContent.includes('Start MYGRAIN'));
        assert.equal(app.state.jobs.size, 0);
        assert.equal(await page.evaluate(() => Boolean(window.fixtureContext)), false);
        await start(page);
        await page.locator('#videolabStart').fill('02:60');
        await page.locator('#videolabFetch').click();
        await page.waitForFunction(() => document.getElementById('videolabStatus').textContent.includes('mm:ss'));
        assert.equal(app.state.jobs.size, 0);
        await page.locator('#videolabStart').fill('02:30');
        await fetchTake(page);
        assert.equal(await page.evaluate(() => fixtureAuditions.length), 0);
        const job = Array.from(app.state.jobs.values())[0];
        assert.deepEqual(job.settings, { url: 'https://www.youtube.com/watch?v=abcdefghijk', startSeconds: 150, durationSeconds: 120 });
        assert.equal(await page.evaluate(() => testController.recorder.sampleRate), sampleRate);
        assert.equal(await page.locator('#videolabTrimPanel').isVisible(), true);
        await trim(page);
        assert.equal(await page.evaluate(() => mygrainVideolab.state.trimmedSeconds), 1);
        const selected = await page.evaluate(() => testController.recorder.chunks[0].map(channel => Array.from(channel.subarray(24000, 72000))));
        let peak = 0;
        for (const channel of selected) for (const value of channel) peak = Math.max(peak, Math.abs(value));
        await page.locator('#videolabNormalize').click();
        await ready(page);
        await page.locator('#videolabPreview').click();
        await page.waitForFunction(() => fixtureAuditions.length === 1);
        const preview = await page.evaluate(() => ({ frames: fixtureAuditions[0].frames, left: fixtureAuditions[0].channels[0].slice(0, 40), right: fixtureAuditions[0].channels[1].slice(0, 40) }));
        assert.equal(preview.frames, sampleRate);
        for (let frame = 0; frame < 40; frame++) {
            assert.equal(preview.left[frame], Math.fround(selected[0][frame] / peak));
            assert.equal(preview.right[frame], Math.fround(selected[1][frame] / peak));
        }
        if (await page.evaluate(() => mygrainVideolab.state.previewing)) await page.locator('#videolabPreview').click();
        await page.locator('#videolabSampleName').fill('Selected sine interval');
        await page.locator('#videolabSave').click();
        await ready(page);
        assert.equal(app.state.uploads.length, 1);
        const upload = app.state.uploads[0];
        assert.equal(upload.length, 44 + sampleRate * 4);
        const saved = new DataView(upload.buffer, upload.byteOffset, upload.byteLength);
        for (let frame = 0; frame < sampleRate; frame++) {
            for (let channel = 0; channel < 2; channel++) {
                const value = Math.fround(selected[channel][frame] / peak);
                const expected = Math.round(value * (value < 0 ? 32768 : 32767));
                assert.equal(saved.getInt16(44 + frame * 4 + channel * 2, true), expected);
            }
        }
        await noOverflow(page);
        await screenshot(page, 'portrait390', true);
        await page.locator('#videolabBrowse').click();
        await ready(page);
        assert.equal(await page.locator('#videolabSamplesDialog').evaluate(element => element.parentNode === document.body), true);
        assert.deepEqual(await page.locator('#videolabLoadTarget option').allTextContents(), ['Apply', 'V', 'Grain A', 'Grain B']);
        const starts = await page.evaluate(() => fixtureAuditions.length);
        for (const target of ['grainMain', 'V', 'grainA', 'grainB']) {
            await page.locator('#videolabLoadTarget').selectOption(target);
            await page.locator('#videolabSampleList button[data-action="load"]').click();
            await ready(page);
        }
        assert.deepEqual(await page.evaluate(() => fixtureLoads.map(load => load.target)), ['grainMain', 'V', 'grainA', 'grainB']);
        assert.equal(await page.evaluate(() => fixtureLoads.every(load => load.frames === 48000)), true);
        assert.equal(await page.evaluate(() => fixtureAuditions.length), starts);
        await page.locator('#videolabSampleList button[data-action="preview"]').click();
        await page.waitForFunction(() => mygrainVideolab.state.previewing);
        await page.locator('#videolabStopPreview').click();
        await ready(page);
        assert.equal(await page.evaluate(() => mygrainVideolab.state.previewing), false);
        for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            await noOverflow(page);
            const dialog = await page.locator('#videolabSamplesDialog').boundingBox();
            assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= viewport.width + 1);
            assert.equal(await page.locator('#videolabBrowserClose').isVisible(), true);
            assert.equal(await page.locator('#videolabSampleList button[data-action="load"]').isVisible(), true);
            await screenshot(page, `browser${viewport.width}`);
        }
        page.once('dialog', dialog => dialog.accept());
        await page.locator('#videolabSampleList button[data-action="delete"]').click();
        await ready(page);
        assert.match(await page.locator('#videolabSampleList').textContent(), /No saved/);
        await page.locator('#videolabBrowserClose').click();
        await page.waitForFunction(() => mygrainVideolab.state.closed);
        assert.equal(await page.evaluate(() => mygrainVideolab.state.hasTake), false);
        assert.equal(await page.locator('#videolabStart').inputValue(), '00:00');
        assert.ok(app.state.requests.every(request => request.username === 'alice' && request.cookie.includes('videolab_fixture=1')));
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await app.close(); }
});

test('failed, cancelled and stale retrievals preserve the last take; bookmark account changes and close scrub private state', { timeout: 90000 }, async () => {
    const app = await fixture();
    const browser = await launch();
    try {
        const page = await browser.newPage({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(app.url);
        await ready(page);
        await start(page);
        await fetchTake(page);
        await trim(page);
        await page.evaluate(() => { window.retainedTake = testController.recorder; window.retainedBytes = Array.from(new Uint8Array(retainedTake.wav())); });
        for (const mode of ['error', 'bad', 'cancelled']) {
            app.state.mode = mode;
            await page.locator('#videolabFetch').click();
            await page.waitForFunction(() => !mygrainVideolab.state.capturing);
            assert.equal(await page.evaluate(() => { const bytes = new Uint8Array(retainedTake.wav()); return testController.recorder === retainedTake && retainedBytes.every((value, index) => value === bytes[index]); }), true);
            assert.match(await page.locator('#videolabStatus').textContent(), /retained/i);
        }
        app.state.mode = 'slow';
        await page.locator('#videolabFetch').click();
        await page.waitForFunction(() => mygrainVideolab.state.capturing);
        assert.equal(await page.locator('#videolabCancel').isEnabled(), true);
        await page.locator('#videolabCancel').click();
        await page.waitForFunction(() => !mygrainVideolab.state.capturing);
        assert.equal(await page.evaluate(() => testController.recorder === retainedTake), true);
        app.state.mode = 'late';
        await page.evaluate(() => window.ignoreCaptureAbort = true);
        await page.locator('#videolabFetch').click();
        await page.waitForFunction(() => mygrainVideolab.state.capturing);
        await page.locator('#videolabCancel').click();
        await page.waitForTimeout(500);
        assert.equal(await page.evaluate(() => testController.recorder === retainedTake), true);
        assert.ok(app.state.deletes.includes(String(app.state.nextId)));
        await page.evaluate(() => window.ignoreCaptureAbort = false);
        app.state.mode = 'ready';
        await page.evaluate(() => window.holdDecode = true);
        await page.locator('#videolabFetch').click();
        await page.waitForFunction(() => window.decodeWaiting);
        await page.locator('#videolabCancel').click();
        await page.evaluate(() => { window.holdDecode = false; releaseDecode(); });
        assert.equal(await page.evaluate(() => testController.recorder === retainedTake), true);
        await page.locator('#videolabURL').fill('https://www.youtube.com/@BBCArchive');
        assert.equal(await page.evaluate(() => testController.recorder === retainedTake), true);
        assert.equal(await page.locator('#videolabFetch').isDisabled(), true);
        await page.locator('#videolabBookmarkName').fill('My archive <private>');
        await page.locator('#videolabSaveURL').click();
        await ready(page);
        assert.equal(app.state.bookmarks.get('alice')[0].url, 'https://www.youtube.com/@BBCArchive');
        assert.match(await page.locator('#videolabSavedURL').textContent(), /My archive <private>/);
        await setVideo(page);
        await page.locator('#videolabBookmarkName').fill('My video <private>');
        await page.locator('#videolabSaveURL').click();
        await ready(page);
        assert.match(await page.locator('#videolabSavedURL').textContent(), /My video <private>/);
        await page.locator('#videolabSavedURL').selectOption('https://www.youtube.com/watch?v=abcdefghijk');
        assert.equal(await page.locator('#videolabURL').inputValue(), 'https://www.youtube.com/watch?v=abcdefghijk');
        await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<button>Native preview fixture</button>' }));
        await page.locator('#videolabShowVideo').click();
        await ready(page);
        const frame = await page.locator('#videolabYouTubeFrame').boundingBox();
        assert.ok(frame.width >= 200 && frame.height >= 200);
        assert.match(await page.locator('#videolabYouTubeFrame').getAttribute('src'), /controls=1&playsinline=1&autoplay=0/);
        await noOverflow(page);
        await page.locator('#videolabURL').fill('https://www.youtube.com/playlist?list=abc');
        assert.equal(await page.locator('#videolabFetch').isDisabled(), true);
        assert.equal(await page.locator('#videolabYouTubeFrame').count(), 0);
        const oldRecorder = await page.evaluate(() => { window.oldSamples = retainedTake.chunks[0][0]; return retainedTake.frames; });
        assert.equal(oldRecorder, 96000);
        await page.evaluate(() => { mygrainAccounts.user.username = 'bob'; dispatchEvent(new Event('mygrain-account-changed')); });
        await ready(page);
        assert.equal(await page.evaluate(() => mygrainVideolab.state.hasTake), false);
        assert.equal(await page.evaluate(() => oldSamples.every(value => value === 0)), true);
        assert.equal(await page.evaluate(() => testController.username), 'bob');
        assert.equal(await page.locator('#videolabBookmarkName').inputValue(), '');
        assert.doesNotMatch(await page.locator('#videolabSavedURL').textContent(), /private/);
        await fetchTake(page);
        await page.evaluate(() => window.holdDecode = true);
        await page.locator('#videolabFetch').click();
        await page.waitForFunction(() => window.decodeWaiting);
        await page.evaluate(() => { window.retiredOperation = testController.capture; mygrainAccounts.user.username = 'carol'; dispatchEvent(new Event('mygrain-account-changed')); window.holdDecode = false; releaseDecode(); });
        await ready(page);
        assert.equal(await page.evaluate(() => mygrainVideolab.state.hasTake), false);
        assert.equal(await page.evaluate(() => retiredOperation.username), null);
        assert.equal(await page.evaluate(() => testController.username), 'carol');
        await fetchTake(page);
        await page.locator('#videolabPreview').click();
        await page.waitForFunction(() => mygrainVideolab.state.previewing);
        await page.evaluate(() => { mygrainAccounts.authenticated = false; dispatchEvent(new Event('mygrain-account-lock')); });
        assert.equal(await page.evaluate(() => mygrainVideolab.state.hasTake || mygrainVideolab.state.previewing), false);
        assert.equal(await page.evaluate(() => testController.username), null);
        assert.equal(await page.locator('#videolabFetch').isDisabled(), true);
        assert.ok(app.state.requests.some(request => request.username === 'bob'));
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await app.close(); }
});

test('waveform pointer/touch and keyboard trimming work in 320/390 portrait and 844 landscape without overflow', { timeout: 60000 }, async () => {
    const app = await fixture();
    const browser = await launch();
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        await page.goto(app.url);
        await ready(page);
        await start(page);
        await fetchTake(page);
        for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            await page.locator('#videolabTrimReset').click();
            await ready(page);
            const canvas = page.locator('#videolabWaveform');
            await canvas.scrollIntoViewIfNeeded();
            const bounds = await canvas.boundingBox();
            await page.touchscreen.tap(bounds.x + bounds.width * 0.25, bounds.y + 30);
            await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + 30);
            await page.mouse.down();
            await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + 30, { steps: 3 });
            await page.mouse.up();
            assert.ok(await page.evaluate(() => mygrainVideolab.state.trimStartSeconds > 0.4));
            await page.locator('#videolabTrimEnd').focus();
            await page.keyboard.press('ArrowLeft');
            assert.ok(await page.evaluate(() => mygrainVideolab.state.trimEndSeconds < 2));
            await noOverflow(page);
            assert.ok((await page.locator('#videolabFetch').boundingBox()).height >= 44);
            await screenshot(page, `waveform${viewport.width}`);
        }
        await page.evaluate(() => mygrainVideolab.close());
        await page.evaluate(() => mygrainVideolab.openBrowser('V'));
        await page.waitForFunction(() => document.getElementById('videolabSamplesDialog').open && !mygrainVideolab.state.busy);
        assert.equal(await page.locator('#videolabLoadTarget').inputValue(), 'V');
    } finally { await browser.close(); await app.close(); }
});

test('late dependencies wait explicitly without polling; account change during adapter decode prevents a stale load', { timeout: 60000 }, async () => {
    const app = await fixture();
    app.state.samples.set('alice', [{ filename: 'trim.wav', name: 'Private Alice tone' }]);
    const browser = await launch();
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => { window.intervalCalls = 0; const interval = window.setInterval.bind(window); window.setInterval = (...args) => { intervalCalls++; return interval(...args); }; });
        await page.goto(`${app.url}?late=1`);
        assert.equal(await page.evaluate(() => Boolean(window.mygrainVideolab)), false);
        assert.equal(await page.locator('#videolabURL').isDisabled(), true);
        assert.equal(await page.locator('#videolabFetch').isDisabled(), true);
        assert.equal(await page.locator('#videolabOpenURL').getAttribute('href'), null);
        assert.equal(await page.evaluate(() => intervalCalls), 0);
        await page.addScriptTag({ url: new URL('radiolab.js', app.url).href });
        await page.evaluate(() => { window.mygrainVideolabAdapter = pendingAdapter; dispatchEvent(new Event('mygrain-videolab-adapter-ready')); window.testController = MygrainVideolab.boot(); });
        await ready(page);
        assert.equal(await page.evaluate(() => intervalCalls), 0);
        await start(page);
        await page.locator('#videolabBrowse').click();
        await ready(page);
        await page.evaluate(() => window.holdDecode = true);
        await page.locator('#videolabSampleList button[data-action="load"]').click();
        await page.waitForFunction(() => window.decodeWaiting);
        await page.evaluate(() => { mygrainAccounts.user.username = 'bob'; dispatchEvent(new Event('mygrain-account-changed')); window.holdDecode = false; releaseDecode(); });
        await ready(page);
        assert.equal(await page.evaluate(() => fixtureLoads.length), 0);
        assert.equal(await page.evaluate(() => fixtureAuditions.length), 0);
        assert.equal(await page.locator('#videolabSamplesDialog').isVisible(), false);
        await page.evaluate(() => mygrainVideolab.openBrowser('grainMain'));
        await ready(page);
        assert.doesNotMatch(await page.locator('#videolabSampleList').textContent(), /Private Alice/);
        assert.equal(await page.locator('#videolabLoadTarget').inputValue(), 'grainMain');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await app.close(); }
});

test('public Reel source, automatic selection, bookmark, soundtrack capture and login failure preserve PCM', { timeout: 45000 }, async () => {
    const app = await fixture();
    const browser = await launch();
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(app.url); await ready(page); await start(page);
        await page.locator('#videolabSource').selectOption('instagram');
        assert.equal(await page.locator('#videolabURL').inputValue(), '');
        assert.equal(await page.locator('#videolabFetch').isDisabled(), true);
        await page.locator('#videolabURL').fill('https://www.instagram.com/reel/Chunk8-jurw/?igsh=share');
        assert.equal(await page.locator('#videolabSource').inputValue(), 'instagram');
        assert.match(await page.locator('#videolabURLHelp').textContent(), /mixed soundtrack/);
        assert.equal(await page.locator('#videolabOpenURL').getAttribute('href'), 'https://www.instagram.com/reel/Chunk8-jurw/');
        await page.locator('#videolabBookmarkName').fill('Public Reel');
        await page.locator('#videolabSaveURL').click(); await ready(page);
        assert.match(await page.locator('#videolabSavedURL').textContent(), /Public Reel · Reel/);
        await page.locator('#videolabDuration').fill('2');
        await page.locator('#videolabFetch').click();
        await page.waitForFunction(() => mygrainVideolab.state.hasTake && !mygrainVideolab.state.capturing);
        assert.deepEqual([...app.state.jobs.values()][0].settings, { url: 'https://www.instagram.com/reel/Chunk8-jurw/', startSeconds: 0, durationSeconds: 2 });
        const prior = await page.evaluate(() => Array.from(testController.recorder.wav()));
        await page.route('**/api/videolab/captures/*', route => {
            if (route.request().method() === 'DELETE') return route.continue();
            return route.fulfill({ json: { ok: true, capture: { id: '2', status: 'error', error: 'Instagram requires login or has limited anonymous access to this Reel. Instagram login is not connected yet.' } } });
        });
        await page.locator('#videolabFetch').click();
        await page.waitForFunction(() => !mygrainVideolab.state.capturing && document.getElementById('videolabStatus').textContent.includes('login is not connected'));
        assert.deepEqual(await page.evaluate(() => Array.from(testController.recorder.wav())), prior);
        await page.locator('#videolabURL').fill('https://youtu.be/abcdefghijk');
        assert.equal(await page.locator('#videolabSource').inputValue(), 'youtube');
        await page.locator('#videolabSavedURL').selectOption('https://www.instagram.com/reel/Chunk8-jurw/');
        assert.equal(await page.locator('#videolabSource').inputValue(), 'instagram');
        for (const width of [320, 390, 844]) { await page.setViewportSize({width, height: width === 844 ? 390 : 844}); await noOverflow(page); }
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await app.close(); }
});
