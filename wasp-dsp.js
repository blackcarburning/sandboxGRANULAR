/* F · The Wasp. Shared, deterministic DSP: editor and render decks use this exact engine. */
(function(root){
'use strict';
const Inputs=root.MygrainEffectInputs||(typeof module==='object'&&module.exports?require('./effect-inputs.js'):null);
const KEYS=Object.freeze(['A','B','C','V','W','P','O','L','X','Q','M','M+','K1','K2','K3','K4','K5','generated','sample','N','drumKick','drumSnare','drumHat','drumPerc','drumClap','drumCymbals','drumEtc','drumRoll']);
const METHODS=Object.freeze(['am','ring','duck','frequency','phase','lowpass','highpass','bandpass','notch']);
const names={am:'Amplitude',ring:'Ring mod',duck:'Ducking',frequency:'Frequency / vibrato',phase:'Phase / comb',lowpass:'Low-pass filter',highpass:'High-pass filter',bandpass:'Band-pass filter',notch:'Notch filter'};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const num=(v,d,a,b)=>v!==null&&v!==''&&Number.isFinite(Number(v))?clamp(Number(v),a,b):d;
function matches(selection,key){return selection==='all'||selection===key||selection==='K'&&/^K[1-5]$/.test(key)||selection==='drums'&&key.startsWith('drum');}
const choices=Object.freeze([...KEYS,'K','drums','all']);
const INPUTS=Inputs.SOURCES;
function route(v={},i=0){return{enabled:v.enabled===true,source:INPUTS.includes(v.source)?v.source:'V',destination:choices.includes(v.destination)?v.destination:'X',method:METHODS.includes(v.method)?v.method:'am',mode:v.mode==='audio'?'audio':'envelope',depth:num(v.depth,.35,-1,1),level:num(v.level,0,-24,6),cutoff:num(v.cutoff,1800,30,18000),resonance:num(v.resonance,.7,.3,4),attack:num(v.attack,8,.5,500),release:num(v.release,160,5,2000),sensitivity:num(v.sensitivity,2,.1,32)};}
const FILTER_MODES=Object.freeze(['lowpass','highpass','bandpass','notch']);
function endFilter(v={}){if(root.mygrainPhone)v={...v,mode:v.mode==='highpass'?'highpass':'lowpass',resonance:.707,highpass:20,lowpass:20000,sweep:0,envelope:0};return{enabled:v.enabled===true,mode:FILTER_MODES.includes(v.mode)?v.mode:'bandpass',slope:[12,24,36,48,60,72,84,96].includes(Number(v.slope))?Number(v.slope):(root.mygrainPhone?12:24),cutoff:num(v.cutoff,1200,30,18000),resonance:num(v.resonance,.7,.5,4),highpass:num(v.highpass,200,20,18000),lowpass:num(v.lowpass,6000,30,20000),rate:num(v.rate,.3,.02,20),sweep:num(v.sweep,0,0,5),wave:['sine','triangle','saw','square'].includes(v.wave)?v.wave:'sine',envelope:num(v.envelope,0,-4,4),attack:num(v.attack,12,.5,500),release:num(v.release,220,5,2000)};}
const filterPresets={Telephone:{mode:'bandpass',cutoff:1600,resonance:.7,slope:12,highpass:450,lowpass:3200},'Thin wire':{mode:'bandpass',cutoff:2400,resonance:2,slope:24,highpass:1000,lowpass:5000},'Needle sweep':{mode:'bandpass',cutoff:1600,resonance:1.4,slope:24,highpass:250,lowpass:8000,rate:.4,sweep:2,wave:'triangle'},Underwater:{mode:'lowpass',cutoff:450,resonance:.8,slope:48,highpass:40,lowpass:2000},'Envelope flicker':{mode:'bandpass',cutoff:600,resonance:1.1,slope:24,highpass:150,lowpass:6000,envelope:3,attack:2,release:180}};
const PLAYGROUND_MODES=Object.freeze(['lowpass','highpass','bandpass','notch','comb','combNegative','allpass','peak','lowshelf','highshelf']);
const PLAYGROUND_CHOICES=Object.freeze([...KEYS.slice(0,3),'D',...KEYS.slice(3),'K','drums','all']);
const PLAYGROUND_INPUTS=INPUTS;
const PLAYGROUND_CONTROLS=Object.freeze(['cutoff','resonant','q']);
const CURVE_BEATS=[.125,.25,.5,1,2,4,8];
const CURVE_MULTIPLIERS=[.125,.25,.5,1,2,4,8];
function curveFactor(timing){return timing==='triplet'?2/3:timing==='dotted'?1.5:1;}
function curveHz(lane,tempo=120){return lane.clock==='hz'?lane.hz:(lane.clock==='sync'?tempo:lane.bpm)/60/lane.beats*lane.multiplier/curveFactor(lane.timing);}
// One editor width is exactly one audible curve cycle. Musical grid positions
// are calculated in phase space, then mapped to the retained 64-point format.
function curveWindow(lane,tempo=120){const hz=curveHz(lane,tempo),bpm=lane.clock==='bpm'?lane.bpm:tempo,seconds=1/hz,beats=bpm/60/hz,gridBeats=lane.snap?lane.snap*curveFactor(lane.snapTiming):0,grid=gridBeats/beats;return{hz,seconds,beats,gridBeats,grid};}
function curveSnapIndex(index,lane,tempo=120){const position=clamp(index/63,0,1);if(!lane.snap)return Math.round(position*63);const {grid}=curveWindow(lane,tempo);if(!Number.isFinite(grid)||grid<=0)return Math.round(position*63);
 // Both visible boundaries are real editable endpoints, even when a grid cell
 // is larger than the loop. Never clamp an out-of-window snap back to zero.
 const lower=Math.min(1,Math.floor(position/grid)*grid),upper=Math.min(1,(Math.floor(position/grid)+1)*grid),phase=position-lower<upper-position?lower:upper;return Math.round(clamp(phase,0,1)*63);
}

// Rate FM is integrated in phase space, not accumulated by callbacks. The mean
// multiplier is unity: a synced rate curve always comes home on its beat.
function rateMod(v={}){return{enabled:v.enabled===true,target:PLAYGROUND_CONTROLS.includes(v.target)?v.target:'all',clock:v.clock==='sync'?'sync':'hz',hz:num(v.hz,.5,.02,1000),beats:CURVE_BEATS.includes(Number(v.beats))?Number(v.beats):4,multiplier:CURVE_MULTIPLIERS.includes(Number(v.multiplier))?Number(v.multiplier):1,timing:['straight','triplet','dotted'].includes(v.timing)?v.timing:'straight',depth:num(v.depth,1,0,6),curve:Array.from({length:64},(_,i)=>num(v.curve?.[i],Math.sin(2*Math.PI*i/64),-1,1))};}
const fract=x=>x-Math.floor(x);
function readCurve(curve,phase,hold){const p=fract(phase)*64,j=Math.floor(p),t=p-j;return hold===true||hold?.[j]?curve[j]:curve[j]+(curve[(j+1)%64]-curve[j])*t;}
function playground(v={}){const lane=key=>{const m=v.modulation?.[key]||{};return{clock:['hz','bpm','sync'].includes(m.clock)?m.clock:'hz',hz:num(m.hz,num(v.rate,.25,.02,20),.02,1000),bpm:num(m.bpm,120,1,300),beats:CURVE_BEATS.includes(Number(m.beats))?Number(m.beats):4,multiplier:CURVE_MULTIPLIERS.includes(Number(m.multiplier))?Number(m.multiplier):1,timing:['straight','triplet','dotted'].includes(m.timing)?m.timing:'straight',snap:CURVE_BEATS.includes(Number(m.snap))?Number(m.snap):0,snapTiming:['straight','triplet','dotted'].includes(m.snapTiming)?m.snapTiming:'straight',...(m.interpolation?{interpolation:['auto','linear','hold'].includes(m.interpolation)?m.interpolation:'auto'}:{}),...(m.phaseOffset!==undefined?{phaseOffset:num(m.phaseOffset,0,0,1)}:{}),source:['off','drawn',...PLAYGROUND_CHOICES].includes(m.source)?m.source:'off',amount:num(m.amount,.65,-1,1),curve:Array.from({length:64},(_,i)=>num(m.curve?.[i],Math.sin(2*Math.PI*i/64),-1,1))};};return{...(PLAYGROUND_INPUTS.includes(v.input)&&v.input!=='all'?{input:v.input}:{}),...(v.glide!==undefined?{glide:num(v.glide,.35,.05,40)}:{}),...(v.motion!==undefined?{motion:num(v.motion,1,0,1)}:{}),...(v.mix!==undefined?{mix:num(v.mix,1,0,1)}:{}),...(v.rateMod?{rateMod:rateMod(v.rateMod)}:{}),routeKick:v.routeKick===true,tempo:num(v.tempo,120,1,300),enabled:v.enabled===true,mode:PLAYGROUND_MODES.includes(v.mode)?v.mode:'lowpass',slope:[12,24,36,48,60,72,84,96].includes(Number(v.slope))?Number(v.slope):24,cutoff:num(v.cutoff,1200,20,20000),resonant:num(v.resonant,1800,20,20000),q:num(v.q,.707,.2,24),rate:num(v.rate,.25,.02,20),sensitivity:num(v.sensitivity,8,1,32),attack:num(v.attack,3,.5,500),release:num(v.release,180,5,2000),modulation:Object.fromEntries(PLAYGROUND_CONTROLS.map(k=>[k,lane(k)]))};}
function normalize(v){if(v!=null&&(v.version!==1||!Array.isArray(v.routes)||v.routes.length!==6))throw Error('Unsupported Wasp settings. Expected six routes, version 1.');return{version:1,enabled:v?.enabled===true,melt:num(v?.melt,1,0,1),blend:num(v?.blend,.7,0,1),output:num(v?.output,0,-24,6),filter:endFilter(v?.filter),playground:playground(v?.playground),routes:Array.from({length:6},(_,i)=>route(i < 2 ? {...v?.routes?.[i],enabled:v?.routes?.[i]?.enabled===true&&!v.routes.slice(0,i).some(r=>r.enabled)} : {},i))};}
const presets={
 Glue:{blend:.35,routes:[{source:'drums',destination:'all',method:'duck',depth:.25,release:180},{source:'V',destination:'X',method:'lowpass',depth:.25,cutoff:2600}]},
 Breathe:{blend:.65,routes:[{source:'drums',destination:'K',method:'am',depth:.65,release:280},{source:'V',destination:'Q',method:'lowpass',depth:.45,cutoff:1800},{source:'A',destination:'M',method:'duck',depth:.35}]},
 'Talking loops':{blend:.7,routes:[{source:'V',destination:'L',method:'bandpass',depth:.65,cutoff:900,resonance:2},{source:'M',destination:'X',method:'lowpass',depth:.6,cutoff:1600},{source:'V',destination:'Q',method:'am',depth:.3}]},
 Rust:{blend:.45,routes:[{source:'L',destination:'V',method:'ring',mode:'audio',depth:.7,sensitivity:4},{source:'V',destination:'X',method:'frequency',mode:'audio',depth:.18},{source:'drums',destination:'A',method:'highpass',depth:.45,cutoff:500}]},
 Melt:{blend:.65,routes:[{source:'V',destination:'X',method:'frequency',mode:'audio',depth:.25},{source:'L',destination:'V',method:'ring',mode:'audio',depth:.55},{source:'drums',destination:'Q',method:'lowpass',depth:.5,cutoff:1500},{source:'Q',destination:'K',method:'phase',depth:.45},{source:'M',destination:'A',method:'am',depth:.5},{source:'W',destination:'M+',method:'notch',depth:.6,cutoff:1200}]},
 Catastrophe:{blend:.75,output:-6,routes:[{source:'all',destination:'all',method:'frequency',mode:'audio',depth:.65,sensitivity:4},{source:'V',destination:'all',method:'ring',mode:'audio',depth:.65},{source:'drums',destination:'all',method:'bandpass',depth:.8,cutoff:1800,resonance:2},{source:'X',destination:'all',method:'phase',mode:'audio',depth:.7},{source:'Q',destination:'all',method:'am',mode:'audio',depth:.5},{source:'W',destination:'all',method:'notch',depth:.8,cutoff:800}]}
};
function preset(name){const p=presets[name];if(!p)throw Error('Unknown Wasp preset.');return normalize({...p,version:1,enabled:false,routes:Array.from({length:6},(_,i)=>({...p.routes[i],enabled:!!p.routes[i]}))});}
// Random choices are frozen into the patch; never run random DSP per sample.
function randomize(value,activeKeys,rng=Math.random){
 const s=normalize(value),keys=[...new Set(activeKeys)].filter(k=>KEYS.includes(k));
 if(!keys.length)throw Error('No audible, playable parts in this patch. Load or unmute a loop first.');
 const pick=a=>a[Math.min(a.length-1,Math.floor(rng()*a.length))];
 const shuffled=keys.slice();for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
 s.melt=1;s.blend=1;s.output=-3;s.playground.enabled=false;
 s.routes=Array.from({length:6},(_,i)=>{if(i>=1)return route();const destination=shuffled[i%shuffled.length],other=keys.filter(k=>k!==destination),method=pick(METHODS);return route({enabled:i<1,source:pick(other.length?other:keys),destination,method,mode:['ring','frequency','phase'].includes(method)?'audio':pick(['audio','envelope']),depth:(rng()<.2?-1:1)*(.7+.3*rng()),level:0,cutoff:250*2**(rng()*4),resonance:.7+rng()*1.6,attack:1+rng()*12,release:50+rng()*230,sensitivity:6+rng()*14});});return s;
}
// Final stereo insert catches Direct Out drums, kick bypass, wet returns and synths.
// It is separate from the pre-EQ per-lane matrix, with no parallel dry connection.
// Topology and coefficients are compiled only on messages, never in the sample loop.
class Engine{
 constructor(rate,slots=32){this.rate=rate;this.dcCoef=Math.exp(-2*Math.PI*10/rate);this.slots=slots;this.keys=Array(slots).fill(null);this.settings=normalize();this.alive=true;this.ramp=0;this.write=0;this.delays=Array.from({length:slots},()=>Array(2).fill(null));this.dc=Array.from({length:slots},()=>[new Float64Array(2),new Float64Array(2)]);this.blend=0;this.filters=Array.from({length:slots},()=>Array.from({length:2},()=>[new Float64Array(2),new Float64Array(2)]));this.env=new Float64Array(2);this.lastMod=new Float64Array(2);this.routeDepth=new Float64Array(2);this.levels=new Float64Array(2);this.carriers=[];this.mods=[];this.program=[];this.update(this.settings,this.keys);}
 update(value,keys=this.keys){this.settings=normalize(value);if(value?.externalInputOnly)this.settings.routes=this.settings.routes.map(r=>({...r,destination:'DAW'}));const previous=this.keys;this.keys=keys.slice();for(let slot=0;slot<this.slots;slot++)if(previous[slot]!==this.keys[slot]){this.delays[slot].fill(null);for(const route of this.filters[slot])for(const channel of route)channel.fill(0);for(const channel of this.dc[slot])channel.fill(0);}this.program=this.settings.routes.slice(0,2).map((r,i)=>({...r,index:i,isFilter:['lowpass','highpass','bandpass','notch'].includes(r.method),linear:10**(r.level/20),attackCoef:Math.exp(-1/(this.rate*r.attack/1000)),releaseCoef:Math.exp(-1/(this.rate*r.release/1000)),sources:this.keys.map((k,j)=>k&&matches(r.source,k)?j:-1).filter(j=>j>=0)}));this.carriers=this.keys.map((key,slot)=>({key,slot,routes:this.program.filter(r=>r.enabled&&r.depth!==0&&matches(r.destination,key))})).filter(x=>x.key&&x.key!=='D');for(let slot=0;slot<this.slots;slot++)for(let i=0;i<2;i++){const r=this.program[i],needed=this.keys[slot]&&r.enabled&&r.depth!==0&&matches(r.destination,this.keys[slot])&&['frequency','phase'].includes(r.method);if(needed&&!this.delays[slot][i])this.delays[slot][i]=[new Float32Array(4096),new Float32Array(4096)];else if(!needed)this.delays[slot][i]=null;}this.mods=new Float64Array(2);this.targetOutput=10**(this.settings.output/20);if(this.output===undefined)this.output=this.targetOutput;}
 process(inputs,outputs){if(!this.alive)return false;const frames=outputs[0]?.[0]?.length||128,s=this.settings,slew=1-Math.exp(-1/(this.rate*.008));
  // A disconnected driver is not a silent musical passage. Fade its route to
  // neutral instead of letting full-depth AM/ring erase the carrier at 100% wet.
  // Inspect channels once per render quantum; connected digital silence still gates.
  for(const r of this.program)r.hasInput=r.sources.some(slot=>inputs[slot]?.some(channel=>channel.length>0));
  for(let f=0;f<frames;f++){
   for(const r of this.program){if(!r.enabled||r.depth===0)continue;let signal=0;for(const slot of r.sources){const a=inputs[slot]||[];signal+=((a[0]?.[f]||0)+(a[1]?.[f]??a[0]?.[f]??0))*.5;}signal=clamp(signal*r.sensitivity,-8,8);const magnitude=Math.min(1,Math.abs(signal)),coef=magnitude>this.env[r.index]?r.attackCoef:r.releaseCoef;this.env[r.index]=magnitude+coef*(this.env[r.index]-magnitude);this.mods[r.index]=r.mode==='audio'?Math.tanh(signal):this.env[r.index];this.routeDepth[r.index]+=((r.hasInput?r.depth*s.melt:0)-this.routeDepth[r.index])*slew;this.levels[r.index]+=(r.linear-this.levels[r.index])*slew;if(r.isFilter){const signed=this.routeDepth[r.index]<0?-this.mods[r.index]:this.mods[r.index],cutoff=clamp(r.cutoff*2**(signed*4),25,Math.min(18000,this.rate*.42));r.g=Math.tan(Math.PI*cutoff/this.rate);r.k=1/r.resonance;r.aa=1/(1+r.g*(r.g+r.k));}}
   this.ramp=Math.min(1,this.ramp+1/(this.rate*.015));this.output+=(this.targetOutput-this.output)*slew;this.blend+=clamp(s.blend-this.blend,-1/(this.rate*.015),1/(this.rate*.015));
   for(const carrier of this.carriers){const {slot,routes}=carrier,a=inputs[slot]||[],out=outputs[slot];if(!out)continue;
    for(let ch=0;ch<2;ch++){const original=a[ch]?.[f]??a[0]?.[f]??0;let value=original;
     for(const r of routes){const i=r.index,mod=this.mods[i],depth=this.routeDepth[i],amount=Math.abs(depth),signed=depth<0?-mod:mod;let wet=value;
      if(r.method==='am'){const gain=r.mode==='audio'?clamp(1+signed,0,2):depth<0?1-this.env[i]:this.env[i];wet=value*((1-amount)+amount*gain);}
      else if(r.method==='ring'){wet=value*((1-amount)+amount*(depth<0?-1:1)*(r.mode==='audio'?mod:this.env[i]*2-1));}
      else if(r.method==='duck'){wet=value*(1-amount*(depth<0?1-this.env[i]:this.env[i]));}
      else if(r.method==='frequency'||r.method==='phase'){const delay=this.delays[slot][i][ch];delay[this.write]=value;const ms=r.method==='frequency'?3:1.2,offset=(1+signed)*ms*this.rate/1000,at=(this.write-offset+8192)%4096,j=Math.floor(at),fraction=at-j;const shifted=delay[j]*(1-fraction)+delay[(j+1)%4096]*fraction;wet=r.method==='phase'?value*(1-amount)+.5*(value-shifted)*amount:value*(1-amount)+shifted*amount;}
      else{const g=r.g,k=r.k,aa=r.aa,ic=this.filters[slot][i][ch],v1=aa*(ic[0]+g*(value-ic[1])),v2=ic[1]+g*v1;ic[0]=clamp(2*v1-ic[0],-16,16);ic[1]=clamp(2*v2-ic[1],-16,16);const filtered=r.method==='lowpass'?v2:r.method==='highpass'?value-k*v1-v2:r.method==='bandpass'?v1*k:value-k*v1;wet=value+(filtered-value)*amount;}
      value=clamp(value+(wet-value)*this.levels[i],-16,16);
     }
     if(routes.length&&s.melt>0){const dc=this.dc[slot][ch],filtered=value-dc[0]+this.dcCoef*dc[1];dc[0]=value;dc[1]=filtered;value=filtered;}let result=original+(value*this.output-original)*this.blend*this.ramp;
     // Transparent below -1 dBFS; continuous soft ceiling for pathological matrices.
     const abs=Math.abs(result);if(routes.length&&this.blend>0&&s.melt>0&&abs>.891)result=Math.sign(result)*(.891+.108*Math.tanh((abs-.891)/.108));
     out[ch][f]=Number.isFinite(result)?result:0;
    }
   }this.write=(this.write+1)%4096;
  }return true;
 }
 dispose(){this.alive=false;this.delays=[];this.filters=[];}
}
// Independent serial stage: only instantiated while enabled. Modulation inputs
// are detection-only pre-Wasp taps; they never enter the audible mix.
class PlaygroundEngine{
 constructor(rate,value){this.rate=rate;this.states=Array.from({length:2},()=>Array.from({length:9},()=>new Float64Array(2)));this.env=new Float64Array(3);this.values=new Float64Array([1200,1800,.707]);this.phase=0;this.phases=new Float64Array(3);this.counter=0;this.write=0;this.mix=0;this.comb=null;this.frame=0;this.clocks=[];this.clock={origin:0,bpm:120,at:-Infinity};this.update(value);this.values.set([this.settings.cutoff,this.settings.resonant,this.settings.q]);}
 update(value){const s=this.settings=playground(value);this.attack=Math.exp(-1/(this.rate*s.attack/1000));this.release=Math.exp(-1/(this.rate*s.release/1000));this.slew=1-Math.exp(-1/(this.rate*(s.glide??.35)/1000));this.lanes=PLAYGROUND_CONTROLS.map(k=>s.modulation[k]);this.increments=this.lanes.map(lane=>curveHz(lane,s.tempo)/this.rate);
  this.holds=this.lanes.map(l=>l.interpolation==='hold'?true:l.interpolation==='linear'?null:Uint8Array.from(l.curve,(v,j)=>{const next=l.curve[(j+1)%64],prev=l.curve[(j+63)%64];return Math.abs(next-v)>.2&&(Math.abs(v-prev)<.16||Math.abs(next-l.curve[(j+2)%64])<.00001)?1:0;}));
  const rm=s.rateMod;this.compiledTempo=NaN;this.rateWarp=null;if(rm?.enabled&&rm.depth>0&&(s.motion??1)>0&&(s.mix??1)>0&&this.lanes.some((l,i)=>l.source==='drawn'&&l.amount!==0&&(rm.target==='all'||rm.target===PLAYGROUND_CONTROLS[i]))){const n=2048,table=new Float64Array(n+1);let previous=2**(rm.depth*readCurve(rm.curve,0));for(let j=1;j<=n;j++){const v=2**(rm.depth*readCurve(rm.curve,j/n));table[j]=table[j-1]+(previous+v)/2/n;previous=v;}const mean=table[n];for(let j=1;j<=n;j++)table[j]/=mean;this.rateWarp=table;}
  const comb=s.mode.startsWith('comb');if(comb&&!this.comb)this.comb=Array.from({length:2},()=>Array.from({length:8},()=>new Float32Array(Math.ceil(this.rate/20)+4)));if(!comb)this.comb=null;
 }
 setClock(value){if(!value||![value.origin,value.bpm,value.at].every(Number.isFinite)||value.bpm<1||value.bpm>300)return;const clock={origin:value.origin,bpm:value.bpm,at:value.at};this.clocks=this.clocks.filter(c=>c.at<clock.at);this.clocks.push(clock);if(this.clocks.length>16)this.clocks.splice(0,this.clocks.length-16);}
 warpedTime(t,bpm){const rm=this.settings.rateMod,table=this.rateWarp;if(!table)return t;const hz=curveHz(rm,bpm),p=t*hz,j=fract(p)*2048,k=Math.floor(j),v=table[k]+(table[k+1]-table[k])*(j-k);return (Math.floor(p)+v)/hz;}
 beginFrame(inputs,frame,absoluteFrame){const s=this.settings,time=(Number.isFinite(absoluteFrame)?absoluteFrame:this.frame++)/this.rate;while(this.clocks.length&&this.clocks[0].at<=time)this.clock=this.clocks.shift();const clock=this.clock,bpm=clock.at===-Infinity?s.tempo:clock.bpm,elapsed=Math.max(0,time-clock.origin),warped=this.warpedTime(elapsed,bpm),rm=s.rateMod;if(this.compiledTempo!==bpm){this.compiledTempo=bpm;this.laneHz=this.lanes.map(l=>curveHz(l,bpm));this.audioRate=!!this.rateWarp||this.lanes.some((l,i)=>l.source==='drawn'&&this.laneHz[i]>20);}
  for(let i=0;i<3;i++){const lane=this.lanes[i],baseTime=lane.clock==='sync'?elapsed:time,t=this.rateWarp&&(rm.target==='all'||rm.target===PLAYGROUND_CONTROLS[i])?(lane.clock==='sync'?warped:this.warpedTime(baseTime,bpm)):baseTime;this.phases[i]=fract(t*this.laneHz[i]+(lane.phaseOffset||0));let mod=0;
   if(lane.source==='drawn')mod=readCurve(lane.curve,this.phases[i],this.holds[i]);else if(lane.source!=='off'){const input=inputs[i+1]||[],magnitude=Math.min(1,Math.max(Math.abs(input[0]?.[frame]||0),Math.abs(input[1]?.[frame]||0))*s.sensitivity),coef=magnitude>this.env[i]?this.attack:this.release;this.env[i]=magnitude+coef*(this.env[i]-magnitude);mod=this.env[i];}
   const target=clamp(s[PLAYGROUND_CONTROLS[i]]*2**(mod*lane.amount*(s.motion??1)*(i===2?8:10)),i===2?.2:20,i===2?24:Math.min(20000,this.rate*.42));this.values[i]+=(target-this.values[i])*this.slew;
  }
  this.phase=this.phases[0];this.mix=Math.min(1,this.mix+1/(this.rate*.015));if(this.audioRate||(this.counter++&7)===0){this.g=Math.tan(Math.PI*this.values[0]/this.rate);this.rg=Math.tan(Math.PI*this.values[1]/this.rate);this.k=1/this.values[2];this.delay=this.rate/this.values[0];this.feedback=Math.min(.92,this.values[2]/(this.values[2]+2));}this.write=(this.write+1)%(Math.ceil(this.rate/20)+4);
 }
 section(x,state,g,k,mode){const a=1/(1+g*(g+k)),v1=a*(state[0]+g*(x-state[1])),v2=state[1]+g*v1;state[0]=clamp(2*v1-state[0],-32,32);state[1]=clamp(2*v2-state[1],-32,32);const high=x-k*v1-v2;return mode==='lowpass'?v2:mode==='highpass'?high:mode==='bandpass'?k*v1:mode==='notch'?x-k*v1:mode==='allpass'?x-2*k*v1:mode==='peak'?x+v1:mode==='lowshelf'?x+v2:mode==='highshelf'?x+high:v1;}
 sample(x,ch){const s=this.settings,states=this.states[ch]||this.states[0];let wet=x;for(let j=0;j<s.slope/12;j++){if(this.comb){const buffer=this.comb[ch][j],at=(this.write-this.delay+buffer.length)%buffer.length,k=Math.floor(at),t=at-k,delayed=buffer[k]*(1-t)+buffer[(k+1)%buffer.length]*t,sign=s.mode==='combNegative'?-1:1;const y=wet+sign*this.feedback*delayed;buffer[this.write]=clamp(y,-8,8);wet=y*(1-this.feedback);}else {
 // Q must shape the audible cutoff, not only the separate resonant peak.
 // Apply it once at the final section: Q^N gain across a steep cascade is not
 // musical resonance. Earlier sections retain their stable Butterworth damping.
 const damping=j===s.slope/12-1?this.k:Math.SQRT2;
 wet=this.section(wet,states[j],this.g,damping,s.mode);
 }}
 // A separate resonant peak makes resonant frequency independent of cutoff.
 // Q is genuine inverse damping, not a renamed cutoff or gain control.
 wet+=.45*this.section(wet,states[8],this.rg,this.k,'resonator');const result=x+(wet-x)*this.mix*(s.mix??1);return Number.isFinite(result)?result:0;}
 dispose(){this.states=[];this.comb=null;this.env=null;this.values=null;this.lanes=[];this.holds=[];this.rateWarp=null;this.clocks=[];this.laneHz=null;}
}
const api={rateMod,readCurve,CURVE_BEATS,CURVE_MULTIPLIERS,curveFactor,curveHz,curveWindow,curveSnapIndex,PLAYGROUND_INPUTS,PLAYGROUND_CHOICES,PLAYGROUND_MODES,PLAYGROUND_CONTROLS,playground,PlaygroundEngine,FILTER_MODES,endFilter,filterPresets,KEYS,INPUTS,METHODS,names,choices,normalize,route,matches,presets,preset,randomize,Engine};if(typeof module==='object'&&module.exports){module.exports=api;api.MasterEngine=require('./wasp-master-desktop.js');}else root.MygrainWasp=api;
})(globalThis);
