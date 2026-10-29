const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright-core');
const base = 'http://127.0.0.1:18958/mygrain/';
(async()=>{for(const [name,engine] of Object.entries({chromium,webkit})){
 const browser=await engine.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{
 const context=await browser.newContext({viewport:{width:1280,height:1000},hasTouch:true});
 assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-cut-test'}})).status(),200);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');
 await page.click('#start-btn');await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
 await page.evaluate(async()=>{
 stopAllPerformancePlayback({silent:true});applyGlobalBpm(120);
 const b=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate);for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=.2*Math.sin(i*.03);
 await applyLoadedBastardLoopWBuffer(b,'drag-test.wav',{bpm:120,durationSeconds:2,patternSteps:16});window.dragOriginal=bastardLoopWBuffer;
 setBastardLoopWCut({enabled:true,start:.25,end:.5,snap:true,grid:1/16,repeat:true});saveState();bastardLoopWCutEditor.open();
 });
 const get=()=>page.evaluate(()=>[bastardLoopWCut.start,bastardLoopWCut.end]);
 async function drag(delta){const area=await page.locator('#bastardLoopWCutTimeline').boundingBox();const box=await page.locator('#bastardLoopWCutDragSection').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+delta*area.width,box.y+box.height/2,{steps:5});await page.mouse.up();}
 await drag(.125);assert.deepEqual(await get(),[.375,.625]);
 await page.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual(await get(),[.25,.5]);
 await page.evaluate(()=>mygrainCardHistory.redo());assert.deepEqual(await get(),[.375,.625]);
 await page.click('#bastardLoopWCutAuditionMetro');await page.waitForFunction(()=>bastardLoopWSource&&bastardLoopWCutPreview);await page.evaluate(()=>{window.dragSource=bastardLoopWSource;window.dragOrigin=bastardLoopWCutPreview.origin;});
 await drag(1);assert.equal(await page.evaluate(()=>bastardLoopWSource!==dragSource&&bastardLoopWCutPreview.origin===dragOrigin),true);assert.deepEqual(await get(),[.75,1]);await drag(-2);assert.deepEqual(await get(),[0,.25]);await page.click('#bastardLoopWCutStop');
 await page.locator('#bastardLoopWCutDragSection').focus();await page.keyboard.press('ArrowRight');assert.deepEqual(await get(),[1/16,5/16]);
 await page.click('#bastardLoopWCutStretch');assert.equal(await page.locator('#bastardLoopWCutDragSection').isVisible(),false);
 const before=await get();const area=await page.locator('#bastardLoopWCutTimeline').boundingBox();await page.mouse.move(area.x+area.width*3/16,area.y+area.height/2);await page.mouse.down();await page.mouse.move(area.x+area.width*5/16,area.y+area.height/2);await page.mouse.up();assert.deepEqual(await get(),before);
 await page.click('#bastardLoopWCutStretch');assert.equal(await page.locator('#bastardLoopWCutDragSection').isVisible(),true);
 await page.evaluate(()=>setBastardLoopWCut({...bastardLoopWCut,snap:false}));await drag(.037);let state=await get();assert.ok(Math.abs(state[0]-(1/16+.037))<.004);assert.ok(Math.abs(state[1]-state[0]-.25)<1e-9);
 const persistence=await page.evaluate(()=>{const preset=gatherPreset(),state=saveState({force:true,snapshotOnly:true});return {preset:preset.bastardLoopWCut,state:state.modes.bastardLoopWCut,original:bastardLoopWBuffer===dragOriginal};});assert.equal(persistence.original,true);assert.deepEqual([persistence.preset.start,persistence.preset.end],state);assert.deepEqual([persistence.state.start,persistence.state.end],state);
 await page.setViewportSize({width:390,height:844});await page.locator('#bastardLoopWCutDragSection').scrollIntoViewIfNeeded();
 // Pointer events cover the touch path on both engines; Chromium also exercises native touch below.
 if(name==='chromium'){const cdp=await context.newCDPSession(page);const box=await page.locator('#bastardLoopWCutDragSection').boundingBox(),area=await page.locator('#bastardLoopWCutTimeline').boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+area.width*.125,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});const after=await get();assert.ok(Math.abs(after[0]-state[0]-.125)<.005);state=after;await cdp.detach();}
 await page.click('#bastardLoopWCutClose');await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await page.click('#start-btn');await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);const recalled=await get();assert.ok(Math.abs(recalled[0]-state[0])<1e-8);assert.deepEqual(errors,[]);
 // The same drag must remain a permitted manual draft edit during Song Amend.
 await page.evaluate(async()=>{const c=mygrainSongBeta,song=(await c.request('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'W area drag '+Date.now()})})).song;c.acceptSong(song);await c.ensureEditing();const body=await mygrainSongBetaAdapter.capture();c.acceptSong((await c.request(`/${song.id}/parts?name=Source&repeats=1`,{method:'POST',headers:{'Content-Type':'application/zip'},body})).song);await c.recall(c.song.parts[0],{amend:true,start:false});bastardLoopWCutEditor.open();});
 await page.locator('#bastardLoopWCutDragSection').scrollIntoViewIfNeeded();
 const beforeAmend=await get();await drag(.0625);await page.waitForFunction(()=>!mygrainCardHistory.busy);const stoppedAmend=await get();assert.ok(Math.abs(stoppedAmend[0]-beforeAmend[0]-.0625)<.005);
 await page.evaluate(()=>auditionBastardLoopWCut('metronome'));await page.locator('#bastardLoopWCutDragSection').scrollIntoViewIfNeeded();await drag(.0625);await page.waitForFunction(()=>!mygrainCardHistory.busy);const runningAmend=await get();assert.ok(Math.abs(runningAmend[0]-stoppedAmend[0]-.0625)<.005);await page.evaluate(()=>stopBastardLoopWCutAudition());
 const saved=await page.evaluate(async()=>{const c=mygrainSongBeta,before=c.song.parts[0].sha256;await c.savePart();await c.recall(c.song.parts[0],{start:false});return{changed:c.song.parts[0].sha256!==before,start:bastardLoopWCut.start,end:bastardLoopWCut.end,frames:bastardLoopWBuffer.length,rate:bastardLoopWBuffer.sampleRate};});assert(saved.changed);assert.deepEqual([saved.start,saved.end],runningAmend);assert.equal(saved.frames/saved.rate,2);
 if(name==='chromium'){
  const rendered=await page.evaluate(async()=>{stopAllPerformancePlayback({silent:true});setLoopLayerSolo('bastardw',{silent:true,skipSave:true});setBastardLoopWEnabled(true,{silent:true,skipSave:true});setSliderValue('performanceBastardLoopWLevel',70);updateBastardLoopWMix();setFxMuted(true,{silent:true,skipSave:true});const part=await mygrainSongBetaAdapter.capture({liveOnly:true}),b=await mygrainSongBetaAdapter.renderPart(part,{bpm:120,patternSteps:16,repeats:1});const rms=(a,z)=>{const d=b.getChannelData(0).slice(Math.round(a*b.sampleRate),Math.round(z*b.sampleRate));return Math.sqrt(d.reduce((sum,x)=>sum+x*x,0)/d.length);};return{duration:b.duration,silent:rms(.05,.15),audible:rms(1.5,1.7)};});assert.equal(rendered.duration,2);assert(rendered.audible>.001);assert(rendered.silent<rendered.audible/20);console.log('PASS real isolated W Song render after saved area-drag amendment',rendered);
 }
 assert.deepEqual(errors,[]);console.log('PASS',name,'W stopped/running Song Amend area drag, Save Amendment and recall');
 console.log('PASS',name,'source section drag, snap/free movement, both boundaries, one-step Undo/Redo, keyboard, stretch preserved, unchanged source, export/state/reload, touch/mobile');
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
