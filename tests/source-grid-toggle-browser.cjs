'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright-core');
const task=process.env.MYGRAIN_TEST_OUTPUT||'/tmp/mygrain-multi-toggle-results',stage=process.env.MYGRAIN_TEST_STAGE,base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19026/mygrain/';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);fs.mkdirSync(task,{recursive:true});
(async()=>{const results=[];for(const[engine,type]of Object.entries(process.env.QUICK?{chromium}:{chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
 try{for(const phone of process.env.QUICK?[true]:[true,false]){
 const context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1280,height:900},isMobile:phone,hasTouch:phone}),page=await context.newPage(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==new URL(base).origin)return r.abort();const name=u.pathname==='/mygrain/'?'index.html':u.pathname.replace('/mygrain/','');if(stage&&['index.html','sample-grid-browser.js'].includes(name))return r.fulfill({path:path.join(stage,name),contentType:name.endsWith('.js')?'application/javascript':'text/html'});return r.continue()});
 assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
 await page.goto(base);await page.waitForFunction(()=>window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 const grid=page.locator('#sampleGridBrowser'),cells=grid.locator('.sample-grid-cell'),click=async l=>phone?l.tap():l.click(),double=async l=>{if(phone){await l.tap();await l.tap()}else await l.dblclick()};
 const open=async target=>{await page.evaluate(t=>openDropboxSampleBrowser(t),target);await page.waitForFunction(()=>mygrainSampleGridBrowser.files.length&&!mygrainSampleGridBrowser.listController)};
 const assertPicked=async(index,count,picked)=>{assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.picks.length),count);assert.equal(await grid.locator('.sample-grid-pick').count(),count);assert.equal(await cells.nth(index).getAttribute('data-picked'),String(picked));assert.equal(await cells.nth(index).getAttribute('aria-pressed'),String(picked));assert.equal(await cells.nth(index).evaluate(c=>c.classList.contains('picked')),picked)};
 const checked=[];for(const lane of ['A','B','C','W','V','P','O']){
 await open('bastardLoop'+lane);const before=await page.evaluate(l=>{const s=sampleGridLoop(l),b=s.buffer();return{meta:s.metadata(),pcm:b?Array.from(b.getChannelData(0)):null}},lane);
 await double(cells.first());await assertPicked(0,1,true);await double(cells.first());await assertPicked(0,0,false);assert(await grid.locator('[data-grid-action=recut]').isDisabled());
 await double(cells.first());await assertPicked(0,1,true);await click(grid.locator('[data-grid-action=load]'));await click(grid.locator('[data-grid-action=load]'));await assertPicked(0,1,true);
 await click(cells.nth(1));await assertPicked(1,1,false);await page.waitForFunction(()=>mygrainSampleGridBrowser.audio.currentTime>.01&&!mygrainSampleGridBrowser.audio.paused);await page.waitForTimeout(420);
 await double(cells.nth(1));await assertPicked(1,2,true);await double(cells.first());await assertPicked(0,1,false);await assertPicked(1,1,true);
 if(lane==='A'){
 // Selection survives page reconstruction; a second double-click removes by canonical identity.
 await click(grid.locator('[data-grid-action=page-next]'));await click(grid.locator('[data-grid-action=page-previous]'));await assertPicked(1,1,true);
 }
 await double(cells.nth(1));await assertPicked(1,0,false);assert(await grid.locator('[data-grid-action=recut]').isDisabled());
 assert.deepEqual(await page.evaluate(l=>{const s=sampleGridLoop(l),b=s.buffer();return{meta:s.metadata(),pcm:b?Array.from(b.getChannelData(0)):null}},lane),before,'selection toggling must not rewrite card audio or provenance');checked.push(lane);
 await click(grid.locator('[data-grid-action=close]'));
 }
 // At the cap, deselection is still available, and reselecting restores exactly one entry.
 await open('bastardLoopA');await page.evaluate(()=>{const b=mygrainSampleGridBrowser;b.picks=b.files.slice(0,64);b.paintPicks();b.paintSelection()});await double(cells.nth(64));assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.picks.length),64);await double(cells.first());await assertPicked(0,63,false);await double(cells.first());await assertPicked(0,64,true);
 // A cancelled drag is never a second selection click.
 await page.evaluate(()=>mygrainSampleGridBrowser.lastTap=null);await click(cells.first());await cells.first().dispatchEvent('pointercancel');await cells.first().dispatchEvent('click',{detail:1});await assertPicked(0,64,true);
 await click(grid.locator('[data-grid-action=clear-picks]'));await page.evaluate(()=>mygrainSampleGridBrowser.lastTap=null);
 await double(cells.first());await page.screenshot({path:path.join(task,`${engine}-${phone?'touch':'mouse'}-selected.png`)});await double(cells.first());await page.screenshot({path:path.join(task,`${engine}-${phone?'touch':'mouse'}-deselected.png`)});
 await click(grid.locator('[data-grid-action=close]'));
 // Direct single-sample browsers still load, including repeated double-click of the same sample.
 await open('drumMachineKick');for(let i=0;i<2;i++){await double(cells.first());await page.waitForFunction(()=>!mygrainCardHistory.busy&&!mygrainSampleGridBrowser.loading&&mygrainSampleGridBrowser.loadedKey);assert.equal(await page.evaluate(()=>mygrainSampleGridBrowser.picks.length),0);assert.equal(await cells.first().getAttribute('data-picked'),'false')}
 assert.deepEqual(errors,[]);results.push({engine,phone,checked,addOnly:true,canonicalAudioUnchanged:true,paging:true,cap:true,cancelledPointer:true,directDoubleLoad:true,errors});console.log('PASS',engine,phone?'touch':'desktop','7 multisample toggles, add-only, PCM, paging, cap, pointer cancellation, direct loads');await context.close();
 }}finally{await browser.close()}
}fs.writeFileSync(path.join(task,process.env.INSTALLED?'installed-results.json':'toggle-results.json'),JSON.stringify(results,null,2))})().catch(e=>{console.error(e);process.exitCode=1});
