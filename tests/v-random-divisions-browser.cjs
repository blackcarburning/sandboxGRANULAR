'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18986/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{
  const c=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-v-cuts'}})).status(),200);
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base);await p.waitForFunction(()=>window.mygrainCardHistory&&window.MygrainVocalCut?.randomizeV&&document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  await p.evaluate(async()=>{
   stopAllPerformancePlayback({silent:true});
   for(let i=0;i<8;i++){randomizeMegaBastardLoopSettings();if(getSelectedBastardLoopVDivisions().some(x=>!['1/2','1/4','1/8'].includes(x)))throw Error('Mega V divisions escaped policy')}
   applyBastardLoopVDivisionSelection(['1/32','1/16'],{save:false});
   if(getBastardLoopVBuildPlan().divisions.some(x=>x!=='1/8'))throw Error('V build plan escaped policy');
   applyGlobalBpm(240);syncPatternLengthControls(8,{skipSave:true});setFxMuted(true,{silent:true});
   const b=audioContext.createBuffer(1,audioContext.sampleRate,audioContext.sampleRate),a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=.2*Math.sin(2*Math.PI*220*i/b.sampleRate);
   bastardLoopVBuffer=b;bastardLoopVSourceBpm=240;bastardLoopVMetadata={durationSeconds:1,bpm:240,label:'V division regression'};bastardLoopVLevel=.5;document.getElementById('performanceBastardLoopVLevel').value='50';
   setBastardLoopVPitchOctaves(0,{skipSave:true});setBastardLoopVPitchSemitones(0,{skipSave:true});setBastardLoopVFineCents(0,{skipSave:true});setBastardLoopVPitchAffectsDuration(false,{skipSave:true});
   setBastardLoopVEnabled(true,{skipSave:true});setLoopLayerSolo('bastardv',{skipSave:true});setBastardLoopVCut({grid:1/32,snap:false,repeat:true},{skipSave:true});
   await saveAudioBufferToDB(b,BASTARD_LOOP_V_AUDIO_BUFFER_KEY);saveState({force:true});window.vDivisionOriginal=b;
  });
  for(let i=0;i<6;i++){
   await p.locator('#performanceBastardLoopVCutRandomizeBtn').scrollIntoViewIfNeeded();await p.locator('#performanceBastardLoopVCutRandomizeBtn').tap();await p.waitForFunction(()=>!mygrainCardHistory.busy);
   assert(await p.evaluate(()=>{const cycle=getBastardLoopVCycleDuration(),bar=getLoopBarDurationSeconds(),s=bastardLoopVCut;return [s.end-s.start,MygrainVocalCut.region(s).duration].every(w=>[.5,.25,.125].some(x=>Math.abs(w*cycle/bar-x)<1e-8))}));
  }
  const before=await p.evaluate(()=>JSON.stringify(bastardLoopVCut));await p.evaluate(()=>mygrainCardHistory.undo());await p.evaluate(()=>mygrainCardHistory.redo());assert.equal(await p.evaluate(()=>JSON.stringify(bastardLoopVCut)),before);
  assert(await p.evaluate(()=>vDivisionOriginal===bastardLoopVBuffer));
  await p.evaluate(async()=>{const a=mygrainAiPatchAdapter;await a.execute({title:'V policy fixture',description:'No model call',parameters:{},loops:{V:{divisions:['1/32','1/16']}}},a.fingerprint());});
  assert.deepEqual(await p.evaluate(()=>getSelectedBastardLoopVDivisions()),['1/8']);
  if(engine==='chromium'){
   const evidence=await p.evaluate(async()=>{
    const s=mygrainSongBeta;document.getElementById('songBetaName').value='V allowed divisions';await s.newSong();await s.newPart({name:'V generated eighth/quarter/half',repeats:1});
    // Legacy manual fine cuts stay playable; randomisation limits are not a format migration.
    setBastardLoopVCut({enabled:true,repeat:true,start:0,end:1/32,grid:1/32},{skipSave:true});await s.newPart({name:'Legacy manual fine V cut',repeats:1});
    await s.newPart({name:'Pre-cut V source snapshot',repeats:1});await s.finishEditing();
    const part=s.song.parts[2],zip=await s.request(`/${s.song.id}/parts/${part.id}`,{binary:true}),entries=parseStoredZipEntries(zip),snapshot=JSON.parse(getZipText(entries,'song-part.json'));
    function preCut(value){if(Array.isArray(value))return value.filter(x=>!x?.id||!/^bastardLoopVCut|^performanceBastardLoopVCut/.test(x.id)).map(preCut);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).filter(([k])=>!/^bastardLoopVCut|^performanceBastardLoopVCut/.test(k)).map(([k,v])=>[k,preCut(v)]))}
    const legacy=await createStoredZip([...entries].map(([path,data])=>({path,data:path==='song-part.json'?JSON.stringify(preCut(snapshot)):data})));
    const decoded=parseStoredZipEntries(await legacy.arrayBuffer());for(const [path,data]of entries)if(path!=='song-part.json'){const out=decoded.get(path);if(out.length!==data.length||!data.every((v,i)=>v===out[i]))throw Error('Legacy source audio changed')}
    await s.run(()=>s.amendPart(part));s.acceptSong((await s.request(`/${s.song.id}/parts/${part.id}/save?sha256=${part.sha256}`,{method:'POST',headers:{'Content-Type':'application/zip'},body:legacy})).song);await s.finishEditing();
    const hashes=s.song.parts.map(x=>x.sha256);s.serverPreparation=true;s.phonePreparation=true;await s.arm();if(!s.armed)throw Error(document.getElementById('songBetaStatus').textContent);
    const rms=[];for(const part of s.song.parts){const b=await s.loadRender(part),a=b.getChannelData(0);rms.push(Math.sqrt(a.reduce((n,v)=>n+v*v,0)/a.length))}
    const rendered=s.song.parts.map(x=>x.render.sha256);await s.arm();return{hashes,after:s.song.parts.map(x=>x.sha256),rendered,warm:s.song.parts.map(x=>x.render.sha256),rms};
   });assert(evidence.rms.every(x=>x>1e-6));assert.deepEqual(evidence.hashes,evidence.after);assert.deepEqual(evidence.rendered,evidence.warm);console.log('PASS current and legacy V real server render, source hashes, warm cache',evidence.rms);
  }
  assert.deepEqual(errors,[]);console.log('PASS',engine,'real random button, permitted source/output widths, Undo/Redo, original audio unchanged');await c.close();
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exit(1)});
