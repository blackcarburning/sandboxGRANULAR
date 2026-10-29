const {chromium,webkit}=require('playwright-core');
const assert=require('node:assert/strict'),fs=require('fs');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18833/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async()=>{const browser=await (process.env.WEBKIT?webkit.launch({}):chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}));
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}); const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(60000);
 await context.request.post(base+'api/auth/register',{data:{username:'touchqa'+Date.now(),password:'isolated-history-fixture'}});
 await page.goto(base);await page.waitForFunction(()=>window.mygrainCardHistory&&mygrainQ&&document.documentElement.dataset.mygrainStartup==='ready');
 await page.locator('#start-btn').tap(); await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
 // An empty account has no source yet: seed disposable audio so Edit is enabled.
 await page.evaluate(()=>{bastardLoopLSampleBuffer=audioContext.createBuffer(1,4410,44100);bastardLoopXSampleBuffer=audioContext.createBuffer(1,4410,44100);syncBastardLoopLUi();syncBastardLoopXUi();});
 // Every ordinary card action must accept a native tap, not a synthetic click or hold.
 for (const part of ['L','X','Q']) {
   await page.locator(`#performanceBastardLoop${part}EditBtn`).tap();
   assert.equal(await page.locator(`#bastardLoop${part}Overlay`).isVisible(),true);
   await page.locator(`#bastardLoop${part}CloseBtn`).tap();
   assert.equal(await page.locator(`#bastardLoop${part}Overlay`).isVisible(),false);
 }
 for (const part of ['L','X']) {
   await page.locator(`#performanceBastardLoop${part}OpenSynthBtn`).tap();
   assert.equal(await page.locator('#synthPopupOverlay').isVisible(),true);
   await page.locator('#oscPopupCloseBtn').tap();
   await page.locator(`#performanceBastardLoop${part}LoadBtn`).tap();
   assert.equal(await page.locator('#dropboxSampleBrowserOverlay').isVisible(),true);
   await page.locator('#dropboxSampleBrowserCloseBtn').tap();
 }
 await page.evaluate(()=>{setBastardLoopLSourceMode('sample',{silent:true,skipSave:true});setBastardLoopXSourceMode('sample',{silent:true,skipSave:true});});
 for (const part of ['L','X']) {
   const button=page.locator(`#performanceBastardLoop${part}SynthModeBtn`);
   await button.tap();assert.match(await button.textContent(),/OSC3|Synth/);
   await page.waitForTimeout(200);await button.tap();assert.match(await button.textContent(),/Sample/);
 }
 assert.equal(await page.locator('.phone-card-action,.phone-action-holding').count(),0);
 console.log('PASS ordinary native taps: L/X/Q Edit Sequence, L/X Open Synth, sample browsers and source switches');
 const seq=()=>page.evaluate(()=>JSON.stringify(bastardLoopXSequence));
 const count=()=>page.evaluate(()=>mygrainCardHistory.counts);
 const start=await seq();await page.locator('#performanceBastardLoopXRandomPatternBtn').tap();const one=await seq();assert.notEqual(one,start);assert.deepEqual(await count(),{undo:1,redo:0});
 await page.locator('#performanceBastardLoopXRandomPatternBtn').tap();const two=await seq();assert.notEqual(two,one);assert.deepEqual(await count(),{undo:2,redo:0});console.log('PASS ordinary native taps apply once with 2 history levels');
 await page.evaluate(()=>{document.getElementById('performanceBastardLoopXLevel').value='41';document.getElementById('performanceBastardLoopXLevel').dispatchEvent(new Event('input'));});
 await page.locator('#sectionJumpUndoBtn').tap();await page.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await seq(),one);assert.equal(await page.$eval('#performanceBastardLoopXLevel',e=>e.value),'41');
 await page.locator('#sectionJumpUndoBtn').tap();await page.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await seq(),start);assert.deepEqual(await count(),{undo:0,redo:2});
 await page.locator('#sectionJumpRedoBtn').tap();await page.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await seq(),one);
 await page.locator('#sectionJumpRedoBtn').tap();await page.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await seq(),two);console.log('PASS exact Undo x2 / Redo x2; unrelated volume preserved');
 await page.locator('#performanceBastardLoopXRandomPatternBtn').tap();await page.locator('#performanceBastardLoopLRandomPatternBtn').tap();assert.deepEqual(await count(),{undo:4,redo:0});
 await page.evaluate(()=>mygrainCardHistory.undo());await page.evaluate(()=>randomizeBastardLoopXPattern());assert.deepEqual(await count(),{undo:4,redo:0});console.log('PASS history accumulates and redo branch cleared');
 // Q changes its sequence in place: its own card action must snapshot before mutation.
 const qbefore=await page.evaluate(()=>JSON.stringify(mygrainQ.state.sequence));await page.locator('#performanceBastardLoopQRandomPatternBtn').tap();const qafter=await page.evaluate(()=>JSON.stringify(mygrainQ.state.sequence));assert.notEqual(qbefore,qafter);await page.evaluate(()=>mygrainCardHistory.undo());assert.equal(await page.evaluate(()=>JSON.stringify(mygrainQ.state.sequence)),qbefore);await page.evaluate(()=>mygrainCardHistory.redo());assert.equal(await page.evaluate(()=>JSON.stringify(mygrainQ.state.sequence)),qafter);console.log('PASS Q card pattern exact undo/redo');
 await page.evaluate(()=>{document.getElementById('drumMachineClapPatternBtn').click()});const clap=await page.evaluate(()=>JSON.stringify(getDrumMachinePattern('clap')));await page.evaluate(()=>mygrainCardHistory.undo());await page.evaluate(()=>mygrainCardHistory.redo());assert.equal(await page.evaluate(()=>JSON.stringify(getDrumMachinePattern('clap'))),clap);console.log('PASS extra drum track history');
 // A real original bass load must be redo-able without rerunning the download.
 await page.evaluate(()=>setBastardLoopXRepository('samples_altbass'));await page.locator('#performanceBastardLoopXRandomBtn').tap();await page.waitForFunction(()=>!mygrainCardHistory.busy&&!!bastardLoopXSampleBuffer);await page.evaluate(()=>{window.__firstBass=bastardLoopXSampleBuffer;window.__firstMeta=JSON.stringify(bastardLoopXSampleMetadata);});
 await page.locator('#performanceBastardLoopXRandomBtn').tap();await page.waitForFunction(()=>!mygrainCardHistory.busy&&bastardLoopXSampleBuffer!==window.__firstBass);await page.evaluate(()=>{window.__secondBass=bastardLoopXSampleBuffer;window.__secondMeta=JSON.stringify(bastardLoopXSampleMetadata);});
 let bassRequests=0;page.on('request',r=>{if(/sample-source|sample-audio|bastardloop/.test(r.url()))bassRequests++});
 await page.evaluate(()=>mygrainCardHistory.undo());assert.equal(await page.evaluate(()=>bastardLoopXSampleBuffer===__firstBass&&JSON.stringify(bastardLoopXSampleMetadata)===__firstMeta),true);
 await page.evaluate(()=>mygrainCardHistory.redo());assert.equal(await page.evaluate(()=>bastardLoopXSampleBuffer===__secondBass&&JSON.stringify(bastardLoopXSampleMetadata)===__secondMeta),true);assert.equal(bassRequests,0);console.log('PASS actual bass PCM identity and metadata restored; no redo downloads');
 const audible=await page.evaluate(async()=>{
   setBastardLoopXSourceMode('sample',{silent:true,skipSave:true});setBastardLoopXEnabled(true,{silent:true,skipSave:true});
   setBastardLoopPlaying(true,{silent:true,skipSave:true});await mygrainCardHistory.undo();
   const analyser=audioContext.createAnalyser();analyser.fftSize=2048;const output=getBastardLoopXPlaybackDestination();output.connect(analyser);
   const resumed=bastardLoopPlaying;let peak=0;for(let i=0;i<15;i++){await new Promise(r=>setTimeout(r,80));const data=new Float32Array(2048);analyser.getFloatTimeDomainData(data);for(const value of data)peak=Math.max(peak,Math.abs(value));}
   output.disconnect(analyser);analyser.disconnect();stopAllPerformancePlayback({silent:true});await mygrainCardHistory.redo();return {peak,resumed};
 });assert.ok(audible.resumed&&audible.peak>.001,JSON.stringify(audible));console.log('PASS audible native audio and transport resume after undo',JSON.stringify(audible));

 const solo=await page.evaluate(()=>{setLoopLayerSolo('none',{silent:true});const cards=[...document.querySelectorAll('.performance-feature-card[aria-label^="Bastardloop"],#performanceDrumMachineCard,[aria-label="Dropbox sample layer controls"]')];return cards.map(card=>({label:card.getAttribute('aria-label'),solo:!!card.querySelector('.mygrain-solo-button')}));});assert.ok(solo.length>=14);assert.ok(solo.every(c=>c.solo),JSON.stringify(solo));
 const off=await page.$eval('#performanceCardXSoloBtn',e=>getComputedStyle(e).backgroundImage);await page.locator('#performanceCardXSoloBtn').tap();const on=await page.$eval('#performanceCardXSoloBtn',e=>({bg:getComputedStyle(e).backgroundImage,active:e.getAttribute('aria-pressed')}));assert.notEqual(on.bg,off);assert.equal(on.active,'true');assert.equal(await page.$eval('#performanceBastardLoopXLayerSoloBtn',e=>e.getAttribute('aria-pressed')),'true');
 const wrong=await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>/^solo\b|\bsolo (on|off)$/i.test(b.textContent.trim())||b.matches('[data-source-waveform-solo],[data-grain-layer-solo],.performance-mixer-solo-btn,.performance-layer-solo-btn')).filter(b=>!b.classList.contains('mygrain-solo-button')).map(b=>b.id));assert.deepEqual(wrong,[]);console.log('PASS every loop card Solo; globally red; card/layer state synchronized');
 const palette=await page.evaluate(()=>[...document.querySelectorAll('.mygrain-solo-button')].map(button=>{const active=button.classList.contains('active'),pressed=button.getAttribute('aria-pressed');button.classList.remove('active');button.setAttribute('aria-pressed','false');const off=getComputedStyle(button).backgroundImage;button.classList.add('active');button.setAttribute('aria-pressed','true');const on=getComputedStyle(button).backgroundImage;button.classList.toggle('active',active);if(pressed===null)button.removeAttribute('aria-pressed');else button.setAttribute('aria-pressed',pressed);return {id:button.id,off,on};}));
 assert.ok(palette.length>40);assert.ok(palette.every(entry=>entry.off===palette[0].off&&entry.on===palette[0].on&&entry.off!==entry.on),JSON.stringify(palette.filter(entry=>entry.off!==palette[0].off||entry.on!==palette[0].on)));console.log('PASS identical dark-red/bright-red palette on all',palette.length,'Solo buttons');

 await page.evaluate(()=>setLoopLayerSolo('none',{silent:true}));
 // Async action stays one transaction until the returned Promise settles.
 await page.evaluate(()=>{window.__pending=mygrainCardHistory.run('delayed fixture',async()=>{await new Promise(r=>window.__release=r);randomizeBastardLoopXPattern();});});assert.equal(await page.evaluate(()=>mygrainCardHistory.busy),true);assert.equal(await page.$eval('#sectionJumpUndoBtn',e=>e.disabled),true);const whileBusy=await seq();await page.locator('#performanceBastardLoopXRandomPatternBtn').tap();assert.equal(await seq(),whileBusy);await page.evaluate(()=>__release());await page.evaluate(()=>__pending);assert.equal(await page.evaluate(()=>mygrainCardHistory.busy),false);console.log('PASS asynchronous history waits for completion');
 const countsBeforeFailure=await count();await page.evaluate(()=>{try{mygrainCardHistory.run('failed no-op',()=>{throw new Error('fixture');});}catch{}});assert.deepEqual(await count(),countsBeforeFailure);
 const beforePartial=await seq();await page.evaluate(()=>{try{mygrainCardHistory.run('partial fixture',()=>{randomizeBastardLoopXPattern();throw new Error('fixture');});}catch{}});await page.evaluate(()=>mygrainCardHistory.undo());assert.equal(await seq(),beforePartial);console.log('PASS failure without mutation adds no step; partial failure remains undoable');
 // Stop and ordinary keyboard activation stay immediate.
 await page.evaluate(()=>setBastardLoopPlaying(true,{silent:true,skipSave:true}));await page.locator('#performanceBastardLoopXStartBtn').tap();assert.equal(await page.evaluate(()=>bastardLoopPlaying),false);
 const beforeKeyboard=await seq();await page.locator('#performanceBastardLoopXRandomPatternBtn').focus();await page.keyboard.press('Enter');assert.notEqual(await seq(),beforeKeyboard);console.log('PASS emergency Stop and keyboard activation immediate');
 const held=await page.evaluate(async()=>{setArpeggiatorEnabled(false,{silent:true,skipSave:true});heldNotes=new Set(['C3']);startHeldKeyboardPlayback();randomizeBastardLoopXPattern();await mygrainCardHistory.undo();const keys=activeKeyCount;stopAllPerformancePlayback({silent:true});setHoldEnabled(true,{silent:true,skipSave:true});setArpeggiatorEnabled(true,{silent:true,skipSave:true});playLoopAndHeldKeys({silent:true});randomizeBastardLoopXPattern();await mygrainCardHistory.undo();const arp=isArpeggiatorPlaying();stopAllPerformancePlayback({silent:true});return {keys,arp};});assert.equal(held.keys,1);assert.equal(held.arp,true);console.log('PASS held keyboard and arpeggiator playback restored');


 await page.screenshot({path:`/tmp/mygrain-touch-${process.env.WEBKIT?'webkit':'chromium'}-portrait.png`});await page.setViewportSize({width:844,height:390});await page.waitForTimeout(150);const rail=await page.$eval('#sectionJumpUndoBtn',e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}});assert.ok(rail.hit&&rail.h>=40&&rail.x<40,JSON.stringify(rail));await page.screenshot({path:`/tmp/mygrain-touch-${process.env.WEBKIT?'webkit':'chromium'}-landscape.png`});console.log('PASS phone portrait/landscape quick controls accessible',JSON.stringify(rail));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.setViewportSize({width:1280,height:900});const desktopBefore=await seq();await page.locator('#performanceBastardLoopXRandomPatternBtn').click();assert.notEqual(await seq(),desktopBefore);await page.locator('#sectionJumpUndoBtn').click();await page.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await seq(),desktopBefore);console.log('PASS desktop mouse actions immediate and quick Undo usable');
 // Retain two exact undo AND redo levels, discarding only the oldest changes.
 const snapshots=[await seq()];
 for(let i=0;i<12;i++){await page.locator('#performanceBastardLoopXRandomPatternBtn').click();snapshots.push(await seq());}
 assert.deepEqual(await count(),{undo:2,redo:0});
 for(let i=11;i>=10;i--){await page.locator('#sectionJumpUndoBtn').click();await page.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await seq(),snapshots[i]);}
 assert.deepEqual(await count(),{undo:0,redo:2});
 assert.equal(await page.locator('#sectionJumpUndoBtn').isDisabled(),true);
 for(let i=11;i<=12;i++){await page.locator('#sectionJumpRedoBtn').click();await page.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await seq(),snapshots[i]);}
 assert.deepEqual(await count(),{undo:2,redo:0});console.log('PASS two exact Undo and Redo levels; oldest changes discarded');
 await page.evaluate(()=>window.dispatchEvent(new Event('mygrain-account-lock')));assert.deepEqual(await count(),{undo:0,redo:0});console.log('PASS account lock clears history');assert.deepEqual(errors,[]);console.log('PASS no uncaught browser errors');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
