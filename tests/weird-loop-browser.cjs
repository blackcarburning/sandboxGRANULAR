// Local disposable stores only; real modular generation, Web Audio and account-scoped downloads.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18952/mygrain/';assert.match(base,/^http:\/\/127\.0\.0\.1:18952\/mygrain\/$/);
(async()=>{const results=[];for(const[engine,type]of Object.entries(process.env.WEIRD_EXTENDED?{chromium}:{chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{for(const mobile of (process.env.WEIRD_EXTENDED?[false]:[false,true])){
  const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(45000);
  assert.equal((await ctx.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-weird-test'}})).status(),200);
  await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  await page.goto(base);await page.waitForFunction(()=>window.mygrainWEffects&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});syncPatternLengthControls(16);});
  console.log('GENERATE',engine,mobile);await page.locator('#performanceGenerateBastardLoopWBtn').click();await page.waitForFunction(()=>bastardLoopWBuffer&&!bastardLoopWGenerationInFlight&&!mygrainCardHistory.busy,{},{timeout:180000});
  const generation=await page.evaluate(()=>({duration:bastardLoopWBuffer.duration,key:bastardLoopWMetadata.sourceKey,names:bastardLoopWMetadata.sampleNames,sourceCount:buildMegaRandomBastardLoopTaskSpecs(120).filter(s=>s.traceLayer==='W').length}));assert.equal(generation.key,'samples_modular');assert(generation.names.length);assert.equal(generation.sourceCount,1);

  if(process.env.WEIRD_EXTENDED){
   console.log('MEGA W / RECUT');
   const rebuilt=await page.evaluate(async()=>{
    const task=buildMegaRandomBastardLoopTaskSpecs(120).find(s=>s.traceLayer==='W'),payload=task.getRequestPayload();
    const result=await requestGeneratedBastardLoopAudio(payload,{traceLayer:'W',fallbackSourceKey:'samples_modular'});
    await task.applyBuffer(await audioContext.decodeAudioData(result.arrayBuffer.slice(0)),result.metadata);
    const before=getBastardLoopSampleRefs('W');await generateBastardLoopWWithPlaybackRestart({reuseSamples:true});
    return{source:payload.source,before,after:getBastardLoopSampleRefs('W')};
   });assert.equal(rebuilt.source,'samples_modular');assert(rebuilt.before.length);assert(rebuilt.after.every(name=>rebuilt.before.includes(name)));
  }
  console.log('AUDIO',engine,mobile);const audio=await page.evaluate(async()=>{
   for(const layer of SPARSE_RANDOM_LAYER_DEFINITIONS)layer.setEnabled(false,{silent:true,skipSave:true});setDrumMachineEnabled(false,{silent:true,skipSave:true});setBastardLoopWEnabled(true,{silent:true,skipSave:true});
   setBastardLoopPlaying(true,{silent:true,skipSave:true});if(!bastardLoopWSource)throw Error('W missing from shared transport');
   const graph=mygrainWEffects.controller.graph,a=audioContext.createAnalyser();a.fftSize=2048;graph.pan.connect(a);let peak=0;
   for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,20));const d=new Float32Array(a.fftSize);a.getFloatTimeDomainData(d);for(const x of d)peak=Math.max(peak,Math.abs(x));}graph.pan.disconnect(a);a.disconnect();
   setBastardLoopWReverse(true,{silent:true,skipSave:true});setBastardLoopWPitchSemitones(7,{silent:true,skipSave:true});setBastardLoopShiftSteps('W',2,{silent:true,skipSave:true});
   setBastardLoopWCut({enabled:true,start:.2,end:.7,repeat:true,stretch:true,targetStart:0,targetDuration:.4},{skipSave:true});
   if(!bastardLoopWSource)throw Error('W edits stopped transport');
   stopAllPerformancePlayback({silent:true});if(bastardLoopWSource)throw Error('W ignored Stop');
   let on=0;for(let i=0;i<100;i++)if(chooseSparseRandomLayerSelection().some(l=>l.key==='bastardw'))on++;
   return{peak,on,cut:bastardLoopWCut,reverse:bastardLoopWReverse,shift:bastardLoopWShiftSteps};
  });assert(audio.peak>.0001,JSON.stringify(audio));assert(audio.on>0&&audio.on<100);
  await page.locator('#performanceBastardLoopWCutBtn').click();assert(await page.locator('#bastardLoopWCutOverlay').isVisible());assert(await page.locator('#bastardLoopVCutOverlay').evaluate(e=>e.hidden));await page.locator('#bastardLoopWCutClose').click();
  const effects=await page.evaluate(()=>{const qRoom=mygrainQ.state.room;bastardLoopWEffects={room:.3,reverbDecay:6,reverbSize:.9,reverbPredelay:40,reverbDamping:5000,reverbLowcut:200,reverbWidth:1,delay:.25,delayBeats:.75,feedback:.4};mygrainWEffects.sync();saveState();return{qRoom,after:mygrainQ.state.room,delay:mygrainWEffects.controller.graph.delay.delayTime.value,wet:mygrainWEffects.controller.state.room};});assert.equal(effects.qRoom,effects.after);assert.equal(effects.wet,.3);
  console.log('PORTABLE',engine,mobile);const portable=await page.evaluate(async()=>{const blob=await mygrainSongBetaAdapter.capture(),snap=mygrainSongBetaAdapter.inspectPart(await blob.arrayBuffer()).snapshot;return{asset:snap.assets.some(a=>a.key==='bastardW'),cut:snap.state.modes.bastardLoopWCut,effects:snap.state.modes.bastardLoopWEffects};});assert(portable.asset);assert(portable.cut.enabled);assert.equal(portable.effects.room,.3);
  if(process.env.WEIRD_EXTENDED){
   console.log('SONG RENDER W');const rendered=await page.evaluate(async()=>{setBastardLoopWEnabled(true,{silent:true,skipSave:true});loopLayerSolo=[];const part=await mygrainSongBetaAdapter.capture({liveOnly:true});const b=await mygrainSongBetaAdapter.renderPart(part,{bpm:300,patternSteps:16,repeats:1,patternCycleMultiplier:1},new AbortController().signal);let peak=0;for(const x of b.getChannelData(0)){if(!Number.isFinite(x))throw Error('Invalid rendered audio');peak=Math.max(peak,Math.abs(x));}return{peak,seconds:b.duration};});assert(rendered.peak>.0001,JSON.stringify(rendered));console.log('RENDERED',rendered);
  }
  // Browser buttons must remain inside this tab and use the proper repository API.
  for(const id of ['performanceBastardLoopBrowserBtn','performanceBastardLoop2BrowserBtn','performanceBastardLoop3BrowserBtn','performanceBastardLoopVBrowserBtn','performanceBastardLoopWBrowserBtn','performanceBastardLoopPBrowserBtn','performanceBastardLoopOBrowserBtn']){
   const b=page.locator('#'+id);if(!await b.count())throw Error('Missing browser '+id);await b.click();await page.waitForFunction(()=>!document.getElementById('bastardloopRepositoryOverlay').hidden);
   const frame=page.frameLocator('#bastardloopRepositoryOverlay iframe');await frame.locator('h1').waitFor();assert.match(await frame.locator('h1').innerText(),/Bastardloop/i);assert.equal(ctx.pages().length,1);await page.locator('#bastardloopRepositoryOverlay>button').click();
  }
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>bastardLoopWBuffer&&!stateSaveSuspended);const restored=await page.evaluate(()=>({duration:bastardLoopWBuffer.duration,cut:bastardLoopWCut,fx:bastardLoopWEffects,shift:bastardLoopWShiftSteps}));assert(restored.cut.enabled);assert.equal(restored.fx.room,.3);assert.equal(restored.shift,2);
  if(process.env.WEIRD_EXTENDED){
   const legacy=await page.evaluate(async()=>{
    mygrainWEffects.input();applyGlobalBpm(150);await new Promise(r=>setTimeout(r,250));const delay=mygrainWEffects.controller.graph.delay.delayTime.value;
    const part=await mygrainSongBetaAdapter.capture({liveOnly:true});part.buffers.delete('bastardW');for(const k of Object.keys(part.snapshot.state.modes))if(k.startsWith('bastardLoopW'))delete part.snapshot.state.modes[k];part.snapshot.extra.controls=part.snapshot.extra.controls.filter(c=>!c.id.includes('BastardLoopW')&&!c.id.startsWith('weirdFx-')&&!c.id.includes('BastardWDivision'));delete part.snapshot.extra.metadata.bastardW;mygrainSongBetaAdapter.recall(part,{start:false});
    return{delay,buffer:!!bastardLoopWBuffer,enabled:bastardLoopWEnabled};
   });assert(Math.abs(legacy.delay-.3)<.001,JSON.stringify(legacy));assert.equal(legacy.buffer,false);assert.equal(legacy.enabled,false);console.log('LEGACY / BPM PASS',legacy);
  }
  assert.deepEqual(errors,[]);results.push({engine,mobile,generation,audio,effects,portable,restored});console.log('PASS',engine,mobile?'phone':'desktop');fs.writeFileSync('/tmp/mygrain-weird-results.json',JSON.stringify(results,null,2));await ctx.close();
 }}finally{await browser.close()}}
})().catch(e=>{console.error(e);process.exitCode=1});
