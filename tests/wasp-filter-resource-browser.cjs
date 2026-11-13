'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19245/mygrain/',out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp/mygrain-wasp-filter-resources';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);fs.mkdirSync(out,{recursive:true});
(async()=>{
 for(const[name,type,phone]of[['webkit-phone',webkit,true],['chromium-phone',chromium,true],['webkit-desktop',webkit,false],['chromium-desktop',chromium,false]]){
  if(process.env.MYGRAIN_TEST_CASES&&!process.env.MYGRAIN_TEST_CASES.split(',').includes(name))continue;
  const browser=await type.launch(type===chromium?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{
   const context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1400,height:1000},isMobile:phone,hasTouch:phone,...(phone?{userAgent:type===webkit?'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/142.0.0.0 Mobile/15E148 Safari/604.1'}:{})});
   assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(45000);page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.stack)});
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   await page.goto(base);await page.waitForFunction(()=>window.mygrainLayerControls&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);
   await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   assert.equal(await page.locator('#waspPower').count(),0,'startup test must keep Wasp editor cold');
   const setup=await page.evaluate(async()=>{
    setFxMuted(true,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);setDrumMachineEnabled(false,{silent:true,skipSave:true});
    for(const id of ['finalCompressorAmount','finalSidechainAmount','finalDriveSoft','finalDriveHard','finalDriveFold','finalDriveCrush','finalReverbMix','finalDelayDepth'])setSliderValue(id,0);
    const ctx=audioContext,b=ctx.createBuffer(2,ctx.sampleRate,ctx.sampleRate);for(let ch=0;ch<2;ch++)for(let i=0;i<b.length;i++)b.getChannelData(ch)[i]=.04*Math.sin(2*Math.PI*220*i/b.sampleRate);
    bastardLoopBuffer=b;bastardLoopSourceBpm=120;bastardLoopMetadata={bpm:120,durationSeconds:1};setBastardLoopEnabled(true,{silent:true,skipSave:true});setLoopLayerSolo('bastarda',{silent:true,skipSave:true});
    mygrainLoopFx.restore(MygrainLoopFx.normalize());
    const s=MygrainWasp.normalize();s.enabled=false;s.melt=1;s.blend=1;s.routes[0]={...s.routes[0],enabled:true,source:'V',destination:'A',method:'highpass',cutoff:6000,depth:1,sensitivity:24};s.routes[1].enabled=false;await mygrainWasp.restore(s);
    window.__waspWarm=[];const Original=window.AudioWorkletNode;window.AudioWorkletNode=class extends Original{constructor(ctx,name,options){super(ctx,name,options);if(name==='mygrain-wasp-v1'){const copy=options.processorOptions.settings.routes.map(r=>({...r}));this.port.addEventListener('message',e=>{if(e.data.warmed)__waspWarm.push(copy)});this.port.start()}}};
    const osc=ctx.createOscillator(),gain=ctx.createGain(),mute=ctx.createGain(),tap=ctx.createScriptProcessor(2048,2,2),captureMute=ctx.createGain();osc.frequency.value=47;gain.gain.value=.07;mute.gain.value=0;captureMute.gain.value=0;osc.connect(gain);mute.connect(ctx.destination);
    const route=mygrainWasp.connect('V',gain,mute,osc);osc.start();finalAmplifierNode.connect(tap);tap.connect(captureMute);captureMute.connect(ctx.destination);
    let samples=[];tap.onaudioprocess=e=>samples.push(...e.inputBuffer.getChannelData(0));window.__measureWasp=async()=>{await new Promise(r=>setTimeout(r,400));samples=[];await new Promise(r=>setTimeout(r,2000));if(!samples.length)throw Error('No final-output PCM');return Math.sqrt(samples.reduce((s,v)=>s+v*v,0)/samples.length)};
    window.__cleanWaspProbe=()=>{osc.stop();route.disconnect();gain.disconnect();mute.disconnect();finalAmplifierNode.disconnect(tap);tap.disconnect();captureMute.disconnect()};
    setBastardLoopPlaying(true,{silent:true,skipSave:true});mygrainDisplay.reveal(document.getElementById('performanceLayerSwitchesCard'));
    return{routes:s.routes,playing:bastardLoopPlaying};
   });
   assert(setup.playing);const dry=await page.evaluate(()=>__measureWasp()),cycles=[];assert(dry>1e-5);
   const tap=async()=>{const b=page.locator('#performanceLayerWaspOnBtn');await b.scrollIntoViewIfNeeded();if(phone)await b.tap();else await b.click();await page.waitForFunction(()=>!mygrainCardHistory.busy)};
   for(let i=0;i<3;i++){
    await tap();await page.waitForFunction(()=>mygrainWasp.settings().enabled);if(phone)await page.waitForFunction(n=>__waspWarm.length===n,i+1);
    const active=await page.evaluate(()=>__measureWasp());assert(active<dry*.2,JSON.stringify({dry,active}));
    assert.deepEqual(await page.evaluate(()=>mygrainWasp.settings().routes),setup.routes);assert(await page.evaluate(()=>bastardLoopPlaying));
    assert.equal(await page.locator('#waspPower').count(),0);await tap();const bypass=await page.evaluate(()=>__measureWasp());assert(Math.abs(bypass/dry-1)<.15,JSON.stringify({dry,bypass}));cycles.push({active,bypass});
   }
   await page.evaluate(async()=>{const s=mygrainWasp.settings();s.routes[1]={...s.routes[1],enabled:true,source:'V',destination:'A',method:'frequency',depth:.2};await mygrainWasp.restore(s)});await tap();if(phone)await page.waitForFunction(()=>__waspWarm.length===4);
   const both=await page.evaluate(()=>({settings:mygrainWasp.settings(),diagnostics:mygrainWasp.diagnostics(),playing:bastardLoopPlaying}));assert(both.settings.routes[0].enabled&&both.settings.routes[1].enabled&&both.playing);assert.equal(both.diagnostics.error,'');
   await page.locator('#performanceLayerWaspJumpBtn').click();await page.waitForSelector('#waspPower');await page.waitForFunction(()=>document.documentElement.dataset.mygrainJumping!=='true');
   assert.equal(await page.locator('#waspPower').getAttribute('aria-pressed'),'true');assert(await page.locator('[data-wasp-route="0"] input[data-wasp="enabled"]').isChecked());assert(await page.locator('[data-wasp-route="1"] input[data-wasp="enabled"]').isChecked());assert(await page.evaluate(()=>bastardLoopPlaying));
   const zip=await page.evaluate(async()=>{const expected=mygrainWasp.settings(),blob=await mygrainSongBetaAdapter.capture(),bytes=await blob.arrayBuffer(),part=await mygrainSongBetaAdapter.decode(bytes,{buffers:new Map(),bytes:0,reservedBytes:0,limitBytes:96*1048576});mygrainSongBetaAdapter.recall(part,{start:false});await mygrainWasp.whenReady();return{expected,restored:mygrainWasp.settings(),bytes:bytes.byteLength}});assert.deepEqual(zip.restored,zip.expected);
   await page.evaluate(async()=>{__cleanWaspProbe();stopAllPerformancePlayback({silent:true});await mygrainWasp.restore({...mygrainWasp.settings(),enabled:false,playground:{...mygrainWasp.settings().playground,enabled:false}})});
   const filters=await page.evaluate(async()=>{
    const buffer=bastardLoopBuffer;setBastardLoopEnabled(true,{silent:true,skipSave:true});bastardLoop2Buffer=buffer;setBastardLoop2Enabled(false,{silent:true,skipSave:true});setLoopLayerSolo('bastarda',{silent:true,skipSave:true});
    const seed=()=>{const s=MygrainLoopFx.normalize();for(const c of Object.values(s.channels))Object.assign(c,{filterEnabled:true,cutoff:1200,lfoDepth:.03});mygrainLoopFx.restore(s);return mygrainLoopFx.settings()};
    seed();const ctx=audioContext,osc=ctx.createOscillator(),mute=ctx.createGain();mute.gain.value=0;mute.connect(ctx.destination);const route=mygrainLoopFx.connect('B',osc,mute,osc);osc.start();const group=[...mygrainLoopFx.groups].find(g=>g.key==='B'&&g.destination===mute);
    const before=group.graph.diagnostics();mygrainLoopFx.randomise();await new Promise(r=>setTimeout(r,220));const random={state:mygrainLoopFx.settings(),keys:mygrainLoopFx.filterActiveKeys(),b:group.graph.diagnostics(),filters:group.graph.filters.length};
    const initial=seed();await randomizeBastardLoopLPattern();await new Promise(r=>setTimeout(r,220));const generated=mygrainLoopFx.settings(),pruned=group.graph.diagnostics();await mygrainCardHistory.undo();const undone=mygrainLoopFx.settings();await mygrainCardHistory.redo();const redone=mygrainLoopFx.settings();
    const neutral=mygrainLoopFx.settings();Object.assign(neutral.channels.A,{filterEnabled:true,cutoff:18000,lfoDepth:0,resonance:.707});mygrainLoopFx.restore(neutral);await randomizeBastardLoopLPattern();const noOp=mygrainLoopFx.settings().channels.A.filterEnabled;
    const staticFilter=mygrainLoopFx.settings();Object.assign(staticFilter.channels.A,{filterEnabled:true,cutoff:1800,lfoDepth:0});mygrainLoopFx.restore(staticFilter);await randomizeBastardLoopLPattern();const staticOn=mygrainLoopFx.settings().channels.A.filterEnabled;
    const aiBefore=seed(),adapter=mygrainAiPatchAdapter;const applied=await adapter.execute({title:'Filter eligibility fixture',parameters:{globalBpmSlider:Number(document.getElementById('globalBpmSlider').value)===117?118:117},loops:{}},adapter.fingerprint());const aiAfter=mygrainLoopFx.settings();const aiFingerprint=applied.fingerprint===adapter.fingerprint();await adapter.undo(applied.before,adapter.fingerprint());const aiUndo=mygrainLoopFx.settings();
    const saved=mygrainLoopFx.settings(),blob=await mygrainSongBetaAdapter.capture(),part=await mygrainSongBetaAdapter.decode(await blob.arrayBuffer(),{buffers:new Map(),bytes:0,reservedBytes:0,limitBytes:96*1048576});mygrainLoopFx.restore(MygrainLoopFx.normalize());mygrainSongBetaAdapter.recall(part,{start:false});const recalled=mygrainLoopFx.settings();
    route.disconnect();osc.stop();mute.disconnect();return{before,random,initial,generated,pruned,undone,redone,noOp,staticOn,aiBefore,aiAfter,aiFingerprint,aiUndo,saved,recalled};
   });
   assert(filters.before.filterOn&&filters.before.lfoOn);assert(!filters.random.b.filterOn&&!filters.random.b.lfoOn&&filters.random.filters===0);
   for(const[key,c]of Object.entries(filters.random.state.channels))if(c.filterEnabled)assert(filters.random.keys.includes(key),key);
   assert(filters.generated.channels.A.filterEnabled);assert(!filters.generated.channels.B.filterEnabled);assert(!filters.pruned.lfoOn);assert.deepEqual(filters.undone,filters.initial);assert.deepEqual(filters.redone,filters.generated);
   assert.equal(filters.noOp,false);assert.equal(filters.staticOn,true);assert(!filters.aiAfter.channels.B.filterEnabled);assert(filters.aiFingerprint);assert.deepEqual(filters.aiUndo,filters.aiBefore);assert.deepEqual(filters.recalled,filters.saved);
   await page.keyboard.press('Escape');await page.evaluate(()=>{mygrainDisplay.reveal(document.getElementById('performanceLayerSwitchesCard'));document.getElementById('performanceLayerWaspOnBtn').scrollIntoView({block:'center'})});
   if(phone){await page.setViewportSize({width:844,height:390});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:390,height:844})}
   await page.screenshot({path:out+'/'+name+'.png'});assert.deepEqual(errors,[]);
   fs.writeFileSync(out+'/'+name+'.json',JSON.stringify({name,dry,cycles,both,zip,filters,errors},null,2));console.log('PASS',name,'cold running Wasp / route warmup / real output / pruning / history / ZIP / AI undo');await context.close();
  }finally{await browser.close()}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
