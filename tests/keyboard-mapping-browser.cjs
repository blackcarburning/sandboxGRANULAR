// Disposable localhost accounts only; no production Song writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18919/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
const evidence = process.env.KEYBOARD_EVIDENCE || '/tmp/mygrain-keyboard-mapping';
fs.mkdirSync(evidence, { recursive: true });

(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        if (process.env.KEYBOARD_ENGINE && process.env.KEYBOARD_ENGINE !== engine) continue;
        const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            for (const mobile of [false, true]) {
                const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
                assert.equal((await context.request.post(base + 'api/auth/register', { data: { username: `keys_${engine[0]}_${+mobile}_${Date.now()}`, password: 'isolated-keyboard-mapping' } })).status(), 200);
                const page = await context.newPage(), errors = [];
                page.on('pageerror', error => errors.push(error.message));
                await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
                await page.goto(base);
                await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
                await page.evaluate(() => mygrainCardHistory.ready);
                await page.locator('#start-btn')[mobile ? 'tap' : 'click']();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
                await page.evaluate(() => {
                    stopAllPerformancePlayback({ silent: true }); setHoldEnabled(false); setArpeggiatorEnabled(false, { skipSave: true });
                    clearAllPerformanceSoloStates({ silent: true, skipSave: true }); setFxMuted(true, { silent: true });
                    const sample = audioContext.createBuffer(1, 48000 * 4, 48000), data = sample.getChannelData(0);
                    for (let i = 0; i < data.length; i++) data[i] = .2 * Math.sin(2 * Math.PI * 261.6255653005986 * i / 48000);
                    setKeyboardSampleBuffer(sample); keyboardSampleMetadata = { fileName: 'C4 tuning fixture', rootMidi: 60 };
                });
                const layouts = [];
                const sizes = mobile ? [[390, 844], [320, 640], [844, 390], [390, 844]] : [[1280, 900]];
                for (const [width, height] of sizes) {
                    await page.setViewportSize({ width, height });
                    await page.locator('#keyboardContainer').scrollIntoViewIfNeeded();
                    await page.waitForFunction(() => {
                        const k = document.getElementById('keyboardContainer');
                        const white = [...k.querySelectorAll('.white:not([hidden])')];
                        return white.length && Math.abs(white.at(-1).getBoundingClientRect().right - k.getBoundingClientRect().right) < 1;
                    });
                    const layout = await page.evaluate(() => {
                        const k = document.getElementById('keyboardContainer'), bounds = k.getBoundingClientRect();
                        const keys = [...k.querySelectorAll('.key:not([hidden])')];
                        const whites = keys.filter(key => key.classList.contains('white'));
                        return {
                            width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1,
                            whiteWidths: whites.map(key => key.getBoundingClientRect().width),
                            visible: keys.map(key => key.dataset.note),
                            bad: keys.flatMap((key, index) => {
                                const r = key.getBoundingClientRect(), black = key.classList.contains('black');
                                const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height * (black ? .4 : .85));
                                const problems = [];
                                if (hit?.closest('.key') !== key) problems.push(`${key.dataset.note}: wrong hit ${hit?.dataset.note}`);
                                if (r.left < bounds.left - 1 || r.right > bounds.right + 1) problems.push(`${key.dataset.note}: clipped`);
                                if (black) {
                                    const previous = keys[index - 1], next = keys[index + 1];
                                    if (!previous?.classList.contains('white') || !next?.classList.contains('white')) problems.push(`${key.dataset.note}: neighbours`);
                                    else if (Math.abs(r.x + r.width / 2 - next.getBoundingClientRect().left) > 1) problems.push(`${key.dataset.note}: off boundary`);
                                }
                                return problems;
                            })
                        };
                    });
                    assert.deepEqual(layout.bad, []); assert.equal(layout.overflow, false);
                    assert.ok(Math.min(...layout.whiteWidths) >= 12, JSON.stringify(layout));
                    if (width === 320 || width === 390) assert.equal(layout.visible.length, 25);
                    layouts.push(layout);
                    await page.screenshot({ path: `${evidence}/${engine}-${width}x${height}.png` });
                }
                // Exhaust the complete old key range and all octave settings through
                // the real host, not a mocked frequency table. Include the old MIDI-0 clamp.
                const mapping = await page.evaluate(async () => {
                    let checked = 0;
                    for (const instrument of ['sample', 'piano', 'strings']) {
                        setKeyboardSoundSource(instrument, { skipSave: true });
                        for (let shift = -3; shift <= 3; shift++) {
                            octaveOffset = shift; updateOctaveDisplay();
                            for (const key of document.querySelectorAll('#keyboardContainer .key')) {
                                const note = key.dataset.note, expected = noteNameToMidi(note);
                                const player = getKeyboardSamplePlayer();
                                if (instrument !== 'sample') await player.prepare(instrument, expected, 127);
                                playKeyboardSound(note); await Promise.resolve();
                                const voice = player.voices.get(makePerformanceStreamId('keyboard', note));
                                if (!voice || voice.midi !== expected) throw new Error(`${instrument} ${note}/${shift}: ${voice?.midi} != ${expected}`);
                                if (key.getAttribute('aria-label') !== `Play ${note}`) throw new Error(`Stale accessible label ${note}`);
                                stopKeyboardSound(note, null, { immediate: true }); checked++;
                            }
                        }
                    }
                    octaveOffset = 0; updateOctaveDisplay();
                    return { checked, active: getKeyboardSamplePlayer().activeVoices.size };
                });
                assert.equal(mapping.checked, 2520); assert.equal(mapping.active, 0);
                // Physical black/white targets, repeated notes and shifted octaves.
                let touches = 0;
                for (const instrument of ['sample', 'piano']) {
                    await page.evaluate(async instrument => { setKeyboardSoundSource(instrument, { skipSave: true }); await prepareKeyboardSound(); setHoldEnabled(true); }, instrument);
                    for (const shift of [-3, 0, 3]) {
                        await page.evaluate(shift => { stopKeyboardSounds({ immediate: true }); heldNotes.clear(); octaveOffset = shift; updateOctaveDisplay(); }, shift);
                        await page.locator('#keyboardContainer').scrollIntoViewIfNeeded();
                        const notes = await page.locator('#keyboardContainer .key:not([hidden])').evaluateAll(keys => keys.map(key => key.dataset.note));
                        for (const note of [...notes, notes[0], notes[0]]) {
                            const key = page.locator(`#keyboardContainer .key[data-note="${note}"]`);
                            const r = await key.boundingBox(), black = note.includes('#');
                            const point = { x: r.width / 2, y: r.height * (black ? .4 : .85) };
                            // Hold uses repeat taps to release, then retrigger.
                            await page.evaluate(note => { heldNotes.delete(note); stopKeyboardSound(note, null, { immediate: true }); }, note);
                            await key[mobile ? 'tap' : 'click']({ position: point });
                            await page.waitForFunction(note => keyboardSamplePlayer?.voices.has(makePerformanceStreamId('keyboard', note)), note);
                            const pitch = await page.evaluate(note => ({ actual: keyboardSamplePlayer.voices.get(makePerformanceStreamId('keyboard', note)).midi, expected: getKeyboardNoteMidi(note) }), note);
                            assert.equal(pitch.actual, pitch.expected); touches++;
                        }
                    }
                    await page.evaluate(() => { setHoldEnabled(false); stopKeyboardSounds({ immediate: true }); });
                }
                // Listen numerically to actual rendered PCM. Source is taken from a
                // real keyboard voice, retaining its native rate and playbackRate.
                const audio = await page.evaluate(async mobile => {
                    function peakFrequency(data, rate, expected) {
                        const n = data.length, re = new Float64Array(n), im = new Float64Array(n);
                        for (let i = 0; i < n; i++) re[i] = data[i] * (.5 - .5 * Math.cos(2 * Math.PI * i / (n - 1)));
                        for (let i = 1, j = 0; i < n; i++) {
                            let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
                            if (i < j) [re[i], re[j]] = [re[j], re[i]];
                        }
                        for (let len = 2; len <= n; len <<= 1) {
                            const angle = -2 * Math.PI / len, wr = Math.cos(angle), wi = Math.sin(angle);
                            for (let i = 0; i < n; i += len) {
                                let cr = 1, ci = 0;
                                for (let j = 0; j < len / 2; j++) {
                                    const a = i + j, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
                                    re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
                                    const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
                                }
                            }
                        }
                        const power = i => Math.log(Math.max(1e-30, re[i] * re[i] + im[i] * im[i]));
                        let best = Math.max(1, Math.floor(expected * .85 * n / rate));
                        for (let i = best + 1; i <= Math.ceil(expected * 1.18 * n / rate); i++) if (power(i) > power(best)) best = i;
                        const a = power(best - 1), b = power(best), c = power(best + 1);
                        return (best + .5 * (a - c) / (a - 2 * b + c)) * rate / n;
                    }
                    const checked = [];
                    setHoldEnabled(false); setArpeggiatorEnabled(false, { skipSave: true }); octaveOffset = 0; updateOctaveDisplay();
                    for (const instrument of ['sample', 'piano']) {
                        setKeyboardSoundSource(instrument, { skipSave: true });
                        const notes = instrument === 'sample'
                            ? ['C-2', 'C#-2', 'D-2', 'D#-2', 'E-2', 'F-2', 'F#-2', 'G-2', 'G#-2', 'A-2', 'A#-2', 'B-2', 'C-1', 'C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'B7']
                            : ['C3', 'C#3', 'D3', 'D#3', 'E3', 'F3', 'F#3', 'G3', 'G#3', 'A3', 'A#3', 'B3', 'C4', 'E4', 'G4', 'B4'];
                        for (const note of notes) {
                            if (instrument !== 'sample') await getKeyboardSamplePlayer().prepare(instrument, getKeyboardNoteMidi(note), 127);
                            playKeyboardSound(note); await Promise.resolve();
                            const voice = keyboardSamplePlayer.voices.get(makePerformanceStreamId('keyboard', note));
                            const expected = getKeyboardNoteFrequency(note), rate = mobile ? 48000 : 44100, n = expected < 16 ? 524288 : 131072;
                            const offline = new OfflineAudioContext(1, n, rate), source = offline.createBufferSource();
                            source.buffer = voice.source.buffer; source.playbackRate.value = voice.source.playbackRate.value;
                            source.connect(offline.destination); source.start(0, 0);
                            stopKeyboardSound(note, null, { immediate: true });
                            const output = await offline.startRendering(), data = output.getChannelData(0);
                            const measured = peakFrequency(data, rate, expected), cents = 1200 * Math.log2(measured / expected);
                            checked.push({ instrument, note, expected, measured, cents, rate, sourceRate: source.buffer.sampleRate });
                            if (Math.abs(cents) > (instrument === 'sample' ? 5 : 30)) throw new Error(`Rendered pitch: ${JSON.stringify(checked.at(-1))}`);
                        }
                    }
                    return checked;
                }, mobile);
                await page.evaluate(() => { stopKeyboardSounds({ immediate: true }); octaveOffset = 0; updateOctaveDisplay(); });
                assert.deepEqual(errors, []);
                results.push({ engine, mobile, layouts, mapping, touches, audio });
                fs.writeFileSync(`${evidence}/results.json`, JSON.stringify(results, null, 2));
                console.log(JSON.stringify({ engine, mobile, mappings: mapping.checked, touches, renderedPitches: audio.length }));
                await context.close();
            }
        } finally { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
