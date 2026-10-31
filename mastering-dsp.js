/* Shared deterministic stereo DSP: AudioWorklet preview and Node offline render. */
(function(root){
'use strict';
const VERSION='live-master-1';
const PRESETS={clean:{drive:0,subcut:20,bass:0,compression:15,ceiling:-1.5},punch:{drive:3,subcut:25,bass:35,compression:30,ceiling:-1.5},dense:{drive:5,subcut:25,bass:45,compression:50,ceiling:-1.5},level:{drive:0,subcut:0,bass:0,compression:0,ceiling:-1.5}};
const limits={subcut:[0,60],drive:[-24,24],bass:[0,100],compression:[0,100],ceiling:[-6,-1]};
function settings(value={},strict=false){const out={};for(const [k,[lo,hi]] of Object.entries(limits)){const v=value[k]??PRESETS.clean[k];if(strict&&(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi))throw Error('Invalid live mastering '+k);out[k]=Math.max(lo,Math.min(hi,Number.isFinite(v)?v:PRESETS.clean[k]));}return out;}
const db=x=>20*Math.log10(Math.max(1e-12,x)),amp=x=>10**(x/20);
class Processor{
 constructor(rate,values){this.rate=rate;this.delay=Math.ceil(rate*.005);this.l=new Float32Array(this.delay);this.r=new Float32Array(this.delay);this.dl=new Float32Array(this.delay);this.dr=new Float32Array(this.delay);this.pos=0;this.subL1=0;this.subL2=0;this.subR1=0;this.subR2=0;this.lowL=0;this.lowR=0;this.detLowL=0;this.detLowR=0;this.env=0;this.bassEnv=0;this.limiter=1;this.compGain=1;this.bassGain=1;this.outL=0;this.outR=0;this.dryL=0;this.dryR=0;this.smooth=null;this.configure(values);this.a=1-Math.exp(-2*Math.PI*120/rate);this.attack=Math.exp(-1/(rate*.012));this.release=Math.exp(-1/(rate*.15));this.bAttack=Math.exp(-1/(rate*.025));this.bRelease=Math.exp(-1/(rate*.2));this.lRelease=Math.exp(-1/(rate*.1));this.lAttack=Math.exp(-1/(rate*.0003));this.slew=1-Math.exp(-1/(rate*.02));}
 configure(values){this.values=settings(values);this.target=[amp(this.values.drive),this.values.bass/100,this.values.compression/100,amp(this.values.ceiling),1-Math.exp(-2*Math.PI*(this.values.subcut||20)/this.rate),this.values.subcut>0?1:0];if(!this.smooth)this.smooth=this.target.slice();}
 process(left,right){
  const s=this.smooth,t=this.target;for(let i=0;i<6;i++)s[i]+=(t[i]-s[i])*this.slew;
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
  const p=this.pos,oldL=this.l[p],oldR=this.r[p];this.dryL=this.dl[p];this.dryR=this.dr[p];this.l[p]=l;this.r[p]=r;this.dl[p]=left;this.dr[p]=right;this.pos=(p+1)%this.delay;
  const desired=Math.min(1,ceiling/Math.max(Math.abs(l),Math.abs(r),1e-12)),la=desired<this.limiter?this.lAttack:this.lRelease;this.limiter=desired+(this.limiter-desired)*la;
  const safe=Math.min(this.limiter,ceiling/Math.max(Math.abs(oldL),Math.abs(oldR),1e-12));this.outL=oldL*safe;this.outR=oldR*safe;
  this.reduction=-db(Math.max(1e-12,this.compGain*safe));this.bassReduction=-db(this.bassGain);
 }
}
const api={VERSION,PRESETS,limits,settings,Processor,db};root.MygrainMasterDSP=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
