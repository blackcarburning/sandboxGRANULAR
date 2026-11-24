import './dsp-quality.js?v=20261115-low-power-1';
import './effect-inputs.js?v=20261122-glasshaus-1';
import './wasp-dsp.js?v=20261122-glasshaus-1';
import './wasp-master-desktop.js?v=20261111-pg-input-1';
class WaspProcessor extends AudioWorkletProcessor {
 constructor(options){super();this.quality=new MygrainDspQuality(rate=>new globalThis.MygrainWasp.Engine(rate,options.processorOptions.slots||32),sampleRate,options.processorOptions.quality);this.engine=this.quality.engine;this.engine.update(options.processorOptions.settings,options.processorOptions.keys);this.port.onmessage=({data})=>{if(data.dispose){this.quality.dispose();this.port.postMessage({disposed:true});this.port.onmessage=null;}else if(data.settings)this.engine.update(data.settings,data.keys);};}
 process(inputs,outputs){return this.quality.process(inputs,outputs,currentFrame);}
}
registerProcessor('mygrain-wasp-v1',WaspProcessor);

class WaspMasterProcessor extends AudioWorkletProcessor{
 constructor(options){super();this.quality=new MygrainDspQuality(rate=>new globalThis.MygrainWasp.MasterEngine(rate),sampleRate,options.processorOptions.quality);this.engine=this.quality.engine;this.engine.update(options.processorOptions.settings);for(const clock of options.processorOptions.clocks||[])this.engine.setClock(clock);this.port.onmessage=({data})=>{if(data.dispose){this.quality.dispose();this.port.postMessage({disposed:true});this.port.onmessage=null;}else if(data.clock)this.engine.setClock(data.clock);else if(Object.hasOwn(data,'externalTransport')){const v=data.externalTransport;this.engine.externalTransport=v?{playing:v.playing,startFrame:Math.round(v.startTime*this.quality.rate),frame:Math.floor(currentFrame/this.quality.divisor)}:null;if(v)this.engine.setClock({origin:v.startTime,bpm:this.engine.settings.playground.tempo,at:currentTime});}else if(data.settings)this.engine.update(data.settings);};}
 process(inputs,outputs){return this.quality.process(inputs,outputs,currentFrame);}
}
registerProcessor('mygrain-wasp-master-v2',WaspMasterProcessor);
