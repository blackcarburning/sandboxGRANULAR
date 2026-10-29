'use strict';
// Same-source disposable account. Never writes production accounts or songs.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18966/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence='output/lx-scroll-20261029';
(async()=>{
 const results=[];
 for(const [engine,type] of Object.entries({chromium,webkit})){
  const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
  try{for(const viewport of [{width:402,height:768},{width:768,height:402}]){
   const context=await browser.newContext({viewport,isMobile:true,hasTouch:true});
   assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-lx-scroll'}})).status(),200);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainCardHistory);
   await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').tap();
   await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   await page.evaluate(async()=>{
    stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});applyGlobalBpm(90);syncPatternLengthControls(64,{skipSave:true});
    const sample=seconds=>{const b=audioContext.createBuffer(1,Math.round(audioContext.sampleRate*seconds),audioContext.sampleRate),a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=.06*Math.sin(2*Math.PI*220*i/b.sampleRate);return b};
    bastardLoopLSampleBuffer=sample(5.48);bastardLoopLSourceMode='sample';bastardLoopLEnabled=true;ensureBastardLoopLSequenceCapacity();bastardLoopLSequence=bastardLoopLSequence.map(()=>normalizeBastardLoopLStep({note:'C2',rest:false}));
    bastardLoopXSampleBuffer=sample(2.856);bastardLoopXSourceMode='sample';bastardLoopXEnabled=true;ensureBastardLoopXSequenceCapacity();bastardLoopXSequence=bastardLoopXSequence.map(()=>normalizeBastardLoopXStep({note:'C2',rest:false}));
    bastardLoopWBuffer=sample(1);bastardLoopWEnabled=true;
    const drum=sample(.05);drumMachineKickBuffer=drum;drumMachineSnareBuffer=drum;drumMachinePercBuffer=drum;
    for(const k of ['kick','snare','perc'])getDrumMachinePattern(k).fill(true);
    for(const t of Object.values(drumMachineExtraTracks)){t.buffer=drum;t.pattern.fill(true)}drumMachineHatPattern.fill(true);
    oscillatorsEnabled=false;seqGrainsEnabled=false;sequencerSteps.forEach(s=>s.enabled=true);
    const t=audioContext.currentTime+.2;startSequencer(t,{force:true});startDrumMachine(t,{silent:true,skipSave:true});startBastardLoopW(t,{skipUi:true});startBastardLoopL(t);startBastardLoopX(t);
    const url=URL.createObjectURL(new Blob([`class Meter extends AudioWorkletProcessor{constructor(){super();this.n=0;this.power=0}process(inputs){const a=inputs[0]?.[0];if(a){for(const x of a)this.power+=x*x;this.n+=a.length;if(this.n>=sampleRate){this.port.postMessage({n:this.n,power:this.power});this.n=0;this.power=0}}return true}}registerProcessor('lx-scroll-meter',Meter)`],{type:'text/javascript'}));
    await audioContext.audioWorklet.addModule(url);URL.revokeObjectURL(url);const meter=new AudioWorkletNode(audioContext,'lx-scroll-meter'),silent=audioContext.createGain();silent.gain.value=0;finalAmplifierNode.connect(meter);meter.connect(silent);silent.connect(audioContext.destination);
    window.lxPcm=[];meter.port.onmessage=e=>lxPcm.push(e.data);
   });
   for(const lane of ['L','X']){
    await page.evaluate(lane=>{
     window[`openBastardLoop${lane}Overlay`]();const layout=document.querySelector(`#bastardLoop${lane}Overlay .lead-sequencer-layout`);layout.scrollTop=0;
     window.lxAudit={styleReads:0,gridWrites:0,refreshes:0,notes:0,lateMs:0,startAudio:audioContext.currentTime,startWall:performance.now(),skipsStart:audioSchedulingStats.skippedSteps};
     const style=window.getComputedStyle,sync=syncPerformanceControlState,voice=window[`scheduleBastardLoop${lane}Voice`];
     window.getComputedStyle=(...a)=>{lxAudit.styleReads++;return style(...a)};
     syncPerformanceControlState=(...a)=>{lxAudit.refreshes++;return sync(...a)};
     window[`scheduleBastardLoop${lane}Voice`]=(...a)=>{lxAudit.notes++;lxAudit.lateMs=Math.max(lxAudit.lateMs,(audioContext.currentTime-a[1])*1000);return voice(...a)};
     const observer=new MutationObserver(r=>lxAudit.gridWrites+=r.length);observer.observe(document.getElementById(`bastardLoop${lane}StepGrid`),{subtree:true,attributes:true});
     window.restoreLxAudit=()=>{observer.disconnect();window.getComputedStyle=style;syncPerformanceControlState=sync;window[`scheduleBastardLoop${lane}Voice`]=voice};
    },lane);
    await page.waitForTimeout(1000);
    const offscreen=await page.evaluate(lane=>{const r=document.getElementById(`bastardLoop${lane}StepGrid`).getBoundingClientRect();return{writes:lxAudit.gridWrites,below:r.top>=innerHeight,top:r.top}},lane);
    const guardReads=await page.evaluate(lane=>{
     const target=document.querySelector(`#bastardLoop${lane}Overlay .lead-sequencer-toolbar-row`);
     function touch(type,y){const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:[{clientX:100,clientY:y}]});target.dispatchEvent(e)}
     touch('touchstart',400);lxAudit.styleReads=0;for(let i=0;i<12;i++)touch('touchmove',390-i*5);return lxAudit.styleReads;
    },lane);
    const layout=page.locator(`#bastardLoop${lane}Overlay .lead-sequencer-layout`),positions=[];
    if(engine==='chromium'){
     const box=await layout.boundingBox(),x=box.x+box.width/2,y=box.y+Math.min(100,box.height-15),cdp=await context.newCDPSession(page);
     await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
     for(let i=1;i<=10;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*6}]});await page.waitForTimeout(20)}
     await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);
     positions.push(await layout.evaluate(e=>e.scrollTop));assert(positions[0]>10,'native touch scroll must move');
    }
    for(let i=0;i<10;i++){await layout.evaluate((e,i)=>e.scrollTop=i%2?0:e.scrollHeight,i);await page.waitForTimeout(90);positions.push(await layout.evaluate(e=>e.scrollTop))}
    await page.locator(`#bastardLoop${lane}StepGrid`).evaluate(e=>e.scrollIntoView({block:'center'}));await page.waitForTimeout(400);
    await page.waitForFunction(lane=>document.querySelectorAll(`#bastardLoop${lane}StepGrid .is-current`).length===1,lane);
    const result=await page.evaluate(lane=>({lane,...lxAudit,elapsedAudio:audioContext.currentTime-lxAudit.startAudio,elapsedWall:(performance.now()-lxAudit.startWall)/1000,skips:audioSchedulingStats.skippedSteps-lxAudit.skipsStart,backdrop:getComputedStyle(document.getElementById(`bastardLoop${lane}Overlay`)).backdropFilter,playing:sequencerPlaying&&drumMachinePlaying&&isBastardLoopLRunning()&&isBastardLoopXRunning(),pcm:lxPcm.slice()}),lane);
    assert(result.playing);assert(result.notes>8);assert(result.pcm.some(p=>p.power>0));assert.equal(result.refreshes,0);assert(positions.some(p=>p>100));
    if(!process.env.BASELINE){assert.equal(guardReads,0);if(offscreen.below)assert.equal(offscreen.writes,0);assert.equal(result.backdrop,'none');assert.equal(result.skips,0);assert(result.lateMs<10);assert(result.elapsedAudio/result.elapsedWall>.95)}
    await page.evaluate(()=>restoreLxAudit());
    if(!process.env.BASELINE){
     await page.locator(`#bastardLoop${lane}AccentAmount`).evaluate(e=>{e.value='61';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))});
     assert.match(await page.locator(`#bastardLoop${lane}AccentAmountValue`).textContent(),/61/);
     const key=page.locator(`#bastardLoop${lane}Keyboard .lead-sequencer-key.white`).first();
     await key.evaluate(e=>e.scrollIntoView({block:'center'}));
     if(engine==='chromium'){
      const box=await key.boundingBox(),x=box.x+box.width/2,y=box.y+box.height*.7,cdp=await context.newCDPSession(page),before=await layout.evaluate(e=>e.scrollTop);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+i*5}]});await page.waitForTimeout(20)}
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);
      assert(Math.abs(await layout.evaluate(e=>e.scrollTop)-before)>10,'pan across keybed must scroll');
      assert.equal(await page.evaluate(lane=>getSequencerKeyboardVoices(lane).length,lane),0,'pan must release audition notes');
     }
     await key.tap();await page.waitForTimeout(80);
     assert.equal(await page.evaluate(lane=>getSequencerKeyboardVoices(lane).length,lane),0,'tap must not leave a held key');
     const stopped=await page.evaluate(lane=>{window[`stopBastardLoop${lane}`]();return{frame:eval(`bastardLoop${lane}PlayheadFrame`),current:document.querySelectorAll(`#bastardLoop${lane}StepGrid .is-current`).length}},lane);
     assert.deepEqual(stopped,{frame:null,current:0});
     await page.evaluate(lane=>window[`startBastardLoop${lane}`](),lane);
     await page.screenshot({path:`${evidence}/${engine}-${viewport.width}-${lane}.png`});
    }
    await page.evaluate(lane=>{window[`queueBastardLoop${lane}PlayheadPaint`]();window[`closeBastardLoop${lane}Overlay`]()},lane);await page.waitForTimeout(100);
    if(!process.env.BASELINE){assert.equal(await page.evaluate(lane=>eval(`bastardLoop${lane}PlayheadFrame`),lane),null);assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'')}
    const report={engine,viewport,offscreen,guardReads,positions,...result};console.log(JSON.stringify(report));results.push(report);
   }
   await page.evaluate(()=>stopAllPerformancePlayback({silent:true}));assert.deepEqual(errors,[]);await context.close();
  }}finally{await browser.close()}
 }
 fs.writeFileSync(`${evidence}/${process.env.BASELINE?'baseline':'fixed'}-scroll.json`,JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
