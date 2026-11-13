'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL;assert.match(base||'',/^http:\/\/127\.0\.0\.1:\d+$/);
(async()=>{for(const[name,engine]of Object.entries({chromium,webkit})){
const browser=await engine.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
try{
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',extraHTTPHeaders:{'X-Mygrain-User':'admin'}});
assert.equal((await context.request.post(base+'/mygrain/api/auth/login',{data:{username:'admin',password:process.env.MYGRAIN_TEST_ADMIN_PASSWORD}})).status(),200);
const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
let submitted=null,fail=false,calls=0;
await p.route('**/api/debug-logs',async r=>{calls++;submitted=r.request().postDataJSON();await r.fulfill(fail?{status:503,json:{ok:false,error:'Test upload failure'}}:{json:{ok:true,logId:'audio-20261103T091500Z-0123456789abcdef'}});});
await p.goto(base+'/mygrain/');await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>document.getElementById('start-overlay').style.display='none');
for(const size of [{width:390,height:844},{width:320,height:640},{width:844,height:390}]){
 await p.setViewportSize(size);const undo=await p.locator('#sectionJumpUndoBtn').boundingBox(),redo=await p.locator('#sectionJumpRedoBtn').boundingBox(),perf=await p.locator('#audioClockWidgetBtn').boundingBox();
 assert(Math.abs(perf.x-undo.x)<1);assert(perf.y>=redo.y+redo.height+7);assert(perf.y+perf.height<=size.height);
}
await p.setViewportSize({width:390,height:844});await p.locator('#audioClockWidgetBtn').tap();
await p.waitForFunction(()=>!document.getElementById('submitCurrentDebugLogBtn').disabled);
await p.waitForTimeout(1100);
await p.locator('.clock-mark').tap();assert.match(await p.locator('.clock-feedback').textContent(),/Crackle marked/);
assert((await p.evaluate(()=>phoneAudioDiagnostics.snapshot())).incidents.length>0);
await p.locator('.clock-submit').tap();await p.waitForFunction(()=>document.querySelector('.clock-feedback').textContent.includes('saved on server'));
assert.equal(calls,1);assert(submitted.phoneDiagnostics.incidents.length>0);assert.equal(submitted.application,'MYGRAIN');
fail=true;await p.locator('.clock-submit').tap();await p.waitForFunction(()=>document.querySelector('.clock-feedback').textContent.includes('Test upload failure'));assert.equal(calls,2);
await p.locator('.clock-close').tap();assert.equal(await p.evaluate(()=>mygrainClockWidget.snapshot().monitorRunning),false);
await p.evaluate(()=>document.getElementById('audioClockWidgetBtn').click());assert(await p.locator('.clock-mark').isVisible());await p.locator('.clock-close').tap();assert.deepEqual(errors,[]);
console.log('PASS',name,'iPhone edge position portrait/narrow/landscape; actual crackle capture; current-log success/failure feedback; close/reopen inactivity');
await context.close();
const desktop=await browser.newContext({viewport:{width:1280,height:900},extraHTTPHeaders:{'X-Mygrain-User':'admin'}});await desktop.request.post(base+'/mygrain/api/auth/login',{data:{username:'admin',password:process.env.MYGRAIN_TEST_ADMIN_PASSWORD}});const dp=await desktop.newPage();await dp.goto(base+'/mygrain/');await dp.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');assert.equal(await dp.locator('#audioClockWidgetBtn').evaluate(e=>e.parentElement.className),'mygrain-app-brand');await desktop.close();console.log('PASS',name,'desktop launcher stays at top');
}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
