// Disposable local accounts, deterministic AI/audio replies; never production writes/model calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const schema = require('../ai-patch-controls.json');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18889/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence = process.env.AI_HISTORY_EVIDENCE || '/tmp/mygrain-ai-history';
fs.mkdirSync(evidence, { recursive: true });
function wav(hz) {
    const rate = 44100, frames = rate / 2, b = Buffer.alloc(44 + frames * 4);
    b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 4, 28);
    b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(frames * 4, 40);
    for (let i = 0; i < frames; i++) for (let c = 0; c < 2; c++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * (hz + c * 19) * i / rate) * (7000 - c * 2000)), 44 + i * 4 + c * 2);
    return b;
}
const initialRecipe = {
    title: 'History fixture', description: 'Different tempo, stereo loop, bass, Q chords and drum pattern.',
    parameters: { globalBpmSlider: 138, grainSize: 279, performanceBastardLoopLevel: 27, performanceBastardLoopXFilterCutoff: 2100 },
    loops: { A: { reload: true, enabled: true, divisions: ['1/8'] }, X: { reload: true, enabled: true, notes: [36, null, 43, 39] }, Q: { enabled: true, instrument: 'strings', chords: [[48, 51, 55]], chordSteps: 8, style: 'warm' } },
    drums: { enabled: true, tracks: { kick: { reload: true, steps: [1, 0, 0, 0, 1, 0, 0, 0] } } }
};
async function sound(page) {
    return page.evaluate(async ids => {
        async function pcm(b) {
            if (!b) return null;
            return { rate: b.sampleRate, frames: b.length, channels: b.numberOfChannels,
                hashes: await Promise.all(Array.from({ length: b.numberOfChannels }, async (_, c) =>
                    BufferlessHex(await crypto.subtle.digest('SHA-256', b.getChannelData(c))))) };
        }
        function BufferlessHex(bytes) { return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''); }
        const buffers = { A: bastardLoopBuffer, V: bastardLoopVBuffer, X: bastardLoopXSampleBuffer,
            K: bastardLoopKRawBuffer, KRendered: bastardLoopKBuffer, kick: drumMachineKickBuffer };
        return { controls: mygrainAiPatchAdapter.read(ids), music: mygrainAiPatchAdapter.musicalState(),
            pcm: Object.fromEntries(await Promise.all(Object.entries(buffers).map(async ([k, b]) => [k, await pcm(b)]))),
            metadata: { A: bastardLoopMetadata, V: bastardLoopVMetadata, X: bastardLoopXSampleMetadata, K: bastardLoopKMetadata, kick: drumMachineKickMetadata },
            sourceBpm: [bastardLoopSourceBpm, bastardLoopVSourceBpm, bastardLoopKSourceBpm] };
    }, Object.keys(schema.controls));
}
(async () => {
    const results = [];
    for (const [name, type] of Object.entries({ chromium, webkit })) {
        if (process.env.AI_HISTORY_ENGINES && !process.env.AI_HISTORY_ENGINES.split(',').includes(name)) continue;
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), `ai-history-${name}-`));
        let context, page, release, desktop = false, recipe = structuredClone(initialRecipe), mode = 'normal', sourceRequests = 0, aiRequests = 0;
        const errors = [], credentials = { username: `aih_${name}_${Date.now()}`, password: 'isolated-ai-history-fixture' };
        async function launch(asDesktop = false) {
            desktop = asDesktop;
            context = await type.launchPersistentContext(profile, {
                ...(name === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {}),
                viewport: desktop ? { width: 1440, height: 1000 } : { width: 390, height: 844 }, isMobile: !desktop, hasTouch: !desktop, reducedMotion: 'reduce'
            });
            page = context.pages()[0]; page.setDefaultTimeout(45000); page.on('pageerror', e => errors.push(e.message));
            await context.route('**/*', async route => {
                const req = route.request(), url = new URL(req.url());
                if (url.origin !== new URL(base).origin) return route.abort();
                if (url.pathname.endsWith('/api/ai-patch-direction')) {
                    aiRequests++;
                    if (mode === 'invalid') return route.fulfill({ json: { ok: true, model: 'openai/gpt-6.1-sol', recipe: { ...recipe, parameters: { unsupported: 4 } } } });
                    return route.fulfill({ json: { ok: true, model: 'openai/gpt-6.1-sol', recipe } });
                }
                if (req.method() === 'POST' && /\/api\/(bastardloop|source-sample)$/.test(url.pathname)) {
                    const data = req.postDataJSON(); sourceRequests++;
                    if (mode === 'hold' && data.source === 'samples_bass') await new Promise(resolve => { release = resolve; });
                    if (mode === 'fail' && data.source === 'samples_bass') return route.fulfill({ status: 503, json: { error: 'Fixture bass unavailable.' } });
                    const filename = `${data.source}-ai-history.wav`, metadata = { sourceKey: data.source, sourceLabel: data.source, sampleNames: [filename], bpm: data.bpm || 138, durationSeconds: .5 };
                    return route.fulfill({ contentType: 'audio/wav', body: wav(data.source === 'samples_bass' ? 110 : data.source === 'samples_kicks' ? 60 : 220), headers: {
                        'X-Mygrain-Bastardloop-Meta': Buffer.from(JSON.stringify(metadata)).toString('base64url'),
                        'X-Mygrain-Source-Name': filename, 'X-Mygrain-Source-Path': filename, 'X-Mygrain-Source-Key': data.source
                    } });
                }
                return route.continue();
            });
        }
        async function start() {
            await page.goto(base);
            await page.waitForFunction(() => window.mygrainAiPatch?.ready && window.mygrainCardHistory && !mygrainSongBeta.busy && document.documentElement.dataset.mygrainStartup === 'ready');
            await page.evaluate(() => mygrainCardHistory.ready);
            await page.locator('#start-btn')[desktop ? 'click' : 'tap']();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.evaluate(() => { stopAllPerformancePlayback({ silent: true }); syncBastardLoopKUi(); });
        }
        const counts = () => page.evaluate(() => mygrainCardHistory.counts);
        async function settled() {
            await page.waitForFunction(() => !mygrainAiPatch.busy && !mygrainCardHistory.busy);
            assert.equal(await page.evaluate(() => mygrainCardHistory.warning), '');
        }
        async function generate(id = '#aiPatchGenerate') {
            await page.locator(id).tap(); await settled();
            assert.match(await page.locator('#aiPatchStatus').textContent(), /^Applied/);
        }
        async function travel(direction, ai = false) {
            const close = page.locator('#aiActivityClose');
            if (await close.isVisible()) await close[desktop ? 'click' : 'tap']();
            await page.locator(ai ? '#aiPatchUndo' : direction === 'undo' ? '#sectionJumpUndoBtn' : '#sectionJumpRedoBtn')[desktop ? 'click' : 'tap']();
            await settled();
        }
        try {
            await launch();
            assert.equal((await context.request.post(base + 'api/auth/register', { data: credentials })).status(), 200);
            await start();
            await page.evaluate(async () => {
                const tone = audioContext.createBuffer(2, 22050, 44100);
                for (let c = 0; c < 2; c++) for (let i = 0; i < tone.length; i++) tone.getChannelData(c)[i] = .12 * Math.sin(2 * Math.PI * (77 + c * 23) * i / 44100);
                const meta = { sampleNames: ['previously-loaded-stereo.wav'], sourceKey: 'samples_radiolab', bpm: 120 };
                await applyLoadedBastardLoopBuffer(tone, 'Loaded before AI', meta);
                await applyLoadedBastardLoopVBuffer(tone, 'Loaded V before AI', meta);
                await applyRecordedBastardLoopKBuffer(tone, { bpm: 120 });
                saveState({ force: true });
            });
            assert.deepEqual(await counts(), { undo: 0, redo: 0 });
            const before = await sound(page), device = await page.evaluate(() => mygrainSongBeta.lease.device.id);
            await page.locator('#aiPatchPrompt').fill('Generate a different stereo loop, bass, chords and drums.');
            await generate(); const generated = await sound(page);
            assert.notDeepEqual(generated, before); assert.deepEqual(generated.pcm.K, before.pcm.K); assert.deepEqual(generated.pcm.V, before.pcm.V);
            assert.deepEqual(await counts(), { undo: 1, redo: 0 });
            assert.match(await page.locator('#sectionJumpUndoBtn').getAttribute('aria-label'), /AI generated patch/);
            assert.equal(generated.pcm.A.channels, 2); assert.notEqual(generated.pcm.A.hashes[0], generated.pcm.A.hashes[1]);
            console.log('PASS', name, 'loaded patch → AI is exactly one stereo-audio history step');
            const requestsAfterApply = [aiRequests, sourceRequests];
            await travel('undo'); assert.deepEqual(await sound(page), before); assert.deepEqual(await counts(), { undo: 0, redo: 1 });
            // A real partial application (new A audio, then pending X) must roll back without destroying Redo.
            mode = 'hold'; release = null; await page.locator('#aiPatchGenerate').tap();
            await page.waitForFunction(() => document.getElementById('aiPatchChanges').textContent.includes('LOADED sampledrop-ai-history.wav'));
            const until = Date.now() + 10000; while (!release && Date.now() < until) await new Promise(r => setTimeout(r, 20)); assert.ok(release);
            assert.equal(await page.locator('#sectionJumpUndoBtn').isDisabled(), true);
            await page.locator('#aiPatchCancel').tap(); release(); await settled();
            assert.deepEqual(await sound(page), before); assert.deepEqual(await counts(), { undo: 0, redo: 1 });
            mode = 'fail'; await page.locator('#aiPatchGenerate').tap(); await settled();
            assert.match(await page.locator('#aiPatchStatus').textContent(), /Fixture bass unavailable/);
            assert.deepEqual(await sound(page), before); assert.deepEqual(await counts(), { undo: 0, redo: 1 });
            mode = 'invalid'; await page.locator('#aiPatchGenerate').tap(); await settled(); assert.deepEqual(await counts(), { undo: 0, redo: 1 });
            mode = 'normal'; recipe = { title: 'No op', description: 'Same grain size.', parameters: { grainSize: before.controls.grainSize }, loops: {} };
            await page.locator('#aiPatchGenerate').tap(); await settled();
            assert.match(await page.locator('#aiPatchStatus').textContent(), /no real changes/); assert.deepEqual(await counts(), { undo: 0, redo: 1 });
            recipe = structuredClone(initialRecipe); const noRequests = [aiRequests, sourceRequests];
            await travel('redo'); assert.deepEqual(await sound(page), generated); assert.deepEqual([aiRequests, sourceRequests], noRequests);
            await travel('undo', true); assert.deepEqual(await sound(page), before); assert.match(await page.locator('#aiPatchStatus').textContent(), /^Undone/);
            await travel('redo'); assert.deepEqual(await sound(page), generated);
            // Preserve the AI card's stale-edit guard; shared history still
            // merges its delta without overwriting an unrelated manual fader.
            await page.evaluate(() => setSliderValue('performanceMasterTrim', -9));
            await page.locator('#aiPatchUndo').tap(); await settled();
            assert.match(await page.locator('#aiPatchStatus').textContent(), /patch changed/);
            assert.deepEqual(await counts(), { undo: 1, redo: 0 });
            await travel('undo'); assert.deepEqual(await sound(page), before);
            assert.equal(await page.locator('#performanceMasterTrim').inputValue(), '-9');
            await travel('redo'); assert.deepEqual(await sound(page), generated);
            assert.equal(await page.locator('#performanceMasterTrim').inputValue(), '-9');
            console.log('PASS', name, 'exact main/card Undo/Redo; cancellation, failed/invalid recipes preserve Redo');
            // All AI modes share the same single-step boundary, including 64-step progression.
            for (const operation of ['refine', 'regenerate', 'section']) {
                const prior = await sound(page), priorCount = await counts();
                recipe = { title: `${operation} fixture`, description: 'One related change.', parameters: { grainSize: operation === 'refine' ? 301 : operation === 'regenerate' ? 319 : 337 }, loops: {} };
                if (operation === 'section') Object.assign(recipe, { patternSteps: 64, loops: { Q: { enabled: true, chords: [[50, 53, 57]], chordSteps: 16 } } });
                if (operation === 'refine') { await page.locator('#aiPatchRefinement').fill('Change only grain size.'); await generate('#aiPatchRefine'); }
                else if (operation === 'regenerate') await generate('#aiPatchRegenerate');
                else { await page.evaluate(() => mygrainAiPatch.section({ type: 'chorus', bars: 4, rolls: false })); await settled(); assert.match(await page.locator('#aiPatchStatus').textContent(), /^Applied/); }
                assert.deepEqual(await counts(), { undo: priorCount.undo + 1, redo: 0 });
                const after = await sound(page); await travel('undo'); assert.deepEqual(await sound(page), prior);
                await travel('redo'); assert.deepEqual(await sound(page), after);
                console.log('PASS', name, operation, 'single step with exact Undo/Redo');
            }
            await page.locator('#aiPatchKeep').tap(); const keptCounts = await counts();
            await travel('undo'); await travel('redo'); assert.deepEqual(await counts(), keptCounts);
            // Later ordinary card changes are independent steps; AI Undo never skips them.
            await page.locator('#performanceBastardLoopXRandomPatternBtn').tap(); await settled();
            assert.equal(await page.locator('#aiPatchUndo').isVisible(), false);
            await travel('undo'); assert.equal(await page.locator('#aiPatchUndo').isVisible(), true);
            await travel('redo'); await travel('undo');
            // Branching removes the ordinary redo, not earlier AI steps.
            recipe = { title: 'Branch', description: 'A replacement direction.', parameters: { grainSize: 355 }, loops: {} };
            await generate(); assert.equal((await counts()).redo, 0);
            const branch = await sound(page);
            await travel('undo'); const priorBranch = await sound(page);
            await page.setViewportSize({ width: 844, height: 390 });
            await travel('redo'); assert.deepEqual(await sound(page), branch);
            await travel('undo'); assert.deepEqual(await sound(page), priorBranch);
            // Rewind through all AI changes, including the real source replacement,
            // then restart with that audio-bearing entry on the Redo stack.
            while ((await counts()).undo) await travel('undo');
            await page.evaluate(() => mygrainCardHistory.flush());
            const persisted = await counts(); await context.close(); await launch(true); await start();
            assert.equal(await page.evaluate(() => mygrainSongBeta.lease.device.id), device);
            assert.deepEqual(await counts(), persisted);
            const restartRequests = [aiRequests, sourceRequests];
            function afterRestart(value) {
                const copy = structuredClone(value);
                // Startup normalizes labels/optional flags on unchanged V/K;
                // these are not part of the AI delta. Changed sounds stay exact.
                delete copy.metadata.V; delete copy.metadata.K;
                return copy;
            }
            await travel('redo'); assert.deepEqual(afterRestart(await sound(page)), afterRestart(generated));
            while ((await counts()).redo) await travel('redo');
            assert.deepEqual(afterRestart(await sound(page)), afterRestart(branch));
            await travel('undo'); assert.deepEqual(afterRestart(await sound(page)), afterRestart(priorBranch));
            await travel('redo'); assert.deepEqual([aiRequests, sourceRequests], restartRequests);
            assert.match(await page.locator('#aiPatchPrompt').inputValue(), /Generate a different/);
            for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 1000 }]) {
                await page.setViewportSize(viewport); await travel('undo'); assert.deepEqual(afterRestart(await sound(page)), afterRestart(priorBranch));
                await travel('redo'); assert.deepEqual(afterRestart(await sound(page)), afterRestart(branch));
            }
            // Same admin account on a fresh Song device does not inherit the journal.
            const other = await context.browser().newContext({ viewport: { width: 1440, height: 1000 } });
            try {
                assert.equal((await other.request.post(base + 'api/auth/login', { data: credentials })).status(), 200);
                const second = await other.newPage(); await second.goto(base);
                await second.waitForFunction(() => window.mygrainCardHistory && !mygrainCardHistory.busy && window.mygrainSongBeta && !mygrainSongBeta.busy);
                assert.notEqual(await second.evaluate(() => mygrainSongBeta.lease.device.id), device);
                assert.deepEqual(await second.evaluate(() => mygrainCardHistory.counts), { undo: 0, redo: 0 });
            } finally { await other.close(); }
            assert.deepEqual(errors, []);
            const result = { engine: name, counts: await counts(), actualStereoPCM: true, exactLoadedPatchUndoRedo: true, sharedAIButton: true,
                cancelFailureInvalidNoOpPreserveRedo: true, staleAIUndoGuard: true, unrelatedManualFaderPreserved: true,
                allFourAIModes: true, nestedLoadsSingleStep: true, independentRandomStep: true,
                keepAndBranch: true, browserProcessRestart: true, noAIOrSourceRequestsOnRedo: true, sameAdminOtherDeviceEmpty: true,
                nativePhonePortraitLandscape: true, finePointerDesktop: true, viewports: [390, 844, 1024, 1440], requestsAfterApply, errors };
            results.push(result); console.log('PASS', JSON.stringify(result));
        } catch (error) {
            console.error('STATE', await page?.evaluate(() => ({ ai: window.mygrainAiPatch?.diagnostics(), history: window.mygrainCardHistory?.counts, warning: window.mygrainCardHistory?.warning, status: document.getElementById('status')?.textContent }))); throw error;
        } finally { release?.(); await context?.close(); }
    }
    fs.writeFileSync(path.join(evidence, 'RESULTS.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
