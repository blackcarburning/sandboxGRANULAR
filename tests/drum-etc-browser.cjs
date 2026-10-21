// Local disposable stores only; no production songs or generation requests.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18889/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence=process.env.ETC_EVIDENCE||'/tmp/mygrain-etc';fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const results=[];
 for(const [engine,type] of Object.entries({chromium,webkit})){
  const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{for(const mobile of [false,true]){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
   assert.equal((await context.request.post(base+'api/auth/register',{data:{username:`etc_${engine}_${mobile}_${Date.now()}`,password:'isolated-etc-fixture'}})).status(),200);
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(40000);page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   await page.goto(base);await page.waitForFunction(()=>window.mygrainSongBeta&&!mygrainSongBeta.busy&&document.documentElement.dataset.mygrainStartup==='ready');
   await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
   await page.evaluate(async()=>{
    stopAllPerformancePlayback({silent:true});setLoopLayerSolo('none',{silent:true,skipSave:true});applyGlobalBpm(240);syncPatternLengthControls(16,{skipSave:true});
    window.etcFingerprint=async()=>{const t=drumMachineExtraTracks.etc;const hash=async b=>b?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b.getChannelData(0).buffer))).join(','):null;return {state:captureExtraDrumMachineTracks().etc,hash:await hash(t.buffer),crashHash:await hash(drumMachineExtraTracks.cymbals.buffer),tone:getDrumMachineToneOptions('etc',true)}};
    for(const [kind,frequency] of [['etc',317],['cymbals',911]]){
     const buffer=audioContext.createBuffer(2,Math.round(audioContext.sampleRate*.45),audioContext.sampleRate);
     for(let c=0;c<2;c++){const values=buffer.getChannelData(c);for(let i=0;i<values.length;i++)values[i]=.23*Math.sin(2*Math.PI*(frequency+c*101)*i/audioContext.sampleRate);}
     await applyLoadedDrumMachineSampleBuffer(kind,buffer,{sourceKey:'samples_crash',fileName:`manual-${kind}.wav`,relativePath:`manual-${kind}.wav`});
    }
    drumMachineKickPattern.fill(false);drumMachineSnarePattern.fill(false);drumMachineHatPattern.fill(false);drumMachinePercPattern.fill(false);
    for(const t of Object.values(drumMachineExtraTracks)){t.pattern.fill(false);t.ratchets.fill(0);t.accents.fill(false);}
    openDrumMachineOverlay();
   });
   assert.equal(await page.locator('.drum-machine-jumps button').count(),7);
   const jump=page.locator('[data-drum-jump="etc"]');assert.equal(await jump.textContent(),'ETC');await jump.click();
   assert.equal(await jump.getAttribute('aria-current'),'true');assert.equal(await jump.getAttribute('aria-controls'),'drumMachineLane-etc');
   assert.equal(await page.locator('#drumMachineEtcRandomBtn, #drumMachineEtcPatternBtn').count(),0);
   assert.equal(await page.locator('#drumMachineEtcGrid .drum-machine-step-btn').count(),16);
   assert.equal(await page.locator('#drumMachineEtcGrid .drum-machine-accent-btn').count(),16);
   await page.locator('#drumMachineEtcGrid .drum-machine-step-btn').nth(7).click();
   await page.locator('#drumMachineEtcGrid .drum-machine-accent-btn').nth(7).click();
   await page.locator('#drumMachineEtcGrid .drum-machine-ratchet-btn').nth(7).click();
   await page.evaluate(()=>{for(const [suffix,value] of Object.entries({Pitch:7,Level:61,Decay:83,Length:75,AccentAmount:80,FilterCutoff:87,FilterEnv:64})){const el=document.getElementById('drumMachineEtc'+suffix);el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));}});
   assert.equal(await page.locator('#drumMachineEtcGrid .drum-machine-accent-btn').nth(7).getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator('#drumMachineCymbalsGrid .drum-machine-accent-btn').nth(7).getAttribute('aria-pressed'),'false');
   const initial=await page.evaluate(()=>etcFingerprint());
   assert(initial.state.pattern[7]&&initial.state.accents[7]);assert.equal(initial.state.ratchets[7],2);assert.notEqual(initial.hash,initial.crashHash);
   assert.equal(await page.evaluate(()=>drumMachineExtraTracks.cymbals.pattern.some(Boolean)),false);
   assert.equal(await page.evaluate(()=>getDrumMachineToneOptions('cymbals').cutoff),100);
   const manual=await page.evaluate(()=>{const c=getSampleBrowserTargetConfig('drumMachineEtc');return {kind:c.drumKind,title:c.title,source:c.sourceKey}});
   assert.deepEqual(manual,{kind:'etc',title:'ETC Browser',source:'samples_crash'});
   // Use the actual Browse ETC -> Load ETC UI and decoder with a local WAV.
   const urls=await page.evaluate(()=>({files:DROPBOX_SAMPLE_SOURCE_FILES_API_URL+'?source=samples_crash',sample:buildDropboxSampleSourcePreviewUrl('samples_crash','manual-etc.wav')}));
   const wav=Buffer.from(await page.evaluate(()=>Array.from(new Uint8Array(audioBufferToWav24bit(drumMachineExtraTracks.etc.buffer)))));
   let manualLoads=0;
   await page.route(urls.files,r=>r.fulfill({json:{ok:true,sourceLabel:'SAMPLES_CRASH',files:[{name:'manual-etc.wav',relativePath:'manual-etc.wav',sourceKey:'samples_crash',previewUrl:urls.sample}]}}));
   await page.route(urls.sample,r=>{manualLoads++;return r.fulfill({contentType:'audio/wav',body:wav});});
   await page.locator('#drumMachineEtcBrowseBtn').click();
   await page.locator('#dropboxSampleBrowserOverlay').getByRole('button',{name:'Load ETC',exact:true}).click();
   await page.waitForFunction(()=>document.getElementById('dropboxSampleBrowserOverlay').hidden&&!drumMachineLoadInFlight);
   assert.equal(manualLoads,1);assert.equal((await page.evaluate(()=>etcFingerprint())).crashHash,initial.crashHash);
   // The lane must produce audio by itself through the actual drum transport/mix.
   await page.evaluate(()=>{
    setDrumMachineEnabled(true,{silent:true,skipSave:true});setSliderValue('performanceDrumMachineLevel',70);
    window.etcStarted=[];const play=playDrumMachineHit;
    playDrumMachineHit=(buffer,...args)=>{if(buffer===drumMachineExtraTracks.etc.buffer)etcStarted.push(args[0]);return play(buffer,...args)};
    drumMachineExtraTracks.etc.pattern.fill(false);drumMachineExtraTracks.etc.pattern[0]=true;drumMachineExtraTracks.etc.pattern[7]=true;
    startDrumMachine();
   });
   await page.waitForFunction(()=>etcStarted.length>0);
   let peak=0;for(let i=0;i<10;i++){peak=Math.max(peak,await page.evaluate(()=>{const a=new Float32Array(finalPanAnalyser.fftSize);finalPanAnalyser.getFloatTimeDomainData(a);return Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length)}));await page.waitForTimeout(35);}
   assert(peak>.0001,`${engine}/${mobile} silent ETC: ${peak}`);
   await page.evaluate(()=>{stopDrumMachine({silent:true,skipSave:true});drumMachineExtraTracks.etc.pattern[0]=false;saveState();});
   // A standalone audio slot is captured and restored, not aliased onto Crash.
   const portable=await page.evaluate(async()=>{
    const blob=await mygrainSongBetaAdapter.capture();window.etcArchive=await blob.arrayBuffer();window.etcPart=await mygrainSongBetaAdapter.decode(etcArchive,{buffers:new Map(),bytes:0,limitBytes:128*1024*1024});
    return {assets:etcPart.snapshot.assets.map(a=>a.key),slots:etcPart.snapshot.extra.audioSlots,independent:etcPart.buffers.get('drumEtc')!==etcPart.buffers.get('drumCymbals')};
   });
   assert(portable.assets.includes('drumEtc')&&portable.assets.includes('drumCymbals'));assert(portable.slots.drumEtc&&portable.slots.drumCymbals&&portable.independent);
   const songRender=mobile?null:await page.evaluate(async()=>{
    const buffer=await MygrainSongClock.render(audioContext,etcPart,{bpm:240,patternSteps:16});
    let peak=0;for(const value of buffer.getChannelData(0))peak=Math.max(peak,Math.abs(value));
    return {peak,frames:buffer.length,sampleRate:buffer.sampleRate};
   });
   if(songRender){assert(songRender.peak>.0001,'ETC must sound in the isolated Song renderer');assert.equal(songRender.frames,songRender.sampleRate);}
   // Every random entry point is exercised with local sample-loader substitution only.
   const random=await page.evaluate(async()=>{
    const before=await etcFingerprint(),original=loadDrumMachineSample;const loads=[];
    loadDrumMachineSample=async kind=>{loads.push(kind)};
    try{await loadRandomDrumMachineSamples();await loadRandomDrumMachineSamplesOnly();await randomizeDrumMachinePatterns();randomizeDrumMachineEnvelopeShape();}
    finally{loadDrumMachineSample=original;}
    const direct=await loadDrumMachineSample('etc'),single=await loadRandomSingleDrumMachineSample('etc');
    return {before,after:await etcFingerprint(),loads,direct,single};
   });
   assert.deepEqual(random.after,random.before);assert(!random.loads.includes('etc'));assert.equal(random.direct,false);assert.equal(random.single,false);
   // Explicit history transaction proves the extra PCM slot has independent exact Undo/Redo.
   const history=await page.evaluate(async()=>{
    const before=await etcFingerprint();
    await mygrainCardHistory.run('ETC sample fixture',async()=>{const buffer=audioContext.createBuffer(2,4096,audioContext.sampleRate);buffer.getChannelData(0).fill(.19);buffer.getChannelData(1).fill(-.17);await applyLoadedDrumMachineSampleBuffer('etc',buffer,{fileName:'replacement.wav',sourceKey:'samples_crash'});});
    const changed=await etcFingerprint();await mygrainCardHistory.undo();const undone=await etcFingerprint();await mygrainCardHistory.redo();const redone=await etcFingerprint();await mygrainCardHistory.flush();
    return {before,changed,undone,redone};
   });
   assert.notEqual(history.before.hash,history.changed.hash);assert.deepEqual(history.undone,history.before);assert.deepEqual(history.redone,history.changed);
   const legacy=await page.evaluate(async()=>{
    const old=structuredClone(etcPart.snapshot),entries=parseStoredZipEntries(etcArchive);
    delete old.extra.audioSlots.drumEtc;delete old.extra.metadata.drumEtc;delete old.state.modes.drumMachineExtraTracks.etc;
    for(const key of Object.keys(old.state.sliders||{}))if(key.startsWith('drumMachineEtc'))delete old.state.sliders[key];
    old.assets=old.assets.filter(asset=>asset.key!=='drumEtc');
    const archive=await createStoredZip([{path:'song-part.json',data:JSON.stringify(old)},...old.assets.map(asset=>({path:asset.path,data:entries.get(asset.path)}))]);
    const decoded=await mygrainSongBetaAdapter.decode(await archive.arrayBuffer(),{buffers:new Map(),bytes:0,limitBytes:128*1024*1024});
    mygrainSongBetaAdapter.recall(decoded,{editing:true});
    return {empty:!drumMachineExtraTracks.etc.buffer&&!drumMachineExtraTracks.etc.pattern.some(Boolean),crash:drumMachineExtraTracks.cymbals.metadata.fileName,slot:decoded.snapshot.extra.audioSlots.drumEtc};
   });
   assert.deepEqual(legacy,{empty:true,crash:'manual-cymbals.wav',slot:false});
   const recalled=await page.evaluate(()=>{mygrainSongBetaAdapter.recall(etcPart,{editing:true});return {etc:drumMachineExtraTracks.etc.metadata.fileName,crash:drumMachineExtraTracks.cymbals.metadata.fileName,accent:drumMachineExtraTracks.etc.accents[7],ratchet:drumMachineExtraTracks.etc.ratchets[7]}});
   assert.deepEqual(recalled,{etc:'manual-etc.wav',crash:'manual-cymbals.wav',accent:true,ratchet:2});
   await page.evaluate(async()=>{await mygrainSongBetaAdapter.whenPersisted();saveState({force:true});});
   // Reload from IndexedDB retains separate lane audio and controls.
   await page.reload();await page.waitForFunction(()=>window.mygrainSongBeta&&!mygrainSongBeta.busy&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
   const restored=await page.evaluate(()=>({etc:drumMachineExtraTracks.etc.metadata?.fileName,crash:drumMachineExtraTracks.cymbals.metadata?.fileName,loaded:!!drumMachineExtraTracks.etc.buffer&&!!drumMachineExtraTracks.cymbals.buffer,accent:drumMachineExtraTracks.etc.accents[7],ratchet:drumMachineExtraTracks.etc.ratchets[7]}));
   assert.deepEqual(restored,{etc:'manual-etc.wav',crash:'manual-cymbals.wav',loaded:true,accent:true,ratchet:2});
   await page.evaluate(()=>openDrumMachineOverlay());await page.locator('[data-drum-jump="etc"]').click();
   await page.screenshot({path:`${evidence}/${engine}-${mobile?'phone':'desktop'}.png`});
   const fit=await page.evaluate(()=>[...document.querySelectorAll('.drum-machine-jumps button, #drumMachineLane-etc .drum-machine-track-actions button')].map(b=>({text:b.textContent.trim(),fits:b.scrollWidth<=b.clientWidth+1&&b.scrollHeight<=b.clientHeight+1})));
   assert(fit.every(b=>b.fits),JSON.stringify(fit));assert.deepEqual(errors,[]);
   results.push({engine,mobile,peak,manual,manualLoads,songRender,portable,randomLoads:random.loads,restored,fit});console.log('PASS',engine,mobile?'phone':'desktop','ETC audio, random exclusion, portable restore, Undo/Redo and reload');await context.close();
  }}finally{await browser.close();}
 }
 fs.writeFileSync(evidence+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
