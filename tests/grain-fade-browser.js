const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const grainStart = html.indexOf('function playGrain(');
const grainSource = html.slice(grainStart, html.indexOf('// --- Scheduler ---', grainStart));
const rampStart = html.indexOf('function createEqualPowerFadeCurve(');
const rampSource = html.slice(rampStart, html.indexOf('function getGeneratedDryOutputGain(', rampStart));

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
        const page = await browser.newPage();
        for (const playbackRate of [.25, 1, 4, 16]) {
            const result = await page.evaluate(async ({ grainSource, rampSource, playbackRate }) => {
                const audioContext = new OfflineAudioContext(2, 48000, 48000);
                const granularOutputGain = audioContext.createGain();
                granularOutputGain.connect(audioContext.destination);
                const sourceBuffer = audioContext.createBuffer(1, 48000, 48000);
                sourceBuffer.getChannelData(0).fill(.5);
                let activeGrainNodes = 0;
                const MAX_GRAIN_NODES = 100;
                const activeGrains = new Map();
                const canPlayGrains = () => true;
                const getGrainTimingMode = () => 'synth';
                const getGrainModeProfile = () => ({});
                const getGranularKeyboardNoteFrequency = () => 130.81;
                const getClickGuardSeconds = () => .008;
                const getFadeSecondsForDuration = () => .008;
                const withModulationEvaluationTime = (time, callback) => callback();
                const getModulatedValue = () => 0;
                const getGrainLayerGain = () => 1;
                const getGranularKeyboardVolumeBiasGain = () => 1;
                const getGranularLayerSettings = () => [{ key: 'A', smoothing: 1, blend: .5, decaySeconds: .01, width: 0, panBias: 0, volume: .25 }];
                const getAvailableGranularSources = () => [{ buffer: sourceBuffer }];
                const getGranularSourceGainMap = (sources, gain) => new Map(sources.map(source => [source, gain]));
                const resolveGranularLayerSampleWindow = () => ({ playbackRate, playOffset: 0, sourceDuration: .04, grainDuration: Math.max(.016, .04 / playbackRate), attackSeconds: .008, releaseSeconds: .06 });
                const document = { getElementById: () => ({ value: 'none' }) };
                const setTimeout = () => {};
                eval(`${rampSource}\n${grainSource}\nplayGrain('C3', .05);`);
                const buffer = await audioContext.startRendering();
                const samples = buffer.getChannelData(0);
                let peak = 0;
                let maxStep = 0;
                let stepFrame = 0;
                for (let frame = 1; frame < samples.length; frame += 1) {
                    peak = Math.max(peak, Math.abs(samples[frame]));
                    const step = Math.abs(samples[frame] - samples[frame - 1]);
                    if (step > maxStep) { maxStep = step; stepFrame = frame; }
                }
                return { peak, maxStep, stepTime: stepFrame / buffer.sampleRate };
            }, { grainSource, rampSource, playbackRate });
            console.log(JSON.stringify({ playbackRate, ...result }));
            if (!process.env.GRAIN_FADE_BASELINE) {
                assert.ok(result.peak > .001 && result.peak < .2);
                assert.ok(result.maxStep < .004, `Abrupt low-level grain cutoff at rate ${playbackRate}: ${JSON.stringify(result)}`);
            }
        }
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
