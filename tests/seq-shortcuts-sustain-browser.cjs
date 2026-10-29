'use strict';
const assert=require('node:assert/strict');
const {webkit,chromium}=require('playwright-core');
(async()=>{for(const [engine,type] of Object.entries({webkit,chromium})){const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});try{const c=await b.newContext({viewport:{width:process.env.MYGRAIN_NOTE_DESKTOP?1440:390,height:process.env.MYGRAIN_NOTE_DESKTOP?1000:844},hasTouch:!process.env.MYGRAIN_NOTE_DESKTOP,isMobile:!process.env.MYGRAIN_NOTE_DESKTOP,...(process.env.MYGRAIN_NOTE_DESKTOP?{}:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'})});const p=await c.newPage();p.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text())});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='https://openclaw.blackcarburning.com')return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"wasp-fixture"}};'});if(u.pathname.includes('/api/'))return r.fulfill({json:{ok:true,authenticated:true,user:{username:'wasp-fixture'},files:[],songs:[],folders:[],samples:[],patches:[]}});if(!['GET','HEAD'].includes(r.request().method()))return r.abort();return r.continue()});await p.goto('https://openclaw.blackcarburning.com/mygrain/');await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting);


await p.waitForFunction(()=>getComputedStyle(document.getElementById('start-overlay')).display==='none');
await p.waitForFunction(()=>!stateSaveSuspended&&!mygrainCardHistory.busy);await p.waitForTimeout(1000);

const shortcuts=await p.evaluate(async()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms));const checks=[];
 function key(letter,target=document.activeElement,extra={}){const e=new KeyboardEvent('keydown',{key:letter,bubbles:true,cancelable:true,...extra});target.dispatchEvent(e);return e.defaultPrevented;}
 function check(ok,label){if(!ok)throw Error(label);checks.push(label);}
 const desktop=desktopTransportMedia.matches;
 for(const layer of ['L','X']){
  if(layer==='L') {openBastardLoopLOverlay();setBastardLoopLStep(0,{note:'C4',accent:false,slide:false,rest:false},{skipSave:true});bastardLoopLRecordArmed=true;setBastardLoopLEditStepIndex(0);}
  else {openBastardLoopXOverlay();setBastardLoopXStep(0,{note:'C4',accent:false,slide:false,rest:false},{skipSave:true});bastardLoopXRecordArmed=true;setBastardLoopXEditStepIndex(0);}
  await wait(50);const button=document.querySelector('#bastardLoop'+layer+'StepGrid [data-step-index="0"]');button.focus();
  const get=()=>layer==='L'?getBastardLoopLStep(0):getBastardLoopXStep(0);
  key('a');check(get().accent===desktop,layer+' accent');key('s');check(get().slide===desktop,layer+' slide');
  key('a',button,{repeat:true});check(get().accent===desktop,layer+' repeat ignored');
  key('a',button,{ctrlKey:true});check(get().accent===desktop,layer+' ctrl ignored');
  const input=document.createElement('input');button.parentElement.append(input);key('a',input);input.remove();check(get().accent===desktop,layer+' typing ignored');
  key('r');check(get().rest===desktop,layer+' rest');
  if(layer==='L')closeBastardLoopLOverlay();else closeBastardLoopXOverlay();
 }
 openDrumMachineOverlay();await wait(50);
 for(const track of ['kick','snare','hat','perc',...Object.keys(drumMachineExtraTracks)]){
  const id=drumMachineExtraTracks[track]?.id||'drumMachine'+track[0].toUpperCase()+track.slice(1);
  const button=document.querySelector('#'+id+'Grid .drum-machine-step-btn');if(!button)continue;button.focus();
  getDrumMachineAccentPattern(track)[0]=false;const pattern=getDrumMachinePattern(track).slice();pattern[0]=true;setDrumMachinePattern(track,pattern);key('a');
  check(Boolean(getDrumMachineAccentPattern(track)[0])===desktop,track+' accent');key('r');check(getDrumMachinePattern(track)[0]===!desktop,track+' rest');
 }
 const originalHit=playDrumMachineHit,levels=[];
 try {
  playDrumMachineHit=(buffer,time,pitch,options)=>{levels.push(options.level);return true;};
  const fixture=audioContext.createBuffer(1,44100,44100);drumMachineKickBuffer=fixture;drumMachineSnareBuffer=fixture;drumMachinePercBuffer=fixture;
  for(const track of ['kick','snare','perc',...Object.keys(drumMachineExtraTracks)]){
   if(drumMachineExtraTracks[track])drumMachineExtraTracks[track].buffer=fixture;
   const pattern=getDrumMachinePattern(track).slice();pattern[0]=true;setDrumMachinePattern(track,pattern);
   getDrumMachineAccentPattern(track)[0]=false;levels.length=0;scheduleDrumMachineRepeats(track,0,audioContext.currentTime+.01,.2);const normal=levels[0];
   getDrumMachineAccentPattern(track)[0]=true;levels.length=0;scheduleDrumMachineRepeats(track,0,audioContext.currentTime+.01,.2);
   check(normal>0&&levels[0]>normal,track+' scheduled accent gain');
  }
 }finally{playDrumMachineHit=originalHit;}
 const snapshot=gatherPreset().drumMachineBaseAccents;restoreDrumMachineBaseAccents({});restoreDrumMachineBaseAccents(snapshot);check(JSON.stringify(drumMachineBaseAccents)===JSON.stringify(snapshot),'drum accent restore');
 buildDrumMachineMidiBlob();checks.push('drum MIDI export');closeDrumMachineOverlay();return checks;
});console.log('PASS shortcuts',engine,process.env.MYGRAIN_NOTE_DESKTOP?'desktop':'phone',shortcuts);
const audio=await p.evaluate(async()=>{
 stopAllPerformancePlayback({silent:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});setFinalReverbEnabled(false,{silent:true,skipSave:true});setGlobalMixDelayEnabled(false,{silent:true,skipSave:true});
 const fx=mygrainLoopFx.settings();for(const c of Object.values(fx.channels))Object.assign(c,{filterEnabled:false,delay:0,room:0});mygrainLoopFx.restore(fx);
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),analyser=audioContext.createAnalyser();analyser.fftSize=2048;splitterNode.connect(analyser,0);const a=new Float32Array(2048),out=[];
 const buffer=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate);for(let i=0;i<buffer.length;i++)buffer.getChannelData(0)[i]=.2*Math.sin(i*2*Math.PI*262/audioContext.sampleRate);
 for(const lane of ['L','X']){
  if(lane==='L'){setBastardLoopLSourceMode('sample',{silent:true,skipSave:true});bastardLoopLSampleBuffer=buffer;bastardLoopLSampleMetadata={rootNote:'C4'};setBastardLoopLStep(0,{note:'C4',rest:false},{skipSave:true});setBastardLoopLEditStepIndex(0);setBastardLoopLLevelPercent(50,{skipSave:true});openBastardLoopLOverlay();}
  else{setBastardLoopXSourceMode('sample',{silent:true,skipSave:true});bastardLoopXSampleBuffer=buffer;bastardLoopXSampleMetadata={rootNote:'C4'};setBastardLoopXStep(0,{note:'C4',rest:false},{skipSave:true});setBastardLoopXEditStepIndex(0);setBastardLoopXLevelPercent(50,{skipSave:true});openBastardLoopXOverlay();}
  for(const suffix of ['Decay','Length']){const el=document.getElementById('performanceBastardLoop'+lane+suffix);if(el)el.value='10';}
  await wait(50);document.querySelector('#bastardLoop'+lane+'StepGrid [data-step-index="0"]').click();
  await wait(600);let peak=0;for(let i=0;i<10;i++){await wait(25);analyser.getFloatTimeDomainData(a);for(const v of a)peak=Math.max(peak,Math.abs(v));}
  out.push({lane,latePeak:peak});stopAllPerformancePlayback({silent:true});if(lane==='L')closeBastardLoopLOverlay();else closeBastardLoopXOverlay();await wait(350);
 }
 analyser.disconnect();return out;
});for(const result of audio)assert(result.latePeak>.001,JSON.stringify(result));console.log('PASS sustained grid PCM',engine,audio);
assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
