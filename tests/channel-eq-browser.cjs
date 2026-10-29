// Native Web Audio + real channel routing, input, history and legacy persistence.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18948/mygrain/',out=process.env.EQ_EVIDENCE||'/tmp/mygrain-channel-eq/evidence';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);fs.mkdirSync(out,{recursive:true});
(async()=>{const results=[];
for(const [engine,type] of Object.entries({chromium,webkit})){
 if(process.env.EQ_ENGINE&&process.env.EQ_ENGINE!==engine)continue;
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{for(const mobile of [false,true]){
  if(process.env.EQ_MOBILE&&process.env.EQ_MOBILE!==String(mobile))continue;
  const c=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
  const registration=await c.request.post(base+'api/auth/register',{data:{username:`eq_${engine[0]}_${+mobile}_${Date.now()}`,password:'isolated-eq-audio-fixture'}});assert.equal(registration.status(),200);
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  await p.goto(base);await p.waitForFunction(()=>window.mygrainChannelEqUi&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  assert.equal(await p.locator('[data-eq-channel]').count(),26);
  const native=await p.evaluate(async()=>{
   const E=MygrainChannelEq,results=[];
   const render=async(key,band,enabled,sampleRate=48000,tone=1000)=>{
    const context=new OfflineAudioContext(1,sampleRate,sampleRate),runtime=E.create(),settings=E.defaults();settings.enabled=enabled;settings.bands.forEach(b=>b.enabled=false);settings.bands[1]={...settings.bands[1],...band,enabled:true};runtime.set(key,settings);
    let allocations=0;const native=context.createIIRFilter.bind(context);context.createIIRFilter=(...a)=>{allocations++;return native(...a)};
    const source=context.createBufferSource(),buffer=context.createBuffer(1,sampleRate,sampleRate);for(let i=0;i<sampleRate;i++)buffer.getChannelData(0)[i]=.01*Math.sin(2*Math.PI*tone*i/sampleRate);source.buffer=buffer;
    const route=runtime.connect(key,source,context.destination,source);const before=runtime.diagnostics();source.start();const rendered=await context.startRendering(),data=rendered.getChannelData(0);let sum=0,original=0,maxError=0;
    for(let i=Math.floor(sampleRate*.5);i<data.length;i++){if(!Number.isFinite(data[i]))throw Error('Non-finite EQ audio');sum+=data[i]*data[i];original+=buffer.getChannelData(0)[i]**2;maxError=Math.max(maxError,Math.abs(data[i]-buffer.getChannelData(0)[i]));}
    route.disconnect();return{db:10*Math.log10(sum/original),expected:E.response(settings,[tone],sampleRate)[0],maxError,allocations,before,after:runtime.diagnostics()};
   };
   for(const key of E.KEYS){const bypass=await render(key,{type:'bell',frequency:1000,gain:-12,q:2,slope:12},false),active=await render(key,{type:'bell',frequency:1000,gain:-12,q:2,slope:12},true);if(bypass.allocations||bypass.maxError>1e-9||Math.abs(active.db+12)>.02||active.after.routes)throw Error(JSON.stringify({key,bypass,active}));results.push({key,db:active.db,bypassExact:true});}
   const shapes=[];
   for(const rate of [44100,48000])for(const type of E.TYPES){const result=await render('A',{type,frequency:1000,gain:12,q:Math.SQRT1_2,slope:96},true,rate,['lowpass','highpass'].includes(type)?1000:type==='lowshelf'?100:10000);if(Math.abs(result.db-result.expected)>.06)throw Error(JSON.stringify({type,rate,result}));shapes.push({type,rate,db:result.db,expected:result.expected});}
   return{channels:results,shapes};
  });
  const stereoPeak=await p.evaluate(async()=>{
   const runtime=MygrainChannelEq.create(),value=MygrainChannelEq.defaults();value.enabled=true;runtime.set('A',value);
   const source=audioContext.createBufferSource(),buffer=audioContext.createBuffer(2,audioContext.sampleRate,audioContext.sampleRate);
   for(let i=0;i<buffer.length;i++){const v=.01*Math.sin(2*Math.PI*1000*i/buffer.sampleRate);buffer.getChannelData(0)[i]=v;buffer.getChannelData(1)[i]=-v;}
   source.buffer=buffer;source.loop=true;const route=runtime.connect('A',source,audioContext.destination,source);runtime.watch('A');source.start();await new Promise(r=>setTimeout(r,240));const peak=Math.max(...runtime.spectra('A')[0].values);runtime.watch(null);route.disconnect();source.stop();return peak;
  });assert(stereoPeak>-90,`Anti-phase stereo spectrum missing: ${stereoPeak}`);
  // Real Loop A path: settled bypass creates no filters; changes stay on the same source clock.
  await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});const b=audioContext.createBuffer(2,audioContext.sampleRate,audioContext.sampleRate);for(let ch=0;ch<2;ch++)for(let i=0;i<b.length;i++)b.getChannelData(ch)[i]=.04*Math.sin(2*Math.PI*1000*i/b.sampleRate);bastardLoopBuffer=b;bastardLoopSourceBpm=120;bastardLoopMetadata={bpm:120,durationSeconds:1};setBastardLoopEnabled(true,{silent:true,skipSave:true});startBastardLoop();window.__eqOriginalSource=bastardLoopSource;});
  const baseline=await p.evaluate(()=>mygrainChannelEq.diagnostics());assert.equal(baseline.filters,0);assert.equal(baseline.analysers,0);assert.equal(baseline.channels.A.routes,1);
  await p.evaluate(()=>mygrainChannelEqUi.open('A'));
  const box=await p.locator('#channelEqDialog').boundingBox();assert(box.x>=0&&box.x+box.width<=await p.evaluate(()=>innerWidth)+1);
  await p.locator('[data-eq-band="1"] [data-eq-field="frequency"]').fill('1000');await p.locator('[data-eq-band="1"] [data-eq-field="frequency"]').press('Tab');
  await p.locator('[data-eq-band="1"] [data-eq-field="gain"]').fill('-12');await p.locator('[data-eq-band="1"] [data-eq-field="gain"]').press('Tab');
  await p.locator('#channelEqEnabled').check();await p.waitForFunction(()=>!mygrainCardHistory.busy&&mygrainChannelEq.diagnostics().filters===1);await p.waitForTimeout(90);
  assert.equal(await p.evaluate(()=>bastardLoopSource===__eqOriginalSource),true);assert.equal(await p.evaluate(()=>mygrainChannelEq.diagnostics().analysers),2);
  const historyBefore=await p.evaluate(()=>mygrainCardHistory.counts.undo);
  const handle=p.locator('[data-eq-handle="1"]'),bounds=await handle.boundingBox();
  await p.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await p.mouse.down();await p.mouse.move(bounds.x+bounds.width/2+35,bounds.y+bounds.height/2-30,{steps:6});await p.mouse.up();
  await p.waitForFunction(()=>!mygrainCardHistory.busy);const dragged=await p.evaluate(()=>mygrainChannelEq.get('A'));assert(dragged.bands[1].frequency>1000);assert(dragged.bands[1].gain>-12);assert.equal(await p.evaluate(()=>mygrainCardHistory.counts.undo),historyBefore+1);
  await p.evaluate(()=>mygrainCardHistory.undo());await p.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await p.evaluate(()=>mygrainChannelEq.get('A').bands[1].frequency),1000);
  await p.evaluate(()=>mygrainCardHistory.redo());await p.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await p.evaluate(()=>mygrainChannelEq.get('A').bands[1].frequency),dragged.bands[1].frequency);
  // Q is available on shelves; cut shapes expose 96 dB/oct and disable meaningless gain.
  await p.selectOption('[data-eq-band="0"] [data-eq-field="type"]','highpass');await p.selectOption('[data-eq-band="0"] [data-eq-field="slope"]','96');assert(await p.locator('[data-eq-band="0"] [data-eq-field="gain"]').isDisabled());
  await p.selectOption('[data-eq-band="3"] [data-eq-field="type"]','highshelf');await p.locator('[data-eq-band="3"] [data-eq-field="q"]').fill('2.5');await p.locator('[data-eq-band="3"] [data-eq-field="q"]').press('Tab');
  await p.locator('#channelEqDialog').screenshot({path:`${out}/${engine}-${mobile?'phone':'desktop'}.png`});
  await p.locator('#channelEqClose').click();await p.waitForTimeout(70);assert.equal(await p.evaluate(()=>mygrainChannelEq.diagnostics().analysers),0);assert(await p.evaluate(()=>mygrainChannelEq.diagnostics().filters)>0);
  // Legacy import resets ALL EQs, even after a previous patch had them enabled.
  const persistence=await p.evaluate(async()=>{const settings=mygrainChannelEq.settings(),preset=gatherPreset(),snapshot=saveState({force:true,snapshotOnly:true});if('' in snapshot.selects)throw Error('EQ popup leaked an anonymous select into patch state');const legacy=JSON.parse(JSON.stringify(preset));delete legacy.channelEq;applyPreset(legacy);const legacyOff=Object.values(mygrainChannelEq.settings().channels).every(c=>!c.enabled);applyPreset(preset);const exact=JSON.stringify(mygrainChannelEq.settings())===JSON.stringify(settings);const legacyState=JSON.parse(JSON.stringify(snapshot));delete legacyState.modes.channelEq;restoreState({state:legacyState,songSnapshot:true,throwOnError:true});const oldSongOff=Object.values(mygrainChannelEq.settings().channels).every(c=>!c.enabled);restoreState({state:snapshot,songSnapshot:true,throwOnError:true});saveState({force:true});return{legacyOff,oldSongOff,exact,settings,extra:(await mygrainSongBetaAdapter.capture({liveOnly:true})).snapshot.extra.controls.some(c=>c.id==='channelEqEnabled')};});
  assert(persistence.legacyOff&&persistence.oldSongOff&&persistence.exact);assert.equal(persistence.extra,false);
  // Disable every EQ: no hidden filters, analysers, or transition nodes remain.
  await p.evaluate(()=>{for(const key of MygrainChannelEq.KEYS){const v=mygrainChannelEq.get(key);v.enabled=false;mygrainChannelEq.set(key,v)}});await p.waitForTimeout(100);const bypass=await p.evaluate(()=>mygrainChannelEq.diagnostics());assert.equal(bypass.filters,0);assert.equal(bypass.analysers,0);assert.equal(bypass.transitions,0);
  await p.evaluate(()=>stopAllPerformancePlayback({silent:true}));await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>mygrainChannelEq.diagnostics().routes),0);
  for(const viewport of mobile?[{width:320,height:640},{width:844,height:390}]:[{width:1280,height:900}]){await p.setViewportSize(viewport);await p.evaluate(()=>mygrainChannelEqUi.open('K5'));const box=await p.locator('#channelEqDialog').boundingBox();assert(box.x>=0&&box.x+box.width<=viewport.width+1);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await p.locator('#channelEqClose').click();}
  assert.deepEqual(errors,[]);results.push({engine,mobile,native,stereoPeak,bypass,persistence:{legacyOff:persistence.legacyOff,oldSongOff:persistence.oldSongOff,exact:persistence.exact},entries:26});console.log('PASS',engine,mobile);fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));await c.close();
 }}finally{await browser.close()}
}
})().catch(e=>{console.error(e);process.exitCode=1});
