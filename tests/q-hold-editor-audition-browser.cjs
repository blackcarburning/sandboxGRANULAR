const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.SONG_BETA_TEST_URL || 'http://127.0.0.1:18891/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
const repro = process.env.Q_HOLD_REPRO_ONLY === '1';
const evidence = process.env.Q_HOLD_EDITOR_EVIDENCE || '/tmp/mygrain-q-hold-editor';
fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const results=[];
 for(const engine of ['chromium','webkit']){
  if(process.env.Q_HOLD_ENGINE && process.env.Q_HOLD_ENGINE!==engine)continue;
  const browser=await({chromium,webkit}[engine]).launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   assert.equal((await context.request.post(base+'api/auth/register',{data:{username:`he_${engine[0]}_${Date.now()}`,password:'isolated-editor-hold'}})).status(),200);
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   await page.goto(base);await page.waitForFunction(()=>window.mygrainQ&&document.documentElement.dataset.mygrainStartup==='ready');
   await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   await page.evaluate(()=>{
    stopAllPerformancePlayback({silent:true});applyGlobalBpm(150);syncPatternLengthControls(16,{skipSave:true});
    const q=MygrainQTheory.defaults();q.instrument='strings';q.sequence[0]=MygrainQTheory.normalizeStep({root:60,type:'custom',notes:[60,65,70,73],gate:1,velocity:90});q.sequence[8]=MygrainQTheory.normalizeStep({root:62,type:'custom',notes:[62,66,69]});mygrainQ.restore(q);saveState();
   });
   await page.locator('#performanceBastardLoopQEditBtn').tap();
   await page.locator('#bastardLoopQPlaybackSettings > summary').tap();
   await page.locator('#bastardLoopQChordHoldBtn').tap();
   assert.equal(await page.locator('#bastardLoopQChordHoldBtn').getAttribute('aria-pressed'),'true');
   await page.locator('[data-q-step="0"]').tap();
   await page.waitForFunction(()=>[...mygrainQ.voices].some(v=>v.preview));
   await page.waitForTimeout(1600);
   const observed=await page.evaluate(()=>({label:document.getElementById('bastardLoopQChordHoldBtn').textContent,hold:mygrainQ.state.chordHold,preview:!!mygrainQ.preview,voices:[...mygrainQ.voices].filter(v=>v.preview).map(v=>({pitch:v.pitch,remaining:Number.isFinite(v.end)?v.end-audioContext.currentTime:null,sustained:!Number.isFinite(v.end),looped:v.source.loop})),notes:mygrainQ.state.sequence[0].notes}));
   console.log(JSON.stringify({engine,repro,observed}));
   if(!repro){assert(observed.preview&&observed.voices.length===4,'Hold must sustain the edited/custom audition past its old short gate');assert(observed.voices.every(v=>v.looped&&(v.sustained||v.remaining>1)));}
   let behaviour;
   if(!repro){
    const audio=await page.evaluate(async()=>{const a=audioContext.createAnalyser();a.fftSize=2048;mygrainQ.graph.level.connect(a);await new Promise(r=>setTimeout(r,60));const d=new Float32Array(a.fftSize);a.getFloatTimeDomainData(d);mygrainQ.graph.level.disconnect(a);return d.reduce((s,v)=>s+v*v,0)/d.length;});
    assert(audio>1e-8,'held audition must produce real audio beyond its old gate');
    await page.locator('[data-q-step="8"]').tap();await page.waitForFunction(()=>mygrainQ.preview?.chord.notes[0]===62);await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(()=>[...mygrainQ.voices].filter(v=>v.preview&&!v.releasing).map(v=>v.pitch).sort((a,b)=>a-b)),[62,66,69]);
    await page.locator('#bastardLoopQChordHoldBtn').tap();await page.waitForFunction(()=>!mygrainQ.preview&&mygrainQ.voices.size===0);
    assert.equal(await page.locator('#bastardLoopQChordHoldBtn').getAttribute('aria-pressed'),'false');
    // Toggling on during a currently sounding short audition extends it immediately.
    await page.locator('[data-q-step="0"]').tap();await page.waitForFunction(()=>!!mygrainQ.preview);await page.locator('#bastardLoopQChordHoldBtn').tap();await page.waitForTimeout(1300);
    assert(await page.evaluate(()=>mygrainQ.preview?.held&&[...mygrainQ.voices].some(v=>v.end===Infinity)));
    for(const viewport of [{width:390,height:844},{width:844,height:390}]){await page.setViewportSize(viewport);const fit=await page.evaluate(()=>{const s=document.querySelector('#bastardLoopQOverlay .q-shell'),b=document.getElementById('bastardLoopQChordHoldBtn'),r=b.getBoundingClientRect();return{overflow:s.scrollWidth>s.clientWidth+1,hit:r.height>0&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b};});assert(!fit.overflow);await page.locator('#bastardLoopQChordHoldBtn').scrollIntoViewIfNeeded();}
    await page.locator('#bastardLoopQCloseBtn').tap();assert.equal(await page.evaluate(()=>!!mygrainQ.preview||mygrainQ.voices.size>0),false);
    await page.setViewportSize({width:390,height:844});await page.locator('#performanceBastardLoopQEditBtn').tap();
    await page.locator('[data-q-step="0"]').tap();await page.waitForFunction(()=>mygrainQ.preview?.held&&mygrainQ.voices.size>0);
    await page.locator('#bastardLoopQAllStopBtn').tap();assert.equal(await page.evaluate(()=>!!mygrainQ.preview||mygrainQ.voices.size>0),false);
    // Closing during a held sample load must cancel the future audition, too.
    await page.evaluate(()=>{window.oldEnsure=mygrainQ.piano.ensure.bind(mygrainQ.piano);mygrainQ.piano.ensure=()=>new Promise(r=>{window.finishHeldLoad=r;});});
    // Use the other cell: a second rapid tap on the same cell opens the note editor.
    await page.locator('[data-q-step="8"]').tap();await page.waitForFunction(()=>typeof finishHeldLoad==='function');await page.locator('#bastardLoopQCloseBtn').tap();
    await page.evaluate(()=>{mygrainQ.piano.ensure=oldEnsure;finishHeldLoad();});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>!!mygrainQ.preview||mygrainQ.voices.size>0),false);
    behaviour={power:audio,nextCustomChord:true,holdOffReleases:true,holdOnDuringAudition:true,closeReleases:true,stopReleases:true,closeCancelsLoading:true};
   }
   assert.deepEqual(errors,[]);results.push({engine,observed,behaviour});
   await page.screenshot({path:`${evidence}/${repro?'before':'after'}-${engine}.png`});
   await context.close();
  }finally{await browser.close();}
 }
 fs.writeFileSync(`${evidence}/${repro?'before':'after'}-results.json`,JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
