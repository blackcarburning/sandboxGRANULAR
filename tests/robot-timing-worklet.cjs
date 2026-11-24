const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),backup=process.env.MYGRAIN_ROBOT_BASELINE;
function recipe(extra={}){return{enabled:true,level:.7,loopBars:1,phrases:[{id:'one',enabled:true,lanes:[{offset:0,duration:.01,pattern:Array.from({length:16},(_,i)=>i===4||i===12?1:0)}]}],...extra};}
function render(file,state,seconds=5,bpm=240,cycleSteps=16,sourceSeconds=.01){const rate=8000,scope={sampleRate:rate,currentTime:0,AudioWorkletProcessor:class{constructor(){this.port={}}},registerProcessor:(n,C)=>{scope.C=C;}};vm.createContext(scope);vm.runInContext(fs.readFileSync(file,'utf8'),scope);const pcm=new Float32Array(rate*sourceSeconds).fill(.1),player=new scope.C({processorOptions:{state,pcm,sourceRate:rate,bpm,cycleSteps,time:0,origin:0}}),audio=new Float32Array(Math.ceil(seconds*rate));for(let i=0;i<audio.length;i+=128){scope.currentTime=i/rate;const out=[new Float32Array(128),new Float32Array(128)];player.process([],[out]);audio.set(out[0].subarray(0,Math.min(128,audio.length-i)),i);}return audio;}
function onsets(a){const x=[];for(let i=0;i<a.length;i++)if(a[i]&&(!i||!a[i-1]))x.push(i/8000);return x;}
const file=process.env.MYGRAIN_ROBOT_CANDIDATE||root+'/robot-worklet.js',cases=[
 [recipe({loopBars:2}),[.5,1.5,2.5,3.5,4.5]],
 [recipe({loopBars:2,timingBars:1}),[.25,.75,2.25,2.75,4.25,4.75]],
 [recipe({loopBars:1,timingBars:2}),[.5,1.5,2.5,3.5,4.5]],
 [recipe({loopBars:4,timingBars:1}),[.25,.75,4.25,4.75]]];
for(const[s,t]of cases)assert.deepEqual(onsets(render(file,s)),t);
// Preserving the original span is inaudibly neutral. All ratchets keep their absolute spacing.
for(const bars of [1,2,4])for(const ratchet of [1,2,3,4]){const s=recipe({loopBars:bars});s.phrases[0].lanes[0].pattern[4]=ratchet;assert.deepEqual(render(file,{...s,timingBars:bars}),render(file,s));}
// Phrase two starts on the new loop boundary, not on the captured grid span.
const chain=recipe({loopBars:2,timingBars:1});chain.phrases.push({id:'two',enabled:true,lanes:[{offset:0,duration:.01,pattern:[1,...Array(15).fill(0)]}]});assert.deepEqual(onsets(render(file,chain)),[.25,.75,2,4.25,4.75]);
// Full tails crossing the new seam remain untouched.
const tails=recipe({loopBars:1,timingBars:1});tails.phrases[0].lanes[0].duration=.2;tails.phrases[0].lanes[0].pattern=Array.from({length:16},(_,i)=>i===15?1:0);assert(render(file,tails,2,240,16,.2)[Math.round(1.1*8000)]>0);
let legacyComparisons=0;if(backup)for(const bars of [undefined,1,2,4])for(const maximiser of [undefined,50,100])for(const ratchet of [1,2,3,4]){const s=recipe();if(bars)s.loopBars=bars;else delete s.loopBars;if(maximiser)s.maximiser=maximiser;s.phrases[0].lanes[0].pattern[4]=ratchet;assert.deepEqual(render(file,s),render(backup,s));legacyComparisons++;}
const scope={};vm.createContext(scope);vm.runInContext(fs.readFileSync(root+'/robot-dsp.js','utf8'),scope);const M=scope.MygrainRobot;assert.equal(M.normalize(recipe({timingBars:1})).timingBars,1);assert.equal(M.normalize(recipe({timingBars:3})).timingBars,undefined);assert.equal(M.renderVersion(recipe()),34);assert.equal(M.renderVersion(recipe({timingBars:1})),35);
for(let i=0;i<100;i++){const result=M.randomGrid({lanes:Array.from({length:16},()=>({duration:.02}))},240,Math.random,4,4);assert(result.lanes.every(l=>l.pattern.slice(4).every(v=>!v)));}
console.log(JSON.stringify({lockedOnsets:true,ratchetSpacing:true,phraseChain:true,normalization:true,boundedRandomisation:true,legacyPcmComparisons:legacyComparisons}));
