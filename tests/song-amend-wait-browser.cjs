// Read-only fixture: delayed Amend stages and failures, no saved Song mutations.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18949/mygrain/',origin=new URL(base).origin;
(async()=>{const results=[];
for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{for(const mobile of [false,true]){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
 const page=await context.newPage(),errors=[],writes=[],identity={ok:true,authenticated:true,user:{username:'read-only-amend-wait-fixture'}};
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const req=r.request(),url=new URL(req.url());if(url.origin!==origin)return r.abort();if(!['GET','HEAD'].includes(req.method())){writes.push(req.method()+' '+url.pathname);return r.abort()}if(url.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext='+JSON.stringify(identity)});if(url.pathname.includes('/api/'))return r.fulfill({json:{...identity,files:[],songs:[],folders:[],stations:[],samples:[],favourites:[],sources:[],patches:[]}});return r.continue()});
 await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainSongBeta);await page.locator('#start-btn').click();await page.waitForFunction(()=>window.mygrainCardHistory&&!mygrainCardHistory.busy);
 assert.equal((await page.locator('.build-badge strong').last().textContent()).trim(),'v2026.10.24.AMEND.1');
 await page.evaluate(()=>{const c=mygrainSongBeta,part={id:'1'.repeat(32),name:'Slow chorus',sha256:'a'.repeat(64),bpm:120,patternSteps:16,repeats:1};c.song={id:'amend-wait-fixture',revision:1,parts:[part]};c.songs=[c.song];c.canEditSong=()=>true;c.renderLockUi=()=>{};c.expandedParts.add(`${c.song.id}:${part.id}`);c.ensureEditing=()=>new Promise((resolve,reject)=>{window.leaseReady=resolve;window.leaseFail=reject});c.recall=async p=>{c.armStage(c.generation,'Decoding saved audio',p);await new Promise(r=>window.audioReady=r);c.editing={id:p.id,sha256:p.sha256,songId:c.song.id};c.render();await new Promise(r=>window.persistenceReady=r)};c.render()});
 await page.locator('.song-beta-amend').click();const notice=page.locator('#songBetaAmendWait');await notice.waitFor({state:'visible'});
 assert.match(await notice.textContent(),/Please wait.*Slow chorus.*Checking editing access/);assert.match(await page.locator('.song-beta-amend').textContent(),/Please wait/);assert.equal(await page.locator('.song-beta-amending').count(),0);
 await page.evaluate(()=>leaseReady());await page.waitForFunction(()=>window.audioReady);assert.match(await notice.textContent(),/Decoding saved audio/);
 await page.evaluate(()=>scrollTo(0,0));const rect=await notice.boundingBox();assert(rect.y>=0&&rect.y+rect.height<=(mobile?844:900)+1);assert(rect.x>=0&&rect.x+rect.width<=(mobile?390:1280)+1);
 await page.evaluate(()=>audioReady());await page.waitForFunction(()=>window.persistenceReady);assert(await notice.isVisible());assert.equal(await page.locator('.song-beta-amending').count(),0);
 await page.evaluate(()=>persistenceReady());await page.waitForFunction(()=>!mygrainSongBeta.busy);assert.equal(await notice.count(),0);assert.equal(await page.locator('.song-beta-amending').count(),1);
 await page.evaluate(()=>{mygrainSongBeta.editing=null;mygrainSongBeta.active=null;mygrainSongBeta.render()});await page.locator('.song-beta-amend').click();await notice.waitFor({state:'visible'});await page.evaluate(()=>leaseFail(new Error('Fixture editing access unavailable')));await page.waitForFunction(()=>!mygrainSongBeta.busy);assert.equal(await notice.count(),0);assert.equal(await page.locator('.song-beta-amending').count(),0);assert.match(await page.locator('#songBetaStatus').textContent(),/editing access unavailable/);
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);results.push({engine,mobile,immediatePleaseWait:true,visibleWhileScrolledAway:true,waitUntilOrange:true,errorClearsWait:true,writes,errors});console.log('PASS',engine,mobile);await context.close();
 }}finally{await browser.close()}
}
if(process.env.MYGRAIN_TEST_RESULTS)fs.writeFileSync(process.env.MYGRAIN_TEST_RESULTS,JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
