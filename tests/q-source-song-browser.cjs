// Disposable localhost accounts/stores only. Real fetched PCM, Web Audio and K worklet.
const assert = require('node:assert/strict'), fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18949/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
const evidence = process.env.MYGRAIN_SAMPLE_EVIDENCE || '/tmp/mygrain-q-source-song'; fs.mkdirSync(evidence, {recursive: true});
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
   for (const mobile of [true]) {
    if(process.env.MYGRAIN_SAMPLE_TEST_CASES&&!process.env.MYGRAIN_SAMPLE_TEST_CASES.split(',').includes(`${engine}-${mobile?'phone':'desktop'}`))continue;
    const context = await browser.newContext({viewport: mobile ? {width:390,height:844} : {width:1280,height:900}, isMobile:mobile, hasTouch:mobile, reducedMotion:'reduce'});
    assert.equal((await context.request.post(base+'api/auth/register', {data:{username:`sample_${engine[0]}_${+mobile}_${Date.now()}`,password:'isolated-keyboard-sample'}})).status(),200);
    const page = await context.newPage(), errors = [], downloads = [];
    page.on('pageerror', e=>errors.push(e.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if(process.env.MYGRAIN_STRESS_Q_START && url.pathname.endsWith('/song-beta-clock.js')){
        const response=await route.fetch(),text=await response.text();
        return route.fulfill({response,body:text.replace('deck.mygrainSongBetaAdapter.startAt(captureTiming.sourceTime);','deck.mygrainSongBetaAdapter.startAt(captureTiming.sourceTime); const blockedUntil=performance.now()+700; while(performance.now()<blockedUntil){}')});
      }
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
    await press('#bastardLoopQCard [data-q-sound="sample"]');
    await page.waitForFunction(()=>!dropboxSampleBrowserLoading&&!document.getElementById('dropboxSampleBrowserOverlay').hidden);
    assert.equal((await page.locator('#dropboxSampleBrowserSourceSelect option').allTextContents()).filter(x=>x.startsWith('SAMPLES_')).length,13);
    await page.locator('#dropboxSampleBrowserSourceSelect').selectOption('samples_leads');
    await page.waitForFunction(()=>!dropboxSampleBrowserLoading);
    await press('#dropboxSampleBrowserList button:has-text("Load into Q")');
    await page.waitForFunction(()=>qSourceSampleBuffer&&!mygrainCardHistory.busy);
    const loader=await page.evaluate(async()=>{
      if(keyboardSampleBuffer)throw Error('Q load replaced keyboard sample');
      await loadRandomPerformanceSample(SAMPLE_BROWSER_TARGETS.qSample);
      const name=mygrainQ.state.qSampleMetadata.fileName,original=qSourceSampleBuffer;
      let failed='';try{await loadKeyboardSampleFromSourceRelativePath('samples_piano','bad.wav','bad.wav',{qSource:true})}catch(e){failed=e.message}
      if(qSourceSampleBuffer!==original||!failed)throw Error('Failed sample replaced Q audio');
      const slow=loadKeyboardSampleFromSourceRelativePath('samples_piano','slow.wav','slow.wav',{qSource:true}).then(()=>'',e=>e.message);
      await new Promise(r=>setTimeout(r,70));await mygrainQ.setSoundSource('osc');const cancelled=await slow;
      if(!cancelled||qSourceSampleBuffer!==original)throw Error('Late Q sample not cancelled');
      await mygrainQ.setSoundSource('sample');
      return {name,failed,cancelled};
    });
    console.log(engine,'loader',JSON.stringify(loader));
    const result=await page.evaluate(async()=>{
      const q=mygrainQ,c=mygrainSongBeta;
      stopAllPerformancePlayback({silent:true});setDrumMachineEnabled(false,{silent:true,skipSave:true});
      for(const layer of SPARSE_RANDOM_LAYER_DEFINITIONS)layer.setEnabled(false,{silent:true,skipSave:true});
      document.getElementById('songBetaName').value='Q source portable regression';await c.newSong();
      q.state.enabled=true;q.state.soundSource='sample';q.state.bank=null;q.state.sequence.fill(null);q.state.sequence[0]=MygrainQTheory.normalizeStep({notes:[60,64,67],gate:2});q.changed({reschedule:false});
      const snap=mygrainSongBetaAdapter.inspectPart(await(await mygrainSongBetaAdapter.capture()).arrayBuffer()).snapshot;
      if(!snap.assets.some(a=>a.key==='qSourceSample'))throw Error('Q sample missing from portable snapshot');
      await c.newPart({name:'Q sample',repeats:1});if(!c.song?.parts.length)throw Error(document.getElementById('songBetaStatus').textContent);
      await c.run(()=>c.amendPart(c.song.parts[0]));if(!c.editing)throw Error('No amend');
      await loadKeyboardSampleFromSourceRelativePath('samples_orch','Amended Q.wav','Amended Q.wav',{qSource:true});
      await c.run(()=>c.savePart());qSourceSampleBuffer=null;q.state.soundSource='osc';
      await c.recall(c.song.parts[0],{start:false});
      if(q.state.soundSource!=='sample'||qSourceSampleBuffer?.duration!==3)throw Error('Q recall failed');
      await c.finishEditing();
      const portable=[];
      for(const kind of ['osc','grain']){
        const b=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate);for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=.15*Math.sin(2*Math.PI*261.63*i/b.sampleRate);
        grainASampleBuffer=b;document.getElementById('grainSynthASource').value='sample';
        q.state.soundSource=kind;q.state.enabled=true;q.state.bank=null;await q.prepareSounds([]);q.changed({reschedule:false});
        await c.newPart({name:'Q '+kind,repeats:1});
      }
      await c.arm();if(!c.armed)throw Error(document.getElementById('songBetaStatus').textContent);
      for(const p of c.song.parts){const rb=await c.loadRender(p,c.abort?.signal,c.generation);let re=0;for(const x of rb.getChannelData(0))re+=x*x;portable.push({name:p.name,rms:Math.sqrt(re/rb.length),qVersion:p.qVersion});if(portable.at(-1).rms<.001)throw Error('Silent '+JSON.stringify(portable.at(-1)));}
      const b=await c.loadRender(c.song.parts[0],c.abort?.signal,c.generation);
      await c.recall(c.song.parts[0],{start:false});let e=0;for(const x of b.getChannelData(0))e+=x*x;
      const rms=Math.sqrt(e/b.length);if(rms<.001)throw Error('Silent Q frozen render '+rms);
      const def=PATCH_REPOSITORY_AUDIO_ENTRIES.find(a=>a.key==='qSourceSample'),preset=gatherPreset(),bytes=new Uint8Array(audioBufferToWav(qSourceSampleBuffer)),metadata={...q.state.qSampleMetadata};qSourceSampleBuffer=null;
      await restorePatchAudioEntry({key:'qSourceSample',metadata},bytes);applyPreset(preset);
      if(!def.getBuffer()||q.state.soundSource!=='sample')throw Error('Patch sample roundtrip failed');
      saveState({force:true});await mygrainSongBetaAdapter.whenPersisted();
      return {portable,rms,source:q.state.soundSource,name:q.state.qSampleMetadata.fileName,asset:snap.assets.find(a=>a.key==='qSourceSample')};
    });
    console.log(engine,JSON.stringify(result));
    await page.reload();await start();assert.equal(await page.evaluate(()=>qSourceSampleBuffer?.duration),3);assert.equal(await page.evaluate(()=>mygrainQ.state.soundSource),'sample');
    await page.evaluate(()=>mygrainQ.open());await page.evaluate(()=>mygrainQSoundSources.browse());
    await page.waitForFunction(()=>!dropboxSampleBrowserLoading);
    assert.equal(await page.locator('#dropboxSampleBrowserSourceSelect').evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el}),true);
    assert.deepEqual(errors,[]);results.push({engine,result});await context.close();
   }
  }finally{await browser.close();}
 }
 fs.writeFileSync(`${evidence}/results.json`,JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
