// Read-only live smoke: mocked identity/API, all server writes blocked.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18949/mygrain/',out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp/q-editor-loop-browser';fs.mkdirSync(out,{recursive:true});
(async()=>{const results=[];for(const[engine,type]of Object.entries({chromium,webkit})){
const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
try{const ctx=await browser.newContext({viewport:process.env.MYGRAIN_SOURCE_DESKTOP?{width:1280,height:900}:{width:390,height:844},isMobile:!process.env.MYGRAIN_SOURCE_DESKTOP,hasTouch:!process.env.MYGRAIN_SOURCE_DESKTOP}),page=await ctx.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(45000);
await page.route('**/*',r=>{const req=r.request(),u=new URL(req.url()),identity={ok:true,authenticated:true,user:{username:'q-quick-readonly-live'}};if(u.origin!==new URL(base).origin)return r.abort();if(!['GET','HEAD'].includes(req.method())){writes.push(req.method()+' '+u.pathname);return r.abort()}if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext='+JSON.stringify(identity)});if(u.pathname.includes('/api/'))return r.fulfill({json:{...identity,files:[],songs:[],folders:[],stations:[],samples:[],favourites:[],patches:[]}});return r.continue()});
await page.goto(base);await page.waitForFunction(()=>window.mygrainQSoundSources&&window.mygrainQCustomChords&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});mygrainQ.open();const q=mygrainQ;q.state.sequence.fill(null);for(const[i,n]of[[4,60],[6,65]])q.state.sequence[i]=MygrainQTheory.normalizeStep({notes:[n,n+4,n+7]});q.state.record=false;q.changed({reschedule:false});q.resetEditorHistory();const b=audioContext.createBuffer(1,audioContext.sampleRate,audioContext.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=.1*Math.sin(2*Math.PI*261.63*i/b.sampleRate);drumMachineKickBuffer=b;drumMachineKickPattern=Array.from({length:16},(_,i)=>i===0);q.piano.ensure=async()=>{};q.piano.source=p=>({sample:{midi:p},buffer:b,offset:0,duration:1,loopStart:.1,loopEnd:.9});});

await page.evaluate(()=>{mygrainQ.playbackSolo=true;mygrainQ.clearSequenceLoop(false);mygrainQ.state.sampleLength=1;mygrainQ.state.sampleDecay=1;mygrainQ.state.level=.5;mygrainQ.state.sequence.fill(null);mygrainQ.state.sequence[0]=MygrainQTheory.normalizeStep({notes:[60,64,67],gate:2});const b=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate);for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=.15*Math.sin(2*Math.PI*261.63*i/b.sampleRate);qSourceSampleBuffer=b;grainASampleBuffer=b;document.getElementById('grainSynthASource').value='sample';setGranularLayersEnabled(true,{silent:true,skipSave:true});mygrainQ.changed({reschedule:false});});
await page.evaluate(()=>mygrainQ.close());
await page.evaluate(()=>setOscillatorsEnabled(false,{silent:true,skipSave:true}));
for(const kind of ['osc','grain','sample']){
 await page.locator('#bastardLoopQCard [data-q-sound="'+kind+'"]').click();await page.waitForFunction(kind=>mygrainQ.state.soundSource===kind,kind);
 if(kind==='osc')assert.equal(await page.evaluate(()=>oscillatorsEnabled),false,'Q OSC must not enable the independent backing oscillator layer');
 const r=await page.evaluate(async()=>{const q=mygrainQ;await q.prepareSounds([]);const graph=q.ensureGraph(),a=audioContext.createAnalyser();a.fftSize=2048;graph.input.connect(a);await q.audition(q.state.sequence[0]);let peak=0;for(let n=0;n<25;n++){await new Promise(r=>setTimeout(r,20));const d=new Float32Array(a.fftSize);a.getFloatTimeDomainData(d);peak=Math.max(peak,Math.sqrt(d.reduce((t,x)=>t+x*x,0)/d.length));}q.stopPreview();graph.input.disconnect(a);a.disconnect();return{peak,source:q.state.soundSource,osc:[...activeOscVoices.values()].filter(v=>v.role.startsWith('q:')).length,grains:[...activeGrains.values()].filter(v=>v.role.startsWith('q:')).length,status:document.querySelector('#bastardLoopQStatus').textContent}});assert(r.peak>.0001,JSON.stringify({kind,...r}));assert.equal(r.osc,0);assert.equal(r.grains,0);results.push({engine,kind,...r});
}
// Repeated live source changes, synth-control retrigger and Stop/Start must not leak OSC.
const switching=await page.evaluate(async()=>{
 const q=mygrainQ,wait=ms=>new Promise(r=>setTimeout(r,ms)),rows=[];
 q.state.sequence.fill(null);q.state.sequence[0]=MygrainQTheory.normalizeStep({notes:[60,64,67],gate:16});q.changed({reschedule:false});
 for(let cycle=0;cycle<2;cycle++){
  await q.setSoundSource('osc');q.start(audioContext.currentTime+.04);await wait(180);
  const count=()=>[...activeOscVoices.values()].filter(v=>v.role.startsWith('q:')).length;
  if(!count())throw Error('Q OSC did not start with backing OSC disabled');
  retriggerActiveOscillatorVoices();await wait(80);
  if([...activeOscVoices.values()].filter(v=>v.role.startsWith('q:')).some(v=>!v.destination))throw Error('Synth edit lost Q destination');
  await q.setSoundSource('sample');await wait(180);
  if(count()||oscillatorsEnabled||!q.running)throw Error('Source switch leaked OSC or stopped Q');
  q.stop();q.start(audioContext.currentTime+.04);await wait(180);
  if(count()||oscillatorsEnabled||!q.running)throw Error('Sample restart revived OSC');
  rows.push({cycle,osc:count(),backingEnabled:oscillatorsEnabled,running:q.running});q.stop();
 }
 delete q.piano.ensure;delete q.piano.source;
 for(const kind of ['osc','piano','strings','grain','piano','strings']){
  if(kind==='osc'){await q.setSoundSource(kind);q.start(audioContext.currentTime+.04)}else await q.setSoundSource(kind);
  await wait(180);
  if(!q.running)throw Error(kind+' source switch left Q stopped');
  if(!q.voices.size)throw Error(kind+' source switch is silent: '+document.querySelector('#bastardLoopQStatus').textContent);
  if(q.state.soundSource!==kind)throw Error(kind+' source switch did not select source');
  if(['piano','strings'].includes(kind)&&audioContext.currentTime-q.origin>.5)throw Error(kind+' resumed an expired loop origin');
  rows.push({kind,running:q.running,voices:q.voices.size,origin:q.origin});
 }
 q.stop();
 return rows;
});results.push({engine,switching});
for(const kind of ['osc','grain']){
 const colours=await page.locator('#bastardLoopQCard').evaluate((card,kind)=>{
  const source=card.querySelector('[data-q-sound="'+kind+'"]'),jump=card.querySelector('[data-q-source-jump="'+kind+'"]');
  return [getComputedStyle(source).backgroundColor,getComputedStyle(jump).backgroundColor];
 },kind);assert.notEqual(colours[0],colours[1]);
 await page.evaluate(kind=>{mygrainQ.open();mygrainQ.setMobilePanel('right');window.__qJumpSeen=false;document.getElementById(kind==='osc'?'performanceKeyboardSynthJumpBtn':'performanceKeyboardGrainJumpBtn').addEventListener('click',()=>window.__qJumpSeen=true,{once:true})},kind);
 await page.locator('#qMobileRightPanel [data-q-source-jump="'+kind+'"]').click();
 assert.equal(await page.evaluate(()=>window.__qJumpSeen&&document.getElementById('bastardLoopQOverlay').hidden),true);
}
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);fs.writeFileSync(out+'/sources-results.json',JSON.stringify(results,null,2));console.log('PASS',engine,results);await ctx.close();}finally{await browser.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
