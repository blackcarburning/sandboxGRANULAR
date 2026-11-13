'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19016/mygrain/',out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp/mygrain-source-grid-results';
fs.mkdirSync(out,{recursive:true});
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
const targets=[['bastardLoopD','loopDBrowse','samples_loopstore'],['bastardLoopL','performanceBastardLoopLLoadBtn','samples_leads'],['bastardLoopX','performanceBastardLoopXLoadBtn','samples_bass'],['dropboxSampleLayer','performanceDropboxSampleBrowseBtn','sampledrop'],['grainA','grainASampleBrowseBtn','sampledrop2'],['grainB','grainBSampleBrowseBtn','splice_claw'],['keyboardSample','performanceKeyboardSampleBrowseBtn','samples_piano']];
(async()=>{const results=[];for(const[engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{ });
 try{for(const phone of process.env.QUICK?[false]:[true,false]){
  const context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1280,height:900},isMobile:phone,hasTouch:phone}),page=await context.newPage(),errors=[],builds=[];page.setDefaultTimeout(60000);
  page.on('pageerror',e=>errors.push(e.message));const wf=page.waitForFunction.bind(page);page.waitForFunction=(f,a,o)=>wf(f,a,{timeout:20000,...o});
  page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/build'))builds.push(r.postDataJSON())});
  await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
  await page.goto(base);await page.waitForFunction(()=>window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  await page.evaluate(async()=>{
   stopAllPerformancePlayback({silent:true});for(const l of SPARSE_RANDOM_LAYER_DEFINITIONS)l.setEnabled(false,{silent:true,skipSave:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});setFxMuted(true,{silent:true});
   setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);mygrainLoopFx.restore();mygrainChannelEq.restore();
   applyGlobalBpm(180);syncPatternLengthControls(16,{skipSave:true});
   await loadDrumMachineSampleFromSourceRelativePath('kick','samples_kicks','Nested/Tone_000_C4.wav','Tone_000_C4.wav');
   for(const k of ['kick','snare','hat','perc',...Object.keys(drumMachineExtraTracks)])getDrumMachinePattern(k).fill(k==='kick');
   setDrumMachineDirectOutput(true,{silent:true,skipSave:true});startDrumMachine(null,{silent:true,skipSave:true});
   await applyLoadedBastardLoopBuffer(cloneAudioBufferForCurrentContext(drumMachineKickBuffer),'Live clock fixture',{sourceKey:'import',bpm:180});setBastardLoopEnabled(true,{silent:true,skipSave:true});setBastardLoopPlaying(true,{silent:true,skipSave:true});
   window.sourceGridAudit={origin:getSharedLoopTransportOriginTime(),starts:0,stops:0,pcm:[]};
   const stop=stopDrumMachine,start=startDrumMachine;stopDrumMachine=(...a)=>{sourceGridAudit.stops++;return stop(...a)};startDrumMachine=(...a)=>{sourceGridAudit.starts++;return start(...a)};
   const meter=audioContext.createScriptProcessor(2048,2,2),mute=audioContext.createGain();mute.gain.value=0;finalAmplifierNode.connect(meter);meter.connect(mute);mute.connect(audioContext.destination);
   meter.onaudioprocess=e=>{let power=0;for(const x of e.inputBuffer.getChannelData(0)){if(!Number.isFinite(x))throw Error('Nonfinite final PCM');power+=x*x}sourceGridAudit.pcm.push(power)};
   window.finishSourceGridAudit=()=>{stopDrumMachine=stop;startDrumMachine=start;meter.onaudioprocess=null;finalAmplifierNode.disconnect(meter);meter.disconnect();mute.disconnect()};
  });
  const grid=page.locator('#sampleGridBrowser'),cells=grid.locator('.sample-grid-cell'),click=async l=>phone?l.tap():l.click();
  const open=async target=>{await page.evaluate(target=>openDropboxSampleBrowser(target),target);await page.waitForFunction(()=>mygrainSampleGridBrowser.files.length>0&&!mygrainSampleGridBrowser.listController)};
  const launch=async id=>{await page.evaluate(id=>{const b=document.getElementById(id);if(!b)throw Error('Missing launch '+id);mygrainDisplay.reveal(b);for(let n=b;n;n=n.parentElement){if(n.tagName==='DETAILS')n.open=true}b.scrollIntoView({block:'center'})},id);await click(page.locator('#'+id));await page.waitForFunction(()=>mygrainSampleGridBrowser.files.length>0&&!mygrainSampleGridBrowser.listController)};
  const stateFor=target=>page.evaluate(target=>{
   const d={bastardLoopD:[bastardLoopDBuffer,bastardLoopDMetadata],bastardLoopL:[bastardLoopLSampleBuffer,bastardLoopLSampleMetadata],bastardLoopX:[bastardLoopXSampleBuffer,bastardLoopXSampleMetadata],dropboxSampleLayer:[dropboxSampleLayerRawBuffer,dropboxSampleLayerMetadata],grainA:[grainASampleBuffer,grainASampleMetadata],grainB:[grainBSampleBuffer,grainBSampleMetadata],keyboardSample:[keyboardSampleBuffer,keyboardSampleMetadata]};
   const[b,m]=d[target];return{meta:m,frames:b?.length||0,rate:b?.sampleRate||0,pcm:b?Array.from(b.getChannelData(0)):[]};
  },target);
  const direct=[];
  for(const[target,id,source]of targets){
   console.log('CHECK',engine,phone,target);await launch(id);assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.config.target),target);assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.sourceKey),source);
   assert(await grid.locator('.sample-grid-loop-tools').isHidden());assert.equal(await cells.count(),source==='sampledrop'?200:target==='bastardLoopD'?10:4);
   if(target==='bastardLoopD')await page.evaluate(()=>{const b=mygrainSampleGridBrowser,node=audioContext.createMediaElementSource(b.audio),tap=audioContext.createScriptProcessor(1024,2,2),mute=audioContext.createGain();mute.gain.value=0;node.connect(audioContext.destination);node.connect(tap);tap.connect(mute);mute.connect(audioContext.destination);window.nativeSourceGridPCM=[];tap.onaudioprocess=e=>{let power=0;for(const x of e.inputBuffer.getChannelData(0))power+=x*x;nativeSourceGridPCM.push({result:b.resultPlaying,power})}});
   await click(cells.first());await page.waitForFunction(()=>mygrainSampleGridBrowser.audio.currentTime>.01||mygrainSampleGridBrowser.decodedPreview?.playing);
   const selected=await page.evaluate(()=>mygrainSampleGridBrowser.file.relativePath);
   await click(grid.locator('[data-grid-action=load]'));await page.waitForFunction(()=>document.querySelector('.sample-grid-status').textContent.startsWith('Loaded'));
   const after=await stateFor(target);assert.equal(after.meta.relativePath,selected);assert.equal(after.meta.sourceKey,source);assert(after.frames>100&&after.pcm.some(x=>Math.abs(x)>.01));assert(await grid.isVisible());
   direct.push({target,path:selected,frames:after.frames,rate:after.rate});
   const alternate=({bastardLoopD:'samples_loops',bastardLoopL:'samples_terra',bastardLoopX:'samples_altbass',dropboxSampleLayer:'samples_vocal',grainA:'samples_piano',grainB:'samples_orch',keyboardSample:'samples_altbass'})[target];
   await grid.locator('.sample-grid-source').selectOption(alternate);await page.waitForFunction(source=>mygrainSampleGridBrowser.sourceKey===source&&mygrainSampleGridBrowser.files.length>0&&!mygrainSampleGridBrowser.listController,alternate);
   await click(cells.first());await click(grid.locator('[data-grid-action=load]'));await page.waitForFunction(()=>document.querySelector('.sample-grid-status').textContent.startsWith('Loaded'));const alt=await stateFor(target);assert.equal(alt.meta.sourceKey,alternate);assert(alt.pcm.some(x=>Math.abs(x)>.0001));if(alternate==='samples_altbass'){assert.match(alt.meta.fileName,/\.aiff?$/i);assert(alt.meta.rootNote||alt.meta.rootMidi===60)}
   await grid.locator('.sample-grid-source').selectOption(source);await page.waitForFunction(source=>mygrainSampleGridBrowser.sourceKey===source&&mygrainSampleGridBrowser.files.length>0&&!mygrainSampleGridBrowser.listController,source);assert.deepEqual(await stateFor(target),alt,'future folder preference does not change loaded PCM');
   await click(grid.locator('[data-grid-action=close]'));

  }
  const loops=[];
  for(const lane of ['A','B','C','W','V','P','O']){
   console.log('CHECK',engine,phone,'loop '+lane);await launch(lane==='V'?'performanceBastardLoopVChooseBtn':`loop${lane}SampleBrowseBtn`);
   assert(await grid.locator('.sample-grid-loop-tools').isVisible());assert.equal(await grid.locator('.sample-grid-divisions input').count(),9);assert(!((await grid.locator('.sample-grid-divisions').innerText()).includes('[object')));
   if(phone){await cells.first().tap();await cells.first().tap()}else await cells.first().dblclick();
   assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.picks.length),1);assert.equal(await cells.first().getAttribute('data-picked'),'true');assert.match(await cells.first().getAttribute('class'),/picked/);
   await click(cells.nth(1));await click(grid.locator('[data-grid-action=load]'));assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.picks.length),2);
   await click(grid.locator('[data-grid-action=load]'));assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.picks.length),2,'duplicate adds only once');
   // Real checkbox interaction: choose a fine manual division, retaining coarse generation elsewhere.
   await grid.locator('.sample-grid-divisions input[value="1/8"]').check();
   for(const value of await grid.locator('.sample-grid-divisions input:checked:not([value="1/8"])').evaluateAll(nodes=>nodes.map(n=>n.value)))await grid.locator(`.sample-grid-divisions input[value="${value}"]`).uncheck();
   console.log('CUTS SELECTED',lane);const picked=await page.evaluate(()=>mygrainSampleGridBrowser.picks.map(f=>f.relativePath));
   await click(grid.locator('[data-grid-action=recut]'));await page.waitForFunction(()=>document.querySelector('.sample-grid-status').textContent.startsWith('Recut loaded')||document.querySelector('.sample-grid-status').textContent==='Playing card loop');
   await page.waitForFunction(()=>!mygrainCardHistory.busy&&!mygrainSampleGridBrowser.loading);console.log('RECUT COMPLETE',lane);
   const result=await page.evaluate(lane=>{const l=sampleGridLoop(lane),b=l.buffer();return{lane,metadata:l.metadata(),frames:b.length,rate:b.sampleRate,pcm:Array.from(b.getChannelData(0)),picks:mygrainSampleGridBrowser.picks.map(f=>f.relativePath),origin:getSharedLoopTransportOriginTime(),playing:drumMachinePlaying,loop:mygrainSampleGridBrowser.audio.loop,blob:mygrainSampleGridBrowser.audio.src}},lane);
   assert.deepEqual(result.metadata.samplePaths,picked);assert(result.frames>20000&&result.pcm.some(x=>Math.abs(x)>.01));assert(result.playing&&result.loop);assert.match(result.blob,/^blob:/);assert.equal(result.origin,await page.evaluate(()=>sourceGridAudit.origin));
   // Trusted Play remains available if a mobile engine denies async autoplay.
   if(await page.evaluate(()=>mygrainSampleGridBrowser.audio.paused))await click(grid.locator('[data-grid-action=play-loop]'));
   await page.waitForFunction(()=>mygrainSampleGridBrowser.audio.currentTime>.02);await page.waitForFunction(()=>nativeSourceGridPCM.some(x=>x.result&&x.power>1e-4));
   if(lane==='A'){
    await click(grid.locator('[data-grid-action=play-loop]'));assert(await page.evaluate(()=>mygrainSampleGridBrowser.audio.paused));
    // Page changes and hearts preserve the full selection pool.
    await click(grid.locator('[data-grid-action=page-next]'));assert.equal(await cells.count(),7);assert.deepEqual(await page.evaluate(()=>mygrainSampleGridBrowser.picks.map(f=>f.relativePath)),picked);await click(grid.locator('[data-grid-action=page-previous]'));assert.equal(await grid.locator('.sample-grid-cell.picked').count(),2);
    await grid.locator('.sample-grid-source').selectOption('samples_loops');await page.waitForFunction(()=>mygrainSampleGridBrowser.sourceKey==='samples_loops'&&mygrainSampleGridBrowser.files.length>0&&!mygrainSampleGridBrowser.listController);assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.picks.length),0);await grid.locator('.sample-grid-source').selectOption('sampledrop');await page.waitForFunction(()=>mygrainSampleGridBrowser.sourceKey==='sampledrop'&&mygrainSampleGridBrowser.files.length>0&&!mygrainSampleGridBrowser.listController);assert.deepEqual(await page.evaluate(()=>mygrainSampleGridBrowser.picks.map(f=>f.relativePath)),picked);await click(cells.first());await page.waitForFunction(()=>mygrainFavourites.loaded);await click(grid.locator('[data-grid-action=heart]'));await page.waitForTimeout(150);await grid.locator('.sample-grid-hearts').selectOption('*');assert.deepEqual(await page.evaluate(()=>mygrainSampleGridBrowser.picks.map(f=>f.relativePath)),picked);await grid.locator('.sample-grid-hearts').selectOption('');
    const geom=[];for(const size of [{width:320,height:568},{width:390,height:844},{width:844,height:390}]){await page.setViewportSize(size);await page.waitForTimeout(50);const g=await grid.evaluate(e=>{const p=e.querySelector('.sample-grid-panel').getBoundingClientRect(),close=e.querySelector('.sample-grid-close').getBoundingClientRect(),controls=e.querySelector('.sample-grid-controls').getBoundingClientRect();return{width:innerWidth,height:innerHeight,panel:p.toJSON(),close:close.toJSON(),controls:controls.toJSON(),scroll:e.querySelector('.sample-grid-scroller').clientHeight,tools:e.querySelector('.sample-grid-loop-tools').getBoundingClientRect().toJSON()}});assert(g.close.bottom<=g.controls.top);assert(g.panel.left>=0&&g.panel.right<=size.width);assert(g.scroll>=40,JSON.stringify(g));geom.push(g);await page.screenshot({path:`${out}/${engine}-${phone?'touch':'mouse'}-${size.width}x${size.height}.png`})}await page.setViewportSize(phone?{width:390,height:844}:{width:1280,height:900});result.geometry=geom;
   }
   loops.push({...result,pcm:undefined});await click(grid.locator('[data-grid-action=close]'));await open('bastardLoop'+lane);assert.deepEqual(await page.evaluate(()=>mygrainSampleGridBrowser.picks.map(f=>f.relativePath)),picked);await click(grid.locator('[data-grid-action=close]'));
  }
  // A cancelled asynchronous decoder must never overwrite the card or create a history step.
  await open('bastardLoopL');const kept=await stateFor('bastardLoopL');
  await page.evaluate(()=>{window.originalGridDecode=decodeRepositoryAudio;window.gridDecodeEntered=false;decodeRepositoryAudio=async(...a)=>{const b=await originalGridDecode(...a);gridDecodeEntered=true;await new Promise(r=>window.releaseGridDecode=r);return b}});
  await click(cells.nth(2));await click(grid.locator('[data-grid-action=load]'));await page.waitForFunction(()=>gridDecodeEntered);await click(grid.locator('[data-grid-action=close]'));await page.evaluate(()=>releaseGridDecode());await page.waitForFunction(()=>!mygrainCardHistory.busy);await page.evaluate(()=>decodeRepositoryAudio=originalGridDecode);assert.deepEqual(await stateFor('bastardLoopL'),kept);
  // Recut failure and Close cancellation both preserve canonical audio and metadata.
  await open('bastardLoopA');const loopBefore=await page.evaluate(()=>({meta:bastardLoopMetadata,pcm:Array.from(bastardLoopBuffer.getChannelData(0))}));
  await page.route('**/api/generate',r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Isolated deliberate Recut failure'})}));
  // Endpoint is discovered from the app rather than guessed.
  const endpoint=await page.evaluate(()=>new URL(BASTARD_LOOP_API_URL,document.baseURI).href);await page.unroute('**/api/generate');
  await page.route(endpoint,r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Isolated deliberate Recut failure'})}));
  await click(grid.locator('[data-grid-action=recut]'));await page.waitForFunction(()=>document.querySelector('.sample-grid-status').textContent.includes('deliberate'));await page.waitForFunction(()=>!mygrainCardHistory.busy);await page.unroute(endpoint);if(await page.locator('#sampleLoadFailureDialog').isVisible())await page.locator('#sampleLoadFailureDialog button').first().click();assert.deepEqual(await page.evaluate(()=>({meta:bastardLoopMetadata,pcm:Array.from(bastardLoopBuffer.getChannelData(0))})),loopBefore);
  let release;const gate=new Promise(r=>release=r);await page.route(endpoint,async r=>{await gate;try{await r.continue()}catch{}});await click(grid.locator('[data-grid-action=recut]'));await click(grid.locator('[data-grid-action=close]'));release();await page.waitForFunction(()=>!mygrainCardHistory.busy);await page.unroute(endpoint);assert.deepEqual(await page.evaluate(()=>({meta:bastardLoopMetadata,pcm:Array.from(bastardLoopBuffer.getChannelData(0))})),loopBefore);
  const audit=await page.evaluate(()=>{const a={...sourceGridAudit,after:getSharedLoopTransportOriginTime(),playing:drumMachinePlaying};finishSourceGridAudit();return a});assert.equal(audit.starts,0);assert.equal(audit.stops,0);assert.equal(audit.origin,audit.after);assert(audit.playing&&audit.pcm.some(x=>x>1e-5));
  await page.evaluate(()=>stopAllPerformancePlayback({silent:true}));
  const nativePCM=await page.evaluate(()=>({source:nativeSourceGridPCM.some(x=>!x.result&&x.power>1e-4),result:nativeSourceGridPCM.some(x=>x.result&&x.power>1e-4)}));assert(nativePCM.source&&nativePCM.result);
  await open('bastardLoopX');const xBefore=await stateFor('bastardLoopX');await click(cells.nth(2));await click(grid.locator('[data-grid-action=load]'));await page.waitForFunction(()=>document.querySelector('.sample-grid-status').textContent.startsWith('Loaded'));const xAfter=await stateFor('bastardLoopX');await click(grid.locator('[data-grid-action=close]'));await page.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual(await stateFor('bastardLoopX'),xBefore);await page.evaluate(()=>mygrainCardHistory.redo());assert.deepEqual(await stateFor('bastardLoopX'),xAfter);
  // Exact loop Undo/Redo is tested after transport is stopped so intentionally restoring history is independent of the clock audit.
  await open('bastardLoopA');await click(grid.locator('[data-grid-action=recut]'));await page.waitForFunction(()=>!mygrainCardHistory.busy&&!mygrainSampleGridBrowser.loading);const newLoop=await page.evaluate(()=>({meta:bastardLoopMetadata,pcm:Array.from(bastardLoopBuffer.getChannelData(0))}));assert.notDeepEqual(newLoop.pcm,loopBefore.pcm);await click(grid.locator('[data-grid-action=close]'));await page.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual(await page.evaluate(()=>({meta:bastardLoopMetadata,pcm:Array.from(bastardLoopBuffer.getChannelData(0))})),loopBefore);await page.evaluate(()=>mygrainCardHistory.redo());assert.deepEqual(await page.evaluate(()=>({meta:bastardLoopMetadata,pcm:Array.from(bastardLoopBuffer.getChannelData(0))})),newLoop);
  await open('bastardLoopA');await click(grid.locator('[data-grid-action=play-loop]'));await page.waitForFunction(()=>mygrainSampleGridBrowser.previewing);await page.evaluate(()=>stopAllPerformancePlayback({silent:true}));assert(await page.evaluate(()=>mygrainSampleGridBrowser.audio.paused&&!mygrainSampleGridBrowser.previewing));await click(grid.locator('.sample-grid-pick').first());assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.picks.length),1);assert.equal(await grid.locator('.sample-grid-cell.picked').count(),1);await click(grid.locator('[data-grid-action=clear-picks]'));assert(await grid.locator('[data-grid-action=recut]').isDisabled());assert.equal(await grid.locator('.sample-grid-cell.picked').count(),0);
  await page.evaluate(()=>window.dispatchEvent(new Event('mygrain-account-lock')));assert(await grid.isHidden());assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.audio.src),'');
  assert.deepEqual(errors,[]);results.push({engine,phone,direct,loops,audit:{...audit,pcm:undefined,nonzero:audit.pcm.filter(x=>x>1e-5).length},errors});console.log('PASS',engine,phone?'phone':'desktop','14 targets, real PCM, picked lists, manual Recut, Undo/Redo, failure/cancellation and uninterrupted clock');await context.close();
 }}finally{await browser.close()}
}fs.writeFileSync(out+'/source-grid-browser-results.json',JSON.stringify(results,null,2))})().catch(e=>{console.error(e);process.exitCode=1});
