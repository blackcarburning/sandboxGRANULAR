import './enemy-drone-dsp.js?v=20261122-enemy-pitch-sync-1';
class EnemyDroneProcessor extends AudioWorkletProcessor{
 constructor(options){super();this.engine=new MygrainEnemyDrone.Engine(sampleRate,options.processorOptions.state,{bpm:options.processorOptions.bpm});this.at=Math.round((options.processorOptions.time||0)*sampleRate);this.dead=false;this.port.onmessage=({data})=>{if(data.dispose){this.dead=true;this.engine=null;this.port.onmessage=null;}else {if(Number.isFinite(data.bpm))this.engine.setTempo(data.bpm);if(data.state)this.engine.update(data.state);}};}
 process(inputs,outputs){if(this.dead)return false;const [l,r]=outputs[0];if(currentFrame+l.length<=this.at)return true;this.engine.process(l,r,Math.max(0,this.at-currentFrame));return true;}
}
registerProcessor('mygrain-enemy-drone-v1',EnemyDroneProcessor);
