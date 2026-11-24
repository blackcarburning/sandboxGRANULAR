'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:19031/mygrain/';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
const out = process.env.MYGRAIN_TEST_OUTPUT;
(async () => {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch(engine === 'chromium' ? {
      executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
    } : {});
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      assert.equal((await context.request.post(base + 'api/auth/login', {
        data: { username: 'admin', password: 'isolated-public-samples' }
      })).status(), 200);
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.setDefaultTimeout(60000);
      await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
      async function ready() {
        await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready' && window.mygrainCardHistory);
        await page.evaluate(() => mygrainCardHistory.ready);
        await page.locator('#start-btn').tap();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
      }
      await page.goto(base); await ready();
      assert.equal(await page.locator('#performanceDropboxSampleSource').inputValue(), 'samples_public');
      await page.evaluate(() => {
        const button = document.getElementById('performanceDropboxSampleBrowseBtn');
        mygrainDisplay.reveal(button); button.scrollIntoView();
      });
      await page.locator('#performanceDropboxSampleBrowseBtn').tap();
      await page.waitForFunction(() => drumSampleGridBrowser && !drumSampleGridBrowser.loading && drumSampleGridBrowser.files.length === 3);
      assert.equal(await page.locator('.sample-grid-source').inputValue(), 'samples_public');
      await page.locator('[data-sample-index="0"]').tap();
      await page.waitForFunction(() => drumSampleGridBrowser.playingKey);
      await page.locator('[data-grid-action="load"]').tap();
      await page.locator('[data-grid-action="confirm-add"]').tap();
      await page.waitForFunction(() => dropboxSampleLayerMetadata?.sourceKey === 'samples_public' && !drumSampleGridBrowser.loading && !mygrainCardHistory.busy);
      await page.locator('[data-grid-action="close"]').tap();
      const identity = await page.evaluate(async () => {
        const original = dropboxSampleLayerRawBuffer, meta = JSON.stringify(dropboxSampleLayerMetadata);
        const select = document.getElementById('performanceDropboxSampleSource');
        await mygrainCardHistory.runDraftEdit('Public source preference', async () => { select.value = 'sampledrop'; select.dispatchEvent(new Event('change')); });
        const same = original === dropboxSampleLayerRawBuffer && meta === JSON.stringify(dropboxSampleLayerMetadata);
        await mygrainCardHistory.undo();
        const undo = select.value;
        await mygrainCardHistory.redo();
        const redo = select.value;
        const preset = gatherPreset();
        select.value = 'samples_public'; applyPreset(preset);
        const presetRecall = select.value;
        select.value = 'samples_public';
        randomizeMegaDropboxSampleLayerSettings();
        const mega = select.value;
        saveState({ force: true }); await mygrainSongBetaAdapter.whenPersisted();
        return { same, undo, redo, presetRecall, mega, channels: original.numberOfChannels };
      });
      assert.deepEqual(identity, { same: true, undo: 'samples_public', redo: 'sampledrop', presetRecall: 'sampledrop', mega: 'samples_public', channels: 2 });
      if (engine === 'chromium') {
        const song = await page.evaluate(async () => {
          stopAllPerformancePlayback({ silent: true }); setFxMuted(true, { silent: true });
          setLoopLayerSolo('dropbox', { silent: true, skipSave: true });
          setDropboxSampleLayerEnabled(true, { silent: true, skipSave: true });
          applyGlobalBpm(240); syncPatternLengthControls(8, { skipSave: true });
          const c = mygrainSongBeta; document.getElementById('songBetaName').value = 'Public sample fixture';
          await c.newSong(); await c.newPart({ name: 'Public source', repeats: 1 });
          const p = c.song.parts[0], bytes = await c.request(`/${c.song.id}/parts/${p.id}`, { binary: true });
          window.publicSampleOriginalZip = Array.from(new Uint8Array(bytes));
          const entries = parseStoredZipEntries(bytes), snapshot = JSON.parse(getZipText(entries, 'song-part.json'));
          snapshot.state.selects.performanceDropboxSampleSource = 'sampledrop';
          const legacy = await createStoredZip([...entries].map(([path, data]) => ({ path, data: path === 'song-part.json' ? JSON.stringify(snapshot) : data })));
          window.publicSamplePreferenceZip = Array.from(new Uint8Array(await legacy.arrayBuffer()));
          await c.finishEditing(); await c.arm();
          if (!c.armed) throw Error(document.getElementById('songBetaStatus').textContent);
          const render = await c.loadRender(c.song.parts[0]);
          let energy = 0; for (const x of render.getChannelData(0)) energy += x*x;
          const hashes = c.song.parts.map(x => x.sha256), renders = c.song.parts.map(x => x.render.sha256);
          await c.arm(); await c.playSong(); const playing = c.playing; c.stop();
          return { energy, playing, hashes, after: c.song.parts.map(x => x.sha256), renders, warm: c.song.parts.map(x => x.render.sha256) };
        });
        assert(song.energy > 1e-5); assert(song.playing); assert.deepEqual(song.hashes, song.after); assert.deepEqual(song.renders, song.warm);
        if (out) for (const [key, name] of [['publicSampleOriginalZip', 'public-source.zip'], ['publicSamplePreferenceZip', 'preference-only.zip']]) {
          fs.writeFileSync(out + '/' + name, Buffer.from(await page.evaluate(key => window[key], key)));
        }
      }
      await page.reload(); await ready();
      assert.equal(await page.locator('#performanceDropboxSampleSource').inputValue(), 'samples_public');
      for (const size of [{ width: 390, height: 844 }, { width: 1365, height: 900 }]) {
        await page.setViewportSize(size);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      }
      assert.deepEqual(errors, []);
      console.log('PASS', engine, JSON.stringify(identity), 'browser preview/load, saved preference, history, reload and layouts');
      await context.close();
    } finally { await browser.close(); }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
