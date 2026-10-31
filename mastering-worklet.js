import './mastering-dsp.js?v=20261031-live-master-2';
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
class LiveMaster extends AudioWorkletProcessor{
 constructor(options){super();this.dsp=new globalThis.MygrainMasterDSP.Processor(sampleRate,options.processorOptions.settings);this.loudness=new OutputLoudness();this.bypass=false;this.match=false;this.mix=1;this.matchGain=1;this.count=0;this.inputSum=0;this.outputSum=0;this.peak=0;this.gr=0;this.bgr=0;this.mb=new Float32Array(3);this.port.onmessage=e=>{if(e.data.settings)this.dsp.configure(e.data.settings);if('bypass'in e.data)this.bypass=e.data.bypass;if('match'in e.data)this.match=e.data.match;};}
 process(inputs,outputs){const input=inputs[0],out=outputs[0];if(!out[0])return true;for(let i=0;i<out[0].length;i++){
  this.dsp.process(input[0]?.[i]||0,input[1]?.[i]??input[0]?.[i]??0);const p=this.dsp;
  this.loudness.process(p.outL,p.outR);
  this.mix+=((this.bypass?0:1)-this.mix)*.005;
  const desired=this.match?Math.min(1,Math.sqrt((this.inputSum+1e-12)/(this.outputSum+1e-12))):1;this.matchGain+=(desired-this.matchGain)*.0001;
  out[0][i]=p.dryL*(1-this.mix)+p.outL*this.mix*this.matchGain;out[1][i]=p.dryR*(1-this.mix)+p.outR*this.mix*this.matchGain;
  this.inputSum=this.inputSum*.99998+(p.dryL*p.dryL+p.dryR*p.dryR)*.00001;this.outputSum=this.outputSum*.99998+(p.outL*p.outL+p.outR*p.outR)*.00001;
  this.peak=Math.max(this.peak,Math.abs(out[0][i]),Math.abs(out[1][i]));this.gr=Math.max(this.gr,p.reduction);this.bgr=Math.max(this.bgr,p.bassReduction);for(let b=0;b<3;b++)this.mb[b]=Math.max(this.mb[b],p.bandReduction[b]);
  if(++this.count>=sampleRate/5){this.port.postMessage({lufsMomentary:this.loudness.momentary,lufsShortTerm:this.loudness.shortTerm,peak:MygrainMasterDSP.db(this.peak),reduction:this.gr,bassReduction:this.bgr,bands:Array.from(this.mb),rms:MygrainMasterDSP.db(Math.sqrt(this.outputSum))});this.count=0;this.peak=0;this.gr=0;this.bgr=0;this.mb.fill(0);}
 }return true;}
}
registerProcessor('mygrain-live-master',LiveMaster);
