'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19037/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const ctx=await browser.newContext({viewport:{width:1280,height:900}});assert.equal((await ctx.request.post(base+'api/auth/login',{data:{username:'admin',password:process.env.MYGRAIN_TEST_PASSWORD||'isolated-export-length'}})).status(),200);
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
 await page.goto(base);await page.waitForFunction(()=>window.mygrainD&&mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});applyGlobalBpm(240);syncPatternLengthControls(32,{skipSave:true});syncPerformanceExportBars(1,{skipSave:true});setLoopLayerSolo('bastardd',{skipSave:true,silent:true});setFxMuted(true,{silent:true});
 const b=audioContext.createBuffer(1,audioContext.sampleRate*3,audioContext.sampleRate);for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=.08*Math.sin(2*Math.PI*220*i/b.sampleRate);bastardLoopDBuffer=b;mygrainD.restore({enabled:true,level:.6,fill:'single',speed:.5,metadata:{fileName:'D fixture.wav'}});
 window.exportCalls=0;const original=renderLiveOutputBarsBuffer;renderLiveOutputBarsBuffer=async function(...args){exportCalls++;return original(...args)};
 });
 async function start(){await page.evaluate(()=>{window.exportResult=null;window.exportFinished=false;window.exportError=null;renderPatternWithOptionalSnapshot().then(async result=>{if(result){const data=await result.blob.arrayBuffer(),v=new DataView(data);window.exportResult={bars:result.bars,bpm:result.bpm,frames:v.getUint32(40,true)/(v.getUint16(22,true)*v.getUint16(34,true)/8),rate:v.getUint32(24,true),bytes:data.byteLength};}window.exportFinished=true;}).catch(e=>{window.exportError=e.message;window.exportFinished=true})});}
 async function done(){await page.waitForFunction(()=>exportFinished,null,{timeout:45000});assert.equal(await page.evaluate(()=>exportError),null);return page.evaluate(()=>exportResult);}
 const results=[];
 for(const choice of ['Keep export setting','Render to pattern length']){await start();const dialog=page.locator('#exportLengthDialog');await dialog.waitFor();assert.match(await dialog.textContent(),/Export setting: 16 steps.*Pattern length: 32 steps/);await dialog.getByRole('button',{name:choice,exact:true}).click();await page.locator('#exportSaveDialog').waitFor();await page.locator('#exportSaveSnapshot').uncheck();await page.locator('[data-export-accept]').click();const result=await done();assert.equal(result.frames,result.rate*(choice==='Keep export setting'?1:2));assert.equal(await page.locator('#performanceExportBars').inputValue(),'1');results.push({choice,...result});}
 for(const choice of ['Cancel','Escape']){const before=await page.evaluate(()=>exportCalls);await start();await page.locator('#exportLengthDialog').waitFor();if(choice==='Escape')await page.keyboard.press('Escape');else await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await done(),null);assert.equal(await page.evaluate(()=>exportCalls),before);}
 // Equal/longer exports bypass the warning; no capture needed to test the choice boundary.
 const boundaries=await page.evaluate(async()=>{const out=[];for(const bars of [2,3]){syncPerformanceExportBars(bars,{skipSave:true});out.push(await choosePerformanceExportSteps())}return out});assert.deepEqual(boundaries,[32,48]);
 // Phone-size dialog contains all three actions without horizontal overflow.
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{syncPerformanceExportBars(1,{skipSave:true});window.lengthChoice=choosePerformanceExportSteps()});await page.locator('#exportLengthDialog').waitFor();assert(await page.evaluate(()=>{const d=document.getElementById('exportLengthDialog'),r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&d.scrollWidth<=d.clientWidth+1}));await page.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.deepEqual(errors,[]);console.log('PASS',engine,JSON.stringify({D:true,patternSteps:32,exportSteps:16,results,boundaries,cancelAndEscape:true}));await ctx.close();
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
