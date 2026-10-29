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

await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!stateSaveSuspended&&!mygrainCardHistory.busy);
// Real randomisation/settings orchestration; only sample I/O and playback restart are stubbed.
await p.evaluate(()=>{
 stopAllPerformancePlayback({silent:true});stopModulationLoop();stopPerformanceMixerVuMeters();
 for(const name of ['generateSourceWithPlaybackRestart','randomizeBastardLoopWCut','requestMegaRandomBastardLoopBuild','applyMegaRandomBastardLoopBuild','loadBastardLoopLSampleFromSource','loadBastardLoopXSampleFromSource','loadDropboxSampleLayerFromSource','loadRandomDrumMachineSamples'])window[name]=async()=>null;
 restartAllTransport=()=>{};
});
const random=await p.evaluate(async()=>{
 const result=[];
 const seed=()=>{setSliderValue('finalDelayDepth',61);setSliderValue('finalReverbMix',47);setFinalReverbEnabled(true,{silent:true,skipSave:true})};
 const state=name=>({name,delay:getSliderPercent('finalDelayDepth'),reverb:getSliderPercent('finalReverbMix'),enabled:finalReverbEnabled});
 for(const mode of ['normal','mega','sparse']){
  seed();if(mode==='normal')await runPatchRandomization();else await runMegaRandomization({sparseMode:mode==='sparse'});
  result.push(state(mode));
 }
 // Randomiser errors must not leave an old global send audible.
 seed();const original=randomizeInternalParameters;randomizeInternalParameters=()=>{throw Error('fixture randomiser failure')};
 try{await runPatchRandomization()}catch(e){if(e.message!=='fixture randomiser failure')throw e}finally{randomizeInternalParameters=original}
 result.push(state('failure'));hideSettlePopup();return result;
});
for(const r of random){assert.equal(r.delay,0,r.name);assert.equal(r.reverb,0,r.name);assert.equal(r.enabled,false,r.name)}
await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});stopModulationLoop();stopPerformanceMixerVuMeters();setFxMuted(false,{silent:true,skipSave:true});resetRandomizeGlobalMixSends()});
await p.locator('#performanceLayerDelayBtn').click();await p.waitForTimeout(150);
const delayOn=await p.evaluate(()=>({send:getSliderPercent('finalDelayDepth'),wet:finalDelayWetGain.gain.value,label:document.getElementById('performanceLayerDelayBtn').textContent,pressed:document.getElementById('performanceLayerDelayBtn').getAttribute('aria-pressed')}));
assert(delayOn.send>0);assert(delayOn.wet>0);assert.equal(delayOn.pressed,'true');
await p.locator('#performanceDelayOffBtn').click();await p.waitForTimeout(150);
const delayOff=await p.evaluate(()=>({send:getSliderPercent('finalDelayDepth'),wet:finalDelayWetGain.gain.value,label:document.getElementById('performanceLayerDelayBtn').textContent,pressed:document.getElementById('performanceLayerDelayBtn').getAttribute('aria-pressed')}));assert.equal(delayOff.send,0);assert(delayOff.wet<.0001);assert.equal(delayOff.pressed,'false');
// Slider edits must update Layers too; Off->On restores the last non-zero send.
await p.evaluate(()=>setSliderValue('finalDelayDepth',43));await p.waitForFunction(()=>document.getElementById('performanceLayerDelayBtn').getAttribute('aria-pressed')==='true');assert.equal(await p.locator('#performanceLayerDelayBtn').getAttribute('aria-pressed'),'true');
await p.locator('#performanceLayerDelayBtn').click();assert.equal(await p.evaluate(()=>getSliderPercent('finalDelayDepth')),0);
await p.locator('#performanceLayerDelayBtn').click();assert.equal(await p.evaluate(()=>getSliderPercent('finalDelayDepth')),.43);
await p.locator('#performanceLayerReverbBtn').click();await p.waitForTimeout(150);
const reverbOn=await p.evaluate(()=>({enabled:finalReverbEnabled,send:getSliderPercent('finalReverbMix'),wet:finalReverbWetGain.gain.value,actions:document.getElementById('performanceFinalReverbBtn').getAttribute('aria-pressed'),layers:document.getElementById('performanceLayerReverbBtn').getAttribute('aria-pressed')}));assert.equal(reverbOn.enabled,true);assert(reverbOn.send>0);assert(reverbOn.wet>0);assert.equal(reverbOn.actions,'true');assert.equal(reverbOn.layers,'true');
await p.locator('#performanceFinalReverbBtn').click();await p.waitForTimeout(150);
assert.equal(await p.locator('#performanceLayerReverbBtn').getAttribute('aria-pressed'),'false');assert(await p.evaluate(()=>finalReverbWetGain.gain.value)<.0001);
// A no-state-change effects update should not repaint the new buttons.
const idle=await p.evaluate(()=>{syncGlobalMixEffectButtons();const observer=new MutationObserver(()=>{});observer.observe(document.getElementById('performanceLayerSwitchesCard'),{subtree:true,attributes:true,childList:true});for(let i=0;i<125;i++)syncGlobalMixEffectButtons();const n=observer.takeRecords().length;observer.disconnect();return n});assert.equal(idle,0);
const layout=[];
for(const size of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
 await p.setViewportSize(size);
 const bounds=await p.evaluate(()=>['performanceLayerReverbBtn','performanceLayerDelayBtn','performanceDelayOffBtn'].map(id=>{const b=document.getElementById(id).getBoundingClientRect();return{id,left:b.left,right:b.right,width:b.width,screen:innerWidth}}));
 for(const b of bounds){assert(b.width>30);assert(b.left>=0);assert(b.right<=b.screen+1)}layout.push({size,bounds});
}
await p.evaluate(()=>{setGlobalMixDelayEnabled(false,{silent:true});setFinalReverbEnabled(false,{silent:true});saveState()});
await p.reload();await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!stateSaveSuspended);
const restored=await p.evaluate(()=>({delay:getSliderPercent('finalDelayDepth'),enabled:finalReverbEnabled,delayButton:document.getElementById('performanceLayerDelayBtn').getAttribute('aria-pressed'),reverbButton:document.getElementById('performanceLayerReverbBtn').getAttribute('aria-pressed')}));assert.equal(restored.delay,0);assert.equal(restored.enabled,false);assert.equal(restored.delayButton,'false');assert.equal(restored.reverbButton,'false');
console.log(engine,JSON.stringify({random,delayOn,delayOff,reverbOn,idle,restored}));results.push({engine,random,delayOn,delayOff,reverbOn,idle,restored,layout});assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}
fs.writeFileSync((process.env.MYGRAIN_AUDIO_EVIDENCE||'/tmp')+'/global-fx-browser.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
