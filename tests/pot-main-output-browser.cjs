'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19333/mygrain/',out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{const results=[];for(const[engine,type]of Object.entries({chromium,webkit}))for(const phone of[false,true]){
 const label=engine+'-'+(phone?'phone':'desktop');if(process.env.MYGRAIN_TEST_CASES&&!process.env.MYGRAIN_TEST_CASES.split(',').includes(label))continue;
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{
  const context=await browser.newContext({viewport:{width:phone?390:1440,height:phone?844:1000},isMobile:phone,hasTouch:phone});
  assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
  const p=await context.newPage(),errors=[];p.setDefaultTimeout(90000);p.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.stack)});
  await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);
  await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  await p.evaluate(async()=>{
   stopAllPerformancePlayback({silent:true});for(const l of SPARSE_RANDOM_LAYER_DEFINITIONS)l.setEnabled(false,{silent:true,skipSave:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});
   setFxMuted(true,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);
   for(const id of['reverb','distortion','noiseMix','finalDriveSoft','finalDriveHard','finalDriveFold','finalDriveCrush','finalCompressorAmount','finalSidechainAmount','delayMix','delayFeedback','finalDelayDepth','finalReverbMix','oscNoiseLevel'])setSliderValue(id,0);
   mygrainLoopFx.restore();mygrainChannelEq.restore();mygrainNoise.restore();await mygrainCookingPot.restore();await mygrainWasp.restore();await mygrainTurntable.off();await mygrainResonator.off();await mygrainAcousticFx.off();mygrainBassFace.restore();mygrainD.setMutilator({enabled:false,input:'A'});mygrainEffectOutput.restore();setSliderValue('performanceMasterTrim',0);applyGlobalBpm(240);syncPatternLengthControls(16,{skipSave:true});setSliderValue('volume',100);
   const src=audioContext.createBuffer(2,audioContext.sampleRate,audioContext.sampleRate);for(let ch=0;ch<2;ch++)for(let i=0;i<src.length;i++)src.getChannelData(ch)[i]=.12*(Math.sin(2*Math.PI*110*i/src.sampleRate)+.2*Math.sin(2*Math.PI*730*i/src.sampleRate));
   bastardLoopBuffer=src;bastardLoopSourceBpm=240;bastardLoopMetadata={bpm:240,durationSeconds:1};setBastardLoopEnabled(true,{silent:true,skipSave:true});setSliderValue('bastardLoopLevel',60);setBastardLoopPlaying(true,{silent:true,skipSave:true});
   window.potMainSource=src;
   window.potMainMeasure=async()=>{await new Promise(r=>setTimeout(r,220));const {audioBuffer:b}=await recordLiveOutputPcm(audioContext,finalAmplifierNode,.25);let sum=0,peak=0;for(const x of b.getChannelData(0)){sum+=x*x;peak=Math.max(peak,Math.abs(x));}return{rms:Math.sqrt(sum/b.length),peak,frames:b.length};};
   mygrainDisplay.reveal(document.getElementById('cookingPotCard'));
   document.getElementById('cookingPotCard').scrollIntoView({block:'center'});
  });
  const slider=p.locator('#cookingPotCard [data-effect-master-proxy="cookingPot"]'),mute=p.locator('#cookingPotCard [data-effect-main-mute]');
  assert.equal(await slider.count(),1);assert.equal(await slider.getAttribute('id'),null);assert.equal(await mute.getAttribute('aria-pressed'),'false');
  await slider.focus();await slider.press('Home');await slider.press('ArrowRight');assert.equal(await p.locator('#volume').inputValue(),'1');
  // Native pointer/touch range changes, including phone viewport scroll stability.
  await slider.scrollIntoViewIfNeeded();const box=await slider.boundingBox();const x=box.x+box.width*.64,y=box.y+box.height/2;
  if(phone)await p.touchscreen.tap(x,y);else await p.mouse.click(x,y);
  const chosen=Number(await slider.inputValue());assert(chosen>45&&chosen<80,'native slider selected '+chosen);assert.equal(Number(await p.locator('#volume').inputValue()),chosen);
  assert.equal(await p.locator('#resonatorMasterVolume').inputValue(),String(chosen));
  await p.evaluate(()=>setSliderValue('volume',38));assert.equal(await slider.inputValue(),'38');
  const modes=[];
  for(const pot of[false,true]){
   await p.evaluate(async pot=>{await mygrainAcousticFx.off();await mygrainCookingPot.restore({enabled:pot});await mygrainCookingPot.whenReady();setSliderValue('volume',100);},pot);
   const full=await p.evaluate(()=>potMainMeasure());await p.evaluate(()=>setSliderValue('volume',50));const half=await p.evaluate(()=>potMainMeasure());
   assert(full.rms>1e-5);assert(Math.abs(half.rms/full.rms-.5)<.025,JSON.stringify({pot,full,half}));
   await p.evaluate(()=>{lfoEnabled.volume=true;lfo2Enabled.volume=true;updateEffects();});
   await mute.click();await p.waitForFunction(()=>!mygrainCardHistory.busy&&mygrainEffectOutput.settings().mainMuted===true);
   const dryMuted=await p.evaluate(()=>potMainMeasure());assert(await p.evaluate(()=>lfoEnabled.volume&&lfo2Enabled.volume),'Mute retains volume modulation');await p.evaluate(()=>{lfoEnabled.volume=false;lfo2Enabled.volume=false;updateEffects();});assert(dryMuted.rms<1e-7,JSON.stringify({pot,dryMuted}));assert.equal(await mute.getAttribute('aria-pressed'),'true');
   await p.evaluate(async()=>{await mygrainAcousticFx.set('wireWorld',{...MygrainAcousticPresets.BANKS.wireWorld[47].settings(),enabled:true,source:'A',level:.8});await mygrainCookingPot.whenReady();});
   const independent=await p.evaluate(()=>potMainMeasure());assert(independent.rms>1e-5,JSON.stringify({pot,independent}));
   const unchanged=await p.evaluate(()=>({source:bastardLoopBuffer===potMainSource,playing:bastardLoopPlaying,power:mygrainAcousticFx.settings('wireWorld').enabled,volume:mygrainEffectOutput.diagnostics().level}));assert(unchanged.source&&unchanged.playing&&unchanged.power);assert(unchanged.volume>0);
   const all=p.locator('#cookingPotCard [data-effect-through-main-all]');
   assert.equal(await all.getAttribute('aria-pressed'),'false');
   await all.click();await p.waitForFunction(()=>!mygrainCardHistory.busy&&Object.keys(mygrainEffectOutput.settings().throughMain).length===9);
   assert.equal(await all.getAttribute('aria-pressed'),'true');
   const following=await p.evaluate(()=>potMainMeasure());assert(following.rms<1e-7,JSON.stringify({pot,following}));
   const routingSaved=await p.evaluate(async()=>{const state=saveState({snapshotOnly:true,force:true}),preset=gatherPreset(),blob=await mygrainSongBetaAdapter.capture(),decoded=await mygrainSongBetaAdapter.decode(await blob.arrayBuffer(),{buffers:new Map(),bytes:0,limitBytes:256*1024*1024});return{state:state.modes.effectOutput,preset:preset.effectOutput,zip:decoded.snapshot.state.modes.effectOutput};});
   for(const saved of Object.values(routingSaved)){assert.equal(Object.keys(saved.throughMain).length,9);assert(saved.mainMuted);}
   await all.click();await p.waitForFunction(()=>!mygrainCardHistory.busy&&!Object.keys(mygrainEffectOutput.settings().throughMain).length);assert.equal(await all.getAttribute('aria-pressed'),'false');
   const wetAgain=await p.evaluate(()=>potMainMeasure());assert(wetAgain.rms>1e-5);
   await p.evaluate(()=>document.querySelector('[data-effect-through-main="wireWorld"]').click());
   await p.waitForFunction(()=>!mygrainCardHistory.busy&&mygrainEffectOutput.settings().throughMain.wireWorld);
   assert.equal(await all.getAttribute('aria-pressed'),'mixed');assert((await all.textContent()).includes('Mixed'));
   await all.click();await p.waitForFunction(()=>!mygrainCardHistory.busy&&Object.keys(mygrainEffectOutput.settings().throughMain).length===9);
   await p.evaluate(()=>mygrainCardHistory.undo());await p.waitForFunction(()=>!mygrainCardHistory.busy&&Object.keys(mygrainEffectOutput.settings().throughMain).length===1);assert.equal(await all.getAttribute('aria-pressed'),'mixed');
   await p.evaluate(()=>mygrainCardHistory.redo());await p.waitForFunction(()=>!mygrainCardHistory.busy&&Object.keys(mygrainEffectOutput.settings().throughMain).length===9);assert.equal(await all.getAttribute('aria-pressed'),'true');
   await all.click();await p.waitForFunction(()=>!mygrainCardHistory.busy&&!Object.keys(mygrainEffectOutput.settings().throughMain).length);
   assert(await p.evaluate(()=>mygrainEffectOutput.settings().mainMuted&&document.getElementById('volume').value==='50'&&mygrainAcousticFx.settings('wireWorld').enabled));
   await mute.click();await p.waitForFunction(()=>!mygrainCardHistory.busy&&!mygrainEffectOutput.settings().mainMuted&&document.getElementById('volume').value==='50');assert.equal(await slider.inputValue(),'50');
   modes.push({pot,full,half,dryMuted,independent,following,wetAgain,routingSaved});
  }
  // Mute is one undoable edit; the fader remains unchanged.
  await p.evaluate(()=>setSliderValue('volume',38));await mute.click();await p.waitForFunction(()=>!mygrainCardHistory.busy&&mygrainEffectOutput.settings().mainMuted===true);
  await p.evaluate(()=>mygrainCardHistory.undo());await p.waitForFunction(()=>!mygrainCardHistory.busy&&document.getElementById('volume').value==='38');assert.equal(await slider.inputValue(),'38');assert.equal(await mute.getAttribute('aria-pressed'),'false');
  await p.evaluate(()=>mygrainCardHistory.redo());await p.waitForFunction(()=>!mygrainCardHistory.busy&&mygrainEffectOutput.settings().mainMuted===true);assert.equal(await slider.inputValue(),'38');assert.equal(await mute.getAttribute('aria-pressed'),'true');
  const saved=await p.evaluate(async()=>{const preset=gatherPreset(),state=saveState({snapshotOnly:true,force:true}),blob=await mygrainSongBetaAdapter.capture(),decoded=await mygrainSongBetaAdapter.decode(await blob.arrayBuffer(),{buffers:new Map(),bytes:0,limitBytes:256*1024*1024});const wav=await renderDawReadyBarsExport({exportSteps:16}),b=await audioContext.decodeAudioData(await wav.blob.arrayBuffer()),a=b.getChannelData(0);return{volume:state.sliders.volume,preset: preset.sliders.volume,zipVolume:decoded.snapshot.state.sliders.volume,mute:state.modes.effectOutput.mainMuted,presetMute:preset.effectOutput.mainMuted,zipMute:decoded.snapshot.state.modes.effectOutput.mainMuted,duplicateKeys:Object.keys(state.sliders).filter(k=>/potmain|cookingpot/i.test(k)),controls:decoded.snapshot.extra.controls,wav:{frames:b.length,rate:b.sampleRate,rms:Math.sqrt(a.reduce((n,v)=>n+v*v,0)/a.length)},pot:mygrainCookingPot.settings(),routing:mygrainEffectOutput.settings()};});
  assert.equal(Number(saved.volume),38);assert.equal(Number(saved.preset),38);assert.equal(Number(saved.zipVolume),38);assert(saved.mute&&saved.presetMute&&saved.zipMute);assert.deepEqual(saved.duplicateKeys,[]);assert(!JSON.stringify(saved.controls).includes('effect-main-mute'));assert(saved.wav.rms>1e-5);assert.equal(saved.wav.frames,saved.wav.rate);
  if(engine==='chromium'&&!phone){
   await p.evaluate(()=>{window.potExportContext=audioContext;});
   p.once('dialog',async d=>{assert.equal(d.type(),'confirm');p.once('dialog',d=>d.accept('muted-main-output-export'));await d.dismiss();});
   const upload=p.waitForResponse(r=>r.url().includes('/mygrain-wavs/api/upload')&&r.request().method()==='POST');
   await p.locator('#sectionJumpFinalMixBtn').click();assert([200,201].includes((await upload).status()));
   await p.waitForFunction(()=>!document.getElementById('performanceRepoExportBtn').disabled);
   assert(await p.evaluate(()=>potExportContext.state==='running'&&audioContext===potExportContext&&mygrainEffectOutput.settings().mainMuted&&document.getElementById('volume').value==='38'));
   saved.postExportSameContextRetainedMute=true;
  }
  await slider.scrollIntoViewIfNeeded();await p.locator('#cookingPotCard .pot-main-output').screenshot({path:out+'/'+label+'-main-output.png'});
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(phone){await p.setViewportSize({width:844,height:390});await p.waitForTimeout(250);await mute.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));await p.waitForFunction(()=>{const r=document.querySelector('#cookingPotCard [data-effect-main-mute]').getBoundingClientRect();return r.y>=-1&&r.bottom<=innerHeight+1;});const r=await mute.boundingBox();assert(r.y>=-1&&r.y+r.height<=391,JSON.stringify({label,r,viewport:await p.evaluate(()=>({width:innerWidth,height:innerHeight,y:scrollY}))}));assert(await slider.isVisible());await mute.tap();await p.waitForFunction(()=>!mygrainCardHistory.busy&&!mygrainEffectOutput.settings().mainMuted);await mute.tap();await p.waitForFunction(()=>!mygrainCardHistory.busy&&mygrainEffectOutput.settings().mainMuted);await p.setViewportSize({width:390,height:844});}
  await p.evaluate(()=>saveState({force:true}));await p.reload();await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&document.querySelector('#cookingPotCard [data-effect-main-mute]'));
  await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  assert.equal(await slider.inputValue(),'38');assert.equal(await mute.getAttribute('aria-pressed'),'true');assert.deepEqual(errors,[]);
  results.push({label,chosen,modes,saved,errors});fs.writeFileSync(out+'/pot-main-output-browser.json',JSON.stringify(results,null,2));console.log('PASS',label,'bulk On/Off/Mixed, nine routing flags, dry/wet/following PCM, history, ZIP/WAV/reload');await context.close();
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});
