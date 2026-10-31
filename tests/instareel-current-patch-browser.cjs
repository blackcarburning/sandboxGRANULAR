'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:18936/mygrain/';
(async()=>{for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'instareel-fixture'}})).status(),200);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainInstareel);await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});const b=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate);const d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=.1*Math.sin(2*Math.PI*220*i/b.sampleRate);bastardLoopVBuffer=b;bastardLoopVEnabled=true;bastardLoopVSourceBpm=120;applyGlobalBpm(120);syncPatternLengthControls(16,{skipSave:true});syncBastardLoopVUi();syncPerformanceControlState()});
  // Inspect the real portable ZIP; stop only at submission, without creating a render job.
  await page.evaluate(()=>{window.reelSubmissions=[];const original=window.fetch.bind(window);window.fetch=async(input,options={})=>{if(new URL(input,document.baseURI).pathname==='/mygrain/api/instareel'&&options.method==='POST'){const zip=await options.body.arrayBuffer();reelSubmissions.push({protectedLayers:new URL(input,document.baseURI).searchParams.get('protectedLayers'),snapshot:mygrainSongBetaAdapter.inspectPart(zip).snapshot});return new Response(JSON.stringify({error:'Snapshot test completed'}),{status:400,headers:{'Content-Type':'application/json'}})}return original(input,options)}});
  await page.locator('#sectionJumpHandle').tap();await page.locator('.section-jump-option[data-jump-target="#genreatorCard"]').tap();
  const button=page.locator('#instareelNewCurrent');assert.equal(await button.textContent(),'New reel with current patch');
  await page.locator('#instareelSeconds').fill('30');await page.locator('.instareel-protection summary').tap();await page.locator('[data-reel-protected=V]').check();await page.locator('[data-reel-protected=L]').check();
  for(const [index,bpm,action] of [[0,120,'#instareelMake'],[1,132,'#instareelNewCurrent']]){
   await page.evaluate(value=>applyGlobalBpm(value),bpm);await page.waitForFunction(()=>!mygrainCardHistory.busy);
   const before=await page.evaluate(()=>JSON.stringify(saveState({force:true,snapshotOnly:true}),(k,v)=>k==='timestamp'?undefined:v));
   await page.locator(action).tap();await page.waitForFunction(()=>!mygrainInstareel.busy&&document.getElementById('instareelStatus').textContent.includes('Snapshot test completed'));
   const captures=await page.evaluate(()=>reelSubmissions);assert.equal(captures.length,index+1);
   assert.equal(captures[index].protectedLayers,'V,L');const info=captures[index].snapshot;
   assert.equal(Number(info.state.globalBpm),bpm,'Submission must contain the currently loaded patch, not the preceding snapshot');
   assert.equal(await page.evaluate(()=>JSON.stringify(saveState({force:true,snapshotOnly:true}),(k,v)=>k==='timestamp'?undefined:v)),before);
  }
  for(const viewport of [{width:390,height:844},{width:844,height:390}]){
   await page.setViewportSize(viewport);await page.locator('#sectionJumpHandle').tap();await page.locator('.section-jump-option[data-jump-target="#genreatorCard"]').tap();await button.scrollIntoViewIfNeeded();
   const protectedBox=await page.locator('.instareel-protection').boundingBox();assert(protectedBox.x>=0&&protectedBox.x+protectedBox.width<=viewport.width+1);const make=await page.locator('#instareelMake').boundingBox(),fresh=await button.boundingBox();assert(fresh.y>=make.y+make.height,'New button must be below Try Another / Make Reel');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  assert.deepEqual(errors,[]);console.log('PASS',engine,'fresh current-patch ZIP at 132 BPM after 120 BPM, untouched patch, portrait/landscape button');
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
