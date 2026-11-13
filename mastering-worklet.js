import './mastering-dsp.js?v=20261112-master-baker-2';
class LiveMaster extends AudioWorkletProcessor{
 constructor(options){super();this.dsp=new globalThis.MygrainMasterDSP.Processor(sampleRate,options.processorOptions.settings);this.loudness=new MygrainMasterDSP.OutputLoudness(sampleRate);this.metering=true;this.vuMetering=true;this.vuL=0;this.vuR=0;this.meterSum=0;this.vuAlpha=1-Math.exp(-1/(sampleRate*.3));this.bypass=false;this.match=false;this.mix=1;this.matchGain=1;this.count=0;this.inputSum=0;this.outputSum=0;this.peak=0;this.gr=0;this.bgr=0;this.mb=new Float32Array(3);this.disposed=false;this.port.onmessage=e=>{if(e.data.dispose){this.disposed=true;return;}if(e.data.settings)this.dsp.configure(e.data.settings);if('vuMetering'in e.data)this.vuMetering=!!e.data.vuMetering;if('bypass'in e.data)this.bypass=e.data.bypass;if('match'in e.data)this.match=e.data.match;if('metering'in e.data){const was=this.metering;this.metering=!!e.data.metering;if(this.metering&&!was){this.loudness=new MygrainMasterDSP.OutputLoudness(sampleRate);this.count=0;this.peak=0;this.gr=0;this.bgr=0;this.vuL=0;this.vuR=0;this.meterSum=0;this.mb.fill(0);}}};}
 process(inputs,outputs){if(this.disposed)return false;const input=inputs[0],out=outputs[0];if(!out[0])return true;for(let i=0;i<out[0].length;i++){
  this.dsp.process(input[0]?.[i]||0,input[1]?.[i]??input[0]?.[i]??0);const p=this.dsp;

  this.mix+=((this.bypass?0:1)-this.mix)*.005;
  const desired=this.match?Math.min(1,Math.sqrt((this.inputSum+1e-12)/(this.outputSum+1e-12))):1;this.matchGain+=(desired-this.matchGain)*.0001;
  out[0][i]=p.dryL*(1-this.mix)+p.outL*this.mix*this.matchGain;out[1][i]=p.dryR*(1-this.mix)+p.outR*this.mix*this.matchGain;
  this.inputSum=this.inputSum*.99998+(p.dryL*p.dryL+p.dryR*p.dryR)*.00001;this.outputSum=this.outputSum*.99998+(p.outL*p.outL+p.outR*p.outR)*.00001;
  if(this.metering){const ml=out[0][i],mr=out[1][i];this.loudness.process(ml,mr);this.meterSum=this.meterSum*.99998+(ml*ml+mr*mr)*.00001;if(this.vuMetering){this.vuL+=(ml*ml-this.vuL)*this.vuAlpha;this.vuR+=(mr*mr-this.vuR)*this.vuAlpha;}this.peak=Math.max(this.peak,Math.abs(ml),Math.abs(mr));this.gr=Math.max(this.gr,p.reduction);this.bgr=Math.max(this.bgr,p.bassReduction);for(let b=0;b<3;b++)this.mb[b]=Math.max(this.mb[b],p.bandReduction[b]);
  if(++this.count>=sampleRate/5){this.port.postMessage({vuL:MygrainMasterDSP.db(Math.sqrt(this.vuL)),vuR:MygrainMasterDSP.db(Math.sqrt(this.vuR)),maximiserGain:this.dsp.maxGainDb,lufsMomentary:this.loudness.momentary,lufsShortTerm:this.loudness.shortTerm,peak:MygrainMasterDSP.db(this.peak),reduction:this.gr,bassReduction:this.bgr,bands:Array.from(this.mb),rms:MygrainMasterDSP.db(Math.sqrt(this.meterSum))});this.count=0;this.peak=0;this.gr=0;this.bgr=0;this.mb.fill(0);}}
 }return true;}
}
registerProcessor('mygrain-live-master',LiveMaster);
