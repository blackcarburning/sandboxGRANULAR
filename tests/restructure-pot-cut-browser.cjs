'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_BASE || 'http://127.0.0.1:19033/mygrain/';
(async()=>{
 for(const [engine,type] of Object.entries({chromium,webkit})){
  const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844}});
   assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-public-samples'}})).status(),200);
   const page=await context.newPage(),errors=[]; page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.stack);});page.setDefaultTimeout(60000);
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainCardHistory);
   await page.evaluate(()=>mygrainCardHistory.ready);console.log(engine,'history ready');await page.locator('#start-btn').click();
   await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   console.log(engine,'engine ready');const v1=Array.from(fs.readFileSync('/root/.openclaw/workspace/output/mygrain-restructure-20261121T185303Z/new-source.zip'));
   await page.evaluate(async bytes=>{
    const a=mygrainSongBetaAdapter,p=await a.decode(Uint8Array.from(bytes).buffer,{buffers:new Map(),bytes:0});
    a.recall(p,{start:false});await a.whenPersisted();
    if(dropboxSampleLayerMetadata?.restructure?.grains!==64||dropboxSampleLayerMetadata.restructure.grainNote!=='1/256'||!dropboxSampleLayerRawBuffer.length)throw Error('Original Restructure patch must retain 1/256 audio and metadata');
   },v1);
   console.log(engine,'archived v1 recalled');const legacy=Array.from(fs.readFileSync('/root/.openclaw/workspace/output/mygrain-public-samples-20261121T183621Z/public-source.zip'));
   const old=await page.evaluate(async bytes=>{
    const a=mygrainSongBetaAdapter, p=await a.decode(Uint8Array.from(bytes).buffer,{buffers:new Map(),bytes:0});
    a.recall(p,{start:false});await a.whenPersisted();
    // A legacy patch's source choice, volume and timing must not be generation-clamped.
    const preset=gatherPreset();preset.dropboxSampleSourceKey='sampledrop';applyPreset(preset);
    setSliderValue('performanceDropboxSampleLevel',93);dropboxSampleLayerStretchToLoop=false;
    window.oldLive=await a.capture({liveOnly:true});window.oldMeta=JSON.stringify(dropboxSampleLayerMetadata);
    window.oldPcm=Array.from(dropboxSampleLayerRawBuffer.getChannelData(0));
    return {length:oldPcm.length,grains:dropboxSampleLayerMetadata?.restructure||null,level:document.getElementById('performanceDropboxSampleLevel').value};
   },legacy);
   console.log(engine,'legacy recalled');assert(old.length>0);assert.equal(old.grains,null);assert.equal(old.level,'93');
   await page.evaluate(()=>{const b=document.getElementById('performanceDropboxSampleLoadBtn');mygrainDisplay.reveal(b);b.scrollIntoView();});
   assert.equal((await page.locator('#performanceDropboxSampleLoadBtn').textContent()).trim(),'Restructure');
   assert.equal(await page.locator('#performanceDropboxSampleBrowseBtn').isVisible(),false);
   // UI-only division edits affect next generation, not the stored source.
   const originalBefore=await page.evaluate(()=>dropboxSampleLayerRawBuffer);
   console.log(engine,'division controls');await page.locator('#performanceRestructureDivisionEighth').check();
   await page.locator('#performanceRestructureDivisionSixteenth').uncheck();
   assert.deepEqual(await page.evaluate(()=>getSelectedRestructureDivisions()),['1/8']);
   const responseReady=page.waitForResponse(r=>r.url().endsWith('/api/restructure')&&r.request().method()==='POST');
   await page.locator('#performanceDropboxSampleLoadBtn').click();
   const generatedPayload=await (await responseReady).json();
   await page.waitForFunction(()=>dropboxSampleLayerMetadata?.restructure?.engine==='CUDA'&&!dropboxSampleLayerLoadInFlight&&!mygrainCardHistory.busy);
   const result=await page.evaluate(async()=>{
    const a=mygrainSongBetaAdapter,m=dropboxSampleLayerMetadata.restructure,b=dropboxSampleLayerRawBuffer;
    const pcm=Array.from(b.getChannelData(0)),meta=JSON.stringify(dropboxSampleLayerMetadata);
    const state={grains:m.grains,frames:dropboxSampleLayerBuffer.length,expected:Math.round(dropboxSampleLayerBuffer.sampleRate*240/m.bpm),stereo:b.numberOfChannels,level:getDropboxSampleLayerLevelValue({applyLayerToggle:false}),source:dropboxSampleLayerMetadata.sourceKey,barFit:dropboxSampleLayerStretchToLoop};
    await mygrainCardHistory.undo();
    state.undoLegacy=JSON.stringify(dropboxSampleLayerMetadata)===oldMeta&&document.getElementById('performanceDropboxSampleLevel').value==='93'&&!dropboxSampleLayerStretchToLoop&&oldPcm.every((x,i)=>x===dropboxSampleLayerRawBuffer.getChannelData(0)[i]);
    await mygrainCardHistory.redo();state.redo=JSON.stringify(dropboxSampleLayerMetadata)===meta&&pcm.every((x,i)=>x===dropboxSampleLayerRawBuffer.getChannelData(0)[i]);
    const zip=await a.capture();window.restructureZip=Array.from(new Uint8Array(await zip.arrayBuffer()));
    const part=await a.decode(Uint8Array.from(restructureZip).buffer,{buffers:new Map(),bytes:0});a.recall(part,{start:false});await a.whenPersisted();
    state.zipRecipe=JSON.stringify(dropboxSampleLayerMetadata)===meta;
    state.zipPcm=pcm.every((x,i)=>Math.abs(x-dropboxSampleLayerRawBuffer.getChannelData(0)[i])<.0001);
    const legacy=oldLive;a.recall(legacy,{start:false});
    state.legacy=JSON.stringify(dropboxSampleLayerMetadata)===oldMeta&&document.getElementById('performanceDropboxSampleSource').value==='sampledrop'&&getDropboxSampleLayerLevelValue({applyLayerToggle:false})===.93;
    a.recall(part,{start:false});await a.whenPersisted();
    window.keepBefore=dropboxSampleLayerRawBuffer;window.metaBefore=JSON.stringify(dropboxSampleLayerMetadata);
    return state;
   });
   assert.deepEqual(generatedPayload.metadata.divisions,['1/8']);assert.equal(generatedPayload.metadata.version,4);
   assert.equal(result.grains,8);assert.equal(generatedPayload.metadata.grainNote,'1/8');assert(generatedPayload.metadata.effect.name);assert(generatedPayload.metadata.gapSteps.length>=2);assert.equal(result.frames,result.expected);assert.equal(result.stereo,2);assert(result.level<=.7);assert.equal(result.source,'samples_public');
   for(const key of ['barFit','undoLegacy','redo','zipRecipe','zipPcm','legacy'])assert.equal(result[key],true,key);
   assert.deepEqual(await page.evaluate(()=>getSelectedRestructureDivisions()),['1/8']);
   // Late cut edits invalidate a pending generation without replacing audio.
   await page.route('**/api/restructure',async r=>{await page.evaluate(()=>setRestructureCut({enabled:true,start:.25,end:.5},{skipSave:true}));await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(generatedPayload)});});
   assert(await page.evaluate(async()=>{const old=dropboxSampleLayerRawBuffer;try{await loadDropboxSampleLayerFromSourceImpl();}catch{}return old===dropboxSampleLayerRawBuffer&&restructureCut.enabled;}));
   await page.unroute('**/api/restructure');
   // A failure after PCM installation restores cut, source, metadata and level.
   await page.route('**/api/restructure',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(generatedPayload)}));
   assert(await page.evaluate(async()=>{
    const fn=applyLoadedDropboxSampleLayerBuffer,before=dropboxSampleLayerRawBuffer,cut=JSON.stringify(restructureCut),meta=JSON.stringify(dropboxSampleLayerMetadata),level=getDropboxSampleLayerLevelValue({applyLayerToggle:false});
    applyLoadedDropboxSampleLayerBuffer=async(...args)=>{await fn(...args);throw Error('injected post-install failure');};
    try{try{await loadDropboxSampleLayerFromSourceImpl();}catch{}return before===dropboxSampleLayerRawBuffer&&cut===JSON.stringify(restructureCut)&&meta===JSON.stringify(dropboxSampleLayerMetadata)&&level===getDropboxSampleLayerLevelValue({applyLayerToggle:false});}
    finally{applyLoadedDropboxSampleLayerBuffer=fn;setRestructureCut(null,{skipSave:true});}
   }));await page.unroute('**/api/restructure');
   // Failed and stale requests retain the previous source, with truthful cleared busy state.
   await page.route('**/api/restructure',r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:'Fixture GPU unavailable'})}));
   const failure=await page.evaluate(async()=>{try{await loadDropboxSampleLayerFromSourceImpl();}catch{}return keepBefore===dropboxSampleLayerRawBuffer&&metaBefore===JSON.stringify(dropboxSampleLayerMetadata)&&!dropboxSampleLayerLoadInFlight;});assert(failure);
   await page.unroute('**/api/restructure');
   await page.route('**/api/restructure',async r=>{await page.evaluate(()=>{sourceMutationSerial++;});await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(generatedPayload)});});
   const stale=await page.evaluate(async()=>{try{await loadDropboxSampleLayerFromSourceImpl();}catch{}return keepBefore===dropboxSampleLayerRawBuffer&&metaBefore===JSON.stringify(dropboxSampleLayerMetadata)&&!dropboxSampleLayerLoadInFlight;});assert(stale);
   await page.unroute('**/api/restructure');
   // The actual Mega/Sparse task runs beside Grain A/B: their serial mutation is legitimate.
   await page.route('**/api/restructure',async r=>{await page.evaluate(()=>setSourceBuffer('grainASample',audioContext.createBuffer(2,1000,audioContext.sampleRate),'parallel fixture'));await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(generatedPayload)});});
   const parallel=await page.evaluate(async()=>{const old=dropboxSampleLayerRawBuffer;megaRandomizeInFlight=true;megaRandomCommentary={message(){}};try{await loadDropboxSampleLayerFromSourceImpl();return old!==dropboxSampleLayerRawBuffer&&dropboxSampleLayerMetadata.restructure.engine==='CUDA'&&getDropboxSampleLayerLevelValue({applyLayerToggle:false})<=.7;}finally{megaRandomizeInFlight=false;megaRandomCommentary=null;}});assert(parallel);
   await page.unroute('**/api/restructure');
   // A changed division choice invalidates an in-flight generation without losing prior audio.
   await page.route('**/api/restructure',async r=>{await page.evaluate(()=>applyRestructureDivisions(['1/4'],{save:false}));await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(generatedPayload)});});
   assert(await page.evaluate(async()=>{const old=dropboxSampleLayerRawBuffer;try{await loadDropboxSampleLayerFromSourceImpl();}catch{}return old===dropboxSampleLayerRawBuffer&&getSelectedRestructureDivisions()[0]==='1/4';}));
   await page.unroute('**/api/restructure');await page.evaluate(()=>applyRestructureDivisions(['1/8'],{save:false}));
   // Both native generation entry points reach the shared division randomizer exactly once.
   const entryPoints=await page.evaluate(async()=>{
    const original=randomizeRestructureDivisions,master=mygrainMasterBaker.randomiseOff;let calls=0;
    randomizeRestructureDivisions=()=>{calls++;return original();};
    mygrainMasterBaker.randomiseOff=()=>{throw Error('unrelated-generator-fixture-boundary');};
    try{
     megaRandomizeInFlight=false;try{await runPatchRandomizationImpl();}catch(e){if(e.message!=='unrelated-generator-fixture-boundary')throw e;}
     const normal=calls;calls=0;megaRandomizeInFlight=true;randomizeMegaDropboxSampleLayerSettings();
     try{await runPatchRandomizationImpl();}catch(e){if(e.message!=='unrelated-generator-fixture-boundary')throw e;}
     return {normal,batch:calls,values:getSelectedRestructureDivisions()};
    }finally{randomizeRestructureDivisions=original;mygrainMasterBaker.randomiseOff=master;megaRandomizeInFlight=false;applyRestructureDivisions(['1/8'],{save:false});}
   });assert.equal(entryPoints.normal,1);assert.equal(entryPoints.batch,1);
   // The actual card Randomise chooses divisions AND builds real CUDA audio with gaps.
   const randomResponse=page.waitForResponse(r=>r.url().endsWith('/api/restructure')&&r.request().method()==='POST');
   await page.locator('#performanceRestructureRandomiseBtn').click();const randomPayload=await (await randomResponse).json();
   await page.waitForFunction(()=>!dropboxSampleLayerLoadInFlight&&!mygrainCardHistory.busy&&dropboxSampleLayerMetadata?.restructure?.version===4);
   assert(randomPayload.ok);assert(randomPayload.metadata.divisions.length>=1);assert(randomPayload.metadata.gapSteps.length>=2);
   assert.deepEqual(await page.evaluate(()=>getSelectedRestructureDivisions()),randomPayload.metadata.divisions);
   await page.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual(await page.evaluate(()=>getSelectedRestructureDivisions()),['1/8']);
   await page.evaluate(()=>mygrainCardHistory.redo());assert.deepEqual(await page.evaluate(()=>getSelectedRestructureDivisions()),randomPayload.metadata.divisions);
   // Failed Randomise must also restore its previous division preference.
   await page.route('**/api/restructure',r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:'Fixture failure'})}));
   assert(await page.evaluate(async()=>{const before=JSON.stringify(getSelectedRestructureDivisions()),audio=dropboxSampleLayerRawBuffer;try{await loadDropboxSampleLayerFromSourceImpl({randomiseDivisions:true});}catch{}return before===JSON.stringify(getSelectedRestructureDivisions())&&audio===dropboxSampleLayerRawBuffer;}));await page.unroute('**/api/restructure');
   if(engine==='chromium'){
    fs.writeFileSync(process.env.MYGRAIN_TEST_OUTPUT+'/new-source.zip',Buffer.from(await page.evaluate(()=>restructureZip)));
    const song=await page.evaluate(async()=>{
     stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});setLoopLayerSolo('dropbox',{silent:true,skipSave:true});setDropboxSampleLayerEnabled(true,{silent:true,skipSave:true});syncPatternLengthControls(16,{skipSave:true});
     const c=mygrainSongBeta;document.getElementById('songBetaName').value='Restructure fixture';await c.newSong();await c.newPart({name:'GPU grains',repeats:1});
     const beforeContent=c.song.parts[0].contentSha256;applyRestructureDivisions(['uncut'],{save:false});await c.newPart({name:'Future choices only',repeats:1});
     if(beforeContent!==c.song.parts[1].contentSha256)throw Error('Next-generation divisions changed stored PCM render identity');
     await c.finishEditing();await c.prepareOnServer(c.song.parts[0],c.generation);await c.arm();
     if(!c.armed)throw Error(document.getElementById('songBetaStatus').textContent);
     const render=await c.loadRender(c.song.parts[0]);let energy=0;for(const x of render.getChannelData(0))energy+=x*x;
     const hash=c.song.parts[0].render.sha256;await c.arm();await c.playSong();const playing=c.playing;c.stop();return {energy,playing,warm:hash===c.song.parts[0].render.sha256};
    });assert(song.energy>1e-5);assert(song.playing);assert(song.warm);console.log('Song',JSON.stringify(song));
   }
   for(const width of [390,1365]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
   assert.deepEqual(errors,[]);console.log('PASS',engine,JSON.stringify({...result,entryPoints,randomDivisions:randomPayload.metadata.divisions,randomGrains:randomPayload.metadata.grains,gaps:randomPayload.metadata.gapSteps}));await context.close();
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
