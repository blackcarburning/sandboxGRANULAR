/* One versioned, portable filter / stereo hall / tempo delay for every loop lane. */
(function(root){
'use strict';
const KEYS=['A','B','C','V','W','P','O','L','X','M','M+','K1','K2','K3','K4','K5','Q','N'];
const SLOPES=[12,24,36,48,96];
const clamp=(v,min,max,fallback)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):fallback;
const defaults=()=>({pan:0,filterEnabled:true,filterType:'lowpass',filterSlope:48,cutoff:18000,resonance:.707,lfoWave:'sine',lfoBeats:4,lfoDepth:0,lfoInvert:false,room:0,reverbDecay:4.5,reverbSize:.85,reverbPredelay:28,reverbDamping:6500,reverbLowcut:180,reverbWidth:1,delay:0,delayBeats:1,feedback:.25,delayCutoff:9000,pingPong:false});
function channel(value={}){
 const d=defaults(),s={...d};
 for(const[k,min,max]of[['pan',-1,1],['cutoff',20,20000],['resonance',.1,4],['lfoBeats',1/16,64],['lfoDepth',0,1],['room',0,1],['reverbDecay',.5,12],['reverbSize',0,1],['reverbPredelay',0,200],['reverbDamping',1000,18000],['reverbLowcut',20,1500],['reverbWidth',0,1],['delay',0,1],['delayBeats',1/12,6],['feedback',0,.7],['delayCutoff',200,18000]])s[k]=clamp(value[k],min,max,d[k]);
 s.reverbEnabled=value.reverbEnabled!==false;s.delayEnabled=value.delayEnabled!==false;s.filterEnabled=value.filterEnabled!==false;s.filterType=value.filterType==='highpass'?'highpass':'lowpass';s.filterSlope=SLOPES.includes(Number(value.filterSlope))?Number(value.filterSlope):d.filterSlope;
 s.lfoWave=['sine','triangle','sawtooth','ramp','square'].includes(value.lfoWave)?value.lfoWave:'sine';s.lfoInvert=value.lfoInvert===true;s.pingPong=value.pingPong===true;return s;
}
const prefix={A:'',B:'2',C:'3',V:'V',W:'W',P:'P',O:'O',L:'L',X:'X',M:'M','M+':'MPlus'};
function legacy(state,key){
 if(key==='N')return channel({filterEnabled:false});
 const m=state.modes||state,sl=state.sliders||{},sel=state.selects||{},s=defaults();
 if(key==='Q'){
  const q=state.q||{};Object.assign(s,Object.fromEntries(Object.keys(s).filter(k=>Object.hasOwn(q,k)).map(k=>[k,q[k]])));
  // Q historically had two simultaneous filters: preserve both in migration.
  s.cutoff=q.lowpass??20000;s.filterSlope=12;s.legacyHighpass=q.highpass??20;
  return {...channel(s),legacyHighpass:clamp(s.legacyHighpass,20,10000,20)};
 }
 if(key.startsWith('K')){
  const p=m.kMultitrack?.tracks?.[Number(key.slice(1))-1]?.processing||m.kMultitrack?.[Number(key.slice(1))-1]?.processing||{};
  const mode=p.filterMode||m.bastardLoopKFilterMode||'lowpass-48';const[type,slope]=mode.split('-');
  return channel({...s,filterEnabled:mode!=='bypass',filterType:type,filterSlope:slope,cutoff:p.cutoff??m.bastardLoopKFilterCutoff??18000,resonance:p.resonance,lfoWave:p.lfoWave??m.bastardLoopKFilterLfoWaveform,lfoBeats:p.lfoDivision??m.bastardLoopKFilterLfoRate,lfoDepth:p.lfoAmount??m.bastardLoopKFilterLfoAmount,lfoInvert:p.lfoInvert??m.bastardLoopKFilterLfoInvert,delay:p.delayMix??0,delayBeats:p.delayDivision??1,feedback:p.delayFeedback??.25,delayCutoff:p.delayCutoff??9000,room:p.reverbMix??0,reverbDecay:p.reverbDecay??4.5});
 }
 const p='bastardLoop'+prefix[key],id='performanceBastardLoop'+prefix[key];
 const mode=sel[id+'FilterMode']??m[p+'FilterMode']??'lowpass-48', [type,slope]=String(mode).split('-');
 Object.assign(s,{filterType:type,filterSlope:slope,cutoff:sl[id+'FilterCutoff']??m[p+'FilterCutoff']??18000,lfoWave:sel[id+'FilterLfoWaveform']??m[p+'FilterLfoWaveform'],lfoBeats:sel[id+'FilterLfoRate']??m[p+'FilterLfoRate']??4,lfoDepth:sl[id+'FilterLfoAmount']!==undefined?Number(sl[id+'FilterLfoAmount'])/100:m[p+'FilterLfoAmount']??0,lfoInvert:m[p+'FilterLfoInvert']===true,delay:sl[id+'DelayMix']!==undefined?Number(sl[id+'DelayMix'])/100:m[p+'DelayMix']??0,delayBeats:sel[id+'DelayDivision']??m[p+'DelayDivision']??1,pingPong:m[p+'DelayPingPongEnabled']===true});
 if(key==='L')Object.assign(s,{room:Number(sl[id+'ReverbMix']??0)/100,reverbSize:Number(sl[id+'ReverbSize']??45)/100,reverbDecay:.5+11.5*Number(sl[id+'ReverbDecay']??55)/100,reverbDamping:sl[id+'ReverbTone']??6400});
 if(key==='M'||key==='M+')Object.assign(s,{room:sl[id+'RoomReverbMix']!==undefined?Number(sl[id+'RoomReverbMix'])/100:m[p+'RoomReverbMix']??0,delayCutoff:sl[id+'DelayFilterCutoff']??m[p+'DelayFilterCutoff']??18000});
 if(key==='W')Object.assign(s,m.bastardLoopWEffects||{});
 return channel(s);
}
function normalize(value,state={}){
 if(value?.version!==undefined&&value.version!==1)throw Error('Unsupported loop effects version. Reload MYGRAIN.');
 return {version:1,channels:Object.fromEntries(KEYS.map(k=>{const v=value?.channels?.[k];const s=v?channel(v):legacy(state,k);if(v?.legacyHighpass!==undefined)s.legacyHighpass=clamp(v.legacyHighpass,20,10000,20);if(k==='N'){s.filterEnabled=false;s.lfoDepth=0;delete s.legacyHighpass}return[k,s]}))};
}
function convertState(original={}){
 const result=JSON.parse(JSON.stringify(original));result.modes={...result.modes};result.modes.loopFx=normalize(result.modes.loopFx??result.loopFx,result);return result;
}
function convertSnapshot(original){
 const state=convertState(original.state);const changed=JSON.stringify(original.state?.modes?.loopFx)!==JSON.stringify(state.modes.loopFx);
 return changed?{snapshot:{...original,state},changed:true}:{snapshot:original,changed:false};
}
function subtle(value,random=Math.random){
 const s=normalize(value);for(const key of KEYS){const c=s.channels[key];Object.assign(c,{delayEnabled:false,reverbEnabled:key==='V'||key==='L',pan:0,filterEnabled:true,filterType:'lowpass',filterSlope:random()<.7?12:24,cutoff:10000+random()*7000,resonance:.55+random()*.25,lfoWave:random()<.6?'sine':'triangle',lfoBeats:[8,16,32][Math.min(2,Math.floor(random()*3))],lfoDepth:.015+random()*.055,lfoInvert:random()<.5,room:random()<.35?0:.035+random()*.085,reverbDecay:2.2+random()*2,reverbSize:.6+random()*.25,reverbPredelay:18+Math.round(random()*22),reverbDamping:5000+Math.round(random()*3000),reverbLowcut:180+Math.round(random()*140),reverbWidth:.8+random()*.2,delay:random()<.55?0:.025+random()*.055,delayBeats:[.5,.75,1][Math.min(2,Math.floor(random()*3))],feedback:.12+random()*.12,delayCutoff:5000+random()*3000,pingPong:random()<.5});delete c.legacyHighpass;if(key==='N'){c.filterEnabled=false;c.lfoDepth=0}}return s;
}
// Conservative native DSP allowance, separate from source/recorded PCM. The
// second hall bank and FFT working copies can coexist during a parameter edit.
function estimatedBytes(value,sampleRate=48000){
 const state=normalize(value),sr=clamp(sampleRate,8000,192000,48000);let bytes=KEYS.length*.25*sr*8,irBytes=0;
 for(const c of Object.values(state.channels)){
  if(c.delayEnabled&&c.delay>0)bytes+=2*12*sr*4;
  if(c.reverbEnabled&&c.room>0){const pcm=Math.ceil(sr*c.reverbDecay)*8;bytes+=pcm*4;irBytes+=pcm;}
 }
 return Math.ceil(bytes+Math.min(16*1048576,irBytes));
}
// Identical deterministic stereo hall texture formerly used by Q.
const impulses=new WeakMap();
function impulse(ctx,decay,size){
 let cache=impulses.get(ctx);if(!cache){cache=new Map();impulses.set(ctx,cache)}const key=decay+':'+size+':'+(root.mygrainPower?.isLive(ctx)?'low':'normal');
 if(cache.has(key))return cache.get(key);
 const b=ctx.createBuffer(2,Math.ceil(ctx.sampleRate*decay),ctx.sampleRate);let random=19800517;
 for(let ch=0;ch<2;ch++){const a=b.getChannelData(ch);for(let i=0;i<a.length;i++){random=(Math.imul(random,1664525)+1013904223)>>>0;const t=i/ctx.sampleRate;a[i]=(random/2147483648-1)*(1-Math.exp(-t/(.008+size*.065)))*Math.exp(-6.9078*t/decay)*Math.min(1,(a.length-1-i)/(ctx.sampleRate*.02));}for(let tap=0;tap<12;tap++){const at=Math.round((.009+(tap+1)*(.003+size*.009)+ch*.0017)*ctx.sampleRate);if(at<a.length)a[at]+=(tap%2?-1:1)*.7*Math.exp(-tap/4)}}
 const result=root.mygrainPower?.processImpulse(ctx,b)||b;
 cache.set(key,result);let bytes=0;for(const x of cache.values())bytes+=x.length*8;while(bytes>16*1048576&&cache.size>1){const k=cache.keys().next().value;bytes-=cache.get(k).length*8;cache.delete(k)}return result;
}
// One cycle is phase 0..1: saw closes throughout, ramp opens throughout.
// Rotate Fourier coefficients to the shared beat phase, not oscillator creation.
function lfoCoefficients(wave,phase=0){
 const real=new Float32Array(257),imag=new Float32Array(257);
 for(let n=1;n<real.length;n++){
  let a=0,b=0;
  if(wave==='sine'){if(n===1)b=1}
  else if(wave==='triangle'){if(n%2)b=8/(Math.PI*Math.PI*n*n)*(n%4===1?1:-1)}
  else if(wave==='square'){if(n%2)b=4/(Math.PI*n)}
  else b=(wave==='ramp'?-1:1)*2/(Math.PI*n);
  const angle=2*Math.PI*n*(phase-Math.floor(phase));
  real[n]=a*Math.cos(angle)+b*Math.sin(angle);imag[n]=b*Math.cos(angle)-a*Math.sin(angle);
 }
 return {real,imag};
}
// User resonance is linear Q; native low/high-pass Biquad Q is in dB.
// Butterworth pole pairs keep the neutral corner at -3 dB for every slope.
// Apply one bounded resonance multiplier to the highest-Q pair, not every
// stage: max aggregate corner gain stays about +12 dB even at 16 poles.
function filterStageQ(resonance,stage,count){
 const stages=Math.max(1,Math.min(8,Math.round(count))),index=Math.max(0,Math.min(stages-1,Math.round(stage)));
 const neutral=1/(2*Math.cos((2*index+1)*Math.PI/(4*stages)));
 const q=neutral*(index===stages-1?clamp(resonance,.1,4,.707)/Math.SQRT1_2:1);
 return 20*Math.log10(q);
}
function createGraph(ctx,destination,initial,bpm=120,origin=0,startTime=ctx.currentTime){
 const nodes=[],own=n=>(nodes.push(n),n),gain=v=>{const n=own(ctx.createGain());n.gain.value=v;return n},biquad=type=>{const n=own(ctx.createBiquadFilter());n.type=type;n.Q.value=.707;return n};
 const input=gain(1),filtered=gain(1),output=gain(1),gate=gain(1);input.channelCount=2;input.channelCountMode='explicit';const panner=own(ctx.createStereoPanner());output.connect(panner).connect(gate).connect(destination);
 filtered.connect(output); // Parallel sends preserve the original dry amplitude.
 let lfoOrigin=Number.isFinite(origin)?origin:0,lfoStart=Number.isFinite(startTime)?startTime:ctx.currentTime,lastTempo=bpm;
 let settings=channel(initial),disposed=false,filterBranch=null,oldBranch=null,filterTimer=null,reverbTimer=null,reverbKey='',reverbPending='',activeBank=0;
 const smooth=(p,v,immediate=false)=>{if(immediate){p.cancelScheduledValues(ctx.currentTime);p.value=v}else{p.cancelScheduledValues(ctx.currentTime);p.setTargetAtTime(v,ctx.currentTime,.02)}};
 const releaseBranch=b=>{if(!b)return;try{input.disconnect(b.input)}catch{};try{b.osc?.stop()}catch{};try{b.osc?.disconnect()}catch{};for(const n of b.nodes)try{n.disconnect()}catch{}};
 // Note envelopes add cents to the same filters as the audio-clock LFO.
 // Keeping the envelope here avoids a static downstream cutoff masking it.
 let envelopeEvents=[];
 function scheduleEnvelope(parameter,event){
  const now=ctx.currentTime,start=Math.max(now,event.start),peak=event.start+event.attack;
  if(event.end<=now)return;
  if(parameter.cancelAndHoldAtTime)parameter.cancelAndHoldAtTime(start);
  else{
   parameter.cancelScheduledValues(start);
   const previous=envelopeEvents.filter(e=>e.start<event.start).at(-1);
   if(previous&&previous.end>start){
    const top=previous.start+previous.attack;
    const held=start<top?previous.cents*(start-previous.start)/previous.attack:previous.cents*(previous.end-start)/(previous.end-top);
    parameter.linearRampToValueAtTime(held,start);
   }
  }
  const value=now<=event.start?0:now<peak?event.cents*(now-event.start)/event.attack:event.cents*(event.end-now)/(event.end-peak);
  parameter.setValueAtTime(value,start);
  if(peak>start)parameter.linearRampToValueAtTime(event.cents,peak);
  parameter.linearRampToValueAtTime(0,event.end);
 }
 function triggerEnvelope(time,duration,cents=0,decayRatio=1){
  const start=Math.max(ctx.currentTime,Number(time)||0),length=Math.max(.01,Number(duration)||.1);
  const attack=Math.max(.004,Math.min(.012,length*.14));
  const decay=Math.max(attack+.03,Math.min(length,length*Math.max(.18,Number(decayRatio)||0)));
  const event={start,attack,end:start+decay,cents:Math.max(0,Math.min(9600,Number(cents)||0))};
  envelopeEvents=envelopeEvents.filter(e=>e.start<start&&e.end>ctx.currentTime).slice(-127);envelopeEvents.push(event);
  for(const f of filterBranch.filters)scheduleEnvelope(f.detune,event);
 }
 function updateLfo(b,s,tempo){
  const frequency=tempo/60/s.lfoBeats,lfoKey=[s.lfoWave,frequency,lfoOrigin].join(':');
  if(b.lfoKey!==lfoKey){
   const at=Math.max(ctx.currentTime,lfoStart),osc=ctx.createOscillator();
   const coefficients=lfoCoefficients(s.lfoWave,(at-lfoOrigin)*frequency);
   osc.setPeriodicWave(ctx.createPeriodicWave(coefficients.real,coefficients.imag,{disableNormalization:true}));
   osc.frequency.value=frequency;osc.connect(b.depth);osc.start(at);
   if(b.osc){const previous=b.osc;try{previous.stop(at)}catch{};previous.onended=()=>previous.disconnect()}
   b.osc=osc;b.lfoKey=lfoKey;
  }
 }
 function updateFilter(s,tempo,immediate){
  const effectiveSlope=root.mygrainPower?.isLive(ctx)?Math.min(24,s.filterSlope):s.filterSlope;
  const key=[s.filterEnabled,s.filterType,effectiveSlope,s.legacyHighpass||20].join(':');
  if(filterBranch?.key!==key){
   clearTimeout(filterTimer);releaseBranch(oldBranch);oldBranch=filterBranch;
   const ns=[],hold=n=>(ns.push(n),n),start=hold(ctx.createGain());let tail=start,filters=[];
   if(s.filterEnabled&&s.legacyHighpass>20){const h=hold(ctx.createBiquadFilter());h.type='highpass';h.frequency.value=s.legacyHighpass;h.Q.value=.707;tail.connect(h);tail=h}
   if(s.filterEnabled)for(let i=0;i<effectiveSlope/12;i++){const f=hold(ctx.createBiquadFilter());f.type=s.filterType;f.frequency.value=Math.min(ctx.sampleRate*.45,s.cutoff);f.Q.value=filterStageQ(s.resonance,i,effectiveSlope/12);tail.connect(f);tail=f;filters.push(f);for(const event of envelopeEvents)scheduleEnvelope(f.detune,event)}
   const wet=hold(ctx.createGain());wet.gain.value=oldBranch?0:1;tail.connect(wet).connect(filtered);input.connect(start);
   const depth=hold(ctx.createGain());depth.gain.value=0;for(const f of filters)depth.connect(f.detune);
   filterBranch={key,input:start,nodes:ns,filters,wet,osc:null,depth};
   if(oldBranch){smooth(oldBranch.wet.gain,0);smooth(wet.gain,1);filterTimer=setTimeout(()=>{releaseBranch(oldBranch);oldBranch=null},160)}
  }
  if(s.filterEnabled&&s.lfoDepth>0)updateLfo(filterBranch,s,tempo);else if(filterBranch.osc){filterBranch.osc.stop();filterBranch.osc.disconnect();filterBranch.osc=null;filterBranch.lfoKey=null;}
  const b=filterBranch;
  // Detune modulation is symmetric in octaves and remains positive at low cutoff.
  smooth(b.depth.gain,s.lfoDepth*2400*(s.lfoInvert?-1:1),immediate);
  b.filters.forEach((f,i)=>{smooth(f.frequency,Math.min(ctx.sampleRate*.45,s.cutoff),immediate);smooth(f.Q,filterStageQ(s.resonance,i,b.filters.length),immediate)});
 }
 const predelay=own(ctx.createDelay(.25)),lowcut=biquad('highpass'),damping=biquad('lowpass'),split=own(ctx.createChannelSplitter(2)),merge=own(ctx.createChannelMerger(2)),width=Array.from({length:4},()=>gain(1)),roomWet=gain(0);
 // WebKit can negotiate zero channels through the inactive convolution bank.
 // Pin the feed-forward pre-delay to stereo; otherwise its wet path is silent.
 predelay.channelCount=2;predelay.channelCountMode='explicit';
 predelay.connect(lowcut).connect(damping);
 const banks=[0,1].map(()=>{const n=own(ctx.createConvolver()),g=gain(0);damping.connect(n).connect(g).connect(split);return {node:n,gain:g}});
 [[0,0],[1,1],[0,1],[1,0]].forEach(([a,b],i)=>{split.connect(width[i],a);width[i].connect(merge,0,b)});merge.connect(roomWet);damping.disconnect();
 let ds=[],delayWet=null,delaySplit=null,delayMerge=null,hallOn=false,delayOn=false;
 function ensureDelay(){
  if(ds.length)return;
  delaySplit=own(ctx.createChannelSplitter(2));delayMerge=own(ctx.createChannelMerger(2));delayWet=gain(0);delayMerge.connect(delayWet);
  ds=[0,1].map((_,i)=>{const d=own(ctx.createDelay(12)),f=biquad('lowpass');delaySplit.connect(d,i);d.connect(f);f.connect(delayMerge,0,i);return {delay:d,filter:f,self:gain(0),cross:gain(0)}});
  ds.forEach((d,i)=>{d.self.connect(d.delay);d.cross.connect(ds[1-i].delay)});
 }
 function buildHall(immediate){
  if(!settings.reverbEnabled||!settings.room)return;const key=settings.reverbDecay+':'+settings.reverbSize+':'+(root.mygrainPower?.isLive(ctx)?'low':'normal');if(key===reverbKey){clearTimeout(reverbTimer);reverbPending='';return}if(key===reverbPending)return;
  clearTimeout(reverbTimer);reverbPending=key;const build=()=>{if(disposed||!settings.reverbEnabled||!settings.room)return;const next=reverbKey?1-activeBank:0;banks[next].node.buffer=impulse(ctx,settings.reverbDecay,settings.reverbSize);banks.forEach((b,i)=>smooth(b.gain.gain,i===next?1:0,!reverbKey));activeBank=next;reverbKey=key;reverbPending=''};
  if(immediate||!reverbKey)build();else reverbTimer=setTimeout(build,180);
 }
 function update(value,tempo=120,immediate=false){
  lastTempo=tempo;settings={...channel(value),...(value.legacyHighpass?{legacyHighpass:value.legacyHighpass}:{})};updateFilter(settings,tempo,immediate);smooth(panner.pan,settings.pan,immediate);
  const wantHall=settings.reverbEnabled&&settings.room>0,wantDelay=settings.delayEnabled&&settings.delay>0;
  if(wantHall!==hallOn){
   hallOn=wantHall;
   if(hallOn){filtered.connect(predelay);roomWet.connect(output);damping.connect(banks[0].node);damping.connect(banks[1].node);}
   else{try{filtered.disconnect(predelay)}catch{};roomWet.disconnect();damping.disconnect();clearTimeout(reverbTimer);reverbPending='';reverbKey='';for(const b of banks){b.node.buffer=null;b.gain.gain.value=0;}}
  }
  // Neither feed nor return nor feedback remains reachable when bypassed.
  if(wantDelay)ensureDelay();
  if(wantDelay!==delayOn){delayOn=wantDelay;if(delayOn){filtered.connect(delaySplit);delayWet.connect(output);ds.forEach((d,i)=>{d.filter.connect(d.self);d.filter.connect(d.cross);});}else{try{filtered.disconnect(delaySplit)}catch{};delayWet?.disconnect();for(const d of ds){try{d.filter.disconnect(d.self);d.filter.disconnect(d.cross)}catch{}}}}
  buildHall(immediate);if(delayWet)smooth(delayWet.gain,wantDelay?settings.delay*.65:0,immediate);
  for(const[p,v]of[[roomWet.gain,settings.room*.8],[predelay.delayTime,settings.reverbPredelay/1000],[lowcut.frequency,settings.reverbLowcut],[damping.frequency,Math.min(ctx.sampleRate*.45,settings.reverbDamping)],...width.map((g,i)=>[g.gain,.5*(1+(i<2?1:-1)*settings.reverbWidth)])])smooth(p,v,immediate);
  for(const d of ds){smooth(d.delay.delayTime,Math.min(11,60/tempo*settings.delayBeats),immediate);smooth(d.filter.frequency,Math.min(ctx.sampleRate*.45,settings.delayCutoff),immediate);smooth(d.self.gain,settings.pingPong?0:settings.feedback,immediate);smooth(d.cross.gain,settings.pingPong?settings.feedback:0,immediate)}
 }
 function syncClock(origin,tempo=lastTempo,at=ctx.currentTime){
  if(disposed)return;lfoOrigin=Number.isFinite(origin)?origin:0;lfoStart=Number.isFinite(at)?at:ctx.currentTime;if(settings.filterEnabled&&settings.lfoDepth>0)updateLfo(filterBranch,settings,tempo);lastTempo=tempo;
 }
 update(initial,bpm,true);
 return {context:ctx,input,output,gate,panner,nodes,banks,update,syncClock,triggerEnvelope,get filters(){return filterBranch.filters},get lfo(){return filterBranch.osc},get lfoOutput(){return filterBranch.depth},setAudible(on){smooth(gate.gain,on?1:0)},dispose(){if(disposed)return;disposed=true;clearTimeout(filterTimer);clearTimeout(reverbTimer);releaseBranch(filterBranch);releaseBranch(oldBranch);for(const n of nodes){try{n.disconnect()}catch{};if('buffer'in n)n.buffer=null}},diagnostics(){return{hallOn,delayOn,filterOn:settings.filterEnabled,lfoOn:!!filterBranch.osc}},get settings(){return settings}};
}
const api={releaseImpulseCache(ctx){impulses.delete(ctx)},KEYS,SLOPES,defaults,channel,normalize,convertState,convertSnapshot,subtle,estimatedBytes,impulse,lfoCoefficients,filterStageQ,createGraph};
if(typeof module==='object'&&module.exports)module.exports=api;else root.MygrainLoopFx=Object.freeze(api);
})(typeof window==='object'?window:globalThis);
