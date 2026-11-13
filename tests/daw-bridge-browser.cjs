'use strict';
const {chromium,webkit}=require('playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19109/mygrain/';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
const out=fs.readFileSync('/tmp/mygrain-vst3-output','utf8').trim()+'/evidence';
(async()=>{
 const raw=out+'/bridge-browser.f32',fixture=spawn('/tmp/mygrain-bridge-fixture',[new URL(base).origin,'75',raw]);
 let log='';fixture.stdout.on('data',c=>{log+=c;});fixture.stderr.pipe(process.stderr);
 const code=await new Promise((resolve,reject)=>{let timeout=setTimeout(()=>reject(Error('Fixture start timeout')),4000);fixture.stdout.on('data',()=>{const m=log.match(/187\d{2}\.[a-f0-9]{32}/);if(m){clearTimeout(timeout);resolve(m[0]);}});fixture.on('exit',n=>reject(Error('Fixture exited '+n)));});
 const browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1100}}),p=await context.newPage(),errors=[],network=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.url().includes('daw-bridge'))network.push([r.url(),r.status()]);});
  await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}});
  await p.goto(base);
  await p.waitForFunction(()=>mygrainDawBridge&&document.documentElement.dataset.mygrainStartup==='ready');
  assert.equal(new URL(p.url()).hash,'');assert.equal(await p.locator('#dawBridgeCode').inputValue(),'');assert.equal(await p.locator('#dawBridgeCard').count(),1);
  await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  const before=await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);setDrumMachineEnabled(false,{silent:true,skipSave:true});mygrainNoise.restore({enabled:false});mygrainChannelEq.restore();applyGlobalBpm(120);syncPatternLengthControls(16,{skipSave:true});const b=audioContext.createBuffer(2,audioContext.sampleRate*2,audioContext.sampleRate);for(let ch=0;ch<2;ch++)for(let i=0;i<b.length;i++)b.getChannelData(ch)[i]=.08*Math.sin(2*Math.PI*83*i/b.sampleRate);bastardLoopBuffer=b;bastardLoopSourceBpm=120;bastardLoopMetadata={bpm:120,durationSeconds:2};setLoopLayerSolo('bastarda',{silent:true,skipSave:true});setBastardLoopEnabled(true,{silent:true,skipSave:true});return{rate:audioContext.sampleRate,version:gatherPreset().version};});
  await p.locator('#dawBridgeCard').evaluate(el=>el.open=true);
  await p.locator('#dawBridgeCode').fill(code);await p.locator('#dawBridgeConnect').click();await p.waitForFunction(()=>mygrainDawBridge.diagnostics().connected,{},{timeout:15000});
  assert.equal(await p.evaluate(()=>mygrainDawBridge.diagnostics().muted),true);
  await p.locator('#dawBridgeArm').click();
  await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.running,{},{timeout:15000});
  const first=await p.evaluate(()=>mygrainDawBridge.diagnostics());
  await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.received>300000,{},{timeout:15000});
  const running=await p.evaluate(()=>mygrainDawBridge.diagnostics());assert.equal(running.clock.underruns,0);assert.equal(running.clock.overflows,0);assert(running.clock.bufferMs>150&&running.clock.bufferMs<650,JSON.stringify(running));
  await p.locator('#dawBridgeStop').click();await p.waitForFunction(()=>!mygrainDawBridge.diagnostics().clock?.armed);assert.equal(await p.evaluate(()=>bastardLoopPlaying),false);
  await p.locator('#dawBridgeStart').click();await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.running,{},{timeout:15000});
  const restarted=await p.evaluate(()=>mygrainDawBridge.diagnostics());assert(restarted.epoch>first.epoch);
  // Account lock must detach the capture and restore normal local routing.
  await p.evaluate(()=>dispatchEvent(new Event('mygrain-account-lock')));
  assert.equal(await p.evaluate(()=>mygrainDawBridge.diagnostics().connected),false);assert.equal(await p.evaluate(()=>mygrainDawBridge.diagnostics().muted),false);
  assert.match(await p.locator('#dawBridgeStatus').textContent(),/Account locked/);
  await p.screenshot({path:out+'/desktop-bridge.png',fullPage:false});
  assert(network.every(x=>x[1]===200),JSON.stringify(network));assert.deepEqual(errors,[]);
  const report={before,first,running,restarted,errors,network,raw};fs.writeFileSync(out+'/browser-bridge.json',JSON.stringify(report,null,2));
  console.log('PASS Chrome live patch -> native stereo, scheduled start, bounded buffer, re-arm, account disconnect',JSON.stringify(running));
  for(const [engine,type]of Object.entries({chromium,webkit})){
   const b=engine==='chromium'?browser:await type.launch();
   try{const phone=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
    await phone.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}});const page=await phone.newPage();await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');
    assert.equal(await page.locator('#dawBridgeCard').count(),0);assert.equal(await page.evaluate(()=>typeof mygrainDawBridge),'undefined');await phone.close();console.log('PASS phone unchanged',engine);
   }finally{if(b!==browser)await b.close();}
  }
 }finally{await browser.close();fixture.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
