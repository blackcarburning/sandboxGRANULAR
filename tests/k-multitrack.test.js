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
test('independent loops skip muted tracks entirely and rejoin without replacing other voices',()=>{
    const f=fixture(),k=f.k;
    [3,5,7,8,11].forEach((steps,i)=>{Object.assign(k.tracks[i],{steps,sourceBpm:120,level:(i+1)/5,pan:(i-2)/2,mute:i===2});k.setBuffer(i,buffer(steps*125))});
    assert.equal(k.start(),true);assert.equal(k.voices.size,4);assert.equal(k.voices.has(2),false);
    for(const [i,voice] of k.voices){const source=voice.source,track=k.tracks[i];assert.equal(source.loopEnd,track.steps/8);assert.equal(source.started.time,2);assert.equal(source.started.offset,1%(track.steps/8));assert.equal(voice.gain.gain.value,.4*track.level);assert.equal(voice.pan.pan.value,track.pan)}
    const source=k.voices.get(1).source,retired=k.voices.get(0);
    k.tracks[0].mute=true;k.tracks[1].pan=-.5;k.tracks[2].mute=false;k.mix();
    assert.equal(k.voices.has(0),false);assert(k.voices.has(2));assert.equal(k.voices.get(1).source,source);assert.equal(k.voices.get(1).pan.pan.value,-.5);
    retired.source.onended();assert.equal(retired.source.buffer,null);
    f.setBpm(180);k.tempo();assert.equal(source.playbackRate.value,1.5);
    const old=[...k.voices.values()];k.stop();assert.equal(k.voices.size,0);old.forEach(v=>v.source.onended());assert(old.every(v=>v.source.buffer===null&&v.source.disconnected));
});
test('shorter periods crop, longer periods silence-pad once; memory is admitted before replacing playback',()=>{
    const {k,sources}=fixture();k.setBuffer(0,buffer(200));k.tracks[0].steps=1;assert.equal(k.bufferFor(k.tracks[0]).length,200);k.start();assert.equal(sources[0].loopEnd,.125);
    k.tracks[0].steps=4;const padded=k.bufferFor(k.tracks[0]);assert.equal(padded.length,500);assert.equal(padded.getChannelData(0)[199],0);assert.equal(padded.getChannelData(0)[190],.25);assert.equal(padded.getChannelData(0)[200],0);assert.equal(k.bufferFor(k.tracks[0]),padded);
    k.tracks[0].steps=1e9;assert.throws(()=>k.start(),/too much audio memory/);assert.equal(k.voices.size,1,'existing graph is not replaced on rejection');
    k.release();assert(k.tracks.every(t=>!t.raw&&!t.rendered&&!t.padded&&!t.paddedSource));
});

test('legacy next-take setting cannot crop the already recorded take during conversion',()=>{
 const converted=K.convertSnapshot({state:{modes:{bastardLoopKRecordingSteps:1,bastardLoopKSourceBpm:120}},extra:{metadata:{bastardK:{durationSeconds:2,recordingSteps:16}}},assets:[{key:'bastardK',frames:96000,sampleRate:48000}]});
 assert.equal(converted.snapshot.state.modes.kMultitrack.tracks[0].steps,16);
 assert.equal(converted.snapshot.state.modes.bastardLoopKRecordingSteps,1);
});
const {Controller}=require('../song-beta');
test('explicit Song conversion uses only the server, verifies editing and never arms or recalls',async()=>{
 const calls=[];const controller={song:{id:'fixture-12345678',revision:4,parts:[{id:'one'}]},generation:7,playing:false,editing:null,
  adapter:{assertNotRecording(){calls.push('recording guard')}},async ensureEditing(){calls.push('editing lease')},
  async request(path,options){assert.match(path,/\/convert-k$/);assert.equal(options.method,'POST');calls.push('server conversion');return{ok:true,converted:1,song:{...this.song,revision:5}}},
  acceptSong(song){this.song=song},invalidate(){},status(message){calls.push(message)},
  upgradeSongParts(){throw Error('Must not convert on device')},arm(){throw Error('Must not arm')},recall(){throw Error('Must not recall')}};
 await Controller.prototype.convertKTracks.call(controller);assert.deepEqual(calls.filter(s=>!s.startsWith('Converting')&&!s.startsWith('Server K')),['recording guard','editing lease','server conversion']);assert.match(calls.at(-1),/Arm Cache remains manual/);
 controller.playing=true;await assert.rejects(Controller.prototype.convertKTracks.call(controller),/Stop Song/);
 controller.playing=false;controller.editing={id:'one'};await assert.rejects(Controller.prototype.convertKTracks.call(controller),/finish the current amendment/);
});

test('version-one multitrack conversion copies former shared processing without changing any take',()=>{
 const tracks=Array.from({length:5},(_,i)=>({level:(i+1)/5,pan:i/5,steps:i+3,sourceBpm:123,metadata:{take:i}}));
 const old={state:{sliders:{performanceBastardLoopKSemitone:'7',performanceBastardLoopKFineTune:'-13',performanceBastardLoopKFilterCutoff:'1400',performanceBastardLoopKFilterEnvelope:'70',performanceBastardLoopKFilterLfoAmount:'30'},selects:{performanceBastardLoopKFilterMode:'highpass-24',performanceBastardLoopKFilterLfoWaveform:'ramp',performanceBastardLoopKFilterLfoRate:'0.5'},modes:{kMultitrack:{version:1,selected:3,tracks},bastardLoopKPreserveDuration:false,bastardLoopKReverse:true,bastardLoopKFilterLfoInvert:true}},assets:tracks.map((_,i)=>({key:K.rawKey(i),path:`audio/${i}.wav`}))};
 const original=JSON.stringify(old),result=K.convertSnapshot(old);assert(result.changed);assert.equal(JSON.stringify(old),original);assert.deepEqual(result.snapshot.assets,old.assets);
 const config=result.snapshot.state.modes.kMultitrack;assert.equal(config.version,2);assert.equal(config.selected,3);
 config.tracks.forEach((track,i)=>{assert.equal(track.level,tracks[i].level);assert.equal(track.steps,tracks[i].steps);assert.deepEqual(track.metadata,tracks[i].metadata);assert.equal(track.processing.semitone,7);assert.equal(track.processing.fine,-13);assert.equal(track.processing.cutoff,1400);assert.equal(track.processing.envelope,.7);assert.equal(track.processing.envelopeDecay,null);assert.equal(track.processing.filterMode,'highpass-24');assert.equal(track.processing.preserveDuration,false);assert.equal(track.processing.reverse,true);assert.equal(track.processing.lfoWave,'square');assert.equal(track.processing.lfoInvert,true);assert.equal(track.processing.lfoAmount,.3);assert.equal(track.processing.delayMix,0);assert.equal(track.processing.reverbMix,0)});
 assert.equal(K.convertSnapshot(result.snapshot).changed,false);
 config.tracks[1].processing.cutoff=800;assert.equal(K.normalize(config).tracks[0].processing.cutoff,1400);assert.equal(K.normalize(config).tracks[1].processing.cutoff,800);
});
test('disabled, zero-level and muted tracks allocate no voices or huge padding, and one-track edits preserve peers',()=>{
 const f=fixture(),k=f.k;k.tracks.forEach((t,i)=>{k.setBuffer(i,buffer(200));t.steps=i?1e9:1});
 k.tracks[1].enabled=false;k.tracks[2].mute=true;k.tracks[3].level=0;k.tracks[4].enabled=false;
 assert(k.start());assert.equal(f.sources.length,1);assert.equal(k.voices.size,1);assert(k.tracks.slice(1).every(t=>!t.padded));
 k.tracks[1].steps=2;k.tracks[1].enabled=true;k.mix();const peer=k.voices.get(0).source;
 k.tracks[1].steps=3;k.restart(1);assert.equal(k.voices.get(0).source,peer);assert.equal(k.voices.get(1).source.loopEnd,.375);
});
test('processing normalization is bounded, serializable and independently round-trips every track',()=>{
 const p=K.processing({resonance:100,delayFeedback:2,delayMix:9,reverbMix:9,reverbDecay:99,semitone:99,filterMode:'bad'});
 assert.equal(p.resonance,8);assert.equal(p.delayFeedback,.7);assert.equal(p.delayMix,.6);assert.equal(p.reverbMix,.6);assert.equal(p.reverbDecay,4);assert.equal(p.semitone,24);assert.equal(p.filterMode,'lowpass-48');
 const config=K.normalize();config.tracks[4].processing=K.processing({cutoff:420,semitone:-7,delayMix:.4});config.tracks[4].enabled=false;
 assert.deepEqual(K.normalize(JSON.parse(JSON.stringify(config))),config);assert.equal(config.tracks[0].processing.cutoff,18000);
});

// Adversarial DC edges expose wrap clicks even when ordinary music hides them.
test('K loop seam smoothing is cached, nondestructive and period-preserving for cropped and padded tracks',()=>{
 const {k}=fixture(),raw=buffer(1000,48000),original=raw.getChannelData(0).slice();
 k.setBuffer(0,raw);const track=k.tracks[0];track.steps=null;
 const smooth=k.bufferFor(track),data=smooth.getChannelData(0);
 assert.notEqual(smooth,raw);assert.deepEqual(raw.getChannelData(0),original);
 assert.equal(smooth.length,raw.length);assert.equal(data[0],0);assert.equal(data[999],0);assert.equal(data[500],.25);
 let maxStep=0;for(let i=1;i<data.length;i++)maxStep=Math.max(maxStep,Math.abs(data[i]-data[i-1]));
 assert(maxStep<.003,`edge sample step ${maxStep}`);assert.equal(k.bufferFor(track),smooth);
 track.steps=1;track.sourceBpm=300; // 2400 frames: original ends into silence.
 const padded=k.bufferFor(track);assert.equal(padded.length,2400);assert.equal(padded.getChannelData(0)[999],0);assert.equal(padded.getChannelData(0)[1000],0);
 track.sourceBpm=120;track.steps=null;track.metadata={durationSeconds:.01};
 const cropped=k.bufferFor(track);assert.equal(cropped.getChannelData(0)[479],0);assert.equal(cropped.getChannelData(0)[0],0);
 assert.deepEqual(raw.getChannelData(0),original);
});
