const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),task=process.env.TASK,clone=value=>JSON.parse(JSON.stringify(value));
function model(before=false){const context=vm.createContext({});for(const file of ['ember-dsp.js','ember2-dsp.js'])vm.runInContext(fs.readFileSync((before&&file==='ember2-dsp.js'?task+'/before':root)+'/'+file,'utf8'),context);return context.MygrainEmber;}
const current=model(),previous=model(true),base=current.defaults();
assert.deepEqual(clone(base),clone(previous.defaults()));assert.deepEqual(clone(current.PRESETS),clone(previous.PRESETS));
for(let seed=1;seed<=24;seed++)assert.deepEqual(clone(current.randomPatch(base,seed*171)),clone(previous.randomPatch(base,seed*171)));
for(const range of [{enabled:false,start:4,end:9},{enabled:true,start:1,end:16}])assert.equal(current.renderVersion({...base,enabled:true,stepLoop:range}),26);
assert.equal(current.renderVersion({...base,enabled:true,stepLoop:{enabled:true,start:1,end:7}}),29);
assert.equal(current.renderVersion({...base,enabled:true,sampleSource:{...base.sampleSource,voiceSeeds:[null,761,null,null]}}),28);
assert.equal(current.renderVersion({...base,stepLoop:{enabled:true,start:1,end:7}}),0);
const invalid={...clone(base),stepLoop:{enabled:true,start:99,end:-7}},normalized=current.normalize(invalid);
assert.deepEqual(clone(normalized.stepLoop),{enabled:true,start:16,end:16});assert.equal(invalid.stepLoop.start,99);
function runtime(code,rate){let Processor;const messages=[],context=vm.createContext({sampleRate:rate,currentTime:0,AudioWorkletProcessor:class{constructor(){this.port={postMessage:message=>messages.push(message)};}},registerProcessor:(name,type)=>Processor=type});vm.runInContext(code,context);return{context,Processor,messages};}
const code=fs.readFileSync(root+'/ember2-worklet.js','utf8'),old=fs.readFileSync(task+'/before/ember2-worklet.js','utf8'),rows=[];
for(const rate of [44100,48000])for(const samplesEnabled of [true,false])for(const loop of [undefined,{enabled:false,start:5,end:9},{enabled:true,start:1,end:16}]){
 const state=clone(base);state.enabled=true;state.sampleDecay=.6;if(!samplesEnabled){delete state.sampleSource;delete state.sampleDecay;}if(loop)state.stepLoop=loop;
 const legacy=clone(state);delete legacy.stepLoop;const samples=Array.from({length:4},(_,voice)=>Float32Array.from({length:12001},(_,frame)=>Math.sin(frame*(.13+voice*.03))*.5));
 const left=runtime(old,rate),right=runtime(code,rate),first=new left.Processor({processorOptions:{state:legacy,samples,bpm:120,time:0,origin:0}}),second=new right.Processor({processorOptions:{state,samples,bpm:120,time:0,origin:0}});let difference=0,energy=0;
 for(let frame=0;frame<rate*.4;frame+=128){left.context.currentTime=right.context.currentTime=frame/rate;const before=[new Float32Array(128),new Float32Array(128)],after=before.map(()=>new Float32Array(128));first.process([],[before]);second.process([],[after]);for(let channel=0;channel<2;channel++)for(let offset=0;offset<128;offset++){difference=Math.max(difference,Math.abs(before[channel][offset]-after[channel][offset]));energy+=after[channel][offset]**2;}}
 assert.equal(difference,0);assert(energy>0);rows.push({rate,samplesEnabled,loop:loop||null,legacyMaxDifference:difference});
}
let windows=0,events=0;
for(let start=1;start<=16;start++)for(let end=start;end<=16;end++){
 const state=clone(base);state.enabled=true;state.stepLoop={enabled:true,start,end};state.voices.forEach(voice=>{voice.pattern=Array(16).fill(0);voice.pattern[start-1]=1;voice.glitch=0;voice.chance=1;});
 const runtimeState=runtime(code,48000),processor=new runtimeState.Processor({processorOptions:{state,bpm:120,time:0,origin:0}}),length=end-start+1;
 for(let step=0;step<length*3;step++)for(let voice=0;voice<4;voice++){const envelope=processor.event(voice,(step+.01)/4);assert.equal(envelope>0,step%length===0,JSON.stringify({start,end,step,voice,envelope}));events++;}
 windows++;
}
const retirements=[];
for(const rate of [44100,48000]){
 const state=clone(base);state.enabled=true;state.voices.forEach(voice=>{voice.pattern=Array(16).fill(1);voice.chance=1;voice.glitch=0;});const samples=Array.from({length:4},()=>new Float32Array(1024).fill(.4)),clock=runtime(code,rate),control=runtime(code,rate);
 const processor=new clock.Processor({processorOptions:{state,samples,bpm:120,time:0,origin:0,notifyStart:true}}),reference=new control.Processor({processorOptions:{state,samples,bpm:120,time:0,origin:0}}),deadline=.03007;
 processor.port.onmessage({data:{stopAt:deadline+.3}});processor.port.onmessage({data:{stopAt:null}});assert.equal(processor.stopTime,Infinity);processor.port.onmessage({data:{stopAt:deadline}});
 let beforeDifference=0,afterEnergy=0;
 for(let frame=0;frame<rate*.05;frame+=128){clock.context.currentTime=control.context.currentTime=frame/rate;const actual=[new Float32Array(128),new Float32Array(128)],expected=actual.map(()=>new Float32Array(128));processor.process([],[actual]);reference.process([],[expected]);for(let channel=0;channel<2;channel++)for(let offset=0;offset<128;offset++){if((frame+offset)/rate<deadline)beforeDifference=Math.max(beforeDifference,Math.abs(actual[channel][offset]-expected[channel][offset]));else afterEnergy+=actual[channel][offset]**2;}}
 assert.equal(beforeDifference,0);assert.equal(afterEnergy,0);assert.equal(clock.messages.filter(message=>message.started).length,1);assert.equal(clock.messages.filter(message=>message.retired).length,1);retirements.push({rate,deadline,beforeDifference,afterEnergy});
}
fs.writeFileSync(task+'/evidence/step-loop-core.json',JSON.stringify({legacyPairs:rows,windows,events,retirements,factoryAndSeededRecipesExact:true},null,2));console.log('PASS',rows.length,'exact legacy PCM pairs;',windows,'inclusive loop windows;',events,'four-voice events; native sample-accurate retirement/cancellation at both rates');
