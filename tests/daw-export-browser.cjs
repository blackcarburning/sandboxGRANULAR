'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright-core');
const base='http://127.0.0.1:18933/mygrain/';
(async()=>{const browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});assert.equal((await ctx.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-daw-fixture'}})).status(),200);
 const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message)});await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await p.goto(base);await p.waitForFunction(()=>window.mygrainDaw&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await p.evaluate(async()=>{
  await mygrainInitialisePatch.run();stopAllPerformancePlayback({silent:true});
  applyGlobalBpm(150,{silent:true,skipSave:true});syncPatternLengthControls(16,{skipSave:true});
  const b=audioContext.createBuffer(1,Math.round(audioContext.sampleRate*.2),audioContext.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.sin(i*2*Math.PI*220/audioContext.sampleRate)*.3*(1-i/d.length);
  bastardLoopLSampleBuffer=b;setBastardLoopLSourceMode('sample',{skipSave:true});setBastardLoopLEnabled(true,{silent:true,skipSave:true});setBastardLoopLLevelPercent(60,{skipSave:true});bastardLoopLSequence[0]={note:'C4',rest:false};bastardLoopLSequence[4]={note:'E4',rest:false};
  drumMachineKickBuffer=b;drumMachineSnareBuffer=b;setDrumMachineEnabled(true,{silent:true,skipSave:true});setDrumMachinePattern('kick',[true,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false],{silent:true,skipSave:true});setDrumMachinePattern('snare',[false,false,false,false,true,false,false,false,false,false,false,false,true,false,false,false],{silent:true,skipSave:true});
  setDrumMachineKickLevelPercent(60,{skipSave:true});setSliderValue('drumMachineSnareLevel',60);
 });
 // Use the real private job API; all writes are under the isolated /tmp account store.
 const response=await p.evaluate(async()=>{const blob=await mygrainSongBetaAdapter.capture();const r=await fetch('/mygrain/api/ftp/daw-start?'+new URLSearchParams({scope:'pattern',name:'DAW Regression',folder:'',reference:'1',notes:'test'}),{method:'POST',headers:{'X-Mygrain-User':'admin','Content-Type':'application/zip'},body:blob});return {status:r.status,data:await r.json()};});
 console.log('START',JSON.stringify(response));assert.equal(response.status,202);
 const jobId=response.data.job.id;let job;
 for(let i=0;i<240;i++){const r=await ctx.request.get(base+'api/ftp/daw-status?id='+jobId,{headers:{'X-Mygrain-User':'admin'}});job=(await r.json()).job;if(i%5===0)console.log('JOB',job?.state,job?.message);if(['done','failed','cancelled'].includes(job?.state))break;await p.waitForTimeout(1000);}
 assert.equal(job.state,'done',job.message);const download=await ctx.request.get(base+'api/ftp/file?'+new URLSearchParams({path:job.path,mygrainUser:'admin'}));assert.equal(download.status(),200);fs.writeFileSync('/tmp/mygrain-daw-pattern.zip',await download.body());
 assert.match(job.filename,/150bpm-pattern-DAW\.zip$/);assert.deepEqual(errors,[]);
 assert.equal(await p.locator('#performanceStemExportBtn').count(),0);assert.equal(await p.locator('[data-jump-target="#dawExportCard"]').count(),2);
 for(const size of [{width:390,height:844},{width:844,height:390},{width:1440,height:900}]){await p.setViewportSize(size);await p.locator('#dawExportCard').scrollIntoViewIfNeeded();assert.equal(await p.locator('#dawExportCard').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);}
 console.log('PASS real server DAW pattern, private FTP download and phone card');
 await p.evaluate(async()=>{stopAllPerformancePlayback({silent:true});document.getElementById('songBetaName').value='DAW arrangement';await mygrainSongBeta.newSong();await mygrainSongBeta.newPart({name:'Intro'});await mygrainSongBeta.setRepeats(mygrainSongBeta.song.parts[0],2);applyGlobalBpm(120,{silent:true,skipSave:true});setDrumMachineEnabled(false,{silent:true,skipSave:true});bastardLoopLSequence[0]={note:'G4',rest:false};await mygrainSongBeta.newPart({name:'Verse'});});
 const songJob=await p.evaluate(async()=>{const c=mygrainSongBeta;const r=await fetch('/mygrain/api/ftp/daw-start?'+new URLSearchParams({scope:'song',name:'DAW Song',folder:'',reference:'0',songId:c.song.id,revision:String(c.song.revision)}),{method:'POST',headers:{'X-Mygrain-User':'admin'},body:new Blob([])});return r.json();});
 assert.equal(songJob.ok,true,JSON.stringify(songJob));let song;
 for(let i=0;i<240;i++){song=(await(await ctx.request.get(base+'api/ftp/daw-status?id='+songJob.job.id,{headers:{'X-Mygrain-User':'admin'}})).json()).job;if(i%10===0)console.log('SONG',song.state,song.message);if(['done','failed','cancelled'].includes(song.state))break;await p.waitForTimeout(1000);}
 assert.equal(song.state,'done',song.message);const songDownload=await ctx.request.get(base+'api/ftp/file?'+new URLSearchParams({path:song.path,mygrainUser:'admin'}));assert.equal(songDownload.status(),200);fs.writeFileSync('/tmp/mygrain-daw-song.zip',await songDownload.body());
 assert.match(song.filename,/150-120bpm-song-DAW\.zip$/);console.log('PASS real server saved Song, repeats and tempo changes');

}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
