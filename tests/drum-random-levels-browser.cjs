'use strict';
// Real drum loading and isolated Song jobs only; never production account writes.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19015/mygrain/';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
const out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp';
const candidate=process.env.MYGRAIN_CANDIDATE_INDEX;
(async()=>{const results=[];for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage(),errors=[],jobs=[];page.setDefaultTimeout(120000);
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/server-arm?'))jobs.push(r.url())});
  await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==new URL(base).origin)return r.abort();if(candidate&&u.pathname==='/mygrain/')return r.fulfill({contentType:'text/html',body:fs.readFileSync(candidate)});return r.continue()});
  assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
  await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  const checks=await page.evaluate(async()=>{
   stopAllPerformancePlayback({silent:true});
   window.drumLevelNames=['Kick','Snare','Hat','Perc','Clap','Cymbals','Etc'];
   window.drumLevels=()=>Object.fromEntries(drumLevelNames.map(n=>[n,Number(document.getElementById('drumMachine'+n+'Level').value)]));
   window.seedDrumLevels=()=>drumLevelNames.forEach((n,i)=>setSliderValue('drumMachine'+n+'Level',[0,19,100,37,5,12,93][i]));
   const rows=[];
   for(const action of ['forceDrumMachineRandomTrackLevels','applyRandomMixBalanceDefaults','randomizeMegaDrumMachineSettings','randomizeDrumMachinePatterns','randomizeDrumMachineEnvelopeShape']){
    seedDrumLevels();window[action]();rows.push({action,levels:drumLevels()});
   }
   seedDrumLevels();await loadRandomDrumMachineSamples();rows.push({action:'random drum set with real sample loads',levels:drumLevels()});
   seedDrumLevels();await loadRandomDrumMachineSamplesOnly();rows.push({action:'samples only',levels:drumLevels()});
   for(const kind of ['kick','snare','hat','clap','cymbals']){seedDrumLevels();await loadRandomSingleDrumMachineSample(kind);rows.push({action:'single '+kind,levels:drumLevels()});}
   // Stored manual values are content, not generation defaults.
   seedDrumLevels();const manual=drumLevels(),preset=gatherPreset();forceDrumMachineRandomTrackLevels();applyPreset(preset);const recalled=drumLevels();
   return{rows,manual,recalled,extra:Object.fromEntries(Object.values(drumMachineExtraTracks).map(t=>[t.kind,t.level])),snareRollSharesSnare:true};
  });
  const expected={Kick:80,Snare:80,Hat:80,Perc:80,Clap:80,Cymbals:40,Etc:80};for(const row of checks.rows)assert.deepEqual(row.levels,expected,row.action);assert.deepEqual(checks.recalled,checks.manual);
  console.log(engine,'drum routes and manual preset recall passed');
  const generation=await page.evaluate(async()=>{
   // Isolate expensive unrelated sample generation; retain the real mix/randomisation paths.
   for(const name of ['generateSourceWithPlaybackRestart','loadMegaRandomGranularSample','loadBastardLoopLSampleFromSource','loadBastardLoopXSampleFromSource','loadDropboxSampleLayerFromSource','generateBastardLoopW','randomizeBastardLoopWCut'])window[name]=async()=>null;
   mygrainD.random=async()=>null;
   requestMegaRandomBastardLoopBuild=async()=>null;applyMegaRandomBastardLoopBuild=async()=>null;restartAllTransport=()=>{};
   const rows=[];for(const mode of ['normal','mega','sparse']){seedDrumLevels();if(mode==='normal')await runPatchRandomization();else await runMegaRandomization({sparseMode:mode==='sparse',tempoDecision:false});hideSettlePopup();rows.push({mode,levels:drumLevels(),bus:drumMachineLevel});}return rows;
  });
  for(const row of generation){assert.deepEqual(row.levels,expected,row.mode);assert.equal(row.bus,.4)}
  console.log(engine,'normal/Mega/Sparse passed');
  await page.evaluate(async()=>{
   stopAllPerformancePlayback({silent:true});for(const l of SPARSE_RANDOM_LAYER_DEFINITIONS)l.setEnabled(false,{silent:true,skipSave:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});setFxMuted(true,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);for(const id of ['reverb','distortion','noiseMix','finalDriveSoft','finalDriveHard','finalDriveFold','finalDriveCrush','finalCompressorAmount','finalSidechainAmount','delayMix','delayFeedback','finalDelayDepth','finalReverbMix','oscNoiseLevel'])setSliderValue(id,0);mygrainLoopFx.restore();mygrainChannelEq.restore();mygrainNoise.restore();await mygrainCookingPot.restore();await mygrainWasp.restore();await mygrainTurntable.off();await mygrainResonator.off();await mygrainAcousticFx.off();mygrainBassFace.restore();mygrainEffectOutput.restore();setSliderValue('performanceMasterTrim',0);setSliderValue('volume',70);applyGlobalBpm(240);syncPatternLengthControls(16,{skipSave:true});setDrumMachineDirectOutput(true,{silent:true,skipSave:true});setDrumMachineEnabled(true,{silent:true,skipSave:true});restoreDrumMachineRoll();restoreDrumMachineLaneSolos([]);for(const k of ['kick','snare','hat','perc',...Object.keys(drumMachineExtraTracks)])getDrumMachinePattern(k).fill(false);getDrumMachinePattern('kick')[0]=true;setDrumMachineLevelPercent(10,{skipSave:true});setFinalPanEnabled(false,{skipSave:true});
  });
  const initial=await page.evaluate(async()=>{
   const c=mygrainSongBeta;document.getElementById('songBetaName').value='Drum level defaults '+Date.now();await c.newSong();seedDrumLevels();setSliderValue('drumMachineKickLevel',25);await c.newPart({name:'Existing manual level',repeats:1});forceDrumMachineRandomTrackLevels();await c.newPart({name:'New random level',repeats:1});await c.finishEditing();c.serverPreparation=true;c.phonePreparation=true;return{hashes:c.song.parts.map(p=>p.sha256),revision:c.song.revision};
  });
  const song=await page.evaluate(async()=>{const c=mygrainSongBeta;await c.arm();if(!c.armed)throw Error(document.getElementById('songBetaStatus').textContent);const rows=[];for(const p of c.song.parts){const b=await c.loadRender(p),a=b.getChannelData(0);let power=0,peak=0;for(const x of a){if(!Number.isFinite(x))throw Error('Nonfinite server PCM');power+=x*x;peak=Math.max(peak,Math.abs(x));}rows.push({name:p.name,frames:b.length,rate:b.sampleRate,rms:Math.sqrt(power/a.length),peak});}return{rows,hashes:c.song.parts.map(p=>p.sha256),revision:c.song.revision};});
  console.log(engine,'server PCM',JSON.stringify(song.rows));
  fs.writeFileSync(out+'/drum-levels-'+engine+'-server.json',JSON.stringify({initial,song},null,2));
  const coldJobs=jobs.length;assert.equal(coldJobs,2);assert.deepEqual(song.hashes,initial.hashes);assert.equal(song.revision,initial.revision);for(const row of song.rows){assert(row.rms>1e-6);assert.equal(row.frames,row.rate)}assert(Math.abs(song.rows[1].peak/song.rows[0].peak-3.2)<.04);
  const warm=await page.evaluate(async()=>{const c=mygrainSongBeta;await c.arm();if(!c.armed)throw Error('Warm arm failed');await c.playSong();await new Promise(r=>setTimeout(r,250));const playing=c.playing;c.stop();return{playing,hashes:c.song.parts.map(p=>p.sha256),revision:c.song.revision};});
  assert(warm.playing);assert.equal(jobs.length,coldJobs);assert.deepEqual(warm.hashes,initial.hashes);assert.equal(warm.revision,initial.revision);assert.deepEqual(errors,[]);
  results.push({engine,checks,generation,initial,song,warm,coldJobs,errors});console.log('PASS',engine,'saved manual/new levels, real server peak ratio, immutable sources, warm reuse and phone playback');await context.close();
 }finally{await browser.close()}
 }fs.writeFileSync(out+'/drum-random-levels-results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
