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



const result=await p.evaluate(async()=>{
 stopAllPerformancePlayback({silent:true});stopModulationLoop();stopPerformanceMixerVuMeters();window.mygrainXDebug.setEnabled(false);loopLayerSolo=[];
 const buffer=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate);
 const data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=.03*Math.sin(2*Math.PI*110*i/buffer.sampleRate);
 const suffixes=['','2','3','V','W','P','O','M','MPlus'];const starts={};
 for(const suffix of suffixes){
  eval(`bastardLoop${suffix}Buffer=buffer;bastardLoop${suffix}Enabled=true`);
  eval(`bastardLoop${suffix}Level=.35`);
  const slider=document.getElementById(`performanceBastardLoop${suffix}Level`);if(slider)slider.value='35';
  starts[suffix||'A']=window[`startBastardLoop${suffix}`](audioContext.currentTime+.2,{skipUi:true});
 }
 const sources=suffixes.map(s=>eval(`bastardLoop${s}Source`));
 let refreshes=0;const original=syncPerformanceControlState;syncPerformanceControlState=(...a)=>{refreshes++;return original(...a)};
 oscillatorsEnabled=false;seqGrainsEnabled=false;sequencerSteps.forEach(s=>s.enabled=true);startSequencer(audioContext.currentTime+.2,{force:true});
 await new Promise(r=>setTimeout(r,1600));
 const stable=suffixes.map((s,i)=>({lane:s||'A',sameSource:eval(`bastardLoop${s}Source`)===sources[i],loop:sources[i]?.loop,rate:sources[i]?.playbackRate.value}));
 syncPerformanceControlState=original;stopAllPerformancePlayback({silent:true});return{starts,stable,refreshes};
});
for(const [lane,started]of Object.entries(result.starts))assert.equal(started,true,`${lane} source starts`);
for(const entry of result.stable){assert.equal(entry.sameSource,true,`${entry.lane} no unsolicited source restart`);assert.equal(entry.loop,true);assert(entry.rate>0);}
assert.equal(result.refreshes,0,'No per-note whole-card refresh while other loops run');
console.log(engine,JSON.stringify(result));results.push({engine,...result});assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}
fs.writeFileSync((process.env.MYGRAIN_AUDIO_EVIDENCE||'/tmp')+'/other-loop-playback.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
