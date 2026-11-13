const {chromium,webkit}=require('playwright-core');
const fs=require('fs');
const out=process.env.OUT||'/tmp';
const fixed=process.env.EXPECT_FIXED==='1';
const assert=require('assert/strict');
const base=process.env.BASE||'http://127.0.0.1:19313/mygrain/';
(async()=>{for(const [engine,type] of Object.entries({chromium,webkit}))for(const phone of [true]){
 const name=engine+(phone?'-phone':'-desktop');
 const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{
 const c=await b.newContext(phone?{viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{viewport:{width:1440,height:1000}}),p=await c.newPage(),errors=[];
 p.setDefaultTimeout(90000);p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
 await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 const result=await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});for(const l of SPARSE_RANDOM_LAYER_DEFINITIONS)l.setEnabled(false,{silent:true,skipSave:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});
  setFxMuted(false,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);
  for(const id of ['reverb','distortion','noiseMix','finalDriveSoft','finalDriveHard','finalDriveFold','finalDriveCrush','finalCompressorAmount','finalSidechainAmount','delayMix','delayFeedback','finalDelayDepth','finalReverbMix','oscNoiseLevel','drumMachineSnareDistortion'])setSliderValue(id,0);
  mygrainLoopFx.restore();mygrainChannelEq.restore();await mygrainWasp.restore();await mygrainTurntable.off();await mygrainResonator.off();mygrainNoise.restore();mygrainBassFace.restore();await mygrainAcousticFx.off();
  loadDrumSendFxState({delay:{enabled:false},reverb:{enabled:false}});setDrumMachineDirectOutput(false,{silent:true,skipSave:true});setDrumMachineEnabled(true,{silent:true,skipSave:true});setSliderValue('performanceDrumMachineLevel',70);setSliderValue('drumMachineKickLevel',100);setSliderValue('drumMachineSnareLevel',100);setSliderValue('drumMachineKickLength',100);setSliderValue('drumMachineKickDecay',100);setSliderValue('drumMachineSnareLength',100);setSliderValue('drumMachineSnareDecay',100);
  const ctx=audioContext,buf=ctx.createBuffer(2,ctx.sampleRate*3,ctx.sampleRate);
  for(let ch=0;ch<2;ch++)for(let i=0;i<buf.length;i++)buf.getChannelData(ch)[i]=.08*Math.sin(2*Math.PI*110*i/buf.sampleRate);
  drumMachineKickBuffer=buf;drumMachineSnareBuffer=buf;drumMachineKickPattern=Array(16).fill(false);drumMachineKickPattern[0]=true;drumMachineSnarePattern=drumMachineKickPattern.slice();
  applyGlobalBpm(240);syncPatternLengthControls(16,{skipSave:true});
  for(const k of ['kick','snare','hat','perc',...Object.keys(drumMachineExtraTracks)])setDrumMachinePattern(k,Array(16).fill(false),{skipSave:true});
  setDrumMachinePattern('kick',Array.from({length:16},(_,i)=>i%4===0),{skipSave:true});
  setFilterEnabled('hpf',true);setSliderValue('hpfCutoff',2000);
  const renders=[];
  for(const [source,amount,comp]of [['off',0,0],['kick',0,0],['kick',80,0],['kick',80,50]]){
   setFinalCompressorSidechainSource(source,{silent:true,skipSave:true});setSliderValue('finalCompressorAmount',comp);setSliderValue('finalSidechainAmount',amount);
   const file=await renderDawReadyBarsExport({exportSteps:16}),buf=await audioContext.decodeAudioData(await file.blob.arrayBuffer()),a=buf.getChannelData(0);let sum=0;for(const v of a){if(!Number.isFinite(v))throw Error('Bad WAV');sum+=v*v;}renders.push({source,amount,comp,rms:Math.sqrt(sum/a.length),frames:buf.length,rate:buf.sampleRate});
  }
  return renders;
 });
 fs.writeFileSync(out+'/kick-wav-'+name+'.json',JSON.stringify({result,errors},null,2));
 console.log('WAV',name,JSON.stringify(result));assert.deepEqual(errors,[]);
 for(const r of result){assert(r.rms>1e-8);assert.equal(r.frames,r.rate);}
 for(const i of [1,2])assert(Math.abs(result[i].rms/result[0].rms-1)<.04);
 assert(result[3].rms>result[0].rms*50);
 }finally{await b.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
