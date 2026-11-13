/* Mutilator: sparse additive controls preserve original sound and clock defaults. */
(function(root){'use strict';
const Inputs=root.MygrainEffectInputs||(typeof module==='object'&&module.exports?require('./effect-inputs.js'):null);
const strains=['gnaw','melt','rupture','scab','venom','hollow','splinter','diode','cinder','shred','vortex','maw'];
const bounded=(value,fallback)=>Number.isFinite(Number(value))?Math.max(0,Math.min(1,Number(value))):fallback;
const EXT=Object.freeze({filter:'auto',resonance:.5,sweep:1,cycleBeats:4,freeRate:1,freeDepth:0,output:0});
const FILTERS=Object.freeze(['auto','lowpass','bandpass','highpass','notch']);
const CYCLES=Object.freeze([.5,1,2,4,8]);
function extensions(v={}){const out={};for(const [k,fallback]of Object.entries(EXT)){let n=v[k];if(k==='filter')n=FILTERS.includes(n)?n:fallback;else if(k==='cycleBeats')n=CYCLES.includes(Number(n))?Number(n):fallback;else{n=n===undefined||n===null||!Number.isFinite(Number(n))?fallback:Number(n);const lo=k==='output'?-18:k==='freeRate'?.125:0,hi=k==='output'?6:k==='freeRate'?12:1;n=Math.max(lo,Math.min(hi,n));}if(n!==fallback)out[k]=n;}return out;}
function audibleControls(value={}){const v=normalizeMutilator(value),e=extensions(v),out={};for(const k of ['filter','resonance','output'])if(k in e)out[k]=e[k];if(v.rhythm){for(const k of ['sweep','cycleBeats'])if(k in e)out[k]=e[k];}else if((v.freeDepth||0)>0){for(const k of ['sweep','freeRate','freeDepth'])if(k in e)out[k]=e[k];}return out;}
function normalizeMutilator(value={}){const v=value&&typeof value==='object'?value:{};return {enabled:v.enabled===true,rhythm:v.rhythm===true,strain:strains.includes(v.strain)?v.strain:'gnaw',amount:bounded(v.amount,.5),tone:bounded(v.tone,.5),mix:bounded(v.mix,.5),...extensions(v),...(v.input&&v.input!=='D'&&Inputs.SOURCES.includes(v.input)?{input:v.input}:{})};}
// One bar at 120 BPM, replayed at BPM/120 by the audio engine (not a UI timer).
// 64 KiB per active voice, independent of song duration. No clock work when bypassed.
const mutilatorPatterns=Object.freeze({
 gnaw:    [1,0,.35,0, 0,.8,0,.45, 1,0,0,.65, 0,.85,0,.4],
 melt:    [1,0,0,.65, 0,0,.9,0, 0,.7,0,0, 1,0,.5,0],
 rupture: [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,.7,.4],
 scab:    [1,.3,0,.65, 0,.9,.3,0, .8,0,.4,.7, 0,.9,0,.5],
 venom:   [1,0,.5,0, 0,.95,0,.3, .8,0,0,.65, 0,.95,.3,0],
 hollow:  [1,0,0,0, 0,0,.85,0, 0,0,0,.7, 0,0,.9,0],
 splinter:[1,0,.65,.3, 0,.8,0,.6, 1,.35,0,.85, 0,.65,.3,.8],
 diode:[1,0,.4,0, .7,0,0,.8, 0,1,0,.3, .8,0,.5,0],
 cinder:[1,0,0,.7, 0,.4,1,0, .5,0,.8,0, 0,.9,0,.6],
 shred:[1,.2,.8,0, .4,1,0,.7, 1,0,.6,.3, 0,.8,.2,1],
 vortex:[1,0,0,.4, 0,.8,0,0, .7,0,.5,0, 0,1,0,.6],
 maw:[1,0,.3,0, 0,0,.9,0, 1,0,0,.6, 0,.7,0,0]
});
function mutilatorGraph(ctx,source,destination,clock={}){
 let nodes=null;
 let bpm=Number.isFinite(clock.bpm)&&clock.bpm>0?clock.bpm:120;
 let startTime=Number.isFinite(clock.time)?clock.time:ctx.currentTime;
 let origin=Number.isFinite(clock.origin)?clock.origin:startTime;
 const stopClock=()=>{if(!nodes?.pulse)return;try{nodes.pulse.stop()}catch{}nodes.pulse.disconnect();nodes.pulse=null;};
 const disconnect=()=>{if(nodes){stopClock();for(const n of [nodes.depth,nodes.dry,nodes.filter,nodes.shaper,nodes.dc,nodes.wet,nodes.trim]){try{source.disconnect(n)}catch{}try{n.disconnect()}catch{}}nodes=null;}try{source.disconnect(destination)}catch{}};
 const syncClock=(strain,cycleBeats=4)=>{
  const key='sync:'+strain+':'+cycleBeats+':'+bpm+':'+origin;if(nodes.pulse&&nodes.motionKey===key)return;
  stopClock();
  const buffer=ctx.createBuffer(1,16384,8192),data=buffer.getChannelData(0),pattern=mutilatorPatterns[strain];
  // Small continuous attacks/releases remove clicks without moving triggers off the grid.
  // Each strain has its own accents and envelope; rests close the filter between hits.
  const envelope=phase=>strain==='melt'?Math.sin(Math.PI*phase):strain==='scab'?Math.floor((1-phase)*4)/4:Math.pow(1-phase,strain==='hollow'?1.15:strain==='venom'?2:3);
  for(let i=0;i<data.length;i++){
   const cell=i/1024,index=Math.floor(cell),phase=cell-index,attack=Math.min(1,phase/.016),release=Math.min(1,(1-phase)/.025);
   data[i]=-1+2*pattern[index]*attack*envelope(phase)*release;
  }
  const pulse=ctx.createBufferSource();pulse.buffer=buffer;pulse.loop=true;pulse.playbackRate.value=cycleBeats===4?bpm/120:bpm/120*4/cycleBeats;
  const time=Math.max(ctx.currentTime,startTime),offset=cycleBeats===4?(((time-origin)*bpm/120)%2+2)%2:(((time-origin)*bpm/120*4/cycleBeats)%2+2)%2;
  pulse.connect(nodes.depth);nodes.pulse=pulse;nodes.strain=strain;nodes.motionKey=key;
  // Replacing a strain or enabling midway resumes the same bar, never phase zero.
  nodes.clock={bpm,origin,time,offset,barSeconds:60*cycleBeats/bpm,strain,cycleBeats};pulse.start(time,offset);
 };
 const freeClock=hz=>{
  const key='free:'+hz;if(nodes.pulse&&nodes.motionKey===key)return;stopClock();
  const buffer=ctx.createBuffer(1,16384,8192),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.sin(2*Math.PI*i/data.length);
  const pulse=ctx.createBufferSource();pulse.buffer=buffer;pulse.loop=true;pulse.playbackRate.value=2*hz;
  const time=Math.max(ctx.currentTime,startTime),offset=(((time-origin)*2*hz)%2+2)%2;
  pulse.connect(nodes.depth);nodes.pulse=pulse;nodes.motionKey=key;nodes.clock={mode:'free',hz,origin,time,offset,periodSeconds:1/hz};pulse.start(time,offset);
 };
 const set=value=>{const v=normalizeMutilator(root.mygrainCookingPot?.active()&&!clock.pot?{...value,enabled:false}:value),snapshot=clock.snapshot?.();if(snapshot){bpm=snapshot.bpm;origin=snapshot.origin;startTime=snapshot.at;}const now=Math.max(ctx.currentTime,startTime);
if(!v.enabled||v.mix<=0||v.amount<=0){disconnect();source.connect(destination);return;}
  if(!nodes){disconnect();const dry=ctx.createGain(),filter=ctx.createBiquadFilter(),shaper=ctx.createWaveShaper(),dc=ctx.createBiquadFilter(),wet=ctx.createGain(),depth=ctx.createGain(),trim=ctx.createGain();trim.gain.value=10**((v.output||0)/20);nodes={dry,filter,shaper,dc,wet,depth,trim};source.connect(dry);dry.connect(destination);source.connect(filter);filter.connect(shaper);shaper.connect(dc);dc.connect(wet);wet.connect(trim);trim.connect(clock.wetDestination||destination);dc.type='highpass';dc.frequency.value=25;dc.Q.value=.5;shaper.oversample=clock.oversample||'2x';depth.connect(filter.detune);}
  const {dry,filter,shaper,wet,trim}=nodes,curve=new Float32Array(2049),drive=1+v.amount*45;
  for(let i=0;i<curve.length;i++){const x=(i/(curve.length-1)*2-1)*drive;if(v.strain==='melt')curve[i]=Math.sin(x);
   else if(v.strain==='rupture')curve[i]=Math.round(Math.tanh(x+Math.sin(x*1.7)*.6)*7)/7;
   else if(v.strain==='scab'){const steps=3+Math.round((1-v.amount)*21);curve[i]=Math.round(Math.max(-1,Math.min(1,x))*steps)/steps;}
   else if(v.strain==='venom')curve[i]=.7*(Math.tanh(x+.65)-Math.tanh(.65));
   else if(v.strain==='hollow')curve[i]=Math.abs(Math.tanh(x));
   else if(v.strain==='splinter')curve[i]=2/Math.PI*Math.asin(Math.sin(x));
   else if(v.strain==='diode')curve[i]=x>=0?Math.tanh(x):.22*Math.tanh(2*x);
   else if(v.strain==='cinder')curve[i]=Math.tanh(x)*(.6+.4*Math.cos(x*2));
   else if(v.strain==='shred')curve[i]=Math.max(-1,Math.min(1,Math.sin(x*1.3)+.35*Math.sin(x*4.1)));
   else if(v.strain==='vortex')curve[i]=Math.tanh(x)*Math.cos(x*.7);
   else if(v.strain==='maw')curve[i]=Math.sign(x)*Math.tanh(Math.max(0,Math.abs(x)-.45));
   else curve[i]=Math.tanh(x);}
  shaper.curve=curve;filter.type=v.filter&&v.filter!=='auto'?v.filter:['melt','splinter','shred'].includes(v.strain)?'bandpass':['rupture','hollow','maw'].includes(v.strain)?'highpass':v.strain==='vortex'?'notch':'lowpass';
  filter.frequency.setTargetAtTime(Math.min(ctx.sampleRate*.42,120*Math.pow(100,v.tone)),now,.015);const originalQ=v.strain==='melt'?1+v.amount*4:.7+v.amount;filter.Q.setTargetAtTime(v.resonance===undefined?originalQ:Math.min(16,originalQ*2**((v.resonance-.5)*4)),now,.015);
  dry.gain.setTargetAtTime(1-v.mix,now,.01);wet.gain.setTargetAtTime(v.mix*.5,now,.01);trim.gain.setTargetAtTime(10**((v.output||0)/20),now,.01);
  // Resonant cutoff motion is in octaves. High-pass strains invert it so every accent opens.
  const sweep=v.sweep??1;
  const originalDepth=(['rupture','hollow'].includes(v.strain)?-1:1)*(1500+v.amount*3300);nodes.depth.gain.setTargetAtTime(v.rhythm?(v.sweep===undefined?originalDepth:originalDepth*sweep):3600*(v.freeDepth||0)*sweep,now,.005);
  if(v.rhythm&&sweep>0)syncClock(v.strain,v.cycleBeats||4);else if(!v.rhythm&&(v.freeDepth||0)>0&&sweep>0)freeClock(v.freeRate||1);else{stopClock();nodes.depth.gain.cancelScheduledValues(now);nodes.depth.gain.setValueAtTime(0,now);nodes.clock=null;}
 };
 return {set,dispose:disconnect,get active(){return !!nodes},get clock(){return nodes?.clock?{...nodes.clock}:null}};
}

const api=Object.freeze({STRAINS:Object.freeze(strains),EXT,FILTERS,CYCLES,normalize:normalizeMutilator,extensions,audibleControls,createGraph:mutilatorGraph});root.MygrainMutilator=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
