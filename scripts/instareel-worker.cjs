'use strict';
const fs=require('node:fs'),{chromium}=require('playwright-core');
const emit=x=>process.stdout.write(JSON.stringify(x)+'\n');
(async()=>{
 const job=JSON.parse(fs.readFileSync(0,'utf8')),base=new URL(job.baseUrl);
 job.arrangementScript=require('./instareel-arrangement.cjs');
 if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||base.pathname!=='/mygrain/')throw Error('Loopback renderer required');
 const browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required','--js-flags=--max-old-space-size=1536']});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:900},extraHTTPHeaders:{Cookie:job.cookie}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==base.origin||!['GET','HEAD'].includes(r.request().method()))return r.abort();return r.continue()});
  await page.exposeFunction('instareelStage',message=>emit({stage:message}));
  await page.exposeFunction('instareelWrite',data=>{const bytes=Buffer.from(data,'base64');if(bytes.length>24*1024*1024)throw Error('Render exceeds WAV limit');fs.writeFileSync(job.outputPath,bytes,{mode:0o600})});
  emit({stage:'Starting isolated audio renderer'});await page.goto(base.href);
  await page.waitForFunction(()=>window.mygrainSongBetaAdapter&&document.documentElement.dataset.mygrainStartup==='ready',null,{timeout:45000});
  await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').click();
  await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended,null,{timeout:45000});
  const result=await page.evaluate(async job=>{
   const adapter=mygrainSongBetaAdapter,controller=mygrainSongBeta;controller.busy=true;
   const response=await fetch(`api/instareel/${job.id}/source`);if(!response.ok)throw Error('Source snapshot unavailable');
   const archive=await response.arrayBuffer(),info=adapter.inspectPart(archive);
   if(info.decodedBytes*2+info.fxBytes*2+64*1048576>512*1048576)throw Error('This patch exceeds the server render budget. Shorten source samples.');
   const part=await adapter.decode(archive,{buffers:new Map(),bytes:0,limitBytes:192*1048576}),plan=job.plan;
   const buffer=await MygrainSongClock.render(audioContext,part,{bpm:plan.bpm,patternSteps:info.snapshot.state.patternLength,patternCycleMultiplier:info.snapshot.extra.patternCycleMultiplier||1},null,{
    durationSeconds:plan.warmup+plan.duration+.08,
    prepareDeck(deck){
     // Every change lives inside the disposable render deck. Never touch live editor settings.
     deck.__instareelApply=deck.eval(job.arrangementScript);
     const prepared=deck.__instareelApply.prepare(plan);window.instareelStage(`Prepared ${plan.options?.notes?'X/L note variations · ':''}${prepared.fills} Roll fills · starting render`);
    },
    beforeStart(deck,start){
     const timers=[];deck.__instareelTimers=timers;
     const modulate=()=>{deck.__instareelApply.tick(audioContext.currentTime-start-plan.warmup);timers.push(deck.setTimeout(modulate,50))};modulate();
     for(const event of plan.events){const due=start+plan.warmup+event.at;
      const check=()=>{const remaining=due-audioContext.currentTime;if(remaining>.008){timers.push(deck.setTimeout(check,Math.min(remaining*1000,100)));return}const applied=deck.__instareelApply(event);window.instareelStage(`Rendering ${Math.min(100,Math.round(event.at/plan.duration*100))}% · ${plan.variation} variations${applied.added.length?' · add '+applied.added.join(' + '):event.amount?' · developing layers':' · original groove'}`)};
      timers.push(deck.setTimeout(check,Math.max(0,(due-audioContext.currentTime)*1000-20)));
     }
     for(const event of deck.__instareelApply.cutEvents()){
      const due=start+plan.warmup+event.at;
      const check=()=>{const remaining=due-audioContext.currentTime;if(remaining>.008){timers.push(deck.setTimeout(check,Math.min(remaining*1000,100)));return}deck.__instareelApply.cut(event)};
      timers.push(deck.setTimeout(check,Math.max(0,(due-audioContext.currentTime)*1000-20)));
     }
    },
    afterCapture(deck){deck.__instareelApply.cleanup();for(const timer of deck.__instareelTimers||[])deck.clearTimeout(timer)}
   });
   const rate=buffer.sampleRate,start=Math.round(plan.warmup*rate),frames=Math.round(plan.duration*rate),fade=Math.round(.05*rate),output=audioContext.createBuffer(2,frames,rate);
   let peak=0,sum=0;
   for(let c=0;c<2;c++){
    const raw=buffer.getChannelData(c),data=output.getChannelData(c);data.set(raw.subarray(start,start+frames));
    // Continue the actual ending into the opening, then blend into its warmed first bar.
    // Exact bar-aligned duration is retained; no fade to silence or shortening.
    for(let i=0;i<fade;i++){const w=i/(fade-1);data[i]=raw[start+frames+i]*(1-w)+data[i]*w}
    for(const x of data){if(!Number.isFinite(x))throw Error('Invalid render sample');peak=Math.max(peak,Math.abs(x));sum+=x*x}
   }
   if(peak<.00001)throw Error('The loaded patch rendered silence. Enable an audible loop or drum pattern and try again.');
   // Only attenuate if necessary; never normalize quiet intentional material upward.
   const gain=peak>.97?.97/peak:1;if(gain!==1)for(let c=0;c<2;c++){const d=output.getChannelData(c);for(let i=0;i<d.length;i++)d[i]*=gain}
   const wav=audioBufferToWav(output),bytes=new Uint8Array(await (wav instanceof Blob?wav.arrayBuffer():Promise.resolve(wav))),chunks=[];
   for(let i=0;i<bytes.length;i+=32768)chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
   await window.instareelWrite(btoa(chunks.join('')));
   adapter.stop();return {duration:frames/rate,sampleRate:rate,frames,peak:peak*gain,rms:Math.sqrt(sum/(frames*2))*gain};
  },job);
  if(errors.length)throw Error(errors[0]);emit({result});
 }finally{await browser.close()}
})().catch(e=>{emit({error:String(e.message||e).slice(0,700)});process.exitCode=1});
