// Real Web Audio output, disposable local accounts, no production state.
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:18891/mygrain/',evidence=process.env.SECTION_EVIDENCE||'/tmp/mygrain-section-browser';fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const results=[];
 for(const engine of ['chromium','webkit']){
  if(process.env.SECTION_ENGINE&&process.env.SECTION_ENGINE!==engine)continue;
  const browser=await({chromium,webkit}[engine]).launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{for(const mobile of [false,true]){
   const context=await browser.newContext({viewport:mobile?{width:402,height:874}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
   const registered=await context.request.post(base+'api/auth/register',{data:{username:`sect_${engine[0]}_${+mobile}_${Date.now()}`,password:'isolated-section-test'}});assert.equal(registered.status(),200);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   await page.goto(base);await page.waitForFunction(()=>window.mygrainQ&&window.mygrainPatternSection&&window.mygrainSongBeta&&!mygrainSongBeta.busy&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   await page.evaluate(()=>{
    stopAllPerformancePlayback({silent:true});resetStemIsolationState();applyGlobalBpm(300);syncPatternLengthControls(64,{skipSave:true});
    const q=MygrainQTheory.defaults();q.enabled=true;for(const i of [0,8,12,24,60])q.sequence[i]=MygrainQTheory.normalizeStep({notes:[60,64,67],root:60,type:'major',gate:4});mygrainQ.restore(q);
    const tone=seconds=>{const b=audioContext.createBuffer(1,Math.round(seconds*audioContext.sampleRate),audioContext.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.sin(i/audioContext.sampleRate*2*Math.PI*220)*.1;return b};
    bastardLoopBuffer=tone(3.2);bastardLoopMetadata={bpm:300,durationSeconds:3.2};bastardLoopEnabled=true;
    bastardLoopLSampleBuffer=tone(.09);bastardLoopXSampleBuffer=tone(.09);bastardLoopLEnabled=true;bastardLoopXEnabled=true;bastardLoopLSourceMode='sample';bastardLoopXSourceMode='sample';bastardLoopLTimingIndex=3;bastardLoopXTimingIndex=3;
    bastardLoopLSequence=Array.from({length:64},(_,i)=>({note:['C3','D3','E3','F3'][i%4],rest:false,ratchet:1,accent:false,slide:false}));bastardLoopXSequence=Array.from({length:64},(_,i)=>({note:['C2','D2','E2','F2'][i%4],rest:false,ratchet:1,accent:false,slide:false}));
    ensureBastardLoopLSequenceCapacity();ensureBastardLoopXSequenceCapacity();
    drumMachineEnabled=true;drumMachineHatPattern=Array(64).fill(true);window.sectionEvents=[];
    const lead=scheduleBastardLoopLVoice,bass=scheduleBastardLoopXVoice,drums=scheduleDrumMachineHatStep;
    scheduleBastardLoopLVoice=(step,time,...args)=>{sectionEvents.push({lane:'L',index:bastardLoopLCurrentStepIndex,time,origin:mygrainPatternSection.active?.origin});return lead(step,time,...args)};
    scheduleBastardLoopXVoice=(step,time,...args)=>{sectionEvents.push({lane:'X',index:bastardLoopXCurrentStepIndex,time,origin:mygrainPatternSection.active?.origin});return bass(step,time,...args)};
    scheduleDrumMachineHatStep=(index,time,...args)=>{sectionEvents.push({lane:'drums',index,time,origin:mygrainPatternSection.active?.origin});return drums(index,time,...args)};
    saveState();window.sectionBefore=JSON.stringify({length:getPatternLengthSteps(),L:bastardLoopLSequence,X:bastardLoopXSequence,hat:drumMachineHatPattern});
   });
   await page.locator('#performanceBastardLoopQEditBtn').click();
   const open=async index=>{const cell=page.locator(`#bastardLoopQStepGrid [data-q-step="${index}"]`);if(mobile){await cell.tap();if(!await page.evaluate(()=>mygrainQ.chordEditor.opened))await cell.tap()}else await cell.dblclick();try{await page.waitForFunction(()=>mygrainQ.chordEditor.preview?.running&&!mygrainQ.chordEditor.loading)}catch(e){console.error('OPEN',engine,mobile,await page.evaluate(()=>({status:document.getElementById('qChordEditorStatus').textContent,opened:mygrainQ.chordEditor.opened,loading:mygrainQ.chordEditor.loading,active:mygrainPatternSection.active,preview:mygrainQ.chordEditor.preview?.running,request:mygrainQ.chordEditor.request})),errors);throw e}};
   const collect=async steps=>{await page.waitForTimeout(steps*50*2+500);return page.evaluate(()=>{const s=mygrainPatternSection.active;return {origin:s.origin,duration:s.duration,start:s.start,rates:{L:getBastardLoopLStepDurationSeconds(),X:getBastardLoopXStepDurationSeconds(),drums:getDrumMachineStepDuration()},events:sectionEvents.filter(e=>e.origin===s.origin),buffer:{duration:bastardLoopSource.buffer.duration,rate:bastardLoopSource.playbackRate.value,loopStart:bastardLoopSource.loopStart,loopEnd:bastardLoopSource.loopEnd},running:{L:bastardLoopLTransportActive,X:bastardLoopXTransportActive,drums:drumMachinePlaying,Q:mygrainQ.chordEditor.preview.running},doubleQ:mygrainQ.running}})};
   const verify=(r,start,steps)=>{assert(Object.values(r.running).every(Boolean),JSON.stringify(r));assert.equal(r.doubleQ,false);assert(Math.abs(r.buffer.duration/r.buffer.rate-r.duration)<.0001);for(const lane of ['L','X','drums']){const events=r.events.filter(e=>e.lane===lane);const dt=r.rates[lane];assert(events.length>=Math.floor(r.duration/dt+1e-6)*2,`${engine}/${mobile} ${lane}: ${events.length}`);for(const e of events){const phase=((e.time-r.origin+1e-7)%r.duration+r.duration)%r.duration,position=(r.start+phase)/dt;assert(Math.abs(position-Math.round(position))<.0001);assert.equal(e.index,Math.floor(position+1e-6)%64,JSON.stringify(e))}}};
   await open(8);const initial=await collect(16);verify(initial,8,16);
   const audio=await page.evaluate(async()=>{const a=audioContext.createAnalyser();a.fftSize=1024;preFilterGainNode.connect(a);const d=new Float32Array(1024);let peak=0;for(let i=0;i<30;i++){a.getFloatTimeDomainData(d);peak=Math.max(peak,Math.sqrt(d.reduce((s,v)=>s+v*v,0)/d.length));await new Promise(r=>setTimeout(r,15))}preFilterGainNode.disconnect(a);return peak});assert(audio>.0001);
   await page.evaluate(async()=>{bastardLoopLTimingIndex=4;bastardLoopXTimingIndex=2;await mygrainQ.chordEditor.startLoop()});const independent=await collect(16);verify(independent,8,16);
   await page.evaluate(async()=>{bastardLoopLTimingIndex=3;bastardLoopXTimingIndex=3;await mygrainQ.chordEditor.startLoop()});
   await page.locator('[data-q-note-action="chord-up"]').click();await page.waitForFunction(()=>mygrainQ.state.sequence[8].notes[0]===61&&!mygrainQ.chordEditor.loading);verify(await collect(16),8,16);
   const length=page.locator('#qChordLoopSteps');await length.fill('4');await length.press('Enter');await page.waitForFunction(()=>mygrainQ.chordEditor.loopSteps===4&&!mygrainQ.chordEditor.loading);const short=await collect(4);verify(short,8,4);
   await page.screenshot({path:`${evidence}/${engine}-${mobile?'phone':'desktop'}.png`});
   await page.locator('#qChordLoopToggle').click();assert(await page.evaluate(()=>!mygrainPatternSection.active&&!drumMachinePlaying&&!bastardLoopLTransportActive&&!bastardLoopXTransportActive&&!mygrainQ.chordEditor.preview.running));
   await page.locator('#qChordLoopToggle').click();await page.waitForFunction(()=>mygrainQ.chordEditor.preview.running&&!mygrainQ.chordEditor.loading);await page.locator('#qChordEditorClose').click();assert(await page.evaluate(()=>!mygrainPatternSection.active&&!drumMachinePlaying&&!bastardLoopLTransportActive&&!bastardLoopXTransportActive));
   await open(60);await length.fill('8');await length.press('Enter');await page.waitForFunction(()=>mygrainQ.chordEditor.loopSteps===8&&!mygrainQ.chordEditor.loading);const wrap=await collect(8);verify(wrap,60,8);await page.locator('#qChordEditorClose').click();
   const normal=await page.evaluate(async()=>{await mygrainQ.preparePlayback();restartAllTransport({silent:true});return {origin:getSharedLoopTransportOriginTime(),q:mygrainQ.running,sourceDuration:bastardLoopSource.buffer.duration}});assert(normal.q);await open(8);verify(await collect(8),8,8);await page.locator('#qChordEditorClose').click();
   assert(await page.evaluate(origin=>!mygrainPatternSection.active&&drumMachinePlaying&&bastardLoopLTransportActive&&bastardLoopXTransportActive&&mygrainQ.running&&mygrainQ.origin===origin,normal.origin));assert.equal(await page.evaluate(()=>bastardLoopSource.buffer.duration),normal.sourceDuration);
   await open(8);await page.evaluate(()=>stopAllPerformancePlayback({silent:true}));await page.locator('#qChordEditorClose').click();assert(await page.evaluate(()=>!mygrainPatternSection.active&&!drumMachinePlaying&&!bastardLoopLTransportActive&&!bastardLoopXTransportActive&&!mygrainQ.running));
   assert(await page.evaluate(()=>sectionBefore===JSON.stringify({length:getPatternLengthSteps(),L:bastardLoopLSequence,X:bastardLoopXSequence,hat:drumMachineHatPattern})), 'loop edits changed saved accompaniment');
   await page.evaluate(()=>{drumMachineEnabled=false;saveState()});await open(8);assert.equal(await page.evaluate(()=>drumMachineEnabled),false);await page.locator('#qChordEditorClose').click();assert.equal(await page.evaluate(()=>drumMachineEnabled),false);
   assert.deepEqual(errors,[]);results.push({engine,mobile,audio,initial,independent,short,wrap,restore:true,stopAll:true,savedPatternsUnchanged:true,mutedDrumsPreserved:true});console.log('PASS',engine,mobile?'phone':'desktop','whole-pattern audio, Q/L/X/drums clock, sampled loop, transpose, editable boundaries, wrap, stop/close/resume, mute and saved state');await context.close();
  }}finally{await browser.close()}
 }
 fs.writeFileSync(evidence+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
