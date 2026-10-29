const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:18959/mygrain/';
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});
 try{const context=await browser.newContext({viewport:{width:1280,height:900}});
 assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-drum-copy'}})).status(),200);
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 const ready=async()=>{await page.waitForFunction(()=>window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);};
 await page.goto(base);await ready();await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});restoreDrumMachineRoll();openDrumMachineOverlay();});
 await page.locator('[data-drum-jump="roll"]').click();
 await page.locator('[data-roll-step="0"]').click();await page.locator('[data-roll-step="1"]').click();
 await page.locator('#drumMachineRollDip').fill('60');await page.locator('#drumMachineRollDip').dispatchEvent('input');
 assert.deepEqual(await page.evaluate(()=>drumMachineRoll.dips.slice(0,2)),[false,false]);
 await page.locator('[data-roll-dip-step="0"]').click();
 assert.equal(await page.locator('[data-roll-dip-step="0"]').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('[data-roll-dip-step="1"]').getAttribute('aria-pressed'),'false');
 await page.evaluate(()=>mygrainCardHistory.undo());assert.equal(await page.locator('[data-roll-dip-step="0"]').getAttribute('aria-pressed'),'false');
 await page.evaluate(()=>mygrainCardHistory.redo());assert.equal(await page.locator('[data-roll-dip-step="0"]').getAttribute('aria-pressed'),'true');
 const audio=await page.evaluate(()=>{const levels=[],original=playDrumMachineHit,buffer=drumMachineSnareBuffer;try{drumMachineSnareBuffer=audioContext.createBuffer(1,100,audioContext.sampleRate);playDrumMachineHit=(b,t,p,o)=>levels.push(o.level);scheduleDrumMachineRepeats('snare',0,0,.1,drumMachineRoll);scheduleDrumMachineRepeats('snare',1,0,.1,drumMachineRoll);return levels;}finally{playDrumMachineHit=original;drumMachineSnareBuffer=buffer;}});
 assert(audio[1]>0);assert(Math.abs(audio[0]/audio[1]-.4)<1e-9);
 // Measure before/after geometry using exact backed-up style and current runtime controls.
 const geometry=()=>page.evaluate(()=>{const card=document.getElementById('drumMachineLane-roll'),rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};return {length:rect('drumMachineRollLength'),page:rect('drumMachineRollPage'),grid:rect('drumMachineRollGrid'),cardH:card.getBoundingClientRect().height,fit:card.scrollWidth<=card.clientWidth+1};});
 const desktop=await geometry();assert(desktop.length.w<=110&&desktop.length.h<=32&&desktop.page.w<=110,JSON.stringify(desktop));assert(desktop.fit);
 await page.screenshot({path:'/tmp/roll-note-dip-'+engine+'-desktop.png'});
 for(const width of [375,390,640,641,768,1280]){await page.setViewportSize({width,height:900});await page.locator('[data-drum-jump="roll"]').click();assert((await geometry()).fit,'fit '+width);}
 await page.setViewportSize({width:1280,height:900});
 const css=fs.readFileSync(__dirname+'/../backups/roll-note-dip-20261027T143342Z/drum-enhancements.css','utf8');
 await page.route('**/drum-enhancements.css?*',route=>route.fulfill({contentType:'text/css',body:css}));await page.reload();await ready();await page.evaluate(()=>openDrumMachineOverlay());await page.locator('[data-drum-jump="roll"]').click();const before=await geometry();assert(desktop.length.w<before.length.w&&desktop.length.h<before.length.h);console.log(engine,'desktop geometry',{before,after:desktop});
 await page.unroute('**/drum-enhancements.css?*');await page.reload();await ready();await page.evaluate(()=>openDrumMachineOverlay());await page.locator('[data-drum-jump="roll"]').click();
 assert.equal(await page.locator('[data-roll-dip-step="0"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-roll-dip-step="1"]').getAttribute('aria-pressed'),'false');
 assert.deepEqual(await page.evaluate(()=>getDrumMachineSectionArrays('roll')[2].slice(0,2)),[true,false]);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('granularSynthState')).modes.drumMachineRoll);assert.deepEqual(saved.dips.slice(0,2),[true,false]);
 await page.locator('#drumMachineRollClearBtn').click();assert.equal(await page.evaluate(()=>drumMachineRoll.dips.some(Boolean)),false);assert.equal(await page.locator('#drumMachineRollDip').inputValue(),'60');
 assert.deepEqual(errors,[]);console.log('PASS',engine,'per-note DSP, toggle Undo/Redo, persistence, save payload, clear, desktop compact geometry and 375/390/640/641/768/1280 containment');await context.close();
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
