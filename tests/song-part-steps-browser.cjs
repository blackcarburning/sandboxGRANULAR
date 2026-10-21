// Actual Song UI and rendered audio, using disposable local accounts only.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18890/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence=process.env.SONG_STEPS_EVIDENCE||'/tmp/mygrain-song-steps';fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const results=[];
 for(const [engine,type] of Object.entries({chromium,webkit})){
  if(process.env.SONG_STEPS_ENGINE&&process.env.SONG_STEPS_ENGINE!==engine)continue;
  const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{for(const mobile of [false,true]){
   const context=await browser.newContext({viewport:mobile?{width:402,height:874}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile,...(mobile?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6.1 Mobile/15E148 Safari/604.1'}:{})});
   const registered=await context.request.post(base+'api/auth/register',{data:{username:`cut_${engine[0]}_${+mobile}_${Date.now()}`,password:'isolated-cut-fixture'}});assert.equal(registered.status(),200,await registered.text());
   const page=await context.newPage(),errors=[];let renderPosts=0;page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.endsWith('/render'))renderPosts++});
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   const open=async()=>{await page.goto(base);await page.waitForFunction(()=>window.mygrainSongBeta&&!mygrainSongBeta.busy&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended)};
   await open();
   await page.evaluate(async()=>{
    stopAllPerformancePlayback({silent:true});resetStemIsolationState();applyGlobalBpm(300);syncPatternLengthControls(32,{skipSave:true});
    const b=audioContext.createBuffer(2,Math.round(audioContext.sampleRate*.25),audioContext.sampleRate);
    for(let c=0;c<2;c++)for(let i=0;i<b.length;i++)b.getChannelData(c)[i]=.35*Math.sin(2*Math.PI*(220+c*50)*i/audioContext.sampleRate);
    await applyLoadedBastardLoopXSampleBuffer(b,'Cut fixture',{fileName:'fixture-C3.wav',rootNote:'C3'});
    const quiet={silent:true,skipSave:true,skipRestart:true};setBastardLoopXSourceMode('sample',quiet);
    bastardLoopXSequence=Array.from({length:64},()=>({note:'',rest:false,accent:false,slide:false,ratchet:1}));bastardLoopXSequence[0].note='C3';bastardLoopXSequence[24].note='C3';bastardLoopXTimingIndex=4;setBastardLoopXEnabled(true,quiet);syncBastardLoopXUi();saveState();
   });
   await page.locator('#songBetaName').fill('Steps fixture');await page.locator('#songBetaNewSong').click();await page.waitForFunction(()=>mygrainSongBeta.song&&mygrainSongBeta.canEditSong()&&!mygrainSongBeta.busy);
   await page.locator('#songBetaPartName').fill('Trim this');await page.locator('#songBetaNewPart').click();await page.waitForFunction(()=>mygrainSongBeta.song.parts.length===1&&!mygrainSongBeta.busy);
   const rows=page.locator('#songBetaParts .song-beta-part');const steps=()=>rows.nth(0).locator('.song-beta-part-steps input');
   assert.equal(await steps().inputValue(),'64');assert.equal(await steps().getAttribute('max'),'64');
   // A cut made before any render must still cache the entire source audio.
   if(mobile){await steps().fill('32');await steps().press('Enter');await page.waitForFunction(()=>mygrainSongBeta.song.parts[0].playbackSteps===32&&!mygrainSongBeta.busy)}
   await page.locator('#songBetaArm').click();await page.waitForFunction(()=>mygrainSongBeta.armed&&!mygrainSongBeta.busy,null,{timeout:65000});
   const original=await page.evaluate(async()=>{const p=mygrainSongBeta.song.parts[0],b=await mygrainSongBeta.loadRender(p),a=b.getChannelData(0);let peak=0;for(let i=Math.floor(2.4*b.sampleRate);i<Math.min(a.length,Math.ceil(2.7*b.sampleRate));i++)peak=Math.max(peak,Math.abs(a[i]));return {sha:p.sha256,render:p.render.sha256,frames:b.length,latePeak:peak};});assert(original.latePeak>.0001);assert.equal(renderPosts,1);
   if(mobile){await steps().fill('64');await steps().press('Enter');await page.waitForFunction(()=>mygrainSongBeta.song.parts[0].playbackSteps===64&&!mygrainSongBeta.busy)}
   await page.evaluate(()=>mygrainSongBeta.run(()=>mygrainSongBeta.reusePart(mygrainSongBeta.song.parts[0])));await page.waitForFunction(()=>mygrainSongBeta.song.parts.length===2&&!mygrainSongBeta.busy);
   await steps().fill('32');await steps().press('Enter');await page.waitForFunction(()=>mygrainSongBeta.song.parts[0].playbackSteps===32&&!mygrainSongBeta.busy);
   const repeat=rows.nth(0).locator('.song-beta-part-repeats input');await repeat.fill('2');await repeat.press('Enter');await page.waitForFunction(()=>mygrainSongBeta.song.parts[0].repeats===2&&!mygrainSongBeta.busy);
   assert.deepEqual(await page.evaluate(()=>mygrainSongBeta.song.parts.map(p=>[p.playbackSteps??64,p.repeats])),[[32,2],[64,1]]);
   await page.locator('#songBetaArm').click();await page.waitForFunction(()=>mygrainSongBeta.armed&&!mygrainSongBeta.busy,null,{timeout:65000});
   const trimmed=await page.evaluate(async()=>{
    const p=mygrainSongBeta.song.parts[0],b=await mygrainSongBeta.loadRender(p),result=await MygrainSongExport.wav([p],new Map([[p.id,b]]),b.sampleRate),out=await audioContext.decodeAudioData(await result.blob.arrayBuffer()),a=out.getChannelData(0);
    const peak=at=>{let peak=0;for(let i=Math.floor(at*out.sampleRate);i<Math.min(a.length,Math.ceil((at+.3)*out.sampleRate));i++)peak=Math.max(peak,Math.abs(a[i]));return peak};
    await mygrainSongBeta.playSong();const entries=mygrainSongBeta.playback.entries.map(e=>({start:e.start,end:e.end}));mygrainSongBeta.stop();await mygrainSongBeta.loopPart(p.id);const loopDuration=mygrainSongBeta.playback.entries[0].end-mygrainSongBeta.playback.entries[0].start;mygrainSongBeta.stop();
    return {sha:p.sha256,render:p.render.sha256,sourceFrames:b.length,exportFrames:result.frames,repeatPeak:peak(1.6),discardedPeak:peak(2.4),entries,loopDuration};
   });
   assert.equal(trimmed.sha,original.sha);assert.equal(trimmed.render,original.render);assert.equal(trimmed.sourceFrames,original.frames);assert.equal(trimmed.exportFrames,original.frames);assert(trimmed.repeatPeak>.0001);assert(trimmed.discardedPeak<.00001,`discarded late note remained audible: ${trimmed.discardedPeak}`);assert(Math.abs(trimmed.entries[0].end-trimmed.entries[0].start-3.2)<.00001);assert(Math.abs(trimmed.loopDuration-3.2)<.00001);assert.equal(renderPosts,1);
   await rows.nth(0).locator('.song-beta-toggle').click();await rows.nth(0).scrollIntoViewIfNeeded();
   const fit=await rows.nth(0).evaluate(row=>{const r=row.getBoundingClientRect();return [...row.querySelectorAll('.song-beta-part-header input')].map(e=>{const b=e.getBoundingClientRect();return {value:e.value,width:b.width,inside:b.left>=r.left&&b.right<=r.right}})});assert(fit.every(f=>f.inside&&f.width>=40),JSON.stringify(fit));
   await page.screenshot({path:`${evidence}/${engine}-${mobile?'phone':'desktop'}.png`});
   await open();assert.deepEqual(await page.evaluate(()=>mygrainSongBeta.song.parts.map(p=>[p.playbackSteps??64,p.repeats])),[[32,2],[64,1]]);
   // WebKit may retain the preceding page's lease when unload beacons are lost.
   // Use the existing explicit same-device recovery control, never bypass locks.
   if(await page.locator('#songBetaRecoverLock').isVisible()){
    page.once('dialog',dialog=>dialog.accept());await page.locator('#songBetaRecoverLock').click();await page.waitForFunction(()=>mygrainSongBeta.canEditSong()&&!mygrainSongBeta.busy);
   }
   await steps().fill('64');await steps().press('Enter');await page.waitForFunction(()=>mygrainSongBeta.song.parts[0].playbackSteps===64&&!mygrainSongBeta.busy);
   assert.equal(await page.evaluate(()=>MygrainSongBeta.partDurationSeconds(mygrainSongBeta.song.parts[0])),6.4);assert.equal(await page.evaluate(()=>mygrainSongBeta.song.parts[0].render.sha256),original.render);
   assert.deepEqual(errors,[]);results.push({engine,mobile,original,trimmed,fit,renderPosts,restoredSteps:64});console.log('PASS',engine,mobile?'phone':'desktop','trim, repeats, exact audio/pitch, independent reuse, looping, restore and reload');await context.close();
  }}finally{await browser.close()}
 }
 fs.writeFileSync(evidence+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
