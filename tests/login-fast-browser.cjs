// Real login writes only to the disposable loopback account store.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_LOGIN_TEST_URL || 'http://127.0.0.1:18962/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async () => {
 for (const [engine, type] of Object.entries({webkit, chromium})) {
  const browser = await type.launch(engine === 'chromium' ? {executablePath:'/snap/bin/chromium', args:['--no-sandbox']} : {});
  try {
   for (const viewport of [{width:390,height:844}, {width:844,height:390}, {width:320,height:640}]) {
    const context = await browser.newContext({viewport, isMobile:true, hasTouch:true});
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => requests.push(r.url()));
    const response = await page.goto(base + '?account=login');
    const html = await response.body();
    assert(html.length < 12000);
    assert.equal(response.headers()['cache-control'], 'no-store');
    await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
    assert(await page.locator('#mygrainLoginForm').isVisible());
    assert.equal(await page.evaluate(() => window.mygrainAccounts.authenticated), false);
    assert(!requests.some(u => /account-context|drum-roll|song-beta|daw-export/.test(u)));
    assert((await page.locator('#mygrain-load-notes .mygrain-load-notes__latest > li').count()) > 0);
    const box = await page.locator('.mygrain-account-panel').boundingBox();
    assert(box.x >= 0 && box.x + box.width <= viewport.width);
    if (viewport.width === 390) {
     // The existing form still performs the real server authentication and reload.
     await page.locator('#mygrainLoginUsername').fill('admin');
     await page.locator('#mygrainLoginPassword').fill('isolated-login-fast');
     await page.locator('#mygrainLoginBtn').tap();
     await page.waitForFunction(() => window.mygrainAccounts?.authenticated && document.documentElement.dataset.mygrainStartup === 'ready');
     assert.equal(await page.evaluate(() => mygrainAccounts.user.username), 'admin');
     const editor = await context.request.get(base);
     assert.deepEqual(await editor.body(), fs.readFileSync('index.html'));
     await page.locator('#start-btn').tap();
     await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
     await page.evaluate(() => openDrumMachineOverlay());
     assert.equal(await page.locator('[data-drum-copy-section]').count(), 8);
    }
    assert.deepEqual(errors, []);
    console.log('PASS', engine, viewport, 'guest, login layout, no editor download/errors', viewport.width === 390 ? '+ real login/full editor/audio/drum controls' : '');
    await context.close();
   }
   for (const fail of [false, true]) {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page = await context.newPage();
    await page.route('**/mygrain-accounts.css*', async r => {
     await new Promise(resolve => setTimeout(resolve, 400));
     fail ? await r.abort() : await r.continue();
    });
    await page.goto(base + '?account=login');
    await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
    if (fail) {
     assert.match(await page.locator('[role=alert]').innerText(), /Account styling could not load/);
     assert(await page.getByRole('button', {name:'Reload MYGRAIN'}).isVisible());
    } else assert(await page.locator('#mygrainLoginForm').isVisible());
    console.log('PASS', engine, fail ? 'failed CSS gives usable retry' : 'delayed CSS readiness');
    await context.close();
   }
  } finally { await browser.close(); }
 }
})().catch(e => {console.error(e); process.exitCode = 1;});
