/* F · The Wasp. Shared, deterministic DSP: editor and render decks use this exact engine. */
(function(root){
'use strict';
const KEYS=Object.freeze(['A','B','C','V','W','P','O','L','X','Q','M','M+','K1','K2','K3','K4','K5','generated','sample','N','drumKick','drumSnare','drumHat','drumPerc','drumClap','drumCymbals','drumEtc','drumRoll']);
const METHODS=Object.freeze(['am','ring','duck','frequency','phase','lowpass','highpass','bandpass','notch']);
const names={am:'Amplitude',ring:'Ring mod',duck:'Ducking',frequency:'Frequency / vibrato',phase:'Phase / comb',lowpass:'Low-pass filter',highpass:'High-pass filter',bandpass:'Band-pass filter',notch:'Notch filter'};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const num=(v,d,a,b)=>v!==null&&v!==''&&Number.isFinite(Number(v))?clamp(Number(v),a,b):d;
function matches(selection,key){return selection==='all'||selection===key||selection==='K'&&/^K[1-5]$/.test(key)||selection==='drums'&&key.startsWith('drum');}
const choices=Object.freeze([...KEYS,'K','drums','all']);
function route(v={},i=0){return{enabled:v.enabled===true,source:choices.includes(v.source)?v.source:'V',destination:choices.includes(v.destination)?v.destination:'X',method:METHODS.includes(v.method)?v.method:'am',mode:v.mode==='audio'?'audio':'envelope',depth:num(v.depth,.35,-1,1),level:num(v.level,0,-24,6),cutoff:num(v.cutoff,1800,30,18000),resonance:num(v.resonance,.7,.3,4),attack:num(v.attack,8,.5,500),release:num(v.release,160,5,2000),sensitivity:num(v.sensitivity,2,.1,32)};}
const FILTER_MODES=Object.freeze(['lowpass','highpass','bandpass','notch']);
function endFilter(v={}){if(root.mygrainPhone)v={...v,mode:v.mode==='highpass'?'highpass':'lowpass',resonance:.707,highpass:20,lowpass:20000,sweep:0,envelope:0};return{enabled:v.enabled===true,mode:FILTER_MODES.includes(v.mode)?v.mode:'bandpass',slope:[12,24,36,48,60,72,84,96].includes(Number(v.slope))?Number(v.slope):(root.mygrainPhone?12:24),cutoff:num(v.cutoff,1200,30,18000),resonance:num(v.resonance,.7,.5,4),highpass:num(v.highpass,200,20,18000),lowpass:num(v.lowpass,6000,30,20000),rate:num(v.rate,.3,.02,20),sweep:num(v.sweep,0,0,5),wave:['sine','triangle','saw','square'].includes(v.wave)?v.wave:'sine',envelope:num(v.envelope,0,-4,4),attack:num(v.attack,12,.5,500),release:num(v.release,220,5,2000)};}
const filterPresets={Telephone:{mode:'bandpass',cutoff:1600,resonance:.7,slope:12,highpass:450,lowpass:3200},'Thin wire':{mode:'bandpass',cutoff:2400,resonance:2,slope:24,highpass:1000,lowpass:5000},'Needle sweep':{mode:'bandpass',cutoff:1600,resonance:1.4,slope:24,highpass:250,lowpass:8000,rate:.4,sweep:2,wave:'triangle'},Underwater:{mode:'lowpass',cutoff:450,resonance:.8,slope:48,highpass:40,lowpass:2000},'Envelope flicker':{mode:'bandpass',cutoff:600,resonance:1.1,slope:24,highpass:150,lowpass:6000,envelope:3,attack:2,release:180}};
function normalize(v){if(v!=null&&(v.version!==1||!Array.isArray(v.routes)||v.routes.length!==6))throw Error('Unsupported Wasp settings. Expected six routes, version 1.');return{version:1,enabled:v?.enabled===true,melt:num(v?.melt,1,0,1),blend:num(v?.blend,.7,0,1),output:num(v?.output,0,-24,6),filter:endFilter(v?.filter),routes:Array.from({length:6},(_,i)=>route(i < 2 ? v?.routes?.[i] : {},i))};}
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
 s.melt=1;s.blend=1;s.output=-3;
 s.routes=Array.from({length:6},(_,i)=>{if(i>=2)return route();const destination=shuffled[i%shuffled.length],other=keys.filter(k=>k!==destination),method=pick(METHODS);return route({enabled:i<2,source:pick(other.length?other:keys),destination,method,mode:['ring','frequency','phase'].includes(method)?'audio':pick(['audio','envelope']),depth:(rng()<.2?-1:1)*(.7+.3*rng()),level:0,cutoff:250*2**(rng()*4),resonance:.7+rng()*1.6,attack:1+rng()*12,release:50+rng()*230,sensitivity:6+rng()*14});});return s;
}
// Final stereo insert catches Direct Out drums, kick bypass, wet returns and synths.
// It is separate from the pre-EQ per-lane matrix, with no parallel dry connection.
// Topology and coefficients are compiled only on messages, never in the sample loop.
class Engine{
 constructor(rate,slots=32){this.rate=rate;this.dcCoef=Math.exp(-2*Math.PI*10/rate);this.slots=slots;this.keys=Array(slots).fill(null);this.settings=normalize();this.alive=true;this.ramp=0;this.write=0;this.delays=Array.from({length:slots},()=>Array(2).fill(null));this.dc=Array.from({length:slots},()=>[new Float64Array(2),new Float64Array(2)]);this.blend=0;this.filters=Array.from({length:slots},()=>Array.from({length:2},()=>[new Float64Array(2),new Float64Array(2)]));this.env=new Float64Array(2);this.lastMod=new Float64Array(2);this.routeDepth=new Float64Array(2);this.levels=new Float64Array(2);this.carriers=[];this.mods=[];this.program=[];this.update(this.settings,this.keys);}
 update(value,keys=this.keys){this.settings=normalize(value);const previous=this.keys;this.keys=keys.slice();for(let slot=0;slot<this.slots;slot++)if(previous[slot]!==this.keys[slot]){this.delays[slot].fill(null);for(const route of this.filters[slot])for(const channel of route)channel.fill(0);for(const channel of this.dc[slot])channel.fill(0);}this.program=this.settings.routes.slice(0,2).map((r,i)=>({...r,index:i,isFilter:['lowpass','highpass','bandpass','notch'].includes(r.method),linear:10**(r.level/20),attackCoef:Math.exp(-1/(this.rate*r.attack/1000)),releaseCoef:Math.exp(-1/(this.rate*r.release/1000)),sources:this.keys.map((k,j)=>k&&matches(r.source,k)?j:-1).filter(j=>j>=0)}));this.carriers=this.keys.map((key,slot)=>({key,slot,routes:this.program.filter(r=>r.enabled&&r.depth!==0&&matches(r.destination,key))})).filter(x=>x.key);for(let slot=0;slot<this.slots;slot++)for(let i=0;i<2;i++){const r=this.program[i],needed=this.keys[slot]&&r.enabled&&r.depth!==0&&matches(r.destination,this.keys[slot])&&['frequency','phase'].includes(r.method);if(needed&&!this.delays[slot][i])this.delays[slot][i]=[new Float32Array(4096),new Float32Array(4096)];else if(!needed)this.delays[slot][i]=null;}this.mods=new Float64Array(2);this.targetOutput=10**(this.settings.output/20);if(this.output===undefined)this.output=this.targetOutput;}
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
const api={FILTER_MODES,endFilter,filterPresets,KEYS,METHODS,names,choices,normalize,route,matches,presets,preset,randomize,Engine};if(typeof module==='object'&&module.exports){module.exports=api;api.MasterEngine=require('./wasp-master-desktop.js');}else root.MygrainWasp=api;
})(globalThis);
