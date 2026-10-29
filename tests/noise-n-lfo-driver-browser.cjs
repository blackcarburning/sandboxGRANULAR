'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'https://openclaw.blackcarburning.com/mygrain/';
const out=process.env.MYGRAIN_N_EVIDENCE||'/tmp/mygrain-noise-lfo-driver';fs.mkdirSync(out,{recursive:true});
(async()=>{const results=[];for(const[engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(60000);
 await page.route('**/*',route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==new URL(base).origin||!['GET','HEAD'].includes(req.method()))return route.abort();if(u.pathname.endsWith('/account-context.js'))return route.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"n-lfo-driver-fixture"}};'});if(u.pathname.includes('/api/'))return route.fulfill({json:{ok:true,authenticated:true,user:{username:'n-lfo-driver-fixture'},files:[],songs:[],folders:[],samples:[],patches:[]}});return route.continue()});
 await page.goto(base);await page.waitForFunction(()=>window.mygrainNoise&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.click('#start-btn');await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});setSliderValue('performanceModAmount',100);setSliderValue('lfoDepth',100);setSliderValue('lfo2Depth',100);setSliderValue('lfoRate',120);setSliderValue('lfo2Rate',120);for(const n of [1,2,3])setLfoRouteState('noiseMix',n,false);mygrainNoise.restore({...mygrainNoise.settings(),enabled:true,level:20,filterEnabled:false,source:'L3'});mygrainNoise.start()});
 const volume=[];
 async function measure(){return page.evaluate(async()=>{const a=audioContext.createAnalyser();a.fftSize=1024;mygrainNoise.graph.gain.connect(a);const data=new Float32Array(1024),gains=[],rms=[];for(let i=0;i<24;i++){await new Promise(r=>setTimeout(r,60));a.getFloatTimeDomainData(data);rms.push(Math.sqrt(data.reduce((s,x)=>s+x*x,0)/data.length));gains.push(mygrainNoise.graph.gain.gain.value)}mygrainNoise.graph.gain.disconnect(a);return{minGain:Math.min(...gains),maxGain:Math.max(...gains),minRms:Math.min(...rms),maxRms:Math.max(...rms),enabled:mygrainNoise.settings().enabled,source:mygrainNoise.settings().source}})}
 for(const n of [1,2]){await page.locator(`.lfo-toggle[data-param="noiseMix"][data-lfo="${n}"]`).click();await page.locator('#noiseMix').fill('0');await page.waitForTimeout(150);const moving=await measure();assert(moving.enabled);assert(moving.maxGain-moving.minGain>.015,JSON.stringify(moving));assert(moving.maxRms>.003,JSON.stringify(moving));assert.equal(moving.source,'L3');
 const inversion=await page.evaluate(n=>{stopModulationLoop();const now=audioContext.currentTime,normal=withModulationEvaluationTime(now,()=>getModulatedValue('noiseMix'));document.querySelector(`.inv-toggle[data-param="noiseMix"][data-lfo="${n}"]`).click();const inverted=withModulationEvaluationTime(now,()=>getModulatedValue('noiseMix'));return{normal,inverted}},n);assert(inversion.normal+inversion.inverted>0);assert(Math.min(inversion.normal,inversion.inverted)<1e-7);await page.evaluate(()=>startModulationLoop());
 await page.locator(`.lfo-toggle[data-param="noiseMix"][data-lfo="${n}"]`).click();await page.waitForTimeout(180);const silent=await measure();assert.equal(silent.enabled,false);assert(silent.maxRms<1e-6,JSON.stringify(silent));volume.push({lfo:n,moving,inversion,silent});}
 const drivers=await page.evaluate(()=>{
  stopAllPerformancePlayback({silent:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});
  const buf=audioContext.createBuffer(1,4800,48000);buf.getChannelData(0).fill(.2);
  bastardLoopBuffer=buf;bastardLoop2Buffer=buf;bastardLoop3Buffer=null;bastardLoopVBuffer=null;bastardLoopWBuffer=null;bastardLoopPBuffer=null;bastardLoopOBuffer=null;generatedLoopBuffer=null;dropboxSampleLayerBuffer=null;
  drumMachineKickBuffer=buf;drumMachineSnareBuffer=buf;drumMachineHatBuffer=null;drumMachinePercBuffer=null;
  drumMachineKickPattern=[true,false];drumMachineSnarePattern=[false,false];drumMachineRoll.pattern=[false,false];
  for(const track of Object.values(drumMachineExtraTracks)){track.buffer=null;track.pattern=[false,false]}
  SPARSE_RANDOM_LAYER_DEFINITIONS.forEach(l=>l.setEnabled(false,{silent:true,skipSave:true}));setDrumMachineEnabled(false,{silent:true,skipSave:true});
  mygrainNoise.restore({...mygrainNoise.settings(),enabled:true,level:20,source:'B'});
  setBastardLoopEnabled(true,{silent:true,skipSave:true});setSliderValue('performanceBastardLoopLevel',50);
  setSliderValue('performanceBastardLoop2Level',50);
  let candidates=mygrainNoise.mixDriverSources();if(!candidates.includes('A')||candidates.includes('B')||candidates.some(k=>k.startsWith('drum')))throw Error('Muted candidates '+candidates);
  setSliderValue('performanceBastardLoopLevel',0);const zero=mygrainNoise.mixDriverSources();if(zero.includes('A'))throw Error('Zero A included');
  setSliderValue('performanceBastardLoopLevel',50);setDrumMachineEnabled(true,{silent:true,skipSave:true});setSliderValue('performanceDrumMachineLevel',40);setSliderValue('drumMachineKickLevel',80);setSliderValue('drumMachineSnareLevel',80);
  const drumCandidates=mygrainNoise.mixDriverSources();if(!drumCandidates.includes('drumKick')||drumCandidates.includes('drumSnare'))throw Error('Empty-pattern track '+drumCandidates);
  setSliderValue('drumMachineKickLevel',0);const zeroKick=mygrainNoise.mixDriverSources();if(zeroKick.includes('drumKick')||zeroKick.includes('drums'))throw Error('Zero kick included');
  const originalChooser=chooseSparseRandomLayerSelection,originalRandom=Math.random,arrangements=[];
  try{
   for(const megaMode of [false,true])for(let i=0;i<20;i++){
    const active=i%2?'bastarda':'bastardb';
    chooseSparseRandomLayerSelection=()=>SPARSE_RANDOM_LAYER_DEFINITIONS.filter(l=>['noise','bastardx',active].includes(l.key));
    mygrainNoise.restore({...mygrainNoise.settings(),enabled:true,level:20,source:i%2?'B':'A'});
    Math.random=()=>.99999;const selected=applySparseRandomLayerSelection({silent:true,megaMode});
    const source=mygrainNoise.settings().source,allowed=active==='bastarda'?'A':'B';
    if(!['L1','L2','L3',allowed,'X'].includes(source))throw Error('Final muted driver '+source+' '+active);
    // Last eligible source must be the one still enabled after all final mutes.
    if(source!==allowed)throw Error('Driver was not resolved against final gates: '+source+' expected '+allowed);
    arrangements.push({megaMode,source,keys:selected.map(l=>l.key)});
   }
  }finally{chooseSparseRandomLayerSelection=originalChooser;Math.random=originalRandom}
  setBastardLoopEnabled(false,{silent:true,skipSave:true});setBastardLoop2Enabled(false,{silent:true,skipSave:true});setBastardLoopXEnabled(false,{silent:true,skipSave:true});
  const fallback=mygrainNoise.mixDriverSources();if(fallback.some(k=>!/^L[123]$/.test(k)))throw Error('Non-LFO fallback '+fallback);
  const sources=new Set();for(let i=0;i<30;i++)sources.add(mygrainNoise.randomiseMixDriver());
  const preset=gatherPreset(),expected=mygrainNoise.settings();mygrainNoise.restore({...expected,source:'manual'});applyPreset(preset);if(mygrainNoise.settings().source!==expected.source)throw Error('Driver recall');
  return{candidates,zero,drumCandidates,zeroKick,arrangements,fallback,sources:[...sources]};
 });
 assert.deepEqual(errors,[]);results.push({engine,volume,drivers,errors});console.log('PASS',engine,JSON.stringify({volume,arrangements:drivers.arrangements.length,fallback:drivers.fallback}));await context.close();
 }finally{await browser.close()}
}fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
