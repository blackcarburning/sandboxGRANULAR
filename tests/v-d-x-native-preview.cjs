'use strict';
const {chromium,webkit}=require('playwright-core'),assert=require('node:assert/strict');
(async()=>{for(const [name,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});
 try{const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await c.request.post('http://127.0.0.1:18983/mygrain/api/auth/login',{data:{username:'admin',password:'isolated-d-loop'}});const p=await c.newPage(),errors=[];p.setDefaultTimeout(20000);p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:18983/mygrain/');await p.waitForFunction(()=>window.mygrainD&&document.documentElement.dataset.mygrainStartup==='ready');
 for(const target of ['bastardLoopV','bastardLoopD','bastardLoopX']){
  await p.evaluate(target=>openDropboxSampleBrowser(SAMPLE_BROWSER_TARGETS[target]),target);await p.waitForSelector('#dropboxSampleBrowserList .sample-browser-card audio');
  assert.equal(await p.getByRole('button',{name:'Preview sample',exact:true}).count(),0);
  const audio=p.locator('#dropboxSampleBrowserList audio').first();assert(await audio.getAttribute('src'));
  await audio.scrollIntoViewIfNeeded();let box=await audio.boundingBox();await p.touchscreen.tap(box.x+20,box.y+box.height/2);
  await p.waitForFunction(()=>{const a=document.querySelector('#dropboxSampleBrowserList audio');return !a.paused&&a.currentTime>.05});
  assert(await p.evaluate(()=>!bastardLoopPlaying&&!sequencerPlaying&&!drumMachinePlaying));
  await p.evaluate(()=>stopAllPerformancePlayback({silent:true}));assert(await audio.evaluate(a=>a.paused));
  box=await audio.boundingBox();await p.touchscreen.tap(box.x+20,box.y+box.height/2);await p.waitForFunction(()=>{const a=document.querySelector('#dropboxSampleBrowserList audio');return !a.paused&&a.currentTime>.1});
  await p.evaluate(()=>closeDropboxSampleBrowser());assert.equal(await audio.getAttribute('src'),null);console.log('PASS',name,target,'native tap Play, stopped transport, Stop/replay and close');
 }
 assert.deepEqual(errors,[]);
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
