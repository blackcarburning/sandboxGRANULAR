/* Shared deterministic stereo DSP: AudioWorklet preview and Node offline render. */
(function(root){
'use strict';
const VERSION='live-master-3';
const extra={lowEQ:0,midEQ:0,highEQ:0,lowComp:0,midComp:0,highComp:0,exciter:0,outputDrive:0,maximiser:0,targetLufs:-10};
const PRESETS={clean:{drive:0,subcut:20,bass:0,compression:15,ceiling:-1.5},punch:{drive:3,subcut:25,bass:35,compression:30,ceiling:-1.5},dense:{drive:5,subcut:25,bass:45,compression:50,ceiling:-1.5},level:{drive:0,subcut:0,bass:0,compression:0,ceiling:-1.5}};
for(const p of Object.values(PRESETS))Object.assign(p,extra);
PRESETS.loud={...PRESETS.punch,drive:6,outputDrive:6,lowComp:25,midComp:20,highComp:15};
PRESETS.hot={...PRESETS.dense,drive:9,outputDrive:10,lowComp:40,midComp:30,highComp:20,exciter:12};
const limits={subcut:[0,60],drive:[-24,36],bass:[0,100],compression:[0,100],ceiling:[-6,-.3],lowEQ:[-12,12],midEQ:[-12,12],highEQ:[-12,12],lowComp:[0,100],midComp:[0,100],highComp:[0,100],exciter:[0,100],outputDrive:[0,24],maximiser:[0,1],targetLufs:[-24,-6]};
function settings(value={},strict=false){const out={};for(const [k,[lo,hi]] of Object.entries(limits)){const v=value[k]??PRESETS.clean[k];if(strict&&(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi||(k==='maximiser'&&v!==0&&v!==1)))throw Error('Invalid live mastering '+k);out[k]=Math.max(lo,Math.min(hi,Number.isFinite(v)?v:PRESETS.clean[k]));}return out;}
const db=x=>20*Math.log10(Math.max(1e-12,x)),amp=x=>10**(x/20);
// ITU-R BS.1770 K weighting at the preview's required 48 kHz.
// EBU momentary: 400 ms; short-term: 3 s. Meter only: no audio modification.
class OutputLoudness{
 constructor(){this.state=new Float64Array(8);this.ring=new Float64Array(144000);this.pos=0;this.frames=0;this.m=0;this.s=0;}
 channel(x,c){const z=this.state;const y=1.53512485958697*x+z[c];z[c]=-2.69169618940638*x+1.69065929318241*y+z[c+1];z[c+1]=1.19839281085285*x-.73248077421585*y;const h=y+z[c+2];z[c+2]=-2*y+1.99004745483398*h+z[c+3];z[c+3]=y-.99007225036621*h;return h;}
 process(l,r){const a=this.channel(l,0),b=this.channel(r,4),v=a*a+b*b;this.m+=v-this.ring[(this.pos+144000-19200)%144000];this.s+=v-this.ring[this.pos];this.ring[this.pos]=v;this.pos=(this.pos+1)%144000;this.frames++;}
 reading(sum,n){return this.frames<n||sum/n<1e-12?null:-.691+10*Math.log10(Math.max(1e-12,sum/n));}
 get momentary(){return this.reading(this.m,19200);}
 get shortTerm(){return this.reading(this.s,144000);}
}

class Processor{
 constructor(rate,values){this.rate=rate;this.maxInput=new OutputLoudness();this.maxOutput=new OutputLoudness();this.maxGainDb=0;this.maxTargetDb=0;this.maxCount=0;this.maxReady=false;this.split=new Float64Array(4);this.bandEnv=new Float64Array(3);this.bandReduction=new Float64Array(3);this.crossoverLow=1-Math.exp(-2*Math.PI*180/rate);this.crossoverHigh=1-Math.exp(-2*Math.PI*3500/rate);this.delay=Math.ceil(rate*.005);this.l=new Float32Array(this.delay);this.r=new Float32Array(this.delay);this.dl=new Float32Array(this.delay);this.dr=new Float32Array(this.delay);this.pos=0;this.subL1=0;this.subL2=0;this.subR1=0;this.subR2=0;this.lowL=0;this.lowR=0;this.detLowL=0;this.detLowR=0;this.env=0;this.bassEnv=0;this.limiter=1;this.compGain=1;this.bassGain=1;this.outL=0;this.outR=0;this.dryL=0;this.dryR=0;this.smooth=null;this.configure(values);this.a=1-Math.exp(-2*Math.PI*120/rate);this.attack=Math.exp(-1/(rate*.012));this.release=Math.exp(-1/(rate*.15));this.bAttack=Math.exp(-1/(rate*.025));this.bRelease=Math.exp(-1/(rate*.2));this.lRelease=Math.exp(-1/(rate*.1));this.lAttack=Math.exp(-1/(rate*.0003));this.slew=1-Math.exp(-1/(rate*.02));}
 configure(values){this.values=settings(values);this.target=[amp(this.values.drive),this.values.bass/100,this.values.compression/100,amp(this.values.ceiling),1-Math.exp(-2*Math.PI*(this.values.subcut||20)/this.rate),this.values.subcut>0?1:0,amp(this.values.lowEQ),amp(this.values.midEQ),amp(this.values.highEQ),this.values.lowComp/100,this.values.midComp/100,this.values.highComp/100,this.values.exciter/100,amp(this.values.outputDrive),this.values.maximiser,this.values.targetLufs];if(!this.smooth)this.smooth=this.target.slice();}
 process(left,right){
  const s=this.smooth,t=this.target;for(let i=0;i<t.length;i++)s[i]+=(t[i]-s[i])*this.slew;
  const drive=s[0],bass=s[1],compression=s[2],ceiling=s[3];
  this.subL1+=s[4]*(left-this.subL1);this.subR1+=s[4]*(right-this.subR1);
  const hL=left-this.subL1,hR=right-this.subR1;this.subL2+=s[4]*(hL-this.subL2);this.subR2+=s[4]*(hR-this.subR2);
  let l=(left+(hL-this.subL2-left)*s[5])*drive,r=(right+(hR-this.subR2-right)*s[5])*drive;
  this.lowL+=this.a*(l-this.lowL);this.lowR+=this.a*(r-this.lowR);
  const bp=Math.max(Math.abs(this.lowL),Math.abs(this.lowR)),ba=bp>this.bassEnv?this.bAttack:this.bRelease;this.bassEnv=bp+(this.bassEnv-bp)*ba;
  this.bassGain=amp(-Math.max(0,db(this.bassEnv)+20)*.65*bass);
  l+=this.lowL*(this.bassGain-1);r+=this.lowR*(this.bassGain-1);
  // Detector high-pass reduces low-end-driven broadband pumping. Audible bass
  // stays intact when its own compression is zero; no automatic bass boost.
  this.detLowL+=this.a*(l-this.detLowL);this.detLowR+=this.a*(r-this.detLowR);
  const peak=Math.max(Math.abs(l-this.detLowL),Math.abs(r-this.detLowR)),ea=peak>this.env?this.attack:this.release;this.env=peak+(this.env-peak)*ea;
  this.compGain=amp(-Math.max(0,db(this.env)+18)*compression*.75);l*=this.compGain;r*=this.compGain;
  // Complementary 180 Hz / 3.5 kHz bands sum exactly to the input at unity.
  const z=this.split;z[0]+=this.crossoverLow*(l-z[0]);z[1]+=this.crossoverLow*(r-z[1]);z[2]+=this.crossoverHigh*(l-z[2]);z[3]+=this.crossoverHigh*(r-z[3]);
  let mixedL=0,mixedR=0;
  for(let b=0;b<3;b++){
   let bl=b===0?z[0]:b===1?z[2]-z[0]:l-z[2],br=b===0?z[1]:b===1?z[3]-z[1]:r-z[3];
   bl*=s[6+b];br*=s[6+b];
   const pk=Math.max(Math.abs(bl),Math.abs(br)),env=this.bandEnv[b],a=pk>env?this.attack:this.release;
   this.bandEnv[b]=pk+(env-pk)*a;const gr=Math.max(0,db(this.bandEnv[b])+24)*s[9+b]*.8;this.bandReduction[b]=gr;
   const gain=amp(-gr);bl*=gain;br*=gain;
   // High-band parallel saturation. No dry attenuation when amount is zero.
   if(b===2){bl+=s[12]*(Math.tanh(bl*3)-bl)*.5;br+=s[12]*(Math.tanh(br*3)-br)*.5;}
   mixedL+=bl;mixedR+=br;
  }
  l=mixedL*s[13];r=mixedR*s[13];
  // Optional target servo: feed-forward start, then slow output-loudness feedback.
  // Silence never drives gain up; +24 dB gain and 12 dB limiting bound the chase.
  this.maxInput.process(l,r);
  if(++this.maxCount>=this.rate/10){
   this.maxCount=0;const inputLU=this.maxInput.momentary,outputLU=this.maxOutput.momentary;
   if(this.values.maximiser>0&&inputLU!==null&&inputLU>-60){
    if(!this.maxReady){this.maxTargetDb=Math.max(-24,Math.min(24,this.values.targetLufs-inputLU));this.maxReady=true;}
    else if(outputLU!==null){const error=this.values.targetLufs-outputLU;if(error<0||-db(this.limiter)<12)this.maxTargetDb=Math.max(-24,Math.min(24,this.maxTargetDb+Math.max(-.5,Math.min(.25,error*.1))));}
   }
  }
  const wanted=this.values.maximiser>0?this.maxTargetDb:0;
  this.maxGainDb+=(wanted-this.maxGainDb)*(1-Math.exp(-1/(this.rate*.5)));
  const maxGain=amp(this.maxGainDb);l*=maxGain;r*=maxGain;
  const p=this.pos,oldL=this.l[p],oldR=this.r[p];this.dryL=this.dl[p];this.dryR=this.dr[p];this.l[p]=l;this.r[p]=r;this.dl[p]=left;this.dr[p]=right;this.pos=(p+1)%this.delay;
  const desired=Math.min(1,ceiling/Math.max(Math.abs(l),Math.abs(r),1e-12)),la=desired<this.limiter?this.lAttack:this.lRelease;this.limiter=desired+(this.limiter-desired)*la;
  const safe=Math.min(this.limiter,ceiling/Math.max(Math.abs(oldL),Math.abs(oldR),1e-12));this.outL=oldL*safe;this.outR=oldR*safe;
  this.maxOutput.process(this.outL,this.outR);
  this.reduction=-db(Math.max(1e-12,this.compGain*safe));this.bassReduction=-db(this.bassGain);
 }
}
const api={VERSION,PRESETS,limits,settings,Processor,OutputLoudness,db};root.MygrainMasterDSP=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
