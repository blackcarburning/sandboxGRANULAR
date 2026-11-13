'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:18993/mygrain/';
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'iPhone Safari'}),page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.stack));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-dropbox-pan'}})).status(),200);
 async function ready(){await page.waitForFunction(()=>window.mygrainSongBeta&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy)}
 await page.goto(base);await ready();
 const layout=await page.locator('#performanceDropboxSamplePan').evaluate(el=>{const c=el.closest('.performance-feature-card');return {width:el.getBoundingClientRect().width,overflow:c.scrollWidth>c.clientWidth+1}});assert(layout.width>100&&!layout.overflow,JSON.stringify(layout));
 await page.locator('#performanceDropboxSamplePan').evaluate(el=>{el.value='-37';el.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(100);
 assert.equal(await page.locator('#performanceDropboxSamplePanValue').textContent(),'37% Left');
 await page.evaluate(()=>saveState({force:true}));await page.reload();await ready();assert.equal(await page.evaluate(()=>dropboxSampleLayerPan),-.37);
 await page.locator('#performanceDropboxSamplePan').dispatchEvent('dblclick');assert.equal(await page.evaluate(()=>dropboxSampleLayerPan),0);
 const persisted=await page.evaluate(()=>{setDropboxSampleLayerPanPercent(64);const preset=gatherPreset();setDropboxSampleLayerPanPercent(-80);applyPreset(preset);const patch=dropboxSampleLayerPan;delete preset.sliders.performanceDropboxSamplePan;applyPreset(preset);const legacy=dropboxSampleLayerPan;setDropboxSampleLayerPanPercent(42);const state=saveState({force:true,snapshotOnly:true});setDropboxSampleLayerPanPercent(-90);restoreState({state,songSnapshot:true,throwOnError:true});return{patch,legacy,snapshot:dropboxSampleLayerPan}});assert.deepEqual(persisted,{patch:.64,legacy:0,snapshot:.42});
 const initial=await page.evaluate(async()=>{
 stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);
 for(const id of ['reverb','distortion','noiseMix','finalDriveSoft','finalDriveHard','finalDriveFold','finalDriveCrush','finalCompressorAmount','finalSidechainAmount','delayMix','delayFeedback','finalDelayDepth','finalReverbMix','oscNoiseLevel'])setSliderValue(id,0);
 const fx=MygrainLoopFx.normalize();for(const ch of Object.values(fx.channels))Object.assign(ch,{filterEnabled:false,lfoDepth:0,reverbEnabled:false,delayEnabled:false});mygrainLoopFx.restore(fx);mygrainChannelEq.restore();
 setDrumMachineEnabled(false,{silent:true,skipSave:true});mygrainNoise.restore({enabled:false,filterEnabled:false,level:0,amount:0});await mygrainWasp.restore(null);
 applyGlobalBpm(240);syncPatternLengthControls(8,{skipSave:true});setLoopLayerSolo('dropbox',{silent:true,skipSave:true});setDropboxSampleLayerEnabled(true,{silent:true,skipSave:true});
 const b=audioContext.createBuffer(1,audioContext.sampleRate,audioContext.sampleRate);for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=.04*Math.sin(2*Math.PI*440*i/b.sampleRate);dropboxSampleLayerRawBuffer=b;dropboxSampleLayerBuffer=b;dropboxSampleLayerMetadata={fileName:'pan-fixture.wav',bpm:240,durationSeconds:1};
 // Exercise the real live voice and its smoothed pan update without swapping global contexts.
 setDropboxSampleLayerPanPercent(-100,{skipSave:true});startDropboxSampleLayer(null,{skipUi:true});
 const liveLeft=dropboxSampleLayerSource.dropboxPanNode.pan.value;
 setDropboxSampleLayerPanPercent(100,{skipSave:true});await new Promise(r=>setTimeout(r,150));
 const liveRight=dropboxSampleLayerSource.dropboxPanNode.pan.value;
 stopDropboxSampleLayer({skipUi:true,fade:false});const released=dropboxSampleLayerSource===null;
 const c=mygrainSongBeta;document.getElementById('songBetaName').value='Dropbox pan isolated';await c.newSong();setDropboxSampleLayerPanPercent(-100);await c.newPart({name:'Left',repeats:1});setDropboxSampleLayerPanPercent(100);await c.newPart({name:'Right',repeats:1});setDropboxSampleLayerPanPercent(0);await c.newPart({name:'Legacy centre',repeats:1});
 const part=c.song.parts[2],body=await c.request(`/${c.song.id}/parts/${part.id}`,{binary:true}),entries=parseStoredZipEntries(body),s=JSON.parse(getZipText(entries,'song-part.json'));delete s.state.sliders.performanceDropboxSamplePan;
 const legacy=await createStoredZip([...entries].map(([path,data])=>({path,data:path==='song-part.json'?JSON.stringify(s):data})));const reply=await c.request(`/${c.song.id}/parts/${part.id}/save?sha256=${part.sha256}`,{method:'POST',headers:{'Content-Type':'application/zip'},body:legacy});c.acceptSong(reply.song);await c.finishEditing();await c.refresh();c.serverPreparation=true;c.phonePreparation=true;c.loadPart=async()=>{throw Error('Phone attempted source decode')};c.adapter.renderPart=async()=>{throw Error('Phone attempted DSP')};return{liveLeft,liveRight,released,revision:c.song.revision,hashes:c.song.parts.map(p=>p.sha256)};
 });
 assert.equal(initial.liveLeft,-1);assert(initial.liveRight>.99);assert(initial.released);
 requests.length=0;
 const result=await page.evaluate(async()=>{const c=mygrainSongBeta;await c.arm();if(!c.armed)throw Error(document.getElementById('songBetaStatus').textContent);const energies=[];for(const p of c.song.parts){const b=await c.loadRender(p);energies.push([...Array(2)].map((_,ch)=>b.getChannelData(ch).reduce((n,x)=>n+x*x,0)))}await c.arm();await c.playSong();await new Promise(r=>setTimeout(r,100));const playing=c.playing;c.stop();await c.audition(c.song.parts[0]);const audition=c.playing;c.stop();return{energies,playing,audition,revision:c.song.revision,hashes:c.song.parts.map(p=>p.sha256)}});
 assert.equal(result.revision,initial.revision);assert.deepEqual(result.hashes,initial.hashes);assert(result.playing&&result.audition);
 for(const [i,[l,r]]of result.energies.entries()){assert(l+r>.001,JSON.stringify(result));if(i===0)assert(r<l*.001,JSON.stringify(result));if(i===1)assert(l<r*.001,JSON.stringify(result));if(i===2)assert(Math.abs(l-r)/(l+r)<.01,JSON.stringify(result));}
 assert.equal(requests.filter(r=>r.method==='POST'&&r.url.includes('/server-arm?')).length,3);assert.deepEqual(errors,[]);console.log('PASS',engine,JSON.stringify({persisted,live:[initial.liveLeft,initial.liveRight],...result}));
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
