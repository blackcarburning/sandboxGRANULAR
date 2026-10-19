const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_ACCOUNTS_TEST_URL || 'http://127.0.0.1:18820/mygrain/';
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) {
    throw new Error('Account acceptance writes are allowed only on an isolated loopback test server.');
}
const origin = new URL(base).origin;
const evidence = process.env.MYGRAIN_ACCOUNTS_EVIDENCE || '/tmp/mygrain-multiuser-acceptance/browser.json';
const fixtureRoot = process.env.MYGRAIN_ACCOUNTS_FIXTURE_ROOT;
const results = { base, checks: [], errors: [], blockedExternal: [] };

function checked(name, value = true) {
    assert.ok(value, name);
    results.checks.push(name);
}

function wavFixture() {
    const frames = 8000;
    const buffer = Buffer.alloc(44 + frames * 2);
    buffer.write('RIFF');
    buffer.writeUInt32LE(buffer.length - 8, 4);
    buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(16000, 24);
    buffer.writeUInt32LE(32000, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(frames * 2, 40);
    for (let frame = 0; frame < frames; frame += 1) {
        buffer.writeInt16LE(Math.round(Math.sin(frame * Math.PI / 20) * 6000), 44 + frame * 2);
    }
    return buffer;
}

async function jsonRequest(context, path, options = {}) {
    const headers = { ...options.headers };
    if (!path.startsWith('/mygrain/api/auth/')) {
        const session = await context.request.get(`${origin}/mygrain/api/auth/session`);
        const identity = await session.json();
        headers['X-Mygrain-User'] = identity.user?.username || '';
    }
    const response = await context.request.fetch(`${origin}${path}`, { ...options, headers });
    const payload = await response.json();
    assert.ok(response.ok(), `${path}: ${response.status()} ${payload.error || ''}`);
    assert.notEqual(payload.ok, false, `${path}: ${payload.error || 'request failed'}`);
    return payload;
}

async function login(page, username, password, register = false) {
    await page.goto(base, { waitUntil: 'load' });
    checked(`${username}: login panel fits the phone width`, await page.evaluate(() => {
        const panel = document.querySelector('.mygrain-account-panel').getBoundingClientRect();
        return panel.left >= 8 && panel.right <= innerWidth - 8;
    }));
    if (username === 'admin' && results.checks.length < 12) {
        await page.screenshot({ path: evidence.replace(/\.json$/, '-login.png'), fullPage: false });
    }
    await page.locator('#mygrainLoginUsername').fill(username);
    await page.locator('#mygrainLoginPassword').fill(password);
    await page.locator(register ? '#mygrainCreateUserBtn' : '#mygrainLoginBtn').click();
    await page.waitForFunction(expected => window.mygrainAccountContext?.user?.username === expected, username);
    await page.waitForLoadState('load');
    checked(`${username}: ${register ? 'registration' : 'login'} works through the initial screen`);
}

async function openRepository(page) {
    if (await page.locator('#start-btn').isVisible()) {
        await page.locator('#start-btn').click();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
    }
    await page.evaluate(() => openWavRepositoryBrowser());
    await page.waitForFunction(() => !wavRepositoryBrowserLoading);
    await page.waitForTimeout(100);
}

async function exerciseAccountPlacement(page) {
    if (await page.locator('#start-btn').isVisible()) {
        await page.locator('#start-btn').click();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
    }
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        await page.locator('.mygrain-account-toolbar').scrollIntoViewIfNeeded();
        checked(`account controls stay in document flow near Debug at ${viewport.width}px`, await page.evaluate(() => {
            const toolbar = document.querySelector('.mygrain-account-toolbar');
            const bounds = toolbar.getBoundingClientRect();
            const debug = document.querySelector('#debugConsoleCard').getBoundingClientRect();
            const position = getComputedStyle(toolbar).position;
            return !['fixed', 'sticky', 'absolute'].includes(position) && bounds.left >= 0 && bounds.right <= innerWidth
                && Math.abs(bounds.top - debug.top) < 400;
        }));
        await page.screenshot({ path: evidence.replace(/\.json$/, `-account-header-${viewport.width}.png`), fullPage: false });
        await page.evaluate(() => window.scrollBy(0, 1000));
        checked(`Jump remains clickable on phones and hidden on desktop at ${viewport.width}px`, await page.evaluate(() => {
            const handle = document.querySelector('#sectionJumpHandle');
            const bounds = handle.getBoundingClientRect();
            if (innerWidth >= 961) return bounds.width === 0 && bounds.height === 0;
            const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            return handle.contains(hit);
        }));
        await page.screenshot({ path: evidence.replace(/\.json$/, `-account-placement-${viewport.width}.png`), fullPage: false });
    }
    await page.setViewportSize({ width: 390, height: 844 });
}

async function exerciseBrowserStorage(page, value) {
    return page.evaluate(async marker => {
        const before = localStorage.getItem('mygrain-account-acceptance');
        const sessionBefore = sessionStorage.getItem('mygrain-account-acceptance');
        localStorage.setItem('mygrain-account-acceptance', marker);
        sessionStorage.setItem('mygrain-account-acceptance', marker);
        const database = await new Promise((resolve, reject) => {
            const request = indexedDB.open('mygrain-account-acceptance', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('markers');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
        const stored = await new Promise((resolve, reject) => {
            const transaction = database.transaction('markers', 'readwrite');
            const request = transaction.objectStore('markers').get('owner');
            let previous;
            request.onsuccess = () => {
                previous = request.result;
                transaction.objectStore('markers').put(marker, 'owner');
            };
            transaction.oncomplete = () => resolve(previous ?? null);
            transaction.onerror = () => reject(transaction.error);
        });
        database.close();
        return { before, sessionBefore, stored };
    }, value);
}

async function exerciseRenderDatabase(page, username) {
    const result = await page.evaluate(async () => {
        const name = `account-acceptance-${crypto.randomUUID()}`;
        const bridge = { context: { state: 'running', destination: {} }, destination: {}, state: {}, databases: new Set(), connections: new Set() };
        bridge.databaseFactory = mygrainAccounts.createRenderDatabaseFactory(bridge);
        __mygrainSongRenderBridges.set(name, bridge);
        const frame = document.createElement('iframe');
        frame.name = name;
        frame.hidden = true;
        frame.srcdoc = '<head><base href="/mygrain/"><script src="song-beta-render-deck.js?v=20261016-accounts-k20"><\/script></head>';
        try {
            const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
            document.body.append(frame);
            await loaded;
            const database = await new Promise((resolve, reject) => {
                const request = frame.contentWindow.indexedDB.open('AcceptanceRenderer', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('markers');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);
            });
            const physical = database.name;
            bridge.disposed = true;
            bridge.connections.forEach(connection => connection.close());
            const deleted = new Promise((resolve, reject) => {
                const request = bridge.databaseFactory.deleteDatabase([...bridge.databases][0]);
                request.onsuccess = resolve;
                request.onerror = () => reject(request.error);
            });
            frame.remove();
            await deleted;
            return physical;
        } finally {
            bridge.connections.forEach(connection => connection.close());
            frame.remove();
            __mygrainSongRenderBridges.delete(name);
        }
    });
    const prefix = username === 'admin' ? '' : `mygrain-account:${encodeURIComponent(username)}:`;
    checked(`${username}: renderer database uses its account namespace and cleanup survives frame removal`, result.startsWith(`${prefix}AcceptanceRenderer-song-render-`));
}

(async () => {
    const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        async function context(viewport) {
            const created = await browser.newContext({ viewport });
            await created.route('**/*', route => {
                const address = new URL(route.request().url());
                if (!['http:', 'https:'].includes(address.protocol) || address.origin === origin) return route.continue();
                results.blockedExternal.push(`${route.request().method()} ${address.origin}${address.pathname}`);
                return route.abort();
            });
            created.on('page', page => page.on('pageerror', error => results.errors.push(error.message)));
            return created;
        }

        const frontpage = await context({ width: 390, height: 844 });
        const frontpagePage = await frontpage.newPage();
        const frontpagePassword = crypto.randomBytes(18).toString('hex');
        await login(frontpagePage, 'frontpage-ui-user', frontpagePassword, true);
        await frontpagePage.evaluate(() => localStorage.setItem('frontpage-preserved-state', 'saved-workspace'));
        await frontpagePage.reload({ waitUntil: 'load' });
        for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
            await frontpagePage.setViewportSize(viewport);
            checked(`remembered initial account actions are visible and unobscured at ${viewport.width}px`, await frontpagePage.evaluate(() => {
                return ['[data-mygrain-account-action="login"]', '[data-mygrain-account-action="create"]', '.mygrain-start-account [data-mygrain-logout]', '#start-btn'].every(selector => {
                    const button = document.querySelector(selector);
                    const bounds = button.getBoundingClientRect();
                    return bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth && button.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
                });
            }));
            await frontpagePage.screenshot({ path: evidence.replace(/\.json$/, `-remembered-${viewport.width}.png`), fullPage: false });
        }
        await frontpagePage.locator('[data-mygrain-account-action="login"]').click();
        await frontpagePage.waitForURL(address => address.searchParams.get('account') === 'login');
        await frontpagePage.locator('#mygrainLoginUsername').waitFor();
        checked('initial Log in / Switch user completes logout before showing an inert form', !(await (await frontpage.request.get(`${origin}/mygrain/api/auth/session`)).json()).authenticated && await frontpagePage.locator('#start-btn').count() === 0);
        await login(frontpagePage, 'frontpage-ui-user', frontpagePassword);
        await frontpagePage.locator('[data-mygrain-account-action="create"]').click();
        await frontpagePage.waitForURL(address => address.searchParams.get('account') === 'create');
        await frontpagePage.locator('#mygrainLoginUsername').waitFor();
        checked('initial Create user opens new-password registration after logout', await frontpagePage.locator('#mygrainLoginPassword').getAttribute('autocomplete') === 'new-password' && !(await (await frontpage.request.get(`${origin}/mygrain/api/auth/session`)).json()).authenticated);
        await frontpagePage.locator('#mygrainLoginUsername').fill('frontpage-created-user');
        await frontpagePage.locator('#mygrainLoginPassword').fill(frontpagePassword);
        await frontpagePage.locator('#mygrainLoginPassword').press('Enter');
        await frontpagePage.waitForFunction(() => mygrainAccountContext.user?.username === 'frontpage-created-user');
        await frontpagePage.waitForLoadState('load');
        checked('Create user from the remembered initial screen registers on Enter', !new URL(frontpagePage.url()).searchParams.has('account'));
        checked('the created workspace does not inherit the previous user storage', await frontpagePage.evaluate(() => localStorage.getItem('frontpage-preserved-state') === null));
        await Promise.all([
            frontpagePage.waitForNavigation({ waitUntil: 'load' }),
            frontpagePage.locator('.mygrain-start-account [data-mygrain-logout]').click()
        ]);
        await frontpagePage.locator('#mygrainLoginUsername').waitFor();
        checked('initial Log out returns to the inert login screen', await frontpagePage.locator('#start-btn').count() === 0);
        await login(frontpagePage, 'frontpage-ui-user', frontpagePassword);
        checked('initial account actions preserve the original saved workspace', await frontpagePage.evaluate(() => localStorage.getItem('frontpage-preserved-state') === 'saved-workspace'));
        await frontpage.close();

        const admin = await context({ width: 390, height: 844 });
        for (const path of ['/mygrain-wavs/api/list', '/mygrain-wavs/private.wav', '/mygrain/api/songs',
            '/mygrain/api/patches/list', '/mygrain/patches/private.zip', '/mygrain/api/vocal-takes',
            '/mygrain/api/favourites', '/mygrain/api/arps', '/mygrain-stems/api/list', '/mygrain-midi/api/list']) {
            const response = await admin.request.get(`${origin}${path}`);
            checked(`anonymous access blocked: ${path}`, [401, 403, 404].includes(response.status()));
        }
        const adminPage = await admin.newPage();
        await login(adminPage, 'admin', 'snowpeas');
        const loginCookies = await admin.cookies(origin);
        checked('login uses a persistent HttpOnly cookie', loginCookies.some(cookie => cookie.httpOnly && cookie.expires > Date.now() / 1000 + 86400));
        await adminPage.reload({ waitUntil: 'load' });
        checked('remembered session survives reload', await adminPage.evaluate(() => mygrainAccountContext.user.username === 'admin'));
        const remembered = await browser.newContext({ storageState: await admin.storageState(), viewport: { width: 390, height: 844 } });
        const rememberedPage = await remembered.newPage();
        await rememberedPage.goto(base, { waitUntil: 'load' });
        checked('remembered login survives restoring browser state', await rememberedPage.evaluate(() => mygrainAccountContext.user.username === 'admin'));
        await remembered.close();
        await exerciseBrowserStorage(adminPage, 'admin-private-marker');
        await exerciseRenderDatabase(adminPage, 'admin');
        await exerciseAccountPlacement(adminPage);

        const audio = wavFixture();
        if (fixtureRoot) {
            assert.match(fs.realpathSync(fixtureRoot), /^\/tmp\/mygrain-accounts-parent(?:-final)?\.[A-Za-z0-9]+$/);
            const sourceFolder = `${fixtureRoot}/admin/source_mirrors/SAMPLEDROP`;
            fs.mkdirSync(sourceFolder, { recursive: true });
            fs.writeFileSync(`${sourceFolder}/account-source-private.wav`, audio);
        }
        const uploaded = await jsonRequest(admin, '/mygrain-wavs/api/upload?filename=account-admin-private.wav', {
            method: 'POST', headers: { 'Content-Type': 'audio/wav' }, data: audio
        });
        const filename = uploaded.savedName;
        const createdFiles = await jsonRequest(admin, '/mygrain-wavs/api/list');
        checked('new WAV creator comes from the authenticated account', createdFiles.files.find(file => file.name === filename)?.createdBy === 'admin');
        const adminSong = await jsonRequest(admin, '/mygrain/api/songs', {
            method: 'POST', data: { name: 'Admin private account acceptance song' }
        });

        const dan = await context({ width: 844, height: 390 });
        const danPage = await dan.newPage();
        await login(danPage, 'dan', 'charged');
        await exerciseRenderDatabase(danPage, 'dan');
        const danFiles = await jsonRequest(dan, '/mygrain-wavs/api/list');
        checked('dan cannot list admin WAVs', !danFiles.files.some(file => file.name === filename));
        const guessedWav = await dan.request.get(`${origin}/mygrain-wavs/${encodeURIComponent(filename)}`);
        checked('dan cannot download a guessed admin WAV URL', guessedWav.status() === 404);
        const guessedSong = await dan.request.get(`${origin}/mygrain/api/songs/${encodeURIComponent(adminSong.song.id)}`, { headers: { 'X-Mygrain-User': 'dan' } });
        checked('dan cannot read a guessed admin song ID', guessedSong.status() === 404);
        const spoof = await dan.request.get(`${origin}/mygrain-wavs/api/list`, { headers: { 'X-Mygrain-User': 'admin' } });
        checked('identity header cannot override the authenticated account', [401, 403, 409].includes(spoof.status()));
        await jsonRequest(dan, '/mygrain-wavs/api/upload?filename=account-dan-private.wav', {
            method: 'POST', headers: { 'Content-Type': 'audio/wav' }, data: audio
        });

        await openRepository(adminPage);
        const vocalProfile = await jsonRequest(admin, '/mygrain/api/vocal-takes/users', {
            method: 'POST', data: { name: 'Account acceptance vocal profile' }
        });
        const vocal = await jsonRequest(admin, `/mygrain/api/vocal-takes/takes?userId=${vocalProfile.user.id}&folderId=&name=Acceptance%20take&bpm=120`, {
            method: 'POST', headers: { 'Content-Type': 'audio/wav' }, data: audio
        });
        const audition = await adminPage.evaluate(async take => {
            await mygrainVocalTakes.audition(take);
            const playing = Boolean(mygrainVocalTakes.preview && !mygrainVocalTakes.preview.paused);
            mygrainVocalTakes.stopPreview();
            return playing;
        }, vocal.take);
        checked('saved vocal-take audition works with authenticated media', audition);
        const privateVocal = await dan.request.get(`${origin}/mygrain/api/vocal-takes/takes/${vocal.take.id}/audio`, { headers: { 'X-Mygrain-User': 'dan' } });
        checked('dan cannot audition an admin vocal take', privateVocal.status() === 404);
        if (fixtureRoot) {
            await adminPage.evaluate(() => { closeWavRepositoryBrowser(); openDropboxSampleBrowser(SAMPLE_BROWSER_TARGETS.grainMain); });
            const previewButton = adminPage.locator('[data-mygrain-preview="account-source-private.wav"]');
            await previewButton.click();
            await adminPage.waitForFunction(() => {
                const audio = document.querySelector('#dropboxSampleBrowserList audio');
                return audio?.src.startsWith('blob:') && !audio.paused;
            });
            checked('sample-browser Preview button plays authenticated source media');
            await adminPage.evaluate(() => closeDropboxSampleBrowser());
            checked('closing the sample browser releases authenticated preview media', await adminPage.evaluate(() => [...document.querySelectorAll('#dropboxSampleBrowserList audio')].every(audio => !audio.getAttribute('src'))));
            const privateSource = await dan.request.get(`${origin}/mygrain-bastardloops/api/source-sample?source=sampledrop&path=account-source-private.wav`, { headers: { 'X-Mygrain-User': 'dan' } });
            checked('dan cannot fetch an admin source mirror sample', !privateSource.ok());
            const privateSources = await dan.request.get(`${origin}/mygrain-bastardloops/api/source-files?source=sampledrop`, { headers: { 'X-Mygrain-User': 'dan' } });
            checked('primed source-list caches do not leak admin filenames to dan', !(await privateSources.text()).includes('account-source-private.wav'));
            await openRepository(adminPage);
        }
        const adminCard = adminPage.locator('#wavRepositoryBrowserList .sample-browser-card').filter({ hasText: filename });
        checked('WAV browser visibly credits its creator', /Created by\s*:?\s*admin/i.test(await adminCard.textContent()));
        await adminCard.getByRole('button', { name: /share/i }).click();
        await adminPage.locator('#mygrainShareRecipient').selectOption({ label: 'dan' });
        await adminPage.locator('#mygrainShareSubmit').click();
        await adminPage.waitForFunction(() => /shared|copied/i.test(document.querySelector('#mygrainShareStatus')?.textContent || ''));
        const shares = await jsonRequest(admin, '/mygrain-wavs/api/shares');
        const share = shares.shares.find(item => item.filename === filename && item.recipient === 'dan');
        checked('Share button creates an explicit outgoing copy', Boolean(share));
        checked('share metadata distinguishes original creator from sharer', share.createdBy === 'admin' && share.sharedBy === 'admin');
        const received = await dan.request.get(`${origin}/mygrain-wavs/${encodeURIComponent(share.recipientFilename)}`);
        checked('recipient copy has byte-identical audio', received.ok() && crypto.createHash('sha256').update(await received.body()).digest('hex') === crypto.createHash('sha256').update(audio).digest('hex'));

        await openRepository(danPage);
        const receivedCard = danPage.locator('#wavRepositoryBrowserList .sample-browser-card').filter({ hasText: share.recipientFilename });
        checked('recipient WAV browser credits creator and sharer', /Created by\s*:?\s*admin/i.test(await receivedCard.textContent()) && /Shared by\s*:?\s*admin/i.test(await receivedCard.textContent()));
        const note = 'Recipient-only feedback on the explicitly shared copy.';
        await receivedCard.locator('textarea').fill(note);
        await receivedCard.getByRole('button', { name: /save.*note|save.*comment/i }).click();
        await danPage.waitForFunction(() => [...document.querySelectorAll('#wavRepositoryBrowserList textarea')].some(textarea => textarea.value.includes('Recipient-only feedback') && /Saved to repo/.test(textarea.closest('.sample-browser-card').textContent)));
        const updatedShares = await jsonRequest(admin, '/mygrain-wavs/api/shares');
        checked('sharer can read recipient comments through share metadata', JSON.stringify(updatedShares.shares).includes(note));
        checked('recipient comment metadata credits the authenticated author', updatedShares.shares.find(item => item.id === share.id)?.commentsBy === 'dan');
        checked('recipient WAV notes visibly credit their author', /(?:Notes|Comment)(?:s)? by\s*:?\s*dan/i.test(await receivedCard.textContent()));
        await adminPage.locator('#mygrainShareRefresh').click();
        await adminPage.waitForFunction(expected => document.querySelector('#mygrainShareThread')?.textContent.includes(expected), note);
        checked('recipient comments are visible in the sender share dialog');
        checked('sender share dialog visibly credits the comment author', /(?:Notes|Comment)(?:s)? by\s*:?\s*dan/i.test(await adminPage.locator('#mygrainShareThread').textContent()));
        await adminPage.screenshot({ path: evidence.replace(/\.json$/, '-sharing.png'), fullPage: false });
        await adminPage.locator('#mygrainShareClose').click();
        await adminPage.screenshot({ path: evidence.replace(/\.json$/, '-portrait.png'), fullPage: false });
        await danPage.screenshot({ path: evidence.replace(/\.json$/, '-landscape.png'), fullPage: false });

        const stranger = await context({ width: 390, height: 844 });
        const strangerPage = await stranger.newPage();
        await login(strangerPage, 'acceptance-new-user', 'test-only-long-passphrase', true);
        const strangerShares = await jsonRequest(stranger, '/mygrain-wavs/api/shares');
        checked('unrelated users cannot see share comments', !JSON.stringify(strangerShares).includes(note));
        const strangerWav = await stranger.request.get(`${origin}/mygrain-wavs/${encodeURIComponent(share.recipientFilename)}`);
        checked('unrelated users cannot download a shared recipient copy', strangerWav.status() === 404);
        for (const path of ['/mygrain/backups/anything/index.html', '/mygrain/ops-backup/anything/server.py',
            '/mygrain/backend/mygrain_accounts.py', '/mygrain/tests/test_mygrain_accounts.py']) {
            const response = await stranger.request.get(`${origin}${path}`);
            checked(`private source/backups blocked: ${path}`, [403, 404].includes(response.status()));
        }

        const reshared = await jsonRequest(dan, '/mygrain-wavs/api/share', {
            method: 'POST', data: { filename: share.recipientFilename, username: 'acceptance-new-user', createdBy: 'dan', sharedBy: 'admin' }
        });
        const thirdFiles = await jsonRequest(stranger, '/mygrain-wavs/api/list');
        const thirdCopy = thirdFiles.files.find(file => file.name === reshared.share.recipientFilename);
        checked('re-sharing preserves the original creator and credits the immediate sharer despite spoofed fields', thirdCopy?.createdBy === 'admin' && thirdCopy?.sharedBy === 'dan');
        await openRepository(strangerPage);
        const thirdCard = strangerPage.locator('#wavRepositoryBrowserList .sample-browser-card').filter({ hasText: thirdCopy.name });
        checked('re-shared WAV browser visibly distinguishes creator and sharer', /Created by\s*:?\s*admin/i.test(await thirdCard.textContent()) && /Shared by\s*:?\s*dan/i.test(await thirdCard.textContent()));
        checked('re-sharing does not misattribute the previous recipient comment to the new recipient', !/Notes by\s*:?\s*acceptance-new-user[^]*Recipient-only feedback/i.test(await thirdCard.textContent()));

        await jsonRequest(admin, '/mygrain/api/auth/logout', { method: 'POST', data: {} });
        await adminPage.goto(base, { waitUntil: 'load' });
        await login(adminPage, 'dan', 'charged');
        const danStorage = await exerciseBrowserStorage(adminPage, 'dan-private-marker');
        checked('switching to dan hides admin localStorage', danStorage.before === null);
        checked('switching to dan hides admin sessionStorage', danStorage.sessionBefore === null);
        checked('switching to dan hides admin IndexedDB', danStorage.stored === null);
        await jsonRequest(admin, '/mygrain/api/auth/logout', { method: 'POST', data: {} });
        await adminPage.goto(base, { waitUntil: 'load' });
        await login(adminPage, 'admin', 'snowpeas');
        const restored = await exerciseBrowserStorage(adminPage, 'admin-private-marker');
        checked('admin localStorage survives account switching', restored.before === 'admin-private-marker');
        checked('admin IndexedDB survives account switching', restored.stored === 'admin-private-marker');
        if (await adminPage.locator('#start-btn').isVisible()) {
            await adminPage.locator('#start-btn').click();
            await adminPage.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
        }
        await adminPage.locator('#mygrainLogoutBtn').scrollIntoViewIfNeeded();
        const stalePage = await admin.newPage();
        await stalePage.goto(base, { waitUntil: 'load' });
        await Promise.all([
            adminPage.waitForEvent('load'),
            adminPage.locator('#mygrainLogoutBtn').click()
        ]);
        await stalePage.waitForFunction(() => !window.mygrainAccounts?.authenticated);
        checked('logging out locks another open tab');
        const loggedOut = await admin.request.get(`${origin}/mygrain-wavs/api/list`, { headers: { 'X-Mygrain-User': 'admin' } });
        checked('logout revokes access server-side', loggedOut.status() === 401);
        await login(adminPage, 'dan', 'charged');
        const staleFetch = await stalePage.evaluate(async () => {
            try { await fetch('/mygrain-wavs/api/list'); return true; } catch { return false; }
        });
        checked('a stale admin tab cannot fetch using the new dan session', !staleFetch);
        await jsonRequest(admin, '/mygrain/api/auth/logout', { method: 'POST', data: {} });
        await login(adminPage, 'admin', 'snowpeas');
        const rawPasswords = await adminPage.evaluate(() => Object.keys(localStorage).some(key => /snowpeas|charged/.test(localStorage.getItem(key) || '')));
        checked('browser convenience storage contains no plaintext seed password', !rawPasswords);
        checked('no uncaught browser exceptions', results.errors.length === 0);
        results.pass = true;
    } catch (error) {
        results.pass = false;
        results.failure = error.stack;
        process.exitCode = 1;
    } finally {
        await browser.close();
        fs.writeFileSync(evidence, JSON.stringify(results, null, 2));
        console.log(JSON.stringify(results, null, 2));
    }
})();
