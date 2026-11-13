import './effect-inputs.js?v=20261111-fx-inputs-1';
import './acoustic-fx-dsp.js?v=20261112-liquid-1';
class AcousticProcessor extends AudioWorkletProcessor {
 constructor(options){super();const o=options.processorOptions;this.engine=new globalThis.MygrainAcousticFx.Engine(o.key,sampleRate,o.settings);this.port.onmessage=({data})=>{if(data.dispose){this.engine.dispose();this.port.postMessage({disposed:true});}else if(data.clear)this.engine.clear();else if(data.settings)this.engine.update(data.settings);};}
 process(inputs,outputs){return this.engine.process(inputs,outputs);}
}
registerProcessor('mygrain-acoustic-v1',AcousticProcessor);
