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




await p.locator('#performanceNoiseLevel').scrollIntoViewIfNeeded();
const result=await p.evaluate(async()=>{
 stopAllPerformancePlayback({silent:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});
 granularLayersEnabled=true;updateSourceMixGains();
 const config=PERFORMANCE_MIXER_VU_CHANNELS.find(c=>c.controlId==='performanceNoiseLevel');
 const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(80);
 const result=[];
 for(const mix of [0,100]){
  stopAllPerformancePlayback({silent:true});await wait(80);
  for(const[id,v]of Object.entries({noiseMix:mix,grainMixerAmp:100,panSpread:0})){clearModulationForParam(id);document.getElementById(id).value=v;}
  document.getElementById('noiseType').value='pink';
  const state=syncPerformanceMixerVuTap(config);
  mygrainNoise.tick();mygrainNoise.start();
  await wait(180);state.analyser.getFloatTimeDomainData(state.data);const rms=Math.sqrt(state.data.reduce((a,v)=>a+v*v,0)/state.data.length);
  updatePerformanceMixerVuChannel(config);result.push({mix,rms,text:document.getElementById('performanceNoiseLevelVuValue').textContent});
 }
 stopAllPerformancePlayback({silent:true});return result;
});console.log(engine,result);assert.equal(result[0].rms,0);assert(result[1].rms>.0001);assert(!result[1].text.includes('inf'));results.push({engine,result});assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}
fs.writeFileSync((process.env.MYGRAIN_AUDIO_EVIDENCE || '/tmp')+'/live-meter-results.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
