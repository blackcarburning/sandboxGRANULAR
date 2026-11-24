/* Henry's Hose — physically informed, source-driven stereo acoustic processor.
 * Research, approximations and units: docs/henrys-hose.md. No sample assets,
 * autonomous excitation, timers, per-sample allocations or UI-owned clocks. */
(function(root){
'use strict';
const TAU=2*Math.PI,C=343,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const DEFAULTS=Object.freeze({length:.34,bore:.3,ribs:.65,damping:.25,reflection:.58,orbit:.4,freeRate:.58,rotationMode:'sync',division:'2',direction:'forward',phase:0,sing:0,stereoFeed:1,micMode:'stereo',micLType:'modern',micRType:'modern',micLX:.33,micLY:.68,micLHeight:.08,micLAim:.875,micRX:.67,micRY:.68,micRHeight:.08,micRAim:.625,width:1,level:.8});
// Version 1 recipes retain their exact geometry and pitch; new sounds lead with Doppler.
const DOPPLER_DEFAULTS=Object.freeze({...DEFAULTS,doppler:.625,orbit:.6,division:'1',micLX:.22,micRX:.78});
const dopplerGain=s=>s.version===2?4*s.doppler:1;
const TYPES=Object.freeze({modern:'Modern condenser',omni:'Clean omni',ribbon:'Vintage ribbon · figure 8',broadcast:'Old broadcast',snare:'Snare dynamic',kick:'Kick dynamic',rifle:'Rifle / shotgun'});
const DIVISIONS=Object.freeze({'0.25':'4 turns / beat','0.5':'2 turns / beat','1':'1 turn / beat','2':'1 turn / 2 beats','4':'1 turn / bar (4 beats)','8':'1 turn / 2 bars','16':'1 turn / 4 bars','32':'1 turn / 8 bars'});
const ENUMS=Object.freeze({micMode:['mono','stereo'],rotationMode:['free','sync'],division:Object.keys(DIVISIONS),direction:['forward','reverse'],micLType:Object.keys(TYPES),micRType:Object.keys(TYPES)});
const length=s=>.25*Math.pow(32,s.length),bore=s=>.01*Math.pow(16,s.bore),orbit=s=>2*s.orbit,rate=s=>.02*(Math.pow(601,s.freeRate)-1),coordinate=v=>(v-.5)*8;
function normalize(value){const v=value&&typeof value==='object'?value:{},modern=value==null||v.version===2,out={version:modern?2:1};for(const[k,d]of Object.entries(modern?DOPPLER_DEFAULTS:DEFAULTS))out[k]=typeof d==='number'?(typeof v[k]!=='boolean'&&v[k]!==null&&v[k]!==''&&Number.isFinite(Number(v[k]))?clamp(Number(v[k]),0,1):d):ENUMS[k].includes(v[k])?v[k]:d;return out;}
class Line{
 constructor(n){this.a=new Float32Array(n);this.p=0;}
 write(v){this.a[this.p]=Math.abs(v)<1e-20?0:v;if(++this.p===this.a.length)this.p=0;}
 read(delay){let p=this.p-1-clamp(delay,0,this.a.length-3);if(p<0)p+=this.a.length;const i=Math.floor(p),f=p-i;return this.a[i]*(1-f)+this.a[(i+1)%this.a.length]*f;}
 clear(){this.a.fill(0);this.p=0;}
}
// Passive high shelves approximate the sqrt(f) thermoviscous attenuation law.
class Wall{
 constructor(sr){this.alpha=[150,1200,7000].map(f=>1-Math.exp(-TAU*f/sr));this.z=[0,0,0];this.g=[1,1,1];}
 set(l,r,loss,ribs){let previous=0;for(let i=0;i<3;i++){const f=[150,1200,7000][i],u=Math.sqrt(TAU*f);this.g[i]=Math.exp(-1.6e-5*l/r*(u-previous)*(1+3*loss+1.5*ribs));previous=u;}}
 tick(x){for(let i=0;i<3;i++){this.z[i]+=this.alpha[i]*(x-this.z[i]);x=this.z[i]+this.g[i]*(x-this.z[i]);}return x;}
 clear(){this.z.fill(0);}
}
class EQ{
 constructor(sr){this.sr=sr;this.z1=0;this.z2=0;this.b0=1;this.b1=this.b2=this.a1=this.a2=0;}
 peak(f,q,db){const w=TAU*Math.min(f,this.sr*.4)/this.sr,A=Math.pow(10,db/40),a=Math.sin(w)/(2*q),co=Math.cos(w),den=1+a/A;this.b0=(1+a*A)/den;this.b1=-2*co/den;this.b2=(1-a*A)/den;this.a1=-2*co/den;this.a2=(1-a/A)/den;}
 tick(x){const y=this.b0*x+this.z1;this.z1=this.b1*x-this.a1*y+this.z2;this.z2=this.b2*x-this.a2*y;return y;}
 clear(){this.z1=this.z2=0;}
}
const SMOOTH_FIELDS=['doppler','orbit','micLX','micLY','micLHeight','micLAim','micRX','micRY','micRHeight','micRAim','width','stereoFeed','sing'];
const PROFILES={modern:[.5,18000,30,0,0],omni:[1,19000,20,0,0],ribbon:[0,10500,35,0,0],broadcast:[.5,5200,140,1700,2],snare:[.5,12500,90,4600,4],kick:[.37,10500,28,430,-5],rifle:[.37,18000,45,5500,2]};
class Hose{
 constructor(sr,s){this.sr=sr;this.clocks=[{origin:0,bpm:120,at:0}];this.count=0;this.freePhase=0;this.lastTime=null;this.feedback=[0,0];this.bell=[0,0];this.boreTime=0;this.channels=Array.from({length:2},()=>({forward:new Line(Math.ceil(sr*.04)+8),back:new Line(Math.ceil(sr*.04)+8),air:new Line(Math.ceil(sr*(s.version===2?.08:.04))+8),fw:new Wall(sr),bw:new Wall(sr),mouth:0,singX:0,singY:0}));this.mics=Array.from({length:2},()=>({low:0,high:0,rifleAir:0,rifleLow:0,air:0,lp:0,hp:0,last:0,eq:new EQ(sr),bass:new EQ(sr),distance:1,delay:sr/C,gain:1,cos:1,sourceCos:1}));this.set(s,true);}
 set(s,instant=false){this.s=normalize(s);this.target={doppler:.25,...this.s};if(instant)this.p={doppler:.25,...this.s};this.metres=length(this.s);this.radius=bore(this.s)/2;this.effective=this.metres*(1+.075*this.s.ribs)+1.2266*this.radius;this.targetTime=this.effective/C*this.sr;if(instant)this.boreTime=this.targetTime;this.rho=.25+.68*this.s.reflection;this.inlet=.15+.65*this.s.reflection;this.inject=Math.sqrt(1-this.rho*this.inlet)*.8;this.mouthAlpha=1-Math.exp(-TAU*Math.min(this.sr*.4,C/(TAU*this.radius)*.5)/this.sr);for(const ch of this.channels){ch.fw.set(this.metres,this.radius,this.s.damping,this.s.ribs);ch.bw.set(this.metres,this.radius,this.s.damping,this.s.ribs);}for(let i=0;i<2;i++){const mic=this.mics[i],type=this.s[i?'micRType':'micLType'],p=PROFILES[type];mic.type=type;mic.pattern=p[0];mic.lowAlpha=1-Math.exp(-TAU*250/this.sr);mic.highAlpha=1-Math.exp(-TAU*2200/this.sr);mic.lpAlpha=1-Math.exp(-TAU*Math.min(this.sr*.4,p[1])/this.sr);mic.hpPole=Math.exp(-TAU*p[2]/this.sr);mic.eq.peak(p[3]||1000,.8,p[4]);mic.bass.peak(85,.7,type==='kick'?4:0);}}
 syncClock(c){if(!c||![c.origin,c.bpm,c.at].every(Number.isFinite)||c.bpm<=0)return;const next={origin:c.origin,bpm:clamp(c.bpm,1,300),at:c.at};this.clocks=this.clocks.filter(x=>x.at!==next.at);this.clocks.push(next);this.clocks.sort((a,b)=>a.at-b.at);if(this.clocks.length>32)this.clocks.splice(0,this.clocks.length-32);}
 clock(t){let c=this.clocks[0];for(let i=1;i<this.clocks.length&&this.clocks[i].at<=t;i++)c=this.clocks[i];return c;}
 angle(t,now=t){const s=this.s,sign=s.direction==='reverse'?-1:1;if(s.rotationMode==='free')return TAU*(s.phase+sign*(this.freePhase+(t-now)*rate(s)));const c=this.clock(t);return TAU*(s.phase+sign*(t-c.origin)*c.bpm/(60*Number(s.division)));}
 geometry(t){const s=this.s,p=this.p,r=orbit(p);for(let i=0;i<2;i++){const m=this.mics[i],prefix=i?'micR':'micL',mx=coordinate(p[prefix+'X']),my=coordinate(p[prefix+'Y']),mz=p[prefix+'Height']*3;let d=m.distance,angle=0,dx=0,dy=0;
  // Retarded source position: receiving time is not emission time. Subsonic
  // six-pass fixed-point geometry keeps delay and radiation on the same path.
  for(let j=0;j<(s.version===2?12:6);j++){angle=this.angle(t-d/C,t);dx=mx-r*Math.cos(angle);dy=my-r*Math.sin(angle);d=Math.max(.12,Math.hypot(dx,dy,mz));}
  const oldDelay=m.delay,oldCos=m.cos,oldGain=m.gain,oldRad=m.radiation;const nx=-dx/d,ny=-dy/d,aim=p[prefix+'Aim']*TAU;m.distance=d;let path=d;
  if(s.version===2){
   // Scale only the moving path component, not amplitude/pickup patterns. At
   // 1x this is physical propagation; at 0x rotation has no pitch modulation.
   // The closest possible path anchors delay above zero even at 4x depth.
   const c=this.clock(t),hz=s.rotationMode==='free'?rate(s):c.bpm/(60*Number(s.division)),speed=TAU*r*hz,depth=Math.min(4*p.doppler,.85*(1+C/Math.max(1e-9,speed))),near=Math.max(.12,Math.hypot(Math.hypot(mx,my)-r,mz));path=near+depth*(d-near);
  }
  m.delay=path/C*this.sr;m.cos=clamp(nx*Math.cos(aim)+ny*Math.sin(aim),-1,1);m.sourceCos=clamp((dx*Math.cos(angle)+dy*Math.sin(angle))/d,-1,1);m.gain=Math.min(1.8,1.3/(.5+d));m.radiation=1-Math.exp(-TAU*Math.min(this.sr*.42,1600+14000/(1+this.radius*80*(1-m.sourceCos)))/this.sr);if(this.count>1){m.delayStep=s.version===2?clamp((m.delay-oldDelay)/16,-3,.85):(m.delay-oldDelay)/16;m.cosStep=(m.cos-oldCos)/16;m.gainStep=(m.gain-oldGain)/16;m.radiationStep=(m.radiation-oldRad)/16;m.delay=oldDelay;m.cos=oldCos;m.gain=oldGain;m.radiation=oldRad;}else m.delayStep=m.cosStep=m.gainStep=m.radiationStep=0;}
  const c=this.clock(t),hz=s.rotationMode==='free'?rate(s):c.bpm/(60*Number(s.division)),flow=.18*TAU*r*hz,ribSpacing=.003+.015*(1-s.ribs),f0=C/(2*this.effective),mode=Math.max(1,Math.round(flow/ribSpacing/f0));this.singF=Math.min(this.sr*.2,mode*f0);this.singC=Math.cos(TAU*this.singF/this.sr);this.singS=Math.sin(TAU*this.singF/this.sr);}
 tick(l,r,t=0){if(this.lastTime!==null&&this.s.rotationMode==='free')this.freePhase=(this.freePhase+Math.max(0,Math.min(.01,t-this.lastTime))*rate(this.s))%1;this.lastTime=t;const p=this.p;for(const k of SMOOTH_FIELDS)p[k]+=(this.target[k]-p[k])*.001;this.boreTime+=(this.targetTime-this.boreTime)*.0007;if((this.count++&15)===0)this.geometry(t);
  const mono=(l+r)*.5;for(let ch=0;ch<2;ch++){const c=this.channels[ch],input=mono*(1-p.stereoFeed)+(ch?r:l)*p.stereoFeed,back=c.bw.tick(c.back.read(this.boreTime));c.forward.write(input*this.inject-back*this.inlet);const fwd=c.fw.tick(c.forward.read(this.boreTime));c.mouth+=this.mouthAlpha*(fwd-c.mouth);const reflection=-this.rho*c.mouth;c.back.write(reflection);let emitted=fwd+reflection;
   // Optional source-excited singing mode: no self-running whistle or free noise.
   const x=.997*(this.singC*c.singX-this.singS*c.singY)+input*.006,y=.997*(this.singS*c.singX+this.singC*c.singY);c.singX=Math.abs(x)<1e-20?0:x;c.singY=Math.abs(y)<1e-20?0:y;emitted+=c.singY*p.sing*.7;c.air.write(emitted*2.4);}
  let left=0,right=0;for(let i=0;i<2;i++){const m=this.mics[i],a=this.channels[i].air,b=this.channels[1-i].air;m.delay+=m.delayStep;m.cos+=m.cosStep;m.gain+=m.gainStep;m.radiation+=m.radiationStep;let x=a.read(m.delay)*.9+b.read(m.delay)*.1;m.air+=m.radiation*(x-m.air);x=m.air;m.low+=m.lowAlpha*(x-m.low);m.high+=m.highAlpha*(x-m.high);const low=m.low,mid=m.high-low;let high=x-m.high,base=m.pattern+(1-m.pattern)*m.cos,highPattern=base;if(m.type==='rifle'){
    // Eight virtual interference-tube ports, summing delayed arrivals. Only
    // the upper band becomes lobar; low frequencies remain supercardioid.
    let sum=0;for(let j=0;j<8;j++){const d=m.delay+(j/7)*.28*(1-m.cos)/C*this.sr;sum+=(a.read(d)*.9+b.read(d)*.1)/8;}m.rifleAir+=m.radiation*(sum-m.rifleAir);m.rifleLow+=m.highAlpha*(m.rifleAir-m.rifleLow);high=m.rifleAir-m.rifleLow;highPattern=base;
   }else if(m.type!=='omni')highPattern=base*(.45+.55*Math.max(0,m.cos));
   const proximity=m.type==='omni'?0:Math.min(1.5,.18/m.distance)*(m.type==='ribbon'?1.5:1);x=(low*(1+proximity)*base+mid*base+high*highPattern)*m.gain;m.lp+=m.lpAlpha*(x-m.lp);x=m.lp-m.last+m.hpPole*m.hp;m.last=m.lp;m.hp=x;x=m.bass.tick(m.eq.tick(x));if(i)right=x;else left=x;}
  if(this.s.micMode==='mono')right=left;const mid=(left+right)*.5,side=(left-right)*.5*p.width;this.l=mid+side;this.r=mid-side;
 }
 clear(){for(const c of this.channels){c.forward.clear();c.back.clear();c.air.clear();c.fw.clear();c.bw.clear();c.mouth=c.singX=c.singY=0;}for(const m of this.mics){m.low=m.high=m.rifleAir=m.rifleLow=m.air=m.lp=m.hp=m.last=0;m.eq.clear();m.bass.clear();}this.count=0;this.l=this.r=0;}
 dispose(){this.channels=null;this.mics=null;}
}
const estimatedBytes=(sr,s)=>((4*(Math.ceil(sr*.04)+8)+2*(Math.ceil(sr*(s?.version===2?.08:.04))+8))*4)+8192;
const api={DEFAULTS,DOPPLER_DEFAULTS,dopplerGain,TYPES,DIVISIONS,ENUMS,normalize,length,bore,orbit,rate,coordinate,Hose,estimatedBytes,C};if(typeof module==='object'&&module.exports)module.exports=api;else root.MygrainHenrysHose=api;
})(globalThis);
