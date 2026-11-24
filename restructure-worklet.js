/* Restructure 8: eight public sample lanes, Ember-style clocks/filters and one
 * shared dispersive spring tank. Individual chamber DSP is absent. */
'use strict';
// Post-synthesis automatic makeup -> manual fader -> stereo-linked peak control.
const TAU=2*Math.PI,limit=(x,a,b)=>Math.max(a,Math.min(b,x)),fract=x=>x-Math.floor(x);
function hash(a,b,c){let x=(a^Math.imul(b+1,374761393)^Math.imul(c+7,668265263))>>>0;x=Math.imul(x^(x>>>13),1274126177);return((x^(x>>>16))>>>0)/4294967296;}
function blep(t,dt){if(t<dt){t/=dt;return t+t-t*t-1;}if(t>1-dt){t=(t-1)/dt;return t*t+t+t+1;}return 0;}
function lfo(p,shape,width,seed){p=fract(p);if(shape==='sine')return Math.sin(TAU*p);if(shape==='triangle')return 1-4*Math.abs(p-.5);if(shape==='hold')return hash(seed,Math.floor(p*8),0)*2-1;const edge=.035;return limit((width-p)/edge,-1,1)*limit(p/edge,0,1)*limit((1-p)/edge,0,1);}
class Filter{
 constructor(){this.a=0;this.b=0;this.c=0;this.d=0;this.hp=0;this.x=0;this.g=.1;this.k=1;this.h=.99;}
 configure(cutoff,resonance,hp,sr){this.g=Math.tan(Math.PI*limit(cutoff,35,sr*.2)/sr);this.k=2-1.8*resonance;this.h=Math.exp(-TAU*hp/sr);}
 process(x,morph,notch){
  const hp=x-this.x+this.h*this.hp;this.x=x;this.hp=hp;
  const g=this.g,k=this.k,a=1/(1+g*(g+k));
  const v1=(this.a+g*(hp-this.b))*a,v2=this.b+g*v1;
  this.a=2*v1-this.a;this.b=2*v2-this.b;
  const high=hp-k*v1-v2;
  // Low -> band -> high morph, a second low-pass pole pair, and a moving notch.
  const t=morph*2,primary=t<1?v2*(1-t)+v1*t:v1*(2-t)+high*(t-1);
  const w1=(this.c+g*(primary-this.d))*a,w2=this.d+g*w1;
  this.c=2*w1-this.c;this.d=2*w2-this.d;
  return (primary*.35+w2*.65)*(1-notch)+(v2+high)*notch*.65;
 }
}
// Archived16th-order Butterworth; revision3 uses damped cascaded4th-order
// edges, each still eight serial TPT biquads. No
// parallel dry/notch path can leak around the 96 dB/oct low/high boundaries.
const FILTER_Q=Array.from({length:16},(_,i)=>1/(2*Math.cos((2*i+1)*Math.PI/32)));
const DAMPED_Q=Array.from({length:16},(_,i)=>i%2?1.3065629648763766:.541196100146197);
const EDGE_SCALE=(2**.25-1)**(-1/8);
function sampleCycleBeats(frames,ratio,shift=0,bpm=120,sr=48000){const minimum=Math.max(-14,Math.ceil(Math.log2(bpm/60/(sr*.4))));return 2**Math.max(minimum,Math.min(8,Math.round(Math.log2(Math.max(16,frames)/24000*64/ratio)-shift/12)));}
class Filter96{
 constructor(){this.lpA=new Float64Array(16);this.lpB=new Float64Array(16);this.hpA=new Float64Array(16);this.hpB=new Float64Array(16);this.k=new Float64Array(16);this.la=new Float64Array(16);this.ha=new Float64Array(16);this.na=0;this.nb=0;this.gl=.1;this.gh=.001;this.gn=.1;this.an=1;this.bypassLow=false;}
 configure(cutoff,resonance,hp,sr,morph,damped=false){
  const fc=limit(cutoff,35,sr*.42),base=limit(hp,15,sr*.2),t=limit(morph,0,1),bandHigh=Math.max(base,fc/Math.SQRT2),bandLow=Math.min(sr*.46,fc*Math.SQRT2);
  let high=t<=.5?base*(bandHigh/base)**(t*2):bandHigh*(Math.max(base,fc)/bandHigh)**((t-.5)*2);
  let low=t<=.5?fc*(bandLow/fc)**(t*2):bandLow*(sr*.46/bandLow)**((t-.5)*2);
  if(damped){low*=EDGE_SCALE;high/=EDGE_SCALE;const a=1-Math.exp(-32/(sr*.012));this.smoothLow=this.smoothLow==null?Math.log(low):this.smoothLow+a*(Math.log(low)-this.smoothLow);this.smoothHigh=this.smoothHigh==null?Math.log(high):this.smoothHigh+a*(Math.log(high)-this.smoothHigh);low=Math.exp(this.smoothLow);high=Math.exp(this.smoothHigh);}
  this.gl=Math.tan(Math.PI*limit(low,35,sr*.46)/sr);this.gh=Math.tan(Math.PI*limit(high,15,sr*.42)/sr);this.gn=Math.tan(Math.PI*fc/sr);this.an=1/(1+this.gn*(this.gn+1));this.bypassLow=t===1;
  for(let i=0;i<8;i++){const k=1/((damped?DAMPED_Q[i]:FILTER_Q[i])*(i===7?1+resonance*(damped?.35:.8):1));this.k[i]=k;this.la[i]=1/(1+this.gl*(this.gl+k));this.ha[i]=1/(1+this.gh*(this.gh+k));}
 }
 process(x,morph,notch){
  const gh=this.gh,gl=this.gl;
  for(let i=0;i<8;i++){const k=this.k[i],a=(this.hpA[i]+gh*(x-this.hpB[i]))*this.ha[i],b=this.hpB[i]+gh*a;this.hpA[i]=2*a-this.hpA[i];this.hpB[i]=2*b-this.hpB[i];x=x-k*a-b;}
  if(!this.bypassLow)for(let i=0;i<8;i++){const a=(this.lpA[i]+gl*(x-this.lpB[i]))*this.la[i],b=this.lpB[i]+gl*a;this.lpA[i]=2*a-this.lpA[i];this.lpB[i]=2*b-this.lpB[i];x=b;}
  // Serial moving notch, after both steep edges (not a full-band bypass).
  const a=(this.na+this.gn*(x-this.nb))*this.an,b=this.nb+this.gn*a;this.na=2*a-this.na;this.nb=2*b-this.nb;
  return x-notch*a;
 }
}
// Three dispersive feedback waveguides form one shared stereo spring tank.
// Cascaded all-pass sections delay frequencies differently, producing spring
// chirps. Fixed coefficients + bounded low-passed feedback are deterministic.
class Spring {
 constructor(sr){this.sr=sr;this.left=0;this.right=0;this.lines=[.0317,.0391,.0479].map((seconds,voice)=>({buffer:new Float32Array(Math.ceil(sr*.22)),pos:0,delay:seconds*sr,low:0,sections:Array.from({length:12},(_,i)=>({x:0,y:0,a:.35+.045*((i+voice*3)%10)}))}));}
 configure(s){this.mix=s.mix;this.feedback=.2+s.decay*.74;this.damp=.025+(1-s.damping)**2*.6;this.drive=1+s.tension*1.5;for(let i=0;i<3;i++)this.lines[i].delay=this.sr*[.0317,.0391,.0479][i]*(.55+s.size*1.45)*(1-s.tension*.3);for(const line of this.lines)line.sections.forEach((ap,i)=>ap.a=.25+.04*(i%10)+s.tension*.2);}
 process(left,right){let l=0,r=0;for(let i=0;i<3;i++){const s=this.lines[i],p=(s.pos-s.delay+s.buffer.length)%s.buffer.length,index=Math.floor(p),fraction=p-index;let y=s.buffer[index]*(1-fraction)+s.buffer[(index+1)%s.buffer.length]*fraction;
 for(const ap of s.sections){const next=ap.a*y+ap.x-ap.a*ap.y;ap.x=y;ap.y=next;y=next;}
 s.low+=this.damp*(y-s.low);const input=(left*(i===1?.3:.7)+right*(i===1?.7:.3))*.4;const feedback=s.low*this.feedback;const driven=(input+feedback)*this.drive;s.buffer[s.pos]=Math.tanh(driven)/this.drive;s.pos=(s.pos+1)%s.buffer.length;l+=s.low*[.7,.2,.5][i];r+=s.low*[.2,.7,-.5][i];}
 this.left=l;this.right=r;}
}
class AutoLevel{
 constructor(sr){this.maximum=128;this.power=(.65/24)**2;this.gain=24;this.limiter=1;this.energyRate=1-Math.exp(-1/(sr*.08));this.down=1-Math.exp(-1/(sr*.025));this.up=1-Math.exp(-1/(sr*.6));this.release=1-Math.exp(-1/(sr*.004));this.delay=Math.ceil(sr*.003);this.size=this.delay+1;this.l=new Float64Array(this.size);this.r=new Float64Array(this.size);this.peaks=new Float64Array(this.size);this.times=new Float64Array(this.size);this.head=0;this.count=0;this.frame=0;this.left=0;this.right=0;}
 process(l,r,level){
  const peak=Math.max(Math.abs(l),Math.abs(r));
  // Freeze makeup on silence, rather than lifting rests or chasing a noise floor.
  if(peak>1e-5){this.power+=this.energyRate*((l*l+r*r)*.5-this.power);const target=limit(.65/Math.sqrt(Math.max(this.power,1e-12)),.125,this.maximum);this.gain+=(target-this.gain)*(target<this.gain?this.down:this.up);}
  l*=this.gain*level;r*=this.gain*level;const n=this.frame++,slot=n%this.size,p=Math.max(Math.abs(l),Math.abs(r));
  // Monotone peak deque covers exactly the delayed output + its known future.
  while(this.count&&this.times[this.head]<n-this.delay){this.head=(this.head+1)%this.size;this.count--;}
  while(this.count){const last=(this.head+this.count-1)%this.size;if(this.peaks[last]>p)break;this.count--;}
  const tail=(this.head+this.count)%this.size;this.peaks[tail]=p;this.times[tail]=n;this.count++;
  this.l[slot]=l;this.r[slot]=r;const maximum=this.peaks[this.head],desired=maximum>.94?.94/maximum:1;
  this.limiter=desired<this.limiter?desired:this.limiter+this.release*(desired-this.limiter);
  const read=(slot+1)%this.size;this.left=this.l[read]*this.limiter;this.right=this.r[read]*this.limiter;
 }
}
class Restructure8 extends AudioWorkletProcessor{
 constructor(options){super();const p=options.processorOptions;this.monitorVoice=Number.isInteger(p.monitorVoice)&&p.monitorVoice>=0&&p.monitorVoice<8?p.monitorVoice:-1;this.samples=p.samples||[];this.sourceFrames=p.sourceFrames||[];this.state=p.state;this.bpm=p.bpm;this.origin=p.origin;this.anchorTime=p.origin;this.anchorBeat=0;this.seqAnchorTime=p.origin;this.seqAnchorBeat=0;this.start=p.time;this.dead=false;this.frame=0;this.phase=new Float64Array(16);this.sampleAnchor=new Float64Array(8);this.hitAge=new Float64Array(8);this.hitKey=Array(8).fill(null);this.lastHit=Array(8).fill(null);this.prev=new Float64Array(8);this.next=new Float64Array(8);this.envelopes=new Float64Array(8);this.decayEnvelopes=new Float64Array(8);this.couplings=new Float64Array(8);this.filters=Array.from({length:16},()=>new Filter());this.filters96=Array.from({length:16},()=>new Filter96());this.carrierPower=new Float64Array(8);this.carrierPower.fill(.01);this.spring=new Spring(sampleRate);this.params=Array.from({length:8},()=>({width:[.5,.5],pan:0,mix:0,rate:0}));this.dcIn=[0,0];this.dcOut=[0,0];this.air=[0,0];this.master=0;this.autoLevel=new AutoLevel(sampleRate);
 this.stopTime=Infinity;this.notifyStart=p.notifyStart===true;
 this.port.onmessage=e=>{if(e.data.stopAt===null||Number.isFinite(e.data.stopAt))this.stopTime=e.data.stopAt===null?Infinity:e.data.stopAt;if(Number.isInteger(e.data.monitorVoice))this.monitorVoice=e.data.monitorVoice>=0&&e.data.monitorVoice<8?e.data.monitorVoice:-1;if(e.data.samples){this.samples=e.data.samples;this.sourceFrames=e.data.sourceFrames||[];this.phase.fill(0);}if(e.data.dispose){this.dead=true;return;}if(e.data.state){const old=this.state.tempo??this.bpm,next=e.data.state.tempo??e.data.bpm;const oldDiv=this.state.engineRevision>=2?(this.state.clockDivider||1):1,nextDiv=e.data.state.engineRevision>=2?(e.data.state.clockDivider||1):1;if(old!==next||oldDiv!==nextDiv){this.seqAnchorBeat+=(currentTime-this.seqAnchorTime)*old/60/oldDiv;this.seqAnchorTime=currentTime;}if(old!==next){this.anchorBeat+=(currentTime-this.anchorTime)*old/60;this.anchorTime=currentTime;}this.state=e.data.state;this.bpm=e.data.bpm;}};
 }
 controls(beat){const s=this.state,sr=sampleRate*2,bpm=s.tempo??this.bpm,seconds=60/bpm;
  this.spring.configure(this.state.spring);
  for(let i=0;i<8;i++){const v=s.voices[i],p=this.params[i],phase=beat/v.lfo.beats+i*.173,l=lfo(phase,v.lfo.shape,v.lfo.width,s.seed+i),r=lfo(phase+v.lfo.stereo*.5,v.lfo.shape,v.lfo.width,s.seed+i),motion=(l+r)*.5;
   p.width[0]=limit(v.width+l*v.lfo.widthDepth*.42,.05,.95);p.width[1]=limit(v.width+r*v.lfo.widthDepth*.42,.05,.95);p.pan=limit(v.pan+motion*v.lfo.panDepth,-1,1);p.mix=0;p.rate=bpm/60*v.ratio;if(!s.sampleSource&&s.pitch?.semitones)p.rate*=2**(s.pitch.semitones/12);if(s.engineRevision>=3&&s.sampleSource){p.cycle=sampleCycleBeats(this.sourceFrames[i]||this.samples[i]?.length||16,v.ratio,0,bpm,sampleRate);p.cycleJump=sampleCycleBeats(this.sourceFrames[i]||this.samples[i]?.length||16,v.ratio,v.pitchJump,bpm,sampleRate);if(s.pitch?.semitones&&s.pitch.mode==='speed'){const pitchRatio=2**(s.pitch.semitones/12);p.cycle/=pitchRatio;p.cycleJump/=pitchRatio;}}
   for(let ch=0;ch<2;ch++){const wave=ch?r:l,spread=(ch?1:-1)*v.filter.spread*.4,cutoff=v.filter.cutoff*2**(wave*v.lfo.filterDepth*3+spread);if(s.engineRevision>=2)this.filters96[i*2+ch].configure(cutoff,v.filter.resonance,v.filter.highpass,sr,v.filter.morph,s.engineRevision>=3);else this.filters[i*2+ch].configure(cutoff,v.filter.resonance,v.filter.highpass,sr);}

  }
 }
 event(i,beat){const s=this.state,v=s.voices[i],loop=s.stepLoop,looping=loop?.enabled===true&&(loop.start!==1||loop.end!==16),span=looping?loop.end-loop.start+1:16,bar=looping?Math.floor(beat*4/span):Math.floor(beat/4),raw=looping?loop.start-1+(beat*4%span):fract(beat/4)*16,pair=Math.floor(raw/2)*2,local=raw-pair,bound=1+(s.engineRevision>=2?0:s.swing);
  const shifted=pair+(local<bound?local/bound:1+(local-bound)/(2-bound)),step=Math.floor(shifted),position=shifted-step,random=hash(s.seed+i,bar,step),base=v.pattern[step];
  if(!v.on||!base||random>v.chance)return 0;
  const repeats=Math.min(8,base+(hash(s.seed+31+i,bar,step)<v.glitch?1+Math.floor(hash(s.seed+i,step,bar+29)*3):0)),t=fract(position*repeats),gate=v.gate;
  if(s.engineRevision>=3){this.hitKey[i]=bar*128+step*8+Math.floor(position*repeats);this.hitAge[i]=t*.25/repeats*(s.clockDivider||1);}
  if(t>=gate)return 0;
  const duration=(60/(s.tempo??this.bpm))*(s.engineRevision>=2?(s.clockDivider||1):1)*.25/repeats,age=t*duration,end=(gate-t)*duration,attack=Math.min(1,age/.0025),release=Math.min(1,end/.004);
  return attack*attack*release*release*Math.exp(-2.4*t/gate);
 }
 process(inputs,outputs){const out=outputs[0];if(this.dead||!out?.length)return false;const s=this.state,sr=sampleRate,decay=s.sampleSource?limit(s.sampleDecay||0,0,2):0,decayFactor=decay>0?Math.exp(-Math.log(1000)/(sr*decay)):0,dc=Math.exp(-TAU*18/sr),air=1-Math.exp(-TAU*Math.min(18000,sr*.4)/sr);
  this.autoLevel.maximum=s.sampleSource?512:128;
  for(let n=0;n<out[0].length;n++){
   const time=currentTime+n/sr,bpm=s.tempo??this.bpm,beat=Math.max(0,this.anchorBeat+(time-this.anchorTime)*bpm/60);
   if(time>=this.stopTime){for(const channel of out)channel.fill(0,n);this.dead=true;this.port.postMessage?.({retired:true});return false;}
   if(time<this.start||!s.enabled){out[0][n]=0;if(out[1])out[1][n]=0;continue;}
   if(this.notifyStart){this.notifyStart=false;this.port.postMessage?.({started:true});}
   if((this.frame++&15)===0)this.controls(beat);
   for(let i=0;i<8;i++){this.envelopes[i]=this.event(i,s.engineRevision>=2?Math.max(0,this.seqAnchorBeat+(time-this.seqAnchorTime)*bpm/60/(s.clockDivider||1)):beat);const rawEnvelope=this.envelopes[i];this.decayEnvelopes[i]=decay>0&&s.voices[i].on?Math.max(rawEnvelope,this.decayEnvelopes[i]*decayFactor):rawEnvelope;if(decay>0)this.envelopes[i]=this.decayEnvelopes[i];if(s.engineRevision>=3&&this.hitKey[i]!==this.lastHit[i]){this.sampleAnchor[i]=beat-this.hitAge[i];this.lastHit[i]=this.hitKey[i];}let fm=0,norm=0;for(let j=0;j<8;j++){const amount=s.matrix[i][j];fm+=this.prev[j]*amount;norm+=Math.abs(amount);}this.couplings[i]=limit(fm/Math.max(1,norm),-1,1)*s.crossDepth*(s.engineRevision>=2?6:3);}
   let left=0,right=0;
   for(let i=0;i<8;i++){
    const v=s.voices[i],p=this.params[i],env=this.envelopes[i],glitched=hash(s.seed+i,Math.floor((s.engineRevision>=2?Math.max(0,this.seqAnchorBeat+(time-this.seqAnchorTime)*bpm/60/(s.clockDivider||1)):beat)*4),17)<v.glitch,shift=glitched?v.pitchJump:0,rate=Math.min(sr*.12,p.rate*2**(shift/12));let dryLeft=0,dryRight=0,rawForCross=0;
    // Two-times oversampling; each stereo side has its own PWM and TPT state.
    for(let ch=0;ch<2;ch++){
     const idx=i*2+ch,frequency=rate*2**(v.detune*(ch?1:-1)/1200)*(1+this.couplings[i]),increment=limit((s.sampleSource?frequency/64*24000/Math.max(1,this.samples[i]?.length||1):frequency)/(sr*2),-.22,.22),dt=Math.max(1e-8,Math.abs(increment));let sum=0;
     for(let os=0;os<2;os++){if(s.engineRevision>=3&&s.sampleSource){const cycle=(glitched?p.cycleJump:p.cycle),clockBeat=beat+os*bpm/(60*sr*2),drift=v.detune/30*(ch?1:-1)*.025*Math.sin(TAU*clockBeat/4);this.phase[idx]=fract((clockBeat-this.sampleAnchor[i])/cycle+drift);}
      const ph=s.engineRevision>=2?fract(this.phase[idx]+this.couplings[i]*(s.engineRevision>=3?.06:.04)):this.phase[idx],width=p.width[ch];let tone;
      if(s.sampleSource){const pcm=this.samples[i];if(pcm?.length){const length=pcm.length,position=ph*length,index=Math.floor(position),fraction=position-index,forward=pcm[index%length]*(1-fraction)+pcm[(index+1)%length]*fraction;const folded=fract(ph+(width-.5)*.8)*length,j=Math.floor(folded),t=folded-j,shifted=pcm[j%length]*(1-t)+pcm[(j+1)%length]*t;tone=forward*v.body+shifted*(1-v.body); }else tone=0;}else{const edge=fract(ph-width),pulse=(ph<width?1:-1)+blep(ph,dt)-blep(edge,dt)-(2*width-1),body=Math.sin(TAU*ph);tone=body*v.body+pulse*(1-v.body)*.7;}
      rawForCross+=tone*.25;this.phase[idx]=fract((s.engineRevision>=2?this.phase[idx]:ph)+increment);sum+=(s.engineRevision>=2?this.filters96[idx]:this.filters[idx]).process(tone*env,v.filter.morph,v.filter.notch)*.5;}
     if(ch===0)dryLeft=sum;else dryRight=sum;
    }
    const x=dryLeft,y=dryRight;
    if(s.engineRevision>=2){const carrier=rawForCross+0;this.carrierPower[i]+=(1-Math.exp(-1/(sr*.025)))*(carrier*carrier-this.carrierPower[i]);this.next[i]=v.on?Math.tanh(carrier*.7/Math.sqrt(Math.max(this.carrierPower[i],1e-6)))*v.level:0;}else this.next[i]=limit((v.on?rawForCross+0:0)*v.level,-1.5,1.5);
    if(v.on&&(this.monitorVoice<0||this.monitorVoice===i)){left+=x*Math.sqrt((1-p.pan)*.5)*v.level;right+=y*Math.sqrt((1+p.pan)*.5)*v.level;}
   }
   this.spring.process(left,right);left=left*(1-s.spring.mix*.35)+this.spring.left*s.spring.mix;right=right*(1-s.spring.mix*.35)+this.spring.right*s.spring.mix;
   this.prev.set(this.next);this.master+=(s.level*2.1-this.master)*.003;
   for(let ch=0;ch<2;ch++){const x=ch?right:left,high=x-this.dcIn[ch]+dc*this.dcOut[ch];this.dcIn[ch]=x;this.dcOut[ch]=high;this.air[ch]+=air*(high-this.air[ch]);}
   this.autoLevel.process(this.air[0],this.air[1],this.master);
   for(let ch=0;ch<2;ch++){const a=s.level===0?0:(ch?this.autoLevel.right:this.autoLevel.left),m=Math.abs(a),safe=m<.85?a:Math.sign(a)*(.85+.13*Math.tanh((m-.85)/.13));out[ch][n]=Number.isFinite(safe)?safe:0;}
  }return true;
 }
}
registerProcessor('mygrain-restructure8-v1',Restructure8);
