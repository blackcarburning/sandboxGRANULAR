'use strict';
// Isolated accounts only. The real app/decoder/history are retained; model replies are fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18946/mygrain/';assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
const out=process.env.AI_SCOPE_EVIDENCE||'/tmp',repo=path.resolve(process.env.MYGRAIN_SOURCE_ROOT||path.join(__dirname,'..')),stage=process.env.MYGRAIN_CANDIDATE_ROOT&&path.resolve(process.env.MYGRAIN_CANDIDATE_ROOT);
fs.mkdirSync(out,{recursive:true});
const clone=x=>JSON.parse(JSON.stringify(x));
function equal(a,b,label){assert.equal(JSON.stringify(a)===JSON.stringify(b),true,label)}
(async()=>{const results=[];for(const [engine,type]of Object.entries(process.env.AI_SCOPE_BASELINE_ONLY?{chromium}:{chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{
 const c=await browser.newContext({viewport:engine==='webkit'?{width:390,height:844}:{width:1280,height:900},isMobile:engine==='webkit',hasTouch:engine==='webkit'}),p=await c.newPage(),errors=[];p.setDefaultTimeout(45000);p.on('pageerror',e=>errors.push(e.message));
 assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:process.env.MYGRAIN_TEST_ADMIN_PASSWORD||'isolated-speedups-test'}})).status(),200);
 let responseMode='success',release,holdSource=false,releaseSource,requests=0;
 await c.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==new URL(base).origin)return route.abort();
  if(process.env.AI_SCOPE_BASELINE_ONLY&&u.pathname==='/mygrain/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(out+'/before/index.html')});
  if(process.env.AI_SCOPE_BASELINE_ONLY&&u.pathname==='/mygrain/restructure.js')return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(out+'/before/restructure.js')});
  const corpus=/^\/mygrain\/((?:industry|restructure)-corpus-v1\/[a-f0-9]{20}\/\d+\.pcm)$/.exec(u.pathname);
  if(corpus&&stage){const target=path.join(stage,corpus[1]);if(!fs.existsSync(target)){fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repo,corpus[1]),target)}}
  if(u.pathname.endsWith('/api/ai-patch-direction')){
   requests++;const body=req.postDataJSON(),mode=responseMode;if(mode==='hold'||mode==='holdSuccess')await new Promise(r=>release=r);
   if(mode==='error'||mode==='hold')return route.fulfill({status:503,json:{ok:false,error:'Fixture AI unavailable. Patch unchanged.'}}).catch(()=>{});
   const recipe={title:'Card scope fixture',description:'Synthetic recipe for transaction checks.',parameters:{globalBpmSlider:body.current.globalBpmSlider===123?124:123},loops:{}};
   if(mode==='source')recipe.loops.A={reload:true,enabled:true,divisions:['1']};
   return route.fulfill({json:{ok:true,model:'openai/gpt-6.1-sol',recipe}})
  }
  if(holdSource&&req.method()==='POST'&&u.pathname.endsWith('/api/bastardloop')){await new Promise(r=>releaseSource=r);return route.fulfill({status:503,json:{error:'Fixture source unavailable'}}).catch(()=>{})}
  return route.continue();
 });
 await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainAiPatch?.ready&&window.mygrainGenreator?.genres.length===15&&window.mygrainRestructure);
 await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 async function reveal(target){await p.locator('#sectionJumpHandle').click();await p.locator('#sectionJumpPanel [data-jump-target="'+target+'"]:visible').first().click();await p.waitForFunction(()=>!document.documentElement.dataset.mygrainJumping)}
 async function seed(){await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});
  const tone=audioContext.createBuffer(1,22050,44100);for(let i=0;i<tone.length;i++)tone.getChannelData(0)[i]=.08*Math.sin(2*Math.PI*220*i/44100);
  if(!bastardLoopBuffer)await applyLoadedBastardLoopBuffer(tone,'AI scope reference',{sourceKey:'samples_radiolab',sampleNames:['scope-reference.wav'],bpm:123});setBastardLoopEnabled(true,{silent:true,skipSave:true});
  mygrainRobot.setBuffer(tone);mygrainRobot.restore({enabled:true,level:.17,loopBars:1,timingBars:1,phrases:[{text:'Retained words',enabled:true,lanes:[{word:'Retained',duration:.5,offset:0,pattern:[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}]}]});
  mygrainGlassHaus.restore({...MygrainGlassHaus.normalize(),enabled:true,level:.13,root:67});
  mygrainEnemyDrone.restore({...MygrainEnemyDrone.normalize(),enabled:true,level:.07});
  mygrainEmber.restore({...MygrainEmber.defaults(),enabled:true,level:.16,crossDepth:.079,sampleSource:{version:2,seed:13091,frames:2000}});
  mygrainRestructure.restore({...MygrainRestructure.defaults(),enabled:true,level:.14,crossDepth:.063});
  setDropboxSampleLayerEnabled(true,{silent:true,skipSave:true});
  const acoustic=mygrainAcousticFx.settings();acoustic.bubbleChamber.enabled=true;acoustic.bubbleChamber.mix=.23;acoustic.heavyLifter.enabled=true;
  // Use default Heavy settings: power and retained recipe are the scope under test.
  acoustic.henrysHose.enabled=true;acoustic.henrysHose.source='A';await mygrainAcousticFx.restore(acoustic);
  await mygrainMasterBaker.restore({...mygrainMasterBaker.settings(),enabled:true,settings:{...mygrainMasterBaker.settings().settings,compression:19}});
  await mygrainCookingPot.whenReady();saveState({force:true});await mygrainCardHistory.flush();
 });}
 async function state(){return p.evaluate(()=>({robot:mygrainRobot.settings(),glasshaus:mygrainGlassHaus.settings(),enemy:mygrainEnemyDrone.settings(),ember:mygrainEmber.settings(),restructure:mygrainRestructure.settings(),legacyR:dropboxSampleLayerEnabled,acoustic:mygrainAcousticFx.settings(),master:mygrainMasterBaker.settings()}))}
 function powers(s){return{sRobot:s.robot.enabled,sGlassHaus:s.glasshaus.enabled,sEnemy:s.enemy.enabled,sEmber:s.ember.enabled,sRestructure:s.restructure?.enabled,sLegacyRestructure:s.legacyR,fxHeavy:s.acoustic.heavyLifter.enabled,fxBubble:s.acoustic.bubbleChamber.enabled,fxMaster:s.master.enabled}}
 function retained(s){s=clone(s);for(const key of ['robot','glasshaus','enemy','ember','restructure','master'])delete s[key].enabled;delete s.legacyR;for(const key of ['heavyLifter','bubbleChamber'])delete s.acoustic[key].enabled;return s}
 function allOff(s,label){const on=Object.entries(powers(s)).filter(([,v])=>v);assert.equal(on.length,0,label+': still On = '+on.map(([k])=>k).join(', '))}
 async function settled(){await p.waitForFunction(()=>!mygrainAiPatch.busy&&!mygrainGenreator.busy&&!mygrainCardHistory.busy);await p.evaluate(()=>mygrainCardHistory.flush())}
 async function generate(){await reveal('#aiPatchCard');await p.locator('#aiPatchPrompt').fill('Create a fresh house patch using supported cards only.');await p.locator('#aiPatchGenerate').click();await settled();assert.match(await p.locator('#aiPatchStatus').textContent(),/^Applied/)}
 await seed();const before=await state();await generate();console.log('CHECK',engine,'fresh generation');const after=await state();allOff(after,'Fresh Generate');equal(retained(after),retained(before),'Only unsupported power may change, not recipes or supported effects');
 if(process.env.AI_SCOPE_BASELINE_ONLY){console.log('Unexpected baseline pass');continue;}
 await p.evaluate(()=>mygrainCardHistory.undo());await settled();equal(await state(),before,'Undo restores all unsupported powers and recipes');
 await p.evaluate(()=>mygrainCardHistory.redo());await settled();equal(await state(),after,'Redo restores generated power states without model calls');
 console.log('CHECK',engine,'Undo/Redo');const applied=await p.evaluate(async()=>{const before=saveState({snapshotOnly:true,force:true}),pcm=bastardLoopBuffer,robot=mygrainRobot.buffer,blob=await buildPatchZipBlob('AI supported cards.zip'),bytes=await blob.arrayBuffer();mygrainSongBetaAdapter.inspectPart(bytes);await openPatchZipFromArrayBuffer(bytes,'AI supported cards.zip');return{off:[mygrainRobot.settings().enabled,mygrainGlassHaus.settings().enabled,mygrainEmber.settings().enabled,mygrainRestructure.settings().enabled,mygrainEnemyDrone.settings().enabled],modes:before.modes,bytes:bytes.byteLength,robotFrames:mygrainRobot.buffer?.length,originalRobotFrames:robot.length,originalSourceFrames:pcm.length,sourceFrames:bastardLoopBuffer.length}});assert(applied.off.every(v=>v===false));assert.equal(applied.robotFrames,applied.originalRobotFrames);assert.equal(applied.sourceFrames,applied.originalSourceFrames);
 // A running Robot/GlassHaus graph must not survive successful generation.
 await seed();await p.evaluate(async()=>{await MygrainRobot.prepare(audioContext);await MygrainGlassHaus.prepare(audioContext);startAllBastardLoopLayers();});
 await p.waitForFunction(()=>mygrainRobot.running&&mygrainGlassHaus.running);await generate();allOff(await state(),'Running source cleanup');assert(await p.evaluate(()=>!mygrainRobot.running&&!mygrainGlassHaus.running&&!mygrainEnemyDrone.running&&!mygrainEmber.running&&!mygrainRestructure.running));
 console.log('CHECK',engine,'ZIP and running cleanup');
 // GENREator and Regenerate must use exactly the same common transaction.
 await seed();await reveal('#genreatorCard');await p.locator('#genreatorBpm').fill('');await p.locator('[data-genre="house"]').click();await settled();assert.match(await p.locator('#genreatorStatus').textContent(),/patch applied/);allOff(await state(),'GENREator');
 await seed();await reveal('#aiPatchCard');await p.locator('#aiPatchRegenerate').click();await settled();assert.match(await p.locator('#aiPatchStatus').textContent(),/^Applied/);allOff(await state(),'Regenerate');
 console.log('CHECK',engine,'GENREator/Regenerate');
 // Refine and section development are not fresh-patch replacement.
 await seed();const refinedBefore=await state();await reveal('#aiPatchCard');await p.locator('#aiPatchRefinement').fill('Nudge the tempo only, retaining my sounds.');await p.locator('#aiPatchRefine').click();await settled();assert.match(await p.locator('#aiPatchStatus').textContent(),/^Applied/);equal(await state(),refinedBefore,'Refine retains unsupported cards');
 await p.evaluate(async()=>{const recipe={parameters:{globalBpmSlider:sequencerBPM===125?126:125},loops:{}};await mygrainAiPatchAdapter.execute(recipe,mygrainAiPatchAdapter.fingerprint(),{mode:'section',protectEq:true})});await settled();equal(await state(),refinedBefore,'Song section retains unsupported cards');
 console.log('CHECK',engine,'Refine/section retained');
 // Merely asking, cancelling, rejection, and model failure must not switch anything off.
 responseMode='hold';release=null;await reveal('#aiPatchCard');await p.locator('#aiPatchGenerate').click();await p.waitForFunction(()=>mygrainAiPatch.busy);while(!release)await new Promise(r=>setTimeout(r,10));equal(await state(),refinedBefore,'Pending model request preserves powers');await p.locator('#aiPatchCancel').click();release();await settled();equal(await state(),refinedBefore,'Cancelled model request preserves powers');
 responseMode='error';await p.locator('#aiPatchGenerate').click();await settled();equal(await state(),refinedBefore,'Failed model request preserves powers');
 responseMode='source';holdSource=true;releaseSource=null;await p.locator('#aiPatchGenerate').click();for(let n=0;!releaseSource&&n<1000;n++)await new Promise(r=>setTimeout(r,10));assert(releaseSource,'Real sample request reached decoder boundary');equal(await state(),refinedBefore,'Pending source load preserves powers');await p.locator('#aiPatchCancel').click();releaseSource();await settled();equal(await state(),refinedBefore,'Cancelled source load restores original powers/settings');holdSource=false;
 // Reject a stale reply after a manual power edit without clobbering that edit.
 responseMode='holdSuccess';release=null;await p.locator('#aiPatchGenerate').click();while(!release)await new Promise(r=>setTimeout(r,10));await p.evaluate(()=>mygrainRobot.set({enabled:false}));const manuallyChanged=await state();release();await settled();equal(await state(),manuallyChanged,'Stale reply retains current manual edit');assert.match(await p.locator('#aiPatchStatus').textContent(),/changed|stale/i);
 console.log('CHECK',engine,'cancel/fail/stale retained');
 // Fault after source shutdown must roll back all powers and retain Redo/history.
 await seed();const rollbackBefore=await state(),countsBefore=await p.evaluate(()=>mygrainCardHistory.counts);await p.evaluate(()=>{window.__scopeAcousticRestore=mygrainAcousticFx.restore;mygrainAcousticFx.restore=function(v){if(!v.heavyLifter.enabled){mygrainAcousticFx.restore=window.__scopeAcousticRestore;throw Error('Injected post-source shutdown failure')}return window.__scopeAcousticRestore(v)}});responseMode='success';await p.locator('#aiPatchGenerate').click();await settled();assert.match(await p.locator('#aiPatchStatus').textContent(),/Injected/);equal(await state(),rollbackBefore,'Post-shutdown failure restores all cards');equal(await p.evaluate(()=>mygrainCardHistory.counts),countsBefore,'Failed application adds no history');
 await p.evaluate(async()=>{const before=mygrainAiPatchAdapter.fingerprint();try{await mygrainAiPatchAdapter.execute({parameters:{globalBpmSlider:sequencerBPM},loops:{}},before,{mode:'generate',protectEq:true});throw Error('No-op accepted')}catch(e){if(!e.message.includes('no real changes'))throw e}});equal(await state(),rollbackBefore,'Rejected no-op changes no unsupported powers');
 // Already-Off and archived/no-new-R states must stay absent, not acquire new R audio.
 await p.evaluate(()=>{mygrainRestructure.restore(null);setDropboxSampleLayerEnabled(true,{silent:true,skipSave:true})});await generate();assert.equal(await p.evaluate(()=>mygrainRestructure.ownsSource),false);allOff({...await state(),restructure:{enabled:false}},'Legacy Dropbox cleanup');
 await p.evaluate(()=>stopAllPerformancePlayback({silent:true}));await p.setViewportSize({width:390,height:844});await reveal('#genreatorCard');assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.deepEqual(errors,[]);const result={engine,ok:true,requests,tests:['Generate','GENREator','Regenerate','running graph cleanup','Undo/Redo','JSON/ZIP and retained Robot/source PCM','Refine and section preservation','pending model/source cancellation','model error','stale response','post-shutdown rollback','no-op rejection','legacy Restructure'],applied:{zipBytes:applied.bytes,robotFrames:applied.robotFrames,sourceFrames:applied.sourceFrames},errors};results.push(result);fs.writeFileSync(out+'/'+engine+'-card-scope.json',JSON.stringify(result,null,2));console.log('PASS',engine,result.tests.join('; '));await c.close();
 }finally{await browser.close()}}
 fs.writeFileSync(out+'/card-scope-results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
