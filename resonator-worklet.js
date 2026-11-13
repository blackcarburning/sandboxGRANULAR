import './effect-inputs.js?v=20261111-fx-inputs-1';
import './resonator-dsp.js?v=20261111-fx-inputs-1';
class ResonatorProcessor extends AudioWorkletProcessor{
 constructor(options){super();this.engine=new globalThis.MygrainResonator.Engine(sampleRate,options.processorOptions?.settings,options.processorOptions?.tempo);this.port.onmessage=({data})=>{if(data.dispose){this.engine.dispose();this.port.postMessage({disposed:true});}else if(Object.hasOwn(data,'monitor'))this.engine.setMonitor(data.monitor);else if(Object.hasOwn(data,'tempo'))this.engine.setTempo(data.tempo);
    else if(data.settings)this.engine.update(data.settings);else if(data.clear)this.engine.clear();};}
 process(inputs,outputs){return this.engine.process(inputs,outputs);}
}
registerProcessor('mygrain-resonator-v1',ResonatorProcessor);
