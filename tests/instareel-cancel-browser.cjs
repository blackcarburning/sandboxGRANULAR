'use strict';
const assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18936/mygrain/';assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{const browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();
 await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'instareel-fixture'}});await page.goto(base);await page.waitForFunction(()=>window.mygrainInstareel&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await page.locator('#sectionJumpHandle').tap();await page.locator('.section-jump-option[data-jump-target="#genreatorCard"]').tap();
 await page.locator('#instareelLibrary summary').tap();await page.locator('.instareel-library-row').first().waitFor();await page.locator('.instareel-library-row button').first().tap();
 await page.waitForFunction(()=>mygrainInstareel.player.playing);await page.waitForTimeout(9500);
 assert.equal(await page.evaluate(()=>audioContext.state),'running');assert.equal(await page.evaluate(()=>mygrainInstareel.player.playing),true);
 if(process.env.MYGRAIN_INSTAREEL_EVIDENCE)await page.screenshot({path:process.env.MYGRAIN_INSTAREEL_EVIDENCE+'/portrait-g.png'});
 await page.locator('#instareelPlay').tap();
 await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});window.reelCancelOriginal=JSON.stringify(saveState({force:true,snapshotOnly:true}),(k,v)=>k==='timestamp'?undefined:v)});
 await page.locator('#instareelMake').tap();await page.waitForFunction(()=>mygrainInstareel.job&&['queued','running'].includes(mygrainInstareel.job.state),null,{timeout:30000});
 const id=await page.evaluate(()=>mygrainInstareel.job.id);await page.locator('#instareelCancel').tap();await page.waitForFunction(()=>document.getElementById('instareelStatus').textContent==='Reel cancelled. Current patch unchanged.');assert.equal(await page.evaluate(()=>mygrainInstareel.job.state),'cancelled');
 const status=await context.request.get(base+'api/instareel/'+id,{headers:{'X-Mygrain-User':'admin'}});assert.equal((await status.json()).job.state,'cancelled');
 assert.equal(await page.evaluate(()=>reelCancelOriginal===JSON.stringify(saveState({force:true,snapshotOnly:true}),(k,v)=>k==='timestamp'?undefined:v)),true);
 console.log('PASS saved preview plays beyond idle cutoff; cancellation terminates job; live patch unchanged');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
