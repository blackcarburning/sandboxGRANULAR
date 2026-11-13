'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:19271/mygrain/';
const out = process.env.MYGRAIN_TEST_OUTPUT || '/tmp/mygrain-generated-loop-random';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
fs.mkdirSync(out, { recursive: true });

(async () => {
    for (const [name, type, phone] of [
        ['chromium-phone', chromium, true], ['webkit-phone', webkit, true],
        ['chromium-desktop', chromium, false], ['webkit-desktop', webkit, false]
    ]) {
        if (process.env.CASE && !process.env.CASE.split(',').includes(name)) continue;
        const browser = await type.launch(type === chromium ? {
            executablePath: '/snap/bin/chromium',
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
        } : {});
        try {
            const context = await browser.newContext({
                viewport: phone ? { width: 390, height: 844 } : { width: 1365, height: 900 },
                isMobile: phone, hasTouch: phone
            });
            const page = await context.newPage(), errors = [], results = [];
            page.setDefaultTimeout(90000);
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin
                ? route.continue() : route.abort());
            assert.equal((await context.request.post(base + 'api/auth/login', {
                data: { username: 'admin', password: 'isolated-vst3-test' }
            })).status(), 200);
            const ready = async () => {
                await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready' && window.mygrainWasp);
                await page.evaluate(() => mygrainCardHistory.ready);
            };
            await page.goto(base); await ready();
            await page.locator('#start-btn').click();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
            await page.evaluate(() => {
                stopAllPerformancePlayback({ silent: true }); clearAllPerformanceSoloStates({ silent: true });
                applyGlobalBpm(240); syncPatternLengthControls(16, { skipSave: true });
                const otherSource = audioContext.createBuffer(2, audioContext.sampleRate, audioContext.sampleRate);
                for (let ch = 0; ch < 2; ch++) for (let i = 0; i < otherSource.length; i++)
                    otherSource.getChannelData(ch)[i] = .02 * Math.sin(2 * Math.PI * 220 * i / otherSource.sampleRate);
                bastardLoopWBuffer = otherSource; bastardLoopDBuffer = otherSource;
                // Only unrelated sample acquisition is stubbed. The generated source,
                // buffer application, random controls, transport and history stay real.
                requestMegaRandomBastardLoopBuild = async spec => spec;
                applyMegaRandomBastardLoopBuild = async () => {};
                loadMegaRandomGranularSample = async () => {};
                loadBastardLoopLSampleFromSource = async () => {};
                loadBastardLoopXSampleFromSource = async () => {};
                loadDropboxSampleLayerFromSource = async () => {};
                loadRandomDrumMachineSamples = async () => {};
                mygrainD.random = async () => {};
                window.__generatedLoopSnapshot = async () => {
                    const buffer = generatedLoopBaseBuffer, data = buffer.getChannelData(0);
                    let peak = 0;
                    for (const sample of data) { if (!Number.isFinite(sample)) throw Error('Invalid PCM'); peak = Math.max(peak, Math.abs(sample)); }
                    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data.buffer))]
                        .map(value => value.toString(16).padStart(2, '0')).join('');
                    const button = document.getElementById('performanceDryLoopLayerBtn');
                    return { enabled: generatedDryLoopEnabled, text: button.textContent,
                        pressed: button.getAttribute('aria-pressed'), muted: button.classList.contains('layer-muted'),
                        mix: getGeneratedDryMixValue(), gain: generatedDryGainNode?.gain.value || 0,
                        transport: generatedLoopTransportEnabled, hash, frames: buffer.length, peak,
                        saved: saveState({ force: true, snapshotOnly: true }).modes.generatedDryLoopEnabled };
                };
            });
            const check = (snapshot, enabled) => {
                assert.equal(snapshot.enabled, enabled); assert.equal(snapshot.saved, enabled);
                assert.equal(snapshot.text, enabled ? 'Loop On' : 'Loop Off');
                assert.equal(snapshot.pressed, String(enabled)); assert.equal(snapshot.muted, !enabled);
                assert(snapshot.frames > 0 && snapshot.peak > .001); assert(snapshot.transport);
                if (!enabled) { assert.equal(snapshot.mix, 0); assert(snapshot.gain < 1e-6); }
                else assert(snapshot.mix > 0);
            };
            // Deterministic random draws exercise both outcomes from the opposite
            // previous setting; only the 50% coin is controlled, not source synthesis.
            for (const enabled of [false, true]) {
                await page.evaluate(enabled => {
                    stopAllPerformancePlayback({ silent: true });
                    setGeneratedDryLoopEnabled(!enabled, { silent: true, skipSave: true });
                }, enabled);
                const before = await page.evaluate(() => generatedDryLoopEnabled);
                await page.evaluate(async enabled => {
                    const original = maybe;
                    maybe = probability => probability === .5 ? enabled : original(probability);
                    try { await runPatchRandomization(); } finally { maybe = original; }
                }, enabled);
                await page.waitForTimeout(100);
                const snapshot = await page.evaluate(() => __generatedLoopSnapshot()); check(snapshot, enabled);
                results.push({ mode: 'ordinary', ...snapshot });
                console.log(name, 'ordinary', enabled ? 'On' : 'Off', snapshot.hash.slice(0, 12));
                await page.evaluate(() => mygrainCardHistory.undo());
                assert.equal(await page.evaluate(() => generatedDryLoopEnabled), before, 'Undo');
                await page.evaluate(() => mygrainCardHistory.redo());
                assert.equal(await page.evaluate(() => generatedDryLoopEnabled), enabled, 'Redo');
            }
            assert.notEqual(results[0].hash, results[1].hash, 'real generated source changes');
            for (const sparseMode of [true, false]) for (const enabled of [false, true]) {
                // Find deterministic lottery seeds through the real selection helper;
                // no fake candidate list and no replaced layer-application path.
                await page.evaluate(({ sparseMode, enabled }) => {
                    const original = chooseSparseRandomLayerSelection;
                    chooseSparseRandomLayerSelection = options => {
                        const savedRandom = Math.random;
                        try {
                            for (let seed = 0; seed < 200; seed++) {
                                Math.random = mygrainUtils.createSeededRandom('loop-selection-' + seed);
                                const selected = original(options);
                                if (selected.some(layer => layer.key === 'loop') === enabled) {
                                    window.__loopSelectedKeys = selected.map(layer => layer.key); return selected;
                                }
                            }
                            throw Error('Both loop lottery outcomes must be reachable');
                        } finally { Math.random = savedRandom; }
                    };
                    window.__originalLoopSelection = original;
                }, { sparseMode, enabled });
                const before = await page.evaluate(() => generatedDryLoopEnabled);
                await page.evaluate(async sparseMode => {
                    try { await runMegaRandomization({ sparseMode }); }
                    finally { chooseSparseRandomLayerSelection = __originalLoopSelection; }
                }, sparseMode);
                await page.waitForTimeout(100);
                const snapshot = await page.evaluate(() => __generatedLoopSnapshot()); check(snapshot, enabled);
                const details = await page.evaluate(() => ({ keys: __loopSelectedKeys,
                    popup: document.getElementById('settlePopup')?.textContent || '',
                    effects: [mygrainWasp.settings().enabled, mygrainD.settings().mutilator.enabled,
                        mygrainWasp.settings().playground.enabled, mygrainTurntable.settings().enabled,
                        mygrainResonator.settings().enabled], routes: mygrainWasp.settings().routes.filter(r => r.enabled).length }));
                assert.equal(details.keys.includes('loop'), enabled);
                if (sparseMode) assert.equal(details.keys.length, 4);
                else assert(details.keys.length >= 6 && details.keys.length <= 10);
                assert(details.popup.includes(`Generated Loop ${enabled ? 'On' : 'Off'}`));
                assert(details.routes <= 1);
                if (sparseMode) assert.deepEqual(details.effects, [false, false, false, false, false]);
                results.push({ mode: sparseMode ? 'sparse' : 'mega', ...snapshot, ...details });
                console.log(name, sparseMode ? 'sparse' : 'mega', enabled ? 'On' : 'Off');
                await page.evaluate(() => mygrainCardHistory.undo());
                assert.equal(await page.evaluate(() => generatedDryLoopEnabled), before, 'batch Undo');
                await page.evaluate(() => mygrainCardHistory.redo());
                assert.equal(await page.evaluate(() => generatedDryLoopEnabled), enabled, 'batch Redo');
            }
            for (const enabled of [false, true]) {
                const zip = await page.evaluate(async enabled => {
                    stopAllPerformancePlayback({ silent: true });
                    setGeneratedDryLoopEnabled(enabled, { silent: true });
                    const blob = await mygrainSongBetaAdapter.capture();
                    const part = await mygrainSongBetaAdapter.decode(await blob.arrayBuffer(),
                        { buffers: new Map(), bytes: 0, reservedBytes: 0, limitBytes: 256 * 1048576 });
                    setGeneratedDryLoopEnabled(!enabled, { silent: true });
                    mygrainSongBetaAdapter.recall(part, { start: false });
                    await mygrainSongBetaAdapter.whenPersisted();
                    await Promise.all([mygrainWasp.whenReady(), mygrainTurntable.whenReady(), mygrainResonator.whenReady()]);
                    await mygrainCardHistory.flush();
                    if (!saveState({ force: true })) throw Error('Fixture state save failed');
                    if (readStoredStateSnapshot().modes.generatedDryLoopEnabled !== enabled) throw Error('Saved loop flag mismatch');
                    return generatedDryLoopEnabled;
                }, enabled);
                assert.equal(zip, enabled, 'ZIP recall');
                await page.reload(); await ready();
                // Main source-layer controls are hydrated by Start (unlike the
                // self-contained effect cards). Check storage before hydration.
                assert.equal(await page.evaluate(() => readStoredStateSnapshot().modes.generatedDryLoopEnabled), enabled, 'stored reload flag');
                await page.locator('#start-btn').click();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !mygrainCardHistory.busy && !stateSaveSuspended);
                assert.equal(await page.evaluate(() => generatedDryLoopEnabled), enabled, 'reload after Start');
            }
            for (const mode of ['Sparse', 'Mega']) {
                const description = await page.evaluate(async mode => {
                    const answer = confirmPatchRandomisation(mode), dialog = document.getElementById('randomisationConfirmDialog');
                    const text = dialog.textContent; dialog.querySelector('button').click(); await answer; return text;
                }, mode);
                assert(description.includes('generated Loop is eligible, not always on'));
            }
            assert.deepEqual(errors, []);
            fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify({ results, errors }, null, 2));
            console.log('PASS', name, 'ordinary/Sparse/Mega On+Off, fresh PCM, final gain+UI, Undo/Redo, ZIP, reload, dialogue');
            await context.close();
        } finally { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
