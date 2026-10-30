'use strict';
// Disposable localhost account only. Exercise the real preview, not a mock source.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18934/mygrain/';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async () => {
 const results = [];
 for (const [engine, type] of Object.entries({ chromium, webkit })) {
  const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] } : {});
  try {
   const context = await browser.newContext({ viewport: { width:390, height:844 }, isMobile:true, hasTouch:true,
    userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
   const login = await context.request.post(base+'api/auth/login', {data:{username:'admin',password:process.env.MYGRAIN_TEST_ADMIN_PASSWORD||'loop-preview-fixture'}});
   assert.equal(login.status(),200);
   const page = await context.newPage(), errors=[], requests=[];
   page.on('pageerror', e=>errors.push(e.message));
   page.on('request', r=>{if(r.url().includes('/api/wav-preview')) requests.push(r.url())});
   await page.goto(base);
   await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');
   await page.locator('#start-btn').tap();
   await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
   await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});openWavRepositoryBrowser()});
   const player=page.locator('.wav-iphone-preview').first(); await player.waitFor();
   await player.locator('button').tap();
   await page.waitForFunction(()=>document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview.playing);
   await page.evaluate(()=>{
    const api=document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview;
    const analyser=audioContext.createAnalyser(); api.source.connect(analyser);
    const zero=audioContext.createGain(); zero.gain.value=0; analyser.connect(zero); zero.connect(audioContext.destination);
    window.previewIdleAudit={start:performance.now(),samples:[],duration:api.buffer.duration};
    window.previewIdleTimer=setInterval(()=>{const pcm=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pcm);
     previewIdleAudit.samples.push({wall:(performance.now()-previewIdleAudit.start)/1000,audio:audioContext.currentTime,
      position:Number(document.querySelector('.wav-iphone-preview input').value),peak:Math.max(...pcm.map(Math.abs)),state:audioContext.state,...backgroundAudioController.diagnostics});
    },250);
    window.finishPreviewIdleAudit=()=>{clearInterval(previewIdleTimer);analyser.disconnect();zero.disconnect();return previewIdleAudit};
   });
   // No gesture or polling evaluation that could wake idle audio during the run.
   await page.waitForTimeout(12500);
   const audit=await page.evaluate(()=>finishPreviewIdleAudit());
   const first=audit.samples[0],last=audit.samples.at(-1);
   const result={engine,duration:audit.duration,wall:last.wall-first.wall,audio:last.audio-first.audio,
    suspended:audit.samples.filter(s=>s.state!=='running'),last,requests:requests.length,errors};
   results.push(result); console.log(JSON.stringify(result));
   if(process.env.MYGRAIN_PREVIEW_EVIDENCE)fs.writeFileSync(process.env.MYGRAIN_PREVIEW_EVIDENCE,JSON.stringify(results,null,2));
   if(!process.env.MYGRAIN_EXPECT_IDLE_BUG){
    assert.equal(result.suspended.length,0,'WAV audition must protect its shared context from idle sleep');
    assert(result.audio>result.wall*.9,'Audio must advance continuously past eight seconds');
    assert(audit.samples.filter(s=>s.wall>8).every(s=>s.peak>.001),'PCM must remain audible past eight seconds');
    assert.equal(requests.length,1,'No streaming refill or replay download is needed');
    await player.locator('button').tap();
    assert.equal(await page.evaluate(()=>document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview.playing),false);
    await page.waitForTimeout(9500);
    assert.equal(await page.evaluate(()=>backgroundAudioController.idleSuspended),true,'Actual idle sleep still works after pausing');
    await player.locator('button').tap();
    await page.waitForFunction(()=>audioContext.state==='running'&&document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview.playing);
    assert.equal(requests.length,1,'Resume reuses decoded audio');
    await page.evaluate(()=>closeWavRepositoryBrowser());
    assert.deepEqual(errors,[]);
   }
   await context.close();
  } finally {await browser.close()}
 }
})().catch(error=>{console.error(error);process.exitCode=1});
