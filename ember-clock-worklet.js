/* Ember 11: audio-clock pulses and optional LFO self-rate modulation. */
class EmberPulseClock extends AudioWorkletProcessor {
 static get parameterDescriptors(){return[
  {name:'frequency',defaultValue:1,minValue:-16000,maxValue:16000,automationRate:'a-rate'},
  {name:'width',defaultValue:.005,minValue:.00001,maxValue:1,automationRate:'a-rate'}
 ];}
 constructor(options){super();const o=options.processorOptions||{};this.start=o.start||0;this.origin=o.origin||0;this.initialFrequency=o.frequency||1;this.phase=null;this.dead=false;this.port.onmessage=e=>{if(e.data?.dispose)this.dead=true;};}
 process(inputs,outputs,p){if(this.dead)return false;const out=outputs[0][0],sr=sampleRate;for(let i=0;i<out.length;i++){
  const time=(currentFrame+i)/sr;if(time<this.start){out[i]=0;continue;}
  if(this.phase===null)this.phase=(((time-this.origin)*this.initialFrequency)%1+1)%1;
  const f=Math.max(-sr*.45,Math.min(sr*.45,p.frequency.length===1?p.frequency[0]:p.frequency[i])),speed=Math.abs(f),period=speed>0?1/speed:Infinity;
  const requested=p.width.length===1?p.width[0]:p.width[i],width=Math.max(1/sr,Math.min(requested,period-1/sr));
  out[i]=this.phase<speed*width?1:-1;const next=this.phase+f/sr;this.phase=next<0?next+1:next%1;
 }return true;}
}
class EmberRateLfo extends AudioWorkletProcessor {
 static get parameterDescriptors(){return[{name:'rate',defaultValue:.2,minValue:.01,maxValue:1280,automationRate:'a-rate'},{name:'depth',defaultValue:0,minValue:0,maxValue:1,automationRate:'a-rate'},{name:'wave',defaultValue:0,minValue:0,maxValue:5,automationRate:'k-rate'},{name:'inverse',defaultValue:0,minValue:0,maxValue:1,automationRate:'k-rate'}];}
 constructor(options){super();const o=options.processorOptions||{};this.start=o.start||0;this.phase=o.phase||0;this.dead=false;this.port.onmessage=e=>{const m=e.data||{};if(m.dispose)this.dead=true;};}
 process(inputs,outputs,p){if(this.dead)return false;const out=outputs[0][0],steps=[.71,-.38,.96,-.81,.17,-.58,.43,-.09];for(let i=0;i<out.length;i++){
  if((currentFrame+i)/sampleRate<this.start){out[i]=0;continue;}
  const phase=this.phase,w=['sine','triangle','sawtooth','rampDown','square','hold'][Math.round(p.wave[0])],x=w==='sine'?Math.sin(2*Math.PI*phase):w==='triangle'?1-4*Math.abs(phase-.5):w==='sawtooth'?phase*2-1:w==='rampDown'?1-phase*2:w==='square'?(phase<.5?1:-1):steps[Math.floor(phase*8)];out[i]=x;
  const base=p.rate.length===1?p.rate[0]:p.rate[i],depth=p.depth.length===1?p.depth[0]:p.depth[i],n=Math.log(base/.01)/Math.log(128000),rate=.01*128000**Math.max(0,Math.min(1,n+x*depth*(p.inverse[0]>.5?-1:1)));
  this.phase=(phase+rate/sampleRate)%1;
 }return true;}
}
registerProcessor('mygrain-ember-pulse-v1',EmberPulseClock);
registerProcessor('mygrain-ember-rate-v1',EmberRateLfo);


// Ember 13: one coherent oscillator/pulse core. Internal C feedback is delayed
// one oversampled tick, not one native render quantum. No random excitation.
class EmberCleanCore extends AudioWorkletProcessor {
 static get parameterDescriptors(){return[
  ...Array.from({length:5},(_,i)=>({name:'freq'+i,defaultValue:110,minValue:.01,maxValue:8000,automationRate:'a-rate'})),
  ...Array.from({length:6},(_,i)=>({name:'pulse'+i,defaultValue:1,minValue:.01,maxValue:2560,automationRate:'a-rate'})),
  ...Array.from({length:6},(_,i)=>({name:'width'+i,defaultValue:.005,minValue:.00001,maxValue:1,automationRate:'a-rate'})),
  ...Array.from({length:11},(_,i)=>({name:'c'+i,defaultValue:0,minValue:0,maxValue:1,automationRate:'k-rate'})),
  ...['oscDivider','pulseDivider'].map(name=>({name,defaultValue:1,minValue:1,maxValue:16,automationRate:'k-rate'})),
  {name:'wave',defaultValue:0,minValue:0,maxValue:3,automationRate:'k-rate'},
  {name:'crossDepth',defaultValue:0,minValue:0,maxValue:1,automationRate:'a-rate'}
 ];}
 constructor(options){super();const o=options.processorOptions||{};this.start=o.start||0;this.origin=o.origin||0;this.phase=new Float64Array(11);this.last=new Float64Array(11);this.sum=new Float64Array(11);this.bases=new Float64Array(11);this.widths=new Float64Array(6);this.duties=new Float64Array(6);this.dividerCycles=new Int16Array(11);this.dividerRatios=new Int16Array(11).fill(1);this.started=false;this.dead=false;this.port.onmessage=e=>{if(e.data?.dispose)this.dead=true;};}
 blep(t,d){if(d<=0)return 0;if(t<d){const x=t/d;return x+x-x*x-1;}if(t>1-d){const x=(t-1)/d;return x*x+x+x+1;}return 0;}
 value(t,d,w,duty=.5){if(w===0)return Math.sin(2*Math.PI*t);if(w===1)return 1-4*Math.abs(t-.5);if(w===2)return 2*t-1-this.blep(t,d);return (t<duty?1:-1)+this.blep(t,d)-this.blep((t-duty+1)%1,d);}
 process(inputs,outputs,p){if(this.dead)return false;const n=outputs[0][0].length,rate=sampleRate*2,flags=[];let count=0;for(let k=0;k<11;k++){flags[k]=p['c'+k][0]>.5;if(flags[k])count++;}const wave=Math.round(p.wave[0]);
  // Count signed generator cycles after FM; reversing through zero unwinds the
  // divider instead of retriggering on narrow pulses or phase-boundary chatter.
  for(let k=0;k<11;k++){const value=p[k<5?'oscDivider':'pulseDivider'][0],ratio=value===1||(value>=2&&value<=16&&value%2===0)?value:1;if(ratio!==this.dividerRatios[k]){this.dividerRatios[k]=ratio;this.dividerCycles[k]=0;}}
  for(let i=0;i<n;i++){
   const time=(currentFrame+i)/sampleRate;if(time<this.start){for(let k=0;k<11;k++)outputs[k][0][i]=0;continue;}
   for(let k=0;k<11;k++){const v=p[(k<5?'freq':'pulse')+(k<5?k:k-5)];this.bases[k]=v.length===1?v[0]:v[i];this.sum[k]=0;}
   for(let k=0;k<6;k++){const v=p['width'+k];this.widths[k]=v.length===1?v[0]:v[i];}
   if(!this.started){for(let k=0;k<11;k++)this.phase[k]=(((time-this.origin)*this.bases[k])%1+1)%1;this.started=true;}
   const depth=p.crossDepth.length===1?p.crossDepth[0]:p.crossDepth[i];
   for(let tick=0;tick<2;tick++){
    let selected=0;for(let k=0;k<11;k++)if(flags[k])selected+=this.last[k];
    for(let k=0;k<11;k++){
     const base=this.bases[k],contributors=count-(flags[k]?1:0);
     // Full-strength audio-rate through-zero FM. Power normalization avoids the
     // old 1/N collapse as more C sources are selected; a source never feeds itself.
     const relativeIndex=Math.min(k<5?1500:1800,Math.max(4,base*(k<5?18:24)));
     // Bound rare narrow-pulse peaks, not the musical depth: unbounded
     // energy compensation otherwise launches short carriers into ultrasonic FM.
     const mixture=contributors?(selected-(flags[k]?this.last[k]:0))/Math.sqrt(contributors):0;
     const cross=Math.max(-1.5,Math.min(1.5,mixture))*relativeIndex*depth;
     const input=k<5?(inputs[k]?.[0]?.[i]||0):0;
     const frequency=Math.max(-16000,Math.min(16000,base+cross+input*Math.min(900,Math.max(2,base*6))));
     const dt=Math.min(.45,Math.abs(frequency)/rate),phase=this.phase[k];
     // Width is measured against the base clock, not its instantaneous FM value:
     // avoids spurious edges/chatter when a modulated rate crosses a threshold.
     const duty=k<5?.5:Math.max(1/rate*base,Math.min(.95,1-2*base/sampleRate,this.widths[k-5]*base));
     const v=this.value(phase,dt,k<5?wave:3,duty);
     const divisor=this.dividerRatios[k];
     if(divisor===1){
      // Exact legacy bypass, including narrow-pulse C centering.
      this.sum[k]+=v*.5;
      this.last[k]=k<5?v:(v-(2*duty-1))*Math.min(4,1/Math.sqrt(Math.max(.000001,4*duty*(1-duty))));
     }else{
      const divided=this.dividerCycles[k]<divisor/2?1:-1;
      this.sum[k]+=divided*.5;this.last[k]=divided;
     }
     const next=phase+frequency/rate;
     if(divisor>1){const wraps=Math.floor(next);if(wraps)this.dividerCycles[k]=((this.dividerCycles[k]+wraps)%divisor+divisor)%divisor;}
     this.phase[k]=((next%1)+1)%1;
    }
   }
   for(let k=0;k<11;k++)outputs[k][0][i]=this.sum[k];
  }return true;
 }
}
registerProcessor('mygrain-ember-clean-v1',EmberCleanCore);

// Keep v1 available to already-loaded Ember 11 clients. New self-rate LFO spans
// three octaves per side rather than the whole 0.01–1280 Hz control range.
class EmberCleanRate extends AudioWorkletProcessor {
 static get parameterDescriptors(){return EmberRateLfo.parameterDescriptors;}
 constructor(options){super();const o=options.processorOptions||{};this.start=o.start||0;this.phase=o.phase||0;this.dead=false;this.port.onmessage=e=>{if(e.data?.dispose)this.dead=true;};}
 process(inputs,outputs,p){if(this.dead)return false;const out=outputs[0][0],steps=[.71,-.38,.96,-.81,.17,-.58,.43,-.09];for(let i=0;i<out.length;i++){
  if((currentFrame+i)/sampleRate<this.start){out[i]=0;continue;}
  const q=this.phase,w=Math.round(p.wave[0]),x=w===0?Math.sin(2*Math.PI*q):w===1?1-4*Math.abs(q-.5):w===2?q*2-1:w===3?1-q*2:w===4?(q<.5?1:-1):steps[Math.floor(q*8)];out[i]=x;
  const base=p.rate.length===1?p.rate[0]:p.rate[i],depth=p.depth.length===1?p.depth[0]:p.depth[i],hz=Math.max(.01,Math.min(1280,base*2**(x*depth*3*(p.inverse[0]>.5?-1:1))));this.phase=(q+hz/sampleRate)%1;
 }return true;}
}
registerProcessor('mygrain-ember-rate-v2',EmberCleanRate);
