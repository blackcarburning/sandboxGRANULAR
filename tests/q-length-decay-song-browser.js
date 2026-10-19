const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost Song test server.');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const contexts = [];
    const errors = [];
    const results = [];
    const blocked = [];
    async function device(sampleRate = 48000, clean = false) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
        contexts.push(context);
        await context.addInitScript(({ sampleRate, clean }) => {
            const NativeContext = window.AudioContext;
            window.AudioContext = class extends NativeContext { constructor(options = {}) { super({ ...options, sampleRate }); } };
            window.webkitAudioContext = window.AudioContext;
            if (clean) for (const name of ['localStorage', 'indexedDB']) Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
        }, { sampleRate, clean });
        const page = await context.newPage();
        page.setDefaultTimeout(60000);
        page.on('pageerror', error => errors.push(error.stack));
        await page.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin !== new URL(base).origin) return route.abort();
            if (clean && /\/SAMPLES_Q(?:_STRINGS)?\/|\/api\/arps$/.test(url.pathname)) { blocked.push(url.pathname); return route.abort(); }
            return route.continue();
        });
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainQ && window.mygrainSongBeta && !mygrainSongBeta.busy && document.querySelectorAll('#bastardLoopQScale option').length === 86);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        return page;
    }
    try {
        const page = await device();
        for (const instrument of ['piano', 'strings']) {
            const source = await page.evaluate(async instrument => {
                stopAllPerformancePlayback({ silent: true });
                syncPatternLengthControls(16, { skipSave: true });
                applyGlobalBpm(300);
                setOscillatorsEnabled(false, { skipSave: true, silent: true });
                setGranularLayersEnabled(false, { skipSave: true, silent: true });
                const state = { ...MygrainQTheory.defaults(), instrument, enabled: true, sampleLength: .5, sampleDecay: .3, arpEnabled: instrument === 'strings', arpPattern: 'up', arpRepeat: 'until-next', arpDivision: .5 };
                state.sequence[0] = MygrainQTheory.normalizeStep({ notes: [48, 52, 55], velocity: 96, gate: 4 });
                state.sequence[4] = MygrainQTheory.normalizeStep({ notes: [50, 53, 57], velocity: 96, gate: 4, accent: true });
                mygrainQ.restore(state);
                document.getElementById('songBetaName').value = `Length and decay ${instrument}`;
                await mygrainSongBeta.newSong();
                document.getElementById('songBetaPartName').value = 'Short samples';
                document.getElementById('songBetaRepeats').value = '1';
                await mygrainSongBeta.newPart();
                return { access: JSON.stringify({ format: 'mygrain-song-library-access', version: 1, key: mygrainSongBeta.key, songId: mygrainSongBeta.song.id }), state: mygrainQ.getState(), qVersion: mygrainSongBeta.song.parts[0].qVersion };
            }, instrument);
            assert.equal(source.qVersion, 7);
            for (const sampleRate of [44100, 48000]) {
                const fresh = await device(sampleRate, true);
                await fresh.locator('#songBetaAccessFile').setInputFiles({ name: 'MYGRAIN-Song-Access.json', mimeType: 'application/json', buffer: Buffer.from(source.access) });
                await fresh.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song?.parts.length > 0);
                const recalled = await fresh.evaluate(async () => {
                    await mygrainSongBeta.recall(mygrainSongBeta.song.parts[0], { start: false });
                    const state = mygrainQ.getState();
                    await mygrainSongBeta.arm();
                    const bytes = await mygrainSongBeta.readRender(mygrainSongBeta.song.parts[0]);
                    const rendered = await audioContext.decodeAudioData(bytes.slice(0));
                    const pcm = rendered.getChannelData(0);
                    return { state, sampleRate: audioContext.sampleRate, pinned: mygrainQ.piano.pinned, armed: mygrainSongBeta.armed, qVersion: mygrainSongBeta.song.parts[0].render.qVersion, power: pcm.reduce((total, value) => total + value * value, 0) / pcm.length };
                });
                assert.deepEqual(recalled.state, source.state);
                assert.equal(recalled.sampleRate, sampleRate);
                assert.equal(recalled.pinned, true);
                assert.equal(recalled.armed, true);
                assert.equal(recalled.qVersion, 7);
                assert.ok(recalled.power > 1e-7);
                results.push({ instrument, sampleRate, sampleLength: recalled.state.sampleLength, sampleDecay: recalled.state.sampleDecay, cleanRecallAndRender: true, qVersion: recalled.qVersion, power: recalled.power });
                console.log(`${instrument}: clean shortened Song recall/render passed at ${sampleRate} Hz.`);
                await fresh.context().close();
            }
        }
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ isolatedServer: true, results, errors, blocked, physicalSafari: 'not tested' }, null, 2));
    } finally {
        for (const context of contexts) await context.close();
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
