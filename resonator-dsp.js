/* R: bounded, audio-excited physical approximations. Shared live/server DSP. */
(function(root){
'use strict';
const Inputs=root.MygrainEffectInputs||(typeof module==='object'&&module.exports?require('./effect-inputs.js'):null);
const SOURCES=Inputs.SOURCES;
const MATERIALS={door:['hollowWood','wood','metal'],wall:['plaster','plywood','metal'],pipe:['metal','plastic','wood'],cone:['paper','plastic','metal']};
const LABELS={door:'Door',wall:'Wall / panel',pipe:'Pipe',cone:'Broken speaker cone',hollowWood:'Hollow timber',wood:'Solid wood',metal:'Metal',plaster:'Plasterboard',plywood:'Plywood',plastic:'Plastic',paper:'Paper'};
const LIMITS={drive:[0,36],damping:[0,1],level:[0,1],pan:[-1,1],width:[.15,5],height:[.15,5],thickness:[1,100],depth:[.01,1],gap:[0,20],looseness:[0,1],length:[.1,8],diameter:[.01,.6],radius:[.025,.5],tear:[0,1],rub:[0,1]};
const CURVE_SIZE=16,CURVE_MIN=-36,CURVE_FREQS=Array.from({length:CURVE_SIZE},(_,i)=>20*Math.pow(1000,i/(CURVE_SIZE-1)));
const objectDefaults=type=>({door:{material:'hollowWood',width:.85,height:2,thickness:35,depth:.04,gap:2,looseness:.55},wall:{material:'plaster',width:2.4,height:2.4,thickness:12,depth:.12,looseness:.45},pipe:{material:'metal',length:1.2,diameter:.08,ends:'open'},cone:{material:'paper',radius:.15,depth:.06,tear:.6,looseness:.4,rub:.25}}[type]||{});
function slot(value,index=0){const v=value&&typeof value==='object'?value:{},object=Object.hasOwn(MATERIALS,v.object)?v.object:index===1?'cone':'door';const s={enabled:index===0,object,source:index===1?'X':'drumKick',band:'bass',drive:18,damping:.4,level:.45,pan:index===1?.25:-.25,width:.85,height:2,thickness:35,depth:.04,gap:2,looseness:.55,length:1.2,diameter:.08,radius:.15,tear:.6,rub:.25,ends:'open',...objectDefaults(object)};
 if(typeof v.enabled==='boolean')s.enabled=v.enabled;
 if(SOURCES.includes(v.source))s.source=v.source;if(['full','bass','mid','treble'].includes(v.band))s.band=v.band;
 if(MATERIALS[object].includes(v.material))s.material=v.material;if(v.ends==='closed')s.ends='closed';
 if(Array.isArray(v.excitationCurve)&&v.excitationCurve.length===CURVE_SIZE&&v.excitationCurve.every(x=>typeof x==='number'&&Number.isFinite(x)))s.excitationCurve=v.excitationCurve.map(x=>Math.max(CURVE_MIN,Math.min(0,x)));
 for(const[k,[lo,hi]]of Object.entries(LIMITS))if(typeof v[k]==='number'&&Number.isFinite(v[k]))s[k]=Math.max(lo,Math.min(hi,v[k]));return s;}
function normalize(v){const s={version:1,enabled:v?.enabled===true,slots:[0,1].map(i=>slot(v?.slots?.[i],i))};if(typeof v?.outputLevel==='number'&&Number.isFinite(v.outputLevel)&&v.outputLevel!==1)s.outputLevel=Math.max(0,Math.min(1,v.outputLevel));if(v?.delay&&['ms','sync'].includes(v.delay.mode))s.delay={mode:v.delay.mode,ms:Math.max(0,Math.min(2000,Number(v.delay.ms)||0)),division:[64,32,16,8,4,2].includes(v.delay.division)?v.delay.division:16};return s;}
const audible=v=>{const s=normalize(v);return s.enabled&&s.slots.some(x=>x.enabled&&x.level>0);};
const matches=(source,key)=>source===key||source==='K'&&/^K[1-5]$/.test(key)||source==='drums'&&key.startsWith('drum');
const estimatedBytes=rate=>Math.ceil(rate*16/343+8)*4*2+8*2*8*8+(CURVE_SIZE-1)*12*8*2+128*4+640+(Math.ceil(rate*2)+1)*4*2;
const physical={hollowWood:[.72,.6],wood:[1,.65],metal:[2.7,.16],plaster:[.65,.95],plywood:[1.2,.5],plastic:[.6,.85],paper:[.4,.8]};
function modes(s,rate){const [stiff,loss]=physical[s.material],scale=Math.sqrt(stiff),area=Math.sqrt(s.width*s.height);let base;
 if(s.object==='cone')base=48*(.15/s.radius)*Math.sqrt(.06/s.depth)*scale*Math.sqrt(1-.6*s.looseness);
 else base=(s.object==='door'?47:80)*scale*Math.sqrt(s.thickness/(s.object==='door'?35:12))*(1.3/area)/Math.sqrt(1+s.depth*2)*(1-.42*s.looseness);
 base=Math.max(6,Math.min(1200,base));
 const ratios=s.object==='cone'?[1,1.61,2.32,3.48,4.72,6.1,8.4,11.3]:[1,1.47+s.width/s.height*.13,2.16,2.83+s.height/s.width*.08,4.13,5.7,7.93,10.9];
 return ratios.map((r,i)=>{const f=Math.min(rate*.42,base*r),decay=.035+(1-s.damping)**2*(1.8/(1+i*.2))/(loss+.2),q=Math.max(.6,Math.min(100,Math.PI*f*decay/6.91)),w=2*Math.PI*f/rate,alpha=Math.sin(w)/(2*q),a0=1+alpha;return{b:alpha/a0,a:-2*Math.cos(w)/a0,c:(1-alpha)/a0,gain:1/Math.pow(i+1,.65),frequency:f};});}
// A bounded log-frequency curve is realised as a base gain and fifteen
// smooth high-shelf transitions. Flat curves are exact scalar gains.
function shelf(frequency,gain,rate){
 const A=Math.pow(10,gain/40),w=2*Math.PI*Math.min(rate*.45,frequency)/rate,c=Math.cos(w),sn=Math.sin(w),a=sn/Math.sqrt(2),b=2*Math.sqrt(A)*a;
 const a0=(A+1)-(A-1)*c+b;
 return [A*((A+1)+(A-1)*c+b)/a0,-2*A*((A-1)+(A+1)*c)/a0,A*((A+1)+(A-1)*c-b)/a0,2*((A-1)-(A+1)*c)/a0,((A+1)-(A-1)*c-b)/a0];
}
function curveFilters(points,rate){return points.slice(1).map((v,i)=>shelf(Math.sqrt(CURVE_FREQS[i]*CURVE_FREQS[i+1]),v-points[i],rate));}
function excitationResponse(s,frequency,rate=44100){
 const w=2*Math.PI*frequency/rate,c=Math.cos(w),sn=Math.sin(w),c2=Math.cos(2*w),sn2=Math.sin(2*w);
 if(s.excitationCurve){let gain=Math.pow(10,s.excitationCurve[0]/20);for(const [b0,b1,b2,a1,a2] of curveFilters(s.excitationCurve,rate)){const nr=b0+b1*c+b2*c2,ni=-b1*sn-b2*sn2,dr=1+a1*c+a2*c2,di=-a1*sn-a2*sn2;gain*=Math.sqrt((nr*nr+ni*ni)/(dr*dr+di*di));}return 20*Math.log10(Math.max(1e-12,gain));}
 if(s.band==='full')return 0;
 const lo=1-Math.exp(-2*Math.PI*(s.band==='bass'?260:s.band==='mid'?3200:10000)/rate),hi=1-Math.exp(-2*Math.PI*(s.band==='treble'?2200:s.band==='mid'?180:18)/rate);
 const lp=lo/Math.hypot(1-(1-lo)*c,(1-lo)*sn),hp=(1-hi)*Math.hypot(1-c,sn)/Math.hypot(1-(1-hi)*c,(1-hi)*sn);
 return 20*Math.log10(Math.max(1e-12,lp*hp));
}
function bandCurve(s,rate=44100){return s.excitationCurve?.slice()||CURVE_FREQS.map(f=>Math.max(CURVE_MIN,Math.min(0,excitationResponse(s,f,rate))));}
class Body{
 constructor(rate,s){this.rate=rate;this.s=slot(s);this.z=Array.from({length:8},()=>new Float64Array(4));this.coeffs=[];this.buffer=new Float32Array(Math.ceil(rate*16/343)+8);this.index=0;this.pos=0;this.velocity=0;this.low=0;this.high=0;this.dc=0;this.pipeLP=0;this.pipeOut=0;this.smoothDrive=0;this.smoothLevel=0;this.seed=1937;this.impacts=0;this.curveZ=Array.from({length:CURVE_SIZE-1},()=>new Float64Array(2));this.curveCoeffs=[];this.excitation=0;this.contactLP1=0;this.contactLP2=0;this.latchZ=Array.from({length:3},()=>new Float64Array(4));this.update(s,true);}
 update(s,initial=false){const previous=this.s;this.s=slot(s);this.target=modes(this.s,this.rate);if(initial||previous.object!==this.s.object){this.coeffs=this.target.map(x=>({...x}));this.clear();}this.targetDelay=Math.min(this.buffer.length-3,Math.max(2,2*this.s.length*this.rate/343));if(initial)this.delay=this.targetDelay;
 const changedCurve=JSON.stringify(previous.excitationCurve)!==JSON.stringify(this.s.excitationCurve);
 this.curveTarget=this.s.excitationCurve?curveFilters(this.s.excitationCurve,this.rate):[];
 if(initial||changedCurve){this.curveCoeffs=this.curveTarget.map(c=>c.slice());for(const z of this.curveZ)z.fill(0);}
 this.curveGain=this.s.excitationCurve?Math.pow(10,this.s.excitationCurve[0]/20):1;
 this.bandLow=1-Math.exp(-2*Math.PI*(this.s.band==='bass'?260:this.s.band==='mid'?3200:10000)/this.rate);this.bandHigh=1-Math.exp(-2*Math.PI*(this.s.band==='treble'?2200:this.s.band==='mid'?180:18)/this.rate);
 // Door collisions have finite contact duration. The hinge/latch adds a
 // short inharmonic midrange ring, rather than a broadband one-sample click.
 if(this.s.object==='door'){
  const metallic=this.s.material==='metal',size=Math.pow(.85/this.s.width,.2)*Math.pow(this.s.thickness/35,.15),base=(metallic?1250:950)*size;
  this.contactCoef=1-Math.exp(-2*Math.PI*(metallic?2000:1400)*(1-.45*this.s.damping)/this.rate);
  this.latchTarget=[1,1.73,2.61].map((ratio,i)=>{const f=Math.max(300,Math.min(this.rate*.2,base*ratio)),decay=(.012+.035*(1-this.s.damping))*(.65+.35*this.s.looseness)/(1+i*.4),r=Math.exp(-1/(this.rate*decay)),w=2*Math.PI*f/this.rate;return{a:2*r*Math.cos(w),b:-r*r,g:(1-r)*6/(i+1)};});
  if(initial||previous.object!=='door')this.latchCoeffs=this.latchTarget.map(c=>({...c}));
 }
 this.air=1-Math.exp(-2*Math.PI*Math.min(this.rate*.4,600+10000*(1-this.s.damping)/(1+this.s.diameter*4))/this.rate);this.pipeTone=1-Math.exp(-2*Math.PI*Math.min(this.rate*.4,343/(this.s.length*(this.s.ends==='closed'?4:2))*2)/this.rate);this.slew=1-Math.exp(-1/(this.rate*.02));this.targetDrive=Math.pow(10,this.s.drive/20);this.dcCoef=1-Math.exp(-2*Math.PI*12/this.rate);this.omega=2*Math.PI*Math.min(90,this.target[0].frequency*.65)/this.rate;}
 clear(){for(const z of this.z)z.fill(0);this.buffer.fill(0);this.pos=this.velocity=this.low=this.high=this.dc=this.pipeLP=this.pipeOut=0;this.impacts=0;this.excitation=0;this.contactLP1=this.contactLP2=0;for(const z of this.latchZ)z.fill(0);for(const z of this.curveZ)z.fill(0);}
 tick(input){const s=this.s,rate=this.rate,k=this.slew;
 this.smoothDrive+=(this.targetDrive-this.smoothDrive)*k;this.smoothLevel+=(s.level-this.smoothLevel)*k;
 this.low+=(input-this.low)*this.bandLow;this.high+=(this.low-this.high)*this.bandHigh;
 let band=s.band==='full'?input:this.low-this.high;
 if(s.excitationCurve){band=input*this.curveGain;for(let i=0;i<this.curveCoeffs.length;i++){const c=this.curveCoeffs[i],z=this.curveZ[i],v=c[0]*band+z[0];z[0]=c[1]*band-c[3]*v+z[1];z[1]=c[2]*band-c[4]*v;band=v;}}
 this.excitation=Number.isFinite(band)?band:0;
 const x=Math.tanh(this.excitation*this.smoothDrive);let y=0;
 if(s.object==='pipe'){
  this.delay+=(this.targetDelay-this.delay)*k;let read=this.index-this.delay;if(read<0)read+=this.buffer.length;const i=Math.floor(read),f=read-i,delayed=this.buffer[i]+(this.buffer[(i+1)%this.buffer.length]-this.buffer[i])*f;
  this.pipeLP+=(delayed-this.pipeLP)*this.air;const loss=physical[s.material][1],feedback=Math.min(.993,.97-s.damping*.32-loss*.035),reflection=s.ends==='closed'?-1:1;
  this.buffer[this.index]=Math.tanh(x*.13+this.pipeLP*feedback*reflection);this.index=(this.index+1)%this.buffer.length;this.pipeOut+=(delayed-this.pipeOut)*this.pipeTone;y=this.pipeOut*(.5+s.diameter*3);
 }else{
  const omega=this.omega;
  this.velocity+=(x-this.pos)*omega*omega-this.velocity*omega*(.12+s.damping*.8);this.pos+=this.velocity;
  let contact=0;if(s.object==='door'||s.object==='wall'){
   const gap=s.object==='door'?.012+s.gap*.012:.02+(1-s.looseness)*.2;
   if(Math.abs(this.pos)>gap){const sign=Math.sign(this.pos),speed=this.velocity;this.pos=sign*gap;this.velocity=-speed*(.12+.65*s.looseness);contact=(speed/omega)*(.3+2*s.looseness);this.impacts++;}
  }else{
   // Torn edges produce asymmetric stiffness and a moving rubbing contact.
   const edge=Math.max(0,Math.abs(this.pos)-(.12+.45*(1-s.tear)));
   this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;const grit=this.seed/2147483648-1;
   contact=(Math.tanh(x*(1+12*s.tear))-x)*s.tear*.22+Math.tanh(this.velocity/Math.max(omega,1e-6)*40)*(edge*s.tear*.45+s.rub*Math.abs(this.pos)*(.2+.15*grit));
  }
  let latch=0;if(s.object==='door'){
   this.contactLP1+=(contact-this.contactLP1)*this.contactCoef;this.contactLP2+=(this.contactLP1-this.contactLP2)*this.contactCoef;contact=this.contactLP2;
   for(let j=0;j<3;j++){const c=this.latchCoeffs[j],t=this.latchTarget[j],z=this.latchZ[j];c.a+=(t.a-c.a)*k;c.b+=(t.b-c.b)*k;c.g+=(t.g-c.g)*k;const v=c.g*(contact-z[1])+c.a*z[2]+c.b*z[3];z[1]=z[0];z[0]=contact;z[3]=z[2];z[2]=v;latch+=v;}
  }
  const excitation=x*.35+contact*3;
  for(let j=0;j<8;j++){const c=this.coeffs[j],t=this.target[j],z=this.z[j];c.b+=(t.b-c.b)*k;c.a+=(t.a-c.a)*k;c.c+=(t.c-c.c)*k;const v=c.b*(excitation-z[1])-c.a*z[2]-c.c*z[3];z[1]=z[0];z[0]=excitation;z[3]=z[2];z[2]=v;y+=v*c.gain;}
  y=y*1.9+contact*.18;if(s.object==='door')y+=latch*.75;
 }
 this.dc+=(y-this.dc)*this.dcCoef;return Math.tanh((y-this.dc)*this.smoothLevel)*.65;
 }
}
const delayMs=(s,bpm=120)=>s?.delay?.mode==='sync'?Math.min(2000,240000/Math.max(1,Number(bpm)||120)/s.delay.division):s?.delay?.ms||0;
class Engine{
 constructor(rate,settings,tempo=120){this.rate=rate;this.tempo=tempo;this.delayBuffers=null;this.delayPos=0;this.delayFrom=0;this.delayTarget=0;this.delayFade=0;this.alive=true;this.monitor=null;this.lastMonitor=null;this.monitorMix=0;this.monitorSamples=new Float32Array(128);this.settings=normalize(settings);this.outputGain=this.settings.outputLevel??1;this.bodies=this.settings.slots.map(s=>new Body(rate,s));this.update(settings);this.delayFrom=this.delayTarget;this.delayFade=1;}
 update(value){this.settings=normalize(value);this.updateDelay();if(!this.settings.enabled)this.clear();this.settings.slots.forEach((s,i)=>{this.bodies[i].update(s);if(!s.enabled||!this.settings.enabled)this.bodies[i].clear();});this.pans=this.settings.slots.map(s=>[Math.cos((s.pan+1)*Math.PI/4),Math.sin((s.pan+1)*Math.PI/4)]);}
 updateDelay(){const target=Math.round(delayMs(this.settings,this.tempo)*this.rate/1000);if(target&&!this.delayBuffers)this.delayBuffers=[new Float32Array(Math.ceil(this.rate*2)+1),new Float32Array(Math.ceil(this.rate*2)+1)];if(target!==this.delayTarget){this.delayFrom=this.delayTarget;this.delayTarget=target;this.delayFade=0;}}
 setTempo(value){this.tempo=Math.max(1,Number(value)||120);this.updateDelay();}
 clear(){for(const b of this.bodies)b.clear();for(const b of this.delayBuffers||[])b.fill(0);this.delayPos=0;}
 delayOutput(out,count){if(!this.delayBuffers)return;const length=this.delayBuffers[0].length;for(let f=0;f<count;f++){this.delayFade=Math.min(1,this.delayFade+1/(this.rate*.01));for(let c=0;c<out.length;c++){const ring=this.delayBuffers[c];if(!ring)continue;ring[this.delayPos]=out[c][f];const a=ring[(this.delayPos-this.delayFrom+length)%length],b=ring[(this.delayPos-this.delayTarget+length)%length];out[c][f]=a+(b-a)*this.delayFade;}this.delayPos=(this.delayPos+1)%length;}if(this.delayTarget===0&&this.delayFade===1){this.delayBuffers=null;this.delayPos=0;}}
 setMonitor(value){this.monitor=value&&[0,1].includes(value.slot)&&['source','graph'].includes(value.mode)?{slot:value.slot,mode:value.mode}:null;if(this.monitor)this.lastMonitor=this.monitor;}
 process(inputs,outputs){if(!this.alive)return false;const out=outputs[0]||[],count=out[0]?.length||128,monitoring=this.monitor||this.monitorMix>1e-7;if(this.monitorSamples.length<count)this.monitorSamples=new Float32Array(count);if(monitoring)this.monitorSamples.fill(0);for(const bus of outputs)for(const ch of bus)ch.fill(0);if(!this.settings.enabled)return true;
  for(let n=0;n<2;n++){const s=this.settings.slots[n];if(!s.enabled||!s.level)continue;const input=inputs[n]||[],body=this.bodies[n],pan=this.pans[n],count=out[0]?.length||128;
   for(let f=0;f<count;f++){const x=input.length>1?(input[0][f]+input[1][f])*.5:input[0]?.[f]||0;let y=body.tick(Number.isFinite(x)?x:0);if(!Number.isFinite(y)){body.clear();y=0;}if(monitoring&&this.lastMonitor?.slot===n)this.monitorSamples[f]=this.lastMonitor.mode==='source'?(Number.isFinite(x)?x:0):body.excitation;if(out[0])out[0][f]+=y*pan[0];if(out[1])out[1][f]+=y*pan[1];}
  }this.delayOutput(out,count);const target=this.settings.outputLevel??1;if(this.outputGain!==1||target!==1){const k=1-Math.exp(-1/(this.rate*.008));for(let f=0;f<count;f++){this.outputGain+=(target-this.outputGain)*k;if(Math.abs(this.outputGain-target)<1e-7)this.outputGain=target;for(const ch of out)ch[f]*=this.outputGain;}}const meter=outputs[1]||[];for(let ch=0;ch<meter.length;ch++)if(out[ch])meter[ch].set(out[ch]);
 if(monitoring){const k=1-Math.exp(-1/(this.rate*.008));for(let f=0;f<count;f++){this.monitorMix+=((this.monitor?1:0)-this.monitorMix)*k;for(const ch of out)ch[f]=ch[f]*(1-this.monitorMix)+this.monitorSamples[f]*this.monitorMix*Math.SQRT1_2;}if(!this.monitor&&this.monitorMix<1e-7)this.monitorMix=0;}return true;}
 dispose(){this.alive=false;this.bodies=[];this.delayBuffers=null;}
}
const api={SOURCES,MATERIALS,LABELS,LIMITS,objectDefaults,slot,normalize,audible,matches,estimatedBytes,delayMs,modes,CURVE_SIZE,CURVE_MIN,CURVE_FREQS,bandCurve,excitationResponse,Engine};if(typeof module==='object'&&module.exports)module.exports=api;else root.MygrainResonator=api;
})(globalThis);
