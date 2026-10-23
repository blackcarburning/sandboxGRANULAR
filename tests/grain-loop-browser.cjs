// Real app/audio and disposable local accounts. No production Song mutations.
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18936/mygrain/';assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence=process.env.MYGRAIN_LOOP_EVIDENCE||'/tmp/mygrain-grain-loop';fs.mkdirSync(evidence,{recursive:true});
(async()=>{const results=[];for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});assert.equal((await c.request.post(base+'api/auth/register',{data:{username:`gl_${engine}_${Date.now()}`,password:'disposable-grain-loop'}})).status(),200);
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 if(process.env.MYGRAIN_LOOP_BASELINE)await p.route(base,r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(process.env.MYGRAIN_LOOP_BASELINE,'utf8')}));
 await p.goto(base);await p.waitForFunction(()=>mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
 const baseline=Boolean(process.env.MYGRAIN_LOOP_BASELINE);await p.evaluate(v=>window.loopBaseline=v,baseline);
 const setup=await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});const source=audioContext.createBuffer(1,Math.round(audioContext.sampleRate*.25),audioContext.sampleRate),a=source.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=.2*Math.sin(2*Math.PI*261.625565*i/source.sampleRate);
  grainASampleBuffer=source;grainBSampleBuffer=source;grainSynthAMicBuffer=source;grainSynthBMicBuffer=source;
  await prepareGranularKeyboardFromUi();setHoldEnabled(true);setArpeggiatorEnabled(false,{skipSave:true});setKeyboardDecay(200,{skipSave:true});
  setGranularLayerMuted('main',true,{silent:true,skipSave:true});setGranularLayerMuted('A',false,{silent:true,skipSave:true});setGranularLayerMuted('B',true,{silent:true,skipSave:true});
  lfoEnabled={};lfo2Enabled={};lfo3Enabled={};for(const key of ['A','B']){document.getElementById(`grainSynth${key}Source`).value=`grain${key}Sample`;for(const [suffix,v]of Object.entries({Start:30,Size:350,Tune:0,FineTune:0,Width:0,Mix:65,Smoothing:65}))setSliderValue(`grainSynth${key}${suffix}`,v);setSliderValue(`grain${key}SampleLoopStart`,20);setSliderValue(`grain${key}SampleLoopEnd`,60);setSliderValue(`grain${key}MicGrainPosition`,0);setSliderValue(`grain${key}MicGrainScale`,100);}
  window.loopMeter=audioContext.createAnalyser();loopMeter.fftSize=1024;window.loopSink=audioContext.createGain();loopSink.gain.value=0;granularOutputGain.connect(loopMeter);loopMeter.connect(loopSink);loopSink.connect(audioContext.destination);
  window.loopRms=()=>{const a=new Float32Array(1024);loopMeter.getFloatTimeDomainData(a);return Math.sqrt(a.reduce((n,v)=>n+v*v,0)/a.length);};
  return {sustain:typeof grainSustainEnabled==='undefined'?null:grainSustainEnabled};
 });
 // A held note outlives both its 250 ms source and the shared 200 ms keyboard fade.
 await p.locator('#keyboardContainer .key[data-note="C4"]').scrollIntoViewIfNeeded();await p.locator('#keyboardContainer .key[data-note="C4"]').tap();await p.waitForTimeout(1500);
 const held=await p.evaluate(()=>({rms:loopRms(),streams:activeGrains.size,pool:getConcurrentGrainSourceCount(),decay:[...activeGrains.values()].map(v=>v.keyboardDecaySeconds)}));
 if(!baseline){assert.ok(held.rms>1e-5&&held.streams>0,JSON.stringify(held));assert.ok(held.pool<=96);assert.deepEqual(held.decay,[0]);}
 const offline=await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});heldNotes.clear();const online=audioContext,output=granularOutputGain,offline=new OfflineAudioContext(2,48000,48000);audioContext=offline;granularOutputGain=offline.createGain();granularOutputGain.connect(offline.destination);const random=Math.random;Math.random=()=>.5;
  try{const layer=getGranularLayerSettings(baseFrequency).find(v=>v.key==='A'),source=getAvailableGranularSources({mode:layer.sourceMode,layer:'A'})[0],win=resolveGranularLayerSampleWindow(source,layer,.03,.03);
   playGrain('C4',.03,1,{role:'test-loop',streamStartTime:.03,layerSettings:[layer]});const rendered=await offline.startRendering(),a=rendered.getChannelData(0);let sum=0;for(let i=12000;i<16000;i++)sum+=a[i]*a[i];return {win,lateRms:Math.sqrt(sum/4000)};
  }finally{Math.random=random;audioContext=online;granularOutputGain=output;}
 });if(!baseline){assert.ok(offline.win.looping&&offline.win.loopStart>=.05-1e-8&&offline.win.loopEnd<=.15+1e-8);assert.ok(offline.win.sourceDuration>offline.win.loopEnd-offline.win.loopStart);assert.ok(offline.lateRms>1e-5,JSON.stringify(offline));}
 const motion=await p.evaluate(()=>{
  setGlobalModulationAmount(55,{save:false});setGranularModulationAmount(75,{save:false});const ids=['grainASampleLoopStart','grainASampleLoopEnd','grainBSampleLoopStart','grainBSampleLoopEnd','grainSynthAStart','grainSynthBStart','grainSynthASize','grainSynthBSize','grainAMicGrainScale','grainBMicGrainScale'];const results=[];
  lfoStartTime=lfo2StartTime=lfo3StartTime=0;for(const n of [1,2,3]){const prefix=n===1?'lfo':`lfo${n}`;document.getElementById(`${prefix}Rate`).value='120';document.getElementById(`${prefix}Depth`).value='50';document.getElementById(`${prefix}Waveform`).value='sine';}
  for(const n of [1,2,3]){lfoEnabled={};lfo2Enabled={};lfo3Enabled={};const routes=n===1?lfoEnabled:n===2?lfo2Enabled:lfo3Enabled;
   for(const id of ids){setSliderValue(id,id.includes('Loop')||id.endsWith('Start')?50:id.endsWith('Scale')?125:250);routes[id]=true;const hi=withModulationEvaluationTime(.125,()=>getModulatedValue(id)),lo=withModulationEvaluationTime(.375,()=>getModulatedValue(id));results.push({n,id,lo,hi,span:hi-lo});delete routes[id];}
  }
  lfoEnabled={grainASampleLoopStart:true};setGranularModulationAmount(0,{save:false});const zero=withModulationEvaluationTime(.125,()=>getModulatedValue('grainASampleLoopStart'));setGranularModulationAmount(75,{save:false});lfoInverted.grainASampleLoopStart=true;const inverted=withModulationEvaluationTime(.125,()=>getModulatedValue('grainASampleLoopStart'));delete lfoInverted.grainASampleLoopStart;lfoEnabled={};return {results,zero,inverted};
 });if(!baseline){for(const r of motion.results)assert.ok(r.span>(r.id.endsWith('Size')?100:r.id.endsWith('Scale')?50:20),JSON.stringify(r));assert.equal(motion.zero,50);assert.ok(motion.inverted<40);}
 const routedSources=baseline?[]:await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});const online=audioContext,output=granularOutputGain,offline=new OfflineAudioContext(2,48000,48000);audioContext=offline;granularOutputGain=offline.createGain();granularOutputGain.connect(offline.destination);
  const original=startTransportSource,calls=[];startTransportSource=function(node,time,offset,duration){calls.push({loop:node.loop,start:node.loopStart,end:node.loopEnd,duration});return original(node,time,offset,duration);};
  const result=[];
  try{for(const id of ['grainASampleLoopStart','grainASampleLoopEnd','grainSynthASize']){setSliderValue('grainASampleLoopStart',10);setSliderValue('grainASampleLoopEnd',90);setSliderValue('grainSynthASize',250);lfoEnabled={[id]:true};
    for(const time of [.125,.375]){const layer=withModulationEvaluationTime(time,()=>getGranularLayerSettings(baseFrequency).find(v=>v.key==='A'));playGrain('C4',time,1,{role:'routed-test',streamStartTime:0,layerSettings:[layer]});}
    const [hi,lo]=calls.splice(0);if(!hi.loop||!lo.loop)throw Error('Routed grains did not loop');const key=id.endsWith('Start')?'start':id.endsWith('End')?'end':'duration',span=Math.abs(hi[key]-lo[key]);if(span<(key==='duration'?.1:.05))throw Error(`${id} bypassed actual BufferSource: ${span}`);result.push({id,hi,lo,span});}
    await offline.startRendering();return result;
  }finally{startTransportSource=original;lfoEnabled={};audioContext=online;granularOutputGain=output;}
 });
 if(!baseline){
  const click=async()=>{await p.locator('#performanceGrainSustainBtn').scrollIntoViewIfNeeded();await p.locator('#performanceGrainSustainBtn').tap();await p.waitForFunction(()=>!mygrainCardHistory.busy);};
  await click();assert.equal(await p.evaluate(()=>grainSustainEnabled),false);await p.evaluate(()=>mygrainCardHistory.undo());assert.equal(await p.evaluate(()=>grainSustainEnabled),true);await p.evaluate(()=>mygrainCardHistory.redo());assert.equal(await p.evaluate(()=>grainSustainEnabled),false);
  await p.evaluate(()=>{setKeyboardDecay(200,{skipSave:true});heldNotes.add('C4');startHeldKeyboardPlayback();});await p.waitForTimeout(600);assert.equal(await p.evaluate(()=>activeGrains.size),0);assert.ok(await p.evaluate(()=>loopRms())<1e-7);
  await click();await p.waitForTimeout(500);assert.ok(await p.evaluate(()=>loopRms())>1e-5,'Sustain On recovers a held key whose timed fade finished');
  // Key-up still releases a sustained stream; no immortal notes.
  await p.evaluate(()=>{stopKeyboardSound('C4');heldNotes.clear();});await p.waitForTimeout(2300);assert.equal(await p.evaluate(()=>activeGrains.size),0);
  // Real Song amendment and backward-compatible restoration.
  await p.evaluate(async()=>{stopAllPerformancePlayback({silent:true});setGrainSustainEnabled(false,{skipSave:true});setGranularModulationAmount(63,{save:false});const c=mygrainSongBeta;document.getElementById('songBetaName').value='Disposable grain sustain and motion';await c.newSong();await c.newPart({name:'Looping grains',repeats:1});await c.finishEditing();await c.run(()=>c.amendPart(c.song.parts[0]));setGrainSustainEnabled(true);setGranularModulationAmount(82,{save:false});await c.run(()=>c.savePart());await c.finishEditing();setGrainSustainEnabled(false,{skipSave:true});setGranularModulationAmount(0,{save:false});await c.recall(c.song.parts[0],{start:false});if(!grainSustainEnabled||getGranularModulationAmountValue()!==.82)throw Error('Saved sustain/depth not recalled');lfoEnabled.grainASampleLoopStart=true;syncLfoRouteButtons('grainASampleLoopStart','1');const preset=gatherPreset(),validated=mygrainUtils.validatePreset(preset,{sliderSchema:buildPresetSliderSchema(),toggleParams:presetToggleParams}).preset;if(!validated.lfo.enabled.grainASampleLoopStart)throw Error('Preset validator dropped Start LFO route');const old=saveState({snapshotOnly:true});delete old.modes.grainSustainEnabled;setGrainSustainEnabled(false,{skipSave:true});restoreState({state:old,songSnapshot:true,throwOnError:true});if(!grainSustainEnabled)throw Error('Old state missing sustain must default On');setGrainSustainEnabled(false,{skipSave:true});saveState({force:true});});
  await p.reload();await p.waitForFunction(()=>mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);assert.equal(await p.evaluate(()=>grainSustainEnabled),false);assert.equal(await p.locator('#performanceGrainModAmount').inputValue(),'82');await p.locator('#performanceGrainModAmount').scrollIntoViewIfNeeded();await p.screenshot({path:`${evidence}/${engine}-depth.png`});await p.locator('#performanceGrainSustainBtn').scrollIntoViewIfNeeded();await p.screenshot({path:`${evidence}/${engine}-sustain.png`});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 assert.deepEqual(errors,[]);const result={engine,baseline,setup,held,offline,motion,routedSources,errors};results.push(result);console.log(JSON.stringify(result));await c.close();
 }finally{await b.close();}
}fs.writeFileSync(`${evidence}/${process.env.MYGRAIN_LOOP_BASELINE?'baseline':'current'}-results.json`,JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
