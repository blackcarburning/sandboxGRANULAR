/* Optional serial effects rack. Missing state retains the original routing. */
(function(root){
'use strict';
const Lfo=typeof module==='object'&&module.exports?require('./effect-lfo.js'):root.MygrainEffectLfo;
const KEYS=['mutilator','bassFace','turntable','resonator','wireWorld','sonicCrystal','bubbleChamber','wasp','playground','henrysHose','heavyLifter'];
function normalize(value){const order=Array.isArray(value?.order)?value.order:[],state={version:1,enabled:value?.enabled===true,order:[...new Set([...order.filter(k=>KEYS.includes(k)),...KEYS])]};
 if(value?.mixes&&typeof value.mixes==='object'){const mixes=Object.fromEntries(KEYS.filter(k=>!['mutilator','bassFace','wasp','playground'].includes(k)&&Number.isFinite(value.mixes[k])).map(k=>[k,Math.max(0,Math.min(1,value.mixes[k]))]));if(Object.keys(mixes).length)state.mixes=mixes;}
 if(Number.isFinite(value?.stirAmount)&&value.stirAmount!==1)state.stirAmount=Math.max(0,Math.min(1,value.stirAmount));
 // Optional group-switch memory is not an audio routing flag. Legacy enabled
 // is retained as legacy metadata; source-owned insert routing is universal.
 if(typeof value?.power?.enabled==='boolean'&&value.power.remembered&&typeof value.power.remembered==='object')state.power={enabled:value.power.enabled,remembered:Object.fromEntries([...KEYS,'masterBaker'].map(key=>[key,value.power.remembered[key]===true]))};return state;}
function shuffle(value,random=Math.random){const order=normalize(value).order;for(let i=order.length-1;i>0;i--){const j=Math.max(0,Math.min(i,Math.floor(random()*(i+1))));[order[i],order[j]]=[order[j],order[i]];}const {power,...routing}=normalize(value);return{...routing,enabled:true,order};}
// A combined wet return cannot be split back into its original sources. A later
// selector may receive it only when that selector covers its entire provenance.
const leaves=key=>key==='K'?['K1','K2','K3','K4','K5']:key==='drums'?['drumKick','drumSnare','drumHat','drumPerc','drumClap','drumCymbals','drumEtc','drumRoll']:[key];
function covers(selection,provenance){if(selection.includes('all'))return true;const allowed=new Set(selection.flatMap(leaves));return provenance.length>0&&provenance.flatMap(leaves).every(key=>allowed.has(key));}
const resonatorSlots=v=>[0,1].map(i=>({enabled:i===0,level:.45,source:i===0?'drumKick':'X',...v.slots?.[i]}));
function scope(key,v){if(key==='resonator')return [...new Set(resonatorSlots(v).filter(s=>s.enabled&&s.level>0).map(s=>s.source))];if(key==='wasp')return ['all'];if(key==='turntable')return [v.input||(v.route==='drums'?'drums':'all')];return [v.input||v.source||(key==='mutilator'?'D':key==='bassFace'?'X':'all')];}
// Every powered insert owns its selected signal, even at zero return level.
// Missing/off patches retain their old render identity; every active chain needs v4.
function renderVersion(modes={}){const values=effectValues(modes);return KEYS.some(k=>values[k]?.enabled&&selection(k,values[k]).some(s=>s!=='DAW'))?4:0;}
function effectValues(modes={}){const w=modes.wasp||{};return{...modes,mutilator:modes.loopD?.mutilator||{},resonator:modes.resonatorR||{},wasp:w,playground:w.playground||{}};}
const LEAVES=Object.freeze(['A','B','C','D','V','W','P','O','L','X','Q','M','M+','generated','sample','K1','K2','K3','K4','K5','drumKick','drumSnare','drumHat','drumPerc','drumClap','drumCymbals','drumEtc','drumRoll','N','DAW','*']);
const match=(choice,key)=>choice==='all'||choice===key||choice==='K'&&/^K[1-5]$/.test(key)||choice==='drums'&&/^drum[A-Z]/.test(key);
function selection(key,v={}){if(key==='wasp')return ['all'];if(key==='resonator')return resonatorSlots(v).filter(s=>s.enabled).map(s=>s.source);return [v.input||v.source||(key==='mutilator'?'D':key==='bassFace'?'X':key==='turntable'&&v.route==='drums'?'drums':'all')];}
function stageFor(key,v,source){if(!v?.enabled)return null;if(key==='wasp')return{key,routes:(v.routes||[]).slice(0,2).map((r,i)=>r.enabled&&match(r.destination,source)?i:-1).filter(i=>i>=0)};if(key==='resonator'){const slots=resonatorSlots(v).map((s,i)=>s.enabled&&match(s.source,source)?i:-1).filter(i=>i>=0);return slots.length?{key,slots}:null;}return selection(key,v).some(s=>match(s,source))?{key}:null;}
function plan(value,values,source){return normalize(value).order.map(key=>stageFor(key,values[key],source)).filter(Boolean);}
function balance(value,key,v={}){return key==='mutilator'||key==='bassFace'||key==='playground'?v.mix??.5:key==='wasp'?v.blend??.7:normalize(value).mixes?.[key]??1;}
// Conservative per-complete-path admission: nonlinear branches cannot be shared
// when a later source selector differs. Missing source inventory overestimates,
// never understates the renderer's processor budget.
function instanceCounts(modes={},includeExternal=false){const v=effectValues(modes),groups=new Map();for(const source of LEAVES){if(!includeExternal&&source==='DAW')continue;const stages=plan(modes.cookingPot,v,source);if(stages.length)groups.set(JSON.stringify(stages),stages);}const counts=Object.fromEntries(KEYS.map(k=>[k,0]));for(const stages of groups.values())for(const stage of stages)counts[stage.key]++;return counts;}
function estimatedBytes(modes={},sr=48000,includeExternal=false){const v=effectValues(modes),counts=instanceCounts(modes,includeExternal);let sum=0;for(const key of KEYS){const count=counts[key];if(!count)continue;let bytes=0;if(root.MygrainAcousticFx?.KEYS.includes(key))bytes=root.MygrainAcousticFx.estimatedBytes({[key]:v[key]},sr,includeExternal);else if(key==='resonator')bytes=root.MygrainResonator?.audible(v[key])?root.MygrainResonator.estimatedBytes(sr):0;else if(key==='turntable')bytes=Math.ceil(sr*.08)*2*4;else if(key==='wasp'||key==='playground')bytes=2*1024*1024;else bytes=1024*1024;sum+=count*bytes;}return sum;}
function outputVolumes(modes={}){const raw=modes.effectOutput?.volumes||{},v=effectValues(modes),owners=new Set(LEAVES.filter(s=>s!=='DAW').map(s=>plan(modes.cookingPot,v,s).at(-1)?.key));return Object.fromEntries(KEYS.filter(k=>owners.has(k)&&Number.isFinite(raw[k])&&raw[k]!==1).map(k=>[k,Math.max(0,Math.min(1,raw[k]))]));}
const wetPort=key=>key==='heavyLifter'?15:key==='henrysHose'?14:KEYS.indexOf(key)+1;
// Generation-only inventory. A semantic control (including a drawn curve or
// sample selection) is one destination, not one destination per array point.
// Audio/normalisation functions and manual/saved ranges remain unchanged.
function parameterControls(bundle,env){
 const controls=[],get=(o,path)=>path.reduce((v,k)=>v?.[k],o),put=(o,path,v)=>{let at=o;for(let i=0;i<path.length-1;i++){const k=path[i];at=at[k]??=(/^\d+$/.test(String(path[i+1]))?[]:{});}at[path.at(-1)]=v;};
 const choice=(a,old,r)=>{const choices=a.filter(v=>v!==old);return choices.length?choices[Math.floor(r()*choices.length)]:old;};
 const add=(card,path,generate,fallback,kind='value')=>{const full=['effects',card,...path.split('.')],id=card+'.'+path;controls.push({card,id,kind,read:b=>get(b,full)??fallback,write:(b,v)=>put(b,full,v),generate});};
 const numeric=(card,path,lo=0,hi=1,fallback=.5,log=false)=>add(card,path,(old,r)=>{let v=log?lo*(hi/lo)**r():lo+(hi-lo)*r();if(v===old)v=old===lo?hi:lo;return v;},fallback);
 const select=(card,path,a,fallback)=>add(card,path,(old,r)=>choice(typeof a==='function'?a():a,old,r),fallback);
 const boolean=(card,path,fallback=false)=>add(card,path,old=>!old,fallback);
 const units=(card,fields)=>fields.split(' ').filter(Boolean).forEach(p=>numeric(card,p,p==='level'?.3:0,1,card==='mutilator'?(env.mutilator.EXT[p]??.5):card==='bubbleChamber'?(env.acoustic.LIQUID_DEFAULTS[p]??.5):.5));
 const input=(card,path='source',pool=env.inputs)=>{if(pool.length)select(card,path,pool,card==='mutilator'?'D':'all');};
 const curve=(card,path,n,lo=-1,hi=1,fallback=Array(n).fill(0))=>add(card,path,(old,r)=>Array.from({length:n},(_,i)=>{const v=lo+(hi-lo)*r();return v===old?.[i]?(v===lo?hi:lo):v;}),fallback,'curve');
 const enumMap=(card,prefix,map)=>{for(const[k,a]of Object.entries(map))select(card,prefix+k,a,a[0]);};
 const rangeMap=(card,prefix,map)=>{for(const[k,range]of Object.entries(map))numeric(card,prefix+k,...range);};
 input('mutilator','input');select('mutilator','strain',env.mutilator.STRAINS);select('mutilator','filter',env.mutilator.FILTERS,'auto');select('mutilator','cycleBeats',env.mutilator.CYCLES,4);
 units('mutilator','amount tone resonance sweep freeDepth');numeric('mutilator','mix',.2,1,.5);numeric('mutilator','freeRate',.125,12,1,true);numeric('mutilator','output',-18,6,0);boolean('mutilator','rhythm');
 input('bassFace','input');select('bassFace','strain',env.bassFace.STRAINS.map(p=>p.id));units('bassFace','amount tone body');numeric('bassFace','mix',.2,1,.5);boolean('bassFace','rhythm');
 input('turntable','input');enumMap('turntable','',{rpm:[33,45,78],needle:['modern','old'],mainsHz:[50,60]});add('turntable','year',(old,r)=>choice(Array.from({length:env.turntable.TODAY-1919},(_,i)=>1920+i),old,r),1975);units('turntable','wow flutter hum clicks crackle wear');numeric('turntable','output',-18,3,0);
 numeric('resonator','outputLevel',.3,1,1);
 enumMap('resonator','delay.',{mode:['off','ms','sync'],division:[64,32,16,8,4,2]});numeric('resonator','delay.ms',0,2000,0);
 for(let i=0;i<2;i++){
  const prefix='slots.'+i+'.';
  // Object and material must stay a valid pair. Treat their model selector as
  // one coupled control; the separate material control is eligible as well.
  const before=controls.length;select('resonator',prefix+'object',Object.keys(env.resonator.MATERIALS),i?'cone':'door');
  const objectControl=controls[before],write=objectControl.write;objectControl.write=(b,v)=>{write(b,v);const slot=b.effects.resonator.slots[i];if(!env.resonator.MATERIALS[v].includes(slot.material))slot.material='metal';};
  add('resonator',prefix+'material',(old,r,b)=>choice(env.resonator.MATERIALS[b.effects.resonator.slots[i].object],old,r),i?'paper':'hollowWood');
  boolean('resonator',prefix+'enabled',i===0);input('resonator',prefix+'source');select('resonator',prefix+'band',['full','bass','mid','treble'],'bass');select('resonator',prefix+'ends',['open','closed'],'open');rangeMap('resonator',prefix,env.resonator.LIMITS);curve('resonator',prefix+'excitationCurve',16,-36,0,Array(16).fill(0));
 }
 units('wireWorld','dispersion travel feedback damping width level');select('wireWorld','direction',['down','up'],'down');input('wireWorld');
 units('sonicCrystal','tuning spacing coupling disorder defect loss reflection width level');select('sonicCrystal','cells',[4,8,12],8);input('sonicCrystal');
 const bubbleStart=controls.length;
 units('bubbleChamber','radius spread decay motion damping resonance fizz flow width level');select('bubbleChamber','population',[8,16,24],16);input('bubbleChamber');
 for(const control of controls.slice(bubbleStart))if(!['bubbleChamber.source','bubbleChamber.level','bubbleChamber.width'].includes(control.id)){const write=control.write;control.write=(b,v)=>{if(b.effects.bubbleChamber.version!==2)b.effects.bubbleChamber=env.acoustic.upgradeBubble(b.effects.bubbleChamber);write(b,v);};}
 const hose=bundle.effects.henrysHose;
 for(const[k,v]of Object.entries(env.hose.DOPPLER_DEFAULTS)){
  if(typeof v==='number'){
   // New random recipes use restrained depth; the calibrated factory bank
   // and manual/saved sensitivity (including the full 4x range) stay intact.
   if(k==='doppler'){numeric('henrysHose',k,.025,.24,hose.version===2?v:.25);const control=controls.at(-1),write=control.write;control.write=(b,v)=>{b.effects.henrysHose.version=2;write(b,v);};}else numeric('henrysHose',k,k==='level'?.3:0,1,v);
  }else select('henrysHose',k,env.hose.ENUMS[k],v);
 }input('henrysHose');
 input('heavyLifter');select('heavyLifter','mode',env.heavy.MODES,'materialBody');units('heavyLifter','level width');
 for(const mode of env.heavy.MODES){
  for(const[k,v]of Object.entries(env.heavy.PARAMS[mode]))numeric('heavyLifter','recipes.'+mode+'.'+k,0,1,v);
  // Seed plus real bounded cuts are one provenance control, generated only if
  // selected. No sample fetch, inactive-tab DSP or invented corpus identity.
  controls.push({card:'heavyLifter',id:'heavyLifter.samples.'+mode,kind:'samples',read:b=>({seed:b.effects.heavyLifter.recipes[mode].seed,samples:b.effects.heavyLifter.samples[mode]}),generate:(old,r,b)=>{const s=env.randomSamples({...b.effects.heavyLifter,mode},r,env.bpm);return{seed:s.recipes[mode].seed,samples:s.samples[mode]};},write:(b,v)=>{b.effects.heavyLifter.recipes[mode].seed=v.seed;b.effects.heavyLifter.samples[mode]=v.samples;}});
 }
 units('wasp','melt');numeric('wasp','blend',.2,1,.7);numeric('wasp','output',-24,6,0);
 for(let i=0;i<2;i++){
  const prefix='routes.'+i+'.';input('wasp',prefix+'source');input('wasp',prefix+'destination',env.waspInputs);enumMap('wasp',prefix,{method:env.wasp.METHODS,mode:['audio','envelope']});
  rangeMap('wasp',prefix,{depth:[-1,1,.35],level:[-24,6,0],cutoff:[30,18000,1800,true],resonance:[.3,4,.7],attack:[.5,500,8,true],release:[5,2000,160,true],sensitivity:[.1,32,2,true]});
 }
 // The Wasp's one-live-route safety invariant is retained. Choose its active
 // editor route as a coupled selector rather than generating two live routes.
 if(env.waspInputs.length)controls.push({card:'wasp',id:'wasp.activeRoute',kind:'value',read:b=>b.effects.wasp.routes.findIndex(r=>r.enabled),generate:(old,r)=>choice([0,1],old,r),write:(b,v)=>{b.effects.wasp.routes.forEach((route,i)=>route.enabled=i===v);}});
 boolean('wasp','filter.enabled');enumMap('wasp','filter.',{mode:env.phone?['lowpass','highpass']:env.wasp.FILTER_MODES,slope:[12,24,36,48,60,72,84,96],wave:['sine','triangle','saw','square']});
 rangeMap('wasp','filter.',{cutoff:[30,18000,1200,true],rate:[.02,20,.3,true],attack:[.5,500,12,true],release:[5,2000,220,true]});
 if(!env.phone)rangeMap('wasp','filter.',{resonance:[.5,4,.7],highpass:[20,18000,200,true],lowpass:[30,20000,6000,true],sweep:[0,5,0],envelope:[-4,4,0]});
 input('playground','input');boolean('playground','routeKick');select('playground','mode',env.wasp.PLAYGROUND_MODES,'lowpass');select('playground','slope',[12,24,36,48,60,72,84,96],24);
 rangeMap('playground','',{cutoff:[20,20000,1200,true],resonant:[20,20000,1800,true],q:[.2,24,.707,true],rate:[.02,20,.25,true],sensitivity:[1,32,8,true],attack:[.5,500,3,true],release:[5,2000,180,true],glide:[.05,40,.35,true],motion:[0,1,1],mix:[.2,1,1]});
 const beats=env.wasp.CURVE_BEATS,multipliers=env.wasp.CURVE_MULTIPLIERS,timings=['straight','dotted','triplet'];
 for(const lane of env.wasp.PLAYGROUND_CONTROLS){const prefix='modulation.'+lane+'.';enumMap('playground',prefix,{clock:['hz','bpm','sync'],beats,multiplier:multipliers,timing:timings,snap:[0,...beats],snapTiming:timings,interpolation:['auto','linear','hold'],source:['off','drawn',...env.inputs.filter(k=>env.wasp.PLAYGROUND_CHOICES.includes(k))]});rangeMap('playground',prefix,{hz:[.02,1000,.25,true],bpm:[1,300,120],amount:[-1,1,.65],phaseOffset:[0,1,0]});curve('playground',prefix+'curve',64);}
 boolean('playground','rateMod.enabled');enumMap('playground','rateMod.',{target:['all',...env.wasp.PLAYGROUND_CONTROLS],clock:['hz','sync'],beats,multiplier:multipliers,timing:timings});numeric('playground','rateMod.hz',.02,1000,.25,true);numeric('playground','rateMod.depth',0,6,0);curve('playground','rateMod.curve',64);
 for(const card of KEYS){
  if(!['mutilator','bassFace','wasp','playground'].includes(card))controls.push({card,id:card+'.dryWet',kind:'value',read:b=>b.pot.mixes?.[card]??1,generate:(old,r)=>{const v=.2+.8*r();return v===old?(old===1?.2:1):v;},write:(b,v)=>{(b.pot.mixes??={})[card]=v;}});
  controls.push({card,id:card+'.overallVolume',kind:'value',read:b=>b.output.volumes?.[card]??1,generate:(old,r)=>{const v=.4+.6*r();return v===old?(old===1?.4:1):v;},write:(b,v)=>{(b.output.volumes??={})[card]=v;}});
 }
 return controls;
}
function randomiseParameters(bundle,env,random=Math.random,amount=1){
 const next=structuredClone(bundle),controls=parameterControls(bundle,env),draw=()=>{const n=random();if(!Number.isFinite(n))throw Error('Invalid Stir random value.');return Math.max(0,Math.min(1-Number.EPSILON,n));},fraction=Number.isFinite(amount)?Math.max(0,Math.min(1,amount)):1,count=Math.round(controls.length*fraction),indices=controls.map((_,i)=>i);
 // Partial Fisher-Yates draws an unbiased exact-sized set. Apply in inventory
 // order so dependent choices (object/material) are always coherent.
 for(let i=0;i<count;i++){const j=i+Math.floor(draw()*(indices.length-i));[indices[i],indices[j]]=[indices[j],indices[i]];}
 const selected=new Set(indices.slice(0,count)),moved=[];
 for(const[i,control]of controls.entries())if(selected.has(i)){const old=control.read(next),value=control.generate(old,draw,next);control.write(next,value);moved.push(control.id);}
 if(moved.includes('turntable.input'))next.effects.turntable.route='mix';
 return{...next,selection:{eligible:controls.length,selected:count,controls:moved}};
}

const api={parameterControls,randomiseParameters,KEYS,outputVolumes,wetPort,normalize,shuffle,covers,scope,renderVersion,LEAVES,match,selection,plan,balance,effectValues,instanceCounts,estimatedBytes};if(typeof module==='object'&&module.exports)module.exports=api;else root.MygrainCookingPot=api;
})(globalThis);
