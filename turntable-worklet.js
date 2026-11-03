import './turntable-dsp.js?v=20261103-turntable-pitch-2';
class TurntableProcessor extends AudioWorkletProcessor{
 constructor(options){super();this.engine=new globalThis.MygrainTurntable.Engine(sampleRate,options.processorOptions?.settings);this.port.onmessage=({data})=>{if(data.dispose){this.engine.dispose();this.port.postMessage({disposed:true});}else if(data.settings)this.engine.update(data.settings);};}
 process(inputs,outputs){return this.engine.process(inputs,outputs);}
}
registerProcessor('mygrain-turntable-v1',TurntableProcessor);
