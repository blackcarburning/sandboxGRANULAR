// Disposable local accounts and stores only; no production song writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18889/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence = process.env.LOCK_RECOVERY_EVIDENCE || '/tmp/mygrain-lock-recovery';
fs.mkdirSync(evidence, { recursive: true });

(async () => {
    const results = [];
    for (const [engine, type] of Object.entries({ chromium, webkit })) {
        const browser = await type.launch(engine === 'chromium' ? {
            executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
        } : {});
        const errors = [];
        const credentials = { username: `recover_${engine}_${Date.now()}`, password: 'isolated-lock-recovery-fixture' };
        try {
            const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
            assert.equal((await desktop.request.post(base + 'api/auth/register', { data: credentials })).status(), 200);
            async function open(context) {
                const page = await context.newPage();
                page.setDefaultTimeout(30000);
                page.on('pageerror', error => errors.push(error.message));
                await page.goto(base);
                await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy && document.documentElement.dataset.mygrainStartup === 'ready');
                await page.locator('#start-btn').click();
                await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
                return page;
            }
            const old = await open(desktop);
            await old.locator('#songBetaDeviceName').fill('Marks Phone');
            await old.locator('#songBetaName').fill('Recovery fixture');
            await old.locator('#songBetaNewSong').click();
            await old.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.canEditSong());
            const original = await old.evaluate(async () => ({
                song: (await mygrainSongBeta.request(`/${mygrainSongBeta.song.id}`)).song,
                device: mygrainSongBeta.lease.device.id,
                headers: mygrainSongBeta.lease.credentials(), lock: mygrainSongBeta.lease.lock
            }));
            const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            assert.equal((await phone.request.post(base + 'api/auth/login', { data: credentials })).status(), 200);
            await phone.addInitScript(id => {
                localStorage.setItem('mygrain-song-selected-v1', id);
                localStorage.setItem('mygrain-song-device-label-v1', 'Other Phone');
            }, original.song.id);
            const recovered = await open(phone);
            await recovered.locator('#songBetaSongs').selectOption(original.song.id);
            await recovered.waitForFunction(id => !mygrainSongBeta.busy && mygrainSongBeta.song?.id === id, original.song.id);
            await recovered.locator('#songBetaDeviceName').fill('Other Phone');
            assert.notEqual(await recovered.evaluate(() => mygrainSongBeta.lease.device.id), original.device);
            assert.equal(await recovered.locator('#songBetaRecoverLock').isHidden(), true);
            await recovered.locator('#songBetaEditSong').click();
            await recovered.waitForFunction(() => !mygrainSongBeta.busy);
            assert.match(await recovered.locator('#songBetaStatus').textContent(), /being edited on Marks Phone/);
            await recovered.locator('#songBetaDeviceName').fill('Marks Phone');
            assert.equal(await recovered.locator('#songBetaRecoverLock').isVisible(), true);
            recovered.once('dialog', dialog => dialog.dismiss());
            await recovered.locator('#songBetaRecoverLock').click();
            await recovered.waitForFunction(() => !mygrainSongBeta.busy);
            assert.equal(await recovered.evaluate(() => mygrainSongBeta.canEditSong()), false);
            assert.deepEqual(await old.evaluate(async () => (await mygrainSongBeta.request(`/${mygrainSongBeta.song.id}/lock`)).lock), original.lock);
            await recovered.evaluate(() => {
                mygrainSongBeta.editing = { id: 'live-draft', songId: mygrainSongBeta.song.id };
                document.getElementById('songBetaPartName').value = 'Keep this unsaved draft';
                window.recoveryAudio = audioContext.createBuffer(2, 1024, audioContext.sampleRate);
                recoveryAudio.getChannelData(0).fill(.125);
                recoveryAudio.getChannelData(1).fill(-.25);
                generatedLoopBuffer = recoveryAudio;
                mygrainSongBeta.render();
            });
            recovered.once('dialog', dialog => dialog.accept());
            await recovered.locator('#songBetaRecoverLock').click();
            await recovered.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.canEditSong());
            assert.equal(await recovered.locator('#songBetaRecoverLock').isHidden(), true);
            const preserved = await recovered.evaluate(async () => ({
                song: (await mygrainSongBeta.request(`/${mygrainSongBeta.song.id}`)).song,
                draft: mygrainSongBeta.editing.id,
                name: document.getElementById('songBetaPartName').value,
                audio: generatedLoopBuffer === recoveryAudio && generatedLoopBuffer.getChannelData(0)[0] === .125
                    && generatedLoopBuffer.getChannelData(1)[0] === -.25,
                layout: { width: document.getElementById('songBetaCard').clientWidth, scroll: document.getElementById('songBetaCard').scrollWidth }
            }));
            assert.deepEqual(preserved.song, original.song);
            assert.equal(preserved.draft, 'live-draft');
            assert.equal(preserved.name, 'Keep this unsaved draft');
            assert.equal(preserved.audio, true);
            assert.ok(preserved.layout.scroll <= preserved.layout.width + 2);
            for (const action of ['renew', 'release']) {
                const status = await old.evaluate(async ({ headers, action }) => (await fetch(`${mygrainSongBeta.api}/${mygrainSongBeta.song.id}/lock/${action}`, { method: 'POST', headers })).status,
                    { headers: original.headers, action });
                assert.equal(status, 423);
            }
            await old.evaluate(() => mygrainSongBeta.lease.check());
            assert.equal(await old.evaluate(() => mygrainSongBeta.canEditSong()), false);
            await recovered.evaluate(async () => {
                mygrainSongBeta.editing = null;
                await mygrainSongBeta.request(`/${mygrainSongBeta.song.id}/rename`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Saved after recovery' })
                });
            });
            const song = await recovered.evaluate(async () => (await mygrainSongBeta.request(`/${mygrainSongBeta.song.id}`)).song);
            assert.equal(song.name, 'Saved after recovery');
            assert.equal(song.revision, original.song.revision + 1);
            assert.deepEqual(errors, []);
            await recovered.locator('#songBetaCard').screenshot({ path: `${evidence}/${engine}-phone.png` });
            results.push({ engine, passed: true, sameNameRecovery: true, otherNameBlocked: true,
                cancelRetainedLock: true, exactSongAndStereoDraftPreserved: true, oldCredentialsRejected: true, saveAfterRecovery: true });
            console.log('PASS', engine, JSON.stringify(results.at(-1)));
        } finally { await browser.close(); }
    }
    fs.writeFileSync(`${evidence}/results.json`, JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
