const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const origin = new URL(process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18849/mygrain/').origin;
const sourcePath = process.env.WAV_EXPORT_SOURCE || path.join(root, 'index.html');
const evidence = process.env.WAV_EXPORT_EVIDENCE;
const engines = (process.env.WAV_EXPORT_ENGINES || 'chromium,webkit').split(',');
const sampleRate = Number(process.env.WAV_EXPORT_SAMPLE_RATE) || 48000;
const mockApis = process.env.WAV_EXPORT_MOCK_APIS !== '0';
const observeCapture = process.env.WAV_EXPORT_OBSERVE_CAPTURE === '1';
const sourceKind = process.env.WAV_EXPORT_SOURCE_KIND || 'loop-a';
if (!mockApis && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('Real-backend WAV export checks require an isolated localhost server.');
}

function inspectWav(bytes) {
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    const channels = bytes.readUInt16LE(22);
    const sampleRate = bytes.readUInt32LE(24);
    const bits = bytes.readUInt16LE(34);
    const frames = bytes.readUInt32LE(40) / (channels * bits / 8);
    const peaks = Array(channels).fill(0);
    const sums = Array(channels).fill(0);
    const nonzero = Array(channels).fill(0);
    for (let frame = 0; frame < frames; frame += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
            const value = bytes.readIntLE(44 + (frame * channels + channel) * 3, 3) / 0x800000;
            peaks[channel] = Math.max(peaks[channel], Math.abs(value));
            sums[channel] += value * value;
            if (value !== 0) nonzero[channel] += 1;
        }
    }
    return { channels, sampleRate, bits, frames, duration: frames / sampleRate, peaks,
        rms: sums.map(value => Math.sqrt(value / frames)), nonzero };
}

for (const engine of engines) {
    test(`${engine}: real live graph exports stopped, playing and repeated stereo WAV`, { timeout: 120000 }, async testContext => {
        if (evidence) fs.mkdirSync(evidence, { recursive: true });
        const browser = await ({ chromium, webkit }[engine]).launch(engine === 'chromium' ? {
            executablePath: process.env.CHROMIUM_PATH || '/snap/chromium/current/usr/lib/chromium-browser/chrome',
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
        } : {});
        const results = { engine, sourcePath, observeCapture, sourceKind, cases: [], errors: [] };
        try {
            const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
                ...(process.env.MYGRAIN_STORAGE_STATE ? { storageState: process.env.MYGRAIN_STORAGE_STATE } : {}) });
            await context.addInitScript(() => { delete window.showSaveFilePicker; delete window.showDirectoryPicker; });
            await context.addInitScript(rate => {
                const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
                window.AudioContext = class extends NativeAudioContext {
                    constructor(options = {}) { super({ ...options, sampleRate: rate }); }
                };
            }, sampleRate);
            const page = await context.newPage();
            page.setDefaultTimeout(30000);
            page.on('pageerror', error => results.errors.push(error.message));
            await page.route('**/*', route => {
                const request = route.request();
                const url = new URL(request.url());
                if (!mockApis) return url.origin === origin ? route.continue() : route.abort();
                if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) return route.abort();
                if (url.pathname === '/mygrain/account-context.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.mygrainAccountContext={user:{username:"wav-export-fixture"}};' });
                if (url.pathname.includes('/api/')) return route.fulfill({ json: { ok: true, authenticated: true, user: { username: 'wav-export-fixture' }, samples: [], stations: [], files: [], sources: [], patches: [], songs: [], shares: [], favourites: [] } });
                const relative = decodeURIComponent(url.pathname.replace(/^\/mygrain\//, '')) || 'index.html';
                const filename = relative === 'index.html' ? sourcePath : path.resolve(root, relative);
                if (relative !== 'index.html' && !filename.startsWith(`${root}/`)) return route.abort();
                if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) return route.fulfill({ status: 404, body: '' });
                return route.fulfill({ contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' })[path.extname(filename)] || 'application/octet-stream', body: fs.readFileSync(filename) });
            });
            await page.goto(`${origin}/mygrain/`, { waitUntil: 'load' });
            if (!await page.evaluate(() => typeof MediaRecorder !== 'undefined')) {
                results.unsupported = 'Installed browser has no MediaRecorder on localhost';
                testContext.skip(results.unsupported);
                return;
            }
            await page.locator('#start-btn').click();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            results.startupErrors = [...results.errors];
            await page.evaluate(async ({ observeCapture, sourceKind }) => {
                window.wavExportSourceKind = sourceKind;
                stopSequencer();
                stopAllBastardLoopLayers({ skipUi: true });
                const offline = new OfflineAudioContext(2, 48000, 48000);
                const merger = offline.createChannelMerger(2);
                for (const [channel, frequency, amplitude] of [[0, 220, .15], [1, 330, .08]]) {
                    const source = offline.createOscillator();
                    source.frequency.value = frequency;
                    const gain = offline.createGain();
                    gain.gain.value = amplitude;
                    source.connect(gain).connect(merger, 0, channel);
                    source.start();
                }
                merger.connect(offline.destination);
                bastardLoopBuffer = await offline.startRendering();
                bastardLoopEnabled = true;
                updateBastardLoopMix();
                setSliderValue('performanceBastardLoopLevel', 60);
                setSliderValue('volume', 70);
                setSliderValue('globalBpmSlider', 240);
                sequencerBPM = 240;
                syncPerformanceExportBars(1, { skipSave: true });
                if (sourceKind === 'grain') {
                    grainASampleBuffer = bastardLoopBuffer;
                    bastardLoopBuffer = null;
                    bastardLoopEnabled = false;
                    setGeneratedLoopTransportEnabled(true, { silent: true, skipSave: true });
                    setOscillatorsEnabled(false, { silent: true, skipSave: true });
                    setGrainTimingMode('synth', { silent: true, skipSave: true });
                    setGranularLayersEnabled(true, { silent: true, skipSave: true });
                    setGranularLayerMuted('main', true, { silent: true, skipSave: true });
                    setGranularLayerMuted('A', false, { silent: true, skipSave: true });
                    setGranularLayerMuted('B', true, { silent: true, skipSave: true });
                    seqGrainsEnabled = true;
                    document.getElementById('seqGrainsEnabled').checked = true;
                    for (const step of sequencerSteps) Object.assign(step, { enabled: true, pitch: 'C3', volume: 80 });
                    const source = document.getElementById('grainSynthASource');
                    source.value = 'grainASample';
                    source.dispatchEvent(new Event('change', { bubbles: true }));
                    setSliderValue('grainSynthAVolume', 70);
                    setSliderValue('grainMixerAmp', 85);
                }
                updateEffects();
                window.wavExportAnalyser = audioContext.createAnalyser();
                wavExportAnalyser.fftSize = 2048;
                finalAmplifierNode.connect(wavExportAnalyser);
                window.wavExportLivePeak = 0;
                window.wavExportCapturePeak = 0;
                if (observeCapture) {
                    const createDestination = audioContext.createMediaStreamDestination.bind(audioContext);
                    audioContext.createMediaStreamDestination = () => {
                        wavExportCapturePeak = 0;
                        const destination = createDestination();
                        const streamSource = audioContext.createMediaStreamSource(destination.stream);
                        const analyser = audioContext.createAnalyser();
                        const silent = audioContext.createGain();
                        silent.gain.value = 0;
                        streamSource.connect(analyser).connect(silent).connect(audioContext.destination);
                        window.wavExportCaptureAnalyser = analyser;
                        return destination;
                    };
                }
                window.wavExportMeter = setInterval(() => {
                    const samples = new Float32Array(wavExportAnalyser.fftSize);
                    wavExportAnalyser.getFloatTimeDomainData(samples);
                    for (const sample of samples) wavExportLivePeak = Math.max(wavExportLivePeak, Math.abs(sample));
                    if (window.wavExportCaptureAnalyser) {
                        const capture = new Float32Array(wavExportCaptureAnalyser.fftSize);
                        wavExportCaptureAnalyser.getFloatTimeDomainData(capture);
                        for (const sample of capture) wavExportCapturePeak = Math.max(wavExportCapturePeak, Math.abs(sample));
                    }
                }, 15);
            }, { observeCapture, sourceKind });
            results.captureDestinationWrapped = await page.evaluate(() => Object.hasOwn(audioContext, 'createMediaStreamDestination'));
            assert.equal(results.captureDestinationWrapped, observeCapture);
            for (const scenario of ['stopped', 'playing', 'repeated', 'suspended']) {
                await page.evaluate(async scenario => {
                    if (scenario !== 'repeated') {
                        stopSequencer();
                        stopAllBastardLoopLayers({ skipUi: true });
                    }
                    if (scenario === 'playing') {
                        if (wavExportSourceKind === 'grain') startSequencer(audioContext.currentTime + .05, { force: true });
                        else startAllBastardLoopLayers(audioContext.currentTime + .05, { skipUi: true });
                    }
                    wavExportLivePeak = 0;
                    wavExportCapturePeak = 0;
                    if (scenario === 'suspended') await audioContext.suspend();
                }, scenario);
                if (scenario === 'playing' || scenario === 'repeated') await page.waitForTimeout(300);
                const before = await page.evaluate(() => ({ state: audioContext.state, playing: bastardLoopPlaying, sequencer: sequencerPlaying, livePeak: wavExportLivePeak, mimeType: chooseRecordingMimeType() }));
                await page.evaluate(() => { wavExportLivePeak = 0; });
                const downloadEvent = page.waitForEvent('download');
                await page.locator('#performanceExportBtn').click();
                const download = await downloadEvent;
                const downloaded = await download.path();
                const bytes = fs.readFileSync(downloaded);
                const metrics = inspectWav(bytes);
                const after = await page.evaluate(() => ({ state: audioContext.state, playing: bastardLoopPlaying, sequencer: sequencerPlaying, livePeak: wavExportLivePeak, capturePeak: wavExportCapturePeak }));
                results.cases.push({ scenario, before, after, filename: download.suggestedFilename(), ...metrics });
                if (evidence) fs.writeFileSync(path.join(evidence, `${engine}-${scenario}.wav`), bytes);
            }
            assert.deepEqual(results.errors, results.startupErrors, 'no new browser errors');
            for (const result of results.cases) {
                assert.equal(result.channels, 2, result.scenario);
                assert.equal(result.bits, 24, result.scenario);
                assert.equal(result.sampleRate, sampleRate, result.scenario);
                assert.ok(Math.abs(result.duration - 1) < .002, result.scenario);
                assert.ok(result.after.livePeak > .001, `${result.scenario}: audible graph ${result.after.livePeak}`);
                if (observeCapture) assert.ok(result.after.capturePeak > .001, `${result.scenario}: native capture stream ${result.after.capturePeak}`);
                assert.ok(result.peaks.every(peak => peak > .001), `${result.scenario}: downloaded PCM ${result.peaks}`);
                assert.ok(result.rms.every(rms => rms > .0001), `${result.scenario}: downloaded RMS ${result.rms}`);
                if (sourceKind === 'loop-a') assert.ok(Math.abs(result.rms[0] - result.rms[1]) > .0001, `${result.scenario}: distinct stereo channels`);
            }
        } finally {
            if (evidence) { fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, `${engine}-results.json`), JSON.stringify(results, null, 2)); }
            console.log(JSON.stringify(results));
            await browser.close();
        }
    });
}
