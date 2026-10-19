const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use isolated localhost song storage, with SONG_LOCK_TEST_LEASE_SECONDS=12.');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    const contexts = [];
    const init = async (context, engine = true) => {
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        if (engine) {
            await page.locator('#start-btn').click();
            await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended && !engineStarting);
        }
        return page;
    };
    try {
        const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        contexts.push(phoneContext);
        const phone = await init(phoneContext);
        await phone.locator('#songBetaDeviceName').fill('Phone editor');
        await phone.locator('#songBetaName').fill('Shared lock browser test');
        await phone.locator('#songBetaNewSong').click();
        await phone.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.canEditSong());
        await phone.evaluate(() => { window.testLeaseHeartbeat = setInterval(() => mygrainSongBeta.lease.check(), 2000); });
        const library = await phone.evaluate(() => ({ key: mygrainSongBeta.key, id: mygrainSongBeta.song.id }));
        await phone.evaluate(() => {
            syncPatternLengthControls(8, { skipSave: true });
            applyGlobalBpm(300);
            const buffer = audioContext.createBuffer(1, 4410, 44100);
            buffer.getChannelData(0).fill(.05);
            generatedLoopBuffer = buffer;
            generatedLoopBaseBuffer = buffer;
            grainMainSampleBuffer = buffer;
            grainASampleBuffer = buffer;
            grainBSampleBuffer = buffer;
        });
        await phone.locator('#songBetaPartName').fill('Intro');
        await phone.locator('#songBetaNewPart').click();
        await phone.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.parts.length === 1);
        assert.equal(await phone.evaluate(() => mygrainSongBeta.song.revision), 2);
        const laptopContext = await browser.newContext({ viewport: { width: 1365, height: 900 } });
        contexts.push(laptopContext);
        await laptopContext.addInitScript(({ key, id }) => {
            localStorage.setItem('mygrain-song-library-key-v1', key);
            localStorage.setItem('mygrain-song-selected-v1', id);
        }, library);
        const laptop = await init(laptopContext);
        assert.equal(await laptop.locator('#songBetaNewPart').isEnabled(), true);
        assert.equal(await laptop.locator('#songBetaRenameSong').isEnabled(), true);
        assert.match(await laptop.locator('#songBetaLockStatus').textContent(), /Phone editor/);
        await laptop.locator('#songBetaEditSong').click();
        await laptop.waitForFunction(() => !mygrainSongBeta.busy);
        assert.match(await laptop.locator('#songBetaStatus').textContent(), /being edited on Phone editor/);
        const direct = await laptop.evaluate(async () => {
            const result = await fetch(`${mygrainSongBeta.api}/${mygrainSongBeta.song.id}/rename`, { method: 'POST', headers: { 'X-Mygrain-Song-Key': mygrainSongBeta.key, 'Content-Type': 'application/json', 'If-Match': `"${mygrainSongBeta.song.revision}"` }, body: JSON.stringify({ name: 'Unauthorized overwrite' }) });
            return result.status;
        });
        assert.equal(direct, 423);
        const otherTab = await init(phoneContext, false);
        await otherTab.evaluate(async id => { mygrainSongBeta.song = (await mygrainSongBeta.request(`/${id}`)).song; await mygrainSongBeta.lease.watch(id); }, library.id);
        assert.equal(await otherTab.evaluate(() => mygrainSongBeta.lease.device.id), await phone.evaluate(() => mygrainSongBeta.lease.device.id));
        assert.notEqual(await otherTab.evaluate(() => mygrainSongBeta.lease.session), await phone.evaluate(() => mygrainSongBeta.lease.session));
        const sameDeviceDenied = await otherTab.evaluate(async () => { try { await mygrainSongBeta.beginEditing(); return false; } catch (error) { return error.code === 'SONG_LOCKED'; } });
        assert.equal(sameDeviceDenied, true);
        await otherTab.close();
        await laptop.locator('#songBetaArm').click();
        await laptop.waitForFunction(() => mygrainSongBeta.armed && !mygrainSongBeta.busy, null, { timeout: 120000 });
        assert.equal(await laptop.evaluate(() => mygrainSongBeta.song.revision), 2);
        assert.equal(await laptop.evaluate(() => mygrainSongBeta.canEditSong()), false);
        await phone.locator('#songBetaPartName').fill('Focus remains here');
        const focus = await phone.evaluate(async () => {
            window.testPartRow = document.querySelector('.song-beta-part');
            const before = document.activeElement;
            await mygrainSongBeta.lease.check();
            return { sameFocus: before === document.activeElement, samePartRow: window.testPartRow === document.querySelector('.song-beta-part'), value: document.getElementById('songBetaPartName').value };
        });
        assert.deepEqual(focus, { sameFocus: true, samePartRow: true, value: 'Focus remains here' });
        await laptop.locator('#songBetaPlay').click();
        await laptop.waitForFunction(() => mygrainSongBeta.playing);
        assert.equal(await laptop.evaluate(() => Boolean(mygrainSongBeta.playback)), true);
        await laptop.locator('#songBetaStop').click();
        await phone.evaluate(() => { clearInterval(window.testLeaseHeartbeat); });
        await phone.locator('#songBetaFinishEditing').click();
        await phone.waitForFunction(() => !mygrainSongBeta.busy && !mygrainSongBeta.lease.token);
        await laptop.locator('#songBetaDeviceName').fill('Laptop editor');
        await laptop.locator('#songBetaEditSong').click();
        await laptop.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.canEditSong());
        await laptop.evaluate(() => { window.prompt = () => 'Renamed on laptop'; });
        await laptop.locator('#songBetaRenameSong').click();
        await laptop.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.revision === 3);
        await laptop.locator('#songBetaFinishEditing').click();
        await laptop.waitForFunction(() => !mygrainSongBeta.busy && !mygrainSongBeta.lease.token);
        await phone.locator('#songBetaEditSong').click();
        await phone.waitForFunction(() => !mygrainSongBeta.busy);
        assert.match(await phone.locator('#songBetaStatus').textContent(), /changed on the server/);
        await phone.locator('#songBetaRefresh').click();
        await phone.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.revision === 3);
        await phone.locator('#songBetaEditSong').click();
        await phone.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.canEditSong());
        const oldCredentials = await phone.evaluate(() => ({ ...mygrainSongBeta.lease.credentials(), 'If-Match': `"${mygrainSongBeta.song.revision}"` }));
        await phone.evaluate(() => {
            mygrainSongBeta.editing = { id: mygrainSongBeta.song.parts[0].id, sha256: mygrainSongBeta.song.parts[0].sha256, songId: mygrainSongBeta.song.id };
            document.getElementById('songBetaPartName').value = 'Unsaved phone draft';
            clearTimeout(mygrainSongBeta.lease.timer);
            mygrainSongBeta.render();
        });
        await phoneContext.setOffline(true);
        await phone.evaluate(() => mygrainSongBeta.lease.check());
        assert.equal(await phone.locator('#songBetaSavePart').isEnabled(), true);
        await phone.locator('#songBetaSavePart').click();
        await phone.waitForFunction(() => !mygrainSongBeta.busy);
        assert.match(await phone.locator('#songBetaStatus').textContent(), /Connection lost/);
        assert.match(await phone.locator('#songBetaLockStatus').textContent(), /Connection lost/);
        const expiry = await laptop.evaluate(async () => { const result = await mygrainSongBeta.request(`/${mygrainSongBeta.song.id}/lock`); return (result.lock.expiresAt - result.serverTime) * 1000; });
        assert.ok(expiry <= 12000 && expiry > 0);
        await new Promise(resolve => setTimeout(resolve, expiry + 200));
        await laptop.locator('#songBetaEditSong').click();
        await laptop.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.canEditSong());
        await laptop.evaluate(() => { window.prompt = () => 'After expired phone'; });
        await laptop.locator('#songBetaRenameSong').click();
        await laptop.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.revision === 4);
        await phoneContext.setOffline(false);
        const oldSave = await phone.evaluate(async headers => {
            const result = await fetch(`${mygrainSongBeta.api}/${mygrainSongBeta.song.id}/rename`, { method: 'POST', headers: { ...headers, 'X-Mygrain-Song-Key': mygrainSongBeta.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Stale phone overwrite' }) });
            return result.status;
        }, oldCredentials);
        assert.equal(oldSave, 423);
        await phone.evaluate(() => mygrainSongBeta.lease.check());
        assert.equal(await phone.evaluate(() => mygrainSongBeta.canEditSong()), false);
        assert.equal(await phone.locator('#songBetaPartName').inputValue(), 'Unsaved phone draft');
        assert.equal(await phone.evaluate(() => Boolean(mygrainSongBeta.editing)), true);
        await laptop.locator('#songBetaFinishEditing').click();
        await laptop.waitForFunction(() => !mygrainSongBeta.busy && !mygrainSongBeta.lease.token);
        await phone.locator('#songBetaEditSong').click();
        await phone.waitForFunction(() => !mygrainSongBeta.busy);
        assert.match(await phone.locator('#songBetaStatus').textContent(), /changed on the server/);
        await phone.evaluate(() => { window.confirm = () => false; });
        await phone.locator('#songBetaRefresh').click();
        await phone.waitForFunction(() => !mygrainSongBeta.busy);
        assert.equal(await phone.locator('#songBetaPartName').inputValue(), 'Unsaved phone draft');
        assert.equal(await phone.evaluate(() => mygrainSongBeta.song.revision), 3);
        await phone.evaluate(() => { window.confirm = () => true; });
        await phone.locator('#songBetaRefresh').click();
        await phone.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song.revision === 4);
        assert.equal(await phone.locator('#songBetaPartName').inputValue(), 'Unsaved phone draft');
        await phone.locator('#songBetaEditSong').click();
        await phone.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.canEditSong());
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1365, height: 900 }]) {
            await phone.setViewportSize(viewport);
            const layout = await phone.locator('#songBetaCard').evaluate(card => ({ width: card.clientWidth, scrollWidth: card.scrollWidth }));
            assert.ok(layout.scrollWidth <= layout.width + 2, JSON.stringify({ viewport, layout }));
        }
        await phone.screenshot({ path: process.env.SONG_LOCK_SCREENSHOT || '/tmp/mygrain-song-locks.png' });
        await phone.close();
        await laptop.waitForFunction(async () => !(await mygrainSongBeta.request(`/${mygrainSongBeta.song.id}/lock`)).lock);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ multiDevice: 'pass', duplicateTab: 'pass', serverEnforcement: 'pass', readOnlyCacheAndPlayback: 'pass', renewalPreservesFocus: 'pass', immediateRelease: 'pass', timeoutRecovery: 'pass (12-second isolated lease; backend unit tests assert 600 seconds)', staleSave: 'pass', unsavedDraftPreserved: 'pass', pagehideRelease: 'pass', viewports: [390, 844, 1365], pageErrors: errors }, null, 2));
    } finally {
        for (const context of contexts) await context.close();
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
