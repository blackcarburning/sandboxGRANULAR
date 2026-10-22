const test=require('node:test'),assert=require('node:assert/strict');
const theory=require('../q-theory.js'),{Controller,ChordEditor}=require('../q-card.js');

test('individual notes identify major/minor, inversions, extended chords and custom sets',()=>{
 assert.equal(theory.identifyChord([60,64,67]).type,'major');
 assert.equal(theory.identifyChord([60,63,67],60).type,'minor');
 assert.match(theory.identifyChord([64,67,72],60).name,/C major \/ E/);
 assert.equal(theory.identifyChord([60,64,67,71,74],60).type,'major9');
 assert.equal(theory.identifyChord([60,61,66]).type,'custom');
 assert.equal(theory.identifyChord([48,60,64,67],60).type,'major');
});
test('moving a note updates root/quality without losing timing, velocity, accents, tie or ratchet',()=>{
 const step=theory.normalizeStep({notes:[60,64,67],root:60,type:'major',velocity:81,gate:11,accent:true,tie:true,ratchet:3});
 const edited=theory.editChordNotes(step,[60,63,67]);
 assert.equal(edited.type,'minor');for(const key of ['velocity','gate','accent','tie','ratchet','rest'])assert.equal(edited[key],step[key]);assert.deepEqual(step.notes,[60,64,67]);
});
test('whole-chord transpose moves every note and identifies the new root',()=>{
 const step=theory.normalizeStep({notes:[60,64,67],root:60,type:'major'});
 const moved=theory.editChordNotes(step,[61,65,68]);assert.equal(moved.root,61);assert.equal(moved.type,'major');assert.deepEqual(moved.notes,[61,65,68]);
});
test('note crossing sorts the saved voicing; collisions and effective-range violations are rejected',()=>{
 const step=theory.normalizeStep({notes:[60,64,67],root:60,type:'major'});
 assert.deepEqual(theory.editChordNotes(step,[69,64,67]).notes,[64,67,69]);
 assert.throws(()=>theory.editChordNotes(step,[60,67,67]),/already used/);
 assert.throws(()=>theory.editChordNotes(step,[60,64,109]),/range/);
 assert.throws(()=>theory.editChordNotes(step,[60,64,108],1),/range/);
 assert.throws(()=>theory.editChordNotes(step,[21,64,67],-1),/range/);
});
test('the edit loop starts on the chord, excludes its end step and never changes the saved source',()=>{
 const source=theory.defaults();source.enabled=false;source.record=true;
 for(const index of [0,8,12,24])source.sequence[index]=theory.normalizeStep({notes:[48+index],root:48+index});
 const before=JSON.stringify(source),loop=theory.chordEditLoop(source,64,8,16);
 assert.equal(loop.sequence[0].notes[0],56);assert.equal(loop.sequence[4].notes[0],60);assert.equal(loop.sequence[16],null);
 assert.deepEqual(theory.playbackEvents(loop,16).map(e=>e.start),[0,4]);assert.equal(loop.enabled,true);assert.equal(loop.record,false);assert.equal(JSON.stringify(source),before);
});
test('a loop crossing the pattern boundary wraps, and a longer edit loop can repeat the source',()=>{
 const source=theory.defaults();source.sequence[60]=theory.normalizeStep({notes:[60],root:60});source.sequence[0]=theory.normalizeStep({notes:[72],root:72});
 const loop=theory.chordEditLoop(source,64,60,8);assert.deepEqual(theory.playbackEvents(loop,8).map(e=>[e.start,e.notes[0]]),[[0,60],[4,72]]);
 const longer=theory.chordEditLoop(source,64,60,128);assert.deepEqual(theory.playbackEvents(longer,128).map(e=>e.start),[0,4,64,68]);
 for(const length of [0,-1,1.5,257,NaN])assert.throws(()=>theory.chordEditLoop(source,64,8,length));
});
test('block, strings and repeating/custom arpeggios keep the exact chosen loop clock',()=>{
 for(const instrument of ['piano','strings'])for(const arpEnabled of [false,true]){
  const source=theory.defaults();Object.assign(source,{instrument,arpEnabled,arpPattern:'custom',arpRepeat:'until-next',arpSteps:[1,0,2,3],rate:.5});
  source.sequence[60]=theory.normalizeStep({notes:[60,64,67],root:60,gate:64});
  const loop=theory.chordEditLoop(source,64,60,8),events=theory.playbackEvents(loop,8);
  assert(events.length);assert(events.every(e=>e.start>=0&&e.start<8));assert.equal(loop.rate,.5);assert.equal(loop.arpPattern,'custom');assert.equal(source.sequence[0],null);
 }
});
test('preview audio is transient and shares the actual Q sample cache without mutating Q state',()=>{
 const owner=new Controller({context:()=>({currentTime:0}),length:()=>64,bpm:()=>120});
 const editor=new ChordEditor(owner);const before=JSON.stringify(owner.getState());const preview=editor.createPreview();
 assert.equal(preview.piano,owner.piano);assert.notEqual(preview.state,owner.state);assert.equal(preview.length(),16);editor.loopSteps=8;assert.equal(preview.length(),8);assert.equal(JSON.stringify(owner.getState()),before);
 owner.chordEditor=editor;editor.preview=preview;preview.running=true;assert.equal(owner.hasAudio(),true);preview.running=false;assert.equal(Boolean(owner.hasAudio()),false);
});
test('piano and string voices release by the edit-loop boundary, even for long gates or a late scheduler tick',()=>{
 for(const instrument of ['piano','strings'])for(const currentTime of [10,10.4]){
  const stops=[],context={currentTime,createBufferSource:()=>({playbackRate:{},connect:gain=>gain,start(){},stop:time=>stops.push(time)}),createGain:()=>({connect(){},gain:{cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}}})};
  const owner=new Controller({context:()=>context,length:()=>64,bpm:()=>120});owner.piano.source=()=>({sample:{midi:60},duration:8,buffer:{},offset:0,loopStart:.1,loopEnd:1});
  const editor=new ChordEditor(owner);editor.loopSteps=4;const p=editor.createPreview();p.origin=10;p.state.instrument=instrument;p.ensureGraph=()=>({input:{}});
  p.voice(60,96,10.375,8,{grid:true,stepSeconds:.125});assert(stops.length);assert(stops.at(-1)<=10.5+.000001);
 }
});

test('temporary muting affects only the edited source cell, with transpose and longer-loop repeats',()=>{
 const owner=new Controller({context:()=>({currentTime:0}),length:()=>64,bpm:()=>120});
 owner.state.transpose=2;
 for(const index of [8,12])owner.state.sequence[index]=theory.normalizeStep({notes:[60,64,67],root:60});
 const before=JSON.stringify(owner.getState()),editor=new ChordEditor(owner);editor.index=8;editor.loopSteps=128;editor.mutedNotes=new Set([64]);
 const preview=editor.createPreview();preview.state=theory.chordEditLoop(owner.state,64,8,128);
 assert.deepEqual(preview.timeline().map(e=>[e.index,e.notes]),[[0,[62,69]],[4,[62,66,69]],[64,[62,69]],[68,[62,66,69]]]);
 editor.mutedNotes=new Set([60,64,67]);
 assert.deepEqual(preview.timeline().filter(e=>e.index%64===0).map(e=>e.notes),[[],[]]);
 assert.equal(preview.playable(),true,'muting all voices must not stop the section clock');
 editor.mutedNotes=new Set();assert(preview.timeline().every(e=>e.notes.length===3));
 assert.equal(JSON.stringify(owner.getState()),before);
});

test('muting preserves custom ARP pulse times and slots instead of renumbering the remaining notes',()=>{
 const owner=new Controller({context:()=>({currentTime:0}),length:()=>64,bpm:()=>120});
 Object.assign(owner.state,{arpEnabled:true,arpPattern:'custom',arpSteps:[1,2,0,3],arpRepeat:'until-next'});
 owner.state.sequence[8]=theory.normalizeStep({notes:[60,64,67],root:60});
 const editor=new ChordEditor(owner);editor.index=8;editor.loopSteps=4;
 const preview=editor.createPreview();preview.state=theory.chordEditLoop(owner.state,64,8,4);
 const original=preview.timeline();editor.mutedNotes=new Set([64]);const muted=preview.timeline();
 assert.deepEqual(muted.map(e=>e.start),original.map(e=>e.start));
 assert.deepEqual(muted.map(e=>e.notes),[[60],[],[67]]);
 assert(original.some(e=>e.notes.includes(64)),'the original cached timeline remains intact');
});

test('removing a note keeps the other pitches and chord performance settings',()=>{
 const step=theory.normalizeStep({notes:[60,64,67],root:60,velocity:87,gate:8,accent:true,tie:true,ratchet:2});
 const two=theory.editChordNotes(step,[60,67]),one=theory.editChordNotes(two,[67]);
 assert.deepEqual(two.notes,[60,67]);assert.deepEqual(one.notes,[67]);
 for(const key of ['velocity','gate','accent','tie','ratchet'])assert.equal(one[key],step[key]);
 assert.deepEqual(step.notes,[60,64,67]);
});
