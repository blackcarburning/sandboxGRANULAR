(function(root){
'use strict';
const Model=root.MygrainCookingPot,KEYS=Model.KEYS,bindings=new Set(),listeners=new Set();
let state=Model.normalize(readStoredStateSnapshot()?.modes?.cookingPot),pending=Promise.resolve(),queued=false,refreshing=false,nativeMode=false,generation=0,error='',failed=false;
const unlink=(s,d,...ports)=>{try{s.disconnect(d,...ports)}catch{}},native=ctx=>ctx.__mygrainNativeContext||ctx;
const values=()=>({mutilator:root.mygrainD.settings().mutilator,bassFace:root.mygrainBassFace.settings(),turntable:root.mygrainTurntable.settings(),resonator:root.mygrainResonator.settings(),...root.mygrainAcousticFx.settings(),wasp:root.mygrainWasp.settings(),playground:root.mygrainWasp.settings().playground});
const audible=(key,v)=>['mutilator','bassFace'].includes(key)?root.MygrainEffectLfo.audible(key,v):key==='resonator'?root.MygrainResonator.audible(v):root.MygrainAcousticFx.KEYS.includes(key)?root.MygrainAcousticFx.audible(key,v):v.enabled;
const clock=ctx=>{const c=root.mygrainWasp.clockSnapshot(ctx);return{...c,pot:true,oversample:'none',time:c.at,snapshot:()=>root.mygrainWasp.clockSnapshot(ctx)}};
const emit=()=>{for(const fn of listeners)fn();syncUi();root.mygrainEffectOutput?.syncUi();root.dispatchEvent(new Event('mygrain-insert-graph'));};
async function prepare(ctx,modes=null){if(!ctx)return;ctx=native(ctx);await root.mygrainEffectLfo.prepare(ctx);const v=modes?{...modes,resonator:modes.resonatorR}:values();await Promise.all([root.mygrainResonator.prepare(ctx,v.resonator),root.mygrainAcousticFx.prepare(ctx,v),root.mygrainWasp.prepare(ctx,{...v.wasp,playground:v.playground}),root.mygrainTurntable.prepare(ctx,v.turntable)]);}
// Source-owned inserts. No raw-tap subtraction, aggregate-return unmixing or
// repeated parallel dry is used. Identical complete paths may share processors.
function retireNode(node){if(!node)return;node.onprocessorerror=null;node.disconnect();let timer;const done=()=>{clearTimeout(timer);node.port.onmessage=null;try{node.port.close()}catch{}};node.port.onmessage=({data})=>{if(data.disposed)done()};timer=setTimeout(done,1500);node.port.postMessage({dispose:true});}
const matches=(selected,key)=>Model.match(selected,key);
function audioValues(ctx){const v=values();for(const key of KEYS)if(!root.mygrainEffectOutput.allows(key,ctx))v[key]={...v[key],enabled:false};return v;}
function sourceInventory(b){
 const gates=root.mygrainTurntable.sourceGates(b.context),groups=[...root.mygrainCharacterFx.groups].filter(g=>g.context===b.context&&!g.wholeMix),out=new Map();
 for(const key of Model.LEAVES.filter(k=>k!=='*')){
  let sources=groups.filter(g=>g.key===key).map(g=>g.input);
  if(!sources.length)sources=root.mygrainAcousticFx.inputTaps(b.context,key).map(t=>t.source);
  if(!sources.length)sources=gates.filter(t=>t.key===key).map(t=>t.source);
  if(sources.length)out.set(key,[...new Set(sources)]);
 }
 // Anything not in the canonical card registry (grains/keyboard/raw layers)
 // remains in the original processed main bus, after named dry gates close.
 out.set('*',[b.source]);return{gates,sources:out};
}
function consumes(key,ctx,gate=null){const b=[...bindings].find(b=>b.context===native(ctx));return !!b?.ready&&!failed&&(gate?b.consumedGates?.has(gate):[...(b.branches?.values()||[])].some(branch=>branch.keys.includes(key)));}
function gateSources(b,gates,v){b.consumedGates=new Set();for(const tap of gates){const consumed=b.ready&&!failed&&Model.plan(state,v,tap.key).length>0;tap.gate.gain.value=consumed?0:1;if(consumed)b.consumedGates.add(tap.gate);}}
function branchPlan(v,key){return Model.plan(state,v,key);}
function entrySettings(e,v,b){
 const value=v[e.key];if(e.key==='heavyLifter')return root.mygrainAcousticFx.nodeSettings(e.key,value,b.context);
 if(e.key==='resonator')return{...value,slots:value.slots.map((s,i)=>({...s,enabled:s.enabled&&e.stage.slots.includes(i)}))};
 if(e.key==='playground'){const w=root.mygrainWasp.settings();return{...w,enabled:false,playground:{...value,mix:1},playgroundInputResolved:true};}
 if(e.key==='wasp')return{...value,blend:1,playground:{...value.playground,enabled:false}};
 if(e.key==='turntable'&&!e.surface)return{...value,hum:0,clicks:0,crackle:0};return value;
}
function setEntry(b,e,v){
 const print=JSON.stringify([v[e.key],e.surface]);if(e.print===print&&e.balance===Model.balance(state,e.key,v[e.key]))return;const setting=entrySettings(e,v,b);
 if(e.graph)e.graph.set(setting);
 else if(e.node&&!e.fresh)e.node.port.postMessage({settings:setting});
 if(e.cross&&!e.fresh){const detectors=Model.LEAVES.filter(k=>k!=='*'),keys=['X',...detectors];e.cross.port.postMessage({settings:{...setting,output:0,carrierSlots:[0],detectorSlots:detectors.map((_,i)=>i+1),carrierRoutes:e.stage.routes},keys});}
 const mix=Model.balance(state,e.key,v[e.key]);if(e.dry){e.dry.gain.value=1-mix;e.wet.gain.value=mix;}e.balance=mix;e.print=print;e.fresh=false;
}
const needsDsp=(key,v)=>key==='resonator'?root.MygrainResonator.audible(v):root.MygrainAcousticFx.KEYS.includes(key)?root.MygrainAcousticFx.audible(key,v):true;
function createEntry(b,branch,stage,v,surface){
 const ctx=b.context,key=stage.key,e={key,stage,surface,input:ctx.createGain(),output:ctx.createGain(),nodes:[],links:[],graph:null,node:null,fresh:true};branch.entries.push(e);b.nodes.set(branch.id+':'+key,e);
 if(key==='mutilator'||key==='bassFace'){
  e.graph=(key==='mutilator'?root.MygrainMutilator:root.MygrainBassFace).createGraph(ctx,e.input,e.output,{...clock(ctx),wetDestination:undefined});
 }else{
  e.dry=ctx.createGain();e.wet=ctx.createGain();e.input.connect(e.dry);e.dry.connect(e.output);e.wet.connect(e.output);
  const audibleDsp=needsDsp(key,v[key]);e.hasDsp=audibleDsp;
  // A zero-level powered effect still owns its input; it may produce silence,
  // but it must never reopen a parallel dry leak.
  if(audibleDsp){
   const wasp=key==='wasp'||key==='playground',resonator=key==='resonator',name=wasp?'mygrain-wasp-master-v2':resonator?'mygrain-resonator-v1':root.MygrainAcousticFx.KEYS.includes(key)?'mygrain-acoustic-v1':'mygrain-turntable-v1';
   e.node=new AudioWorkletNode(ctx,name,{numberOfInputs:key==='playground'?4:resonator?2:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',processorOptions:{quality:root.mygrainPower?.divisor(ctx)||1,key,settings:entrySettings(e,v,b),tempo:clock(ctx).bpm,clocks:root.mygrainWasp.clockHistory(ctx),clockAligned:key==='turntable'}});e.nodes.push(e.node);
   if(key==='wasp'){
    const detectors=Model.LEAVES.filter(k=>k!=='*'),keys=['X',...detectors],settings={...entrySettings(e,v,b),output:0,carrierSlots:[0],detectorSlots:detectors.map((_,i)=>i+1),carrierRoutes:stage.routes};
    e.cross=new AudioWorkletNode(ctx,'mygrain-wasp-v1',{numberOfInputs:keys.length,numberOfOutputs:keys.length,outputChannelCount:Array(keys.length).fill(2),channelCount:2,channelCountMode:'explicit',processorOptions:{quality:root.mygrainPower?.divisor(ctx)||1,settings,keys,slots:keys.length}});e.nodes.push(e.cross);e.input.connect(e.cross,0,0);e.cross.connect(e.node,0,0);
   }else if(resonator){for(const slot of stage.slots)e.input.connect(e.node,0,slot);}else e.input.connect(e.node);
   e.node.connect(e.wet);for(const node of e.nodes)node.onprocessorerror=()=>fail(Error(META[key][0]+' stopped; inserts bypassed and original sources restored.'));
  }
 }
 setEntry(b,e,v);if(key==='resonator')e.output.connect(b.resonatorMeter);return e;
}
function retireEntry(b,branch,e){
 for(const t of e.links)unlink(t.source,t.node,0,t.input);e.links=[];e.graph?.dispose();for(const node of e.nodes)retireNode(node);for(const n of [e.input,e.output,e.dry,e.wet])n?.disconnect();b.nodes.delete(branch.id+':'+e.key);
}
function retireBranch(b,branch){for(const t of branch.sources)unlink(t,branch.input);for(const e of branch.entries)retireEntry(b,branch,e);branch.input.disconnect();branch.output.disconnect();b.branches.delete(branch.id);}
function wireDetectors(b,e,inventory){
 const wanted=[];if(e.cross&&!e.fresh){const detectors=Model.LEAVES.filter(k=>k!=='*');detectors.forEach((key,i)=>{for(const source of inventory.get(key)||[])wanted.push({source,node:e.cross,input:i+1});});}
 if(e.key==='playground'&&e.node){const v=values().playground;root.MygrainWasp.PLAYGROUND_CONTROLS.forEach((key,i)=>{const lane=v.modulation[key];if(lane.source==='off'||lane.source==='drawn'||!lane.amount)return;for(const [sourceKey,sources]of inventory)if(sourceKey!=='*'&&sourceKey!=='DAW'&&matches(lane.source,sourceKey))for(const source of sources)wanted.push({source,node:e.node,input:i+1});});}
 for(const t of e.links)if(!wanted.some(w=>w.source===t.source&&w.node===t.node&&w.input===t.input))unlink(t.source,t.node,0,t.input);
 for(const w of wanted)if(!e.links.some(t=>w.source===t.source&&w.node===t.node&&w.input===t.input))w.source.connect(w.node,0,w.input);e.links=wanted;
}
function syncSources(){try{syncPreparedSources();}catch(e){fail(e);}}
function syncPreparedSources(){
 for(const b of bindings){if(!b.ready||b.preparing||failed)continue;const v=audioValues(b.context),inventory=sourceInventory(b),potential=new Map();
  for(const sourceKey of Model.LEAVES){const plan=branchPlan(v,sourceKey);if(!plan.length||!root.mygrainEffectOutput.allowsSource(sourceKey,plan,b.context))continue;const id=JSON.stringify([plan,b.analysisGroups?.get(sourceKey)||'']);let group=potential.get(id);if(!group){group={id,plan,keys:[],sources:[]};potential.set(id,group);}group.keys.push(sourceKey);group.sources.push(...inventory.sources.get(sourceKey)||[]);}
  // Include semantic source membership, never individual voice identity. A Solo
  // change must not reuse a shared nonlinear/reverb state containing other layers;
  // new voices in the same audible source set must not recreate the processors.
  for(const [id,g]of [...potential]){potential.delete(id);g.id=JSON.stringify([g.plan,g.keys,root.mygrainPower?.divisor(b.context)||1]);potential.set(g.id,g);}
  for(const branch of [...b.branches.values()])if(!potential.has(branch.id))retireBranch(b,branch);
  const surfaceOwners=new Set();
  for(const g of potential.values()){
   let branch=b.branches.get(g.id);if(branch&&branch.entries.some(e=>!e.graph&&e.hasDsp!==needsDsp(e.key,v[e.key]))){retireBranch(b,branch);branch=null;}if(!branch&&!g.sources.length)continue;
   if(!branch){branch={id:g.id,keys:g.keys,input:b.context.createGain(),output:b.context.createGain(),sources:[],entries:[]};b.branches.set(g.id,branch);let carrier=branch.input;
    for(const stage of g.plan){const surface=!surfaceOwners.has(stage.key);surfaceOwners.add(stage.key);const e=createEntry(b,branch,stage,v,surface);carrier.connect(e.input);carrier=e.output;}
    carrier.connect(branch.output);branch.output.connect(root.mygrainEffectOutput.potInput(g.plan.at(-1).key,b.context));
   }else for(const e of branch.entries){e.surface=!surfaceOwners.has(e.key);surfaceOwners.add(e.key);setEntry(b,e,v);}
   branch.keys=g.keys;const wanted=[...new Set(g.sources)];for(const source of branch.sources)if(!wanted.includes(source))unlink(source,branch.input);for(const source of wanted)if(!branch.sources.includes(source))source.connect(branch.input);branch.sources=wanted;
   for(const e of branch.entries)wireDetectors(b,e,inventory.sources);
  }
  b.sum.gain.value=branchPlan(v,'*').length?0:1;gateSources(b,inventory.gates,v);
 }
}
function createSum(b){b.resonatorMeter||=b.context.createGain();b.sum=b.context.createGain();b.source.connect(b.sum);b.sum.connect(root.mygrainEffectOutput.potInput(null,b.context));b.branches=new Map();b.ready=true;}
function disposeGraph(b){b.ready=false;b.consumedGates?.clear();for(const branch of [...(b.branches?.values()||[])])retireBranch(b,branch);for(const tap of root.mygrainTurntable.sourceGates(b.context))tap.gate.gain.value=1;if(b.sum){unlink(b.source,b.sum);b.sum.disconnect();b.sum=null;}root.mygrainEffectOutput.setPotActive(b.context,false);}
async function refreshNative(){refreshing=true;try{await Promise.all([root.mygrainResonator.restore(root.mygrainResonator.settings()),root.mygrainAcousticFx.restore(root.mygrainAcousticFx.settings()),root.mygrainTurntable.restore(root.mygrainTurntable.settings()),root.mygrainWasp.restore(root.mygrainWasp.settings())]);root.mygrainCharacterFx.update();root.mygrainD.setMutilator(root.mygrainD.settings().mutilator,{skipSave:true});}finally{refreshing=false;}}
async function reconcile(){root.mygrainEffectOutput.sync();const token=++generation,stamp=JSON.stringify([state,values()]);if(failed){for(const b of bindings)disposeGraph(b);return;}
 if(!nativeMode){nativeMode=true;await refreshNative();}
 for(const b of bindings){b.preparing=true;await prepare(b.context);if(token!==generation||failed||!bindings.has(b))return;b.preparing=false;if(!b.sum)createSum(b);syncSources();if(failed)return;root.mygrainEffectOutput.setPotActive(b.context,true);}
 if(stamp!==JSON.stringify([state,values()]))return schedule();emit();}
function fail(e){failed=true;error=e.message;for(const b of bindings)disposeGraph(b);emit();if(!root.__mygrainSongRenderDeck)setStatus(error,'error');}
function schedule(){if(refreshing)return pending;for(const b of bindings)b.preparing=true;if(!queued){queued=true;pending=Promise.resolve().then(()=>{queued=false;return reconcile();}).catch(e=>{fail(e);throw e;});pending.catch(()=>{});}return pending;}
function restore(value){state=Model.normalize(value);error='';failed=false;emit();return schedule();}
const powers=()=>{const v=values();return{...Object.fromEntries(KEYS.map(key=>[key,!!v[key].enabled])),masterBaker:root.mygrainMasterBaker?.settings().enabled===true};};
const powerEnabled=()=>state.power?.enabled===true||Object.values(powers()).some(Boolean);
async function setPower(enabled){
 enabled=!!enabled;if(enabled===powerEnabled())return;
 const account=root.mygrainAccounts?.user?.username,context=audioContext;
 const previous=values(),previousPot=Model.normalize(state),previousMaster=root.mygrainMasterBaker?.settings();
 const remembered=enabled?(state.power?.remembered||powers()):powers();
 if(enabled&&Object.values(remembered).some(Boolean))await ensurePatchZipAudioReady();
 if(root.mygrainAccounts?.user?.username!==account||audioContext!==context||stateSaveSuspended)throw Error('Account or audio changed; Cooking pot power cancelled.');
 const next=structuredClone(previous);for(const key of KEYS)next[key].enabled=enabled&&remembered[key]===true;
 try{
  // Canonical setters drive the rack, original effect cards and Layers together.
  // Keep serial/native routing, recipes, input choices, order and transport intact.
  await root.mygrainMasterBaker?.restore({...previousMaster,enabled:enabled&&remembered.masterBaker===true});
  await applyStirSettings(next,{...previousPot,power:{enabled,remembered}});
 }catch(e){
  if(root.mygrainAccounts?.user?.username===account&&audioContext===context){await applyStirSettings(previous,previousPot);if(previousMaster)await root.mygrainMasterBaker.restore(previousMaster);}
  throw e;
 }
 syncUi();return Model.normalize(state);
}
function releaseContext(ctx){generation++;for(const b of [...bindings])if(!ctx||b.context===native(ctx)){disposeGraph(b);b.resonatorMeter?.disconnect();bindings.delete(b);}emit();}
// Generation only: recipes are frozen through the same canonical card setters.
// Keep Mega/Sparse's independent coin-flips separate from the five-to-all eligible effect Stir policy.
function bigStirSettings(current,random,pot,output){
 const inputs=[...new Set(root.mygrainCharacterFx.activeInputs())].filter(key=>key!=='all'&&root.MygrainEffectInputs.SOURCES.includes(key)&&(!key.startsWith('drum')||isDrumMachineLaneAudible(key.slice(4).toLowerCase())));
 const amount=pot.stirAmount??1;
 if(amount>0&&!inputs.length)throw Error('BIG STIR needs an active, loaded card with its level above zero.');
 return Model.randomiseParameters({effects:current,pot,output},{inputs,waspInputs:inputs.filter(key=>root.MygrainWasp.KEYS.includes(key)),bpm:getSharedBpmClockValue(),phone:!!root.mygrainPhone,acoustic:root.MygrainAcousticFx,mutilator:root.MygrainMutilator,bassFace:root.MygrainBassFace,turntable:root.MygrainTurntable,resonator:root.MygrainResonator,hose:root.MygrainHenrysHose,heavy:root.MygrainHeavyLifter,wasp:root.MygrainWasp,randomSamples:(...args)=>root.mygrainHeavyLifterAssets.randomSamples(...args)},random,amount);
}
async function applyStirSettings(next,pot,output){
 // Sparse recipes omit defaults; expand them before D's merging setter.
 root.mygrainD.setMutilator({...root.MygrainMutilator.EXT,input:'D',lfo:null,...next.mutilator},{skipSave:true});root.mygrainBassFace.restore(next.bassFace);
 const results=await Promise.allSettled([root.mygrainTurntable.restore(next.turntable),root.mygrainResonator.restore(next.resonator),root.mygrainAcousticFx.restore(Object.fromEntries(root.MygrainAcousticFx.KEYS.map(key=>[key,next[key]]))),root.mygrainWasp.restore({...next.wasp,playground:next.playground})]);
 const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
 if(output)root.mygrainEffectOutput.restore(output);
 await restore(pot);await pending;
}
async function stir({big=false,random=Math.random}={}){
 const account=root.mygrainAccounts?.user?.username,context=audioContext;
 await ensurePatchZipAudioReady();
 if(root.mygrainAccounts?.user?.username!==account||audioContext!==context||stateSaveSuspended)throw Error('Account or audio changed; Stir cancelled.');
 const previous=values(),previousPot=Model.normalize(state),draw=()=>{const n=random();if(!Number.isFinite(n))throw Error('Invalid Stir random value.');return Math.max(0,Math.min(1-Number.EPSILON,n));};
 const previousOutput=root.mygrainEffectOutput.settings(),generated=big?bigStirSettings(previous,draw,previousPot,previousOutput):null;
 const next=generated?generated.effects:structuredClone(previous),pot=Model.shuffle(generated?.pot||previousPot,draw),eligible=Model.shuffle(previousPot,draw).order.filter(key=>(!big||key!=='wasp'||next.wasp.routes.some(route=>route.enabled))&&(key!=='mutilator'||next.mutilator.amount>0&&next.mutilator.mix>0));
 const minimum=Math.min(5,eligible.length),count=minimum+Math.floor(draw()*(eligible.length-minimum+1)),selected=new Set(eligible.slice(0,count));
 for(const key of KEYS)next[key].enabled=previous[key].enabled||selected.has(key);
 const previousMaster=root.mygrainMasterBaker?.settings();
 try{await applyStirSettings(next,pot,generated?.output);}catch(e){await applyStirSettings(previous,previousPot,previousOutput);if(previousMaster)await root.mygrainMasterBaker.restore(previousMaster);throw e;}
 return {pot:Model.normalize(state),enabled:KEYS.filter(key=>selected.has(key)),...(generated?{selection:generated.selection}:{})};
}
async function changeModulators(transform,label){
 const previous=values(),account=root.mygrainAccounts?.user?.username,context=audioContext,next=transform(previous),owned=()=>root.mygrainAccounts?.user?.username===account&&audioContext===context;
 if(stateSaveSuspended||!owned())throw Error('Account or audio changed; '+label+' cancelled.');
 if(!next)return previous;
 const apply=async settings=>{
  root.mygrainD.setMutilator({lfo:settings.mutilator.lfo||null},{skipSave:true});
  const bass=root.mygrainBassFace.settings();delete bass.lfo;if(settings.bassFace.lfo)bass.lfo=structuredClone(settings.bassFace.lfo);root.mygrainBassFace.restore(bass);
  const results=await Promise.allSettled(['wireWorld','sonicCrystal','bubbleChamber','heavyLifter'].map(key=>{const value=root.mygrainAcousticFx.settings(key);delete value.lfo;if(settings[key].lfo)value.lfo=structuredClone(settings[key].lfo);return root.mygrainAcousticFx.set(key,value);}));
  const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;await pending;
 };
 try{await apply(next);if(!owned())throw Error('Account or audio changed; '+label+' cancelled.');}catch(e){if(owned())await apply(previous);throw e;}return values();
}
function liquidize({random=Math.random}={}){return changeModulators(previous=>root.MygrainEffectLfo.liquidize(previous,random),'Liquidizer');}
function resetModulators(){return changeModulators(previous=>{
 const next=structuredClone(previous);let changed=false;
 for(const key of [...root.MygrainEffectLfo.KEYS,'heavyLifter'])if(next[key]?.lfo?.targets?.length){next[key].lfo.targets=[];changed=true;}
 return changed?next:null;
},'Modulator reset');}
// Observational source-terminal access for isolated render analysis. No graph or gain changes.
function sourceTerminal(key,ctx){
 const b=[...bindings].find(b=>b.context===native(ctx));
 const branch=[...(b?.branches?.values()||[])].find(branch=>branch.keys.length===1&&branch.keys[0]===key);
 return branch?{effect:branch.entries.at(-1).key,source:branch.output,destination:root.mygrainEffectOutput.potInput(branch.entries.at(-1).key,b.context)}:null;
}
// Opt-in only for disposable analysis decks. Keep unrelated sources out of
// shared nonlinear processors so a post-FX family can be measured unambiguously.
function isolateAnalysis(groups,ctx){const b=[...bindings].find(b=>b.context===native(ctx));if(!b)throw Error('Analysis context missing');b.analysisGroups=new Map(groups.flatMap((keys,i)=>keys.map(key=>[key,String(i+1)])));syncPreparedSources();}
function analysisRoutes(keys,ctx){
 const b=[...bindings].find(b=>b.context===native(ctx));if(!b?.ready||failed)throw Error('Analysis graph not ready');
 const wanted=new Set(keys),inventory=sourceInventory(b),routes=[],covered=new Set();
 for(const branch of b.branches.values())if(branch.keys.some(key=>wanted.has(key))){
  if(branch.keys.some(key=>!wanted.has(key)))throw Error('Analysis branch contains unrelated sources');
  const effect=branch.entries.at(-1).key;routes.push({keys:[...branch.keys],effects:branch.entries.map(e=>e.key),source:branch.output,destination:root.mygrainEffectOutput.potInput(effect,b.context),postEffect:true});branch.keys.forEach(key=>covered.add(key));
 }
 for(const tap of inventory.gates)if(wanted.has(tap.key)&&!covered.has(tap.key))routes.push({keys:[tap.key],effects:[],source:tap.gate,destination:tap.destination,postEffect:false});
 return{routes,raw:[...new Set(keys.flatMap(key=>inventory.sources.get(key)||[]))]};
}
const api={isolateAnalysis,analysisRoutes,sourceTerminal,effectDiagnostics(key){const entries=[...bindings].flatMap(b=>[...b.nodes.values()].filter(e=>e.key===key).map(e=>({entry:e,branch:[...(b.branches?.values()||[])].find(branch=>branch.entries.includes(e))})));return{processors:entries.reduce((n,{entry:e})=>n+(e.graph?Number(e.graph.active):e.nodes.length),0),connections:entries.reduce((n,{branch})=>n+(branch?.sources.length||0),0)};},resonatorMeterNode(ctx){return [...bindings].find(b=>!ctx||b.context===native(ctx))?.resonatorMeter||null;},setResonatorMonitor(monitor){for(const b of bindings)[...b.nodes.values()].filter(e=>e.key==='resonator').forEach(e=>e.node?.port.postMessage({monitor}));},settings:()=>Model.normalize(state),setStirAmount(value){const n=Number(value);if(!Number.isFinite(n))throw Error('Invalid BIG STIR amount.');state=Model.normalize({...state,stirAmount:Math.max(0,Math.min(1,n))});syncUi();return Model.normalize(state);},setMix(key,value){if(!KEYS.includes(key)||['mutilator','bassFace','wasp','playground'].includes(key))throw Error('Invalid insert balance.');return restore({...state,mixes:{...state.mixes,[key]:Math.max(0,Math.min(1,Number(value)||0))}});},restore,stir,liquidize,resetModulators,setPower,powerEnabled,active:()=>true,consumes,changed(){if(!refreshing)schedule();},prepare,async whenReady(){for(;;){const task=pending;await task;if(task!==pending)continue;if([...bindings].some(b=>b.preparing)&&!failed){schedule();continue;}return;}},syncSources,bind(source){for(const b of [...bindings])if(b.context===source.context)releaseContext(b.context);const b={source,context:source.context,sum:null,nodes:new Map()};bindings.add(b);schedule();},releaseContext,clear(){for(const b of bindings)for(const [key,e]of b.nodes)if(e.key==='resonator'||root.MygrainAcousticFx.KEYS.includes(e.key))e.node?.port.postMessage({clear:true});},async randomise({random=Math.random,sparse=false}={}){await root.mygrainMasterBaker?.randomiseOff();const {power,...routing}=state;return restore(sparse?{...routing,enabled:false}:Model.shuffle(routing,random));},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},diagnostics:()=>({enabled:true,insertVersion:1,order:[...state.order],contexts:bindings.size,clocks:[...bindings].map(b=>({clock:root.mygrainWasp.clockSnapshot(b.context),effects:[...b.nodes.values()].filter(e=>e.graph).map(e=>({key:e.key,clock:e.graph.clock}))})),scalers:[...bindings].reduce((n,b)=>n+(b.scalers?.size||0),0),processors:[...bindings].reduce((n,b)=>n+b.nodes.size,0),chains:[...bindings].map(b=>[...(b.branches?.values()||[])].map(branch=>({sources:branch.keys,quality:root.mygrainPower?.divisor(b.context)||1,stages:branch.entries.map(e=>e.key)}))),error})};root.mygrainCookingPot=api;
// State remains owned by each card. Observe its setter, never duplicate its power.
for(const [owner,method]of [[root.mygrainD,'setMutilator'],[root.mygrainBassFace,'restore'],[root.mygrainWasp,'restore'],[root.mygrainResonator,'restore'],[root.mygrainAcousticFx,'restore'],[root.mygrainTurntable,'restore']]){const original=owner[method];owner[method]=function(...args){const result=original.apply(this,args);if(!refreshing){failed=false;schedule();}return result;};}
for(const runtime of [root.mygrainWasp,root.mygrainResonator,root.mygrainAcousticFx,root.mygrainTurntable])runtime.subscribe(()=>{if(!refreshing)schedule();});
root.mygrainMasterBaker?.subscribe(()=>syncUi());
const oldClock=root.mygrainWasp.syncClock;let clockPrint='';root.mygrainWasp.syncClock=function(...args){const result=oldClock.apply(this,args);if(!args.slice(0,3).every(Number.isFinite))return result;const print=args.join(':');if(print!==clockPrint){clockPrint=print;for(const b of bindings)for(const e of b.nodes.values()){e.node?.port.postMessage({clock:{origin:args[0],bpm:args[1],at:args[2]},tempo:args[1]});if(e.graph){const signature=args.slice(0,2).join(':');if(e.clockPrint!==signature){e.clockPrint=signature;e.graph.set(values()[e.key]);}}}}return result;};
const originalRelease=root.mygrainChannelEq.releaseContext;root.mygrainChannelEq.releaseContext=function(ctx){releaseContext(ctx);return originalRelease.call(this,ctx);};
root.addEventListener('mygrain-account-lock',()=>releaseContext());root.addEventListener('pagehide',()=>releaseContext());

const META={heavyLifter:['Heavy Lifter','heavyLifterCard','HeavyLifter','#c4cbd0'],henrysHose:['Henry’s Hose','henrysHoseCard','HenrysHose','#ff6267'],mutilator:['Mutilator','loopDMutilator','Mutilator','#58b787'],bassFace:['Bass Face','bassFaceCard','BassFace','#80d8a7'],turntable:['Turntable','turntableCard','Turntable','#e0c69a'],resonator:['Olaf’s Resonator','resonatorCard','Resonator','#e8a278'],wireWorld:['WireWorld','wireWorldCard','WireWorld','#ffba76'],sonicCrystal:['Sonic Crystal','sonicCrystalCard','SonicCrystal','#95fbd9'],bubbleChamber:['Bubble Chamber','bubbleChamberCard','BubbleChamber','#a6ccff'],wasp:['The Wasp','waspCard','Wasp','#f9d96a'],playground:['Filter Playground','filterPlaygroundCard','Playground','#65e6d6']};
const potIcon='<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 27h36v16c0 10-8 15-18 15S14 53 14 43zM9 27h46M14 32H7v10h7m36-10h7v10h-7M20 23c-7-7 7-8 0-16m12 16c-7-7 7-8 0-16m12 16c-7-7 7-8 0-16"/><path d="M25 39c4-5 10-5 14 0m-12 7h10"/></svg>';
const spoonIcon='<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="43" cy="17" rx="10" ry="14" transform="rotate(35 43 17)"/><path d="M35 29 12 57c-3 3-7-1-4-4l24-27"/></svg>';
const liquidizerIcon='<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M17 7h30l-4 34H21ZM23 41h18l5 16H18ZM29 41V17m-6 10 18 8m-18 0 18-8M47 13h8v18h-10M25 7V3h14v4"/><circle cx="32" cy="50" r="3"/></svg>';
const ladleIcon='<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="m14 7 7-3c3-1 5 1 6 4l12 28M22 9l12 29M17 41l37-13c4 12-1 25-12 29S21 53 17 41Z"/><path d="m17 41 37-13"/></svg>';
let card=null,drag=null,uiBusy=false,navigationRequest=0;
function jumpTo(button,loadEffects=false){const request=++navigationRequest;const go=()=>{if(request===navigationRequest&&button.isConnected)root.mygrainJumpToButton(button);};if(!loadEffects){go();return;}Promise.all(['turntableCard','waspCard','filterPlaygroundCard'].map(id=>{const target=document.getElementById(id);return target&&root.mygrainDemand?.run(target);})).then(go).catch(e=>setStatus(e.message,'error'));}

function busy(){return uiBusy||root.mygrainCardHistory?.busy||root.mygrainSongBeta?.busy||root.mygrainSongBeta?.playing||stateSaveSuspended;}
async function edit(label,action){if(busy()){setStatus('Finish the current edit or stop Song playback first.','error');return;}uiBusy=true;syncUi();try{const run=async()=>{await action();saveState();};if(root.mygrainCardHistory)await root.mygrainCardHistory.runDraftEdit(label,run);else await run();}catch(e){setStatus(e.message,'error');}finally{uiBusy=false;syncUi();}}
function syncJumps(){
 for(const key of KEYS){const source=document.getElementById(META[key][1]),head=source?.querySelector('.d-mutilator-head,.bass-face-head,.tt-header,.r-head,.acoustic-head,.wasp-head,.wasp-pg-head');if(!head||source.querySelector('[data-pot-return]'))continue;
  const nav=document.createElement('nav');nav.className='pot-return-nav';nav.setAttribute('aria-label',META[key][0]+' navigation');const button=document.createElement('button');button.type='button';button.className='pot-return-jump';button.dataset.potReturn=key;button.dataset.jumpTarget='#cookingPotCard';button.title='Back to The cooking pot';button.setAttribute('aria-label','Jump back to The cooking pot');button.innerHTML=potIcon;button.onclick=()=>jumpTo(button);nav.append(button);head.before(nav);
 }
}
// Source menus are mirrors: the existing effect settings remain the only owner.
const inputCount=key=>key==='resonator'||key==='wasp'?2:1;
function inputValue(key,v,index){
 if(key==='resonator')return v.slots[index].source;
 if(key==='wasp')return v.routes[index].source;
 if(key==='turntable')return v.input||(v.route==='drums'?'drums':'all');
 if(key==='playground')return v.input||'all';
 return v.input||v.source||(key==='mutilator'?'D':'X');
}
function inputLabel(key,index){return META[key][0]+(key==='resonator'?' object '+(index+1):key==='wasp'?' modulation '+(index+1):'')+' input';}
function inputMenus(key){return '<div class="pot-inputs">'+Array.from({length:inputCount(key)},(_,index)=>`<div class="pot-input"><button type="button" class="pot-source-jump" data-pot-source-jump="${key}" data-pot-input-index="${index}" hidden>J</button><span aria-hidden="true">${inputCount(key)>1?index+1:'In'}</span><select data-effect-input-proxy="${key}" data-pot-input-index="${index}" aria-label="${inputLabel(key,index)}">${root.MygrainEffectInputs.options().map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></div>`).join('')+'</div>';}
async function changeInput(key,index,value){
 if(!root.MygrainEffectInputs.SOURCES.includes(value))throw Error('Unknown effect input.');
 const before=values();if(before[key].enabled||key==='playground'&&before.playground.enabled)await ensurePatchZipAudioReady();
 const next=values()[key];
 if(key==='mutilator')root.mygrainD.setMutilator({input:value},{skipSave:true});
 else if(key==='bassFace')root.mygrainBassFace.restore({...next,input:value});
 else if(key==='turntable'){delete next.input;next.route=value==='drums'?'drums':'mix';if(!['all','drums'].includes(value))next.input=value;await root.mygrainTurntable.restore(next);}
 else if(key==='resonator'){next.slots[index].source=value;await root.mygrainResonator.restore(next);}
 else if(key==='wasp'){next.routes[index].source=value;await root.mygrainWasp.restore(next);}
 else if(key==='playground')await root.mygrainWasp.restore({...root.mygrainWasp.settings(),playground:{...next,input:value}});
 else await root.mygrainAcousticFx.set(key,{...next,source:value});
 await api.whenReady();
}
function syncInputs(row,key,v){for(const select of row.querySelectorAll('[data-effect-input-proxy]')){
 const index=Number(select.dataset.potInputIndex),value=inputValue(key,v,index);if(select.value!==value)select.value=value;select.disabled=busy();
 const jump=select.parentElement.querySelector('[data-pot-source-jump]'),target=root.MygrainEffectInputs.jumpTarget(value);jump.hidden=!target;
 if(target)jump.dataset.jumpTarget=target;else delete jump.dataset.jumpTarget;
 jump.title='Jump to '+root.MygrainEffectInputs.label(value);jump.setAttribute('aria-label',jump.title);
 const lane=key==='resonator'?v.slots[index]:key==='wasp'?v.routes[index]:v;
 select.title=inputLabel(key,index)+' · '+root.MygrainEffectInputs.label(value)+(lane.enabled?'':' (Off)')+(key==='wasp'?' → '+lane.destination:'');
}}
function syncUi(){if(!card)return;syncJumps();const v=values(),power=card.querySelector('[data-pot-power]'),on=powerEnabled();power.querySelector('[data-pot-power-label]').textContent='Cooking pot '+(on?'On':'Off');power.setAttribute('aria-pressed',String(on));card.dataset.enabled=String(on);power.disabled=busy();
 for(const [i,key]of state.order.entries()){const row=card.querySelector(`[data-pot-effect="${key}"]`),meta=META[key];syncInputs(row,key,v[key]);if(!drag){const body=card.querySelector('tbody');if(body.children[i]!==row)body.insertBefore(row,body.children[i]||null);}row.querySelector('.pot-handle').textContent='⠿ '+(i+1);const btn=row.querySelector('[data-pot-effect-power]');btn.textContent=v[key].enabled?'On':'Off';btn.setAttribute('aria-pressed',String(!!v[key].enabled));btn.disabled=busy();row.querySelector('[data-pot-step="-1"]').disabled=busy()||i===0;row.querySelector('[data-pot-step="1"]').disabled=busy()||i===KEYS.length-1;row.querySelector('.pot-handle').disabled=busy();const holder=row.querySelector('[data-pot-icon]'),source=document.getElementById(meta[1]),svg=source?.querySelector('.wasp-head svg,.wasp-pg-head svg,.tt-header h3 svg,.r-art svg,.acoustic-title svg,.d-mutilator-head svg,.bass-face-head svg');if(svg&&holder.dataset.sourceSvg!==svg.outerHTML){holder.dataset.sourceSvg=svg.outerHTML;const clone=svg.cloneNode(true);clone.removeAttribute('id');clone.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));clone.setAttribute('aria-hidden','true');clone.style.color='inherit';holder.replaceChildren(clone);const color=getComputedStyle(svg).color,rgb=color.match(/[0-9.]+/g)?.slice(0,3).map(Number),luma=rgb?(.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]):0;row.style.setProperty('--effect-color',luma>105?color:meta[3]);}}
 const amount=card.querySelector('[data-pot-stir-amount]');amount.disabled=busy();amount.value=String(Math.round((state.stirAmount??1)*100));card.querySelector('[data-pot-stir-amount-value]').textContent=amount.value+'%';
 for(const button of card.querySelectorAll('[data-pot-shuffle],[data-pot-big-stir],[data-pot-liquidizer],[data-pot-mod-reset],[data-effect-main-mute],[data-effect-through-main-all]'))button.disabled=busy();card.querySelector('[data-pot-status]').textContent=error||(!on?'Off · effect selection remembered; On restores its power switches.':'On · source insert order: '+state.order.map(key=>META[key][0]+(v[key].enabled?'':' (Off)')).join(' → '));}
function move(key,to){const order=[...state.order],from=order.indexOf(key);to=Math.max(0,Math.min(order.length-1,to));if(from===to)return;order.splice(from,1);order.splice(to,0,key);return edit('Cooking pot effect order',()=>restore({...state,enabled:true,order}));}
function cancelDrag(){if(!drag)return;const d=drag;drag=null;try{d.handle.releasePointerCapture(d.id)}catch{}card.querySelectorAll('.pot-dragging,.pot-drop-target').forEach(el=>el.classList.remove('pot-dragging','pot-drop-target'));syncUi();}
function mount(){if(root.__mygrainSongRenderDeck||card)return;card=document.getElementById('cookingPotCard');if(!card)return;
 document.addEventListener('click',e=>{if(e.target.closest('[data-jump-target],[data-jump-click]'))navigationRequest++;},true);
 card.innerHTML=`<header class="pot-heading">${potIcon}<div><span class="pot-kicker">SERIAL EFFECTS MATRIX</span><h3>The cooking pot</h3></div></header><p>Drag the handles to change the real audio order, top to bottom. Off effects are bypassed. Each switch is linked to its card and Layers.</p><div class="pot-actions"><button type="button" class="performance-btn" data-pot-power aria-pressed="false">${potIcon}<span data-pot-power-label>Cooking pot Off</span></button><button type="button" class="performance-btn" data-pot-shuffle title="Shuffle the order and switch 5–11 eligible effects on; keep all effect settings">${spoonIcon}<span>Stir the pot</span></button><div class="pot-big-stir-controls"><button type="button" class="performance-btn" data-pot-big-stir title="Move the selected percentage of eligible effect controls, choose inputs from active cards and shuffle the order, then switch 5–11 eligible effects on, including Bubble Chamber">${ladleIcon}<span>BIG STIR</span></button><label class="pot-stir-amount">Controls moved <output data-pot-stir-amount-value>100%</output><input type="range" data-pot-stir-amount aria-label="BIG STIR controls moved" aria-describedby="potStirAmountHint" min="0" max="100" step="1" value="100"></label><p class="pot-stir-hint" id="potStirAmountHint">Sets how many effect controls BIG STIR randomizes, not how far they move. 0% keeps their settings; 100% randomizes all eligible controls. Effect order and on/off selection still change.</p></div><button type="button" class="performance-btn" data-pot-liquidizer title="Randomize card LFOs only; keep power, recipes, routing and order">${liquidizerIcon}<span>Liquidizer</span></button><button type="button" class="performance-btn" data-pot-mod-reset title="Clear every effect LFO assignment, including all Heavy Lifter tabs; keep LFO settings, recipes, power and routing"><span aria-hidden="true">↺</span><span>Reset modulators</span></button></div><table class="pot-table" aria-label="Cooking pot effects order"><colgroup><col class="pot-order-col"><col><col class="pot-power-col"><col class="pot-move-col"></colgroup><thead><tr><th scope="col" aria-label="Effect order">#</th><th scope="col">Effect</th><th scope="col">Power</th><th scope="col">Move</th></tr></thead><tbody>${KEYS.map(key=>{const m=META[key];return`<tr data-pot-effect="${key}" style="--effect-color:${m[3]}"><td><button type="button" class="pot-handle" aria-label="Reorder ${m[0]}; use arrow up or down">⠿</button></td><td><div class="pot-effect-cell"><button type="button" class="pot-effect-name pot-effect-jump" data-pot-jump="${key}" data-jump-target="#${m[1]}" aria-label="Jump to ${m[0]}"><span data-pot-icon></span><span>${m[0]}<small class="pot-jump-label">Jump ↗</small></span></button>${inputMenus(key)}</div></td><td><button type="button" class="pot-linked-power" data-pot-effect-power="${key}" aria-label="${m[0]} power" aria-pressed="false">Off</button></td><td><span class="pot-move"><button type="button" data-pot-step="-1" aria-label="Move ${m[0]} earlier">↑</button><button type="button" data-pot-step="1" aria-label="Move ${m[0]} later">↓</button></span></td></tr>`;}).join('')}</tbody></table><p>Cooking pot Off remembers the current On/Off selection and switches every effect, including Master Baker, Off. On reinstates only that selection. Effect settings, order, input selection and Master Vol routing stay unchanged. Each selected source leaves the normal dry path and passes through its powered effects in the order above. Each stage’s Dry / Wet blends its incoming signal with its processed output: Dry is left, 100% Wet is right. An Off effect releases its DSP and passes the signal unchanged. Sources sharing an early stage stay isolated if their later routes differ. Turntable keeps its whole-mix, individual-track and drum routes. Wasp’s source modulation remains a pre-chain sidechain. Return amounts and “Through main output” switches still apply. Stir shuffles the order and adds a random 5–11 eligible effects, retaining already-powered effects and their settings. BIG STIR moves the chosen percentage of eligible controls across all eleven effects, including those left Off and all Heavy Lifter tabs. 0% keeps every recipe/input/balance/volume; 100% selects every eligible control. Curves and sample selections count as one control each; dependent object/material choices stay valid. Power/order still change at every percentage. Liquidizer LFO settings/assignments, Master Baker’s recipe and main-output routing stay unchanged. BIG STIR includes Dry/Wet and effect overall volumes, and chooses their inputs only from active, loaded cards with non-zero levels. It does not choose Whole mix or inactive cards. Wasp is eligible only when an active card can be its destination. Bubble Chamber is included: Stir keeps its recipe; BIG STIR randomises it like the other effects. The Master Baker is pinned after the final main/return sum and shares the Cooking pot group power switch. Mega/Sparse leave Master Baker Off; local randomisation and both Stir actions retain its power and settings. Everything is saved with your patch; Mega and Sparse finish with Cooking pot Off for normal output; Mega keeps its newly chosen recipes and effect selection for an explicit On.</p><p class="pot-status" data-pot-status role="status" aria-live="polite"></p>`;
 const amount=card.querySelector('[data-pot-stir-amount]');
 amount.oninput=()=>{card.querySelector('[data-pot-stir-amount-value]').textContent=amount.value+'%';};
 amount.onchange=()=>{const value=Number(amount.value)/100;edit('BIG STIR controls moved',()=>api.setStirAmount(value));};
 for(const event of ['keydown','keyup'])amount.addEventListener(event,e=>e.stopPropagation());
 root.mygrainEffectOutput.mountMainControls(card,'cookingPot',edit);
 for(const select of card.querySelectorAll('[data-effect-input-proxy]')){
  select.onchange=()=>{const key=select.dataset.effectInputProxy,index=Number(select.dataset.potInputIndex),value=select.value;edit(inputLabel(key,index),()=>changeInput(key,index,value));};
  for(const event of ['keydown','keyup'])select.addEventListener(event,e=>e.stopPropagation());
 }

 for(const jump of card.querySelectorAll('[data-pot-source-jump]'))jump.onclick=()=>jumpTo(jump);
 card.querySelector('[data-pot-power]').onclick=()=>edit('Cooking pot on/off',()=>setPower(!powerEnabled()));card.querySelector('[data-pot-shuffle]').onclick=()=>edit('Stir the cooking pot',()=>api.stir());card.querySelector('[data-pot-liquidizer]').onclick=()=>edit('Cooking pot · Liquidizer',()=>liquidize());card.querySelector('[data-pot-mod-reset]').onclick=()=>edit('Cooking pot · Reset all effect modulators',()=>resetModulators());card.querySelector('[data-pot-big-stir]').onclick=()=>edit('BIG STIR cooking pot',()=>api.stir({big:true}));
 for(const row of card.querySelectorAll('[data-pot-effect]')){const key=row.dataset.potEffect,handle=row.querySelector('.pot-handle'),jump=row.querySelector('[data-pot-jump]');jump.onclick=()=>jumpTo(jump,true);row.querySelector('[data-pot-effect-power]').onclick=()=>{const canonical=document.getElementById('performanceLayer'+META[key][2]+'OnBtn');if(canonical&&!canonical.disabled)canonical.click();};for(const btn of row.querySelectorAll('[data-pot-step]'))btn.onclick=()=>move(key,state.order.indexOf(key)+Number(btn.dataset.potStep));
 handle.onkeydown=e=>{if(e.key==='Escape'){cancelDrag();return;}if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();move(key,state.order.indexOf(key)+(e.key==='ArrowUp'?-1:1));}};
 handle.onpointerdown=e=>{if(e.button!==0||busy())return;drag={id:e.pointerId,handle,key,startX:e.clientX,startY:e.clientY,moved:false};handle.setPointerCapture(e.pointerId);};
 handle.onpointermove=e=>{if(!drag||e.pointerId!==drag.id)return;if(!drag.moved&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<7)return;drag.moved=true;row.classList.add('pot-dragging');const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-pot-effect]');if(!target||target===row||!card.contains(target))return;const rect=target.getBoundingClientRect(),from=state.order.indexOf(key),at=state.order.indexOf(target.dataset.potEffect)+(e.clientY>=rect.top+rect.height/2?1:0),order=[...state.order];order.splice(from,1);order.splice(Math.max(0,at-(from<at?1:0)),0,key);drag.order=order;card.querySelectorAll('.pot-drop-target').forEach(el=>el.classList.remove('pot-drop-target'));target.classList.add('pot-drop-target');};
 handle.onpointerup=e=>{if(!drag||e.pointerId!==drag.id)return;const changed=drag.moved,order=drag.order||state.order;cancelDrag();if(changed&&JSON.stringify(order)!==JSON.stringify(state.order))edit('Cooking pot dragged effect order',()=>restore({...state,enabled:true,order}));};handle.onpointercancel=cancelDrag;handle.onlostpointercapture=()=>{if(drag)cancelDrag();};
 }
 for(const [parent,cls]of [[document.querySelector('#sectionJumpPanel .section-jump-grid'),'section-jump-option'],[document.getElementById('performanceMixerJumpCard'),'performance-btn performance-mixer-jump-btn'],[document.querySelector('#performanceLayerSwitchesCard .performance-layer-switches'),'performance-btn performance-layer-jump-btn']])if(parent){const btn=document.createElement('button');btn.type='button';btn.className=cls;if(parent.closest('#performanceLayerSwitchesCard'))btn.id='performanceLayerCookingPotJumpBtn';btn.dataset.jumpTarget='#cookingPotCard';btn.setAttribute('aria-label','Jump to The cooking pot');btn.innerHTML=potIcon+'<span class="jump-button-label">The cooking pot</span>';btn.onclick=()=>jumpTo(btn);const ai=parent.querySelector('[data-jump-target="#aiPatchCard"]');if(ai)ai.after(btn);else parent.append(btn);}
 const quick=document.getElementById('sectionJumpCookingPotBtn');if(quick)quick.innerHTML=potIcon+'<span class="jump-button-label">The cooking pot</span>';
 root.mygrainNavigation?.refresh();const watch=new MutationObserver(records=>{if(records.some(r=>r.target.id?.startsWith('performanceLayer')||r.target.matches?.('#loopDMutilatorToggle,#bassFaceToggle')||r.type==='childList'&&[...r.addedNodes].some(n=>n.nodeType===1&&!card.contains(n))))syncUi();});watch.observe(document.body,{attributes:true,attributeFilter:['aria-pressed'],childList:true,subtree:true});root.mygrainCardHistory?.subscribe?.(syncUi);syncUi();
}
// Native companions reuse the same history-wrapped actions and canonical switches.
api.remoteState=()=>({enabled:powerEnabled(),order:state.order.filter(k=>!['henrysHose','heavyLifter'].includes(k)).map(k=>KEYS.indexOf(k)),mask:KEYS.slice(0,9).reduce((n,k,i)=>n|(values()[k].enabled?1<<i:0),0)});
api.remoteControl=async(action,index,value)=>{
 if(!Number.isInteger(index)||!Number.isInteger(value))throw Error('Invalid Pot command.');
 if(action===10){const button=card?.querySelector(`[data-pot-jump="${KEYS[index]}"]`);if(!button)throw Error('Effect unavailable.');jumpTo(button,true);root.focus();return;}
 if(busy())throw Error('Finish the current edit first.');
 if(action===7){const button=document.getElementById('performanceLayer'+META[KEYS[index]]?.[2]+'OnBtn');if(!button||button.disabled)throw Error('Effect unavailable.');if((button.getAttribute('aria-pressed')==='true')!==!!value)button.click();const until=performance.now()+30000;do{await new Promise(r=>setTimeout(r,25));if(performance.now()>until)throw Error('Effect power change timed out.');}while(root.mygrainCardHistory?.busy);await pending;return;}
 let failure=null;
 await edit(action===8?(index?'BIG STIR cooking pot':'Stir the cooking pot'):'Cooking pot native edit',async()=>{try{
  if(action===6)await setPower(!!value);
  else if(action===8)await stir({big:!!index});
  else if(action===9){const legacy=state.order.filter(key=>!['henrysHose','heavyLifter'].includes(key)),from=legacy.indexOf(KEYS[index]);if(from<0||value<0||value>=legacy.length)throw Error('Invalid Pot position.');legacy.splice(from,1);legacy.splice(value,0,KEYS[index]);let cursor=0;const order=state.order.map(key=>['henrysHose','heavyLifter'].includes(key)?key:legacy[cursor++]);await restore({...state,enabled:true,order});}
  else throw Error('Unsupported Pot command.');
 }catch(e){failure=e;throw e;}});if(failure)throw failure;
};
root.addEventListener('load',mount,{once:true});api.mount=mount;
root.addEventListener('mygrain-effect-solo',()=>schedule());
})(globalThis);
