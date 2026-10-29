'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'https://openclaw.blackcarburning.com/mygrain/',out=process.env.MYGRAIN_N_EVIDENCE||'/tmp/mygrain-filter-host';fs.mkdirSync(out,{recursive:true});
(async()=>{const results=[];for(const[engine,type]of Object.entries({chromium,webkit})){
const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
try{const c=await browser.newContext(),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(60000);await p.route('**/*',r=>{const req=r.request(),u=new URL(req.url());if(u.origin!==new URL(base).origin||!['GET','HEAD'].includes(req.method()))return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"n-space-fixture"}};'});if(u.pathname.includes('/api/'))return r.fulfill({json:{ok:true,authenticated:true,user:{username:'n-space-fixture'},files:[],songs:[],folders:[],samples:[],patches:[]}});return r.continue()});
await p.goto(base);await p.waitForFunction(()=>window.mygrainNoise&&window.mygrainLoopFx&&document.documentElement.dataset.mygrainStartup==='ready');await p.click('#start-btn');await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);

const result=await p.evaluate(()=>{
 stopAllPerformancePlayback({silent:true});stopModulationLoop();stopPerformanceMixerVuMeters();
 const s=mygrainLoopFx.settings();for(const k of ['L','X'])Object.assign(s.channels[k],{filterEnabled:true,filterSlope:12,cutoff:500,lfoDepth:.5,lfoWave:k==='L'?'ramp':'sawtooth',lfoBeats:.25,room:0,delay:0});mygrainLoopFx.restore(s);
 const buffer=audioContext.createBuffer(1,48000,48000);bastardLoopLSampleBuffer=buffer;bastardLoopXSampleBuffer=buffer;setBastardLoopLSourceMode('sample',{silent:true,skipSave:true});setBastardLoopXSourceMode('sample',{silent:true,skipSave:true});
 scheduleBastardLoopLSingleVoice({note:'C4'},audioContext.currentTime+.1,.1,null);scheduleBastardLoopXSingleVoice({note:'C4'},audioContext.currentTime+.1,.1,null);
 const groups=[...mygrainLoopFx.groups].filter(g=>['L','X'].includes(g.key)),calls=[];if(groups.length<2)throw Error('Missing L/X graphs');
 for(const g of groups){const original=g.graph.syncClock;g.graph.syncClock=function(...args){calls.push({key:g.key,args});return original(...args)}}
 const position=withBufferedTransportStart(null,deadline=>({deadline,L:resolveTransportLaneStart(deadline,'L',.125,16),X:resolveTransportLaneStart(deadline,'X',.125,16)}),{reset:true,startLeadSeconds:.3});
 const expected=position.L.origin;if(position.X.origin!==expected)throw Error('Lane origins differ');
 for(const g of groups){const c=calls.filter(c=>c.key===g.key).at(-1);if(!c||c.args[0]!==expected||c.args[1]!==sequencerBPM)throw Error('Clock hook '+JSON.stringify(c));if(Math.abs(g.graph.lfo.frequency.value-sequencerBPM/60/.25)>1e-6)throw Error('Wrong Hz');}
 const before=groups.map(g=>g.graph.lfo);for(const k of ['L','X']){s.channels[k].cutoff=900;s.channels[k].lfoDepth=.7}mygrainLoopFx.restore(s);if(groups.some((g,i)=>g.graph.lfo!==before[i]))throw Error('Editing cutoff/depth reset phase');
 const snapshot=saveState({force:true,snapshotOnly:true});const preset=gatherPreset();const selected=snapshot.modes.loopFx.channels;for(const k of ['L','X'])if(selected[k].lfoWave!==s.channels[k].lfoWave||selected[k].lfoBeats!==.25)throw Error('State changed LFO selection');
 return{origin:expected,calls,unchangedOnEdit:true,presetSaved:!!preset.loopFx,frequencies:groups.map(g=>({key:g.key,hz:g.graph.lfo.frequency.value}))};
});assert(result.calls.some(c=>c.key==='L'));assert(result.calls.some(c=>c.key==='X'));assert.deepEqual(errors,[]);fs.writeFileSync(out+'/'+engine+'-host-clock.json',JSON.stringify(result,null,2));console.log('PASS L/X host transport hooks',engine,JSON.stringify(result));await c.close();}finally{await browser.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
