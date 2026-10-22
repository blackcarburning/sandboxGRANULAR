// Disposable localhost accounts/stores only. Real fetched PCM, Web Audio and K worklet.
const assert = require('node:assert/strict'), fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18898/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
const evidence = process.env.MYGRAIN_SAMPLE_EVIDENCE || '/tmp/mygrain-keyboard-sample'; fs.mkdirSync(evidence, {recursive: true});
function wav() {
    const frames = 44100 * 3, data = Buffer.alloc(44 + frames * 2);
    data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
    data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(44100, 24); data.writeUInt32LE(88200, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(frames * 2, 40);
    for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(.20 * 32767 * Math.sin(2 * Math.PI * 261.625565 * i / 44100)), 44 + i * 2);
    return data;
}
(async () => {
 const results = [];
 for (const [engine, type] of Object.entries({chromium, webkit})) {
  const browser = await type.launch(engine === 'chromium' ? {executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']} : {});
  try {
   for (const mobile of [false, true]) {
    if(process.env.MYGRAIN_SAMPLE_TEST_CASES&&!process.env.MYGRAIN_SAMPLE_TEST_CASES.split(',').includes(`${engine}-${mobile?'phone':'desktop'}`))continue;
    const context = await browser.newContext({viewport: mobile ? {width:390,height:844} : {width:1280,height:900}, isMobile:mobile, hasTouch:mobile, reducedMotion:'reduce'});
    assert.equal((await context.request.post(base+'api/auth/register', {data:{username:`sample_${engine[0]}_${+mobile}_${Date.now()}`,password:'isolated-keyboard-sample'}})).status(),200);
    const page = await context.newPage(), errors = [], downloads = [];
    page.on('pageerror', e=>errors.push(e.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname.endsWith('/api/source-files')) {
        const sourceKey = url.searchParams.get('source'), name = 'Middle C fixture.wav';
        return route.fulfill({json:{ok:true,sourceKey,sourceLabel:sourceKey.toUpperCase(),files:[{name,relativePath:name,sourceKey,sourceLabel:sourceKey.toUpperCase(),previewUrl:new URL(`/mygrain-bastardloops/api/source-sample?source=${sourceKey}&path=${encodeURIComponent(name)}`,base).href}]}});
      }
      if (url.pathname.endsWith('/api/source-sample')) {
        downloads.push(url.searchParams.get('path'));
        if (url.searchParams.get('path') === 'slow.wav') await new Promise(r=>setTimeout(r,400));
        if (url.searchParams.get('path') === 'bad.wav') return route.fulfill({status:500,body:'no sample'});
        return route.fulfill({contentType:'audio/wav',body:wav()});
      }
      return route.continue();
    });
    const press = selector => mobile ? page.locator(selector).tap() : page.locator(selector).click();
    async function start() {
      await page.waitForFunction(()=>window.mygrainCardHistory && document.documentElement.dataset.mygrainStartup==='ready');
      await page.evaluate(()=>mygrainCardHistory.ready); await press('#start-btn');
      await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
    }
    await page.goto(base); await start();
    await press('#performanceKeyboardSoundSwitch [data-keyboard-sound="sample"]');
    await page.waitForFunction(()=>!document.getElementById('dropboxSampleBrowserOverlay').hidden && !dropboxSampleBrowserLoading);
    const folders = await page.locator('#dropboxSampleBrowserSourceSelect option').allTextContents();
    assert.equal(folders.filter(s=>s.startsWith('SAMPLES_')).length,13);
    await page.locator('#dropboxSampleBrowserSourceSelect').selectOption('samples_leads');
    await page.waitForFunction(()=>!dropboxSampleBrowserLoading && getSampleBrowserTargetConfig().sourceKey==='samples_leads');
    await press('#dropboxSampleBrowserList button:has-text("Load into Keyboard")');
    await page.waitForFunction(()=>keyboardSampleBuffer && keyboardSoundSource==='sample' && !mygrainCardHistory.busy);
    assert.equal(await page.locator('#performanceBastardLoopKSoundSwitch [data-keyboard-sound="sample"]').getAttribute('aria-pressed'),'true');
    assert.match(await page.locator('#performanceKeyboardSampleName').innerText(),/Middle C fixture/);
    const pitches = await page.evaluate(async ()=>{
      stopAllPerformancePlayback({silent:true}); setArpeggiatorEnabled(false,{skipSave:true}); setHoldEnabled(false);
      clearAllPerformanceSoloStates({silent:true,skipSave:true}); setFxMuted(true,{silent:true});
      const result=[];
      for(const note of ['C4','C5','C3']) {
        playKeyboardSound(note); await Promise.resolve();
        const voice=keyboardSamplePlayer.voices.get(makePerformanceStreamId('keyboard',note));
        result.push({note,rate:voice.source.playbackRate.value,peak:voice.peak,capture:!!keyboardGrainCaptureGain});
        stopKeyboardSound(note,null,{immediate:true});
      }
      return result;
    });
    assert.deepEqual(pitches.map(p=>p.rate),[1,2,.5]); assert.ok(pitches.every(p=>p.peak>0&&p.capture));
    const patchRoundTrip=await page.evaluate(async()=>{
      const preset=gatherPreset(),metadata={...keyboardSampleMetadata},buffer=keyboardSampleBuffer;
      const definition=PATCH_REPOSITORY_AUDIO_ENTRIES.find(entry=>entry.key==='keyboardSample');
      const bytes=new Uint8Array(audioBufferToWav(buffer));
      setKeyboardSampleBuffer(null);setKeyboardSoundSource('osc');
      await restorePatchAudioEntry({key:'keyboardSample',metadata},bytes);applyPreset(preset);
      return {included:definition.getBuffer()===keyboardSampleBuffer,source:keyboardSoundSource,name:keyboardSampleMetadata.fileName,seconds:keyboardSampleBuffer.duration};
    });
    assert.ok(patchRoundTrip.included);assert.equal(patchRoundTrip.source,'sample');assert.equal(patchRoundTrip.seconds,3);
    // Never allow a failed or late download to replace the current instrument.
    const cancelled = await page.evaluate(async ()=>{
      const original=keyboardSampleBuffer;
      const slow=loadKeyboardSampleFromSourceRelativePath('samples_piano','slow.wav').then(()=>'',e=>e.message);
      await new Promise(r=>setTimeout(r,70)); setKeyboardSoundSource('osc');
      const message=await slow;
      let failed='';try{await loadKeyboardSampleFromSourceRelativePath('samples_piano','bad.wav');}catch(e){failed=e.message;}
      setKeyboardSoundSource('sample'); return {same:original===keyboardSampleBuffer,message,failed};
    });
    assert.ok(cancelled.same);assert.ok(cancelled.message);assert.match(cancelled.failed,/500/);
    // A real UI Hold note, then Record to K with an explicit short step length.
    await page.evaluate(()=>{
      applyGlobalBpm(300);syncPatternLengthControls(8,{skipSave:true});setBastardLoopKRecordingSteps(8);
      setDrumMachineEnabled(false,{silent:true,skipSave:true});setHoldEnabled(true);
      for(const layer of SPARSE_RANDOM_LAYER_DEFINITIONS)layer.setEnabled(false,{silent:true,skipSave:true});
      syncBastardLoopKUi();
    });
    await page.locator('#keyboardContainer').evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
    const key = await page.evaluate(()=>[...document.querySelectorAll('#keyboardContainer .key:not(.black)')].map(el=>{const b=el.getBoundingClientRect();return {note:el.dataset.note,x:b.x+b.width/2,y:b.y+b.height*.8};}).find(k=>document.elementFromPoint(k.x,k.y)?.closest('.key')?.dataset.note===k.note));
    assert.ok(key);if(mobile)await page.touchscreen.tap(key.x,key.y);else await page.mouse.click(key.x,key.y);
    assert.equal(await page.evaluate(note=>heldNotes.has(note),key.note),true);
    await press('#performanceKeyboardToKRecordSurfaceBtn');
    await page.waitForFunction(()=>bastardLoopKRecordingState==='idle'&&bastardLoopKMetadata?.recordingSteps===8&&!mygrainCardHistory.busy,null,{timeout:20000});
    const take=await page.evaluate(()=>{
      const b=bastardLoopKRawBuffer,x=b.getChannelData(0);let sum=0;for(const v of x)sum+=v*v;
      return {frames:b.length,rate:b.sampleRate,rms:Math.sqrt(sum/x.length),source:bastardLoopKMetadata};
    });
    assert.equal(take.frames,Math.round(8*60/300/4*take.rate));assert.ok(take.rms>.005,JSON.stringify(take));
    // Portable state, Undo/Redo and actual Song Amend/Save use embedded audio, not a folder refetch.
    const saved=await page.evaluate(async()=>{
      stopAllPerformancePlayback({silent:true});setArpeggiatorEnabled(true,{skipSave:true});setHoldEnabled(true);heldNotes=new Set(['C4','E4']);
      setBastardLoopKEnabled(false,{silent:true,skipSave:true});
      const c=mygrainSongBeta; document.getElementById('songBetaName').value='Sample keyboard regression';await c.newSong();heldNotes=new Set(['C4','E4']);setHoldEnabled(true);setArpeggiatorEnabled(true,{skipSave:true});await c.newPart({name:'Sample keyboard',repeats:1});
      if(!c.song?.parts.length)throw new Error(document.getElementById('songBetaStatus').textContent);
      const snap=mygrainSongBetaAdapter.inspectPart(await (await mygrainSongBetaAdapter.capture()).arrayBuffer()).snapshot;
      await c.run(()=>c.amendPart(c.song.parts[0]));
      if(!c.editing)throw new Error(document.getElementById('songBetaStatus').textContent);
      await loadKeyboardSampleFromSourceRelativePath('samples_orch','Amended.wav','Amended.wav');
      await c.run(()=>c.savePart());
      setKeyboardSampleBuffer(null);keyboardSampleMetadata=null;setKeyboardSoundSource('osc');
      await c.recall(c.song.parts[0],{start:false});
      const restored={source:keyboardSoundSource,metadata:keyboardSampleMetadata,seconds:keyboardSampleBuffer.duration,steps:getBastardLoopKRecordingSteps()};
      await c.finishEditing();
      await mygrainCardHistory.undo();if(keyboardSampleMetadata.fileName!=='Middle C fixture.wav')throw new Error('Sample Undo did not restore original audio');
      await mygrainCardHistory.redo();if(keyboardSampleMetadata.fileName!=='Amended.wav')throw new Error('Sample Redo did not restore replacement audio');
      await c.arm();if(!c.armed)throw new Error(document.getElementById('songBetaStatus').textContent);
      const render=c.renders.get(c.song.parts[0].id);let e=0;for(const x of render.getChannelData(0))e+=x*x;
      const renderRms=Math.sqrt(e/render.length);
      saveState({force:true});await mygrainSongBetaAdapter.whenPersisted();
      return {held:snap.extra.heldNotes,slot:snap.extra.audioSlots.keyboardSample,asset:snap.assets.find(a=>a.key==='keyboardSample'),restored,renderRms};
    });
    console.log('Saved sample evidence',JSON.stringify(saved));
    assert.ok(saved.slot&&saved.asset);assert.equal(saved.restored.source,'sample');assert.equal(saved.restored.metadata.fileName,'Amended.wav');assert.equal(saved.restored.seconds,3);assert.ok(saved.renderRms>.001);
    const beforeReload=downloads.length;
    await page.reload();await start();
    assert.equal(await page.evaluate(()=>keyboardSampleMetadata.fileName),'Amended.wav');
    assert.equal(await page.evaluate(()=>keyboardSampleBuffer.duration),3);assert.equal(downloads.length,beforeReload);
    // Arp voices and real recording, including retained custom step length.
    await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});applyGlobalBpm(300);setBastardLoopKRecordingSteps(11);heldNotes=new Set(['C4','E4']);setArpeggiatorEnabled(true,{skipSave:true});setHoldEnabled(true);});
    await press('#performanceKeyboardToKRecordSurfaceBtn');
    await page.waitForFunction(()=>bastardLoopKRecordingState==='idle'&&bastardLoopKMetadata?.recordingSteps===11&&!mygrainCardHistory.busy,null,{timeout:20000});
    const arp=await page.evaluate(()=>{const b=bastardLoopKRawBuffer;let e=0;for(const v of b.getChannelData(0))e+=v*v;return {frames:b.length,rate:b.sampleRate,rms:Math.sqrt(e/b.length)};});
    assert.equal(arp.frames,Math.round(11*60/300/4*arp.rate));assert.ok(arp.rms>.005);
    await page.locator('#keyboardSampleCard').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${evidence}/${engine}-${mobile?'phone':'desktop'}.png`});
    if(mobile) {
      await page.setViewportSize({width:844,height:390});
      await page.locator('#keyboardSampleCard').scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false);
      await page.screenshot({path:`${evidence}/${engine}-phone-landscape.png`});
      await page.setViewportSize({width:390,height:844});
    }
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);assert.equal(overflow,false);
    assert.deepEqual(errors,[]);results.push({engine,mobile,folders,pitches,patchRoundTrip,take,arp,saved,downloads:downloads.length});
    console.log(JSON.stringify(results.at(-1))); await context.close();
   }
  } finally {await browser.close();}
 }
 fs.writeFileSync(`${evidence}/results.json`,JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
