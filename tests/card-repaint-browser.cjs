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
 stopAllPerformancePlayback({silent:true});stopModulationLoop();stopPerformanceMixerVuMeters();window.mygrainXDebug.setEnabled(false);
 let refreshes=0;const originalSync=syncPerformanceControlState;
 syncPerformanceControlState=function(...args){refreshes++;return originalSync.apply(this,args)};
 const observer=new MutationObserver(()=>{});observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
 const noteRun=(enabled,role,destination)=>{
  stopAllOscillators();oscillatorsEnabled=enabled;observer.takeRecords();refreshes=0;
  const before=activeOscVoices.size,start=performance.now();
  for(let i=0;i<8;i++)playOscillatorNote('C2',audioContext.currentTime+.35,1,{role,destination,voiceId:`audit:${role}:${i}`});
  return{refreshes,mutations:observer.takeRecords().length,ms:performance.now()-start,voicesCreated:activeOscVoices.size-before};
 };
 const muted=noteRun(false,'sequencer');
 const audible=noteRun(true,'sequencer');
 const qDestination=audioContext.createGain();qDestination.connect(audioContext.destination);
 const independentQ=noteRun(false,'q:audit',qDestination);
 stopAllOscillators();qDestination.disconnect();observer.disconnect();syncPerformanceControlState=originalSync;
 const idle={};
 for(const lane of ['L','X']){
  eval(`bastardLoop${lane}SampleBuffer=audioContext.createBuffer(1,44100,44100);bastardLoop${lane}SourceMode='sample';openBastardLoop${lane}Overlay()`);
  const normalize=window[`normalizeBastardLoop${lane}Step`];let normalizations=0;
  window[`normalizeBastardLoop${lane}Step`]=(...a)=>{normalizations++;return normalize(...a)};
  const obs=new MutationObserver(()=>{});obs.observe(document.getElementById(`bastardLoop${lane}Overlay`),{subtree:true,childList:true,attributes:true,characterData:true});
  eval(`bastardLoop${lane}TransportActive=true;bastardLoop${lane}NextStepTime=audioContext.currentTime+10`);
  const start=performance.now();for(let i=0;i<125;i++)window[`scheduleBastardLoop${lane}Steps`]();
  idle[lane]={normalizations,mutations:obs.takeRecords().length,ms:performance.now()-start};
  obs.disconnect();window[`normalizeBastardLoop${lane}Step`]=normalize;window[`stopBastardLoop${lane}`]();window[`closeBastardLoop${lane}Overlay`]();
 }
 return{muted,audible,independentQ,idle};
});
if(!process.env.BASELINE){
 for(const name of ['muted','audible','independentQ'])assert.equal(result[name].refreshes,0,`${name}: no global GUI refresh from notes`);
 assert.equal(result.muted.mutations,0);assert.equal(result.muted.voicesCreated,0);
 assert.equal(result.audible.voicesCreated,8);assert.equal(result.independentQ.voicesCreated,8);
 for(const lane of ['L','X']){assert.equal(result.idle[lane].normalizations,0);assert.equal(result.idle[lane].mutations,0);}
}
console.log(engine,JSON.stringify(result));results.push({engine,...result});assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}
fs.writeFileSync((process.env.MYGRAIN_AUDIO_EVIDENCE||'/tmp')+'/'+(process.env.BASELINE?'baseline':'fixed')+'-card-repaint.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
