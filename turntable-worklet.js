import './turntable-dsp.js?v=20261104-turntable-drums-1';
class TurntableProcessor extends AudioWorkletProcessor{
 constructor(options){super();this.engine=new globalThis.MygrainTurntable.Engine(sampleRate,options.processorOptions?.settings);if(options.processorOptions?.clockAligned)this.engine.phase=currentFrame;this.port.onmessage=({data})=>{if(data.dispose){this.engine.dispose();this.port.postMessage({disposed:true});}else if(data.settings)this.engine.update(data.settings);};}
 process(inputs,outputs){return this.engine.process(inputs,outputs);}
}
registerProcessor('mygrain-turntable-v1',TurntableProcessor);
