'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),T=require('../q-theory.js'),{Controller}=require('../q-card.js');
function fixture(){
 const context={currentTime:0,state:'running',createBufferSource:()=>({playbackRate:{},connect:g=>g,start(){},stop(){},disconnect(){}}),createGain:()=>({gain:{cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}})};
 const c=new Controller({length:()=>16,bpm:()=>120,context:()=>context,save(){},ready:async()=>true});
 c.sync=()=>{};c.syncTransport=()=>{};c.status=()=>{};c.reflectPlaying=()=>{};c.updatePlayhead=()=>{};c.updateEffects=()=>{};c.ensureGraph=()=>({input:{}});
 c.piano.ensure=async()=>{};c.piano.source=p=>({sample:{midi:p},duration:8,buffer:{},offset:0,loopStart:.1,loopEnd:.8});
 for(const [i,n]of [[0,36],[4,60],[6,65],[12,84],[60,72]])c.state.sequence[i]=T.normalizeStep({root:n,notes:[n,n+4,n+7],gate:16,velocity:83});
 c.resetEditorHistory();return{c,context};
}
test('buffered starts queue the first chord immediately, before competing render-deck startup blocks timers',()=>{const {c,context}=fixture();try{c.start(.4);clearInterval(c.timer);assert.equal(context.currentTime,0);assert([...c.voices].some(v=>v.eventStart===0&&v.start===.4));}finally{c.stop()}});
for(const instrument of ['piano','strings'])test(`switching to ${instrument} starts at a fresh deadline after cold loading`,async()=>{
 const {c,context}=fixture();c.state.soundSource='osc';c.running=true;c.origin=0;context.currentTime=5;
 c.preparePlayback=async()=>{context.currentTime=7};let started;
 c.start=at=>{started=at;c.running=true};
 await c.setSoundSource(instrument);
 assert.equal(c.state.soundSource,instrument);assert.equal(c.state.instrument,instrument);
 assert.equal(started,7.04);assert.equal(c.running,true);c.stop();
});
test('Stop during piano loading cancels the automatic restart',async()=>{
 const {c}=fixture();c.state.soundSource='osc';c.running=true;c.origin=0;
 c.preparePlayback=async()=>c.stop();let starts=0;c.start=()=>starts++;
 await c.setSoundSource('piano');assert.equal(starts,0);assert.equal(c.running,false);
});
