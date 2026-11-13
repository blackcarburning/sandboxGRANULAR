'use strict';
const {chromium}=require('playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs'),{spawn}=require('node:child_process');
const base='http://127.0.0.1:19109/mygrain/',origin=new URL(base).origin,out=fs.readFileSync('/tmp/mygrain-vst3-easy-output','utf8').trim()+'/evidence';
(async()=>{
 const fixture=spawn('/tmp/mygrain-bridge-fixture',[origin,'65']);let log='';fixture.stdout.on('data',c=>log+=c);
 const code=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Fixture timeout')),4000);fixture.stdout.on('data',()=>{const m=log.match(/187\d{2}\.[a-f0-9]{32}/);if(m){clearTimeout(t);resolve(m[0]);}});});
 const browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=document-user-activation-required']});
 try{
  const c=await browser.newContext(),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
  // Headless Chromium permits autoplay even with restrictive policy switches.
  // Hold the real context's initial resume until a real gesture, modeling the
  // first-run Chrome restriction without replacing its audio engine.
  await p.addInitScript(()=>{let allowed=false;const Native=AudioContext;document.addEventListener('pointerdown',e=>{if(e.isTrusted)allowed=true;},true);window.AudioContext=new Proxy(Native,{construct(target,args){const ctx=new target(...args),resume=ctx.resume.bind(ctx),state=Object.getOwnPropertyDescriptor(BaseAudioContext.prototype,'state').get;ctx.suspend();Object.defineProperty(ctx,'state',{get:()=>allowed?state.call(ctx):'suspended'});ctx.resume=()=>allowed?resume():new Promise(resolve=>{const unlock=e=>{if(!e.isTrusted)return;document.removeEventListener('pointerdown',unlock,true);resume().then(resolve);};document.addEventListener('pointerdown',unlock,true);});return ctx;}});});
  await p.goto(base+'#daw='+code);try{await p.waitForFunction(()=>window.mygrainDawBridge?.connected&&typeof audioContext!=='undefined'&&audioContext?.state==='suspended',{},{timeout:12000});}catch(e){throw Error('Auto policy diagnostic: '+JSON.stringify(await p.evaluate(()=>({bridge:window.mygrainDawBridge?.diagnostics(),ctx:typeof audioContext!=='undefined'?audioContext?.state:null,starting:typeof engineStarting!=='undefined'?engineStarting:null,status:document.getElementById('dawBridgeStatus')?.textContent,startup:document.documentElement.dataset.mygrainStartup})))+' '+e.message);}
  assert.equal(new URL(p.url()).hash,'');assert.equal(await p.locator('#dawBridgeCode').inputValue(),'');
  // No Connect click. One real Start gesture unlocks a policy-blocked auto-start.
  await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy&&mygrainDawBridge.diagnostics().clock?.browserReady,{},{timeout:20000});
  const automatic=await p.evaluate(()=>({connected:mygrainDawBridge.connected,context:audioContext.state,ready:mygrainDawBridge.diagnostics().clock.browserReady}));
  const second=await c.newPage();await second.goto(base+'#daw='+code);await second.waitForFunction(()=>document.getElementById('dawBridgeStatus')?.textContent.includes('Another MYGRAIN tab'));assert.equal(await second.evaluate(()=>typeof audioContext==='undefined'||!audioContext),true);
  await p.locator('#dawBridgeDisconnect').click();await p.waitForFunction(()=>!mygrainDawBridge.connected);await p.close();
  // The refused tab keeps its manual code and can connect after the owner leaves.
  await second.locator('#start-btn').click();await second.locator('#dawBridgeCard').evaluate(el=>el.open=true);await second.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);assert.equal(await second.locator('#dawBridgeCode').inputValue(),code);await second.locator('#dawBridgeConnect').click();await second.waitForFunction(()=>mygrainDawBridge.connected&&mygrainDawBridge.diagnostics().clock?.browserReady);await second.locator('#dawBridgeDisconnect').click();
  assert.deepEqual(errors,[]);fs.writeFileSync(out+'/automatic-policy.json',JSON.stringify({automatic,firstResumeGestureGate:'test fixture using real AudioContext',requiredGestures:1,connectClicksForLaunch:0,duplicateTabBlockedBeforeAudio:true,manualReconnectAfterOwnerLeaves:true,errors},null,2));console.log('PASS automatic connection with restrictive autoplay, one Start gesture, duplicate ownership and manual reconnect');
 }finally{await browser.close();fixture.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
