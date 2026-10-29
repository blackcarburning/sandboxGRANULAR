'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:18967/mygrain/',out='output/vu-visible-20261029';
(async()=>{const reports=[];for(const [engine,type] of Object.entries({chromium,webkit})){
 if(process.env.VU_ENGINES&&!process.env.VU_ENGINES.split(',').includes(engine))continue;
 const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{for(const viewport of [{width:402,height:768},{width:768,height:402}]){
 if(process.env.VU_WIDTHS&&!process.env.VU_WIDTHS.split(',').includes(String(viewport.width)))continue;
 const c=await b.newContext({viewport,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6.1 Mobile Safari/604.1'});
 assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-page-scroll'}})).status(),200);
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainCardHistory);await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});
  window.vuTone=audioContext.createOscillator();window.vuGain=audioContext.createGain();vuGain.gain.value=.08;vuTone.connect(vuGain);vuGain.connect(finalAmplifierNode);vuTone.start();bastardLoopMFxOutputGainNode=vuGain;bastardLoopMPlusFxOutputGainNode=vuGain;
  // Real analyser taps on every channel with one known non-silent isolated test signal.
  for(const config of PERFORMANCE_MIXER_VU_CHANNELS)config.getNode=()=>vuGain;
  bastardLoopMMicAnalyserNode=audioContext.createAnalyser();bastardLoopMMicAnalyserNode.fftSize=512;vuGain.connect(bastardLoopMMicAnalyserNode);bastardLoopMMicAnalyserData=new Float32Array(512);
  bastardLoopMPlusMicAnalyserNode=audioContext.createAnalyser();bastardLoopMPlusMicAnalyserNode.fftSize=512;vuGain.connect(bastardLoopMPlusMicAnalyserNode);bastardLoopMPlusMicAnalyserData=new Float32Array(512);
  startBastardLoopMInputMeter();startBastardLoopMPlusInputMeter();startPerformanceMixerVuMeters();syncKeyboardRecordingMeter();
  window.vuAudit={reads:0,diagnosticReads:0,writes:0,offscreenWrites:[],frames:0,lastUpdates:{}};
  const paint=window.updatePerformanceVuDisplay;window.updatePerformanceVuDisplay=function(shell,...args){const r=shell?.getBoundingClientRect();if(shell)vuAudit.lastUpdates[shell.id]={top:r.top,bottom:r.bottom,wall:performance.now(),stack:new Error().stack};return paint(shell,...args)};
  const original=AnalyserNode.prototype.getFloatTimeDomainData;AnalyserNode.prototype.getFloatTimeDomainData=function(...a){if(new Error().stack.includes('capturePhoneDiagnosticState'))vuAudit.diagnosticReads++;else vuAudit.reads++;return original.apply(this,a)};
  const observer=new MutationObserver(records=>{for(const r of records){const meter=r.target.closest?.('[role="meter"]')||r.target.parentElement?.closest?.('.performance-inline-vu,.performance-vu-wrap,.vocal-playback-display');if(!meter)continue;vuAudit.writes++;const rect=meter.getBoundingClientRect();if(!rect.width||!rect.height||rect.bottom<=0||rect.top>=innerHeight)vuAudit.offscreenWrites.push({id:meter.id||meter.getAttribute('aria-label'),attr:r.attributeName,top:rect.top,bottom:rect.bottom,wall:performance.now(),paint:vuAudit.lastUpdates[meter.id]})}});observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','aria-valuenow','aria-valuetext','class']});
  const url=URL.createObjectURL(new Blob([`class Probe extends AudioWorkletProcessor{constructor(){super();this.i=0}process(ins){if(++this.i%30===0){const a=ins[0]?.[0]||[];this.port.postMessage(a.reduce((s,v)=>s+v*v,0))}return true}}registerProcessor('vu-probe',Probe)`],{type:'text/javascript'}));await audioContext.audioWorklet.addModule(url);URL.revokeObjectURL(url);window.vuPcm=[];const node=new AudioWorkletNode(audioContext,'vu-probe'),silent=audioContext.createGain();silent.gain.value=0;finalAmplifierNode.connect(node);node.connect(silent);silent.connect(audioContext.destination);node.port.onmessage=e=>vuPcm.push(e.data);
 });
 const meterIds=await p.locator('.performance-vu-shell').evaluateAll(els=>els.map(e=>e.id));assert(meterIds.length>20);
 const results=[];
 for(const id of meterIds){
  await p.evaluate(id=>document.getElementById(id).scrollIntoView({block:'center',behavior:'instant'}),id);await p.waitForTimeout(320);
  const visible=await p.locator('#'+id).evaluate(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0});
  if(visible)await p.waitForFunction(()=>mygrainMeters.snapshot().active>0);
  const before=await p.evaluate(()=>({reads:vuAudit.reads,writes:vuAudit.writes,wall:performance.now()}));
  if(visible)await p.waitForFunction(({id,wall})=>vuAudit.lastUpdates[id]?.wall>wall&&document.getElementById(id).querySelector('.performance-vu-fill').style.transform.includes('scaleX'),{id,wall:before.wall});else await p.waitForTimeout(150);
  const state=await p.evaluate(id=>{const el=document.getElementById(id);return{id,transform:el.querySelector('.performance-vu-fill')?.style.transform,reads:vuAudit.reads,writes:vuAudit.writes,clock:mygrainMeters.snapshot()}},id);
  if(visible){assert(state.reads>before.reads,JSON.stringify(state));assert.match(state.transform,/scaleX/)}results.push(state);
 }
 // All five K and both M/M+ playback VUs read a real stereo tap only when viewed.
 await p.evaluate(()=>{window.vuVoices=new Map(Array.from({length:5},(_,i)=>[i,{output:vuGain}]));mygrainKTrackMeters.sync(vuVoices)});
 const playbackMeters=[];
 for(const selector of ['[data-vocal-playback-meter="0"]','[data-vocal-playback-meter="1"]',...Array.from({length:5},(_,i)=>`[data-k-track-meter="${i}"]`)]){
  await p.locator(selector).evaluate(el=>el.scrollIntoView({block:'center',inline:'center',behavior:'instant'}));
  await p.waitForFunction(()=>!mygrainUiActivity.busy);await p.evaluate(()=>mygrainKTrackMeters.sync(vuVoices));
  await p.waitForFunction(selector=>Number(document.querySelector(selector).getAttribute('aria-valuenow'))>-60,selector);
  playbackMeters.push({selector,db:await p.locator(selector).getAttribute('aria-valuenow')});
 }
 // Zero sampling and paints when every VU is away from the viewport.
 await p.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await p.waitForTimeout(500);
 const off=await p.evaluate(()=>({clock:mygrainMeters.snapshot(),k:mygrainKTrackMeters.activeCount,reads:vuAudit.reads,writes:vuAudit.writes}));await p.waitForTimeout(550);const offAfter=await p.evaluate(()=>({reads:vuAudit.reads,writes:vuAudit.writes}));
 assert.equal(off.clock.active,0);assert.equal(off.clock.timer,false);assert.equal(off.k,0);assert.equal(offAfter.reads,off.reads);assert.equal(offAfter.writes,off.writes);
 // While continuously scrolling across the mixer, no VU work sneaks through.
 await p.evaluate(()=>document.getElementById('performanceGeneratedDryTrimVuShell').scrollIntoView({block:'center',behavior:'instant'}));await p.waitForTimeout(500);
 await p.evaluate(()=>{document.dispatchEvent(new Event('scroll'));window.vuBusyStart={reads:vuAudit.reads,writes:vuAudit.writes}});
 for(let i=0;i<12;i++){await p.evaluate(i=>{window.scrollBy(0,i%2?8:-8);document.dispatchEvent(new Event('scroll'))},i);await p.waitForTimeout(40)}
 const busy=await p.evaluate(()=>({before:vuBusyStart,reads:vuAudit.reads,writes:vuAudit.writes,clock:mygrainMeters.snapshot()}));assert.equal(busy.reads,busy.before.reads);assert.equal(busy.writes,busy.before.writes);assert.equal(busy.clock.timer,false);await p.waitForTimeout(500);assert((await p.evaluate(()=>vuAudit.reads))>busy.reads);
 // Observe actual full-screen black mask through a frame, then top-aligned arrival.
 const jumps=[];
 for(const selector of ['#performanceMixerCard','[aria-label="Bastardloop L controls"]','#bastardLoopKCard','#noiseCard']){
  await p.evaluate(selector=>{const button=document.createElement('button');button.dataset.jumpTarget=selector;window.mygrainJumpToButton(button)},selector);
  assert(await p.locator('#desktopJumpCurtain').isVisible());const mask=await p.locator('#desktopJumpCurtain').evaluate(e=>({text:e.innerText,bg:getComputedStyle(e).backgroundColor,r:[e.getBoundingClientRect().width,e.getBoundingClientRect().height],blocked:mygrainMeters.blocked,clock:mygrainMeters.snapshot()}));assert.equal(mask.text,'jumping');assert.equal(mask.bg,'rgb(0, 0, 0)');assert(mask.blocked);assert.equal(mask.clock.timer,false);
  await p.waitForFunction(()=>!document.documentElement.dataset.mygrainJumping);await p.waitForTimeout(200);
  const top=await p.locator(selector).evaluate(e=>({top:e.getBoundingClientRect().top,margin:parseFloat(getComputedStyle(e).scrollMarginTop)||0}));assert(Math.abs(top.top-top.margin)<3,JSON.stringify({selector,...top}));jumps.push({selector,...top});
 }
 // Mixer slider and module links must arrive at the card header, not its centre.
 await p.evaluate(()=>jumpToPerformanceMixerSlider(PERFORMANCE_MIXER_VU_CHANNELS[0].controlId));await p.waitForFunction(()=>!document.documentElement.dataset.mygrainJumping);const sliderTop=await p.evaluate(()=>{const e=document.getElementById(PERFORMANCE_MIXER_VU_CHANNELS[0].controlId).closest('.performance-sound-card');return e.getBoundingClientRect().top-(parseFloat(getComputedStyle(e).scrollMarginTop)||0)});assert(Math.abs(sliderTop)<3,String(sliderTop));
 // Exercise a real phone drawer tap as well as the direct jump paths.
 await p.evaluate(()=>{window.vuJumpEvents=0;window.addEventListener('mygrain-jump-change',()=>{if(document.documentElement.dataset.mygrainJumping)vuJumpEvents++})});
 await p.locator('#sectionJumpHandle').tap();await p.locator('#sectionJumpBastardMixerBtn').tap();await p.waitForFunction(()=>!document.documentElement.dataset.mygrainJumping);assert((await p.evaluate(()=>vuJumpEvents))>0);
 const mixerTop=await p.locator('#performanceMixerCard').evaluate(e=>e.getBoundingClientRect().top-(parseFloat(getComputedStyle(e).scrollMarginTop)||0));assert(Math.abs(mixerTop)<3,String(mixerTop));
 await p.evaluate(()=>mygrainNavigation.transitionJump(()=>({target:document.getElementById('performanceMixerCard'),block:'start',ready:new Promise(r=>setTimeout(r,400))})));
 await p.screenshot({path:`${out}/${engine}-${viewport.width}-jumping.png`});await p.waitForFunction(()=>!document.documentElement.dataset.mygrainJumping);
 const audio=await p.evaluate(()=>({pcm:vuPcm.some(v=>v>0),state:audioContext.state,offscreenWrites:vuAudit.offscreenWrites,allMeters:document.querySelectorAll('[role="meter"]').length}));assert(audio.pcm);assert.equal(audio.state,'running');assert.deepEqual(audio.offscreenWrites,[]);assert.deepEqual(errors,[]);
 await p.screenshot({path:`${out}/${engine}-${viewport.width}.png`});const report={engine,viewport,meterCount:meterIds.length,playbackMeters,results,off,offAfter,busy,jumps,audio};reports.push(report);fs.writeFileSync(`${out}/${engine}-${viewport.width}-browser.json`,JSON.stringify(report,null,2));console.log('PASS',engine,viewport.width,meterIds.length,'legacy meters + K/M playback, zero offscreen/scroll work, black mask and card tops, real PCM');await c.close();
 }}finally{await b.close()}}
 fs.writeFileSync(`${out}/browser.json`,JSON.stringify(reports,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
