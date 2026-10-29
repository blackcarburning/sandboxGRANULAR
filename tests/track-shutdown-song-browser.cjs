'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18959/mygrain/';assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'iPhone Safari'}),page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-track-idle'}})).status(),200);
 await page.goto(base);await page.waitForFunction(()=>window.mygrainSongBeta&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 const initial=await page.evaluate(async()=>{
 stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});
 // Response comparison needs a linear deterministic path, not default master
 // drive/compression, filtering or room tails from a freshly initialized patch.
 setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);
 for(const id of ['reverb','distortion','noiseMix','finalDriveSoft','finalDriveHard','finalDriveFold','finalDriveCrush','finalCompressorAmount','finalSidechainAmount','delayMix','delayFeedback','finalDelayDepth','finalReverbMix','oscNoiseLevel'])setSliderValue(id,0);
 const fx=MygrainLoopFx.normalize();for(const ch of Object.values(fx.channels))Object.assign(ch,{filterEnabled:false,lfoDepth:0,room:.6,delay:.5,reverbEnabled:false,delayEnabled:false});mygrainLoopFx.restore(fx);
 setLoopLayerSolo('bastardx',{silent:true,skipSave:true});setDrumMachineEnabled(false,{silent:true,skipSave:true});mygrainNoise.restore({enabled:false,filterEnabled:true,level:40,amount:5});await mygrainWasp.restore(null);
 applyGlobalBpm(240);syncPatternLengthControls(8,{skipSave:true});mygrainChannelEq.restore();
 const b=audioContext.createBuffer(1,4800,48000);for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=.04*Math.sin(2*Math.PI*500*i/b.sampleRate);bastardLoopXSampleBuffer=b;bastardLoopXMetadata={name:'X idle fixture'};bastardLoopXSourceMode='sample';
 setBastardLoopXEnabled(true,{silent:true,skipSave:true});bastardLoopXSequence=Array.from({length:8},(_,i)=>normalizeBastardLoopXStep({note:i%2===0?'C2':null,rest:i%2!==0,accent:i%4===0,slide:false}));
 setBastardLoopLEnabled(false,{silent:true,skipSave:true});Object.assign(fx.channels.L,{lfoDepth:.6,room:.3,delay:.3});/* Keep audible X deterministic across separate jobs; disabled L retains an LFO. */Object.assign(fx.channels.X,{filterEnabled:true,cutoff:1400,lfoDepth:0,room:0,delay:0});mygrainLoopFx.restore(fx);syncBastardLoopXUi();
 const c=mygrainSongBeta;document.getElementById('songBetaName').value='Isolated track shutdown';await c.newSong();await c.newPart({name:'Current X',repeats:1});await c.newPart({name:'Legacy X',repeats:1});
 const part=c.song.parts[1],body=await c.request(`/${c.song.id}/parts/${part.id}`,{binary:true}),entries=parseStoredZipEntries(body),s=JSON.parse(getZipText(entries,'song-part.json'));delete s.state.modes.noiseN;delete s.state.sliders.drumMachineKickAccentAmount;delete s.state.sliders.drumMachineSnareAccentAmount;delete s.state.sliders.drumMachinePercAccentAmount;delete s.state.sliders.drumMachineRollAccentAmount;
 const legacy=await createStoredZip([...entries].map(([path,data])=>({path,data:path==='song-part.json'?JSON.stringify(s):data})));
 const reply=await c.request(`/${c.song.id}/parts/${part.id}/save?sha256=${part.sha256}`,{method:'POST',headers:{'Content-Type':'application/zip'},body:legacy});c.acceptSong(reply.song);await c.finishEditing();await c.refresh();
 // Simulate a 135 MB legacy preparation estimate, without allocating it on
 // the phone. Server reads actual immutable source metadata independently.
 const estimate=c.preparationBytes.bind(c);c.preparationBytes=(part,info,rendering=true)=>part.name==='Legacy X'?135*1048576:estimate(part,info,rendering);
 c.loadPart=async()=>{throw Error('Phone attempted original-source decode')};c.adapter.renderPart=async()=>{throw Error('Phone attempted DSP render')};
 return {before:{revision:c.song.revision,hashes:c.song.parts.map(p=>p.sha256)},budget:c.memoryBudget.limitBytes,server:c.serverPreparation};
 });assert.equal(initial.budget,96*1048576);assert(initial.server);requests.length=0;
 const result=await page.evaluate(async()=>{const c=mygrainSongBeta;await c.arm();if(!c.armed)throw Error(document.getElementById('songBetaStatus').textContent);const rms=[];for(const part of c.song.parts){const b=await c.loadRender(part),a=b.getChannelData(0);let sum=0;for(let i=Math.round(a.length*.2);i<a.length;i++)sum+=a[i]*a[i];rms.push(Math.sqrt(sum/(a.length-Math.round(a.length*.2))))}await c.arm();await c.playSong();await new Promise(r=>setTimeout(r,150));const playing=c.playing;c.stop();c.adapter.recall=()=>{throw Error('Phone Audition attempted live-source restore')};await c.audition(c.song.parts[0]);const audition=c.playing&&c.loopPartId===c.song.parts[0].id;c.stop();return {armed:c.armed,playing,audition,rms,after:{revision:c.song.revision,hashes:c.song.parts.map(p=>p.sha256)},renderVersions:c.song.parts.map(p=>p.render.drumAccentVersion),reserved:c.memoryBudget.bytes}});
 assert.deepEqual(result.after,initial.before);assert(result.armed&&result.playing&&result.audition);assert.equal(result.reserved,0);assert.deepEqual(result.renderVersions,[1,1]);const ratio=20*Math.log10(result.rms[0]/result.rms[1]);assert(Math.abs(ratio)<.1,JSON.stringify(result));
  const originals=requests.filter(r=>r.method==='GET'&&/\/parts\/[a-f0-9]{32}$/.test(new URL(r.url).pathname)),jobs=requests.filter(r=>r.method==='POST'&&r.url.includes('/server-arm?'));assert.equal(originals.length,0);assert.equal(jobs.length,2);assert.deepEqual(errors,[]);console.log('PASS',engine,JSON.stringify({budget:initial.budget,serverJobs:jobs.length,phoneSourceDownloads:originals.length,ratio,...result}));
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
