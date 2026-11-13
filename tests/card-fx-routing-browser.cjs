'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19333/mygrain/',out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp';assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
const engine=process.env.MYGRAIN_TEST_ENGINE||'chromium';(async()=>{const browser=await(engine==='webkit'?webkit.launch():chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}));try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),p=await context.newPage(),jobs=[],errors=[];p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/server-arm?'))jobs.push(r.url());});
 await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
 await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);

 await p.evaluate(async()=>{
 stopAllPerformancePlayback({silent:true});setDrumMachineEnabled(false,{silent:true,skipSave:true});for(const l of SPARSE_RANDOM_LAYER_DEFINITIONS)l.setEnabled(false,{silent:true,skipSave:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});setFxMuted(true,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);for(const id of['reverb','distortion','noiseMix','finalDriveSoft','finalDriveHard','finalDriveFold','finalDriveCrush','finalCompressorAmount','finalSidechainAmount','delayMix','delayFeedback','finalDelayDepth','finalReverbMix','oscNoiseLevel'])setSliderValue(id,0);mygrainLoopFx.restore();mygrainChannelEq.restore();mygrainNoise.restore();await mygrainCookingPot.restore();await mygrainWasp.restore();await mygrainTurntable.off();await mygrainResonator.off();await mygrainAcousticFx.off();mygrainBassFace.restore();mygrainD.setMutilator({enabled:false,input:'D'});mygrainEffectOutput.restore();setSliderValue('performanceMasterTrim',0);applyGlobalBpm(240);syncPatternLengthControls(16,{skipSave:true});setSliderValue('volume',60);

 window.routeProbe=async(key,settings,{pulse=false}={})=>{
  await backgroundAudioController?.wake();if(audioContext.state!=='running')await audioContext.resume();
  mygrainLoopFx.restore({version:1,channels:{[key]:settings}});await mygrainCookingPot.whenReady();
  const b=audioContext.createBuffer(2,Math.round(audioContext.sampleRate*(pulse?.025:.6)),audioContext.sampleRate);for(let c=0;c<2;c++)for(let i=0;i<b.length;i++)b.getChannelData(c)[i]=.08*Math.sin(2*Math.PI*1000*i/b.sampleRate);
  const source=audioContext.createBufferSource();source.buffer=b;const gain=audioContext.createGain();gain.gain.value=.5;source.connect(gain);const route=mygrainChannelEq.connect(key,gain,preFilterGainNode,source);await mygrainCookingPot.whenReady();
  await prepareLiveOutputCapture(audioContext);const at=audioContext.currentTime+.08;source.start(at);const{audioBuffer:out}=await recordLiveOutputPcm(audioContext,finalAmplifierNode,pulse?1:.35,{captureStartTime:at});try{source.stop()}catch{}route.disconnect();gain.disconnect();
  const a=out.getChannelData(0);let sum=0,late=0;for(let i=0;i<a.length;i++){sum+=a[i]*a[i];if(i>out.sampleRate*.16)late+=a[i]*a[i];}return{rms:Math.sqrt(sum/a.length),late:Math.sqrt(late/a.length)};
 };
 return true;});
 const rows=[];for(const pot of [false,true])for(const effect of ['bassFace','mutilator'])for(const key of ['A','D']){
  await p.evaluate(async({pot,effect,key})=>{await mygrainCookingPot.restore({enabled:pot});mygrainBassFace.restore({enabled:effect==='bassFace',input:key,amount:.4,mix:1,tone:.8});mygrainD.setMutilator({enabled:effect==='mutilator',input:key,amount:.4,mix:1,tone:.8});mygrainEffectOutput.restore({mainMuted:true});await mygrainCookingPot.whenReady();}, {pot,effect,key});
  const dry=await p.evaluate(key=>routeProbe(key,{filterEnabled:false,reverbEnabled:false,delayEnabled:false}),key);
  const filtered=await p.evaluate(key=>routeProbe(key,{filterEnabled:true,cutoff:180,filterSlope:48,lfoDepth:0,reverbEnabled:false,delayEnabled:false}),key);
  assert(dry.rms>1e-6,JSON.stringify({pot,effect,key,dry}));assert(filtered.rms<dry.rms*.08,JSON.stringify({pot,effect,key,dry,filtered}));rows.push({pot,effect,key,dry,filtered});
 }
 await p.evaluate(async()=>{await mygrainCookingPot.restore({enabled:true});mygrainD.setMutilator({enabled:false});mygrainBassFace.restore({enabled:true,input:'A',amount:.3,mix:1,tone:.8});await mygrainCookingPot.whenReady();});
 const plain=await p.evaluate(()=>routeProbe('A',{filterEnabled:false,reverbEnabled:false,delayEnabled:false},{pulse:true}));const delay=await p.evaluate(()=>routeProbe('A',{filterEnabled:false,reverbEnabled:false,delayEnabled:true,delay:.8,delayBeats:.5,feedback:.3},{pulse:true}));const hall=await p.evaluate(()=>routeProbe('A',{filterEnabled:false,reverbEnabled:true,room:1,reverbDecay:2,delayEnabled:false},{pulse:true}));
 assert(delay.late>plain.late*5+1e-6,JSON.stringify({plain,delay}));assert(hall.late>plain.late*5+1e-6,JSON.stringify({plain,hall}));assert.deepEqual(errors,[]);fs.writeFileSync(out+'/card-routing-'+engine+'.json',JSON.stringify({rows,plain,delay,hall,errors},null,2));console.log('PASS',engine,'A/D card filter before Bass Face/Mutilator native and Pot; delay/hall in wet-only output');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
