import './mastering-dsp.js?v=20261031-live-master-1';
class LiveMaster extends AudioWorkletProcessor{
 constructor(options){super();this.dsp=new globalThis.MygrainMasterDSP.Processor(sampleRate,options.processorOptions.settings);this.bypass=false;this.match=false;this.mix=1;this.matchGain=1;this.count=0;this.inputSum=0;this.outputSum=0;this.peak=0;this.gr=0;this.bgr=0;this.port.onmessage=e=>{if(e.data.settings)this.dsp.configure(e.data.settings);if('bypass'in e.data)this.bypass=e.data.bypass;if('match'in e.data)this.match=e.data.match;};}
 process(inputs,outputs){const input=inputs[0],out=outputs[0];if(!out[0])return true;for(let i=0;i<out[0].length;i++){
  this.dsp.process(input[0]?.[i]||0,input[1]?.[i]??input[0]?.[i]??0);const p=this.dsp;
  this.mix+=((this.bypass?0:1)-this.mix)*.005;
  const desired=this.match?Math.min(1,Math.sqrt((this.inputSum+1e-12)/(this.outputSum+1e-12))):1;this.matchGain+=(desired-this.matchGain)*.0001;
  out[0][i]=p.dryL*(1-this.mix)+p.outL*this.mix*this.matchGain;out[1][i]=p.dryR*(1-this.mix)+p.outR*this.mix*this.matchGain;
  this.inputSum=this.inputSum*.99998+(p.dryL*p.dryL+p.dryR*p.dryR)*.00001;this.outputSum=this.outputSum*.99998+(p.outL*p.outL+p.outR*p.outR)*.00001;
  this.peak=Math.max(this.peak,Math.abs(out[0][i]),Math.abs(out[1][i]));this.gr=Math.max(this.gr,p.reduction);this.bgr=Math.max(this.bgr,p.bassReduction);
  if(++this.count>=sampleRate/5){this.port.postMessage({peak:MygrainMasterDSP.db(this.peak),reduction:this.gr,bassReduction:this.bgr,rms:MygrainMasterDSP.db(Math.sqrt(this.outputSum))});this.count=0;this.peak=0;this.gr=0;this.bgr=0;}
 }return true;}
}
registerProcessor('mygrain-live-master',LiveMaster);
