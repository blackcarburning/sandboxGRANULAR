'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:19089/mygrain/';
(async()=>{for(const [name,type] of Object.entries({chromium,webkit})){const browser=await type.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});try{const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-playground'}})).status(),200);await page.goto(base);await page.waitForFunction(()=>window.mygrainWasp&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);await page.waitForSelector('#waspCard',{state:'attached'});await page.locator('#waspCard').scrollIntoViewIfNeeded();await page.waitForSelector('[data-playground-draw="q"]',{state:'attached'});await page.evaluate(()=>mygrainCardHistory.ready);
for(const key of ['cutoff','resonant','q']){
 const row=page.locator(`[data-playground-lane="${key}"]`),canvas=row.locator('canvas');
 await page.evaluate(async key=>{const s=mygrainWasp.settings();s.enabled=false;s.playground.modulation[key]={...s.playground.modulation[key],source:'drawn',clock:'sync',beats:4,multiplier:1,snap:1,snapTiming:'straight',curve:Array(64).fill(0)};await mygrainWasp.restore(s);},key);
 await canvas.evaluate(el=>{mygrainDisplay.reveal(el);el.scrollIntoView({block:'center'});});
 await row.locator('[data-pg-mode]').selectOption('blocks');
 const curve=()=>page.evaluate(key=>mygrainWasp.settings().playground.modulation[key].curve,key);
 for(const shape of ['square','saw','ramp']){
  await row.locator('[data-pg-block-shape]').selectOption(shape);await canvas.scrollIntoViewIfNeeded();let b=await canvas.boundingBox();
  await page.mouse.move(b.x+b.width*.36,b.y+b.height*.4);await page.mouse.down();await page.mouse.move(b.x+b.width*.36,b.y+b.height*.1,{steps:5});await page.mouse.up();await page.waitForFunction(()=>!mygrainCardHistory.busy);
  let c=await curve();assert(c.slice(16,32).some(v=>v>.7));assert(c.slice(0,16).every(v=>v===0));assert(c.slice(32).every(v=>v===0));
  if(shape==='square')assert(c.slice(16,32).every(v=>Math.abs(v-.8)<.04));
  if(shape==='saw')assert(c[16]>.7&&c[31]===0);if(shape==='ramp')assert(c[16]===0&&c[31]>.7);
  await page.mouse.dblclick(b.x+b.width*.36,b.y+b.height*.3);await page.waitForFunction(()=>!mygrainCardHistory.busy);assert((await curve()).every(v=>v===0));
 }
 await row.locator('[data-pg-block-shape]').selectOption('square');await canvas.scrollIntoViewIfNeeded();let b=await canvas.boundingBox();
 await page.touchscreen.tap(b.x+b.width*.6,b.y+b.height*.2);await page.waitForFunction(()=>!mygrainCardHistory.busy);assert((await curve()).slice(32,48).some(v=>v>.5));
 // Double tap in a new cell, preserving the previously placed block.
 await page.touchscreen.tap(b.x+b.width*.85,b.y+b.height*.2);await page.touchscreen.tap(b.x+b.width*.85,b.y+b.height*.2);await page.waitForFunction(()=>!mygrainCardHistory.busy);assert((await curve()).slice(48).every(v=>v===0));
 await row.locator('[data-pg-zoom]').fill('4');
 const geometry=await row.evaluate(el=>({outer:el.querySelector('.wasp-pg-scroll').clientWidth,inner:el.querySelector('canvas').getBoundingClientRect().width}));assert(geometry.inner>geometry.outer*3.8);
 await row.locator('.wasp-pg-scroll').evaluate(el=>el.scrollLeft=el.scrollWidth);
 const area=await row.locator('.wasp-pg-scroll').boundingBox();
 await page.mouse.click(area.x+area.width*.75,area.y+30);await page.waitForFunction(()=>!mygrainCardHistory.busy);
 assert((await curve()).slice(48).some(v=>v>.3),'zoomed scrolled placement must map to final cell');
 const beforeCancel=await curve();await page.mouse.move(area.x+30,area.y+40);await page.mouse.down();await canvas.dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse'});await page.mouse.up();assert.deepEqual(await curve(),beforeCancel);

 await row.locator('.wasp-pg-scroll').evaluate(el=>el.scrollLeft=el.scrollWidth);await row.locator('[data-pg-zoom]').fill('1');await row.locator('.wasp-pg-scroll').evaluate(el=>el.scrollLeft=0);
 await row.locator('[data-pg-mode]').selectOption('freehand');await canvas.scrollIntoViewIfNeeded();b=await canvas.boundingBox();await page.mouse.move(b.x+1,b.y+b.height*.8);await page.mouse.down();await page.mouse.move(b.x+b.width-1,b.y+b.height*.2,{steps:12});await page.mouse.up();await page.waitForFunction(()=>!mygrainCardHistory.busy);let c=await curve();assert(c[0]<-.5&&c[63]>.5);
 const restored=await page.evaluate(async key=>{const s=mygrainWasp.settings(),before=s.playground.modulation[key].curve;await mygrainWasp.restore(JSON.parse(JSON.stringify(s)));return {same:JSON.stringify(before)===JSON.stringify(mygrainWasp.settings().playground.modulation[key].curve),enabled:mygrainWasp.settings().enabled};},key);assert(restored.same&&!restored.enabled);
}
for(const size of [{width:320,height:740},{width:844,height:390},{width:1440,height:1000}]){await page.setViewportSize(size);await page.locator('#waspCard').scrollIntoViewIfNeeded();await page.locator('[data-playground-lane="q"] canvas').evaluate(el=>{mygrainDisplay.reveal(el);el.scrollIntoView({block:'center'});});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page overflow');}
assert.deepEqual(errors,[]);console.log('PASS',name,'three lanes: square/saw/ramp height drag, double-click/double-tap deletion, touch placement, zoom, freehand and curve roundtrip');}finally{await browser.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
