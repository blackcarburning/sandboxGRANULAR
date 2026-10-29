'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';
const out = process.env.MYGRAIN_N_EVIDENCE || '/tmp/mygrain-noise-n-controls';
fs.mkdirSync(out, {recursive:true});
(async () => {
 const results = [];
 for (const [engine, type] of Object.entries({chromium, webkit})) {
  const browser = await type.launch(engine === 'chromium' ? {executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']} : {});
  try {
   const context = await browser.newContext({viewport:{width:1280,height:900}});
   const page = await context.newPage(), errors = [];
   page.on('pageerror', e => errors.push(e.message));
   page.setDefaultTimeout(60000);
   await page.route('**/*', route => {
    const req=route.request(), u=new URL(req.url());
    if(u.origin!==new URL(base).origin || !['GET','HEAD'].includes(req.method())) return route.abort();
    if(u.pathname.endsWith('/account-context.js')) return route.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"n-controls-fixture"}};'});
    if(u.pathname.includes('/api/')) return route.fulfill({json:{ok:true,authenticated:true,user:{username:'n-controls-fixture'},files:[],songs:[],folders:[],samples:[],patches:[]}});
    return route.continue();
   });
   await page.goto(base);
   await page.waitForFunction(()=>window.mygrainNoise&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');
   await page.locator('#start-btn').click();
   await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   console.log(engine, 'ready');
   await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});mygrainNoise.restore({...mygrainNoise.settings(),enabled:false,level:31,type:'white',filterEnabled:false});syncPerformanceControlState()});
   await page.locator('#performanceNoiseLayerBtn').click();
   for (const id of ['performanceNoiseLayerBtn','noiseNToggle']) assert.equal(await page.locator('#'+id).getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator('#performanceNoiseLevel').inputValue(),'31');
   await page.locator('#performanceNoiseLevel').fill('43');
   assert.equal(await page.locator('#noiseMix').inputValue(),'43');
   await page.locator('#noiseNToggle').click();
   assert.equal(await page.locator('#performanceNoiseLayerBtn').getAttribute('aria-pressed'),'false');
   assert.equal(await page.locator('#performanceNoiseLevel').inputValue(),'43');
   await page.locator('#performanceNoiseLayerBtn').click();
   await page.locator('#noiseMix').fill('29');
   assert.equal(await page.locator('#performanceNoiseLevel').inputValue(),'29');
   const soloIds=['performanceNoiseLayerSoloBtn','performanceNoiseLevelSoloBtn','noiseNSolo'];
   for (const id of soloIds) {
    await page.locator('#'+id).click();
    for(const other of soloIds) assert.equal(await page.locator('#'+other).getAttribute('aria-pressed'),'true',other);
    assert.deepEqual(await page.evaluate(()=>[...loopLayerSolo]),['noise']);
    await page.locator('#'+id).click();
    for(const other of soloIds) assert.equal(await page.locator('#'+other).getAttribute('aria-pressed'),'false',other);
   }
   const audio=await page.evaluate(async()=>{
    stopModulationLoop();stopPerformanceMixerVuMeters();
    mygrainNoise.start();
    const analyser=audioContext.createAnalyser();analyser.fftSize=1024;mygrainNoise.graph.gain.connect(analyser);
    const values=new Float32Array(1024);
    async function peak(){await new Promise(r=>setTimeout(r,320));analyser.getFloatTimeDomainData(values);return Math.max(...values.map(Math.abs))}
    const normal=await peak();
    setLoopLayerSolo('bastarda',{silent:true,skipSave:true});const otherSolo=await peak();
    setLoopLayerSolo('noise',{silent:true,skipSave:true});const ownSolo=await peak();
    const snapshot=saveState({force:true,snapshotOnly:true}),preset=gatherPreset();
    setLoopLayerSolo([],{silent:true,skipSave:true});
    restoreState({state:snapshot,songSnapshot:true,throwOnError:true});const restored=[...loopLayerSolo];
    setLoopLayerSolo([],{silent:true,skipSave:true});applyPreset(preset);const presetSolo=[...loopLayerSolo];
    clearAllPerformanceSoloStates({silent:true,skipSave:true});const cleared=[...loopLayerSolo],afterClear=await peak();
    mygrainNoise.graph.gain.disconnect(analyser);analyser.disconnect();mygrainNoise.stop();
    return {normal,otherSolo,ownSolo,restored,presetSolo,cleared,afterClear};
   });
   assert(audio.normal>.001,JSON.stringify(audio));assert(audio.otherSolo<1e-5,JSON.stringify(audio));assert(audio.ownSolo>.001,JSON.stringify(audio));assert(audio.afterClear>.001,JSON.stringify(audio));assert.deepEqual(audio.restored,['noise']);assert.deepEqual(audio.presetSolo,['noise']);assert.deepEqual(audio.cleared,[]);
   for(const id of ['performanceNoiseLevelModuleJumpBtn','performanceNoiseLayerJumpBtn']) {
    await page.locator('#'+id).click();
    await page.waitForTimeout(750);
    assert(await page.evaluate(()=>{const r=document.getElementById('noiseCard').getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}),id+' must jump to N');
   }
   for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1280,height:900}]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert(await page.locator('#performanceNoiseLayerBtn').isVisible());
    assert(await page.locator('#performanceNoiseLevelSoloBtn').isVisible());
   }
   await page.locator('#performanceNoiseLevel').locator('..').screenshot({path:out+'/'+engine+'-mixer.png'});
   await page.locator('#performanceNoiseLayerBtn').locator('..').screenshot({path:out+'/'+engine+'-layers.png'});
   assert.deepEqual(errors,[]);
   results.push({engine,audio,errors});console.log('PASS',engine,JSON.stringify(audio));
   await context.close();
  } finally {await browser.close()}
 }
 fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
