const assert=require('node:assert/strict'), {chromium,webkit}=require('playwright-core');
// Run against tests/song-beta-test-server.py with a disposable seeded admin.
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18933/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async()=>{for(const [engine,type] of Object.entries({chromium,webkit})){
 const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await c.request.post(base+'api/auth/login',{data:{username:'admin',password:process.env.MYGRAIN_TEST_ADMIN_PASSWORD||'rotate-fixture'}});
 await p.goto(base);await p.waitForFunction(()=>window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await p.evaluate(()=>stopAllPerformancePlayback({silent:true}));
 for(const layer of ['L','X']){
  for(const length of [8,16,32,64]){
   const before=await p.evaluate(({layer,length})=>{syncPatternLengthControls(length,{skipSave:true});const seq=Array.from({length:64},(_,i)=>({note:i%3===0?'':midiToNoteName(36+i%36),rest:i%3===0,accent:i%2===0,slide:i%4===0,ratchet:1+i%8}));if(layer==='L'){bastardLoopLSequence=seq;openBastardLoopLOverlay();}else{bastardLoopXSequence=seq;openBastardLoopXOverlay();}return seq;},{layer,length});
   const get=()=>p.evaluate(layer=>layer==='L'?bastardLoopLSequence:bastardLoopXSequence,layer);
   const right=p.locator(`#bastardLoop${layer}ShiftRightBtn`),left=p.locator(`#bastardLoop${layer}ShiftLeftBtn`);
   await right.tap();const after=await get();assert.deepEqual(after.slice(0,length),[before[length-1],...before.slice(0,length-1)]);assert.deepEqual(after.slice(length),before.slice(length));
   const saved=await p.evaluate(layer=>readStoredStateSnapshot().modes[`bastardLoop${layer}Sequence`],layer);assert.deepEqual(saved,after);
   await left.tap();assert.deepEqual(await get(),before);
   await left.tap();assert.deepEqual((await get()).slice(0,length),[...before.slice(1,length),before[0]]);
   await right.tap();assert.deepEqual(await get(),before);
   console.log('PASS',engine,layer,length,'native tap rotates full step data, wrap both directions, inverse, hidden tail, saved state');
  }
  for(const size of [{width:390,height:844},{width:844,height:390}]){await p.setViewportSize(size);const button=p.locator(`#bastardLoop${layer}ShiftRightBtn`);await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert(box.width>25&&box.height>25);}
  await p.evaluate(layer=>layer==='L'?closeBastardLoopLOverlay():closeBastardLoopXOverlay(),layer);
 }
 assert.deepEqual(errors,[]);await c.close();
 }finally{await b.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
