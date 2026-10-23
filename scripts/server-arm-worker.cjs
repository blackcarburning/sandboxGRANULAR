// Private backend worker: stdin-only job credentials, loopback app, existing audio engine.
'use strict';
const fs=require('node:fs'), {chromium}=require('playwright-core');
const job=JSON.parse(fs.readFileSync(0,'utf8')),base=new URL(job.baseUrl);
if(base.protocol!=='http:'||!['127.0.0.1','localhost'].includes(base.hostname)||base.pathname!=='/mygrain/')throw new Error('Server audio worker requires a loopback app.');
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
(async()=>{
 let browser;
 try {
  browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required','--js-flags=--max-old-space-size=1536']});
  const context=await browser.newContext({viewport:{width:1280,height:900},extraHTTPHeaders:job.cookie?{Cookie:job.cookie}:{}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const u=new URL(route.request().url()),method=route.request().method();
   if(u.origin!==base.origin)return route.abort();
   // No edit, conversion, lease, upload or other account/Song mutation can escape this worker.
   if(!['GET','HEAD'].includes(method)&&!(method==='POST'&&u.pathname===`/mygrain/api/songs/${job.songId}/parts/${job.partId}/render`))return route.abort();
   return route.continue();
  });
  await page.exposeFunction('serverArmStage',stage=>emit({stage:String(stage).slice(0,160)}));
  emit({stage:'Starting server audio engine'});await page.goto(base.href);
  await page.waitForFunction(()=>window.mygrainSongBeta&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready',null,{timeout:45000});
  await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').click();
  await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy,null,{timeout:45000});
  const result=await page.evaluate(async job=>{
   const c=mygrainSongBeta,reply=await c.request(`/${encodeURIComponent(job.songId)}`),part=reply.song.parts.concat(reply.song.sharedParts||[]).find(p=>p.id===job.partId);
   if(!part||part.sha256!==job.sourceSha256)throw new Error('The saved part changed before server preparation. Refresh Songs.');
   c.acceptSong(reply.song);c.serverPreparation=false;c.memoryBudget.limitBytes=512*1048576;c.armConcurrency=1;c.abort=new AbortController();
   const stage=c.armStage.bind(c);c.armStage=(generation,message,part)=>{window.serverArmStage(message);return stage(generation,message,part)};
   await c.adapter.ready();const generation=c.generation,info=await c.readPartMetadata(part,generation);
   if(c.preparationBytes(part,info,true)>c.memoryBudget.limitBytes)throw new Error('This part exceeds the server’s 512 MB audio preparation budget. Shorten its source samples.');
   let decoded;
   try {
    decoded=await c.loadPart(part,generation,info,{rendering:true});await c.prepareRender(part,decoded,generation);
    const saved=c.song.parts.concat(c.song.sharedParts||[]).find(p=>p.id===job.partId),buffer=await c.loadRender(saved),samples=buffer.getChannelData(0);
    let sum=0,peak=0;for(const sample of samples){if(!Number.isFinite(sample))throw new Error('Non-finite server render');sum+=sample*sample;peak=Math.max(peak,Math.abs(sample))}
    return {partId:part.id,sourceSha256:part.sha256,render:saved.render,rms:Math.sqrt(sum/samples.length),peak,frames:buffer.length,sampleRate:buffer.sampleRate};
   }finally{decoded=null;c.releasePart(part);c.adapter.stop?.()}
  },{songId:job.songId,partId:job.partId,sourceSha256:job.sourceSha256});
  if(errors.length)throw new Error(errors[0]);emit({result});
 }catch(error){emit({error:String(error.message||error).slice(0,700)});process.exitCode=1}
 finally{await browser?.close()}
})();
