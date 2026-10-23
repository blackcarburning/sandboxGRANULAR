// Actual Web Audio graph from setupEffects, not a reimplementation of its routing.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright-core');
const fixture = require('./drum-parallel-fx-fixture.js');
const html = fs.readFileSync(process.env.MYGRAIN_COMP_SOURCE || require('node:path').join(__dirname, '../index.html'), 'utf8');
const sources = fixture.collectSources(html);
for (const name of ['getFinalCompressorSettings']) {
    sources.names.push(name); sources.functions.push(fixture.extractFunction(html, name));
}
(async () => {
    const results = [];
    for (const [engine, kind] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
        const browser = await engine.launch(kind === 'chromium' ? { executablePath: '/snap/bin/chromium',
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
            const output = await page.evaluate(async ({sources, factory}) => {
                const create = new Function(`return (${factory})`)();
                const results = [];
                for (const rate of [44100, 48000]) {
                    for (const amplitude of [.01, .2]) {
                        for (const route of ['direct', 'kick', 'return']) {
                          for (const amount of [0, .3, 1]) {
                            const ctx = new OfflineAudioContext(2, rate * 2, rate);
                            const f = create(sources, ctx, { globals: { destroyBastardLoopLReverbLane() {}, syncKeyboardRecordingLevel() {}, syncKeyboardRecordingMeter() {} } });
                            await f.functions.setupEffects();
                            const s = f.state;
                            s.drumMachineDirectOutput = route !== 'kick';
                            const drumBus = route === 'kick' ? f.functions.ensureDrumMachineKickBypassBus()
                                : f.functions.ensureDrumMachineBus();
                            drumBus.gain.value = 1;
                            const drumDestination = route === 'return' ? s.drumSendFxGraph.returnPanner : drumBus;
                            const settings = f.functions.getFinalCompressorSettings(amount);
                            s.finalCompressorDriveGain.gain.value = settings.drive;
                            for (const name of ['threshold', 'knee', 'ratio', 'attack', 'release']) s.finalCompressorNode[name].value = settings[name];
                            // Distinct, steady stems make differential bus gain measurable.
                            for (const [channel, frequency, destination] of [[0, 400, s.finalOutputPanner], [1, 1000, drumDestination]]) {
                                const buffer = ctx.createBuffer(2, rate * 2, rate);
                                const data = buffer.getChannelData(channel);
                                for (let i = 0; i < data.length; i++) data[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / rate);
                                const source = ctx.createBufferSource(); source.buffer = buffer;
                                source.connect(destination); source.start();
                            }
                            const rendered = await ctx.startRendering();
                            const rms = [0, 1].map(channel => {
                                const pcm = rendered.getChannelData(channel); let power = 0;
                                for (let i = rate; i < rate * 1.5; i++) {
                                    if (!Number.isFinite(pcm[i])) throw new Error('Non-finite PCM');
                                    power += pcm[i] ** 2;
                                }
                                return Math.sqrt(power / (rate * .5));
                            });
                            results.push({ rate, amplitude, route, amount, rms, balanceDb: 20 * Math.log10(rms[0] / rms[1]) });
                          }
                        }
                    }
                }
                return results;
            }, { sources, factory: fixture.createFixture.toString() });
            for (const result of output) {
                assert.ok(result.rms.every(value => value > .0001));
                if (!process.env.MYGRAIN_COMP_BASELINE) assert.ok(Math.abs(result.balanceDb) < .15, JSON.stringify(result));
            }
            results.push({ engine: kind, output });
        } finally { await browser.close(); }
    }
    console.log(JSON.stringify({ physicalDeviceTested: false, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
