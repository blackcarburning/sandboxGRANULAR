const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18967/mygrain/';
(async()=>{const results=[];for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{for(const viewport of [{width:390,height:844},{width:844,height:390}]){
 const context=await browser.newContext({viewport,isMobile:true,hasTouch:true});assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-page-scroll'}})).status(),200);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin||r.request().url().startsWith('blob:')?r.continue():r.abort());await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainCardHistory);await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 const state=()=>page.evaluate(()=>({pan:capturePhoneDiagnosticState().panLab,wasp:mygrainWasp.diagnostics(),meters:mygrainMeters.snapshot()}));
 const off=await state();assert.equal(off.pan.enabled,false);assert.equal(off.pan.panners,0);assert.equal(off.pan.sources,0);assert.equal(off.pan.analyser,false);assert.equal(off.wasp.processors,0);
 await page.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});activeKeyCount=1;
  window.__panOsc=audioContext.createOscillator();__panOsc.frequency.value=220;window.__panGain=audioContext.createGain();__panGain.gain.value=.07;__panOsc.connect(__panGain).connect(outputGainNode);__panOsc.start();
  const code=`class Witness extends AudioWorkletProcessor{constructor(){super();this.p=0;this.n=0}process(inputs){for(const v of inputs[0]?.[0]||[]){this.p+=v*v;this.n++}if(this.n>=sampleRate*.25){this.port.postMessage(Math.sqrt(this.p/this.n));this.p=0;this.n=0}return true}}registerProcessor('pan-off-witness',Witness)`;
  const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));await audioContext.audioWorklet.addModule(url);URL.revokeObjectURL(url);
  window.__panWitness=new AudioWorkletNode(audioContext,'pan-off-witness');window.__panPcm=[];__panWitness.port.onmessage=e=>__panPcm.push(e.data);const mute=audioContext.createGain();mute.gain.value=0;finalAmplifierNode.connect(__panWitness);__panWitness.connect(mute).connect(audioContext.destination);
  window.__panReads=0;const read=readFinalPanAnalysis;readFinalPanAnalysis=(...a)=>{__panReads++;return read(...a)};
 });
 await page.waitForFunction(()=>__panPcm.length>1&&__panPcm.at(-1)>.00001);
 // The visible master VU owns its own bounded display tap, never Pan Lab DSP.
 await page.evaluate(()=>{setPerformanceMixerVuMetersEnabled(true);performanceOutputVuShell.scrollIntoView({block:'center',behavior:'instant'})});
 await page.waitForFunction(()=>!mygrainUiActivity.busy&&Boolean(performanceOutputAnalyser));
 assert(await page.evaluate(()=>readOutputDisplayRms()>.00001));
 assert.equal((await state()).pan.panners,0);
 await page.evaluate(()=>document.getElementById('finalPanSection').scrollIntoView({block:'start',behavior:'instant'}));
 await page.waitForFunction(()=>!performanceOutputAnalyser);

 for(let cycle=0;cycle<4;cycle++){
  await page.evaluate(()=>{for(const id of ['finalPanAudioDepth','finalPanOrbit','finalPanGravity'])setSliderValue(id,0);setSliderValue('finalPanWidth',100);setSliderValue('finalPanLfoDepth',60);updateFinalOutputPanning();});
  await page.locator('#finalPanEnabled').check();await page.waitForTimeout(100);
  let s=await state();assert(s.pan.active);assert.equal(s.pan.panners,2);assert.equal(s.pan.sources,1);assert.equal(s.pan.analyser,false,'LFO-only motion needs no FFT');
  await page.evaluate(()=>{setSliderValue('finalPanAudioDepth',35);updateFinalOutputPanning()});await page.waitForTimeout(150);s=await state();assert.equal(s.pan.sources,2);assert(s.pan.analyser);assert(await page.evaluate(()=>__panReads>0));
  await page.evaluate(()=>{for(const id of ['finalPanAudioDepth','finalPanLfoDepth','finalPanOrbit','finalPanGravity'])setSliderValue(id,0);updateFinalOutputPanning();});
  s=await state();assert.equal(s.pan.enabled,true);assert.equal(s.pan.active,false);assert.equal(s.pan.panners,0);assert.equal(s.pan.sources,0);assert.equal(s.pan.analyser,false);
  await page.locator('#finalPanEnabled').uncheck();
  await page.evaluate(async()=>{const s=mygrainWasp.settings();s.enabled=true;s.blend=1;s.output=0;await mygrainWasp.restore(s)});assert.equal((await state()).wasp.processors,2);
  await page.evaluate(async()=>{await mygrainWasp.restore({...mygrainWasp.settings(),enabled:false})});assert.equal((await state()).wasp.processors,0,'Off must remove processors before restore returns');
  await page.waitForFunction(()=>mygrainWasp.diagnostics().retiringProcessors===0);
 }
 await page.evaluate(()=>{setSliderValue('finalPanAudioDepth',90);updateFinalOutputPanning();__panReads=0;window.__scrollTargets=[...document.querySelectorAll('.performance-feature-card'),document.getElementById('finalPanSection')].filter(Boolean);});
 // First visit allows legitimate lazy UI mounts; subsequent sweeps must remain bounded.
 for(let i=0;i<await page.evaluate(()=>__scrollTargets.length);i++){await page.evaluate(i=>__scrollTargets[i].scrollIntoView({block:'start',behavior:'instant'}),i);await page.waitForTimeout(80)}
 await page.waitForTimeout(500);
 const before=await page.evaluate(()=>({dom:document.querySelectorAll('*').length,registered:mygrainMeters.snapshot().registered,groups:mygrainLoopFx.groups.size,scroll:mygrainUiActivity.snapshot().events}));
 await page.evaluate(()=>{__panPcm=[];window.__panStart={audio:audioContext.currentTime,wall:performance.now()}});
 for(let round=0;round<4;round++){for(let i=0;i<await page.evaluate(()=>__scrollTargets.length);i++){await page.evaluate(i=>__scrollTargets[i].scrollIntoView({block:'start',behavior:'instant'}),round%2?await page.evaluate(()=>__scrollTargets.length)-1-i:i);await page.waitForTimeout(35)}}
 await page.waitForTimeout(400);
 const after=await page.evaluate(()=>({dom:document.querySelectorAll('*').length,registered:mygrainMeters.snapshot().registered,groups:mygrainLoopFx.groups.size,scroll:mygrainUiActivity.snapshot().events,pan:capturePhoneDiagnosticState().panLab,wasp:mygrainWasp.diagnostics(),reads:__panReads,pcm:__panPcm,ratio:(audioContext.currentTime-__panStart.audio)/((performance.now()-__panStart.wall)/1000)}));
 assert.equal(after.pan.panners,0);assert.equal(after.pan.sources,0);assert.equal(after.pan.analyser,false);assert.equal(after.reads,0);assert.equal(after.wasp.processors,0);assert.equal(after.registered,before.registered);assert.equal(after.groups,before.groups);assert(after.dom<=before.dom+10);assert(after.scroll>before.scroll);assert(after.pcm.length>5&&after.pcm.every(v=>v>.00001));assert(after.ratio>.95);
 await page.evaluate(()=>{setFinalPanEnabled(true,{skipSave:true});saveState({force:true});window.__savedPanState=readStoredStateSnapshot();});assert.equal(await page.evaluate(()=>__savedPanState.modes.finalPanEnabled),true);assert.equal(await page.evaluate(()=>gatherPreset().finalPanEnabled),true);
 // Startup always returns to opt-in Off even if the saved editor switch was On.
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');assert.equal(await page.locator('#finalPanEnabled').isChecked(),false);
 assert.deepEqual(errors,[]);results.push({engine,viewport,before,after});await context.close();
 }}finally{await browser.close()}}
 console.log(JSON.stringify({passed:results.length,results},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
