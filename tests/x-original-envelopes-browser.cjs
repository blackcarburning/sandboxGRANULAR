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
    if (process.env.BASELINE && ['/mygrain/','/mygrain/index.html'].includes(u.pathname)) return r.fulfill({contentType:'text/html',body:fs.readFileSync(process.env.BASELINE,'utf8')});
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




const originalFunctions=require('./fixtures/x-original-envelopes.json').functions;
const original=await p.evaluate(src=>Object.fromEntries(Object.entries(src).map(([name,text])=>[name,typeof new Function('return ('+text+')')()])) ,originalFunctions);assert.equal(original.scheduleBastardLoopXSingleVoice,'function');
const result=await p.evaluate(async(src)=>{
 stopAllPerformancePlayback({silent:true});stopModulationLoop();stopPerformanceMixerVuMeters();window.mygrainXDebug.setEnabled(false);
 const old=Object.fromEntries(Object.entries(src).map(([name,text])=>[name,new Function('return ('+text+')')()]));
 const cases=[
  {kind:'sequence',rate:1}, {kind:'sequence',rate:4,seconds:.015,attack:.09},
  {kind:'sequence',rate:.25,decay:1}, {kind:'sequence',rate:1,next:4,seconds:.8},
  {kind:'sequence',rate:4,next:.25,seconds:.1}, {kind:'sequence',rate:1,stepWindow:.025,decay:.1},
  {kind:'preview',rate:1}, {kind:'preview',rate:4,seconds:.015},
  {kind:'preview',rate:.25,decay:1}, {kind:'preview',rate:1,keyHold:true},
  {kind:'preview',rate:4,keyHold:true}, {kind:'sequence',rate:1,attack:.15,length:1.5,decay:1}
 ];
 const output=[];
 for(const sr of [44100,48000])for(const spec of cases){
  async function render(baseline){
   const ctx=new OfflineAudioContext(1,sr*6,sr);audioContext=ctx;
   const seconds=spec.seconds||.3;const buffer=ctx.createBuffer(1,Math.round(sr*seconds),sr),d=buffer.getChannelData(0);
   for(let i=0;i<d.length;i++)d[i]=.21*Math.sin(2*Math.PI*110*i/sr)+.07;
   bastardLoopXSampleBuffer=buffer;
   isBastardLoopXUsingSynth=()=>false;getBastardLoopXLevelValue=()=>.6;getBastardLoopXAuditionLevel=()=>.54;
   ensureBastardLoopXDelayBus=()=>ctx.destination;createBastardLoopConfigurableFilters=()=>[];
   getBastardLoopXPitchRatioForNote=note=>note==='D4'?spec.next:spec.rate;
   getBastardLoopXSampleRegion=()=>({start:0,end:buffer.duration});getBastardLoopXAttackSeconds=()=>spec.attack||.02;
   getBastardLoopXStartTrimRatio=()=>0;getBastardLoopXStepLengthRatio=()=>spec.length||.65;getBastardLoopXDecayRatio=()=>spec.decay||.6;
   const step={note:'C4',slide:!!spec.next};
   if(spec.kind==='preview')(baseline?old.previewBastardLoopXStep:previewBastardLoopXStep)(step,{keyHold:spec.keyHold?{}:undefined});
   else(baseline?old.scheduleBastardLoopXSingleVoice:scheduleBastardLoopXSingleVoice)(step,.05,.125,spec.next?{note:'D4'}:null,{stepWindow:spec.stepWindow});
   const b=await ctx.startRendering();return b.getChannelData(0);
  }
  const before=await render(true),after=await render(false);let maxDifference=0,peak=0;
  for(let i=0;i<before.length;i++){if(!Number.isFinite(after[i]))throw Error('Non-finite audio');maxDifference=Math.max(maxDifference,Math.abs(after[i]-before[i]));peak=Math.max(peak,Math.abs(after[i]));}
  if(maxDifference!==0)throw Error('Original envelope mismatch: '+JSON.stringify({sr,spec,maxDifference}));
  output.push({sr,...spec,maxDifference,peak});
 }
 return output;
},originalFunctions);
assert.equal(result.length,24);assert(result.every(r=>r.maxDifference===0&&r.peak>.001));
console.log(engine,JSON.stringify({cases:result.length,maxDifference:Math.max(...result.map(r=>r.maxDifference))}));results.push({engine,cases:result});assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}
fs.writeFileSync((process.env.MYGRAIN_AUDIO_EVIDENCE||'/tmp')+'/x-original-envelope-comparison.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
