// Isolated accounts only. Native decoding/audio and repository API; deterministic AI recipe.
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18831/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const out='/tmp/mygrain-altbass-evidence';fs.mkdirSync(out,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(__dirname+'/../SAMPLES_ALTBASS/manifest.json'));
const sample=manifest.samples.find(s=>s.patch==='Pulse Bass'&&s.velocity===127&&s.midi===36);
const sampleId=crypto.createHash('sha256').update(require('node:path').resolve(__dirname+'/../SAMPLES_ALTBASS')+'\0'+sample.name).digest('hex');
const selection={sampleId,source:'samples_altbass',relativePath:sample.name,sha256:sample.sha256,name:require('node:path').basename(sample.name),durationS:sample.durationS,filename:{bpm:null,key:null,mode:'unknown',tags:['juno6','bass'],loopClaim:false,oneShotClaim:true},audioTentative:{note:null,key:null,bpm:null},measured:{},playbackRoot:{note:sample.rootNote,source:'Original upstream SFZ keyboard key'},warnings:[]};
const recipe={title:'Clean Juno bass',description:'Switch X to the clean analogue repository.',parameters:{performanceBastardLoopXSemitone:0,performanceBastardLoopXLevel:45},loops:{X:{repository:'samples_altbass',reload:true,sampleId,selection,notes:[36,null,36,43],enabled:true}}};
const results=[];
(async()=>{for(const[engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{for(const viewport of [{width:390,height:844},{width:844,height:390}]){
  const ctx=await browser.newContext({viewport,isMobile:true,hasTouch:true}),page=await ctx.newPage();page.setDefaultTimeout(60000);
  const errors=[],requests=[];let fail=false;page.on('pageerror',e=>errors.push(e.message));
  await ctx.request.post(base+'api/auth/register',{data:{username:'altbass'+Date.now(),password:'isolated-bass-fixture'}}).then(r=>assert.equal(r.status(),200));
  await page.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url());if(u.origin!==new URL(base).origin)return route.abort();
   if(u.pathname.endsWith('/api/ai-patch-direction'))return route.fulfill({json:{ok:true,model:'openai/gpt-6.1-sol',recipe,catalogue:{status:'ready',reason:'fixture',fallbackLanes:[]}}});
   if(u.pathname.endsWith('/api/source-sample')){requests.push({method:r.method(),source:r.method()==='POST'?r.postDataJSON().source:u.searchParams.get('source')});if(fail&&u.searchParams.get('source')==='samples_altbass')return route.fulfill({status:503,json:{error:'Fixture unavailable'}});}
   return route.continue();
  });
  try{
   await page.goto(base);await page.waitForFunction(()=>mygrainAiPatch?.ready&&document.documentElement.dataset.mygrainStartup==='ready');
   await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
   await page.locator('#performanceBastardLoopXRepository').selectOption('samples_altbass');
   await page.evaluate(()=>loadBastardLoopXSampleFromSource());
   let state=await page.evaluate(()=>({repository:bastardLoopXRepository,source:bastardLoopXSampleMetadata.sourceKey,root:bastardLoopXRootNote,frames:bastardLoopXSampleBuffer.length}));
   assert.equal(state.repository,'samples_altbass');assert.equal(state.source,'samples_altbass');assert(state.frames>1000);
   // Original AIFF PCM is decoded at its native rate, and old prepared-file
   // references are replaced, not replayed from cached converted audio.
   const originals=await page.evaluate(async sample=>{
    await loadBastardLoopXSampleFromSourceRelativePath('samples_altbass',sample.name);
    document.getElementById('performanceBastardLoopXSemitone').value='0';
    const response=await fetch(buildDropboxSampleSourcePreviewUrl('samples_altbass',sample.name));
    const bytes=await response.arrayBuffer(),info=readOriginalAiffInfo(bytes),buffer=bastardLoopXSampleBuffer;
    const view=new DataView(bytes);let pcmExact=true;
    for(let frame=0;frame<info.frames;frame+=17){const o=info.dataOffset+frame*3;let n=view.getUint8(o)*65536+view.getUint8(o+1)*256+view.getUint8(o+2);if(n>=8388608)n-=16777216;if(buffer.getChannelData(0)[frame]!==Math.fround(n/8388608)){pcmExact=false;break;}}
    const region=getBastardLoopXSampleRegion();
    const legacy={bastardLoopXRepository:'samples_altbass',bastardLoopXSourceKey:'samples_altbass',bastardLoopXFileName:'Juno6 Pulse Bass v127 C1.wav',bastardLoopXRelativePath:'Juno6 Pulse Bass v127 C1.wav',bastardLoopXRootNote:'C1'};
    const before=buffer;restoreBastardLoopXSampleSelectionFromState(legacy);const invalidated=bastardLoopXSampleBuffer===null;await ensureBastardLoopXSampleBufferReady();
    return {rate:buffer.sampleRate,frames:buffer.length,pcmExact,region,ratio:getBastardLoopXPitchRatioForNote('C2'),invalidated,replaced:bastardLoopXSampleBuffer!==before,root:bastardLoopXRootNote,path:bastardLoopXSampleMetadata.relativePath};
   },sample);
   assert.equal(originals.rate,sample.sampleRate);assert.equal(originals.frames,sample.frames);assert(originals.pcmExact);assert.equal(originals.ratio,1);assert(originals.invalidated&&originals.replaced);assert.equal(originals.root,'C2');assert.equal(originals.path,sample.name);assert.equal(originals.region.start,sample.sfzStartFrame/sample.sampleRate);
   // Run actual Mega/Sparse orchestration; keep unrelated source generators out of this bass-only test.
   const random=await page.evaluate(async()=>{
    const originals={runPatchRandomization,buildMegaRandomBastardLoopTaskSpecs,loadBastardLoopLSampleFromSource,loadDropboxSampleLayerFromSource,loadRandomDrumMachineSamples};
    runPatchRandomization=async()=>({generationProfile:createMusicalGenerationProfile()});buildMegaRandomBastardLoopTaskSpecs=()=>[];loadBastardLoopLSampleFromSource=async()=>{};loadDropboxSampleLayerFromSource=async()=>{};loadRandomDrumMachineSamples=async()=>{};
    try{await runMegaRandomization();const mega=bastardLoopXRepository;await runMegaRandomization({sparseMode:true});randomizeBastardLoopXPattern();randomizeInternalParameters({silent:true});return {mega,sparse:bastardLoopXRepository,loaded:bastardLoopXSampleMetadata.sourceKey};}
    finally{runPatchRandomization=originals.runPatchRandomization;buildMegaRandomBastardLoopTaskSpecs=originals.buildMegaRandomBastardLoopTaskSpecs;loadBastardLoopLSampleFromSource=originals.loadBastardLoopLSampleFromSource;loadDropboxSampleLayerFromSource=originals.loadDropboxSampleLayerFromSource;loadRandomDrumMachineSamples=originals.loadRandomDrumMachineSamples;stopAllPerformancePlayback({silent:true});saveState({force:true});}
   });assert.deepEqual(random,{mega:'samples_altbass',sparse:'samples_altbass',loaded:'samples_altbass'});
   await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
   assert.equal(await page.evaluate(()=>bastardLoopXRepository),'samples_altbass');
   const presetRoundtrip=await page.evaluate(()=>{const preset=gatherPreset();setBastardLoopXRepository('samples_bass',{skipSave:true});applyPreset(preset);const imported=bastardLoopXRepository;delete preset.bastardLoopXRepository;applyPreset(preset);return {imported,legacy:bastardLoopXRepository};});assert.deepEqual(presetRoundtrip,{imported:'samples_altbass',legacy:'samples_altbass'});
   // Repository selector is present in the existing sample browser too.
   await page.locator('#performanceBastardLoopXLoadBtn').click();await page.waitForFunction(()=>!document.getElementById('dropboxSampleBrowserSourceSelect').hidden);
   assert.equal(await page.locator('#dropboxSampleBrowserSourceSelect').inputValue(),'samples_altbass');assert.equal(await page.locator('#dropboxSampleBrowserSourceSelect option').count(),2);
   await page.locator('[data-mygrain-preview]').first().click();
   await page.waitForFunction(()=>createOriginalAltBassPreview.active?.playing);
   assert.match(await page.locator('#dropboxSampleBrowserStatus').textContent(),/Previewing/);
   await page.evaluate(()=>closeDropboxSampleBrowser());
   assert.equal(await page.evaluate(()=>createOriginalAltBassPreview.active?.playing),false);
   // AI explicit switch is transactional and Undo restores repository AND source mode/audio.
   await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});setBastardLoopLSourceMode('sample',{silent:true,skipSave:true});setBastardLoopXSourceMode('synth',{silent:true,skipSave:true});setBastardLoopXRepository('samples_bass');window.__beforeBass=bastardLoopXSampleBuffer;});
   await page.locator('#aiPatchPrompt').fill('Change only X to clean Juno analogue bass');await page.locator('#aiPatchGenerate').click();await page.waitForFunction(()=>!mygrainAiPatch.busy);
   assert.match(await page.locator('#aiPatchStatus').textContent(),/^Applied/);
   assert.equal(await page.evaluate(()=>bastardLoopXRepository),'samples_altbass');assert.equal(await page.evaluate(()=>bastardLoopXSourceMode),'sample');assert.equal(await page.evaluate(()=>bastardLoopXRootNote),sample.rootNote);
   // Native sampler transport has non-silent audio.
   const energy=await page.evaluate(async()=>{
    const analyser=audioContext.createAnalyser();analyser.fftSize=2048;const tap=getBastardLoopXPlaybackDestination();tap.connect(analyser);setBastardLoopXEnabled(true,{silent:true,skipSave:true});setBastardLoopPlaying(true,{silent:true,skipSave:true});let peak=0;
    for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,80));const a=new Float32Array(2048);analyser.getFloatTimeDomainData(a);for(const n of a)peak=Math.max(peak,Math.abs(n));}stopAllPerformancePlayback({silent:true});tap.disconnect(analyser);analyser.disconnect();return peak;
   });assert(energy>.001,'Native Loop X output silent');
   await page.locator('#aiPatchUndo').click();await page.waitForFunction(()=>!mygrainAiPatch.busy);assert.match(await page.locator('#aiPatchStatus').textContent(),/^Undone/);
   assert.deepEqual(await page.evaluate(()=>({repo:bastardLoopXRepository,mode:bastardLoopXSourceMode,same:bastardLoopXSampleBuffer===__beforeBass})),{repo:'samples_bass',mode:'synth',same:true});
   // Targeted Refine can request the same explicit repository switch.
   await page.locator('#aiPatchRefinement').fill('Switch X to the clean Juno repository');await page.locator('#aiPatchRefine').click();await page.waitForFunction(()=>!mygrainAiPatch.busy);assert.match(await page.locator('#aiPatchStatus').textContent(),/^Applied/);
   await page.locator('#aiPatchUndo').click();await page.waitForFunction(()=>!mygrainAiPatch.busy);
   fail=true;await page.locator('#aiPatchGenerate').click();await page.waitForFunction(()=>!mygrainAiPatch.busy);assert.match(await page.locator('#aiPatchStatus').textContent(),/Fixture unavailable/);assert.equal(await page.evaluate(()=>bastardLoopXRepository),'samples_bass');fail=false;
   assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.evaluate(()=>{document.getElementById('aiActivityClose')?.click();setBastardLoopXRepository('samples_altbass');});await page.locator('#performanceBastardLoopXRepository').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/'+engine+'-'+viewport.width+'.png'});
   results.push({engine,viewport,state,originals,random,energy,sourceRequests:requests.length,checks:['real-library-decode','Mega/Sparse-repository-preservation','reload-persistence','preset-and-legacy-import','browser-selector','AI-switch','Refine-switch','Undo-source-and-repository','failed-load-rollback','non-silent-native-X','no-page-errors','no-overflow']});console.log(JSON.stringify(results.at(-1)));
  }catch(e){console.error('STATE',await page.evaluate(()=>({status:document.getElementById('aiPatchStatus')?.textContent,log:document.getElementById('aiPatchChanges')?.textContent})));throw e;}finally{await ctx.close();}
 }}finally{await browser.close();}
}fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
