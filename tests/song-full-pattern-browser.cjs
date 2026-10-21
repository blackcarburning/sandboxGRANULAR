// Disposable local accounts and stores only. No production writes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18890/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence=process.env.SONG_LENGTH_EVIDENCE||'/tmp/mygrain-song-length';fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const results=[];
 for(const [engine,type] of Object.entries({chromium,webkit})){
  const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{for(const landscape of [false,true]){
   const lane=landscape?'L':'X',steps=landscape?32:64,multiplier=landscape?4:2;
   const context=await browser.newContext({viewport:landscape?{width:844,height:390}:{width:402,height:874},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6.1 Mobile/15E148 Safari/604.1'});
   const registration=await context.request.post(base+'api/auth/register',{data:{username:`pat_${engine[0]}_${+landscape}_${Date.now()}`,password:'isolated-pattern-fixture'}});
   assert.equal(registration.status(),200,await registration.text());
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   await page.goto(base);await page.waitForFunction(()=>window.mygrainSongBeta&&!mygrainSongBeta.busy&&document.documentElement.dataset.mygrainStartup==='ready');
   await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
   await page.evaluate(async({lane,steps,multiplier})=>{
    stopAllPerformancePlayback({silent:true});resetStemIsolationState();applyGlobalBpm(300);syncPatternLengthControls(steps,{skipSave:true});
    const buffer=audioContext.createBuffer(2,Math.round(audioContext.sampleRate*.25),audioContext.sampleRate);
    for(let c=0;c<2;c++)for(let i=0;i<buffer.length;i++)buffer.getChannelData(c)[i]=.35*Math.sin(2*Math.PI*(220+c*50)*i/audioContext.sampleRate);
    const sequence=Array.from({length:64},()=>({note:'',rest:false,accent:false,slide:false,ratchet:1}));sequence[0].note='C3';sequence[steps*3/4].note='C3';
    const quiet={silent:true,skipSave:true,skipRestart:true};
    if(lane==='X'){
     await applyLoadedBastardLoopXSampleBuffer(buffer,'Local fixture',{fileName:'fixture-C3.wav',rootNote:'C3'});
     setBastardLoopXSourceMode('sample',quiet);bastardLoopXSequence=sequence;bastardLoopXTimingIndex=4;setBastardLoopXEnabled(true,quiet);syncBastardLoopXUi();
    }else{
     await applyLoadedBastardLoopLSampleBuffer(buffer,'Local fixture',{fileName:'fixture-C3.wav',rootNote:'C3'});
     setBastardLoopLSourceMode('sample',quiet);bastardLoopLSequence=sequence;bastardLoopLTimingIndex=5;setBastardLoopLEnabled(true,quiet);syncBastardLoopLUi();
    }
    saveState();
   },{lane,steps,multiplier});
   await page.locator('#songBetaName').fill('Full pattern fixture');await page.locator('#songBetaNewSong').click();
   await page.waitForFunction(()=>mygrainSongBeta.song&&mygrainSongBeta.canEditSong()&&!mygrainSongBeta.busy);
   await page.locator('#songBetaPartName').fill('Full current pattern');await page.locator('#songBetaNewPart').click();
   await page.waitForFunction(()=>mygrainSongBeta.song.parts.length===1&&!mygrainSongBeta.busy);
   const saved=await page.evaluate(()=>({part:mygrainSongBeta.song.parts[0],duration:MygrainSongBeta.partDurationSeconds(mygrainSongBeta.song.parts[0]),grid:getPatternLengthSteps()}));
   assert.equal(saved.part.patternSteps,steps);assert.equal(saved.part.patternCycleMultiplier,multiplier);assert.equal(saved.duration,steps*.05*multiplier);assert.equal(saved.grid,steps);
   const inspected=await page.evaluate(async({lane,steps})=>{
    const part=mygrainSongBeta.song.parts[0],body=await mygrainSongBeta.request(`/${mygrainSongBeta.song.id}/parts/${part.id}`,{binary:true});
    const decoded=await mygrainSongBetaAdapter.decode(body,{buffers:new Map(),bytes:0});window.savedPattern=decoded;
    const m=decoded.snapshot.state.modes;return {cycle:decoded.snapshot.extra.patternCycleMultiplier,steps:decoded.snapshot.state.patternLength,notes:m[`bastardLoop${lane}Sequence`].slice(0,steps).flatMap((s,i)=>s.note?[i]:[])};
   },{lane,steps});
   assert.deepEqual(inspected,{cycle:multiplier,steps,notes:[0,steps*3/4]});
   await page.locator('#songBetaArm').click();await page.waitForFunction(()=>mygrainSongBeta.armed&&!mygrainSongBeta.busy,null,{timeout:65000});
   const audio=await page.evaluate(async({steps,multiplier})=>{
    const part=mygrainSongBeta.song.parts[0],buffer=await mygrainSongBeta.loadRender(part,mygrainSongBeta.abort?.signal);
    const lateTime=steps*.75*.05*multiplier,channel=buffer.getChannelData(0);
    let latePeak=0;for(let i=Math.floor(lateTime*buffer.sampleRate);i<Math.min(channel.length,Math.ceil((lateTime+.3)*buffer.sampleRate));i++)latePeak=Math.max(latePeak,Math.abs(channel[i]));
    const exportInfo=MygrainSongExport.layout([part,{...part,id:'repeat',repeats:2}],null,buffer.sampleRate);
    await mygrainSongBeta.playSong();const entries=mygrainSongBeta.playback.entries.map(e=>({start:e.start,end:e.end}));mygrainSongBeta.stop();
    return {duration:buffer.duration,frames:buffer.length,sampleRate:buffer.sampleRate,latePeak,exportFrames:exportInfo.frames,entries};
   },{steps,multiplier});
   assert.equal(audio.frames,Math.round(saved.duration*audio.sampleRate));assert(audio.latePeak>.0001,'the notes after the old truncation boundary must be audible');
   assert.equal(audio.exportFrames,audio.frames*3);assert(Math.abs(audio.entries[0].end-audio.entries[0].start-saved.duration)<1/audio.sampleRate);
   await page.evaluate(()=>{mygrainSongBetaAdapter.recall(savedPattern,{editing:true});});
   const recalled=await page.evaluate(({lane,steps})=>({steps:getPatternLengthSteps(),last:(lane==='X'?bastardLoopXSequence:bastardLoopLSequence)[steps*.75].note}),{lane,steps});
   assert.deepEqual(recalled,{steps,last:'C3'});
   // A subsequent short/normal pattern must not inherit the long cycle.
   await page.evaluate(()=>{bastardLoopXTimingIndex=3;bastardLoopLTimingIndex=3;syncPatternLengthControls(16,{skipSave:true});saveState();});
   await page.locator('#songBetaPartName').fill('Short next pattern');await page.locator('#songBetaNewPart').click();
   await page.waitForFunction(()=>mygrainSongBeta.song.parts.length===2&&!mygrainSongBeta.busy);
   assert.deepEqual(await page.evaluate(()=>mygrainSongBeta.song.parts.map(p=>[p.patternSteps,p.patternCycleMultiplier])),[[steps,multiplier],[16,1]]);
   await page.screenshot({path:`${evidence}/${engine}-${landscape?'landscape':'portrait'}.png`});
   await page.reload();await page.waitForFunction(()=>window.mygrainSongBeta&&!mygrainSongBeta.busy&&document.documentElement.dataset.mygrainStartup==='ready');
   assert.deepEqual(await page.evaluate(()=>mygrainSongBeta.song.parts.map(p=>[p.patternSteps,p.patternCycleMultiplier])),[[steps,multiplier],[16,1]]);
   assert.deepEqual(errors,[]);results.push({engine,landscape,lane,steps,multiplier,savedDuration:saved.duration,inspected,audio});
   console.log('PASS',engine,landscape?'landscape':'portrait',lane,steps,'steps x'+multiplier,'late audio',audio.latePeak);await context.close();
  }}finally{await browser.close();}
 }
 fs.writeFileSync(evidence+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
