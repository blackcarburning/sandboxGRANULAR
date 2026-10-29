'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18948/mygrain/',out=process.env.EQ_ROUTING_EVIDENCE||'/tmp/mygrain-channel-eq/routing-evidence';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);fs.mkdirSync(out,{recursive:true});
(async()=>{const results=[];
for(const [engine,type] of Object.entries({chromium,webkit})){
 if(process.env.EQ_ENGINE&&process.env.EQ_ENGINE!==engine)continue;
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 assert.equal((await c.request.post(base+'api/auth/register',{data:{username:`eqroutes_${engine[0]}_${Date.now()}`,password:'isolated-eq-route-fixture'}})).status(),200);
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());await p.goto(base);await p.waitForFunction(()=>window.mygrainChannelEqUi&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 console.log('START',engine);
 const actual=await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});applyGlobalBpm(120);syncPatternLengthControls(8,{skipSave:true});setLoopLayerSolo('none',{silent:true,skipSave:true});mygrainChannelEq.restore();
  const b=audioContext.createBuffer(2,audioContext.sampleRate,audioContext.sampleRate);for(let ch=0;ch<2;ch++)for(let i=0;i<b.length;i++)b.getChannelData(ch)[i]=.02*Math.sin(2*Math.PI*1000*i/b.sampleRate);window.__eqRouteBuffer=b;
  bastardLoopBuffer=b;bastardLoopSourceBpm=120;bastardLoopMetadata={bpm:120,durationSeconds:1};setBastardLoopEnabled(true,{silent:true,skipSave:true});startBastardLoop();const source=bastardLoopSource;
  const tap=audioContext.createAnalyser();tap.fftSize=2048;tap.smoothingTimeConstant=0;preFilterGainNode.connect(tap);const data=new Float32Array(2048),rms=()=>{tap.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((sum,x)=>sum+x*x,0)/data.length)};
  await new Promise(r=>setTimeout(r,350));const dry=rms();const eq=MygrainChannelEq.defaults();eq.enabled=true;eq.bands[1].frequency=1000;eq.bands[1].gain=-12;mygrainChannelEq.set('A',eq);
  await new Promise(r=>setTimeout(r,350));const wet=rms(),sameClock=source===bastardLoopSource;
  mygrainChannelEqUi.open('A');await new Promise(r=>setTimeout(r,200));const spectra=mygrainChannelEq.spectra('A'),peak=Math.max(...spectra.flatMap(s=>Array.from(s.values)));mygrainChannelEqUi.close();
  preFilterGainNode.disconnect(tap);tap.disconnect();return{dry,wet,db:20*Math.log10(wet/dry),sameClock,spectrumPeak:peak};
 });
 assert(actual.dry>.00001,JSON.stringify(actual));assert(Math.abs(actual.db+12)<.15,JSON.stringify(actual));assert(actual.sameClock);assert(actual.spectrumPeak>-95,JSON.stringify(actual));console.log('PCM',engine,actual);
 const coverage=await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});const b=__eqRouteBuffer,options={silent:true,skipSave:true};
  const configs=mygrainChannelEq.settings();for(const key of MygrainChannelEq.KEYS){configs.channels[key].enabled=true;configs.channels[key].bands[1].gain=-6;}mygrainChannelEq.restore(configs);
  bastardLoopBuffer=b;bastardLoop2Buffer=b;bastardLoop3Buffer=b;bastardLoopVBuffer=b;bastardLoopPBuffer=b;bastardLoopOBuffer=b;
  bastardLoopMRawBuffer=b;bastardLoopMBuffer=b;bastardLoopMPlusRawBuffer=b;bastardLoopMPlusBuffer=b;
  dropboxSampleLayerRawBuffer=b;dropboxSampleLayerBuffer=b;generatedLoopBuffer=b;generatedLoopBaseBuffer=b;
  setBastardLoopEnabled(true,options);setBastardLoop2Enabled(true,options);setBastardLoop3Enabled(true,options);setBastardLoopVEnabled(true,options);setBastardLoopPEnabled(true,options);setBastardLoopOEnabled(true,options);setBastardLoopMEnabled(true,options);setBastardLoopMPlusEnabled(true,options);setDropboxSampleLayerEnabled(true,options);setGeneratedDryLoopEnabled(true,options);setBastardLoopKEnabled(true,options);setBastardLoopLEnabled(true,options);setBastardLoopXEnabled(true,options);
  for(let i=0;i<5;i++){mygrainKMultitrack.setBuffer(i,b);Object.assign(mygrainKMultitrack.tracks[i],{level:.1,enabled:true,mute:false,steps:8,sourceBpm:120,processing:MygrainKMultitrack.processing({filterMode:'bypass'})})}mygrainKMultitrack.refreshBuffers();
  const start=audioContext.currentTime+.2;startBastardLoop(start);startBastardLoop2(start);startBastardLoop3(start);startBastardLoopV(start);startBastardLoopP(start);startBastardLoopO(start);startBastardLoopM(start);startBastardLoopMPlus(start);startDropboxSampleLayer(start);startGeneratedDryLoop(start);startBastardLoopK(start);
  bastardLoopLSampleBuffer=b;bastardLoopXSampleBuffer=b;setBastardLoopLSourceMode('sample',options);setBastardLoopXSourceMode('sample',options);
  const step={note:'C4',rest:false,accent:false,slide:false,ratchet:1};scheduleBastardLoopLSingleVoice(step,start,.5,null);scheduleBastardLoopXSingleVoice(step,start,.5,null);
  drumMachineKickBuffer=b;drumMachineSnareBuffer=b;drumMachineHatBuffer=b;drumMachinePercBuffer=b;setDrumMachineEnabled(true,options);
  drumMachineKickPattern[0]=drumMachineSnarePattern[0]=drumMachinePercPattern[0]=true;
  scheduleDrumMachineRepeats('kick',0,start,.125);scheduleDrumMachineRepeats('snare',0,start,.125);scheduleDrumMachineRepeats('perc',0,start,.125);playDrumMachineHatHit(start);
  drumMachineRoll.pattern[0]=true;drumMachineRoll.ratchets[0]=1;scheduleDrumMachineRoll(0,start,.125);
  for(const kind of ['clap','cymbals','etc']){const track=drumMachineExtraTracks[kind];track.buffer=b;track.pattern[0]=true;scheduleExtraDrumMachineRepeats(kind,0,start,.125)}
  const q=MygrainQTheory.defaults();q.enabled=true;q.sequence[0]=MygrainQTheory.normalizeStep({notes:[60],chordHold:true});mygrainQ.restore(q);await mygrainQ.preparePlayback();mygrainQ.start(audioContext.currentTime+.1);
  const snapshot=mygrainChannelEq.diagnostics();
  // Re-trigger short native drum paths after Q's asynchronous sample preparation.
  const now=audioContext.currentTime+.1;for(const kind of ['kick','snare','perc'])scheduleDrumMachineRepeats(kind,0,now,.125);for(const kind of ['clap','cymbals','etc'])scheduleExtraDrumMachineRepeats(kind,0,now,.125);playDrumMachineHatHit(now);scheduleDrumMachineRoll(0,now,.125);scheduleBastardLoopLSingleVoice(step,now,.5,null);scheduleBastardLoopXSingleVoice(step,now,.5,null);
  const active=mygrainChannelEq.diagnostics(),retained=mygrainChannelEq.settings();
  // Noise Hat and both OSC3 roles must take their own EQ path too.
  drumMachineHatBuffer=null;playDrumMachineHatHit(now);const noiseHat=mygrainChannelEq.diagnostics().channels.drumHat.routes;
  setBastardLoopLSourceMode('synth',options);setBastardLoopXSourceMode('synth',options);playBastardLoopLSynthVoice(step,now,.2,null);playBastardLoopXSynthVoice(step,now,.2,null);const synth=mygrainChannelEq.diagnostics();
  // The generated fixture was started directly, outside startSequencer.
  sequencerPlaying=true;stopAllPerformancePlayback({silent:true});await new Promise(r=>setTimeout(r,220));return{active,noiseHat,synth,afterStop:mygrainChannelEq.diagnostics(),settingsRetained:JSON.stringify(mygrainChannelEq.settings())===JSON.stringify(retained)};
 });
 for(const [key,value] of Object.entries(coverage.active.channels)){assert(value.routes>0,`${engine} missing ${key}: ${JSON.stringify(coverage.active.channels)}`);assert(value.filters>0,`${engine} missing filters ${key}`)}
 assert(coverage.noiseHat>0);assert(coverage.synth.channels.L.routes>0&&coverage.synth.channels.X.routes>0);assert.equal(coverage.afterStop.routes,0,JSON.stringify(coverage.afterStop));assert(coverage.settingsRetained);console.log('ROUTES',engine);
 // A real saved Song is converted/rendered in a server-owned browser, not the requesting phone.
 const song=await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});setLoopLayerSolo('bastarda',{silent:true,skipSave:true});setBastardLoopEnabled(true,{silent:true,skipSave:true});bastardLoopBuffer=__eqRouteBuffer;
  mygrainChannelEq.restore();const value=MygrainChannelEq.defaults();value.enabled=true;value.bands[1].frequency=1000;value.bands[1].gain=-12;mygrainChannelEq.set('A',value);
  const c=mygrainSongBeta;document.getElementById('songBetaName').value='Channel EQ server test';await c.newSong();await c.newPart({name:'EQ enabled',repeats:1});value.enabled=false;mygrainChannelEq.set('A',value);await c.newPart({name:'Legacy bypass',repeats:1});
  // Rewrite only the disposable second test archive to genuinely pre-EQ metadata.
  let part=c.song.parts[1],body=await c.request(`/${c.song.id}/parts/${part.id}`,{binary:true}),entries=parseStoredZipEntries(body),s=JSON.parse(getZipText(entries,'song-part.json'));delete s.state.modes.channelEq;
  const legacy=await createStoredZip([...entries].map(([path,data])=>({path,data:path==='song-part.json'?JSON.stringify(s):data})));
  const reply=await c.request(`/${c.song.id}/parts/${part.id}/save?sha256=${part.sha256}`,{method:'POST',headers:{'Content-Type':'application/zip'},body:legacy});c.acceptSong(reply.song);
  return {id:c.song.id,revision:c.song.revision,parts:c.song.parts.map(p=>({id:p.id,sha256:p.sha256})),key:c.key};
 });
 const cookies=await c.cookies(),cookie=cookies.find(c=>c.name==='mygrain_session')||cookies.find(c=>/session/.test(c.name));assert(cookie);
 fs.writeFileSync(`${out}/${engine}-job.json`,JSON.stringify({baseUrl:base,cookie:`${cookie.name}=${cookie.value}`,songId:song.id,parts:song.parts,key:song.key}),{mode:0o600});
 // Exercise both server rendering and unchanged legacy recall through the existing controller.
 const armed=await p.evaluate(async()=>{const c=mygrainSongBeta,before={revision:c.song.revision,sources:c.song.parts.map(p=>p.sha256)};await c.finishEditing();for(const part of [...c.song.parts])await c.prepareOnServer(part,c.generation);await c.arm();const measurements=[];for(const part of c.song.parts){const b=await c.loadRender(part),a=b.getChannelData(0);let sum=0;for(let i=Math.round(a.length*.2);i<a.length;i++){if(!Number.isFinite(a[i]))throw Error('Nonfinite Song output');sum+=a[i]*a[i]}measurements.push({name:part.name,rms:Math.sqrt(sum/(a.length-Math.round(a.length*.2))),render:part.render})}return{armed:c.armed,before,after:{revision:c.song.revision,sources:c.song.parts.map(p=>p.sha256)},measurements,budget:c.memoryBudget.bytes}});
 assert(armed.armed);assert.deepEqual(armed.after,armed.before);assert.equal(armed.budget,0);const ratio=20*Math.log10(armed.measurements[0].rms/armed.measurements[1].rms);assert(Math.abs(ratio+12)<.8,JSON.stringify({ratio,measurements:armed.measurements}));assert.equal(armed.measurements[0].render.channelEqVersion,2);console.log('SONG',engine,ratio);
 const recalled=await p.evaluate(async()=>{const c=mygrainSongBeta;await c.recall(c.song.parts[0],{start:false});const on=mygrainChannelEq.get('A');await c.recall(c.song.parts[1],{start:false});const off=mygrainChannelEq.get('A');return{on,off}});assert(recalled.on.enabled&&!recalled.off.enabled);assert.equal(recalled.on.bands[1].gain,-12);
 assert.deepEqual(errors,[]);results.push({engine,actual,coverage,song:{id:song.id,ratio,...armed},recall:true});fs.writeFileSync(`${out}/results-${engine}.json`,JSON.stringify(results,null,2));await c.close();
 }finally{await browser.close()}
}
})().catch(e=>{console.error(e);process.exitCode=1});
