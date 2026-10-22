// Trusted mouse/touch input and real audio; disposable localhost accounts only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = 'http://127.0.0.1:18891/mygrain/';
const evidence = process.env.Q_SOLO_EVIDENCE || '/tmp/mygrain-q-note-solo';
fs.mkdirSync(evidence, { recursive: true });
(async () => {
    const results = [];
    for (const engine of ['chromium', 'webkit']) {
        const browser = await ({ chromium, webkit }[engine]).launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try { for (const mobile of [false, true]) {
            const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile });
            const registered = await context.request.post(base + 'api/auth/register', { data: { username: `ns_${engine[0]}_${+mobile}_${Date.now()}`, password: 'isolated-note-solo-test' } });
            assert.equal(registered.status(), 200);
            const page = await context.newPage(), errors = [];
            page.setDefaultTimeout(30000);
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
            const tap = async selector => mobile ? page.locator(selector).tap() : page.locator(selector).click();
            const ready = () => page.waitForFunction(() => mygrainQ.chordEditor.preview?.running && !mygrainQ.chordEditor.loading);
            const load = async () => {
                await page.goto(base);
                await page.waitForFunction(() => window.mygrainQ && document.documentElement.dataset.mygrainStartup === 'ready');
                await tap('#start-btn');
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
                await tap('#performanceBastardLoopQEditBtn');
            };
            await load();
            await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true }); resetStemIsolationState(); applyGlobalBpm(300); syncPatternLengthControls(64, { skipSave: true });
                const q = MygrainQTheory.defaults(); q.enabled = true;
                for (const index of [8, 12]) q.sequence[index] = MygrainQTheory.normalizeStep({ root: 60, notes: [60, 64, 67], type: 'major', gate: 4 });
                mygrainQ.restore(q);
                const tone = audioContext.createBuffer(1, Math.round(.08 * audioContext.sampleRate), audioContext.sampleRate);
                tone.getChannelData(0).forEach((_, i, data) => { data[i] = .05 * Math.sin(2 * Math.PI * 130 * i / audioContext.sampleRate); });
                bastardLoopXSampleBuffer = tone; bastardLoopXSourceMode = 'sample'; bastardLoopXEnabled = true; bastardLoopXTimingIndex = 3;
                bastardLoopXSequence = Array.from({ length: 64 }, () => ({ note: 'C2', rest: false, ratchet: 1, accent: false, slide: false }));
                drumMachineEnabled = true; drumMachineHatPattern = Array(64).fill(true);
                window.soloEvents = []; window.soloHats = [];
                const hat = scheduleDrumMachineHatStep;
                scheduleDrumMachineHatStep = (index, time, ...args) => { soloHats.push({ time, origin: mygrainPatternSection.active?.origin }); return hat(index, time, ...args); };
                const editor = mygrainQ.chordEditor, create = editor.createPreview.bind(editor);
                editor.createPreview = () => {
                    const preview = create(), voice = preview.voice.bind(preview);
                    preview.voice = (...args) => { voice(...args); soloEvents.push({ pitch: args[0], time: args[2], origin: preview.origin }); };
                    return preview;
                };
                saveState();
            });
            const open = async () => {
                const cell = page.locator('#bastardLoopQStepGrid [data-q-step="8"]');
                if (mobile) { await cell.tap(); if (!await page.evaluate(() => mygrainQ.chordEditor.opened)) await cell.tap(); } else await cell.dblclick();
                await ready();
            };
            const note = index => `[data-q-note-index="${index}"]`;
            const soloButton = '[data-q-note-action="solo"]';
            const snapshot = () => page.evaluate(() => ({ q: JSON.stringify(mygrainQ.getState()), x: JSON.stringify(bastardLoopXSequence), hats: JSON.stringify(drumMachineHatPattern), undo: mygrainCardHistory.counts.undo, layerSolos: JSON.stringify(loopLayerSolo) }));
            const collect = async pitch => {
                await ready(); await page.waitForTimeout(950);
                const actual = await page.evaluate(() => {
                    const editor = mygrainQ.chordEditor, preview = editor.preview;
                    return { events: soloEvents.filter(event => event.origin === preview.origin).map(event => ({ pitch: event.pitch, step: Math.round((event.time - preview.origin) / .05) % editor.loopSteps })), hats: soloHats.filter(event => event.origin === preview.origin).length, bass: bastardLoopXTransportActive, drums: drumMachinePlaying, duration: mygrainPatternSection.active.duration };
                });
                assert(actual.events.some(event => event.step < 4 && event.pitch === pitch));
                assert(!actual.events.some(event => event.step < 4 && event.pitch !== pitch), JSON.stringify(actual));
                for (const other of [60, 64, 67]) assert(actual.events.some(event => event.step >= 4 && event.pitch === other), 'other chord is not solo-filtered');
                assert(actual.hats > 16 && actual.bass && actual.drums && actual.duration === .8);
                return actual;
            };
            await open(); const before = await snapshot();
            // Solo a previously muted note; turning solo off restores that mute.
            if (mobile) { await tap(note(1)); await tap(note(1)); } else await page.locator(note(1)).dblclick();
            await ready(); assert.deepEqual(await page.evaluate(() => [...mygrainQ.chordEditor.mutedNotes]), [64]);
            await tap(soloButton); await ready();
            assert.equal(await page.locator(soloButton).getAttribute('aria-pressed'), 'true');
            const isolated = await collect(64);
            assert.equal(await page.locator('.q-chord-note-soloed').count(), 1);
            assert.deepEqual(await snapshot(), before, 'solo and mute must not save state, change patterns/history or enable any layer solo');
            await tap(note(2)); await collect(67);
            await page.locator(note(2)).press('ArrowLeft'); await collect(64);
            const layouts = [];
            for (const viewport of mobile ? [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 640 }] : [{ width: 1280, height: 900 }]) {
                await page.setViewportSize(viewport);
                const fit = await page.evaluate(() => { const shell = document.querySelector('#qChordEditorOverlay section'), r = shell.getBoundingClientRect(); return { width: innerWidth, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, overflow: shell.scrollWidth > shell.clientWidth, labelsFit: [...shell.querySelectorAll('.q-chord-editor-tools button')].every(button => button.scrollWidth <= button.clientWidth) }; });
                assert(fit.inside && !fit.overflow && fit.labelsFit, JSON.stringify(fit)); layouts.push(fit);
            }
            await page.screenshot({ path: `${evidence}/${engine}-${mobile ? 'phone' : 'desktop'}.png` });
            await tap(soloButton); await ready();
            assert.equal(await page.evaluate(() => mygrainQ.chordEditor.soloSelected), false);
            assert.deepEqual(await page.evaluate(() => mygrainQ.chordEditor.preview.timeline()[0].notes), [60, 67]);
            await tap(soloButton); await ready();
            await tap('[data-q-note-action="up"]'); await ready();
            assert.deepEqual(await page.evaluate(() => mygrainQ.chordEditor.preview.timeline()[0].notes), [65]);
            await tap('[data-q-note-action="chord-up"]'); await ready();
            assert.deepEqual(await page.evaluate(() => mygrainQ.chordEditor.preview.timeline()[0].notes), [66]);
            await tap('[data-q-note-action="delete"]'); await ready();
            assert.equal(await page.evaluate(() => mygrainQ.chordEditor.soloSelected), true);
            assert.deepEqual(await page.evaluate(() => mygrainQ.chordEditor.preview.timeline()[0].notes), [68]);
            const portable = await page.evaluate(async () => { const blob = await mygrainSongBetaAdapter.capture(); const part = mygrainSongBetaAdapter.inspectPart(await blob.arrayBuffer()); return Object.keys(part.snapshot.state.q); });
            assert(!portable.some(key => /solo|muted|editor/i.test(key)));
            await tap('#qChordEditorClose');
            assert.equal(await page.evaluate(() => mygrainQ.chordEditor.soloSelected), false);
            assert.equal(await page.evaluate(() => mygrainQ.chordEditor.mutedNotes.size), 0);
            await open(); assert.equal(await page.locator(soloButton).getAttribute('aria-pressed'), 'false');
            // Strings + transpose + custom ARP retain all rhythmic slots.
            await tap('#qChordEditorClose');
            await page.evaluate(async () => { const q = mygrainQ.getState(); Object.assign(q, { transpose: 2, arpEnabled: true, arpPattern: 'custom', arpSteps: [1, 2, 0, 3], arpRepeat: 'until-next' }); q.sequence[8] = MygrainQTheory.normalizeStep({ root: 60, notes: [60, 64, 67] }); mygrainQ.restore(q); await mygrainQ.setInstrument('strings'); });
            await open(); await tap(note(1)); await tap(soloButton); await ready();
            const arp = await page.evaluate(() => mygrainQ.chordEditor.preview.timeline().filter(event => event.index === 0).map(event => ({ start: event.start, notes: event.notes })));
            assert(arp.some(event => event.notes.includes(66)) && arp.some(event => !event.notes.length));
            assert(arp.every(event => event.notes.every(pitch => pitch === 66)));
            await page.locator('#qChordLoopToggle').click();
            assert.equal(await page.evaluate(() => mygrainQ.chordEditor.soloSelected), true);
            await page.locator('#qChordLoopToggle').click(); await ready();
            assert(await page.evaluate(() => mygrainQ.chordEditor.preview.timeline().filter(event => event.index === 0).every(event => event.notes.every(pitch => pitch === 66))));
            await tap('#qChordEditorClose'); await page.evaluate(() => mygrainCardHistory.flush()); await load();
            assert.equal(await page.evaluate(() => mygrainQ.chordEditor.soloSelected), false);
            assert.deepEqual(errors, []);
            results.push({ engine, mobile, isolated, layouts, transient: true, portable: true, selection: true, edits: true, arp, closeAndReload: true });
            console.log('PASS', engine, mobile ? 'phone' : 'desktop', 'chord-only solo, other chord/bass/drums intact, mouse/touch/keyboard selection, manual mutes, editing/delete, portable state, strings/transposed ARP, stop/start, Close/reload and layouts');
            await context.close();
        } } finally { await browser.close(); }
    }
    fs.writeFileSync(evidence + '/results.json', JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
