const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:18959/mygrain/';
const iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
(async()=>{for(const[engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});
 try{const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:iphone});
 await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-drum-copy'}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 const ready=async()=>{await page.waitForFunction(()=>window.mygrainCardHistory&&window.mygrainDrumPatterns&&window.mygrainPower&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);};
 await page.goto(base);await ready();
 await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});syncPatternLengthControls(32,{skipSave:true});
 const kinds=['kick','snare','hat','perc','clap','cymbals','etc'];for(const [n,k]of kinds.entries()){
 const b=audioContext.createBuffer(n%2+1,256+n*13,24000);for(let ch=0;ch<b.numberOfChannels;ch++)b.getChannelData(ch).forEach((_,i,a)=>a[i]=Math.sin(i*.1+n+ch)*.2);
 if(k==='kick')drumMachineKickBuffer=b;else if(k==='snare')drumMachineSnareBuffer=b;else if(k==='hat')drumMachineHatBuffer=b;else if(k==='perc')drumMachinePercBuffer=b;else drumMachineExtraTracks[k].buffer=b;
 getDrumMachineSectionArrays(k).forEach((a,j)=>a?.forEach((_,i)=>a[i]=j===1?(i%3===0?4:0):i%(j+3)===n%3));
 }
 drumMachineRoll=MygrainDrumRoll.normalize({length:64,dip:47,pattern:Array.from({length:64},(_,i)=>i%7===0),ratchets:Array(64).fill(3)});
 drumMachineKickMetadata={fileName:'kick.wav'};drumMachineSnareMetadata={fileName:'snare.wav'};drumMachineHatMetadata={fileName:'hat.wav'};drumMachinePercMetadata={fileName:'perc.wav'};
 setSliderValue('drumMachineSnarePitch',3);setSliderValue('drumMachineClapLevel',0);setSliderValue('finalDriveSoft',17);restoreDrumMachineLaneSolos(['kick','roll']);syncDrumMachineUi();saveState();openDrumMachineOverlay();});
 const capture=()=>page.evaluate(()=>{const pcm=[drumMachineKickBuffer,drumMachineSnareBuffer,drumMachineHatBuffer,drumMachinePercBuffer,...Object.values(drumMachineExtraTracks).map(t=>t.buffer)].map(b=>b?{rate:b.sampleRate,channels:Array.from({length:b.numberOfChannels},(_,ch)=>Array.from(b.getChannelData(ch)))}:null);return{state:mygrainDrumPatterns.drumState(),pcm};});
 const original=await capture();
 await page.locator('#drumMachineSavePatternBtn').click();await page.waitForFunction(()=>!document.getElementById('drumPatternLibrary').hasAttribute('aria-busy'));
 const d=page.locator('#drumPatternLibrary'),folderName='Fills '+engine+' '+Date.now();assert.equal(await d.locator('audio,video,[data-preview]').count(),0);
 await d.locator('[data-folder-name]').fill(folderName);await d.locator('[data-new-folder]').click();await page.waitForFunction(()=>document.querySelector('#drumPatternLibrary [data-status]').textContent==='Folder created.');
 await d.getByRole('button',{name:'📁 '+folderName,exact:true}).click();
 await d.locator('[data-folder-name]').fill('Nested');await d.locator('[data-new-folder]').click();await page.waitForFunction(()=>document.querySelector('#drumPatternLibrary [data-status]').textContent==='Folder created.');await d.getByRole('button',{name:'📁 Nested',exact:true}).click();
 await d.locator('[data-name]').fill('Exact kit');await d.locator('[data-save]').click();await page.waitForFunction(()=>document.querySelector('#drumPatternLibrary [data-status]').textContent==='Pattern and sounds saved.');
 assert.deepEqual(await capture(),original,'saving must not change drums');
 const row=d.locator('[data-pattern-id]');await row.click();const id=await row.getAttribute('data-pattern-id');
 await page.evaluate(()=>{drumMachineKickPattern.fill(false);drumMachineRoll.dip=0;drumMachineKickBuffer=null;setSliderValue('drumMachineSnarePitch',-5);saveState();});const changed=await capture();
 await d.locator('[data-load]').click();await page.waitForFunction(()=>document.querySelector('#drumPatternLibrary [data-status]').textContent==='Pattern and sounds loaded. Undo is available.');assert.deepEqual(await capture(),original);
 assert.equal(await page.evaluate(()=>document.getElementById('finalDriveSoft').value),'17');
 await d.locator('[data-close]').click();await page.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual(await capture(),changed);await page.evaluate(()=>mygrainCardHistory.redo());assert.deepEqual(await capture(),original);
 await page.reload();await ready();assert.deepEqual(await capture(),original);
 await page.evaluate(async()=>{const fx=captureDrumSendFxState();Object.assign(fx.reverb,{enabled:true,amount:40,send:100,size:80,decay:80});loadDrumSendFxState(fx);ensureDrumSendFxGraph();updateDrumSendEffects();await waitForDrumSendImpulse();});
 const exported=await page.evaluate(()=>{const p=gatherPreset();delete p.timestamp;return p;});
 const before=await page.evaluate(()=>{const s=saveState({snapshotOnly:true});delete s.timestamp;return s;});
 await page.evaluate(()=>closeDrumMachineOverlay());await page.waitForFunction(()=>!document.getElementById('sectionJumpDrawer').classList.contains('is-close-guarded'));await page.locator('#sectionJumpHandle').click();await page.locator('#iphoneLowPowerBtn').click();assert.equal(await page.evaluate(()=>mygrainPower.active),true);await page.evaluate(()=>waitForDrumSendImpulse());assert.equal(await page.evaluate(()=>drumSendFxGraph.reverb.buffer.numberOfChannels),1);
 const metrics=await page.evaluate(()=>{
 const b=createFinalReverbImpulseForContext(audioContext,.8,.8,'hall');
 const g=MygrainLoopFx.createGraph(audioContext,audioContext.createGain(),{filterSlope:96,room:.2,reverbDecay:6},120);
 const result={channels:b.numberOfChannels,seconds:b.duration,filterCount:g.filters.length,hallChannels:g.banks[0].node.buffer.numberOfChannels,hallSeconds:g.banks[0].node.buffer.duration};g.dispose();return result;});
 assert.equal(metrics.channels,1);assert(metrics.seconds<=1.5);assert.equal(metrics.filterCount,2);assert.equal(metrics.hallChannels,1);assert(metrics.hallSeconds<=1.5);
 assert.deepEqual(await page.evaluate(()=>{const p=gatherPreset();delete p.timestamp;return p;}),exported,'patch export must not change with low power');
 const during=await page.evaluate(()=>{const s=saveState({snapshotOnly:true});delete s.timestamp;return s;});assert.deepEqual(during,before,'low power cannot change settings');
 await page.evaluate(()=>mygrainPower.set(false));const after=await page.evaluate(()=>{const s=saveState({snapshotOnly:true});delete s.timestamp;return s;});assert.deepEqual(after,before);
 assert.equal(await page.evaluate(()=>{const g=MygrainLoopFx.createGraph(audioContext,audioContext.createGain(),{filterSlope:96,room:.2,reverbDecay:6},120);const n=g.filters.length;g.dispose();return n;}),8);
 await page.evaluate(()=>{mygrainPower.set(true);randomizeDrumMachinePatterns({skipSave:true});});assert.equal(await page.evaluate(()=>mygrainPower.active),false);
 await page.evaluate(()=>mygrainPower.set(true));await page.reload();await ready();assert.equal(await page.evaluate(()=>mygrainPower.active),false);
 assert.equal((await context.request.get(base+'api/drum-patterns',{headers:{'X-Mygrain-User':'different'}})).status(),401);
 const fresh=await browser.newContext();assert.equal((await fresh.request.get(base+'api/drum-patterns')).status(),401);await fresh.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-drum-copy'}});const response=await fresh.request.get(base+'api/drum-patterns',{headers:{'X-Mygrain-User':'admin'}});assert((await response.json()).patterns.some(p=>p.id===id));await fresh.close();
 assert.deepEqual(errors,[]);console.log('PASS',engine,'folder/nested save, exact PCM, load/Undo/Redo/reload, isolation, iPhone power metrics/settings/reversibility/randomise/reload');await context.close();
 const desktop=await browser.newContext();await desktop.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-drum-copy'}});const dp=await desktop.newPage();await dp.goto(base);await dp.waitForFunction(()=>window.mygrainPower);assert.equal(await dp.evaluate(()=>mygrainPower.set(true)),false);assert.equal(await dp.locator('#iphoneLowPowerBtn').isVisible(),false);await desktop.close();console.log('PASS',engine,'desktop unavailable');
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
