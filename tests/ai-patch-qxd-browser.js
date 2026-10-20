// Isolated integration test: real Q bank, decoded X/drum audio, real capture worklet.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base=process.env.AI_PATCH_TEST_URL||'http://127.0.0.1:18876/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const out=process.env.AI_QXD_EVIDENCE||'/tmp/mygrain-ai-qxd-evidence';fs.mkdirSync(out,{recursive:true});
function wav(hz){const rate=44100,n=rate/2,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*hz*i/rate)*9000*Math.exp(-i/(rate*.2))),44+i*2);return b;}
const pattern=hits=>Array.from({length:16},(_,i)=>hits.includes(i)?1:0);
const recipe={title:'Warm C minor groove',description:'Cm / Ab with root bass and a straight kick/snare/hat pattern.',parameters:{globalBpmSlider:112,performanceBastardLoopQLevelMixer:38,performanceBastardLoopXLevel:36,performanceBastardLoopXSemitone:0,performanceBastardLoopXLength:70,performanceBastardLoopXAttack:8,performanceBastardLoopXDecay:85,performanceBastardLoopXFilterCutoff:2100,performanceDrumMachineLevel:50,drumMachineKickLevel:75,drumMachineSnareLevel:60,drumMachineHatLevel:35,drumMachineHatDecay:55},loops:{Q:{enabled:true,instrument:'strings',chords:[[48,51,55],[48,51,56]],chordSteps:8,style:'warm'},X:{enabled:true,reload:true,notes:[36,null,null,null,36,null,43,null,32,null,null,null,32,null,39,null]}},drums:{enabled:true,tracks:{kick:{reload:true,steps:pattern([0,8,10])},snare:{reload:true,steps:pattern([4,12])},hat:{reload:true,steps:pattern([0,2,4,6,8,10,12,14])}}}};
const results=[];
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 if(process.env.AI_PATCH_ENGINES&&!process.env.AI_PATCH_ENGINES.split(',').includes(engine))continue;
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1280,height:800}]){
  if(process.env.AI_PATCH_WIDTHS&&!process.env.AI_PATCH_WIDTHS.split(',').includes(String(viewport.width)))continue;
  const ctx=await browser.newContext({viewport,isMobile:viewport.width<960,hasTouch:viewport.width<960}),page=await ctx.newPage();page.setDefaultTimeout(60000);
  let mode='normal',release,heldQ=[],requestCount=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==new URL(base).origin)return route.abort();
   if(mode==='holdQ'&&u.pathname.includes('/SAMPLES_Q_STRINGS/samples/'))await new Promise(resolve=>heldQ.push(resolve));
   if(u.pathname.endsWith('/api/ai-patch-direction'))return route.fulfill({json:{ok:true,model:'openai/gpt-6.1-sol',recipe}});
   if(route.request().method()==='POST'&&u.pathname.endsWith('/api/source-sample')){
    const data=route.request().postDataJSON();requestCount++;
    if(mode==='hold'&&data.source==='samples_snares')await new Promise(r=>release=r);
    if(mode==='fail'&&data.source==='samples_kicks')return route.fulfill({status:503,json:{error:'Fixture kick unavailable'}});
    return route.fulfill({contentType:'audio/wav',headers:{'X-Mygrain-Source-Name':data.source+'.wav','X-Mygrain-Source-Path':data.source+'.wav'},body:wav(data.source==='samples_bass'?110:data.source==='samples_kicks'?60:data.source==='samples_snares'?310:2200)});
   }return route.continue();
  });
  const flags=()=>page.evaluate(()=>({mega:megaRandomizeInFlight,suspended:stateSaveSuspended,busy:mygrainAiPatch.busy,context:audioContext===window.__qxdContext,loggedIn:mygrainAccounts.authenticated,generate:!document.getElementById('aiPatchGenerate').disabled,prompt:!document.getElementById('aiPatchPrompt').disabled}));
  const ready=async()=>{await page.waitForFunction(()=>!mygrainAiPatch.busy);assert.deepEqual(await flags(),{mega:false,suspended:false,busy:false,context:true,loggedIn:true,generate:true,prompt:true});};
  const generate=async()=>{await page.locator('#aiPatchGenerate').click();await ready();assert.match(await page.locator('#aiPatchStatus').textContent(),/^Applied/);};
  try{
   assert.equal((await ctx.request.post(base+'api/auth/register',{data:{username:'aiqxd'+Date.now(),password:'isolated-test-fixture'}})).status(),200);
   await page.goto(base);await page.waitForFunction(()=>mygrainAiPatch?.ready&&window.mygrainSongBeta&&!mygrainSongBeta.busy);
   await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
   await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});syncBastardLoopKUi();window.__qxdContext=audioContext;window.__qxdInitial=saveState({force:true,snapshotOnly:true});
    const add=audioContext.addEventListener.bind(audioContext),remove=audioContext.removeEventListener.bind(audioContext);window.__qxdListeners=new Set();audioContext.addEventListener=(type,fn,opt)=>{if(type==='statechange')__qxdListeners.add(fn);return add(type,fn,opt)};audioContext.removeEventListener=(type,fn,opt)=>{if(type==='statechange')__qxdListeners.delete(fn);return remove(type,fn,opt)};
   });
   await page.locator('#aiPatchPrompt').fill('Warm Q chords, X bass and straight drums.');await generate();
   const actual=await page.evaluate(()=>({drums:mygrainAiPatchAdapter.drumInventory(),q:mygrainQ.getState(),bass:bastardLoopXSequence.slice(0,16),kick:drumMachineKickPattern.slice(0,16),snare:drumMachineSnarePattern.slice(0,16),hat:drumMachineHatPattern.slice(0,16),hatTiming:drumMachineHatTimingMode}));
   assert.deepEqual(actual.kick.map(Number),recipe.drums.tracks.kick.steps);assert.deepEqual(actual.snare.map(Number),recipe.drums.tracks.snare.steps);assert.equal(actual.q.arpEnabled,false);assert.equal(actual.q.lowpass,5200);assert.equal(actual.q.sequence[8].notes[2],56);assert(actual.drums.kick.loaded&&actual.drums.snare.loaded&&actual.drums.hat.loaded);assert.equal(actual.hatTiming,'straight');
   const log=await page.locator('#aiPatchChanges').textContent();for(const source of ['samples_bass','samples_kicks','samples_snares','samples_hats'])assert(log.includes('LOADED '+source+'.wav'));assert(log.includes('Drum kick:'));assert.equal(await page.locator('#aiPatchSamples li').count(),15);
   assert.equal(await page.evaluate(()=>mygrainAiPatchAdapter.inventory().Q.loaded),true);
   // Direct regeneration works with no Keep gate, while transport is running.
   await page.locator('#aiPatchHear').click();await ready();assert(await page.evaluate(()=>mygrainQ.running&&drumMachinePlaying&&bastardLoopXTransportActive));await generate();
   assert(await page.evaluate(()=>mygrainQ.running&&drumMachinePlaying&&bastardLoopXTransportActive));
   for(let i=0;i<2;i++){
    await page.locator('#aiPatchRender').click();await ready();assert.match(await page.locator('#aiPatchStatus').textContent(),/^Preview captured/);assert(await page.locator('#aiPatchReplay').isVisible());
    assert.match(await page.locator('#aiPatchPreviewStatus').textContent(),/RMS 0\.(?!0000)/);
    assert.equal(await page.evaluate(()=>__qxdListeners.size),0);assert(await page.evaluate(()=>mygrainQ.running&&drumMachinePlaying));
   }
   await page.locator('#aiPatchReplay').click();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>mygrainAiPatchAdapter.previewPlaying),true);await page.evaluate(()=>stopAllPerformancePlayback({silent:true}));assert.equal(await page.evaluate(()=>mygrainAiPatchAdapter.previewPlaying),false);await page.locator('#aiPatchStop').click();assert.equal(await page.evaluate(()=>bastardLoopPlaying||drumMachinePlaying||mygrainQ.running),false);
   // Manual edit remains live, and a stale rendered capture is not replayed.
   await page.evaluate(()=>{setSliderValue('performanceBastardLoopXFilterCutoff',3300);flushPendingSliderUpdates();});await page.locator('#aiPatchReplay').click();assert.match(await page.locator('#aiPatchStatus').textContent(),/Patch changed/);
   await page.locator('#aiPatchHear').click();await ready();await page.locator('#aiPatchStop').click();await generate();
   // Undo returns the patch immediately before the latest generation, including manual edit and samples.
   await page.locator('#aiPatchUndo').click();await ready();assert.match(await page.locator('#aiPatchStatus').textContent(),/^Undone/);assert.equal(await page.evaluate(()=>Number(document.getElementById('performanceBastardLoopXFilterCutoff').value)),3300);
   // Failed loads and cancellation both leave the existing patch playable.
   mode='fail';await page.locator('#aiPatchGenerate').click();await ready();assert.match(await page.locator('#aiPatchStatus').textContent(),/Fixture kick unavailable/);mode='normal';await page.locator('#aiPatchHear').click();await ready();
   mode='hold';release=null;await page.locator('#aiPatchGenerate').click();await page.waitForFunction(()=>document.getElementById('aiPatchChanges').textContent.includes('requesting fresh audio from samples_snares'));
   await page.locator('#aiPatchCancel').click();release?.();mode='normal';await ready();assert.match(await page.locator('#aiPatchStatus').textContent(),/restored/);
   await page.locator('#aiPatchHear').click();await ready();
   // A hung Q sample request must not trap Cancel or leave late audio in the restored bank.
   mode='holdQ';await page.locator('#aiPatchGenerate').click();await page.waitForFunction(()=>document.getElementById('aiPatchChanges').textContent.includes('Loop Q: downloading'));
   await page.waitForTimeout(100);assert(heldQ.length);await page.locator('#aiPatchCancel').click();await ready();assert.match(await page.locator('#aiPatchStatus').textContent(),/restored/);
   mode='normal';heldQ.splice(0).forEach(resolve=>resolve());await page.waitForTimeout(150);await page.locator('#aiPatchHear').click();await ready();
   // Preview stop/cancel must not restart audio in its finally block.
   await page.locator('#aiPatchRender').click();await page.waitForFunction(()=>document.getElementById('aiPatchChanges').textContent.includes('Rendering one bar'));
   await page.locator('#aiPatchStop').click();await ready();assert.equal(await page.evaluate(()=>bastardLoopPlaying||drumMachinePlaying||mygrainQ.running),false);assert.equal(await page.evaluate(()=>__qxdListeners.size),0);
   await page.evaluate(async()=>{
    const original=stopAllPerformancePlayback;let first=true;
    stopAllPerformancePlayback=function(...args){if(first){first=false;throw new Error('Fixture entry failure');}return original(...args);};
    try { await mygrainAiPatch.generate(); } finally { stopAllPerformancePlayback=original; }
   });await ready();assert.match(await page.locator('#aiPatchStatus').textContent(),/Fixture entry failure/);
   await generate();await page.locator('#aiPatchKeep').click();await page.locator('#aiPatchHear').click();await ready();
   const audio=await page.evaluate(async()=>{const a=audioContext.createAnalyser();a.fftSize=4096;finalAmplifierNode.connect(a);await new Promise(r=>setTimeout(r,450));const data=new Float32Array(a.fftSize);a.getFloatTimeDomainData(data);finalAmplifierNode.disconnect(a);const qa=audioContext.createAnalyser();qa.fftSize=4096;mygrainQ.graph.pan.connect(qa);await new Promise(r=>setTimeout(r,350));const qdata=new Float32Array(qa.fftSize);qa.getFloatTimeDomainData(qdata);mygrainQ.graph.pan.disconnect(qa);return{qRms:Math.sqrt(qdata.reduce((s,v)=>s+v*v,0)/qdata.length),inventory:mygrainAiPatchAdapter.inventory().Q,cache:mygrainQ.piano.cache.size,rms:Math.sqrt(data.reduce((s,v)=>s+v*v,0)/data.length),gain:finalAmplifierNode.gain.value,q:mygrainQ.running,drums:drumMachinePlaying,x:bastardLoopXTransportActive,bridges:__mygrainSongRenderBridges.size,frames:document.querySelectorAll('iframe').length};});assert(audio.rms>.0001,JSON.stringify(audio));assert(audio.qRms>.0001,JSON.stringify(audio));assert(audio.q&&audio.drums&&audio.x);assert.equal(audio.bridges,0);assert.equal(await page.evaluate(()=>captureAudioDebug().aiPatch.phase),'idle');
   await page.locator('#aiPatchCard').screenshot({path:out+'/'+engine+'-'+viewport.width+'.png'});assert.deepEqual(errors,[]);
   const result={engine,viewport,requestCount,audio,checks:['Q-harmony-style','X-bass-notes','real-drum-samples-patterns','regenerate-without-Keep','resume-after-generation','two-real-one-bar-renders','capture-listeners-released','preview-staleness','manual-edit-after-generation','latest-Undo','failed-load-recovery','mid-load-cancel-recovery','preview-stop-no-restart','Keep-then-play','hung-Q-cancel-recovers-before-network','entry-failure-cleans-locks','Q-independently-audible','same-context-no-reload'],errors};results.push(result);console.log(JSON.stringify(result));
  }catch(e){console.error('STATE',await page.evaluate(()=>({status:document.getElementById('aiPatchStatus')?.textContent,log:document.getElementById('aiPatchChanges')?.textContent,flags:{megaRandomizeInFlight,stateSaveSuspended},q:window.mygrainQ?.state})),errors);throw e;}finally{release?.();heldQ.forEach(resolve=>resolve());await ctx.close();}
 }}finally{await browser.close();}
}fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
