 'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.BASE,out=process.env.OUT;
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);fs.mkdirSync(out,{recursive:true});
(async()=>{for(const [name,type,phone] of [['chromium',chromium,false],['webkit',webkit,true]]){
 const browser=await type.launch(type===chromium?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1440,height:1000},isMobile:phone,hasTouch:phone}),p=await context.newPage(),errors=[];
 p.setDefaultTimeout(120000);p.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message)});p.on('dialog',d=>d.accept());
 await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
 const ready=async(start=true)=>{await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainCookingPot);await p.evaluate(()=>mygrainCardHistory.ready);if(start){await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy)}};
 await p.goto(base);await ready();
 await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});window.__readEffects=()=>{const effects={wasp:mygrainWasp.settings(),playground:mygrainWasp.settings().playground,mutilator:mygrainD.settings().mutilator,bassFace:mygrainBassFace.settings(),turntable:mygrainTurntable.settings(),resonator:mygrainResonator.settings(),...mygrainAcousticFx.settings(),masterBaker:mygrainMasterBaker.settings()};return{effects,output:mygrainEffectOutput.settings(),pot:mygrainCookingPot.settings(),powers:Object.fromEntries(Object.entries(effects).map(([k,v])=>[k,v.enabled]))}};
  const b=audioContext.createBuffer(2,48000,48000);for(let ch=0;ch<2;ch++)for(let i=0;i<b.length;i++)b.getChannelData(ch)[i]=.02*Math.sin(2*Math.PI*220*i/48000);
  await mygrainD.apply(b,'fixture.wav',{fileName:'fixture.wav',sourceKey:'import'});mygrainD.enable(true,{skipSave:true});
  for(const s of ['','2','3','V','W','P','O','M','MPlus'])eval(`bastardLoop${s}Buffer=b;bastardLoop${s}Enabled=true;bastardLoop${s}Level=.6`);
  bastardLoopDBuffer=b;bastardLoopLSampleBuffer=b;bastardLoopXSampleBuffer=b;bastardLoopLEnabled=true;bastardLoopXEnabled=true;setLoopLayerSolo([],{silent:true,skipSave:true});
  generateSourceWithPlaybackRestart=async()=>{};requestMegaRandomBastardLoopBuild=async s=>s;applyMegaRandomBastardLoopBuild=async()=>{};loadMegaRandomGranularSample=async()=>{};loadBastardLoopLSampleFromSource=async()=>{};loadBastardLoopXSampleFromSource=async()=>{};loadDropboxSampleLayerFromSource=async()=>{};loadRandomDrumMachineSamples=async()=>{};mygrainD.random=async()=>{};
  window.__realSelection=applyMegaRandomEffectSelection;applyMegaRandomEffectSelection=o=>__realSelection({...o,random:()=>.2});
  window.__seedOn=async()=>{mygrainEffectOutput.restore({...mygrainEffectOutput.settings(),mainMuted:true});mygrainD.setMutilator({enabled:true,input:'D'},{skipSave:true});await mygrainBassFace.restore({...mygrainBassFace.settings(),enabled:true,input:'D'});await mygrainAcousticFx.set('wireWorld',{...mygrainAcousticFx.settings('wireWorld'),enabled:true,source:'D',level:.1});await mygrainMasterBaker.setEnabled(true);await mygrainCookingPot.whenReady();saveState({force:true})};
 });
 if(name==='chromium')await p.evaluate(async()=>{document.getElementById('songBetaName').value='Randomizer normal output';await mygrainSongBeta.newSong()});
 const read=()=>p.evaluate(()=>__readEffects());
 const assertOff=async()=>{const state=await read();assert.equal(Object.keys(state.powers).length,12);assert(Object.values(state.powers).every(v=>v===false),JSON.stringify(state.powers));const diag=await p.evaluate(()=>({power:mygrainCookingPot.powerEnabled(),pressed:document.querySelector('[data-pot-power]').getAttribute('aria-pressed'),pot:mygrainCookingPot.diagnostics(),baker:mygrainMasterBaker.diagnostics()}));assert(!state.output.mainMuted,'main output unmuted');assert.equal(await p.locator('[data-effect-main-mute="cookingPot"]').getAttribute('aria-pressed'),'false');assert.equal(diag.power,false);assert.equal(diag.pressed,'false');assert.equal(diag.pot.processors,0);assert.equal(diag.baker.processors,0);return{state,diag}};
 const cases=[];
 for(const sparseMode of [false,true]){
  await p.evaluate(()=>__seedOn());const before=await read();assert(before.powers.masterBaker&&before.powers.wireWorld);
  await p.evaluate(async sparseMode=>{await runMegaRandomization({sparseMode,tempoDecision:false});stopAllPerformancePlayback({silent:true});hideSettlePopup();await mygrainCookingPot.whenReady()},sparseMode);
  const result=await assertOff();
  await p.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual((await read()).effects,before.effects,'Undo restores powered state');assert.deepEqual((await read()).output,before.output,'Undo restores main mute');
  await p.evaluate(()=>mygrainCardHistory.redo());assert.deepEqual(await read(),result.state,'Redo restores generated Off');
  // Exercise real ZIP recall inside the page; decoded AudioBuffers cannot cross the protocol.
  await p.evaluate(async()=>{const b=await mygrainSongBetaAdapter.capture(),d=await mygrainSongBetaAdapter.decode(await b.arrayBuffer(),{buffers:new Map(),bytes:0,reservedBytes:0,limitBytes:256*1048576});await mygrainMasterBaker.setEnabled(true);await mygrainSongBetaAdapter.recall(d,{start:false});await mygrainCookingPot.whenReady()});
  assert.deepEqual((await read()).effects,result.state.effects,'ZIP recall retains all Off');assert.deepEqual((await read()).output,result.state.output,'ZIP recalls unmuted main output');
  if(!sparseMode){assert(Object.values(result.state.pot.power.remembered).some(Boolean),'Mega keeps generated choices');await p.evaluate(()=>mygrainCookingPot.setPower(true));assert.deepEqual((await read()).powers,result.state.pot.power.remembered,'Explicit On restores only generated selection');await p.evaluate(()=>mygrainCookingPot.setPower(false));}
  if(name==='chromium')await p.evaluate(sparse=>mygrainSongBeta.newPart({name:sparse?'Sparse Off':'Mega Off',repeats:1}),sparseMode);
  cases.push({mode:sparseMode?'Sparse':'Mega',...result});console.log(name,cases.at(-1).mode,'Off, released processors, Undo/Redo, ZIP, explicit On');
 }

 // The accepted ordinary patch randomizer shares the main-output generation policy.
 await p.evaluate(()=>mygrainEffectOutput.restore({...mygrainEffectOutput.settings(),mainMuted:true}));
 await p.evaluate(async()=>{await runPatchRandomization();stopAllPerformancePlayback({silent:true});hideSettlePopup()});
 assert(!(await read()).output.mainMuted,'ordinary randomizer unmutes');
 await p.evaluate(()=>mygrainCardHistory.undo());assert.equal((await read()).output.mainMuted,true,'ordinary Undo restores mute');
 await p.evaluate(()=>mygrainCardHistory.redo());assert(!(await read()).output.mainMuted,'ordinary Redo unmutes');
 // Real Liquidizer button, low-depth starting recipes, history and ZIP round-trip.
 await p.evaluate(async()=>{const low=lfo=>({...lfo,depth:.17});mygrainD.setMutilator({lfo:low(mygrainD.settings().mutilator.lfo)},{skipSave:true});mygrainBassFace.restore({...mygrainBassFace.settings(),lfo:low(mygrainBassFace.settings().lfo)});for(const k of ['wireWorld','sonicCrystal','bubbleChamber','heavyLifter'])await mygrainAcousticFx.set(k,{...mygrainAcousticFx.settings(k),lfo:low(mygrainAcousticFx.settings(k).lfo)});await mygrainCookingPot.whenReady();saveState({force:true})});
 const beforeLiquid=await read();
 await p.locator('#cookingPotCard').evaluate(el=>{mygrainDisplay.reveal(el);el.scrollIntoView({block:'start'})});
 await p.locator('[data-pot-liquidizer]').click();await p.waitForFunction(()=>!mygrainCardHistory.busy&&!document.querySelector('[data-pot-liquidizer]').disabled);await p.evaluate(()=>mygrainCookingPot.whenReady());
 const liquid=await read();for(const k of ['mutilator','bassFace','wireWorld','sonicCrystal','bubbleChamber','heavyLifter'])assert(liquid.effects[k].lfo.depth>=.8&&liquid.effects[k].lfo.depth<=1,k+' runtime Liquidizer depth');
 const withoutLfo=v=>JSON.parse(JSON.stringify(v,(k,x)=>k==='lfo'?undefined:x));assert.deepEqual(withoutLfo(liquid),withoutLfo(beforeLiquid),'Liquidizer retains non-LFO state');
 await p.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual((await read()).effects,beforeLiquid.effects,'Liquidizer Undo');
 await p.evaluate(()=>mygrainCardHistory.redo());assert.deepEqual((await read()).effects,liquid.effects,'Liquidizer Redo');
 await p.evaluate(async()=>{const b=await mygrainSongBetaAdapter.capture(),d=await mygrainSongBetaAdapter.decode(await b.arrayBuffer(),{buffers:new Map(),bytes:0,reservedBytes:0,limitBytes:256*1048576});await mygrainSongBetaAdapter.recall(d,{start:false});await mygrainCookingPot.whenReady()});assert.deepEqual((await read()).effects,liquid.effects,'Liquidizer ZIP recall');
 if(name==='chromium')await p.evaluate(async()=>{await mygrainCookingPot.setPower(false);await mygrainAcousticFx.set('wireWorld',{...mygrainAcousticFx.settings('wireWorld'),enabled:true,source:'D',level:.3});await mygrainCookingPot.whenReady();await mygrainSongBeta.newPart({name:'Liquidizer 80–100%',repeats:1})});
 console.log(name,'ordinary unmute, Liquidizer depth 80–100%, retained recipes/power/routes, Undo/Redo and ZIP');
 let song=null;
 if(name==='chromium'){
  song=await p.evaluate(async()=>{const c=mygrainSongBeta,hashes=c.song.parts.map(p=>p.sha256),revision=c.song.revision;await c.finishEditing();c.serverPreparation=true;c.phonePreparation=true;await c.arm();if(!c.armed)throw Error(document.getElementById('songBetaStatus').textContent);const rows=[];for(const part of c.song.parts){const b=await c.loadRender(part),a=b.getChannelData(0);if(!a.every(Number.isFinite))throw Error('Nonfinite rendered samples');rows.push({name:part.name,frames:b.length,rms:Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length)})}const before=JSON.stringify(c.song.parts.map(p=>p.render));await c.arm();await c.playSong();const playing=c.playing;c.stop();if(JSON.stringify(c.song.parts.map(p=>p.sha256))!==JSON.stringify(hashes)||c.song.revision!==revision)throw Error('Source snapshots changed');return{rows,playing,warmReuse:before===JSON.stringify(c.song.parts.map(p=>p.render)),memory:c.memoryBudget.bytes}});
  assert.equal(song.rows.length,3);assert(song.rows.every(r=>r.frames>0&&r.rms>1e-6),JSON.stringify(song));assert(song.playing&&song.warmReuse);assert.equal(song.memory,0);console.log(name,'three real server Song renders, warm reuse and playback',JSON.stringify(song));
 }
 // A source acquisition warning must not bypass the final group-Off boundary.
 await p.evaluate(async()=>{await __seedOn();loadMegaRandomGranularSample=async()=>{throw Error('isolated expected source warning')};await runMegaRandomization({tempoDecision:false});stopAllPerformancePlayback({silent:true});hideSettlePopup()});await assertOff();console.log(name,'source-warning completion Off');
 for(const mode of ['Mega','Sparse']){const text=await p.evaluate(async mode=>{const done=confirmPatchRandomisation(mode),dialog=document.getElementById('randomisationConfirmDialog'),text=dialog.textContent;dialog.querySelector('button').click();await done;return text},mode);assert(text.includes('normal output'));}
 await p.evaluate(()=>saveState({force:true}));const final=await read();await p.reload();await ready(false);const reloaded=await p.evaluate(()=>({effects:{wasp:mygrainWasp.settings(),playground:mygrainWasp.settings().playground,mutilator:mygrainD.settings().mutilator,bassFace:mygrainBassFace.settings(),turntable:mygrainTurntable.settings(),resonator:mygrainResonator.settings(),...mygrainAcousticFx.settings(),masterBaker:mygrainMasterBaker.settings()},output:mygrainEffectOutput.settings(),pot:mygrainCookingPot.settings()}));assert.deepEqual(reloaded.output,final.output);assert.deepEqual(reloaded.effects,final.effects);assert.deepEqual(reloaded.pot,final.pot);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'random-output-depth-'+name+'.json'),JSON.stringify({cases,song,reloaded:true,sourceWarning:true,errors},null,2));console.log('PASS',name);await context.close();
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
