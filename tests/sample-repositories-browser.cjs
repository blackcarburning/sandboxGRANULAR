// Real localhost source API / generation, disposable admin store, no production writes.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18982/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'iPhone Safari',reducedMotion:'reduce'});
 assert.equal((await ctx.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-sample-repositories'}})).status(),200);
 const page=await ctx.newPage(),errors=[],builds=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(45000);
 page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/bastardloop'))builds.push(r.postDataJSON())});
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 async function start(){await page.waitForFunction(()=>window.mygrainSongBeta&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy)}
 await page.goto(base);await start();
 for(const layer of ['A','B','C','W']){const select=page.locator(`#loop${layer}Repository`);await select.selectOption('samples_loops');assert.equal(await select.inputValue(),'samples_loops');const box=await select.boundingBox();assert(box&&box.width>0&&box.width<390);}
 const generated=await page.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});applyGlobalBpm(240);syncPatternLengthControls(8,{skipSave:true});
  for(const fn of [generateBastardLoopWithPlaybackRestart,generateBastardLoop2WithPlaybackRestart,generateBastardLoop3WithPlaybackRestart,generateBastardLoopWWithPlaybackRestart])await fn();
  const buffers=[bastardLoopBuffer,bastardLoop2Buffer,bastardLoop3Buffer,bastardLoopWBuffer];
  const metadata=[bastardLoopMetadata,bastardLoop2Metadata,bastardLoop3Metadata,bastardLoopWMetadata];
  const mega=buildMegaRandomBastardLoopTaskSpecs(240).filter(s=>['A','B','C','W'].includes(s.traceLayer)).map(s=>s.getRequestPayload().source);
  const oldW=bastardLoopWMetadata.sourceKey;document.getElementById('loopWRepository').value='samples_modular';const recut=getBastardLoopWBuildPlan({reuseSamples:true}).source;document.getElementById('loopWRepository').value='samples_loops';
  const preset=gatherPreset();restoreLoopSampleRepositories();applyPreset(preset);const recalled=captureLoopSampleRepositories();
  applyPreset({...preset,loopSampleRepositories:undefined});const legacy=captureLoopSampleRepositories();applyPreset(preset);
  return{keys:metadata.map(m=>m.sourceKey),energy:buffers.map(b=>b.getChannelData(0).reduce((n,v)=>n+v*v,0)),mega,oldW,recut,recalled,legacy};
 });assert.deepEqual(generated.keys,Array(4).fill('samples_loops'));assert(generated.energy.every(n=>n>0));assert.deepEqual(generated.mega,Array(4).fill('samples_loops'));assert.equal(generated.recut,generated.oldW);assert.deepEqual(Object.values(generated.recalled),Array(4).fill('samples_loops'));assert.deepEqual(generated.legacy,{A:'sampledrop',B:'sampledrop2',C:'splice_claw',W:'samples_modular'});
 // Browser option event and real native sample decoding in each requested lane.
 for(const target of ['drumMachinePerc','drumMachineEtc']){
  await page.evaluate(target=>openDropboxSampleBrowser(target),target);
  await page.waitForFunction(()=>!dropboxSampleBrowserLoading&&!document.getElementById('dropboxSampleBrowserOverlay').hidden);
  assert((await page.locator('#dropboxSampleBrowserSourceSelect option').allTextContents()).includes('SAMPLES_PERC'));
  await page.locator('#dropboxSampleBrowserSourceSelect').selectOption('samples_perc');await page.waitForFunction(()=>!dropboxSampleBrowserLoading&&getSampleBrowserTargetConfig().sourceKey==='samples_perc');
  await page.locator(`#dropboxSampleBrowserList button:has-text("Load ${target==='drumMachinePerc'?'Perc':'ETC'}")`).first().tap();
  await page.waitForFunction(target=>!mygrainCardHistory.busy&&(target==='drumMachinePerc'?drumMachinePercMetadata:drumMachineExtraTracks.etc.metadata)?.sourceKey==='samples_perc',target);
  await page.evaluate(()=>closeDropboxSampleBrowser());
 }
 const drums=await page.evaluate(async()=>{const old=drumMachineExtraTracks.etc.buffer;await loadDrumMachineSample('etc');const saved=captureExtraDrumMachineTracks();restoreExtraDrumMachineTracks();restoreExtraDrumMachineTracks(saved);return{manual:old===drumMachineExtraTracks.etc.buffer,etc:getExtraDrumBrowserSourceKey(drumMachineExtraTracks.etc),perc:getDrumMachinePercBrowserSourceKey(),energy:[drumMachinePercBuffer,drumMachineExtraTracks.etc.buffer].map(b=>b.getChannelData(0).reduce((n,x)=>n+x*x,0))}});assert(drums.manual);assert.equal(drums.etc,'samples_perc');assert.equal(drums.perc,'samples_perc');assert(drums.energy.every(n=>n>0));
 // New repository preferences survive a real portable Song, old-format recall,
 // actual server render jobs, warm reuse and phone playback.
 const song=await page.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});setLoopLayerSolo('bastarda',{silent:true,skipSave:true});setBastardLoopEnabled(true,{silent:true,skipSave:true});
  const c=mygrainSongBeta;document.getElementById('songBetaName').value='Sample repository fixture';await c.newSong();await c.newPart({name:'New repositories',repeats:1});await c.newPart({name:'Legacy preferences',repeats:1});
  const p=c.song.parts[1],zip=await c.request(`/${c.song.id}/parts/${p.id}`,{binary:true}),entries=parseStoredZipEntries(zip),snapshot=JSON.parse(getZipText(entries,'song-part.json'));
  delete snapshot.state.modes.loopSampleRepositories;for(const layer of ['A','B','C','W'])delete snapshot.state.selects[`loop${layer}Repository`];
  const legacy=await createStoredZip([...entries].map(([path,data])=>({path,data:path==='song-part.json'?JSON.stringify(snapshot):data})));
  c.acceptSong((await c.request(`/${c.song.id}/parts/${p.id}/save?sha256=${p.sha256}`,{method:'POST',headers:{'Content-Type':'application/zip'},body:legacy})).song);await c.finishEditing();
  await c.recall(c.song.parts[0],{start:false});const recalled=captureLoopSampleRepositories();
  await c.recall(c.song.parts[1],{start:false});const old=captureLoopSampleRepositories();
  const before=c.song.parts.map(p=>p.sha256);await c.arm();if(!c.armed)throw Error(document.getElementById('songBetaStatus').textContent);
  const rms=[];for(const p of c.song.parts){const b=await c.loadRender(p),a=b.getChannelData(0);rms.push(Math.sqrt(a.reduce((n,x)=>n+x*x,0)/a.length))}
  const renders=c.song.parts.map(p=>p.render.sha256);await c.arm();const warm=c.song.parts.map(p=>p.render.sha256);await c.playSong();await new Promise(r=>setTimeout(r,100));const playing=c.playing;c.stop();
  await c.recall(c.song.parts[0],{start:false});saveState({force:true});await mygrainSongBetaAdapter.whenPersisted();
  return{recalled,old,rms,before,after:c.song.parts.map(p=>p.sha256),renders,warm,playing};
 });assert.deepEqual(Object.values(song.recalled),Array(4).fill('samples_loops'));assert.deepEqual(song.old,generated.legacy);assert(song.rms.every(n=>n>1e-6));assert.deepEqual(song.after,song.before);assert.deepEqual(song.warm,song.renders);assert(song.playing);
 await page.reload();await start();assert.deepEqual(await page.evaluate(()=>captureLoopSampleRepositories()),generated.recalled);
 for(const size of [{width:390,height:844},{width:844,height:390}]){await page.setViewportSize(size);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 assert.equal(builds.length,4);assert(builds.every(b=>b.source==='samples_loops'));assert.deepEqual(errors,[]);console.log('PASS',engine,JSON.stringify({generated,drums,song}));await ctx.close();
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
