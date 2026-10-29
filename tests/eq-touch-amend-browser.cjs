'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:18929/mygrain/';
(async()=>{for(const [engine,type] of Object.entries({chromium,webkit})){
const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
try{
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-edit-fixture'}})).status(),200);
const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
await p.goto(base);await p.waitForFunction(()=>window.mygrainChannelEqUi&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
await p.evaluate(async()=>{stopAllPerformancePlayback({silent:true});await mygrainQ.prepareCapture();document.getElementById('songBetaName').value='EQ touch amendment';await mygrainSongBeta.newSong();await mygrainSongBeta.newPart({name:'L EQ'});await mygrainSongBeta.amendPart(mygrainSongBeta.song.parts[0]);mygrainChannelEqUi.open('L');});
const drag=async(index,dx=14)=>{const b=await p.locator(`[data-eq-handle="${index}"]`).boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2;await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+dx,y-10,{steps:4});await p.mouse.up();await p.waitForFunction(()=>!mygrainCardHistory.busy);};
await drag(1);
// An actual source-load guard can reject synchronously after pointer capture.
await p.evaluate(()=>{bastardLoopGenerationInFlight=true;});
await drag(2);
await p.evaluate(()=>{bastardLoopGenerationInFlight=false;});
const before=await p.evaluate(()=>mygrainChannelEq.get('L').bands[2].frequency);
await drag(2);
assert.notEqual(await p.evaluate(()=>mygrainChannelEq.get('L').bands[2].frequency),before,'A rejected edit must not freeze all subsequent handles');
for(let pass=0;pass<2;pass++){
if(pass)await p.evaluate(()=>{bastardLoopLSampleBuffer=audioContext.createBuffer(1,48000,48000);bastardLoopLSampleBuffer.getChannelData(0).fill(.01);setBastardLoopLEnabled(true,{silent:true,skipSave:true});setBastardLoopLLevelPercent(50,{skipSave:true});if(!startBastardLoopL())throw Error('L playback did not start');});
for(let i=0;i<4;i++)await drag(i,pass? -10:10);
}
await p.evaluate(()=>stopAllPerformancePlayback({silent:true}));
// Rejected Q-slider gestures must release the same shared gesture lock.
await p.evaluate(()=>{bastardLoopGenerationInFlight=true;const q=document.querySelector('[data-eq-q-slider="0"]');q.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:91}));q.value='700';q.dispatchEvent(new Event('input',{bubbles:true}));q.dispatchEvent(new Event('change',{bubbles:true}));bastardLoopGenerationInFlight=false;});
await p.waitForTimeout(50);await drag(0);
// A cancelled touch restores settings and permits the next handle gesture.
const cancelled=await p.evaluate(()=>mygrainChannelEq.get('L'));
const h=await p.locator('[data-eq-handle="1"]').boundingBox();await p.mouse.move(h.x+h.width/2,h.y+h.height/2);await p.mouse.down();await p.mouse.move(h.x+24,h.y-10);await p.evaluate(()=>document.querySelector('[data-eq-handle="1"]').dispatchEvent(new PointerEvent('lostpointercapture')));await p.mouse.up();await p.waitForFunction(()=>!mygrainCardHistory.busy);assert.deepEqual(await p.evaluate(()=>mygrainChannelEq.get('L')),cancelled);await drag(1);
// Chromium supports real native touch moves through CDP; WebKit exercises pointer lifecycle below.
if(engine==='chromium'){const cdp=await context.newCDPSession(p);for(let i=0;i<4;i++){const b=await p.locator(`[data-eq-handle="${i}"]`).boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2;const before=await p.evaluate(i=>mygrainChannelEq.get('L').bands[i].frequency,i);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+12,y:y+8}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForFunction(()=>!mygrainCardHistory.busy);assert.notEqual(await p.evaluate(i=>mygrainChannelEq.get('L').bands[i].frequency,i),before);}}
const expected=await p.evaluate(()=>mygrainChannelEq.get('L'));
await p.evaluate(async()=>{mygrainChannelEqUi.close();await mygrainSongBeta.savePart();await mygrainSongBeta.amendPart(mygrainSongBeta.song.parts[0]);});
assert.deepEqual(await p.evaluate(()=>mygrainChannelEq.get('L')),expected);
await p.evaluate(()=>mygrainSongBeta.cancelAmendment());assert.deepEqual(errors,[]);console.log('PASS',engine,'repeated L EQ, rejected drag recovery, Amend save/recall');
}finally{await browser.close();}}
})().catch(e=>{console.error(e);process.exitCode=1});
