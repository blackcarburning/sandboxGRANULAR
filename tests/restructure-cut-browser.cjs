'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_BASE||'http://127.0.0.1:19032/mygrain/';
(async()=>{for(const[engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{
  const context=await browser.newContext({viewport:{width:1365,height:900}});
  assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-public-samples'}})).status(),200);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(60000);
  await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainCardHistory);
  await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').click();
  await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  await page.evaluate(async()=>{
   stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});
   const b=audioContext.createBuffer(2,96000,48000);
   for(let c=0;c<2;c++)for(let i=0;i<b.length;i++)b.getChannelData(c)[i]=.3*Math.sin(2*Math.PI*(220+c*71)*i/48000);
   await applyLoadedDropboxSampleLayerBuffer(b,{bpm:120});setRestructureCut(null,{skipSave:true});window.rawCutFixture=b;
   mygrainDisplay.reveal(document.getElementById('performanceRestructureCutBtn'));
  });
  for(const width of [1365,390]){
   await page.setViewportSize({width,height:900});await page.locator('#performanceRestructureCutBtn').click();
   const overlay=page.locator('#restructureCutOverlay');await overlay.waitFor({state:'visible'});
   assert((await page.locator('#restructureCutWaveform').boundingBox()).width>200);
   if(width===1365){
    const alpha=await page.locator('#restructureCutOverlay .weird-cut-shell').evaluate(el=>getComputedStyle(el).backgroundColor);
    assert.match(alpha,/rgba\(.+, 0\.76\)/,alpha);
    if(process.env.MYGRAIN_TEST_OUTPUT)await overlay.screenshot({path:process.env.MYGRAIN_TEST_OUTPUT+'/'+engine+'-desktop-cut.png'});
   }
   await page.locator('#restructureCutEnabled').check();
   await page.locator('#restructureCutEnd').press('ArrowLeft');await page.waitForFunction(()=>!mygrainCardHistory.busy);
   assert(await page.evaluate(()=>restructureCut.enabled&&restructureCut.end<1));
   await page.locator('#restructureCutRepeat').click();await page.waitForFunction(()=>!mygrainCardHistory.busy&&restructureCut.repeat);
   await page.locator('#restructureCutFromStart').click();await page.waitForFunction(()=>!mygrainCardHistory.busy&&restructureCut.fromStart);
   await page.locator('#restructureCutStretch').click();await page.waitForFunction(()=>!mygrainCardHistory.busy&&restructureCut.stretch);
   await page.locator('#restructureCutGap').click();await page.waitForFunction(()=>!mygrainCardHistory.busy&&restructureCut.gapEnabled);
   await page.locator('#restructureCutReset').click();await page.waitForFunction(()=>!mygrainCardHistory.busy&&!restructureCut.enabled&&!restructureCut.gapEnabled);
   // Source trim produces silence in PCM; raw recording is not replaced.
   const pcm=await page.evaluate(()=>{
    setRestructureCut({enabled:true,start:.25,end:.5},{skipSave:true});const x=sampleGridDropboxPlayback().getChannelData(0);
    const energy=(a,b)=>x.subarray(a,b).reduce((n,v)=>n+v*v,0);
    return {before:energy(0,23000),inside:energy(25000,47000),after:energy(49000,96000),unchanged:dropboxSampleLayerRawBuffer===rawCutFixture};
   });assert.equal(pcm.before,0);assert(pcm.inside>1);assert.equal(pcm.after,0);assert(pcm.unchanged);
   // Stopped muted-card audition is routed, audible and Stop owns metronome+source.
   await page.evaluate(()=>setDropboxSampleLayerEnabled(false,{silent:true,skipSave:true}));
   await page.locator('#restructureCutAuditionMetro').click();
   await page.waitForFunction(()=>restructureCutPreview&&dropboxSampleLayerSource);
   const audible=await page.evaluate(async()=>{
    const a=audioContext.createAnalyser();a.fftSize=2048;dropboxSampleLayerGainNode.connect(a);const data=new Float32Array(a.fftSize);
    let peak=0;const end=audioContext.currentTime+2.2;
    while(audioContext.currentTime<end){a.getFloatTimeDomainData(data);peak=Math.max(peak,...data.map(Math.abs));await new Promise(r=>setTimeout(r,25));}
    dropboxSampleLayerGainNode?.disconnect(a);a.disconnect();return peak;
   });assert(audible>.001,engine+' audition silent');
   await page.locator('#restructureCutStop').click();assert(await page.evaluate(()=>!restructureCutPreview&&!dropboxSampleLayerSource&&restructureCutMetronomeNodes.size===0));
   await page.locator('#restructureCutClose').click();
  }
  const state=await page.evaluate(async()=>{
   setRestructureCut({enabled:true,start:.25,end:.5,repeat:true,gapEnabled:true,gaps:[[.75,.8125]]},{skipSave:true});
   const expected=JSON.stringify(restructureCut),a=mygrainSongBetaAdapter;
   const zip=await a.capture();const part=await a.decode(await zip.arrayBuffer(),{buffers:new Map(),bytes:0});
   setRestructureCut(null,{skipSave:true});a.recall(part,{start:false});await a.whenPersisted();
   const zipRecall=JSON.stringify(restructureCut)===expected;
   await mygrainCardHistory.runDraftEdit('Restructure cut reset fixture',()=>setRestructureCut(null));await mygrainCardHistory.undo();const undo=JSON.stringify(restructureCut)===expected;await mygrainCardHistory.redo();const redo=!restructureCut.enabled;
   setRestructureCut({enabled:true,start:.25,end:.5},{skipSave:true});setBastardLoopWCut({enabled:true,start:.25,end:.5},{skipSave:true});mygrainD.cut({enabled:true,start:.25,end:.5},{skipSave:true});mygrainD.lane(2).cut({enabled:true,start:.25,end:.5},{skipSave:true});
   const original=mygrainMasterBaker.randomiseOff;mygrainMasterBaker.randomiseOff=()=>{throw Error('random-fixture-boundary')};
   try{await runPatchRandomizationImpl();}catch(e){if(e.message!=='random-fixture-boundary')throw e;}finally{mygrainMasterBaker.randomiseOff=original;}
   const randomReset=!restructureCut.enabled&&!bastardLoopWCut.enabled&&!mygrainD.settings().cut.enabled&&!mygrainD.lane(2).settings.cut?.enabled;
   setRestructureCut({enabled:true,start:.25,end:.5},{skipSave:true});document.getElementById('resetDefaultBtn').click();const patchReset=!restructureCut.enabled&&restructureCut.start===0&&restructureCut.end===1;
   return {zipRecall,undo,redo,randomReset,patchReset};
  });for(const[k,v]of Object.entries(state))assert.equal(v,true,k);
  if(engine==='chromium'){
   const song=await page.evaluate(async()=>{
    stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});setLoopLayerSolo('dropbox',{silent:true,skipSave:true});setDropboxSampleLayerEnabled(true,{silent:true,skipSave:true});syncPatternLengthControls(16,{skipSave:true});
    const c=mygrainSongBeta;document.getElementById('songBetaName').value='Restructure cut fixture';await c.newSong();
    setRestructureCut(null,{skipSave:true});await c.newPart({name:'Full bar',repeats:1});setRestructureCut({enabled:true,start:.25,end:.5},{skipSave:true});await c.newPart({name:'Cut bar',repeats:1});await c.finishEditing();
    for(const part of c.song.parts)await c.prepareOnServer(part,c.generation);await c.arm();if(!c.armed)throw Error('Song not armed');
    const a=(await c.loadRender(c.song.parts[0])).getChannelData(0),b=(await c.loadRender(c.song.parts[1])).getChannelData(0);let diff=0;for(let i=0;i<Math.min(a.length,b.length);i++)diff+=(a[i]-b[i])**2;
    await c.playSong();const playing=c.playing;c.stop();return {diff,playing};
   });assert(song.diff>1);assert(song.playing);console.log('server cut Song',song);
  }
  assert.deepEqual(errors,[]);console.log('PASS',engine,state);await context.close();
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
