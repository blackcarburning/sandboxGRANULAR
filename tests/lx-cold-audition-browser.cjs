'use strict';
const assert=require('node:assert/strict');
const {webkit,chromium}=require('playwright-core');
(async()=>{for(const [engine,type] of Object.entries({webkit,chromium})){const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});try{const c=await b.newContext({viewport:{width:process.env.MYGRAIN_NOTE_DESKTOP?1440:390,height:process.env.MYGRAIN_NOTE_DESKTOP?1000:844},hasTouch:!process.env.MYGRAIN_NOTE_DESKTOP,isMobile:!process.env.MYGRAIN_NOTE_DESKTOP,...(process.env.MYGRAIN_NOTE_DESKTOP?{}:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'})});const p=await c.newPage();p.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text())});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='https://openclaw.blackcarburning.com')return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"wasp-fixture"}};'});if(u.pathname.includes('/api/'))return r.fulfill({json:{ok:true,authenticated:true,user:{username:'wasp-fixture'},files:[],songs:[],folders:[],samples:[],patches:[]}});if(!['GET','HEAD'].includes(r.request().method()))return r.abort();return r.continue()});await p.goto('https://openclaw.blackcarburning.com/mygrain/');await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting);


await p.waitForFunction(()=>getComputedStyle(document.getElementById('start-overlay')).display==='none');
await p.waitForFunction(()=>!stateSaveSuspended&&!mygrainCardHistory.busy);await p.waitForTimeout(1000);

const frames=44100,wav=Buffer.alloc(44+frames*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*2,40);for(let i=0;i<frames;i++)wav.writeInt16LE(Math.round(6000*Math.sin(i*2*Math.PI*262/44100)),44+i*2);
await p.route('**/*.wav',async r=>{await new Promise(resolve=>setTimeout(resolve,350));await r.fulfill({contentType:'audio/wav',body:require('node:fs').readFileSync(require('node:path').join(__dirname,'..',decodeURIComponent(new URL(r.request().url()).pathname.split('/mygrain/')[1])))})});
await p.route('**/api/source-sample?*',async r=>{await new Promise(resolve=>setTimeout(resolve,300));return r.fulfill({contentType:'audio/wav',body:wav})});

for (const width of (process.env.MYGRAIN_NOTE_WIDTHS||'1440,390').split(',').map(Number)){
await p.setViewportSize({width,height:width===1440?1000:844});
const results=await p.evaluate(async width=>{
 stopAllPerformancePlayback({silent:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});setFinalReverbEnabled(false,{silent:true,skipSave:true});setGlobalMixDelayEnabled(false,{silent:true,skipSave:true});
 const fx=mygrainLoopFx.settings();for(const c of Object.values(fx.channels))Object.assign(c,{filterEnabled:false,delay:0,room:0});mygrainLoopFx.restore(fx);
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),analyser=audioContext.createAnalyser();analyser.fftSize=2048;splitterNode.connect(analyser,0);const a=new Float32Array(2048),out=[];
 async function measure(name,trigger){stopAllPerformancePlayback({silent:true});await wait(400);const result=trigger();let peak=0;for(let j=0;j<65;j++){await wait(25);analyser.getFloatTimeDomainData(a);for(const v of a)peak=Math.max(peak,Math.abs(v));}await result;out.push({name,peak});}
 for(const lane of ['L','X']){
  function setup(){
   const metadata={sourceKey:'samples_leads',sourceLabel:'SAMPLES_LEADS',fileName:'fixture.wav',relativePath:'fixture.wav',rootNote:'C4'};
   if(lane==='L'){setBastardLoopLSourceMode('sample',{silent:true,skipSave:true});bastardLoopLSampleBuffer=null;bastardLoopLSampleMetadata=metadata;setBastardLoopLStep(0,{note:'C4',rest:false},{skipSave:true});setBastardLoopLEditStepIndex(0);setBastardLoopLLevelPercent(50,{skipSave:true});renderBastardLoopLKeyboard();}
   else {setBastardLoopXSourceMode('sample',{silent:true,skipSave:true});bastardLoopXSampleBuffer=null;bastardLoopXSampleMetadata=metadata;setBastardLoopXStep(0,{note:'C4',rest:false},{skipSave:true});setBastardLoopXEditStepIndex(0);setBastardLoopXLevelPercent(50,{skipSave:true});renderBastardLoopXKeyboard();}
  }
  setup();await measure(lane+' grid remembered sample',()=>lane==='L'?auditionBastardLoopLCurrentStepWithReady():auditionBastardLoopXCurrentStepWithReady());
  setup();const key=document.querySelector('#bastardLoop'+lane+'Keyboard [data-note="C4"]')||document.querySelector('#bastardLoop'+lane+'Keyboard [data-note]');
  for(const cancel of [false,true]){
   setup();await measure(lane+(cancel?' scroll cancel':' cold 40ms tap'),async()=>{
    key.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:2,button:0,pointerType:width===390?'touch':'mouse'}));await wait(40);
    key.dispatchEvent(new PointerEvent(cancel?'pointercancel':'pointerup',{bubbles:true,pointerId:2,button:0,pointerType:width===390?'touch':'mouse'}));
   });
  }
 }

 for(const lane of ['L','X']){
  if(lane==='L'){setBastardLoopXSourceMode('sample',{silent:true,skipSave:true});setBastardLoopLSourceMode('synth',{silent:true,skipSave:true});}
  else {setBastardLoopLSourceMode('sample',{silent:true,skipSave:true});setBastardLoopXSourceMode('synth',{silent:true,skipSave:true});}
  await measure(lane+' synth grid',()=>lane==='L'?auditionBastardLoopLCurrentStepWithReady():auditionBastardLoopXCurrentStepWithReady());
 }
 const buffer=audioContext.createBuffer(1,audioContext.sampleRate,audioContext.sampleRate);for(let i=0;i<buffer.length;i++)buffer.getChannelData(0)[i]=.2*Math.sin(i*2*Math.PI*262/audioContext.sampleRate);
 qSourceSampleBuffer=buffer;await mygrainQ.setSoundSource('sample');mygrainQ.state.level=.5;mygrainQ.state.sequence[0]={notes:[60,64,67],root:60,type:'major',velocity:100};mygrainQ.state.arpEnabled=false;mygrainQ.sync();
 await measure('Q grid',()=>document.querySelector('#bastardLoopQStepGrid [data-q-step="0"]').click());
 analyser.disconnect();return out;
},width);
for(const result of results){if(result.name.includes('cancel'))assert(result.peak<.0001,JSON.stringify(result));else assert(result.peak>.001,JSON.stringify(result));}
console.log('PASS',engine,width,JSON.stringify(results));
}
assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
