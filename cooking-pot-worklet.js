/* Decompose a serial chain into its dry and per-card wet contributions.
   Y[n] = d[n]Y[n-1] + wet[n]. At unity the sum is exactly the serial output.
   Individual final-return faders therefore never remove excitation upstream. */
import './cooking-pot-model.js?v=20261111-source-isolation-1';
class CookingPotSum extends AudioWorkletProcessor {
 constructor(options){super();this.alive=true;this.configure(options.processorOptions);this.port.onmessage=({data})=>{if(data.dispose){this.alive=false;this.port.postMessage({disposed:true});}else this.configure(data);};}
 configure(data){this.returnStages=data.returnStages||null;this.order=data.order||[];this.dry=data.dry||{};this.mainDry=data.mainDry||this.dry;this.selectivePlayground=!!data.selectivePlayground;}
 returnFactor(key,inputs,frame){let gain=1;for(const next of this.returnStages[key]||[]){const dynamic=next==='wasp'?inputs[10]?.[0]:next==='playground'?inputs[11]?.[0]:null;gain*=dynamic?.length?dynamic[frame]:this.dry[next]??1;}return gain;}
 process(inputs,outputs){if(!this.alive)return false;const keys=globalThis.MygrainCookingPot.KEYS,frames=outputs[0][0].length;for(const bus of outputs)for(const ch of bus)ch.fill(0);
  for(let f=0;f<frames;f++){let suffix=1,mainSuffix=1,pgSuffix=0,pgDry=1;for(let j=this.order.length-1;j>=0;j--){const key=this.order[j],slot=keys.indexOf(key),wet=inputs[slot+1]||[],out=outputs[slot+1],returnGain=this.returnStages?this.returnFactor(key,inputs,f):suffix;for(let ch=0;ch<2;ch++)out[ch][f]=(wet[ch]?.[f]??wet[0]?.[f]??0)*returnGain;const dynamic=key==='wasp'?inputs[10]?.[0]:key==='playground'?inputs[11]?.[0]:null;if(key==='playground'&&this.selectivePlayground){pgSuffix=suffix;pgDry=dynamic?.length?dynamic[f]:this.dry[key]??1;}suffix*=dynamic?.length?dynamic[f]:this.dry[key]??1;mainSuffix*=key==='playground'&&this.selectivePlayground?1:dynamic?.length?dynamic[f]:this.mainDry[key]??1;}for(let ch=0;ch<2;ch++){const x=(inputs[0]?.[ch]?.[f]??inputs[0]?.[0]?.[f]??0)+(inputs[12]?.[ch]?.[f]??inputs[12]?.[0]?.[f]??0);const y=x*mainSuffix+(inputs[13]?.[ch]?.[f]??inputs[13]?.[0]?.[f]??0)*(pgDry-1)*pgSuffix;outputs[0][ch][f]=Number.isFinite(y)?y:0;}}
  return true;
 }
}
registerProcessor('mygrain-cooking-pot-sum-v1',CookingPotSum);

class CookingPotCarrier extends AudioWorkletProcessor {
 constructor(){super();this.alive=true;this.port.onmessage=({data})=>{if(data.dispose){this.alive=false;this.port.postMessage({disposed:true});}};}
 process(inputs,outputs){if(!this.alive)return false;const out=outputs[0],coefficient=inputs[2]?.[0];for(let ch=0;ch<out.length;ch++)for(let f=0;f<out[ch].length;f++){const full=inputs[0]?.[ch]?.[f]??inputs[0]?.[0]?.[f]??0,base=inputs[1]?.[ch]?.[f]??inputs[1]?.[0]?.[f]??0;out[ch][f]=full-base*(coefficient?.[f]??1);}return true;}
}
registerProcessor('mygrain-cooking-pot-carrier-v2',CookingPotCarrier);

class CookingPotBase extends AudioWorkletProcessor {
 constructor(){super();this.alive=true;this.selectivePlayground=false;this.port.onmessage=({data})=>{if(data.dispose){this.alive=false;this.port.postMessage({disposed:true});}else if(Object.hasOwn(data,'selectivePlayground'))this.selectivePlayground=!!data.selectivePlayground;};}
 process(inputs,outputs){if(!this.alive)return false;const out=outputs[0];for(let ch=0;ch<out.length;ch++)for(let f=0;f<out[ch].length;f++)out[ch][f]=(inputs[0]?.[ch]?.[f]??inputs[0]?.[0]?.[f]??0)*(inputs[1]?.[0]?.[f]??1)*(this.selectivePlayground?1:inputs[2]?.[0]?.[f]??1)+(this.selectivePlayground?(inputs[3]?.[ch]?.[f]??inputs[3]?.[0]?.[f]??0)*(inputs[1]?.[0]?.[f]??1)*((inputs[2]?.[0]?.[f]??1)-1):0);return true;}
}
registerProcessor('mygrain-cooking-pot-base-v2',CookingPotBase);
