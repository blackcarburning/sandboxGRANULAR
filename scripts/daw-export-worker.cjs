// Stdin-only credentials. Read-only same-origin engine; writes only a private job directory.
'use strict';
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright-core');
const job=JSON.parse(fs.readFileSync(0,'utf8')),base=new URL(job.baseUrl),dir=job.workdir;
if(base.protocol!=='http:'||!['127.0.0.1','localhost'].includes(base.hostname)||base.pathname!=='/mygrain/'||!/^\/tmp\/mygrain-daw-[A-Za-z0-9_-]+$/.test(dir))throw Error('Invalid private DAW worker target.');
const emit=x=>process.stdout.write(JSON.stringify(x)+'\n');
(async()=>{let browser,total=0;try{
 browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required','--js-flags=--max-old-space-size=1536']});
 const context=await browser.newContext({viewport:{width:1280,height:900},extraHTTPHeaders:job.cookie?{Cookie:job.cookie}:{}});
 await context.addInitScript(()=>{const Native=window.AudioContext;window.AudioContext=function(opts={}){return new Native({...opts,sampleRate:48000})};window.AudioContext.prototype=Native.prototype;window.webkitAudioContext=window.AudioContext;});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===base.origin&&['GET','HEAD'].includes(r.request().method())?r.continue():r.abort()});
 await page.exposeFunction('dawStage',stage=>emit({stage:String(stage).slice(0,300)}));
 await page.exposeFunction('dawPattern',()=>fs.readFileSync(path.join(dir,'pattern.zip')).toString('base64'));
 await page.exposeFunction('dawWrite',(name,base64,first)=>{if(!/^(?:source-[0-9]+\.zip|render-[0-9]+-[A-Za-z0-9+_-]+\.wav|render-manifest\.json)$/.test(name))throw Error('Invalid worker artifact');const data=Buffer.from(base64,'base64');total+=data.length;if(total>1024**3)throw Error('DAW staging exceeds 1 GiB. Export a shorter arrangement.');fs.writeFileSync(path.join(dir,name),data,{flag:first?'w':'a',mode:0o600});});
 emit({stage:'Starting 48 kHz server audio engine'});await page.goto(base.href);
 await page.waitForFunction(()=>window.mygrainDaw&&window.mygrainSongBeta&&document.documentElement.dataset.mygrainStartup==='ready',null,{timeout:60000});
 await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy,null,{timeout:60000});
 const result=await page.evaluate(async job=>{
  const c=mygrainSongBeta,adapter=mygrainSongBetaAdapter,signal=new AbortController().signal;
  c.serverPreparation=false;c.memoryBudget.limitBytes=512*1048576;c.armConcurrency=1;
  if(adapter.context().sampleRate!==48000)throw Error('Server could not open a 48 kHz render context.');
  async function write(name,blob){if(!(blob instanceof Blob))blob=new Blob([blob]);for(let offset=0;offset<blob.size;offset+=524288){const text=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(blob.slice(offset,offset+524288));});await dawWrite(name,text,offset===0);}}
  let parts,pattern;
  if(job.scope==='song'){
   const data=await c.request('/'+encodeURIComponent(job.songId));if(String(data.song.revision)!==String(job.revision))throw Error('The song changed before export. Refresh Songs and export again.');c.acceptSong(data.song);parts=c.song.parts;
  }else{
   const b64=await dawPattern(),bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)),info=adapter.inspectPart(bytes.buffer);
   if(info.decodedBytes*2+bytes.length*2+info.fxBytes+32*1048576>512*1048576)throw Error('The pattern exceeds the server preparation memory budget. Shorten source samples.');
   pattern=await adapter.decode(bytes.buffer,{buffers:new Map(),bytes:0,limitBytes:192*1048576});
   await write('source-0.zip',bytes);
   parts=[{id:'pattern',name:job.name,bpm:Number(info.snapshot.state.globalBpm||info.snapshot.state.sequencerBpm),patternSteps:info.snapshot.state.patternLength,repeats:1,patternCycleMultiplier:info.snapshot.extra.patternCycleMultiplier||1}];
  }
  if(!parts?.length)throw Error('The song has no saved parts.');
  const manifest={parts:{},arrangement:[],createdAt:new Date().toISOString(),sourceSongId:job.scope==='song'?job.songId:null,sourceRevision:job.scope==='song'?job.revision:null};
  let count=0;const variants=new Map();
  for(const part of parts){
   const sourceId=part.sourcePartId||part.id,duration=MygrainSongBeta.partDurationSeconds({...part,repeats:1}),variant=sourceId+':'+(part.playbackSteps??part.patternSteps*(part.patternCycleMultiplier||1));
   if(!variants.has(variant)){
    const index=count++,renderKey=String(index);let decoded=pattern;
    if(!decoded){
     const info=await c.readPart(part);if(c.preparationBytes(part,info,true)>512*1048576){info.releaseDownload?.();throw Error('A saved part exceeds the server 512 MiB preparation budget.');}
     await write('source-'+index+'.zip',info.body);decoded=await c.loadPart(part,c.generation,info,{rendering:true});
    }
    const output={name:part.name,bpm:part.bpm,sourceSha256:part.sha256||null,sourceArchive:'source-'+index+'.zip',sources:decoded.snapshot.assets,sourceMetadata:decoded.snapshot.extra.metadata,drumSettings:decoded.snapshot.state.modes.drumMachineExtraTracks,duration,stems:{},midi:[],peaks:{}};manifest.parts[renderKey]=output;
    const components=mygrainDaw.components(decoded);if(job.reference)components.push({key:'reference',label:'Stereo Reference',reference:true});
    const estimated=components.length*(duration+2)*48000*6;
    if(estimated>768*1048576)throw Error('This pattern’s DAW render would exceed the package budget. Shorten its cycle.');
    for(let i=0;i<components.length;i++){
     const comp=components[i];await dawStage(`Rendering ${part.name}: ${comp.label} (${i+1}/${components.length})`);
     const name=`render-${index}-${comp.key}.wav`;
     const result=await mygrainDaw.renderComponent(decoded,part,comp,signal,buffer=>write(name,audioBufferToWav24bit(buffer)));
     manifest.releaseTailSeconds=Math.max(manifest.releaseTailSeconds||2,result.tailSeconds);
     if(result.peak>.000001){output.stems[comp.label]=name;output.midi.push(...result.midi);output.peaks[comp.label]=result.peak;}
    }
    if(job.scope==='song')c.releasePart(part);
    decoded=null;variants.set(variant,renderKey);
   }
   for(let repeat=0;repeat<part.repeats;repeat++)manifest.arrangement.push({renderKey:variants.get(variant),name:part.name,bpm:Number(part.bpm),duration,repeat:repeat+1,partId:part.id});
  }
  if(job.scope==='song'){const check=await c.request('/'+encodeURIComponent(job.songId));if(String(check.song.revision)!==String(job.revision))throw Error('The song changed during export. No package was published. Export the current revision again.');}
  await write('render-manifest.json',JSON.stringify(manifest));return {parts:count};
 },{scope:job.scope,name:job.name,reference:job.reference,songId:job.songId,revision:job.revision});
 if(errors.length)throw Error(errors[0]);emit({result});
}catch(e){emit({error:String(e.message||e).slice(0,700)});process.exitCode=1;}finally{await browser?.close();}})();
