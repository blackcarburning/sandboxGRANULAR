'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18965/mygrain/';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{const results=[];for(const[engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});assert.equal((await ctx.request.post(base+'api/auth/login',{data:{username:'admin',password:process.env.MYGRAIN_TEST_ADMIN_PASSWORD||'isolated-speedups-test'}})).status(),200);const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());if(process.env.X_PREVIEW_BEFORE_HTML)await p.route(base,r=>r.fulfill({contentType:'text/html',body:require('node:fs').readFileSync(process.env.X_PREVIEW_BEFORE_HTML)}));await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!stateSaveSuspended&&!engineStarting&&!mygrainCardHistory.busy);

 for(const mode of ['synth','sample'])for(const record of [false,true])for(const input of ['keyboard','grid']){
  await p.evaluate(({mode,record})=>{
   stopAllPerformancePlayback({silent:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});
   const buffer=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate);for(let i=0;i<buffer.length;i++)buffer.getChannelData(0)[i]=.2*Math.sin(2*Math.PI*220*i/buffer.sampleRate);
   bastardLoopLSourceMode='sample';bastardLoopXSourceMode=mode;bastardLoopXSampleBuffer=buffer;bastardLoopXSampleMetadata=null;bastardLoopXRootNote='C3';bastardLoopXEnabled=false;bastardLoopXRecordArmed=record;
   setBastardLoopXLevelPercent(60,{skipSave:true});setSliderValue('performanceBastardLoopXAttack',1);
   const fx=mygrainLoopFx.settings();Object.assign(fx.channels.X,{filterEnabled:false,room:0,delay:0});mygrainLoopFx.restore(fx);
   bastardLoopXSequence=Array.from({length:64},()=>createEmptyBastardLoopXStep());bastardLoopXSequence[0]={...createEmptyBastardLoopXStep(),note:'C3',rest:false};setBastardLoopXEditStepIndex(0);resetBastardLoopXStepTapMemory();openBastardLoopXOverlay();
   window.xPreviewMeter=audioContext.createAnalyser();xPreviewMeter.fftSize=2048;finalAmplifierNode.connect(xPreviewMeter);
   window.xPreviewBefore=JSON.stringify(bastardLoopXSequence);
  },{mode,record});
  await p.waitForTimeout(450); // Let Stop's duck and the idle gate settle first.
  const idle=await p.evaluate(()=>({idle:shouldIdleBypassFinalBusCompressor(),gain:finalSidechainGain.gain.value}));assert(idle.idle&&idle.gain<.01,JSON.stringify(idle));
  // Measure the actual final speaker bus, not connectAnalysisTap's pre-gate signal.
  await p.evaluate(()=>{window.xPreviewPeak=0;window.xPreviewPolling=setInterval(()=>{const a=new Float32Array(xPreviewMeter.fftSize);xPreviewMeter.getFloatTimeDomainData(a);for(const v of a)xPreviewPeak=Math.max(xPreviewPeak,Math.abs(v))},10)});
  if(input==='keyboard')await p.locator('#bastardLoopXKeyboard button[data-note="D3"]').tap();
  else await p.locator('#bastardLoopXStepGrid button[data-step-index="0"]').tap();
  await p.waitForTimeout(650);
  const result=await p.evaluate(()=>{clearInterval(xPreviewPolling);finalAmplifierNode.disconnect(xPreviewMeter);xPreviewMeter.disconnect();return{peak:xPreviewPeak,running:bastardLoopXTransportActive,shared:bastardLoopPlaying,sequenceUnchanged:JSON.stringify(bastardLoopXSequence)===xPreviewBefore,status:document.getElementById('bastardLoopXStatus').textContent}});
  console.log(JSON.stringify({engine,mode,record,input,...result}));assert(result.peak>.0001,'Silent final output: '+JSON.stringify({engine,mode,record,input,...result}));assert.equal(result.running,false);assert.equal(result.shared,false);assert.equal(result.sequenceUnchanged,!(record&&input==='keyboard'));
  await p.evaluate(()=>{stopSequencerEditorOnly('X');closeBastardLoopXOverlay()});await p.waitForTimeout(750);
  assert.equal(await p.evaluate(()=>shouldIdleBypassFinalBusCompressor()),true,'Output must return to idle after preview cleanup');
 }
 assert.deepEqual(errors,[]);
 }finally{await b.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
