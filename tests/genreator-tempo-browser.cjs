'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:18936/mygrain/';
(async()=>{for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{
 const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'instareel-fixture'}})).status(),200);
 const p=await c.newPage(),requests=[],errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/api/ai-patch-direction',async r=>{requests.push(r.request().postDataJSON());await r.fulfill({status:503,json:{ok:false,error:'Test AI unavailable. Patch unchanged.'}})});
 await p.goto(base);await p.waitForFunction(()=>window.mygrainGenreator?.genres.length===15&&window.mygrainAiPatch?.ready&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);assert.equal(await p.locator('#genreatorBpm').inputValue(),'');
 await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!mygrainCardHistory.busy);
 await p.locator('#sectionJumpHandle').tap();await p.locator('.section-jump-option[data-jump-target="#genreatorCard"]').tap();await p.waitForFunction(()=>!document.documentElement.dataset.mygrainJumping);await p.locator('#genreatorCard').scrollIntoViewIfNeeded();
 const bpm=p.locator('#genreatorBpm'),genre=p.locator('[data-genre="house"]'),dialog=p.locator('#genreatorTempoDialog'),choice=v=>p.locator(`[data-tempo-choice="${v}"]`);
 const done=()=>p.waitForFunction(()=>!mygrainGenreator.busy&&!mygrainAiPatch.busy);
 const fingerprint=await p.evaluate(()=>mygrainAiPatchAdapter.fingerprint());
 await genre.tap();await done();assert.equal(requests.at(-1).genreBpm,null);assert(!await dialog.isVisible());
 await bpm.fill('123');await genre.tap();assert(await dialog.isVisible());assert.equal(requests.length,1);await choice('cancel').tap();await done();assert.equal(requests.length,1);assert.equal(await bpm.inputValue(),'123');
 await genre.tap();await choice('yes').tap();await done();assert.equal(requests.at(-1).genreBpm,123);
 await bpm.fill('16');await genre.tap();await choice('suggested').tap();await done();assert.equal(requests.at(-1).genreBpm,null);assert.equal(await bpm.inputValue(),'');
 const count=requests.length;await bpm.fill('16');await genre.tap();await choice('yes').tap();await done();assert.equal(requests.length,count);assert.match(await p.locator('#genreatorStatus').textContent(),/60 to 180/);
 for(const viewport of [{width:390,height:844},{width:844,height:390}]){
  await p.setViewportSize(viewport);await p.locator('#sectionJumpHandle').tap();await p.locator('.section-jump-option[data-jump-target="#genreatorCard"]').tap();await p.waitForFunction(()=>!document.documentElement.dataset.mygrainJumping);await p.locator('#genreatorCard').scrollIntoViewIfNeeded();await bpm.fill('128');await genre.tap();
  const layout=await dialog.evaluate(el=>{const r=el.getBoundingClientRect(),b=el.querySelector('[data-tempo-choice="suggested"]').getBoundingClientRect();return{body:el.parentElement===document.body,visible:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,hit:el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)),count:el.querySelectorAll('button').length}});assert.deepEqual(layout,{body:true,visible:true,hit:true,count:3});await choice('cancel').tap();await done();
 }
 await p.evaluate(()=>{const button=document.getElementById('randomizeBtn');button.addEventListener('click',e=>e.stopImmediatePropagation(),{capture:true,once:true});button.click()});assert.equal(await bpm.inputValue(),'');
 await bpm.fill('130');await p.evaluate(async()=>{const old=setPerformanceMixerVuMetersEnabled;setPerformanceMixerVuMetersEnabled=()=>{throw Error('Stop after tempo reset')};try{await runPatchRandomization()}catch{}finally{setPerformanceMixerVuMetersEnabled=old}});assert.equal(await bpm.inputValue(),'');
 await bpm.fill('134');await p.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));assert.equal(await bpm.inputValue(),'');
 assert.equal(await p.evaluate(()=>mygrainAiPatchAdapter.fingerprint()),fingerprint);assert.deepEqual(errors,[]);console.log('PASS',engine,'Auto startup/Random/reopen; Yes/Cancel/Use suggested; invalid override; body modal hit targets in portrait/landscape; untouched patch');await c.close();
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
