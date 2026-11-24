import './mastering-dsp.js?v=20261112-master-baker-2';
import './loop-balance.js?v=20261122-restructure-balance-3';
// Observer only. The original audio routes remain untouched; output is silence.
class RandomBalanceMeter extends AudioWorkletProcessor {
 constructor(options){super();this.routes=options.processorOptions.routes;this.keys=[...new Set(this.routes.map(r=>r.family))];this.meters=Object.fromEntries(this.keys.map(k=>[k,new MygrainLoopBalance.Integrated(sampleRate)]));this.sums=new Float64Array(this.keys.length*2);this.start=Infinity;this.end=Infinity;this.finished=false;this.disposed=false;this.port.onmessage=({data})=>{if(data.dispose)this.disposed=true;if(data.arm){this.start=data.arm.start;this.end=data.arm.end;this.finished=false;this.meters=Object.fromEntries(this.keys.map(k=>[k,new MygrainLoopBalance.Integrated(sampleRate)]));}};}
 process(inputs,outputs){if(this.disposed)return false;const frames=outputs[0][0].length;
  try{for(let i=0;i<frames;i++){const frame=currentFrame+i;if(frame>=this.start&&frame<this.end){this.sums.fill(0);for(let n=0;n<this.routes.length;n++){const route=this.routes[n],input=inputs[n],offset=this.keys.indexOf(route.family)*2,l=input[0]?.[i]||0,r=input[1]?.[i]??l;this.sums[offset]+=l*route.scale;this.sums[offset+1]+=r*route.scale;}for(let k=0;k<this.keys.length;k++)this.meters[this.keys[k]].process(this.sums[k*2],this.sums[k*2+1]);}if(!this.finished&&frame>=this.end){this.finished=true;this.port.postMessage({measured:Object.fromEntries(Object.entries(this.meters).map(([k,m])=>[k,m.result()]))});}}
  }catch(error){this.disposed=true;this.port.postMessage({error:error.message});}return !this.disposed;
 }
}
registerProcessor('mygrain-random-balance-meter-v1',RandomBalanceMeter);
