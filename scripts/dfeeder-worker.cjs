/* Private stdin-only worker: a disposable editor, no user's patch or Song writes. */
'use strict';
const fs=require('node:fs'),{chromium}=require('playwright-core');
let activeBrowser=null;for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{const deadline=setTimeout(()=>process.exit(143),7000);deadline.unref();Promise.resolve(activeBrowser?.close()).catch(()=>{}).finally(()=>process.exit(143));});
const analysisCode=fs.readFileSync(__dirname+'/../loop-balance.js','utf8');
const balanceWorklet=fs.readFileSync(__dirname+'/../mastering-dsp.js','utf8')+'\n'+analysisCode+'\n'+fs.readFileSync(__dirname+'/dfeeder-balance-worklet.cjs','utf8');
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
let browserJobs=0,browserLaunches=0;
async function render(job){
 const base=new URL(job.baseUrl);
 if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||base.pathname!=='/mygrain/')throw Error('Loopback Dfeeder renderer required');
 if(!Array.isArray(job.bpms)||job.bpms.length>100||job.bpms.some(n=>!Number.isInteger(n)||n<68||n>178))throw Error('Invalid batch plan');
 const indices=job.indices??job.bpms.map((_,index)=>index);
 if(!Array.isArray(indices)||!indices.length||new Set(indices).size!==indices.length||indices.some(n=>!Number.isInteger(n)||n<0||n>=job.bpms.length))throw Error('Invalid batch indices');
 const mode=job.mode||'native',key=job.key||'random',tone=job.tone||'minimal',pot=job.pot||'legacy';
 if(!['minimal','tonal'].includes(tone)||tone==='tonal'&&mode!=='loop'||!['legacy','off','random'].includes(pot)||mode==='native'&&pot!=='legacy')throw Error('Invalid shop steering');
 if(!['native','loop','ember','drone'].includes(mode)||!['random','C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].includes(key)||(mode!=='drone'&&key!=='random'))throw Error('Invalid generation mode or drone key');
 const chord=job.chord||'single',octaves=job.octaves===undefined?4:job.octaves;
 const harmony=require('../enemy-drone-harmony.js');if(!['single',...harmony.CHORDS.map(c=>c.id)].includes(chord)||![1,2,3,4].includes(octaves)||mode!=='drone'&&(chord!=='single'||octaves!==4))throw Error('Invalid Drone harmony');
 const genre=job.genre||'';if(genre&&(mode!=='loop'||typeof genre!=='string'||!/^[a-z0-9-]{1,40}$/.test(genre)))throw Error('Invalid genre steering');
 let genrePlan=null;
 if(!activeBrowser?.isConnected()){activeBrowser=await chromium.launch({executablePath:process.env.MYGRAIN_CHROMIUM||'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required','--js-flags=--max-old-space-size=1536']});browserLaunches++;}
 const browser=activeBrowser;
 try{
  for(const index of indices){
  for(let attempt=0;attempt<3;attempt++){
   // A fresh context each run bounds sample/DSP/IDB residency and avoids previous-run state.
   const context=await browser.newContext({viewport:{width:1280,height:900}});
   try{
    // Host transport only: keep native rendering/DSP identical on an isolated host.
    // Real cookies also authenticate nested AudioWorklet fetches.
    const cookies=job.cookie.split(';').map(x=>x.trim()).filter(x=>x.includes('=')).map(x=>{const i=x.indexOf('=');return{name:x.slice(0,i),value:x.slice(i+1),url:base.origin,httpOnly:true,sameSite:'Lax'};});
    if(process.env.MYGRAIN_ENGINE_KEY_FILE)cookies.push({name:'demand_engine_key',value:fs.readFileSync(process.env.MYGRAIN_ENGINE_KEY_FILE,'utf8').trim(),url:base.origin,httpOnly:true,sameSite:'Lax'});
    await context.addCookies(cookies);
    const page=await context.newPage(),errors=[];page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>{const u=new URL(r.request().url()),method=r.request().method();if(u.origin!==base.origin)return r.abort();
     // Only the existing stateless source-generation request may POST. No save,
     // upload, feedback, account, Song, AI or review write can escape the deck.
     if(!['GET','HEAD'].includes(method)&&!(method==='POST'&&['/mygrain-bastardloops/api/bastardloop','/mygrain-bastardloops/api/source-sample'].includes(u.pathname)))return r.abort();
     return r.continue();});
    await page.exposeFunction('dfeederStage',message=>emit({stage:`${index+1}/${job.bpms.length} · ${message}`}));
    await page.exposeFunction('dfeederWrite',encoded=>{const data=Buffer.from(encoded,'base64');if(data.length>64*1048576)throw Error('Loop exceeds WAV budget');fs.writeFileSync(`${job.outputDir}/${String(index).padStart(4,'0')}.wav`,data,{mode:0o600});});
    await page.exposeFunction('dfeederSnapshot',(encoded,first)=>{const data=Buffer.from(encoded,'base64'),target=`${job.outputDir}/${String(index).padStart(4,'0')}.zip`;if((first?0:(fs.existsSync(target)?fs.statSync(target).size:0))+data.length>192*1048576)throw Error('Source snapshot exceeds 192 MiB');fs.writeFileSync(target,data,{flag:first?'w':'a',mode:0o600});});
    await page.goto(base.href);await page.waitForFunction(()=>window.mygrainCookingPot&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');
    await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').click();
    await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy&&!window.mygrainSongBeta?.busy);
    if(mode!=='native')await page.waitForFunction(()=>window.mygrainEmber&&window.mygrainEnemyDrone);
    if(genre&&!genrePlan){
     try{
     emit({stage:'Genre steer · native LLM is planning your batch · up to 3 minutes if a proposal needs repair…'});
     const snapshot=await page.evaluate(async()=>{const schema=await(await fetch('ai-patch-controls.json')).json();return{current:mygrainAiPatchAdapter.read(Object.keys(schema.controls)),loops:mygrainAiPatchAdapter.inventory({forModel:true})};});
     const headers={'Content-Type':'application/json','Cookie':job.cookie};if(process.env.MYGRAIN_ENGINE_KEY_FILE)headers['X-Demand-Key']=fs.readFileSync(process.env.MYGRAIN_ENGINE_KEY_FILE,'utf8').trim();
     const response=await fetch(new URL('api/shop-genre-plan',base),{method:'POST',headers,body:JSON.stringify({jobId:job.id,...snapshot}),signal:AbortSignal.timeout(185000)});
     const planned=await response.json();if(!response.ok||!planned.ok)throw Error(planned.error||'Native genre planning failed');genrePlan=planned;
     }catch(error){error.genrePlanFailed=true;throw error;}
    }
    if(mode==='native'||mode==='loop'||mode==='ember')await page.addScriptTag({content:analysisCode});
    const result=await page.evaluate(async({bpm,index,seed,mode,key,tone,pot,chord,octaves,genre,genrePlan,balanceWorklet,retainSource})=>{
     let r=seed>>>0;const random=()=>{r^=r<<13;r^=r>>>17;r^=r<<5;return(r>>>0)/4294967296;};Math.random=random;
     const pick=a=>a[Math.floor(random()*a.length)],shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
     stopAllPerformancePlayback({silent:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});
     mygrainPower?.set(false,{silent:true});await mygrainPower?.whenReady();
     const layered=mode==='native'||mode==='loop',useEmber=mode==='loop'||mode==='ember',useDrone=mode==='drone';
     const off={silent:true,skipSave:true};for(const layer of SPARSE_RANDOM_LAYER_DEFINITIONS)layer.setEnabled(false,off);setDrumMachineEnabled(false,off);
     mygrainEmber?.set({enabled:false});mygrainEmber?.stop();mygrainEnemyDrone?.set({enabled:false});mygrainEnemyDrone?.stop();
     await mygrainAcousticFx.off();await mygrainResonator.off();await mygrainTurntable.off();await mygrainWasp.restore();mygrainBassFace.restore();mygrainD.setMutilator({enabled:false},off);await mygrainMasterBaker.randomiseOff();
     mygrainLoopFx.restore();mygrainChannelEq.restore();mygrainEffectOutput.restore();
     applyGlobalBpm(bpm);syncPatternLengthControls(64,{skipSave:true});setSliderValue('volume',80);
     const allowed=['bastarda','bastardb','bastardc','bastardd','bastardw','dropbox'];
     const laneKey={A:'bastarda',B:'bastardb',C:'bastardc',D:'bastardd',W:'bastardw',P:'bastardp',O:'bastardo',L:'bastardl',X:'bastardx'};
     const selected=genrePlan?Object.entries(genrePlan.recipe.loops).filter(([,lane])=>lane.enabled).map(([key])=>laneKey[key]):layered?shuffle(allowed).slice(0,2+Math.floor(random()*5)):[];
     if(pot==='random'&&mode==='loop'&&!genrePlan)while(selected.filter(k=>k!=='bastardd').length<2)selected.push(pick(allowed.filter(k=>k!=='bastardd'&&!selected.includes(k))));
     if(!genrePlan&&tone==='tonal')selected.push(pick(['bastardp','bastardo']),'bastardl','bastardx');
     const selectedSet=new Set([...selected,...(useEmber?['bastarde']:[]),...(useDrone?['enemy']:[])]);
     if(genrePlan){
      await window.dfeederStage('Genre steer · applying native sources, notes and drum patterns');
      const recipe=structuredClone(genrePlan.recipe);recipe.parameters.globalBpmSlider=bpm;
      await mygrainAiPatchAdapter.execute(recipe,mygrainAiPatchAdapter.fingerprint(),{mode:'generate',protectEq:false,report:message=>window.dfeederStage('Genre steer · '+message)});
      // Keep native recipe timing/levels. Fresh drum sample reloads and generated
      // source cuts plus Ember produce new audio on every isolated variation.
      syncPatternLengthControls(64,{skipSave:true});
      drumMachineExtraTracks.cymbals.level=0;setSliderValue(drumMachineExtraTracks.cymbals.id+'Level',0);
     }
     if(layered&&!genrePlan){
     await window.dfeederStage('Loading Drums');
     await loadRandomDrumMachineSamples();randomizeMegaDrumMachineSettings();forceDrumMachineRandomTrackLevels();
     if(mode==='loop'){drumMachineExtraTracks.cymbals.level=0;setSliderValue(drumMachineExtraTracks.cymbals.id+'Level',0);}
     for(const apply of [applyBastardLoopDivisionSelection,applyBastardLoop2DivisionSelection,applyBastardLoop3DivisionSelection,applyBastardLoopWDivisionSelection])apply(['2','1'],{save:false});
     if(tone==='tonal'){applyBastardLoopPDivisionSelection(['2','1'],{save:false});applyBastardLoopODivisionSelection(['2','1'],{save:false});}
     const specs=buildMegaRandomBastardLoopTaskSpecs(bpm).filter(s=>['A','B','C','W','P','O'].includes(s.traceLayer)&&selectedSet.has(s.soloLayer));
     for(const spec of specs){await window.dfeederStage('Building Loop '+spec.traceLayer);await applyMegaRandomBastardLoopBuild(await requestMegaRandomBastardLoopBuild(spec));}
     if(tone==='tonal'){await window.dfeederStage('Building Lead and Bass');randomizeMegaBastardLoopLeadAndBassSettings();await loadBastardLoopLSampleFromSource();await loadBastardLoopXSampleFromSource();if(!bastardLoopLSampleBuffer||!bastardLoopXSampleBuffer)throw Error('Tonal samples did not load');}
     if(selectedSet.has('bastardd')){await window.dfeederStage('Loading Loop D');await mygrainD.load({repository:'samples_loops'},{batch:true});mygrainD.state.level=.35+random()*.25;mygrainD.sync();}
     if(selectedSet.has('dropbox')){await window.dfeederStage('Loading Restructure');randomizeMegaDropboxSampleLayerSettings();await loadDropboxSampleLayerFromSource();if(!window.mygrainRestructure?.ownsSource)setSliderValue('performanceDropboxSampleLevel',Math.min(70,getDropboxSampleLayerLevelValue({applyLayerToggle:false})*100));}
     }
     if(mode==='loop'){setSliderValue('performanceDrumMachineLevel',100);if(selectedSet.has('bastardd')){mygrainD.state.level=1;mygrainD.sync();}}
     if(useEmber){
      await window.dfeederStage(mode==='loop'?'Generating Ember after drums · starting at 40%':'Generating Ember · starting at 40%');
      await mygrainEmber.generatePatch();mygrainEmber.set({enabled:true,level:.4,tempo:null});
      await MygrainEmber.prepare(audioContext,mygrainEmber.settings());
     }
     let harmonyRoot;
     if(useDrone){
      await window.dfeederStage('Generating random Drone'+(key==='random'?'':' · '+key));
      await document.getElementById('enemyRandomAll').onclick();await mygrainCardHistory.ready;
      const state=mygrainEnemyDrone.settings();
      if(key!=='random'||chord!=='single'){harmonyRoot=key==='random'?MygrainDroneHarmony.NOTES[Math.floor(random()*12)]:key;mygrainEnemyDrone.set(MygrainDroneHarmony.constrain(state,{mode:chord==='single'?'single':'chord',root:harmonyRoot,chord,octaves},random));}
      mygrainEnemyDrone.set({enabled:true});await MygrainEnemyDrone.prepare(audioContext);
     }
     for(const layer of SPARSE_RANDOM_LAYER_DEFINITIONS)layer.setEnabled(selectedSet.has(layer.key),off);
     // Granular/oscillator/source-synthesis and unlisted loop layers never enter generation.
     setGranularLayersEnabled(false,off);setDrumMachineEnabled(layered,off);setDrumMachineDirectOutput(true,off);
     for(const [key,id]of [['bastarda','performanceBastardLoopLevel'],['bastardb','performanceBastardLoop2Level'],['bastardc','performanceBastardLoop3Level'],['bastardw','performanceBastardLoopWLevel'],['bastardp','performanceBastardLoopPLevel'],['bastardo','performanceBastardLoopOLevel']])if(!genrePlan&&selectedSet.has(key)&&document.getElementById(id))setSliderValue(id,25+Math.floor(random()*31));
     let effects=[],next={},effectTargets={};
     if(pot==='random'||pot==='legacy'&&layered){
     await window.dfeederStage(pot==='random'?'Cooking Pot · individual tracks (no drums or D)':'Randomising effects');
     const sourceKeys={bastarda:'A',bastardb:'B',bastardc:'C',bastardd:'D',bastardw:'W',dropbox:'sample',bastardp:'P',bastardo:'O',bastardl:'L',bastardx:'X'};
     const eligible=selected.filter(k=>k!=='bastardd').map(k=>sourceKeys[k]).concat(useEmber?['E']:[],useDrone?['Enemy']:[]);
     const targets=pot==='random'?shuffle(eligible).slice(0,3):[];
     if(pot==='random'&&mode==='loop'&&targets.length!==3)throw Error('Random Cooking Pot requires three eligible source tracks');
     const inputs=pot==='random'?eligible:selected.map(k=>({bastarda:'A',bastardb:'B',bastardc:'C',bastardd:'D',bastardw:'W',dropbox:'sample'}[k])).concat(['drums','drumKick','drumSnare','drumHat'],useEmber?['E']:[]);
     const ws=mygrainWasp.settings(),ac=mygrainAcousticFx.settings();
     const current={...ac,mutilator:mygrainD.state.mutilator,bassFace:mygrainBassFace.settings(),wasp:ws,playground:ws.playground,resonator:mygrainResonator.settings(),turntable:mygrainTurntable.settings()};
     const generated=MygrainCookingPot.randomiseParameters({effects:current,pot:mygrainCookingPot.settings(),output:mygrainEffectOutput.settings()},
      {inputs,waspInputs:inputs.filter(k=>MygrainWasp.KEYS.includes(k)),bpm,phone:false,acoustic:MygrainAcousticFx,mutilator:MygrainMutilator,bassFace:MygrainBassFace,turntable:MygrainTurntable,resonator:MygrainResonator,hose:MygrainHenrysHose,heavy:MygrainHeavyLifter,wasp:MygrainWasp,randomSamples:(...args)=>mygrainHeavyLifterAssets.randomSamples(...args)},random,1);
     effects=shuffle(MygrainCookingPot.KEYS.filter(k=>pot!=='random'||k!=='wasp')).slice(0,pot==='random'?targets.length:1+Math.floor(random()*3));const enabled=new Set(effects);next=generated.effects;
     for(const key of MygrainCookingPot.KEYS)next[key].enabled=enabled.has(key);
     if(pot==='random')effects.forEach((effect,i)=>{const target=targets[i],recipe=next[effect];effectTargets[effect]=target;if(effect==='resonator')recipe.slots=recipe.slots.map((slot,n)=>({...slot,enabled:n===0,level:n===0?Math.max(.45,slot.level):slot.level,source:target}));else if(['mutilator','bassFace','turntable','playground'].includes(effect))recipe.input=target;else recipe.source=target;if(effect==='playground'){recipe.routeKick=false;for(const lane of Object.values(recipe.modulation))lane.source='off';}});
     const routing=pot==='random'?MygrainCookingPot.shuffle(generated.pot,random):generated.pot;
     mygrainD.setMutilator(next.mutilator,{skipSave:true});mygrainBassFace.restore(next.bassFace);
     await mygrainAcousticFx.restore(Object.fromEntries(MygrainAcousticFx.KEYS.map(k=>[k,next[k]])));
     await mygrainResonator.restore(next.resonator);await mygrainTurntable.restore(next.turntable);await mygrainWasp.restore({...next.wasp,playground:next.playground});
     // Keep output audible, do not randomise terminal overall gain or main mute.
     mygrainEffectOutput.restore();await mygrainCookingPot.restore({...routing,power:undefined});await mygrainCookingPot.whenReady();
     }
     clearAllPerformanceSoloStates({silent:true,skipSave:true});
     const powers={bastarde:mygrainEmber.settings().enabled,enemy:mygrainEnemyDrone.settings().enabled,noise:mygrainNoise.settings().enabled,osc:oscillatorsEnabled,granular:granularLayersEnabled,sample:generatedSampleLayerEnabled,loop:generatedDryLoopEnabled,bastardv:bastardLoopVEnabled,bastardp:bastardLoopPEnabled,bastardo:bastardLoopOEnabled,bastardl:bastardLoopLEnabled,bastardx:bastardLoopXEnabled,bastardq:mygrainQ.state.enabled,bastardm:bastardLoopMEnabled,bastardmplus:bastardLoopMPlusEnabled,bastardk:bastardLoopKEnabled,bastarda:bastardLoopEnabled,bastardb:bastardLoop2Enabled,bastardc:bastardLoop3Enabled,bastardd:mygrainD.state.enabled,bastardw:bastardLoopWEnabled,dropbox:window.mygrainRestructure?.ownsSource?window.mygrainRestructure.settings().enabled:dropboxSampleLayerEnabled};const active=Object.keys(powers).filter(k=>powers[k]===true);
     const permitted=mode==='loop'?[...allowed,'bastarde',...(tone==='tonal'?['bastardp','bastardo','bastardl','bastardx']:[])]:mode==='ember'?['bastarde']:mode==='drone'?['enemy']:allowed;
     if(active.some(k=>!permitted.includes(k))||drumMachineEnabled!==layered||oscillatorsEnabled||granularLayersEnabled||generatedSampleLayerEnabled||generatedDryLoopEnabled||mygrainPower.divisor(audioContext)!==1)throw Error('Dfeeder source/quality guard failed');
     // Force gates again just before the canonical live-output renderer schedules sources.
     for(const l of SPARSE_RANDOM_LAYER_DEFINITIONS)l.setEnabled(selectedSet.has(l.key),off);
     await window.dfeederStage(`Rendering four bars at ${bpm} BPM · full quality`);
     // The canonical recorder owns its exact clock/window. Start autonomous
     // sources on that SAME frame without altering the editor or Song renderer.
     const transportStart=withBufferedTransportStart,meters=[],sourceMetrics={};let meterTimer,balanceSetup,balanceError;const balances=[];let postFxApplied,postFxVerified,postFxNode;
     if(mode==='loop'||layered&&selectedSet.has('dropbox')){
      await window.dfeederStage('Analysing post-FX drums and selected sources, including Restructure');
      const url=URL.createObjectURL(new Blob([balanceWorklet],{type:'text/javascript'}));
      try{await audioContext.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
     }
     const hasRestructure=layered&&selectedSet.has('dropbox'),balanceSources=mode==='loop'||hasRestructure;
     let balance=useEmber?{version:1,startLevel:.4,status:'single-source',effectiveLevel:.4}:null;
     const sampleMeters=()=>{if(tone==='tonal'){const candidates=[...[...mygrainLoopFx.groups].filter(g=>['L','X'].includes(g.key)&&g.context===audioContext).map(g=>[g.key,g.bridge]),...(selectedSet.has('bastardp')?[['P',bastardLoopPGainNode]]:[['O',bastardLoopOGainNode]])];for(const [name,source]of candidates)if(source&&!meters.some(m=>m.source===source)){const node=audioContext.createAnalyser();node.fftSize=1024;source.connect(node);meters.push({name,source,node,data:new Float32Array(1024),peak:0,sum:0,frames:0});}}for(const m of meters){m.node.getFloatTimeDomainData(m.data);for(const x of m.data){m.peak=Math.max(m.peak,Math.abs(x));m.sum+=x*x;m.frames++;}}};
     if(useEmber||useDrone||balanceSources)withBufferedTransportStart=(time,callback,options)=>transportStart(time,()=>{callback();
      if(!setBastardLoopPlaying(true,{startTime:time,silent:true,skipSave:true}))throw Error('Native loop transport did not start');
      for(const [name,engine,on]of [['ember',mygrainEmber,useEmber],['enemy',mygrainEnemyDrone,useDrone]])if(on){if(!engine.running)throw Error(name+' did not start');const source=engine.graph.output,node=audioContext.createAnalyser();node.fftSize=1024;source.connect(node);meters.push({name,source,node,data:new Float32Array(1024),peak:0,sum:0,frames:0});}
      if(balanceSources)balanceSetup=Promise.resolve().then(async()=>{
       await mygrainCookingPot.whenReady();mygrainCookingPot.syncSources();
       const cycle=Math.round(60/bpm*16*audioContext.sampleRate),startFrame=Math.round(time*audioContext.sampleRate);
       ensureDrumMachineKickBypassBus();
       const master=mygrainEffectOutput.diagnostics().level;
       const drumKeys=MygrainCookingPot.LEAVES.filter(key=>/^drum[A-Z]/.test(key));
       mygrainCookingPot.isolateAnalysis([['E'],['D'],['sample'],drumKeys],audioContext);
       await mygrainCookingPot.whenReady();
       const families=[...(useEmber?[['ember',['E']]]:[]),...(selectedSet.has('bastardd')?[['d',['D']]]:[]),...(hasRestructure?[['restructure',['sample']]]:[]),['drums',drumKeys]],raw=[];
       for(const [family,keys]of families){const group=mygrainCookingPot.analysisRoutes(keys,audioContext);if(family==='drums')raw.push(...group.raw);for(const route of group.routes){const scale=route.postEffect?(route.destination.gain.__effectOutputTarget??route.destination.gain.value):master;balances.push({...route,family,scale});}}
       if(!balances.some(r=>r.family==='drums')||useEmber&&!balances.some(r=>r.family==='ember')||selectedSet.has('bastardd')&&!balances.some(r=>r.family==='d'))throw Error('Post-FX analysis route missing');
       if(hasRestructure&&!balances.some(r=>r.family==='restructure'))throw Error('Restructure post-FX route missing');
       postFxNode=new AudioWorkletNode(audioContext,'mygrain-shop-postfx-balance-v1',{numberOfInputs:balances.length+1,numberOfOutputs:balances.length,outputChannelCount:balances.map(()=>2),channelCount:2,channelCountMode:'explicit',processorOptions:{routes:balances.map(({family,scale})=>({family,scale})),rawScale:master,hasEmber:useEmber,hasRestructure,restructureLevel:getDropboxSampleLayerLevelValue({applyLayerToggle:false}),hasD:selectedSet.has('bastardd'),drumEffected:balances.some(r=>r.family==='drums'&&r.postEffect),startFrame,decisionFrame:startFrame+cycle-Math.round(.35*audioContext.sampleRate),captureFrame:startFrame+cycle,endFrame:startFrame+2*cycle}});
       postFxNode.port.onmessage=({data})=>{if(data.error)balanceError=data.error;if(data.applied){postFxApplied=data.applied;window.dfeederStage('Post-FX levels balanced · drum makeup '+data.applied.drumMakeup.gainDb.toFixed(1)+' dB · recording final loop');}if(data.verified)postFxVerified=data.verified;};
       postFxNode.onprocessorerror=()=>{balanceError='Post-FX loudness analysis stopped';};
       balances.forEach((route,n)=>{route.source.disconnect(route.destination);route.source.connect(postFxNode,0,n);postFxNode.connect(route.destination,n,0);});
       for(const source of raw)source.connect(postFxNode,0,balances.length);
       postFxNode.__raw=raw;

      }).catch(error=>{balanceError=error.message;});
      meterTimer=setInterval(sampleMeters,80);
     },options);
     let rendered;const wasOutputRecording=isOutputRecording;isOutputRecording=true;
     try{rendered=await renderLiveOutputBarsBuffer({exportSteps:64,loopWarmupCycles:1,forceBastardLoops:true,forceDrumMachine:layered});await balanceSetup;}
     finally{isOutputRecording=wasOutputRecording;withBufferedTransportStart=transportStart;clearInterval(meterTimer);sampleMeters();if(postFxNode){postFxNode.port.postMessage({dispose:true});postFxNode.disconnect();for(const route of balances){try{route.source.disconnect(postFxNode);}catch{}route.source.connect(route.destination);}for(const source of postFxNode.__raw||[])try{source.disconnect(postFxNode);}catch{}postFxNode.port.close();}for(const m of meters){sourceMetrics[m.name]={peak:Math.max(sourceMetrics[m.name]?.peak||0,m.peak),rms:Math.max(sourceMetrics[m.name]?.rms||0,Math.sqrt(m.sum/Math.max(1,m.frames)))};m.source.disconnect(m.node);m.node.disconnect();}}
     if(balanceSources){
      if(balanceError||!postFxApplied||!postFxVerified)throw Error(balanceError||'Post-FX source loudness analysis did not complete');
      balance={version:1,...postFxApplied.ember,status:'balanced',sourceTap:'post-fx',referenceTap:'post-fx',routes:balances.map(({family,keys,effects,scale})=>({family,keys,effects,scale})),drumMakeup:postFxApplied.drumMakeup,verified:{drums:postFxVerified.drums,ember:postFxVerified.ember}};
      MygrainLoopBalance.verifySaved(postFxVerified.drums,postFxVerified.ember,postFxVerified.d,postFxVerified.restructure);
      if(postFxApplied.restructure)balance.restructure={...postFxApplied.restructure,status:'balanced',sourceTap:'post-fx',referenceTap:'post-fx',verified:{drums:postFxVerified.drums,restructure:postFxVerified.restructure}};
      if(postFxApplied.d){balance.d={...postFxApplied.d,status:'balanced',sourceTap:'post-fx',referenceTap:'post-fx',verified:{drums:postFxVerified.drums,d:postFxVerified.d}};}

     }
     for(const [name,on]of [['ember',useEmber],['enemy',useDrone],['L',tone==='tonal'],['X',tone==='tonal'],['P',selectedSet.has('bastardp')],['O',selectedSet.has('bastardo')]])if(on&&!(sourceMetrics[name]?.rms>1e-7))throw Error(name+' rendered no audible source audio');
     let peak=0,sum=0;for(let c=0;c<rendered.audioBuffer.numberOfChannels;c++)for(const x of rendered.audioBuffer.getChannelData(c)){if(!Number.isFinite(x))throw Error('Invalid render PCM');peak=Math.max(peak,Math.abs(x));sum+=x*x;}
     if(peak<1e-5)throw Error('Random run rendered silence');
     peakNormaliseLoopStoreBuffer(rendered.audioBuffer);
     if(useEmber||balanceSources){const measure=new MygrainLoopBalance.Integrated(rendered.audioBuffer.sampleRate),left=rendered.audioBuffer.getChannelData(0),right=rendered.audioBuffer.getChannelData(1);for(let i=0;i<left.length;i++)measure.process(left[i],right[i]);balance.finalMix=measure.result();}
     const bytes=new Uint8Array(audioBufferToWav24bit(rendered.audioBuffer)),chunks=[];for(let i=0;i<bytes.length;i+=32768)chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
     await window.dfeederWrite(btoa(chunks.join('')));stopAllPerformancePlayback({silent:true});
     if(retainSource){
      await window.dfeederStage('Retaining exact source sounds for DAW checkout');
      const snapshot=await mygrainSongBetaAdapter.capture();
      for(let offset=0;offset<snapshot.size;offset+=524288){const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(snapshot.slice(offset,offset+524288));});await window.dfeederSnapshot(encoded,offset===0);}
     }
     return{index,bpm,steps:64,quality:'full',layers:active,drums:layered,balance,drumLevels:{bus:getDrumMachineLevelValue({applyLayerToggle:false}),cymbals:drumMachineExtraTracks.cymbals.level},mode,key,...(useDrone?{chord,octaves,harmonyRoot}:{}),tone,pot,genre,genreModel:genrePlan?.model,genreTitle:genrePlan?.recipe.title,sourceMetrics,effects,effectTargets,effectChains:mygrainCookingPot.diagnostics().chains,seed,peak:1,rms:Math.sqrt(sum/(rendered.audioBuffer.length*rendered.audioBuffer.numberOfChannels))/peak,
      sources:{A:bastardLoopMetadata,B:bastardLoop2Metadata,C:bastardLoop3Metadata,W:bastardLoopWMetadata,D:bastardLoopDMetadata,dropbox:window.mygrainRestructure?.settings()??dropboxSampleLayerMetadata,...(tone==='tonal'?{P:bastardLoopPMetadata,O:bastardLoopOMetadata,L:bastardLoopLSampleMetadata,X:bastardLoopXSampleMetadata}:{})},
      recipes:{...(mode==='loop'&&selectedSet.has('bastardd')?{d:mygrainD.settings()}:{}),...(tone==='tonal'?{L:bastardLoopLSequence,X:bastardLoopXSequence}:{}),effects:next,cookingPot:mygrainCookingPot.settings(),...(useEmber?{ember:mygrainEmber.settings()}:{}),...(useDrone?{enemy:mygrainEnemyDrone.settings()}:{})},frames:rendered.audioBuffer.length,sampleRate:rendered.audioBuffer.sampleRate};
    },{bpm:job.bpms[index],index,mode,key,tone,pot,chord,octaves,genre,genrePlan,balanceWorklet,retainSource:job.retainSource===true,seed:(job.seed+index*2654435761+attempt*2246822519)>>>0});
    if(errors.length)throw Error(errors[0]);emit({sample:result});break;
   }catch(error){if(attempt===2||error.genrePlanFailed)throw error;emit({stage:`${index+1}/${job.bpms.length} · Retrying random run (${attempt+2}/3)`,retryError:String(error.message||error).slice(0,500)});}finally{await context.close();}
  }
  }
 }finally{
  // No account page, AudioContext, cookies, storage or DSP graph survives a job.
  if(browser.contexts().length)throw Error('Generation worker retained an account context');
  if(++browserJobs>=8){await browser.close();activeBrowser=null;browserJobs=0;}
 }
}
(async()=>{
 let idle;
 try{
  if(process.argv.includes('--persistent')){
   const lines=require('node:readline').createInterface({input:process.stdin,crlfDelay:Infinity});
   for await(const line of lines){
    clearTimeout(idle);const started=performance.now();
    try{await render(JSON.parse(line));}
    catch(error){emit({error:String(error.stack||error.message||error).slice(0,1400)});}
    emit({idle:true,contexts:activeBrowser?.contexts().length||0,browserLaunches,elapsedMs:Math.round(performance.now()-started)});
    idle=setTimeout(async()=>{await activeBrowser?.close();process.exit(0)},60000);
   }
  }else await render(JSON.parse(fs.readFileSync(0,'utf8')));
 }finally{clearTimeout(idle);await activeBrowser?.close();}
})().catch(e=>{emit({error:String(e.stack||e.message||e).slice(0,1400)});process.exitCode=1;});
