// Ordinary native touch taps are the regression boundary, not held Solo presses.
const {chromium,webkit}=require('playwright-core');
const assert=require('node:assert/strict');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18833/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async()=>{for(const [name,engine] of Object.entries({chromium,webkit})){
 const browser=await engine.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{ });
 try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await ctx.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await ctx.request.post(base+'api/auth/register',{data:{username:'solotaps'+Date.now(),password:'isolated-solo-fixture'}});
 await page.goto(base);await page.waitForFunction(()=>window.mygrainCardHistory&&window.mygrainQ&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
 const solos=await page.locator('.performance-feature-card[aria-label^="Bastardloop"] .mygrain-solo-button,#performanceDrumMachineCard .mygrain-solo-button,[aria-label="Dropbox sample layer controls"] .mygrain-solo-button').evaluateAll(buttons=>buttons.map(b=>b.id));assert.equal(solos.length,14);
 for(const id of solos){await page.evaluate(()=>setLoopLayerSolo('none',{silent:true}));const button=page.locator('#'+id);await button.tap();await page.waitForFunction(id=>document.getElementById(id).getAttribute('aria-pressed')==='true',id);assert.equal(await button.evaluate(e=>e.classList.contains('phone-card-action')),false,id);await button.tap();await page.waitForFunction(id=>document.getElementById(id).getAttribute('aria-pressed')==='false',id);assert.deepEqual(await page.evaluate(()=>loopLayerSolo),[],id);}
 console.log('PASS',name,'all 14 loop-card Solo controls toggle on/off with ordinary native taps');
 const right=['sectionJumpAiBtn','sectionJumpSongBtn','sectionJumpMegaRandomBtn','sectionJumpSparseRandomBtn','sectionJumpKeyboardBtn','sectionJumpLayerSwitchBtn','sectionJumpBastardMixerBtn','sectionJumpActionsBtn','sectionJumpTransportBtn'];
 assert.deepEqual(await page.locator('.section-jump-quick-stack > button').evaluateAll(es=>es.map(e=>e.id)),right);
 await page.evaluate(()=>randomizeBastardLoopXPattern());const after=await page.evaluate(()=>JSON.stringify(bastardLoopXSequence));
 for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1280,height:900}]){
  await page.setViewportSize(viewport);await page.waitForTimeout(100);
  for(const id of ['sectionJumpUndoBtn','sectionJumpRedoBtn']){const rect=await page.locator('#'+id).evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e,parent:e.parentElement.className};});assert.equal(rect.parent,'history-edge-controls');assert.ok(rect.x<40&&rect.right<=40&&rect.y>=0&&rect.bottom<=viewport.height&&rect.hit,JSON.stringify(rect));}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const action=viewport.width<960?'tap':'click';await page.locator('#sectionJumpUndoBtn')[action]();await page.waitForFunction(()=>!mygrainCardHistory.busy);await page.locator('#sectionJumpRedoBtn')[action]();await page.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await page.evaluate(()=>JSON.stringify(bastardLoopXSequence)),after);
  await page.screenshot({path:`/tmp/mygrain-touch2-${name}-${viewport.width}.png`});
 }
 console.log('PASS',name,'original right rail order; left Undo/Redo hit targets and exact restore in portrait/landscape/desktop');
 await page.setViewportSize({width:390,height:844});
 // Native A+B loop playback: a card Solo must actually silence B, not merely change the button.
 await page.evaluate(()=>{
  clearAllPerformanceSoloStates({silent:true,skipSave:true});stopAllPerformancePlayback({silent:true});
  const tone=frequency=>{const b=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate);const data=b.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=.2*Math.sin(2*Math.PI*frequency*i/audioContext.sampleRate);return b;};
  bastardLoopBuffer=tone(220);bastardLoop2Buffer=tone(440);bastardLoopEnabled=true;bastardLoop2Enabled=true;
  for(const id of ['performanceBastardLoopLevel','performanceBastardLoop2Level']){const input=document.getElementById(id);input.value='70';input.dispatchEvent(new Event('input'));}
  setBastardLoopPlaying(true,{silent:true,skipSave:true});
 });
 async function peaks(){return page.evaluate(async()=>{const ready=(bastardLoopTransportStartTime??audioContext.currentTime)+.08;while(audioContext.currentTime<ready)await new Promise(r=>setTimeout(r,25));const nodes=[bastardLoopGainNode,bastardLoop2GainNode],analysers=nodes.map(node=>{if(!node)return null;const a=audioContext.createAnalyser();a.fftSize=2048;node.connect(a);return a;});const peaks=[0,0];for(let pass=0;pass<6;pass++){await new Promise(r=>setTimeout(r,100));analysers.forEach((a,i)=>{if(!a)return;const values=new Float32Array(2048);a.getFloatTimeDomainData(values);for(const n of values)peaks[i]=Math.max(peaks[i],Math.abs(n));});}analysers.forEach((a,i)=>{if(!a)return;try{nodes[i].disconnect(a);}catch{}a.disconnect();});return peaks;});}
 const before=await peaks();assert.ok(before.every(p=>p>.001),JSON.stringify(before));await page.locator('#performanceBastardLoopSoloBtn').tap();const isolated=await peaks();assert.ok(isolated[0]>.001&&isolated[1]===0,JSON.stringify(isolated));assert.equal(await page.locator('#performanceBastardLoopLayerSoloBtn').getAttribute('aria-pressed'),'true');await page.locator('#performanceBastardLoopSoloBtn').tap();const restored=await peaks();assert.ok(restored.every(p=>p>.001),JSON.stringify(restored));console.log('PASS',name,'native A+B audio, card tap isolates A and second tap restores B',JSON.stringify({before,isolated,restored}));
 await page.evaluate(()=>stopAllPerformancePlayback({silent:true}));assert.deepEqual(errors,[]);console.log('PASS',name,'no page errors');
 }finally{await browser.close();}
}})().catch(error=>{console.error(error);process.exitCode=1});
