'use strict';
const {chromium,webkit}=require('playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.BASE||'http://127.0.0.1:19044/mygrain/',out=process.env.OUT||'/tmp';
(async()=>{
 let auth;if(process.env.MYGRAIN_LIVE_AUTH){let raw='';for await(const chunk of process.stdin)raw+=chunk;auth=JSON.parse(raw);}else assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
 const results=[];
 for(const [kind,type] of Object.entries({chromium,webkit})){
  if(process.env.ENGINE&&process.env.ENGINE!==kind)continue;
  const browser=await type.launch(kind==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),p=await context.newPage(),errors=[];p.setDefaultTimeout(60000);p.on('pageerror',e=>errors.push(e.message));
   if(auth)await context.addCookies([{name:auth.cookie,value:auth.token,domain:new URL(base).hostname,path:'/',httpOnly:true,secure:true,sameSite:'Lax'}]);
   else assert((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-robot-fixture'}})).ok());
   await p.route('**/*',r=>new URL(r.request().url()).origin!==new URL(base).origin||r.request().method()!=='GET'?r.abort():r.continue());
   if(process.env.BASELINE_ASSET_DIR)await p.route(/\/song-beta-adapter\.js(?:\?|$)/,r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(process.env.BASELINE_ASSET_DIR,'song-beta-adapter.js'))}));
   for(const name of ['index.html','song-beta-adapter.js']){const r=await context.request.get(base+name);assert.equal(r.status(),200);assert.deepEqual(await r.body(),fs.readFileSync(path.resolve('sandboxGRANULAR',name)));}
   await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   await p.evaluate(async()=>{
    stopAllPerformancePlayback({silent:true});const ctx=audioContext,bank=ctx.createBuffer(1,Math.round(ctx.sampleRate*.1),ctx.sampleRate);
    for(let i=0;i<bank.length;i++)bank.getChannelData(0)[i]=.1*Math.sin(2*Math.PI*330*i/ctx.sampleRate);
    mygrainRobot.restore({enabled:true,level:.7,loopBars:2,timingBars:1,snap:{method:'manual',strength:75,maxShiftMs:100},phrases:[{id:'stir',text:'test',voice:'kokoro_af_heart',enabled:true,lanes:[{word:'test',offset:0,duration:.1,markers:{peakPower:.03,attack:.005,manual:.04},pattern:Array(16).fill(1)}]}]});
    mygrainRobot.setBuffer(bank);await saveAudioBufferToDB(bank,'robotWordsBuffer');await mygrainRobot.prepare(ctx);
    bastardLoopBuffer=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);for(let i=0;i<bastardLoopBuffer.length;i++)bastardLoopBuffer.getChannelData(0)[i]=.08*Math.sin(2*Math.PI*220*i/ctx.sampleRate);
    bastardLoopEnabled=true;bastardLoopLevel=.7;bastardLoopSourceBpm=120;
    setBastardLoopPlaying(true,{silent:true,skipSave:true});await mygrainCardHistory.flush();
    window.__stirRobot={bank,settings:JSON.stringify(mygrainRobot.settings()),node:mygrainRobot.graph.node,source:bastardLoopSource,origin:getSharedLoopTransportOriginTime(),samples:[]};
    const x=__stirRobot;x.proc=ctx.createScriptProcessor(1024,1,1);x.mute=ctx.createGain();x.mute.gain.value=0;x.node.connect(x.proc);x.proc.connect(x.mute);x.mute.connect(ctx.destination);x.proc.onaudioprocess=e=>{let energy=0;for(const value of e.inputBuffer.getChannelData(0))energy+=value*value;x.samples.push(Math.sqrt(energy/1024));};
   });
   async function tap(selector){
    await p.waitForFunction(()=>!mygrainCardHistory.busy);
    if(!await p.locator(selector).isVisible())await p.locator(selector).evaluate(async el=>{const button=document.querySelector('[data-jump-target="#cookingPotCard"]');if(button){const jump=await mygrainJumpToButton(button);await jump?.ready;}mygrainDisplay.reveal(el);});
    await p.waitForFunction(()=>document.documentElement.dataset.mygrainJumping!=='true');
    await p.locator(selector).evaluate(el=>{mygrainDisplay.reveal(el);el.scrollIntoView({block:'center',behavior:'instant'});});
    await p.evaluate(()=>{window.__stirRandom=Math.random;Math.random=()=>0;});
    try{await p.locator(selector).tap();await p.waitForFunction(()=>!mygrainCardHistory.busy&&!document.querySelector('[data-pot-shuffle]').disabled);await p.evaluate(()=>mygrainCookingPot.whenReady());}finally{await p.evaluate(()=>{Math.random=__stirRandom;});}
   }
   async function check(label,enabled=true,identity=true){
    const actual=await p.evaluate(({enabled,identity})=>{const x=__stirRobot;return {enabled:mygrainRobot.settings().enabled,running:mygrainRobot.running,settings:JSON.stringify(mygrainRobot.settings())===x.settings,bank:mygrainRobot.buffer===x.bank,node:!identity||mygrainRobot.graph?.node===x.node,source:bastardLoopSource===x.source,origin:getSharedLoopTransportOriginTime()===x.origin,power:document.getElementById('robotPower').getAttribute('aria-pressed')};},{enabled,identity});
    assert.deepEqual(actual,{enabled,running:enabled,settings:true,bank:true,node:true,source:true,origin:true,power:String(enabled)},label);return actual;
   }
   const cases=[];
   for(const [label,selector,amount] of [['Stir','[data-pot-shuffle]',1],['BIG STIR 0%','[data-pot-big-stir]',0],['BIG STIR 100%','[data-pot-big-stir]',1]]){
    await p.evaluate(amount=>{mygrainCookingPot.setStirAmount(amount);__stirRobot.samples=[];},amount);await tap(selector);await check(label);console.log(kind,label,'preserved');await p.waitForTimeout(4500);
    const rms=await p.evaluate(()=>Math.max(0,...__stirRobot.samples));assert(rms>1e-5,label+' stopped Robot audio');cases.push({label,preserved:true,robotRms:rms});
   }
   // A failed Stir must not change the excluded source either.
   await p.evaluate(()=>{const restore=mygrainAcousticFx.restore;window.__stirRestore=restore;let once=true;mygrainAcousticFx.restore=function(...args){if(once){once=false;throw Error('Injected Stir rollback');}return restore.apply(this,args);};});
   await tap('[data-pot-shuffle]');await p.evaluate(()=>{mygrainAcousticFx.restore=__stirRestore;});await check('failed Stir');console.log(kind,'rollback preserved');
   // Effect Undo/Redo may rebuild the editor graph; retain canonical Robot settings/audio.
   for(const action of ['undo','redo']){await p.evaluate(action=>mygrainCardHistory[action](),action);await p.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await p.evaluate(()=>JSON.stringify(mygrainRobot.settings())===__stirRobot.settings),true,action+' changed Robot');console.log(kind,action,'preserved');}
   await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});mygrainRobot.set({enabled:false});__stirRobot.settings=JSON.stringify(mygrainRobot.settings());__stirRobot.bank=mygrainRobot.buffer;__stirRobot.source=bastardLoopSource;__stirRobot.origin=getSharedLoopTransportOriginTime();});
   for(const selector of ['[data-pot-shuffle]','[data-pot-big-stir]']){await tap(selector);await check('Robot initially Off',false,false);}
   assert.deepEqual(errors,[]);results.push({kind,cases,offStaysOff:true,rollback:true,undoRedo:true,exactHostedBytes:true,errors});fs.writeFileSync(path.join(out,'robot-stir-results.json'),JSON.stringify(results,null,2));console.log('PASS',kind);
   await context.close();
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
