'use strict';
// Disposable localhost store. Real native streaming, touch, WebAudio and saved PCM.
const assert = require('node:assert/strict'), fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:19014/mygrain/';
const out = process.env.MYGRAIN_TEST_OUTPUT || '/tmp/mygrain-grid-results';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/); fs.mkdirSync(out, {recursive:true});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const kinds = ['Kick','Snare','Hat','Perc','Clap','Cymbals','Etc','Roll'];
(async () => {
 const results = [];
 for (const [engine, type] of Object.entries({chromium, webkit})) {
  const browser = await type.launch(engine === 'chromium' ? {executablePath:'/snap/bin/chromium', args:['--no-sandbox','--disable-dev-shm-usage']} : {});
  try { for (const phone of [true,false]) {
   const context = await browser.newContext({viewport: phone ? {width:390,height:844} : {width:1280,height:900}, isMobile:phone, hasTouch:phone});
   const page = await context.newPage(), errors = []; page.setDefaultTimeout(45000);
   page.on('pageerror', error => errors.push(error.message));
   await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
   assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
   await page.goto(base); await page.waitForFunction(() => window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup === 'ready');
   await page.evaluate(() => mygrainCardHistory.ready); await page.locator('#start-btn').click();
   await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
   await page.evaluate(async () => {
    stopAllPerformancePlayback({silent:true});
    for (const l of SPARSE_RANDOM_LAYER_DEFINITIONS) l.setEnabled(false,{silent:true,skipSave:true});
    clearAllPerformanceSoloStates({silent:true,skipSave:true}); setFxMuted(true,{silent:true});
    setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);mygrainLoopFx.restore();mygrainChannelEq.restore();
    await loadDrumMachineSampleFromSourceRelativePath('kick','samples_kicks','Nested/Tone_000.wav','Tone_000.wav');
    applyGlobalBpm(180); syncPatternLengthControls(32,{skipSave:true});
    for (const kind of ['kick','snare','hat','perc',...Object.keys(drumMachineExtraTracks)]) getDrumMachinePattern(kind).fill(kind==='kick');
    restoreDrumMachineRoll();restoreDrumMachineLaneSolos([]);setDrumMachineDirectOutput(true,{silent:true,skipSave:true});
    startDrumMachine(null,{silent:true,skipSave:true});openDrumMachineOverlay();
    const meter=audioContext.createScriptProcessor(2048,2,2),mute=audioContext.createGain();mute.gain.value=0;
    finalAmplifierNode.connect(meter);meter.connect(mute);mute.connect(audioContext.destination);
    window.gridAudit={stops:0,starts:0,pcm:[],hits:[],origin:getSharedLoopTransportOriginTime(),buffer:drumMachineKickBuffer};
    meter.onaudioprocess=e=>{const a=e.inputBuffer.getChannelData(0);let sum=0;for(const x of a){if(!Number.isFinite(x))throw Error('Nonfinite PCM');sum+=x*x;}gridAudit.pcm.push({time:audioContext.currentTime,rms:Math.sqrt(sum/a.length)});};
    const stop=stopDrumMachine,start=startDrumMachine,hit=playDrumMachineHit;
    stopDrumMachine=(...args)=>{gridAudit.stops++;return stop(...args)};
    startDrumMachine=(...args)=>{gridAudit.starts++;return start(...args)};
    playDrumMachineHit=(buffer,...args)=>{if(buffer===drumMachineKickBuffer)gridAudit.hits.push({time:audioContext.currentTime,selected:drumMachineKickMetadata.relativePath});return hit(buffer,...args)};
    window.endGridAudit=()=>{stopDrumMachine=stop;startDrumMachine=start;playDrumMachineHit=hit;meter.onaudioprocess=null;finalAmplifierNode.disconnect(meter);meter.disconnect();mute.disconnect();};
   });
   const click = async locator => phone ? locator.tap() : locator.click();
   const grid = page.locator('#sampleGridBrowser'), cells=grid.locator('.sample-grid-cell');
   await click(page.locator('#drumMachineKickBrowseBtn'));
   await page.waitForFunction(() => window.mygrainSampleGridBrowser?.files.length === 417);
   assert.equal(await cells.count(),200);
   const layout=await grid.evaluate(e=>({columns:getComputedStyle(e.querySelector('.sample-grid-cells')).gridTemplateColumns.split(' ').length,
    header:e.querySelector('.sample-grid-header').getBoundingClientRect().height,
    close:e.querySelector('.sample-grid-close').getBoundingClientRect().toJSON(),controls:e.querySelector('.sample-grid-controls').getBoundingClientRect().toJSON(),players:e.querySelectorAll('audio').length,
    widgets:e.querySelectorAll('.sample-browser-card,.sample-favourite-item,audio[controls]').length,
    left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,scroll:e.querySelector('.sample-grid-scroller').scrollHeight}));
   assert.equal(layout.columns,phone?5:10);assert(layout.header<140);assert(layout.close.bottom<=layout.controls.top);assert.equal(layout.close.width,44);assert.equal(layout.close.height,44);assert.equal(layout.players,1);assert.equal(layout.widgets,0);
   const originalOrder = await page.evaluate(()=>mygrainSampleGridBrowser.order.map(f=>f.relativePath));
   assert.equal(new Set(originalOrder).size,417);assert.notDeepEqual(originalOrder,originalOrder.slice().sort());
   await click(cells.first());await page.waitForFunction(()=>document.querySelector('#sampleGridBrowser audio').currentTime > .02);
   assert.equal(await page.evaluate(()=>drumMachineKickMetadata.relativePath),'Nested/Tone_000.wav','single tap is preview only');
   await click(grid.locator('[data-grid-action="next"]'));
   assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.selected),1);
   await click(grid.locator('[data-grid-action="previous"]'));
   assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.selected),0);
   // Double tap/click is a load, not a close. A single tap elsewhere is not.
   await wait(450);
   if(phone){await cells.nth(2).tap();await cells.nth(2).tap();}else await cells.nth(2).dblclick();
   await page.waitForFunction(()=>document.querySelector('.sample-grid-status').textContent.startsWith('Loaded'));
   const firstLoad=await page.evaluate(()=>({path:drumMachineKickMetadata.relativePath,selected:mygrainSampleGridBrowser.file.relativePath,playing:drumMachinePlaying,bufferChanged:gridAudit.buffer!==drumMachineKickBuffer}));
   assert.equal(firstLoad.path,firstLoad.selected);assert(firstLoad.playing&&firstLoad.bufferChanged);assert(await grid.isVisible());
   // Enter, arrows and page transitions all use the same fixed array.
   await cells.nth(2).focus();await page.keyboard.press('ArrowDown');
   assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.selected),phone?7:12);
   await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowUp');
   assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.selected),2);
   await click(grid.locator('[data-grid-action="page-next"]'));assert.equal(await cells.count(),200);
   assert.equal(await cells.first().innerText(),'201\n▶');
   await click(grid.locator('[data-grid-action="page-next"]'));assert.equal(await cells.count(),17);
   assert(await grid.locator('[data-grid-action="page-next"]').isDisabled());
   await click(grid.locator('[data-grid-action="page-previous"]'));await click(grid.locator('[data-grid-action="page-previous"]'));
   assert.deepEqual(await page.evaluate(()=>mygrainSampleGridBrowser.order.map(f=>f.relativePath)),originalOrder);
   // Saved hearts share canonical source/path IDs; filtering never reshuffles.
   await click(cells.nth(3));await page.waitForFunction(()=>mygrainFavourites.loaded);
   const key=await page.evaluate(()=>MygrainSampleGrid.keyOf(mygrainSampleGridBrowser.file));
   await click(grid.locator('[data-grid-action="heart"]'));await page.waitForFunction(key=>Object.hasOwn(mygrainFavourites.group('samples').items,key),key);
   assert.equal(await cells.nth(3).locator('.sample-grid-cell-heart').count(),1);
   assert.match(await cells.nth(3).getAttribute('aria-label'),/Hearted/);
   await grid.locator('.sample-grid-hearts').selectOption('*');assert((await cells.count())>=1);
   assert.equal(await grid.locator('.sample-grid-cell-heart').count(),await cells.count());
   await grid.locator('.sample-grid-hearts').selectOption('');
   assert.deepEqual(await page.evaluate(()=>mygrainSampleGridBrowser.order.map(f=>f.relativePath)),originalOrder);
   const pageBefore=await page.evaluate(()=>({x:scrollX,y:scrollY,drum:document.querySelector('#drumMachineOverlay .drum-machine-layout').scrollTop}));
   await grid.locator('.sample-grid-scroller').evaluate(e=>e.scrollTop=e.scrollHeight);
   assert.equal(await cells.last().innerText(),'200\n▶');await click(cells.last());
   await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.sample-grid-status').textContent.startsWith('Loaded'));
   await grid.locator('.sample-grid-scroller').evaluate(e=>e.scrollTop=0);
   if(phone && engine==='chromium'){
    const cdp=await context.newCDPSession(page),rect=await cells.nth(10).boundingBox(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    const before=await page.evaluate(()=>({path:drumMachineKickMetadata.relativePath,selected:mygrainSampleGridBrowser.selected}));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let n=1;n<=8;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-n*16}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(300);
    assert.deepEqual(await page.evaluate(()=>({path:drumMachineKickMetadata.relativePath,selected:mygrainSampleGridBrowser.selected})),before,'scroll gesture is neither preview nor load');
   }
   assert.deepEqual(await page.evaluate(()=>({x:scrollX,y:scrollY,drum:document.querySelector('#drumMachineOverlay .drum-machine-layout').scrollTop})),pageBefore);
   await grid.locator('.sample-grid-scroller').evaluate(e=>e.scrollTop=0);
   await page.screenshot({path:`${out}/${engine}-${phone?'phone':'desktop'}.png`});
   await click(grid.locator('[data-grid-action="close"]'));
   assert(await page.locator('#drumMachineOverlay').isVisible());assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.audio.getAttribute('src')),null);
   await click(page.locator('#drumMachineKickBrowseBtn'));await page.waitForFunction(()=>mygrainSampleGridBrowser.files.length===417);
   assert.notDeepEqual(await page.evaluate(()=>mygrainSampleGridBrowser.order.map(f=>f.relativePath)),originalOrder,'new visit gets a new order');
   await click(grid.locator('[data-grid-action="close"]'));
   // Every actual lane button routes to its assigned folder and loads into its canonical buffer.
   const laneResults=[];
   for(const label of kinds){
    await click(page.locator(`#drumMachine${label}BrowseBtn`));
    await page.waitForFunction(()=>mygrainSampleGridBrowser.files.length>0&&!mygrainSampleGridBrowser.listController);
    const selectedSource=await page.evaluate(()=>mygrainSampleGridBrowser.sourceKey);
    assert.equal(selectedSource,({Kick:'samples_kicks',Snare:'samples_snares',Hat:'samples_hats',Perc:'sampledrop',Clap:'samples_clap',Cymbals:'samples_crash',Etc:'samples_crash',Roll:'samples_snares'})[label]);
    await click(cells.first());await click(grid.locator('[data-grid-action="load"]'));
    await page.waitForFunction(()=>document.querySelector('.sample-grid-status').textContent.startsWith('Loaded'));
    const lane=await page.evaluate(label=>{const kind=label==='Roll'?'snare':label.toLowerCase();return{kind,meta:getDrumMachineTrackMetadata(kind),file:mygrainSampleGridBrowser.file,hidden:mygrainSampleGridBrowser.overlay.hidden}},label);
    assert.equal(lane.meta.relativePath,lane.file.relativePath);assert.equal(lane.meta.sourceKey,selectedSource);assert(!lane.hidden);laneResults.push(lane);
    if(label==='Perc'||label==='Etc'){
     await grid.locator('.sample-grid-source').selectOption('samples_perc');await page.waitForFunction(()=>mygrainSampleGridBrowser.sourceKey==='samples_perc'&&mygrainSampleGridBrowser.files.length>0);
     await click(cells.first());await click(grid.locator('[data-grid-action="load"]'));await page.waitForFunction(()=>document.querySelector('.sample-grid-status').textContent.startsWith('Loaded'));
    }
    await click(grid.locator('[data-grid-action="close"]'));
   }
   // Async selection/Close cancellation before decode cannot replace the existing PCM.
   await click(page.locator('#drumMachineKickBrowseBtn'));await page.waitForFunction(()=>mygrainSampleGridBrowser.files.length===417);
   let release;const gate=new Promise(resolve=>release=resolve);
   await page.route('**/api/source-sample?**',async route=>{await gate;try{await route.continue()}catch{}});
   const kept=await page.evaluate(()=>drumMachineKickMetadata.relativePath);
   await click(cells.nth(4));await click(grid.locator('[data-grid-action="load"]'));await click(grid.locator('[data-grid-action="close"]'));
   release();await page.waitForFunction(()=>!mygrainCardHistory.busy);await page.unroute('**/api/source-sample?**');
   assert.equal(await page.evaluate(()=>drumMachineKickMetadata.relativePath),kept);
   const audio=await page.evaluate(()=>{const r={stops:gridAudit.stops,starts:gridAudit.starts,origin:gridAudit.origin,after:getSharedLoopTransportOriginTime(),playing:drumMachinePlaying,pcm:gridAudit.pcm,hits:gridAudit.hits};endGridAudit();return r;});
   assert.equal(audio.stops,0);assert.equal(audio.starts,0);assert.equal(audio.origin,audio.after);assert(audio.playing);
   assert(audio.hits.length>20);assert(audio.pcm.filter(p=>p.rms>1e-5).length>15);
   // A browser is view-only state: exact saved patch is unchanged by opening/closing.
   await page.evaluate(()=>stopDrumMachine({silent:true,skipSave:true}));
   const state=await page.evaluate(()=>{const s=saveState({snapshotOnly:true});delete s.timestamp;return s});
   await click(page.locator('#drumMachineKickBrowseBtn'));await page.waitForFunction(()=>mygrainSampleGridBrowser.files.length===417);
   await click(grid.locator('[data-grid-action="close"]'));
   assert.deepEqual(await page.evaluate(()=>{const s=saveState({snapshotOnly:true});delete s.timestamp;return s}),state);
   await page.evaluate(()=>closeDrumMachineOverlay());
   assert.deepEqual(errors,[]);results.push({engine,phone,layout,firstLoad,laneResults,audio,errors});
   console.log('PASS',engine,phone?'phone':'desktop','200-cell paging, gestures, streaming, hearts, eight lanes, cancellation, continuing final PCM, unchanged clock and saved state');
   await context.close();
  }}finally{await browser.close()}
 }
 fs.writeFileSync(out+'/browser-results.json',JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
