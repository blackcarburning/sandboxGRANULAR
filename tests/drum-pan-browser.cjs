'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19047/mygrain/';assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const out=process.env.DRUM_PAN_EVIDENCE||'/tmp/drum-pan-evidence';fs.mkdirSync(out,{recursive:true});
(async()=>{const results=[];for(const engine of(process.env.ENGINE?[process.env.ENGINE]:['chromium','webkit'])){
 const browser=await({chromium,webkit}[engine]).launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{const context=await browser.newContext({viewport:{width:390,height:740},hasTouch:true,isMobile:true});
 assert((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).ok());const page=await context.newPage();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 const boot=async()=>{await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainCardHistory);await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});openDrumMachineOverlay();});};await page.goto(base);await boot();
 await page.evaluate(()=>{MygrainDrumPan.restore();saveState({force:true});});
 for(const viewport of[{width:320,height:640},{width:390,height:740},{width:844,height:390},{width:1280,height:900}]){
  await page.setViewportSize(viewport);await page.evaluate(()=>document.querySelector('.drum-machine-shell').scrollTop=0);
  const metrics=await page.evaluate(()=>{const s=document.querySelector('.drum-machine-shell'),l=document.querySelector('.drum-machine-layout');return{height:s.clientHeight,scrollHeight:s.scrollHeight,overflow:getComputedStyle(s).overflowY,laneHeight:l.clientHeight,width:document.documentElement.scrollWidth,view:innerWidth};});
  assert.equal(metrics.overflow,'auto');assert(metrics.scrollHeight>metrics.height);assert(metrics.laneHeight>100);assert(metrics.width<=metrics.view+1);assert.equal(await page.locator('[data-drum-pan]').count(),8);
  for(const lane of ['kick','snare','hat','perc','clap','cymbals','etc','roll']){const input=page.locator(`[data-drum-pan="${lane}"]`);await input.evaluate(e=>e.scrollIntoView({block:"center"}));assert(await input.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}),JSON.stringify({lane,viewport,hit:await input.evaluate(e=>{const r=e.getBoundingClientRect();return{rect:r.toJSON(),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,200)}})}));}
  results.push({engine,viewport,metrics});
 }
 await page.setViewportSize({width:390,height:740});await page.evaluate(()=>document.querySelector('.drum-machine-shell').scrollTop=0);
 const cdp=engine==='chromium'?await context.newCDPSession(page):null;
 if(cdp){const area=page.locator('#drumMachineOverlay .sequencer-snapshots > p').first();await area.scrollIntoViewIfNeeded();const box=await area.boundingBox(),before=await page.evaluate(()=>document.querySelector('.drum-machine-shell').scrollTop);const x=box.x+box.width/2,y=Math.min(620,box.y+box.height/2);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=10;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*15}]});await page.waitForTimeout(20);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(300);assert(await page.evaluate(()=>document.querySelector('.drum-machine-shell').scrollTop)>before+50,'Snapshot text must initiate native scrolling');}
 // Native range input, one transaction and Undo/Redo.
 const range=page.locator('[data-drum-pan="hat"]');await range.scrollIntoViewIfNeeded();await range.focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await page.evaluate(()=>MygrainDrumPan.value('hat')),.01);await page.evaluate(()=>mygrainCardHistory.undo());assert.equal(await page.evaluate(()=>MygrainDrumPan.value('hat')),0);await page.evaluate(()=>mygrainCardHistory.redo());assert.equal(await page.evaluate(()=>MygrainDrumPan.value('hat')),.01);
 await page.evaluate(()=>{MygrainDrumPan.setLane('hat',.65);MygrainDrumPan.setLane('kick',-.3);syncDrumMachineUi();});
 const accent=page.locator('#drumMachineHatGrid .drum-machine-accent-btn').first();await accent.scrollIntoViewIfNeeded();
 // An explicit centre overrides the lane, independently of accent power.
 await page.evaluate(()=>{MygrainDrumPan.setHat(0,0);drumMachineHatAccentPattern[0]=false;syncDrumMachineUi();});
 const drag=async direction=>{await accent.scrollIntoViewIfNeeded();const r=await accent.boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2,dx=direction*r.width*.43;
  if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/8,y:y+2}]});await page.waitForTimeout(25);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+2,{steps:8});await page.mouse.up();}
  await page.waitForFunction(()=>!mygrainCardHistory.busy);
 };
 await accent.evaluate(e=>{window.panEvents=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','click'])e.addEventListener(type,event=>panEvents.push({type:event.type,x:event.clientX,y:event.clientY,busy:window.mygrainCardHistory.busy,pan:MygrainDrumPan.value('hat',0)}));});const scrollBefore=await page.evaluate(()=>document.querySelector('.drum-machine-shell').scrollTop);await drag(-1);
 const left=await page.evaluate(()=>({pan:MygrainDrumPan.value('hat',0),accent:drumMachineHatAccentPattern[0],other:MygrainDrumPan.value('hat',1),scroll:document.querySelector('.drum-machine-shell').scrollTop}));assert(left.pan<-.7,JSON.stringify({left,events:await page.evaluate(()=>window.panEvents)}));assert.equal(left.accent,false);assert.equal(left.other,.65);assert(Math.abs(left.scroll-scrollBefore)<2);
 await page.evaluate(()=>mygrainCardHistory.undo());assert.equal(await page.evaluate(()=>MygrainDrumPan.value('hat',0)),0);await page.evaluate(()=>mygrainCardHistory.redo());assert.equal(await page.evaluate(()=>MygrainDrumPan.value('hat',0)),left.pan);
 await page.waitForTimeout(550);await accent.tap();await page.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await page.evaluate(()=>drumMachineHatAccentPattern[0]),true);
 await page.evaluate(()=>MygrainDrumPan.setHat(0,0));await drag(1);assert(await page.evaluate(()=>MygrainDrumPan.value('hat',0))>.7);assert.equal(await page.evaluate(()=>drumMachineHatAccentPattern[0]),true);
 const appearance=await accent.evaluate(e=>({line:getComputedStyle(e,'::after').backgroundColor,fill:getComputedStyle(e,'::before').backgroundColor,touch:getComputedStyle(e).touchAction,text:e.textContent}));assert.equal(appearance.line,'rgb(255, 225, 0)');assert.equal(appearance.fill,'rgb(187, 37, 37)');assert.equal(appearance.text,'Accent');assert(appearance.touch.includes('pan-y'));
 await page.screenshot({path:`${out}/${engine}-hat-pan.png`});
 const saved=await page.evaluate(()=>{saveState({force:true});return{pan:MygrainDrumPan.capture(),preset:gatherPreset().drumPan,state:saveState({force:true,snapshotOnly:true}).modes.drumPan};});assert.deepEqual(saved.pan.drumPan,saved.preset);assert.deepEqual(saved.preset,saved.state);
 // Portable/native codecs use canonical modes, not duplicate range values.
 const serialized=await page.evaluate(async()=>{
 const adapter=mygrainSongBeta.adapter,part=await adapter.capture({liveOnly:true});
 const pan=structuredClone(part.snapshot.state.modes.drumPan);
 const preset=gatherPreset();MygrainDrumPan.restore();applyPreset(preset);
 if(JSON.stringify(MygrainDrumPan.capture().drumPan)!==JSON.stringify(pan))throw Error('Preset import lost panning');
 const worker=new Worker(new URL('daw-project-codec.js',document.baseURI));
 const result=await new Promise((resolve,reject)=>{worker.onmessage=e=>e.data.type==='prepared'?resolve(e.data):reject(Error(e.data.message));worker.onerror=reject;worker.postMessage({type:'pack',id:1,audio:[],slots:[],snapshot:part.snapshot,settings:{kind:'bridge'},parts:[]});});worker.terminate();
 const header=new DataView(result.buffer),zip=result.buffer.slice(16+header.getUint32(8,true));
 const decoded=await adapter.decode(zip,{buffers:new Map(),bytes:0,limitBytes:256*1048576});
 if(JSON.stringify(decoded.snapshot.state.modes.drumPan)!==JSON.stringify(pan))throw Error('Native codec lost panning');
 MygrainDrumPan.restore();await adapter.recall(decoded,{start:false,persist:false});
 if(JSON.stringify(MygrainDrumPan.capture().drumPan)!==JSON.stringify(pan))throw Error('Native/ZIP recall lost panning');
 return{pan,nativeBytes:result.buffer.byteLength};
 });assert.deepEqual(serialized.pan,saved.preset);
 await page.reload();await boot();assert.deepEqual(await page.evaluate(()=>MygrainDrumPan.capture()),saved.pan);assert.deepEqual(errors,[]);
 results.push({engine,left,appearance,saved,serialized});console.log('PASS',engine,'scroll, eight lanes, independent hat swipes, accent taps, Undo/Redo, save/reload');await context.close();
 }finally{await browser.close()}
}fs.writeFileSync(out+'/'+(process.env.ENGINE||'all')+'-results.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
