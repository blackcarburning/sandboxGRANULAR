const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';

function closeTo(actual, expected, label) {
    assert.ok(Math.abs(actual - expected) < .05, `${label}: ${actual} versus ${expected}`);
}

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    const results = [];
    async function preparePage(context) {
        const page = await context.newPage();
        page.setDefaultTimeout(60000);
        page.on('pageerror', error => errors.push(error.stack));
        await page.route('**/*', route => {
            const request = route.request();
            if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
            return new URL(request.url()).origin === new URL(base).origin ? route.continue() : route.abort();
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainQ && typeof updateBastardLoopXVoiceFx === 'function');
        return page;
    }
    try {
        for (const sampleRate of [44100, 48000]) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            await context.addInitScript(rate => {
                const NativeAudioContext = window.AudioContext;
                window.AudioContext = class extends NativeAudioContext { constructor(options = {}) { super({ ...options, sampleRate: rate }); } };
                window.webkitAudioContext = window.AudioContext;
            }, sampleRate);
            const page = await preparePage(context);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true });
                setLoopLayerSolo('none', { silent: true, skipSave: true });
                applyGlobalBpm(120);
                syncPatternLengthControls(8, { silent: true, skipSave: true });
                for (const [id, value] of [['performanceBastardLoopXLevel', '70'], ['performanceBastardLoopXDecay', '100'],
                    ['performanceBastardLoopXFilterEnvelope', '0'], ['performanceBastardLoopXFilterCutoff', '12000'], ['performanceBastardLoopXFilterLfoAmount', '80']]) {
                    const slider = document.getElementById(id);
                    slider.value = value;
                    slider.dispatchEvent(new Event('input', { bubbles: true }));
                }
                bastardLoopXRootNote = 'C3';
                bastardLoopXSampleBuffer = audioContext.createBuffer(1, audioContext.sampleRate * 4, audioContext.sampleRate);
                const signal = bastardLoopXSampleBuffer.getChannelData(0);
                for (let frame = 0; frame < signal.length; frame += 1) {
                    signal[frame] = .08 * (Math.sin(2 * Math.PI * 200 * frame / audioContext.sampleRate) + Math.sin(2 * Math.PI * 3000 * frame / audioContext.sampleRate));
                }
                bastardLoopXSequence = Array.from({ length: 64 }, (unused, index) => ({ ...createEmptyBastardLoopXStep(), note: index % 2 === 0 ? 'C3' : '' }));
                setBastardLoopXEnabled(true, { silent: true, skipSave: true });
                if (!startBastardLoopX()) throw new Error('X transport did not start');
            });
            const slider = page.locator('#performanceBastardLoopXFilterCutoff');
            await slider.scrollIntoViewIfNeeded();
            await page.waitForFunction(() => [...bastardLoopXActiveVoices].some(voice => voice.filterLfoDepthGain.gain.value > 4700));
            await page.evaluate(() => {
                window.cutoffTestVoice = [...bastardLoopXActiveVoices].at(-1);
                window.cutoffTestLfo = bastardLoopXFilterLfoSourceNode;
            });
            const box = await slider.boundingBox();
            assert.ok(box && box.width > 50);
            const session = await context.newCDPSession(page);
            const touch = async (type, fraction) => session.send('Input.dispatchTouchEvent', {
                type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + 12 + (box.width - 24) * fraction, y: box.y + box.height / 2, id: 1 }]
            });
            await touch('touchStart', .67);
            for (const fraction of [.5, .25, .08, .03]) {
                await touch('touchMove', fraction);
                await page.waitForTimeout(25);
            }
            await touch('touchEnd');
            await page.waitForTimeout(110);
            const released = await page.evaluate(() => ({
                cutoff: getBastardLoopXFilterCutoff(), running: isBastardLoopXRunning(), sameSource: window.cutoffTestLfo === bastardLoopXFilterLfoSourceNode,
                base: window.cutoffTestVoice.filterNodes.map(filter => filter.frequency.value),
                depth: window.cutoffTestVoice.filterLfoDepthGain.gain.value, offset: window.cutoffTestVoice.filterLfoOffsetSource.offset.value,
                noteCount: bastardLoopXActiveVoices.size, rate: audioContext.sampleRate
            }));
            assert.ok(released.cutoff > 50 && released.cutoff < 1800, JSON.stringify(released));
            assert.equal(released.running, true);
            assert.equal(released.sameSource, true);
            assert.equal(released.rate, sampleRate);
            const halfDepth = (released.cutoff - 50) * .8 * .5;
            released.base.forEach(value => closeTo(value, released.cutoff, 'Released cutoff'));
            closeTo(released.depth, halfDepth, 'Released LFO depth');
            closeTo(released.offset, -halfDepth, 'Released LFO offset');
            await page.waitForTimeout(700);
            const later = await page.evaluate(() => ({
                cutoff: getBastardLoopXFilterCutoff(), sameSource: window.cutoffTestLfo === bastardLoopXFilterLfoSourceNode,
                voices: [...bastardLoopXActiveVoices].map(voice => ({ base: voice.filterNodes[0].frequency.value,
                    depth: voice.filterLfoDepthGain.gain.value, offset: voice.filterLfoOffsetSource.offset.value }))
            }));
            assert.equal(later.cutoff, released.cutoff);
            assert.equal(later.sameSource, true);
            assert.ok(later.voices.length > released.noteCount);
            later.voices.forEach(voice => {
                closeTo(voice.base, released.cutoff, 'Next note cutoff');
                closeTo(voice.depth, halfDepth, 'Next note depth');
                closeTo(voice.offset, -halfDepth, 'Next note offset');
            });
            const preview = await page.evaluate(() => {
                stopBastardLoopX({ fade: false });
                previewBastardLoopXStep({ ...createEmptyBastardLoopXStep(), note: 'C3' });
                saveState({ force: true });
                return JSON.parse(localStorage.getItem(STATE_STORAGE_KEY)).modes;
            });
            await page.waitForTimeout(70);
            const previewDepth = await page.evaluate(() => [...bastardLoopXActiveVoices].at(-1).filterLfoDepthGain.gain.value);
            closeTo(previewDepth, halfDepth, 'Audition depth');
            assert.equal(preview.bastardLoopXFilterCutoff, released.cutoff);
            assert.equal(preview.bastardLoopXFilterLfoAmount, .8);
            await page.reload({ waitUntil: 'load' });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            assert.equal(await slider.inputValue(), String(released.cutoff));
            assert.equal(await page.locator('#performanceBastardLoopXFilterLfoAmount').inputValue(), '80');
            results.push({ sampleRate, released, nextVoices: later.voices.length, restored: true });
            await context.close();
        }
        const context = await browser.newContext();
        const page = await preparePage(context);
        const renders = await page.evaluate(async () => {
            stateSaveSuspended = true;
            const results = [];
            for (const sampleRate of [44100, 48000]) {
                for (const waveform of ['sine', 'triangle', 'sawtooth', 'ramp', 'square', 'random-step']) {
                    for (const invert of [false, true]) {
                        destroyBastardLoopXFilterLfoSource();
                        bastardLoopXActiveVoices.clear();
                        const context = new OfflineAudioContext(2, sampleRate * 3, sampleRate);
                        audioContext = context;
                        document.getElementById('performanceBastardLoopXFilterCutoff').value = '12000';
                        document.getElementById('performanceBastardLoopXFilterLfoAmount').value = '80';
                        document.getElementById('performanceBastardLoopXFilterLfoWaveform').value = waveform;
                        document.getElementById('performanceBastardLoopXFilterLfoRate').value = '4';
                        bastardLoopXFilterLfoInvert = invert;
                        const edited = { filterNodes: createBastardLoopConfigurableFilters(12000, 'lowpass-48') };
                        const reference = { filterNodes: createBastardLoopConfigurableFilters(600, 'lowpass-48') };
                        attachBastardLoopXFilterLfoToVoice(edited, 12000);
                        attachBastardLoopXFilterLfoToVoice(reference, 600);
                        bastardLoopXActiveVoices.add(edited);
                        const initialSource = bastardLoopXFilterLfoSourceNode;
                        const merger = context.createChannelMerger(2);
                        merger.connect(context.destination);
                        const signal = context.createBuffer(1, sampleRate * 3, sampleRate);
                        const samples = signal.getChannelData(0);
                        for (let frame = 0; frame < samples.length; frame += 1) {
                            samples[frame] = .08 * (Math.sin(2 * Math.PI * 200 * frame / sampleRate) + Math.sin(2 * Math.PI * 3000 * frame / sampleRate));
                        }
                        [edited, reference].forEach((voice, channel) => {
                            const source = context.createBufferSource();
                            source.buffer = signal;
                            const output = context.createGain();
                            connectBastardLoopFilterChain(source, voice.filterNodes, output);
                            output.connect(merger, 0, channel);
                            source.start();
                        });
                        const suspended = context.suspend(.5);
                        const rendering = context.startRendering();
                        await suspended;
                        const slider = document.getElementById('performanceBastardLoopXFilterCutoff');
                        slider.value = '600';
                        slider.dispatchEvent(new Event('input', { bubbles: true }));
                        slider.dispatchEvent(new Event('change', { bubbles: true }));
                        const sameSource = initialSource === bastardLoopXFilterLfoSourceNode;
                        await context.resume();
                        const rendered = await rendering;
                        const editedSamples = rendered.getChannelData(0);
                        const referenceSamples = rendered.getChannelData(1);
                        let maxDifference = 0;
                        let energy = 0;
                        for (let frame = sampleRate; frame < rendered.length; frame += 1) {
                            maxDifference = Math.max(maxDifference, Math.abs(editedSamples[frame] - referenceSamples[frame]));
                            energy += referenceSamples[frame] * referenceSamples[frame];
                        }
                        results.push({ sampleRate, waveform, invert, sameSource, maxDifference, rms: Math.sqrt(energy / (rendered.length - sampleRate)) });
                        destroyBastardLoopXVoiceLfo(edited);
                        destroyBastardLoopXVoiceLfo(reference);
                    }
                }
            }
            destroyBastardLoopXFilterLfoSource();
            bastardLoopXActiveVoices.clear();
            return results;
        });
        for (const render of renders) {
            assert.equal(render.sameSource, true, JSON.stringify(render));
            assert.ok(render.maxDifference < 1e-5, JSON.stringify(render));
            assert.ok(render.rms > .001, JSON.stringify(render));
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ base, touch: results, renders, errors, writes }, null, 2));
        await context.close();
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
