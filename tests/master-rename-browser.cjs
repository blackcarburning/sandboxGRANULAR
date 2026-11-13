'use strict';
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL;
assert.match(base || '', /^http:\/\/127\.0\.0\.1:\d+$/);
(async () => {
 for (const [engine, type] of Object.entries({ chromium, webkit })) {
  const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {});
  try {
   const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, extraHTTPHeaders: { 'X-Mygrain-User': 'admin' } });
   const login = await context.request.post(base + '/mygrain/api/auth/login', { data: { username: 'admin', password: process.env.MYGRAIN_TEST_ADMIN_PASSWORD } });
   assert.equal(login.status(), 200);
   const page = await context.newPage(), errors = [];
   page.on('pageerror', e => errors.push(e.message));
   await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
   await page.goto(base + '/mygrain/');
   await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
   const list = async () => (await (await context.request.get(base + '/mygrain-wavs/api/list')).json()).files;
   const original = 'master-dense-minus6LUFS-' + engine + '.wav';
   const originalBytes = await (await context.request.get(base + '/mygrain-wavs/' + encodeURIComponent(original))).body();
   await page.evaluate(() => { document.getElementById('start-overlay').style.display = 'none'; openWavMastersBrowser('reels'); });
   const row = name => page.locator('#wavRepositoryBrowserList .sample-browser-card').filter({ has: page.locator('.sample-browser-name', { hasText: name }) });
   await row(original).waitFor();
   page.once('dialog', d => d.dismiss());
   await row(original).getByRole('button', { name: 'Rename WAV', exact: true }).click();
   await page.waitForFunction(() => document.getElementById('wavRepositoryBrowserStatus').textContent.includes('cancelled'));
   assert((await list()).some(f => f.name === original));
   let current = original;
   for (const next of ['My-reel-' + engine + '.wav', 'Final-reel-' + engine + '.wav']) {
    page.once('dialog', d => d.accept(next));
    await row(current).getByRole('button', { name: 'Rename WAV', exact: true }).click();
    await row(next).waitFor();
    await row(current).waitFor({ state: 'detached' });
    const files = await list(), file = files.find(f => f.name === next);
    assert.equal(file.displayName, next); assert.equal(file.mastering.kind, 'reels');
    assert(!files.some(f => f.name === current));
    assert.deepEqual(await (await context.request.get(base + '/mygrain-wavs/' + encodeURIComponent(next))).body(), originalBytes);
    current = next;
   }
   await page.route('**/mygrain-wavs/api/rename', r => r.fulfill({ status: 400, json: { ok: false, error: 'Fixture rename failure' } }));
   page.once('dialog', d => d.accept('Should not exist.wav'));
   await row(current).getByRole('button', { name: 'Rename WAV', exact: true }).click();
   await page.waitForFunction(() => document.getElementById('wavRepositoryBrowserStatus').textContent.includes('Fixture rename failure'));
   assert(await row(current).isVisible()); assert(!(await list()).some(f => f.name === 'Should not exist.wav'));
   await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
   await page.evaluate(() => { document.getElementById('start-overlay').style.display = 'none'; openWavMastersBrowser('reels'); });
   await row(current).waitFor();
   assert.deepEqual(errors, []);
   console.log('PASS', engine, 'rename refresh, repeated rename, cancellation, failure, reload persistence, unchanged WAV bytes');
  } finally { await browser.close(); }
 }
})().catch(e => { console.error(e); process.exitCode = 1; });
