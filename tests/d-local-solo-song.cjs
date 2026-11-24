'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.BASE||'http://127.0.0.1:19345/mygrain/',out=process.env.OUT;assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{for(const[engine,type]of Object.entries({chromium})){
const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});try{
 const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),p=await c.newPage(),errors=[];p.setDefaultTimeout(60000);p.on('pageerror',e=>errors.push(e.stack));await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());assert((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).ok());
 await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});for(const l of SPARSE_RANDOM_LAYER_DEFINITIONS)l.setEnabled(false,{silent:true,skipSave:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});setFxMuted(true,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);mygrainLoopFx.restore();mygrainChannelEq.restore();mygrainNoise.restore();await mygrainCookingPot.restore();await mygrainWasp.restore();await mygrainTurntable.off();await mygrainResonator.off();await mygrainAcousticFx.off();mygrainBassFace.restore();mygrainEffectOutput.restore();mygrainD.restore();mygrainD.clearLanes();
  const fx=MygrainLoopFx.normalize();for(const s of Object.values(fx.channels))Object.assign(s,{filterEnabled:false,delayEnabled:false,reverbEnabled:false});mygrainLoopFx.restore(fx);
  for(const id of ['reverb','distortion','noiseMix','finalDriveSoft','finalDriveHard','finalDriveFold','finalDriveCrush','finalCompressorAmount','finalSidechainAmount','delayMix','delayFeedback','finalDelayDepth','finalReverbMix','oscNoiseLevel'])setSliderValue(id,0);setSliderValue('performanceMasterTrim',0);setSliderValue('volume',60);applyGlobalBpm(240);syncPatternLengthControls(16,{skipSave:true});
  window.d4freq=[110,330,770,1430,1900,2300];window.d4pcm=[];
  const meter=audioContext.createScriptProcessor(4096,2,2),mute=audioContext.createGain();mute.gain.value=0;finalAmplifierNode.connect(meter);meter.connect(mute);mute.connect(audioContext.destination);meter.onaudioprocess=e=>{const channels=[0,1].map(ch=>{const a=e.inputBuffer.getChannelData(ch);return d4freq.map(f=>{let q1=0,q2=0;const k=2*Math.cos(2*Math.PI*f/audioContext.sampleRate);for(const x of a){const q=x+k*q1-q2;q2=q1;q1=q;}return Math.sqrt(Math.max(0,q1*q1+q2*q2-k*q1*q2))/a.length;})});d4pcm.push(channels);};
  window.d4tone=f=>{const raw=audioContext.createBuffer(2,audioContext.sampleRate,audioContext.sampleRate);for(let ch=0;ch<2;ch++)for(let i=0;i<raw.length;i++)raw.getChannelData(ch)[i]=.03*Math.sin(2*Math.PI*f*i/raw.sampleRate);return raw;};
  await mygrainD.apply(d4tone(110),'lane1.wav',{fileName:'lane1.wav',sourceBpm:240});mygrainD.enable(true,{skipSave:true});
  for(const n of [2,3,4]){await mygrainD.lane(n).apply(d4tone(d4freq[n-1]),'lane'+n+'.wav',{fileName:'lane'+n+'.wav',sourceBpm:240});mygrainD.lane(n).set({enabled:true});}
  setBastardLoopPlaying(true,{silent:true,skipSave:true});mygrainDisplay.reveal(document.getElementById('bastardLoopDCard'));document.getElementById('bastardLoopDCard').scrollIntoView();
 });

 const jobs=[];p.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/server-arm?'))jobs.push(r.url());});
 const initial=await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});mygrainD.clearLanes();mygrainD.restore({...mygrainD.settings(),enabled:true});mygrainChannelEq.restore();
  const c=mygrainSongBeta;document.getElementById('songBetaName').value='D four-lane isolated PCM check';await c.newSong();await c.newPart({name:'Legacy D',repeats:1});
  for(const n of [2,3,4]){await mygrainD.lane(n).apply(d4tone(d4freq[n-1]),'lane'+n+'.wav',{fileName:'lane'+n+'.wav',sourceBpm:240});mygrainD.lane(n).set({enabled:true,pan:n===2?-1:n===3?1:0});}
  mygrainD.setLocalSolo(2);if(!mygrainD.localSoloLanes().includes(2))throw Error('Local audition was not active before capture');await c.newPart({name:'Four independent lanes',repeats:1});if(JSON.stringify(c.song.parts[1].snapshot||{}).includes('localSolo'))throw Error('Local audition captured');
  const eq=mygrainChannelEq.get('D4'),start=structuredClone(eq);start.enabled=true;Object.assign(start.bands[1],{type:'bell',frequency:1430,q:1,gain:-18});
  eq.automation={version:1,read:true,steps:16,points:[{phase:0,...structuredClone(start)},{phase:1,...structuredClone(start)}]};mygrainChannelEq.set('D4',eq);
  await c.newPart({name:'Lane four automated EQ',repeats:1});
  await c.finishEditing();mygrainD.setLocalSolo(3);if(!mygrainD.localSoloLanes().includes(3))throw Error('Local audition was not active before Arm');c.serverPreparation=true;c.phonePreparation=true;
  return{hashes:c.song.parts.map(x=>x.sha256),revision:c.song.revision,capabilities:c.song.parts.map(x=>x.loopDVersion)};
 });assert.deepEqual(initial.capabilities,[1,3,3]);
 const result=await p.evaluate(async()=>{const c=mygrainSongBeta;await c.arm();if(!c.armed)throw Error(document.getElementById('songBetaStatus').textContent);const rows=[];for(const part of c.song.parts){const b=await c.loadRender(part);const amplitudes=[0,1].map(ch=>d4freq.slice(0,4).map(f=>{let a=0,z=0;const data=b.getChannelData(ch),start=Math.round(.2*b.sampleRate),end=Math.round(.8*b.sampleRate);for(let i=start;i<end;i++){const x=data[i];if(!Number.isFinite(x))throw Error('Nonfinite PCM');a+=x*Math.cos(2*Math.PI*f*i/b.sampleRate);z+=x*Math.sin(2*Math.PI*f*i/b.sampleRate);}return Math.hypot(a,z)/(end-start);}));rows.push({name:part.name,frames:b.length,sampleRate:b.sampleRate,amplitudes,render:part.render});}return{rows,hashes:c.song.parts.map(x=>x.sha256),revision:c.song.revision}});
 assert.equal(jobs.length,3);const [legacy,all,eq]=result.rows;
 assert(legacy.amplitudes[0][0]>.0003);for(const n of [1,2,3])assert(legacy.amplitudes[0][n]<legacy.amplitudes[0][0]*.03,JSON.stringify(legacy));
 assert(all.amplitudes[0][1]>.0003&&all.amplitudes[1][1]<all.amplitudes[0][1]*.03,JSON.stringify(all));assert(all.amplitudes[1][2]>.0003&&all.amplitudes[0][2]<all.amplitudes[1][2]*.03,JSON.stringify(all));
 assert(eq.amplitudes[0][3]<all.amplitudes[0][3]*.2,JSON.stringify({all,eq}));assert(eq.amplitudes[0][0]>all.amplitudes[0][0]*.9);
 for(const row of result.rows)assert.equal(row.frames,row.sampleRate);
 const warm=await p.evaluate(async()=>{const c=mygrainSongBeta;await c.arm();await c.playSong();await new Promise(r=>setTimeout(r,250));const playing=c.playing;c.stop();return{playing,reserved:c.memoryBudget.bytes,hashes:c.song.parts.map(x=>x.sha256),revision:c.song.revision};});assert(warm.playing);assert.equal(warm.reserved,0);assert.equal(jobs.length,3);assert.deepEqual(result.hashes,initial.hashes);assert.deepEqual(warm.hashes,initial.hashes);assert.equal(warm.revision,initial.revision);assert.deepEqual(errors,[]);
 fs.writeFileSync(out+'/d4-server-song.json',JSON.stringify({initial,result,warm,jobs:jobs.length,errors},null,2));console.log('PASS legacy/new independent panned lanes and real automated EQ in three actual server Song jobs, exact frames, warm reuse, phone PCM playback, immutable source hashes/revision');
}finally{await b.close();}}})().catch(e=>{console.error(e);process.exitCode=1});
