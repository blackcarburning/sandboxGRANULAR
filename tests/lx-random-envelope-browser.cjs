const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:19073/mygrain/';
(async()=>{for(const[name,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});try{
 const c=await b.newContext();assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:process.env.MYGRAIN_TEST_ADMIN_PASSWORD}})).status(),200);const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());await p.goto(base);await p.waitForFunction(()=>mygrainAiPatch?.ready&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 const r=await p.evaluate(async()=>{
  stopAllPerformancePlayback({silent:true});
  const values=()=>[getBastardLoopLStepLengthRatio(),getBastardLoopLDecayRatio(),getBastardLoopXStepLengthRatio(),getBastardLoopXDecayRatio(),Number(document.getElementById('performanceBastardLoopXLevel').value)];
  const seed=()=>{setSliderValue('performanceBastardLoopXLevel',17);for(const lane of ['L','X']){setSliderValue(`performanceBastardLoop${lane}Length`,23);setSliderValue(`performanceBastardLoop${lane}Decay`,37)}flushPendingSliderUpdates()};
  seed();await randomizeBastardLoopLPattern();const l=values();await mygrainCardHistory.undo();const undo=values();await mygrainCardHistory.redo();const redo=values();seed();await randomizeBastardLoopXPattern();const x=values();
  seed();randomizeMegaBastardLoopLeadAndBassSettings();const mega=values();
  seed();await mygrainCardHistory.run('random patch',()=>{setSliderValue('performanceBastardLoopLLength',9);setSliderValue('performanceBastardLoopXDecay',9)});const ordinary=values();
  seed();const a=mygrainAiPatchAdapter;await a.execute({title:'L/X envelope fixture',parameters:{performanceBastardLoopLLength:25,performanceBastardLoopLDecay:35,performanceBastardLoopXLength:45,performanceBastardLoopXDecay:55,performanceBastardLoopXLevel:65},loops:{}},a.fingerprint());const ai=values();
  const zip=await mygrainSongBetaAdapter.capture();const state=JSON.parse(getZipText(parseStoredZipEntries(await zip.arrayBuffer()),'song-part.json')).state;const saved=['L','X'].flatMap(k=>[state.modes[`bastardLoop${k}Length`],state.modes[`bastardLoop${k}Decay`]]);saved.push(state.modes.bastardLoopXLevel*100);
  seed();const preset=gatherPreset();applyGeneratedLXEnvelope();applyPreset(preset);const legacy=values();
  return{l,undo,redo,x,mega,ordinary,ai,saved,legacy};
 });
 assert.deepEqual(r.l,[.23,.37,.23,.37,17]);assert.deepEqual(r.undo,[.23,.37,.23,.37,17]);assert.deepEqual(r.redo,r.l);assert.deepEqual(r.x,[.23,.37,.23,.37,17]);assert.deepEqual(r.mega,[1,.8,1,.8,80]);assert.deepEqual(r.ordinary,[.09,.37,.23,.09,17]);for(const k of ['ai','saved'])assert.deepEqual(r[k],[.25,.35,.45,.55,65],k);assert.deepEqual(r.legacy,[.23,.37,.23,.37,17]);assert.deepEqual(errors,[]);console.log('PASS',name,JSON.stringify(r));await c.close();
 }finally{await b.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
