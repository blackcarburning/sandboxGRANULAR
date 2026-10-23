// Real Web Audio, disposable localhost accounts only; never touch saved production Songs.
const assert = require('node:assert/strict'), fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18919/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
const evidence = process.env.K_DSP_EVIDENCE || '/tmp/mygrain-k-track-processing'; fs.mkdirSync(evidence, { recursive: true });
(async () => {
 const results = [];
 for (const [engine, type] of Object.entries({ chromium, webkit })) {
  if (process.env.K_ENGINE && process.env.K_ENGINE !== engine) continue;
  const browser = await type.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] } : {});
  try { for (const mobile of [true, false]) {
   if (process.env.K_MOBILE && process.env.K_MOBILE !== String(mobile)) continue;
   const context = await browser.newContext({ viewport: mobile ? { width:390, height:844 } : { width:1280, height:900 }, isMobile:mobile, hasTouch:mobile, reducedMotion:'reduce' });
   assert.equal((await context.request.post(base+'api/auth/register', { data:{ username:`kdsp_${engine[0]}_${+mobile}_${Date.now()}`, password:'isolated-k-track-dsp' } })).status(),200);
   const page = await context.newPage(), errors=[]; page.on('pageerror', e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   const press=s=>page.locator(s)[mobile?'tap':'click']();
   await page.goto(base); await page.waitForFunction(()=>window.mygrainKMultitrack&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');
   await page.evaluate(()=>mygrainCardHistory.ready); await press('#start-btn'); await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   const dsp=await page.evaluate(async()=>{
    const rms=(data,first,last)=>{let sum=0;for(let i=first;i<last;i++)sum+=data[i]**2;return Math.sqrt(sum/(last-first))};
    async function render(settings,impulse=false) {
     const rate=16000,ctx=new OfflineAudioContext(2,rate*2,rate),input=ctx.createGain(),pan=ctx.createStereoPanner();
     const graph=MygrainKTrackDsp.create(ctx,input,pan,MygrainKMultitrack.processing(settings),120,ctx.destination);
     const b=ctx.createBuffer(1,rate/2,rate),a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=impulse?(i<160?.15:0):.15*Math.sin(2*Math.PI*1000*i/rate);
     const source=ctx.createBufferSource();source.buffer=b;source.connect(input);graph.start(0,.5);source.start(0);
     const out=await ctx.startRendering(),data=out.getChannelData(0),result={body:rms(data,1600,6400),tail:rms(data,9600,18000),peak:Math.max(...data),nodes:graph.nodes.length};graph.dispose();return result;
    }
    const bypass=await render({filterMode:'bypass'}),filtered=await render({cutoff:200,filterMode:'lowpass-48'}),delay=await render({filterMode:'bypass',delayMix:.6,delayFeedback:.6},true),reverb=await render({filterMode:'bypass',reverbMix:.6,reverbDecay:2},true),drive=await render({filterMode:'bypass',drive:12});
    if(!(filtered.body<bypass.body*.02))throw new Error('Filter did not attenuate the tone');
    if(!(delay.tail>.0001&&reverb.tail>.00001))throw new Error('Missing local FX tails');
    if(!(Math.abs(drive.body-bypass.body)>.001))throw new Error('Drive did not process audio');
    return {bypass,filtered,delay,reverb,drive};
   });
   // Install five distinct takes and count graph lifetimes without retaining disposed nodes.
   await page.evaluate(()=>{
    stopAllPerformancePlayback({silent:true});setHoldEnabled(false);setArpeggiatorEnabled(false,{skipSave:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});setFxMuted(true,{silent:true});
    applyGlobalBpm(300);syncPatternLengthControls(8,{skipSave:true});
    for(const layer of SPARSE_RANDOM_LAYER_DEFINITIONS)layer.setEnabled(false,{silent:true,skipSave:true});
    window.dspLive=new Set();window.dspCreated=0;window.dspDisposed=0;const original=MygrainKTrackDsp;
    window.MygrainKTrackDsp={create(...args){const graph=original.create(...args),dispose=graph.dispose;dspCreated++;dspLive.add(graph);graph.dispose=()=>{if(dspLive.delete(graph))dspDisposed++;dispose()};return graph}};
    for(let i=0;i<5;i++){const b=audioContext.createBuffer(1,Math.round(audioContext.sampleRate*.4),audioContext.sampleRate),a=b.getChannelData(0);for(let frame=0;frame<a.length;frame++)a[frame]=.1*Math.sin(2*Math.PI*(220+i*110)*frame/b.sampleRate);mygrainKMultitrack.setBuffer(i,b);Object.assign(mygrainKMultitrack.tracks[i],{sourceBpm:300,steps:8,metadata:{durationSeconds:.4,recordingSteps:8}})}
    mygrainKMultitrack.refreshBuffers();
   });
   const edit=async(key,value)=>{
    const input=page.locator(`[data-k-processing="${key}"]`);
    await input.evaluate((e,value)=>{if(e.type==='checkbox')e.checked=value;else e.value=String(value);e.dispatchEvent(new Event('change',{bubbles:true}))},value);
    await page.waitForFunction(()=>!mygrainCardHistory.busy);
   };
   const colours=[];
   for(let i=0;i<5;i++){
    await press(`[data-k-track="${i}"] [data-k-record-select]`);await edit('cutoff',700+i*900);await edit('semitone',i-2);await edit('preserveDuration',false);await edit('delayMix',i*5);await edit('reverbMix',i*4);
    const state=await page.evaluate(i=>({selected:mygrainKMultitrack.selected,cutoff:mygrainKMultitrack.tracks[i].processing.cutoff,title:document.querySelector('[data-k-editor-title]').textContent,row:document.querySelector(`[data-k-track="${i}"]`).style.getPropertyValue('--k-track-rgb'),editor:document.getElementById('kTrackControlSection').style.getPropertyValue('--k-track-rgb')}),i);
    assert.equal(state.selected,i);assert.equal(state.cutoff,700+i*900);assert.match(state.title,new RegExp(`K${i+1}`));assert.equal(state.row,state.editor);colours.push(state.row);
   }
   assert.equal(new Set(colours).size,5);
   await press('[data-k-track="0"] [data-k-record-select]');assert.equal(await page.locator('[data-k-processing="cutoff"]').inputValue(),'700');
   assert.equal(await page.locator('[data-k-processing="filterMode"]').inputValue(),'lowpass-48');
   await page.locator('#kTrackControlSection').scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/${engine}-${mobile?'phone':'desktop'}-controls.png`});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   const lifecycle=await page.evaluate(async()=>{
    const k=mygrainKMultitrack;k.change(2,'mute',true);k.change(3,'enabled',false);k.change(4,'level',0);
    setBastardLoopKEnabled(true,{silent:true,skipSave:true});setBastardLoopPlaying(true,{silent:true,skipSave:true});
    if(k.voices.size!==2||k.voices.has(2)||k.voices.has(3)||k.voices.has(4))throw new Error('Idle K tracks created voices');
    const peer=k.voices.get(1).source;if(Math.abs(peer.playbackRate.value-2**(-1/12))>.00001)throw new Error('Track pitch mapping failed');k.changeProcessing('cutoff',350);
    if(k.voices.get(1).source!==peer)throw new Error('Selected-track filter edit restarted a peer');
    k.changeProcessing('preserveDuration',true);for(const pitch of [3,7,-5,2])k.changeProcessing('semitone',pitch);k.changeProcessing('reverse',true);if(tempoLockedPitchBufferCache.get(k.tracks[0].raw)?.size||reversedAudioBufferCache.has(k.tracks[0].raw))throw new Error('K accumulated global pitch/reverse copies');if(k.voices.get(1).source!==peer||k.tracks[0].rendered.duration!==k.tracks[0].raw.duration)throw new Error('Independent duration-preserving tuning failed');
    for(let n=0;n<10;n++){k.change(0,'mute',true);await new Promise(r=>setTimeout(r,30));k.change(0,'mute',false);await new Promise(r=>setTimeout(r,30))}
    if(k.voices.get(1).source!==peer)throw new Error('Mute cycled a peer');
    const active=k.voices.size;setBastardLoopKEnabled(false,{silent:true,skipSave:true});await new Promise(r=>setTimeout(r,80));if(k.voices.size||dspLive.size)throw new Error('K master-off retained processing');setBastardLoopKEnabled(true,{silent:true,skipSave:true});if(k.voices.size!==2)throw new Error('K master-on did not resume audible tracks');stopAllPerformancePlayback({silent:true});await new Promise(r=>setTimeout(r,100));
    if(dspLive.size)throw new Error(`Retained ${dspLive.size} stopped DSP graphs`);
    return {active,created:dspCreated,disposed:dspDisposed};
   });
   assert.equal(lifecycle.created,lifecycle.disposed);
   // Actual keyboard capture signal must decay for all five sound engines.
   const decay=await page.evaluate(async()=>{
    stopAllPerformancePlayback({silent:true});setHoldEnabled(false);setArpeggiatorEnabled(false,{skipSave:true});
    const tone=audioContext.createBuffer(1,audioContext.sampleRate*4,audioContext.sampleRate),a=tone.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=.3*Math.sin(2*Math.PI*261.625565*i/tone.sampleRate);
    setKeyboardSampleBuffer(tone);keyboardSampleMetadata={fileName:'Decay C4 fixture',rootMidi:60};grainASampleBuffer=tone;grainBSampleBuffer=tone;
    document.getElementById('grainSynthASource').value='grainASample';document.getElementById('grainSynthBSource').value='grainBSample';syncLegacyAudioBuffer();
    setGranularLayerMuted('A',false,{silent:true,skipSave:true});setGranularLayerMuted('B',true,{silent:true,skipSave:true});
    const analyser=audioContext.createAnalyser();analyser.fftSize=512;keyboardGrainCaptureGain.connect(analyser);const sink=audioContext.createGain();sink.gain.value=0;analyser.connect(sink);sink.connect(audioContext.destination);
    const sample=()=>{const data=new Float32Array(512);analyser.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((sum,x)=>sum+x*x,0)/data.length)};
    const result=[];setKeyboardDecay(350,{skipSave:true});
    for(const instrument of ['sample','piano','strings','osc','grain']){
     stopKeyboardSounds({immediate:true});setKeyboardSoundSource(instrument,{skipSave:true});await prepareKeyboardSound(instrument);setHoldEnabled(true);
     playKeyboardSound('C4');let early=0;for(let i=0;i<5;i++){await new Promise(r=>setTimeout(r,35));early=Math.max(early,sample())}
     await new Promise(r=>setTimeout(r,450));const late=sample();
     const retained={samples:keyboardSamplePlayer?.activeVoices.size||0,osc:[...activeOscVoices.values()].filter(v=>isKeyboardSoundRole(v.role)).length,streams:[...activeGrains.values()].filter(v=>isKeyboardSoundRole(v.role)).length};
     if(!(early>.00001&&late<Math.max(.00001,early*.005)))throw new Error(`Decay ${instrument}: ${early} -> ${late}`);
     if(retained.samples||retained.osc||retained.streams)throw new Error(`Decay retains ${instrument}: ${JSON.stringify(retained)}`);
     result.push({instrument,early,late,retained});setHoldEnabled(false);
    }
    // Off must retain each native envelope, including the original full grain window.
    setKeyboardDecay(0,{skipSave:true});
    for(const instrument of ['sample','piano','strings','osc','grain']){
     stopKeyboardSounds({immediate:true});setKeyboardSoundSource(instrument,{skipSave:true});await prepareKeyboardSound(instrument);setHoldEnabled(true);playKeyboardSound('C4');await new Promise(r=>setTimeout(r,650));const nativeLate=sample();if(!(nativeLate>.00001))throw new Error(`Off changed native ${instrument} envelope: ${nativeLate}`);setHoldEnabled(false);result.find(r=>r.instrument===instrument).nativeLate=nativeLate;
    }
    setKeyboardDecay(350,{skipSave:true});
    keyboardGrainCaptureGain.disconnect(analyser);analyser.disconnect();sink.disconnect();return result;
   });
   // A worklet-recorded K take contains the decay, without an extra global envelope at playback.
   await page.selectOption('#performanceKeyboardKTrack','4');
   await page.locator('#performanceKeyboardKRecordSteps').fill('16');await page.locator('#performanceKeyboardKRecordSteps').press('Tab');
   await page.evaluate(async()=>{stopAllPerformancePlayback({silent:true});setKeyboardSoundSource('sample',{skipSave:true});await prepareKeyboardSound('sample');heldNotes=new Set(['C4']);setHoldEnabled(true)});
   await press('#performanceKeyboardToKRecordSurfaceBtn');
   await page.waitForFunction(()=>bastardLoopKRecordingState==='idle'&&bastardLoopKMetadata?.recordingSteps===16&&!mygrainCardHistory.busy,null,{timeout:20000});
   const recorded=await page.evaluate(()=>{const b=bastardLoopKRawBuffer,a=b.getChannelData(0),rms=(first,last)=>{let sum=0;for(let i=first;i<last;i++)sum+=a[i]**2;return Math.sqrt(sum/(last-first))};return{duration:b.duration,early:rms(0,Math.floor(b.sampleRate*.2)),late:rms(Math.floor(b.sampleRate*.6),a.length)}});
   assert(recorded.early>.0001&&recorded.late<recorded.early*.005,JSON.stringify(recorded));
   await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});setHoldEnabled(false)});
   // New settings survive real Song save/amend/recall, Undo/Redo and render.
   const song=await page.evaluate(async()=>{
    stopAllPerformancePlayback({silent:true});setHoldEnabled(false);const k=mygrainKMultitrack,c=mygrainSongBeta;
    k.select(0);const before=k.tracks[0].processing.cutoff;k.changeProcessing('cutoff',900);await mygrainCardHistory.undo();if(k.tracks[0].processing.cutoff!==before)throw new Error('Track processing Undo failed');await mygrainCardHistory.redo();if(k.tracks[0].processing.cutoff!==900)throw new Error('Track processing Redo failed');
    document.getElementById('songBetaName').value='Independent K processing';await c.newSong();await c.newPart({name:'Five distinct K tracks',repeats:1});if(!c.song?.parts.length)throw new Error(document.getElementById('songBetaStatus').textContent);
    const expected=k.captureSettings();await c.recall(c.song.parts[0],{start:false});if(JSON.stringify(k.captureSettings())!==JSON.stringify(expected))throw new Error('K processing Song recall mismatch');
    if(getKeyboardDecaySeconds()!==.35)throw new Error('Keyboard decay not saved');
    await c.run(()=>c.amendPart(c.song.parts[0]));k.select(1);k.changeProcessing('resonance',2.5);k.changeProcessing('delayMix',.17);setKeyboardDecay(560,{skipSave:true});
    await c.run(()=>c.savePart());await c.recall(c.song.parts[0],{start:false});if(k.tracks[1].processing.resonance!==2.5||k.tracks[1].processing.delayMix!==.17||getKeyboardDecaySeconds()!==.56)throw new Error('Amendment did not retain selected processing');
    await c.finishEditing();await c.arm();if(!c.armed)throw new Error(document.getElementById('songBetaStatus').textContent);const render=c.renders.get(c.song.parts[0].id),a=render.getChannelData(0),rms=Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);if(!(rms>.0001))throw new Error('Silent K processing Song');
    const part=await c.readPartMetadata(c.song.parts[0]);const old=structuredClone(part.snapshot);old.state.modes.kMultitrack.version=1;for(const t of old.state.modes.kMultitrack.tracks)delete t.processing;old.state.sliders.performanceBastardLoopKSemitone='3';old.state.sliders.performanceBastardLoopKFilterCutoff='4200';const raw=JSON.stringify(old),converted=MygrainKMultitrack.convertSnapshot(old);
    if(!converted.changed||JSON.stringify(old)!==raw||converted.snapshot.state.modes.kMultitrack.tracks.some(t=>t.processing.semitone!==3||t.processing.cutoff!==4200))throw new Error('Legacy multitrack conversion failed');
    return {version:k.captureSettings().version,cutoffs:k.tracks.map(t=>t.processing.cutoff),rms,converted:true,decay:getKeyboardDecaySeconds()};
   });
   // Convert an actual version-one multitrack ZIP using the visible Song-editor action.
   const legacyHash=await page.evaluate(async()=>{
    const c=mygrainSongBeta,part=c.song.parts[0],entries=parseStoredZipEntries(await c.request(`/${c.song.id}/parts/${part.id}`,{binary:true})),s=JSON.parse(getZipText(entries,'song-part.json'));
    s.state.modes.kMultitrack.version=1;for(const t of s.state.modes.kMultitrack.tracks)delete t.processing;
    s.state.sliders.performanceBastardLoopKSemitone='3';s.state.sliders.performanceBastardLoopKFilterCutoff='4200';
    const archive=await createStoredZip([...entries].map(([path,data])=>({path,data:path==='song-part.json'?JSON.stringify(s):data})));
    await c.ensureEditing();const result=await c.request(`/${c.song.id}/parts?name=Legacy-five-K&repeats=1`,{method:'POST',headers:{'Content-Type':'application/zip'},body:archive});c.acceptSong(result.song);window.legacyKEntries=entries;return c.song.parts.at(-1).sha256;
   });
   await press('#songBetaConvertK');await page.waitForFunction(()=>!mygrainSongBeta.busy&&/K conversion complete/.test(document.getElementById('songBetaStatus').textContent));
   const conversion=await page.evaluate(async()=>{
    const c=mygrainSongBeta,part=c.song.parts.at(-1),entries=parseStoredZipEntries(await c.request(`/${c.song.id}/parts/${part.id}`,{binary:true})),s=JSON.parse(getZipText(entries,'song-part.json'));
    let audio=0;for(const [path,bytes] of entries){if(!path.startsWith('audio/'))continue;const old=legacyKEntries.get(path);if(!old||old.length!==bytes.length||bytes.some((v,i)=>v!==old[i]))throw new Error('Conversion changed recorded audio');audio++}
    if(s.state.modes.kMultitrack.version!==2||s.state.modes.kMultitrack.tracks.some(t=>t.processing.semitone!==3||t.processing.cutoff!==4200))throw new Error('Conversion did not preserve shared processing');
    await c.recall(part,{start:false});if(mygrainKMultitrack.tracks.some(t=>!t.raw||t.processing.semitone!==3))throw new Error('Converted multitrack recall failed');return{audio,hash:part.sha256,armed:c.armed};
   });
   assert(conversion.audio>=5);assert.notEqual(conversion.hash,legacyHash);assert.equal(conversion.armed,false);
   if(mobile){for(const viewport of [{width:320,height:640},{width:844,height:390}]){await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)}}
   // Navigating to another track also stops and disposes a selected-track audition.
   await press('#performanceBastardLoopKAuditionBtn');await page.waitForTimeout(30);await press('[data-k-track="0"] [data-k-record-select]');await page.waitForTimeout(40);
   assert.equal(await page.evaluate(()=>activeSourceCardAuditionKind==='bastardk'),false);
   assert.deepEqual(errors,[]);results.push({engine,mobile,dsp,colours,lifecycle,decay,recorded,song,conversion});fs.writeFileSync(`${evidence}/results.json`,JSON.stringify(results,null,2));
   console.log(JSON.stringify({engine,mobile,lifecycle,decay,recorded,song,conversion}));await context.close();
  }} finally {await browser.close()}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
