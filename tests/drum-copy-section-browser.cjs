const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright-core');
const base = 'http://127.0.0.1:18959/mygrain/';
(async () => {
 for (const [engine, browserType] of Object.entries({chromium, webkit})) {
  const browser = await browserType.launch(engine === 'chromium' ? {executablePath:'/snap/bin/chromium', args:['--no-sandbox']} : {});
  try { for (const viewport of [{width:1280,height:900},{width:390,height:844},{width:844,height:390},{width:320,height:640}]) {
   const mobile = viewport.width !== 1280;
   const context = await browser.newContext({viewport, isMobile:mobile, hasTouch:mobile});
   await context.request.post(base+'api/auth/login', {data:{username:'admin',password:'isolated-drum-copy'}});
   const page = await context.newPage(), errors=[];
   page.on('pageerror', e=>errors.push(e.message));
   await page.route('**/*', r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   await page.goto(base);
   await page.waitForFunction(()=>window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup==='ready');
   await page.evaluate(()=>mygrainCardHistory.ready);
   await page.locator('#start-btn').click();
   await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
   await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});openDrumMachineOverlay();});
   for (const kind of ['kick','snare','hat','perc','clap','cymbals','etc','roll']) {
    const before = await page.evaluate(kind=>{
     const arrays=getDrumMachineSectionArrays(kind); arrays.forEach((a,j)=>a?.fill(j===1?0:false));
     arrays[0][1]=true; arrays[1][1]=4; if(arrays[2]){arrays[2][1]=true;arrays[2][2]=true;}
     syncDrumMachineUi(); saveState(); return arrays.map(a=>a?.slice());
    },kind);
    const card=page.locator('#drumMachineLane-'+kind), copy=card.locator('[data-drum-copy-section]');
    assert.equal(await copy.count(),1);
    assert(await copy.evaluate(b=>b.parentElement.matches('.drum-machine-accent-copy-row')));
    assert.equal(await card.locator('.drum-machine-track-actions [data-drum-copy-section]').count(),0);
    const placement=await copy.evaluate(b=>{const card=b.closest('.drum-machine-track-card'),rect=b.getBoundingClientRect(),grid=card.querySelector('.drum-machine-step-grid').getBoundingClientRect(),env=card.querySelector('[data-drum-lane-accent]')?.getBoundingClientRect();return{inside:rect.left>=0&&rect.right<=innerWidth,aboveSteps:rect.bottom<=grid.top,besideEnvelope:!env||(Math.abs(env.bottom-rect.bottom)<1&&rect.left>=env.right)};});
    assert(placement.inside&&placement.aboveSteps&&placement.besideEnvelope,JSON.stringify({kind,viewport,placement}));
    const step=i=>card.locator(kind==='roll'?`.drum-machine-step-btn[data-roll-step="${i}"]`:`.drum-machine-step-btn[data-step-index="${i}"]`);
    const tap=async el=>mobile?el.tap():el.click();
    await tap(copy); await tap(step(2)); await tap(step(1)); // reversed selection: steps 2–3
    assert.deepEqual(await page.evaluate(k=>getDrumMachineSectionArrays(k).map(a=>a?.slice()),kind),before);
    await tap(step(5));
    await page.waitForFunction(()=>!mygrainCardHistory.busy);
    const after=await page.evaluate(k=>getDrumMachineSectionArrays(k).map(a=>a?.slice()),kind);
    for(let lane=0;lane<before.length;lane++) {
     if(!before[lane]) continue;
     assert.deepEqual(after[lane].slice(0,5),before[lane].slice(0,5));
     for(let i=5;i<after[lane].length;i++) assert.equal(after[lane][i],before[lane][1+(i-5)%2]);
    }
    await page.evaluate(()=>mygrainCardHistory.undo());
    assert.deepEqual(await page.evaluate(k=>getDrumMachineSectionArrays(k).map(a=>a?.slice()),kind),before);
    await page.evaluate(()=>mygrainCardHistory.redo());
    assert.deepEqual(await page.evaluate(k=>getDrumMachineSectionArrays(k).map(a=>a?.slice()),kind),after);
    await tap(copy);await tap(copy);assert.equal(await copy.getAttribute('aria-pressed'),'false');
    console.log('PASS',engine,mobile?'phone':'desktop',kind,'copy, reversed range, accents, ratchets, Undo/Redo, cancel');
   }
   const saved=await page.evaluate(()=>{saveState({force:true});return ['kick','snare','hat','perc','clap','cymbals','etc','roll'].map(k=>getDrumMachineSectionArrays(k).map(a=>a?.slice()));});
   await page.reload();await page.waitForFunction(()=>window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');
   await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
   assert.deepEqual(await page.evaluate(()=>['kick','snare','hat','perc','clap','cymbals','etc','roll'].map(k=>getDrumMachineSectionArrays(k).map(a=>a?.slice()))),saved);
   assert.deepEqual(errors,[]);console.log('PASS',engine,mobile,'save/reload, no runtime errors');await context.close();
  }} finally {await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
