const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost song test server.');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        page.on('pageerror', error => errors.push(error.stack));
        await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainQ && document.querySelectorAll('#bastardLoopQScale option').length === 86);
        await page.click('#start-btn');
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        await page.click('#performanceBastardLoopQEditBtn');
        const layouts = [];
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 844 }]) {
            await page.setViewportSize(viewport);
            await page.waitForFunction(() => Math.abs(document.getElementById('bastardLoopQOverlay').getBoundingClientRect().height - visualViewport.height) < 1);
            const layout = await page.evaluate(() => {
                const palette = document.getElementById('bastardLoopQPalette').getBoundingClientRect();
                const grid = document.querySelector('.q-grid-scroll').getBoundingClientRect();
                const toolbar = document.querySelector('.q-session-controls').getBoundingClientRect();
                const cell = document.querySelector('#bastardLoopQStepGrid .q-step');
                return { width: innerWidth, height: innerHeight, paletteTop: palette.top, paletteBottom: palette.bottom, gridTop: grid.top, gridBottom: grid.bottom, toolbarTop: toolbar.top, toolbarBottom: toolbar.bottom, chordCount: document.querySelectorAll('.q-chord').length, cellHeight: cell.getBoundingClientRect().height, cellFont: parseFloat(getComputedStyle(cell).fontSize) };
            });
            assert.ok(layout.chordCount > 50);
            assert.ok(layout.paletteBottom <= layout.gridTop);
            assert.ok(layout.paletteTop >= 0 && layout.gridBottom < viewport.height);
            assert.ok(layout.toolbarTop >= 0 && layout.toolbarBottom < viewport.height);
            assert.ok(layout.cellHeight <= 40 && layout.cellFont <= 10);
            layouts.push(layout);
            if (viewport.width === 1440) await page.screenshot({ path: '/tmp/mygrain-q-workspace-desktop.png' });
            if (viewport.width === 844) await page.screenshot({ path: '/tmp/mygrain-q-workspace-landscape.png' });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: '/tmp/mygrain-q-workspace-mobile.png' });
        const chord = (root, type) => page.locator(`.q-chord[data-root="${root}"][data-type="${type}"]`);
        await chord(0, 'major').click();
        await page.waitForFunction(() => document.querySelector('.q-chord.q-chord-playing [data-note].q-note-playing'));
        assert.equal(await page.evaluate(() => mygrainQ.state.sequence.some(Boolean)), false);
        assert.equal(await chord(0, 'major').getAttribute('aria-pressed'), 'true');
        await page.click('#bastardLoopQRecordBtn');
        await chord(2, 'minor').click();
        await chord(7, 'major').click();
        await page.click('#bastardLoopQRestBtn');
        assert.deepEqual(await page.evaluate(() => mygrainQ.state.sequence.slice(0, 3).map(step => ({ notes: step.notes, rest: step.rest }))), [{ notes: [50, 53, 57], rest: false }, { notes: [55, 59, 62], rest: false }, { notes: [55, 59, 62], rest: true }]);
        assert.equal(await page.evaluate(() => mygrainQ.cursor), 3);
        await page.setViewportSize({ width: 844, height: 390 });
        for (let count = 0; count < 6; count += 1) await chord(0, 'major').click();
        assert.equal(await page.evaluate(() => mygrainQ.cursor), 9);
        assert.ok(await page.evaluate(() => {
            const cell = document.querySelector('.q-step.selected').getBoundingClientRect();
            const scroller = document.querySelector('.q-grid-scroll').getBoundingClientRect();
            return cell.top >= scroller.top - 1 && cell.bottom <= scroller.bottom + 1;
        }));
        await page.setViewportSize({ width: 390, height: 844 });
        const beforePractice = await page.evaluate(() => JSON.stringify(mygrainQ.state.sequence));
        await page.click('#bastardLoopQPracticeBtn');
        await chord(4, 'minor').click();
        assert.equal(await page.evaluate(() => JSON.stringify(mygrainQ.state.sequence)), beforePractice);
        await page.locator('#bastardLoopQTonalSettings summary').click();
        await page.selectOption('#bastardLoopQRoot', '7');
        assert.equal(await page.locator('.q-chord').first().getAttribute('data-root'), '7');
        await page.selectOption('#bastardLoopQInversion', '1');
        assert.deepEqual(await page.evaluate(() => mygrainQ.paletteChords[0].notes), [59, 62, 67]);
        await page.selectOption('#bastardLoopQInversion', '0');
        await page.selectOption('#bastardLoopQRoot', '0');
        await page.locator('#bastardLoopQTonalSettings summary').click();
        await page.evaluate(() => {
            applyGlobalBpm(300);
            const original = mygrainQ.voice.bind(mygrainQ);
            mygrainQ.voice = (pitch, velocity, start, duration, options = {}) => {
                if (options.preview) window.qPlayedEvents.push({ pitch, start, root: mygrainQ.preview.chord.root });
                return original(pitch, velocity, start, duration, options);
            };
            window.qPlayedEvents = [];
        });
        await page.locator('#bastardLoopQPlaybackSettings summary').click();
        await page.selectOption('#bastardLoopQArpEnabled', '1');
        await page.selectOption('#bastardLoopQArpDivision', '0.25');
        const orders = [];
        for (const [pattern, expected] of Object.entries({ up: [48, 52, 55], down: [55, 52, 48], updown: [48, 52, 55, 52], odds: [48, 55, 52], evens: [52, 48, 55] })) {
            await page.evaluate(() => { mygrainQ.stop(); window.qPlayedEvents = []; });
            await page.selectOption('#bastardLoopQArpPattern', pattern);
            await chord(0, 'major').click();
            await page.waitForFunction(count => qPlayedEvents.length >= count, expected.length);
            const events = await page.evaluate(() => qPlayedEvents);
            assert.deepEqual(events.map(event => event.pitch), expected);
            assert.ok(Math.abs(events[1].start - events[0].start - .05) < .000001);
            await page.waitForFunction(() => mygrainQ.preview === null && mygrainQ.voices.size === 0);
            orders.push({ pattern, notes: events.map(event => event.pitch), intervalSeconds: events[1].start - events[0].start });
        }
        await page.selectOption('#bastardLoopQArpRepeat', 'until-next');
        await page.selectOption('#bastardLoopQArpPattern', 'up');
        await page.evaluate(() => { window.qPlayedEvents = []; });
        await chord(0, 'major').click();
        await page.waitForFunction(() => qPlayedEvents.length >= 9);
        await chord(5, 'major').click();
        await page.waitForFunction(() => mygrainQ.preview?.chord.root === 53 && qPlayedEvents.some(event => event.root === 53));
        assert.ok(await page.evaluate(() => [...mygrainQ.voices].every(voice => [53, 57, 60].includes(voice.pitch))));
        await page.click('#bastardLoopQRestBtn');
        assert.deepEqual(await page.evaluate(() => ({ voices: mygrainQ.voices.size, preview: mygrainQ.preview, timer: mygrainQ.previewTimer })), { voices: 0, preview: null, timer: null });
        await chord(0, 'major').click();
        await page.waitForFunction(() => mygrainQ.voices.size > 0);
        await page.locator('#bastardLoopQEditTools summary').click();
        await page.click('#bastardLoopQSoloStopBtn');
        assert.deepEqual(await page.evaluate(() => ({ running: mygrainQ.running, voices: mygrainQ.voices.size, preview: mygrainQ.preview, timer: mygrainQ.previewTimer })), { running: false, voices: 0, preview: null, timer: null });
        await page.selectOption('#bastardLoopQArpEnabled', '0');
        await page.click('#bastardLoopQSoloPlayBtn');
        await page.waitForFunction(() => mygrainQ.running && document.querySelector('#bastardLoopQStepGrid .playing'));
        await page.click('#bastardLoopQSoloStopBtn');
        assert.equal(await page.evaluate(() => mygrainQ.running || mygrainQ.voices.size > 0), false);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ layouts, recordAndRestAdvance: true, cursorFollowsRecording: true, practiceLeavesGridUnchanged: true, rootAndInversionChangePalette: true, playingNotesHighlighted: true, orders, repeatUntilNextChord: true, stopCancelsArp: true, errors }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
