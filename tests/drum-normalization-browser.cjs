// Disposable localhost account/store. Real engine, original-buffer exports and server jobs.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18894/mygrain/';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
const evidence=process.env.DRUM_NORMALIZE_EVIDENCE||'/tmp/mygrain-drum-normalization-results';fs.mkdirSync(evidence,{recursive:true});
(async()=>{const results=[];for(const engine of (process.env.DRUM_NORMALIZE_ENGINE?[process.env.DRUM_NORMALIZE_ENGINE]:['chromium','webkit'])){
 const browser=await ({chromium,webkit}[engine]).launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-drum-normalization'}})).status(),200);
 const page=await context.newPage(),errors=[],jobs=[];page.setDefaultTimeout(90000);
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/server-arm?'))jobs.push(r.url());});
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);
 await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 console.log(engine,'engine ready');
 const initial=await page.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});for(const layer of SPARSE_RANDOM_LAYER_DEFINITIONS)layer.setEnabled(false,{silent:true,skipSave:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});
  setFxMuted(true,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);
  for(const id of ['reverb','distortion','noiseMix','finalDriveSoft','finalDriveHard','finalDriveFold','finalDriveCrush','finalCompressorAmount','finalSidechainAmount','delayMix','delayFeedback','finalDelayDepth','finalReverbMix','oscNoiseLevel','drumMachineSnareDistortion'])setSliderValue(id,0);
  mygrainLoopFx.restore();mygrainChannelEq.restore();await mygrainWasp.restore();await mygrainTurntable.off();await mygrainResonator.off();mygrainNoise.restore();mygrainBassFace.restore();await mygrainAcousticFx.off();await mygrainMasterBaker?.off?.();
  loadDrumSendFxState({delay:{enabled:false},reverb:{enabled:false}});setDrumMachineDirectOutput(true,{silent:true,skipSave:true});setDrumMachineEnabled(true,{silent:true,skipSave:true});setSliderValue('performanceDrumMachineLevel',65);applyGlobalBpm(120);syncPatternLengthControls(16,{skipSave:true});
  const buffer=audioContext.createBuffer(2,Math.round(audioContext.sampleRate*.35),audioContext.sampleRate);
  for(let c=0;c<2;c++)for(let i=0;i<buffer.length;i++)buffer.getChannelData(c)[i]=(.1/(c+1))*Math.sin(2*Math.PI*400*i/buffer.sampleRate);
  const original=buffer.getChannelData(0).slice();drumMachineSampleProcessing=MygrainDrumTone.sampleState(null,true);
  for(const kind of MygrainDrumTone.SAMPLE_LANES){
   await applyLoadedDrumMachineSampleBuffer(kind,buffer,{fileName:kind+'-normalization-fixture.wav'});
   const name=kind[0].toUpperCase()+kind.slice(1);for(const [suffix,value]of [['Level',100],['Pitch',0],['Decay',100],['Length',100]])setSliderValue('drumMachine'+name+suffix,value);
   setDrumMachinePattern(kind,Array(16).fill(false),{skipSave:true});
  }
  setDrumMachinePattern('snare',[true,...Array(15).fill(false)],{skipSave:true});restoreDrumMachineBaseAccents({});restoreDrumMachineRoll();
  openDrumMachineOverlay();syncDrumMachineUi();
  return {state:structuredClone(drumMachineSampleProcessing),rawUnchanged:original.every((x,i)=>x===buffer.getChannelData(0)[i])};
 });
 assert(initial.rawUnchanged);for(const lane of Object.values(initial.state.lanes)){assert(lane.enabled);assert(Math.abs(lane.gain-5.011872)<.01);}
 await page.locator('[data-drum-jump="snare"]').tap();
 await page.locator('#drumNormalizeBypass-snare').tap();assert.equal(await page.evaluate(()=>MygrainDrumTone.sampleGain(drumMachineSampleProcessing,'snare')),1);
 await page.locator('#drumNormalize-snare').tap();await page.waitForFunction(()=>!mygrainCardHistory.busy&&drumMachineSampleProcessing.lanes.snare.enabled);
 const measured=await page.evaluate(async()=>{
  // Production hit function, real OfflineAudioContext, including normalization and shaper.
  const cases=[];
  for(const rate of [44100,48000])for(const normalized of [false,true])for(const response of ['legacy','smooth'])for(const amount of [0,.01,.05,.5,1]){
   const offline=new OfflineAudioContext(2,Math.round(rate*.4),rate),buffer=offline.createBuffer(2,Math.round(rate*.3),rate);
   for(let c=0;c<2;c++)for(let i=0;i<buffer.length;i++)buffer.getChannelData(c)[i]=(.1/(c+1))*Math.sin(2*Math.PI*301*i/rate);
   const processing=MygrainDrumTone.sampleState();processing.snareDrive=response;processing.lanes.snare={enabled:normalized,gain:5,peak:.1};
   const names=['audioContext','ensureDrumMachineBus','getFadeSecondsForDuration','drumMachineActiveVoices','scheduleTransportSourceStop','registerDrumMachineReverbTail','drumMachineSampleProcessing','MygrainDrumTone','isDrumMachineLaneAudible','makeDistortionCurve'];
   const play=new Function(...names,`return (${playDrumMachineHit.toString()})`)(offline,()=>offline.destination,()=>.008,new Set(),(s,t)=>s.stop(t),()=>{},processing,MygrainDrumTone,()=>true,makeDistortionCurve);
   play(buffer,.01,1,{eqChannel:'snare',level:1,decayRatio:1,lengthRatio:1,distortionAmount:amount});
   const rendered=await offline.startRendering(),power=c=>{let sum=0;for(const x of rendered.getChannelData(c)){if(!Number.isFinite(x))throw Error('Nonfinite PCM');sum+=x*x;}return Math.sqrt(sum/rendered.length);};
   cases.push({rate,normalized,response,amount,left:power(0),right:power(1)});
  }
  // Actual final live output: changing only normalization must change RMS by its saved fixed gain.
  const ctx=audioContext,tap=ctx.createScriptProcessor(2048,2,2),mute=ctx.createGain();mute.gain.value=0;finalAmplifierNode.connect(tap);tap.connect(mute);mute.connect(ctx.destination);
  const liveBuffer=ctx.createBuffer(2,Math.round(ctx.sampleRate*1.2),ctx.sampleRate);
  for(let c=0;c<2;c++)for(let i=0;i<liveBuffer.length;i++)liveBuffer.getChannelData(c)[i]=(.1/(c+1))*Math.sin(2*Math.PI*400*i/ctx.sampleRate);
  let values=[];tap.onaudioprocess=e=>values.push(...e.inputBuffer.getChannelData(0));
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const run=async enabled=>{stopDrumMachineVoices({fade:false});drumMachineSampleProcessing.lanes.snare.enabled=enabled;playDrumMachineHit(liveBuffer,ctx.currentTime+.04,1,{eqChannel:'snare',level:1,decayRatio:1,lengthRatio:1});await wait(300);values=[];await wait(300);return Math.sqrt(values.reduce((a,x)=>a+x*x,0)/values.length);};
  const bypass=await run(false),normalized=await run(true);tap.onaudioprocess=null;finalAmplifierNode.disconnect(tap);tap.disconnect();mute.disconnect();stopDrumMachineVoices({fade:false});
  drumMachineSampleProcessing.lanes.snare.enabled=true;syncDrumSampleProcessingUi();saveState({force:true});await mygrainSongBetaAdapter.whenPersisted();
  const archive=await mygrainSongBetaAdapter.capture(),decoded=await mygrainSongBetaAdapter.decode(await archive.arrayBuffer(),{buffers:new Map(),bytes:0,limitBytes:128*1048576});
  const raw=decoded.buffers.get('drumSnare'),rawPeak=Math.max(...raw.getChannelData(0));
  // Production controller holds its busy lease during rendering; direct diagnostic calls must do the same.
  mygrainSongBeta.busy=true;await backgroundAudioController.wake();await audioContext.resume();
  const rendered=await MygrainSongClock.render(audioContext,decoded,{bpm:120,patternSteps:16});
  const power=data=>Math.sqrt(data.reduce((a,x)=>a+x*x,0)/data.length);
  const normalizedSong=power(rendered.getChannelData(0));decoded.snapshot.state.modes.drumMachineSampleProcessing.lanes.snare.enabled=false;
  const drySong=await MygrainSongClock.render(audioContext,decoded,{bpm:120,patternSteps:16});mygrainSongBeta.busy=false;
  return {cases,live:{bypass,normalized,gain:drumMachineSampleProcessing.lanes.snare.gain},export:{rawPeak,processing:JSON.parse(JSON.stringify(decoded.snapshot.state.modes.drumMachineSampleProcessing)),songRatio:normalizedSong/power(drySong.getChannelData(0)),frames:rendered.length,rate:rendered.sampleRate}};
 });
 for(const x of measured.cases){const clean=measured.cases.find(y=>y.rate===x.rate&&y.normalized===x.normalized&&y.response===x.response&&y.amount===0);if(x.response==='smooth')assert(x.left>clean.left*.999);else if(x.amount===.01)assert(x.left<clean.left*.5);if(x.amount===0)assert(Math.abs(x.left/x.right-2)<.001);}
 assert(measured.live.bypass>1e-6);assert(Math.abs(measured.live.normalized/measured.live.bypass-measured.live.gain)<.15,JSON.stringify(measured.live));
 assert(Math.abs(measured.export.rawPeak-.1)<.001);assert(Math.abs(measured.export.songRatio-measured.live.gain)<.03,JSON.stringify(measured.export));
 console.log(engine,'live/offline/export checks passed');
 // Actual phone/server preparation: new normalized snapshot, a legacy snapshot, warm cache and source integrity.
 await page.evaluate(()=>closeDrumMachineOverlay());
 const song=await page.evaluate(async()=>{
  const c=mygrainSongBeta;document.getElementById('songBetaName').value='Drum normalization isolated '+Date.now();await c.newSong();
  document.getElementById('songBetaPartName').value='Normalized drums';await c.newPart();
  // A genuine legacy source has no new field in its archived manifest.
  const modern=structuredClone(drumMachineSampleProcessing);restoreDrumSampleProcessing();
  const archive=await mygrainSongBetaAdapter.capture(),entries=parseStoredZipEntries(await archive.arrayBuffer()),snapshot=JSON.parse(getZipText(entries,'song-part.json'));delete snapshot.state.modes.drumMachineSampleProcessing;
  const legacy=await createStoredZip([...entries].map(([path,data])=>({path,data:path==='song-part.json'?JSON.stringify(snapshot):data})));
  await c.newPart({name:'Legacy drums',blob:legacy});restoreDrumSampleProcessing(modern);saveState({force:true});
  const before={revision:c.song.revision,hashes:c.song.parts.map(p=>p.sha256),revisions:c.song.parts.map(p=>p.revision)},sources=await Promise.all(c.song.parts.map(p=>c.readPartMetadata(p)));
  c.serverPreparation=true;c.phonePreparation=true;c.memoryBudget.limitBytes=96*1048576;await c.arm();if(!c.armed)throw Error(document.getElementById('songBetaStatus').textContent);
  const rendered=c.song.parts.map(p=>({name:p.name,processing:p.drumProcessingVersion||0,render:p.render.drumProcessingVersion||0,sha:p.render.sha256}));
  const sourceHashes=c.song.parts.map(p=>p.sha256),after={revision:c.song.revision,hashes:sourceHashes,revisions:c.song.parts.map(p=>p.revision)};
  await c.playSong(c.song.parts[0].id);await new Promise(r=>setTimeout(r,250));const playing=c.playing;c.stop();await c.arm();
  return {before,after,rendered,playing,sourceStates:sources.map(s=>s.snapshot.state.modes.drumMachineSampleProcessing),budget:c.memoryBudget.bytes};
 });
 assert.deepEqual(song.before,song.after);assert.equal(song.rendered[0].processing,1);assert.equal(song.rendered[0].render,1);assert.equal(song.rendered[1].processing,0);assert.equal(song.rendered[1].render,0);assert(song.playing);assert.equal(song.budget,0);
 assert.equal(jobs.length,2);console.log(engine,'real server jobs and warm cache passed');
 const beforeJobs=jobs.length;await page.evaluate(()=>mygrainSongBeta.arm());assert.equal(jobs.length,beforeJobs,'warm arm must reuse existing PCM');
 await page.evaluate(async()=>{saveState({force:true});await mygrainSongBetaAdapter.whenPersisted();});
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
 const restored=await page.evaluate(()=>({processing:drumMachineSampleProcessing,peak:Math.max(...drumMachineSnareBuffer.getChannelData(0))}));
 assert(restored.processing.lanes.snare.enabled);assert.equal(restored.processing.snareDrive,'smooth');assert(Math.abs(restored.peak-.1)<.001);
 await page.evaluate(()=>openDrumMachineOverlay());await page.locator('[data-drum-jump="snare"]').tap();await page.screenshot({path:evidence+'/'+engine+'-phone.png'});
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:evidence+'/'+engine+'-desktop.png'});
 assert.deepEqual(errors,[]);const result={engine,initial,measured,song,restored,serverJobs:jobs.length};results.push(result);fs.writeFileSync(evidence+'/'+engine+'.json',JSON.stringify(result,null,2));console.log('PASS',engine,'all lanes, bypass, original exports, live/offline/Song PCM, legacy state, real server jobs, warm cache and reload');
 await context.close();
 }finally{await browser.close();}
}fs.writeFileSync(evidence+'/results.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
