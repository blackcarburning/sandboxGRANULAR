const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../k-multitrack');
function buffer(frames, rate = 1000) { const data = new Float32Array(frames).fill(.25); return { length:frames, sampleRate:rate, duration:frames/rate, numberOfChannels:1, getChannelData:()=>data, copyToChannel:from=>data.set(from) }; }
function fixture() {
    const sources=[],param=()=>({value:0,setValueAtTime(v){this.value=v},linearRampToValueAtTime(v){this.value=v},setTargetAtTime(v){this.value=v},cancelScheduledValues(){}});
    const node=()=>({connect(){},disconnect(){this.disconnected=true}});
    const context={currentTime:0,createBuffer:(_,frames,rate)=>{const b=buffer(frames,rate);b.getChannelData(0).fill(0);return b},createBufferSource(){const s={...node(),playbackRate:param(),stop(){},buffer:null};sources.push(s);return s},createGain:()=>({...node(),gain:param()}),createStereoPanner:()=>({...node(),pan:param()})};
    let published,bpm=120;
    const k=K.create({context:()=>context,bpm:()=>bpm,pitchRate:()=>1,masterGain:()=>.4,memoryBudget:()=>1024*1024,timing:()=>({time:2,origin:1}),route:()=>[],filters(){},disconnectFilters(){},published:v=>published=v,startSource(s,time,offset){s.buffer=s.patternSectionBuffer;s.started={time,offset}}});
    return {k,sources,context,setBpm:v=>bpm=v,get published(){return published}};
}
test('legacy conversion is idempotent, preserves audio and maps only old K settings to K1',()=>{
    const old={state:{patternLength:16,sliders:{performanceBastardLoopKRecordLength:'3'},modes:{bastardLoopKSourceBpm:140,otherSetting:72}},extra:{audioSlots:{bastardK:true,bastardKRender:true},metadata:{bastardK:{durationSeconds:48*60/140/4,recordingSteps:48}}},assets:[{key:'bastardK',path:'audio/bastardK.wav'}]};
    const before=JSON.stringify(old),converted=K.convertSnapshot(old);
    assert.equal(converted.changed,true);assert.equal(JSON.stringify(old),before);
    assert.deepEqual(converted.snapshot.assets,old.assets);assert.equal(converted.snapshot.state.modes.otherSetting,72);
    const tracks=converted.snapshot.state.modes.kMultitrack.tracks;
    assert.equal(tracks[0].steps,48);assert.equal(tracks[0].sourceBpm,140);assert.equal(tracks[0].level,1);assert.equal(tracks[0].pan,0);assert.equal(tracks[0].mute,false);
    assert.equal(converted.snapshot.extra.audioSlots.bastardKTrack5,false);
    assert.equal(K.convertSnapshot(converted.snapshot).changed,false);
    assert.throws(()=>K.normalize({version:2,tracks:[]}),/Unsupported/);
});
test('five sources use their own lengths, tempo and common-origin modulo; level, mute and pan stay per-track',()=>{
    const f=fixture(),k=f.k;
    [3,5,7,8,11].forEach((steps,i)=>{Object.assign(k.tracks[i],{steps,sourceBpm:120,level:(i+1)/5,pan:(i-2)/2,mute:i===2});k.setBuffer(i,buffer(steps*125))});
    assert.equal(k.start(),true);assert.equal(k.voices.size,5);
    f.sources.forEach((source,i)=>{const track=k.tracks[i];assert.equal(source.loopEnd,track.steps/8);assert.equal(source.started.time,2);assert.equal(source.started.offset,1%(track.steps/8));assert.equal(k.voices.get(i).gain.gain.value,i===2?0:.4*track.level);assert.equal(k.voices.get(i).pan.pan.value,track.pan)});
    const source=k.voices.get(0).source;k.tracks[0].mute=true;k.tracks[1].pan=-.5;k.mix();assert.equal(k.voices.get(0).source,source);assert.equal(k.voices.get(0).gain.gain.value,0);assert.equal(k.voices.get(1).pan.pan.value,-.5);
    f.setBpm(180);k.tempo();assert.equal(source.playbackRate.value,1.5);
    const old=[...k.voices.values()];k.stop();assert.equal(k.voices.size,0);old.forEach(v=>v.source.onended());assert(old.every(v=>v.source.buffer===null&&v.source.disconnected));
});
test('shorter periods crop, longer periods silence-pad once; memory is admitted before replacing playback',()=>{
    const {k,sources}=fixture();k.setBuffer(0,buffer(200));k.tracks[0].steps=1;assert.equal(k.bufferFor(k.tracks[0]).length,200);k.start();assert.equal(sources[0].loopEnd,.125);
    k.tracks[0].steps=4;const padded=k.bufferFor(k.tracks[0]);assert.equal(padded.length,500);assert.equal(padded.getChannelData(0)[199],.25);assert.equal(padded.getChannelData(0)[200],0);assert.equal(k.bufferFor(k.tracks[0]),padded);
    k.tracks[0].steps=1e9;assert.throws(()=>k.start(),/too much audio memory/);assert.equal(k.voices.size,1,'existing graph is not replaced on rejection');
    k.release();assert(k.tracks.every(t=>!t.raw&&!t.rendered&&!t.padded&&!t.paddedSource));
});

test('legacy next-take setting cannot crop the already recorded take during conversion',()=>{
 const converted=K.convertSnapshot({state:{modes:{bastardLoopKRecordingSteps:1,bastardLoopKSourceBpm:120}},extra:{metadata:{bastardK:{durationSeconds:2,recordingSteps:16}}},assets:[{key:'bastardK',frames:96000,sampleRate:48000}]});
 assert.equal(converted.snapshot.state.modes.kMultitrack.tracks[0].steps,16);
 assert.equal(converted.snapshot.state.modes.bastardLoopKRecordingSteps,1);
});
const {Controller}=require('../song-beta');
test('explicit Song conversion verifies editing and never arms or recalls the live pattern',async()=>{
 const calls=[];const controller={song:{parts:[{id:'one'}]},generation:7,playing:false,editing:null,
  adapter:{assertNotRecording(){calls.push('recording guard')}},async ensureEditing(){calls.push('editing lease')},async upgradeSongParts(g){assert.equal(g,7);calls.push('convert originals');return 0},status(message){calls.push(message)},arm(){throw new Error('Must not arm')},recall(){throw new Error('Must not recall')}};
 await Controller.prototype.convertKTracks.call(controller);assert.deepEqual(calls.slice(0,3),['recording guard','editing lease','convert originals']);assert.match(calls[3],/Arm Cache remains manual/);
 controller.playing=true;await assert.rejects(Controller.prototype.convertKTracks.call(controller),/Stop Song/);assert.equal(calls.length,4);
 controller.playing=false;controller.editing={id:'one'};await assert.rejects(Controller.prototype.convertKTracks.call(controller),/finish the current amendment/);
 controller.editing=null;controller.upgradeSongParts=async()=>1;await assert.rejects(Controller.prototype.convertKTracks.call(controller),/editing access was lost/);
});
