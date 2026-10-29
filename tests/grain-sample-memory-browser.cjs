'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18949/mygrain/';
assert.match(base,/^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 if(process.env.GRAIN_ENGINE&&process.env.GRAIN_ENGINE!==engine)continue;
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{if(process.env.GRAIN_OLD_INDEX&&r.request().url()===base)return r.fulfill({contentType:'text/html',body:fs.readFileSync(process.env.GRAIN_OLD_INDEX,'utf8')});const u=new URL(r.request().url()),identity={authenticated:true,ok:true,user:{username:'grain-memory-fixture'}};if(u.origin!==new URL(base).origin)return r.abort();if(!['GET','HEAD'].includes(r.request().method()))return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext='+JSON.stringify(identity)});if(u.pathname.includes('/api/'))return r.fulfill({json:{...identity,files:[],songs:[],folders:[],stations:[],samples:[],patches:[]}});return r.continue()});
 async function start(){await page.goto(base);await page.waitForFunction(()=>window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);}
 const state=()=>page.evaluate(async()=>Promise.all(['grainASample','grainBSample'].map(async kind=>{const b=getSourceBuffer(kind);return {name:getGrainSampleMetadata(kind)?.fileName,rate:b.sampleRate,length:b.length,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b.getChannelData(0)))).join(',')}}))); // hashes compare exact saved Float32 PCM
 await start();
 await page.evaluate(async()=>{
  window.loadFixture=async(target,frequency,name)=>{const b=audioContext.createBuffer(1,Math.floor(audioContext.sampleRate*.25),audioContext.sampleRate);const d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=.2*Math.sin(2*Math.PI*frequency*i/b.sampleRate);await loadGranularBrowserSampleFromResponse(new Response(audioBufferToWav(b),{headers:{'X-Mygrain-Source-Name':name,'X-Mygrain-Source-Key':'samples_vocal'}}),target,{fileName:name});};
  await loadFixture('grainA',220,'old-A.wav');await loadFixture('grainB',330,'old-B.wav');window.oldGrainA=grainASampleBuffer;
  await loadFixture('grainA',440,'custom-A.wav');await loadFixture('grainB',660,'custom-B.wav');
 });
 const expected=await state();await start();assert.deepEqual(await state(),expected,'Custom A/B PCM and names must survive normal reload');
 // Simulate an obsolete queued Song persistence write arriving after a new sample.
 await page.evaluate(async()=>{window.stale=grainASampleBuffer;const b=audioContext.createBuffer(1,12345,audioContext.sampleRate);b.getChannelData(0).fill(.123);setGrainSampleMetadata('grainASample',{fileName:'latest-custom-A.wav',sourceKey:'samples_vocal'});await applyLoadedAudioBuffer(b,'Latest custom A','grainASample');saveState({force:true});await saveAudioBufferToDB(stale,GRAIN_A_SAMPLE_AUDIO_BUFFER_KEY);await clearAudioBufferFromDB(GRAIN_B_SAMPLE_AUDIO_BUFFER_KEY);});
 const latest=await state();await start();assert.deepEqual(await state(),latest,'Late old write must not resurrect a previous sample');
 // Local settings can be older than the last committed audio (tab killed during saving).
 await page.evaluate(()=>{const s=readStoredStateSnapshot();s.modes.grainASampleFileName='ancient-A.wav';s.modes.grainBSampleFileName='ancient-B.wav';localStorage.setItem(STATE_STORAGE_KEY,JSON.stringify(s));});
 await start();assert.deepEqual(await state(),latest,'Audio checkpoint owns its matching source identity');
 const failure=await page.evaluate(async()=>{const original=openAudioDB;openAudioDB=async()=>{throw new DOMException('Fixture quota exhausted','QuotaExceededError')};let rejected=false;try{await loadGranularBrowserSampleFromResponse(new Response(audioBufferToWav(grainBSampleBuffer),{headers:{'X-Mygrain-Source-Name':'must-not-stick.wav','X-Mygrain-Source-Key':'samples_vocal'}}),'grainA',{fileName:'must-not-stick.wav'})}catch{rejected=true}finally{openAudioDB=original}return{rejected,status:document.getElementById('status').textContent}});
 assert(failure.rejected);assert.match(failure.status,/could not be remembered/);assert.deepEqual(await state(),latest,'Failed load restores previous playing sample and metadata');await start();assert.deepEqual(await state(),latest,'Failed save must retain last good checkpoint');
 // Pre-fix IndexedDB records without checkpoint metadata remain readable.
 await page.evaluate(async()=>{const db=await openAudioDB();await new Promise((resolve,reject)=>{const t=db.transaction(AUDIO_STORE_NAME,'readwrite'),store=t.objectStore(AUDIO_STORE_NAME),r=store.get(GRAIN_B_SAMPLE_AUDIO_BUFFER_KEY);r.onsuccess=()=>{const d=r.result;delete d.sourceMetadata;store.put(d,GRAIN_B_SAMPLE_AUDIO_BUFFER_KEY)};t.oncomplete=resolve;t.onerror=()=>reject(t.error)});db.close()});await start();assert.deepEqual(await state(),latest,'Legacy PCM records remain compatible');
 assert.deepEqual(errors,[]);console.log('PASS',engine,'A/B custom PCM reload, obsolete write protection, atomic names, explicit quota failure, prior checkpoint retained');await ctx.close();
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
