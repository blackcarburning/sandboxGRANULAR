'use strict';
const {chromium,webkit}=require('playwright-core'),assert=require('node:assert/strict');
const lanes=process.env.MYGRAIN_GAP_COPY_LANE?[process.env.MYGRAIN_GAP_COPY_LANE]:process.env.MYGRAIN_GAP_COPY_TOUCH_ONLY?['V']:['','2','3','V','W','P','O'],initial=[[0,1/16],[2/16,3/16],[.5,1]],once=[[0,1/16],[2/16,3/16],[.5,9/16],[10/16,11/16],[.75,1]],repeated=[[0,1/16],[2/16,3/16],[.5,9/16],[10/16,11/16],[12/16,13/16],[14/16,15/16]];
(async()=>{for(const [engine,type]of Object.entries(process.env.MYGRAIN_GAP_COPY_TOUCH_ONLY?{chromium}:{chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),p=await context.newPage(),errors=[];
  p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));
  const base='http://127.0.0.1:18958/mygrain/';assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-cut-test'}})).status(),200);
  await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  await p.evaluate(lanes=>{stopAllPerformancePlayback({silent:true});applyGlobalBpm(120,{silent:true,skipSave:true});syncPatternLengthControls(16,{skipSave:true});for(const s of lanes){const b=audioContext.createBuffer(2,audioContext.sampleRate*2,audioContext.sampleRate);for(let ch=0;ch<2;ch++)for(let i=0;i<b.length;i++)b.getChannelData(ch)[i]=(.04+.25*i/b.length)*Math.sin(i*2*Math.PI*(ch?330:220)/b.sampleRate);window['bastardLoop'+s+'Buffer']=b;window.eval('bastardLoop'+s+'Buffer = window["bastardLoop'+s+'Buffer"]');window.eval('bastardLoop'+s+'Metadata = {bpm:120,durationSeconds:2}');window.eval('bastardLoop'+s+'SourceBpm = 120');window['setBastardLoop'+s+'Cut']({enabled:true,repeat:true,fromStart:true,start:0,end:.25,gapEnabled:true,gaps:[[0,1/16],[2/16,3/16],[.5,1]]},{skipSave:true,skipRestart:true});}},lanes);
  const settle=()=>p.waitForFunction(()=>!mygrainCardHistory.busy);
  const settings=s=>p.evaluate(s=>window.eval('bastardLoop'+s+'Cut'),s);
  for(const s of lanes){
   const prefix='bastardLoop'+s+'Cut',overlay=p.locator('#'+prefix+'Overlay');
   await p.evaluate(s=>window.eval('bastardLoop'+s+'CutEditor.open()'),s);await overlay.waitFor({state:'visible'});
   assert.equal(await p.locator('#'+prefix+'Waveform').getAttribute('data-waveform-view'),'output');
   const cell=i=>overlay.locator('[data-gap-cell="'+i+'"]');
   await overlay.locator('[data-gap-copy="range"]').tap();await cell(0).tap();await cell(3).tap();assert.deepEqual((await settings(s)).gaps,initial);assert.equal(await overlay.locator('.copy-selected').count(),4);
   await cell(8).tap();await settle();assert.deepEqual((await settings(s)).gaps,once);
   await p.evaluate(()=>mygrainCardHistory.undo());await settle();assert.deepEqual((await settings(s)).gaps,initial);
   await p.evaluate(()=>mygrainCardHistory.redo());await settle();assert.deepEqual((await settings(s)).gaps,once);
   await overlay.locator('[data-gap-copy="section"]').tap();await cell(0).tap();await cell(3).tap();await cell(8).tap();await settle();assert.deepEqual((await settings(s)).gaps,repeated);
   await overlay.locator('[data-gap-copy="section"]').tap();await cell(0).tap();await overlay.locator('[data-gap-copy="section"]').tap();assert.equal(await overlay.locator('.copy-selected').count(),0);assert.deepEqual((await settings(s)).gaps,repeated);
   // Grid changes cancel an incomplete selection, not the saved gap pattern.
   await overlay.locator('[data-gap-copy="range"]').tap();await cell(0).tap();await p.locator('#'+prefix+'Grid').selectOption('0.125');await settle();assert.equal(await overlay.locator('.copy-selected').count(),0);assert.deepEqual((await settings(s)).gaps,repeated);await p.locator('#'+prefix+'Grid').selectOption('0.0625');await settle();
   for(const size of [{width:375,height:812},{width:844,height:390},{width:1440,height:1000}]){await p.setViewportSize(size);assert(await overlay.evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert(await overlay.locator('[data-gap-copy="section"]').evaluate(e=>{const r=e.getBoundingClientRect();return r.width>=40&&r.width<=innerWidth}));}
   if(s==='V'){await p.setViewportSize({width:390,height:844});await overlay.screenshot({path:'output/gap-section-copy-20261027/'+engine+'-V.png'});await p.locator('#'+prefix+'Waveform').screenshot({path:'output/gap-section-copy-20261027/'+engine+'-repeated-waveform.png'});}
   await p.locator('#'+prefix+'Close').tap();console.log('PASS',engine,prefix,'copy, repeat-fill, Undo/Redo, cancellation, grid change and mobile layouts');
  }
  const roundtrip=await p.evaluate(async lanes=>{const body=await mygrainSongBetaAdapter.capture(),decoded=await mygrainSongBetaAdapter.decode(await body.arrayBuffer(),{buffers:new Map(),bytes:0});for(const s of lanes)window['setBastardLoop'+s+'Cut']({},{skipRestart:true});await mygrainSongBetaAdapter.recall(decoded,{start:false});return lanes.map(s=>window.eval('bastardLoop'+s+'Cut').gaps);},lanes);for(const gaps of roundtrip)assert.deepEqual(gaps,repeated);
  if(engine==='chromium'){
   await p.evaluate(async()=>{const c=mygrainSongBeta,song=(await c.request('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Gap section amend '+Date.now()})})).song;c.acceptSong(song);await c.ensureEditing();const body=await mygrainSongBetaAdapter.capture();c.acceptSong((await c.request(`/${song.id}/parts?name=Original&repeats=1`,{method:'POST',headers:{'Content-Type':'application/zip'},body})).song);await c.recall(c.song.parts[0],{amend:true,start:false});});
   for(const s of lanes){if(s==='V')await p.evaluate(()=>setBastardLoopPlaying(true,{silent:true}));await p.evaluate(s=>window.eval('bastardLoop'+s+'CutEditor.open()'),s);const overlay=p.locator('#bastardLoop'+s+'CutOverlay');await overlay.locator('[data-gap-copy="range"]').tap();await overlay.locator('[data-gap-cell="0"]').tap();await overlay.locator('[data-gap-cell="3"]').tap();await overlay.locator('[data-gap-cell="4"]').tap();await settle();await p.locator('#bastardLoop'+s+'CutClose').tap();}
   const recalled=await p.evaluate(async lanes=>{const c=mygrainSongBeta;await c.savePart();await c.recall(c.song.parts[0],{start:false});return lanes.map(s=>window.eval('bastardLoop'+s+'Cut').gaps);},lanes);for(const gaps of recalled)assert.deepEqual(gaps,[[0,1/16],[2/16,3/16],[4/16,5/16],[6/16,7/16],...repeated.slice(2)]);
   console.log('PASS',lanes.length+'-lane saved Song amendment copy, Save Amendment and recall');
  }
  assert.deepEqual(errors,[]);console.log('PASS',engine,lanes.length+'-lane editable source archive roundtrip; no page errors');await context.close();
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});
