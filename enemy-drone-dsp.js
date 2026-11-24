/* Enemy Drone v1. One deterministic bounded engine for live and isolated Song audio. */
(function(root){'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const num=(v,d,a=0,b=1)=>typeof v==='number'&&Number.isFinite(v)?clamp(v,a,b):d;
const NOTES=[36,43,48,51,55,60,62,67],CENTS=[-.83,.71,-.47,.39,-.23,.17,-.61,.53];
const FINAL_L=[1,1,-1,1,1,-1,-1,-1],FINAL_R=[1,-1,1,1,-1,-1,1,-1];
const WAVEFORMS=['original','sine','triangle','saw','square','pulse'];
const driftDefaults=()=>({enabled:false,amount:15,speed:.08,breath:.06,pan:.1});
const normalizeDrift=v=>({enabled:v?.enabled===true,amount:num(v?.amount,15,0,50),speed:num(v?.speed,.08,.01,.5),breath:num(v?.breath,.06,0,.3),pan:num(v?.pan,.1,0,.5)});
const finalReverbDefaults=()=>({mix:0,size:.75,decay:5,tone:.55,predelay:.022});
function normalizeFinalReverb(v){v=v||{};return{mix:num(v.mix,0),size:num(v.size,.75),decay:num(v.decay,5,.5,12),tone:num(v.tone,.55),predelay:num(v.predelay,.022,0,.15)};}
const pitchLfoDefaults=()=>({enabled:false,depth:25,rate:.125,shape:'ramp',range:'up'});
const PITCH_LFO_RATIOS=[1/16,1/8,1/4,1/2,1,2,4,8,16];
const pitchLfoHz=(v,bpm=120)=>v?.sync===true?num(bpm,120,1,1000)/60*(v.ratio||1):v.rate;
const normalizePitchLfo=v=>({...((Object.hasOwn(v||{},'sync')||Object.hasOwn(v||{},'ratio'))?{sync:v?.sync===true,ratio:PITCH_LFO_RATIOS.includes(v?.ratio)?v.ratio:1}:{}),enabled:v?.enabled===true,depth:num(v?.depth,25,0,100),rate:num(v?.rate,.125,.01,8),shape:['ramp','rectifiedSine','saw'].includes(v?.shape)?v.shape:'ramp',range:['up','bipolar','down'].includes(v?.range)?v.range:'up'});
const pitchLfoActive=v=>v?.pitchLfo?.enabled===true&&v.pitchLfo.depth>0;
// Output is octaves, not a linear-Hz offset: 25% = one octave in every register.
function pitchLfoAt(phase,shape,range){const p=phase-Math.floor(phase),u=shape==='rectifiedSine'?Math.sin(Math.PI*p):shape==='saw'?1-p:p;return range==='bipolar'?2*u-1:range==='down'?u-1:u;}
class PitchLfo{
 constructor(rate,value,bpm=120){this.bpm=bpm;this.sampleRate=rate;this.phase=0;this.slew=1-Math.exp(-1/(rate*.025));this.update(value);this.depth=this.settings.enabled?this.settings.depth*.04:0;this.rate=pitchLfoHz(this.settings,this.bpm);}
 update(value){this.settings=normalizePitchLfo(value);}
 setTempo(bpm){this.bpm=num(bpm,120,1,1000);}
 process(){const s=this.settings;this.depth+=((s.enabled?s.depth*.04:0)-this.depth)*this.slew;const hz=pitchLfoHz(s,this.bpm);if(s.sync)this.rate=hz;else this.rate+=(hz-this.rate)*this.slew;const out=this.depth*pitchLfoAt(this.phase,s.shape,s.range);this.phase=(this.phase+this.rate/this.sampleRate)%1;return out;}
 get bypass(){return (!this.settings.enabled||!this.settings.depth)&&this.depth<1e-8;}
}
function normalize(v){v=v||{};const modern=v.engineRevision===2;return{version:1,...(modern?{engineRevision:2,distortion:{drive:num(v.distortion?.drive,.35),mix:num(v.distortion?.mix,0)}}:{}),...(Object.hasOwn(v,'transpose')?{transpose:Math.round(num(v.transpose,0,-24,24))}:{}),...(v.finalReverb?{finalReverb:normalizeFinalReverb(v.finalReverb)}:{}),...(v.drift?{drift:normalizeDrift(v.drift)}:{}),...(v.pitchLfo?{pitchLfo:normalizePitchLfo(v.pitchLfo)}:{}),enabled:v.enabled===true,level:num(v.level,.45),tone:num(v.tone,.3),detune:num(v.detune,7,0,100),cross:num(v.cross,.12),motion:num(v.motion,.12),routing:['pairs','ring','swarm'].includes(v.routing)?v.routing:'pairs',delay:{mix:num(v.delay?.mix,.2),time:num(v.delay?.time,.375,.05,2),feedback:num(v.delay?.feedback,modern?.65:.38,0,modern?.985:.88),return:num(v.delay?.return,modern?.28:.1)},reverb:{mix:num(v.reverb?.mix,.3),size:num(v.reverb?.size,.55),decay:num(v.reverb?.decay,modern?.86:.65,0,modern?.995:.92),return:num(v.reverb?.return,modern?.3:.12)},voices:Array.from({length:8},(_,i)=>({...((v.voices?.[i]&&Object.hasOwn(v.voices[i],'waveform'))?{waveform:WAVEFORMS.includes(v.voices[i].waveform)?v.voices[i].waveform:'original'}:{}),...((v.voices?.[i]&&Object.hasOwn(v.voices[i],'width'))?{width:num(v.voices[i].width,.5,.1,.9)}:{}),...((v.voices?.[i]&&Object.hasOwn(v.voices[i],'phase'))?{phase:num(v.voices[i].phase,0,0,360)}:{}),on:v.voices?.[i]?.on!==false,note:Math.round(num(v.voices?.[i]?.note,NOTES[i],36,96)),fine:num(v.voices?.[i]?.fine,0,-100,100),level:num(v.voices?.[i]?.level,.65),pan:num(v.voices?.[i]?.pan,[-.8,.8,-.55,.55,-.3,.3,-.1,.1][i],-1,1)}))};}
const audible=v=>!!(v?.enabled&&v.level>0&&v.voices?.some(x=>x.on&&x.level>0));

// Output-only stereo hall: four allpasses per side into an eight-line modulated
// orthogonal FDN. RT60 feedback, damping and DC rejection; no return to the swarm.
class FinalReverb{
 constructor(rate,settings){
  this.rate=rate;this.w=0;this.dry=1;this.wet=0;this.output=new Float64Array(2);
  this.buffers=Array.from({length:8},()=>new Float32Array(Math.ceil(rate*.21)+4));
  this.delays=new Float64Array(8);this.targetDelays=new Float64Array(8);this.feedback=new Float64Array(8);
  this.reads=new Float64Array(8);this.matrix=new Float64Array(8);this.low=new Float64Array(8);this.dc=new Float64Array(8);
  this.oscSin=Float64Array.from({length:8},(_,i)=>Math.sin(i*1.713));this.oscCos=Float64Array.from({length:8},(_,i)=>Math.cos(i*1.713));
  this.rotSin=Float64Array.from([.071,.089,.107,.131,.157,.181,.211,.241],x=>Math.sin(2*Math.PI*x/rate));
  this.rotCos=Float64Array.from([.071,.089,.107,.131,.157,.181,.211,.241],x=>Math.cos(2*Math.PI*x/rate));
  this.predelay=[new Float32Array(Math.ceil(rate*.15)+4),new Float32Array(Math.ceil(rate*.15)+4)];
  this.diffusers=[0,1].map(ch=>[.0037,.0059,.0083,.0113].map((t,i)=>({buffer:new Float32Array(Math.max(3,Math.round(rate*t*(ch?[1.13,.97,1.07,1.19][i]:1)))),at:0})));
  this.slew=1-Math.exp(-1/(rate*.025));this.delaySlew=1-Math.exp(-1/(rate*.15));this.dcSlew=1-Math.exp(-2*Math.PI*12/rate);
  this.update(settings);this.delays.set(this.targetDelays);this.pre=this.targetPre;
 }
 update(settings){const s=this.settings=normalizeFinalReverb(settings);this.targetDry=Math.cos(s.mix*Math.PI/2);this.targetWet=Math.sin(s.mix*Math.PI/2);this.targetPre=s.predelay*this.rate;this.damping=Math.min(.95,1-Math.exp(-2*Math.PI*(1200+15000*s.tone*s.tone)/this.rate));
  [.0311,.0379,.0437,.0533,.0617,.0719,.0797,.0893].forEach((v,i)=>{this.targetDelays[i]=v*(.6+s.size*1.5)*this.rate;this.feedback[i]=10**(-3*this.targetDelays[i]/this.rate/s.decay);});
 }
 read(buffer,offset){const p=(this.w-offset+buffer.length*4)%buffer.length,j=Math.floor(p),f=p-j;return buffer[j]*(1-f)+buffer[(j+1)%buffer.length]*f;}
 process(left,right){
  this.dry+=(this.targetDry-this.dry)*this.slew;this.wet+=(this.targetWet-this.wet)*this.slew;this.pre+=(this.targetPre-this.pre)*this.delaySlew;
  let a=left,b=right;
  for(let ch=0;ch<2;ch++){
   const p=this.predelay[ch];p[this.w%p.length]=ch?right:left;let x=this.read(p,this.pre);
   for(const d of this.diffusers[ch]){const delayed=d.buffer[d.at],y=delayed-.65*x;d.buffer[d.at]=x+.65*y;d.at=(d.at+1)%d.buffer.length;x=y;}
   if(ch)b=x;else a=x;
  }
  let l=0,r=0;
  for(let i=0;i<8;i++){
   this.delays[i]+=(this.targetDelays[i]-this.delays[i])*this.delaySlew;
   const sin=this.oscSin[i],cos=this.oscCos[i];this.oscSin[i]=sin*this.rotCos[i]+cos*this.rotSin[i];this.oscCos[i]=cos*this.rotCos[i]-sin*this.rotSin[i];
   const x=this.read(this.buffers[i],this.delays[i]+sin*this.rate*.00023);this.low[i]+=(x-this.low[i])*this.damping;this.dc[i]+=(this.low[i]-this.dc[i])*this.dcSlew;const y=this.low[i]-this.dc[i];this.reads[i]=y;this.matrix[i]=y;l+=y*FINAL_L[i];r+=y*FINAL_R[i];
  }
  // In-place Walsh-Hadamard transform, orthonormalized by sqrt(8).
  for(let stride=1;stride<8;stride*=2)for(let base=0;base<8;base+=2*stride)for(let j=0;j<stride;j++){const i=base+j,x=this.matrix[i],y=this.matrix[i+stride];this.matrix[i]=x+y;this.matrix[i+stride]=x-y;}
  for(let i=0;i<8;i++){const injection=(a*(i<4?1:-1)+b*(i%2?-1:1))*.12;this.buffers[i][this.w%this.buffers[i].length]=injection+this.matrix[i]*.3535533905932738*this.feedback[i];}
  this.output[0]=left*this.dry+l*.35*this.wet;this.output[1]=right*this.dry+r*.35*this.wet;this.w++;return this.output;
 }
 get silentBypass(){return this.settings.mix===0&&this.wet<1e-6;}
}
const extended=v=>!!v&&((v.transpose||0)!==0||v.detune>50||v.voices?.some(x=>x.on&&x.level>0&&Math.abs(x.fine)>50)||(v.finalReverb?.mix||0)>0);

// Shared harmonic mipmaps: 1..256 partials, linear phase/adjacent-bank
// interpolation. Only source waveforms are band-limited; PM/feedback can add sidebands.
const TABLE_SIZE=4096,TAU=2*Math.PI;
function makeWaveTables(){
 const saw=[],triangle=[],a=new Float64Array(TABLE_SIZE+1),b=new Float64Array(TABLE_SIZE+1);
 for(let n=1;n<=256;n++){
  const ca=-2/(Math.PI*n),cb=n%2?8/(Math.PI*Math.PI*n*n)*(n%4===1?1:-1):0;
  for(let j=0;j<TABLE_SIZE;j++){const x=Math.sin(TAU*n*j/TABLE_SIZE);a[j]+=x*ca;b[j]+=x*cb;}
  if((n&(n-1))===0){a[TABLE_SIZE]=a[0];b[TABLE_SIZE]=b[0];saw.push(Float32Array.from(a));triangle.push(Float32Array.from(b));}
 }return{saw,triangle};
}
const waveTables=makeWaveTables();
function tableAt(table,phase){const at=(phase-Math.floor(phase))*TABLE_SIZE,j=Math.floor(at),f=at-j;return table[j]*(1-f)+table[j+1]*f;}
function waveAt(shape,phase,frequency,width=.5){
 if(shape==='sine')return Math.sin(TAU*phase);
 const q=clamp(Math.log2(.45/Math.max(1e-8,frequency)),0,9),hi=Math.min(8,Math.floor(q)),lo=Math.max(0,hi-1),mix=q>=9?1:q-Math.floor(q),tables=shape==='triangle'?waveTables.triangle:waveTables.saw;
 let x=tableAt(tables[lo],phase)*(1-mix)+tableAt(tables[hi],phase)*mix;
 if(shape==='square'||shape==='pulse'){const w=shape==='square'?.5:width;x=(x-tableAt(tables[lo],phase+w)*(1-mix)-tableAt(tables[hi],phase+w)*mix)/(2*Math.max(w,1-w));}
 return x;
}
// Three incommensurate continuous phases per voice, not noise or random steps.
class LivingDrift{
 constructor(rate,value){this.rate=rate;this.blend=0;this.slew=1-Math.exp(-1/(rate*.15));this.sin=new Float64Array(24);this.cos=new Float64Array(24);this.rs=new Float64Array(24);this.rc=new Float64Array(24);this.pitch=new Float64Array(8);this.amplitude=new Float64Array(8);this.pan=new Float64Array(8);this.amplitude.fill(1);for(let i=0;i<24;i++){this.sin[i]=Math.sin(i*1.713+.37);this.cos[i]=Math.cos(i*1.713+.37);}this.amount=value.amount;this.breath=value.breath;this.panAmount=value.pan;this.update(value);}
 update(value){const s=this.settings=normalizeDrift(value);for(let i=0;i<8;i++)for(let j=0;j<3;j++){const w=TAU*s.speed*(.71+i*.097)*[1,.371,1.713][j]/this.rate,k=i*3+j;this.rs[k]=Math.sin(w);this.rc[k]=Math.cos(w);}}
 process(){const s=this.settings,k=this.slew;this.blend+=((s.enabled?1:0)-this.blend)*k;this.amount+=(s.amount-this.amount)*k;this.breath+=(s.breath-this.breath)*k;this.panAmount+=(s.pan-this.panAmount)*k;
  for(let i=0;i<8;i++){const at=i*3;for(let j=at;j<at+3;j++){const a=this.sin[j],b=this.cos[j];this.sin[j]=a*this.rc[j]+b*this.rs[j];this.cos[j]=b*this.rc[j]-a*this.rs[j];}const a=this.sin[at],b=this.sin[at+1],c=this.sin[at+2];this.pitch[i]=(.55*a+.3*b+.15*c)*this.amount*this.blend;this.amplitude[i]=1-this.breath*this.blend*(.5+.5*(.6*b+.4*c));this.pan[i]=(.65*c+.35*a)*this.panAmount*this.blend;}
 }
 get bypass(){return !this.settings.enabled&&this.blend<1e-7;}
}
const living=v=>!!(v?.drift?.enabled||v?.voices?.some(x=>x.on&&x.level>0&&x.waveform&&x.waveform!=='original'));

const phased=v=>!!v?.voices?.some(x=>x.on&&x.level>0&&(x.phase||0)%360!==0);

class Engine{
 constructor(rate,value,clock={}){this.bpm=num(clock.bpm,120,1,1000);this.rate=rate;this.phaseShift=Float64Array.from({length:8},(_,i)=>(num(value?.voices?.[i]?.phase,0,0,360)%360)/360);this.phaseTarget=new Float64Array(8);this.waveMix=new Float64Array(48);this.waveTarget=new Uint8Array(8);this.waveActive=new Uint8Array(8);this.width=new Float64Array(8);for(let i=0;i<8;i++){const v=value?.voices?.[i],shape=Math.max(0,WAVEFORMS.indexOf(v?.waveform||'original'));this.waveMix[i*6+shape]=1;this.width[i]=num(v?.width,.5,.1,.9);}this.phase=new Float64Array(8);this.last=new Float64Array(8);this.gains=new Float64Array(8);this.freq=new Float64Array(8);this.panL=new Float64Array(8);this.panR=new Float64Array(8);this.frames=0;this.volume=0;this.tone=0;this.cross=0;this.motion=0;this.detune=0;this.delay=[new Float32Array(Math.ceil(rate*2)+4),new Float32Array(Math.ceil(rate*2)+4)];this.room=Array.from({length:4},()=>new Float32Array(Math.ceil(rate*.18)+4));this.roomFilter=new Float64Array(4);this.roomReads=new Float64Array(4);this.dcX=new Float64Array(2);this.dcY=new Float64Array(2);this.low=new Float64Array(2);this.ret=0;this.w=0;this.distMix=this.distDrive=0;this.mixD=this.mixR=this.feedD=this.feedR=0;this.dtime=rate*.375;this.update(value);}
 setTempo(bpm){this.bpm=num(bpm,120,1,1000);this.pitchMod?.setTempo(this.bpm);}
 update(value){const s=this.s=normalize(value);if(pitchLfoActive(s)){if(!this.pitchMod)this.pitchMod=new PitchLfo(this.rate,s.pitchLfo,this.bpm);else this.pitchMod.update(s.pitchLfo);}else if(this.pitchMod)this.pitchMod.update({...this.pitchMod.settings,enabled:false});for(let i=0;i<8;i++){this.phaseTarget[i]=((s.voices[i].phase||0)%360)/360;this.waveTarget[i]=WAVEFORMS.indexOf(s.voices[i].waveform||'original');if(this.waveTarget[i]||this.waveMix[i*6]<1-1e-7)this.waveActive[i]=1;}if(s.drift?.enabled){if(!this.drifter)this.drifter=new LivingDrift(this.rate,s.drift);else this.drifter.update(s.drift);}else if(this.drifter)this.drifter.update({...this.drifter.settings,enabled:false});this.increments=s.voices.map(v=>440*2**((v.note-69+(s.transpose||0))/12)/this.rate);if(s.enabled&&s.finalReverb?.mix>0){if(!this.finalVerb)this.finalVerb=new FinalReverb(this.rate,s.finalReverb);else this.finalVerb.update(s.finalReverb);}else if(!s.enabled){this.finalVerb=null;}else if(this.finalVerb)this.finalVerb.update(s.finalReverb||finalReverbDefaults());this.angles=s.voices.map(v=>(v.pan+1)*Math.PI/4);this.roomLengths=[.0297,.0371,.0411,.0437].map(t=>Math.round(this.rate*t*(.6+s.reverb.size*2.9)));this.damping=1-Math.exp(-2*Math.PI*(650+10000*s.tone*s.tone)/this.rate);this.slew=1-Math.exp(-1/(this.rate*.025));this.dc=Math.exp(-2*Math.PI*18/this.rate);}
 read(buffer,offset){const at=(this.w-offset+buffer.length*4)%buffer.length,k=Math.floor(at),f=at-k;return buffer[k]*(1-f)+buffer[(k+1)%buffer.length]*f;}
 process(left,right,start=0){const s=this.s,k=this.slew,modern=s.engineRevision===2;for(let f=start;f<left.length;f++){
  this.volume+=((s.enabled?s.level:0)-this.volume)*k;this.tone+=(s.tone-this.tone)*k;this.cross+=(s.cross-this.cross)*k;this.detune+=(s.detune-this.detune)*k;this.motion+=(s.motion-this.motion)*k;
  this.mixD+=(s.delay.mix-this.mixD)*k;this.mixR+=(s.reverb.mix-this.mixR)*k;this.feedD+=(s.delay.return-this.feedD)*k;this.feedR+=(s.reverb.return-this.feedR)*k;this.dtime+=clamp(s.delay.time*this.rate-this.dtime,-.25,.25);
  const d0=this.read(this.delay[0],this.dtime),d1=this.read(this.delay[1],Math.min(this.delay[1].length-2,this.dtime*1.013)),r=this.roomReads;for(let i=0;i<4;i++){const b=this.room[i];r[i]=b[(this.w+b.length-this.roomLengths[i])%b.length];}
  const roomL=(r[0]+r[1]-r[2]+r[3])*.25,roomR=(r[0]-r[1]+r[2]+r[3])*.25,back=Math.tanh((d0+d1)*.5*this.feedD+(roomL+roomR)*this.feedR),old=this.last;
  if(this.drifter){this.drifter.process();if(this.drifter.bypass)this.drifter=null;}const living=this.drifter,pitchOctaves=this.pitchMod?this.pitchMod.process():0,pitchRatio=pitchOctaves?2**pitchOctaves:1;const pitchActive=!!this.pitchMod;if(this.pitchMod?.bypass)this.pitchMod=null;let l=0,rr=0;for(let i=0;i<8;i++){
   const v=s.voices[i];this.gains[i]+=((v.on?v.level:0)-this.gains[i])*k;this.freq[i]+=(this.increments[i]*2**((v.fine+CENTS[i]*this.detune)/1200)-this.freq[i])*k;const angle=living?(clamp(v.pan+living.pan[i],-1,1)+1)*Math.PI/4:this.angles[i];this.panL[i]+=(Math.cos(angle)-this.panL[i])*k;this.panR[i]+=(Math.sin(angle)-this.panR[i])*k;
   let mod=s.routing==='pairs'?old[i^1]:s.routing==='ring'?old[(i+7)%8]:(old[(i+7)%8]+old[(i+3)%8])*.5;
   const drift=Math.sin((this.frames+f)/this.rate*(.11+i*.023)+i)*this.motion*.002*(living?1-living.blend:1);
   let frequency=living?this.freq[i]*2**(living.pitch[i]/1200):this.freq[i];if(pitchActive)frequency=Math.min(.45,frequency*pitchRatio);this.phase[i]=(this.phase[i]+frequency*(1+drift))%1;
   // Phase is a read offset, never a carrier reset. Slew the shortest arc at edits.
   if(this.phaseShift[i]!==this.phaseTarget[i]){let delta=this.phaseTarget[i]-this.phaseShift[i];delta-=Math.round(delta);let next=Math.abs(delta)<1e-10?this.phaseTarget[i]:this.phaseShift[i]+delta*k;if(next<0)next+=1;else if(next>=1)next-=1;this.phaseShift[i]=next;}
   const rawPhase=this.phase[i]*Math.PI*2+mod*this.cross*2+back*(modern?3:.85),phase=this.phaseShift[i]?rawPhase+this.phaseShift[i]*TAU:rawPhase,base=Math.sin(phase),h3=(pitchActive?frequency:this.freq[i])*this.rate< this.rate/6?Math.sin(3*phase)/3:0,h5=(pitchActive?frequency:this.freq[i])*this.rate<this.rate/10?Math.sin(5*phase)/5:0;
   let signal=(base+this.tone*(h3+h5))/(1+this.tone*.4);
   if(this.waveActive[i]){let mixed=0,residual=0;this.width[i]+=(num(v.width,.5,.1,.9)-this.width[i])*k;for(let shape=0;shape<6;shape++){const at=i*6+shape;this.waveMix[at]+=((shape===this.waveTarget[i]?1:0)-this.waveMix[at])*k;const gain=this.waveMix[at];if(shape)residual+=gain;if(gain>1e-9)mixed+=gain*(shape?waveAt(WAVEFORMS[shape],phase/TAU,frequency,this.width[i]):signal);}signal=mixed;if(!this.waveTarget[i]&&residual<1e-7){this.waveActive[i]=0;this.waveMix.fill(0,i*6,i*6+6);this.waveMix[i*6]=1;}}
   const x=living?signal*this.gains[i]*living.amplitude[i]:signal*this.gains[i];old[i]=x;l+=x*this.panL[i]*.11;rr+=x*this.panR[i]*.11;
  }
  // Stereo distortion is before both effects, so repeats and the room inherit it.
  if(modern){this.distMix+=(s.distortion.mix-this.distMix)*k;this.distDrive+=(s.distortion.drive-this.distDrive)*k;const drive=1+31*this.distDrive*this.distDrive;l+=(Math.tanh(l*drive)/Math.sqrt(drive)-l)*this.distMix;rr+=(Math.tanh(rr*drive)/Math.sqrt(drive)-rr)*this.distMix;}
  // Strictly bounded writes, sub-unity feedback, damped orthogonal FDN mixing.
  this.delay[0][this.w%this.delay[0].length]=Math.tanh(l+d1*s.delay.feedback+roomL*this.feedR*(modern?.65:.25)*(1-s.delay.feedback));
  this.delay[1][this.w%this.delay[1].length]=Math.tanh(rr+d0*s.delay.feedback+roomR*this.feedR*(modern?.65:.25)*(1-s.delay.feedback));
  const sum=(r[0]+r[1]+r[2]+r[3])*.5;
  for(let i=0;i<4;i++){this.roomFilter[i]+=(sum-r[i]-this.roomFilter[i])*this.damping;this.room[i][this.w%this.room[i].length]=Math.tanh((i%2?rr:l)*.4+(i%2?d1:d0)*this.feedD*(modern?.65:.25)*(1-s.reverb.decay)+this.roomFilter[i]*s.reverb.decay);}
  for(let ch=0;ch<2;ch++){const raw=(ch?rr:l)+(ch?d1:d0)*this.mixD+(ch?roomR:roomL)*this.mixR,dc=raw-this.dcX[ch]+this.dc*this.dcY[ch];this.dcX[ch]=raw;this.dcY[ch]=dc;this.low[ch]+=(dc-this.low[ch])*Math.min(.9,this.damping);if(!this.finalVerb){const x=this.low[ch]*this.volume*(modern?1.6:1),y=.85*Math.tanh(x/.85);(ch?right:left)[f]=Number.isFinite(y)?y:0;}}
  if(this.finalVerb){const mix=this.finalVerb.process(this.low[0],this.low[1]);for(let ch=0;ch<2;ch++){const x=mix[ch]*this.volume*(modern?1.6:1),y=.85*Math.tanh(x/.85);(ch?right:left)[f]=Number.isFinite(y)?y:0;}if(this.finalVerb.silentBypass)this.finalVerb=null;}
  this.w++;this.ret=back;
 }this.frames+=left.length-start;return true;}
}
const prepared=new WeakMap();
async function prepare(context){const ctx=context.__mygrainNativeContext||context;if(!prepared.has(ctx)){const p=ctx.audioWorklet.addModule(new URL('enemy-drone-worklet.js?v=20261122-enemy-pitch-sync-1',document.baseURI));prepared.set(ctx,p);p.catch(()=>prepared.delete(ctx));}await prepared.get(ctx);}
function createGraph(context,destination,value,{time=context.currentTime,bpm=120,gate=()=>1}={}){const ctx=context.__mygrainNativeContext||context,node=new AudioWorkletNode(ctx,'mygrain-enemy-drone-v1',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{state:normalize(value),time,bpm}}),output=ctx.createGain();output.gain.value=gate();node.connect(output);output.connect(destination);let dead=false;return{node,output,update(v,bpm){if(!dead)node.port.postMessage({state:normalize(v),bpm});},setGain(v){if(!dead)output.gain.setTargetAtTime(v,ctx.currentTime,.01);},dispose(){if(dead)return;dead=true;node.port.postMessage({dispose:true});node.disconnect();output.disconnect();node.port.close();}};}
const api={normalize,PITCH_LFO_RATIOS,pitchLfoHz,pitchLfoDefaults,normalizePitchLfo,pitchLfoAt,pitchLfoActive,PitchLfo,normalizeDrift,driftDefaults,LivingDrift,WAVEFORMS,waveAt,living,phased,defaults:()=>normalize({engineRevision:2}),upgrade:v=>normalize({...v,engineRevision:2}),audible,Engine,FinalReverb,finalReverbDefaults,extended,prepare,createGraph,estimatedBytes:(rate,value)=>Math.ceil(rate*((value?.finalReverb?.mix>0?8:5)+(value?.voices?.some(x=>x.waveform&&x.waveform!=='original')?2:0)))*4,renderVersion:v=>audible(v)?(pitchLfoActive(v)?(v.pitchLfo.sync?7:6):phased(v)?5:living(v)?4:extended(v)?3:v.engineRevision===2?2:1):0};root.MygrainEnemyDrone=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
