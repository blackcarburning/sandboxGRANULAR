'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:18983/mygrain/';
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{
  const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-d-loop'}})).status(),200);
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  if(engine==='webkit')await p.addInitScript(()=>{const N=window.AudioContext||window.webkitAudioContext;window.AudioContext=class extends N{constructor(o){super({...o,sampleRate:48000})}}});
  await p.goto(base);await p.waitForFunction(()=>window.mygrainD&&document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
  await p.evaluate(async()=>{
   stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});applyGlobalBpm(240);syncPatternLengthControls(8,{skipSave:true});
   const b=audioContext.createBuffer(1,audioContext.sampleRate,audioContext.sampleRate),a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=.2*Math.sin(2*Math.PI*220*i/b.sampleRate);
   await mygrainD.apply(b,'D resumption fixture');bastardLoopBuffer=b;setBastardLoopEnabled(true,{skipSave:true});
   mygrainD.restore({...mygrainD.settings(),enabled:true,cut:MygrainVocalCut.normalize(),speed:1});setLoopLayerSolo('bastardd',{skipSave:true});startAllBastardLoopLayers();
   window.dResumeMeter=audioContext.createAnalyser();dResumeMeter.fftSize=2048;preFilterGainNode.connect(dResumeMeter);
   window.dRms=()=>{const a=new Float32Array(2048);dResumeMeter.getFloatTimeDomainData(a);return Math.sqrt(a.reduce((n,x)=>n+x*x,0)/a.length)};
  });
  async function audible(){await p.waitForFunction(()=>!!mygrainD.source&&dRms()>1e-4)}
  await audible();
  for(let i=0;i<3;i++){
   await p.evaluate(()=>setLoopLayerSolo('bastarda',{skipSave:true}));assert(!await p.evaluate(()=>!!mygrainD.source));
   await p.evaluate(()=>setLoopLayerSolo('bastardd',{skipSave:true}));await audible();
   assert(await p.evaluate(()=>{const s=mygrainD.source;for(let j=0;j<10;j++)syncLoopLayerSoloButtons();return s===mygrainD.source}),'UI refresh must not replace a playing voice');
   await p.evaluate(()=>mygrainD.enable(false,{skipSave:true}));assert(!await p.evaluate(()=>!!mygrainD.source));
   await p.evaluate(()=>mygrainD.enable(true,{skipSave:true}));await audible();
   await p.evaluate(()=>mygrainD.restore(mygrainD.settings()));await audible();
   await p.evaluate(()=>stopBastardLoop({preserveTransportState:true,skipUi:true}));await audible();
  }
  await p.locator('#loopDSolo').scrollIntoViewIfNeeded();
  await p.locator('#loopDSolo').tap();await audible();
  await p.locator('#loopDSolo').tap();await audible();
  // An actual native ended event models an interrupted source, not a forced flag reset.
  await p.evaluate(()=>{window.dInterrupted=mygrainD.source;mygrainD.source.stop()});
  await p.waitForFunction(()=>mygrainD.source&&mygrainD.source!==dInterrupted&&dRms()>1e-4,{},{timeout:5000});
  assert(await p.evaluate(()=>{const s=mygrainD.source;for(let i=0;i<20;i++)mygrainD.checkCycle();return s===mygrainD.source}));
  // Muting and explicit Stop must remain authoritative beyond complete cycles.
  await p.evaluate(()=>setLoopLayerSolo('bastarda',{skipSave:true}));await p.waitForTimeout(1300);assert(!await p.evaluate(()=>!!mygrainD.source));
  await p.evaluate(()=>setLoopLayerSolo('bastardd',{skipSave:true}));await audible();
  await p.locator('#performanceMainStopAllBtn').scrollIntoViewIfNeeded();await p.locator('#performanceMainStopAllBtn').evaluate(b=>b.click());
  await p.evaluate(()=>{syncLoopLayerSoloButtons();mygrainD.checkCycle()});await p.waitForTimeout(1300);
  assert(await p.evaluate(()=>!mygrainD.source&&!bastardLoopPlaying&&dRms()<1e-5));
  await p.evaluate(()=>{startAllBastardLoopLayers()});await audible();
  // Running buffer replacement, tempo and length retain an audible D voice.
  await p.evaluate(async()=>{await mygrainD.apply(bastardLoopDBuffer,'replacement');applyGlobalBpm(180);syncPatternLengthControls(16,{skipSave:true})});await audible();
  await p.evaluate(()=>stopAllPerformancePlayback({silent:true}));assert.deepEqual(errors,[]);
  console.log('PASS',engine,'solo away/back, enable, restore, A-only teardown, stable voices, native-ended cycle recovery, muted/stopped silence and fresh Play');await c.close();
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exit(1)});
