'use strict';
const assert=require('node:assert/strict');
const {webkit,chromium}=require('playwright-core');
(async()=>{for(const [engine,type] of Object.entries({webkit,chromium})){const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});try{const c=await b.newContext({viewport:{width:process.env.MYGRAIN_NOTE_DESKTOP?1440:390,height:process.env.MYGRAIN_NOTE_DESKTOP?1000:844},hasTouch:!process.env.MYGRAIN_NOTE_DESKTOP,isMobile:!process.env.MYGRAIN_NOTE_DESKTOP,...(process.env.MYGRAIN_NOTE_DESKTOP?{}:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'})});const p=await c.newPage();p.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text())});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='https://openclaw.blackcarburning.com')return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"wasp-fixture"}};'});if(u.pathname.includes('/api/'))return r.fulfill({json:{ok:true,authenticated:true,user:{username:'wasp-fixture'},files:[],songs:[],folders:[],samples:[],patches:[]}});if(!['GET','HEAD'].includes(r.request().method()))return r.abort();return r.continue()});if(process.env.MYGRAIN_RESONANCE_BASELINE)await p.route('**/loop-card-fx.js?*',r=>r.fulfill({contentType:'text/javascript',body:require('node:fs').readFileSync(require('node:path').join(__dirname,'../backups/card-resonance-20261026/loop-card-fx.js'))}));await p.goto('https://openclaw.blackcarburning.com/mygrain/');console.log('boot',engine);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting);


await p.waitForFunction(()=>getComputedStyle(document.getElementById('start-overlay')).display==='none');
await p.waitForFunction(()=>!stateSaveSuspended&&!mygrainCardHistory.busy);await p.waitForTimeout(1000);console.log('audio ready',engine);

await p.evaluate(()=>{for(const card of document.querySelectorAll('.performance-feature-card, #bastardLoopQCard, #noiseCard'))mygrainDemand.run(card);for(const id of ['bastardLoopCard','bastardLoop2Card','bastardLoop3Card','bastardLoopVCard','bastardLoopWCard','bastardLoopPCard','bastardLoopOCard','bastardLoopLCard','bastardLoopXCard','bastardLoopMCard','bastardLoopMPlusCard','bastardLoopKCard','bastardLoopQCard'])mygrainDemand.run(document.getElementById(id));});await p.waitForFunction(()=>document.querySelectorAll('.loop-fx').length===14);
 console.log('panels ready',engine);const routing=await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});stopModulationLoop();stopPerformanceMixerVuMeters();mygrainXDebug.setEnabled(false);loopLayerSolo=[];
  const buffer=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate),d=buffer.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=.03*Math.sin(2*Math.PI*110*i/buffer.sampleRate);
  const suffixes=['','2','3','V','W','P','O','M','MPlus'];for(const s of suffixes){eval(`bastardLoop${s}Buffer=buffer;bastardLoop${s}Enabled=true;bastardLoop${s}Level=.35`);window[`startBastardLoop${s}`](audioContext.currentTime+.2,{skipUi:true})}
  setBastardLoopLSourceMode('sample',{silent:true,skipSave:true});setBastardLoopXSourceMode('sample',{silent:true,skipSave:true});bastardLoopLSampleBuffer=buffer;bastardLoopXSampleBuffer=buffer;bastardLoopLEnabled=true;bastardLoopXEnabled=true;setBastardLoopLLevelPercent(40,{skipSave:true});setBastardLoopXLevelPercent(40,{skipSave:true});
  scheduleBastardLoopLSingleVoice({note:'C4',accent:true},audioContext.currentTime+.2,.2,null);scheduleBastardLoopXSingleVoice({note:'C4',accent:true},audioContext.currentTime+.2,.2,null);
  for(let i=0;i<5;i++){mygrainKMultitrack.setBuffer(i,buffer);mygrainKMultitrack.tracks[i].enabled=true}setBastardLoopKEnabled(true,{silent:true,skipSave:true});startBastardLoopK(audioContext.currentTime+.2);
  const q=mygrainQ;q.state.enabled=true;Object.assign(q.state,{soundSource:'piano'});q.piano.source=p=>({sample:{midi:p},buffer,offset:0,duration:1});q.voice(60,90,audioContext.currentTime+.2,.5);
  await new Promise(r=>setTimeout(r,600));const keys=[...mygrainLoopFx.groups].map(g=>g.key),native={M:getBastardLoopMDelayMix(),MRoom:getBastardLoopMRoomReverbMix(),L:getBastardLoopLReverbSettings().mix,X:!!bastardLoopXDelayNode};
  stopAllPerformancePlayback({silent:true});const qGraph=q.ensureGraph(),group=[...mygrainLoopFx.groups].find(g=>g.key==='Q');q.voice(60,90,audioContext.currentTime+.05,.3);return{keys,native,qConnected:group.sources.has(qGraph.pan),count:mygrainLoopFx.groups.size};
 });for(const key of ['A','B','C','V','W','P','O','L','X','M','M+','K1','K2','K3','K4','K5','Q'])assert(routing.keys.includes(key),key+' routing '+JSON.stringify(routing));assert.equal(routing.native.M,0);assert.equal(routing.native.MRoom,0);assert.equal(routing.native.L,0);assert.equal(routing.qConnected,true);

console.log('routing ready',engine);const resonance=await p.evaluate(async()=>{
 const checks=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
 for(const key of MygrainLoopFx.KEYS.filter(k=>k!=='N')){
  if(key.startsWith('K')){mygrainKMultitrack.select(Number(key.slice(1))-1);}
  const panel=document.querySelector('[data-loop-fx-key="'+(key.startsWith('K')?'K':key)+'"]');
  if(!panel)throw Error('Missing panel '+key);
  function set(field,value){const e=panel.querySelector('[data-loop-fx="'+field+'"]');if(e.type==='checkbox')e.checked=value;else e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));}
  const groups=[...mygrainLoopFx.groups].filter(g=>g.key===key);if(!groups.length)throw Error('Missing playback graph '+key);
  const probe=audioContext.createOscillator(),volume=audioContext.createGain();volume.gain.value=.001;probe.connect(volume).connect(groups[0].graph.input);probe.start();set('filterEnabled',true);set('cutoff',1000);set('filterSlope',48);set('lfoDepth',0);
  const f=new Float32Array([1000]),m=new Float32Array(1),phase=new Float32Array(1);
  function db(){let value=0;for(const filter of groups[0].graph.filters){filter.getFrequencyResponse(f,m,phase);value+=20*Math.log10(m[0]);}return value;}
  set('resonance',.1);await wait(180);const low=db();set('resonance',4);await wait(180);const high=db();
  probe.stop();probe.disconnect();volume.disconnect();checks.push({key,qs:groups[0].graph.filters.map(f=>({q:f.Q.value,hz:f.frequency.value})),stored:mygrainLoopFx.channel(key).resonance,nodes:groups[0].graph.filters.length,lowDb:low,highDb:high,deltaDb:high-low});
 }
 // Native rendered PCM verifies DSP, not just getFrequencyResponse/labels.
 const pcm=[];
 for(const type of ['lowpass','highpass'])for(const slope of MygrainLoopFx.SLOPES){
  const levels=[];
  for(const resonance of [.1,.707,4]){
   const sr=48000,c=new OfflineAudioContext(1,sr/2,sr),g=MygrainLoopFx.createGraph(c,c.destination,{filterType:type,filterSlope:slope,cutoff:1000,resonance,room:0,delay:0,lfoDepth:0},120),o=c.createOscillator();o.frequency.value=1000;const gain=c.createGain();gain.gain.value=.02;o.connect(gain).connect(g.input);o.start();const b=await c.startRendering(),a=b.getChannelData(0);let sum=0,peak=0;for(let i=sr/4;i<a.length;i++){if(!Number.isFinite(a[i]))throw Error('Nonfinite');sum+=a[i]*a[i];peak=Math.max(peak,Math.abs(a[i]));}levels.push({resonance,rms:Math.sqrt(sum/(a.length-sr/4)),peak});g.dispose();
  }
  pcm.push({type,slope,levels,deltaDb:20*Math.log10(levels[2].rms/levels[0].rms)});
 }
 const snapshot=saveState({force:true,snapshotOnly:true}),preset=gatherPreset();mygrainLoopFx.randomise();restoreState({state:snapshot,songSnapshot:true,throwOnError:true});
 return {checks,pcm,restored:JSON.stringify(snapshot.modes.loopFx)===JSON.stringify(mygrainLoopFx.settings()),preset:JSON.stringify(snapshot.modes.loopFx)===JSON.stringify(preset.loopFx)};
});
console.log('AUDIT DATA',engine,JSON.stringify(resonance));for(const c of resonance.checks){assert.equal(c.stored,4);assert.equal(c.nodes,4);if(!process.env.MYGRAIN_RESONANCE_BASELINE)assert(c.deltaDb>30,JSON.stringify(c));}
for(const c of resonance.pcm){if(!process.env.MYGRAIN_RESONANCE_BASELINE){assert(c.deltaDb>30,JSON.stringify(c));assert(c.levels[2].peak<.15,JSON.stringify(c));assert(Math.abs(20*Math.log10(c.levels[1].rms/(.02/Math.sqrt(2))))+0<3.1,JSON.stringify(c));}}
assert(resonance.restored);assert(resonance.preset);console.log('PASS resonance audit',engine,process.env.MYGRAIN_NOTE_DESKTOP?'desktop':'phone',JSON.stringify(resonance));
assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
