'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs');
const {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'https://openclaw.blackcarburning.com/mygrain/';
const out=process.env.MYGRAIN_GRAIN_EVIDENCE||'/tmp/mygrain-granular-ab-random';fs.mkdirSync(out,{recursive:true});
const sources=require('../random-performance-samples.js').sources;
function wav(freq){const b=Buffer.alloc(44+22050);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(88200,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(22050,40);for(let i=0;i<11025;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*freq/44100)*5000),44+i*2);return b}
(async()=>{const results=[];for(const[engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{
 const context=await browser.newContext({viewport:{width:1280,height:900}}),p=await context.newPage(),errors=[],downloads=[],catalogs=[];
 let counter=0, fail=false, empty=false, delay=0;
 p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(60000);
 await p.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());if(u.origin!==new URL(base).origin||!['GET','HEAD'].includes(req.method()))return route.abort();
  if(u.pathname.endsWith('/account-context.js'))return route.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"grain-batch-fixture"}};'});
  if(u.pathname.endsWith('/api/source-files')){
   const key=u.searchParams.get('source');assert(sources.includes(key));catalogs.push(key);
   const name=`fresh-${++counter}.wav`;
   return route.fulfill({json:{ok:true,sourceKey:key,files:[{sourceKey:key,name:'drum.wav',relativePath:'Drums/drum.wav'},{sourceKey:key,name:'bass.wav',relativePath:'Bass/bass.wav'},...(empty?[]:[{sourceKey:key,name,relativePath:'Tonal/'+name}])]}});
  }
  if(u.pathname.endsWith('/api/source-sample')){
   const key=u.searchParams.get('source'),path=u.searchParams.get('path');assert(sources.includes(key));assert.match(path,/^Tonal\/fresh-\d+\.wav$/);downloads.push({key,path});
   if(delay)await new Promise(r=>setTimeout(r,delay));
   if(fail)return route.fulfill({status:503,json:{error:'fixture sample unavailable'}});
   const n=Number(path.match(/\d+/)[0]);return route.fulfill({contentType:'audio/wav',headers:{'X-Mygrain-Source-Key':key,'X-Mygrain-Source-Path':path,'X-Mygrain-Source-Name':path.split('/').pop()},body:wav(200+n*37)});
  }
  if(u.pathname.includes('/api/'))return route.fulfill({json:{ok:true,authenticated:true,user:{username:'grain-batch-fixture'},files:[],songs:[],folders:[],samples:[],patches:[],stations:[]}});
  return route.continue();
 });
 async function start(){await p.goto(base);await p.waitForFunction(()=>window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy)}
 await start();console.log(engine,'ready');
 await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});stopModulationLoop();stopPerformanceMixerVuMeters();
  window.batchState=async()=>Promise.all(['grainASample','grainBSample'].map(async kind=>{const b=getSourceBuffer(kind),meta=getGrainSampleMetadata(kind);return{meta,selector:document.getElementById(kind==='grainASample'?'grainSynthASource':'grainSynthBSource').value,length:b?.length,hash:b?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b.getChannelData(0)))).join(','):null}}));
  // Keep the production Mega/Sparse coordinator and A/B loader. Unrelated
  // generators are isolated so the fixture never writes or builds server audio.
  for(const name of ['generateSourceWithPlaybackRestart','loadBastardLoopLSampleFromSource','loadBastardLoopXSampleFromSource','loadDropboxSampleLayerFromSource','loadRandomDrumMachineSamples'])window[name]=async()=>null;
  requestMegaRandomBastardLoopBuild=async()=>null;applyMegaRandomBastardLoopBuild=async()=>null;randomizeBastardLoopWCut=()=>{};restartAllTransport=()=>{};
  for(const[target,frequency]of [['grainA',123],['grainB',456]]){const b=audioContext.createBuffer(1,11025,44100),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=.1*Math.sin(i*2*Math.PI*frequency/44100);await loadGranularBrowserSampleFromResponse(new Response(audioBufferToWav(b),{headers:{'X-Mygrain-Source-Name':target+'-old.wav','X-Mygrain-Source-Key':'samples_vocal'}}),target)}
 });
 const modes=[];
 for(const sparseMode of [true,false,true,false]){
  const before=await p.evaluate(()=>batchState()),count=await p.evaluate(()=>mygrainCardHistory.counts.undo),n=downloads.length;
  await p.evaluate(sparseMode=>runMegaRandomization({sparseMode}),sparseMode);
  const after=await p.evaluate(()=>batchState());assert.equal(downloads.length-n,2);
  for(let i=0;i<2;i++){assert.notEqual(after[i].meta.fileName,before[i].meta.fileName);assert.notEqual(after[i].hash,before[i].hash);assert.equal(after[i].selector,i?'grainBSample':'grainASample');assert(after[i].length>1000)}
  assert.equal(await p.evaluate(()=>mygrainCardHistory.counts.undo),count+1);
  await p.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual(await p.evaluate(()=>batchState()),before);
  await p.evaluate(()=>mygrainCardHistory.redo());assert.deepEqual(await p.evaluate(()=>batchState()),after);
  modes.push({mode:sparseMode?'sparse':'mega',after});console.log(engine,sparseMode?'sparse':'mega','fresh A/B and single Undo/Redo PASS');
 }
 const beforeNormal=await p.evaluate(()=>batchState()),n=downloads.length;await p.evaluate(()=>runPatchRandomization());assert.deepEqual(await p.evaluate(()=>batchState()),beforeNormal);assert.equal(downloads.length,n);
 // Each failed load keeps its previous PCM and metadata and reports a warning.
 fail=true;const beforeFailure=await p.evaluate(()=>batchState());await p.evaluate(()=>runMegaRandomization({sparseMode:true}));assert.deepEqual(await p.evaluate(()=>batchState()),beforeFailure);assert.match(await p.locator('#status').textContent(),/Grain A:.*fixture sample unavailable.*Grain B:.*fixture sample unavailable/);fail=false;
 empty=true;await p.evaluate(()=>runMegaRandomization());assert.deepEqual(await p.evaluate(()=>batchState()),beforeFailure);assert.match(await p.locator('#status').textContent(),/No new eligible samples/);empty=false;
 // A competing replacement while the download is pending must win.
 delay=450;
 const cancelled=await p.evaluate(async()=>{const previous=grainASampleBuffer;megaRandomizeInFlight=true;const promise=loadMegaRandomGranularSample('grainA').then(()=>'',e=>e.message);await new Promise(r=>setTimeout(r,150));grainASampleBuffer=audioContext.createBuffer(1,777,44100);const winner=grainASampleBuffer;let message;try{message=await promise;return{message,preserved:grainASampleBuffer===winner}}finally{grainASampleBuffer=previous;megaRandomizeInFlight=false}});
 assert(cancelled.preserved);assert.match(cancelled.message,/cancelled/);delay=0;
 const expected=await p.evaluate(async()=>{saveState({force:true});await mygrainSongBetaAdapter.whenPersisted();return batchState()});
 await start();const restored=await p.evaluate(async()=>Promise.all(['grainASample','grainBSample'].map(async kind=>{const b=getSourceBuffer(kind);return{meta:getGrainSampleMetadata(kind),selector:document.getElementById(kind==='grainASample'?'grainSynthASource':'grainSynthBSource').value,length:b.length,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b.getChannelData(0)))).join(',')}})));
 assert.deepEqual(restored,expected);assert.deepEqual(errors,[]);
 results.push({engine,modes,cancelled,catalogs,downloads,reload:true});console.log('PASS',engine,'normal Randomise unchanged; failed/empty loads preserved; mutation cancellation; exact A/B PCM reload');await context.close();
 }finally{await browser.close()}
}fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2))})().catch(e=>{console.error(e);process.exitCode=1});
