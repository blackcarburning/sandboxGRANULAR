'use strict';
// Disposable localhost account; real WebAudio, scroll gestures and DOM observers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18965/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence = 'output/drum-scroll-20261029';
(async () => {
 const results = [];
 for (const [engine, type] of Object.entries({chromium, webkit})) {
  const browser = await type.launch(engine === 'chromium' ? {executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']} : {});
  try { for (const viewport of [{width:390,height:844},{width:844,height:390}]) {
   const context = await browser.newContext({viewport,isMobile:true,hasTouch:true,userAgent:'iPhone Safari'});
   assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-drum-scroll'}})).status(),200);
   const page = await context.newPage(), errors = [];
   page.on('pageerror', e=>errors.push(e.message));
   await page.route('**/*', r=>new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort());
   await page.goto(base);
   await page.waitForFunction(()=>window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup==='ready');
   await page.evaluate(()=>mygrainCardHistory.ready);
   await page.locator('#start-btn').tap();
   await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   await page.evaluate(async()=>{
    stopAllPerformancePlayback({silent:true});
    // Deterministic, audible short sample through the real drum/output graph.
    setFxMuted(true,{silent:true});applyGlobalBpm(180);syncPatternLengthControls(64,{skipSave:true});
    const b=audioContext.createBuffer(1,Math.round(audioContext.sampleRate*.04),audioContext.sampleRate),a=b.getChannelData(0);
    for(let i=0;i<a.length;i++)a[i]=.1*Math.sin(2*Math.PI*250*i/b.sampleRate)*Math.sin(Math.PI*i/a.length);
    drumMachineKickBuffer=b;drumMachineSnareBuffer=b;drumMachinePercBuffer=b;
    for(const k of ['kick','snare','perc'])getDrumMachinePattern(k).fill(true);
    for(const t of Object.values(drumMachineExtraTracks)){t.buffer=b;t.pattern.fill(true);}
    drumMachineHatPattern.fill(true);restoreDrumMachineLaneSolos([]);
    drumMachineRoll=MygrainDrumRoll.normalize({length:64,pattern:Array(64).fill(true)});
    openDrumMachineOverlay();startDrumMachine(null,{silent:true,skipSave:true});
    const url=URL.createObjectURL(new Blob([`class Meter extends AudioWorkletProcessor {constructor(){super();this.n=0;this.power=0;this.nonzero=0;}process(inputs){const a=inputs[0]?.[0];if(a){for(const x of a){this.power+=x*x;if(Math.abs(x)>.00001)this.nonzero++;}this.n+=a.length;if(this.n>=sampleRate){this.port.postMessage({n:this.n,power:this.power,nonzero:this.nonzero});this.n=0;this.power=0;this.nonzero=0;}}return true}}registerProcessor('drum-scroll-meter',Meter);`],{type:'text/javascript'}));
    await audioContext.audioWorklet.addModule(url);URL.revokeObjectURL(url);
    const meter=new AudioWorkletNode(audioContext,'drum-scroll-meter'),silent=audioContext.createGain();silent.gain.value=0;
    finalAmplifierNode.connect(meter);meter.connect(silent);silent.connect(audioContext.destination);
    window.drumAudit={modalScans:0,styleReads:0,mutations:0,rollMutations:0,refreshes:0,hits:0,lateMs:0,pcm:[],audioStart:audioContext.currentTime,skipsStart:audioSchedulingStats.skippedSteps};
    meter.port.onmessage=e=>drumAudit.pcm.push(e.data);
    const query=document.querySelectorAll.bind(document),style=window.getComputedStyle;
    document.querySelectorAll=function(s){if(s.includes('.drum-machine-overlay')&&s.includes('dialog'))drumAudit.modalScans++;return query(s)};
    window.getComputedStyle=function(...a){drumAudit.styleReads++;return style(...a)};
    const sync=syncPerformanceControlState,hit=playDrumMachineHit;
    syncPerformanceControlState=(...a)=>{drumAudit.refreshes++;return sync(...a)};
    playDrumMachineHit=(b,t,...a)=>{drumAudit.hits++;drumAudit.lateMs=Math.max(drumAudit.lateMs,(audioContext.currentTime-t)*1000);return hit(b,t,...a)};
    const observer=new MutationObserver(records=>{drumAudit.mutations+=records.length;drumAudit.rollMutations+=records.filter(r=>document.getElementById('drumMachineLane-roll').contains(r.target)).length});
    observer.observe(document.getElementById('drumMachineOverlay'),{subtree:true,childList:true,attributes:true,characterData:true});
    window.endDrumAudit=()=>{observer.disconnect();document.querySelectorAll=query;window.getComputedStyle=style;syncPerformanceControlState=sync;playDrumMachineHit=hit;meter.port.onmessage=null;finalAmplifierNode.disconnect(meter);meter.disconnect();silent.disconnect()};
   });
   await page.waitForTimeout(300);
   // Hidden Roll must do no per-step work; scroll both ends while audio runs.
   const positions=[];
   for(let i=0;i<20;i++){
    await page.evaluate(i=>{const l=document.querySelector('#drumMachineOverlay .drum-machine-layout');l.scrollTop=i%2?0:l.scrollHeight},i);
    await page.waitForTimeout(110);
    positions.push(await page.locator('#drumMachineOverlay .drum-machine-layout').evaluate(e=>e.scrollTop));
   }
   const sequenceScans = await page.evaluate(()=>drumAudit.modalScans);
   // Native Chromium touch scrolling exercises the document capture guard too.
   if(engine==='chromium'){
    await page.locator('#drumMachineOverlay .drum-machine-layout').evaluate(e=>e.scrollTop=0);
    const rect=await page.locator('[aria-label="Kick track"] .performance-chip').boundingBox(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    const cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*9}]});await page.waitForTimeout(20);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const nativeScroll=await page.locator('#drumMachineOverlay .drum-machine-layout').evaluate(e=>e.scrollTop);
    positions.push(nativeScroll);assert(nativeScroll>40,'native touch gesture must scroll');
   }
   await page.waitForTimeout(500);
   const result=await page.evaluate(()=>{
    const result={...drumAudit,elapsedAudio:audioContext.currentTime-drumAudit.audioStart,skips:audioSchedulingStats.skippedSteps-drumAudit.skipsStart,playing:drumMachinePlaying,voices:drumMachineActiveVoices.size,backdrop:getComputedStyle(document.getElementById('drumMachineOverlay')).backdropFilter};
    endDrumAudit();return result;
   });
   assert(result.playing);assert(result.hits>80);assert(result.pcm.some(p=>p.power>0&&p.nonzero>100));assert.equal(result.refreshes,0);assert(positions.some(p=>p>100));
   if(!process.env.BASELINE){assert.equal(sequenceScans,0,'sequencer animation must not re-scan modal layout');assert.equal(result.skips,0);assert(result.lateMs<10);assert.equal(result.backdrop,'none');}
   assert.deepEqual(errors,[]);
   // Resume the visible Roll indicator after scrolling; stop/close must leave
   // no visual clock or old events to repaint a restarted editor.
   await page.locator('#drumMachineRollGrid .drum-machine-step-btn').first().evaluate(e=>e.scrollIntoView({block:'center'}));
   await page.waitForFunction(()=>/^Step /.test(document.getElementById('drumMachineRollPosition').textContent));
   assert.match(await page.locator('#drumMachineRollPosition').textContent(),/^Step /);
   if(!process.env.BASELINE){
    await page.screenshot({path:`${evidence}/${engine}-${viewport.width}.png`});
    assert.equal(await page.locator('.drum-ui-build').textContent(),'D29.1');
    const cleanup=await page.evaluate(()=>{stopDrumMachine({silent:true,skipSave:true});closeDrumMachineOverlay();return{frame:drumMachineVisualFrame,queue:drumMachineVisualEvents.length}});
    assert.deepEqual(cleanup,{frame:null,queue:0});
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'');
    // A new body-level modal still locks/unlocks page scrolling, including
    // visibility controlled by an ancestor rather than the dialog itself.
    await page.evaluate(()=>{const host=document.createElement('div');host.id='drumAuditModal';host.hidden=true;host.innerHTML='<div role="dialog" aria-modal="true">fixture</div>';document.body.append(host)});
    await page.locator('#drumAuditModal').evaluate(e=>e.hidden=false);
    await page.waitForTimeout(40);assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'hidden');
    await page.locator('#drumAuditModal').evaluate(e=>e.remove());
    await page.waitForTimeout(40);assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'');
   }else await page.evaluate(()=>{stopDrumMachine({silent:true,skipSave:true});closeDrumMachineOverlay()});
   console.log(JSON.stringify({engine,viewport,sequenceScans,...result,positions}));results.push({engine,viewport,sequenceScans,...result,positions});
   await context.close();
  }} finally {await browser.close();}
 }
 fs.writeFileSync(`${evidence}/${process.env.BASELINE?'baseline':'fixed'}-scroll.json`,JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
