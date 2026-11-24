'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:19032/mygrain/';
(async()=>{
 for(const [engine,type] of Object.entries({chromium,webkit})){
  const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844}});
   assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-public-samples'}})).status(),200);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(60000);
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   async function ready(){await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainCardHistory);await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);}
   await page.goto(base);await ready();
   const legacy=Array.from(fs.readFileSync('/root/.openclaw/workspace/output/mygrain-restructure-20261121T185303Z/new-source.zip'));
   await page.evaluate(async bytes=>{
    const a=mygrainSongBetaAdapter,p=await a.decode(Uint8Array.from(bytes).buffer,{buffers:new Map(),bytes:0});a.recall(p,{start:false});await a.whenPersisted();
    if(dropboxSampleLayerShiftSteps!==0||Object.hasOwn(gatherPreset(),'dropboxSampleLayerShiftSteps'))throw Error('Legacy neutral shift changed');
    window.legacyShiftPart=p;window.shiftRaw=dropboxSampleLayerRawBuffer;window.shiftPcm=Array.from(shiftRaw.getChannelData(0));
    const b=document.getElementById('performanceDropboxSampleShiftRightBtn');mygrainDisplay.reveal(b);b.scrollIntoView();
   },legacy);
   const right=page.locator('#performanceDropboxSampleShiftRightBtn'),left=page.locator('#performanceDropboxSampleShiftLeftBtn');
   assert.equal((await right.textContent()).trim(),'>');assert.equal((await left.textContent()).trim(),'<');
   await right.click();await page.waitForFunction(()=>dropboxSampleLayerShiftSteps===1&&!mygrainCardHistory.busy);
   assert.equal(await page.locator('#performanceDropboxSampleShiftValue').textContent(),'+1');
   const state=await page.evaluate(async()=>{
    const a=mygrainSongBetaAdapter;
    if(shiftRaw!==dropboxSampleLayerRawBuffer||!shiftPcm.every((v,i)=>v===dropboxSampleLayerRawBuffer.getChannelData(0)[i]))throw Error('Shift altered original PCM');
    await mygrainCardHistory.undo();if(dropboxSampleLayerShiftSteps!==0)throw Error('Undo failed');
    await mygrainCardHistory.redo();if(dropboxSampleLayerShiftSteps!==1)throw Error('Redo failed');
    // Record the actual AudioBufferSource start arguments for both scheduled and running origins.
    const original=startTransportSource,starts=[];startTransportSource=function(source,...args){starts.push({time:args[0],offset:args[1],rate:source.playbackRate.value});return original(source,...args);};
    try{
     setFxMuted(true,{silent:true});setLoopLayerSolo('dropbox',{silent:true,skipSave:true});setDropboxSampleLayerEnabled(true,{silent:true,skipSave:true});
     const future=audioContext.currentTime+2;setTransportEpoch(future);startDropboxSampleLayer(future,{skipUi:true});stopDropboxSampleLayer({fade:false,skipUi:true});
     const duration=getDropboxSampleLayerCycleDuration(),loop=getResolvedDropboxSampleLayerDuration(sampleGridDropboxPlayback()),rate=getDropboxSampleLayerPlaybackRate();
     if(Math.abs(starts.at(-1).offset-duration*rate/16)>.00001)throw Error('Future shift ignored');
     const origin=audioContext.currentTime-.31;setTransportEpoch(origin);startDropboxSampleLayer(origin,{skipUi:true});
     const start=starts.at(-1),elapsed=(start.time-origin)%duration,expected=((elapsed+duration/16)%duration)*rate;
     if(Math.abs(start.offset-Math.min(loop-.0005,expected))>.00001)throw Error('Running shift lost clock phase');
     stopDropboxSampleLayer({fade:false,skipUi:true});
     setBastardLoopShiftSteps('R',-1,{silent:true,skipSave:true});const negative=getBastardLoopShiftedOffset(0,rate,loop,duration,'R');
     if(Math.abs(negative-duration*rate*15/16)>.00001)throw Error('Left wrap incorrect');
     setBastardLoopShiftSteps('R',-999,{silent:true,skipSave:true});if(dropboxSampleLayerShiftSteps!==-16)throw Error('Lower limit');
     setBastardLoopShiftSteps('R',999,{silent:true,skipSave:true});if(dropboxSampleLayerShiftSteps!==16)throw Error('Upper limit');
     setBastardLoopShiftSteps('R',1,{silent:true,skipSave:true});
    }finally{startTransportSource=original;stopDropboxSampleLayer({fade:false,skipUi:true});}
    const zip=await a.capture(),part=await a.decode(await zip.arrayBuffer(),{buffers:new Map(),bytes:0});
    a.recall(legacyShiftPart,{start:false});if(dropboxSampleLayerShiftSteps!==0)throw Error('Old ZIP inherited shift');
    a.recall(part,{start:false});await a.whenPersisted();if(dropboxSampleLayerShiftSteps!==1)throw Error('ZIP lost shift');
    const preset=gatherPreset();setBastardLoopShiftSteps('R',0,{silent:true,skipSave:true});applyPreset(preset);if(dropboxSampleLayerShiftSteps!==1)throw Error('Preset lost shift');
    delete preset.dropboxSampleLayerShiftSteps;applyPreset(preset);if(dropboxSampleLayerShiftSteps!==0)throw Error('Old preset inherited shift');
    setBastardLoopShiftSteps('R',1,{silent:true});saveState({force:true});await a.whenPersisted();
    return {shift:dropboxSampleLayerShiftSteps,starts,rawUnchanged:true,history:true,zip:true,legacy:true,preset:true};
   });
   await page.reload();await ready();assert.equal(await page.evaluate(()=>dropboxSampleLayerShiftSteps),1);
   for(const width of [320,390,1365]){await page.setViewportSize({width,height:900});await page.evaluate(()=>{const b=document.getElementById('performanceDropboxSampleShiftRightBtn');mygrainDisplay.reveal(b);b.scrollIntoView();});assert(await right.isVisible());assert(await left.isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
   await left.click();await page.waitForFunction(()=>dropboxSampleLayerShiftSteps===0&&!mygrainCardHistory.busy);
   await right.click();await page.waitForFunction(()=>dropboxSampleLayerShiftSteps===1&&!mygrainCardHistory.busy);
   if(engine==='chromium'){
    const song=await page.evaluate(async()=>{
     stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});setLoopLayerSolo('dropbox',{silent:true,skipSave:true});setDropboxSampleLayerEnabled(true,{silent:true,skipSave:true});syncPatternLengthControls(16,{skipSave:true});
     const c=mygrainSongBeta;document.getElementById('songBetaName').value='Restructure shift fixture';await c.newSong();
     setBastardLoopShiftSteps('R',0,{silent:true,skipSave:true});await c.newPart({name:'Original',repeats:1});
     setBastardLoopShiftSteps('R',1,{silent:true,skipSave:true});await c.newPart({name:'Shifted',repeats:1});await c.finishEditing();
     for(const p of c.song.parts)await c.prepareOnServer(p,c.generation);
     await c.arm();if(!c.armed)throw Error('Song not armed after server preparation');
     const first=await c.loadRender(c.song.parts[0]),second=await c.loadRender(c.song.parts[1]);
     const a=first.getChannelData(0),b=second.getChannelData(0);let diff=0,energy=0;for(let i=0;i<Math.min(a.length,b.length);i++){diff+=(a[i]-b[i])**2;energy+=b[i]**2;}
     if(energy<1e-5||diff<1e-5)throw Error('Server shift not audible');
     const hashes=c.song.parts.map(p=>p.render.sha256);await c.arm();if(!c.armed)throw Error('Song not armed');await c.playSong();const playing=c.playing;c.stop();
     return {energy,diff,playing,warm:hashes.every((h,i)=>h===c.song.parts[i].render.sha256)};
    });assert(song.playing);assert(song.warm);console.log('Song',JSON.stringify(song));
   }
   assert.deepEqual(errors,[]);console.log('PASS',engine,JSON.stringify(state));await context.close();
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
