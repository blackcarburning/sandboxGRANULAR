const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright-core');
const base = 'http://127.0.0.1:18926/mygrain/';
(async()=>{for(const [name,engine] of Object.entries({chromium,webkit})){
 const browser=await engine.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{
 const context=await browser.newContext({viewport:{width:1280,height:1000},hasTouch:true});
 assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vdrag'}})).status(),200);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');
 await page.click('#start-btn');await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
 await page.evaluate(async()=>{
 stopAllPerformancePlayback({silent:true});applyGlobalBpm(120);
 const b=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate);for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=.2*Math.sin(i*.03);
 await applyLoadedBastardLoopVBuffer(b,'drag-test.wav',{bpm:120,durationSeconds:2,patternSteps:16});window.dragOriginal=bastardLoopVBuffer;
 setBastardLoopVCut({enabled:true,start:.25,end:.5,snap:true,grid:1/16,repeat:true});saveState();bastardLoopVCutEditor.open();
 });
 const get=()=>page.evaluate(()=>[bastardLoopVCut.start,bastardLoopVCut.end]);
 async function drag(delta){const area=await page.locator('#bastardLoopVCutTimeline').boundingBox();const box=await page.locator('#bastardLoopVCutDragSection').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+delta*area.width,box.y+box.height/2,{steps:5});await page.mouse.up();}
 await drag(.125);assert.deepEqual(await get(),[.375,.625]);
 await page.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual(await get(),[.25,.5]);
 await page.evaluate(()=>mygrainCardHistory.redo());assert.deepEqual(await get(),[.375,.625]);
 await page.click('#bastardLoopVCutAuditionMetro');await page.waitForFunction(()=>bastardLoopVSource&&bastardLoopVCutPreview);await page.evaluate(()=>{window.dragSource=bastardLoopVSource;window.dragOrigin=bastardLoopVCutPreview.origin;});
 await drag(1);assert.equal(await page.evaluate(()=>bastardLoopVSource!==dragSource&&bastardLoopVCutPreview.origin===dragOrigin),true);assert.deepEqual(await get(),[.75,1]);await drag(-2);assert.deepEqual(await get(),[0,.25]);await page.click('#bastardLoopVCutStop');
 await page.locator('#bastardLoopVCutDragSection').focus();await page.keyboard.press('ArrowRight');assert.deepEqual(await get(),[1/16,5/16]);
 await page.click('#bastardLoopVCutStretch');assert.equal(await page.locator('#bastardLoopVCutDragSection').isVisible(),false);
 const before=await get();const area=await page.locator('#bastardLoopVCutTimeline').boundingBox();await page.mouse.move(area.x+area.width*3/16,area.y+area.height/2);await page.mouse.down();await page.mouse.move(area.x+area.width*5/16,area.y+area.height/2);await page.mouse.up();assert.deepEqual(await get(),before);
 await page.click('#bastardLoopVCutStretch');assert.equal(await page.locator('#bastardLoopVCutDragSection').isVisible(),true);
 await page.evaluate(()=>setBastardLoopVCut({...bastardLoopVCut,snap:false}));await drag(.037);let state=await get();assert.ok(Math.abs(state[0]-(1/16+.037))<.004);assert.ok(Math.abs(state[1]-state[0]-.25)<1e-9);
 const persistence=await page.evaluate(()=>{const preset=gatherPreset(),state=saveState({force:true,snapshotOnly:true});return {preset:preset.bastardLoopVCut,state:state.modes.bastardLoopVCut,original:bastardLoopVBuffer===dragOriginal};});assert.equal(persistence.original,true);assert.deepEqual([persistence.preset.start,persistence.preset.end],state);assert.deepEqual([persistence.state.start,persistence.state.end],state);
 await page.setViewportSize({width:390,height:844});await page.locator('#bastardLoopVCutDragSection').scrollIntoViewIfNeeded();
 // Pointer events cover the touch path on both engines; Chromium also exercises native touch below.
 if(name==='chromium'){const cdp=await context.newCDPSession(page);const box=await page.locator('#bastardLoopVCutDragSection').boundingBox(),area=await page.locator('#bastardLoopVCutTimeline').boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+area.width*.125,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});const after=await get();assert.ok(Math.abs(after[0]-state[0]-.125)<.005);state=after;await cdp.detach();}
 await page.click('#bastardLoopVCutClose');await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await page.click('#start-btn');await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);const recalled=await get();assert.ok(Math.abs(recalled[0]-state[0])<1e-8);assert.deepEqual(errors,[]);
 console.log('PASS',name,'source section drag, snap/free movement, both boundaries, one-step Undo/Redo, keyboard, stretch preserved, unchanged source, export/state/reload, touch/mobile');
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
