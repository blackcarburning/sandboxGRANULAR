'use strict';
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18967/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async()=>{
 for(const [engine,type] of Object.entries({chromium,webkit})){
  const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});
  try{
   const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-page-scroll'}})).status(),200);
   const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
   await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   await p.goto(base);await p.waitForFunction(()=>window.mygrainChannelEqUi&&document.documentElement.dataset.mygrainStartup==='ready');
   await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
   // Isolated store intentionally has no private sample mirrors.
   await p.waitForTimeout(1500);
   if(await p.locator('#sampleLoadFailureDialog[open]').count())await p.locator('#sampleLoadFailureDialog button').click();
   async function bounds(selector,viewport){
    const box=await p.locator(selector).boundingBox();assert(box,selector);
    assert(box.x>=23&&box.y>=59,`${engine} ${selector}: ${JSON.stringify(box)}`);
    assert(box.x+box.width<=viewport.width-23&&box.y+box.height<=viewport.height-27,`${selector}: ${JSON.stringify(box)}`);
   }
   async function target(selector){
    const el=p.locator(selector);assert(await el.evaluate(el=>{const r=el.getBoundingClientRect();return r.height>=44&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}),selector+': '+JSON.stringify(await el.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML}})));
   }
   for(const viewport of [{width:320,height:640},{width:390,height:844},{width:430,height:932},{width:844,height:390},{width:390,height:844}]){
    await p.setViewportSize(viewport);await p.evaluate(()=>mygrainChannelEqUi.open('P'));
    await bounds('#channelEqDialog',viewport);
    for(const sel of ['#channelEqReset','#channelEqClose','.ceq-head .channel-eq-switch'])await target(sel);
    const actions=await p.locator('.ceq-head > :not(h2)').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right}}));
    assert(actions[0].right<=actions[1].x&&actions[1].right<=actions[2].x);
    const before=await p.locator('#channelEqEnabled').isChecked();await p.locator('.ceq-head .channel-eq-switch').tap();assert.equal(await p.locator('#channelEqEnabled').isChecked(),!before);
    await p.locator('#channelEqReset').tap();
    await p.locator('#channelEqDialog').evaluate(e=>e.scrollTop=e.scrollHeight);
    await target('#channelEqClose');await p.locator('#channelEqClose').tap();assert(!await p.locator('#channelEqDialog').isVisible());
    for(const [open,overlay,shell,close] of [
     ['openBastardLoopLOverlay()','bastardLoopLOverlay','.lead-sequencer-shell','bastardLoopLCloseBtn'],
     ['openBastardLoopXOverlay()','bastardLoopXOverlay','.lead-sequencer-shell','bastardLoopXCloseBtn'],
     ['mygrainQ.open()','bastardLoopQOverlay','.lead-sequencer-shell','bastardLoopQCloseBtn'],
     ['openDrumMachineOverlay()','drumMachineOverlay','.drum-machine-shell','drumMachineCloseBtn'],
     ['openSynthPopup()','synthPopupOverlay','.synth-popup-shell','oscPopupCloseBtn'],
     ['openDropboxSampleBrowser()','dropboxSampleBrowserOverlay','.sample-browser-shell','dropboxSampleBrowserCloseBtn'],
     ['openWavRepositoryBrowser()','wavRepositoryBrowserOverlay','.sample-browser-shell','wavRepositoryBrowserCloseBtn'],
     ["openBastardLoopSamplesDialog('A')",'bastardLoopSamplesOverlay','.sample-browser-shell','bastardLoopSamplesCloseBtn']]){
      await p.evaluate(code=>(0,eval)(code),open);
      await p.waitForTimeout(250);
      if(await p.locator('#sampleLoadFailureDialog[open]').count()){await bounds('#sampleLoadFailureDialog',viewport);await p.locator('#sampleLoadFailureDialog button').tap();}
      await bounds(`#${overlay} ${shell}`,viewport);await target('#'+close);await p.locator('#'+close).tap();assert(!await p.locator('#'+overlay).isVisible());
    }
    console.log('PASS',engine,viewport);
   }
   assert.deepEqual(errors,[]);await c.close();
  }finally{await browser.close()}
 }
})().catch(e=>{console.error(e);process.exit(1)});
