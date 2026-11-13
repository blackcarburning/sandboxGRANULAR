const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:19073/mygrain/';
(async()=>{for(const[name,type]of Object.entries({chromium})){
 if(process.env.Q_EXPORT_ENGINES&&!process.env.Q_EXPORT_ENGINES.split(',').includes(name))continue;
 const browser=await type.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:"iPhone Safari"});assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'q-repo-local-test'}})).status(),200);const p=await c.newPage();p.setDefaultTimeout(60000);const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.type()==='prompt'?d.accept('Q export fixture'):d.dismiss());await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainQ);await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});resetStemIsolationState();applyGlobalBpm(240);syncPatternLengthControls(16,{skipSave:true});syncPerformanceExportBars(1,{skipSave:true});setFxMuted(true,{silent:true});const q=MygrainQTheory.defaults();Object.assign(q,{enabled:true,instrument:'piano',level:.8,room:0,delay:0});q.sequence[0]=MygrainQTheory.normalizeStep({notes:[60,64,67],velocity:100,gate:12});mygrainQ.restore(q);window.qExportStarts=0;const start=mygrainQ.start.bind(mygrainQ);mygrainQ.start=(...args)=>{qExportStarts++;return start(...args)};uploadWavToRepository=async(blob,filename)=>{const b=await audioContext.decodeAudioData(await blob.arrayBuffer());let peak=0,sum=0;for(const x of b.getChannelData(0)){peak=Math.max(peak,Math.abs(x));sum+=x*x}window.qExportResult={peak,rms:Math.sqrt(sum/b.length),frames:b.length,rate:b.sampleRate,starts:qExportStarts};return{savedName:filename}};});
 const jobs=[];p.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/server-arm?'))jobs.push(r.url())});
 const before=await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});mygrainQ.setEnabled(true,{skipSave:true});
  const c=mygrainSongBeta;document.getElementById('songBetaName').value='Q repo render compatibility';await c.newSong();await c.newPart({name:'Current Q',repeats:1});await c.newPart({name:'Legacy piano Q',repeats:1});
  const part=c.song.parts[1],body=await c.request(`/${c.song.id}/parts/${part.id}`,{binary:true}),entries=parseStoredZipEntries(body),stored=JSON.parse(getZipText(entries,'song-part.json'));
  delete stored.state.q.soundSource;delete stored.state.q.sampleLength;delete stored.state.q.sampleDecay;
  const legacy=await createStoredZip([...entries].map(([path,data])=>({path,data:path==='song-part.json'?JSON.stringify(stored):data})));
  const saved=await c.request(`/${c.song.id}/parts/${part.id}/save?sha256=${part.sha256}`,{method:'POST',headers:{'Content-Type':'application/zip'},body:legacy});c.acceptSong(saved.song);await c.finishEditing();await c.refresh();
  c.loadPart=async()=>{throw Error('Phone attempted source decode')};c.adapter.renderPart=async()=>{throw Error('Phone attempted DSP render')};
  return{revision:c.song.revision,hashes:c.song.parts.map(p=>p.sha256)};
 });
 const result=await p.evaluate(async()=>{const c=mygrainSongBeta;await c.arm();if(!c.armed)throw Error(document.getElementById('songBetaStatus').textContent);const rms=[];for(const part of c.song.parts){const b=await c.loadRender(part);let sum=0;for(const x of b.getChannelData(0))sum+=x*x;rms.push(Math.sqrt(sum/b.length))}return{rms,revision:c.song.revision,hashes:c.song.parts.map(p=>p.sha256)}});
 assert(result.rms.every(x=>x>.0001),JSON.stringify(result));assert.deepEqual({revision:result.revision,hashes:result.hashes},before);const coldJobs=jobs.length;assert(coldJobs>0);
 const playback=await p.evaluate(async()=>{const c=mygrainSongBeta;await c.arm();await c.playSong();await new Promise(r=>setTimeout(r,100));const playing=c.playing;c.stop();await c.audition(c.song.parts[0]);const audition=c.playing;c.stop();return{playing,audition}});assert.equal(jobs.length,coldJobs);assert(playback.playing&&playback.audition);
 const results={...result,...playback,coldJobs,warmJobs:jobs.length-coldJobs};
 assert.deepEqual(errors,[]);console.log('PASS',name,JSON.stringify(results));await c.close();}finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
