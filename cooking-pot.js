(function(root){
'use strict';
const Model=root.MygrainCookingPot,KEYS=Model.KEYS,bindings=new Set(),modules=new WeakMap(),listeners=new Set();
let state=Model.normalize(readStoredStateSnapshot()?.modes?.cookingPot),pending=Promise.resolve(),queued=false,refreshing=false,nativeMode=false,generation=0,error='';
const nodeIds=new WeakMap();let nodeSerial=0;const nodeId=node=>{if(!nodeIds.has(node))nodeIds.set(node,++nodeSerial);return nodeIds.get(node)};
const unlink=(s,d,...ports)=>{try{s.disconnect(d,...ports)}catch{}},native=ctx=>ctx.__mygrainNativeContext||ctx;
const values=()=>({mutilator:root.mygrainD.settings().mutilator,bassFace:root.mygrainBassFace.settings(),turntable:root.mygrainTurntable.settings(),resonator:root.mygrainResonator.settings(),...root.mygrainAcousticFx.settings(),wasp:root.mygrainWasp.settings(),playground:root.mygrainWasp.settings().playground});
const audible=(key,v)=>['mutilator','bassFace'].includes(key)?v.enabled&&v.mix>0&&v.amount>0:key==='resonator'?root.MygrainResonator.audible(v):root.MygrainAcousticFx.KEYS.includes(key)?root.MygrainAcousticFx.audible(key,v):v.enabled;
const coefficient=(key,v)=>!audible(key,v)?1:['mutilator','bassFace'].includes(key)?1-v.mix:key==='turntable'?0:1;
const clock=ctx=>{const c=root.mygrainWasp.clockSnapshot(ctx);return{...c,pot:true,oversample:'none',time:c.at,snapshot:()=>root.mygrainWasp.clockSnapshot(ctx)}};
const emit=()=>{for(const fn of listeners)fn();syncUi();};
async function prepare(ctx,modes=null){if(!ctx)return;ctx=native(ctx);const requested=modes?Model.normalize(modes.cookingPot).enabled:state.enabled;if(!requested)return;
 if(!modules.has(ctx)){const p=ctx.audioWorklet.addModule(new URL('cooking-pot-worklet.js?v=20261111-source-isolation-1',document.baseURI));modules.set(ctx,p);p.catch(()=>modules.delete(ctx));}await modules.get(ctx);
 const v=modes?{...modes,resonator:modes.resonatorR}:values();
 await Promise.all([root.mygrainResonator.prepare(ctx,v.resonator),root.mygrainAcousticFx.prepare(ctx,v),root.mygrainWasp.prepare(ctx,v.wasp),root.mygrainTurntable.prepare(ctx,v.turntable)]);
}
function retireNode(node){node.onprocessorerror=null;node.disconnect();let timer;const done=()=>{clearTimeout(timer);node.port.onmessage=null;try{node.port.close()}catch{}};node.port.onmessage=({data})=>{if(data.disposed)done()};timer=setTimeout(done,1500);node.port.postMessage({dispose:true});}
function clearTaps(b){for(const t of b.taps)unlink(t.source,t.node,0,t.input);b.taps=[];}
function syncDetectorSources(){for(const b of bindings){clearTaps(b);const entry=b.nodes.get('playground');if(!entry?.node)continue;const settings=root.mygrainWasp.settings().playground;root.MygrainWasp.PLAYGROUND_CONTROLS.forEach((key,i)=>{const lane=settings.modulation[key];if(['off','drawn'].includes(lane.source)||!lane.amount)return;for(const tap of root.mygrainWasp.sourceTaps())if(tap.source.context===b.context&&tap.key!=='DAW'&&root.MygrainWasp.matches(lane.source,tap.key)){tap.source.connect(entry.node,0,i+1);b.taps.push({source:tap.source,node:entry.node,input:i+1});}});}}
// Preserve source selection separately from serial wet ownership. Main dry gets
// only selected-source dry corrections; unrelated loops never excite a wet return.
function connectEdge(b,source,destination,input=0,gain=1){if(!source||source.context!==b.context)return;if(gain!==1){const n=b.context.createGain();n.gain.value=gain;source.connect(n);n.connect(destination,0,input);b.edges.push([source,n,0,n]);}else{source.connect(destination,0,input);b.edges.push([source,destination,input]);}}
function characterTaps(b){const d=(root.mygrainD.potTaps||[]).filter(n=>n.context===b.context);return [...root.mygrainCharacterFx.groups].filter(g=>g.context===b.context&&!g.wholeMix&&!(g.key==='D'&&d.length)).map(g=>({source:g.input,key:g.key})).concat(d.map(source=>({source,key:'D'})));}
const matches=(selected,key)=>root.MygrainBassFace.matches(selected||'D',key);
function audioValues(){const v=values();for(const key of KEYS)if(!root.mygrainEffectOutput.allows(key))v[key]={...v[key],enabled:false};return v;}
function selectedInputs(b,key,v){
 if(key==='mutilator'||key==='bassFace')return v.input==='all'?[[{source:b.source,key:'all'}]]:[characterTaps(b).filter(t=>matches(v.input||'D',t.key))];
 if(key==='resonator')return v.slots.map(slot=>root.mygrainResonator.inputTaps(b.context,slot.source));
 if(root.MygrainAcousticFx.KEYS.includes(key))return [root.mygrainAcousticFx.inputTaps(b.context,v.source)];
 if(key==='playground'&&v.input)return [root.mygrainDawFx?.isExternalContext(b.context)&&v.input!=='DAW'?[]:root.mygrainAcousticFx.inputTaps(b.context,v.input)];
 if(key==='turntable'&&v.input)return [root.mygrainAcousticFx.inputTaps(b.context,v.input)];
 if(key==='turntable')return [root.mygrainTurntable.inputs(b.context,v.route).map(t=>({source:t.source,key:v.route==='mix'?'all':'drums'}))];
 return [[{source:b.source,key:'all'}]];
}
// Scalers belong to the effect topology, not transient source voices. Reuse them
// across drum/grain arrivals so source changes cannot regrow the worklet graph.
function clearScalers(b,wanted=new Set()){
 for(const [key,e]of b.scalers||[])if(!wanted.has(key)){unlink(e.source,e.node);for(const {source,port}of e.dynamics)unlink(source,e.node,3,port);retireNode(e.node);b.scalers.delete(key);}
}
function scaledCarrier(b,source,dynamics,wanted){
 const key=JSON.stringify([nodeId(source),dynamics.map(d=>[nodeId(d.source),d.port])]);wanted.add(key);b.scalers??=new Map();let entry=b.scalers.get(key);
 if(!entry){const node=new AudioWorkletNode(b.context,'mygrain-cooking-pot-base-v2',{numberOfInputs:4,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});source.connect(node);for(const d of dynamics)d.source.connect(node,3,d.port);entry={node,source,dynamics};b.scalers.set(key,entry);}
 return entry.node;
}
function disconnectEdges(b){for(const [source,destination,input,owned,output=0]of b.edges){unlink(source,destination,output,input);owned?.disconnect();}b.edges=[];}
function syncSources(){
 const v=audioValues();for(const b of bindings){if(!b.sum)continue;const taps=characterTaps(b),selected=new Map([...b.nodes].map(([key,e])=>[key,selectedInputs(b,key,v[key])])),stamp=JSON.stringify([state.order,[...b.nodes].map(([k,e])=>[k,Model.scope(k,v[k]),k==='resonator'?v[k].slots.map(s=>s.enabled&&s.level>0):null,nodeId(e.input),selected.get(k).map(slot=>slot.map(t=>[t.key,nodeId(t.source)]))]),taps.map(t=>[t.key,nodeId(t.source)]),['mutilator','bassFace'].map(k=>[v[k].input,coefficient(k,v[k])]),v.turntable.enabled,v.turntable.route,v.turntable.input,v.playground.input]);if(stamp===b.wiringStamp)continue;b.wiringStamp=stamp;disconnectEdges(b);const wantedScalers=new Set(),before=[],selectiveTurntable=b.nodes.has('turntable')&&!!v.turntable.input,newInputs=selectiveTurntable||['mutilator','bassFace'].some(k=>b.nodes.has(k)&&v[k].input==='all');
  const remaining=(key,stages)=>stages.includes('turntable')&&(v.turntable.input?matches(v.turntable.input,key):v.turntable.route==='mix'||key.startsWith('drum'))?0:1;
  const globalFactor=stages=>stages.reduce((n,k)=>['mutilator','bassFace'].includes(k)&&v[k].input==='all'?n*coefficient(k,v[k]):n,1);
  const localFactor=(key,stages)=>stages.reduce((n,k)=>['mutilator','bassFace'].includes(k)&&v[k].input!=='all'&&matches(v[k].input||'D',key)?n*coefficient(k,v[k]):n,1);
  const factor=(key,stages)=>stages.reduce((n,k)=>['mutilator','bassFace'].includes(k)&&matches(v[k].input||'D',key)?n*coefficient(k,v[k]):n,1);
  for(const key of state.order){const e=b.nodes.get(key);if(!e)continue;
   selected.get(key).forEach((sources,i)=>{for(const tap of sources){if(tap.key==='all'||tap.key==='drums'){
     connectEdge(b,tap.source,e.base[i],0,globalFactor(before)*remaining(tap.key,before));
     // Source-selected Turntable owns its physical dry gate. Before that stage,
     // restore its pre-insert excitation for any Whole-mix effect; afterwards
     // only the ordered wet carrier supplies it. Never duplicate final main dry.
     if(selectiveTurntable&&!before.includes('turntable'))for(const source of selected.get('turntable')?.[0]||[])if(tap.key==='all'||source.key.startsWith('drum'))connectEdge(b,source.source,e.base[i],0,factor(source.key,before));
     for(const source of taps)if(tap.key==='all'||source.key.startsWith('drum')){const correction=!newInputs?(before.includes('turntable')&&v.turntable.route==='mix'?0:factor(source.key,before)-1):selectiveTurntable&&matches(v.turntable.input,source.key)||before.includes('turntable')&&v.turntable.route==='drums'&&source.key.startsWith('drum')?0:factor(source.key,before)*remaining(source.key,before)-globalFactor(before)*remaining(tap.key,before);if(correction)connectEdge(b,source.source,e.base[i],0,correction);}
    }else connectEdge(b,tap.source,e.base[i],0,factor(tap.key,before)*remaining(tap.key,before));}
   });
   // Earlier global insert attenuation follows the same per-sample transport clock.
   for(const i of e.base.keys()){
    for(const [k,port]of [['wasp',1],['playground',2]])if(before.includes(k)){const source=b.nodes.get(k).node;source.connect(e.base[i],3,port);b.edges.push([source,e.base[i],port,null,3]);}
    const selective=!!v.playground.input&&before.includes('playground');e.base[i].port.postMessage({selectivePlayground:selective});
    if(selective){
     const subset=new Map();for(const tap of selected.get(key)[i]){
      if(tap.key==='all'||tap.key==='drums'){for(const source of selected.get('playground')?.[0]||[])if(tap.key==='all'||source.key.startsWith('drum'))subset.set(nodeId(source.source),source);}
      else if(root.MygrainWasp.matches(v.playground.input,tap.key))subset.set(nodeId(tap.source),tap);
     }
     for(const tap of subset.values())connectEdge(b,tap.source,e.base[i],3,factor(tap.key,before)*remaining(tap.key,before));
    }
   }
   // Route each earlier wet contribution independently. The old aggregate
   // carrier had lost source identity and leaked unrelated tracks into this DSP.
   const slots=key==='resonator'?v[key].slots.map(s=>s.enabled&&s.level>0?[s.source]:[]):[Model.scope(key,v[key])];
   for(const [slot,selection]of slots.entries())for(const prior of before){
    const provenance=Model.scope(prior,v[prior]);if(!Model.covers(selection,provenance))continue;
    const middle=before.slice(before.indexOf(prior)+1).filter(k=>Model.covers(Model.scope(k,v[k]),provenance));
    const gain=middle.reduce((n,k)=>n*coefficient(k,v[k]),1);if(!gain)continue;
    const dynamics=middle.filter(k=>k==='wasp'||k==='playground');let carrier=b.nodes.get(prior).wet;
    if(dynamics.length)carrier=scaledCarrier(b,carrier,dynamics.map(k=>({source:b.nodes.get(k).node,port:k==='wasp'?1:2})),wantedScalers);
    connectEdge(b,carrier,key==='resonator'?e.node:e.input,key==='resonator'?slot:0,gain);
   }
   before.push(key);
  }
  // Product of the character inserts affects only their selected original stems.
  for(const tap of taps){if(v.turntable.enabled&&v.turntable.route==='drums'&&tap.key.startsWith('drum'))continue;if(selectiveTurntable&&matches(v.turntable.input,tap.key))continue;const correction=localFactor(tap.key,before)-1;if(correction)connectEdge(b,tap.source,b.sum,12,correction);}
  const pg=b.nodes.get('playground');if(pg?.dryCorrection&&v.playground.input){
   const preceding=state.order.slice(0,state.order.indexOf('playground')).filter(key=>b.nodes.has(key));
   for(const tap of selected.get('playground')[0])connectEdge(b,tap.source,pg.dryCorrection,0,localFactor(tap.key,state.order)*globalFactor(preceding)*remaining(tap.key,preceding));
   if(preceding.includes('wasp')&&b.nodes.has('wasp')){const source=b.nodes.get('wasp').node;source.connect(pg.dryCorrection,3,1);b.edges.push([source,pg.dryCorrection,1,null,3]);}
  }
  clearScalers(b,wantedScalers);
 }syncDetectorSources();
}
function retireEntry(b,key){const e=b.nodes.get(key);if(!e)return;clearTaps(b);e.graph?.dispose();if(e.node)retireNode(e.node);if(e.carry)retireNode(e.carry);if(e.dryCorrection)retireNode(e.dryCorrection);for(const n of e.base)retireNode(n);for(const n of [e.input,e.output,e.wet,e.cancel])n?.disconnect();b.nodes.delete(key);}
function newEntry(b,key,v){const ctx=b.context,e={key,input:ctx.createGain(),output:ctx.createGain(),wet:ctx.createGain(),base:Array.from({length:key==='resonator'?2:1},()=>new AudioWorkletNode(ctx,'mygrain-cooking-pot-base-v2',{numberOfInputs:4,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'}))};e.wet.connect(e.output);e.wet.connect(b.sum,0,KEYS.indexOf(key)+1);
 if(key==='mutilator'||key==='bassFace'){
  e.base[0].connect(e.input);e.cancel=ctx.createGain();e.cancel.gain.value=-coefficient(key,v);e.base[0].connect(e.cancel);e.cancel.connect(e.output);
  e.graph=(key==='mutilator'?root.MygrainMutilator:root.MygrainBassFace).createGraph(ctx,e.input,e.output,{...clock(ctx),wetDestination:e.wet});e.graph.set(v);
 }else{
  const wasp=key==='wasp'||key==='playground',resonator=key==='resonator',acoustic=root.MygrainAcousticFx.KEYS.includes(key),name=wasp?'mygrain-wasp-master-v2':resonator?'mygrain-resonator-v1':acoustic?'mygrain-acoustic-v1':'mygrain-turntable-v1';
  if(key==='playground'){e.dryCorrection=new AudioWorkletNode(ctx,'mygrain-cooking-pot-base-v2',{numberOfInputs:4,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});e.dryCorrection.connect(b.sum,0,13);}
  e.node=new AudioWorkletNode(ctx,name,{numberOfInputs:wasp?4:resonator?2:1,numberOfOutputs:wasp?4:resonator?2:1,outputChannelCount:wasp?[2,2,2,1]:resonator?[2,2]:[2],channelCount:2,channelCountMode:'explicit',processorOptions:{key,settings:nodeSettings(key,v),tempo:clock(ctx).bpm,clocks:root.mygrainWasp.clockHistory(ctx),clockAligned:key==='turntable'}});
  e.node.onprocessorerror=()=>fail(Error('The cooking pot processor stopped. Original routing restored.'));
  e.input.connect(e.node);e.base[0].connect(e.node);if(resonator){e.input.connect(e.node,0,1);e.base[1].connect(e.node,0,1);}
  if(wasp){
   // Subtract only the selected base's dry portion, using the engine's per-frame
   // coefficient. Its wet return and the previous-stage carrier remain intact.
   e.carry=new AudioWorkletNode(ctx,'mygrain-cooking-pot-carrier-v2',{numberOfInputs:3,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});
   e.node.connect(e.carry,0,0);e.base[0].connect(e.carry,0,1);e.node.connect(e.carry,3,2);e.carry.connect(e.output);e.node.connect(e.wet,key==='wasp'?1:2,0);e.node.connect(b.sum,3,key==='wasp'?10:11);for(const c of root.mygrainWasp.clockHistory(ctx))e.node.port.postMessage({clock:c});
  }else{e.node.connect(e.wet);if(key!=='turntable')e.input.connect(e.output);}
 }
 b.nodes.set(key,e);return e;
}
function nodeSettings(key,v){if(key==='wasp')return{...v,playground:{...v.playground,enabled:false}};if(key==='playground'){const s=root.mygrainWasp.settings();return{...s,enabled:false,playground:v,playgroundInputResolved:true};}return v;}
function refreshGraph(b){const v=audioValues();for(const key of KEYS){if(!audible(key,v[key]))retireEntry(b,key);else{const e=b.nodes.get(key)||newEntry(b,key,v[key]);e.graph?.set(v[key]);if(e.cancel)e.cancel.gain.value=-coefficient(key,v[key]);e.node?.port.postMessage({settings:nodeSettings(key,v[key])});if(key==='resonator'){e.node?.port.postMessage({tempo:clock(b.context).bpm});e.node?.port.postMessage({monitor:root.mygrainResonator.diagnostics().audition});}}}
 const active=state.order.filter(k=>b.nodes.has(k)),returnStages=Object.fromEntries(active.map((key,i)=>[key,active.slice(i+1).filter(next=>Model.covers(Model.scope(next,v[next]),Model.scope(key,v[key])))]));
 b.sum.port.postMessage({order:state.order,returnStages,selectivePlayground:!!v.playground.input,dry:Object.fromEntries(KEYS.map(key=>[key,coefficient(key,v[key])])),mainDry:Object.fromEntries(KEYS.map(key=>[key,['mutilator','bassFace'].includes(key)&&v[key].input!=='all'||key==='turntable'&&(v[key].route==='drums'||v[key].input)?1:coefficient(key,v[key])]))});syncSources();
}
function createSum(b){b.sum=new AudioWorkletNode(b.context,'mygrain-cooking-pot-sum-v1',{numberOfInputs:14,numberOfOutputs:10,outputChannelCount:Array(10).fill(2),channelCount:2,channelCountMode:'explicit',processorOptions:{order:state.order,dry:{}}});b.source.connect(b.sum,0,0);b.sum.connect(root.mygrainEffectOutput.potInput(null,b.context),0,0);KEYS.forEach((key,i)=>b.sum.connect(root.mygrainEffectOutput.potInput(key,b.context),i+1,0));b.sum.onprocessorerror=()=>fail(Error('The cooking pot mixer stopped. Original routing restored.'));}
function disposeGraph(b){clearTaps(b);disconnectEdges(b);clearScalers(b);for(const key of [...b.nodes.keys()])retireEntry(b,key);if(b.sum){unlink(b.source,b.sum);retireNode(b.sum);b.sum=null;b.wiringStamp='';}root.mygrainEffectOutput.setPotActive(b.context,false);}
async function refreshNative(){refreshing=true;try{await Promise.all([root.mygrainResonator.restore(root.mygrainResonator.settings()),root.mygrainAcousticFx.restore(root.mygrainAcousticFx.settings()),root.mygrainTurntable.restore(root.mygrainTurntable.settings()),root.mygrainWasp.restore(root.mygrainWasp.settings())]);root.mygrainCharacterFx.update();root.mygrainD.setMutilator(root.mygrainD.settings().mutilator,{skipSave:true});}finally{refreshing=false;}}
async function reconcile(){root.mygrainEffectOutput.sync();const token=++generation,stamp=JSON.stringify([state,values()]);if(!state.enabled){for(const b of bindings)disposeGraph(b);if(nativeMode){nativeMode=false;await refreshNative();}if(stamp!==JSON.stringify([state,values()]))return schedule();emit();return;}
 for(const b of bindings){await prepare(b.context);if(token!==generation||!state.enabled||!bindings.has(b))return;if(!b.sum)createSum(b);refreshGraph(b);root.mygrainEffectOutput.setPotActive(b.context,true);}
 if(!nativeMode){nativeMode=true;await refreshNative();}if(stamp!==JSON.stringify([state,values()]))return schedule();emit();}
function fail(e){nativeMode=false;error=e.message;state={...state,enabled:false};for(const b of bindings)disposeGraph(b);refreshNative().catch(()=>{});emit();if(!root.__mygrainSongRenderDeck)setStatus(error,'error');}
function schedule(){if(refreshing)return pending;if(!queued){queued=true;pending=Promise.resolve().then(()=>{queued=false;return reconcile();}).catch(e=>{fail(e);throw e;});pending.catch(()=>{});}return pending;}
function restore(value){state=Model.normalize(value);error='';emit();return schedule();}
function releaseContext(ctx){generation++;for(const b of [...bindings])if(!ctx||b.context===native(ctx)){disposeGraph(b);bindings.delete(b);}emit();}
// Generation only: recipes are frozen through the same canonical card setters.
// Keep Mega/Sparse's independent coin-flips separate from the two-effect Stir policy.
function bigStirSettings(current,random){
 const pick=a=>a[Math.floor(random()*a.length)],next=structuredClone(current),inputs=[...new Set(root.mygrainCharacterFx.activeInputs())].filter(key=>key!=='all'&&root.MygrainEffectInputs.SOURCES.includes(key)&&(!key.startsWith('drum')||isDrumMachineLaneAudible(key.slice(4).toLowerCase())));
 if(!inputs.length)throw Error('BIG STIR needs an active, loaded card with its level above zero.');
 next.mutilator={...pick(root.MygrainMutilatorPresets.PRESETS).settings(),input:pick(inputs)};
 next.bassFace={...pick(root.MygrainBassFace.PRESETS).settings(),input:pick(inputs)};
 next.turntable={...current.turntable,route:'mix',input:pick(inputs),rpm:pick([33,45,78]),year:1920+Math.floor(random()*(root.MygrainTurntable.TODAY-1919)),needle:pick(['modern','old']),wow:random()*.6,flutter:random()*.5,hum:random()*.35,mainsHz:pick([50,60]),clicks:random()*.5,crackle:random()*.6,wear:random(),output:-random()*4};
 next.resonator=root.MygrainResonator.normalize({...current.resonator,outputLevel:.4+random()*.4,slots:[0,1].map(i=>{
  const object=pick(['door','wall','pipe','cone']);return {...root.MygrainResonator.objectDefaults(object),enabled:i===0||random()<.5,object,material:pick(root.MygrainResonator.MATERIALS[object]),source:pick(inputs),band:pick(['full','bass','mid','treble']),drive:6+random()*20,damping:.2+random()*.7,level:.2+random()*.4,pan:random()*1.4-.7,looseness:random(),...(object==='pipe'?{length:.2+random()*3,diameter:.02+random()*.2}:{}),...(object==='cone'?{radius:.08+random()*.2,tear:random(),rub:random()*.6}:{}),...(['door','wall'].includes(object)?{width:.4+random()*2,height:.5+random()*2,thickness:5+random()*45,gap:random()*8}:{} )};
 })});
 for(const key of root.MygrainAcousticFx.KEYS.filter(key=>key!=='bubbleChamber'))next[key]={...pick(root.MygrainAcousticPresets.BANKS[key]).settings(),source:pick(inputs)};
 const keys=inputs.filter(key=>root.MygrainWasp.KEYS.includes(key));
 next.wasp=keys.length?root.MygrainWasp.randomize(current.wasp,keys,random):structuredClone(current.wasp);
 // Wasp cannot process D/host-only carriers; never invent an inactive X fallback.
 for(const route of next.wasp.routes.slice(0,2)){route.source=pick(keys.length?keys:inputs);if(keys.length)route.destination=pick(keys);else route.enabled=false;}
 next.wasp.blend=.45+random()*.5;
 next.wasp.filter={...pick(Object.values(root.MygrainWasp.filterPresets)),enabled:true};
 next.playground=root.MygrainWasp.playground({input:pick(inputs),routeKick:false,tempo:getSharedBpmClockValue(),mode:pick(['lowpass','highpass','bandpass','notch','comb','combNegative','allpass','peak']),slope:pick([12,24,36,48]),cutoff:180*2**(random()*5),resonant:240*2**(random()*5),q:.7+random()*5,glide:.2+random()*3,motion:.45+random()*.55,mix:.4+random()*.6,modulation:Object.fromEntries(root.MygrainWasp.PLAYGROUND_CONTROLS.map(key=>{
  const steps=pick([2,4,8,16]),curve=Array.from({length:steps},()=>random()*2-1),sync=random()<.7;
  return [key,{source:'drawn',amount:.3+random()*.65,clock:sync?'sync':'hz',hz:.08+random()*3,beats:pick([1,2,4,8]),multiplier:pick([.5,1,2,4]),timing:pick(['straight','dotted','triplet']),interpolation:pick(['hold','linear']),curve:Array.from({length:64},(_,i)=>curve[Math.floor(i*steps/64)])}];
 }))});
 return next;
}
async function applyStirSettings(next,pot){
 // Sparse recipes omit defaults; expand them before D's merging setter.
 root.mygrainD.setMutilator({...root.MygrainMutilator.EXT,input:'D',...next.mutilator},{skipSave:true});root.mygrainBassFace.restore(next.bassFace);
 const results=await Promise.allSettled([root.mygrainTurntable.restore(next.turntable),root.mygrainResonator.restore(next.resonator),root.mygrainAcousticFx.restore(Object.fromEntries(root.MygrainAcousticFx.KEYS.map(key=>[key,next[key]]))),root.mygrainWasp.restore({...next.wasp,playground:next.playground})]);
 const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
 await restore(pot);await pending;
}
async function stir({big=false,random=Math.random}={}){
 const account=root.mygrainAccounts?.user?.username,context=audioContext;
 await ensurePatchZipAudioReady();
 if(root.mygrainAccounts?.user?.username!==account||audioContext!==context||stateSaveSuspended)throw Error('Account or audio changed; Stir cancelled.');
 const previous=values(),previousPot=Model.normalize(state),draw=()=>{const n=random();if(!Number.isFinite(n))throw Error('Invalid Stir random value.');return Math.max(0,Math.min(1-Number.EPSILON,n));};
 const next=big?bigStirSettings(previous,draw):structuredClone(previous),pot=Model.shuffle(previousPot,draw),selected=new Set(Model.shuffle(previousPot,draw).order.filter(key=>key!=='bubbleChamber'&&(!big||key!=='wasp'||next.wasp.routes.some(route=>route.enabled))&&(key!=='mutilator'||next.mutilator.amount>0&&next.mutilator.mix>0)).slice(0,2));
 for(const key of KEYS)next[key].enabled=selected.has(key);
 const previousMaster=root.mygrainMasterBaker?.settings();
 try{await root.mygrainMasterBaker?.randomiseOff();await applyStirSettings(next,pot);}catch(e){await applyStirSettings(previous,previousPot);if(previousMaster)await root.mygrainMasterBaker.restore(previousMaster);throw e;}
 return {pot:Model.normalize(state),enabled:KEYS.filter(key=>selected.has(key))};
}
const api={setResonatorMonitor(monitor){for(const b of bindings)b.nodes.get('resonator')?.node?.port.postMessage({monitor});},settings:()=>Model.normalize(state),restore,stir,active:()=>state.enabled,changed(){if(!refreshing)schedule();},prepare,whenReady:()=>pending,syncSources,bind(source){for(const b of [...bindings])if(b.context===source.context)releaseContext(b.context);const b={source,context:source.context,sum:null,nodes:new Map(),edges:[],taps:[]};bindings.add(b);schedule();},releaseContext,clear(){for(const b of bindings)for(const [key,e]of b.nodes)if(key==='resonator'||root.MygrainAcousticFx.KEYS.includes(key))e.node?.port.postMessage({clear:true});},async randomise({random=Math.random,sparse=false}={}){await root.mygrainMasterBaker?.randomiseOff();await root.mygrainAcousticFx.set('bubbleChamber',{...root.mygrainAcousticFx.settings('bubbleChamber'),enabled:false});return restore(sparse?{...state,enabled:false}:Model.shuffle(state,random));},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},diagnostics:()=>({enabled:state.enabled,order:[...state.order],contexts:bindings.size,clocks:[...bindings].map(b=>({clock:root.mygrainWasp.clockSnapshot(b.context),effects:[...b.nodes.values()].filter(e=>e.graph).map(e=>({key:e.key,clock:e.graph.clock}))})),scalers:[...bindings].reduce((n,b)=>n+(b.scalers?.size||0),0),processors:[...bindings].reduce((n,b)=>n+b.nodes.size,0),chains:[...bindings].map(b=>state.order.filter(k=>b.nodes.has(k))),error})};root.mygrainCookingPot=api;
// State remains owned by each card. Observe its setter, never duplicate its power.
for(const [owner,method]of [[root.mygrainD,'setMutilator'],[root.mygrainBassFace,'restore'],[root.mygrainWasp,'restore'],[root.mygrainResonator,'restore'],[root.mygrainAcousticFx,'restore'],[root.mygrainTurntable,'restore']]){const original=owner[method];owner[method]=function(...args){const result=original.apply(this,args);if(!refreshing)schedule();return result;};}
for(const runtime of [root.mygrainWasp,root.mygrainResonator,root.mygrainAcousticFx,root.mygrainTurntable])runtime.subscribe(()=>{if(!refreshing)schedule();});
const oldClock=root.mygrainWasp.syncClock;let clockPrint='';root.mygrainWasp.syncClock=function(...args){const result=oldClock.apply(this,args);if(!args.slice(0,3).every(Number.isFinite))return result;const print=args.join(':');if(print!==clockPrint){clockPrint=print;for(const b of bindings)for(const e of b.nodes.values()){e.node?.port.postMessage({clock:{origin:args[0],bpm:args[1],at:args[2]},tempo:args[1]});if(e.graph){const signature=args.slice(0,2).join(':');if(e.clockPrint!==signature){e.clockPrint=signature;e.graph.set(values()[e.key]);}}}}return result;};
const originalRelease=root.mygrainChannelEq.releaseContext;root.mygrainChannelEq.releaseContext=function(ctx){releaseContext(ctx);return originalRelease.call(this,ctx);};
root.addEventListener('mygrain-account-lock',()=>releaseContext());root.addEventListener('pagehide',()=>releaseContext());

const META={mutilator:['Mutilator','loopDMutilator','Mutilator','#58b787'],bassFace:['Bass Face','bassFaceCard','BassFace','#80d8a7'],turntable:['Turntable','turntableCard','Turntable','#e0c69a'],resonator:['Olaf’s Resonator','resonatorCard','Resonator','#e8a278'],wireWorld:['WireWorld','wireWorldCard','WireWorld','#ffba76'],sonicCrystal:['Sonic Crystal','sonicCrystalCard','SonicCrystal','#95fbd9'],bubbleChamber:['Bubble Chamber','bubbleChamberCard','BubbleChamber','#a6ccff'],wasp:['The Wasp','waspCard','Wasp','#f9d96a'],playground:['Filter Playground','filterPlaygroundCard','Playground','#65e6d6']};
const potIcon='<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 27h36v16c0 10-8 15-18 15S14 53 14 43zM9 27h46M14 32H7v10h7m36-10h7v10h-7M20 23c-7-7 7-8 0-16m12 16c-7-7 7-8 0-16m12 16c-7-7 7-8 0-16"/><path d="M25 39c4-5 10-5 14 0m-12 7h10"/></svg>';
const spoonIcon='<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="43" cy="17" rx="10" ry="14" transform="rotate(35 43 17)"/><path d="M35 29 12 57c-3 3-7-1-4-4l24-27"/></svg>';
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
function syncUi(){if(!card)return;syncJumps();const v=values(),power=card.querySelector('[data-pot-power]');power.querySelector('[data-pot-power-label]').textContent='Cooking pot '+(state.enabled?'On':'Off');power.setAttribute('aria-pressed',String(state.enabled));card.dataset.enabled=String(state.enabled);power.disabled=busy();
 for(const [i,key]of state.order.entries()){const row=card.querySelector(`[data-pot-effect="${key}"]`),meta=META[key];syncInputs(row,key,v[key]);if(!drag){const body=card.querySelector('tbody');if(body.children[i]!==row)body.insertBefore(row,body.children[i]||null);}row.querySelector('.pot-handle').textContent='⠿ '+(i+1);const btn=row.querySelector('[data-pot-effect-power]');btn.textContent=v[key].enabled?'On':'Off';btn.setAttribute('aria-pressed',String(!!v[key].enabled));btn.disabled=busy();row.querySelector('[data-pot-step="-1"]').disabled=busy()||i===0;row.querySelector('[data-pot-step="1"]').disabled=busy()||i===KEYS.length-1;row.querySelector('.pot-handle').disabled=busy();const holder=row.querySelector('[data-pot-icon]'),source=document.getElementById(meta[1]),svg=source?.querySelector('.wasp-head svg,.wasp-pg-head svg,.tt-header h3 svg,.r-art svg,.acoustic-title svg,.d-mutilator-head svg,.bass-face-head svg');if(svg&&holder.dataset.sourceSvg!==svg.outerHTML){holder.dataset.sourceSvg=svg.outerHTML;const clone=svg.cloneNode(true);clone.removeAttribute('id');clone.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));clone.setAttribute('aria-hidden','true');clone.style.color='inherit';holder.replaceChildren(clone);const color=getComputedStyle(svg).color,rgb=color.match(/[0-9.]+/g)?.slice(0,3).map(Number),luma=rgb?(.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]):0;row.style.setProperty('--effect-color',luma>105?color:meta[3]);}}
 for(const button of card.querySelectorAll('[data-pot-shuffle],[data-pot-big-stir],[data-effect-main-mute],[data-effect-through-main-all]'))button.disabled=busy();card.querySelector('[data-pot-status]').textContent=error||(state.enabled?'On · '+state.order.map(key=>META[key][0]+(v[key].enabled?'':' (Off)')).join(' → '):'Off · original card input routes are in use. Drag a row to start cooking.');}
function move(key,to){const order=[...state.order],from=order.indexOf(key);to=Math.max(0,Math.min(order.length-1,to));if(from===to)return;order.splice(from,1);order.splice(to,0,key);return edit('Cooking pot effect order',()=>restore({...state,enabled:true,order}));}
function cancelDrag(){if(!drag)return;const d=drag;drag=null;try{d.handle.releasePointerCapture(d.id)}catch{}card.querySelectorAll('.pot-dragging,.pot-drop-target').forEach(el=>el.classList.remove('pot-dragging','pot-drop-target'));syncUi();}
function mount(){if(root.__mygrainSongRenderDeck||card)return;card=document.getElementById('cookingPotCard');if(!card)return;
 document.addEventListener('click',e=>{if(e.target.closest('[data-jump-target],[data-jump-click]'))navigationRequest++;},true);
 card.innerHTML=`<header class="pot-heading">${potIcon}<div><span class="pot-kicker">SERIAL EFFECTS MATRIX</span><h3>The cooking pot</h3></div></header><p>Drag the handles to change the real audio order, top to bottom. Off effects are bypassed. Each switch is linked to its card and Layers.</p><div class="pot-actions"><button type="button" class="performance-btn" data-pot-power aria-pressed="false">${potIcon}<span data-pot-power-label>Cooking pot Off</span></button><button type="button" class="performance-btn" data-pot-shuffle title="Shuffle the order and switch two effects on; keep all effect settings">${spoonIcon}<span>Stir the pot</span></button><button type="button" class="performance-btn" data-pot-big-stir title="Randomise effect recipes, choose inputs from active cards and shuffle the order, then leave two eligible effects on; Bubble Chamber stays Off">${ladleIcon}<span>BIG STIR</span></button></div><table class="pot-table" aria-label="Cooking pot effects order"><colgroup><col class="pot-order-col"><col><col class="pot-power-col"><col class="pot-move-col"></colgroup><thead><tr><th scope="col" aria-label="Effect order">#</th><th scope="col">Effect</th><th scope="col">Power</th><th scope="col">Move</th></tr></thead><tbody>${KEYS.map(key=>{const m=META[key];return`<tr data-pot-effect="${key}" style="--effect-color:${m[3]}"><td><button type="button" class="pot-handle" aria-label="Reorder ${m[0]}; use arrow up or down">⠿</button></td><td><div class="pot-effect-cell"><button type="button" class="pot-effect-name pot-effect-jump" data-pot-jump="${key}" data-jump-target="#${m[1]}" aria-label="Jump to ${m[0]}"><span data-pot-icon></span><span>${m[0]}<small class="pot-jump-label">Jump ↗</small></span></button>${inputMenus(key)}</div></td><td><button type="button" class="pot-linked-power" data-pot-effect-power="${key}" aria-label="${m[0]} power" aria-pressed="false">Off</button></td><td><span class="pot-move"><button type="button" data-pot-step="-1" aria-label="Move ${m[0]} earlier">↑</button><button type="button" data-pot-step="1" aria-label="Move ${m[0]} later">↓</button></span></td></tr>`;}).join('')}</tbody></table><p>Pot On changes effect order, not input selection or Master Vol routing. Each effect processes its selected tracks and compatible earlier returns. An earlier Whole mix return bypasses later single-track stages; choose Whole mix there to process that combined return. Turntable keeps its whole-mix, individual-track and drum routes. Wasp’s source modulation remains a pre-chain sidechain. Return amounts and “Through main output” switches still apply. Stir shuffles the order and leaves two eligible effects On, keeping their settings. BIG STIR also randomises the eligible effects, including those left Off, and chooses their inputs only from active, loaded cards with non-zero levels. It does not choose Whole mix or inactive cards. Wasp is eligible only when an active card can be its destination. Bubble Chamber is manual-only: both Stir actions leave it Off and keep its settings. The Master Baker is pinned after the final main/return sum, even when the Pot is Off. Both Stir actions and patch randomisation leave Master Baker Off, keeping its settings. Everything is saved with your patch; Mega keeps its independent effect choices.</p><p class="pot-status" data-pot-status role="status" aria-live="polite"></p>`;
 root.mygrainEffectOutput.mountMainControls(card,'cookingPot',edit);
 for(const select of card.querySelectorAll('[data-effect-input-proxy]')){
  select.onchange=()=>{const key=select.dataset.effectInputProxy,index=Number(select.dataset.potInputIndex),value=select.value;edit(inputLabel(key,index),()=>changeInput(key,index,value));};
  for(const event of ['keydown','keyup'])select.addEventListener(event,e=>e.stopPropagation());
 }

 for(const jump of card.querySelectorAll('[data-pot-source-jump]'))jump.onclick=()=>jumpTo(jump);
 card.querySelector('[data-pot-power]').onclick=()=>edit('Cooking pot on/off',()=>restore({...state,enabled:!state.enabled}));card.querySelector('[data-pot-shuffle]').onclick=()=>edit('Stir the cooking pot',()=>api.stir());card.querySelector('[data-pot-big-stir]').onclick=()=>edit('BIG STIR cooking pot',()=>api.stir({big:true}));
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
api.remoteState=()=>({enabled:state.enabled,order:state.order.map(k=>KEYS.indexOf(k)),mask:KEYS.reduce((n,k,i)=>n|(values()[k].enabled?1<<i:0),0)});
api.remoteControl=async(action,index,value)=>{
 if(!Number.isInteger(index)||!Number.isInteger(value))throw Error('Invalid Pot command.');
 if(action===10){const button=card?.querySelector(`[data-pot-jump="${KEYS[index]}"]`);if(!button)throw Error('Effect unavailable.');jumpTo(button,true);root.focus();return;}
 if(busy())throw Error('Finish the current edit first.');
 if(action===7){const button=document.getElementById('performanceLayer'+META[KEYS[index]]?.[2]+'OnBtn');if(!button||button.disabled)throw Error('Effect unavailable.');if((button.getAttribute('aria-pressed')==='true')!==!!value)button.click();const until=performance.now()+30000;do{await new Promise(r=>setTimeout(r,25));if(performance.now()>until)throw Error('Effect power change timed out.');}while(root.mygrainCardHistory?.busy);await pending;return;}
 let failure=null;
 await edit(action===8?(index?'BIG STIR cooking pot':'Stir the cooking pot'):'Cooking pot native edit',async()=>{try{
  if(action===6)await restore({...state,enabled:!!value});
  else if(action===8)await stir({big:!!index});
  else if(action===9){const order=[...state.order],from=order.indexOf(KEYS[index]);if(from<0||value<0||value>=KEYS.length)throw Error('Invalid Pot position.');order.splice(from,1);order.splice(value,0,KEYS[index]);await restore({...state,enabled:true,order});}
  else throw Error('Unsupported Pot command.');
 }catch(e){failure=e;throw e;}});if(failure)throw failure;
};
root.addEventListener('load',mount,{once:true});api.mount=mount;
root.addEventListener('mygrain-effect-solo',()=>schedule());
})(globalThis);
