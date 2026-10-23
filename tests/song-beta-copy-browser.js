const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost song test server.');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const results = [];
        for (const sampleRate of [44100, 48000]) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            assert.equal((await context.request.post(base + 'api/auth/register', { data: { username: `copy_single_${sampleRate}_${Date.now()}`, password: 'isolated-single-copy' } })).status(), 200);
            await context.addInitScript(rate => {
                const Original = window.AudioContext || window.webkitAudioContext;
                window.AudioContext = class extends Original {
                    constructor(options) { super({ ...options, sampleRate: rate }); }
                };
            }, sampleRate);
            const page = await context.newPage();
            const errors = [];
            const writes = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('request', request => {
                if (request.method() === 'POST' && request.url().startsWith(base + 'api/songs')) writes.push(new URL(request.url()).pathname);
            });
            await page.route('**/*', route => {
                const request = route.request();
                if (request.url().startsWith(new URL(base).origin + '/')) return route.continue();
                return route.abort();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
            await page.click('#start-btn');
            await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
            const fixture = await page.evaluate(async () => {
                const controller = mygrainSongBeta;
                setGeneratedLoopTransportEnabled(false, { silent: true, skipSave: true });
                setOscillatorsEnabled(false, { silent: true, skipSave: true });
                setGranularLayersEnabled(false, { silent: true, skipSave: true });
                setArpeggiatorEnabled(false);
                seqGrainsEnabled = false;
                document.getElementById('seqGrainsEnabled').checked = false;
                const song = (await controller.request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Loop copy phone fixture' }) })).song;
                controller.acceptSong(song);
                await controller.lease.watch(song.id);
                await controller.beginEditing();
                const tone = frequency => {
                    const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                    const data = buffer.getChannelData(0);
                    for (let index = 0; index < data.length; index += 1) data[index] = Math.sin(2 * Math.PI * frequency * index / buffer.sampleRate) * .15;
                    return buffer;
                };
                for (const [name, frequency, steps, bpm] of [['Source', 220, 8, 300], ['Target', 330, 16, 240]]) {
                    syncPatternLengthControls(steps, { skipSave: true });
                    applyGlobalBpm(bpm);
                    bastardLoopEnabled = true;
                    bastardLoopSourceBpm = bpm;
                    bastardLoopBuffer = tone(frequency);
                    bastardLoopLSampleBuffer = tone(frequency + 100);
                    bastardLoopMPlusRawBuffer = tone(frequency + 200);
                    bastardLoopMPlusBuffer = tone(frequency + 300);
                    bastardLoopMPlusMetadata = { summary: name + ' backing vocal', durationSeconds: 1 };
                    document.getElementById('performanceBastardLoopLevel').value = name === 'Source' ? '33' : '77';
                    saveState();
                    const body = await mygrainSongBetaAdapter.capture();
                    controller.acceptSong((await controller.request(`/${song.id}/parts?name=${name}&repeats=1`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body })).song);
                }
                window.readCopyFixture = async part => {
                    const body = await controller.request(`/${song.id}/parts/${part.id}`, { binary: true });
                    const entries = parseStoredZipEntries(body);
                    const snapshot = JSON.parse(getZipText(entries, 'song-part.json'));
                    const audio = {};
                    for (const asset of snapshot.assets) audio[asset.key] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', entries.get(asset.path)))).join(',');
                    return { snapshot, audio };
                };
                window.copyFixtureBefore = await Promise.all(controller.song.parts.map(readCopyFixture));
                for (const part of controller.song.parts) controller.expandedParts.add(`${song.id}:${part.id}`);
                await controller.arm();
                controller.render();
                return { songId: song.id, source: controller.song.parts[0], target: controller.song.parts[1], sampleRate: audioContext.sampleRate };
            });
            assert.equal(fixture.sampleRate, sampleRate);
            assert.equal(await page.evaluate(() => mygrainSongBeta.armed), true);
            const sourceRow = page.locator('.song-beta-part').nth(0);
            const targetRow = page.locator('.song-beta-part').nth(1);
            assert.equal(await targetRow.locator('.song-beta-paste').isDisabled(), true);
            const layouts = [];
            for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 640 }]) {
                await page.setViewportSize(viewport);
                await sourceRow.locator('.song-beta-copy').click();
                const dialog = page.locator('.song-beta-copy-dialog');
                await dialog.waitFor({ state: 'visible' });
                assert.equal(await dialog.locator('[data-layer]').count(), 20);
                const geometry = await dialog.evaluate(element => {
                    const bounds = element.getBoundingClientRect();
                    return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: innerWidth, height: innerHeight, overflowing: element.scrollWidth > element.clientWidth + 1, inBody: element.parentElement === document.body };
                });
                assert.equal(geometry.inBody, true);
                assert.equal(geometry.overflowing, false);
                assert.ok(geometry.left >= 0 && geometry.right <= geometry.width + 1);
                assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height + 1);
                if (process.env.SONG_COPY_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SONG_COPY_SCREENSHOT_DIR}/copy-${sampleRate}-${viewport.width}x${viewport.height}.png` });
                await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
                assert.equal(await page.locator('.song-beta-copy-dialog').count(), 0);
                assert.equal(await sourceRow.locator('.song-beta-copy').evaluate(element => document.activeElement === element), true);
                await sourceRow.locator('.song-beta-copy').click();
                await page.keyboard.press('Escape');
                await page.locator('.song-beta-copy-dialog').waitFor({ state: 'detached' });
                layouts.push(viewport);
            }
            await page.setViewportSize({ width: 390, height: 844 });
            const writesBeforeCopy = writes.length;
            await sourceRow.locator('.song-beta-copy').click();
            await page.locator('.song-beta-copy-dialog [data-layer="A"]').click();
            await page.locator('.song-beta-copy-selected').click();
            await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.loopClipboard?.layer === 'A');
            assert.equal(writes.length, writesBeforeCopy);
            assert.match(await page.locator('#songBetaClipboard').textContent(), /Bastardloop A from Source/);
            const writesBeforeRecording = writes.length;
            for (const lane of ['M', 'M+', 'output']) {
                await page.evaluate(lane => {
                    if (lane === 'M') bastardLoopMRecordingState = 'armed';
                    else if (lane === 'M+') bastardLoopMPlusRecordingState = 'recording';
                    else isRecording = true;
                }, lane);
                await targetRow.locator('.song-beta-paste').click();
                await page.waitForFunction(() => !mygrainSongBeta.busy);
                assert.match(await page.locator('#songBetaStatus').textContent(), /Finish recording/);
                assert.equal(writes.length, writesBeforeRecording);
                await page.evaluate(() => { bastardLoopMRecordingState = 'idle'; bastardLoopMPlusRecordingState = 'idle'; isRecording = false; });
            }
            const rendersBefore = writes.filter(path => path.endsWith('/render')).length;
            page.once('dialog', dialog => dialog.accept());
            await targetRow.locator('.song-beta-paste').click();
            await page.waitForFunction(() => !mygrainSongBeta.busy, null, { timeout: 60000 });
            assert.equal(await page.evaluate(() => mygrainSongBeta.armed), true);
            assert.match(await page.locator('#songBetaStatus').textContent(), /Pasted Bastardloop A.*Cache re-armed/);
            assert.equal(writes.filter(path => path.endsWith('/render')).length - rendersBefore, 1);
            const checked = await page.evaluate(async () => {
                const controller = mygrainSongBeta;
                const [source, target] = await Promise.all(controller.song.parts.map(readCopyFixture));
                const buffer = controller.renders.get(controller.song.parts[1].id);
                const peak = buffer.getChannelData(0).reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
                return { before: copyFixtureBefore, source, peak, target: { ...target, part: controller.song.parts[1] }, sourcePart: controller.song.parts[0] };
            });
            assert.deepEqual(checked.source, checked.before[0]);
            assert.equal(checked.target.audio.bastardA, checked.before[0].audio.bastardA);
            assert.equal(checked.target.audio.bastardL, checked.before[1].audio.bastardL);
            assert.equal(checked.target.audio.bastardMPlus, checked.before[1].audio.bastardMPlus);
            assert.equal(checked.target.snapshot.state.sliders.performanceBastardLoopLevel, '33');
            assert.equal(checked.target.snapshot.state.globalBpm, checked.before[1].snapshot.state.globalBpm);
            assert.equal(checked.target.snapshot.state.patternLength, 16);
            assert.equal(checked.sourcePart.sha256, fixture.source.sha256);
            assert.ok(checked.peak > .001, `Changed target render is audible: ${checked.peak}`);
            await page.evaluate(async () => {
                await mygrainSongBeta.recall(mygrainSongBeta.song.parts[1], { start: false });
                mygrainSongBeta.render();
            });
            const recalled = await page.evaluate(() => ({ level: document.getElementById('performanceBastardLoopLevel').value, bpm: document.getElementById('globalBpmSlider').value, steps: getPatternLengthSteps() }));
            assert.equal(recalled.level, '33');
            assert.equal(recalled.steps, 16);
            assert.equal(Number(recalled.bpm), 240);
            await sourceRow.locator('.song-beta-copy').click();
            await page.locator('.song-beta-copy-dialog [data-layer="M+"]').click();
            await page.locator('.song-beta-copy-selected').click();
            await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.loopClipboard?.layer === 'M+');
            page.once('dialog', dialog => dialog.dismiss());
            const cancelledRevision = await page.evaluate(() => mygrainSongBeta.song.revision);
            await targetRow.locator('.song-beta-paste').click();
            await page.waitForFunction(() => !mygrainSongBeta.busy);
            assert.equal(await page.evaluate(() => mygrainSongBeta.song.revision), cancelledRevision);
            await page.route(/\/paste-loop\?/, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Fixture offline; retry safely' }) }), { times: 1 });
            page.once('dialog', dialog => dialog.accept());
            await targetRow.locator('.song-beta-paste').click();
            await page.waitForFunction(() => !mygrainSongBeta.busy);
            assert.match(await page.locator('#songBetaStatus').textContent(), /Fixture offline/);
            assert.equal(await page.evaluate(() => mygrainSongBeta.song.revision), cancelledRevision);
            assert.equal(await page.evaluate(() => mygrainSongBeta.loopClipboard.layer), 'M+');
            page.once('dialog', dialog => dialog.accept());
            await targetRow.locator('.song-beta-paste').click();
            await page.waitForFunction(() => !mygrainSongBeta.busy);
            const backing = await page.evaluate(async () => {
                const controller = mygrainSongBeta;
                const result = await readCopyFixture(controller.song.parts[1]);
                return { result, source: copyFixtureBefore[0], previous: copyFixtureBefore[1] };
            });
            assert.equal(backing.result.audio.bastardMPlus, backing.source.audio.bastardMPlus);
            assert.equal(backing.result.audio.bastardMPlusRender, backing.source.audio.bastardMPlusRender);
            assert.equal(backing.result.audio.bastardL, backing.previous.audio.bastardL);
            assert.deepEqual(backing.result.snapshot.extra.metadata.bastardMPlus, backing.source.snapshot.extra.metadata.bastardMPlus);
            await page.evaluate(async () => { await mygrainSongBeta.finishEditing(); mygrainSongBeta.render(); });
            assert.equal(await page.evaluate(() => mygrainSongBeta.canEditSong()), false);
            assert.equal(await targetRow.locator('.song-beta-paste').isEnabled(), true);
            assert.equal(await sourceRow.locator('.song-beta-copy').isEnabled(), true);
            await sourceRow.locator('.song-beta-copy').click();
            await page.locator('.song-beta-copy-dialog [data-layer="L"]').click();
            await page.locator('.song-beta-copy-selected').click();
            await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.loopClipboard?.layer === 'L');
            assert.equal(await targetRow.locator('.song-beta-paste').isEnabled(), true);
            const acquireCount = () => writes.filter(path => path.endsWith('/lock/acquire')).length;
            const acquiredBeforeCancel = acquireCount();
            page.once('dialog', dialog => dialog.dismiss());
            await targetRow.locator('.song-beta-paste').click();
            await page.waitForFunction(() => !mygrainSongBeta.busy);
            assert.equal(acquireCount(), acquiredBeforeCancel);
            assert.equal(await page.evaluate(() => mygrainSongBeta.canEditSong()), false);
            const lockedRevision = await page.evaluate(async () => {
                const controller = mygrainSongBeta;
                const identity = { deviceId: '3'.repeat(32), sessionId: '4'.repeat(32), label: 'Other test iPhone' };
                const result = await controller.request(`/${controller.song.id}/lock/acquire`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': `"${controller.song.revision}"` }, body: JSON.stringify(identity)
                });
                window.otherPasteTestLease = { ...identity, token: result.token };
                return controller.song.revision;
            });
            const pasteCountBeforeConflict = writes.filter(path => path.endsWith('/paste-loop')).length;
            page.once('dialog', dialog => dialog.accept());
            await targetRow.locator('.song-beta-paste').click();
            await page.waitForFunction(() => !mygrainSongBeta.busy);
            assert.match(await page.locator('#songBetaStatus').textContent(), /Other test iPhone/);
            assert.equal(writes.filter(path => path.endsWith('/paste-loop')).length, pasteCountBeforeConflict);
            assert.equal(await page.evaluate(() => mygrainSongBeta.song.revision), lockedRevision);
            assert.equal(await page.evaluate(() => mygrainSongBeta.loopClipboard.layer), 'L');
            assert.equal(await page.evaluate(() => mygrainSongBeta.canEditSong()), false);
            assert.equal(await targetRow.locator('.song-beta-paste').isEnabled(), true);
            await page.evaluate(async () => {
                const controller = mygrainSongBeta;
                const other = otherPasteTestLease;
                await controller.request(`/${controller.song.id}/lock/release`, {
                    method: 'POST', headers: { 'X-Mygrain-Song-Device': other.deviceId, 'X-Mygrain-Song-Session': other.sessionId, 'X-Mygrain-Song-Lock': other.token }
                });
            });
            page.once('dialog', dialog => {
                assert.match(dialog.message(), /Editing access will be requested automatically/);
                return dialog.accept();
            });
            await targetRow.locator('.song-beta-paste').click();
            await page.waitForFunction(() => !mygrainSongBeta.busy, null, { timeout: 60000 });
            assert.equal(await page.evaluate(() => mygrainSongBeta.canEditSong()), true);
            assert.match(await page.locator('#songBetaStatus').textContent(), /Pasted Bastardloop L/);
            const pastedReadOnly = await page.evaluate(async () => (await readCopyFixture(mygrainSongBeta.song.parts[1])).audio.bastardL);
            assert.equal(pastedReadOnly, checked.before[0].audio.bastardL);
            assert.equal(await page.evaluate(() => typeof persistentDebugLog?.checkpoint), 'function');
            await page.evaluate(async () => mygrainSongBeta.finishEditing());
            await page.reload({ waitUntil: 'load' });
            await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
            assert.equal(await page.evaluate(() => mygrainSongBeta.loopClipboard), null);
            assert.deepEqual(errors, []);
            results.push({ sampleRate, layouts, pinnedOriginal: true, completeAudioSettingsCopy: true, rawAndRenderedBackingVocal: true,
                unchangedOtherLayersAndTiming: true, changedRenderAudible: checked.peak, automaticRearmOnlyChangedPart: true,
                readonlyPasteAcquiresEditing: true, otherDeviceLockPreserved: true, cancelDoesNotAcquireEditing: true, cancelSafe: true, errors });
            await context.close();
        }
        console.log(JSON.stringify(results, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
