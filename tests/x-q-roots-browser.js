const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:8765/mygrain/';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const writes = [];
    const results = [];
    try {
        for (const [viewport, sampleRate] of [[{ width: 390, height: 844 }, 44100], [{ width: 844, height: 390 }, 48000]]) {
            const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
            await context.addInitScript(rate => {
                const NativeAudioContext = window.AudioContext;
                window.AudioContext = class extends NativeAudioContext { constructor(options = {}) { super({ ...options, sampleRate: rate }); } };
                window.webkitAudioContext = window.AudioContext;
            }, sampleRate);
            const page = await context.newPage();
            page.setDefaultTimeout(45000);
            page.on('pageerror', error => errors.push(error.stack));
            await page.route('**/*', route => {
                const request = route.request();
                if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
                return new URL(request.url()).origin === new URL(base).origin ? route.continue() : route.abort();
            });
            async function start() {
                await page.waitForFunction(() => window.mygrainQ && document.querySelectorAll('#bastardLoopQScale option').length === 86);
                await page.locator('#start-btn').tap();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            }
            await page.goto(`${base}?x-q-roots-check=1`, { waitUntil: 'load' });
            await start();
            await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true });
                syncPatternLengthControls(64, { silent: true, skipSave: true });
                mygrainQ.state = MygrainQTheory.defaults();
                mygrainQ.sync();
                bastardLoopXSequence = Array.from({ length: 64 }, createEmptyBastardLoopXStep);
                syncBastardLoopXUi();
            });
            const copy = page.locator('#performanceBastardLoopXCopyQRootsBtn');
            const random = page.locator('#performanceBastardLoopXRandomAroundNoteBtn');
            assert.equal(await copy.isDisabled(), true);
            assert.equal(await random.isDisabled(), true);
            assert.equal(await page.locator('#performanceBastardLoopLCopyQRootsBtn').count(), 0);
            await page.evaluate(() => {
                mygrainQ.state.transpose = -12;
                mygrainQ.state.sequence = Array.from({ length: 64 }, (_, index) => MygrainQTheory.normalizeStep({
                    root: 48 + index % 12, notes: [64, 67, 72], accent: index % 4 === 0, ratchet: index === 63 ? 2 : 1
                }));
                mygrainQ.state.sequence[8].rest = true;
                mygrainQ.state.sequence[12] = null;
                mygrainQ.state.sequence[15] = { kind: 'accent', notes: [], accent: true };
                mygrainQ.cursor = 31;
                mygrainQ.sync();
                bastardLoopXEditStepIndex = 56;
                bastardLoopXTimingIndex = 5;
                bastardLoopXRootNote = 'D3';
                const semitone = document.getElementById('performanceBastardLoopXSemitone');
                semitone.value = '-2';
                semitone.dispatchEvent(new Event('input', { bubbles: true }));
                window.rootTestQ = JSON.stringify(mygrainQ.state.sequence);
                window.rootTestL = JSON.stringify(bastardLoopLSequence);
            });
            assert.equal(await copy.isEnabled(), true);
            await copy.scrollIntoViewIfNeeded();
            await copy.tap();
            const copied = await page.evaluate(() => ({
                sequence: bastardLoopXSequence, rate: bastardLoopXTimingIndex, tuning: bastardLoopXPitchSemitones,
                sampleRoot: bastardLoopXRootNote, cursor: bastardLoopXEditStepIndex,
                qUnchanged: JSON.stringify(mygrainQ.state.sequence) === rootTestQ,
                lUnchanged: JSON.stringify(bastardLoopLSequence) === rootTestL,
                stored: readStoredStateSnapshot().modes.bastardLoopXSequence
            }));
            assert.equal(copied.sequence[0].note, 'C2');
            assert.equal(copied.sequence[63].note, 'D#2');
            assert.equal(copied.sequence[63].ratchet, 2);
            assert.equal(copied.sequence[8].rest, true);
            assert.equal(copied.sequence[12].note, '');
            assert.equal(copied.sequence[15].accent, true);
            assert.equal(copied.cursor, 0);
            assert.equal(copied.qUnchanged && copied.lUnchanged, true);
            assert.deepEqual(copied.stored, copied.sequence);
            assert.deepEqual([copied.rate, copied.tuning, copied.sampleRoot], [5, -2, 'D3']);
            await page.evaluate(() => {
                bastardLoopXEditStepIndex = 63;
                window.rootTestSample = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                const data = rootTestSample.getChannelData(0);
                for (let frame = 0; frame < data.length; frame += 1) data[frame] = .05 * Math.sin(2 * Math.PI * 130 * frame / audioContext.sampleRate);
                bastardLoopXSampleBuffer = rootTestSample;
                setBastardLoopXEnabled(true, { silent: true, skipSave: true });
                if (!startBastardLoopX()) throw new Error('X did not start with its copied roots');
            });
            await page.waitForFunction(() => bastardLoopXActiveVoices.size > 0);
            await random.scrollIntoViewIfNeeded();
            await random.tap();
            const varied = await page.evaluate(() => ({
                sequence: bastardLoopXSequence, rate: bastardLoopXTimingIndex, tuning: bastardLoopXPitchSemitones,
                sampleRoot: bastardLoopXRootNote, sampleUnchanged: bastardLoopXSampleBuffer === rootTestSample,
                qUnchanged: JSON.stringify(mygrainQ.state.sequence) === rootTestQ,
                lUnchanged: JSON.stringify(bastardLoopLSequence) === rootTestL,
                status: document.getElementById('bastardLoopXStatus').textContent,
                running: isBastardLoopXRunning(), sampleRate: audioContext.sampleRate,
                overflow: document.documentElement.scrollWidth > innerWidth + 1
            }));
            assert.equal(varied.sequence[0].note, 'D#2');
            assert.equal(varied.sampleUnchanged && varied.qUnchanged && varied.lUnchanged && varied.running, true);
            assert.deepEqual([varied.rate, varied.tuning, varied.sampleRoot], [5, -2, 'D3']);
            assert.equal(varied.sampleRate, sampleRate);
            assert.match(varied.status, /around D#2/);
            assert.equal(varied.overflow, false);
            await page.evaluate(() => stopAllPerformancePlayback({ silent: true }));
            await page.reload({ waitUntil: 'load' });
            await start();
            const recalled = await page.evaluate(() => ({ sequence: bastardLoopXSequence, rate: bastardLoopXTimingIndex, tuning: bastardLoopXPitchSemitones, sampleRoot: bastardLoopXRootNote }));
            assert.deepEqual(recalled.sequence, varied.sequence);
            assert.deepEqual([recalled.rate, recalled.tuning, recalled.sampleRoot], [5, -2, 'D3']);
            results.push({ viewport, sampleRate, copiedRoots: copied.sequence.filter(step => step.note && !step.rest).length, lastRoot: copied.sequence[63].note, anchor: varied.sequence[0].note, playback: varied.running, reload: true });
            await context.close();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(JSON.stringify({ base, results, errors, writes }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
