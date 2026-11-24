const fs=require('fs'),assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.BASE,T=process.env.TASK;
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
 try{
  const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),p=await c.newPage(),errors=[];p.setDefaultTimeout(60000);p.on('pageerror',e=>errors.push(e.stack));
  await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  assert((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).ok());await p.goto(base);
  await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainEmber&&window.mygrainKMultitrack&&window.mygrainLayerControls);
  await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  const click=async id=>{const l=p.locator('#'+id);await l.evaluate(e=>{mygrainDisplay.reveal(e);e.scrollIntoView({block:'center'});});await l.tap();};
  const choose=async value=>{await p.locator('#emberKRecordTrack').evaluate(e=>{mygrainDisplay.reveal(e);e.scrollIntoView({block:'center'});});await p.locator('#emberKRecordTrack').selectOption(String(value));};
  await p.evaluate(async()=>{stopAllPerformancePlayback({silent:true});setDrumMachineEnabled(false,{silent:true,skipSave:true});for(const l of SPARSE_RANDOM_LAYER_DEFINITIONS)l.setEnabled(false,{silent:true,skipSave:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});applyGlobalBpm(240);mygrainEmber.restore({...MygrainEmber.defaults(),tempo:240});await MygrainEmber.prepare(audioContext,{...mygrainEmber.settings(),enabled:true});window.__pcm=()=>mygrainKMultitrack.tracks.map(t=>t.raw?Array.from({length:t.raw.numberOfChannels},(_,ch)=>Array.from(t.raw.getChannelData(ch))):null);});
  assert.equal(await p.locator('#emberKRecordTrack option').count(),5);
  // Existing K and Keys selections update Ember; Ember updates both.
  await click('performanceBastardLoopKLayerSoloBtn');await p.waitForFunction(()=>hasLoopLayerSolo('bastardk'));await click('performanceBastardLoopKLayerSoloBtn');
  await p.locator('#performanceKeyboardKTrack').evaluate(e=>{e.value='1';e.dispatchEvent(new Event('change',{bubbles:true}));});assert.equal(await p.locator('#emberKRecordTrack').inputValue(),'1');
  await p.locator('[data-k-track="3"] [data-k-record-select]').evaluate(e=>{mygrainDisplay.reveal(e);e.click();});assert.equal(await p.locator('#emberKRecordTrack').inputValue(),'3');
  const takes=[];
  for(const lane of [2,4]){
   await choose(lane);assert.equal(await p.locator('#performanceKeyboardKTrack').inputValue(),String(lane));assert(await p.locator(`[data-k-track="${lane}"] [data-k-record-select]`).isChecked());
   await p.evaluate(()=>{setBastardLoopKRecordingSteps(4);window.__before=__pcm();window.__prior=mygrainKMultitrack.getBuffer(mygrainKMultitrack.selected);});
   if(lane===2)await p.evaluate(()=>{const prepare=MygrainEmber.prepare;window.__entered=false;MygrainEmber.prepare=async(...args)=>{MygrainEmber.prepare=prepare;window.__entered=true;await new Promise(resolve=>window.__release=resolve);return prepare(...args);};});
   await click('emberExportK');
   if(lane===2){await p.waitForFunction(()=>window.__entered);assert(await p.locator('#emberKRecordTrack').isDisabled());assert(await p.evaluate(()=>{try{mygrainKMultitrack.select(0);return false;}catch{return true;}}));await p.evaluate(()=>window.__release());}
   await p.waitForFunction(()=>bastardLoopKRecordingState==='countin');assert(await p.locator('#emberKRecordTrack').isDisabled());
   await p.waitForFunction(()=>bastardLoopKRecordingState==='idle'&&mygrainKMultitrack.getBuffer(mygrainKMultitrack.selected)!==__prior&&!mygrainCardHistory.busy);
   const take=await p.evaluate(lane=>{const now=__pcm(),b=mygrainKMultitrack.getBuffer(lane);if(now.some((x,i)=>i!==lane&&JSON.stringify(x)!==JSON.stringify(__before[i])))throw Error('Other K lane changed');let energy=0,peak=0;for(let ch=0;ch<b.numberOfChannels;ch++)for(const x of b.getChannelData(ch)){if(!Number.isFinite(x))throw Error('Nonfinite PCM');energy+=x*x;peak=Math.max(peak,Math.abs(x));}return{lane:lane+1,frames:b.length,rate:b.sampleRate,rms:Math.sqrt(energy/(b.length*b.numberOfChannels)),peak,label:mygrainKMultitrack.tracks[lane].metadata.sourceLabel};},lane);
   assert.equal(take.frames,Math.round(take.rate*.25));assert(take.rms>.001);assert.equal(take.label,'EMBER2');takes.push(take);assert(!(await p.locator('#emberKRecordTrack').isDisabled()));console.log(engine,'native capture K'+(lane+1),take.rms);
  }
  // Exact multi-lane history, selected lane and existing persistence.
  await p.evaluate(async()=>{stopAllPerformancePlayback({silent:true});window.__after=__pcm();await mygrainCardHistory.undo();});await p.waitForFunction(()=>!mygrainCardHistory.busy);
  assert(await p.evaluate(()=>mygrainKMultitrack.selected===4&&JSON.stringify(__pcm())===JSON.stringify(__before)));assert.equal(await p.locator('#emberKRecordTrack').inputValue(),'4');
  await p.evaluate(()=>mygrainCardHistory.redo());await p.waitForFunction(()=>!mygrainCardHistory.busy);assert(await p.evaluate(()=>JSON.stringify(__pcm())===JSON.stringify(__after)));
  await choose(1);await p.evaluate(()=>{setBastardLoopKRecordingSteps(4);window.__cancel=__pcm();});await click('emberExportK');await p.waitForFunction(()=>bastardLoopKRecordingState==='countin');await click('emberExportK');await p.waitForFunction(()=>bastardLoopKRecordingState==='idle');assert(await p.evaluate(()=>JSON.stringify(__pcm())===JSON.stringify(__cancel)));
  const layer=await p.locator('#performanceBastardLoopKToggleBtn').evaluate(e=>{mygrainDisplay.reveal(e);e.scrollIntoView({block:'center'});return{text:e.textContent,level:e.dataset.layerLevel,classes:e.className,display:getComputedStyle(e).display,row:e.parentElement.innerText};});console.log(engine,'K Layers',layer);
  assert(layer.level?.endsWith('%'));assert.equal(await p.locator('#performanceBastardLoopKToggleBtn').count(),1);
  // The existing K Layers button owns canonical power and volume, additive Solo and Jump.
  await click('performanceBastardLoopKToggleBtn');await p.waitForFunction(()=>!mygrainCardHistory.busy);const was=await p.evaluate(()=>bastardLoopKEnabled);await click('performanceBastardLoopKToggleBtn');await p.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await p.evaluate(()=>bastardLoopKEnabled),!was);
  if(!(await p.evaluate(()=>bastardLoopKEnabled))){await click('performanceBastardLoopKToggleBtn');await p.waitForFunction(()=>!mygrainCardHistory.busy);}
  const vol=await p.locator('#performanceBastardLoopKLevelMixer').inputValue();await p.locator('#performanceBastardLoopKToggleBtn').press('ArrowLeft');await p.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(Number(await p.locator('#performanceBastardLoopKLevelMixer').inputValue()),Math.max(0,Number(vol)-1));
  await click('performanceBastardLoopKLayerSoloBtn');assert(await p.evaluate(()=>hasLoopLayerSolo('bastardk')));await click('performanceBastardLoopKLayerSoloBtn');
  await p.locator('#performanceBastardLoopKToggleBtn').locator('..').locator('[data-jump-target]').tap();assert(await p.locator('#bastardLoopKCard').isVisible());
  const fits=[];for(const [width,height]of [[320,844],[390,844],[844,390],[1440,900]]){
   await p.setViewportSize({width,height});for(const sel of ['.e2-k-export','#performanceBastardLoopKToggleBtn']){
    const box=await p.locator(sel).evaluate(e=>{mygrainDisplay.reveal(e);e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{left:r.left,right:r.right,controls:[...e.querySelectorAll('button,input,select')].map(x=>({width:x.clientWidth,scroll:x.scrollWidth,height:x.getBoundingClientRect().height}))};});assert(box.left>=-1&&box.right<=width+1,JSON.stringify({width,sel,box}));assert(box.controls.every(x=>x.scroll<=x.width+2&&x.height>=40));fits.push({width,height,sel,box});
   }
  }
  await choose(4);await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});saveState({force:true});});await p.reload();await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainKMultitrack&&window.mygrainEmber);await p.evaluate(()=>mygrainCardHistory.ready);
  await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  assert.equal(await p.locator('#emberKRecordTrack').inputValue(),'4');assert.equal(await p.locator('#performanceKeyboardKTrack').inputValue(),'4');assert(await p.evaluate(()=>[2,4].every(i=>mygrainKMultitrack.getBuffer(i)?.length===Math.round(audioContext.sampleRate*.25))));
  await p.setViewportSize({width:390,height:844});await p.locator('.e2-k-export').evaluate(e=>{mygrainDisplay.reveal(e);e.scrollIntoView({block:'center'});});await p.screenshot({path:T+'/evidence/'+engine+'-k-selector.png'});
  assert.deepEqual(errors,[]);fs.writeFileSync(T+'/evidence/'+engine+'-k-track.json',JSON.stringify({takes,layer,fits,errors,reload:true,undoRedo:true,cancel:true},null,2));console.log('PASS',engine,'selected K3/K5 native capture, locked preparation, other lanes, history/cancel/reload, Layers and layout');
 }finally{await b.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
