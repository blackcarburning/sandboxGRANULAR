const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18933/mygrain/';
assert.match(base, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const output = process.env.MYGRAIN_PREVIEW_EVIDENCE;
const before = process.env.MYGRAIN_PREVIEW_BASELINE_HTML;
(async () => {
  const browser = await chromium.launch({executablePath:'/snap/bin/chromium', args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const results = [];
  try {
    for (const variant of before ? ['before', 'after'] : ['after']) {
      const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
        userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
      const page = await context.newPage();
      page.setDefaultTimeout(60000);
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      if (variant === 'before') await page.route(base, route => route.fulfill({path:before,contentType:'text/html'}));
      await context.request.post(base+'api/auth/login', {data:{username:'admin',password:process.env.MYGRAIN_TEST_ADMIN_PASSWORD||'loop-preview-fixture'}});
      await page.goto(base);
      await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
      await page.locator('#start-btn').tap();
      await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
      await page.evaluate(() => {stopAllPerformancePlayback({silent:true});openWavRepositoryBrowser();});
      const player = page.locator('.wav-iphone-preview').first();
      await player.waitFor();
      await page.locator('#wavRepositoryBrowserFilter').fill('one.wav');
      await page.waitForFunction(() => document.querySelectorAll('#wavRepositoryBrowserList audio').length === 1
        && document.querySelector('#wavRepositoryBrowserList .sample-browser-name').textContent === 'one.wav');
      const client = await context.newCDPSession(page);
      await client.send('Network.enable');
      await client.send('Network.setCacheDisabled',{cacheDisabled:true});
      await client.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:100000,uploadThroughput:1000000,connectionType:'cellular3g'});
      page.on('response', async response => {
        if (response.url().includes('/api/wav-preview')) requests.push({url:new URL(response.url()).pathname,
          status:response.status(), bytes:Number(response.headers()['content-length'])});
      });
      const start = Date.now();
      await player.locator('button').tap();
      await page.waitForFunction(() => document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview.playing);
      const elapsed = Date.now()-start;
      const details = await page.evaluate(() => {
        const api = document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview;
        const data = api.buffer.getChannelData(0);
        let energy = 0; for(let i=0;i<data.length;i++) energy += data[i]*data[i];
        return {duration:api.buffer.duration, rms:Math.sqrt(energy/data.length), buffers:[...document.querySelectorAll('#wavRepositoryBrowserList audio')].filter(a=>a.__mygrainIphonePreview.buffer).length};
      });
      assert.ok(details.rms>0.001,'decoded listening copy must contain audio');
      assert.equal(details.buffers,1);
      assert.deepEqual(errors,[]);
      if(variant==='after') {
        assert.equal(requests.length,1,'no slow original fallback for working previews');
        assert.equal(requests[0].url,'/mygrain/api/wav-preview-fast');
        assert.ok(elapsed<5000,`fast tap-to-play exceeded five seconds: ${elapsed}`);
      }
      const result={variant,tapToPlayMs:elapsed,downloadBytesPerSecond:100000,latencyMs:80,requests,...details};
      results.push(result);console.log(JSON.stringify(result));
      // Replay must not download another copy.
      await player.locator('button').tap();await player.locator('button').tap();
      assert.equal(requests.length,1);
      await page.evaluate(()=>closeWavRepositoryBrowser());
      await context.close();
    }
    if(before) assert.ok(results[0].tapToPlayMs/results[1].tapToPlayMs > 5);
    if(output) fs.writeFileSync(output,JSON.stringify(results,null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
