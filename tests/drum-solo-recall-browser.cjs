const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18959/mygrain/';
(async()=>{for(const [engine,type] of Object.entries(process.env.BASELINE?{chromium}:{chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});
 try{for(const mobile of (process.env.BASELINE?[false]:[false,true])){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
 await context.request.post(base+'api/auth/login',{data:{username:'admin',password:process.env.MYGRAIN_TEST_ADMIN_PASSWORD||'isolated-drum-copy'}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 const ready=async()=>{await page.waitForFunction(()=>window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);};
 await page.goto(base);await ready();
 await page.evaluate(()=>{
 stopAllPerformancePlayback({silent:true});syncPatternLengthControls(32,{skipSave:true});
 for(const k of ['kick','snare','hat','perc','clap','cymbals','etc','roll']) getDrumMachineSectionArrays(k).forEach((a,j)=>a?.forEach((_,i)=>{a[i]=j===1?(i%5===0?4:0):i%(j+3)===1;}));
 for(const [id,value] of Object.entries({drumMachineSnareDistortion:37,finalDriveSoft:24,finalCompressorAmount:67,finalCompressorRelease:230,drumMachineKickPitch:3,drumMachineSnareDecay:62,drumMachineHatLevel:41,drumMachineClapLevel:0,drumMachineCymbalsFilterEnv:45,preFilterGain:-4,postFilterGain:3}))setSliderValue(id,value);
 drumMachineRoll=MygrainDrumRoll.normalize(drumMachineRoll);
 syncDrumMachineUi();saveState();openDrumMachineOverlay();
 });
 if(!process.env.BASELINE){
 for(const k of ['kick','snare','hat','perc','clap','cymbals','etc','roll']){
 const b=page.locator(`[data-drum-jump="${k}"]`);
 await b.dblclick();assert.equal(await b.getAttribute('aria-pressed'),'true');
 assert.deepEqual(await page.evaluate(()=>['kick','snare','hat','perc','clap','cymbals','etc','roll'].filter(isDrumMachineLaneAudible)),[k]);
 await b.dblclick();
 }
 await page.locator('[data-drum-jump="snare"]').dblclick();await page.locator('[data-drum-jump="roll"]').dblclick();
 assert.deepEqual(await page.evaluate(()=>drumMachineLaneSolos),['snare','roll']);
 await page.evaluate(()=>mygrainCardHistory.undo());
 assert.deepEqual(await page.evaluate(()=>drumMachineLaneSolos),['snare']);
 await page.evaluate(()=>mygrainCardHistory.redo());
 assert.deepEqual(await page.evaluate(()=>drumMachineLaneSolos),['snare','roll']);
 }
 const capture=()=>page.evaluate(()=>{const s=saveState({snapshotOnly:true});return {arrays:['kick','snare','hat','perc','clap','cymbals','etc','roll'].map(k=>getDrumMachineSectionArrays(k).map(a=>a?.slice())),sliders:Object.fromEntries(Object.entries(s.sliders).filter(([k])=>/^(drumMachine|finalDrive|finalCompressor|preFilterGain|postFilterGain)/.test(k))),solos:s.modes.drumMachineLaneSolos,length:s.patternLength};});
 const before=await capture();await page.reload();await ready();const after=await capture();
 assert.deepEqual(after,before);assert.deepEqual(errors,[]);console.log('PASS',engine,mobile?'phone':'desktop','all lane solos, position, multi-solo and complete drum/FX recall');await context.close();
 }}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
