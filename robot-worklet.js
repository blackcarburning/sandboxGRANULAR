/* Sample-accurate word player. Full samples may overlap on manually edited grids. */
class RobotProcessor extends AudioWorkletProcessor{
 constructor(options){super();const p=options.processorOptions;this.state=p.state;this.pcm=p.pcm;this.rate=p.sourceRate/sampleRate;this.bpm=p.bpm;this.cycleSteps=p.cycleSteps;this.time=p.time;this.origin=p.origin;this.last=-1;this.voices=[];this.energy=0;this.limit=1;this.dead=false;this.end=Number.isFinite(p.end)?p.end:Infinity;this.refreshAlignment();this.port.onmessage=e=>{const v=e.data;if(v.dispose){this.dead=true;this.voices=[];}if(v.state)this.state=v.state;if(v.bpm)this.bpm=v.bpm;if(v.cycleSteps)this.cycleSteps=v.cycleSteps;if(v.state||v.bpm||v.cycleSteps)this.refreshAlignment();};}
 refreshAlignment(){
  const s=this.state,snap=s.snap,phrases=s.phrases.filter(p=>p.enabled);this.aligned=false;
  if(!snap||!(snap.strength>0)||!(snap.maxShiftMs>0)||!phrases.length)return;
  const beat=15/this.bpm,span=(s.loopBars?16*s.loopBars:this.cycleSteps)*beat,events=[];
  const advance=(p,l)=>p.voice?.startsWith('kokoro_')?Math.min((l.markers?.[snap.method]||0)*snap.strength/100,snap.maxShiftMs/1000):0;
  const available=s.timingBars&&s.loopBars?Math.min(16,16*s.loopBars/s.timingBars):16;
  if(!phrases.some(p=>p.lanes.some(l=>l.pattern.some((n,i)=>n>0&&i<available)&&advance(p,l)>0)))return;
  phrases.forEach((p,index)=>{const cells=s.loopBars?16:this.cycleSteps,step=beat*(s.timingBars&&s.loopBars?s.timingBars:s.loopBars||1);
   for(let j=0;j<cells;j++){if(j*step>=span-1e-9)break;for(const l of p.lanes){const repeats=l.pattern[j%16];for(let r=0;r<repeats;r++){const anchor=index*span+j*step+r*step/repeats;if(anchor>=(index+1)*span-1e-9)continue;events.push({at:anchor-advance(p,l),anchor,pos:l.offset*sampleRate*this.rate,end:(l.offset+l.duration)*sampleRate*this.rate});}}}
  });
  if(!events.length)return;events.sort((a,b)=>a.at-b.at);this.aligned=true;this.events=events;this.period=span*phrases.length;this.eventCycle=Math.max(0,Math.floor((currentTime-this.origin)/this.period)-1);this.eventIndex=0;
  while(this.eventTime()<currentTime-1e-8||this.eventAnchor()<this.time-1e-8)this.advanceEvent();
 }
 eventTime(){return this.origin+this.eventCycle*this.period+this.events[this.eventIndex].at;}
 eventAnchor(){return this.origin+this.eventCycle*this.period+this.events[this.eventIndex].anchor;}
 advanceEvent(){if(++this.eventIndex===this.events.length){this.eventIndex=0;this.eventCycle++;}}
 fireAligned(time){while(this.eventTime()<=time+1e-8){const e=this.events[this.eventIndex];if(this.eventAnchor()>=this.time-1e-8&&this.eventAnchor()<this.end-1e-8&&this.state.enabled)this.voices.push({pos:e.pos,end:e.end});this.advanceEvent();}}

 process(inputs,outputs){const out=outputs[0];if(this.dead)return false;const s=this.state,phrases=s.phrases.filter(p=>p.enabled);for(let i=0;i<out[0].length;i++){const time=currentTime+i/sampleRate,position=(time-this.origin)*this.bpm/15,tick=Math.floor((position+1e-8)*12/(s.loopBars||1));
if(this.aligned){this.fireAligned(time);this.last=s.timingBars&&s.loopBars?Math.floor((position+1e-8)/(16*s.loopBars))*192+Math.floor((((position%(16*s.loopBars))+16*s.loopBars)%(16*s.loopBars)+1e-8)*12/s.timingBars):tick;}else if(s.timingBars&&s.loopBars){
 const loopSteps=16*s.loopBars,cycle=Math.floor((position+1e-8)/loopSteps),within=position-cycle*loopSteps;
 const localTick=Math.floor((within+1e-8)*12/s.timingBars),key=cycle*192+localTick;
 if(time>=this.time&&position>=0&&localTick>=0&&localTick<192&&key!==this.last){
  this.last=key;
  if(s.enabled&&phrases.length){const step=Math.floor(localTick/12),sub=localTick%12,phrase=phrases[cycle%phrases.length];
   for(const lane of phrase.lanes){const repeats=lane.pattern[step];if(repeats>0&&sub%(12/repeats)===0)this.voices.push({pos:lane.offset*sampleRate*this.rate,end:(lane.offset+lane.duration)*sampleRate*this.rate});}
  }
 }
}else if(time>=this.time&&position>=0&&tick!==this.last){this.last=tick;if(s.enabled&&phrases.length){const step=Math.floor(tick/12),sub=tick%12,phrase=phrases[Math.floor(step/(s.loopBars?16:this.cycleSteps))%phrases.length];for(const lane of phrase.lanes){const repeats=lane.pattern[step%16];if(repeats>0&&sub%(12/repeats)===0){this.voices.push({pos:lane.offset*sampleRate*this.rate,end:(lane.offset+lane.duration)*sampleRate*this.rate});}}}}let value=0;for(let v=this.voices.length-1;v>=0;v--){const voice=this.voices[v];if(voice.pos>=voice.end||voice.pos>=this.pcm.length){this.voices.splice(v,1);continue;}const n=Math.floor(voice.pos),f=voice.pos-n;value+=this.pcm[n]*(1-f)+(this.pcm[n+1]||0)*f;voice.pos+=this.rate;}value*=s.enabled?s.level:0;
// Sum full word tails first. The optional zero-latency, sample-peak maximiser
// raises quiet speech without choking a previous word or shifting the clock.
if(s.maximiser>0){this.energy+=(value*value-this.energy)*(1-Math.exp(-1/(sampleRate*.1)));const rms=Math.sqrt(this.energy),boost=Math.pow(10,Math.min(24,Math.max(0,-12-20*Math.log10(Math.max(rms,1e-9))))*s.maximiser/2000);value*=boost;const target=Math.min(1,Math.pow(10,-1/20)/Math.max(1e-20,Math.abs(value)));this.limit=target<this.limit?target:target+(this.limit-target)*Math.exp(-1/(sampleRate*.05));value*=this.limit;}else this.limit=1;
out[0][i]=value;out[1][i]=value;}return true;}
}
registerProcessor('mygrain-robot-v1',RobotProcessor);
