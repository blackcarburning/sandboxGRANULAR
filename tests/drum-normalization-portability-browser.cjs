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

 const baselinePath=process.env.DRUM_NORMALIZE_BASELINE_INDEX;
 const baseline=baselinePath?fs.readFileSync(baselinePath,'utf8'):null;
 const start=baseline?.indexOf('        function playDrumMachineHit(');
 const oldHit=baseline?baseline.slice(start,baseline.indexOf('\n        }',start)+10):null;
 const portability=await page.evaluate(async oldHit=>{
  const project=await mygrainSongBetaAdapter.capture({liveOnly:true,projectCapture:true});
  const projectState=structuredClone(project.snapshot.state.modes.drumMachineSampleProcessing);
  const projectPeak=Math.max(...project.buffers.get('drumSnare').getChannelData(0));
  const modern=await buildPatchZipBlob('normalization.zip');
  await openPatchZipFromArrayBuffer(await modern.arrayBuffer(),'normalization.zip');
  const modernState=structuredClone(drumMachineSampleProcessing);
  const definitions=PATCH_REPOSITORY_AUDIO_ENTRIES.filter(a=>a.role==='drum-sample'&&a.getBuffer());
  const entries=definitions.map(a=>({path:a.path,data:audioBufferToWav(a.getBuffer())}));
  const preset=gatherPreset();delete preset.drumMachineSampleProcessing;
  const legacy=await createStoredZip([{path:'manifest.json',data:JSON.stringify({version:1,assets:definitions.map(a=>({key:a.key,path:a.path,role:a.role}))})},{path:'preset.json',data:JSON.stringify(preset)},...entries]);
  await openPatchZipFromArrayBuffer(await legacy.arrayBuffer(),'pre-normalization.zip');
  const legacyState=structuredClone(drumMachineSampleProcessing),legacyPeaks=Object.fromEntries(MygrainDrumTone.SAMPLE_LANES.map(k=>[k,Math.max(...getDrumSampleBuffer(k).getChannelData(0))]));
  await openPatchZipFromArrayBuffer(await modern.arrayBuffer(),'normalization.zip');
  const restored=structuredClone(drumMachineSampleProcessing);
  const comparisons=[];
  let exportPcm;
  for(const rate of [44100,48000])for(const amount of [0,.01,.5,1]){
   const render=async (source,normalized)=>{
    const ctx=new OfflineAudioContext(2,Math.round(rate*.4),rate),buf=ctx.createBuffer(2,Math.round(rate*.3),rate);
    for(let c=0;c<2;c++)for(let i=0;i<buf.length;i++)buf.getChannelData(c)[i]=(.1/(c+1))*Math.sin(2*Math.PI*301*i/rate);
    const processing=MygrainDrumTone.sampleState();processing.lanes.snare={enabled:normalized,gain:5,peak:.1};
    const names=['audioContext','ensureDrumMachineBus','getFadeSecondsForDuration','drumMachineActiveVoices','scheduleTransportSourceStop','registerDrumMachineReverbTail','drumMachineSampleProcessing','MygrainDrumTone','isDrumMachineLaneAudible','makeDistortionCurve'];
    const play=new Function(...names,`return (${source})`)(ctx,()=>ctx.destination,()=>.008,new Set(),(s,t)=>s.stop(t),()=>{},processing,MygrainDrumTone,()=>true,makeDistortionCurve);
    play(buf,.01,1,{eqChannel:'snare',level:1,decayRatio:1,lengthRatio:1,distortionAmount:amount});return ctx.startRendering();
   };
   const after=await render(playDrumMachineHit.toString(),false);
   if(oldHit){const before=await render(oldHit,false);let maxDifference=0;for(let c=0;c<2;c++){const a=after.getChannelData(c),b=before.getChannelData(c);for(let i=0;i<a.length;i++)maxDifference=Math.max(maxDifference,Math.abs(a[i]-b[i]));}comparisons.push({rate,amount,maxDifference});}
   if(rate===48000&&amount===0)exportPcm=await render(playDrumMachineHit.toString(),true);
  }
  const part={id:'fixture',bpm:300,patternSteps:8,repeats:1},wav=await MygrainSongExport.wav([part],new Map([['fixture',exportPcm]]),exportPcm.sampleRate),bytes=await wav.blob.arrayBuffer(),view=new DataView(bytes);
  return {projectState,projectPeak,modernState,legacyState,legacyPeaks,restored,comparisons,wav:{bytes:bytes.byteLength,frames:wav.frames,peak:wav.peak,rate:view.getUint32(24,true),bits:view.getUint16(34,true)}};
 },oldHit);
 assert.equal(portability.projectState.lanes.snare.gain,initial.state.lanes.snare.gain);assert(Math.abs(portability.projectPeak-.1)<.001);
 assert.deepEqual(portability.modernState,portability.restored);assert.equal(portability.legacyState.snareDrive,'legacy');
 for(const kind of Object.keys(portability.legacyPeaks)){assert.equal(portability.legacyState.lanes[kind].enabled,false);assert.equal(portability.legacyState.lanes[kind].gain,1);assert(Math.abs(portability.legacyPeaks[kind]-.1)<.001);}
 for(const row of portability.comparisons)assert(row.maxDifference<1e-7,JSON.stringify(row));
 assert.equal(portability.wav.rate,48000);assert.equal(portability.wav.bits,24);assert.equal(portability.wav.bytes,44+portability.wav.frames*6);assert(Math.abs(portability.wav.peak-.5)<.001);
 assert.deepEqual(errors,[]);fs.writeFileSync(evidence+'/'+engine+'-portability.json',JSON.stringify(portability,null,2));console.log('PASS',engine,'modern/legacy editable ZIP, native project capture, old-vs-new legacy PCM and real 24-bit WAV encoding');
 await context.close();
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});
