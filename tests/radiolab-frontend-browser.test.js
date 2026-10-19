const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, webkit } = require('playwright-core');
const { encodeWav } = require('../radiolab.js');

function launchBrowser() {
    if (process.env.RADIOLAB_BROWSER_ENGINE === 'webkit') return webkit.launch({ headless: true });
    return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

test('current recording waveform trims via pointer, touch and keyboard in phone orientations; audition and normalized Save use only exact selected frames', { timeout: 60000 }, async () => {
    const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const card = source.slice(source.indexOf('            <div class="performance-feature-card" id="radiolabCard"'), source.indexOf('            <div class="performance-feature-card" aria-label="Bastardloop V controls">'));
    const dialog = source.match(/<dialog id="radiolabSamplesDialog"[\s\S]*?<\/dialog>/)[0];
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="radiolab.css"><style>body{margin:8px;background:#090d14;color:#eee;font:16px sans-serif}.performance-btn{border:1px solid #6e6878;border-radius:8px;background:#20232c;color:#eee;font:inherit;padding:10px 14px}</style></head><body>${card}${dialog}<script>window.mygrainAccounts={authenticated:true,user:{username:'fixture-user'}};</script><script src="radiolab.js"></script><script>
        window.previewBuffers=[];
        window.previewSources=[];
        const context={state:'running',destination:{},createBuffer(channels,frames,sampleRate){
            const data=Array.from({length:channels},()=>new Float32Array(frames));
            return {numberOfChannels:channels,length:frames,sampleRate,copyToChannel(values,channel,offset=0){data[channel].set(values,offset);},getChannelData(channel){return data[channel];}};
        },createBufferSource(){const source={connect(){},disconnect(){this.disconnected=true;},stop(){this.stopped=true;},start(){previewBuffers.push({frames:this.buffer.length,sampleRate:this.buffer.sampleRate,channels:Array.from({length:this.buffer.numberOfChannels},(_,channel)=>Array.from(this.buffer.getChannelData(channel)))});}};previewSources.push(source);return source;}};
        window.testController=new MygrainRadiolab.Controller(document.getElementById('radiolabCard'),{getContext:()=>context});
        window.mygrainRadiolab={get state(){return testController.state;}};
        window.restoreTake=()=>{
            testController.stopPreview();
            testController.recorder?.clear();
            const left=Float32Array.from({length:16000},(_,frame)=>[.125,-.25,0,.0625][frame%4]);
            const right=Float32Array.from({length:16000},(_,frame)=>[-.0625,.125,0,-.125][frame%4]);
            left[0]=1;right[15999]=-1;
            const recorder=new MygrainRadiolab.PCMRecorder({sampleRate:8000}).start(null,0,{station:{id:'fixture',name:'Fixture radio'}});
            recorder.append([left.subarray(0,6000),right.subarray(0,6000)]);
            recorder.append([left.subarray(6000),right.subarray(6000)]);
            testController.recorder=recorder.stop();testController.render();
        };
        restoreTake();
    </script></body></html>`;
    const uploads = [];
    const server = http.createServer(async (request, response) => {
        const url = new URL(request.url, 'http://localhost');
        const json = body => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
        if (url.pathname.endsWith('/stations')) return json({ stations: [] });
        if (url.pathname.endsWith('/samples')) {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            uploads.push(Buffer.concat(chunks));
            return json({ sample: { name: 'Trimmed fixture', filename: 'trim.wav' } });
        }
        if (url.pathname === '/mygrain/') { response.writeHead(200, { 'Content-Type': 'text/html' }); return response.end(html); }
        const asset = path.basename(url.pathname);
        if (['radiolab.js', 'radiolab.css'].includes(asset)) {
            response.writeHead(200, { 'Content-Type': asset.endsWith('.css') ? 'text/css' : 'application/javascript' });
            return response.end(fs.readFileSync(path.join(__dirname, '..', asset)));
        }
        response.writeHead(404); response.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await launchBrowser();
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/mygrain/`);
        await page.waitForFunction(() => window.mygrainRadiolab && !mygrainRadiolab.state.busy);
        const canvas = page.locator('#radiolabWaveform');
        const startInput = page.locator('#radiolabTrimStart');
        const endInput = page.locator('#radiolabTrimEnd');
        for (const [orientation, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }], ['small-portrait', { width: 320, height: 568 }], ['small-landscape', { width: 568, height: 320 }]]) {
            await page.setViewportSize(viewport);
            await page.evaluate(() => restoreTake());
            await startInput.focus();
            await startInput.press('Home');
            await startInput.press('ArrowRight');
            assert.equal(await page.evaluate(() => testController.recorder.trimStartFrame), 1);
            await startInput.press('End');
            assert.equal(await page.evaluate(() => testController.recorder.selectedFrames), 1);
            await startInput.press('Home');
            await endInput.focus();
            await endInput.press('Home');
            assert.equal(await page.evaluate(() => testController.recorder.selectedFrames), 1);
            await endInput.press('End');
            await page.evaluate(() => {
                for (const [id, value] of [['radiolabTrimStart', '.5'], ['radiolabTrimEnd', '1.5']]) {
                    const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });
            await canvas.scrollIntoViewIfNeeded();
            const layout = await canvas.evaluate(element => {
                const bounds = element.getBoundingClientRect();
                const drawing = element.getContext('2d');
                return { left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height, pixels: element.width, pixelHeight: element.height,
                    overflow: document.documentElement.scrollWidth > innerWidth + 1,
                    selectedAlpha: drawing.getImageData(Math.floor(element.width * .5), Math.floor(element.height / 2), 1, 1).data[3],
                    excludedAlpha: drawing.getImageData(Math.floor(element.width * .125), Math.floor(element.height / 2), 1, 1).data[3] };
            });
            assert.equal(layout.overflow, false, orientation);
            assert.ok(layout.left >= 0 && layout.right <= viewport.width + 1);
            assert.equal(layout.pixels, Math.round(layout.width * 2));
            assert.equal(layout.pixelHeight, 240);
            assert.ok(layout.selectedAlpha > layout.excludedAlpha, JSON.stringify(layout));
            let bounds = await canvas.boundingBox();
            await page.mouse.move(bounds.x + bounds.width * .25, bounds.y + bounds.height / 2);
            await page.mouse.down();
            await page.mouse.move(bounds.x + bounds.width * .375, bounds.y + bounds.height / 2, { steps: 4 });
            await page.mouse.up();
            const draggedStart = await page.evaluate(() => mygrainRadiolab.state.trimStartSeconds);
            assert.ok(Math.abs(draggedStart - .75) <= 2 / bounds.width + 1 / 8000, JSON.stringify({ orientation, draggedStart, bounds }));
            bounds = await canvas.boundingBox();
            await page.touchscreen.tap(bounds.x + bounds.width * .625, bounds.y + bounds.height / 2);
            assert.ok(Math.abs(await page.evaluate(() => mygrainRadiolab.state.trimEndSeconds) - 1.25) <= 2 / bounds.width + 1 / 8000);
            await page.evaluate(() => { testController.setTrim('start', .5); testController.setTrim('end', 1.5); });
            await page.locator('#radiolabPreview').tap();
            await page.waitForFunction(() => mygrainRadiolab.state.previewingTake && !mygrainRadiolab.state.busy);
            const raw = await page.evaluate(() => previewBuffers.at(-1));
            assert.equal(raw.frames, 8000);
            assert.equal(raw.sampleRate, 8000);
            assert.deepEqual(raw.channels[0].slice(0, 4), [.125, -.25, 0, .0625]);
            assert.deepEqual(raw.channels[1].slice(0, 4), [-.0625, .125, 0, -.125]);
            assert.equal(await page.locator('#radiolabPreview').textContent(), 'Stop Preview');
            await page.locator('#radiolabPreview').tap();
            assert.equal(await page.evaluate(() => mygrainRadiolab.state.previewingTake), false);
            await page.locator('#radiolabNormalize').tap();
            await page.waitForFunction(() => mygrainRadiolab.state.normalized && !mygrainRadiolab.state.busy);
            await page.locator('#radiolabPreview').tap();
            await page.waitForFunction(() => mygrainRadiolab.state.previewingTake && !mygrainRadiolab.state.busy);
            const normalized = await page.evaluate(() => previewBuffers.at(-1));
            assert.deepEqual(normalized.channels, raw.channels.map(channel => channel.map(value => value * 4)));
            await page.locator('#radiolabName').fill('Trimmed fixture');
            const attempts = uploads.length;
            await page.locator('#radiolabSave').tap();
            await page.waitForFunction(() => !mygrainRadiolab.state.busy && !mygrainRadiolab.state.previewingTake);
            assert.equal(uploads.length, attempts + 1);
            const saved = uploads.at(-1);
            assert.equal(saved.length, 44 + 8000 * 4);
            assert.equal(saved.readUInt32LE(24), 8000);
            assert.equal(saved.readUInt16LE(22), 2);
            const expected = [16384, -8192, -32768, 16384, 0, 0, 8192, -16384];
            for (let index = 0; index < 16000; index += 1) assert.equal(saved.readInt16LE(44 + index * 2), expected[index % expected.length]);
            await page.locator('#radiolabSave').tap();
            await page.waitForFunction(() => !mygrainRadiolab.state.busy);
            assert.deepEqual(uploads.at(-1), saved);
            assert.equal(await page.evaluate(() => testController.recorder.chunks[0][0][0]), 1);
            assert.equal(await page.evaluate(() => testController.recorder.chunks[1][1].at(-1)), -1);
            const artifactDirectory = process.env.RADIOLAB_SCREENSHOT_DIR;
            if (artifactDirectory) {
                fs.mkdirSync(artifactDirectory, { recursive: true });
                await canvas.scrollIntoViewIfNeeded();
                await page.screenshot({ path: path.join(artifactDirectory, `radiolab-trim-${process.env.RADIOLAB_BROWSER_ENGINE || 'chromium'}-${orientation}.png`) });
            }
            await page.locator('#radiolabTrimReset').tap();
            assert.equal(await page.evaluate(() => mygrainRadiolab.state.normalized), false);
            assert.equal(await page.evaluate(() => mygrainRadiolab.state.trimmedSeconds), 2);
        }
        await page.evaluate(() => { testController.setTrim('start', 2 / 8000); testController.setTrim('end', 3 / 8000); });
        for (const selector of ['#radiolabPreview', '#radiolabNormalize', '#radiolabSave']) assert.equal(await page.locator(selector).isDisabled(), true);
        await page.evaluate(() => {
            testController.recorder.clear();
            const recorder = new MygrainRadiolab.PCMRecorder({ sampleRate: 44100 }).start(null, 0, { station: { id: 'fixture' } });
            recorder.append([Float32Array.of(-.125), Float32Array.of(.0625)]);
            testController.recorder = recorder.stop(); testController.render();
        });
        await endInput.focus();
        await endInput.press('Home');
        await startInput.focus();
        await startInput.press('End');
        assert.equal(await page.evaluate(() => testController.recorder.selectedFrames), 1);
        await page.locator('#radiolabSave').tap();
        await page.waitForFunction(() => !mygrainRadiolab.state.busy);
        assert.equal(uploads.at(-1).length, 48);
        assert.equal(uploads.at(-1).readInt16LE(44), -32768);
        assert.equal(uploads.at(-1).readInt16LE(46), 16384);
        await page.evaluate(() => window.dispatchEvent(new Event('mygrain-account-lock')));
        assert.equal(await page.locator('#radiolabTrimPanel').isHidden(), true);
        assert.equal(await page.evaluate(() => mygrainRadiolab.state.trimmedSeconds), 0);
        assert.equal(await canvas.evaluate(element => element.getContext('2d').getImageData(0, 0, element.width, element.height).data.some(value => value !== 0)), false);
        assert.deepEqual(errors, []);
    } finally {
        await browser?.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});

test('main current-take Preview and Normalize preserve stereo and Save full-scale PCM in phone portrait and landscape', { timeout: 60000 }, async () => {
    const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const card = source.slice(source.indexOf('            <div class="performance-feature-card" id="radiolabCard"'), source.indexOf('            <div class="performance-feature-card" aria-label="Bastardloop V controls">'));
    const dialog = source.match(/<dialog id="radiolabSamplesDialog"[\s\S]*?<\/dialog>/)[0];
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="radiolab.css"><style>body{margin:8px;background:#090d14;color:#eee;font:16px sans-serif}.performance-btn{border:1px solid #6e6878;border-radius:8px;background:#20232c;color:#000;font:inherit;padding:10px 14px}.performance-btn.primary{color:#00131a;background:#7ef6ff}button:disabled{opacity:.5}</style></head><body>${card}${dialog}<script>
        window.mygrainAccounts={authenticated:true,user:{username:'fixture-user'}};
        window.loads=[];
        window.mygrainRadiolabAdapter={getContext:()=>null,load:async(body,sample,target,guard)=>{guard();loads.push({filename:sample.filename,target,bytes:body.byteLength});}};
        </script><script src="radiolab.js"></script></body></html>`;
    const sampleRate = 44100;
    const pattern = [4096, 8192, -8192, -16384, 0, 0, 2048, 4096, 8192, 12288];
    const raw = Buffer.alloc(sampleRate / 10 * 4);
    for (let index = 0; index < raw.length / 2; index += 1) raw.writeInt16LE(pattern[index % pattern.length], index * 2);
    const monitorWav = Buffer.from(encodeWav([[new Float32Array(sampleRate * 15), new Float32Array(sampleRate * 15)]], sampleRate));
    for (let offset = 44; offset < monitorWav.length; offset += raw.length) raw.copy(monitorWav, offset, 0, Math.min(raw.length, monitorWav.length - offset));
    const existing = Buffer.from(monitorWav);
    const samples = new Map([['existing.wav', existing]]);
    const uploads = [];
    const streams = new Set();
    let failSave = false;
    const server = http.createServer(async (request, response) => {
        const url = new URL(request.url, 'http://localhost');
        const json = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
        if (url.pathname === '/mygrain/api/radiolab/stations') return json({ stations: ['signal', 'stall'].map(id => ({ id, name: id, streamUrl: `/mygrain/radiolab/stream/${id}` })) });
        if (url.pathname === '/mygrain/api/radiolab/stream/release') return json({ ok: true });
        if (url.pathname.startsWith('/mygrain/radiolab/stream/')) {
            if (url.searchParams.get('_radiolab_format') !== 'pcm') {
                response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': monitorWav.length });
                return response.end(monitorWav);
            }
            response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Radiolab-Sample-Rate': String(sampleRate), 'X-Radiolab-Channels': '2' });
            response.flushHeaders();
            streams.add(response);
            let timer;
            if (!url.pathname.endsWith('/stall')) {
                response.write(raw.subarray(0, 3));
                response.write(raw.subarray(3));
                timer = setInterval(() => response.write(raw), 15);
            }
            response.on('close', () => { clearInterval(timer); streams.delete(response); });
            return;
        }
        if (url.pathname === '/mygrain/api/radiolab/samples') {
            if (request.method === 'POST') {
                const chunks = [];
                for await (const chunk of request) chunks.push(chunk);
                const body = Buffer.concat(chunks);
                uploads.push(body);
                if (failSave) { failSave = false; return json({ error: 'Fixture Save failed; take retained' }, 503); }
                const filename = `${url.searchParams.get('name')}.wav`;
                samples.set(filename, body);
                return json({ sample: { filename, name: url.searchParams.get('name') } });
            }
            return json({ samples: Array.from(samples.keys(), filename => ({ filename, name: filename })) });
        }
        if (url.pathname === '/mygrain/api/radiolab/file') {
            response.writeHead(200, { 'Content-Type': 'audio/wav' });
            return response.end(samples.get(url.searchParams.get('name')));
        }
        if (url.pathname === '/mygrain/') { response.writeHead(200, { 'Content-Type': 'text/html' }); return response.end(html); }
        const asset = path.basename(url.pathname);
        if (['radiolab.js', 'radiolab.css', 'radiolab-worklet.js'].includes(asset)) {
            response.writeHead(200, { 'Content-Type': asset.endsWith('.css') ? 'text/css' : 'application/javascript' });
            return response.end(fs.readFileSync(path.join(__dirname, '..', asset)));
        }
        response.writeHead(404); response.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await launchBrowser();
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            window.previewBuffers = [];
            window.radioElements = [];
            window.radioGains = [];
            const NativeAudio = window.Audio;
            window.Audio = class extends NativeAudio { constructor(...args) { super(...args); radioElements.push(this); } };
            const Context = window.AudioContext || window.webkitAudioContext;
            const createGain = Context.prototype.createGain;
            Context.prototype.createGain = function(...args) { const gain = createGain.apply(this, args); radioGains.push(gain); return gain; };
            const createSource = Context.prototype.createBufferSource;
            Context.prototype.createBufferSource = function(...args) {
                const source = createSource.apply(this, args);
                const start = source.start.bind(source);
                source.start = (...args) => {
                    const buffer = source.buffer;
                    window.previewSource = source;
                    const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => Array.from(buffer.getChannelData(channel).slice(0, 5)));
                    previewBuffers.push({ channels, frames: buffer.length, sampleRate: buffer.sampleRate });
                    return start(...args);
                };
                return source;
            };
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/mygrain/`);
        await page.waitForFunction(() => window.mygrainRadiolab && !mygrainRadiolab.state.busy);
        for (const selector of ['#radiolabPreview', '#radiolabNormalize', '#radiolabSave']) assert.equal(await page.locator(selector).isDisabled(), true);
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            const manual = viewport.width === 390;
            await page.locator('#radiolabRecord').tap();
            await page.waitForFunction(() => mygrainRadiolab.state.recording && mygrainRadiolab.state.recordedSeconds >= 3 && !mygrainRadiolab.state.busy);
            assert.equal(await page.evaluate(() => mygrainRadiolab.state.normalized), false);
            for (const selector of ['#radiolabPreview', '#radiolabNormalize', '#radiolabSave']) assert.equal(await page.locator(selector).isDisabled(), true);
            await page.locator('#radiolabStop').tap();
            const frames = await page.evaluate(() => Math.round(mygrainRadiolab.state.recordedSeconds * 44100));
            assert.equal(await page.locator('#radiolabNormalize').isDisabled(), false);
            assert.match(await page.locator('#radiolabTake').textContent(), /Not normalized/);
            await page.locator('#radiolabListen').tap();
            await page.waitForFunction(() => mygrainRadiolab.state.listening && !mygrainRadiolab.state.busy);
            await page.locator('#radiolabPreview').tap();
            await page.waitForFunction(() => mygrainRadiolab.state.previewingTake && mygrainRadiolab.state.previewing && !mygrainRadiolab.state.busy);
            assert.equal(await page.locator('#radiolabPreview').textContent(), 'Stop Preview');
            assert.equal(await page.locator('#radiolabPreview').getAttribute('aria-pressed'), 'true');
            const rawPreview = await page.evaluate(() => previewBuffers.at(-1));
            assert.equal(rawPreview.frames, frames);
            assert.equal(rawPreview.sampleRate, sampleRate);
            assert.deepEqual(rawPreview.channels, [
                Array.from(Float32Array.from([4096 / 32767, -8192 / 32768, 0, 2048 / 32767, 8192 / 32767])),
                Array.from(Float32Array.from([8192 / 32767, -.5, 0, 4096 / 32767, 12288 / 32767]))
            ]);
            await page.waitForFunction(() => radioGains.at(-2).gain.value === 0);
            await page.locator('#radiolabPreview').tap();
            assert.equal(await page.evaluate(() => mygrainRadiolab.state.previewingTake), false);
            assert.equal(await page.evaluate(() => mygrainRadiolab.state.listening && !radioElements.at(-1).paused), true);
            await page.waitForFunction(() => Math.abs(radioGains.at(-2).gain.value - .8) < 1e-6);
            await page.locator('#radiolabPreview').tap();
            await page.waitForFunction(() => mygrainRadiolab.state.previewing && !mygrainRadiolab.state.busy);
            if (manual) {
                await page.locator('#radiolabNormalize').tap();
                await page.waitForFunction(() => mygrainRadiolab.state.normalized && !mygrainRadiolab.state.busy);
                assert.equal(await page.evaluate(() => mygrainRadiolab.state.previewing), false);
                assert.match(await page.locator('#radiolabStatus').textContent(), /normalized to peak 1.0/);
            } else failSave = true;
            await page.locator('#radiolabName').fill(manual ? 'manual' : 'automatic');
            const attempts = uploads.length;
            await page.locator('#radiolabSave').tap();
            await page.waitForFunction(() => !mygrainRadiolab.state.busy && mygrainRadiolab.state.normalized);
            assert.equal(uploads.length, attempts + 1);
            assert.equal(await page.evaluate(() => mygrainRadiolab.state.previewingTake), false);
            assert.equal(await page.locator('#radiolabNormalize').textContent(), 'Normalized');
            assert.equal(await page.locator('#radiolabNormalize').isDisabled(), true);
            assert.match(await page.locator('#radiolabTake').textContent(), /Normalized: peak 1.0/);
            const saved = uploads.at(-1);
            assert.equal(saved.readUInt16LE(22), 2);
            assert.equal(saved.readUInt32LE(24), sampleRate);
            assert.equal(saved.length, 44 + frames * 4);
            let peak = 0;
            for (let index = 0; index < frames * 2; index += 1) {
                const value = saved.readInt16LE(44 + index * 2);
                assert.equal(value, pattern[index % pattern.length] * 2);
                peak = Math.max(peak, Math.abs(value));
            }
            assert.equal(peak, 32768);
            if (!manual) {
                assert.match(await page.locator('#radiolabStatus').textContent(), /Fixture Save failed/);
                assert.equal(await page.locator('#radiolabSave').isDisabled(), false);
                await page.locator('#radiolabSave').tap();
                await page.waitForFunction(() => !mygrainRadiolab.state.busy && document.getElementById('radiolabStatus').textContent.includes('Saved “'));
                assert.deepEqual(uploads.at(-1), saved);
            }
            await page.locator('#radiolabPreview').tap();
            await page.waitForFunction(() => mygrainRadiolab.state.previewing && !mygrainRadiolab.state.busy);
            const normalizedPreview = await page.evaluate(() => previewBuffers.at(-1));
            assert.deepEqual(normalizedPreview.channels, rawPreview.channels.map(channel => channel.map(value => value * 2)));
            assert.equal(normalizedPreview.frames, frames);
            await page.waitForFunction(() => !mygrainRadiolab.state.previewingTake && !mygrainRadiolab.state.previewing);
            assert.equal(await page.locator('#radiolabPreview').textContent(), 'Preview');
            assert.equal(await page.evaluate(() => mygrainRadiolab.state.listening), true);
            await page.evaluate(() => document.getElementById('radiolabNormalize').dispatchEvent(new Event('click')));
            await page.waitForFunction(() => !mygrainRadiolab.state.busy);
            await page.locator('#radiolabSave').tap();
            await page.waitForFunction(() => !mygrainRadiolab.state.busy && document.getElementById('radiolabStatus').textContent.includes('Saved “'));
            assert.deepEqual(uploads.at(-1), saved);
            await page.evaluate(({ frames, sampleRate }) => {
                for (const [id, frame] of [['radiolabTrimStart', 7], ['radiolabTrimEnd', frames - 11]]) {
                    const input = document.getElementById(id); input.value = String(frame / sampleRate); input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }, { frames, sampleRate });
            assert.equal(await page.evaluate(() => mygrainRadiolab.state.normalized), false);
            await page.locator('#radiolabPreview').tap();
            await page.waitForFunction(() => mygrainRadiolab.state.previewingTake && !mygrainRadiolab.state.busy);
            const selectedRaw = await page.evaluate(() => previewBuffers.at(-1));
            assert.equal(selectedRaw.frames, frames - 18);
            assert.equal(selectedRaw.sampleRate, sampleRate);
            assert.deepEqual(selectedRaw.channels, rawPreview.channels.map(channel => channel.map((unused, offset) => channel[(7 + offset) % channel.length])));
            await page.locator('#radiolabSave').tap();
            await page.waitForFunction(() => !mygrainRadiolab.state.busy && mygrainRadiolab.state.normalized);
            const selectedSaved = uploads.at(-1);
            assert.equal(selectedSaved.length, 44 + (frames - 18) * 4);
            for (let index = 0; index < (frames - 18) * 2; index += 1) assert.equal(selectedSaved.readInt16LE(44 + index * 2), pattern[(index + 14) % pattern.length] * 2);
            await page.locator('#radiolabPreview').tap();
            await page.waitForFunction(() => mygrainRadiolab.state.previewingTake && !mygrainRadiolab.state.busy);
            const selectedNormalized = await page.evaluate(() => previewBuffers.at(-1));
            assert.equal(selectedNormalized.frames, frames - 18);
            assert.deepEqual(selectedNormalized.channels, selectedRaw.channels.map(channel => channel.map(value => value * 2)));
            await page.locator('#radiolabPreview').tap();
            await page.locator('#radiolabSave').tap();
            await page.waitForFunction(() => !mygrainRadiolab.state.busy);
            assert.deepEqual(uploads.at(-1), selectedSaved);
            for (const selector of ['#radiolabPreview', '#radiolabNormalize']) {
                const bounds = await page.locator(selector).boundingBox();
                assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width && bounds.height >= 44, `${selector} ${JSON.stringify(bounds)}`);
                const colors = await page.locator(selector).evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
                assert.notEqual(colors.color, colors.background);
                assert.notEqual(colors.color, 'rgb(0, 0, 0)');
            }
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            if (process.env.RADIOLAB_EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.RADIOLAB_EVIDENCE_DIR, `${process.env.RADIOLAB_BROWSER_ENGINE || 'chromium'}-main-${viewport.width}.png`), fullPage: true });
            await page.locator('#radiolabPreview').tap();
            await page.waitForFunction(() => mygrainRadiolab.state.previewing && !mygrainRadiolab.state.busy);
            await page.locator('#radiolabBrowser').tap();
            await page.waitForFunction(() => document.querySelectorAll('.radiolab-sample-row').length >= 2 && !mygrainRadiolab.state.busy);
            assert.equal(await page.evaluate(() => mygrainRadiolab.state.previewing), false);
            const row = page.locator('.radiolab-sample-row[data-filename="existing.wav"]');
            await row.locator('[data-action="play"]').tap();
            await page.waitForFunction(() => mygrainRadiolab.state.previewing && !mygrainRadiolab.state.busy);
            assert.equal(await page.evaluate(() => mygrainRadiolab.state.previewingTake), false);
            assert.equal(await page.evaluate(() => mygrainRadiolab.state.normalized), true);
            assert.equal(await row.locator('[data-action="play"]').textContent(), 'Stop');
            const savedPreview = await page.evaluate(async encoded => {
                const source = window.previewSource;
                const actual = source.buffer;
                const Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                const expected = await new Context(2, 1, source.context.sampleRate).decodeAudioData(Uint8Array.from(atob(encoded), character => character.charCodeAt(0)).buffer);
                const channelsEqual = Array.from({ length: expected.numberOfChannels }, (unused, channelIndex) => {
                    const expectedChannel = expected.getChannelData(channelIndex);
                    return actual.getChannelData(channelIndex).every((value, frameIndex) => value === expectedChannel[frameIndex]);
                });
                return {
                    contextSampleRate: source.context.sampleRate,
                    actual: { sampleRate: actual.sampleRate, frames: actual.length, channels: actual.numberOfChannels },
                    expected: { sampleRate: expected.sampleRate, frames: expected.length, channels: expected.numberOfChannels },
                    channelsEqual
                };
            }, existing.toString('base64'));
            assert.equal(savedPreview.actual.sampleRate, savedPreview.contextSampleRate);
            assert.deepEqual(savedPreview.actual, savedPreview.expected);
            assert.deepEqual(savedPreview.channelsEqual, [true, true]);
            await row.locator('[data-action="play"]').tap();
            await row.locator('[data-action="load"]').tap();
            await page.waitForFunction(() => loads.length > 0 && !mygrainRadiolab.state.busy);
            await page.locator('#radiolabBrowserClose').tap();
            await page.locator('#radiolabStop').tap();
        }
        await page.selectOption('#radiolabStation', 'stall');
        await page.locator('#radiolabRecord').tap();
        await page.waitForFunction(() => mygrainRadiolab.state.armed && !mygrainRadiolab.state.busy);
        for (const selector of ['#radiolabPreview', '#radiolabNormalize', '#radiolabSave']) assert.equal(await page.locator(selector).isDisabled(), true);
        await page.locator('#radiolabStop').tap();
        assert.equal(await page.evaluate(() => mygrainRadiolab.state.normalized), true);
        assert.equal(await page.locator('#radiolabPreview').isDisabled(), false);
        await page.evaluate(() => dispatchEvent(new Event('mygrain-account-lock')));
        assert.equal(await page.evaluate(() => mygrainRadiolab.state.normalized || mygrainRadiolab.state.previewingTake), false);
        for (const selector of ['#radiolabPreview', '#radiolabNormalize', '#radiolabSave']) assert.equal(await page.locator(selector).isDisabled(), true);
        assert.deepEqual(samples.get('existing.wav'), existing);
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
        for (const stream of streams) stream.end();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});

test('recording cards provide private Play/Stop, Load, Rename, Re-trim and confirmed Delete with phone-sized portrait and landscape controls', { timeout: 60000 }, async () => {
    const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const card = source.slice(source.indexOf('            <div class="performance-feature-card" id="radiolabCard"'), source.indexOf('            <div class="performance-feature-card" aria-label="Bastardloop V controls">'));
    const dialog = source.match(/<dialog id="radiolabSamplesDialog"[\s\S]*?<\/dialog>/)[0];
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="radiolab.css"><style>body{margin:8px;background:#090d14;color:#eee;font:16px sans-serif}.sample-browser-card-actions{flex-direction:column;align-items:stretch}.performance-btn{border:1px solid #6e6878;border-radius:8px;background:#20232c;color:#000;font:inherit;padding:10px 14px}.performance-btn.primary{color:#00131a;background:linear-gradient(135deg,#7ef6ff,#00c6ff,#7effb2)}button:disabled{opacity:.5}</style></head><body>${card}${dialog}<script>
        const username = new URL(location.href).searchParams.get('user') || 'alice';
        window.mygrainAccounts = {authenticated:true,user:{username}};
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (url, options = {}) => {
            const headers = new Headers(options.headers);
            headers.set('X-Mygrain-User', mygrainAccounts.user.username);
            if (options.method === 'DELETE') window.deletePreviewing = mygrainRadiolab.state.previewing;
            return nativeFetch(url, {...options, headers});
        };
        window.loads = [];
        window.mygrainRadiolabAdapter = {getContext:()=>null,load:async(body,sample,target,guard)=>{guard();loads.push({filename:sample.filename,target,bytes:body.byteLength});}};
        </script><script src="radiolab.js"></script></body></html>`;
    const sampleRate = 8000;
    const channel = Float32Array.from({ length: sampleRate * 8 }, (_, frame) => .25 * Math.sin(frame * 2 * Math.PI * 440 / sampleRate));
    const wav = Buffer.from(encodeWav([[channel, channel]], sampleRate));
    const libraries = new Map([
        ['alice', [
            { filename: 'Named radio + café.wav', name: 'Evening bulletin', duration: 8 },
            { filename: 'another-recording.wav', name: 'A second private recording', duration: 8 },
            { filename: 'long-name-' + 'radio-station-'.repeat(12) + '.wav', name: 'LongUnbrokenRecordingName'.repeat(7), duration: 8 }
        ]],
        ['bob', [{ filename: 'bob-only.wav', name: 'Bob private recording', duration: 8 }]]
    ]);
    const deleted = [];
    let deleteFailure = false;
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        const json = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
        const user = request.headers['x-mygrain-user'];
        if (url.pathname.startsWith('/mygrain/api/radiolab/')) {
            if (!libraries.has(user)) return json({ error: 'Sign in required' }, 401);
            if (url.pathname.endsWith('/stations')) return json({ stations: [] });
            if (url.pathname.endsWith('/samples')) {
                if (request.method === 'DELETE') {
                    if (deleteFailure) return json({ error: 'Fixture delete failed; recording retained' }, 500);
                    const filename = url.searchParams.get('name');
                    if (!libraries.get(user).some(sample => sample.filename === filename)) return json({ error: 'Not found' }, 404);
                    libraries.set(user, libraries.get(user).filter(sample => sample.filename !== filename));
                    deleted.push({ user, filename });
                    return json({ ok: true });
                }
                return json({ samples: libraries.get(user) });
            }
            if (url.pathname.endsWith('/file')) {
                if (!libraries.get(user).some(sample => sample.filename === url.searchParams.get('name'))) return json({ error: 'Not found' }, 404);
                response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
                return response.end(wav);
            }
        }
        if (url.pathname === '/mygrain/') { response.writeHead(200, { 'Content-Type': 'text/html' }); return response.end(html); }
        const asset = path.basename(url.pathname);
        if (['radiolab.js', 'radiolab.css'].includes(asset)) {
            response.writeHead(200, { 'Content-Type': asset.endsWith('.css') ? 'text/css' : 'application/javascript' });
            return response.end(fs.readFileSync(path.join(__dirname, '..', asset)));
        }
        response.writeHead(404); response.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await launchBrowser();
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const base = `http://127.0.0.1:${server.address().port}/mygrain/`;
        await page.goto(base);
        await page.waitForFunction(() => window.mygrainRadiolab && !mygrainRadiolab.state.busy);
        await page.locator('#radiolabBrowser').tap();
        await page.waitForFunction(() => document.querySelectorAll('.radiolab-sample-row').length === 3 && !mygrainRadiolab.state.busy);
        const modal = page.locator('#radiolabSamplesDialog');
        assert.equal(await modal.getByRole('button', { name: 'Close', exact: true }).count(), 1);
        assert.equal(await modal.locator('select').count(), 1);
        const first = page.locator('.radiolab-sample-row').filter({ has: page.getByRole('heading', { name: 'Evening bulletin', exact: true }) });
        assert.equal(await first.getAttribute('data-filename'), 'Named radio + café.wav');
        assert.deepEqual(await first.locator('[data-action]').evaluateAll(buttons => buttons.map(button => button.dataset.action)), ['play', 'load', 'rename', 'trim', 'delete']);
        assert.equal(await first.locator('[data-action="rename"]').textContent(), 'Rename file');
        assert.equal(await first.locator('[data-action="trim"]').textContent(), 'Re-trim');
        assert.equal(await first.locator('[data-action="play"]').getAttribute('aria-label'), 'Play Named radio + café.wav');
        for (const selector of ['#radiolabBrowserClose', '#radiolabRefreshSamples', '[data-action="play"]']) {
            const colors = await modal.locator(selector).evaluateAll(buttons => buttons.map(button => getComputedStyle(button).color));
            assert.ok(colors.length > 0);
            assert.ok(colors.every(color => color === 'rgb(238, 238, 238)'), `${selector}: ${colors}`);
        }
        assert.equal(await first.locator('[data-action="load"]').evaluate(button => getComputedStyle(button).color), 'rgb(0, 19, 26)');
        await first.locator('[data-action="play"]').tap();
        await page.waitForFunction(() => mygrainRadiolab.state.previewing && !mygrainRadiolab.state.busy);
        assert.equal(await first.locator('[data-action="play"]').textContent(), 'Stop');
        assert.equal(await first.locator('[data-action="play"]').evaluate(button => getComputedStyle(button).color), 'rgb(238, 238, 238)');
        await first.locator('[data-action="play"]').tap();
        assert.equal(await page.evaluate(() => mygrainRadiolab.state.previewing), false);
        for (const target of ['V', 'grainMain', 'grainA', 'grainB']) {
            await page.selectOption('#radiolabLoadTarget', target);
            assert.ok((await first.locator('[data-action="load"]').getAttribute('aria-label')).includes('Named radio + café.wav'));
            await first.locator('[data-action="load"]').tap();
            await page.waitForFunction(target => loads.some(load => load.target === target) && !mygrainRadiolab.state.busy, target);
            assert.equal(await page.evaluate(() => mygrainRadiolab.state.previewing), false);
        }
        assert.deepEqual(await page.evaluate(() => loads.map(load => load.bytes)), Array(4).fill(wav.length));
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }, { width: 568, height: 320 }]) {
            await page.setViewportSize(viewport);
            const layout = await modal.evaluate(element => {
                const rect = element.getBoundingClientRect();
                return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight,
                    overflow: element.scrollWidth > element.clientWidth + 1,
                    buttons: Array.from(element.querySelectorAll('button'), button => { const box = button.getBoundingClientRect(); return { width: box.width, height: box.height, fontSize: getComputedStyle(button).fontSize }; }) };
            });
            assert.equal(layout.overflow, false, JSON.stringify({ viewport, layout }));
            assert.ok(layout.left >= 0 && layout.right <= layout.width + 1 && layout.top >= 0 && layout.bottom <= layout.height + 1);
            assert.ok(layout.buttons.every(button => button.width >= 44 && button.width <= 160 && button.height >= 44 && button.fontSize === '14px'), JSON.stringify(layout.buttons));
            await modal.locator('[data-action="delete"]').last().scrollIntoViewIfNeeded();
            assert.equal(await modal.locator('[data-action="delete"]').last().isVisible(), true);
        }
        const artifactDirectory = process.env.RADIOLAB_SCREENSHOT_DIR;
        if (artifactDirectory) {
            fs.mkdirSync(artifactDirectory, { recursive: true });
            const engine = process.env.RADIOLAB_BROWSER_ENGINE || 'chromium';
            for (const [orientation, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
                await page.setViewportSize(viewport);
                await modal.evaluate(element => { element.scrollTop = 0; });
                await page.screenshot({ path: path.join(artifactDirectory, `radiolab-recordings-${engine}-${orientation}.png`) });
            }
        }
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await first.locator('[data-action="delete"]').evaluate(button => getComputedStyle(button).color), 'rgb(255, 181, 181)');
        page.once('dialog', confirmation => { assert.ok(confirmation.message().includes('Named radio + café.wav')); return confirmation.dismiss(); });
        await first.locator('[data-action="delete"]').tap();
        await page.waitForFunction(() => !mygrainRadiolab.state.busy);
        assert.equal(deleted.length, 0);
        assert.equal(await page.locator('.radiolab-sample-row').count(), 3);
        await first.locator('[data-action="play"]').tap();
        await page.waitForFunction(() => mygrainRadiolab.state.previewing && !mygrainRadiolab.state.busy);
        page.once('dialog', confirmation => confirmation.accept());
        await first.locator('[data-action="delete"]').tap();
        await page.waitForFunction(() => document.querySelectorAll('.radiolab-sample-row').length === 2 && !mygrainRadiolab.state.busy);
        assert.equal(await page.evaluate(() => window.deletePreviewing), false);
        assert.equal(await page.evaluate(() => mygrainRadiolab.state.previewing), false);
        assert.deepEqual(deleted, [{ user: 'alice', filename: 'Named radio + café.wav' }]);
        deleteFailure = true;
        page.once('dialog', confirmation => confirmation.accept());
        await page.locator('.radiolab-sample-row [data-action="delete"]').first().tap();
        await page.waitForFunction(() => !mygrainRadiolab.state.busy);
        assert.match(await page.locator('#radiolabBrowserStatus').textContent(), /Fixture delete failed/);
        assert.equal(await page.locator('.radiolab-sample-row').count(), 2);
        await page.locator('#radiolabBrowserClose').tap();
        await page.locator('#radiolabBrowser').tap();
        await page.waitForFunction(() => document.querySelectorAll('.radiolab-sample-row').length === 2 && !mygrainRadiolab.state.busy);
        await page.locator('.radiolab-sample-row [data-action="play"]').first().tap();
        await page.waitForFunction(() => mygrainRadiolab.state.previewing && !mygrainRadiolab.state.busy);
        await page.evaluate(() => { mygrainAccounts.authenticated = false; dispatchEvent(new Event('mygrain-account-lock')); });
        assert.equal(await modal.evaluate(element => element.open), false);
        assert.equal(await page.locator('.radiolab-sample-row').count(), 0);
        assert.equal(await page.evaluate(() => mygrainRadiolab.state.previewing), false);
        await page.goto(base + '?user=bob');
        await page.waitForFunction(() => window.mygrainRadiolab && !mygrainRadiolab.state.busy);
        await page.locator('#radiolabBrowser').tap();
        await page.waitForFunction(() => document.querySelectorAll('.radiolab-sample-row').length === 1 && !mygrainRadiolab.state.busy);
        assert.equal(await page.locator('.radiolab-sample-row').getAttribute('data-filename'), 'bob-only.wav');
        assert.doesNotMatch(await modal.textContent(), /Evening bulletin|another-recording|LongUnbroken/);
        assert.equal(deleted.length, 1);
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});

test('touch station changes, hung/failed play, deadlines and interrupted contexts recover with generation-scoped release', { timeout: 30000 }, async () => {
    const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const card = source.slice(source.indexOf('            <div class="performance-feature-card" id="radiolabCard"'), source.indexOf('            <div class="performance-feature-card" aria-label="Bastardloop V controls">'));
    const dialog = source.match(/<dialog id="radiolabSamplesDialog"[\s\S]*?<\/dialog>/)[0];
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="radiolab.css"></head><body>${card}${dialog}<script>window.mygrainAccounts={authenticated:true,user:{username:'fixture-user'}};window.mygrainRadiolabAdapter={getContext:()=>null};</script><script src="radiolab.js"></script></body></html>`;
    const sampleRate = 24000;
    const channel = Float32Array.from({ length: sampleRate * 8 }, (_, frame) => .25 * Math.sin(frame * 2 * Math.PI * 440 / sampleRate));
    const wav = Buffer.from(encodeWav([[channel, channel]], sampleRate));
    const streams = [];
    const releases = [];
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        const json = body => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
        if (url.pathname === '/mygrain/api/radiolab/stations') return json({ stations: ['first', 'second'].map(id => ({ id, name: id, streamUrl: `/mygrain/radiolab/stream/${id}` })) });
        if (url.pathname === '/mygrain/api/radiolab/stream/release') {
            assert.equal(request.method, 'POST');
            assert.equal(request.headers['x-mygrain-user'], 'fixture-user');
            releases.push(url);
            return json({ ok: true, released: true });
        }
        if (url.pathname.startsWith('/mygrain/radiolab/stream/')) {
            streams.push(url);
            response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
            return response.end(wav);
        }
        if (url.pathname === '/mygrain/') { response.writeHead(200, { 'Content-Type': 'text/html' }); return response.end(html); }
        const asset = path.basename(url.pathname);
        if (['radiolab.js', 'radiolab-worklet.js', 'radiolab.css'].includes(asset)) {
            response.writeHead(200, { 'Content-Type': asset.endsWith('.css') ? 'text/css' : 'application/javascript' });
            return response.end(fs.readFileSync(path.join(__dirname, '..', asset)));
        }
        response.writeHead(404);
        response.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await launchBrowser();
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            window.radioElements = [];
            window.radioSources = 0;
            window.radioPlays = [];
            window.radioPlayMode = 'hung';
            window.radioClick = false;
            document.addEventListener('click', () => { window.radioClick = true; }, true);
            document.addEventListener('click', () => { window.radioClick = false; });
            const NativeAudio = window.Audio;
            window.Audio = function (...args) { const audio = new NativeAudio(...args); radioElements.push(audio); return audio; };
            window.Audio.prototype = NativeAudio.prototype;
            const Context = window.AudioContext || window.webkitAudioContext;
            const source = Context.prototype.createMediaElementSource;
            Context.prototype.createMediaElementSource = function (audio) { radioSources += 1; window.radioContext = this; return source.call(this, audio); };
            const play = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function () {
                radioPlays.push({ gesture: radioClick, url: this.src });
                if (radioPlayMode === 'hung') return new Promise((resolve, reject) => { window.rejectOldPlay = reject; });
                if (radioPlayMode === 'failed') return Promise.reject(new Error('fixture denied playback; tap again'));
                return play.call(this);
            };
            const timeout = window.setTimeout.bind(window);
            window.setTimeout = (handler, delay, ...args) => timeout(handler, delay === 12000 ? 800 : delay, ...args);
        });
        page.setDefaultTimeout(10000);
        await page.goto(`http://127.0.0.1:${server.address().port}/mygrain/`);
        await page.waitForFunction(() => window.mygrainRadiolab && !mygrainRadiolab.state.busy);
        await page.locator('#radiolabListen').tap();
        assert.equal(await page.locator('#radiolabStation').isDisabled(), false);
        await page.selectOption('#radiolabStation', 'second');
        assert.equal(await page.evaluate(() => mygrainRadiolab.state.busy || mygrainRadiolab.state.listening), false);
        assert.equal(await page.evaluate(() => radioElements[0].hasAttribute('src')), false);
        await page.evaluate(() => { radioPlayMode = 'native'; });
        await page.locator('#radiolabListen').tap();
        await page.waitForFunction(() => radioElements[0].currentTime > .2 && !mygrainRadiolab.state.busy);
        await page.evaluate(() => rejectOldPlay(new Error('stale station rejection')));
        await page.waitForTimeout(50);
        assert.equal(await page.evaluate(() => mygrainRadiolab.state.listening), true);
        assert.equal(await page.evaluate(() => radioElements.length), 1);
        assert.equal(await page.evaluate(() => radioSources), 1);
        await page.locator('#radiolabStop').tap();
        await page.evaluate(() => { radioPlayMode = 'failed'; });
        await page.locator('#radiolabListen').tap();
        await page.waitForFunction(() => !mygrainRadiolab.state.busy);
        assert.match(await page.locator('#radiolabStatus').textContent(), /fixture denied/);
        await page.evaluate(() => { radioPlayMode = 'native'; });
        await page.locator('#radiolabListen').tap();
        await page.waitForFunction(() => radioElements[0].currentTime > .2 && !mygrainRadiolab.state.busy);
        const attempts = await page.evaluate(() => radioPlays);
        assert.deepEqual(attempts.map(attempt => new URL(attempt.url).searchParams.get('_radiolab_generation')), ['1', '2', '3', '4']);
        assert.ok(attempts.every(attempt => attempt.gesture));
        assert.equal(new Set(attempts.map(attempt => new URL(attempt.url).searchParams.get('_radiolab_client'))).size, 1);
        await page.evaluate(() => radioContext.suspend());
        await page.waitForFunction(() => !mygrainRadiolab.state.listening);
        assert.equal(await page.evaluate(() => radioElements[0].hasAttribute('src')), false);
        await page.evaluate(() => { radioPlayMode = 'hung'; });
        await page.locator('#radiolabListen').tap();
        await page.locator('#radiolabStop').tap();
        assert.equal(await page.evaluate(() => mygrainRadiolab.state.busy), false);
        await page.locator('#radiolabListen').tap();
        await page.waitForFunction(() => !mygrainRadiolab.state.busy);
        assert.match(await page.locator('#radiolabStatus').textContent(), /timed out/);
        await page.evaluate(() => { radioPlayMode = 'native'; });
        await page.locator('#radiolabListen').tap();
        await page.waitForFunction(() => radioElements[0].currentTime > .2 && !mygrainRadiolab.state.busy);
        await page.locator('#radiolabStop').tap();
        await page.waitForFunction(() => !mygrainRadiolab.state.busy);
        assert.equal(await page.evaluate(() => radioSources), 1);
        await page.waitForTimeout(100);
        assert.deepEqual(releases.map(url => url.searchParams.get('_radiolab_generation')).sort(), ['1', '2', '3', '4', '5', '6', '7']);
        assert.ok(streams.every(url => /^[A-Za-z0-9_-]{16,96}$/.test(url.searchParams.get('_radiolab_client'))));
        assert.deepEqual(errors, []);
        await page.close();
    } finally {
        await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});

for (const mode of ['zero-worklet', 'zero-script', 'no-callback', 'no-WebAudio']) test('manual server PCM recording independent of iPhone-style unavailable tap: ' + mode, { timeout: 30000 }, async () => {
    const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const card = source.slice(source.indexOf('            <div class="performance-feature-card" id="radiolabCard"'), source.indexOf('            <div class="performance-feature-card" aria-label="Bastardloop V controls">'));
    const dialog = source.match(/<dialog id="radiolabSamplesDialog"[\s\S]*?<\/dialog>/)[0];
    const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="radiolab.css"></head><body>' + card + dialog + '<script>window.mygrainAccounts={authenticated:true,user:{username:"fixture-user"}};window.loads=[];window.mygrainRadiolabAdapter={getContext:()=>null,load:async(body,sample,target,guard)=>{guard();loads.push({target,bytes:body.byteLength});}};</script><script src="radiolab.js"></script></body></html>';
    const sampleRate = 44100;
    const channel = Float32Array.from({ length: sampleRate * 15 }, (_, frame) => .25 * Math.sin(frame * 2 * Math.PI * 440 / sampleRate));
    const wav = Buffer.from(encodeWav([[channel, channel]], sampleRate));
    const raw = wav.subarray(44);
    const captureRequests = [];
    const monitorRequests = [];
    const releases = [];
    const active = new Set();
    let saved;
    const server = http.createServer(async (request, response) => {
        const url = new URL(request.url, 'http://localhost');
        const json = body => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
        if (url.pathname === '/mygrain/api/radiolab/stations') return json({ stations: ['signal', 'stall'].map(id => ({ id, name: id, streamUrl: '/mygrain/radiolab/stream/' + id })) });
        if (url.pathname === '/mygrain/api/radiolab/stream/release') { releases.push(url); return json({ ok: true }); }
        if (url.pathname.startsWith('/mygrain/radiolab/stream/')) {
            if (url.searchParams.get('_radiolab_format') !== 'pcm') {
                monitorRequests.push(url);
                response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
                return response.end(wav);
            }
            assert.equal(request.headers['x-mygrain-user'], 'fixture-user');
            assert.match(url.searchParams.get('_radiolab_client'), /-pcm$/);
            captureRequests.push(url);
            response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Radiolab-Sample-Rate': '44100', 'X-Radiolab-Channels': '2', 'Cache-Control': 'no-store' });
            response.flushHeaders();
            active.add(response);
            if (url.pathname.endsWith('/stall')) { response.on('close', () => active.delete(response)); return; }
            let offset = 0;
            const deliver = () => {
                if (offset >= raw.length) { clearInterval(timer); response.end(); return; }
                const bytes = raw.subarray(offset, offset + 17640);
                offset += bytes.length;
                response.write(bytes.subarray(0, 3));
                response.write(bytes.subarray(3));
            };
            const timer = setInterval(deliver, 100);
            deliver();
            response.on('close', () => { clearInterval(timer); active.delete(response); });
            return;
        }
        if (url.pathname === '/mygrain/api/radiolab/samples' && request.method === 'POST') {
            const chunks = [];
            for await (const bytes of request) chunks.push(bytes);
            saved = Buffer.concat(chunks);
            return json({ sample: { filename: 'manual.wav', name: 'Manual capture', duration: saved.readUInt32LE(40) / 4 / 44100 } });
        }
        if (url.pathname === '/mygrain/api/radiolab/samples') return json({ samples: saved ? [{ filename: 'manual.wav', name: 'Manual capture' }] : [] });
        if (url.pathname === '/mygrain/api/radiolab/file') { response.writeHead(200, { 'Content-Type': 'audio/wav' }); return response.end(saved); }
        if (url.pathname === '/mygrain/') { response.writeHead(200, { 'Content-Type': 'text/html' }); return response.end(html); }
        const asset = path.basename(url.pathname);
        if (['radiolab.js', 'radiolab-worklet.js', 'radiolab.css'].includes(asset)) {
            response.writeHead(200, { 'Content-Type': asset.endsWith('.css') ? 'text/css' : 'application/javascript' });
            return response.end(fs.readFileSync(path.join(__dirname, '..', asset)));
        }
        response.writeHead(404); response.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await launchBrowser();
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(mode => {
            const nativeTimeout = window.setTimeout.bind(window);
            window.setTimeout = (handler, delay, ...args) => nativeTimeout(handler, delay === 12000 ? 1500 : delay, ...args);
            if (mode === 'no-WebAudio') {
                window.AudioContext = undefined;
                window.webkitAudioContext = undefined;
                window.Audio = class { constructor() { throw new Error('Recording must not construct native audio'); } };
                return;
            }
            const NativeAudio = window.Audio;
            window.radioElements = [];
            window.Audio = class extends NativeAudio { constructor(...args) { super(...args); radioElements.push(this); } };
            if (mode === 'zero-script') {
                window.AudioWorkletNode = undefined;
                const original = AudioContext.prototype.createScriptProcessor;
                AudioContext.prototype.createScriptProcessor = function(...args) {
                    const tap = original.apply(this, args);
                    tap.addEventListener('audioprocess', event => { for (let channel = 0; channel < event.inputBuffer.numberOfChannels; channel += 1) event.inputBuffer.getChannelData(channel).fill(0); });
                    return tap;
                };
            } else {
                const NativeWorklet = window.AudioWorkletNode;
                window.AudioWorkletNode = class extends NativeWorklet {
                    constructor(...args) {
                        super(...args);
                        this.port.addEventListener('message', event => {
                            if (event.data.type !== 'pcm') return;
                            if (mode === 'no-callback') { this.port.postMessage({ type: 'ack' }); event.stopImmediatePropagation(); }
                            else event.data.channels.forEach(channel => channel.fill(0));
                        });
                    }
                };
            }
        }, mode);
        page.setDefaultTimeout(8000);
        await page.goto('http://127.0.0.1:' + server.address().port + '/mygrain/');
        await page.waitForFunction(() => window.mygrainRadiolab && !mygrainRadiolab.state.busy);
        await page.selectOption('#radiolabStation', 'signal');
        assert.equal(await page.locator('#radiolabRewind').isVisible(), false);
        assert.equal(await page.locator('#radiolabAudition').isVisible(), false);
        if (mode !== 'no-WebAudio') {
            await page.locator('#radiolabListen').tap();
            await page.waitForFunction(() => radioElements[0]?.currentTime > .35 && !mygrainRadiolab.state.busy);
            assert.equal(await page.evaluate(() => radioElements[0].paused), false);
            assert.equal(await page.evaluate(() => mygrainRadiolab.diagnostics.hasSignal), false);
        }
        await page.locator('#radiolabRecord').tap();
        await page.waitForFunction(() => mygrainRadiolab.state.recording && mygrainRadiolab.state.recordedSeconds >= .3 && !mygrainRadiolab.state.busy);
        assert.equal(await page.evaluate(() => mygrainRadiolab.state.armed), false);
        assert.equal(await page.evaluate(() => mygrainRadiolab.diagnostics.hasSignal), false);
        assert.equal(await page.evaluate(() => mygrainRadiolab.diagnostics.takeHasSignal), true);
        assert.equal(await page.evaluate(() => mygrainRadiolab.diagnostics.capture.path), 'server-pcm-fetch');
        assert.equal(await page.evaluate(() => mygrainRadiolab.state.bufferSeconds || mygrainRadiolab.state.rewindSeconds), 0);
        assert.equal(captureRequests.length, 1);
        assert.equal(monitorRequests.length, mode === 'no-WebAudio' ? 0 : 1);
        await page.locator('#radiolabStop').tap();
        const stopped = await page.evaluate(() => mygrainRadiolab.state.recordedSeconds);
        assert.equal(await page.locator('#radiolabSave').isDisabled(), false);
        await page.locator('#radiolabName').fill('Independent live capture');
        await page.locator('#radiolabSave').tap();
        await page.waitForFunction(() => !mygrainRadiolab.state.busy && document.getElementById('radiolabStatus').textContent.includes('Saved “')).catch(async error => {
            throw new Error(error.message + '; status=' + await page.locator('#radiolabStatus').textContent() + '; state=' + JSON.stringify(await page.evaluate(() => mygrainRadiolab.state)) + '; saved=' + Boolean(saved) + '; errors=' + JSON.stringify(errors));
        });
        assert.ok(saved.subarray(44).some(value => value !== 0));
        assert.equal(saved.readUInt32LE(24), 44100);
        assert.equal(saved.length, 44 + Math.round(stopped * 44100) * 4);
        if (mode !== 'no-WebAudio') {
            await page.locator('#radiolabBrowser').tap();
            await page.waitForFunction(() => document.querySelectorAll('#radiolabSampleList .radiolab-sample-row').length === 1 && !mygrainRadiolab.state.busy);
            await page.locator('.radiolab-sample-row [data-action="play"]').tap();
            await page.waitForFunction(() => mygrainRadiolab.state.previewing && !mygrainRadiolab.state.busy);
            await page.locator('.radiolab-sample-row [data-action="play"]').tap();
            for (const target of ['grainMain', 'grainA', 'grainB', 'V']) {
                await page.selectOption('#radiolabLoadTarget', target);
                await page.locator('.radiolab-sample-row [data-action="load"]').tap();
                await page.waitForFunction(target => loads.some(load => load.target === target) && !mygrainRadiolab.state.busy, target);
            }
            assert.deepEqual(await page.evaluate(() => loads.map(load => load.bytes)), Array(4).fill(saved.length));
            await page.locator('#radiolabBrowserClose').tap();
        }
        await page.selectOption('#radiolabStation', 'stall');
        await page.locator('#radiolabRecord').tap();
        await page.waitForFunction(() => !mygrainRadiolab.state.armed && !mygrainRadiolab.state.busy && mygrainRadiolab.diagnostics.capture.state === 'failed');
        assert.equal(await page.evaluate(() => mygrainRadiolab.state.recordedSeconds), stopped);
        assert.equal(await page.locator('#radiolabSave').isDisabled(), false);
        assert.match(await page.locator('#radiolabStatus').textContent(), /within 12 seconds/);
        await page.evaluate(() => window.dispatchEvent(new Event('mygrain-account-lock')));
        assert.equal(await page.evaluate(() => mygrainRadiolab.state.locked), true);
        assert.equal(await page.evaluate(() => mygrainRadiolab.diagnostics.capture), null);
        assert.deepEqual(await page.evaluate(() => mygrainRadiolab.diagnostics.events), []);
        assert.deepEqual(errors, []);
        await page.close();
        assert.equal(releases.filter(url => url.searchParams.get('_radiolab_client').endsWith('-pcm')).length, 2);
    } finally {
        await browser.close();
        for (const response of active) response.end();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
