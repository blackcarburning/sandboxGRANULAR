// Real DSP and complete saved-state round trips in disposable localhost stores.
const assert = require('node:assert/strict'), fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18919/mygrain/';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
const evidence = process.env.K_REVERB_EVIDENCE || '/tmp/mygrain-k-reverb';
fs.mkdirSync(evidence, {recursive:true});
(async()=>{
 const results=[];
 for(const [engine,type] of Object.entries({chromium,webkit})){
  if(process.env.K_ENGINE && process.env.K_ENGINE!==engine)continue;
  const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{for(const mobile of [true,false]){
   if(process.env.K_MOBILE && process.env.K_MOBILE!==String(mobile))continue;
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
   assert.equal((await context.request.post(base+'api/auth/register',{data:{username:`kroom_${engine[0]}_${+mobile}_${Date.now()}`,password:'isolated-k-room-fixture'}})).status(),200);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   await page.goto(base);await page.waitForFunction(()=>window.mygrainKMultitrack&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');
   await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn')[mobile?'tap':'click']();
   await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   const audio=await page.evaluate(async()=>{
    const rms=(data,rate,start,end)=>{let sum=0,n=0;for(let i=Math.round(start*rate);i<Math.round(end*rate);i++){sum+=data[i]*data[i];n++}return Math.sqrt(sum/n)};
    const runs=[];
    for(const rate of [16000,44100])for(const frequency of [1000,4400]){
     const ctx=new OfflineAudioContext(2,rate*9,rate),input=ctx.createGain(),pan=ctx.createStereoPanner();
     const g=MygrainKTrackDsp.create(ctx,input,pan,MygrainKMultitrack.processing({filterMode:'bypass',reverbMix:.6,reverbDecay:4}),120,ctx.destination);
     const buffer=ctx.createBuffer(1,rate*4,rate),samples=buffer.getChannelData(0);
     for(let i=0;i<samples.length;i++)samples[i]=.15*Math.sin(2*Math.PI*frequency*i/rate);
     const source=ctx.createBufferSource();source.buffer=buffer;source.connect(input);source.start(0);
     const rendered=await ctx.startRendering(),data=rendered.getChannelData(0);
     const result={rate,frequency,body:rms(data,rate,3,3.5),tail:rms(data,rate,4.2,4.5),late:rms(data,rate,8.3,8.8),peak:data.reduce((p,v)=>Math.max(p,Math.abs(v)),0)};
     if(!(result.body>.03&&result.tail>.000001&&result.late<1e-7&&result.peak<.75))throw new Error('K reverb tone regression: '+JSON.stringify(result));
     g.dispose();runs.push(result);
    }
    for(const decay of [.2,1.2,4]){
     const rate=16000,ctx=new OfflineAudioContext(2,rate*(decay+.8),rate),input=ctx.createGain(),pan=ctx.createStereoPanner();
     const g=MygrainKTrackDsp.create(ctx,input,pan,MygrainKMultitrack.processing({filterMode:'bypass',reverbMix:.6,reverbDecay:decay}),120,ctx.destination);
     const room=g.nodes.find(n=>n instanceof ConvolverNode);
     if(Math.abs(room.buffer.duration-decay)>1/rate)throw new Error('K Decay seconds changed');
     const buffer=ctx.createBuffer(1,160,rate),a=buffer.getChannelData(0);let seed=1;
     for(let i=0;i<a.length;i++){seed=(seed*1664525+1013904223)>>>0;a[i]=.15*(seed/2147483648-1)}
     const source=ctx.createBufferSource();source.buffer=buffer;source.connect(input);source.start(0);
     const rendered=await ctx.startRendering(),data=rendered.getChannelData(0),tail=rms(data,rate,.05,.12),late=rms(data,rate,decay+.3,decay+.6);
     if(!(tail>1e-5&&late<1e-7))throw new Error('Finite Hall impulse failed: '+JSON.stringify({decay,tail,late}));
     g.dispose();if(room.buffer!==null)throw new Error('Disposed room retained its impulse');runs.push({decay,tail,late});
    }
    // No input must not produce an autonomous tone.
    const ctx=new OfflineAudioContext(2,16000*2,16000),g=MygrainKTrackDsp.create(ctx,ctx.createGain(),ctx.createStereoPanner(),MygrainKMultitrack.processing({filterMode:'bypass',reverbMix:.6,reverbDecay:4}),120,ctx.destination);
    const silence=await ctx.startRendering();if(silence.getChannelData(0).some(v=>Math.abs(v)>1e-12))throw new Error('Room self-oscillates without input');g.dispose();
    return runs;
   });
   await page.evaluate(()=>{
    stopAllPerformancePlayback({silent:true});setHoldEnabled(false);setArpeggiatorEnabled(false,{skipSave:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});setFxMuted(true,{silent:true});
    applyGlobalBpm(300);syncPatternLengthControls(8,{skipSave:true});for(const layer of SPARSE_RANDOM_LAYER_DEFINITIONS)layer.setEnabled(false,{silent:true,skipSave:true});
    window.roomGraphs=new Set();window.roomCreated=0;window.roomDisposed=0;window.roomCleared=0;
    const original=MygrainKTrackDsp;window.MygrainKTrackDsp={prepare:original.prepare,create(...args){const graph=original.create(...args),dispose=graph.dispose;roomGraphs.add(graph);roomCreated++;graph.dispose=()=>{if(roomGraphs.delete(graph)){roomDisposed++;dispose();for(const node of graph.nodes)if(node instanceof ConvolverNode){if(node.buffer!==null)throw new Error('Leaked K IR');roomCleared++}}};return graph}};
    for(let i=0;i<5;i++){
     const buffer=audioContext.createBuffer(1,Math.round(audioContext.sampleRate*.4),audioContext.sampleRate),a=buffer.getChannelData(0);for(let n=0;n<a.length;n++)a[n]=.035*Math.sin(2*Math.PI*(220+i*110)*n/buffer.sampleRate);
     mygrainKMultitrack.setBuffer(i,buffer);Object.assign(mygrainKMultitrack.tracks[i],{sourceBpm:300,steps:8,metadata:{durationSeconds:.4,recordingSteps:8}});
    }
    mygrainKMultitrack.refreshBuffers();
   });
   const press=s=>page.locator(s)[mobile?'tap':'click']();
   const edit=async(key,value)=>{await page.locator(`[data-k-processing="${key}"]`).evaluate((e,v)=>{e.value=String(v);e.dispatchEvent(new Event('change',{bubbles:true}))},value);await page.waitForFunction(()=>!mygrainCardHistory.busy)};
   for(let i=0;i<5;i++){await press(`[data-k-track="${i}"] [data-k-record-select]`);await edit('filterMode','bypass');await edit('reverbMix',60);await edit('reverbDecay',4000)}
   const live=await page.evaluate(async()=>{
    let phase="initial start";try {
    const k=mygrainKMultitrack;setBastardLoopKEnabled(true,{silent:true,skipSave:true});setBastardLoopPlaying(true,{silent:true,skipSave:true});
    if(k.voices.size!==5)throw new Error('Not all five K tracks are audible');
    const rooms=[...k.voices.values()].map(v=>v.graph.nodes.find(n=>n instanceof ConvolverNode));
    if(rooms.some(r=>!r)||new Set(rooms).size!==5||new Set(rooms.map(r=>r.buffer)).size!==1)throw new Error('K room independence/shared IR failed');
    phase="live decay edit";const peers=[...k.voices.values()].map(v=>v.source);k.select(0);k.changeProcessing('reverbDecay',1.2);
    for(let i=1;i<5;i++)if(k.voices.get(i).source!==peers[i])throw new Error('A reverb edit restarted its peer');
    phase="five distinct cold rooms";stopAllPerformancePlayback({silent:true});await new Promise(r=>setTimeout(r,100));
    for(let i=0;i<5;i++){k.select(i);k.changeProcessing('reverbDecay',2+i*.5)}k.select(0);
    setBastardLoopPlaying(true,{silent:true,skipSave:true});
    if(k.voices.size!==5||new Set([...k.voices.values()].map(v=>v.graph.nodes.find(n=>n instanceof ConvolverNode).buffer)).size!==5)throw new Error('Five distinct Hall tails failed to start');
    phase="mute cycles";for(let n=0;n<5;n++){k.change(0,'mute',true);await new Promise(r=>setTimeout(r,40));k.change(0,'mute',false);await new Promise(r=>setTimeout(r,40))}
    phase="idle tracks";k.change(2,'mute',true);k.change(3,'enabled',false);k.change(4,'level',0);await new Promise(r=>setTimeout(r,80));
    if(k.voices.size!==2||roomGraphs.size!==2)throw new Error('Inaudible tracks retained DSP');
    stopAllPerformancePlayback({silent:true});await new Promise(r=>setTimeout(r,100));if(k.voices.size||roomGraphs.size||k.preparedReverbCount)throw new Error('Stop retained K graphs');
    k.prewarm();if(k.preparedReverbCount!==2)throw new Error('Audible room preflight count');stopAllPerformancePlayback({silent:true});if(k.preparedReverbCount)throw new Error('Cancelled preflight retained rooms');
    phase="audition";if(!await auditionBastardLoopK())throw new Error('K audition failed');
    if(roomGraphs.size!==1||![...roomGraphs][0].nodes.some(n=>n instanceof ConvolverNode))throw new Error('K audition bypassed Hall');
    await new Promise(r=>setTimeout(r,700));stopSourceCardAudition();if(roomGraphs.size||k.preparedReverbCount)throw new Error('K audition retained its room');
    return {created:roomCreated,disposed:roomDisposed,cleared:roomCleared};
    } catch(error) { throw new Error(phase+": "+error.stack+" preparation "+JSON.stringify(transportSync.preparation)); }
   });assert.equal(live.created,live.disposed);assert.equal(live.cleared,live.disposed);
   // A complete patch ZIP and a saved Song retain each track, all mutes and Decay.
   const saved=await page.evaluate(async()=>{
    const k=mygrainKMultitrack,c=mygrainSongBeta,expected=JSON.stringify(k.captureSettings());
    const archive=await mygrainSongBetaAdapter.capture(),decoded=await mygrainSongBetaAdapter.decode(await archive.arrayBuffer(),{buffers:new Map(),bytes:0,limitBytes:128*1024*1024});
    k.select(0);k.changeProcessing('reverbMix',0);await mygrainSongBetaAdapter.recall(decoded,{start:false});decoded.releaseMemory?.();
    if(JSON.stringify(k.captureSettings())!==expected)throw new Error('Complete patch ZIP changed K settings or mutes');
    document.getElementById('songBetaName').value='K Hall regression';await c.newSong();await c.newPart({name:'Five K rooms',repeats:1});if(!c.song?.parts.length)throw new Error(document.getElementById('songBetaStatus').textContent);
    const original=c.song.parts[0].sha256;await c.recall(c.song.parts[0],{start:false});if(JSON.stringify(k.captureSettings())!==expected)throw new Error('Song changed K settings');
    for(let i=0;i<5;i++){k.change(i,'mute',false);k.change(i,'enabled',true);k.change(i,'level',1)}
    await c.newPart({name:'Five active independent rooms',repeats:1});
    await c.arm();if(!c.armed)throw new Error(document.getElementById('songBetaStatus').textContent);
    const part=c.song.parts[0],buffer=c.renders.get(part.id),a=buffer.getChannelData(0),rms=Math.sqrt(a.reduce((sum,v)=>sum+v*v,0)/a.length);
    if(c.song.parts.length!==2||c.song.parts.some(p=>p.render.kReverbVersion!==1)||part.render.kReverbVersion!==1||!(rms>1e-5)||part.sha256!==original)throw new Error('New Hall render lost version/audio/source');
    // Simulate a legacy freeze in disposable storage, then exercise the actual Arm path.
    const request=c.request.bind(c),oldRender={...part.render};delete oldRender.kReverbVersion;
    c.song={...c.song,parts:[{...part,render:oldRender},c.song.parts[1]]};c.invalidate(true);let rerenders=0;
    c.request=async(path,options)=>{if(path.includes('/render?')&&options?.method==='POST')rerenders++;return request(path,options)};
    await c.arm();if(!c.armed||rerenders!==1||c.song.parts[0].render.kReverbVersion!==1||c.song.parts[0].sha256!==original)throw new Error('Legacy K freeze did not refresh exactly once: '+JSON.stringify({armed:c.armed,rerenders}));
    c.request=request;return {rms,version:c.song.parts[0].render.kReverbVersion,rerenders,sourceUnchanged:true,fiveTrackRender:true};
   });
   await page.locator('#kTrackControlSection').scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/${engine}-${mobile?'phone':'desktop'}.png`});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   assert.deepEqual(errors,[]);const result={engine,mobile,audio,live,saved};results.push(result);console.log(JSON.stringify(result));await context.close();
  }}finally{await browser.close()}
 }
 fs.writeFileSync(evidence+'/results.json',JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
