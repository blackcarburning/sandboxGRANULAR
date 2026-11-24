'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = 'http://127.0.0.1:19032/mygrain/';
(async()=>{
 for(const [engine,type] of Object.entries({chromium,webkit})){
  const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844}});
   assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-public-samples'}})).status(),200);
   const page=await context.newPage(),errors=[]; page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(60000);
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainCardHistory);
   await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').click();
   await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   const v1=Array.from(fs.readFileSync('/root/.openclaw/workspace/output/mygrain-restructure-20261121T185303Z/new-source.zip'));
   await page.evaluate(async bytes=>{
    const a=mygrainSongBetaAdapter,p=await a.decode(Uint8Array.from(bytes).buffer,{buffers:new Map(),bytes:0});
    a.recall(p,{start:false});await a.whenPersisted();
    if(dropboxSampleLayerMetadata?.restructure?.grains!==64||dropboxSampleLayerMetadata.restructure.grainNote!=='1/256'||!dropboxSampleLayerRawBuffer.length)throw Error('Original Restructure patch must retain 1/256 audio and metadata');
   },v1);
   const legacy=Array.from(fs.readFileSync('/root/.openclaw/workspace/output/mygrain-public-samples-20261121T183621Z/public-source.zip'));
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
   assert(old.length>0);assert.equal(old.grains,null);assert.equal(old.level,'93');
   await page.evaluate(()=>{const b=document.getElementById('performanceDropboxSampleLoadBtn');mygrainDisplay.reveal(b);b.scrollIntoView();});
   assert.equal((await page.locator('#performanceDropboxSampleLoadBtn').textContent()).trim(),'Restructure');
   assert.equal(await page.locator('#performanceDropboxSampleBrowseBtn').isVisible(),false);
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
   assert.equal(result.grains,16);assert.equal(generatedPayload.metadata.grainNote,'1/16');assert(generatedPayload.metadata.effect.name);assert(generatedPayload.metadata.gapSteps.length>=2);assert.equal(result.frames,result.expected);assert.equal(result.stereo,2);assert(result.level<=.7);assert.equal(result.source,'samples_public');
   for(const key of ['barFit','undoLegacy','redo','zipRecipe','zipPcm','legacy'])assert.equal(result[key],true,key);
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
   if(engine==='chromium'){
    fs.writeFileSync(process.env.MYGRAIN_TEST_OUTPUT+'/new-source.zip',Buffer.from(await page.evaluate(()=>restructureZip)));
    const song=await page.evaluate(async()=>{
     stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});setLoopLayerSolo('dropbox',{silent:true,skipSave:true});setDropboxSampleLayerEnabled(true,{silent:true,skipSave:true});syncPatternLengthControls(16,{skipSave:true});
     const c=mygrainSongBeta;document.getElementById('songBetaName').value='Restructure fixture';await c.newSong();await c.newPart({name:'GPU grains',repeats:1});await c.finishEditing();await c.prepareOnServer(c.song.parts[0],c.generation);await c.arm();
     if(!c.armed)throw Error(document.getElementById('songBetaStatus').textContent);
     const render=await c.loadRender(c.song.parts[0]);let energy=0;for(const x of render.getChannelData(0))energy+=x*x;
     const hash=c.song.parts[0].render.sha256;await c.arm();await c.playSong();const playing=c.playing;c.stop();return {energy,playing,warm:hash===c.song.parts[0].render.sha256};
    });assert(song.energy>1e-5);assert(song.playing);assert(song.warm);console.log('Song',JSON.stringify(song));
   }
   for(const width of [390,1365]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
   assert.deepEqual(errors,[]);console.log('PASS',engine,JSON.stringify(result));await context.close();
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
