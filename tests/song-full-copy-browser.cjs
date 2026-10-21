// Isolated local stores/accounts only. Exercises real saved ZIPs and stereo WAVs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18889/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence = process.env.FULL_COPY_EVIDENCE || '/tmp/mygrain-full-copy';
fs.mkdirSync(evidence, { recursive: true });
(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
        try {
            const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
            const credentials = { username: `copy_${engine}_${Date.now()}`, password: 'isolated-full-copy-fixture' };
            assert.equal((await context.request.post(base + 'api/auth/register', { data: credentials })).status(), 200);
            const page = await context.newPage(), errors = [];
            page.setDefaultTimeout(45000);
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
            await page.goto(base);
            await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy && document.documentElement.dataset.mygrainStartup === 'ready');
            await page.locator('#start-btn').click();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            await page.locator('#songBetaName').fill('Independent copy fixture');
            await page.locator('#songBetaNewSong').click();
            await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.canEditSong());
            const original = await page.evaluate(async () => {
                stopAllPerformancePlayback({ silent: true });
                syncPatternLengthControls(8, { skipSave: true }); applyGlobalBpm(300);
                const tone = audioContext.createBuffer(2, Math.round(audioContext.sampleRate * .4), audioContext.sampleRate);
                for (let c = 0; c < 2; c++) for (let i = 0; i < tone.length; i++) tone.getChannelData(c)[i] = .12 * Math.sin(2 * Math.PI * (220 + c * 110) * i / tone.sampleRate);
                await applyLoadedBastardLoopBuffer(tone, 'Original stereo', { sampleNames: ['original-stereo.wav'], bpm: 300 });
                const controller = mygrainSongBeta;
                await controller.newPart({ name: 'Intro', repeats: 2 });
                let part = controller.song.parts[0];
                const rendered = await controller.request(`/${controller.song.id}/parts/${part.id}/render?sha256=${part.sha256}&portable=1&keyboard=1&grain=1&q=7&vocalcut=1&vocalrepeat=1&drumlanes=1`, {
                    method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: mygrainSongBetaAdapter.encodeRender(tone)
                });
                controller.acceptSong(rendered.song);
                part = controller.song.parts[0];
                await controller.setColour(part, '#123456');
                await controller.reusePart(controller.song.parts[0]);
                await controller.setRepeats(controller.song.parts[1], 5);
                part = controller.song.parts[0];
                controller.renderSources.set(part.id, part.contentSha256 || part.sha256); controller.armed = true;
                for (const entry of controller.song.parts) controller.expandedParts.add(`${controller.song.id}:${entry.id}`);
                controller.render();
                window.copyLiveAudio = audioContext.createBuffer(2, 1024, audioContext.sampleRate);
                copyLiveAudio.getChannelData(0).fill(.2); generatedLoopBuffer = copyLiveAudio;
                window.fullCopyOriginal = structuredClone(controller.song.parts);
                window.readFullCopyZip = async part => {
                    const body = await controller.request(`/${controller.song.id}/parts/${part.id}`, { binary: true });
                    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', body))).map(b => b.toString(16).padStart(2, '0')).join('');
                };
                return { parts: fullCopyOriginal, hash: await readFullCopyZip(part), revision: controller.song.revision };
            });
            console.log('Fixture ready', engine);
            const copyButton = page.locator('.song-beta-part').nth(1).locator('.song-beta-full-copy');
            assert.equal(await copyButton.textContent(), 'Make a full copy');
            await copyButton.click();
            await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts.length === 3);
            const saved = await page.evaluate(async () => {
                const copied = mygrainSongBeta.song.parts.at(-1);
                const bytes = await mygrainSongBeta.readRender(copied);
                const audio = await mygrainSongBeta.loadRender(copied, new AbortController().signal);
                return { parts: mygrainSongBeta.song.parts, revision: mygrainSongBeta.song.revision,
                    copiedHash: await readFullCopyZip(copied), armed: mygrainSongBeta.armed,
                    liveUnchanged: generatedLoopBuffer === copyLiveAudio && generatedLoopBuffer.getChannelData(0)[0] > .19,
                    render: { channels: audio.numberOfChannels, frames: audio.length, bytes: bytes.byteLength,
                        stereoDistinct: audio.getChannelData(0)[100] !== audio.getChannelData(1)[100] } };
            });
            assert.deepEqual(saved.parts.slice(0, 2), original.parts);
            const copied = saved.parts[2];
            assert.equal(copied.name, 'Intro_full_copy'); assert.equal(copied.repeats, 5); assert.equal(copied.colour, '#123456');
            assert.equal(copied.sourcePartId, undefined); assert.notEqual(copied.id, original.parts[0].id);
            assert.equal(saved.copiedHash, original.hash); assert.equal(saved.revision, original.revision + 1);
            assert.equal(saved.liveUnchanged, true); assert.equal(saved.armed, true);
            assert.equal(saved.render.channels, 2); assert.equal(saved.render.stereoDistinct, true);
            for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
                await page.setViewportSize(viewport);
                const layout = await page.locator('.song-beta-part').nth(2).locator('.song-beta-full-copy').evaluate(button => ({ width: button.clientWidth, scroll: button.scrollWidth, left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right, viewport: innerWidth }));
                assert.ok(layout.scroll <= layout.width + 2 && layout.left >= 0 && layout.right <= layout.viewport + 1, JSON.stringify(layout));
            }
            await page.setViewportSize({ width: 390, height: 844 });
            await page.locator('.song-beta-part').nth(2).screenshot({ path: `${evidence}/${engine}-copy-card.png` });
            await page.locator('.song-beta-part').nth(2).locator('.song-beta-amend').click();
            await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.editing?.id === mygrainSongBeta.song.parts[2].id);
            await page.locator('#songBetaPartName').fill('Edited independent copy');
            await page.evaluate(() => { document.getElementById('performanceBastardLoopLevel').value = '61'; });
            await page.locator('#songBetaSavePart').click();
            await page.waitForFunction(() => !mygrainSongBeta.busy && !mygrainSongBeta.editing);
            const amended = await page.evaluate(async () => ({ parts: mygrainSongBeta.song.parts, originalHash: await readFullCopyZip(mygrainSongBeta.song.parts[0]), copyHash: await readFullCopyZip(mygrainSongBeta.song.parts[2]) }));
            assert.deepEqual(amended.parts.slice(0, 2), original.parts);
            assert.equal(amended.originalHash, original.hash); assert.notEqual(amended.copyHash, original.hash);
            assert.equal(amended.parts[2].name, 'Edited independent copy');
            await page.reload();
            await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy && mygrainSongBeta.song?.parts.length === 3);
            assert.deepEqual(await page.evaluate(() => mygrainSongBeta.song.parts), amended.parts);
            assert.deepEqual(errors, []);
            results.push({ engine, passed: true, completeStereoCopy: true, originalAndReuseUnchanged: true, independentAmendment: true, persistsReload: true, desktopAndPhoneFit: true, liveAudioUntouched: true, armedPlaybackRetained: true });
            console.log('PASS', engine, JSON.stringify(results.at(-1)));
        } finally { await browser.close(); }
    }
    fs.writeFileSync(`${evidence}/results.json`, JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
