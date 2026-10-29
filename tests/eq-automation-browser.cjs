const assert=require('node:assert/strict'),{chromium,webkit}=require('/root/.openclaw/workspace/node_modules/playwright-core');
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});
 try{const c=await b.newContext({viewport:{width:1280,height:900},hasTouch:true}),p=await c.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)});
 await p.route('**/*',async r=>{const u=new URL(r.request().url());if(!['http:','https:'].includes(u.protocol))return r.continue();if(u.origin!=='https://openclaw.blackcarburning.com')return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"automation-fixture"}};'});if(u.pathname.includes('/api/'))return r.fulfill({json:{ok:true,authenticated:true,user:{username:'automation-fixture'},files:[],songs:[],folders:[],samples:[],patches:[]}});if(!['GET','HEAD'].includes(r.request().method()))return r.abort();return r.fulfill({response:await r.fetch({url:"http://127.0.0.1:8765"+u.pathname+u.search})})});
 await p.goto('https://openclaw.blackcarburning.com/mygrain/',{waitUntil:'domcontentloaded',timeout:60000});await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&window.mygrainEqAutomation&&window.mygrainChannelEqUi);
 await p.evaluate(()=>{for(const card of document.querySelectorAll('.performance-feature-card'))mygrainDemand.run(card)});
 assert.equal(await p.locator('.channel-eq-entry [data-eq-auto="write"]').count(),2);
 for(const key of ['X','L']){
  // Arm W while stopped, then use the real sequencer's audio clock.
  await p.locator(`.channel-eq-entry [data-eq-automation="${key}"] [data-eq-auto="write"]`).click();
  await p.evaluate(key=>{const buffer=audioContext.createBuffer(1,48000,48000);for(let i=0;i<buffer.length;i++)buffer.getChannelData(0)[i]=.1*Math.sin(2*Math.PI*220*i/48000);
   if(key==='X'){bastardLoopXSampleBuffer=buffer;bastardLoopXSourceMode='sample';setBastardLoopXLevelPercent(50,{skipSave:true});bastardLoopXSequence=Array.from({length:64},()=>({...createEmptyBastardLoopXStep(),note:'C2',rest:false}));if(!startBastardLoopX())throw Error("X start failed");}
   else{bastardLoopLSampleBuffer=buffer;bastardLoopLSourceMode='sample';setBastardLoopLLevelPercent(50,{skipSave:true});bastardLoopLSequence=Array.from({length:64},()=>({...createEmptyBastardLoopLStep(),note:'C3',rest:false}));if(!startBastardLoopL())throw Error("L start failed");}

   const value=mygrainChannelEq.get(key);value.enabled=true;value.bands[1].gain=12;mygrainChannelEq.set(key,value);
  },key);
  await p.waitForFunction(key=>mygrainEqAutomation.info(key).recording,key,{timeout:12000});
  // Move actual graph handles during the take (native pointer gestures).
  await p.evaluate(key=>mygrainChannelEqUi.open(key),key);
  const handle=p.locator('[data-eq-handle="1"]');let box=await handle.boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+130,box.y+60,{steps:35});await p.waitForTimeout(180);await p.mouse.up();
  await p.waitForFunction(()=>!mygrainCardHistory.busy);
  await p.waitForFunction(key=>!mygrainEqAutomation.info(key).write,key,{timeout:18000});
  const recorded=await p.evaluate(key=>{const a=mygrainChannelEq.settings().channels[key].automation;return {count:a.points.length,first:a.points[0].phase,last:a.points.at(-1).phase,read:a.read,values:[Math.min(...a.points.map(x=>x.bands[1].frequency)),Math.max(...a.points.map(x=>x.bands[1].frequency))]};},key);
  assert(recorded.count>3,JSON.stringify(recorded));assert.equal(recorded.first,0);assert.equal(recorded.last,1);assert(recorded.read);assert(recorded.values[1]>recorded.values[0]*1.5);
  // Handles must animate without a new input event; read follows sequence phase.
  const period=await p.evaluate(k=>mygrainEqAutomationClock(k).duration,key),positions=[];
  for(let i=0;i<12;i++){await p.waitForTimeout(period*1000/12);positions.push(await handle.getAttribute('style'));}
  assert(new Set(positions).size>2,'handle did not animate');
  await p.locator('#channelEqClose').click();
  console.log('PASS',engine,key,'real clock W/R, handle drag and playback',recorded);
 }
 // Both public export formats carry the same completed takes; old patches clear it.
 const recall=await p.evaluate(()=>{stopBastardLoopX();stopBastardLoopL();const preset=gatherPreset(),snap=saveState({force:true,snapshotOnly:true});const expected=JSON.stringify(preset.channelEq);mygrainChannelEq.restore();applyPreset(JSON.parse(JSON.stringify(preset)));const legacy=JSON.stringify(mygrainChannelEq.settings())===expected;mygrainChannelEq.restore();restoreState({state:JSON.parse(JSON.stringify(snap)),songSnapshot:true,throwOnError:true});return {legacy,snapshot:JSON.stringify(mygrainChannelEq.settings())===JSON.stringify(snap.modes.channelEq),counts:['X','L'].map(k=>mygrainChannelEq.get(k).automation.points.length)};});assert(recall.legacy&&recall.snapshot,JSON.stringify(recall));
 const zip=await p.evaluate(async()=>{const expected=JSON.stringify(mygrainChannelEq.settings()),blob=await buildPatchZipBlob('automation-test.zip'),bytes=await blob.arrayBuffer(),entries=parseStoredZipEntries(bytes),stored=JSON.parse(getZipText(entries,'song-part.json'));if(JSON.stringify(stored.state.modes.channelEq)!==expected)throw Error('ZIP dropped automation');mygrainChannelEq.restore();await openPatchZipFromArrayBuffer(bytes,'automation-test.zip');return {exact:JSON.stringify(mygrainChannelEq.settings())===expected,bytes:blob.size}});assert(zip.exact,JSON.stringify(zip));console.log('PASS',engine,'actual exported ZIP import',zip);
 // Actual left/right native PCM routing remains finite through continuous changes.
 const pcm=await p.evaluate(async()=>{const eq=MygrainChannelEq.create();eq.restore(mygrainChannelEq.settings());const ctx=new AudioContext(),source=ctx.createOscillator(),gain=ctx.createGain(),meter=ctx.createAnalyser();gain.gain.value=.08;source.connect(gain);const route=eq.connect('X',gain,meter);await eq.prepareAutomation('X');await new Promise(r=>setTimeout(r,70));meter.connect(ctx.destination);source.start();const v=eq.get('X');v.enabled=true;eq.set('X',v);let peak=0,jump=0;for(let i=0;i<35;i++){const a=MygrainEqAutomation.interpolate(v.automation.points,i/35);eq.automate('X',a);await new Promise(r=>setTimeout(r,10));const data=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(data);for(let j=1;j<data.length;j++)jump=Math.max(jump,Math.abs(data[j]-data[j-1]));for(const x of data){if(!Number.isFinite(x))throw Error('nonfinite audio');peak=Math.max(peak,Math.abs(x));}}const prepared=eq.diagnostics();source.stop();route.disconnect();await ctx.close();return {peak,jump,prepared,transitions:eq.diagnostics().transitions};});assert(pcm.prepared.automated===1&&pcm.prepared.automationErrors.length===0&&pcm.peak>0&&pcm.peak<2&&pcm.jump<.08,JSON.stringify(pcm));
 for(const width of [390,1280]){await p.setViewportSize({width,height:900});await p.evaluate(()=>mygrainChannelEqUi.open('X'));assert(await p.evaluate(()=>document.getElementById('channelEqDialog').scrollWidth<=document.getElementById('channelEqDialog').clientWidth+1),'dialog overflow');await p.locator('#channelEqClose').click();}
 await p.locator('.channel-eq-entry [data-eq-automation="X"] [data-eq-auto="remove"]').click();assert.equal(await p.evaluate(()=>mygrainChannelEq.get('X').automation||null),null);assert(await p.evaluate(()=>!!mygrainChannelEq.get('L').automation));
 assert.deepEqual(errors,[]);console.log('PASS',engine,'patch recall, PCM, mobile layout, independent delete',recall,pcm);await c.close();
 }finally{await b.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
