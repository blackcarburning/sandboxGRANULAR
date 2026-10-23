// Real five-track capture, independent Web Audio looping, Song conversion/recall, local accounts only.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18919/mygrain/';
assert.match(base,/^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
(async()=>{
 const results=[];
 for(const [engine,type] of Object.entries({chromium,webkit})) {
  const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try {for(const mobile of [false,true]) {
   if(process.env.K_ENGINE&&process.env.K_ENGINE!==engine)continue;
   if(process.env.K_MOBILE&&process.env.K_MOBILE!==String(mobile))continue;
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
   assert.equal((await context.request.post(base+'api/auth/register',{data:{username:`kfive_${engine[0]}_${+mobile}_${Date.now()}`,password:'isolated-k-five-recorder'}})).status(),200);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   const press=s=>mobile?page.locator(s).tap():page.locator(s).click();
   async function start(){await page.waitForFunction(()=>window.mygrainKMultitrack&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await press('#start-btn');await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);}
   await page.goto(base);await start();
   assert.equal(await page.locator('[data-k-track]').count(),5);
   // Independent source periods are checked against actual rendered PCM, not just node properties.
   const pcm=await page.evaluate(async()=>{
    const ctx=new OfflineAudioContext(2,16000,8000),periods=[.125,.25,.375,.5,.625],levels=[.12,.08,.05,.04,.03],pans=[-1,1,0,-1,1];
    const k=MygrainKMultitrack.create({context:()=>ctx,bpm:()=>120,pitchRate:()=>1,masterGain:()=>1,memoryBudget:()=>8*1048576,timing:()=>({time:0,origin:0}),route(g,p){g.connect(p);p.connect(ctx.destination);return []},disconnectFilters(){},startSource(s,t,o){s.buffer=s.patternSectionBuffer;s.start(t,o)}});
    periods.forEach((period,i)=>{const b=ctx.createBuffer(1,Math.round(period*8000),8000);b.getChannelData(0).fill(1,0,40);k.setBuffer(i,b);Object.assign(k.tracks[i],{sourceBpm:120,steps:i+1,level:levels[i],pan:pans[i],mute:i===4})});
    k.start();const out=await ctx.startRendering(),left=out.getChannelData(0),right=out.getChannelData(1);let worst=0;
    for(let frame=200;frame<16000;frame++){let l=0,r=0;periods.forEach((period,i)=>{if(i===4)return;if(frame%Math.round(period*8000)>=40)return;l+=levels[i]*Math.cos((pans[i]+1)*Math.PI/4);r+=levels[i]*Math.sin((pans[i]+1)*Math.PI/4)});worst=Math.max(worst,Math.abs(left[frame]-l),Math.abs(right[frame]-r));}
    return {worst,peak:Math.max(...left)};
   });
   assert(pcm.worst<.0001,JSON.stringify(pcm));assert(pcm.peak>.1);
   await page.evaluate(async()=>{stopAllPerformancePlayback({silent:true});setArpeggiatorEnabled(false,{skipSave:true});applyGlobalBpm(300);syncPatternLengthControls(8,{skipSave:true});setDrumMachineEnabled(false,{silent:true,skipSave:true});setFxMuted(true,{silent:true});setKeyboardSoundSource('osc',{skipSave:true});await prepareKeyboardSound('osc');heldNotes=new Set(['C4','E4']);setHoldEnabled(true)});
   const takes=[];
   for(const [index,steps] of [3,5,7,8,11].entries()) {
    await page.selectOption('#performanceKeyboardKTrack',String(index));
    assert.equal(await page.locator(`[data-k-track="${index}"] [data-k-record-select]`).isChecked(),true);
    await page.locator('#performanceKeyboardKRecordSteps').fill(String(steps));await page.locator('#performanceKeyboardKRecordSteps').press('Tab');
    await page.evaluate(()=>{heldNotes=new Set(['C4','E4']);setHoldEnabled(true)});
    await press('#performanceKeyboardToKRecordSurfaceBtn');
    await page.waitForFunction(()=>bastardLoopKRecordingState==='countin');
    assert.equal(await page.locator('#performanceKeyboardKTrack').isDisabled(),true);
    await page.waitForFunction(expected=>bastardLoopKRecordingState==='idle'&&bastardLoopKMetadata?.recordingSteps===expected&&!mygrainCardHistory.busy,steps,{timeout:20000});
    const take=await page.evaluate(()=>{const b=bastardLoopKRawBuffer;let sum=0;for(const v of b.getChannelData(0))sum+=v*v;return{frames:b.length,rate:b.sampleRate,rms:Math.sqrt(sum/b.length),tracks:mygrainKMultitrack.tracks.map(t=>t.raw?.length||0)}});
    assert.equal(take.frames,Math.round(steps*.05*take.rate));assert(take.rms>.0001,JSON.stringify(take));assert.equal(take.tracks.filter(Boolean).length,index+1);takes.push(take);
    await page.evaluate(()=>stopAllPerformancePlayback({silent:true}));
   }
   // Record select and keyboard destination are a single, bidirectional choice.
   await press('[data-k-track="1"] [data-k-record-select]');assert.equal(await page.locator('#performanceKeyboardKTrack').inputValue(),'1');
   await press('#performanceKeyboardKSolo');assert.equal(await page.locator('#performanceKeyboardKSolo').getAttribute('aria-pressed'),'true');await press('#performanceKeyboardKSolo');
   const edit=async(selector,value)=>{await page.locator(selector).evaluate((e,value)=>{e.value=String(value);e.dispatchEvent(new Event('change',{bubbles:true}))},value);await page.waitForFunction(()=>!mygrainCardHistory.busy)};
   await edit('[data-k-track="1"] [data-k-level]',37);await edit('[data-k-track="2"] [data-k-pan]',-80);await press('[data-k-track="3"] [data-k-mute]');await page.waitForFunction(()=>!mygrainCardHistory.busy);
   await page.evaluate(()=>{setBastardLoopKEnabled(true,{silent:true});setBastardLoopPlaying(true,{silent:true})});
   await page.waitForFunction(()=>[...mygrainKMultitrack.voices.values()].every(v=>audioContext.currentTime>v.source.patternSectionStart+.03));
   const playback=await page.evaluate(()=>[...mygrainKMultitrack.voices.values()].map(v=>({period:v.source.loopEnd,level:v.gain.gain.value,pan:v.pan.pan.value,rate:v.source.playbackRate.value})));
   assert.equal(playback.length,5);playback.forEach((v,i)=>assert(Math.abs(v.period-[3,5,7,8,11][i]*.05)<.00003));assert(Math.abs(playback[2].pan+.8)<1e-6);assert.equal(playback[3].level,0);
   // Live period edits crop/pad just that track and reject unsafe lengths before replacing its graph.
   await edit('[data-k-track="0"] [data-k-steps]',2);
   assert(Math.abs(await page.evaluate(()=>mygrainKMultitrack.voices.get(0).source.loopEnd)-.1)<.00003);
   await edit('[data-k-track="0"] [data-k-steps]',6);
   assert(Math.abs(await page.evaluate(()=>mygrainKMultitrack.voices.get(0).source.buffer.duration)-.3)<.00003);
   await edit('[data-k-track="0"] [data-k-steps]',3);
   const rejected=await page.evaluate(()=>{const source=mygrainKMultitrack.voices.get(0).source;try{mygrainKMultitrack.change(0,'steps',1e9)}catch{}return{steps:mygrainKMultitrack.tracks[0].steps,same:source===mygrainKMultitrack.voices.get(0).source}});
   assert.deepEqual(rejected,{steps:3,same:true});
   await page.evaluate(()=>stopAllPerformancePlayback({silent:true}));
   const saved=await page.evaluate(async()=>{const c=mygrainSongBeta;document.getElementById('songBetaName').value='Five K tracks';await c.newSong();await c.newPart({name:'Five independent takes',repeats:1});const part=c.song.parts[0];await c.recall(part,{start:false});return{config:mygrainKMultitrack.captureSettings(),frames:mygrainKMultitrack.tracks.map(t=>t.raw.length),snapshot:await c.readPartMetadata(part)}});
   assert.deepEqual(saved.frames,takes.map(t=>t.frames));assert.equal(saved.config.selected,1);assert.equal(saved.config.tracks[1].level,.37);assert.equal(saved.config.tracks[2].pan,-.8);assert.equal(saved.config.tracks[3].mute,true);
   // One changed track's clear and Undo must not touch the other four takes.
   const history=await page.evaluate(async()=>{const before=mygrainKMultitrack.tracks.map(t=>t.raw.length);await mygrainCardHistory.run('Clear selected K fixture',()=>clearBastardLoopK({silent:true}),false,false,true);const after=mygrainKMultitrack.tracks.map(t=>t.raw?.length||0);await mygrainCardHistory.undo();return{before,after,undo:mygrainKMultitrack.tracks.map(t=>t.raw?.length||0)}});
   assert.equal(history.after[1],0);assert.deepEqual(history.undo,history.before);
   // A real take during Amend replaces only its selected track and is saved atomically.
   await page.evaluate(async()=>{const c=mygrainSongBeta;await c.run(()=>c.amendPart(c.song.parts[0]));if(!c.editing)throw new Error('Amend did not open')});
   await page.selectOption('#performanceKeyboardKTrack','4');
   await page.locator('#performanceKeyboardKRecordSteps').fill('9');await page.locator('#performanceKeyboardKRecordSteps').press('Tab');
   await page.evaluate(async()=>{setKeyboardSoundSource('osc',{skipSave:true});await prepareKeyboardSound('osc');heldNotes=new Set(['C4','E4']);setHoldEnabled(true)});
   await press('#performanceKeyboardToKRecordSurfaceBtn');
   await page.waitForFunction(()=>bastardLoopKRecordingState==='idle'&&bastardLoopKMetadata?.recordingSteps===9&&!mygrainCardHistory.busy,null,{timeout:20000});
   const amended=await page.evaluate(async()=>{const c=mygrainSongBeta;stopAllPerformancePlayback({silent:true});setLoopLayerSolo('bastardk',{silent:true});await c.run(()=>c.savePart());await c.recall(c.song.parts[0],{start:false});return{frames:mygrainKMultitrack.tracks.map(t=>t.raw.length),selected:mygrainKMultitrack.selected}});
   assert.deepEqual(amended.frames.slice(0,4),takes.slice(0,4).map(t=>t.frames));assert.equal(amended.frames[4],Math.round(9*.05*takes[4].rate));takes[4].frames=amended.frames[4];
   await page.selectOption('#performanceKeyboardKTrack','1');
   // Real hidden renderer must retain all five tracks and produce non-silent output.
   await page.evaluate(async()=>{stopAllPerformancePlayback({silent:true});await mygrainSongBeta.finishEditing();await mygrainSongBeta.arm()});
   const armed=await page.evaluate(async()=>{const c=mygrainSongBeta,b=await c.loadRender(c.song.parts[0]);let sum=0;for(const v of b.getChannelData(0))sum+=v*v;return{armed:c.armed,renders:c.renderBytes,rms:Math.sqrt(sum/b.length),status:document.getElementById('songBetaStatus').textContent}});assert.equal(armed.armed,true,armed.status);assert(armed.rms>.0001,JSON.stringify(armed));
   // Durable browser audio restore, with selected K2 rather than canonical K1.
   await page.evaluate(async()=>{saveState({force:true});await mygrainSongBetaAdapter.whenPersisted()});await page.reload();await start();
   const reloaded=await page.evaluate(()=>({config:mygrainKMultitrack.captureSettings(),frames:mygrainKMultitrack.tracks.map(t=>t.raw?.length||0)}));
   assert.deepEqual(reloaded.frames,takes.map(t=>t.frames));assert.equal(reloaded.config.selected,1);assert.equal(reloaded.config.tracks[3].mute,true);
   // Convert a real old one-track archive through the visible Song-editor action.
   const legacy=await page.evaluate(async()=>{
    const c=mygrainSongBeta,original=c.song.parts[0];const body=await c.request(`/${c.song.id}/parts/${original.id}`,{binary:true});const entries=parseStoredZipEntries(body),s=JSON.parse(getZipText(entries,'song-part.json'));
    delete s.state.modes.kMultitrack;s.state.modes.bastardLoopKRecordingSteps=3;s.state.modes.bastardLoopKSourceBpm=300;
    const removed=new Set(['bastardKTrack2','bastardKTrack3','bastardKTrack4','bastardKTrack5']);s.assets=s.assets.filter(a=>!removed.has(a.key));for(const key of removed)delete s.extra.audioSlots[key];s.extra.metadata.bastardK={...s.extra.metadata.bastardK,recordingSteps:3};
    const archive=await createStoredZip([...entries].filter(([path])=>![...removed].some(key=>path===`audio/${key}.wav`)).map(([path,data])=>({path,data:path==='song-part.json'?JSON.stringify(s):data})));
    await c.ensureEditing();const result=await c.request(`/${c.song.id}/parts?name=Legacy-K&repeats=1`,{method:'POST',headers:{'Content-Type':'application/zip'},body:archive});c.acceptSong(result.song);window.__legacyEntries=entries;window.__legacyHash=c.song.parts.at(-1).sha256;return{hash:window.__legacyHash};
   });
   await press('#songBetaConvertK');await page.waitForFunction(()=>!mygrainSongBeta.busy&&/K conversion complete/.test(document.getElementById('songBetaStatus').textContent));
   const converted=await page.evaluate(async()=>{const c=mygrainSongBeta,part=c.song.parts.at(-1);const body=await c.request(`/${c.song.id}/parts/${part.id}`,{binary:true});const entries=parseStoredZipEntries(body),s=JSON.parse(getZipText(entries,'song-part.json'));let equal=true;for(const [path,bytes] of entries){if(path==='song-part.json')continue;const old=__legacyEntries.get(path);if(!old||old.length!==bytes.length||bytes.some((v,i)=>v!==old[i]))equal=false}await c.recall(part,{start:false});return{hash:part.sha256,config:s.state.modes.kMultitrack,equal,tracks:mygrainKMultitrack.tracks.map(t=>t.raw?.length||0),armed:c.armed}});
   assert.notEqual(converted.hash,legacy.hash);assert.equal(converted.equal,true);assert.equal(converted.config.tracks.length,5);assert.deepEqual(converted.tracks,[takes[0].frames,0,0,0,0]);assert.equal(converted.armed,false);
   // Preset restoration applies K mix/selection immediately, while raw ZIP bindings stay canonical K1.
   const preset=await page.evaluate(()=>{const p=gatherPreset();p.kMultitrack.tracks[0].level=.23;p.kMultitrack.tracks[0].pan=.4;p.kMultitrack.selected=4;setBastardLoopPlaying(true,{silent:true});applyPreset(p);return{selected:mygrainKMultitrack.selected,level:mygrainKMultitrack.tracks[0].level,canonical:PATCH_REPOSITORY_AUDIO_ENTRIES.find(e=>e.key==='bastardK').getBuffer()===mygrainKMultitrack.getBuffer(0),saved:saveState({snapshotOnly:true}).modes.kMultitrack}});
   assert.equal(preset.selected,4);assert.equal(preset.level,.23);assert.equal(preset.canonical,true);assert.equal(preset.saved.tracks[0].pan,.4);
   await page.evaluate(()=>stopAllPerformancePlayback({silent:true}));
   // Only K5 audio, K1/K2 selected empty: transport must still start all playable K tracks.
   const onlyFifth=await page.evaluate(()=>{const b=mygrainKMultitrack.getBuffer(0);for(let i=0;i<5;i++)mygrainKMultitrack.setBuffer(i,i===4?b:null);mygrainKMultitrack.refreshBuffers();mygrainKMultitrack.select(0);setBastardLoopKEnabled(true,{silent:true});setBastardLoopPlaying(true,{silent:true});const keys=[...mygrainKMultitrack.voices.keys()];return keys});assert.deepEqual(onlyFifth,[4]);
   const cleared=await page.evaluate(async()=>{mygrainKMultitrack.select(4);await clearBastardLoopK({silent:true});return mygrainKMultitrack.voices.size});assert.equal(cleared,0);
   await page.locator('#kMultitrackTracks').screenshot({path:`/tmp/mygrain-k-five-${engine}-${mobile?'phone':'desktop'}-tracks.png`});
   await page.locator('#bastardLoopKCard').scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/mygrain-k-five-${engine}-${mobile?'phone':'desktop'}.png`});
   if(mobile){for(const viewport of [{width:320,height:640},{width:844,height:390}]){await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)}}
   assert.deepEqual(errors,[]);results.push({engine,mobile,takes:takes.map(t=>({frames:t.frames,rms:t.rms})),pcm,armed,convertedAudioIdentical:converted.equal});console.log('PASS',engine,mobile);
   await context.close();
  }} finally {await browser.close()}
 }
 fs.writeFileSync('/tmp/mygrain-k-five-browser-results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
