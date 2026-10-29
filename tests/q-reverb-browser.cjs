// Read-only live smoke: mocked identity/API, all server writes blocked.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18949/mygrain/',out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp/q-editor-loop-browser';fs.mkdirSync(out,{recursive:true});
(async()=>{const results=[];for(const[engine,type]of Object.entries({chromium,webkit})){
const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
try{const ctx=await browser.newContext({viewport:process.env.MYGRAIN_SOURCE_DESKTOP?{width:1280,height:900}:{width:390,height:844},isMobile:!process.env.MYGRAIN_SOURCE_DESKTOP,hasTouch:!process.env.MYGRAIN_SOURCE_DESKTOP}),page=await ctx.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(45000);
await page.route('**/*',r=>{const req=r.request(),u=new URL(req.url()),identity={ok:true,authenticated:true,user:{username:'q-quick-readonly-live'}};if(u.origin!==new URL(base).origin)return r.abort();if(!['GET','HEAD'].includes(req.method())){writes.push(req.method()+' '+u.pathname);return r.abort()}if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext='+JSON.stringify(identity)});if(u.pathname.includes('/api/'))return r.fulfill({json:{...identity,files:[],songs:[],folders:[],stations:[],samples:[],favourites:[],patches:[]}});return r.continue()});
await page.goto(base);await page.waitForFunction(()=>window.mygrainQSoundSources&&window.mygrainQCustomChords&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});mygrainQ.open();const q=mygrainQ;q.state.sequence.fill(null);for(const[i,n]of[[4,60],[6,65]])q.state.sequence[i]=MygrainQTheory.normalizeStep({notes:[n,n+4,n+7]});q.state.record=false;q.changed({reschedule:false});q.resetEditorHistory();const b=audioContext.createBuffer(1,audioContext.sampleRate,audioContext.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=.1*Math.sin(2*Math.PI*261.63*i/b.sampleRate);drumMachineKickBuffer=b;drumMachineKickPattern=Array.from({length:16},(_,i)=>i===0);q.piano.ensure=async()=>{};q.piano.source=p=>({sample:{midi:p},buffer:b,offset:0,duration:1,loopStart:.1,loopEnd:.9});});


await page.evaluate(()=>mygrainQ.close());
await page.locator('[data-q-action="reverb-strings"]').click();
assert.equal(await page.evaluate(()=>mygrainQ.state.reverbDecay),6.5);
await page.locator('#qReverbPredelay').fill('80');
assert.equal(await page.evaluate(()=>mygrainQ.state.reverbPredelay),80);
await page.waitForTimeout(300);
const audio=await page.evaluate(async()=>{
 const render=async(decay,width,predelay=0)=>{
  const c=new OfflineAudioContext(2,48000*8,48000);
  const q=new MygrainQ.Controller({context:()=>c,destination:()=>c.destination,bpm:()=>120,soloGain:()=>1});
  Object.assign(q.state,{room:1,reverbDecay:decay,reverbSize:.9,reverbWidth:width,reverbPredelay:predelay,level:1,enabled:true});
  const g=q.ensureGraph();g.dry.gain.value=0;g.delayWet.gain.cancelScheduledValues(0);g.delayWet.gain.value=0;
  const b=c.createBuffer(1,480,48000);for(let i=0;i<480;i++)b.getChannelData(0)[i]=Math.sin(2*Math.PI*440*i/48000)*.5;
  const source=c.createBufferSource();source.buffer=b;source.connect(g.input);source.start(.25);
  const out=await c.startRendering();const l=out.getChannelData(0),r=out.getChannelData(1);
  const energy=(a,start,end)=>{let e=0;for(let i=Math.floor(start*48000);i<Math.floor(end*48000);i++)e+=a[i]*a[i];return e;};
  let diff=0,peak=0;for(let i=0;i<l.length;i++){if(!Number.isFinite(l[i])||!Number.isFinite(r[i]))throw Error('nonfinite audio');diff+=(l[i]-r[i])**2;peak=Math.max(peak,Math.abs(l[i]),Math.abs(r[i]));}
  return {early:energy(l,.25,.4),late:energy(l,2,4),end:energy(l,7,8),diff,peak};
 };
 const short=await render(1,1),long=await render(6.5,1),mono=await render(6.5,0),delayed=await render(6.5,1,200);
 return {short,long,mono,delayed};
});
assert(audio.long.late>audio.short.late*100,JSON.stringify(audio));
assert(audio.long.diff>.001,JSON.stringify(audio));assert(audio.mono.diff<1e-10,JSON.stringify(audio));
assert(audio.delayed.early<1e-10,JSON.stringify(audio));assert(audio.long.peak<1,JSON.stringify(audio));
const saved=await page.evaluate(()=>{const state=mygrainQ.getState();return MygrainQTheory.normalizeState(JSON.parse(JSON.stringify(state)))});assert.equal(saved.reverbDecay,6.5);assert.equal(saved.reverbPredelay,80);
const controls=await page.evaluate(()=>{const q=mygrainQ;const g=q.ensureGraph();q.updateEffects();return {lowcut:g.reverbLowcut.frequency.value,damping:g.reverbDamping.frequency.value,banks:g.reverbBanks.length,dry:g.dry.gain.value}});
assert.equal(controls.banks,2);assert.equal(controls.dry,1);
await page.locator('[data-q-action="reverb-off"]').click();assert.equal(await page.evaluate(()=>mygrainQ.state.room),0);
await page.locator('[data-q-action="reverb-cathedral"]').click();assert.equal(await page.evaluate(()=>mygrainQ.state.reverbDecay),10);
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
console.log('PASS',engine,JSON.stringify(audio));await page.locator('.q-reverb-panel').screenshot({path:out+'/'+engine+'-reverb.png'});await ctx.close();}finally{await browser.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
