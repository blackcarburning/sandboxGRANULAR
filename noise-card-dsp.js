(function(root){
'use strict';
const TYPES=['lowpass','highpass','bandpass','notch'],POLES=[2,4,6,8,12,16];
const SOURCES=['manual','L1','L2','L3','A','B','C','V','W','P','O','L','X','Q','M','M+','generated','sample','K','K1','K2','K3','K4','K5','drums','drumKick','drumSnare','drumHat','drumPerc','drumClap','drumCymbals','drumEtc','drumRoll'];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const num=(x,d,a,b)=>Number.isFinite(Number(x))&&x!==null?clamp(Number(x),a,b):d;
function normalize(v={},legacy={}){v=v||{};return {version:1,enabled:typeof v.enabled==='boolean'?v.enabled:((legacy.selects?.noiseType||legacy.noiseType||'none')!=='none'&&Number(legacy.sliders?.noiseMix)>0),type:['white','pink'].includes(v.type)?v.type:(legacy.selects?.noiseType||legacy.noiseType)==='white'?'white':'pink',level:num(v.level,Number(legacy.sliders?.noiseMix)||20,0,100),filterEnabled:v.filterEnabled!==false,filterType:TYPES.includes(v.filterType)?v.filterType:'lowpass',poles:POLES.includes(Number(v.poles))?Number(v.poles):4,cutoff:num(v.cutoff,1800,20,20000),resonance:num(v.resonance,.707,.1,4),drive:num(v.drive,0,0,24),source:SOURCES.includes(v.source)?v.source:'L1',mode:['follow','trigger'].includes(v.mode)?v.mode:'trigger',amount:num(v.amount,4,-8,8),sensitivity:num(v.sensitivity,4,.25,32),threshold:num(v.threshold,.12,.005,.95),attack:num(v.attack,8,1,2000),decay:num(v.decay,180,5,4000),sustain:num(v.sustain,.15,0,1),release:num(v.release,240,5,5000),hold:num(v.hold,50,5,2000),invert:v.invert===true};}
// Startup only: explicit patch/Song restores continue to use normalize unchanged.
function startupSettings(v,legacy={}){return normalize({...normalize(v,legacy),enabled:false,filterEnabled:true,filterType:'lowpass',poles:16,cutoff:80,source:'drums',mode:'follow',amount:8,decay:50,release:50,sustain:0});}
function wave(w,p,pw=.5){switch(w){case'sine':return Math.sin(p*2*Math.PI);case'triangle':return p<.5?p*4-1:3-p*4;case'sawtooth':return p*2-1;case'ramp':return 1-p*2;case'square':return p<.5?-1:1;case'pulse':return p<pw?1:-1;case'stepped':return Math.floor(p*8)/7*2-1;default:return 0}}
function rawLfo(l,t){const phase=(t-l.start)*l.rate;return wave(l.wave,phase-Math.floor(phase),l.pulse)*l.depth;}
function lfoValue(lfos,index,t){const l=lfos[index];let depth=1;for(let j=0;j<3;j++)if(j!==index&&l.cross?.[j]){const amount=l.cross[j];depth*=1-amount+(rawLfo(lfos[j],t)+1)*.5*amount}return rawLfo(l,t)*depth;}

class Envelope{
 constructor(sr,config){this.sr=sr;this.value=0;this.detector=0;this.stage='idle';this.armed=true;this.followOpen=false;this.until=0;this.configure(config)}
 configure(v){const next=normalize(v);if(this.s&&(this.s.source!==next.source||this.s.mode!==next.mode)){this.value=0;this.detector=0;this.stage='idle';this.armed=true;this.followOpen=false;this.until=0}if(this.s&&(this.s.threshold!==next.threshold||this.s.sensitivity!==next.sensitivity)){this.armed=true;this.followOpen=false}this.s=next;this.a=Math.exp(-1/(this.s.attack*.001*this.sr));this.r=Math.exp(-1/(this.s.release*.001*this.sr));this.detectA=Math.exp(-1/(.002*this.sr));this.detectR=Math.exp(-1/(.025*this.sr));}
 trigger(t,strength=1){this.stage='attack';this.from=this.value;this.peak=clamp(strength,0,1);this.start=t;this.until=t+this.s.hold*.001;}
 sample(amplitude,t){const s=this.s,x=clamp(Math.abs(amplitude)*s.sensitivity,0,1);this.detector=x+(this.detector-x)*(x>this.detector?this.detectA:this.detectR);
  if(s.source!=='manual'){if(this.detector<s.threshold*.5)this.armed=true;if(this.detector>=s.threshold&&this.armed&&t>=this.until){if(s.mode==='trigger')this.trigger(t,1);this.armed=false}}
  if(s.mode==='follow'&&s.source!=='manual'){if(this.detector>=s.threshold)this.followOpen=true;else if(this.detector<s.threshold*.5)this.followOpen=false;const amplitude=this.followOpen?this.detector:0;const target=s.invert?1-amplitude:amplitude;this.value=target+(this.value-target)*(target>this.value?this.a:this.r);return this.value;}
  const elapsed=t-this.start;
  if(this.stage==='attack'){const f=clamp(elapsed/(s.attack*.001),0,1);this.value=this.from+(this.peak-this.from)*f;if(f===1){this.stage='decay';this.start=t}}
  else if(this.stage==='decay'){const f=clamp(elapsed/(s.decay*.001),0,1);this.value=this.peak*(1+(s.sustain-1)*f);if(f===1){this.stage='sustain';this.start=t;this.until=t+s.hold*.001}}
  else if(this.stage==='sustain'){this.value=this.peak*s.sustain;if(t>=this.until){this.stage='release';this.start=t;this.from=this.value}}
  else if(this.stage==='release'){const f=clamp(elapsed/(s.release*.001),0,1);this.value=this.from*(1-f);if(f===1){this.value=0;this.stage='idle'}}
  return s.invert?1-this.value:this.value;
 }
}
function randomise(v,random=Math.random){const pick=a=>a[Math.floor(random()*a.length)],s=normalize(v);return normalize({...s,enabled:false,type:pick(['white','pink']),level:6+Math.round(random()*16),filterEnabled:true,filterType:pick(TYPES),poles:pick([2,4,6,8]),cutoff:150+random()*2600,resonance:.5+random()*.7,drive:random()*9,source:pick(SOURCES.filter(k=>k!=='manual')),mode:pick(['follow','trigger']),amount:1+random()*4,sensitivity:3+random()*7,threshold:.05+random()*.16,attack:3+random()*55,decay:80+random()*420,sustain:random()*.3,release:90+random()*650,hold:30+random()*120,invert:false});}
const estimatedBytes=(sr=48000)=>Math.ceil(sr)*2*2*2*4+256*1024;
const api={TYPES,POLES,SOURCES,normalize,startupSettings,Envelope,lfoValue,randomise,estimatedBytes};if(typeof module==='object'&&module.exports)module.exports=api;else root.MygrainNoise=api;
})(typeof globalThis==='undefined'?window:globalThis);
