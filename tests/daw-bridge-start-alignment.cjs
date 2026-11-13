'use strict';
// Real Chromium final-mix PCM -> native Bridge engine. No DAW/device emulation claim.
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19109/mygrain/';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
const out=process.env.MYGRAIN_ALIGNMENT_OUTPUT;
assert(out,'Set MYGRAIN_ALIGNMENT_OUTPUT to a private evidence directory');
const rate=Number(process.env.MYGRAIN_TEST_RATE||48000),label=process.env.MYGRAIN_ALIGNMENT_LABEL||'fixed';
const fixture=process.env.MYGRAIN_ALIGNMENT_FIXTURE||'/tmp/mygrain-live-start-fixture';
const raw=path.join(out,`live-start-${label}-${rate}.f32`);
const peak=(samples,a,b)=>{let index=a,value=0;for(let i=a;i<b;i++)if(Math.abs(samples[i])>value){value=Math.abs(samples[i]);index=i;}return{index,value};};
(async()=>{
 const browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
 let host;
 try{
  const context=await browser.newContext(),p=await context.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  if(label==='before')await p.route('**/daw-bridge.js?*',r=>r.fulfill({path:path.join(out,'../before/daw-bridge.js'),contentType:'application/javascript'}));
  await p.addInitScript(rate=>{const Native=AudioContext;window.AudioContext=new Proxy(Native,{construct(target,args){return new target({...args[0],sampleRate:rate});}});},rate);
  assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
  await p.goto(base);await p.waitForFunction(()=>window.mygrainDawBridge&&document.documentElement.dataset.mygrainStartup==='ready');
  await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  const reference=await p.evaluate(async()=>{
   stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);
   for(const id of ['reverb','distortion','noiseMix','finalDriveSoft','finalDriveHard','finalDriveFold','finalDriveCrush','finalCompressorAmount','finalSidechainAmount','delayMix','delayFeedback','finalDelayDepth','finalReverbMix','oscNoiseLevel'])setSliderValue(id,0);
   setDrumMachineEnabled(false,{silent:true,skipSave:true});mygrainNoise.restore({enabled:false});mygrainChannelEq.restore();await mygrainResonator.off();
   applyGlobalBpm(120);syncPatternLengthControls(16,{skipSave:true});
   const b=audioContext.createBuffer(2,audioContext.sampleRate*2,audioContext.sampleRate);
   for(let ch=0;ch<2;ch++)for(let n=0;n<4;n++)b.getChannelData(ch)[Math.round((.1+n*.5)*b.sampleRate)]=ch?.1:.15;
   bastardLoopBuffer=b;bastardLoopSourceBpm=120;bastardLoopMetadata={bpm:120,durationSeconds:2};setLoopLayerSolo('bastarda',{silent:true,skipSave:true});setBastardLoopEnabled(true,{silent:true,skipSave:true});
   const render=await renderLiveOutputBarsBuffer({exportSteps:16,loopWarmupCycles:1});
   return{rate:render.audioBuffer.sampleRate,frames:render.audioBuffer.length,samples:Array.from(render.audioBuffer.getChannelData(0)),latency:getTransportTimingDebug().latency};
  });
  assert.equal(reference.rate,rate);assert.equal(reference.frames,rate*2);
  host=spawn(fixture,[new URL(base).origin,'40',raw]);let log='';host.stdout.on('data',c=>log+=c);host.stderr.pipe(process.stderr);
  const code=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Fixture start timeout')),5000);host.stdout.on('data',()=>{const m=log.match(/187\d{2}\.[a-f0-9]{32}/);if(m){clearTimeout(timeout);resolve(m[0]);}});host.on('exit',n=>reject(Error('Fixture exited '+n)));});
  await p.locator('#dawBridgeCard').evaluate(el=>el.open=true);await p.locator('#dawBridgeCode').fill(code);await p.locator('#dawBridgeConnect').click();
  await p.waitForFunction(()=>mygrainDawBridge.diagnostics().connected);
  await p.locator('#dawBridgeArm').click();await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.running,{},{timeout:15000});
  const first=await p.evaluate(()=>mygrainDawBridge.diagnostics());
  await p.waitForFunction(target=>mygrainDawBridge.diagnostics().clock?.clock>target+125000,first.clock.target,{timeout:15000});
  const last=await p.evaluate(()=>mygrainDawBridge.diagnostics());
  await p.locator('#dawBridgeStop').click();await p.waitForFunction(()=>!mygrainDawBridge.diagnostics().clock?.armed);
  host.kill('SIGTERM');await new Promise(resolve=>host.once('exit',resolve));host=null;
  const bytes=fs.readFileSync(raw),native=new Float32Array(Math.floor(bytes.length/8));for(let i=0;i<native.length;i++)native[i]=bytes.readFloatLE(i*8);
  const target=first.clock.target,peaks=[];
  for(let n=0;n<4;n++){
   const t=.1+n*.5,r=peak(reference.samples,Math.round((t-.02)*rate),Math.round((t+.02)*rate));
   const expected=target+Math.round(r.index*48000/rate),actual=peak(native,expected-800,expected+800);
   assert(r.value>1e-4&&actual.value>1e-4,JSON.stringify({r,actual}));
   peaks.push({renderFrame:r.index,expectedNativeFrame:expected,actualNativeFrame:actual.index,offsetSamples:actual.index-expected,amplitude:actual.value});
  }
  const report={label,rate,nativeRate:48000,latency:reference.latency,first,last,peaks,errors,targetHostVerified:false};
  fs.writeFileSync(path.join(out,`live-start-${label}-${rate}.json`),JSON.stringify(report,null,2));
  assert.equal(last.clock.underruns,0);assert.equal(last.clock.overflows,0);assert.deepEqual(errors,[]);
  if(label==='fixed'){
   assert(Math.abs(peaks[0].offsetSamples)<=3,'cold-start sample alignment: '+JSON.stringify(peaks));
   // The preview has independent browser/native clocks, not sample-locked PDC.
   // Allow <0.5 ms over the following beats; do not demand zero clock drift.
   assert(peaks.every(p=>Math.abs(p.offsetSamples)<24),JSON.stringify(peaks));
  }
  console.log(JSON.stringify({label,rate,latencyFrames:reference.latency.frames,peaks}));
 }finally{if(host)host.kill('SIGTERM');await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
