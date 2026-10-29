 'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:18967/mygrain/',evidence='output/page-scroll-20261029';
(async()=>{const results=[];for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
 try{for(const viewport of [{width:402,height:768},{width:768,height:402}]){
  const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:3,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6.1 Mobile Safari/604.1'});
  assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-page-scroll'}})).status(),200);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());await page.goto(base);
  await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainCardHistory);await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
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
    const url=URL.createObjectURL(new Blob([`class Meter extends AudioWorkletProcessor{constructor(){super();this.n=0;this.power=0}process(inputs){const a=inputs[0]?.[0];if(a){for(const x of a)this.power+=x*x;this.n+=a.length;if(this.n>=sampleRate){this.port.postMessage({n:this.n,power:this.power});this.n=0;this.power=0}}return true}}registerProcessor('page-scroll-meter',Meter)`],{type:'text/javascript'}));
    await audioContext.audioWorklet.addModule(url);URL.revokeObjectURL(url);const meter=new AudioWorkletNode(audioContext,'page-scroll-meter'),silent=audioContext.createGain();silent.gain.value=0;finalAmplifierNode.connect(meter);meter.connect(silent);silent.connect(audioContext.destination);
    window.pagePcm=[];meter.port.onmessage=e=>pagePcm.push(e.data);
   });

  await page.waitForTimeout(400);
  await page.evaluate(()=>{
   const names=['drawWaveforms','drawSourceWaveform','drawBastardLoopKWaveform','updateKeyboardGeometry','updateKeyboardNoteLabels','warmKeyboardSound'];
   const originals=Object.fromEntries(names.map(k=>[k,window[k]]));window.pageAudit={calls:Object.fromEntries(names.map(k=>[k,0])),keyWrites:0,hiddenSeqWrites:0,pcmStart:pagePcm.length,audioStart:audioContext.currentTime,wallStart:performance.now(),skipsStart:audioSchedulingStats.skippedSteps};
   for(const name of names)window[name]=(...a)=>{pageAudit.calls[name]++;return originals[name](...a)};
   const o=new MutationObserver(records=>{for(const r of records){if(r.target.closest?.('#keyboardContainer'))pageAudit.keyWrites++;if(r.target.matches?.('.seq-step'))pageAudit.hiddenSeqWrites++}});o.observe(document.body,{subtree:true,attributes:true,attributeFilter:['style','hidden','title','aria-label']});
   window.endPageAudit=()=>{o.disconnect();for(const name of names)window[name]=originals[name]};
  });
  await page.waitForTimeout(900);
  const idle=await page.evaluate(()=>({...pageAudit,calls:{...pageAudit.calls}}));
  const positions=[];
  for(let i=0;i<14;i++){
   const height=viewport.height-[0,30,70,110,70,30,0][i%7];await page.setViewportSize({width:viewport.width,height});
   await page.evaluate(i=>window.scrollTo(0,i%2?1500:600),i);await page.waitForTimeout(55);positions.push(await page.evaluate(()=>scrollY));
  }
  if(engine==='chromium'){
   await page.evaluate(()=>window.scrollTo(0,100));const cdp=await context.newCDPSession(page),x=15,y=viewport.height-70;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=10;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*10}]});await page.waitForTimeout(20)}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});positions.push(await page.evaluate(()=>scrollY));
  }
  await page.waitForTimeout(650);
  const result=await page.evaluate(()=>({audit:{...pageAudit},elapsedAudio:audioContext.currentTime-pageAudit.audioStart,elapsedWall:(performance.now()-pageAudit.wallStart)/1000,skips:audioSchedulingStats.skippedSteps-pageAudit.skipsStart,pcm:pagePcm.slice(pageAudit.pcmStart),playing:sequencerPlaying&&drumMachinePlaying&&isBastardLoopLRunning()&&isBastardLoopXRunning(),blur:getComputedStyle(document.querySelector('.performance-controls')).backdropFilter,controlHeight:document.querySelector('.performance-controls').getBoundingClientRect().height,uiActivity:window.mygrainUiActivity?.snapshot?.()}));
  assert(result.playing);assert(result.pcm.some(p=>p.power>0));assert(positions.some(p=>p>500));assert.equal(result.skips,0);assert(result.elapsedAudio/result.elapsedWall>.95);
  if(!process.env.BASELINE){assert.equal(result.blur,'none');assert.equal(result.audit.hiddenSeqWrites,0);assert.equal(result.audit.calls.updateKeyboardNoteLabels,0,'URL-bar height changes must not relabel keys');assert.equal(result.audit.calls.warmKeyboardSound,0,'URL-bar height changes must not reload instruments');assert(result.audit.calls.updateKeyboardGeometry<=1,'height-only changes must not rebuild geometry');assert.equal(result.uiActivity.scrolling,false)}
  await page.evaluate(()=>endPageAudit());
  // Width/orientation changes still update the actual keyboard after the burst.
  await page.setViewportSize({width:viewport.height,height:viewport.width});await page.waitForTimeout(450);
  const keys=await page.evaluate(()=>{const k=document.getElementById('keyboardContainer');return [...k.querySelectorAll('.key:not([hidden])')].map(e=>({note:e.dataset.note,width:e.style.width}))});assert(keys.length>0&&keys.every(k=>k.width));
  const report={engine,viewport,idle,positions,...result};console.log(JSON.stringify(report));results.push(report);
  await page.evaluate(()=>stopAllPerformancePlayback({silent:true}));assert.deepEqual(errors,[]);await context.close();
 }}finally{await browser.close()}
 }fs.writeFileSync(`${evidence}/${process.env.BASELINE?'baseline':'fixed'}-scroll.json`,JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
