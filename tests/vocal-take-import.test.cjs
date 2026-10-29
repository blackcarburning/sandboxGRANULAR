const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'../vocal-takes.js'),'utf8').match(/function laneAdapter\(lane\) \{[\s\S]*?\n    \}/)[0];
for(const lane of ['M','M+'])test(`take import enables, mixes and saves only ${lane}, and rejects stale decode`,async()=>{
 const events=[],buffer={numberOfChannels:2},body=new ArrayBuffer(8),c={root:{mygrainSongBeta:{}},isAudioGraphReady:()=>true,engineStarting:false,stateSaveSuspended:false,bastardLoopMRecordingState:'idle',bastardLoopMPlusRecordingState:'idle',bastardLoopMSource:{},bastardLoopMPlusSource:{},syncPerformanceControlState(){events.push('sync')},saveState(){events.push('save')}};
 c.audioContext={async decodeAudioData(b){assert.equal(b,body);return buffer}};
 for(const key of ['M','MPlus']){c[`stopBastardLoop${key}`]=()=>events.push('stop '+key);c[`applyRecordedBastardLoop${key}Buffer`]=async(b,o)=>{assert.equal(b,buffer);assert.equal(o.bpm,120);events.push('apply '+key)};c[`ensureBastardLoop${key}ReadyForTransport`]=()=>events.push('enable '+key);c[`updateBastardLoop${key}Mix`]=()=>events.push('mix '+key)}
 vm.createContext(c);vm.runInContext(src,c);const a=c.laneAdapter(lane),key=lane==='M'?'M':'MPlus';assert.equal(a.canLoad(),true);const result=await a.load(body,{name:'Stereo',bpm:120,durationSeconds:2});assert(result.playing);assert.deepEqual(events,[`stop ${key}`,`apply ${key}`,`enable ${key}`,`mix ${key}`,'sync','save']);
 events.length=0;c.audioContext.decodeAudioData=async()=>{c.stateSaveSuspended=true;return buffer};await assert.rejects(a.load(body,{name:'Stereo',bpm:120,durationSeconds:2}),/state changed/);assert.deepEqual(events,[]);
});
