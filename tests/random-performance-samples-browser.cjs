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
   assert.equal((await context.request.post(base+'api/auth/register',{data:{username:`rand_${engine[0]}_${Date.now()}`,password:'disposable-random-samples'}})).status(),200);
   const page=await context.newPage(), errors=[], catalog=[], downloads=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
   let available='samples_vocal', sequence=0, audioFailure=false, audioDelay=0, empty=false;
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/api/source-files')) {
     const key=url.searchParams.get('source');assert.ok(sources.includes(key),'Forbidden root requested: '+key);catalog.push(key);
     const name=`fixture-${sequence}.wav`;
     return route.fulfill({json:{ok:true,sourceKey:key,files:[
      {sourceKey:key,name:'drum.wav',relativePath:'Drums/drum.wav'},
      {sourceKey:key,name:'bass.wav',relativePath:'Bass/bass.wav'},
      {sourceKey:'samples_bass',name:'foreign.wav',relativePath:'foreign.wav'},
      ...(key===available&&!empty?[{sourceKey:key,name,relativePath:`Tonal/${name}`,previewUrl:'https://bad.test/bass.wav'}]:[])
     ]}});
    }
    if(url.pathname.endsWith('/api/source-sample')) {
     const key=url.searchParams.get('source'),path=url.searchParams.get('path');
     assert.ok(sources.includes(key));assert.match(path,/^Tonal\/fixture-\d+\.wav$/);downloads.push({sourceKey:key,path});
     if(audioDelay)await new Promise(r=>setTimeout(r,audioDelay));
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
    // Keep Random reachable even with the corresponding Mic panel selected.
    if(target!=='keyboardSample')await page.locator(`[data-grain-source-mode-btn="${target==='grainA'?'A':'B'}"][data-source-mode="${target==='grainA'?'grainAMic':'grainBMic'}"]`).tap();
    await page.locator(selector).scrollIntoViewIfNeeded();assert.equal(await page.locator(selector).isVisible(),true);await page.locator(selector).tap();
    await page.waitForFunction(()=>!randomPerformanceSampleLoadController&&!mygrainCardHistory.busy);
    const after=await page.evaluate(()=>randomState());assert.equal(after[slot],`fixture-${sequence}.wav`);
    await page.screenshot({path:`${evidence}/${engine}-${target}-phone.png`});
    for(const other of ['a','b','k'].filter(s=>s!==slot))assert.equal(after[other],before[other]);
    assert.deepEqual(after.controls,['73','187']);assert.ok(after.pcm[targets.findIndex(t=>t[0]===target)].energy>1);
    assert.equal((await page.evaluate(()=>mygrainCardHistory.counts)).undo,counts.undo+1);
    await page.evaluate(()=>mygrainCardHistory.undo());assert.equal((await page.evaluate(()=>randomState()))[slot],before[slot]);
    await page.evaluate(()=>mygrainCardHistory.redo());assert.equal((await page.evaluate(()=>randomState()))[slot],after[slot]);
   }
   // Every target must reach every permitted folder, independent of the manual browser selection.
   for(const [target,,slot] of targets)for(const source of sources){
    available=source;sequence++;
    await page.evaluate(target=>loadRandomPerformanceSample(target),target);
    assert.equal((await page.evaluate(()=>randomState()))[slot],`fixture-${sequence}.wav`);
   }
   const beforeFailure=await page.evaluate(()=>({state:randomState(),counts:mygrainCardHistory.counts}));empty=true;
   assert.match(await page.evaluate(()=>loadRandomPerformanceSample('grainA').then(()=>'',e=>e.message)),/No new eligible samples/);empty=false;
   audioFailure=true;sequence++;
   assert.match(await page.evaluate(()=>loadRandomPerformanceSample('grainB').then(()=>'',e=>e.message)),/500/);audioFailure=false;
   assert.deepEqual(await page.evaluate(()=>({state:randomState(),counts:mygrainCardHistory.counts})),beforeFailure);
   audioDelay=400;sequence++;
   const pending=page.evaluate(async()=>{
    const old=keyboardSampleBuffer,p=loadRandomPerformanceSample('keyboardSample').then(()=>'',e=>e.message);
    while(!keyboardSampleLoadController)await new Promise(r=>setTimeout(r,10));
    setKeyboardSoundSource('osc');return {message:await p,same:old===keyboardSampleBuffer};
   });
   const cancelled=await pending;assert.ok(cancelled.same);assert.match(cancelled.message,/aborted|cancelled|changed/);audioDelay=0;
   // Real Song amendment and portable recall, without touching production data.
   const song=await page.evaluate(async()=>{
    const c=mygrainSongBeta;document.getElementById('songBetaName').value='Disposable random sample amendment';
    await c.newSong();await c.newPart({name:'Random sources',repeats:1});await c.finishEditing();
    await c.run(()=>c.amendPart(c.song.parts[0]));return {editing:!!c.editing};
   });assert.ok(song.editing);
   for(const [target]of targets){sequence++;available='samples_piano';await page.evaluate(target=>loadRandomPerformanceSample(target),target);}
   const saved=await page.evaluate(async()=>{
    const c=mygrainSongBeta,expected=randomState();await c.run(()=>c.savePart());await c.finishEditing();
    setKeyboardSampleBuffer(null);grainASampleBuffer=null;grainBSampleBuffer=null;
    await c.recall(c.song.parts[0],{start:false});saveState({force:true});await mygrainSongBetaAdapter.whenPersisted();
    return {expected,recalled:randomState()};
   });
   // Portable Song audio is 16-bit WAV: compare identity/duration exactly and
   // energy within quantization tolerance, not decoded Float32 bit patterns.
   assert.deepEqual({...saved.recalled,pcm:null},{...saved.expected,pcm:null});
   saved.expected.pcm.forEach((pcm,index)=>{
    assert.equal(saved.recalled.pcm[index].seconds,pcm.seconds);
    assert.ok(Math.abs(saved.recalled.pcm[index].energy/pcm.energy-1)<.001);
   });
   await page.screenshot({path:`${evidence}/${engine}-random-sample-phone.png`});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const beforeReload=downloads.length;await page.reload();await start();
   const recalled=await page.evaluate(()=>({a:grainASampleMetadata?.fileName,b:grainBSampleMetadata?.fileName,k:keyboardSampleMetadata?.fileName,seconds:[grainASampleBuffer,grainBSampleBuffer,keyboardSampleBuffer].map(b=>b?.duration)}));
   assert.deepEqual([recalled.a,recalled.b,recalled.k],[saved.expected.a,saved.expected.b,saved.expected.k]);
   // WebKit's native resampler can trim one frame when restoring a WAV.
   assert.ok(recalled.seconds.every(seconds=>Math.abs(seconds-1)<1/22050));assert.equal(downloads.length,beforeReload);
   assert.deepEqual(errors,[]);
   const result={engine,uiTargets:3,allowedFolders:sources,catalogRequests:catalog.length,downloads:downloads.length,saved:recalled,errors};results.push(result);console.log(JSON.stringify(result));
   await context.close();
  }finally{await browser.close();}
 }
 fs.writeFileSync(`${evidence}/results.json`,JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
