const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:18959/mygrain/';
(async()=>{for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});
 try{const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-drum-copy'}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 const ready=async()=>{await page.waitForFunction(()=>window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);};
 await page.goto(base);await ready();await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});openDrumMachineOverlay();});
 const slider=page.locator('#drumMachineRollDip');
 assert.equal(await slider.count(),1);assert.equal(await slider.locator('xpath=ancestor::article').getAttribute('id'),'drumMachineLane-roll');
 assert.equal(await slider.inputValue(),'0');
 const before=await page.evaluate(()=>JSON.stringify({snare:drumMachineSnarePattern,roll:drumMachineRoll.pattern}));
 await slider.fill('60');await slider.dispatchEvent('input');await page.waitForFunction(()=>!mygrainCardHistory.busy);
 assert.equal(await page.evaluate(()=>drumMachineRoll.dip),60);assert.equal(await page.locator('#drumMachineRollDipValue').textContent(),'60%');
 await page.evaluate(()=>mygrainCardHistory.undo());assert.equal(await slider.inputValue(),'0');
 await page.evaluate(()=>mygrainCardHistory.redo());assert.equal(await slider.inputValue(),'60');
 assert.equal(await page.evaluate(()=>JSON.stringify({snare:drumMachineSnarePattern,roll:drumMachineRoll.pattern})),before);
 await page.reload();await ready();assert.equal(await slider.inputValue(),'60');assert.equal(await page.evaluate(()=>drumMachineRoll.dip),60);
 await page.evaluate(()=>openDrumMachineOverlay());await page.locator('#drumMachineRollClearBtn').click();assert.equal(await slider.inputValue(),'60');
 assert.deepEqual(errors,[]);console.log('PASS',engine,'phone: Roll-only Dip, legacy 0%, 60%, Undo/Redo, patterns unchanged, reload, Clear preserves Dip');await context.close();
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
