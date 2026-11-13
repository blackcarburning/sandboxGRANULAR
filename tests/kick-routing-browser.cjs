const {chromium,webkit}=require('playwright-core');
const fs=require('fs');
const out=process.env.OUT||'/tmp';
const fixed=process.env.EXPECT_FIXED!=='0';
const assert=require('assert/strict');
const base=process.env.BASE||'http://127.0.0.1:19313/mygrain/';
(async()=>{for(const [engine,type] of Object.entries({chromium,webkit}))for(const phone of [false,true]){
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
  const tap=ctx.createScriptProcessor(2048,2,2),mute=ctx.createGain();mute.gain.value=0;finalAmplifierNode.connect(tap);tap.connect(mute);mute.connect(ctx.destination);let samples=[];
  tap.onaudioprocess=e=>samples.push(...e.inputBuffer.getChannelData(0));
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const measure=async()=>{await wait(280);samples=[];const end=performance.now()+2500;while(samples.length<8192&&performance.now()<end)await wait(40);if(!samples.length)throw Error('No final PCM '+ctx.state);let sum=0;for(const x of samples){if(!Number.isFinite(x))throw Error('Non-finite PCM');sum+=x*x;}return Math.sqrt(sum/samples.length);};
  const run=async(track,source='kick',amount=0,comp=0)=>{
   stopAllPerformancePlayback({silent:true});setFilterEnabled('hpf',false);setSliderValue('finalCompressorAmount',comp);setSliderValue('finalSidechainAmount',amount);setFinalCompressorSidechainSource(source,{silent:true,skipSave:true});setFxMuted(false,{silent:true});
   scheduleDrumMachineRepeats(track,0,ctx.currentTime+.03,.125);const dry=await measure();setSliderValue('hpfCutoff',2000);setFilterEnabled('hpf',true);const wet=await measure();return{dry,wet,ratio:wet/dry,bypass:shouldRouteKickAroundFinalCompressor()};
  };
  const off=await run('kick','off'),zero=await run('kick','kick'),snare=await run('snare','kick'),compOff=await run('kick','kick',80,0),active=await run('kick','kick',80,50);
  const switches=[];for(const [source,amount,comp,muted]of[['off',80,50,false],['kick',0,50,false],['kick',80,0,false],['kick',80,50,true],['kick',80,50,false],['lfo1',80,50,false]]){setSliderValue('finalCompressorAmount',comp);setSliderValue('finalSidechainAmount',amount);setFinalCompressorSidechainSource(source,{silent:true,skipSave:true});setFxMuted(muted,{silent:true});switches.push({source,amount,comp,muted,bypass:shouldRouteKickAroundFinalCompressor(),trim:getDrumMachineKickPlaybackLevel()});}
  const transition=[];
  setFxMuted(false,{silent:true});setSliderValue('finalCompressorAmount',50);setSliderValue('finalSidechainAmount',80);setFinalCompressorSidechainSource('kick',{silent:true,skipSave:true});setFilterEnabled('hpf',true);
  for(const change of ['amount','comp','key','mute','direct','playground','trim']){
   stopAllPerformancePlayback({silent:true});setFxMuted(false,{silent:true});setSliderValue('finalCompressorAmount',50);setSliderValue('finalSidechainAmount',80);setSliderValue('finalSidechainKickLevel',100);setFinalCompressorSidechainSource('kick',{silent:true,skipSave:true});setDrumMachineDirectOutput(false,{silent:true,skipSave:true});await mygrainWasp.restore();
   scheduleDrumMachineRepeats('kick',0,ctx.currentTime+.03,.125);await wait(80);
   const voice=[...drumMachineActiveVoices][0],node=drumMachineKickRoutingNode,before=node.connectedTo===drumMachineKickBypassGainNode;
   if(change==='amount')setSliderValue('finalSidechainAmount',0);
   if(change==='comp')setSliderValue('finalCompressorAmount',0);
   if(change==='key')setFinalCompressorSidechainSource('off',{silent:true,skipSave:true});
   if(change==='mute')setFxMuted(true,{silent:true});
   if(change==='direct')setDrumMachineDirectOutput(true,{silent:true,skipSave:true});
   if(change==='playground')await mygrainWasp.restore({...mygrainWasp.settings(),playground:{...mygrainWasp.settings().playground,enabled:true,routeKick:true}});
   if(change==='trim')setSliderValue('finalSidechainKickLevel',0);
   await wait(150);const after=node.connectedTo===drumMachineBusGainNode;
   const sameVoice=drumMachineActiveVoices.has(voice)&&drumMachineActiveVoices.size===1;
   transition.push({change,before,after,sameVoice,gain:voice.kickTrim.gain.value,pcm:change==='amount'?await measure():null});
  }
  await mygrainWasp.restore();setSliderValue('finalSidechainKickLevel',0);setSliderValue('finalSidechainAmount',0);await wait(100);const ignoredTrim=drumMachineKickRoutingNode.gain.value;
  stopAllPerformancePlayback({silent:true});tap.onaudioprocess=null;finalAmplifierNode.disconnect(tap);tap.disconnect();mute.disconnect();
  return{off,zero,snare,compOff,active,switches,transition,ignoredTrim};
 });
 fs.writeFileSync(out+'/'+(fixed?'fixed-':'baseline-')+name+'.json',JSON.stringify({result,errors},null,2));console.log(name,JSON.stringify(result));assert.deepEqual(errors,[]);
 if(fixed){for(const k of ['off','zero','snare','compOff']){assert(result[k].dry>1e-4,k+' dry silent');assert(result[k].ratio<.05,k+' did not traverse filter');}assert(result.active.ratio>.85,'active SC kick should avoid music filter');assert.deepEqual(result.switches.map(s=>s.bypass),[false,false,false,false,true,false]);for(const t of result.transition){assert(t.before&&t.sameVoice,JSON.stringify(t));if(t.change!=='trim')assert(t.after,JSON.stringify(t));else assert(t.gain<.001,JSON.stringify(t));}assert(result.transition[0].pcm<result.active.wet*.05);assert(result.ignoredTrim>.999);}
 }finally{await b.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
