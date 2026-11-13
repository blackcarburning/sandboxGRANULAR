'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19209/mygrain/',out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp/mygrain-layer-evidence';
fs.mkdirSync(out,{recursive:true});
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async()=>{const results=[];for(const [name,type,mobile]of [['chromium-desktop',chromium,false],['webkit-desktop',webkit,false],['chromium-phone',chromium,true],['webkit-phone',webkit,true]]){
 if(process.env.MYGRAIN_TEST_CASES&&!process.env.MYGRAIN_TEST_CASES.split(',').includes(name))continue;
 const b=await type.launch(type===chromium?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--disable-dev-shm-usage']}:{ });
 try{
 const c=await b.newContext({viewport:mobile?{width:390,height:844}:{width:1400,height:1000},hasTouch:mobile,isMobile:mobile,...(mobile?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})}),p=await c.newPage(),errors=[];
 p.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.stack)});await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);await p.goto(base);await p.waitForFunction(()=>window.mygrainLayerControls&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});setOscillatorsEnabled(true,{silent:true,skipSave:true});setDrumMachineEnabled(true,{silent:true,skipSave:true});setSliderValue('performanceOscVolume',50);mygrainDisplay.reveal(document.getElementById('performanceLayerSwitchesCard'));document.getElementById('performanceLayerSwitchesCard').scrollIntoView({block:'center'});});
 for(const key of ['Wasp','Playground','Turntable'])assert.equal(await p.locator('#performanceLayer'+key+'JumpBtn').count(),1);
 const btn=p.locator('#performanceLayerOscBtn');await btn.scrollIntoViewIfNeeded();await p.waitForTimeout(300);
 const startCounts=await p.evaluate(()=>mygrainCardHistory.counts);
 let box=await btn.boundingBox();const start={x:box.x+box.width*.30,y:box.y+box.height*.5},end={x:start.x+box.width*.22,y:start.y};
 if(mobile&&type===chromium){const cdp=await c.newCDPSession(p);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});for(let n=1;n<=7;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*n/7,y:start.y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else{await p.mouse.move(start.x,start.y);await p.mouse.down();await p.mouse.move(end.x,end.y,{steps:7});await p.mouse.up();}
 await p.waitForFunction(()=>!mygrainCardHistory.busy);await p.waitForTimeout(80);
 const dragged=await p.evaluate(()=>({on:oscillatorsEnabled,value:Number(document.getElementById('performanceOscVolume').value),fill:document.getElementById('performanceLayerOscBtn').style.getPropertyValue('--layer-volume'),counts:mygrainCardHistory.counts,aria:document.getElementById('performanceLayerOscBtn').getAttribute('aria-description')}));assert(dragged.on);assert(dragged.value>=70&&dragged.value<=74,JSON.stringify(dragged));assert.equal(dragged.counts.undo,startCounts.undo+1);assert.match(dragged.aria,/72%|71%|73%/);
 await p.evaluate(()=>mygrainCardHistory.undo());await p.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await p.evaluate(()=>Number(document.getElementById('performanceOscVolume').value)),50);await p.evaluate(()=>mygrainCardHistory.redo());await p.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await p.evaluate(()=>Number(document.getElementById('performanceOscVolume').value)),dragged.value);
 await btn.press('Shift+ArrowLeft');await p.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await p.evaluate(()=>Number(document.getElementById('performanceOscVolume').value)),dragged.value-10);
 if(mobile)await btn.tap();else await btn.click();assert.equal(await p.evaluate(()=>oscillatorsEnabled),false);const off=await btn.evaluate(e=>({bg:getComputedStyle(e).background,color:getComputedStyle(e).color,border:getComputedStyle(e).borderColor,vu:e.style.getPropertyValue('--layer-vu')}));assert.match(off.bg,/52, 52, 54/);assert.equal(off.color,'rgb(169, 169, 175)');assert.equal(off.border,'rgb(98, 98, 103)');
 if(mobile){await btn.tap();assert.equal(await p.evaluate(()=>oscillatorsEnabled),true);await btn.tap();assert.equal(await p.evaluate(()=>oscillatorsEnabled),false);}
 // Both Jump surfaces mirror the mute state without disabling navigation.
 const nav=p.locator('#sectionJumpPanel .section-jump-option[data-nav-section="synth"]');
 assert.equal(await nav.getAttribute('data-layer-active'),'false');
 const navOff=await nav.evaluate(e=>({bg:getComputedStyle(e).background,color:getComputedStyle(e).color,border:getComputedStyle(e).borderColor,disabled:e.disabled,aria:e.getAttribute('aria-description')}));
 assert.equal(navOff.color,off.color);assert.equal(navOff.border,off.border);assert.match(navOff.bg,/52, 52, 54/);assert.equal(navOff.disabled,false);
 if(mobile){await p.locator('#sectionJumpHandle').click();await p.waitForTimeout(250)}
 await nav.click();await p.waitForFunction(()=>document.documentElement.dataset.mygrainJumping!=='true');
 assert.equal(await p.evaluate(()=>oscillatorsEnabled),false);
 await p.keyboard.press('Escape');await p.waitForTimeout(500);
 await btn.scrollIntoViewIfNeeded();await p.waitForTimeout(350);
 
 // Inactive dragging cannot alter level or enable the layer.
 box=await btn.boundingBox();await p.mouse.move(box.x+20,box.y+20);await p.mouse.down();await p.mouse.move(box.x+90,box.y+20,{steps:6});await p.mouse.up();assert.equal(await p.evaluate(()=>Number(document.getElementById('performanceOscVolume').value)),dragged.value-10);
 await p.evaluate(()=>setOscillatorsEnabled(true,{silent:true,skipSave:true}));await p.waitForTimeout(20);assert.equal(await nav.getAttribute('data-layer-active'),'true');
 // Pointer cancellation restores the old value and does not leave History busy.
 const cancel=await p.evaluate(async()=>{const e=document.getElementById('performanceLayerOscBtn'),r=e.getBoundingClientRect(),before=Number(document.getElementById('performanceOscVolume').value);e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:99,isPrimary:true,button:0,clientX:r.x+20,clientY:r.y+20}));e.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:99,isPrimary:true,button:0,clientX:r.x+50,clientY:r.y+20}));window.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:99,isPrimary:true}));await Promise.resolve();return{before,after:Number(document.getElementById('performanceOscVolume').value),drag:mygrainLayerControls.snapshot().dragging}});assert.equal(cancel.before,cancel.after);assert.equal(cancel.drag,false);
 // Canonical changes update the new display; Solo-isolated layers are neutral grey.
 await p.evaluate(()=>{setSliderValue('performanceDrumMachineLevel',37);setLoopLayerSolo('drums',{silent:true,skipSave:true});});await p.waitForTimeout(20);assert(await btn.evaluate(e=>e.classList.contains('layer-solo-muted')||e.classList.contains('layer-muted')));await p.evaluate(()=>clearAllPerformanceSoloStates({silent:true,skipSave:true}));
 const drm=p.locator('#performanceDrumMachineEnableBtn');await p.evaluate(()=>{mygrainDisplay.reveal(document.getElementById('performanceDrumMachineCard'));document.getElementById('performanceDrumMachineCard').scrollIntoView();});await drm.click();assert.equal(await p.evaluate(()=>drumMachineEnabled),false);assert.equal(await p.locator('#performanceDrumMachineLayerBtn').getAttribute('aria-pressed'),'false');await drm.click();assert.equal(await p.evaluate(()=>drumMachineEnabled),true);
 await btn.scrollIntoViewIfNeeded();await p.waitForTimeout(350);
 // A real stereo anti-phase signal must register mono energy, not cancel out.
 await p.evaluate(()=>{const buffer=audioContext.createBuffer(2,audioContext.sampleRate,audioContext.sampleRate);for(let i=0;i<buffer.length;i++){buffer.getChannelData(0)[i]=.15*Math.sin(2*Math.PI*220*i/buffer.sampleRate);buffer.getChannelData(1)[i]=-buffer.getChannelData(0)[i];}window.__layerTone=audioContext.createBufferSource();__layerTone.buffer=buffer;__layerTone.loop=true;__layerTone.connect(oscOutputGain);__layerTone.start();setSliderValue('performanceOscVolume',100);window.__layerProbe=audioContext.createAnalyser();__layerProbe.fftSize=1024;window.__layerSplit=audioContext.createChannelSplitter(2);oscOutputGain.connect(__layerSplit);__layerSplit.connect(__layerProbe,0);});await p.waitForTimeout(1200);
 const full=await p.evaluate(()=>{const d=new Float32Array(1024);__layerProbe.getFloatTimeDomainData(d);return{rms:Math.sqrt(d.reduce((s,v)=>s+v*v,0)/d.length),vu:document.getElementById('performanceLayerOscBtn').style.getPropertyValue('--layer-vu'),...mygrainLayerControls.snapshot()}});assert(parseInt(full.vu)>0,JSON.stringify(full));
 await p.evaluate(()=>setSliderValue('performanceOscVolume',50));await p.waitForTimeout(650);const half=await p.evaluate(()=>{const d=new Float32Array(1024);__layerProbe.getFloatTimeDomainData(d);return{rms:Math.sqrt(d.reduce((s,v)=>s+v*v,0)/d.length),vu:document.getElementById('performanceLayerOscBtn').style.getPropertyValue('--layer-vu')}});assert(Math.abs(half.rms/full.rms-.5)<.035,JSON.stringify({full,half}));assert(parseInt(half.vu)<parseInt(full.vu));
 await p.evaluate(()=>setSliderValue('performanceOscVolume',0));await p.waitForTimeout(650);assert.equal(await btn.evaluate(e=>e.style.getPropertyValue('--layer-vu')),'0%');
 // Active volume buttons own real touch from contact; vertical drift cannot pan or toggle.
 if(mobile&&type===chromium){
  await p.evaluate(()=>setSliderValue('performanceOscVolume',43));await btn.scrollIntoViewIfNeeded();await p.waitForTimeout(250);
  const before=await p.evaluate(()=>({value:document.getElementById('performanceOscVolume').value,on:oscillatorsEnabled,scroll:scrollY,undo:mygrainCardHistory.counts.undo})),r=await btn.boundingBox(),cdp=await c.newCDPSession(p),point={x:r.x+r.width*.5,y:r.y+r.height*.5};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});for(let n=1;n<=8;n++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x,y:point.y-100*n/8}]});await p.waitForTimeout(30)}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(500);
  const after=await p.evaluate(()=>({value:document.getElementById('performanceOscVolume').value,on:oscillatorsEnabled,scroll:scrollY,undo:mygrainCardHistory.counts.undo}));assert.equal(after.value,before.value);assert.equal(after.on,before.on);assert.equal(after.undo,before.undo);assert(Math.abs(after.scroll-before.scroll)<=1,JSON.stringify({before,after}));
  // A small horizontal change with substantial vertical drift stays planted and adjusts promptly.
  const planted=await p.evaluate(()=>({scroll:scrollY,view:visualViewport.offsetTop,focus:document.activeElement.id,value:Number(document.getElementById('performanceOscVolume').value),undo:mygrainCardHistory.counts.undo}));
  assert.equal(await btn.evaluate(e=>getComputedStyle(e).touchAction),'none');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+5,y:point.y-12}]});
  const early=await p.evaluate(()=>Number(document.getElementById('performanceOscVolume').value));assert(early>planted.value,'Touch should respond after 5px, even with vertical drift');
  for(let n=1;n<=6;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+r.width*.16*n/6,y:point.y-50*n/6}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForFunction(()=>!mygrainCardHistory.busy);
  const adjusted=await p.evaluate(()=>({scroll:scrollY,view:visualViewport.offsetTop,focus:document.activeElement.id,value:Number(document.getElementById('performanceOscVolume').value),undo:mygrainCardHistory.counts.undo}));
  assert(Math.abs(adjusted.scroll-planted.scroll)<=1);assert.equal(adjusted.view,planted.view);assert.equal(adjusted.focus,planted.focus);assert(adjusted.value>=58&&adjusted.value<=60);assert.equal(adjusted.undo,Math.min(planted.undo+1,2));assert.equal(await p.evaluate(()=>mygrainCardHistory.undoLabel),'Layer volume: Osc');
  await p.evaluate(()=>mygrainCardHistory.undo());assert.equal(await p.evaluate(()=>Number(document.getElementById('performanceOscVolume').value)),planted.value);await p.evaluate(()=>mygrainCardHistory.redo());assert.equal(await p.evaluate(()=>Number(document.getElementById('performanceOscVolume').value)),adjusted.value);
  // Scrolling remains available from the explanatory text outside the controls.
  await p.evaluate(()=>{document.querySelector('.performance-layer-switches-note').scrollIntoView({block:'center'});});await p.waitForTimeout(200);
  const note=await p.locator('.performance-layer-switches-note').boundingBox(),pan={x:note.x+note.width/2,y:note.y+note.height/2},scrollBefore=await p.evaluate(()=>scrollY);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pan]});for(let n=1;n<=8;n++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:pan.x,y:pan.y-100*n/8}]});await p.waitForTimeout(30)}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(400);
  assert(Math.abs((await p.evaluate(()=>scrollY))-scrollBefore)>20,'Page should still scroll outside volume buttons');await btn.scrollIntoViewIfNeeded();
  results.push({name:name+'-touch-ownership',before,after,planted,early,adjusted});
 }
 // Effect shortcuts exist before hydration and remain unique after actual navigation.
 const effects=[['Turntable','turntableCard','turntable'],['Wasp','waspCard','wasp'],['Playground','filterPlaygroundCard','playground']];
 for(const [key,target,section]of effects){
  const link=p.locator('#performanceLayer'+key+'JumpBtn');assert.equal(await link.count(),1);
  assert.equal(await link.getAttribute('data-jump-target'),'#'+target);assert.equal(await link.getAttribute('data-nav-section'),section);
  await link.click();await p.waitForFunction(()=>document.documentElement.dataset.mygrainJumping!=='true');
  if(key==='Wasp')await p.waitForSelector('#waspPower');
  const destination=p.locator('#'+target);await destination.waitFor({state:'visible'});
  const rect=await destination.boundingBox();assert(rect.y< (mobile?844:1000)&&rect.y+rect.height>0,JSON.stringify({key,rect}));
  await p.keyboard.press('Escape');await p.waitForTimeout(300);
 }
 const effectStates=await p.evaluate(async()=>{
  const w=mygrainWasp.settings(),t=mygrainTurntable.settings();
  const read=()=>Object.fromEntries(['Wasp','Playground','Turntable'].map(key=>{const el=document.getElementById('performanceLayer'+key+'JumpBtn');return[key,{active:el.dataset.layerActive,bg:getComputedStyle(el).backgroundImage,count:document.querySelectorAll('#'+el.id).length}]}));
  await mygrainWasp.restore({...w,enabled:true,playground:{...w.playground,enabled:false}});await mygrainTurntable.restore({...t,enabled:true});await new Promise(r=>setTimeout(r,30));const waspOn=read();
  await mygrainWasp.restore({...w,enabled:false,playground:{...w.playground,enabled:true}});await mygrainTurntable.restore({...t,enabled:false});await new Promise(r=>setTimeout(r,30));const playgroundOn=read();
  await mygrainWasp.restore({...w,enabled:false,playground:{...w.playground,enabled:false}});await mygrainTurntable.restore({...t,enabled:false});return{waspOn,playgroundOn};
 });
 assert.equal(effectStates.waspOn.Wasp.active,'true');assert.equal(effectStates.waspOn.Playground.active,'false');assert.equal(effectStates.waspOn.Turntable.active,'true');
 assert.equal(effectStates.playgroundOn.Wasp.active,'false');assert.equal(effectStates.playgroundOn.Playground.active,'true');assert.equal(effectStates.playgroundOn.Turntable.active,'false');
 for(const state of Object.values(effectStates))for(const value of Object.values(state)){assert.equal(value.count,1);if(value.active==='false')assert.match(value.bg,/52, 52, 54/);else assert.doesNotMatch(value.bg,/52, 52, 54/)}
 results.push({name:name+'-effect-navigation',effectStates});
 // Snapshot uses existing fields; fresh recall refreshes the linked volume display.
 const saved=await p.evaluate(()=>{setSliderValue('performanceOscVolume',43);setSliderValue('performanceDrumMachineLevel',37);return saveState({force:true,snapshotOnly:true})});assert.equal(Number(saved.sliders.performanceDrumMachineLevel),37);
 if(name==='chromium-desktop'){
  const archive=await p.evaluate(async()=>{const blob=await mygrainSongBetaAdapter.capture(),data=await blob.arrayBuffer(),info=mygrainSongBetaAdapter.inspectPart(data);setSliderValue('performanceOscVolume',9);setSliderValue('performanceDrumMachineLevel',12);const part=await mygrainSongBetaAdapter.decode(data,{buffers:new Map(),bytes:0,reservedBytes:0,limitBytes:96*1048576});mygrainSongBetaAdapter.recall(part,{start:false});return{bytes:data.byteLength,osc:info.snapshot.state.sliders.performanceOscVolume,drums:info.snapshot.state.sliders.performanceDrumMachineLevel}});assert.equal(Number(archive.osc),43);assert.equal(Number(archive.drums),37);await p.waitForTimeout(60);assert.equal(await p.locator('#performanceDrumMachineLayerBtn').getAttribute('data-layer-level'),'37%');
 }

 await p.evaluate(()=>{__layerTone.stop();oscOutputGain.disconnect(__layerSplit);__layerSplit.disconnect();__layerProbe.disconnect();mygrainDisplay.reveal(document.getElementById('performanceLayerSwitchesCard'));document.getElementById('performanceLayerSwitchesCard').scrollIntoView({block:'center'});});await p.waitForTimeout(1200);await p.screenshot({path:out+'/'+name+'.png'});
 // Background lifecycle stops only the monitor, never the sound context.
 const hiddenA=await p.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide'));return mygrainLayerControls.snapshot()});await p.waitForTimeout(1100);
 const hiddenB=await p.evaluate(()=>({state:audioContext.state,...mygrainLayerControls.snapshot()}));assert.equal(hiddenA.samples,hiddenB.samples);assert.equal(hiddenB.taps,0);assert.equal(hiddenB.state,'running');
 await p.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow')));await p.waitForTimeout(600);
 const visible=await p.evaluate(()=>mygrainLayerControls.snapshot());await p.evaluate(()=>{window.scrollTo(0,0);});await p.waitForTimeout(500);const idleA=await p.evaluate(()=>mygrainLayerControls.snapshot());await p.waitForTimeout(1100);const idleB=await p.evaluate(()=>mygrainLayerControls.snapshot());assert.equal(idleA.samples,idleB.samples);assert.equal(idleB.taps,0);
 await p.reload();await p.waitForFunction(()=>window.mygrainLayerControls&&document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);const recall=await p.evaluate(()=>({drums:document.getElementById('performanceDrumMachineLevel').value,display:document.getElementById('performanceDrumMachineLayerBtn').dataset.layerLevel,osc:document.getElementById('performanceOscVolume').value}));assert.equal(recall.drums,'37');assert.equal(recall.display,'37%');assert.equal(recall.osc,'43');assert.deepEqual(errors,[]);
 results.push({name,dragged,off,navOff,cancel,full,half,visible,hiddenA,hiddenB,idleA,idleB,recall,errors});console.log('PASS',name);
 }finally{await b.close()}
}fs.writeFileSync(out+'/layer-browser.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
