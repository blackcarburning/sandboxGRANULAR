// Isolated real accounts/SQLite/Song APIs and Q bank. Only model output and test drum/bass WAVs are fixtures.
const assert = require('node:assert/strict'), fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const apiBase = process.env.AI_PATCH_TEST_URL || 'http://127.0.0.1:18876/mygrain/';
assert.match(apiBase, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const liveAssets = process.env.AI_PARTS_LIVE_ASSETS === '1';
const base = liveAssets ? 'https://openclaw.blackcarburning.com/mygrain/' : apiBase;
assert(!liveAssets || process.env.AI_PARTS_REAL_MODEL !== '1', 'Live-asset checks use only isolated APIs and fixture inference.');
const out = process.env.AI_PARTS_EVIDENCE || '/tmp/mygrain-ai-parts-evidence'; fs.mkdirSync(out, { recursive: true });
async function installLiveUploadProbe(page) {
    if (!liveAssets) return;
    // WebKit's network inspector can omit Blob upload bodies. Preserve identical bytes for the localhost QA proxy.
    await page.addInitScript(() => {
        const nativeFetch = window.fetch; window.__qaZipBodies = new Map();
        window.fetch = async function (input, options = {}) {
            const url = new URL(input instanceof Request ? input.url : input, document.baseURI).href;
            const request = input instanceof Request ? input : new Request(url, options);
            if (request.method === 'POST' && request.headers.get('Content-Type') === 'application/zip') {
                const bytes = new Uint8Array(await request.clone().arrayBuffer()); let binary = '';
                for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
                window.__qaZipBodies.set(url, btoa(binary));
            }
            return nativeFetch.call(this, input, options);
        };
    });
}
function wav(hz) {
    const rate = 44100, n = rate / 2, b = Buffer.alloc(44 + n * 2);
    b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
    b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / rate) * 8000 * Math.exp(-i / (rate * .2))), 44 + i * 2);
    return b;
}
const hits = (length, on) => Array.from({ length }, (_, i) => Number(on.includes(i)));
const initial = { title: 'Original C minor', description: 'Original chords and drums.', parameters: { globalBpmSlider: 104, performanceBastardLoopQLevelMixer: 35, performanceBastardLoopXLevel: 35, performanceBastardLoopXSemitone: 0, performanceDrumMachineLevel: 45, drumMachineKickLevel: 65, drumMachineSnareLevel: 50, drumMachineHatLevel: 25 }, loops: { Q: { enabled: true, instrument: 'strings', chords: [[60, 63, 67], [60, 63, 68]], chordSteps: 8, style: 'warm' }, X: { enabled: true, reload: true, notes: [36, null, null, null, 36, null, null, null, 32, null, null, null, 32, null, null, null] } }, drums: { enabled: true, tracks: { kick: { reload: true, steps: hits(16, [0, 8]) }, snare: { reload: true, steps: hits(16, [4, 12]) }, hat: { reload: true, steps: hits(16, [0, 2, 4, 6, 8, 10, 12, 14]) } } } };
const sectionRecipe = { title: 'Related Eb chorus', description: 'Relative-major lift from C minor; return through G.', patternSteps: 64, parameters: {}, loops: { Q: { enabled: true, chords: [[63, 67, 70], [68, 72, 75], [60, 63, 67], [59, 62, 67]], chordSteps: 16 }, X: { enabled: true, notes: Array.from({ length: 64 }, (_, i) => i % 8 === 0 ? [39, 32, 36, 31][Math.floor(i / 16)] : null) } }, drums: { tracks: { snare: { steps: hits(64, [4, 12, 20, 28, 36, 44, 52, 60, 63]), ratchets: Array.from({ length: 64 }, (_, i) => i === 63 ? 4 : 0) } } } };
const results = [];
(async () => {
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        if (process.env.AI_PATCH_ENGINES && !process.env.AI_PATCH_ENGINES.split(',').includes(engine)) continue;
        const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try { for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
            if (process.env.AI_PATCH_WIDTHS && !process.env.AI_PATCH_WIDTHS.split(',').includes(String(viewport.width))) continue;
            const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 960, hasTouch: viewport.width < 960 }), p = await ctx.newPage();
            await installLiveUploadProbe(p);
            p.setDefaultTimeout(60000);
            const errors = [], requests = []; let loads = 0, mode = 'normal', release, device, other;
            p.on('pageerror', e => errors.push(e.message));
            const routes = async r => {
                const req = r.request(), u = new URL(req.url()); if (u.origin !== new URL(base).origin) return r.abort();
                if (liveAssets && u.pathname.endsWith('/account-context.js')) return r.fulfill({ contentType: 'text/javascript', body: 'window.mygrainAccountContext=' + JSON.stringify({ user: { username } }) + ';' });
                if (u.pathname.endsWith('/api/ai-patch-direction')) {
                    const data = req.postDataJSON(); requests.push(data); const held = mode;
                    if (held === 'hold') await new Promise(resolve => release = resolve);
                    if (process.env.AI_PARTS_REAL_MODEL === '1' && data.mode === 'section') {
                        const response = await r.fetch({ timeout: 90000 });
                        fs.writeFileSync(out + '/real-model.json', JSON.stringify({ request: data, status: response.status(), response: await response.json() }, null, 2));
                        return r.fulfill({ response });
                    }
                    const recipe = data.mode === 'section' ? structuredClone(sectionRecipe) : data.mode === 'refine' ? { title: 'Gentler bass', description: 'Keep all musical context.', parameters: { performanceBastardLoopXLevel: 30 }, loops: {} } : initial;
                    if (data.mode === 'section' && !data.section.rolls) delete recipe.drums.tracks.snare.ratchets;
                    if (held === 'bad') recipe.loops.X.reload = true;
                    return r.fulfill({ json: { ok: true, model: 'openai/gpt-6.1-sol', recipe, catalogue: { status: 'retained' } } });
                }
                if (req.method() === 'POST' && u.pathname.endsWith('/api/source-sample')) {
                    const data = req.postDataJSON(); loads++;
                    return r.fulfill({ contentType: 'audio/wav', headers: { 'X-Mygrain-Source-Name': data.source + '.wav', 'X-Mygrain-Source-Path': data.source + '.wav' }, body: wav(data.source === 'samples_bass' ? 65.41 : data.source === 'samples_kicks' ? 60 : data.source === 'samples_snares' ? 310 : 2200) });
                }
                if (liveAssets && u.pathname.includes('/api/')) {
                    // Every API call goes to a disposable localhost store, never the production account backend.
                    const forwarded = { ...req.headers(), origin: new URL(apiBase).origin, 'x-mygrain-user': username };
                    for (const key of ['host', 'cookie', 'content-length', 'referer', 'transfer-encoding']) delete forwarded[key];
                    let body = req.postDataBuffer();
                    if (req.method() === 'POST' && forwarded['content-type'] === 'application/zip') {
                        const captured = await req.frame().evaluate(url => { const bytes = window.__qaZipBodies.get(url); window.__qaZipBodies.delete(url); return bytes; }, req.url());
                        if (captured) { const original = Buffer.from(captured, 'base64'); if (body) assert.deepEqual(body, original); body = original; }
                        assert(body?.length, 'Binary QA upload body missing; no request forwarded.');
                    }
                    if (body) forwarded['content-length'] = String(body.length);
                    const response = await ctx.request.fetch(new URL(u.pathname + u.search, apiBase).href, { method: req.method(), headers: forwarded, ...(body ? { data: body } : {}), timeout: 90000 });
                    return r.fulfill({ response });
                }
                if (liveAssets && !['GET', 'HEAD'].includes(req.method())) throw Error('Unexpected production mutation blocked: ' + req.method() + ' ' + u.pathname);
                return r.continue();
            };
            await p.route('**/*', routes);
            const username = 'parts' + Date.now(); assert.equal((await ctx.request.post(apiBase + 'api/auth/register', { data: { username, password: 'isolated-test-fixture' } })).status(), 200);
            const headers = { 'X-Mygrain-User': username }, ready = async () => { await p.waitForFunction(() => !mygrainAiPatch.busy); assert(await p.evaluate(() => !megaRandomizeInFlight && !stateSaveSuspended && audioContext === __partsContext && mygrainAccounts.authenticated)); };
            const click = async (id, status = /^Applied/) => { await p.locator(id).click(); await ready(); assert.match(await p.locator('#aiPatchStatus').textContent(), status); };
            const slot = async (number, kind, status) => { await p.locator(`#aiPartSlot${number} [data-action="${kind}"]`).click(); await ready(); assert.match(await p.locator('#aiPartStatus').textContent(), status); };
            const music = () => p.evaluate(() => mygrainAiPatchAdapter.musicalState());
            const prompt = 'Warm C minor strings and matching bass at 104 BPM, a sparse steady kit.';
            try {
                await p.goto(base); await p.waitForFunction(() => mygrainAiPatch?.ready && mygrainAiParts?.ready && mygrainSongBeta && !mygrainSongBeta.busy);
                if (liveAssets) assert.match(await p.locator('.build-badge').first().textContent(), /v2026.10.20.AI.7/);
                await p.locator('#start-btn').click(); await p.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                await p.evaluate(() => { stopAllPerformancePlayback({ silent: true }); syncBastardLoopKUi(); syncPatternLengthControls(16, { skipSave: true }); window.__partsContext = audioContext; });
                await p.evaluate(() => {
                    const capture = mygrainSongBetaAdapter.capture;
                    mygrainSongBetaAdapter.capture = async function (...args) {
                        const before = JSON.parse(mygrainAiPatchAdapter.fingerprint({ ignoreQBank: true })), result = await capture.apply(this, args);
                        const after = JSON.parse(mygrainAiPatchAdapter.fingerprint({ ignoreQBank: true })), changes = [];
                        function compare(a, b, path) { if (JSON.stringify(a) === JSON.stringify(b)) return; if (a && b && typeof a === 'object' && typeof b === 'object') for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) compare(a[key], b[key], path + '.' + key); else changes.push({ path, before: a, after: b }); }
                        compare(before, after, 'capture'); window.__captureChanges = changes; return result;
                    };
                });
                await p.locator('#aiPatchPrompt').fill(prompt); await click('#aiPatchGenerate');
                const original = await music(); await p.locator('#aiPartName1').fill('Verse original'); await slot(1, 'store', /^Stored Take 1/);
                assert(await p.evaluate(() => mygrainAiPatch.diagnostics().undoAvailable));
                const saved1 = (await (await ctx.request.get(apiBase + 'api/ai-parts', { headers })).json()).parts[0]; assert.equal(saved1.name, 'Verse original'); assert(saved1.audioAssets >= 4 && saved1.bytes > 10000);
                await p.evaluate(() => { window.__partsBass = bastardLoopXSampleBuffer; window.__partsDrums = [drumMachineKickBuffer, drumMachineSnareBuffer, drumMachineHatBuffer]; });
                const initialLoads = loads; await p.locator('#aiPartType').selectOption('chorus'); await p.locator('#aiPartRolls').check(); await p.locator('#aiPartInstruction').fill('Lift into the relative major. Keep the same kit and bass sound; add one restrained snare fill.');
                await click('#aiPartGenerate'); assert.equal(requests.at(-1).mode, 'section'); assert.equal(requests.at(-1).section.type, 'chorus'); assert.deepEqual(requests.at(-1).musicalState, original);
                const chorus = await music(); assert.equal(chorus.X.length, 64); assert.notDeepEqual(chorus.Q.sequence, original.Q.sequence); assert.equal(chorus.Q.instrument, original.Q.instrument); assert.equal(loads, initialLoads);
                assert(await p.evaluate(() => sequencerBPM === 104 && bastardLoopXSampleBuffer === __partsBass && drumMachineKickBuffer === __partsDrums[0] && drumMachineSnareBuffer === __partsDrums[1] && drumMachineHatBuffer === __partsDrums[2]));
                const chorusPrompt = await p.locator('#aiPatchPrompt').inputValue(); assert.match(chorusPrompt, /Section: chorus/);
                await p.locator('#aiPartName2').fill('Chorus lift'); await slot(2, 'store', /^Stored Take 2/);
                await click('#aiPatchUndo', /^Undone/); assert.deepEqual(await music(), original); assert.equal(await p.locator('#aiPatchPrompt').inputValue(), prompt);
                await slot(2, 'recall', /^Recalled Take 2/); assert.deepEqual(await music(), chorus); assert.equal(await p.locator('#aiPatchPrompt').inputValue(), chorusPrompt);
                assert(await p.evaluate(() => !mygrainQ.running && !drumMachinePlaying && !bastardLoopPlaying));
                await p.locator('#aiPartName2').fill('Chorus <b>lift</b>'); await slot(2, 'rename', /^Renamed Take 2/); assert.equal(await p.locator('#aiPartSlot2 h5 b').count(), 0);
                await p.locator('#aiPatchRefinement').fill('Make the bass slightly gentler, preserving this chorus.'); await click('#aiPatchRefine'); assert.equal(requests.at(-1).mode, 'refine'); assert.deepEqual(requests.at(-1).musicalState, chorus); assert.equal(loads, initialLoads);
                await click('#aiPatchUndo', /^Undone/); assert.equal(await p.locator('#aiPatchPrompt').inputValue(), chorusPrompt);
                if (process.env.AI_PARTS_REAL_MODEL !== '1') { await click('#aiPatchRegenerate'); assert.equal(requests.at(-1).mode, 'section'); assert.equal(requests.at(-1).prompt, chorusPrompt); assert.equal(loads, initialLoads); }
                await p.locator('#aiPatchRender').click(); await ready(); assert.match(await p.locator('#aiPatchStatus').textContent(), /^Preview captured/); const capture = await p.locator('#aiPatchPreviewStatus').textContent(); assert.match(capture, /RMS 0\.(?!0000)/);
                await slot(1, 'recall', /^Recalled Take 1/); assert.deepEqual(await music(), original);
                await p.evaluate(() => audioContext.suspend());
                await slot(2, 'recall', /^Recalled Take 2/); assert.equal(await p.evaluate(() => audioContext.state), 'running'); assert.deepEqual(await music(), chorus);
                await slot(1, 'recall', /^Recalled Take 1/); assert.deepEqual(await music(), original);
                await p.evaluate(() => {
                    const recall = mygrainSongBetaAdapter.recall; let fail = true;
                    mygrainSongBetaAdapter.recall = function (...args) { const result = recall.apply(this, args); if (fail) { fail = false; throw Error('Fixture recall interruption'); } return result; };
                });
                await slot(2, 'recall', /Fixture recall interruption/); assert.deepEqual(await music(), original); assert.equal(await p.locator('#aiPatchPrompt').inputValue(), prompt);
                // A second browser has no localStorage or IndexedDB, only the same login cookie.
                const cookies = (await ctx.storageState()).cookies; device = await browser.newContext({ viewport, storageState: { cookies, origins: [] } }); const second = await device.newPage(); await installLiveUploadProbe(second);
                await second.route('**/*', routes); await second.goto(base); await second.waitForFunction(() => mygrainAiParts?.ready && mygrainAiPatch?.ready && mygrainSongBeta && !mygrainSongBeta.busy);
                await second.locator('#start-btn').click(); await second.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                await second.locator('#aiPartSlot2 [data-action="recall"]').click(); await second.waitForFunction(() => !mygrainAiPatch.busy); assert.match(await second.locator('#aiPartStatus').textContent(), /^Recalled Take 2/); assert.deepEqual(await second.evaluate(() => mygrainAiPatchAdapter.musicalState()), chorus); assert.equal(await second.locator('#aiPatchPrompt').inputValue(), chorusPrompt);
                assert(await second.locator('#aiPatchFollowup').isVisible()); assert(await second.locator('#aiPatchHear').isVisible());
                await second.locator('#aiPatchHear').click(); await second.waitForFunction(() => !mygrainAiPatch.busy); assert(await second.evaluate(() => mygrainQ.running && drumMachinePlaying)); await second.locator('#aiPatchStop').click();
                await device.close(); device = null;
                other = await browser.newContext(); const otherName = 'otherparts' + Date.now(); assert.equal((await other.request.post(apiBase + 'api/auth/register', { data: { username: otherName, password: 'isolated-test-fixture' } })).status(), 200);
                assert.deepEqual((await (await other.request.get(apiBase + 'api/ai-parts', { headers: { 'X-Mygrain-User': otherName } })).json()).parts, []);
                assert.equal((await other.request.get(apiBase + 'api/ai-parts?slot=1', { headers: { 'X-Mygrain-User': otherName } })).status(), 404);
                assert.equal((await ctx.request.post(apiBase + 'api/ai-parts', { headers: { ...headers, Origin: 'https://untrusted.example' }, data: { slot: 1, revision: 1, name: 'Wrong' } })).status(), 403);
                assert.equal((await ctx.request.post(apiBase + 'api/ai-parts', { headers, data: { slot: 1, revision: 0, name: 'Wrong' } })).status(), 409); await other.close(); other = null;
                await p.locator('#songBetaName').fill('AI structure integration'); await p.locator('#songBetaNewSong').click(); await p.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song);
                await p.locator('#songBetaPartName').fill('Unsent Song name'); const beforeAdd = await p.evaluate(() => mygrainAiPatchAdapter.fingerprint());
                await slot(2, 'add', /^Added saved Chorus/); assert.equal(await p.evaluate(() => mygrainAiPatchAdapter.fingerprint()), beforeAdd); assert.equal(await p.locator('#songBetaPartName').inputValue(), 'Unsent Song name');
                const part = await p.evaluate(() => mygrainSongBeta.song.parts[0]); assert.equal(part.name, 'Chorus <b>lift</b>'); assert.equal(part.repeats, 2); assert.equal(part.patternSteps, 64);
                const saved2 = (await (await ctx.request.get(apiBase + 'api/ai-parts', { headers })).json()).parts.find(x => x.slot === 2); assert.equal(part.sha256, saved2.sha256);
                await slot(1, 'add', /^Added saved Verse/); assert.equal(await p.evaluate(() => mygrainSongBeta.song.parts[0].sha256), part.sha256); assert.equal(await p.evaluate(() => mygrainSongBeta.song.parts.length), 2);
                if (process.env.AI_PARTS_SONG_RENDER === '1') {
                    await p.locator('#songBetaArm').click(); await p.waitForFunction(() => !mygrainSongBeta.busy, { timeout: 120000 });
                    assert(await p.evaluate(() => mygrainSongBeta.armed), await p.locator('#songBetaStatus').textContent());
                    const renders = await p.evaluate(() => [...mygrainSongBeta.renders.values()].map(buffer => { const data = buffer.getChannelData(0); let power = 0; for (const x of data) power += x * x; return { seconds: buffer.duration, rms: Math.sqrt(power / data.length) }; }));
                    assert.equal(renders.length, 2); assert(renders.every(r => r.rms > .0001));
                    await p.locator('#songBetaPlay').click(); await p.waitForFunction(() => mygrainSongBeta.playing); await p.waitForTimeout(500); await p.evaluate(() => mygrainSongBeta.stop());
                    fs.writeFileSync(out + '/song-renders.json', JSON.stringify({ renders, played: true, stopped: true }, null, 2));
                }
                if (process.env.AI_PARTS_REAL_MODEL !== '1') {
                    mode = 'bad'; const beforeBad = await p.evaluate(() => mygrainAiPatchAdapter.fingerprint()); await click('#aiPartGenerate', /keeps current library samples/); assert.equal(await p.evaluate(() => mygrainAiPatchAdapter.fingerprint()), beforeBad);
                    mode = 'hold'; await p.locator('#aiPartGenerate').click(); await p.waitForFunction(() => mygrainAiPatch.busy); await p.waitForTimeout(100); await p.locator('#aiPatchCancel').click(); release?.(); mode = 'normal'; await ready(); assert.equal(await p.evaluate(() => mygrainAiPatchAdapter.fingerprint()), beforeBad);
                }
                await p.locator('#aiPartType').selectOption('middle8'); assert.equal(await p.locator('#aiPartBars').inputValue(), '8'); assert(await p.locator('#aiPartBars').isDisabled());
                const layout = await p.locator('#aiPatchCard').evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: innerWidth, overflow: el.scrollWidth > el.clientWidth + 1 })); assert(layout.left >= -1 && layout.right <= layout.width + 1 && !layout.overflow, JSON.stringify(layout));
                await p.locator('#aiPatchCard').screenshot({ path: out + '/' + engine + '-' + viewport.width + '.png' }); assert.deepEqual(errors, []);
                await p.evaluate(() => window.dispatchEvent(new Event('mygrain-account-lock'))); assert.equal(await p.locator('#aiPartName2').inputValue(), ''); assert(await p.locator('#aiPartGenerate').isDisabled());
                const result = { engine, viewport, liveAssets, productionWrites: 0, modelRequests: requests.length, sampleLoads: loads, capture, section: { patternSteps: chorus.X.length, qChords: chorus.Q.sequence.filter(x => x && !x.rest).length, rolls: chorus.drumRatchets }, checks: ['contextual-section', 'same-tempo-and-buffer-identities', 'named-store-complete-audio', 'Undo-after-Store', 'full-state-Recall-no-autoplay', 'rename-safe-text', 'refine-current-section', 'regenerate-same-section', 'cross-device-no-local-storage', 'account-isolation', 'CSRF', 'stale-revision-denied', 'Add-to-Song-saved-archive-not-live-patch', 'existing-Song-parts-unchanged', 'source-reload-rejected', 'cancel-no-change', 'audible-preview', 'Middle8-explicit-repeats', 'mobile-layout', 'account-lock'], errors };
                results.push(result); console.log(JSON.stringify(result));
            } catch (error) { console.error('STATE', await p.evaluate(() => ({ status: document.getElementById('aiPatchStatus')?.textContent, part: document.getElementById('aiPartStatus')?.textContent, song: document.getElementById('songBetaStatus')?.textContent, captureChanges: window.__captureChanges, log: document.getElementById('aiPatchChanges')?.textContent }))); throw error; }
            finally { release?.(); await device?.close(); await other?.close(); await ctx.close(); }
        } } finally { await browser.close(); }
    }
    fs.writeFileSync(out + '/results.json', JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
