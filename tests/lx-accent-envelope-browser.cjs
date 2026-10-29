'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'https://openclaw.blackcarburning.com/mygrain/',out=process.env.MYGRAIN_N_EVIDENCE||'/tmp/mygrain-lx-accent';fs.mkdirSync(out,{recursive:true});
(async()=>{const results=[];for(const[engine,type]of Object.entries({chromium,webkit})){
const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
try{const c=await browser.newContext(),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(60000);await p.route('**/*',r=>{const req=r.request(),u=new URL(req.url());if(u.origin!==new URL(base).origin||!['GET','HEAD'].includes(req.method()))return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"n-space-fixture"}};'});if(u.pathname.includes('/api/'))return r.fulfill({json:{ok:true,authenticated:true,user:{username:'n-space-fixture'},files:[],songs:[],folders:[],samples:[],patches:[]}});return r.continue()});
await p.goto(base);await p.waitForFunction(()=>window.mygrainNoise&&window.mygrainLoopFx&&document.documentElement.dataset.mygrainStartup==='ready');await p.click('#start-btn');await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);

const wiring=await p.evaluate(()=>{
 stopAllPerformancePlayback({silent:true});stopModulationLoop();stopPerformanceMixerVuMeters();clearAllPerformanceSoloStates({silent:true,skipSave:true});
 const state=mygrainLoopFx.settings();for(const key of ['L','X'])Object.assign(state.channels[key],{filterEnabled:true,filterType:'lowpass',cutoff:900,lfoDepth:0,room:0,delay:0});mygrainLoopFx.restore(state);
 const b=audioContext.createBuffer(1,48000,48000);for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=.1*Math.sin(i*2*Math.PI*2500/48000);
 bastardLoopLSampleBuffer=b;bastardLoopXSampleBuffer=b;bastardLoopLEnabled=true;bastardLoopXEnabled=true;setBastardLoopLSourceMode('sample',{silent:true,skipSave:true});setBastardLoopXSourceMode('sample',{silent:true,skipSave:true});setBastardLoopLLevelPercent(50,{skipSave:true});setBastardLoopXLevelPercent(50,{skipSave:true});setSliderValue('performanceBastardLoopLFilterEnvelope',0);setSliderValue('performanceBastardLoopXFilterEnvelope',0);setSliderValue('bastardLoopXAccentAmount',100);
 const calls=[];
 function spy(g,key){if(g.accentSpy)return;g.accentSpy=true;const fn=g.triggerEnvelope;g.triggerEnvelope=function(...args){calls.push({key,args});return fn(...args)}}
 scheduleBastardLoopLSingleVoice({note:'C4'},audioContext.currentTime+.1,.1,null);scheduleBastardLoopXSingleVoice({note:'C4'},audioContext.currentTime+.1,.1,null);
 for(const g of mygrainLoopFx.groups)spy(g.graph,g.key);
 try{
  for(const key of ['L','X']){
   const scheduler=key==='L'?scheduleBastardLoopLSingleVoice:scheduleBastardLoopXSingleVoice;
   const time=audioContext.currentTime+.2;scheduler({note:'C4',accent:false},time,.2,null);scheduler({note:'C4',accent:true},time+.3,.2,null);
  }
  const sample=calls.slice();if(sample.length!==4||sample[0].args[2]!==0||sample[1].args[2]<2300||sample[2].args[2]!==0||sample[3].args[2]<2300)throw Error('Sample envelopes '+JSON.stringify(sample));
  for(const g of mygrainLoopFx.groups)if(['L','X'].includes(g.key))spy(g.graph,g.key);
  const velocity=[],original=playOscillatorNote;playOscillatorNote=function(note,time,v,options){velocity.push({role:options.role,v});return original(note,time,v,options)};
  try{
   ensureBastardLoopLSynthReady({forceMinimumMix:true});playBastardLoopLSynthVoice({note:'C4'},audioContext.currentTime+.1,.1,null);playBastardLoopXSynthVoice({note:'C4'},audioContext.currentTime+.1,.1,null);for(const g of mygrainLoopFx.groups)spy(g.graph,g.key);calls.length=0;velocity.length=0;const time=audioContext.currentTime+.8;
   const a=playBastardLoopLSynthVoice({note:'C4',accent:true},time,.2,null);
   const x=playBastardLoopXSynthVoice({note:'C4',accent:false},time+.3,.2,null);
   const y=playBastardLoopXSynthVoice({note:'C4',accent:true},time+.6,.2,null);
   if(!a||!x||!y)throw Error('Synth setup');
   const synth=[...new Map(calls.map(c=>[c.key+':'+c.args[0],c])).values()];if(synth.length!==3||synth[0].args[2]<2300||synth[1].args[2]!==0||synth[2].args[2]<2300)throw Error('Synth envelopes '+JSON.stringify(synth));
   const xs=velocity.filter(v=>v.role==='bastardloopx');if(xs.length!==2||xs[0].v!==xs[1].v)throw Error('X accent changed gain '+JSON.stringify(xs));
   setSliderValue('performanceBastardLoopXFilterEnvelope',50);setSliderValue('bastardLoopXAccentAmount',-100);const reduced=getBastardLoopXFilterEnvelopeAmountForStep({accent:true}),normal=getBastardLoopXFilterEnvelopeAmountForStep({accent:false});if(reduced!==0||normal!==.5)throw Error('Negative accent');
   return{sample,synth,velocity,reduced,normal};
  }finally{playOscillatorNote=original}
 }finally{stopAllPerformancePlayback({silent:true})}
});
const audio=await p.evaluate(async()=>{
 async function render(envelope,lfo=0){const sr=48000,ctx=new OfflineAudioContext(1,sr,sr),g=MygrainLoopFx.createGraph(ctx,ctx.destination,{...MygrainLoopFx.defaults(),filterEnabled:true,filterSlope:48,cutoff:900,lfoDepth:lfo,lfoBeats:4,room:0,delay:0},120),s=ctx.createOscillator();s.frequency.value=2500;s.connect(g.input);s.start(0);s.stop(.8);if(envelope)g.triggerEnvelope(.15,.5,2400,1);if(envelope===2)g.triggerEnvelope(.35,.25,1200,1);const b=await ctx.startRendering(),d=b.getChannelData(0);let attack=0,tail=0;for(let i=0;i<d.length;i++){const t=i/sr;if(t>.18&&t<.25)attack+=d[i]**2;if(t>.70&&t<.78)tail+=d[i]**2}g.dispose();return{attack,tail}}
 async function drum(accent){const sr=48000,ctx=new OfflineAudioContext(1,sr,sr),o=ctx.createOscillator();o.frequency.value=2500;MygrainDrumTone.connect(ctx,o,ctx.destination,{cutoff:50,envAmount:.8,accent,start:.15,duration:.5});o.start(.15);o.stop(.8);const b=await ctx.startRendering(),d=b.getChannelData(0);let energy=0;for(let i=Math.floor(sr*.18);i<sr*.25;i++)energy+=d[i]**2;return energy}
 return{plain:await render(false),accent:await render(true),retrigger:await render(2),withLfo:await render(true,.2),drumPlain:await drum(false),drumAccent:await drum(true)};
});assert(audio.accent.attack>audio.plain.attack*100,JSON.stringify(audio));assert(audio.accent.tail<audio.accent.attack/100,JSON.stringify(audio));assert(audio.withLfo.attack>audio.plain.attack*10,JSON.stringify(audio));assert(Math.abs(audio.accent.attack-audio.retrigger.attack)/audio.accent.attack<1e-6,JSON.stringify(audio));assert(audio.drumAccent>audio.drumPlain*100,JSON.stringify(audio));
for(const key of ['L','X']){assert.equal(await p.locator(`[data-loop-fx-key="${key}"] #performanceBastardLoop${key}FilterEnvelope`).count(),1)}
assert.deepEqual(errors,[]);results.push({engine,wiring,audio,errors});console.log('PASS',engine,JSON.stringify({audio,wiring}));await c.close();}finally{await browser.close()}}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
