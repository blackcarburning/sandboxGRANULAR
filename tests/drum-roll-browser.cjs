// Real UI/touch and Web Audio, isolated localhost accounts/Songs only.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18891/mygrain/';
assert.match(base,/^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
const evidence=process.env.ROLL_EVIDENCE||'/tmp/mygrain-drum-roll';fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const results=[];
 for(const engine of (process.env.ROLL_ENGINE ? [process.env.ROLL_ENGINE] : ['chromium','webkit'])){
  const browser=await({chromium,webkit}[engine]).launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{for(const mobile of (process.env.ROLL_MODE ? [process.env.ROLL_MODE==='phone'] : [false,true])){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
   assert.equal((await context.request.post(base+'api/auth/register',{data:{username:`r_${engine[0]}_${+mobile}_${Date.now()}`,password:'isolated-roll-check'}})).status(),200);
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(60000);page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)});
   await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
   console.log('START',engine,mobile);await page.goto(base);await page.waitForFunction(()=>window.mygrainSongBeta&&document.documentElement.dataset.mygrainStartup==='ready');
   const press=async selector=>{if(mobile)await page.locator(selector).tap();else await page.locator(selector).click();};
   await press('#start-btn');await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   await page.evaluate(async()=>{
    stopAllPerformancePlayback({silent:true});setLoopLayerSolo('none',{silent:true,skipSave:true});applyGlobalBpm(300);syncPatternLengthControls(16,{skipSave:true});
    setDrumMachineDirectOutput(true,{silent:true,skipSave:true});setDrumMachineEnabled(true,{silent:true,skipSave:true});
    setOscillatorsEnabled(false,{silent:true,skipSave:true});setGranularLayersEnabled(false,{silent:true,skipSave:true});window.mygrainQ.setState?.({enabled:false});
    const buffer=audioContext.createBuffer(1,Math.round(audioContext.sampleRate*.055),audioContext.sampleRate);const data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=.25*Math.sin(2*Math.PI*433*i/buffer.sampleRate);
    await applyLoadedDrumMachineSampleBuffer('snare',buffer,{sourceKey:'samples_snare',fileName:'roll-snare.wav'});
    for(const p of [drumMachineKickPattern,drumMachineSnarePattern,drumMachineHatPattern,drumMachinePercPattern])p.fill(false);
    for(const t of Object.values(drumMachineExtraTracks)){t.pattern.fill(false);t.ratchets.fill(0);t.accents.fill(false);}
    drumMachineSnarePattern[12]=true;drumMachineSnareRatchetPattern.fill(1);
    for(const [suffix,value]of Object.entries({Pitch:3,Level:70,Decay:100,Length:100,Distortion:0})){const el=document.getElementById('drumMachineSnare'+suffix);if(el){el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}}
    openDrumMachineOverlay();
   });
   console.log('UI ready',engine,mobile);await press('[data-drum-jump="roll"]');assert.equal(await page.locator('.drum-machine-jumps button').count(),8);
   await page.locator('#drumMachineRollLength').fill('128');await page.locator('#drumMachineRollLength').press('Tab');
   await page.waitForFunction(()=>drumMachineRoll.length===128);
   await page.locator('#drumMachineRollPage').selectOption('3');await press('[data-roll-step="124"]');
   for(let i=0;i<3;i++)await press('#drumMachineRollGrid .drum-machine-step-cell:nth-child(29) .drum-machine-ratchet-btn');
   assert.equal(await page.evaluate(()=>drumMachineRoll.ratchets[124]),4);
   await page.evaluate(()=>mygrainCardHistory.undo());assert.equal(await page.evaluate(()=>drumMachineRoll.ratchets[124]),3);
   await page.evaluate(()=>mygrainCardHistory.redo());assert.equal(await page.evaluate(()=>drumMachineRoll.ratchets[124]),4);
   // Global grid resizing must not resize or repeat the independent Roll.
   const lengths=await page.evaluate(()=>{const result=[];for(const n of[64,8,16]){syncPatternLengthControls(n,{skipSave:true});result.push([getDrumMachinePatternLength(),drumMachineRoll.length,drumMachineRoll.pattern.filter(Boolean).length,drumMachineRoll.pattern[124]]);}return result;});
   assert.deepEqual(lengths,[[64,128,1,true],[8,128,1,true],[16,128,1,true]]);
   // Restore one overlap Snare; actual live audio scheduling across two long cycles.
   await page.evaluate(()=>{
    drumMachineSnarePattern.fill(false);drumMachineSnarePattern[12]=true;
    window.rollHits=[];const original=playDrumMachineHit;window.rollOriginalPlay=original;
    playDrumMachineHit=(buffer,time,ratio,settings)=>{if(buffer===drumMachineSnareBuffer)rollHits.push({time,ratio,...settings});return original(buffer,time,ratio,settings)};
    withBufferedTransportStart(null,deadline=>{window.rollOrigin=deadline;startDrumMachine(deadline,{ensureAudible:false,skipSave:true,silent:true});},{reset:true});
   });
   await page.waitForFunction(()=>audioContext.currentTime>rollOrigin+12.78,{},{timeout:30000});
   console.log('Live cycle complete',engine,mobile);
   const live=await page.evaluate(()=>{
    const hits=rollHits.filter(h=>h.time<rollOrigin+12.8-.00001).map(h=>({...h,tick:(h.time-rollOrigin)/.05}));
    stopDrumMachine({silent:true,skipSave:true});playDrumMachineHit=rollOriginalPlay;
    return{hits,origin:rollOrigin};
   });
   assert.equal(live.hits.length,22); // 16 backbeats minus two overlaps plus 8 roll ratchets.
   for(const cycle of[0,128]){
    const hits=live.hits.filter(h=>h.tick>=cycle+124-.001&&h.tick<cycle+125-.001);
    assert.equal(hits.length,4);for(let i=0;i<4;i++){assert(Math.abs(hits[i].tick-(cycle+124+i/4))<.001);assert(Math.abs(hits[i].ratio-Math.pow(2,3/12))<1e-6);}
   }
   // The real production sample scheduler must produce nonzero PCM for Roll alone.
   const audio=await page.evaluate(async()=>{
    const analyser=audioContext.createAnalyser();analyser.fftSize=2048;ensureDrumMachineBus().connect(analyser);
    scheduleDrumMachineRoll(124,audioContext.currentTime+.1,.05);
    await new Promise(r=>setTimeout(r,130));const values=new Float32Array(2048);analyser.getFloatTimeDomainData(values);ensureDrumMachineBus().disconnect(analyser);analyser.disconnect();
    return Math.sqrt(values.reduce((s,v)=>s+v*v,0)/values.length);
   });assert(audio>.001,`silent Roll ${audio}`);
   const portable=await page.evaluate(async()=>{
    saveState({force:true});window.rollSaved=saveState({force:true,snapshotOnly:true});window.rollPreset=gatherPreset();
    const blob=await mygrainSongBetaAdapter.capture();window.rollArchive=await blob.arrayBuffer();window.rollPart=await mygrainSongBetaAdapter.decode(rollArchive,{buffers:new Map(),bytes:0,limitBytes:128*1024*1024});
    return{length:rollPart.snapshot.state.modes.drumMachineRoll.length,ratchets:rollPart.snapshot.state.modes.drumMachineRoll.ratchets[124],cycle:rollPart.snapshot.extra.patternCycleMultiplier,assets:rollPart.snapshot.assets.map(x=>x.key),preset:rollPreset.drumMachineRoll};
   });
   assert.equal(portable.length,128);assert.equal(portable.ratchets,4);assert.equal(portable.cycle,8);assert(portable.assets.includes('drumSnare'));assert(!portable.assets.includes('drumRoll'));assert.equal(portable.preset.pattern[124],true);
   const recall=await page.evaluate(async()=>{
    restoreDrumMachineRoll();mygrainSongBetaAdapter.recall(rollPart,{start:false});const restored=JSON.stringify(drumMachineRoll)===JSON.stringify(rollSaved.modes.drumMachineRoll);
    const legacy=structuredClone(rollSaved);delete legacy.modes.drumMachineRoll;restoreState({state:legacy,songSnapshot:true,throwOnError:true});const empty=!drumMachineRoll.pattern.some(Boolean);
    applyPreset(rollPreset);const preset=drumMachineRoll.pattern[124]&&drumMachineRoll.ratchets[124]===4;
    mygrainSongBetaAdapter.recall(rollPart,{start:false});return{restored,empty,preset};
   });assert.deepEqual(recall,{restored:true,empty:true,preset:true});
   // Server capture, full-length freeze, stored audio and exact tail roll in Song.
   console.log('Capture/recall passed',engine,mobile);
   const song=await page.evaluate(async()=>{
    document.getElementById('songBetaName').value='Independent Roll';await mygrainSongBeta.newSong();
    document.getElementById('songBetaPartName').value='128-step ending';await mygrainSongBeta.newPart();
    await mygrainSongBeta.arm();
    const p=mygrainSongBeta.song.parts[0];if(!mygrainSongBeta.armed)throw new Error(document.getElementById('songBetaStatus').textContent);
    const buffer=mygrainSongBeta.renders.get(p.id);const values=buffer.getChannelData(0),rate=buffer.sampleRate;
    const power=(a,b)=>{const clip=values.slice(a*rate,b*rate);return clip.reduce((s,x)=>s+x*x,0)/clip.length;};
    return{peak:values.reduce((p,x)=>Math.max(p,Math.abs(x)),0),cycle:p.patternCycleMultiplier,duration:buffer.duration,roll:p.render.drumRollVersion,sample:p.render.drumSampleVersion,ending:power(6.215,6.255),quiet:power(5.9,6.0),frames:buffer.length};
   });
   console.log('Song result',engine,mobile,JSON.stringify(song));
   fs.writeFileSync(`${evidence}/song-${engine}-${mobile}.json`,JSON.stringify(song,null,2));
   assert.equal(song.cycle,8);assert(Math.abs(song.duration-6.4)<.001);assert.equal(song.roll,1);assert.equal(song.sample,1);assert(song.ending>1e-6,JSON.stringify(song));assert(song.quiet<1e-8,JSON.stringify(song));
   // Mobile page selector stays usable in landscape and narrow portrait too.
   if(mobile)for(const size of[{width:844,height:390},{width:320,height:640}]){
    await page.setViewportSize(size);await press('[data-drum-jump="roll"]');await page.locator('#drumMachineRollPage').selectOption('3');
    const fit=await page.evaluate(()=>{const card=document.getElementById('drumMachineLane-roll'),a=document.getElementById('drumMachineRollLength').getBoundingClientRect(),b=document.getElementById('drumMachineRollPage').getBoundingClientRect();return{fit:card.scrollWidth<=card.clientWidth+1,controls:a.width>70&&b.width>70}});assert(fit.fit&&fit.controls,JSON.stringify(fit));
   }
   await page.screenshot({path:`${evidence}/${engine}-${mobile?'phone':'desktop'}.png`});
   await page.evaluate(async()=>{await mygrainSongBetaAdapter.whenPersisted();saveState({force:true});});await page.reload();
   await page.waitForFunction(()=>window.mygrainSongBeta&&document.documentElement.dataset.mygrainStartup==='ready');await press('#start-btn');await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
   const reloaded=await page.evaluate(()=>({length:drumMachineRoll.length,active:drumMachineRoll.pattern[124],count:drumMachineRoll.ratchets[124],sample:!!drumMachineSnareBuffer}));
   assert.deepEqual(reloaded,{length:128,active:true,count:4,sample:true});assert.deepEqual(errors,[]);
   results.push({engine,mobile,live,audio,portable,recall,song,reloaded});console.log('PASS',engine,mobile?'phone touch':'desktop','128-step live timing, priority, PCM, undo, preset/legacy/Song/reload');
   fs.writeFileSync(`${evidence}/results.json`,JSON.stringify(results,null,2));await context.close();
  }}finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
