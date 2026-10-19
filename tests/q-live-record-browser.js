const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const results = [];
    try {
        for (const sampleRate of [44100, 48000]) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            await context.addInitScript(sampleRate => {
                const NativeContext = window.AudioContext || window.webkitAudioContext;
                window.AudioContext = class extends NativeContext { constructor(options) { super({ ...options, sampleRate }); } };
                window.webkitAudioContext = window.AudioContext;
            }, sampleRate);
            const page = await context.newPage();
            page.setDefaultTimeout(30000);
            page.on('pageerror', error => errors.push(error.stack));
            await page.route('**/*', route => {
                const request = route.request();
                const url = new URL(request.url());
                return request.method() === 'GET' && url.origin === new URL(base).origin && !url.pathname.startsWith('/mygrain-bastardloops/') ? route.continue() : route.abort();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.waitForFunction(() => window.mygrainQ && document.querySelectorAll('#bastardLoopQScale option').length === 86);
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.locator('#performanceBastardLoopQEditBtn').tap();
            await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true });
                applyGlobalBpm(80);
                syncPatternLengthControls(16, { skipSave: true });
                mygrainQ.restore(MygrainQTheory.defaults());
                window.qLiveWrites = [];
                window.qLiveVoices = [];
                const recordChord = mygrainQ.recordChord.bind(mygrainQ);
                mygrainQ.recordChord = chord => {
                    const now = audioContext.currentTime;
                    const stepSeconds = 60 / mygrainQ.host.bpm() / 4 / (mygrainQ.playbackState || mygrainQ.state).rate;
                    const position = Math.floor((now - mygrainQ.origin) / stepSeconds);
                    const result = recordChord(chord);
                    qLiveWrites.push({ mode: mygrainQ.state.recordMode, result, expected: ((position % 16) + 16) % 16, cycle: Math.floor(position / 16), actual: mygrainQ.cursor, notes: chord.notes, rest: Boolean(chord.rest), origin: mygrainQ.origin, now });
                    return result;
                };
                const voice = mygrainQ.voice.bind(mygrainQ);
                mygrainQ.voice = (pitch, velocity, start, duration, options) => {
                    qLiveVoices.push({ pitch, start, preview: Boolean(options?.preview) });
                    return voice(pitch, velocity, start, duration, options);
                };
                const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                const samples = buffer.getChannelData(0);
                for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(index / audioContext.sampleRate * Math.PI * 2 * 110) * .02;
                bastardLoopBuffer = buffer;
                bastardLoopEnabled = true;
                bastardLoopSourceBpm = 80;
                generatedLoopTransportEnabled = true;
                drumMachineHatPattern.fill(false);
                for (const index of [0, 4, 8, 12]) drumMachineHatPattern[index] = true;
                renderDrumMachineStepGrid('hat');
            });
            const record = page.locator('#bastardLoopQRecordBtn');
            await record.tap();
            assert.equal(await record.textContent(), '● Step');
            await record.tap();
            assert.equal(await record.textContent(), '● Live');
            assert.match(await page.locator('#bastardLoopQRecordHelp').textContent(), /two functions.*Step.*Live/);
            await page.locator('.q-chord[data-root="0"][data-type="major"]').tap();
            await page.waitForFunction(() => mygrainQ.preview && mygrainQ.voices.size > 0);
            assert.equal(await page.evaluate(() => mygrainQ.state.sequence.some(Boolean)), false);
            await page.locator('#bastardLoopQAllPlayBtn').tap();
            await page.waitForFunction(() => mygrainQ.running && sequencerPlaying && bastardLoopPlaying && drumMachinePlaying && audioContext.currentTime > mygrainQ.origin);
            const origin = await page.evaluate(() => mygrainQ.origin);
            const transport = await page.evaluate(() => ({ q: mygrainQ.origin, pattern: transportLoopStartTime, loops: bastardLoopTransportStartTime, drums: drumMachineTransportStartTime }));
            assert.ok(Object.values(transport).every(time => Math.abs(time - origin) < .001));
            await page.evaluate(() => { mygrainQ.cursor = 15; mygrainQ.sync(); });
            for (const [target, root, type] of [[2, 0, 'major'], [5, 5, 'major'], [10, 7, 'major']]) {
                const chord = page.locator(`.q-chord[data-root="${root}"][data-type="${type}"]`);
                await chord.scrollIntoViewIfNeeded();
                const bounds = await chord.boundingBox();
                await page.waitForFunction(target => {
                    const position = (audioContext.currentTime - mygrainQ.origin) / (60 / mygrainQ.host.bpm() / 4);
                    return Math.floor(position) % 16 === target && position % 1 > .25 && position % 1 < .45;
                }, target);
                await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
                await page.waitForFunction(() => mygrainQ.playbackState?.sequence[qLiveWrites.at(-1).actual]?.notes.join() === qLiveWrites.at(-1).notes.join());
                assert.equal(await page.evaluate(() => mygrainQ.origin), origin);
            }
            const writes = await page.evaluate(() => qLiveWrites.filter(write => write.result && write.mode === 'live'));
            assert.equal(writes.length, 3);
            assert.ok(writes.every(write => write.actual === write.expected));
            assert.equal(writes[0].actual, 2);
            const beforeRecentNudge = await page.evaluate(() => JSON.stringify(mygrainQ.state.sequence));
            await page.locator('#bastardLoopQNudgeRightBtn').tap();
            assert.equal(await page.evaluate(() => mygrainQ.cursor), 11);
            await page.locator('#bastardLoopQNudgeLeftBtn').tap();
            assert.equal(await page.evaluate(() => JSON.stringify(mygrainQ.state.sequence)), beforeRecentNudge);
            assert.equal(await page.evaluate(() => mygrainQ.cursor), 10);
            assert.equal(await page.evaluate(() => mygrainQ.origin), origin);
            await page.waitForTimeout(3200);
            const replay = await page.evaluate(writes => writes.map(write => {
                const stepSeconds = 60 / mygrainQ.host.bpm() / 4;
                const when = write.origin + ((write.cycle + 1) * 16 + write.actual) * stepSeconds;
                return { step: write.actual, expectedNotes: write.notes, heardNotes: qLiveVoices.filter(voice => !voice.preview && Math.abs(voice.start - when) < .002).map(voice => voice.pitch) };
            }), writes);
            for (const chord of replay) assert.deepEqual(chord.heardNotes, chord.expectedNotes);
            const power = await page.evaluate(async () => {
                const analyser = audioContext.createAnalyser();
                analyser.fftSize = 2048;
                mygrainQ.graph.pan.connect(analyser);
                const samples = new Float32Array(analyser.fftSize);
                let maximum = 0;
                for (let count = 0; count < 40; count += 1) {
                    await new Promise(resolve => setTimeout(resolve, 25));
                    analyser.getFloatTimeDomainData(samples);
                    maximum = Math.max(maximum, samples.reduce((total, value) => total + value * value, 0) / samples.length);
                }
                analyser.disconnect();
                return maximum;
            });
            assert.ok(power > .000001);
            await page.locator('#bastardLoopQStepGrid [data-q-step="2"]').tap();
            const beforeNudge = await page.evaluate(() => JSON.stringify(mygrainQ.state.sequence));
            await page.locator('#bastardLoopQNudgeLeftBtn').tap();
            await page.waitForFunction(() => mygrainQ.playbackState.sequence[1]?.notes.join() === '48,52,55');
            assert.deepEqual(await page.evaluate(() => ({ cursor: mygrainQ.cursor, old: mygrainQ.state.sequence[2], moved: mygrainQ.state.sequence[1].notes })), { cursor: 1, old: null, moved: [48, 52, 55] });
            const nextNudgedTime = await page.evaluate(() => {
                const stepSeconds = 60 / mygrainQ.host.bpm() / 4;
                const cycle = Math.floor((audioContext.currentTime - mygrainQ.origin) / stepSeconds / 16) + 1;
                return mygrainQ.origin + (cycle * 16 + 1) * stepSeconds;
            });
            await page.waitForFunction(when => audioContext.currentTime > when + .2, nextNudgedTime);
            const nudgedReplay = await page.evaluate(when => ({
                notes: qLiveVoices.filter(voice => !voice.preview && Math.abs(voice.start - when) < .002).map(voice => voice.pitch),
                oldStepReplayed: qLiveVoices.some(voice => !voice.preview && voice.pitch === 48 && Math.abs(voice.start - when - 60 / mygrainQ.host.bpm() / 4) < .002),
                origin: mygrainQ.origin, pattern: transportLoopStartTime, loops: bastardLoopTransportStartTime, drums: drumMachineTransportStartTime
            }), nextNudgedTime);
            assert.deepEqual(nudgedReplay.notes, [48, 52, 55]);
            assert.equal(nudgedReplay.oldStepReplayed, false);
            assert.ok([nudgedReplay.origin, nudgedReplay.pattern, nudgedReplay.loops, nudgedReplay.drums].every(time => Math.abs(time - origin) < .001));
            await page.locator('#bastardLoopQNudgeRightBtn').tap();
            assert.equal(await page.evaluate(() => JSON.stringify(mygrainQ.state.sequence)), beforeNudge);
            for (let count = 0; count < 3; count += 1) await page.locator('#bastardLoopQNudgeRightBtn').tap();
            assert.deepEqual(await page.evaluate(() => ({ cursor: mygrainQ.cursor, moved: mygrainQ.state.sequence[5].notes, neighbour: mygrainQ.state.sequence[4].notes })), { cursor: 5, moved: [48, 52, 55], neighbour: [53, 57, 60] });
            for (let count = 0; count < 3; count += 1) await page.locator('#bastardLoopQNudgeLeftBtn').tap();
            assert.equal(await page.evaluate(() => JSON.stringify(mygrainQ.state.sequence)), beforeNudge);
            for (let count = 0; count < 3; count += 1) await page.locator('#bastardLoopQNudgeLeftBtn').tap();
            assert.equal(await page.evaluate(() => mygrainQ.cursor), 15);
            for (let count = 0; count < 3; count += 1) await page.locator('#bastardLoopQNudgeRightBtn').tap();
            assert.equal(await page.evaluate(() => JSON.stringify(mygrainQ.state.sequence)), beforeNudge);
            assert.equal(await page.evaluate(() => mygrainQ.origin), origin);
            await page.locator('#bastardLoopQPracticeBtn').tap();
            const beforePractice = await page.evaluate(() => JSON.stringify(mygrainQ.state.sequence));
            await page.locator('.q-chord[data-root="2"][data-type="minor"]').tap();
            assert.equal(await page.evaluate(() => JSON.stringify(mygrainQ.state.sequence)), beforePractice);
            assert.equal(await page.evaluate(() => mygrainQ.origin), origin);
            await record.tap();
            await record.tap();
            await page.locator('#bastardLoopQRestBtn').tap();
            const rest = await page.evaluate(() => qLiveWrites.at(-1));
            assert.equal(rest.rest, true);
            assert.equal(rest.actual, rest.expected);
            await page.locator('#bastardLoopQStepGrid [data-q-step="10"]').tap();
            const beforeDelete = await page.evaluate(() => JSON.stringify(mygrainQ.state.sequence));
            await page.locator('#bastardLoopQDeleteStepBtn').tap();
            const deleted = await page.evaluate(() => ({ cursor: mygrainQ.cursor, sequence: mygrainQ.state.sequence }));
            assert.equal(deleted.cursor, 10);
            assert.equal(deleted.sequence[10], null);
            assert.equal(await page.evaluate(() => mygrainQ.preview), null);
            assert.deepEqual(deleted.sequence.filter((step, index) => index !== 10), JSON.parse(beforeDelete).filter((step, index) => index !== 10));
            await record.tap();
            await page.locator('#bastardLoopQStepGrid [data-q-step="14"]').tap();
            await page.locator('.q-chord[data-root="9"][data-type="minor"]').tap();
            assert.deepEqual(await page.evaluate(() => ({ mode: mygrainQ.state.recordMode, cursor: mygrainQ.cursor, notes: mygrainQ.state.sequence[14].notes })), { mode: 'step', cursor: 15, notes: [57, 60, 64] });
            await record.tap();
            await page.locator('#bastardLoopQPlaybackSettings summary').tap();
            await page.selectOption('#bastardLoopQArpEnabled', '1');
            await page.selectOption('#bastardLoopQArpPattern', 'down');
            await page.selectOption('#bastardLoopQArpRepeat', 'until-next');
            await page.selectOption('#bastardLoopQArpDivision', '0.125');
            await page.locator('#bastardLoopQPlaybackSettings summary').tap();
            await page.evaluate(() => {
                mygrainQ.stopPreview();
                mygrainQ.state.sequence.fill(null);
                mygrainQ.state.sequence[8] = MygrainQTheory.normalizeStep({ notes: [48], rest: true });
                mygrainQ.state.sequence[12] = MygrainQTheory.normalizeStep({ notes: [48, 52, 55] });
                mygrainQ.changed({ live: true });
            });
            const arpChord = page.locator('.q-chord[data-root="7"][data-type="major"]');
            await arpChord.scrollIntoViewIfNeeded();
            const arpBounds = await arpChord.boundingBox();
            await page.waitForFunction(() => {
                const position = (audioContext.currentTime - mygrainQ.origin) / (60 / mygrainQ.host.bpm() / 4);
                return Math.floor(position) % 16 === 4 && position % 1 > .25 && position % 1 < .45;
            });
            const voiceCount = await page.evaluate(() => qLiveVoices.length);
            await page.touchscreen.tap(arpBounds.x + arpBounds.width / 2, arpBounds.y + arpBounds.height / 2);
            await page.waitForFunction(() => mygrainQ.preview?.chord.root === 55);
            await page.waitForFunction(() => !mygrainQ.preview);
            const arpNotes = await page.evaluate(voiceCount => qLiveVoices.slice(voiceCount).filter(voice => voice.preview).map(voice => voice.pitch), voiceCount);
            assert.deepEqual(arpNotes.slice(0, 3), [62, 59, 55]);
            assert.equal(await page.evaluate(() => mygrainQ.running && mygrainQ.origin), origin);
            await page.locator('#bastardLoopQAllStopBtn').tap();
            assert.equal(await page.evaluate(() => mygrainQ.running || sequencerPlaying || bastardLoopPlaying || drumMachinePlaying || mygrainQ.preview || mygrainQ.voices.size), 0);
            await page.evaluate(() => { mygrainQ.restore(MygrainQTheory.defaults()); });
            await page.locator('#bastardLoopQAllPlayBtn').tap();
            await page.waitForFunction(() => sequencerPlaying && bastardLoopPlaying && drumMachinePlaying);
            const existingOrigin = await page.evaluate(() => transportLoopStartTime);
            await record.tap();
            await record.tap();
            await page.waitForFunction(() => mygrainQ.running);
            assert.equal(await page.evaluate(() => mygrainQ.origin), existingOrigin);
            await page.waitForTimeout(300);
            assert.equal(await page.evaluate(() => mygrainQ.running && !mygrainQ.hasSequence()), true);
            await page.evaluate(() => {
                const ensure = mygrainQ.piano.ensure.bind(mygrainQ.piano);
                mygrainQ.piano.ensure = async events => { await new Promise(resolve => setTimeout(resolve, 400)); return ensure(events); };
            });
            await page.locator('.q-chord[data-root="11"][data-type="diminished"]').tap();
            const delayedWrite = await page.evaluate(() => qLiveWrites.at(-1));
            assert.equal(delayedWrite.actual, delayedWrite.expected);
            await page.waitForTimeout(900);
            assert.deepEqual(await page.evaluate(index => mygrainQ.state.sequence[index].notes, delayedWrite.actual), delayedWrite.notes);
            assert.equal(await page.evaluate(() => mygrainQ.origin), existingOrigin);
            assert.equal(await page.evaluate(() => mygrainQ.running && drumMachinePlaying && sequencerPlaying), true);
            assert.equal(await page.evaluate(() => MygrainQTheory.normalizeState(mygrainQ.getState()).recordMode), 'live');
            await page.screenshot({ path: `/tmp/mygrain-q-live-record-${sampleRate}.png` });
            await page.locator('#bastardLoopQAllStopBtn').tap();
            await page.waitForTimeout(600);
            assert.equal(await page.evaluate(() => mygrainQ.running || sequencerPlaying || bastardLoopPlaying || drumMachinePlaying || mygrainQ.preview || mygrainQ.voices.size), 0);
            results.push({ sampleRate, transport, writes, replay, power, recentRecordedChordNudge: true, nudgedReplay, occupiedNudgeSwap: true, nudgeWrap: true, liveRest: rest.actual, selectedDelete: true, stepModeAdvance: true, liveArpNotes: arpNotes, liveArpStopsAtRest: true, emptyGridAutoJoin: true, delayedSampleTiming: delayedWrite.actual, allStop: true });
            await context.close();
        }
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ readOnly: true, touchEmulation: true, physicalIPhoneTested: false, results, errors }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
