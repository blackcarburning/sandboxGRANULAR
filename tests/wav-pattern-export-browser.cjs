// Complete editable WAV round-trip through real UI, audio graph and isolated HTTP stores.
const assert = require('node:assert/strict'), fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18890/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence = process.env.WAV_PATTERN_EVIDENCE || '/tmp/mygrain-wav-pattern';
fs.mkdirSync(evidence, {recursive:true});
(async () => {
 const results = [];
 for (const [engine, type] of Object.entries({chromium,webkit})) {
  if (process.env.WAV_PATTERN_ENGINE && process.env.WAV_PATTERN_ENGINE !== engine) continue;
  const browser = await type.launch(engine === 'chromium' ? {executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']} : {});
  try { for (const mobile of [false,true]) {
   const context = await browser.newContext({viewport:mobile?{width:402,height:874}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
   const registration = await context.request.post(base+'api/auth/register',{data:{username:`wp_${engine[0]}_${+mobile}_${Date.now()}`,password:'isolated-wav-fixture'}});
   assert.equal(registration.status(),200,await registration.text());
   const page = await context.newPage(), errors = [], uploads = [];
   page.setDefaultTimeout(45000); page.on('pageerror',e=>errors.push(e.message));
   page.on('console',message=>{if(message.type()==='error')console.error('PAGE',engine,+mobile,message.text())});
   page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/mygrain-wavs/api/'))uploads.push(new URL(r.url()).pathname)});
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   const open = async () => {
    await page.goto(base);
    await page.waitForFunction(()=>window.mygrainSongBeta&&!mygrainSongBeta.busy&&document.documentElement.dataset.mygrainStartup==='ready');
    await page.locator('#start-btn').click();
    await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   };
   await open();
   await page.evaluate(async () => {
    stopAllPerformancePlayback({silent:true});resetStemIsolationState();applyGlobalBpm(300);syncPatternLengthControls(32,{skipSave:true});
    const sound=(frequency,duration=.4)=>{const b=audioContext.createBuffer(2,Math.round(audioContext.sampleRate*duration),audioContext.sampleRate);for(let c=0;c<2;c++)for(let i=0;i<b.length;i++)b.getChannelData(c)[i]=.28*Math.sin(2*Math.PI*(frequency+c*31)*i/audioContext.sampleRate);return b};
    await applyLoadedBastardLoopXSampleBuffer(sound(220),'Source X',{fileName:'source-X-C3.wav',rootNote:'C3'});
    await applyLoadedBastardLoopLSampleBuffer(sound(370),'Source L',{fileName:'source-L-C3.wav',rootNote:'C3'});
    await applyLoadedDrumMachineSampleBuffer('etc',sound(900,.1),{fileName:'manual-ETC.wav',sourceKey:'samples_crash'});
    const quiet={silent:true,skipSave:true,skipRestart:true};
    setBastardLoopXSourceMode('sample',quiet);setBastardLoopLSourceMode('sample',quiet);
    bastardLoopXSequence=Array.from({length:64},(_,i)=>({note:i===0||i===24?'C3':'',rest:false,accent:i===24,slide:false,ratchet:1}));
    bastardLoopLSequence=Array.from({length:32},(_,i)=>({note:i===8?'E3':'',rest:false,accent:false,slide:false,ratchet:1}));
    bastardLoopXTimingIndex=4;setBastardLoopXEnabled(true,quiet);setBastardLoopLEnabled(true,quiet);syncBastardLoopXUi();syncBastardLoopLUi();
    drumMachineExtraTracks.etc.pattern.fill(false);drumMachineExtraTracks.etc.pattern[0]=true;setDrumMachineEnabled(true,quiet);setSliderValue('performanceDrumMachineLevel',60);syncPerformanceExportBars(1,{skipSave:true});
    window.soundHashes=async slots=>{const hashes=[];for(const b of slots){const bytes=await crypto.subtle.digest('SHA-256',new Uint8Array(audioBufferToWav24bit(b)));hashes.push(Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join(''))}return hashes};
    window.patternFingerprint=async()=>{
     const hashes=await soundHashes([bastardLoopXSampleBuffer,bastardLoopLSampleBuffer,drumMachineExtraTracks.etc.buffer]);
     return {x:bastardLoopXSequence,l:bastardLoopLSequence,timing:bastardLoopXTimingIndex,steps:getPatternLengthSteps(),bpm:sequencerBPM,hashes,etc:drumMachineExtraTracks.etc.pattern.slice(),meta:JSON.stringify([bastardLoopXSampleMetadata,bastardLoopLSampleMetadata,drumMachineExtraTracks.etc.metadata])};
    };
    window.mutatePattern=async()=>{await applyLoadedBastardLoopXSampleBuffer(sound(120,.2),'Changed X',{fileName:'changed-C2.wav',rootNote:'C2'});bastardLoopXSequence[0].note='G2';bastardLoopLSequence[8].note='A3';bastardLoopXTimingIndex=2;drumMachineExtraTracks.etc.pattern.fill(false);applyGlobalBpm(240);saveState()};
    window.layerFingerprint=()=>({rows:[...document.querySelectorAll('#performanceLayerSwitchesCard .performance-layer-switch-row')].map(row=>{const b=row.querySelector('button');return [b.id,b.getAttribute('aria-pressed'),b.classList.contains('layer-muted')]}),grain:[grainMainMuted,grainAMuted,grainBMuted],fx:fxMuted,k:mygrainKMultitrack.captureSettings().tracks.map(t=>t.mute)});
    window.mutateLayers=()=>{SPARSE_RANDOM_LAYER_DEFINITIONS.forEach(layer=>layer.setEnabled(!['bastardx','bastardl'].includes(layer.key),{silent:true,skipSave:true}));setGranularLayerMuted('main',false,{silent:true});setGranularLayerMuted('A',true,{silent:true});setGranularLayerMuted('B',false,{silent:true});setFxMuted(false,{silent:true});mygrainKMultitrack.tracks.forEach(t=>t.mute=!t.mute);syncPerformanceControlState()};
    SPARSE_RANDOM_LAYER_DEFINITIONS.forEach(layer=>layer.setEnabled(['bastardx','bastardl'].includes(layer.key),{silent:true,skipSave:true}));
    setGranularLayerMuted('main',true,{silent:true});setGranularLayerMuted('A',false,{silent:true});setGranularLayerMuted('B',true,{silent:true});setFxMuted(true,{silent:true});
    mygrainKMultitrack.tracks.forEach((t,i)=>t.mute=i%2===0);syncPerformanceControlState();
    const old=patternFingerprint,mutate=mutatePattern;window.patternFingerprint=async()=>({...await old(),layers:layerFingerprint()});window.mutatePattern=async()=>{await mutate();mutateLayers();saveState()};
    saveState();
   });
   page.on('dialog',dialog=>dialog.accept(dialog.type()==='prompt' ? (page.renderName || 'fixture-render') : undefined));
   const legacyBefore=await page.evaluate(async()=>{await uploadWavToRepository(new Blob([audioBufferToWav24bit(bastardLoopXSampleBuffer)],{type:'audio/wav'}),'old-history.wav');await fetch(WAV_REPOSITORY_FEEDBACK_API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:'old-history.wav',comment:'Keep this comment ♥',reaction:'love'})});return (await(await fetch(WAV_REPOSITORY_LIST_API_URL)).json()).files.find(f=>f.name==='old-history.wav')});
   const original = await page.evaluate(()=>patternFingerprint());
   const name=`editable-${engine}-${+mobile}`;
   const recorderAvailable=await page.evaluate(()=>typeof MediaRecorder!=='undefined');
   if(recorderAvailable){
    page.renderName=name;
    await page.locator('#performanceRepoExportBtn').click();
    await page.waitForFunction(()=>!document.getElementById('performanceRepoExportBtn').disabled);
   } else {
    // The installed Linux WebKit lacks MediaRecorder; do not fake its renderer.
    // Exercise the actual paired upload + import using a real Chromium-rendered WAV.
    const reference=fs.readFileSync('/tmp/mygrain-wav-pattern/reference-render.wav');
    await page.evaluate(async ({audio,name})=>uploadWavToRepository(new Blob([new Uint8Array(audio)],{type:'audio/wav'}),name+'.wav',{patternBlob:await mygrainSongBetaAdapter.capture(),patternOwner:mygrainAccounts.user.username}),{audio:[...reference],name});
   }
   const listing=await page.evaluate(async()=>{const r=await fetch(WAV_REPOSITORY_LIST_API_URL);return r.json()});
   assert.equal(listing.files.length,2,JSON.stringify({listing,status:await page.evaluate(()=>document.getElementById('status')?.textContent),errors}));const pairedFile=listing.files.find(f=>f.name===name+'.wav');assert(pairedFile.patternExport);assert.equal(pairedFile.patternExport.filename,name+'.zip');
   if(recorderAvailable)fs.writeFileSync(`${evidence}/reference-render.wav`,await(await context.request.get(new URL(pairedFile.url,base).href)).body());
   const rendered=await page.evaluate(async file=>{const b=await audioContext.decodeAudioData(await (await fetch(file.url)).arrayBuffer());let peak=0;for(const sample of b.getChannelData(0))peak=Math.max(peak,Math.abs(sample));return {peak,frames:b.length,rate:b.sampleRate}},pairedFile);
   assert(rendered.peak>.0001,`${engine}/${mobile}: silent export`);assert.equal(rendered.frames,Math.round(rendered.rate*.8));
   // Complete snapshots use the existing PCM16 source codec, not float identity.
   const archived=await page.evaluate(async file=>{
    const bytes=await(await fetch(file.patternExport.url)).arrayBuffer();const decoded=await mygrainSongBetaAdapter.decode(bytes,{buffers:new Map(),bytes:0,limitBytes:256*1024*1024});
    const decodedSlots=['bastardX','bastardL','drumEtc'].map(k=>decoded.buffers.get(k));const originals=[bastardLoopXSampleBuffer,bastardLoopLSampleBuffer,drumMachineExtraTracks.etc.buffer];
    let maxError=0;for(let k=0;k<3;k++){if(originals[k].length!==decodedSlots[k].length)throw new Error('Source length changed');for(let c=0;c<2;c++){const a=originals[k].getChannelData(c),b=decodedSlots[k].getChannelData(c);for(let i=0;i<a.length;i++)maxError=Math.max(maxError,Math.abs(a[i]-b[i]))}}
    return {hashes:await soundHashes(decodedSlots),maxError,assets:decoded.snapshot.assets.map(a=>a.key)};
   },pairedFile);
   assert(archived.maxError<2/32768);assert(archived.assets.includes('bastardX')&&archived.assets.includes('bastardL')&&archived.assets.includes('drumEtc'));
   const importedTarget={...original,hashes:archived.hashes};
   assert(uploads.includes('/mygrain-wavs/api/render-with-pattern'));
   // Old upload endpoint and old browser cards remain unchanged.
   await page.evaluate(async()=>{const b=audioBufferToWav24bit(bastardLoopXSampleBuffer);await uploadWavToRepository(new Blob([b],{type:'audio/wav'}),'legacy.wav')});
   await page.evaluate(()=>mutatePattern());
   const changed = await page.evaluate(()=>patternFingerprint());assert.notDeepEqual(changed,original);
   await page.locator('#performanceWavBrowserBtn').click();
   await page.waitForFunction(()=>document.querySelectorAll('#wavRepositoryBrowserList .sample-browser-card').length===3);
   const rows=page.locator('#wavRepositoryBrowserList .sample-browser-card');
   assert.equal(await rows.filter({hasText:'legacy.wav'}).locator('.wav-pattern-import').count(),0);
   const oldCard=rows.filter({hasText:'old-history.wav'});assert.equal(await oldCard.locator('.wav-pattern-import').count(),0);assert.equal(await oldCard.locator('textarea').inputValue(),'Keep this comment ♥');assert.match(await oldCard.locator('[data-reaction="love"]').getAttribute('class'),/active/);
   const paired=rows.filter({hasText:name+'.wav'});assert.equal(await paired.locator('.wav-pattern-import').count(),1);assert.equal(await paired.locator('.wav-pattern-import').textContent(),'Restore Patch');assert.equal(await paired.locator('.wav-pattern-download').getAttribute('download'),name+'.zip');
   const zipRequest=await context.request.get(new URL(pairedFile.patternExport.url,base).href,{headers:{'X-Mygrain-User':await page.evaluate(()=>mygrainAccounts.user.username)}});assert.equal(zipRequest.status(),200);assert.match(zipRequest.headers()['content-disposition'],/attachment/);assert.match(zipRequest.headers()['content-disposition'],new RegExp(name+'\\.zip'));
   await paired.locator('.wav-pattern-download').scrollIntoViewIfNeeded();
   await page.evaluate(()=>{window.savedDownloadBlob=downloadBlob;downloadBlob=async(blob,name)=>{window.downloadedPatch={name,size:blob.size,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('')}}});
   await paired.locator('.wav-pattern-download').click();await page.waitForFunction(()=>window.downloadedPatch);assert.deepEqual(await page.evaluate(()=>downloadedPatch),{name:name+'.zip',size:pairedFile.patternExport.size,hash:pairedFile.patternExport.sha256});await page.evaluate(()=>{downloadBlob=savedDownloadBlob});
   await paired.locator('.wav-pattern-import').scrollIntoViewIfNeeded();
   const fit=await paired.locator('.wav-pattern-import').evaluate(b=>{const r=b.getBoundingClientRect(),card=b.closest('.sample-browser-card').getBoundingClientRect();return {width:r.width,height:r.height,inside:r.left>=card.left&&r.right<=card.right,fit:b.scrollWidth<=b.clientWidth}});assert(fit.inside&&fit.fit&&fit.height>=36,JSON.stringify(fit));
   await page.screenshot({path:`${evidence}/${engine}-${mobile?'phone':'desktop'}-browser.png`});
   await paired.locator('.wav-pattern-import').click();
   await page.waitForFunction(()=>document.getElementById('wavRepositoryBrowserOverlay').hidden&&!mygrainCardHistory.busy);
   assert.deepEqual(await page.evaluate(()=>patternFingerprint()),importedTarget);
   assert.equal(await page.evaluate(()=>sequencerPlaying||bastardLoopPlaying||drumMachinePlaying),false);
   await page.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual(await page.evaluate(()=>patternFingerprint()),changed);
   await page.evaluate(()=>mygrainCardHistory.redo());assert.deepEqual(await page.evaluate(()=>patternFingerprint()),importedTarget);
   // Local WAV export creates a correctly typed editable ZIP too; manual ZIP import works.
   let local=null;
   if(recorderAvailable){
    local=await page.evaluate(async()=>{const saved=saveAudioFiles;saveAudioFiles=async files=>{window.localPatternBytes=await files[1].blob.arrayBuffer();window.localPatternFiles=files.map(f=>({name:f.filename,type:f.blob.type,size:f.blob.size}))};try{await exportDawReadyBars();return localPatternFiles}finally{saveAudioFiles=saved}});
    assert.equal(local.length,2);assert.equal(local[1].type,'application/zip');assert.match(local[1].name,/\.zip$/);assert(local[1].size>1000);
   }else await page.evaluate(async file=>{window.localPatternBytes=await(await fetch(file.patternExport.url)).arrayBuffer()},pairedFile);
   const localHashes=await page.evaluate(async()=>{const p=await mygrainSongBetaAdapter.decode(localPatternBytes,{buffers:new Map(),bytes:0,limitBytes:256*1024*1024});return soundHashes(['bastardX','bastardL','drumEtc'].map(k=>p.buffers.get(k)))});
   await page.evaluate(()=>mutatePattern());
   await page.evaluate(()=>openPatchZipFromArrayBuffer(localPatternBytes,'download.pattern.zip'));
   assert.deepEqual(await page.evaluate(()=>patternFingerprint()),{...original,hashes:localHashes});
   // Standalone named ZIP uses the same full-state codec, including all quick mutes.
   await page.evaluate(async()=>{window.standaloneZip=await (await buildPatchZipBlob('standalone-fixture.zip')).arrayBuffer();await mutatePattern();await openPatchZipFromArrayBuffer(standaloneZip,'standalone-fixture.zip')});
   assert.deepEqual(await page.evaluate(()=>patternFingerprint()),{...original,hashes:localHashes});
   const legacyAfter=await page.evaluate(async()=> (await(await fetch(WAV_REPOSITORY_LIST_API_URL)).json()).files.find(f=>f.name==='old-history.wav'));assert.deepEqual(legacyAfter,legacyBefore);
   // A Song WAV pairs the actual saved patches, not the unrelated current workspace.
   page.renderName='1';
   const songArchive=await page.evaluate(async()=>{
    const song=mygrainSongBeta;document.getElementById('songBetaName').value='Export archive fixture';await song.newSong();
    await song.newPart({name:'Verse',repeats:1});await mutatePattern();await song.newPart({name:'Chorus',repeats:2});
    const parts=song.song.parts,partsWithReuse=[...parts,{...parts[0],id:'reused-fixture',sourcePartId:parts[0].id,repeats:3}];
    const before=JSON.stringify(song.song),rendered=await audioContext.decodeAudioData(audioBufferToWav24bit(bastardLoopXSampleBuffer));
    const result=await mygrainSongBetaAdapter.exportSong(partsWithReuse,new Map(parts.map(p=>[p.id,rendered])),'fixture-song.wav',new AbortController().signal);
    if(JSON.stringify(song.song)!==before)throw Error('Song changed during export');
    const bytes=await fetchEditablePatternBytes({patternExport:result.patternExport});
    const entries=parseStoredZipEntries(bytes),manifest=JSON.parse(getZipText(entries,'render-patches.json'));
    await importEditablePattern(bytes,'fixture-song.wav');
    return {filename:result.patternExport.filename,patchNames:manifest.patches.map(p=>p.name),order:manifest.arrangement.map(p=>p.name),repeats:manifest.arrangement.map(p=>p.repeats),layers:layerFingerprint()};
   });
   assert.equal(songArchive.filename,'fixture-song.zip');assert.deepEqual(songArchive.patchNames,['Verse','Chorus']);assert.deepEqual(songArchive.order,['Verse','Chorus','Verse']);assert.deepEqual(songArchive.repeats,[1,2,3]);assert.deepEqual(songArchive.layers,original.layers);
   // Persisted state and linked source survive a real page restart.
   await page.evaluate(()=>mygrainCardHistory.flush());await open();
   assert.equal(await page.locator('#performanceExportPattern').count(),0);
   // Fingerprint helper is test-only; recover it without replacing any production state.
   assert.equal(await page.evaluate(()=>bastardLoopXSequence[24].note),'C3');
   const postReload=await page.evaluate(async()=>{const r=await fetch(WAV_REPOSITORY_LIST_API_URL);return r.json()});assert(postReload.files.find(f=>f.name===name+'.wav').patternExport);
   assert.deepEqual(errors,[]);
   results.push({engine,mobile,recorderAvailable,renderSource:recorderAvailable?'actual live output render':'real Chromium WAV; installed WebKit lacks MediaRecorder',rendered,archived,local,fit,conditionalImport:true,exactUndoRedo:true,reload:true,uploads});
   console.log('PASS',engine,mobile?'phone':'desktop','WAV/source audio, complete L/X/ETC state, conditional import, exact Undo/Redo, ZIP import and reload',recorderAvailable?'(actual renderer)':'(import only; MediaRecorder unavailable)');
   await context.close();
  }} finally {await browser.close()}
 }
 fs.writeFileSync(evidence+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
