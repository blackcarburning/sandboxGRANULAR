import './dsp-quality.js?v=20261115-low-power-1';
import './effect-inputs.js?v=20261122-glasshaus-1';
import './turntable-dsp.js?v=20261111-fx-inputs-1';
class TurntableProcessor extends AudioWorkletProcessor{
 constructor(options){super();this.quality=new MygrainDspQuality(rate=>new globalThis.MygrainTurntable.Engine(rate,options.processorOptions?.settings),sampleRate,options.processorOptions?.quality);this.engine=this.quality.engine;if(options.processorOptions?.clockAligned)this.engine.phase=Math.floor(currentFrame/this.quality.divisor);this.port.onmessage=({data})=>{if(data.dispose){this.quality.dispose();this.port.postMessage({disposed:true});}else if(data.settings)this.engine.update(data.settings);};}
 process(inputs,outputs){return this.quality.process(inputs,outputs,currentFrame);}
}
registerProcessor('mygrain-turntable-v1',TurntableProcessor);
