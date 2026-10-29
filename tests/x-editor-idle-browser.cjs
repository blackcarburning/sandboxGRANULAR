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



const result=await p.evaluate(async()=>{
 stopAllPerformancePlayback({silent:true});stopModulationLoop();stopPerformanceMixerVuMeters();bastardLoopXSampleBuffer=audioContext.createBuffer(1,44100,44100);openBastardLoopXOverlay();
 let normalizations=0,mutations=0;const original=normalizeBastardLoopXStep;normalizeBastardLoopXStep=(...a)=>{normalizations++;return original(...a)};
 const observer=new MutationObserver(records=>mutations+=records.length);observer.observe(document.getElementById('bastardLoopXOverlay'),{subtree:true,childList:true,attributes:true,characterData:true});
 bastardLoopXTransportActive=true;bastardLoopXNextStepTime=audioContext.currentTime+10;
 const start=performance.now();for(let i=0;i<125;i++)scheduleBastardLoopXSteps();const elapsed=performance.now()-start;
 await new Promise(r=>setTimeout(r,20));observer.disconnect();normalizeBastardLoopXStep=original;stopBastardLoopX();return{normalizations,mutations,elapsed};
});assert.equal(result.normalizations,0);assert.equal(result.mutations,0);assert.equal(await p.evaluate(()=>window.mygrainXDebug.enabled),false);console.log(engine,result);results.push({engine,...result});assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}
fs.writeFileSync((process.env.MYGRAIN_AUDIO_EVIDENCE || '/tmp')+'/x-ui-work.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
