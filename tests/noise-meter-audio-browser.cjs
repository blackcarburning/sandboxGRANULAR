// Legacy granular-noise fallback regression (N primary DSP is covered by noise-n-browser.cjs).
// Read-only native audio regression: API writes and off-origin requests are blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');

(async () => {
 const results = [];
 for (const [engine, type] of Object.entries({ chromium, webkit })) {
  const b = await type.launch(engine === 'chromium'
   ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {});
  try {
   const c = await b.newContext(), p = await c.newPage(), errors = [];
   p.on('pageerror', e => errors.push(e.message));
   await p.route('**/*', r => {
    const req = r.request(), u = new URL(req.url());
    if (u.origin !== 'https://openclaw.blackcarburning.com' || !['GET', 'HEAD'].includes(req.method())) return r.abort();
    if (u.pathname.endsWith('/account-context.js')) return r.fulfill({
     contentType: 'text/javascript', body: 'window.mygrainAccountContext={user:{username:"audio-regression-readonly"}}'
    });
    if (u.pathname.includes('/api/')) return r.fulfill({ json: {
     ok: true, authenticated: true, user: { username: 'audio-regression-readonly' },
     files: [], songs: [], folders: [], stations: [], samples: [], favourites: [], patches: []
    }});
    return r.continue();
   });
   await p.goto('https://openclaw.blackcarburning.com/mygrain/');
   await p.waitForFunction(() => window.mygrainWEffects && document.documentElement.dataset.mygrainStartup === 'ready');
   await p.locator('#start-btn').click();
   await p.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended);



// Real control event paths and durable state, using disposable browser storage.
const controls=await p.evaluate(()=>{
 stopAllPerformancePlayback({silent:true});
 const slider=document.getElementById('performanceNoiseLevel');
 for(const value of [0,20,75,100]) {slider.value=value;slider.dispatchEvent(new Event('input',{bubbles:true})); if(+document.getElementById('noiseMix').value!==value)throw Error('Mixer sync '+value);}
 document.getElementById('noiseMix').value='83';document.getElementById('noiseMix').dispatchEvent(new Event('input',{bubbles:true}));
 if(+slider.value!==83)throw Error('Reverse sync');
 saveState();const saved=JSON.parse(localStorage.getItem(STATE_STORAGE_KEY));
 return{max:slider.max,noise:saved.sliders.noiseMix,type:saved.selects.noiseType};
});assert.equal(controls.max,'100');assert.equal(+controls.noise,83);assert.equal(controls.type,'pink');
await p.reload();await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!stateSaveSuspended);
assert.equal(await p.locator('#performanceNoiseLevel').inputValue(),'83');
for(const sr of [44100,48000]) {
 const result=await p.evaluate(async sr=>{
 stopAllPerformancePlayback({silent:true});stopPerformanceMixerVuMeters();
 const online=audioContext,output=granularOutputGain,meter=granularNoiseMeterGain,noiseN=window.mygrainNoise;window.mygrainNoise=null;
 const white=whiteNoiseBuffer,pink=pinkNoiseBuffer,a=grainASampleBuffer,bb=grainBSampleBuffer;
 const random=Math.random;Math.random=()=>.5;
 clearAllPerformanceSoloStates({silent:true,skipSave:true});
 for(const[id,value]of Object.entries({grainASampleLoopStart:0,grainASampleLoopEnd:100,grainAMicGrainPosition:0,grainAMicGrainScale:100,grainAMicGrainAttackScale:100,grainAMicGrainReleaseScale:100,grainAMicGrainLevel:100,panSpread:0,grainMixerAmp:70})) {clearModulationForParam(id);document.getElementById(id).value=String(value);}
 document.getElementById('noiseType').value='pink';keyboardVolumeBias=0;
 const config=PERFORMANCE_MIXER_VU_CHANNELS.find(v=>v.controlId==='performanceNoiseLevel');
 if(config.getNode()!==granularNoiseMeterGain)throw Error('Wrong meter source');
 async function render(mix,withMeter=true,busLevel=.63,decay=false){
 const ctx=new OfflineAudioContext(2,sr,sr);audioContext=ctx;
 granularOutputGain=ctx.createGain();granularOutputGain.gain.value=busLevel;
 granularNoiseMeterGain=withMeter?ctx.createGain():null;if(withMeter)granularNoiseMeterGain.gain.value=busLevel;
 const merger=ctx.createChannelMerger(2);granularOutputGain.connect(merger,0,0);if(withMeter)granularNoiseMeterGain.connect(merger,0,1);merger.connect(ctx.destination);
 const buf=ctx.createBuffer(1,sr,sr);for(let i=0;i<sr;i++)buf.getChannelData(0)[i]=.2*Math.sin(i*.197)+.1*Math.sin(i*.431);
 pinkNoiseBuffer=buf;whiteNoiseBuffer=buf;grainASampleBuffer=buf;grainBSampleBuffer=buf;
 document.getElementById('noiseMix').value=String(mix);
 playGrain('C2',.04,1,{role:'noise-regression',...(decay?{keyboardDecaySeconds:.2,keyboardDecayStart:.04}:{}),layerSettings:[{key:'A',sourceMode:'grainASample',sizeSeconds:.1,startPct:0,pitchRatio:1,preserveDuration:true,attackSeconds:.01,decaySeconds:.06,releaseSeconds:.08,blend:.3,smoothing:.4,width:0,panBias:0,jitterSeconds:0,volume:.4}]});
 const b=await ctx.startRendering();return{main:Array.from(b.getChannelData(0)),meter:Array.from(b.getChannelData(1)),remaining:getConcurrentGrainSourceCount()};
 }
 try{
 const out=[];
 for(const mix of [0,20,100])for(const decay of [false,true]){
 const tapped=await render(mix,true,.63,decay),untapped=await render(mix,false,.63,decay);
 let energy=0,meterEnergy=0,delta=0,noiseDelta=0;
 for(let i=0;i<sr;i++){energy+=tapped.main[i]**2;meterEnergy+=tapped.meter[i]**2;delta=Math.max(delta,Math.abs(tapped.main[i]-untapped.main[i]));noiseDelta=Math.max(noiseDelta,Math.abs(tapped.main[i]-tapped.meter[i]));}
 out.push({mix,decay,rms:Math.sqrt(energy/sr),meterRms:Math.sqrt(meterEnergy/sr),audibleDelta:delta,noiseOnlyDelta:noiseDelta,remaining:tapped.remaining});
 }
 const muted=await render(100,true,0);return{sr,cases:out,mutedPeak:Math.max(...muted.meter.map(Math.abs))};
 }finally{window.mygrainNoise=noiseN;Math.random=random;audioContext=online;granularOutputGain=output;granularNoiseMeterGain=meter;whiteNoiseBuffer=white;pinkNoiseBuffer=pink;grainASampleBuffer=a;grainBSampleBuffer=bb;}
 },sr);
 for(const x of result.cases){assert(x.rms>.0001);assert.equal(x.audibleDelta,0);assert.equal(x.remaining,0);if(x.mix===0)assert.equal(x.meterRms,0);else assert(x.meterRms>.0001);if(x.mix===100)assert(x.noiseOnlyDelta<1e-7);}
 assert.equal(result.mutedPeak,0);console.log(engine,JSON.stringify(result));results.push({engine,controls,...result});
}
assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}
fs.writeFileSync((process.env.MYGRAIN_AUDIO_EVIDENCE || '/tmp')+'/noise-results.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
