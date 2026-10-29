'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const { encodeWav } = require('../radiolab.js');
const tone = Buffer.from(encodeWav([[Float32Array.from({length:44100},(_,i)=>.2*Math.sin(i*2*Math.PI*330/44100))]],44100,1));
(async()=>{
for (const [engine, type] of Object.entries({chromium,webkit})) {
 const browser = await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try {
  for (const width of [390,1440]) {
   const context = await browser.newContext({viewport:{width,height:width===390?844:1000},isMobile:width===390,hasTouch:width===390});
   const page = await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); let mode='ready'; let captures=0;
   await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.origin!=='https://openclaw.blackcarburning.com')return route.abort();
    // The live host serves a reduced login shell to guests. Use the deployed full
    // entrypoint with isolated account APIs; all JS/CSS still come from live HTTPS.
    if(u.pathname==='/mygrain/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'../index.html'),'utf8')});
    if(u.pathname.endsWith('/account-context.js'))return route.fulfill({contentType:'application/javascript',body:'window.mygrainAccountContext={user:{username:"videolab-fixture"}};'});
    if(u.pathname.endsWith('/api/videolab/captures')&&route.request().method()==='POST'){captures++;assert.equal(JSON.parse(route.request().postData()).url,'https://www.instagram.com/reel/CDUMkliABpa/');return route.fulfill({json:{ok:true,capture:{id:'c'.repeat(32),status:'queued'}}});}
    if(u.pathname.endsWith('/audio'))return route.fulfill({contentType:'audio/wav',body:tone});
    if(u.pathname.includes('/api/videolab/captures/'))return route.fulfill({json:{ok:true,capture:{id:'c'.repeat(32),status:mode,title:'Reel fixture',error:mode==='error'?'Instagram requires login. Instagram login is not connected yet.':undefined}}});
    if(u.pathname.includes('/api/'))return route.fulfill({json:{ok:true,authenticated:true,user:{username:'videolab-fixture'},bookmarks:[],samples:[],files:[],songs:[],patches:[],folders:[]}});
    if(!['GET','HEAD'].includes(route.request().method()))return route.abort();
    return route.continue();
   });
   await page.goto('https://openclaw.blackcarburning.com/mygrain/?videolab=20261028-instagram-1');
   await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');
   await page.locator('#start-btn').click();
   await page.waitForFunction(()=>typeof isAudioGraphReady==='function'&&isAudioGraphReady()&&!engineStarting&&getComputedStyle(document.getElementById('start-overlay')).display==='none');
   await page.locator('#sectionJumpHandle').click();
   await page.locator('#sectionJumpVideolabBtn').click();
   await page.waitForFunction(()=>window.mygrainVideolab&&!mygrainVideolab.state.busy);
   assert.equal(await page.evaluate(()=>mygrainVideolab.state.build),'v2026.10.28.INSTAGRAM.1');
   await page.locator('#videolabSource').selectOption('instagram');
   await page.locator('#videolabURL').fill('https://www.instagram.com/reel/CDUMkliABpa/?igsh=share');
   await page.locator('#videolabDuration').fill('1');
   await page.locator('#videolabFetch').click();
   await page.waitForFunction(()=>mygrainVideolab.state.hasTake&&!mygrainVideolab.state.capturing);
   assert.equal(await page.locator('#videolabSampleName').inputValue(),'Reel fixture');
   const before=await page.evaluate(()=>mygrainVideolab.state.recordedSeconds);
   mode='error';await page.locator('#videolabFetch').click();
   await page.waitForFunction(()=>!mygrainVideolab.state.capturing&&document.getElementById('videolabStatus').textContent.includes('login is not connected'));
   assert.equal(await page.evaluate(()=>mygrainVideolab.state.recordedSeconds),before);
   assert.equal(captures,2);
   assert(await page.locator('#videolabSource').isVisible());
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   assert.deepEqual(errors,[]);
   await page.screenshot({path:`/root/.openclaw/workspace/output/videolab-instagram-20261028/live-${engine}-${width}.png`});
   console.log('PASS live static + isolated API',engine,width,'Reel capture, login error, preserved take, no overflow/errors');
   await context.close();
  }
 } finally {await browser.close();}
}
})().catch(e=>{console.error(e);process.exitCode=1});
