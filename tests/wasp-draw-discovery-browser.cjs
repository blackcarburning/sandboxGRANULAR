'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium, webkit} = require('playwright-core');
const base = 'http://127.0.0.1:19087/mygrain/';
const out = fs.readFileSync('/tmp/mygrain-draw-visible-evidence','utf8').trim();
const keys = ['cutoff','resonant','q'];
(async()=>{
 const results=[];
 for(const [name,type] of Object.entries({chromium,webkit})){
  if(process.env.DRAW_ENGINE && process.env.DRAW_ENGINE!==name)continue;
  const browser=await type.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{for(const phone of [true,false]){
   const context=await browser.newContext(phone?{viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{viewport:{width:1440,height:1000}});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(45000);
   await page.route('**/*',r=>{
    const u=new URL(r.request().url());if(u.origin!==new URL(base).origin)return r.abort();
    const name=u.pathname.split('/').pop()||'index.html';
    if(process.env.DRAW_BASELINE && ['index.html','wasp-ui.js','wasp.css','demand-ui.js'].includes(name))return r.fulfill({body:fs.readFileSync(path.join(out,name)),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});
    return r.continue();
   });
   assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-playground'}})).status(),200);
   await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainWasp);
   await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   await page.evaluate(()=>document.getElementById('waspCard').scrollIntoView());await page.waitForSelector('#waspPlaygroundPower',{state:'attached'});
   await page.evaluate(async()=>{await mygrainJumpToButton(document.getElementById('sectionJumpWaspBtn'));await mygrainWasp.restore(null);const pg=document.querySelector('[data-wasp-playground]');mygrainDisplay.reveal(pg);pg.scrollIntoView({block:'start'});});
   if(process.env.DRAW_BASELINE)await page.locator('[data-wasp-playground]').screenshot({path:out+'/before-iphone.png'});
   assert.equal(await page.locator('[data-playground-draw]').count(),6,'Draw controls must be discoverable without opening a source menu');
   const sizes=phone?[{width:390,height:844},{width:844,height:390}]:[{width:1440,height:1000}];
   for(const size of sizes){
    await page.setViewportSize(size);
    for(const key of keys){
     await page.evaluate(async()=>{await mygrainWasp.restore(null);});
     const button=page.locator('.wasp-pg-draw-launch [data-playground-draw="'+key+'"]');
     await button.evaluate(el=>{mygrainDisplay.reveal(el);el.scrollIntoView({block:'center'});});
     const box=await button.boundingBox();assert(box&&box.height>=44&&box.width>=44);
     if(phone)await button.tap();else await button.click();
     await page.waitForFunction(k=>mygrainWasp.settings().playground.modulation[k].source==='drawn'&&!mygrainCardHistory.busy,key);
     const row=page.locator('[data-playground-lane="'+key+'"]'),canvas=row.locator('canvas');
     await page.waitForFunction(k=>{const c=document.querySelector('[data-playground-lane="'+k+'"] canvas'),r=c.getBoundingClientRect();return c.width>100&&r.top>=0&&r.bottom<=innerHeight&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===0&&v>100)},key);
     assert.equal(await row.locator('[data-playground="source"]').inputValue(),'drawn');
     assert.equal(await button.getAttribute('aria-expanded'),'true');
     assert.equal(await row.locator('[data-playground-draw]').getAttribute('aria-expanded'),'true');
     const current=await page.evaluate(()=>({s:mygrainWasp.settings(),d:mygrainWasp.diagnostics()}));assert.equal(current.s.enabled,false);assert.equal(current.s.playground.enabled,false);assert.equal(current.d.processors,0);
     // A genuine touch/mouse gesture edits the existing authoritative curve.
     const rect=await canvas.boundingBox();assert(rect&&rect.width>100);
     if(phone){await page.touchscreen.tap(rect.x+rect.width*.75,rect.y+rect.height*.12);}else{await page.mouse.move(rect.x+rect.width*.2,rect.y+rect.height*.85);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.8,rect.y+rect.height*.15,{steps:10});await page.mouse.up();}
     await page.waitForFunction(()=>!mygrainCardHistory.busy);
     const curve=await page.evaluate(k=>mygrainWasp.settings().playground.modulation[k].curve,key);assert.notDeepEqual(curve,current.s.playground.modulation[key].curve);
     await page.evaluate(async()=>{await mygrainCardHistory.undo();await mygrainCardHistory.redo();});
     assert.deepEqual(await page.evaluate(k=>mygrainWasp.settings().playground.modulation[k].curve,key),curve);
     // Dropdown and draw buttons stay synchronized; reopening preserves the curve.
     await row.locator('[data-playground="source"]').selectOption('A');await page.waitForFunction(k=>mygrainWasp.settings().playground.modulation[k].source==='A'&&!mygrainCardHistory.busy,key);
     assert.equal(await row.locator('.wasp-pg-draw').isVisible(),false);assert.equal(await button.getAttribute('aria-expanded'),'false');
     const local=row.locator('[data-playground-draw]');await local.evaluate(el=>el.scrollIntoView({block:'center'}));if(phone)await local.tap();else await local.click();
     await page.waitForFunction(k=>mygrainWasp.settings().playground.modulation[k].source==='drawn'&&!mygrainCardHistory.busy,key);assert.deepEqual(await page.evaluate(k=>mygrainWasp.settings().playground.modulation[k].curve,key),curve);
     const saved=await page.evaluate(()=>({snapshot:saveState({force:true,snapshotOnly:true}).modes.wasp,preset:gatherPreset().wasp}));assert.deepEqual(saved.snapshot.playground.modulation[key].curve,curve);assert.deepEqual(saved.preset.playground.modulation[key].curve,curve);
    }
    const geometry=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));assert(geometry.width<=geometry.viewport+1,JSON.stringify(geometry));
    await page.locator('.wasp-pg-draw-launch').evaluate(el=>el.scrollIntoView({block:'center'}));await page.locator('.wasp-pg-draw-launch').screenshot({path:out+`/draw-buttons-${name}-${size.width}.png`});
    await page.locator('[data-wasp-playground]').screenshot({path:out+`/playground-${name}-${size.width}.png`});
    results.push({engine:name,phone,size,geometry});console.log('PASS discovery, drawing, history, persistence and layout',name,size.width,size.height);
   }
   // Re-entry after the normal display budget has parked the backing store.
   const canvas=page.locator('[data-playground-lane="q"] canvas');await page.evaluate(()=>window.scrollTo(0,0));
   await page.waitForFunction(()=>document.querySelector('[data-playground-lane="q"] canvas').width===0);
   await page.evaluate(()=>mygrainJumpToButton(document.getElementById('sectionJumpWaspBtn')));
   await page.waitForFunction(()=>document.documentElement.dataset.mygrainJumping!=='true'&&!mygrainUiActivity.busy);
   const reopen=page.locator('.wasp-pg-draw-launch [data-playground-draw="q"]');
   await reopen.evaluate(el=>{mygrainDisplay.reveal(el);el.scrollIntoView({block:'center',behavior:'instant'});});
   if(phone)await reopen.tap();else await reopen.click();
   await page.waitForFunction(()=>{const c=document.querySelector('[data-playground-lane="q"] canvas');return c.width>100&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===0&&v>100)});
   assert.deepEqual(errors,[]);await context.close();
  }}finally{await browser.close();}
 }
 fs.writeFileSync(out+'/browser-'+(process.env.DRAW_ENGINE||'all')+'.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
