'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium,webkit}=require('playwright-core');
(async()=>{
for(const [name,engine]of Object.entries({chromium,webkit})){
 const browser=await engine.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await page.clock.install();
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><button id="audioClockWidgetBtn" aria-expanded="false">Audio clock</button>');
  await page.addScriptTag({path:path.join(__dirname,'../audio-diagnostics.js')});
  await page.evaluate(()=>{
   window.rate=1;window.offset=performance.now();window.fakeState='running';window.late=0;
   window.AudioContext=()=>{throw Error('Monitor must not create an audio context');};
   window.fakeContext={sampleRate:44100,baseLatency:.01,get state(){return fakeState;},get currentTime(){return (performance.now()-offset)/1000*rate;}};
   MygrainClockWidget.mount({getContext:()=>fakeContext,getStats:()=>({lateTicks:late,skippedSteps:0,maxLatenessMs:0,lookaheadMs:350,grains:2,oscillators:3})});
  });
  const snap=()=>page.evaluate(()=>mygrainClockWidget.snapshot());
  assert.equal((await snap()).monitorRunning,false);
  await page.clock.runFor(6000);assert.equal((await snap()).samples,0);
  await page.locator('#audioClockWidgetBtn').tap();await page.locator('.clock-details').tap();await page.clock.runFor(5100);
  let text=await page.locator('#audioClockWidget').innerText();assert.match(text,/100\.0%/);assert.match(text,/44,100 Hz/);assert.match(text,/Unavailable/);
  await page.locator('.clock-close').tap();let count=(await snap()).samples;await page.clock.runFor(6000);assert.equal((await snap()).samples,count);
  await page.evaluate(()=>{rate=.7;});await page.locator('#audioClockWidgetBtn').tap();await page.clock.runFor(5100);
  text=await page.locator('#audioClockWidget').innerText();assert.match(text,/70\.0%/);assert.match(text,/Stress observed/);
  await page.clock.fastForward(3000);assert(parseFloat(await page.locator('#audioClockWidget dd').nth(8).textContent())>=2000);
  await page.evaluate(()=>{fakeState='suspended';});await page.clock.runFor(1100);assert.match(await page.locator('#audioClockWidget').innerText(),/Paused/);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  count=(await snap()).samples;await page.clock.runFor(6000);assert.equal((await snap()).samples,count);assert.equal((await snap()).monitorRunning,false);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});fakeState='running';document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal((await snap()).monitorRunning,true);
  await page.locator('.clock-reset').tap();assert.equal(await page.locator('#audioClockWidget dd').nth(7).textContent(),'Warming up…');
  await page.locator('.clock-details').tap();
  const box=await page.locator('#audioClockWidget').boundingBox();assert(box.width<=250&&box.height<300);assert(box.x>=0&&box.x+box.width<=391);
  await page.locator('.clock-close').tap();
  console.log('PASS',name,'normal/slow clocks; unavailable latency; suspension; zero samples closed/hidden; reset; phone bounds');
  if(process.env.MYGRAIN_TEST_URL){
   const base=process.env.MYGRAIN_TEST_URL,context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,extraHTTPHeaders:{'X-Mygrain-User':'admin'}});
   assert.equal((await context.request.post(base+'/mygrain/api/auth/login',{data:{username:'admin',password:process.env.MYGRAIN_TEST_ADMIN_PASSWORD}})).status(),200);
   const app=await context.newPage(),errors=[];app.on('pageerror',e=>errors.push(e.message));
   await app.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   await app.goto(base+'/mygrain/');await app.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');
   assert.equal(await app.evaluate(()=>mygrainClockWidget.snapshot().monitorRunning),false);
   await app.evaluate(()=>document.getElementById('start-overlay').style.display='none');
   await app.locator('#audioClockWidgetBtn').tap();assert.match(await app.locator('#audioClockWidget dd').first().textContent(),/Not started/);
   await app.evaluate(async()=>{await createAudioContextInstance();});await app.waitForTimeout(1200);
   assert.match(await app.locator('#audioClockWidget').innerText(),/Hz/);
   const h=await app.locator('.clock-handle').boundingBox();await app.mouse.move(h.x+20,h.y+h.height/2);await app.mouse.down();await app.mouse.move(h.x+50,h.y+180);await app.mouse.up();
   const moved=await app.locator('#audioClockWidget').boundingBox();assert(moved.y>100);
   await app.setViewportSize({width:844,height:390});const bounds=await app.locator('#audioClockWidget').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=845);
   await app.locator('.clock-close').click();assert.equal(await app.evaluate(()=>mygrainClockWidget.snapshot().monitorRunning),false);
   assert.deepEqual(errors,[]);await context.close();console.log('PASS',name,'authenticated app startup, real audio context, drag, rotation, close; no page errors');
  }
 }finally{await browser.close();}
}
})().catch(e=>{console.error(e);process.exitCode=1;});
