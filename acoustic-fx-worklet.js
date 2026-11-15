import './dsp-quality.js?v=20261115-low-power-1';
import './effect-inputs.js?v=20261114-liquidizer-1';
import './henrys-hose-dsp.js?v=20261113-hose-doppler-2';
import './heavy-lifter-dsp.js?v=20261114-heavy-lfo-3';
import './effect-lfo.js?v=20261114-liquidizer-1';
import './acoustic-fx-dsp.js?v=20261114-liquidizer-1';
class AcousticProcessor extends AudioWorkletProcessor {
 constructor(options){super();const o=options.processorOptions;this.quality=new MygrainDspQuality(rate=>new globalThis.MygrainAcousticFx.Engine(o.key,rate,o.settings),sampleRate,o.quality);this.engine=this.quality.engine;for(const c of o.clocks||[])this.engine.syncClock(c);this.port.onmessage=({data})=>{if(data.clock)this.engine.syncClock(data.clock);if(data.dispose){this.quality.dispose();this.port.postMessage({disposed:true});}else if(data.clear)this.quality.clear();else if(data.settings)this.engine.update(data.settings);};}
 process(inputs,outputs){return this.quality.process(inputs,outputs,currentFrame);}
}
registerProcessor('mygrain-acoustic-v1',AcousticProcessor);
