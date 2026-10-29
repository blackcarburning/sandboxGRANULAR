'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'https://openclaw.blackcarburning.com/mygrain/';
const out=process.env.MYGRAIN_DRUM_LOOP_EVIDENCE||'/tmp/mygrain-generated-drums-only';fs.mkdirSync(out,{recursive:true});
(async()=>{const results=[];for(const[engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{
 const c=await browser.newContext({viewport:{width:1280,height:900}}),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(60000);
 await p.route('**/*',r=>{const req=r.request(),u=new URL(req.url());if(u.origin!==new URL(base).origin||!['GET','HEAD'].includes(req.method()))return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"drums-only-fixture"}};'});if(u.pathname.includes('/api/'))return r.fulfill({json:{ok:true,authenticated:true,user:{username:'drums-only-fixture'},files:[],songs:[],folders:[],samples:[],patches:[],stations:[]}});return r.continue()});
 await p.goto(base);await p.waitForFunction(()=>window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);console.log(engine,'ready');
 await p.evaluate(()=>{
  stopAllPerformancePlayback({silent:true});stopModulationLoop();stopPerformanceMixerVuMeters();clearAllPerformanceSoloStates({silent:true,skipSave:true});
  mygrainNoise.setEnabled(false,{skipSave:true});setOscillatorsEnabled(true,{silent:true,skipSave:true});setGranularLayersEnabled(true,{silent:true,skipSave:true});setGeneratedSampleLayerEnabled(true,{silent:true,skipSave:true});setGeneratedDryLoopEnabled(true,{silent:true,skipSave:true});setGeneratedDryMixPercent(80);setGeneratedLoopTransportEnabled(true,{silent:true,skipSave:true});
  setKeyboardSoundSource('grain',{skipSave:true});setArpeggiatorEnabled(false);applyGlobalBpm(120);
  const sr=audioContext.sampleRate,duration=getPatternLengthSteps()*60/120/4;
  generatedLoopBuffer=audioContext.createBuffer(1,Math.ceil(sr*duration),sr);generatedLoopBaseBuffer=generatedLoopBuffer;
  const d=generatedLoopBuffer.getChannelData(0);for(let i=0;i<d.length;i++){const t=i/sr,phase=t%.125;d[i]=.2*Math.sin(2*Math.PI*130*t)*Math.exp(-phase*10)}
  for(const[key,freq]of [['A',880],['B',1320]]){const b=audioContext.createBuffer(1,Math.ceil(sr*.5),sr),data=b.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=.2*Math.sin(2*Math.PI*freq*i/sr);if(key==='A')grainASampleBuffer=b;else grainBSampleBuffer=b;document.getElementById('grainSynth'+key+'Source').value='grain'+key+'Sample';setSliderValue('grainSynth'+key+'Volume',100);setGranularLayerMuted(key,false,{skipSave:true})}
  updateSourceAvailability();
  // Deliberately simulate old patches that still request sequenced grains.
  seqGrainsEnabled=true;document.getElementById('seqGrainsEnabled').checked=true;sequencerSteps.forEach(s=>s.enabled=true);
  window.noteCalls=[];const osc=playOscillatorNote,grains=startGrainStream;
  playOscillatorNote=(...args)=>{noteCalls.push({kind:'osc',role:args[3]?.role});return osc(...args)};
  startGrainStream=(...args)=>{noteCalls.push({kind:'grain',role:args[3]?.role});return grains(...args)};
  window.measureBus=async(node)=>{const a=audioContext.createAnalyser();a.fftSize=2048;node.connect(a);await new Promise(r=>setTimeout(r,Math.max(400,((generatedDrySource?.patternSectionStart||0)-audioContext.currentTime+.15)*1000)));const d=new Float32Array(2048);a.getFloatTimeDomainData(d);node.disconnect(a);a.disconnect();return Math.max(...d.map(Math.abs))};
 });
 await p.locator('#performanceSeqPlayBtn').click();
 const running=await p.evaluate(async()=>({playing:sequencerPlaying,source:generatedDrySource?.buffer===generatedLoopBuffer,drums:await measureBus(generatedDryGainNode),grains:await measureBus(granularOutputGain),calls:noteCalls,streams:[...activeGrains.values()].map(x=>x.role)}));
 assert(running.playing&&running.source);assert(running.drums>.001,JSON.stringify(running));assert(running.grains<1e-6,JSON.stringify(running));assert.deepEqual(running.calls,[]);assert.deepEqual(running.streams,[]);
 await p.locator('#performanceLoopDisableBtn').click();
 assert.deepEqual(await p.evaluate(()=>({enabled:generatedLoopTransportEnabled,playing:sequencerPlaying,source:!!generatedDrySource})),{enabled:false,playing:false,source:false});
 await p.locator('#performanceLoopDisableBtn').click();await p.locator('#performanceSeqPlayBtn').click();
 const separate=await p.evaluate(async()=>{
  playKeyboardSound('C4',audioContext.currentTime+.03,1,{role:'keyboard'});
  const grains=await measureBus(granularOutputGain),before=[...activeGrains.values()].map(x=>x.role);
  setGeneratedLoopTransportEnabled(false,{silent:true,skipSave:true});
  return{grains,before,after:[...activeGrains.values()].map(x=>x.role),afterGain:await measureBus(granularOutputGain),drumsStopped:!generatedDrySource,calls:noteCalls};
 });
 assert(separate.grains>.00001,JSON.stringify(separate));assert(separate.afterGain>.00001,JSON.stringify(separate));assert(separate.before.includes('keyboard'));assert(separate.after.includes('keyboard'));assert(separate.drumsStopped);assert(!separate.calls.some(c=>c.role==='sequencer'));
 await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});setGeneratedLoopTransportEnabled(true,{silent:true,skipSave:true});const s=saveState({force:true,snapshotOnly:true});s.checkboxes||={};s.checkboxes.seqGrainsEnabled=true;restoreState({state:s,songSnapshot:true,throwOnError:true});noteCalls.length=0;startSequencer()});
 const legacy=await p.evaluate(async()=>{await new Promise(r=>setTimeout(r,350));return{playing:sequencerPlaying,calls:noteCalls,roles:[...activeGrains.values()].map(x=>x.role)}});assert(legacy.playing);assert.deepEqual(legacy.calls,[]);assert(!legacy.roles.includes('sequencer'));
 await p.evaluate(()=>stopAllPerformancePlayback({silent:true}));assert.equal(await p.locator('#seqGrainsEnabled').isVisible(),false);
 assert.deepEqual(errors,[]);results.push({engine,running,separate,legacy});console.log('PASS',engine,JSON.stringify({running,separate,legacy}));await c.close();
 }finally{await browser.close()}
}fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2))})().catch(e=>{console.error(e);process.exitCode=1});
