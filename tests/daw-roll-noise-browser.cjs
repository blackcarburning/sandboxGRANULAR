'use strict';
const assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const base='http://127.0.0.1:18933/mygrain/';
(async()=>{const browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});try{
 const ctx=await browser.newContext();await ctx.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-daw-fixture'}});const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.log('PAGE',e.message)});await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());await p.goto(base);await p.waitForFunction(()=>window.mygrainDaw&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 const result=await p.evaluate(async()=>{
  await mygrainInitialisePatch.run();stopAllPerformancePlayback({silent:true});applyGlobalBpm(300,{silent:true,skipSave:true});syncPatternLengthControls(8,{skipSave:true});
  const b=audioContext.createBuffer(1,audioContext.sampleRate/4,audioContext.sampleRate),samples=b.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=.2*Math.sin(i*2*Math.PI*440/audioContext.sampleRate)*(1-i/samples.length);
  setBastardLoopXSourceMode('sample',{skipSave:true});bastardLoopXSampleBuffer=b;setBastardLoopXEnabled(true,{silent:true,skipSave:true});setBastardLoopXLevelPercent(60,{skipSave:true});bastardLoopXSequence[0]={note:'C3',rest:false,ratchet:2};
  qSourceSampleBuffer=b;mygrainQ.restore({...MygrainQTheory.defaults(),soundSource:'sample',enabled:true,sequence:[{notes:[60,64,67],velocity:91,gate:1},...Array(63).fill(null)]});
  mygrainKMultitrack.setBuffer(1,b);Object.assign(mygrainKMultitrack.tracks[1],{level:.5,sourceBpm:300,steps:8,enabled:true,mute:false});setBastardLoopKEnabled(true,{silent:true,skipSave:true});setBastardLoopKLevelPercent(50,{skipSave:true});
  mygrainNoise.restore({enabled:true,level:35,source:'X',mode:'follow',amount:3});
  drumMachineSnareBuffer=b;setDrumMachineEnabled(true,{silent:true,skipSave:true});setDrumMachinePattern('snare',[true,false,false,false,true,false,false,false],{silent:true,skipSave:true});restoreDrumMachineRoll({length:8,pattern:[true,false,false,false,false,false,false,false],ratchets:[3,0,0,0,0,0,0,0]});
  const decoded=await mygrainSongBetaAdapter.capture({liveOnly:true}),timing={bpm:300,patternSteps:8,repeats:1},items=mygrainDaw.components(decoded),results=[];
  for(const key of ['drumsnare','drumroll','noise']){
   const comp=items.find(x=>x.key===key);if(!comp)throw Error('Missing component '+key+' in '+JSON.stringify(items));
   const info=await mygrainDaw.renderComponent(decoded,timing,comp,new AbortController().signal,async buffer=>{if(buffer.sampleRate!==audioContext.sampleRate)throw Error('Wrong rate');});results.push({key,...info});
  }
  return {results,bridges:window.__mygrainSongRenderBridges.size};
 });
 for(const r of result.results){assert.ok(r.peak>.000001,JSON.stringify(r));if(['loopX','loopQ'].includes(r.key))assert.ok(r.midi.length>0,JSON.stringify(r));console.log('PASS LANE',r.key,r.peak,r.midi.length,r.tailSeconds);}
 assert.equal(result.bridges,0);assert.deepEqual(errors,[]);const normal=result.results.find(r=>r.key==='drumsnare').midi,roll=result.results.find(r=>r.key==='drumroll').midi;assert.equal(normal.length,1,JSON.stringify(normal));assert.equal(roll.length,3,JSON.stringify(roll));assert.ok(normal[0].start>.1);assert.equal(roll[0].start,0);console.log('PASS separate normal Snare/Roll and X-driven N; renderer cleanup');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
