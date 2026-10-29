(function(root){'use strict';const normalize=root.MygrainWasp.normalize,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
class MasterEngine{
 constructor(rate){this.rate=rate;this.alive=true;this.mix=0;this.drive=1;this.melt=0;this.level=1;this.filterMix=0;this.filterState=null;this.phase=0;this.envelope=0;this.filterCutoff=1200;this.update(normalize());}
 update(value){this.settings=normalize(value);this.targetDrive=1+7*this.settings.melt*this.settings.melt;this.targetLevel=10**(this.settings.output/20);if(this.settings.filter.enabled&&!this.filterState)this.filterState=Array.from({length:2},()=>Array.from({length:8},()=>new Float64Array(2)));}
 // Topology-preserving state-variable sections: bounded resonance, no feedback graph.
 section(x,state,g,k,mode){const a=1/(1+g*(g+k)),v1=a*(state[0]+g*(x-state[1])),v2=state[1]+g*v1;state[0]=clamp(2*v1-state[0],-32,32);state[1]=clamp(2*v2-state[1],-32,32);return mode==='lowpass'?v2:mode==='highpass'?x-k*v1-v2:mode==='bandpass'?k*v1:x-k*v1;}
 filterFrame(input,f,slew){const cfg=this.settings.filter;this.filterMix+=clamp((cfg.enabled?1:0)-this.filterMix,-1/(this.rate*.015),1/(this.rate*.015));if(!cfg.enabled&&this.filterMix===0){this.filterState=null;return;}this.filterCutoff+=(cfg.cutoff-this.filterCutoff)*slew;this.filterG=Math.tan(Math.PI*Math.min(this.filterCutoff,this.rate*.42)/this.rate);}

 process(inputs,outputs){if(!this.alive)return false;const input=inputs[0]||[],output=outputs[0]||[],frames=output[0]?.length||128,s=this.settings,step=1/(this.rate*.015),slew=1-Math.exp(-1/(this.rate*.008));
  for(let f=0;f<frames;f++){if(s.filter.enabled||this.filterState)this.filterFrame(input,f,slew);this.mix+=clamp(s.blend-this.mix,-step,step);this.drive+=(this.targetDrive-this.drive)*slew;this.melt+=(s.melt-this.melt)*slew;this.level+=(this.targetLevel-this.level)*slew;
   for(let ch=0;ch<output.length;ch++){const x=input[ch]?.[f]??input[0]?.[f]??0,drive=this.drive;let wet=x;
    // Unity small-signal gain: Melt adds harmonics, never automatic makeup gain.
    wet=x+(Math.tanh(x*drive)/drive-x)*this.melt;
    if(this.filterState&&this.filterMix>0){const mode=s.filter.mode==='highpass'?'highpass':'lowpass';const states=this.filterState[ch]||this.filterState[0];let filtered=wet;for(let i=0;i<s.filter.slope/12;i++)filtered=this.section(filtered,states[i],this.filterG,Math.SQRT2,mode);wet+=(filtered-wet)*this.filterMix;}
    wet*=this.level;let y=x+(wet-x)*this.mix;
    // Protect the combined dry + wet signal, not merely the wet branch.
    // Exactly zero Blend remains transparent, including legacy hot input.
    const a=Math.abs(y);if(this.mix>0&&a>.891)y=Math.sign(y)*(.891+.108*Math.tanh((a-.891)/.108));
    output[ch][f]=Number.isFinite(y)?y:0;
   }
  }return true;
 }
 dispose(){this.alive=false;this.filterState=null;}
}
root.MygrainWasp.MasterEngine=MasterEngine;})(globalThis);
