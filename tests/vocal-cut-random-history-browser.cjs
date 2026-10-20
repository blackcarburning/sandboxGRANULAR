const {chromium,webkit}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18833/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async()=>{for(const [name,engine] of Object.entries({chromium,webkit})){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'mygrain-v-cut-'+name+'-')),errors=[];let context,page;
 async function launch(){context=await engine.launchPersistentContext(profile,{...(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{ }),viewport:{width:390,height:844},isMobile:true,hasTouch:true});page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));}
 async function open(start=true){await page.goto(base);await page.waitForFunction(()=>window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);if(start){await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);}}
 const cut=()=>page.evaluate(()=>JSON.parse(JSON.stringify(bastardLoopVCut)));
 const counts=()=>page.evaluate(()=>mygrainCardHistory.counts);
 async function travel(direction){await page.locator(direction==='undo'?'#sectionJumpUndoBtn':'#sectionJumpRedoBtn').tap();await page.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await page.evaluate(()=>mygrainCardHistory.warning),'');}
 try{
  await launch();assert.equal((await context.request.post(base+'api/auth/register',{data:{username:'vcut'+name+Date.now(),password:'isolated-vcut-fixture'}})).ok(),true);await open();
  assert.equal(await page.locator('#performanceBastardLoopVCutRandomizeBtn').isDisabled(),true);
  await page.evaluate(async()=>{
   stopAllPerformancePlayback({silent:true});applyGlobalBpm(120);syncPatternLengthControls(16,{skipSave:true});
   const b=audioContext.createBuffer(2,audioContext.sampleRate*2,audioContext.sampleRate);
   for(let c=0;c<2;c++)for(let i=0;i<b.length;i++)b.getChannelData(c)[i]=.2*Math.sin(2*Math.PI*(c?330:220)*i/b.sampleRate);
   bastardLoopVBuffer=b;bastardLoopVSourceBpm=120;bastardLoopVMetadata={durationSeconds:2,bpm:120,label:'original stereo V fixture'};
   setBastardLoopVPitchOctaves(0,{skipSave:true});setBastardLoopVPitchSemitones(0,{skipSave:true});setBastardLoopVFineCents(0,{skipSave:true});
   setBastardLoopVReverse(false,{skipSave:true});setBastardLoopVEnabled(true,{silent:true,skipSave:true});setBastardLoopVCut(undefined,{skipSave:true});
   await saveAudioBufferToDB(b,BASTARD_LOOP_V_AUDIO_BUFFER_KEY);saveState({force:true});window.vOriginal=b;
  });
  const device=await page.evaluate(()=>mygrainSongBeta.lease.device.id),initial=await cut();
  for(let i=0;i<2;i++){await page.locator('#performanceBastardLoopVCutRandomizeBtn').tap();const s=await cut();assert.equal(s.enabled,true);assert.ok(s.start>=0&&s.end>s.start&&s.end<=1);}
  const second=await cut();assert.deepEqual(await counts(),{undo:2,redo:0});
  await travel('undo');const first=await cut();await travel('undo');assert.deepEqual(await cut(),initial);await travel('redo');assert.deepEqual(await cut(),first);await travel('redo');assert.deepEqual(await cut(),second);
  assert.equal(await page.evaluate(()=>bastardLoopVBuffer===vOriginal),true);
  console.log('PASS',name,'card native randomisation is one step; two exact Undo/Redo levels preserve original V PCM');

  await page.locator('#performanceBastardLoopVCutBtn').tap();await page.locator('#bastardLoopVCutRandomize').tap();assert.deepEqual(await counts(),{undo:3,redo:0});
  for(const id of ['bastardLoopVCutStretch','bastardLoopVCutFromStart']){const before=await cut(),n=(await counts()).undo;await page.locator('#'+id).tap();assert.equal((await counts()).undo,n+1);await page.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual(await cut(),before);await page.evaluate(()=>mygrainCardHistory.redo());}
  await page.locator('#bastardLoopVCutReset').tap();
  await page.locator('#bastardLoopVCutStartSeconds').fill('0.25');await page.locator('#bastardLoopVCutStartSeconds').press('Tab');
  await page.locator('#bastardLoopVCutEndSeconds').fill('1.5');await page.locator('#bastardLoopVCutEndSeconds').press('Tab');
  assert.equal((await cut()).start,.125);assert.equal((await cut()).end,.75);
  const beforeDrag=await cut(),beforeCount=await counts();
  await page.locator('#bastardLoopVCutTimeline').scrollIntoViewIfNeeded();const timeline=await page.locator('#bastardLoopVCutTimeline').boundingBox(),handle=await page.locator('#bastardLoopVCutStart').boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();assert.equal(await page.evaluate(()=>mygrainCardHistory.busy),true);
  for(const fraction of [.2,.25,.375])await page.mouse.move(timeline.x+timeline.width*fraction,timeline.y+timeline.height/2);
  await page.mouse.up();await page.waitForFunction(()=>!mygrainCardHistory.busy);
  const afterDrag=await cut();assert.notDeepEqual(afterDrag,beforeDrag);assert.equal((await counts()).undo,Math.min(10,beforeCount.undo+1));
  await page.locator('#bastardLoopVCutClose').tap();await travel('undo');assert.deepEqual(await cut(),beforeDrag);await travel('redo');assert.deepEqual(await cut(),afterDrag);
  console.log('PASS',name,'popup randomise/toggles/fields and complete native handle drag remember exact settings; drag is one step');

  // Exercise the real native source and cut rendering, not only serialized UI settings.
  const audio=await page.evaluate(()=>{
   setBastardLoopVCut({enabled:true,start:.125,end:.375,stretch:true,fromStart:true,targetDuration:.5,targetStart:0});
   const original=bastardLoopVBuffer,rendered=getBastardLoopVPlaybackBuffer();startBastardLoopV(audioContext.currentTime+.1,{audition:true});
   const result={originalUntouched:original===vOriginal,nativeSource:bastardLoopVSource?.buffer===rendered,frames:rendered.length,originalFrames:original.length,channels:rendered.numberOfChannels,peak:Math.max(...rendered.getChannelData(0).subarray(0,10000).map(Math.abs))};
   stopBastardLoopV({skipUi:true});return result;
  });assert.equal(audio.originalUntouched,true);assert.equal(audio.nativeSource,true);assert.equal(audio.frames,audio.originalFrames);assert.equal(audio.channels,2);assert.ok(audio.peak>.01);
  // Direct setter above was fixture-only; restore the history head before restart.
  await page.evaluate(s=>setBastardLoopVCut(s),afterDrag);
  // Force an actual random button choice with Stretch/From Start on and a non-default mapping.
  await page.evaluate(()=>{window.vSavedRandom=Math.random;Math.random=()=>.1;});
  await page.locator('#performanceBastardLoopVCutRandomizeBtn').tap();
  await page.evaluate(()=>{Math.random=window.vSavedRandom;delete window.vSavedRandom;});
  const persistedCut=await cut();assert.equal(persistedCut.stretch,true);assert.equal(persistedCut.fromStart,true);assert.ok(persistedCut.targetDuration>0);
  await travel('undo');assert.deepEqual(await cut(),afterDrag);await page.evaluate(()=>mygrainCardHistory.flush());const savedCounts=await counts();
  await context.close();await launch();await open(false);assert.deepEqual(await counts(),savedCounts);assert.equal(await page.evaluate(()=>mygrainSongBeta.lease.device.id),device);
  await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);assert.deepEqual(await cut(),afterDrag);
  await travel('redo');assert.deepEqual(await cut(),persistedCut);await travel('undo');assert.deepEqual(await cut(),afterDrag);await travel('undo');assert.deepEqual(await cut(),beforeDrag);await travel('redo');assert.deepEqual(await cut(),afterDrag);await travel('redo');assert.deepEqual(await cut(),persistedCut);
  const snapshot=await page.evaluate(async()=>{const {snapshot}=await mygrainSongBetaAdapter.capture({liveOnly:true});return snapshot.state.modes.bastardLoopVCut;});assert.deepEqual(snapshot,persistedCut);
  console.log('PASS',name,'real cut/stretched source renders non-silent stereo at unchanged loop length; complete settings survive browser-process restart and Song capture');

  for(const viewport of [{width:390,height:844},{width:844,height:390}]){
   await page.setViewportSize(viewport);await page.locator('#performanceBastardLoopVCutBtn').tap();await page.locator('#bastardLoopVCutRandomize').scrollIntoViewIfNeeded();
   const hit=await page.locator('#bastardLoopVCutRandomize').evaluate(e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;});assert.equal(hit,true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:`/tmp/mygrain-vcut-${name}-${viewport.width}.png`});await page.locator('#bastardLoopVCutClose').tap();
  }
  assert.deepEqual(errors,[]);console.log('PASS',name,'portrait/landscape randomise controls visible, tappable and no page errors');
 }finally{await context?.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});
