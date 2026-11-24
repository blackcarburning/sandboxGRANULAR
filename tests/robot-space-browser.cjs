'use strict';
const {chromium,webkit}=require('playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.BASE||'http://127.0.0.1:19037/mygrain/',out=process.env.MYGRAIN_ROBOT_TEST_OUTPUT||'/tmp';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{for(const [kind,B] of Object.entries({chromium,webkit})){
const browser=await B.launch(kind==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
try{const c=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(60000);
assert((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-robot-fixture'}})).ok());await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
const pcm=await p.evaluate(async()=>{
 const sr=24000,bank=new AudioBuffer({length:sr,sampleRate:sr,numberOfChannels:1});bank.getChannelData(0).fill(.001);
 const pattern=Array(16).fill(4),state={enabled:true,level:1,loopBars:1,phrases:[{id:'bleed',text:'long word',voice:'male1',speed:210,enabled:true,lanes:Array.from({length:16},(_,i)=>({word:'word'+i,offset:0,duration:1,pattern}))}]};
 async function render(s,fx){const ctx=new OfflineAudioContext(2,sr*2,sr);await MygrainRobot.prepare(ctx);let dest=ctx.destination;if(fx)dest=MygrainLoopFx.createGraph(ctx,dest,fx,300,0,0).input;MygrainRobot.createGraph(ctx,dest,s,bank,{time:0,origin:0,bpm:300,cycleSteps:16});return(await ctx.startRendering()).getChannelData(0);}
 const a=await render(state),loud=await render({...state,maximiser:100});let peak=0;for(const v of loud){if(!Number.isFinite(v))throw Error('Nonfinite maximiser');peak=Math.max(peak,Math.abs(v));}
 // At 0.30s, 25 ratchet instants × 16 full tails are alive: the old 128 cap produced .128.
 const bleed=a[Math.round(.301*sr)];if(bleed<.39)throw Error('A previous word was choked: '+bleed);
 const pulse={...state,phrases:[{...state.phrases[0],lanes:[{word:'pulse',offset:0,duration:.01,pattern:[1,...Array(15).fill(0)]}]}]};
 const dry=await render(pulse),delay=await render(pulse,MygrainLoopFx.channel({filterEnabled:false,reverbEnabled:false,delayEnabled:true,delay:1,delayBeats:1,feedback:0})),hall=await render(pulse,MygrainLoopFx.channel({filterEnabled:false,reverbEnabled:true,room:1,reverbPredelay:20,reverbDecay:1,delayEnabled:false}));
 const energy=(x,from,to)=>x.slice(Math.round(from*sr),Math.round(to*sr)).reduce((n,v)=>n+v*v,0);
 return {bleed,peak,boost:loud[100]/a[100],dryTail:energy(dry,.03,.18),delayTail:energy(delay,.19,.23),hallTail:energy(hall,.03,.18)};
});assert(pcm.bleed>.39);assert(pcm.peak<=Math.pow(10,-1/20)+1e-6);assert(pcm.boost>1);assert.equal(pcm.dryTail,0);assert(pcm.delayTail>0);assert(pcm.hallTail>0);
await p.evaluate(()=>{const el=document.getElementById('waspCard');mygrainDisplay.reveal(el);el.scrollIntoView({block:'center',behavior:'instant'});});await p.waitForSelector('[data-wasp="source"] option[value="Robot"]',{state:'attached'});
const lifecycle=await p.evaluate(async()=>{
 stopAllPerformancePlayback({silent:true});for(const x of SPARSE_RANDOM_LAYER_DEFINITIONS)x.setEnabled(false,{silent:true,skipSave:true});setDrumMachineEnabled(false,{silent:true,skipSave:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});
 const bank=audioContext.createBuffer(1,audioContext.sampleRate,audioContext.sampleRate);for(let i=0;i<bank.length;i++)bank.getChannelData(0)[i]=.03*Math.sin(2*Math.PI*440*i/bank.sampleRate);
 mygrainRobot.restore({enabled:true,level:.7,loopBars:1,maximiser:42,phrases:[{id:'loop',text:'robot',voice:'male1',speed:210,enabled:true,lanes:[{word:'robot',offset:0,duration:1,pattern:[1,...Array(15).fill(0)]}]}]});mygrainRobot.setBuffer(bank);
 // Robot-only normal transport admission used to reject this armed source.
 mygrainEmber.set({enabled:false});mygrainEnemyDrone.set({enabled:false});mygrainRestructure.set({enabled:false});const robotOnly=setBastardLoopPlaying(true,{silent:true,skipSave:true});if(!robotOnly||!mygrainRobot.running)throw Error('Robot-only loop start rejected');stopAllPerformancePlayback({silent:true});
 mygrainEmber.set({enabled:true});mygrainEnemyDrone.set({enabled:true});mygrainRestructure.set({enabled:true});stopAllPerformancePlayback({silent:true});
 const entries=[mygrainRobot,mygrainEnemyDrone,mygrainRestructure,mygrainEmber],calls=[];
 const originals=entries.map((owner,i)=>{const original=owner.start;owner.start=function(at,...rest){calls.push({i,at});return original.call(this,at,...rest)};return original});
 let running,sequencerCalls;
 try{startAllBastardLoopLayers();running=entries.map(x=>x.running);stopAllPerformancePlayback({silent:true});const count=calls.length;startSequencer(null,{force:true});sequencerCalls=calls.splice(count);if(!entries.every(x=>x.running))throw Error('An armed source missed sequencer start');}finally{entries.forEach((x,i)=>x.start=originals[i]);}
 const groups=[...mygrainCharacterFx.groups].filter(g=>g.key==='Robot').length;stopAllPerformancePlayback({silent:true});
 const api=mygrainLoopFx,fx=api.settings();fx.channels.Robot=MygrainLoopFx.channel({filterEnabled:true,cutoff:900,room:.25,delay:.2});api.restore(fx);
 const s=JSON.stringify(mygrainRobot.settings()),effects=JSON.stringify(api.channel('Robot')),zip=await mygrainSongBetaAdapter.capture(),part=await mygrainSongBetaAdapter.decode(await zip.arrayBuffer(),{buffers:new Map(),bytes:0});mygrainRobot.restore();api.restore(null);mygrainSongBetaAdapter.recall(part,{start:false});await mygrainSongBetaAdapter.whenPersisted();
 const round=s===JSON.stringify(mygrainRobot.settings())&&effects===JSON.stringify(api.channel('Robot'));
 mygrainDisplay.reveal(document.getElementById('robotCard'));document.getElementById('robotCard').scrollIntoView();
 const row=document.getElementById('robotLayerRow'),firstEffect=row.parentNode.querySelector('.performance-layer-switch-row--effect');
 return{calls,sequencerCalls,running,groups,round,aboveEffects:!!(row.compareDocumentPosition(firstEffect)&Node.DOCUMENT_POSITION_FOLLOWING),pot:MygrainCookingPot.LEAVES.includes('Robot'),wasp:MygrainWasp.INPUTS.includes('Robot')&&MygrainWasp.KEYS.includes('Robot'),menu:!!document.querySelector('[data-wasp="source"] option[value="Robot"]')};
});assert(lifecycle.running.every(Boolean));assert.equal(lifecycle.calls.length,4);assert.equal(new Set(lifecycle.calls.map(x=>x.at)).size,1);assert(lifecycle.groups>0);assert.equal(lifecycle.sequencerCalls.length,4);assert.equal(new Set(lifecycle.sequencerCalls.map(x=>x.at)).size,1);assert(lifecycle.round&&lifecycle.aboveEffects&&lifecycle.pot&&lifecycle.wasp&&lifecycle.menu,JSON.stringify(lifecycle));
await p.waitForSelector('#robotCard [data-loop-fx="cutoff"]',{state:'attached'});await p.locator('#robotMaximiser').evaluate(el=>{el.value='65';el.dispatchEvent(new Event('input',{bubbles:true}));});await p.locator('#robotMaximiser').dispatchEvent('change');await p.waitForFunction(()=>mygrainRobot.settings().maximiser===65&&!mygrainCardHistory.busy);await p.evaluate(()=>mygrainCardHistory.undo());assert.equal(await p.evaluate(()=>mygrainRobot.settings().maximiser),42);
assert.deepEqual(errors,[]);const result={kind,pcm,lifecycle,undo:true,errors};fs.writeFileSync(out+'/'+kind+'-robot-space.json',JSON.stringify(result,null,2));console.log('PASS',JSON.stringify(result));await c.close();
}finally{await browser.close();}}})().catch(e=>{console.error(e);process.exitCode=1});
