import './wasp-dsp.js?v=20261027-wet-1';
import './wasp-master-desktop.js?v=20261026-poles-1';
class WaspProcessor extends AudioWorkletProcessor {
 constructor(options){super();this.engine=new globalThis.MygrainWasp.Engine(sampleRate,32);this.engine.update(options.processorOptions.settings,options.processorOptions.keys);this.port.onmessage=({data})=>{if(data.dispose){this.engine.dispose();this.port.postMessage({disposed:true});this.port.onmessage=null;}else if(data.settings)this.engine.update(data.settings,data.keys);};}
 process(inputs,outputs){return this.engine.process(inputs,outputs);}
}
registerProcessor('mygrain-wasp-v1',WaspProcessor);

class WaspMasterProcessor extends AudioWorkletProcessor{
 constructor(options){super();this.engine=new globalThis.MygrainWasp.MasterEngine(sampleRate);this.engine.update(options.processorOptions.settings);this.port.onmessage=({data})=>{if(data.dispose){this.engine.dispose();this.port.postMessage({disposed:true});this.port.onmessage=null;}else if(data.settings)this.engine.update(data.settings);};}
 process(inputs,outputs){return this.engine.process(inputs,outputs);}
}
registerProcessor('mygrain-wasp-master-v2',WaspMasterProcessor);
