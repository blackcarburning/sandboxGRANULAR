'use strict';
// Real Chromium PCM -> native Bridge core, with intentionally slow preparation.
// Requires an isolated test server/account; never point this at production.
const {chromium}=require('playwright-core'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const base=process.env.MYGRAIN_TEST_URL,fixture=process.env.MYGRAIN_CLOCK_FIXTURE,out=process.env.MYGRAIN_CLOCK_OUTPUT;
assert.match(base||'',/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);assert(fixture&&out);
const rate=Number(process.env.MYGRAIN_TEST_RATE||48000),control=path.join(out,`clock-${rate}.control`),sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MYGRAIN_CHROMIUM||'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});let host;
 try{
  const c=await browser.newContext();assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:process.env.MYGRAIN_TEST_PASSWORD||'isolated-vst3-test'}})).status(),200);
  const p=await c.newPage(),errors=[];p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(rate=>{const Native=AudioContext;window.AudioContext=new Proxy(Native,{construct(target,args){return new target({...args[0],sampleRate:rate})}})},rate);
  await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.click('#start-btn');await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  fs.writeFileSync(control,'stop');let log='';host=spawn(fixture,[new URL(base).origin,control]);host.stdout.on('data',b=>log+=b);
  const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Native fixture start timeout')),5000);host.stdout.on('data',()=>{const m=log.match(/187\d{2}\.[a-f0-9]{32}/);if(m){clearTimeout(timer);resolve(m[0])}})});
  await p.evaluate(code=>{document.getElementById('dawBridgeCode').value=code;mygrainDawBridge.connect()},code);
  await p.waitForFunction(()=>mygrainDawBridge.diagnostics().connected&&mygrainDawBridge.diagnostics().project.ready);
  await p.evaluate(()=>{
   [...mygrainProjectSessions].find(s=>s.worker).configure({enabled:false});
   stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});setDrumMachineEnabled(false,{silent:true,skipSave:true});
   const b=audioContext.createBuffer(2,Math.round(audioContext.sampleRate*4*60/102),audioContext.sampleRate);
   for(let c=0;c<2;c++)for(let i=0;i<b.length;i++)b.getChannelData(c)[i]=.05*Math.sin(2*Math.PI*220*i/b.sampleRate);
   bastardLoopBuffer=b;bastardLoopSourceBpm=102;bastardLoopMetadata={bpm:102,durationSeconds:b.duration};setLoopLayerSolo('bastarda',{silent:true,skipSave:true});setBastardLoopEnabled(true,{silent:true,skipSave:true});
   const prewarm=prewarmTransportBuffers;window.prewarmTransportBuffers=function(...args){if(transportSync.depth===0){const end=performance.now()+400;while(performance.now()<end){}}return prewarm.apply(this,args)};
  });
  fs.writeFileSync(control,'play');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock.running,null,{timeout:15000});
  const start=await p.evaluate(()=>mygrainDawBridge.diagnostics());await sleep(11000);const steady=await p.evaluate(()=>mygrainDawBridge.diagnostics());
  assert.equal(start.clock.underruns,0);assert.equal(steady.clock.underruns,0);assert.equal(steady.epoch,start.epoch);assert(steady.clock.running&&steady.clock.received>start.clock.received+rate*8);assert(steady.clock.timelineJumps>=start.clock.timelineJumps+2,'Host must wrap its musical/sample timeline without cycle metadata');
  fs.writeFileSync(control,'stop');await p.waitForFunction(()=>!mygrainDawBridge.diagnostics().clock.armed&&mygrainDawBridge.diagnostics().epoch===0);await sleep(1000);assert.equal(await p.evaluate(()=>mygrainDawBridge.diagnostics().clock.armed),false);
  fs.writeFileSync(control,'play');await p.waitForFunction(old=>mygrainDawBridge.diagnostics().clock.running&&mygrainDawBridge.diagnostics().clock.received>old,steady.clock.received,{timeout:15000});await sleep(3000);const restart=await p.evaluate(()=>mygrainDawBridge.diagnostics());assert(restart.clock.running);assert.equal(restart.clock.underruns,0);
  const exit=new Promise(resolve=>host.once('exit',resolve));fs.writeFileSync(control,'quit');assert.equal(await exit,0);host=null;
  const native=log.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x)),last=native.at(-1);assert(last.nonzeroFrames>48000&&last.peak>1e-5&&Number.isFinite(last.peak));assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,`clock-${rate}.json`),JSON.stringify({rate,start,steady,restart,native,errors,targetDawVerified:false},null,2));
  console.log(`PASS ${rate} Hz: 400 ms prewarm, sustained native PCM, Stop/restart, zero underruns`);
 }finally{if(host)host.kill();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
