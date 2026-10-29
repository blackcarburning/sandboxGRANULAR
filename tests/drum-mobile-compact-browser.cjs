// Disposable localhost accounts only.
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18961/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async()=>{for(const[engine,type]of Object.entries({webkit,chromium})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});
 try{for(const viewport of [{width:390,height:844},{width:844,height:390},{width:320,height:640}]){
 const context=await browser.newContext({viewport,isMobile:true,hasTouch:true});
 assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-drum-mobile'}})).status(),200);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 const ready=async()=>{await page.waitForFunction(()=>window.mygrainDrumPatterns&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);};
 await page.goto(base);await ready();await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});restoreDrumMachineLaneSolos([]);openDrumMachineOverlay();});
 assert.equal(await page.locator('#drumMachineOverlay .drum-machine-copy p').count(),0);assert.equal(await page.locator('[data-drum-solo]').count(),0);
 const metrics=await page.evaluate(()=>{const l=document.querySelector('#drumMachineOverlay .drum-machine-layout');const b=[...document.querySelectorAll('#drumMachineOverlay .drum-machine-toolbar button')];return{top:l.getBoundingClientRect().top,height:l.clientHeight,overflow:document.documentElement.scrollWidth>innerWidth,buttons:b.map(e=>({id:e.id,y:e.getBoundingClientRect().y}))};});
 assert(!metrics.overflow);assert(metrics.height>(viewport.height>500?viewport.height*.58:viewport.height*.48));assert.equal(metrics.buttons.length,8);
 const row=metrics.buttons.slice(5);assert.deepEqual(row.map(b=>b.id),['drumMachineMidiExportBtn','drumMachineSavePatternBtn','drumMachinePatternsBtn']);assert(row.every(b=>Math.abs(b.y-row[0].y)<1));
 const double=async k=>{const b=page.locator(`[data-drum-jump="${k}"]`);await b.tap();await b.tap();};
 for(const k of ['kick','snare','hat','perc','clap','cymbals','etc','roll']){
 const b=page.locator(`[data-drum-jump="${k}"]`);await b.tap();assert.equal(await b.getAttribute('aria-pressed'),'false');await page.waitForTimeout(400);
 await double(k);assert.equal(await b.getAttribute('aria-pressed'),'true');assert.deepEqual(await page.evaluate(()=>['kick','snare','hat','perc','clap','cymbals','etc','roll'].filter(isDrumMachineLaneAudible)),[k]);await double(k);assert.equal(await b.getAttribute('aria-pressed'),'false');}
 await double('snare');await double('roll');assert.deepEqual(await page.evaluate(()=>drumMachineLaneSolos),['snare','roll']);
 await page.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual(await page.evaluate(()=>drumMachineLaneSolos),['snare']);await page.evaluate(()=>mygrainCardHistory.redo());assert.deepEqual(await page.evaluate(()=>drumMachineLaneSolos),['snare','roll']);
 await page.reload();await ready();assert.deepEqual(await page.evaluate(()=>drumMachineLaneSolos),['snare','roll']);await page.evaluate(()=>openDrumMachineOverlay());
 for(const id of ['drumMachineSavePatternBtn','drumMachinePatternsBtn']){await page.locator('#'+id).tap();await page.locator('#drumPatternLibrary').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('drumPatternLibrary').hasAttribute('aria-busy'));await page.locator('#drumPatternLibrary [data-close]').tap();}
 await page.locator('[data-drum-jump="roll"]').tap();await page.locator('#drumMachineRollLength').fill('128');await page.locator('#drumMachineRollLength').press('Tab');assert.equal(await page.evaluate(()=>drumMachineRoll.length),128);
 await page.screenshot({path:`output/drum-mobile-20261028/after-${engine}-${viewport.width}.png`});assert.deepEqual(errors,[]);console.log(JSON.stringify({engine,viewport,...metrics,result:'PASS'}));await context.close();
 }}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
