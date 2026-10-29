'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
(async()=>{const results=[];for(const [engine,type] of Object.entries({chromium,webkit}))for(const phone of [false,true]){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{const context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1440,height:1000},...(phone?{isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const req=r.request(),u=new URL(req.url());if(u.origin!=='https://openclaw.blackcarburning.com'||!['GET','HEAD'].includes(req.method()))return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"idle-fixture"}};'});if(u.pathname.includes('/api/'))return r.fulfill({json:{ok:true,authenticated:true,user:{username:'idle-fixture'},files:[],songs:[],folders:[],samples:[],patches:[]}});return r.continue();});
 await page.goto('https://openclaw.blackcarburning.com/mygrain/?fx-idle-test=1');await page.waitForFunction(()=>window.mygrainLoopFx&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting);
 assert((await page.content()).includes('loop-card-fx.js?v=20261027-amend-fx-memory-2'));
 const result=await page.evaluate(async()=>{
  const checks=[],qChecks=[];
  for(const on of [false,true]){const ctx=new OfflineAudioContext(2,48000,48000),controller=new MygrainQ.Controller({context:()=>ctx,destination:()=>ctx.destination,bpm:()=>120,soloGain:()=>1});Object.assign(controller.state,{enabled:true,level:1,room:on?.4:0,delay:on?.3:0});const eq=window.mygrainChannelEq;window.mygrainChannelEq=null;let g;try{g=controller.ensureGraph();}finally{window.mygrainChannelEq=eq;}if(!on&&g.reverbBanks.some(b=>b.node.buffer))throw Error('idle Q builds reverb');const osc=ctx.createOscillator(),gain=ctx.createGain();gain.gain.value=.1;osc.connect(gain).connect(g.input);osc.start();osc.stop(.05);const b=await ctx.startRendering();let tail=0;for(const x of b.getChannelData(0).slice(24000))tail+=x*x;qChecks.push(tail);clearTimeout(g.reverbTimer);for(const n of g.nodes)n.disconnect();}
  if(qChecks[0]>1e-10||qChecks[1]<1e-6)throw Error('Q bypass/re-enable audio regression '+qChecks);

  async function render(enabled){const ctx=new OfflineAudioContext(2,48000,48000),s={...MygrainLoopFx.defaults(),filterEnabled:false,room:.5,delay:.4,reverbEnabled:enabled,delayEnabled:enabled},g=MygrainLoopFx.createGraph(ctx,ctx.destination,s,120);const osc=ctx.createOscillator(),a=ctx.createGain();a.gain.value=.1;osc.connect(a).connect(g.input);osc.start();osc.stop(.05);const b=await ctx.startRendering();let tail=0;for(const x of b.getChannelData(0).slice(24000))tail+=x*x;const diagnostic=g.diagnostics();g.dispose();return{tail,diagnostic};}
  checks.push(await render(false),await render(true));
  // Editing parks actual live-host banks without altering saved knobs/routes,
  // including graphs made while preparation is active. Resume restores audio.
  const wet=MygrainLoopFx.normalize();Object.assign(wet.channels.L,{filterEnabled:false,room:.4,delay:.3});mygrainLoopFx.restore(wet);
  const ctx=new OfflineAudioContext(2,48000,48000),source=ctx.createOscillator(),amp=ctx.createGain();amp.gain.value=.1;source.connect(amp);
  const resume=mygrainLoopFx.prepareEditing(),route=mygrainLoopFx.connect('L',amp,ctx.destination,null,ctx);
  const hostGraph=[...mygrainLoopFx.groups].find(g=>g.context===ctx).graph;
  if(hostGraph.banks.some(b=>b.node.buffer)||hostGraph.diagnostics().hallOn||hostGraph.diagnostics().delayOn)throw Error('New preparation graph allocates wet DSP');
  mygrainLoopFx.restore(wet);if(hostGraph.banks.some(b=>b.node.buffer))throw Error('Restore rebuilds parked DSP');
  resume();resume();await new Promise(r=>setTimeout(r,220));
  if(!hostGraph.diagnostics().hallOn||!hostGraph.diagnostics().delayOn||!hostGraph.banks.some(b=>b.node.buffer))throw Error('Editing fails to resume effects');
  if(JSON.stringify(mygrainLoopFx.settings())!==JSON.stringify(wet))throw Error('Editing changes saved effects');
  source.start();source.stop(.05);const resumed=await ctx.startRendering();let resumedTail=0;for(const x of resumed.getChannelData(0).slice(24000))resumedTail+=x*x;
  if(resumedTail<1e-6)throw Error('Resumed effects are silent');route.disconnect();mygrainChannelEq.releaseContext(ctx);
  // Track native edges and ensure bypass removes all reachability/feedback edges.
  const edges=new Map(),rawConnect=AudioNode.prototype.connect,rawDisconnect=AudioNode.prototype.disconnect;
  AudioNode.prototype.connect=function(to,...args){if(!edges.has(this))edges.set(this,new Set());edges.get(this).add(to);return rawConnect.call(this,to,...args);};
  AudioNode.prototype.disconnect=function(to,...args){if(!arguments.length)edges.get(this)?.clear();else edges.get(this)?.delete(to);return rawDisconnect.apply(this,arguments);};
  let graph;
  try{const ctx=new OfflineAudioContext(2,128,48000),s={...MygrainLoopFx.defaults(),filterEnabled:false,room:.3,delay:.3};graph=MygrainLoopFx.createGraph(ctx,ctx.destination,s,120);for(let i=0;i<4;i++){graph.update({...s,reverbEnabled:false,delayEnabled:false},120,true);if(graph.banks.some(b=>b.node.buffer))throw Error('disabled hall retains impulse');const d=graph.diagnostics();if(d.hallOn||d.delayOn||d.lfoOn||graph.filters.length)throw Error('bypassed effect active');graph.update({...s,reverbEnabled:true,delayEnabled:true},120,true);}graph.update({...s,reverbEnabled:false,delayEnabled:false},120,true);
   // From graph input, no effect-specific node is reachable when bypassed.
   const reachable=new Set(),walk=n=>{if(reachable.has(n))return;reachable.add(n);for(const to of edges.get(n)||[])walk(to);};walk(graph.input);
   if([...reachable].some(n=>n instanceof DelayNode||n instanceof ConvolverNode||n instanceof BiquadFilterNode))throw Error('disabled DSP reachable');
   const input=ctx.createGain(),comp=ctx.createDynamicsCompressor();comp.threshold.value=0;comp.ratio.value=1;const out=configureIdleCompressor(input,comp,false);out.connect(ctx.destination);
   for(const on of [false,true,false]){configureIdleCompressor(input,comp,on);reachable.clear();walk(input);if(reachable.has(comp)!==on)throw Error('compressor bypass reachability');}disposeIdleCompressor(comp);input.disconnect();comp.disconnect();

  }finally{graph?.dispose();AudioNode.prototype.connect=rawConnect;AudioNode.prototype.disconnect=rawDisconnect;}
  // Physical visibility: hidden waveform requests perform zero canvas operations, reveal repaints.
  return{checks,qChecks,phone:window.mygrainPhone};
 });
 assert(result.checks[0].tail<1e-12);assert(result.checks[1].tail>1e-6);assert.equal(!!result.phone,phone);
 const ui=await page.evaluate(async()=>{
  const card=document.getElementById('bastardLoopCard')||document.querySelector('[aria-label="Bastardloop controls"]');mygrainDemand.run(card);await new Promise(r=>setTimeout(r,100));
  const panel=document.querySelector('[data-loop-fx-key="A"]');if(!panel)throw Error('missing A FX panel');
  const input=panel.querySelector('[data-loop-fx="reverbEnabled"]');input.checked=false;input.dispatchEvent(new Event('input',{bubbles:true}));const off=mygrainLoopFx.channel('A').reverbEnabled;input.checked=true;input.dispatchEvent(new Event('input',{bubbles:true}));
  for(const key of ['A','B','C','V','W','P','O','L','X','M','M+','K','Q','N']){const id={A:'bastardLoopCard',B:'bastardLoop2Card',C:'bastardLoop3Card','M+':'bastardLoopMPlusCard',N:'noiseCard'}[key]||`bastardLoop${key}Card`;mygrainDemand.run(document.getElementById(id)||document.querySelector(`[aria-label="Bastardloop${key==='A'?'':' '+key} controls"]`));}await new Promise(r=>setTimeout(r,100));
  mygrainLoopFx.randomise();for(const [key,c] of Object.entries(mygrainLoopFx.settings().channels)){if(c.delayEnabled||c.reverbEnabled!==['V','L'].includes(key))throw Error('incorrect random space switches '+key);}
  const saved=mygrainLoopFx.settings();saved.channels.A.reverbEnabled=false;saved.channels.A.delayEnabled=false;saved.channels.A.room=.27;saved.channels.A.delay=.19;mygrainLoopFx.restore(saved);const snap=saveState({force:true,snapshotOnly:true});mygrainLoopFx.randomise();mygrainLoopFx.restore(snap.modes.loopFx);if(mygrainLoopFx.channel('A').reverbEnabled||mygrainLoopFx.channel('A').delayEnabled||mygrainLoopFx.channel('A').room!==.27)throw Error('switch state did not roundtrip');
  const checkboxCount=document.querySelectorAll('[data-loop-fx="reverbEnabled"],[data-loop-fx="delayEnabled"]').length;
  const final=document.getElementById('performanceLayerDelayBtnCheckbox');final.click();const on=getSliderPercent('finalDelayDepth')>0;final.click();
  const calls=[],rd=AudioNode.prototype.disconnect,rc=AudioNode.prototype.connect;
  AudioNode.prototype.disconnect=function(to,...a){calls.push(['off',this,to]);return rd.apply(this,arguments);};AudioNode.prototype.connect=function(to,...a){calls.push(['on',this,to]);return rc.apply(this,arguments);};
  try{finalEffectInputState=null;configureFinalEffectInputs(false,false,false);for(const [from,to] of [[finalDelayWetGain,finalFxOutput],[finalDelayFeedbackLowpass,finalDelayNode],[finalReverbWetGain,finalFxOutput]])if(!calls.some(([op,a,b])=>op==='off'&&a===from&&b===to)||calls.some(([op,a,b])=>op==='on'&&a===from&&b===to))throw Error('final bypass return still connected');
   configureFinalEffectInputs(true,true,false);for(const [from,to] of [[finalDelayWetGain,finalFxOutput],[finalReverbWetGain,finalFxOutput]])if(!calls.some(([op,a,b])=>op==='on'&&a===from&&b===to))throw Error('final enable failed');configureFinalEffectInputs(false,false,false);
   const vocalDest=audioContext.createGain();vocalDest.connect(audioContext.destination);ensureBastardLoopMFxBus(vocalDest);ensureBastardLoopMPlusFxBus(vocalDest);
   if(bastardLoopMRoomReverbConvolverNode.buffer||bastardLoopMPlusRoomReverbConvolverNode.buffer)throw Error('idle vocal hall allocated');
   for(const [from,to] of [[bastardLoopMFxInputGainNode,bastardLoopMDelaySendGainNode],[bastardLoopMPlusFxInputGainNode,bastardLoopMPlusDelaySendGainNode]])if(!calls.some(([op,a,b])=>op==='off'&&a===from&&b===to))throw Error('legacy vocal effect feed still connected');destroyBastardLoopMFxBus();destroyBastardLoopMPlusFxBus();vocalDest.disconnect();
   const state=captureDrumSendFxState();state.delay.enabled=false;state.reverb.enabled=false;const ctx=new OfflineAudioContext(2,128,48000),g=createDrumSendFxGraph(ctx,ctx.destination,state,120);for(const [from,to] of [[g.delayTone,g.returnTrim],[g.feedbackLowpass,g.delay],[g.reverbWet,g.returnTrim]])if(!calls.some(([op,a,b])=>op==='off'&&a===from&&b===to))throw Error('drum bypass not disconnected');g.disposed=true;cancelDrumSendImpulseBuild(g);for(const n of g.nodes)n.disconnect();
  }finally{AudioNode.prototype.disconnect=rd;AudioNode.prototype.connect=rc;}

  const wasp=MygrainWasp.normalize();wasp.enabled=true;await mygrainWasp.restore(wasp);const running=mygrainWasp.diagnostics();wasp.enabled=false;await mygrainWasp.restore(wasp);await new Promise(r=>setTimeout(r,100));
  const canvas=SOURCE_LOOP_CONTROL_DEFINITIONS.map(x=>getSourceSlotConfig(x.kind).canvas).find(Boolean),kind=SOURCE_LOOP_CONTROL_DEFINITIONS.find(x=>getSourceSlotConfig(x.kind).canvas===canvas).kind;
  let draws=0;const ctx=canvas.getContext('2d'),original=ctx.fillRect;ctx.fillRect=function(...args){draws++;return original.apply(this,args);};const old=canvas.style.display;canvas.style.display='none';await new Promise(r=>setTimeout(r,100));drawSourceWaveform(kind);const hiddenDraws=draws;canvas.style.display=old;canvas.scrollIntoView();await new Promise(r=>setTimeout(r,200));const visibleDraws=draws;ctx.fillRect=original;
  return{off,on,checkboxCount,running,stopped:mygrainWasp.diagnostics(),hiddenDraws,visibleDraws,overflow:document.documentElement.scrollWidth>innerWidth+1};
 });
 assert.equal(ui.off,false);assert(ui.on);assert.equal(ui.checkboxCount,28);assert(ui.running.processors>0);assert.equal(ui.stopped.processors,0);assert.equal(ui.hiddenDraws,0);assert(ui.visibleDraws>0);assert.equal(ui.overflow,false);assert.deepEqual(errors,[]);results.push({engine,phone,result,ui});console.log('PASS',engine,phone?'phone':'desktop',JSON.stringify({result,ui}));await context.close();
 }finally{await browser.close();}}
 fs.writeFileSync('/root/.openclaw/workspace/output/fx-idle-20261027/browser.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
