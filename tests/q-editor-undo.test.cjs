const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../q-theory.js');
const { Controller } = require('../q-card.js');
function fixture() {
 const c = new Controller({ length:()=>16,bpm:()=>120,context:()=>({currentTime:0}),save(){} });
 c.sync=()=>{};c.status=()=>{};
 c.state.sequence[0]=T.normalizeStep({root:36,type:'custom',notes:[36,65,70,73],velocity:73,gate:6.5,accent:true,ratchet:2});
 c.resetEditorHistory();return c;
}
test('Q editor provides exactly ten undo and ten redo levels while preserving custom chord parameters',async()=>{
 const c=fixture(), original=T.copy(c.state.sequence[0]);
 for(let i=0;i<12;i++){c.state.sequence[0].notes[0]++;c.changed({reschedule:false});}
 assert.equal(c.editorUndo.length,10);assert.equal(c.editorRedo.length,0);
 for(let i=0;i<10;i++)await c.travelEditorHistory('undo');
 assert.equal(c.state.sequence[0].notes[0],38);assert.equal(c.editorUndo.length,0);assert.equal(c.editorRedo.length,10);
 await c.travelEditorHistory('undo');assert.equal(c.state.sequence[0].notes[0],38);
 for(let i=0;i<10;i++)await c.travelEditorHistory('redo');
 assert.equal(c.state.sequence[0].notes[0],48);assert.equal(c.editorUndo.length,10);assert.equal(c.editorRedo.length,0);
 const expected={...original,notes:[48,65,70,73]};assert.deepEqual(c.state.sequence[0],expected);
});
test('a new edit after Undo discards Redo; no-op controls and Hold do not consume chord history',async()=>{
 const c=fixture();c.changed({reschedule:false});assert.equal(c.editorUndo.length,0);
 c.state.chordHold=true;c.changed({reschedule:false});assert.equal(c.editorUndo.length,0);
 c.state.sequence[0].notes[0]++;c.changed({reschedule:false});await c.travelEditorHistory('undo');
 assert.equal(c.state.chordHold,true);assert.equal(c.editorRedo.length,1);
 c.state.selection={notes:[99]};c.changed({reschedule:false});assert.equal(c.editorRedo.length,1);
 c.state.sequence[0].notes[0]+=2;c.changed({reschedule:false});assert.equal(c.editorRedo.length,0);
});
test('delete, paste and transpose undo exact Q data without touching other instruments',async()=>{
 const c=fixture(), original=T.copy(c.state.sequence[0]);const other={bass:[48,50],drums:[true,false]};c.host.other=other;
 c.state.sequence[0]=null;c.changed({reschedule:false});await c.travelEditorHistory('undo');assert.deepEqual(c.state.sequence[0],original);
 await c.travelEditorHistory('redo');assert.equal(c.state.sequence[0],null);
 await c.travelEditorHistory('undo');c.state.transpose=3;c.changed({reschedule:false});await c.travelEditorHistory('undo');assert.equal(c.state.transpose,0);
 assert.deepEqual(other,{bass:[48,50],drums:[true,false]});
});
test('external restore resets local history, and silent unjournaled changes cannot be overwritten',async()=>{
 const c=fixture();c.state.sequence[0].notes[0]++;c.changed({reschedule:false});
 const saved=c.getState();c.restore(saved);assert.equal(c.editorUndo.length,0);assert.equal(c.editorRedo.length,0);
 c.state.sequence[0].notes[0]++;c.changed({reschedule:false});c.state.sequence[0].notes[0]++;
 await assert.rejects(c.travelEditorHistory('undo'),/restored outside/);assert.equal(c.state.sequence[0].notes[0],39);assert.equal(c.editorUndo.length,0);
});
function audioFixture(instrument='strings') {
 const calls=[];const context={currentTime:0,state:'running',createBufferSource:()=>({playbackRate:{},connect:g=>g,start(){},stop:t=>calls.push(t),disconnect(){}}),createGain:()=>({gain:{cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}})};
 const c=new Controller({length:()=>16,bpm:()=>120,context:()=>context,ready:async()=>true});
 c.sync=()=>{};c.syncTransport=()=>{};c.status=()=>{};c.reflectPlaying=()=>{};c.updatePlayhead=()=>{};c.updateEffects=()=>{};c.ensureGraph=()=>({input:{}});
 c.state.instrument=instrument;c.state.chordHold=true;c.piano.ensure=async()=>{};
 c.piano.source=()=>({sample:{midi:60},duration:8,buffer:{},offset:0,loopStart:.1,loopEnd:.8});
 return {c,context,calls};
}
test('held custom Strings auditions loop without a scheduled stop; Hold Off releases them',async()=>{
 const {c,context,calls}=audioFixture();try{
 await c.audition(T.normalizeStep({root:60,type:'custom',notes:[60,65,70,73]}));
 assert(c.preview.held);assert.equal(c.voices.size,4);assert([...c.voices].every(v=>v.end===Infinity&&v.source.loop));assert.deepEqual(calls,[]);assert(Number.isFinite(c.tailUntil));
 context.currentTime=2;c.tickPreview();assert(c.preview.held);
 c.releaseHeldPreview();assert.equal(c.preview.held,false);assert(calls.every(t=>t===2.025));
 }finally{c.stop();}
});
test('held Piano auditions use the natural recording duration rather than the fixed .85-second gate',async()=>{
 const {c}=audioFixture('piano');try{await c.audition(T.normalizeStep({notes:[60]}));const v=[...c.voices][0];assert(v.end-v.start>7.9);assert.equal(v.source.loop,undefined);}finally{c.stop();}
});
test('held auditions during sequence playback end at the next chord or explicit rest',async()=>{
 const {c}=audioFixture();try{
 c.running=true;c.origin=0;c.state.sequence[0]=T.normalizeStep({notes:[60],gate:1});c.state.sequence[8]=T.normalizeStep({notes:[65],gate:1});c.playbackState=T.copy(c.state);
 await c.audition(T.normalizeStep({notes:[60,65]}));assert.equal(c.preview.endPosition,8);assert([...c.voices].every(v=>Math.abs(v.end-1)<.002));assert([...c.voices].every(v=>Number.isFinite(v.end)));
 c.stopPreview();c.state.sequence[4]=T.normalizeStep({notes:[48],rest:true});c.playbackState=T.copy(c.state);await c.audition(T.normalizeStep({notes:[60]}));assert.equal(c.preview.endPosition,4);
 }finally{c.stop();}
});
