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
test('legacy Q defaults keep neutral candidate transpose and preserve the existing v1 state',()=>{
 const state=T.normalizeState({version:1,enabled:true});assert.equal(state.paletteTranspose,0);assert.equal(state.version,1);assert.equal(state.sequence.length,64);
 assert.equal(T.normalizeState({paletteTranspose:999}).paletteTranspose,24);assert.equal(T.normalizeState({paletteTranspose:-3.3}).paletteTranspose,-3);
});
test('candidate semitone and octave shifts are literal and never rewrite recorded chords',()=>{
 const {c}=fixture(),sequence=T.copy(c.state.sequence),before=c.palette();c.shiftPool('paletteTranspose',1);
 assert.deepEqual(c.palette().map(x=>x.notes),before.map(x=>x.notes.map(n=>n+1)));assert.deepEqual(c.state.sequence,sequence);assert.equal(c.editorUndo.length,0);
 c.shiftPool('paletteTranspose',-1);assert.deepEqual(c.palette(),before);
 c.shiftPool('octave',1);assert.deepEqual(c.palette().map(x=>x.notes),before.map(x=>x.notes.map(n=>n+12)));assert.deepEqual(c.state.sequence,sequence);
 c.shiftPool('tonic',-1);assert.equal(c.state.tonic,11);assert.equal(c.state.chordRoot,11);c.shiftPool('tonic',1);assert.equal(c.state.tonic,0);
 assert.deepEqual(T.normalizeState(JSON.parse(JSON.stringify(c.getState()))).paletteTranspose,c.state.paletteTranspose);
});
test('holding-pen notes ignore candidate pitch offsets and never restrict the native pool',()=>{
 const {c}=fixture(),raw=[60,64,67];global.mygrainQCustomChords={getNotes:()=>[raw]};
 try{c.shiftPool('paletteTranspose',1);assert.deepEqual(T.transposed(raw,c.candidateShift(true)),raw);c.shiftPool('octave',1);assert.deepEqual(T.transposed(raw,c.candidateShift(true)),raw);assert.deepEqual(raw,[60,64,67]);
 global.mygrainQCustomChords={getNotes:()=>[[108]]};assert.doesNotThrow(()=>c.shiftPool('paletteTranspose',1));assert.deepEqual(T.transposed([108],c.candidateShift(true)),[108]);
 }finally{delete global.mygrainQCustomChords}
});
test('selected-range scheduler repeats only its original grid cells and keeps the full saved pattern',async()=>{
 const {c,context}=fixture(),original=T.copy(c.state.sequence);try{
 await c.setSequenceLoop([4,7]);assert.equal(c.running,false);c.start(.04);clearInterval(c.timer);
 assert.equal(c.length(),16);assert.equal(c.playbackLength(),4);assert.deepEqual(c.timeline().map(e=>e.index),[4,6]);assert.deepEqual(c.timeline().map(e=>e.start),[0,2]);assert.equal(c.playbackIndex(0),4);assert.equal(c.playbackIndex(4),4);assert.equal(c.playbackIndex(7),7);
 assert.deepEqual(c.state.sequence,original);assert.equal(c.getState().loopRange,undefined);
 assert([...c.voices].every(v=>v.pitch>=60&&v.pitch<=72));assert([...c.voices].every(v=>v.end<=c.origin+.5+.00001));
 context.currentTime=c.origin+.49;c.tick();assert([...c.voices].some(v=>v.eventCycle===1));assert([...c.voices].every(v=>v.eventStart===0||v.eventStart===2));
 c.clearSequenceLoop(false);assert.equal(c.playbackLength(),16);assert.equal(c.timeline().length,4);
 }finally{c.stop()}
});
test('range ARP and accent timeline uses selected cells, not the start of the full sequence',()=>{
 const {c}=fixture();c.loopRange=[4,7];c.state.arpEnabled=true;c.state.arpRepeat='until-next';c.state.sequence[5]=T.normalizeStep({kind:'accent',notes:[],accent:true});
 const events=c.timeline();assert(events.length>2);assert(events.every(e=>e.index===4||e.index===6));assert(events.every(e=>e.start>=0&&e.start<4));assert(events.every(e=>e.notes.every(n=>n>=60&&n<=72)));
});
test('Live recording inside a Q loop writes the actual original grid cell',()=>{
 const {c,context}=fixture();global.document={hidden:true,querySelectorAll:()=>[],getElementById:()=>null};
 try{c.loopRange=[4,7];c.running=true;c.origin=0;c.state.record=true;c.state.recordMode='live';c.playbackState=T.copy(c.state);context.currentTime=.16;
 const chord=T.normalizeStep({notes:[62,65,69]});assert(c.recordChord(chord));assert.equal(c.cursor,5);assert.deepEqual(c.state.sequence[5].notes,chord.notes);assert.equal(c.state.sequence[1],null);
 }finally{c.running=false;delete global.document;c.stop()}
});
test('Clear All stops the test loop, clears all 64 cells and is exactly undoable',async()=>{
 const {c}=fixture(),before=T.copy(c.state.sequence);c.loopRange=[4,7];await c.action('clear-all');assert(c.state.sequence.every(x=>x===null));assert.equal(c.loopRange,null);assert.equal(c.running,false);assert.equal(c.cursor,0);
 await c.travelEditorHistory('undo');assert.deepEqual(c.state.sequence,before);assert.equal(c.loopRange,null);
});
test('invalid loop ranges and cancellation never change the saved sequence',async()=>{
 const {c}=fixture(),before=T.copy(c.state.sequence);await assert.rejects(c.setSequenceLoop([7,4]),/first and last/);await assert.rejects(c.setSequenceLoop([1,3]),/no chords/);
 let release;c.piano.ensure=()=>new Promise(r=>release=r);const pending=c.setSequenceLoop([4,7]);await Promise.resolve();await Promise.resolve();c.clearSequenceLoop(false);release();await pending;assert(!c.running);assert.equal(c.loopRange,null);assert.deepEqual(c.state.sequence,before);
});

test('Stop retains the selected range for solo and shared Start; restore and Clear All reset it',async()=>{
 const {c}=fixture();await c.setSequenceLoop([4,7]);c.start(.04);clearInterval(c.timer);c.stop();assert.deepEqual(c.loopRange,[4,7]);c.start(.08,{origin:0});clearInterval(c.timer);assert.equal(c.origin,0);assert.deepEqual(c.timeline().map(e=>e.index),[4,6]);c.stop();c.restore(c.getState());assert.equal(c.loopRange,null);
});
test('range changes during shared playback start the shared section and loop off restores full transport',async()=>{
 const {c,context}=fixture();c.host.transportOrigin=()=>0;context.currentTime=3;c.start(0);clearInterval(c.timer);let started,stops=0,full=0;
 global.mygrainPatternSection={active:null,stop(){stops++;this.active=null},start(index,steps,rate,options){started={index,steps,rate,...options};this.active=started}};c.host.allPlay=()=>full++;
 try{await c.setSequenceLoop([4,7]);assert.deepEqual(started,{index:4,steps:4,rate:1,owner:'q-range'});assert.equal(c.playbackLength(),4);c.clearSequenceLoop();assert.equal(full,1);assert.equal(stops,2);assert.equal(c.playbackLength(),16)}finally{delete global.mygrainPatternSection;c.stop()}
});
test('Stop cancels an in-flight loop load without discarding an existing range',async()=>{
 const {c}=fixture();c.loopRange=[4,7];let release;c.piano.ensure=()=>new Promise(r=>release=r);const pending=c.setSequenceLoop([4,6]);await Promise.resolve();await Promise.resolve();c.stop();release();await pending;assert.equal(c.running,false);assert.deepEqual(c.loopRange,[4,7]);assert.equal(c.loopLoading,false);
});

test('tonic plus/minus changes bass-root candidates as well as the scale pool',()=>{const {c}=fixture();c.host.bassNotes=()=>[60,67];c.setPaletteFromBass(true);const before=c.palette().map(chord=>chord.notes);c.shiftPool('tonic',1);assert.deepEqual(c.palette().map(chord=>chord.notes),before.map(notes=>notes.map(n=>n+1)));assert.deepEqual(c.state.paletteBassRoots,[1,8]);c.shiftPool('tonic',-1);assert.deepEqual(c.palette().map(chord=>chord.notes),before);});
test('holding-pen origin survives normalize, edits, copy and JSON song roundtrip without reclassifying old chords',()=>{const notes=[60,64,67],custom=T.normalizeStep({notes,customChord:true});assert.equal(custom.customChord,true);assert.equal(T.normalizeStep({notes}).customChord,undefined);assert.equal(T.editChordNotes(custom,[61,65,68]).customChord,true);const state=T.normalizeState({sequence:[custom]});assert.equal(T.normalizeState(JSON.parse(JSON.stringify(state))).sequence[0].customChord,true);const {c}=fixture();c.insert(custom);assert.equal(c.state.sequence[0].customChord,true);});

test('main Q range starts at the cropped section origin rather than the accompaniment offset',()=>{
 const {c}=fixture();global.mygrainQ=c;global.mygrainPatternSection={active:{owner:'q-range',origin:2,bpm:120,rate:1}};
 try{c.loopRange=[4,7];c.start(2,{origin:1.5});clearInterval(c.timer);assert.equal(c.origin,2);assert.deepEqual(c.timeline().map(e=>e.index),[4,6]);}finally{c.stop();delete global.mygrainQ;delete global.mygrainPatternSection}
});
test('note edits do not add pool copies; explicit Save updates the step instance',async()=>{
 const {ChordEditor}=require('../q-card.js'),{c}=fixture(),added=[];const e=new ChordEditor(c);Object.assign(e,{opened:true,index:4});e.render=()=>{};e.revealSelected=()=>{};e.status=()=>{};
 global.document={activeElement:{matches:()=>false},querySelectorAll:()=>[],getElementById:()=>null};global.mygrainQCustomChords={saveInstance:(notes,id)=>{added.push({notes:[...notes],id});return {customChord:true,customChordId:id||'saved-one',customChordColour:200}}};
 try{e.commit([61,65,68],61);assert.equal(added.length,0);e.saveChord();assert.equal(c.state.sequence[4].customChordId,'saved-one');e.commit([62,66,69],62);assert.equal(added.length,1);e.saveChord();assert.equal(added.length,2);assert.equal(added[1].id,'saved-one');assert.deepEqual(added[1].notes,[62,66,69]);}finally{delete global.document;delete global.mygrainQCustomChords;c.stop()}
});
