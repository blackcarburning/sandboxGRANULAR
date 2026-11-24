'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.BASE || 'http://127.0.0.1:19419/mygrain/';
const out = process.env.OUT;
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);

(async () => {
  for (const [name, type] of Object.entries(process.env.ONLY_BROWSER
    ? { [process.env.ONLY_BROWSER]: { chromium, webkit }[process.env.ONLY_BROWSER] }
    : { chromium, webkit })) {
    const browser = await type.launch(name === 'chromium' ? {
      executablePath: '/snap/bin/chromium',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
    } : {});
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await context.newPage(), errors = [], results = [];
      page.setDefaultTimeout(45000);
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
      assert((await context.request.post(base + 'api/auth/login', { data: { username: 'admin', password: 'isolated-vst3-test' } })).ok());
      await page.goto(base);
      await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready' && window.mygrainEmber);
      await page.evaluate(() => mygrainCardHistory.ready);
      await page.locator('#start-btn').click();
      await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
      const click = async id => {
        await page.evaluate(id => {
          const element = document.getElementById(id);
          mygrainDisplay.reveal(element);
          element.scrollIntoView({ block: 'center' });
        }, id);
        await page.locator('#' + id).click();
        await page.waitForFunction(() => !mygrainCardHistory.busy);
      };
      await page.evaluate(async () => {
        stopAllPerformancePlayback({ silent: true });
        for (const layer of SPARSE_RANDOM_LAYER_DEFINITIONS) layer.setEnabled(false, { silent: true, skipSave: true });
        clearAllPerformanceSoloStates({ silent: true, skipSave: true });
        await mygrainAcousticFx.off();
        await mygrainCookingPot.restore();
        mygrainEmber.restore();
        setGeneratedLoopTransportEnabled(true, { silent: true, skipSave: true });
        setLoopLayerSolo(['bastarde'], { silent: true, skipSave: true });
        window.__emberStarts = [];
        const start = mygrainEmber.start;
        mygrainEmber.start = function (time) {
          window.__emberStarts.push({ time, now: audioContext.currentTime, origin: getSharedLoopTransportOriginTime(), deadline: transportSync.startTime });
          return start(time);
        };
      });
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        // Off: starting the main loop must not allocate an Ember graph.
        await click('performanceSeqPlayBtn');
        assert(await page.evaluate(() => sequencerPlaying && !mygrainEmber.running && !mygrainEmber.settings().enabled));
        await click('performanceSeqPlayBtn');
        // On alone is armed, not playing; actual main Loop Play must trigger it.
        await click('emberPower');
        assert(await page.evaluate(() => mygrainEmber.settings().enabled && !mygrainEmber.running));
        await page.evaluate(() => { window.__emberStarts.length = 0; });
        await click('performanceSeqPlayBtn');
        assert(await page.evaluate(() => sequencerPlaying && mygrainEmber.running), 'Enabled Ember did not start from main Loop Play');
        const timing = await page.evaluate(() => window.__emberStarts);
        assert.equal(timing.length, 1);
        assert.equal(timing[0].time, timing[0].deadline);
        assert.equal(timing[0].time, timing[0].origin);
        assert(timing[0].time > timing[0].now);
        // Capture actual downstream stereo PCM, not just a graph-running flag.
        const audio = await page.evaluate(async () => {
          const split = audioContext.createChannelSplitter(2), analysers = [0, 1].map(() => audioContext.createAnalyser());
          finalAmplifierNode.connect(split);
          analysers.forEach((analyser, i) => { analyser.fftSize = 4096; split.connect(analyser, i); });
          await new Promise(resolve => setTimeout(resolve, Math.max(0, transportSync.startTime - audioContext.currentTime) * 1000 + 550));
          const rms = analysers.map(analyser => {
            const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
            return Math.sqrt(data.reduce((sum, value) => { if (!Number.isFinite(value)) throw Error('Non-finite PCM'); return sum + value * value; }, 0) / data.length);
          });
          finalAmplifierNode.disconnect(split); split.disconnect(); analysers.forEach(analyser => analyser.disconnect());
          return rms;
        });
        assert(audio.every(value => value > .00001), JSON.stringify({ name, width, audio }));
        await click('performanceSeqPlayBtn');
        assert(await page.evaluate(() => !sequencerPlaying && !mygrainEmber.running && mygrainEmber.settings().enabled));
        // Turn On while the loop runs; Off must dispose only Ember, not the loop.
        await click('emberPower');
        await click('performanceSeqPlayBtn');
        await click('emberPower');
        assert(await page.evaluate(() => sequencerPlaying && mygrainEmber.running));
        await click('emberPower');
        assert(await page.evaluate(() => sequencerPlaying && !mygrainEmber.running));
        await click('performanceSeqPlayBtn');
        // The existing Bastardloop start must also be reachable without samples.
        await click('emberPower');
        assert.equal(await page.locator('#performanceBastardLoopPlayBtn').isEnabled(), true, 'Ember-only shared Start is disabled');
        await click('performanceBastardLoopPlayBtn');
        await page.waitForFunction(() => bastardLoopPlaying && mygrainEmber.running);
        await page.evaluate(() => { window.__emberExistingGraph = mygrainEmber.graph; window.__emberStarts.length = 0; });
        await click('performanceSeqPlayBtn');
        assert(await page.evaluate(() => sequencerPlaying && mygrainEmber.graph === window.__emberExistingGraph && window.__emberStarts.length === 0), 'Loop Play restarted an already playing Ember');
        await click('performanceSeqPlayBtn');
        assert(await page.evaluate(() => bastardLoopPlaying && mygrainEmber.graph === window.__emberExistingGraph), 'Stopping only the sequencer killed independently playing Ember');
        await click('performanceBastardLoopStopBtn');
        assert(await page.evaluate(() => !bastardLoopPlaying && !mygrainEmber.running));
        await click('emberPower');
        results.push({ width, timing, stereoRms: audio });
        console.log(name, width, 'actual main/shared controls and stereo PCM passed');
      }
      // Legacy sequencer entry points share the start/reset implementation.
      await click('emberPower');
      assert(await page.evaluate(() => { startSequencer(); return sequencerPlaying && mygrainEmber.running; }));
      assert(await page.evaluate(() => { resetSequencer(); return !sequencerPlaying && !mygrainEmber.running; }));
      // Disabling the loop must not trigger E or override its saved power.
      await click('performanceLoopDisableBtn');
      assert.equal(await page.locator('#performanceSeqPlayBtn').isEnabled(), false);
      assert(await page.evaluate(() => !startSequencer() && !mygrainEmber.running && mygrainEmber.settings().enabled));
      await click('performanceLoopDisableBtn');
      await click('performanceSeqPlayBtn');
      await click('performanceMainStopAllBtn');
      assert(await page.evaluate(() => !sequencerPlaying && !bastardLoopPlaying && !mygrainEmber.running && mygrainEmber.settings().enabled));
      // Repeat stop/start must not accumulate LFO processors or alter recipes.
      const lifecycle = await page.evaluate(() => {
        const recipe = MygrainEmber.randomPatch(mygrainEmber.settings(), 1919, 'bpm');
        mygrainEmber.set({ ...recipe, enabled: true });
        const before = mygrainEmber.settings(), counts = [];
        for (let i = 0; i < 8; i++) {
          startSequencer(); const graph = mygrainEmber.graph; counts.push(graph.nodeCount);
          stopSequencer(); if (graph.lfoNodeCount !== 0 || mygrainEmber.running) throw Error('Leaked Ember LFO');
        }
        return { before, after: mygrainEmber.settings(), counts };
      });
      assert.deepEqual(lifecycle.before, lifecycle.after);
      assert.equal(new Set(lifecycle.counts).size, 1);
      assert.deepEqual(errors, []);
      if (out) fs.writeFileSync(out + '/' + name + '-ember-loop-start.json', JSON.stringify({ results, lifecycle, errors }, null, 2));
      console.log('PASS', name, 'main Loop Play/Stop, On/Off, sample-free shared Start, shared deadline/stereo PCM, independent transport, sequencer Reset, global Stop and repeated LFO disposal');
    } finally { await browser.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
