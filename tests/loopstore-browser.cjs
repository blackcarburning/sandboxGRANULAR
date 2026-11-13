'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19219/mygrain/';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
const out=process.env.MYGRAIN_TEST_OUTPUT;
const results=[];
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 if(process.env.MYGRAIN_TEST_ENGINE&&engine!==process.env.MYGRAIN_TEST_ENGINE)continue;
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{for(const phone of [false,true]){
  if(process.env.MYGRAIN_TEST_DEVICE&&phone!==(process.env.MYGRAIN_TEST_DEVICE==='phone'))continue;
  const rate=phone?48000:44100,label=engine+'-'+(phone?'phone':'desktop');
  const context=await browser.newContext({viewport:{width:phone?390:1440,height:phone?844:960},isMobile:phone,hasTouch:phone,...phone?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{}});
  assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
  const p=await context.newPage(),errors=[],requests=[];p.setDefaultTimeout(45000);
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  await p.addInitScript(rate=>{const Native=window.AudioContext;window.AudioContext=new Proxy(Native,{construct(target,args){return new target({...args[0],sampleRate:rate});}});},rate);
  await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();
  await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  await p.evaluate(async()=>{
   stopAllPerformancePlayback({silent:true});applyGlobalBpm(137);syncPatternLengthControls(16,{skipSave:true});
   document.getElementById('performanceExportBars').value='1';setFxMuted(true,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);
   setDrumMachineEnabled(false,{silent:true,skipSave:true});mygrainNoise.restore({enabled:false});mygrainChannelEq.restore();await mygrainResonator.off();await mygrainWasp.restore(null);await mygrainTurntable.off();
   const frames=Math.round(60/137*4*audioContext.sampleRate),src=audioContext.createBuffer(2,frames,audioContext.sampleRate);
   for(let ch=0;ch<2;ch++)for(let i=0;i<frames;i++)src.getChannelData(ch)[i]=.15*Math.cos(2*Math.PI*(ch?173:110)*i/frames);
   bastardLoopBuffer=src;bastardLoopSourceBpm=137;bastardLoopMetadata={bpm:137,durationSeconds:frames/audioContext.sampleRate};
   setBastardLoopEnabled(true,{silent:true,skipSave:true});setLoopLayerSolo('bastarda',{silent:true,skipSave:true});
   window.loopStoreSourceBefore=bastardLoopBuffer;
   const originalRender = renderLiveOutputBarsBuffer;
   renderLiveOutputBarsBuffer = async function(options) {
    const result = await originalRender(options);
    window.loopStoreRaw = Array.from({length:result.audioBuffer.numberOfChannels},(_,ch)=>result.audioBuffer.getChannelData(ch).slice());
    return result;
   };
   const before=saveState({snapshotOnly:true,force:true});delete before.timestamp;window.loopStoreStateBefore=JSON.stringify(before);
  });
  // Actual Actions button -> existing capture worklet -> PCM24 upload. No renderer mocks.
  await p.locator('#sectionJumpActionsBtn').click();
  const add=p.locator('#performanceLoopStoreAddBtn');await add.waitFor({state:'visible'});
  p.once('dialog',d=>d.accept('browser-'+label));
  const upload=p.waitForResponse(r=>r.url().includes('/mygrain-loopstore/api/upload')&&r.request().method()==='POST');
  await add.click();const response=await upload;assert.equal(response.status(),200,await response.text());const saved=await response.json();
  await p.waitForFunction(()=>!document.getElementById('performanceLoopStoreAddBtn').disabled);
  assert(await p.evaluate(()=>{const after=saveState({snapshotOnly:true,force:true});delete after.timestamp;return bastardLoopBuffer===loopStoreSourceBefore&&JSON.stringify(after)===loopStoreStateBefore;}),'render must preserve editor settings and original source buffer');
  assert.equal(saved.loopStore.sampleRate,rate);assert.equal(saved.loopStore.frames,Math.round(60/137*4*rate));assert(saved.loopStore.exactCut);
  const wav=await context.request.get(new URL(saved.url,base).href),bytes=await wav.body();
  assert.equal(bytes.readUInt16LE(34),24);assert.equal(bytes.length-44,saved.loopStore.frames*6);
  const samples=[];for(let i=44;i<bytes.length;i+=6)samples.push(bytes.readIntLE(i,3)/8388608);
  const peak=Math.max(...samples),seam=Math.abs(samples[0]-samples.at(-1));let maxAdjacent=0;
  for(let i=1;i<samples.length;i++)maxAdjacent=Math.max(maxAdjacent,Math.abs(samples[i]-samples[i-1]));
  assert(peak>.01&&samples.every(Number.isFinite));
  const normalisation=await p.evaluate(async url=>{
   const v=new DataView(await (await fetch(url)).arrayBuffer()),channels=v.getUint16(22,true),raw=loopStoreRaw;
   let sourcePeak=0,maxError=0,savedPeak=0;
   for(const data of raw)for(const x of data)sourcePeak=Math.max(sourcePeak,Math.abs(x));
   for(let i=0;i<raw[0].length;i++)for(let ch=0;ch<channels;ch++){
    const offset=44+(i*channels+ch)*3,word=v.getUint8(offset)|(v.getUint8(offset+1)<<8)|(v.getInt8(offset+2)<<16),value=word/8388608;
    savedPeak=Math.max(savedPeak,Math.abs(value));maxError=Math.max(maxError,Math.abs(value-raw[ch][i]/sourcePeak));
   }
   return{sourcePeak,savedPeak,maxError,channels};
  },new URL(saved.url,base).href);
  assert(normalisation.sourcePeak>0&&normalisation.sourcePeak<.9);
  assert(Math.abs(normalisation.savedPeak-1)<2/8388608,JSON.stringify(normalisation));
  assert(normalisation.maxError<3/8388608,'every saved sample must use the same stereo-linked gain: '+JSON.stringify(normalisation));
  assert.match(await add.getAttribute('title'),/peak-normalises.*0 dBFS/);
  assert.match(await p.locator('#sectionJumpLoopStoreAddBtn').getAttribute('title'),/WAV Browser exports are not normalised/);assert(seam<maxAdjacent*1.2,JSON.stringify({label,seam,maxAdjacent,head:samples.slice(0,6),tail:samples.slice(-6)}));
  // Open using the added Jump shortcut, not a test-only browser entry point.
  await p.locator('#sectionJumpHandle').click();
  await p.locator('#sectionJumpDrawer [data-jump-click="#performanceLoopStoreBrowserBtn"]').click();
  await p.waitForFunction(()=>document.getElementById('wavRepositoryBrowserTitle').textContent==='Loop Store Browser'&&document.querySelectorAll('#wavRepositoryBrowserList .sample-browser-card').length>0);
  assert.equal(await p.locator('#wavRepositoryBrowserList textarea').count(),0);
  assert.equal(await p.locator('#wavRepositoryBrowserList .sample-browser-feedback').count(),0);
  assert.equal(await p.locator('#wavRepositoryBrowserList [data-mygrain-share]').count(),0);
  assert.equal(await p.locator('#wavRepositoryBrowserList .wav-library-sections').count(),0);
  await p.locator('#wavRepositoryBrowserFilter').fill(saved.savedName);
  await p.waitForFunction(()=>document.querySelectorAll('#wavRepositoryBrowserList .sample-browser-card').length===1);
  const row=p.locator('#wavRepositoryBrowserList .sample-browser-card');assert((await row.textContent()).includes('Exact cut'));
  const player=row.locator('.wav-iphone-preview'),loop=player.locator('.wav-preview-loop'),play=player.locator('.wav-preview-play');
  const geometry=()=>player.evaluate(el=>[...el.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect(),p=el.getBoundingClientRect();return{x:r.x-p.x,y:r.y-p.y,width:r.width};}));
  const before=await geometry();assert(before.every(x=>x.width===108));
  await loop.click();if(phone)await play.click();
  await p.waitForFunction(()=>document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview.source?.loop);
  const pcm=await p.evaluate(async()=>{
   const api=document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview,source=api.source;
   const proc=audioContext.createScriptProcessor(1024,1,1),mute=audioContext.createGain();mute.gain.value=0;
   source.connect(proc);proc.connect(mute);mute.connect(audioContext.destination);
   let frames=0,sum=0,peak=0,blocks=0;await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('No loop PCM')),8000);proc.onaudioprocess=e=>{const a=e.inputBuffer.getChannelData(0);if(blocks++>1)for(const x of a){sum+=x*x;peak=Math.max(peak,Math.abs(x));frames++;}if(frames>audioContext.sampleRate*2){clearTimeout(timeout);resolve();}};});
   source.disconnect(proc);proc.disconnect();mute.disconnect();return{rms:Math.sqrt(sum/frames),peak,frames,sameSource:api.source===source,bufferFrames:api.buffer.length,rate:api.buffer.sampleRate,loop:source.loop};
  });
  assert(pcm.rms>.005&&pcm.peak>.01&&pcm.sameSource&&pcm.loop);assert.equal(pcm.bufferFrames,saved.loopStore.frames);
  assert.deepEqual(await geometry(),before);assert(!requests.some(r=>r.url.includes('/api/wav-preview')),'Loop Store must use original PCM');
  await play.click();assert.equal(await play.textContent(),'Play');await play.click();
  await p.waitForFunction(()=>document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview.playing);
  if(phone){
   if(out)await p.screenshot({path:out+'/'+label+'-portrait.png'});
   const pageY=await p.evaluate(()=>scrollY);await p.setViewportSize({width:844,height:390});await play.scrollIntoViewIfNeeded();
   const bounds=await play.boundingBox();assert(bounds.y>=0&&bounds.y+bounds.height<=390);assert.equal(await p.evaluate(()=>scrollY),pageY);
   assert(await play.isVisible());assert(await loop.isVisible());
  }
  if(out)await p.screenshot({path:out+'/'+label+'.png'});
  await p.evaluate(()=>{window.retired=[...document.querySelectorAll('#wavRepositoryBrowserList audio')].map(a=>a.__mygrainIphonePreview);closeWavRepositoryBrowser();});
  assert(await p.evaluate(()=>retired.every(x=>!x.source&&!x.buffer)));
  // Exercise visible management controls against the real shared repository.
  if(phone){
   await p.evaluate(()=>openLoopStoreBrowser());await p.waitForFunction(()=>!wavRepositoryBrowserLoading);
   await p.locator('#wavRepositoryBrowserFilter').fill(saved.savedName);await p.waitForFunction(()=>document.querySelectorAll('#wavRepositoryBrowserList .sample-browser-card').length===1);
   const newName='managed-'+label+'-'+Date.now()+'.wav';p.once('dialog',d=>d.accept(newName));
   const renamedResponse=p.waitForResponse(r=>r.url().includes('/mygrain-loopstore/api/rename'));
   await p.locator('#wavRepositoryBrowserList').getByRole('button',{name:'Rename WAV',exact:true}).click();
   const rename=await renamedResponse;assert.equal(rename.status(),200);const renamed=await rename.json();
   assert((await (await context.request.get(new URL(renamed.url,base).href)).body()).equals(bytes),'rename preserves PCM bytes');
   await p.locator('#wavRepositoryBrowserFilter').fill(renamed.savedName);await p.waitForFunction(()=>!wavRepositoryBrowserLoading&&document.querySelectorAll('#wavRepositoryBrowserList .sample-browser-card').length===1);
   p.once('dialog',d=>d.dismiss());const deleteCount=requests.filter(r=>r.method==='DELETE').length;
   await p.locator('#wavRepositoryBrowserList').getByRole('button',{name:'Delete WAV',exact:true}).click();assert.equal(requests.filter(r=>r.method==='DELETE').length,deleteCount);
   p.once('dialog',d=>d.accept());const removedResponse=p.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().includes('/mygrain-loopstore/api/delete'));
   await p.locator('#wavRepositoryBrowserList').getByRole('button',{name:'Delete WAV',exact:true}).click();assert.equal((await removedResponse).status(),200);
   assert.equal((await context.request.get(new URL(renamed.url,base).href)).status(),404);await p.evaluate(()=>closeWavRepositoryBrowser());
  }
  // Ordinary WAV and Masters browser must recover their own controls and URL.
  await p.evaluate(()=>openWavRepositoryBrowser());await p.waitForFunction(()=>!wavRepositoryBrowserLoading);
  assert.equal(await p.locator('#wavRepositoryBrowserTitle').textContent(),'WAV Repository Browser');assert.equal(await p.locator('#wavRepositoryBrowserList .wav-library-sections').count(),1);
  await p.evaluate(()=>{closeWavRepositoryBrowser();openLoopStoreBrowser();});await p.waitForFunction(()=>!wavRepositoryBrowserLoading);
  await p.evaluate(()=>{closeWavRepositoryBrowser();openWavMastersBrowser();});await p.waitForFunction(()=>!wavRepositoryBrowserLoading);
  assert.equal(await p.locator('#wavRepositoryBrowserList').getAttribute('data-section'),'masters');
  if(engine==='chromium'&&!phone){
   await p.evaluate(()=>{closeWavRepositoryBrowser();syncPatternLengthControls(32,{skipSave:true});window.loopStoreRenderCalls=0;window.originalLoopStoreRender=renderDawReadyBarsExport;renderDawReadyBarsExport=(...args)=>{loopStoreRenderCalls++;return originalLoopStoreRender(...args);};});
   const uploadsBefore=requests.filter(r=>r.method==='POST'&&r.url.includes('/mygrain-loopstore/api/upload')).length;
   await add.click();await p.locator('#exportLengthDialog').waitFor();await p.locator('#exportLengthDialog').getByRole('button',{name:'Cancel',exact:true}).click();
   await p.waitForFunction(()=>!document.getElementById('performanceLoopStoreAddBtn').disabled);
   assert.equal(await p.evaluate(()=>loopStoreRenderCalls),0);
   await add.click();await p.locator('#exportLengthDialog').waitFor();await p.keyboard.press('Escape');
   await p.waitForFunction(()=>!document.getElementById('performanceLoopStoreAddBtn').disabled);
   assert.equal(await p.evaluate(()=>loopStoreRenderCalls),0);
   assert.equal(requests.filter(r=>r.method==='POST'&&r.url.includes('/mygrain-loopstore/api/upload')).length,uploadsBefore);
   await p.evaluate(()=>{renderDawReadyBarsExport=originalLoopStoreRender;syncPatternLengthControls(16,{skipSave:true});});
   // Account locking during the actual warm-up/capture must never upload later.
   await add.click();await p.waitForFunction(()=>document.getElementById('performanceLoopStoreAddBtn').textContent==='Rendering loop…');
   await p.evaluate(()=>window.dispatchEvent(new Event('mygrain-account-lock')));
   await p.waitForFunction(()=>!document.getElementById('performanceLoopStoreAddBtn').disabled);
   assert.equal(requests.filter(r=>r.method==='POST'&&r.url.includes('/mygrain-loopstore/api/upload')).length,uploadsBefore);
  }
  await p.evaluate(()=>{closeWavRepositoryBrowser();openLoopStoreBrowser();});await p.waitForFunction(()=>!wavRepositoryBrowserLoading);
  await p.evaluate(()=>window.dispatchEvent(new Event('mygrain-account-lock')));
  assert(await p.locator('#wavRepositoryBrowserOverlay').evaluate(e=>e.hidden));assert.deepEqual(errors,[]);
  results.push({label,rate,frames:saved.loopStore.frames,normalisation,seam,maxAdjacent,pcm,errors});console.log('PASS',label,JSON.stringify(results.at(-1)));await context.close();
 }}finally{await browser.close();}
}if(out)fs.writeFileSync(out+'/browser.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
