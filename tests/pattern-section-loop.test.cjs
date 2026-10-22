const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {Section}=require('../q-card.js');
const near=(a,b)=>assert(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('all independent sequencer rates repeat the same section on an exact audio clock',()=>{
 for(const rate of [.25,.5,1,2,4])for(const laneRate of [.125,.25,.5,1,2,4,8])for(const length of [1,4,16,128,256]){
  const dt=.125*laneRate,section=new Section(10,8*.125/rate,length*.125/rate),align=((-(section.start)%dt)+dt)%dt;
  if(!section.hasSteps(dt)){assert.equal(section.grid(10,dt,64).time,Infinity);assert.equal(section.next(10,dt),Infinity);continue}
  let time=section.grid(10,dt,64).time,last=-1;
  for(let i=0;i<100;i++){
   const sourceTick=(section.start+section.phase(time))/dt;near(sourceTick,Math.round(sourceTick));
   const index=section.position(time,dt,64),phase=((time-10)%section.duration+section.duration)%section.duration;
   const expected=Math.floor((section.start+(Math.abs(phase-section.duration)<1e-6?0:phase))/dt+1e-6)%64;
   assert.equal(index,expected);assert(time>last);last=time;const next=section.next(time,dt);assert(next>time);time=next;
  }
 }
});
test('nonzero sections, source-end wrap and long regions select only their own steps',()=>{
 for(const [start,length,want] of [[8,4,[8,9,10,11]],[60,8,[60,61,62,63,0,1,2,3]],[8,128,Array.from({length:128},(_,i)=>(8+i)%64)]]){
  const section=new Section(10,start*.05,length*.05);let time=10;const got=[];
  for(let i=0;i<length*3;i++){got.push(section.position(time,.05,64));time=section.next(time,.05)}
  assert.deepEqual(got,[...want,...want,...want]);near(time,10+length*3*.05);
 }
});
const buffer=(channels,frames,sampleRate)=>({numberOfChannels:channels,length:frames,sampleRate,duration:frames/sampleRate,data:Array.from({length:channels},()=>new Float32Array(frames)),getChannelData(n){return this.data[n]}});
test('continuous audio loops preserve source regions, rate and stereo without altering original buffers',()=>{
 const original=buffer(2,64,20);original.data[0].set(Array.from({length:64},(_,i)=>i));original.data[1].set(Array.from({length:64},(_,i)=>-i));
 for(const [offset,seconds,rate] of [[8,.8,1],[60,.4,1],[8,6.4,1],[8,.8,2]]){
  const source={buffer:original,loopStart:0,loopEnd:3.2,playbackRate:{value:rate}},section=new Section(10,0,seconds);
  assert.equal(section.buffer({createBuffer:buffer},source,offset/20),0);
  const frames=Math.round(seconds*rate*20);assert.equal(source.buffer.length,frames);near(source.loopEnd/rate,seconds);
  for(let i=0;i<frames;i++){assert.equal(source.buffer.data[0][i],(offset+i)%64);assert.equal(source.buffer.data[1][i],-((offset+i)%64))}
 }
 assert.equal(original.data[0][63],63);
 const source={buffer:original,loopStart:.4,loopEnd:1.2,playbackRate:{value:1}};
 new Section(10,0,2).buffer({createBuffer:buffer},source,1);assert.deepEqual([...source.buffer.data[0]].slice(0,8),[20,21,22,23,8,9,10,11]);
});
test('actual drum scheduler repeats selected indexes over multiple wraps without changing saved patterns',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
 const match=/^        function scheduleDrumMachine\(/m.exec(html),end=html.indexOf('\n        }',match.index);
 const events=[],section=new Section(10,.4,.2),context={audioContext:{currentTime:9.9},drumMachinePlaying:true,drumMachineNextStepTime:10,drumMachineCurrentStep:8,drumMachineExtraTracks:{},getDrumMachineStepDuration:()=>.05,getDrumMachinePatternLength:()=>64,getTransportScheduleHorizon:()=>11.01,countMissedAudioSteps:()=>0,scheduleDrumMachineRepeats:(track,index,time)=>{if(track==='kick')events.push([index,time])},scheduleDrumMachineHatStep(){},scheduleDrumMachineVisualStep(){},window:{mygrainPatternSection:{position:(time,dt,count)=>section.position(time,dt,count),next:(time,dt)=>section.next(time,dt)}}};
 vm.createContext(context);vm.runInContext(html.slice(match.index,end+10),context);context.scheduleDrumMachine();
 assert.deepEqual(events.map(e=>e[0]),Array.from({length:21},(_,i)=>8+i%4));events.forEach(([index,time],i)=>near(time,10+i*.05));
});
test('the native transport assigns its buffer once, with normal playback unchanged outside section mode',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
 const match=/^        function startTransportSource\(/m.exec(html),end=html.indexOf('\n        }',match.index);
 for(const active of [null,new Section(10,.4,.2)]){
  const original=buffer(1,64,20);original.data[0].set(Array.from({length:64},(_,i)=>i));
  let assigned=0,current;const source={patternSectionBuffer:original,loop:true,loopStart:0,loopEnd:3.2,playbackRate:{value:1},start(...args){this.started=args}};
  Object.defineProperty(source,'buffer',{get:()=>current,set:value=>{assert.equal(++assigned,1,'native buffer reassigned');current=value}});
  const context={audioContext:{createBuffer:buffer},transportSync:{depth:0},window:{mygrainPatternSection:{active}}};
  vm.createContext(context);vm.runInContext(html.slice(match.index,end+10),context);context.startTransportSource(source,10,.4);
  assert.equal(assigned,1);assert.equal(source.patternSectionBuffer,undefined);assert.equal(source.started[0],10);
  if(active){assert.notEqual(source.buffer,original);near(source.buffer.duration,.2);assert.equal(source.started[1],0)}
  else {assert.equal(source.buffer,original);assert.equal(source.started[1],.4)}
 }
});
