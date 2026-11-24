'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19047/mygrain/';assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{const results=[];for(const engine of['chromium','webkit']){const b=await({chromium,webkit}[engine]).launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});try{const c=await b.newContext({viewport:{width:390,height:740},hasTouch:true,isMobile:true});assert((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).ok());const p=await c.newPage();await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);await p.evaluate(()=>openDrumMachineOverlay());
 const result=await p.evaluate(async()=>{
  MygrainDrumPan.restore({version:1,lanes:{hat:.6,kick:-.4,roll:.9,snare:-.9},hatSteps:[-1,null,0,1]});const pan=MygrainDrumPan.capture();
  await mygrainSequencerSnapshots.save('drums','Pan regression');const id=mygrainSequencerSnapshots.settings().cards.drums.at(-1).id;
  MygrainDrumPan.restore();await mygrainSequencerSnapshots.recall('drums',id);
  if(JSON.stringify(MygrainDrumPan.capture())!==JSON.stringify(pan))throw Error('Drum snapshot lost panning');
  MygrainDrumPan.setHat(0,-.7);MygrainDrumPan.setHat(1,null);
  drumMachineSectionCopies.set('hat',{mode:'start'});handleDrumMachineSectionCopy('hat',0);handleDrumMachineSectionCopy('hat',1);handleDrumMachineSectionCopy('hat',4);
  if(MygrainDrumPan.value('hat',4)!==-.7||MygrainDrumPan.capture().drumPan.hatSteps[5]!==null)throw Error('Copy Sec lost pan/inheritance');
  const raw=audioContext.createBuffer(1,2000,48000);raw.getChannelData(0).fill(.02);const lanes=['kick','snare','hat','perc','clap','cymbals','etc','roll'];
  for(const lane of lanes){MygrainDrumPan.setLane(lane,.4);const old=new Set(drumMachineActiveVoices);if(!playDrumMachineHit(raw,audioContext.currentTime+.05,1,{eqChannel:lane}))throw Error('No '+lane+' voice');const voice=[...drumMachineActiveVoices].find(v=>!old.has(v));if(!voice.cleanupNodes.some(n=>n.pan?.value===Math.fround(.4)))throw Error('No native panner for '+lane);}
  const hat=drumMachineHatBuffer;drumMachineHatBuffer=null;MygrainDrumPan.setLane('hat',-.4);const old=new Set(drumMachineActiveVoices);playDrumMachineHatHit(audioContext.currentTime+.05);const voice=[...drumMachineActiveVoices].find(v=>!old.has(v));if(!voice?.cleanupNodes.some(n=>n.pan?.value===Math.fround(-.4)))throw Error('Synth hat pan omitted');drumMachineHatBuffer=hat;stopDrumMachineVoices();
  MygrainDrumPan.restore(pan.drumPan);saveState({force:true});return{snapshots:true,copySection:true,nativeLaneRoutes:8,synthHat:true};
 });
 if(engine==='chromium'){
  const button=p.locator('#drumMachineHatGrid .drum-machine-accent-btn').first();await button.evaluate(e=>e.scrollIntoView({block:'center'}));const box=await button.boundingBox(),cdp=await c.newCDPSession(p),x=box.x+box.width/2,y=box.y+box.height/2,before=await p.evaluate(()=>MygrainDrumPan.capture());
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=4;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+5*i,y}]});await p.waitForTimeout(30);}await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await p.waitForFunction(()=>!mygrainCardHistory.busy);assert.deepEqual(await p.evaluate(()=>MygrainDrumPan.capture()),before);
  result.cancelledGesturePreservedState=true;
 }
 results.push({engine,...result});console.log('PASS',engine,JSON.stringify(result));await c.close();}finally{await b.close()}}
 const out=process.env.DRUM_PAN_EVIDENCE||'/tmp/drum-pan-evidence';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/state-results.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
