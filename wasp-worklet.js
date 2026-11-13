import './effect-inputs.js?v=20261111-fx-inputs-1';
import './wasp-dsp.js?v=20261111-fx-inputs-1';
import './wasp-master-desktop.js?v=20261111-pg-input-1';
class WaspProcessor extends AudioWorkletProcessor {
 constructor(options){super();this.engine=new globalThis.MygrainWasp.Engine(sampleRate,32);this.engine.update(options.processorOptions.settings,options.processorOptions.keys);this.port.onmessage=({data})=>{if(data.dispose){this.engine.dispose();this.port.postMessage({disposed:true});this.port.onmessage=null;}else if(data.settings)this.engine.update(data.settings,data.keys);};}
 process(inputs,outputs){return this.engine.process(inputs,outputs,currentFrame);}
}
registerProcessor('mygrain-wasp-v1',WaspProcessor);

class WaspMasterProcessor extends AudioWorkletProcessor{
 constructor(options){super();this.engine=new globalThis.MygrainWasp.MasterEngine(sampleRate);this.engine.update(options.processorOptions.settings);for(const clock of options.processorOptions.clocks||[])this.engine.setClock(clock);this.port.onmessage=({data})=>{if(data.dispose){this.engine.dispose();this.port.postMessage({disposed:true});this.port.onmessage=null;}else if(data.clock)this.engine.setClock(data.clock);else if(Object.hasOwn(data,'externalTransport')){const v=data.externalTransport;this.engine.externalTransport=v?{playing:v.playing,startFrame:Math.round(v.startTime*sampleRate),frame:currentFrame}:null;if(v)this.engine.setClock({origin:v.startTime,bpm:this.engine.settings.playground.tempo,at:currentTime});}else if(data.settings)this.engine.update(data.settings);};}
 process(inputs,outputs){return this.engine.process(inputs,outputs,currentFrame);}
}
registerProcessor('mygrain-wasp-master-v2',WaspMasterProcessor);
