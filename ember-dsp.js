/* Ember 15: native Web Audio patch graph, shared by live and isolated Song decks.
   A creative instrument inspired by the ENNER signal map, not a circuit emulation. */
(function(root){
'use strict';
const clamp=(v,lo,hi,f)=>Number.isFinite(Number(v))?Math.max(lo,Math.min(hi,Number(v))):f;
const OUTPUTS=[...Array.from({length:5},(_,i)=>'osc'+(i+1)),...Array.from({length:6},(_,i)=>'pulse'+(i+1)),'and1','and2','and3','ring12','ring23','ring34','delayL','delayR'];
const prepared=new WeakSet(),preparations=new WeakMap();
async function prepare(context){const ctx=context.__mygrainNativeContext||context;if(!preparations.has(ctx)){const p=ctx.audioWorklet.addModule(new URL('ember-clock-worklet.js?v=20261117-ember-20-no-mod-1',document.baseURI)).then(()=>prepared.add(ctx));preparations.set(ctx,p);p.catch(()=>preparations.delete(ctx));}await preparations.get(ctx);}
const INPUTS=[...['direct','high','bright','warm','low'].flatMap(k=>[k+'L',k+'R']),'delayInL','delayInR'];
const PATCHES={
 hearth:[['osc1','lowL'],['osc2','lowR'],['ring23','warmL'],['ring23','warmR'],['pulse4','mod1'],['pulse6','mod2']],
 bells:[['ring12','brightL'],['ring34','brightR'],['osc5','delayInL'],['delayL','delayInR'],['pulse3','mod3'],['osc2','mod1']],
 binary:[['pulse1','lowL'],['pulse2','lowR'],['and1','warmL'],['and2','brightR'],['osc3','mod1'],['ring23','delayInL']],
 empty:[]};
function defaults(){return{version:1,enabled:false,level:.55,tempo:null,frequencies:[55,82.5,110,165,220],wave:'sine',pitch:0,tone:.35,modDepth:.2,pulseRate:1,delayTime:.32,feedback:0,bizarre:0,cables:[{from:'osc1',to:'directL',amount:.65},{from:'osc2',to:'directR',amount:.65},{from:'pulse1',to:'directL',amount:.25},{from:'pulse2',to:'directR',amount:.25}]};}
// Optional per-output Hz overrides: absent/null lanes retain the exact v1 divided clock.
function pulseFrequency(state,i,bpm=120){return state.pulseFrequencies?.[i]??((state.tempo??bpm)/60*state.pulseRate/2**i);}
const DIVIDER_RATIOS=[1,2,4,6,8,10,12,14,16];
const dividerRatio=v=>DIVIDER_RATIOS.includes(v)?v:1;
const LFO_RATIOS=[1,2,3,4,6,8,12,16,24,32,48,64];
const LFO_RATIO_CHOICES=[...LFO_RATIOS.slice(1).reverse().map(divide=>({multiply:1,divide})),{multiply:1,divide:1},...LFO_RATIOS.slice(1).map(multiply=>({multiply,divide:1}))];
const LFO_WAVES=['sine','triangle','sawtooth','rampDown','square','hold'];
const LFO_TARGETS={...Object.fromEntries(Array.from({length:5},(_,i)=>['freq'+i,[.01,1200,true]])),...Object.fromEntries(Array.from({length:6},(_,i)=>['pulse'+i,[.01,2560,true]])),...Object.fromEntries(Array.from({length:6},(_,i)=>['width'+i,[.00001,1,true]])),lfoRate:[.01,1280,true],crossModDepth:[0,1],level:[0,1],pitch:[-36,36],tone:[0,1],modDepth:[0,1],delayTime:[.02,1.5],feedback:[0,.78],bizarre:[0,1],balance:[0,1],tempo:[20,1200,true],pulseRate:[.25,128,true]};
function normalizeLfo(v){v=v&&typeof v==='object'?v:{};return{...(v.sync&&typeof v.sync==='object'?{sync:{enabled:v.sync.enabled===true,divide:LFO_RATIOS.includes(v.sync.divide)?v.sync.divide:1,multiply:LFO_RATIOS.includes(v.sync.multiply)?v.sync.multiply:1}}:{}),enabled:v.enabled===true,wave:LFO_WAVES.includes(v.wave)?v.wave:'sine',rate:clamp(v.rate,.01,20,.2),depth:clamp(v.depth,0,1,.5),inverse:v.inverse===true,targets:(Array.isArray(v.targets)?v.targets:[]).filter((t,i,a)=>Object.hasOwn(LFO_TARGETS,t?.key)&&a.findIndex(x=>x?.key===t.key)===i).map(t=>({key:t.key,inverse:t.inverse===true}))};}
function lfoFrequency(v,bpm=120){const sync=v?.lfo?.sync;return sync?.enabled===true?(v.tempo??bpm)/60*(sync.multiply??1)/(sync.divide??1):(v?.lfo?.rate??.2);}
function lfoActive(v){return v?.lfo?.enabled===true&&v.lfo.depth>0&&v.lfo.targets?.length>0;}
function targetBase(v,key,bpm=120){return key==='lfoRate'?lfoFrequency(v,bpm):key.startsWith('width')?(v.pulseWidths?.[+key.slice(5)]??.005):key.startsWith('freq')?v.frequencies[+key.slice(4)]:key.startsWith('pulse')&&key!=='pulseRate'?pulseFrequency(v,+key.slice(5),bpm):key==='tempo'?(v.tempo??bpm):key==='balance'?(v.balance??.5):key==='crossModDepth'?(v.crossModDepth??.5):v[key];}
// Base controls never move or serialize their instantaneous LFO offsets.
function lfoValue(v,key,signal,bpm=120){const base=targetBase(v,key,bpm),t=v.lfo?.targets.find(t=>t.key===key);if(!lfoActive(v)||!t)return base;const [lo,hi,log]=LFO_TARGETS[key],d=signal*v.lfo.depth*(t.inverse!==v.lfo.inverse?-1:1);if(log){const octaves=key.startsWith('freq')?2:key.startsWith('width')?3:3;return Math.max(lo,Math.min(key.startsWith('freq')?1200:hi,base*2**(d*octaves)));}if(key==='pitch')return Math.max(lo,Math.min(hi,base+d*12));return Math.max(lo,Math.min(hi,base+d*(hi-lo)));}

function normalize(v){const d=defaults(),a=v&&typeof v==='object'?v:{};return{...d,...Object.fromEntries(['oscDivider','pulseDivider'].filter(k=>dividerRatio(a[k])>1).map(k=>[k,a[k]])),...(a.cableStrengthBypass===true?{cableStrengthBypass:true}:{}),...(Array.isArray(a.pulseCrossMod)?{pulseCrossMod:Array.from({length:6},(_,i)=>a.pulseCrossMod[i]===true)}:{}),...(Array.isArray(a.pulseWidths)?{pulseWidths:Array.from({length:6},(_,i)=>clamp(a.pulseWidths[i],.00001,1,.005))}:{}),...(Array.isArray(a.crossMod)?{crossMod:Array.from({length:5},(_,i)=>a.crossMod[i]===true)}:{}),...(a.crossModDepth!=null?{crossModDepth:clamp(a.crossModDepth,0,1,.5)}:{}),...(a.balance!=null&&clamp(a.balance,0,1,.5)!==.5?{balance:clamp(a.balance,0,1,.5)}:{}),...(a.lfo&&typeof a.lfo==='object'?{lfo:normalizeLfo(a.lfo)}:{}),...(Array.isArray(a.pulseFrequencies)&&a.pulseFrequencies.some(v=>v!=null)?{pulseFrequencies:Array.from({length:6},(_,i)=>a.pulseFrequencies[i]==null?null:clamp(a.pulseFrequencies[i],.01,2560,1))}:{}),enabled:a.enabled===true,level:clamp(a.level,0,1,d.level),tempo:a.tempo==null?null:clamp(a.tempo,20,1200,120),frequencies:d.frequencies.map((f,i)=>{let hz=clamp(a.frequencies?.[i],.01,8000,f);while(hz>1200)hz/=2;return hz;}),wave:['sine','triangle','sawtooth','square'].includes(a.wave)?a.wave:d.wave,pitch:clamp(a.pitch,-36,36,0),tone:clamp(a.tone,0,1,d.tone),modDepth:clamp(a.modDepth,0,1,d.modDepth),pulseRate:clamp(a.pulseRate,.25,128,1),delayTime:clamp(a.delayTime,.02,1.5,d.delayTime),feedback:clamp(a.feedback,0,.78,d.feedback),bizarre:clamp(a.bizarre,0,1,d.bizarre),cables:(Array.isArray(a.cables)?a.cables:d.cables).slice(0,64).filter((c,i,all)=>OUTPUTS.includes(c?.from)&&INPUTS.includes(c?.to)&&all.findIndex(x=>x?.from===c.from&&x?.to===c.to)===i).map(c=>({from:c.from,to:c.to,amount:clamp(c.amount,0,1,.55)}))};}
// Ember 13: every factory is an explicit high-depth LFO + C performance.
// Retain the 200 established IDs; add 100 free-Hz laboratory circuits.
const FAMILY_IDS=['contact','binary','dust','ring','radio','ceramic','delay','rain','fault','ghost','torsion','fracture','orbit','paradox','unstable'];
const FAMILY_NAMES=['BPM · Subduction','BPM · Opposing currents','BPM · Pulse engines','BPM · Ring collision','BPM · Clock shear','BPM · Hollow strikes','BPM · Stereo ricochet','BPM · Through-zero','BPM · Coupled gates','BPM · Harmonic rupture','Hz lab · Torsion','Hz lab · Fracture','Hz lab · Orbital drift','Hz lab · Paradox','Hz lab · Instability'];
const MATERIALS=['Basalt','Cobalt','Tungsten','Copper','Magnetite','Porcelain','Titanium','Carbon','Ferrite','Quartz','Osmium','Mica','Bismuth','Mercury','Iridium'];
const EVENTS=['Undertow','Ratchet','Collision','Inversion','Rupture','Dislocation','Vortex','Tectonic','Fracture','Reactor','Surge','Torsion','Backlash','Avalanche','Turbine','Torque','Rift','Coil','Flux','Singularity'];
const PRESETS=FAMILY_IDS.flatMap((id,fi)=>EVENTS.map((event,i)=>{
 const synced=fi<10,number=(fi%10)*20+i+1,root=[24.5,27.5,32.703,36.708,41.203][i%5]*2**(Math.floor(i/5)/12),ratios=[[1,1.5,2,3,.75],[1,1.001,1.5,2.002,.5],[1,1.25,1.875,2.5,1.5],[1,.75,1.501,2.25,2],[1,1.4142,1.618,2.718,.625]][fi%5],frequencies=ratios.map(x=>+(root*x).toFixed(6));
 const pulseRate=[8,16,32,64,128][(i+fi)%5],freeRoot=[31.37,53.11,89.73,151.19,257.03][i%5]*2**(Math.floor(i/5)/19),pulseFrequencies=synced?undefined:Array.from({length:6},(_,k)=>+(freeRoot/[1,1.997,3.03,5.17,7.11,11.37][k]).toFixed(6)),pulseBases=Array.from({length:6},(_,k)=>pulseFrequencies?.[k]??2*pulseRate/2**k);
 const crossMod=[false,false,false,false,true],pulseCrossMod=Array(6).fill(false);
 if([3,7,9,13,14].includes(fi))crossMod[3]=true;
 if([2,4,5,8,10,11,14].includes(fi))pulseCrossMod[5]=true;
 const depth=+( .7+((i*7+fi*3)%31)/100 ).toFixed(2),lfoDepth=+( .7+((i*11+fi*5)%31)/100 ).toFixed(2),ratio=[{multiply:1,divide:8},{multiply:1,divide:4},{multiply:1,divide:3},{multiply:1,divide:2},{multiply:1,divide:1},{multiply:2,divide:1},{multiply:3,divide:1},{multiply:4,divide:1}][(i+fi*3)%8];
 const target=(key,inverse=false)=>({key,inverse}),targets=[target('freq0'),target('freq1',true),target('freq4',i%2===0)];
 if([1,2,4,5,8,10,11,12,14].includes(fi))targets.push(target('width0',true),target('width1'));
 if([3,6,7,9,13].includes(fi))targets.push(target('freq2',i%2===0),target('freq3',i%2!==0));
 if(!synced){targets.push(target('pulse0',i%2===0),target('pulse1',i%2!==0));if([11,12,14].includes(fi))targets.push(target('lfoRate',i%2===0));}
 const lfo=normalizeLfo({enabled:true,wave:LFO_WAVES[(i+fi)%6],rate:+[.071,.137,.293,.617,1.271,2.713,5.131,9.731][(i+fi)%8].toFixed(3),depth:lfoDepth,inverse:!!(Math.floor(i/5)%2),targets,sync:{enabled:synced,...ratio}});
 const pulseAmount=[2,4,5,8,11,14].includes(fi)?.55:.28,oscAmount=[2,4,5,8,11,14].includes(fi)?.42:.64;
 const cables=[{from:'osc1',to:'directL',amount:oscAmount},{from:'osc2',to:'directR',amount:oscAmount*.94},{from:'pulse1',to:'directL',amount:pulseAmount},{from:'pulse2',to:'directR',amount:pulseAmount*.93}];
 if([3,5,9,13].includes(fi))cables.push({from:'ring12',to:'lowL',amount:.24},{from:'ring34',to:'lowR',amount:.26});
 if([6,12].includes(fi))cables.push({from:'osc3',to:'delayInL',amount:.2},{from:'osc4',to:'delayInR',amount:.18});
 if(fi===8)cables.push({from:'and1',to:'lowL',amount:.17},{from:'and2',to:'lowR',amount:.19});
 const settings=normalize({...defaults(),frequencies,...(pulseFrequencies?{pulseFrequencies}:{}),pulseRate,pulseWidths:pulseBases.map((f,k)=>pulseCrossMod[k]?Math.min(1,.4/f):Math.max(.00002,Math.min(.08,(.13+((i+k*3+fi)%8)*.035)/f))),wave:[5,9,10,13].includes(fi)?'triangle':'sine',crossMod,pulseCrossMod,crossModDepth:depth,lfo,tone:.2+(i%6)*.055,modDepth:.2,delayTime:.11+(i%8)*.043,feedback:[6,12].includes(fi)?.12:0,bizarre:0,cables});
 return{id:'ember-'+id+'-'+String(i+1).padStart(2,'0'),section:FAMILY_NAMES[fi],clock:synced?'bpm':'hz',name:(synced?'B':'H')+String(synced?number:(fi-10)*20+i+1).padStart(3,'0')+' · '+MATERIALS[fi]+' '+event,description:(synced?'BPM-locked LFO and six linked pulse bases':'Independent free-Hz LFO and six experimental pulse rates')+' · LFO '+Math.round(lfoDepth*100)+'% / C '+Math.round(depth*100)+'%. Low/mid through-zero stereo FM; no noise source.',settings};
}));
const STARTERS={
 hearth:{name:'Clear Foundation',settings:normalize(defaults())},
 bells:{name:'Deep FM Pair',settings:normalize({...defaults(),frequencies:[55,82.5,110,165,27.5],crossMod:[false,false,false,false,true],crossModDepth:.42})},
 binary:{name:'Pulse Architecture',settings:normalize({...defaults(),frequencies:[55,82.5,110,165,27.5],pulseFrequencies:[55,27.5,13.75,6.875,3.4375,1.71875],pulseWidths:[.007,.012,.02,.02,.02,.02],pulseCrossMod:[false,false,false,false,true,false],crossModDepth:.35,cables:[{from:'pulse1',to:'directL',amount:.6},{from:'pulse2',to:'directR',amount:.6}]})},
 empty:{name:'Silent Blueprint',settings:normalize({...defaults(),cables:[]})}
};
const audible=v=>v?.enabled===true&&((v.level??.55)>0||(lfoActive(v)&&v.lfo.targets.some(t=>t.key==='level')))&&(v.cables||[]).some(c=>(v.cableStrengthBypass===true||c.amount>0)&&/^(direct|high|bright|warm|low|delayIn)/.test(c.to));
const crossModActive=v=>(v?.crossMod?.some(Boolean)||v?.pulseCrossMod?.some(Boolean))&&((v.crossModDepth??.5)>0||(lfoActive(v)&&v.lfo.targets.some(t=>t.key==='crossModDepth')));
// Inspect raw legacy snapshots too: retired noise-only freezes must not remain audible.
const renderVersion=v=>audible(v)?(v?.rhythm?.version===1||(v.cables||[]).some(c=>/^mod[1-5](?:neg)?$/.test(c.to))?13:dividerRatio(v.oscDivider)>1||dividerRatio(v.pulseDivider)>1?11:v.cableStrengthBypass===true?10:crossModActive(v)?9:8):0;
// Full-card generation: independent C switches and varied Mod/Inverse destinations.
function randomPatch(value,seed=(Math.random()*4294967296)>>>0,mode,options={}){let n=seed>>>0||0x9e3779b9;const rnd=()=>{n^=n<<13;n^=n>>>17;n^=n<<5;return(n>>>0)/4294967296;},pick=a=>a[Math.floor(rnd()*a.length)],old=normalize(value),base=pick(PRESETS).settings,synced=mode==='bpm'||(mode!=='hz'&&old.lfo?.sync?.enabled),ratio=pick(LFO_RATIO_CHOICES.filter(r=>r.multiply/r.divide>=1/16&&r.multiply/r.divide<=2));
 const root=pick([36.708,41.203,49,55,65.406,73.416,82.407,98]),ratios=pick([[1,1.5,2,3,.5],[1,1.25,1.5,2,.5],[1,1.001,2,2.002,.5]]),frequencies=ratios.map(r=>+(root*r).toFixed(5)),crossFlags=Array.from({length:11},()=>rnd()<.5);if(!crossFlags.some(Boolean))crossFlags[Math.floor(rnd()*crossFlags.length)]=true;const crossMod=crossFlags.slice(0,5),pulseCrossMod=crossFlags.slice(5);
 const pulseBase=pick([13.75,27.5,55,110,220,440]),pulseFrequencies=synced?Array(6).fill(null):Array.from({length:6},(_,i)=>pulseBase/2**i),pulseRate=synced?pick([1,2,4,8,16,32,64]):base.pulseRate,actualPulses=pulseFrequencies.map((v,i)=>v??((old.tempo??120)/60*pulseRate/2**i));
 // Keep one randomly chosen pitched destination, then sample without replacement.
 // Volume and balance remain performance controls, not generated modulation targets.
 const anchor='freq'+Math.floor(rnd()*5),pool=Object.keys(LFO_TARGETS).filter(key=>!['level','balance',anchor].includes(key)),targets=[{key:anchor,inverse:rnd()<.5}],targetCount=2+Math.floor(rnd()*5);
 while(targets.length<targetCount){const key=pool.splice(Math.floor(rnd()*pool.length),1)[0];targets.push({key,inverse:rnd()<.5});}
 const lfo=normalizeLfo({enabled:true,wave:pick(['sine','triangle']),rate:.03+rnd()*.47,depth:synced?1:.1+rnd()*.2,inverse:rnd()<.5,targets,sync:{enabled:!!synced,...ratio}});
 const cables=base.cables.map(c=>({...c}));for(const [from,to]of [['pulse1','directL'],['pulse2','directR']])if(!cables.some(c=>c.from===from&&c.to===to))cables.push({from,to,amount:.3});
 const next=normalize({...base,cables,cableStrengthBypass:true,enabled:old.enabled,level:old.level,balance:old.balance??.5,tempo:old.tempo,frequencies,wave:pick(['sine','sine','triangle']),pulseFrequencies,pulseWidths:actualPulses.map(f=>Math.min(.03,(.25+rnd()*.25)/f)),pulseRate,crossMod,pulseCrossMod,crossModDepth:synced?1:.2+rnd()*.35,lfo,tone:.2+rnd()*.35,modDepth:.15+rnd()*.2,feedback:0,bizarre:0,oscDivider:pick(DIVIDER_RATIOS),pulseDivider:pick(DIVIDER_RATIOS)});
 // Exclude C settings only after generation, preserving the seeded draw stream
 // and both output-divider choices. An omitted legacy C field stays omitted.
 if(options.excludeCrossMod===true){
  for(const key of ['crossMod','pulseCrossMod','crossModDepth']){if(Object.hasOwn(old,key))next[key]=Array.isArray(old[key])?[...old[key]]:old[key];else delete next[key];}
  next.lfo.targets=next.lfo.targets.filter(t=>t.key!=='crossModDepth');
  const target=old.lfo?.targets.find(t=>t.key==='crossModDepth');if(target)next.lfo.targets.push({...target});
 }
 // Generate fresh topology, not another factory's usually identical four leads.
 // Draw after the legacy controls so tuning, dividers and C policy keep their stream.
 const leads=[],addLead=(from,to)=>{if(!leads.some(c=>c.from===from&&c.to===to))leads.push({from,to,amount:.35+rnd()*.4});};
 const voices=Array.from({length:5},(_,i)=>'osc'+(i+1)),pulseSources=['pulse1','pulse2','pulse3'];
 for(const side of ['L','R']){addLead(pick(voices),'direct'+side);addLead(pick(pulseSources),'direct'+side);}
 const sources=OUTPUTS.filter(id=>!id.startsWith('delay')),destinations=INPUTS.filter(id=>!id.startsWith('delay'));
 const extras=2+Math.floor(rnd()*5);for(let i=0;i<extras;i++){
  const pairs=sources.flatMap(from=>destinations.filter(to=>!leads.some(c=>c.from===from&&c.to===to)).map(to=>({from,to})));
  const lead=pick(pairs);addLead(lead.from,lead.to);
 }
 const topology=cables=>cables.map(c=>c.from+':'+c.to).sort().join('|');
 // Even a repeated seed must not leave the visible wiring unchanged.
 if(topology(leads)===topology(old.cables))leads.pop();
 next.cables=leads;
 return next;
}
function createGraph(ctx,destination,value,options={}){
 const native=ctx.__mygrainNativeContext||ctx;if(!prepared.has(native))throw Error('Prepare Ember audio clocks before creating its graph.');
 let state=normalize(value),bpm=options.bpm||120,origin=Number.isFinite(options.origin)?options.origin:ctx.currentTime,start=Math.max(ctx.currentTime,options.time??ctx.currentTime),dead=false;
 let lfoSource=null,lfoNodes=[],gateMask=1,syncClock=null;
 const nodes=[],sources=[],outs={},ins={},osc=[],pulses=[],wires=[],add=n=>(nodes.push(n),n),gain=(v=1)=>{const n=add(ctx.createGain());n.gain.value=v;return n;};
 const output=gain(0),dc=add(ctx.createBiquadFilter());dc.type='highpass';dc.frequency.value=18;const limiter=add(ctx.createWaveShaper()),curve=new Float32Array(4097);for(let i=0;i<curve.length;i++){const x=2*i/(curve.length-1)-1;curve[i]=Math.tanh(x*1.3)/1.3;}limiter.curve=curve;limiter.oversample='2x';
 // Per-cable headroom is applied once; do not attenuate the stereo sum again.
 const sum=gain(1);sum.connect(dc).connect(limiter).connect(output);output.connect(destination);
 const ownSource=n=>{sources.push(n);return add(n);};

 const merger=add(ctx.createChannelMerger(2));merger.connect(sum);
 const filters=[];
 for(const [kind,type,hz,q]of [['direct',null,0,0],['high','highpass',2300,.65],['bright','bandpass',1700,1.1],['warm','bandpass',490,.9],['low','lowpass',800,.6]])for(const [ch,side]of ['L','R'].entries()){
  const input=gain();ins[kind+side]=input;let tail=input;
  if(type){const f=add(ctx.createBiquadFilter());f.type=type;f.frequency.value=hz;f.Q.value=q;input.connect(f);tail=f;filters.push({node:f,hz});}
  tail.connect(merger,0,ch);
 }
 const clock=add(new AudioWorkletNode(native,'mygrain-ember-clean-v1',{numberOfInputs:5,numberOfOutputs:11,outputChannelCount:Array(11).fill(1),processorOptions:{start,origin},parameterData:{oscDivider:state.oscDivider??1,pulseDivider:state.pulseDivider??1,...Object.fromEntries(state.frequencies.map((f,i)=>['freq'+i,f])),...Object.fromEntries(Array.from({length:6},(_,i)=>['pulse'+i,pulseFrequency(state,i,bpm)])),...Object.fromEntries(Array.from({length:6},(_,i)=>['width'+i,state.pulseWidths?.[i]??.005])),wave:['sine','triangle','sawtooth','square'].indexOf(state.wave),crossDepth:state.crossModDepth??.5,...Object.fromEntries(Array.from({length:11},(_,i)=>['c'+i,(i<5?state.crossMod?.[i]:state.pulseCrossMod?.[i-5])?1:0]))}}));
 for(let i=0;i<5;i++){const o=gain(),m=gain(),delay=add(ctx.createDelay(.1));clock.connect(o,i,0);o.frequency=clock.parameters.get('freq'+i);osc.push(o);outs['osc'+(i+1)]=o;ins['mod'+(i+1)]=m;delay.delayTime.value=128/ctx.sampleRate;m.connect(delay);delay.connect(clock,0,i);}
 ins.mod5neg=gain();const negative=gain(-1);ins.mod5neg.connect(negative).connect(ins.mod5);
 for(let i=0;i<6;i++){const o=gain();clock.connect(o,i+5,0);o.frequency=clock.parameters.get('pulse'+i);o.width=clock.parameters.get('width'+i);outs['pulse'+(i+1)]=o;pulses.push(o);}
 for(const [i,pair]of [[0,[0,2]],[1,[1,3]],[2,[2,5]]]){
  const sum=gain(.25),logic=add(ctx.createWaveShaper()),c=new Float32Array(2049);for(let j=0;j<c.length;j++)c[j]=(2*j/(c.length-1)-1)>.35?1:-1;logic.curve=c;pulses[pair[0]].connect(sum);pulses[pair[1]].connect(sum);sum.connect(logic);outs['and'+(i+1)]=logic;
 }
 for(const [key,a,b]of [['ring12',0,1],['ring23',1,2],['ring34',2,3]]){const r=gain(0);osc[a].connect(r);osc[b].connect(r.gain);outs[key]=r;}
 const delays=[],feedbacks=[],delayFilters=[];
 for(const [i,side]of ['L','R'].entries()){
  const input=gain(),delay=add(ctx.createDelay(2)),filter=add(ctx.createBiquadFilter()),feedback=gain();filter.type='lowpass';filter.frequency.value=3800;const bound=add(ctx.createWaveShaper());bound.curve=curve;input.connect(delay);delay.connect(filter).connect(bound);bound.connect(feedback).connect(delay);bound.connect(merger,0,i);ins['delayIn'+side]=input;outs['delay'+side]=bound;delays.push(delay);feedbacks.push(feedback);delayFilters.push(filter);
 }
 const wander=ownSource(ctx.createOscillator());wander.frequency.value=.19;const wanderGain=gain(0);wander.connect(wanderGain);wanderGain.connect(delays[0].delayTime);wanderGain.connect(delays[1].delayTime);
 const baseParameters=new Map();
 const parameter=(p,v,immediate=false)=>{baseParameters.set(p,v);p.cancelScheduledValues(ctx.currentTime);if(immediate||typeof ctx.startRendering==='function')p.setValueAtTime(v,ctx.currentTime);else p.setTargetAtTime(v,ctx.currentTime,.018);};
 const balanceGain=(from,b=state.balance??.5)=>/^(osc|ring)/.test(from)?Math.min(1,2*(1-b)):/^(pulse|and)/.test(from)?Math.min(1,2*b):1;
 function patch(){for(const w of wires){try{outs[w.from].disconnect(w.node)}catch{}w.node.disconnect();const i=nodes.indexOf(w.node);if(i>=0)nodes.splice(i,1);}wires.length=0;for(const c of state.cables){const n=gain(),isMod=c.to.startsWith('mod'),amount=state.cableStrengthBypass===true?1:c.amount;n.gain.value=amount*(isMod?state.modDepth:.26*balanceGain(c.from));outs[c.from].connect(n);n.connect(ins[c.to]);wires.push({...c,amount,node:n});}}
 // C coupling is internal to one audio-clock core: no block-delay FM network.
 function clearCrossMod(){}
 function configureCrossMod(initial=false){for(const key of ['oscDivider','pulseDivider'])parameter(clock.parameters.get(key),state[key]??1,true);for(let i=0;i<11;i++)parameter(clock.parameters.get('c'+i),state.enabled&&((i<5?state.crossMod?.[i]:state.pulseCrossMod?.[i-5])===true)?1:0,true);parameter(clock.parameters.get('crossDepth'),state.crossModDepth??.5,initial);}
 function update(value,newBpm=bpm,initial=false){if(dead)return;clearLfo();const next=normalize(value),rewire=JSON.stringify(next.cables)!==JSON.stringify(state.cables)||next.cableStrengthBypass!==state.cableStrengthBypass||next.modDepth!==state.modDepth||(next.balance??.5)!==(state.balance??.5)||initial;state=next;bpm=newBpm;configureCrossMod(initial);const tempo=state.tempo??bpm;
  parameter(clock.parameters.get('wave'),['sine','triangle','sawtooth','square'].indexOf(state.wave),true);for(let i=0;i<5;i++)parameter(osc[i].frequency,Math.min(1200,state.frequencies[i]*2**(state.pitch/12)),initial);
  // Each free-Hz lane is independent; linked lanes preserve the legacy clock.
  pulses.forEach((o,i)=>{parameter(o.frequency,pulseFrequency(state,i,bpm),initial);parameter(o.width,state.pulseWidths?.[i]??.005,initial);});filters.forEach(f=>parameter(f.node.frequency,Math.min(ctx.sampleRate*.42,f.hz*2**((state.tone-.5)*4)),initial));
  delays.forEach((d,i)=>parameter(d.delayTime,state.delayTime*(i?1.173:1),initial));feedbacks.forEach(f=>parameter(f.gain,state.feedback,initial));delayFilters.forEach(f=>parameter(f.frequency,1300+state.tone*6500,initial));parameter(wanderGain.gain,state.bizarre*.007,initial);if(rewire)patch();setGain(options.gate?options.gate():1,initial);
 }
 function releaseLfo(){if(!lfoSource)return;if(lfoSource._emberSelfRate){lfoSource.port.postMessage({dispose:true});lfoSource.port.close();}else{try{lfoSource.stop()}catch{}lfoSource.buffer=null;}lfoSource.disconnect();lfoSource=null;}
 function clearLfo(){if(lfoSource){lfoSource.disconnect();if(!lfoSource._emberSelfRate)releaseLfo();}for(const {node,param,base}of lfoNodes){node.disconnect();param.cancelScheduledValues(ctx.currentTime);param.setValueAtTime(base,ctx.currentTime);}lfoNodes=[];}
 function clockPhase(when){const hz=lfoFrequency(state,bpm);if(state.lfo?.sync?.enabled===true){const phase=syncClock?((syncClock.phase+(when-syncClock.when)*syncClock.hz)%1+1)%1:((when-origin)*hz%1+1)%1;syncClock={when,phase,hz};return phase;}syncClock=null;return((when-origin)*hz%1+1)%1;}
 function configureLfo(){
  clearLfo();if(!state.enabled||!lfoActive(state)){releaseLfo();clockPhase(Math.max(ctx.currentTime,start));return;}
  const has=key=>state.lfo.targets.some(t=>t.key===key),value=(key,x)=>lfoValue(state,key,x,bpm),control=(param,fn)=>{const node=ctx.createWaveShaper(),curve=new Float32Array(2049);for(let i=0;i<curve.length;i++)curve[i]=fn(i*2/(curve.length-1)-1);node.curve=curve;const base=baseParameters.get(param)??param.value;param.cancelScheduledValues(ctx.currentTime);param.setValueAtTime(0,ctx.currentTime);lfoSource.connect(node);node.connect(param);lfoNodes.push({node,param,base});};
  const selfRate=has('lfoRate'),when=Math.max(ctx.currentTime,start),phase=clockPhase(when);
  if(selfRate){const target=state.lfo.targets.find(t=>t.key==='lfoRate');if(!lfoSource?._emberSelfRate){releaseLfo();lfoSource=new AudioWorkletNode(native,'mygrain-ember-rate-v2',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],parameterData:{rate:lfoFrequency(state,bpm),depth:state.lfo.depth,wave:LFO_WAVES.indexOf(state.lfo.wave),inverse:target.inverse!==state.lfo.inverse?1:0},processorOptions:{start:when,phase}});lfoSource._emberSelfRate=true;}
   lfoSource.parameters.get('wave').setValueAtTime(LFO_WAVES.indexOf(state.lfo.wave),ctx.currentTime);lfoSource.parameters.get('inverse').setValueAtTime(target.inverse!==state.lfo.inverse?1:0,ctx.currentTime);lfoSource.parameters.get('rate').setValueAtTime(lfoFrequency(state,bpm),ctx.currentTime);lfoSource.parameters.get('depth').setValueAtTime(state.lfo.depth,ctx.currentTime);
  }else{releaseLfo();
  const size=4096,buffer=ctx.createBuffer(1,size,ctx.sampleRate),data=buffer.getChannelData(0),steps=[.71,-.38,.96,-.81,.17,-.58,.43,-.09];for(let i=0;i<size;i++){const p=i/size;data[i]=state.lfo.wave==='sine'?Math.sin(2*Math.PI*p):state.lfo.wave==='triangle'?1-4*Math.abs(p-.5):state.lfo.wave==='sawtooth'?p*2-1:state.lfo.wave==='rampDown'?1-p*2:state.lfo.wave==='square'?(p<.5?1:-1):steps[Math.floor(p*8)];}
  lfoSource=ctx.createBufferSource();lfoSource.buffer=buffer;lfoSource.loop=true;lfoSource.playbackRate.value=lfoFrequency(state,bpm)*size/ctx.sampleRate;
  }
  osc.forEach((o,i)=>{if(has('freq'+i)||has('pitch'))control(o.frequency,x=>Math.min(1200,value('freq'+i,x)*2**(value('pitch',x)/12)));});
  pulses.forEach((o,i)=>{if(has('pulse'+i)||(state.pulseFrequencies?.[i]==null&&(has('tempo')||has('pulseRate'))))control(o.frequency,x=>state.pulseFrequencies?.[i]!=null?value('pulse'+i,x):Math.max(has('pulse'+i) ? .01 : 0,Math.min(2560,value('pulse'+i,x)*value('tempo',x)/(state.tempo??bpm)*value('pulseRate',x)/state.pulseRate)));});
  pulses.forEach((o,i)=>{if(has('width'+i))control(o.width,x=>value('width'+i,x));});
  if(has('tone')){filters.forEach(f=>control(f.node.frequency,x=>Math.min(ctx.sampleRate*.42,f.hz*2**((value('tone',x)-.5)*4))));delayFilters.forEach(f=>control(f.frequency,x=>1300+value('tone',x)*6500));}
  if(has('delayTime'))delays.forEach((d,i)=>control(d.delayTime,x=>value('delayTime',x)*(i?1.173:1)));
  if(has('feedback'))feedbacks.forEach(f=>control(f.gain,x=>value('feedback',x)));
  if(has('bizarre'))control(wanderGain.gain,x=>value('bizarre',x)*.007);
  for(const w of wires){if(w.to.startsWith('mod')){if(has('modDepth'))control(w.node.gain,x=>w.amount*value('modDepth',x));}else if(has('balance')&&/^(osc|ring|pulse|and)/.test(w.from))control(w.node.gain,x=>w.amount*.26*balanceGain(w.from,value('balance',x)));}
  if(has('crossModDepth'))control(clock.parameters.get('crossDepth'),x=>value('crossModDepth',x));
  if(has('level'))control(output.gain,x=>state.enabled?value('level',x)*gateMask:0);
  if(!selfRate)lfoSource.start(when,phase*4096/ctx.sampleRate);
 }
 function setGain(mask=1,immediate=false){clearLfo();gateMask=Math.max(0,Math.min(1,mask));parameter(output.gain,state.enabled?state.level*gateMask:.0,immediate);configureLfo();}
 update(state,bpm,true);
 for(const n of sources)n.start(start);
 return{output,update,setGain,dispose(){if(dead)return;clearLfo();releaseLfo();clearCrossMod();dead=true;clock.port.postMessage({dispose:true});clock.port.close();for(const n of sources){try{n.stop()}catch{}if('buffer'in n)n.buffer=null;}for(const n of nodes)n.disconnect();wires.length=0;baseParameters.clear();syncClock=null;},get state(){return normalize(state);},get nodeCount(){return nodes.length+lfoNodes.length+(lfoSource?1:0);},get crossModNodeCount(){return 0;},get crossModRouteCount(){return !dead&&state.enabled&&crossModActive(state)?[...(state.crossMod||[]),...(state.pulseCrossMod||[])].filter(Boolean).length*10:0;},get lfoNodeCount(){return lfoNodes.length+(lfoSource?1:0);}};
}
const api={DIVIDER_RATIOS,OUTPUTS,INPUTS,PATCHES,PRESETS,STARTERS,LFO_RATIOS,LFO_RATIO_CHOICES,LFO_WAVES,LFO_TARGETS,defaults,normalize,normalizeLfo,lfoFrequency,lfoActive,lfoValue,pulseFrequency,randomPatch,audible,crossModActive,renderVersion,prepare,createGraph};if(typeof module==='object'&&module.exports)module.exports=api;else root.MygrainEmber=api;
})(typeof globalThis!=='undefined'?globalThis:this);
