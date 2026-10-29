'use strict';
const assert=require('node:assert/strict'), {chromium,webkit}=require('playwright-core'), {spawn}=require('node:child_process');
const base=process.env.SONG_BETA_TEST_URL;
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{
 const browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
 try{
  const ctx=await browser.newContext();assert.equal((await ctx.request.post(base+'api/auth/login',{data:{username:'admin',password:process.env.MYGRAIN_TEST_ADMIN_PASSWORD}})).status(),200);
  const page=await ctx.newPage();page.setDefaultTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainSongBeta);await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  const song=await page.evaluate(async()=>{
   stopAllPerformancePlayback({silent:true});stopModulationLoop();stopPerformanceMixerVuMeters();applyGlobalBpm(300);syncPatternLengthControls(8,{skipSave:true});for(const layer of SPARSE_RANDOM_LAYER_DEFINITIONS)layer.setEnabled(false,{silent:true,skipSave:true});setDrumMachineEnabled(false,{silent:true,skipSave:true});seqGrainsEnabled=false;document.getElementById('seqGrainsEnabled').checked=false;setLoopLayerSolo([],{silent:true,skipSave:true});
   const buffer=audioContext.createBuffer(1,48000,48000),pcm=buffer.getChannelData(0);for(let i=0;i<pcm.length;i++)pcm[i]=Math.sin(2*Math.PI*220*i/48000)*.2;
   bastardLoopBuffer=buffer;bastardLoopSourceBpm=300;setBastardLoopEnabled(true,{silent:true,skipSave:true});setSliderValue('performanceBastardLoopLevel',50);
   const fx=mygrainLoopFx.settings();Object.assign(fx.channels.A,{room:.15,delay:.1,cutoff:6000,filterEnabled:true});mygrainLoopFx.restore(fx);
   document.getElementById('songBetaName').value='Isolated warm worker test';const c=mygrainSongBeta;await c.newSong();const modern=await c.adapter.capture();await c.newPart({name:'Current',blob:modern});
   const entries=parseStoredZipEntries(await modern.arrayBuffer()),s=JSON.parse(getZipText(entries,'song-part.json')),isW=key=>/^(?:bastard(?:Loop)?W|performanceBastardLoopW|performanceBastardWDivision|weirdFx-)/i.test(key);
   for(const group of ['modes','sliders','selects'])for(const key of Object.keys(s.state[group]||{}))if(isW(key))delete s.state[group][key];delete s.extra.audioSlots.bastardW;delete s.extra.metadata.bastardW;s.extra.controls=s.extra.controls.filter(x=>!isW(x.id));s.assets=s.assets.filter(x=>x.key!=='bastardW');entries.delete('audio/bastardW.wav');entries.set('song-part.json',JSON.stringify(s));
   const old=await createStoredZip([...entries].map(([path,data])=>({path,data})));await c.newPart({name:'Pre-W',blob:old});await c.finishEditing();return c.song;
  });
  const cookie=(await ctx.cookies(base)).map(c=>`${c.name}=${c.value}`).join('; ');
  const jobs=song.parts.map(p=>({baseUrl:base,cookie,songId:song.id,partId:p.id,sourceSha256:p.sha256}));
  const code=`import sys,json,time,pathlib\nsys.path.insert(0,str(pathlib.Path('backend').resolve()))\nimport mygrain_server_arm as s\njobs=json.load(sys.stdin);results=[]\ntry:\n for job in jobs:\n  t=time.perf_counter();stages=[];r=s.render(job,120,lambda message: stages.append((message,time.perf_counter()-t)));results.append(dict(seconds=time.perf_counter()-t,startupSeconds=stages[0][1],pid=s._worker.pid,**r))\n try:\n  s.render(dict(jobs[0],cookie='invalid=none'),2)\n  raise AssertionError('Unauthenticated context reused prior credentials')\n except Exception as e:\n  assert s._worker is None\n t=time.perf_counter();r=s.render(jobs[0],120);results.append(dict(seconds=time.perf_counter()-t,pid=s._worker.pid,**r))\n print(json.dumps(results))\nfinally:\n s.close_worker()\n`;
  const results=await new Promise((resolve,reject)=>{const child=spawn('python3',['-c',code],{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('exit',n=>n?reject(Error(err)):resolve(JSON.parse(out)));child.stdin.end(JSON.stringify(jobs))});
  assert.equal(results[0].pid,results[1].pid);assert.notEqual(results[1].pid,results[2].pid);assert(results.every(r=>r.rms>.00001&&r.frames>1000));
  const mobile=[];
  for(const [engine,type] of Object.entries({chromium,webkit})){
   const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
   try{const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await c.addCookies((await ctx.cookies(base)));const p=await c.newPage();const pageErrors=[];p.on('pageerror',e=>pageErrors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainSongBeta);await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
    const result=await p.evaluate(async song=>{const c=mygrainSongBeta;await c.refresh();c.acceptSong(c.songs.find(s=>s.id===song.id));if(c.song.revision!==song.revision||c.song.parts.some((p,i)=>p.sha256!==song.parts[i].sha256))throw Error('Saved sources changed');c.readPart=()=>{throw Error('Downloaded source ZIP despite warm render')};await c.arm();await c.playSong(c.song.parts[0].id);await new Promise(r=>setTimeout(r,200));const playing=c.playing;c.stop();return{playing,armed:c.armed,reserved:c.memoryBudget.bytes,ready:c.uniqueParts().filter(p=>c.isPartReady(p)).length}},song);
    assert.equal(result.ready,2);assert(result.playing&&result.armed);assert.equal(result.reserved,0);assert.deepEqual(pageErrors,[]);for(const vp of[{width:320,height:640},{width:844,height:390}]){await p.setViewportSize(vp);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}mobile.push({engine,...result});
   }finally{await b.close()}
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({renders:results,mobile,originalSourcesUnchanged:true,unauthenticatedContextRejected:true},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
