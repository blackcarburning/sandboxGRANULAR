const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const results = [];
    const errors = [];
    try {
        for (const sampleRate of [44100, 48000]) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
            await page.click('#start-btn');
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.click('#performanceBastardLoopQEditBtn');
            await page.evaluate(() => {
                window.qPlaybackEvents = [];
                window.qPlaybackSeeks = 0;
                const voice = mygrainQ.voice.bind(mygrainQ);
                mygrainQ.voice = (pitch, velocity, start, duration, options = {}) => {
                    if (!options.preview) qPlaybackEvents.push({ pitch, start, duration });
                    return voice(pitch, velocity, start, duration, options);
                };
                const seek = mygrainQ.seek.bind(mygrainQ);
                mygrainQ.seek = time => { qPlaybackSeeks += 1; return seek(time); };
            });
            const scenarios = [
                ...['up', 'down', 'updown', 'odds', 'evens'].map(pattern => ({ pattern, repeat: 'once', division: .25 })),
                { pattern: 'up', repeat: 'until-next', division: .25 },
                { pattern: 'down', repeat: 'until-next', division: .0625, adjacent: true },
                { pattern: 'up', repeat: 'once', division: .25, rest: true },
                { pattern: 'up', repeat: 'once', division: .25, block: true },
                { pattern: 'up', repeat: 'once', division: .25, shared: true }
            ];
            for (const scenario of scenarios) {
                await page.evaluate(() => {
                    stopAllPerformancePlayback({ silent: true });
                    syncPatternLengthControls(16, { skipSave: true });
                    applyGlobalBpm(300);
                    mygrainQ.restore(MygrainQTheory.defaults());
                    mygrainQ.piano.pinned = false;
                    qPlaybackEvents.length = 0;
                    qPlaybackSeeks = 0;
                });
                await page.locator('#bastardLoopQPlaybackSettings summary').click();
                await page.selectOption('#bastardLoopQArpEnabled', scenario.block ? '0' : '1');
                await page.selectOption('#bastardLoopQArpPattern', scenario.pattern);
                await page.selectOption('#bastardLoopQArpRepeat', scenario.repeat);
                await page.selectOption('#bastardLoopQArpDivision', String(scenario.division));
                await page.locator('#bastardLoopQPlaybackSettings summary').click();
                await page.click('#bastardLoopQRecordBtn');
                await page.click('.q-chord[data-root="0"][data-type="major"]');
                await page.click('.q-chord[data-root="5"][data-type="major"]');
                const expected = await page.evaluate(scenario => {
                    mygrainQ.stopPreview();
                    if (scenario.repeat === 'until-next' && !scenario.adjacent) {
                        mygrainQ.state.sequence[8] = mygrainQ.state.sequence[1];
                        mygrainQ.state.sequence[1] = null;
                        mygrainQ.state.sequence[12] = MygrainQTheory.normalizeStep({ notes: [48], rest: true });
                    }
                    if (scenario.rest) mygrainQ.state.sequence[2] = MygrainQTheory.normalizeStep({ notes: [48], rest: true });
                    mygrainQ.sync();
                    return MygrainQTheory.playbackEvents(mygrainQ.state, 16).flatMap(event => event.notes.map(pitch => ({ pitch, start: event.start * .05, duration: event.gate * .05 })));
                }, scenario);
                if (scenario.shared) {
                    await page.click('#bastardLoopQCloseBtn');
                    await page.click('#performanceBastardLoopQStartBtn');
                } else {
                    await page.evaluate(() => { document.getElementById('bastardLoopQEditTools').open = true; });
                    await page.click('#bastardLoopQSoloPlayBtn');
                }
                await page.waitForFunction(() => mygrainQ.running && qPlaybackEvents.length > 0);
                const measured = await page.evaluate(async () => {
                    const analyser = audioContext.createAnalyser();
                    analyser.fftSize = 2048;
                    mygrainQ.graph.pan.connect(analyser);
                    const samples = new Float32Array(analyser.fftSize);
                    let power = 0;
                    while (audioContext.currentTime < mygrainQ.origin + .7) {
                        analyser.getFloatTimeDomainData(samples);
                        power = Math.max(power, samples.reduce((total, sample) => total + sample * sample, 0) / samples.length);
                        await new Promise(resolve => setTimeout(resolve, 15));
                    }
                    const origin = mygrainQ.origin;
                    const events = qPlaybackEvents.filter(event => event.start < origin + .7).map(event => ({ pitch: event.pitch, start: event.start - origin, duration: event.duration }));
                    const seeks = qPlaybackSeeks;
                    const running = mygrainQ.running;
                    mygrainQ.graph.pan.disconnect(analyser);
                    stopAllPerformancePlayback({ silent: true });
                    return { events, power, seeks, running, sampleRate: audioContext.sampleRate };
                });
                const expectedEvents = expected.filter(event => event.start < .7);
                assert.deepEqual(measured.events.map(event => event.pitch), expectedEvents.map(event => event.pitch), JSON.stringify({ sampleRate, scenario, measured, expectedEvents }));
                measured.events.forEach((event, index) => {
                    assert.ok(Math.abs(event.start - expectedEvents[index].start) < .000001);
                    assert.ok(Math.abs(event.duration - expectedEvents[index].duration) < .000001);
                });
                assert.equal(measured.sampleRate, sampleRate);
                assert.equal(measured.running, true);
                assert.equal(measured.seeks, 0);
                assert.ok(measured.power > .000001, `Real Q audio should be audible: ${JSON.stringify({ scenario, measured })}`);
                results.push({ sampleRate, ...scenario, events: measured.events.length, power: measured.power });
            }
            await context.close();
        }
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ readOnly: true, realGridControls: true, results, errors }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
