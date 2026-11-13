(function(root){
'use strict';
const Inputs=root.MygrainEffectInputs||(typeof module==='object'&&module.exports?require('./effect-inputs.js'):null);
const TODAY=new Date().getFullYear();
const defaults=()=>({version:1,enabled:false,route:'mix',rpm:33,year:1975,needle:'modern',wow:.22,flutter:.14,hum:.12,mainsHz:50,clicks:.16,crackle:.18,wear:.35,output:0});
const limits={year:[1920,TODAY],wow:[0,1],flutter:[0,1],hum:[0,1],clicks:[0,1],crackle:[0,1],wear:[0,1],output:[-18,3]};
function normalize(value){const s=defaults();if(value&&typeof value==='object'){s.mainsHz=value.mainsHz===60?60:50;s.rpm=[33,45,78].includes(value.rpm)?value.rpm:33;s.enabled=value.enabled===true;s.route=value.route==='drums'?'drums':'mix';if(Inputs.SOURCES.includes(value.input)){s.route=value.input==='drums'?'drums':'mix';if(!['all','drums'].includes(value.input))s.input=value.input;}s.needle=value.needle==='old'?'old':'modern';for(const[k,[lo,hi]]of Object.entries(limits)){const v=value[k];if(typeof v==='number'&&Number.isFinite(v))s[k]=Math.max(lo,Math.min(hi,v));}}return s;}
class Engine{
 constructor(rate,settings,seed=1931){this.rate=rate;this.settings=normalize(settings);this.seed=seed>>>0;this.index=0;this.phase=0;this.rotationOffset=null;this.humOffset=null;this.pop=0;this.dust=0;this.alive=true;this.buffers=[new Float32Array(Math.ceil(rate*.08)),new Float32Array(Math.ceil(rate*.08))];this.filters=[new Float64Array(5),new Float64Array(5)];this.current={...this.settings};}
 random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
 update(value){this.settings=normalize(value);}
 process(inputs,outputs){if(!this.alive)return false;const input=inputs[0]||[],out=outputs[0]||[],count=out[0]?.length||128,s=this.settings,rate=this.rate,slew=1-Math.exp(-1/(rate*.025)),surfaceSpeed=(s.rpm===33?100/3:s.rpm)/(100/3),popDecay=Math.exp(-surfaceSpeed/(rate*.0018)),dustDecay=Math.exp(-surfaceSpeed/(rate*.0003));
 for(let f=0;f<count;f++){
  for(const k of Object.keys(limits))this.current[k]+=(s[k]-this.current[k])*slew;
  const c=this.current,age=Math.max(0,Math.min(1,(TODAY-c.year)/(TODAY-1920))),old=s.needle==='old',cutoff=Math.min(rate*.42,18000*Math.pow(1500/18000,age)*(old?.67:1)),lp=1-Math.exp(-2*Math.PI*cutoff/rate),hp=1-Math.exp(-2*Math.PI*(18+age*110+(old?35:0))/rate);
  // Integrate rotational speed so an RPM change never resets the wow/flutter
  // cycle. Offset zero preserves the original 33-RPM waveform exactly.
  if(this.rotationOffset===null)this.rotationOffset=this.phase*(surfaceSpeed-1);
  const rotationTime=(this.phase+this.rotationOffset)/rate,drift=Math.sin(2*Math.PI*.556*rotationTime)+.22*Math.sin(2*Math.PI*.83*rotationTime),flutter=Math.sin(2*Math.PI*7.7*rotationTime)+.3*Math.sin(2*Math.PI*11.3*rotationTime);
  // Audible pitch drift, not a parallel chorus. At full scale each control
  // spans roughly a semitone or more; an 8–26ms centre keeps both reads causal.
  // Shared stereo trajectory preserves the image; the 80ms ring bounds memory.
  const excursion=rate*(.018*c.wow*drift+.0012*c.flutter*flutter),delay=rate*(.008+.018*Math.max(c.wow,c.flutter))+excursion,n=this.buffers[0].length,read=(this.index-delay+n)%n,i=Math.floor(read),mix=read-i;
  if(this.random()<c.clicks*2.6*surfaceSpeed/rate)this.pop+=(this.random()*2-1)*(.025+.12*c.clicks);
  if(this.random()<c.crackle*700*surfaceSpeed/rate)this.dust+=(this.random()*2-1)*.014*c.crackle;
  this.pop*=popDecay;this.dust*=dustDecay;
  if(this.humOffset===null)this.humOffset=this.phase*(s.mainsHz/50-1);
  const humTime=(this.phase+this.humOffset)/rate;
  const hum=(Math.sin(2*Math.PI*50*humTime)+.17*Math.sin(2*Math.PI*100*humTime))*.009*c.hum,noise=(this.random()*2-1)*.0015*c.crackle,surface=hum+this.pop+this.dust+noise,drive=1+(old?2: .35)*c.wear+age*c.wear*1.5,gain=Math.pow(10,c.output/20);
  for(let ch=0;ch<out.length;ch++){const b=this.buffers[ch%2],z=this.filters[ch%2],x=input[ch]?.[f]??input[0]?.[f]??0;b[this.index]=x;let y=b[i]+(b[(i+1)%n]-b[i])*mix;
   y=Math.tanh(y*drive)/drive;z[0]+=(y-z[0])*hp;y-=z[0];for(let k=1;k<5;k++){z[k]+=(y-z[k])*lp;y=z[k];}y=(y+surface)*gain;out[ch][f]=Number.isFinite(y)?y:0;
  }
  this.index=(this.index+1)%n;this.phase++;this.rotationOffset+=surfaceSpeed-1;this.humOffset+=s.mainsHz/50-1;
 }return true;}
 dispose(){this.alive=false;this.buffers=[];this.filters=[];}
}
const api={TODAY,defaults,normalize,Engine};if(typeof module==='object'&&module.exports)module.exports=api;else root.MygrainTurntable=api;
})(globalThis);
