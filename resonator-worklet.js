import './dsp-quality.js?v=20261115-low-power-1';
import './effect-inputs.js?v=20261122-glasshaus-1';
import './resonator-dsp.js?v=20261111-fx-inputs-1';
class ResonatorProcessor extends AudioWorkletProcessor{
 constructor(options){super();this.quality=new MygrainDspQuality(rate=>new globalThis.MygrainResonator.Engine(rate,options.processorOptions?.settings,options.processorOptions?.tempo),sampleRate,options.processorOptions?.quality);this.engine=this.quality.engine;this.port.onmessage=({data})=>{if(data.dispose){this.quality.dispose();this.port.postMessage({disposed:true});}else if(Object.hasOwn(data,'monitor'))this.engine.setMonitor(data.monitor);else if(Object.hasOwn(data,'tempo'))this.engine.setTempo(data.tempo);
    else if(data.settings)this.engine.update(data.settings);else if(data.clear)this.quality.clear();};}
 process(inputs,outputs){return this.quality.process(inputs,outputs,currentFrame);}
}
registerProcessor('mygrain-resonator-v1',ResonatorProcessor);
