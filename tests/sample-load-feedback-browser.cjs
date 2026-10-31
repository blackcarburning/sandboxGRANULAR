// Disposable accounts only; actual UI loading, native audio buffers and durable Undo/recall.
const assert = require('node:assert/strict'), fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const { sources } = require('../random-performance-samples.js');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18932/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence = process.env.MYGRAIN_RANDOM_EVIDENCE || '/tmp/mygrain-random-performance'; fs.mkdirSync(evidence, {recursive:true});
function wav(seed) {
 const rate=22050, frames=rate, data=Buffer.alloc(44+frames*2);
 data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);
 data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++)data.writeInt16LE(Math.round(.2*32767*Math.sin(2*Math.PI*(220+seed*17)*i/rate)),44+i*2);
 return data;
}
(async()=>{
 const results=[];
 for(const [engine,type] of Object.entries({chromium,webkit})) {
  const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try {
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
   assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-render-refresh-fixture'}})).status(),200);
   const page=await context.newPage(), errors=[], catalog=[], downloads=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
   let available='samples_vocal', sequence=0, audioFailure=false, audioDelay=0, empty=false, emptyAudio=false, networkFailure=false, drumTest=false, corruptAudio=false, catalogFailure=false;
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/api/source-files')) {
     if(catalogFailure)return route.abort('failed');
     const key=url.searchParams.get('source');assert.ok(sources.includes(key),'Forbidden root requested: '+key);catalog.push(key);
     const name=`fixture-${sequence}.wav`;
     return route.fulfill({json:{ok:true,sourceKey:key,files:empty?[]:[
      {sourceKey:key,name:'drum.wav',relativePath:'Drums/drum.wav'},
      {sourceKey:key,name:'bass.wav',relativePath:'Bass/bass.wav'},
      {sourceKey:'samples_bass',name:'foreign.wav',relativePath:'foreign.wav'},
      ...(key===available&&!empty?[{sourceKey:key,name,relativePath:`Tonal/${name}`,previewUrl:'https://bad.test/bass.wav'}]:[])
     ]}});
    }
    if(url.pathname.endsWith('/api/source-sample')) {
     if(drumTest && route.request().method()==='POST') {
      const key=route.request().postDataJSON().source;
      if(key==='samples_kicks')return route.fulfill({contentType:'audio/wav',body:Buffer.alloc(0)});
      return route.fulfill({contentType:'audio/wav',headers:{'X-Mygrain-Source-Name':'new-drum.wav'},body:wav(9)});
     }
     const key=url.searchParams.get('source'),path=url.searchParams.get('path');
     assert.ok(sources.includes(key));assert.match(path,/^Tonal\/fixture-\d+\.wav$/);downloads.push({sourceKey:key,path});
     if(audioDelay)await new Promise(r=>setTimeout(r,audioDelay));
     if(networkFailure)return route.abort('failed');
     if(corruptAudio)return route.fulfill({contentType:'audio/wav',body:Buffer.from('not a WAV')});
     if(emptyAudio)return route.fulfill({contentType:'audio/wav',body:Buffer.alloc(0)});
     if(audioFailure)return route.fulfill({status:500,body:'fixture failed'});
     return route.fulfill({contentType:'audio/wav',headers:{'X-Mygrain-Source-Key':key,'X-Mygrain-Source-Path':encodeURIComponent(path)},body:wav(Number(path.match(/\d+/)[0]))});
    }
    if(url.origin!==new URL(base).origin)return route.abort();
    return route.continue();
   });
   async function start(){await page.waitForFunction(()=>window.MygrainRandomSamples&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);}
   await page.goto(base);await start();
   await page.evaluate(()=>{
    stopAllPerformancePlayback({silent:true});setKeyboardSoundSource('osc');
    setSliderValue('grainAMicGrainScale',73);setSliderValue('grainBMicGrainReleaseScale',187);
    window.randomState=()=>({a:grainASampleMetadata?.fileName,b:grainBSampleMetadata?.fileName,k:keyboardSampleMetadata?.fileName,
     controls:[document.getElementById('grainAMicGrainScale').value,document.getElementById('grainBMicGrainReleaseScale').value],
     pcm:[grainASampleBuffer,grainBSampleBuffer,keyboardSampleBuffer].map(b=>b?{seconds:b.duration,energy:Array.from(b.getChannelData(0)).reduce((sum,v)=>sum+v*v,0)}:null)});
   });
   const targets=[['grainA','#grainASampleRandomBtn','a'],['grainB','#grainBSampleRandomBtn','b'],['keyboardSample','#performanceKeyboardSampleRandomBtn','k']];
   for(const [target,selector,slot] of targets) {
    const before=await page.evaluate(()=>randomState()),counts=await page.evaluate(()=>mygrainCardHistory.counts);
    sequence++;available=sources[sequence-1];
    await page.locator(selector).evaluate(button=>button.click());
    await page.waitForFunction(()=>!randomPerformanceSampleLoadController&&!mygrainCardHistory.busy);
    const after=await page.evaluate(()=>randomState());assert.equal(after[slot],`fixture-${sequence}.wav`);
    await page.screenshot({path:`${evidence}/${engine}-${target}-phone.png`});
    for(const other of ['a','b','k'].filter(s=>s!==slot))assert.equal(after[other],before[other]);
    assert.deepEqual(after.controls,['73','187']);assert.ok(after.pcm[targets.findIndex(t=>t[0]===target)].energy>1);

   }
   assert.equal(await page.locator('#sampleLoadFailureDialog').count(),0,'No popup on success');
   const beforeFailure=await page.evaluate(()=>randomState());empty=true;
   assert.match(await page.evaluate(()=>loadRandomPerformanceSample('grainA').then(()=>'',e=>e.message)),/No new eligible samples/);empty=false;
   const popup=page.locator('#sampleLoadFailureDialog');
   await popup.waitFor({state:'visible'});assert.match(await popup.innerText(),/No new eligible samples/);
   await popup.getByRole('button',{name:'OK',exact:true}).tap();
   audioFailure=true;sequence++;
   assert.match(await page.evaluate(()=>loadRandomPerformanceSample('grainB').then(()=>'',e=>e.message)),/500/);audioFailure=false;
   await popup.waitFor({state:'visible'});assert.match(await popup.innerText(),/500/);
   await popup.getByRole('button',{name:'OK',exact:true}).tap();
   for(const failure of ['empty','network','corrupt']) {
    emptyAudio=failure==='empty';networkFailure=failure==='network';corruptAudio=failure==='corrupt';sequence++;
    const message=await page.evaluate(()=>loadRandomPerformanceSample('grainA').then(()=>'',e=>e.message));assert.ok(message);
    await popup.waitFor({state:'visible'});
    if(emptyAudio)assert.match(await popup.innerText(),/empty audio/);
    await popup.getByRole('button',{name:'OK',exact:true}).tap();
   }
   emptyAudio=false;networkFailure=false;corruptAudio=false;
   assert.deepEqual(await page.evaluate(()=>randomState()),beforeFailure);
   // A partial drum reload remains audible, keeps the failed lane, and reports it.
   drumTest=true;
   await page.evaluate(async()=>{
    const buffer=audioContext.createBuffer(1,22050,22050);buffer.getChannelData(0).fill(.1);
    await applyLoadedDrumMachineSampleBuffer('kick',buffer,{fileName:'kept-kick.wav'});
    window.keptKick=drumMachineKickBuffer;
    await loadRandomDrumMachineSamplesOnly();
   });
   await popup.waitFor({state:'visible'});
   assert.equal(await page.evaluate(()=>drumMachineKickBuffer===window.keptKick),true);
   assert.equal(await page.evaluate(()=>drumMachineSnareMetadata.fileName),'new-drum.wav');
   assert.match(await popup.innerText(),/empty audio/);
   await popup.getByRole('button',{name:'OK',exact:true}).tap();drumTest=false;
   // Empty/rejected sample-browser refreshes also notify, not just random buttons.
   await page.evaluate(()=>{dropboxSampleBrowserTarget=SAMPLE_BROWSER_TARGETS.grainA;setGrainSampleBrowserSourceKey(SAMPLE_BROWSER_TARGETS.grainA,'samples_vocal');});
   empty=true;await page.evaluate(()=>refreshDropboxSampleBrowser());empty=false;
   await popup.waitFor({state:'visible'});assert.match(await popup.innerText(),/list returned empty/);
   await popup.getByRole('button',{name:'OK',exact:true}).tap();
   catalogFailure=true;await page.evaluate(()=>refreshDropboxSampleBrowser());catalogFailure=false;
   await popup.waitFor({state:'visible'});await page.screenshot({path:`${evidence}/${engine}-sample-load-popup.png`});
   await popup.getByRole('button',{name:'OK',exact:true}).tap();
   audioDelay=400;sequence++;
   const pending=page.evaluate(async()=>{
    const old=keyboardSampleBuffer,p=loadRandomPerformanceSample('keyboardSample').then(()=>'',e=>e.message);
    while(!keyboardSampleLoadController)await new Promise(r=>setTimeout(r,10));
    setKeyboardSoundSource('osc');return {message:await p,same:old===keyboardSampleBuffer};
   });
   const cancelled=await pending;assert.ok(cancelled.same);assert.match(cancelled.message,/aborted|cancelled|changed/);audioDelay=0;
   assert.equal(await popup.isVisible(),false,'Intentional source change is not a failed-download popup');
   await page.evaluate(()=>{reportSampleLoadFailure('Grain A',new Error('Empty sample response'));hideSettlePopup();showSettlePopup('Randomisation complete',{force:true});});
   assert.equal(await popup.isVisible(),true,'Completion status must not hide failure popup');
   await popup.getByRole('button',{name:'OK',exact:true}).tap();
   await page.evaluate(()=>{window.__mygrainSongRenderDeck=true;reportSampleLoadFailure('Render deck',new Error('no sample'));window.__mygrainSongRenderDeck=false;});
   assert.equal(await popup.isVisible(),false,'Offscreen Song render must not open UI');
   await page.screenshot({path:`${evidence}/${engine}-sample-alert-dismissed.png`});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(errors,[]);
   const result={engine,uiTargets:3,catalogRequests:catalog.length,downloads:downloads.length,emptyCatalog:true,emptyAudio:true,networkFailure:true,partialDrum:true,previousSamplesKept:true,errors};results.push(result);console.log(JSON.stringify(result));
   await context.close();
  }finally{await browser.close();}
 }
 fs.writeFileSync(`${evidence}/results.json`,JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
