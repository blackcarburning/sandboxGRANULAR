const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const layouts = [];
    async function openPhone(simulatedViewport = false) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
        if (simulatedViewport) await context.addInitScript(() => {
            const viewport = new EventTarget();
            Object.assign(viewport, { height: 640, width: 390, offsetTop: 32, offsetLeft: 0, scale: 1 });
            Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
        });
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
            window.qMobileAuditions = [];
            const audition = mygrainQ.audition.bind(mygrainQ);
            mygrainQ.audition = chord => { qMobileAuditions.push(chord.notes.slice()); return audition(chord); };
            window.qMobileAnalyser = audioContext.createAnalyser();
            qMobileAnalyser.fftSize = 2048;
            finalAmplifierNode.connect(qMobileAnalyser);
        });
        return { context, page };
    }

    async function geometry(page) {
        return page.evaluate(() => {
            const rect = element => {
                const bounds = element.getBoundingClientRect();
                return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right, height: bounds.height, width: bounds.width };
            };
            const shell = document.querySelector('#bastardLoopQOverlay .q-shell');
            const clippedLabels = [...document.querySelectorAll('.q-session-controls button')].map(button => {
                const range = document.createRange();
                range.selectNodeContents(button);
                const text = range.getBoundingClientRect();
                const bounds = button.getBoundingClientRect();
                return { id: button.id, text: button.innerText, width: text.width, available: bounds.width - 2, fits: text.left >= bounds.left + 1 && text.right <= bounds.right - 1 };
            }).filter(label => !label.fits);
            const labelFits = clippedLabels.length === 0;
            return { width: innerWidth, height: innerHeight, visibleTop: visualViewport.offsetTop, visibleBottom: visualViewport.offsetTop + visualViewport.height,
                shell: rect(shell), overflow: shell.scrollWidth > shell.clientWidth + 1, grid: rect(document.querySelector('.q-grid-scroll')),
                palette: rect(document.getElementById('bastardLoopQPalette')), chord: rect(document.querySelector('#bastardLoopQPalette .q-chord')), toolbar: rect(document.querySelector('.q-session-controls')),
                buttons: [...document.querySelectorAll('.q-session-controls button')].map(rect), labelFits, clippedLabels, collapsed: !document.getElementById('bastardLoopQPlaybackSettings').open };
        });
    }

    async function tapBottomCell(page, index) {
        const point = await page.evaluate(index => {
            const scroller = document.querySelector('.q-grid-scroll');
            scroller.scrollTop = scroller.scrollHeight;
            const cell = document.querySelector(`[data-q-step="${index}"]`);
            const bounds = cell.getBoundingClientRect();
            const visible = scroller.getBoundingClientRect();
            const coordinate = { x: bounds.left + bounds.width / 2, y: Math.min(bounds.bottom, visible.bottom - 3) - 2 };
            const hit = document.elementFromPoint(coordinate.x, coordinate.y)?.closest('[data-q-step]');
            return { ...coordinate, hit: hit?.dataset.qStep, cellBottom: bounds.bottom, visibleBottom: visible.bottom };
        }, index);
        assert.equal(point.hit, String(index), JSON.stringify(point));
        await page.touchscreen.tap(point.x, point.y);
        return point;
    }

    try {
        const { context, page } = await openPhone();
        assert.equal(await page.locator('#bastardLoopQNudgeLeftBtn').isDisabled(), true);
        assert.equal(await page.locator('#bastardLoopQNudgeRightBtn').isDisabled(), true);
        for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }, { width: 320, height: 568 }, { width: 430, height: 932 }, { width: 844, height: 390 }, { width: 667, height: 375 }, { width: 568, height: 320 }]) {
            await page.setViewportSize(viewport);
            await page.waitForFunction(() => Math.abs(document.getElementById('bastardLoopQOverlay').getBoundingClientRect().height - visualViewport.height) < 1);
            const layout = await geometry(page);
            assert.equal(layout.collapsed, true);
            assert.equal(layout.overflow, false);
            assert.equal(layout.buttons.length, 10);
            assert.equal(layout.labelFits, true, JSON.stringify(layout));
            assert.ok(layout.shell.top >= layout.visibleTop && layout.shell.bottom <= layout.visibleBottom);
            assert.ok(layout.palette.bottom <= layout.grid.top && layout.grid.bottom <= layout.shell.bottom);
            assert.ok(layout.chord.height <= (viewport.height <= 500 ? 30 : 36), JSON.stringify(layout));
            assert.ok(layout.chord.height >= 30, JSON.stringify(layout));
            assert.ok(layout.grid.height >= layout.palette.height * .75, JSON.stringify(layout));
            assert.ok(layout.buttons.every(button => Math.abs(button.top - layout.buttons[0].top) < 1 && button.height <= 33 && button.left >= layout.toolbar.left && button.right <= layout.toolbar.right));
            if (viewport.width === 320) assert.ok(layout.grid.height > 100, JSON.stringify(layout));
            layouts.push(layout);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#bastardLoopQPlaybackSettings summary').tap();
        const expanded = await geometry(page);
        await page.selectOption('#bastardLoopQArpEnabled', '1');
        await page.selectOption('#bastardLoopQArpDivision', '0.125');
        await page.locator('#bastardLoopQPlaybackSettings summary').tap();
        const collapsed = await geometry(page);
        assert.ok(collapsed.grid.height > expanded.grid.height + 15);
        assert.equal(await page.evaluate(() => mygrainQ.state.arpEnabled && mygrainQ.state.arpDivision === .125), true);
        assert.match(await page.locator('#bastardLoopQPlaybackSummary').textContent(), /ARP/);
        const before = await page.evaluate(() => {
            stopAllPerformancePlayback({ silent: true });
            syncPatternLengthControls(64, { skipSave: true });
            const state = MygrainQTheory.defaults();
            state.record = true;
            state.sequence[0] = MygrainQTheory.normalizeStep({ root: 53, notes: [53, 57, 60] });
            state.sequence[61] = MygrainQTheory.normalizeStep({ notes: [48], rest: true });
            state.sequence[63] = MygrainQTheory.normalizeStep({ root: 48, notes: [48, 52, 55] });
            mygrainQ.restore(state);
            qMobileAuditions.length = 0;
            return JSON.stringify(mygrainQ.state.sequence);
        });
        assert.equal(await page.locator('#bastardLoopQChordUpBtn').isDisabled(), false);
        const bottomTap = await tapBottomCell(page, 63);
        await page.waitForFunction(() => mygrainQ.preview?.chord.root === 48 && mygrainQ.voices.size === 3);
        await page.waitForFunction(() => {
            const samples = new Float32Array(qMobileAnalyser.fftSize);
            qMobileAnalyser.getFloatTimeDomainData(samples);
            return samples.reduce((total, sample) => total + sample * sample, 0) / samples.length > .000001;
        });
        assert.equal(await page.evaluate(() => JSON.stringify(mygrainQ.state.sequence)), before);
        assert.deepEqual(await page.evaluate(() => ({ cursor: mygrainQ.cursor, record: mygrainQ.state.record, auditions: qMobileAuditions })), { cursor: 63, record: true, auditions: [[48, 52, 55]] });
        await page.locator('#bastardLoopQChordUpBtn').tap();
        await page.waitForFunction(() => mygrainQ.preview?.chord.root === 49);
        assert.deepEqual(await page.evaluate(() => ({ first: mygrainQ.state.sequence[0].notes, selected: mygrainQ.state.sequence[63].notes, cursor: mygrainQ.cursor, transpose: mygrainQ.state.transpose })), { first: [53, 57, 60], selected: [49, 53, 56], cursor: 63, transpose: 0 });
        await page.locator('#bastardLoopQChordDownBtn').tap();
        await page.waitForFunction(() => mygrainQ.preview?.chord.root === 48);
        assert.equal(await page.evaluate(() => JSON.stringify(mygrainQ.state.sequence)), before);
        for (let repeat = 0; repeat < 3; repeat += 1) {
            await tapBottomCell(page, 63);
            await page.waitForTimeout(80);
        }
        assert.equal(await page.evaluate(() => qMobileAuditions.length), 6);
        await page.locator('#bastardLoopQNudgeLeftBtn').tap();
        assert.deepEqual(await page.evaluate(() => ({ cursor: mygrainQ.cursor, moved: mygrainQ.state.sequence[62].notes, old: mygrainQ.state.sequence[63] })), { cursor: 62, moved: [48, 52, 55], old: null });
        await page.locator('#bastardLoopQNudgeRightBtn').tap();
        assert.equal(await page.evaluate(() => JSON.stringify(mygrainQ.state.sequence)), before);
        assert.equal(await page.evaluate(() => mygrainQ.cursor), 63);
        await tapBottomCell(page, 62);
        assert.equal(await page.locator('#bastardLoopQNudgeLeftBtn').isDisabled(), true);
        assert.equal(await page.locator('#bastardLoopQChordUpBtn').isDisabled(), true);
        assert.equal(await page.evaluate(() => mygrainQ.preview === null && mygrainQ.voices.size === 0 && mygrainQ.cursor === 62), true);
        await tapBottomCell(page, 61);
        assert.equal(await page.locator('#bastardLoopQNudgeRightBtn').isDisabled(), true);
        assert.equal(await page.locator('#bastardLoopQChordDownBtn').isDisabled(), true);
        assert.equal(await page.evaluate(() => qMobileAuditions.length), 6);
        await page.screenshot({ path: '/tmp/mygrain-q-compact-mobile.png' });
        const client = await context.newCDPSession(page);
        const swipe = await page.evaluate(() => {
            const palette = document.getElementById('bastardLoopQPalette');
            palette.scrollTop = 0;
            const bounds = palette.getBoundingClientRect();
            return { x: bounds.left + bounds.width / 2, start: bounds.bottom - 12, end: bounds.top + 12, sequence: JSON.stringify(mygrainQ.state.sequence) };
        });
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: swipe.x, y: swipe.start, id: 1 }] });
        for (let step = 1; step <= 8; step += 1) {
            await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: swipe.x, y: swipe.start + (swipe.end - swipe.start) * step / 8, id: 1 }] });
            await page.waitForTimeout(20);
        }
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(() => document.getElementById('bastardLoopQPalette').scrollTop > 20);
        assert.equal(await page.evaluate(() => JSON.stringify(mygrainQ.state.sequence)), swipe.sequence);
        assert.equal(await page.evaluate(() => qMobileAuditions.length), 6);
        await page.locator('#bastardLoopQCloseBtn').tap();
        await page.locator('.keyboard-section').scrollIntoViewIfNeeded();
        const keyPoint = await page.evaluate(() => {
            const candidates = [...document.querySelectorAll('.keyboard .key.white')].flatMap(element => {
                const bounds = element.getBoundingClientRect();
                const point = { x: bounds.left + bounds.width / 2, y: Math.min(bounds.bottom - 2, innerHeight - 2) };
                const hit = document.elementFromPoint(point.x, point.y)?.closest('.key')?.dataset.note;
                return hit === element.dataset.note ? [{ ...point, hit, note: element.dataset.note }] : [];
            });
            return candidates[Math.floor(candidates.length / 2)];
        });
        assert.ok(keyPoint, 'A visible main-keyboard key must receive bottom-edge touches.');
        assert.equal(keyPoint.hit, keyPoint.note);
        for (let repeat = 0; repeat < 3; repeat += 1) {
            await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: keyPoint.x, y: keyPoint.y, id: 1 }] });
            await page.waitForFunction(note => document.querySelector(`.key[data-note="${note}"]`).classList.contains('active'), keyPoint.note);
            await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await page.waitForFunction(note => !document.querySelector(`.key[data-note="${note}"]`).classList.contains('active'), keyPoint.note);
        }
        await context.close();
        const simulated = await openPhone(true);
        for (const height of [640, 500, 700]) {
            await simulated.page.evaluate(height => { visualViewport.height = height; visualViewport.offsetTop = height === 700 ? 0 : 32; visualViewport.dispatchEvent(new Event('resize')); visualViewport.dispatchEvent(new Event('scroll')); }, height);
            const layout = await geometry(simulated.page);
            assert.ok(Math.abs(layout.shell.top - layout.visibleTop - 6) < 1);
            assert.ok(layout.shell.bottom <= layout.visibleBottom && layout.grid.bottom < layout.visibleBottom);
            layouts.push({ simulatedBrowserChrome: true, ...layout });
        }
        await simulated.page.evaluate(() => {
            syncPatternLengthControls(64, { skipSave: true });
            mygrainQ.state.sequence[63] = MygrainQTheory.normalizeStep({ root: 48, notes: [48, 52, 55] });
            mygrainQ.sync();
        });
        await tapBottomCell(simulated.page, 63);
        await simulated.page.waitForFunction(() => mygrainQ.preview?.chord.root === 48);
        await simulated.context.close();
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ readOnly: true, touchEmulation: true, physicalIPhoneTested: false, layouts, expandedGridHeight: expanded.grid.height, collapsedGridHeight: collapsed.grid.height, bottomTap, keyPoint, paletteTouchScroll: true, repeatedGridTaps: 3, repeatedKeyTouches: 3, individualTranspose: true, audibleGridChord: true, errors }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
