'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18965/mygrain/';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{const results=[];for(const[engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});assert.equal((await ctx.request.post(base+'api/auth/login',{data:{username:'admin',password:process.env.MYGRAIN_TEST_ADMIN_PASSWORD||'isolated-speedups-test'}})).status(),200);const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!stateSaveSuspended&&!engineStarting&&!mygrainCardHistory.busy);
 for(const layer of ['L','X'])for(const source of ['sample','synth','synth-muted']){
  await p.evaluate(({layer,source})=>{
   stopAllPerformancePlayback({silent:true});setLoopLayerSolo([],{silent:true,skipSave:true});
   const data=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate);for(let i=0;i<data.length;i++)data.getChannelData(0)[i]=.2*Math.sin(2*Math.PI*220*i/data.sampleRate);
   setSliderValue('performanceBastardLoop'+layer+'Level',60);setSliderValue('performanceBastardLoop'+layer+'Attack',1);bastardLoopLSourceMode='sample';bastardLoopXSourceMode='sample';
   const fx=mygrainLoopFx.settings();Object.assign(fx.channels[layer],{filterEnabled:false,room:0,delay:0});mygrainLoopFx.restore(fx);
   if(source==='synth-muted'){setSliderValue('performanceBastardLoop'+layer+'Level',0);source='synth'}
   if(layer==='X'){bastardLoopXSampleMetadata=null;bastardLoopXSampleBuffer=data;bastardLoopXRootNote='C3';bastardLoopXSourceMode=source;bastardLoopXRecordArmed=true;openBastardLoopXOverlay()}
   else{bastardLoopLSampleMetadata=null;bastardLoopLSampleBuffer=data;bastardLoopLRootNote='C3';bastardLoopLSourceMode=source;bastardLoopLRecordArmed=true;openBastardLoopLOverlay()}
   window.keyAudio=audioContext.createAnalyser();keyAudio.fftSize=2048;window.keyTaps=connectAnalysisTap(keyAudio);window.keySink=audioContext.createGain();keySink.gain.value=0;keyAudio.connect(keySink);keySink.connect(audioContext.destination);
  },{layer,source});
  const key=p.locator('#bastardLoop'+layer+'Keyboard button[data-note="C3"]');await key.scrollIntoViewIfNeeded();const box=await key.boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await p.waitForTimeout(90);
  const r=await p.evaluate(({layer,source})=>{const a=new Float32Array(keyAudio.fftSize);keyAudio.getFloatTimeDomainData(a);return{layer,source,rms:Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length),holds:sequencerKeyboardHolds.size,voices:activeOscVoices.size,status:document.getElementById('bastardLoop'+layer+'Status').textContent}}, {layer,source});await p.mouse.up();console.log(JSON.stringify({engine,...r}));results.push({engine,...r});await p.evaluate(layer=>{for(const source of keyTaps)source.disconnect(keyAudio);keyAudio.disconnect();keySink.disconnect();if(layer==='X')closeBastardLoopXOverlay();else closeBastardLoopLOverlay()},layer);
 }

 const saved=await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});for(const layer of SPARSE_RANDOM_LAYER_DEFINITIONS)layer.setEnabled(false,{silent:true,skipSave:true});setDrumMachineEnabled(false,{silent:true,skipSave:true});seqGrainsEnabled=false;document.getElementById('seqGrainsEnabled').checked=false;
  bastardLoopLSourceMode='sample';bastardLoopXSourceMode='synth';setBastardLoopXEnabled(true,{silent:true,skipSave:true});setSliderValue('performanceBastardLoopXLevel',60);applyGlobalBpm(300);syncPatternLengthControls(8,{skipSave:true});bastardLoopXSequence=Array.from({length:64},()=>createEmptyBastardLoopXStep());bastardLoopXSequence[0]={...createEmptyBastardLoopXStep(),note:'C3',rest:false};
  const c=mygrainSongBeta;document.getElementById('songBetaName').value='Isolated X audition render test';await c.newSong();const part=await c.newPart({name:'OSC3 sequence'});setSliderValue('performanceBastardLoopXLevel',0);const muted=await c.newPart({name:'Muted OSC3 sequence'});await c.finishEditing();const source=part.sha256,revision=c.song.revision;
  await c.prepareOnServer(part,c.generation);await c.prepareOnServer(muted,c.generation);await c.arm();const buffer=await c.loadRender(c.song.parts[0]);let sum=0;for(const sample of buffer.getChannelData(0))sum+=sample*sample;const silent=await c.loadRender(c.song.parts[1]);let mutedPeak=0;for(const x of silent.getChannelData(0))mutedPeak=Math.max(mutedPeak,Math.abs(x));if(mutedPeak>1e-5)throw Error('Audition floor leaked into muted Song render: '+mutedPeak);
  if(source!==c.song.parts[0].sha256||revision!==c.song.revision)throw Error('Server render changed saved sources');return{serverRenderRms:Math.sqrt(sum/buffer.length),frames:buffer.length,mutedPeak,sourceUnchanged:true};
 });assert(saved.serverRenderRms>.0001,JSON.stringify(saved));console.log(JSON.stringify({engine,...saved}));
 assert.deepEqual(errors,[]);
 }finally{await b.close()}
}if(process.env.X_KEY_ASSERT)assert(results.every(x=>x.rms>.0001),JSON.stringify(results));})().catch(e=>{console.error(e);process.exitCode=1});
