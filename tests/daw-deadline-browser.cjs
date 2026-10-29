'use strict';
const assert=require('node:assert/strict'),{chromium}=require('playwright-core');
(async()=>{const browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const base='http://127.0.0.1:18933/mygrain/';
 assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-daw-fixture'}})).status(),200);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await page.goto(base);await page.waitForFunction(()=>window.mygrainDaw&&document.documentElement.dataset.mygrainStartup==='ready');
 await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').tap();
 await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 const result=await page.evaluate(async()=>{
  await mygrainInitialisePatch.run();stopAllPerformancePlayback({silent:true});applyGlobalBpm(300,{silent:true,skipSave:true});syncPatternLengthControls(8,{skipSave:true});
  const sample=audioContext.createBuffer(1,audioContext.sampleRate/4,audioContext.sampleRate),pcm=sample.getChannelData(0);
  for(let i=0;i<pcm.length;i++)pcm[i]=.25*Math.sin(i*2*Math.PI*220/audioContext.sampleRate)*(1-i/pcm.length);
  drumMachineKickBuffer=sample;setDrumMachineEnabled(true,{silent:true,skipSave:true});
  setDrumMachinePattern('kick',[true,false,false,false,true,false,false,false],{silent:true,skipSave:true});
  const decoded=await mygrainSongBetaAdapter.capture({liveOnly:true}),timing={bpm:300,patternSteps:8,repeats:1};
  const nativeRender=MygrainSongClock.render;let attempts=0,oldOrigin,origin,frames,peak=0;
  MygrainSongClock.render=(ctx,part,t,signal,options)=>nativeRender(ctx,part,t,signal,{...options,beforeStart(deck,start){
   attempts++;origin=start;options.beforeStart?.(deck,start);
   if(attempts===1){oldOrigin=start;const native=deck.startDrumMachine;let delayed=false;deck.startDrumMachine=function(...args){if(!delayed){delayed=true;const end=performance.now()+900;while(performance.now()<end){}}return native.apply(this,args);};}
  }});
  try{await mygrainDaw.renderComponent(decoded,timing,{key:'drumkick',label:'Kick'},new AbortController().signal,async buffer=>{frames=buffer.length;for(const v of buffer.getChannelData(0))peak=Math.max(peak,Math.abs(v));});}
  finally{MygrainSongClock.render=nativeRender;}
  await new Promise(resolve=>setTimeout(resolve,50));
  return {attempts,oldOrigin,origin,frames,expectedFrames:Math.round((.4+2)*audioContext.sampleRate),peak,bridges:__mygrainSongRenderBridges.size};
 });
 assert.ok(result.attempts>=2,JSON.stringify(result));assert.ok(result.origin>result.oldOrigin);assert.equal(result.frames,result.expectedFrames);assert.ok(result.peak>.001,JSON.stringify(result));assert.equal(result.bridges,0);assert.deepEqual(errors,[]);
 console.log('PASS cold/slow render retry: fresh origin, exact frames, non-silent PCM, zero retained decks and no page errors',JSON.stringify(result));
 const failures=await page.evaluate(async()=>{
  const decoded=await mygrainSongBetaAdapter.capture({liveOnly:true}),timing={bpm:300,patternSteps:8,repeats:1};
  let unrelated=0,cancelled=0;
  try{await MygrainSongClock.render(audioContext,decoded,timing,new AbortController().signal,{prepareDeck(){unrelated++;throw Error('Fixture preparation failure');}});}catch(e){if(e.message!=='Fixture preparation failure')throw e;}
  const abort=new AbortController();
  try{await MygrainSongClock.render(audioContext,decoded,timing,abort.signal,{beforeStart(){cancelled++;abort.abort();throw Error('Transport deadline expired; prepare and replan playback');}});}catch(e){if(e.name!=='AbortError')throw e;}
  return {unrelated,cancelled,bridges:__mygrainSongRenderBridges.size};
 });
 assert.deepEqual(failures,{unrelated:1,cancelled:1,bridges:0});assert.deepEqual(errors,[]);
 console.log('PASS cancellation and unrelated preparation errors do not retry or retain render decks');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
