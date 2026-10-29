'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),FX=require('../loop-card-fx.js');
test('all 14 cards / five K lanes have bounded independent portable settings',()=>{const s=FX.normalize();assert.equal(Object.keys(s.channels).length,18);s.channels.A.room=.9;assert.equal(s.channels.B.room,0);assert.deepEqual(FX.normalize(JSON.parse(JSON.stringify(s))),s);assert.throws(()=>FX.normalize({version:2}));const c=FX.channel({feedback:5,cutoff:-1,reverbDecay:300,lfoDepth:10});assert.deepEqual([c.feedback,c.cutoff,c.reverbDecay,c.lfoDepth],[.7,20,12,1]);});
test('legacy filters, X modulation, Q hall and W effects migrate without current-device input',()=>{const original={modes:{bastardLoopXFilterMode:'highpass-96',bastardLoopXFilterCutoff:550,bastardLoopXFilterLfoAmount:.13,bastardLoopWEffects:{room:.2,reverbDecay:7,delay:.18}},q:{room:.3,reverbDecay:6,highpass:180,lowpass:9000},sliders:{performanceBastardLoopLReverbMix:'12'},selects:{performanceBastardLoopXFilterLfoRate:'16'}};const s=FX.convertState(original).modes.loopFx;assert.equal(s.channels.X.filterType,'highpass');assert.equal(s.channels.X.filterSlope,96);assert.equal(s.channels.X.lfoBeats,16);assert.equal(s.channels.X.lfoDepth,.13);assert.equal(s.channels.W.reverbDecay,7);assert.equal(s.channels.Q.legacyHighpass,180);assert.equal(s.channels.L.room,.12);assert.equal(original.modes.loopFx,undefined)});
test('K five tracks retain independent filter and effect values',()=>{const s=FX.convertState({modes:{kMultitrack:{version:2,tracks:Array.from({length:5},(_,i)=>({processing:{cutoff:1000+i*1000,filterMode:'highpass-24',reverbMix:.1*i,delayMix:.03*i}}))}}}).modes.loopFx;assert.equal(s.channels.K5.cutoff,5000);assert.equal(s.channels.K5.room,.4);assert.equal(s.channels.K1.room,0)});
test('Song metadata conversion is idempotent and never changes assets or unrelated state',()=>{const original={state:{modes:{bastardLoopXAttackSeconds:.031},patternLength:32},assets:[{key:'bastardW',sha256:'abc'}],extra:{audioSlots:{bastardW:true}}};const result=FX.convertSnapshot(original);assert(result.changed);assert.deepEqual(result.snapshot.assets,original.assets);assert.deepEqual(result.snapshot.extra,original.extra);assert.equal(result.snapshot.state.modes.bastardLoopXAttackSeconds,.031);assert.equal(FX.convertSnapshot(result.snapshot).changed,false);assert.equal(original.state.modes.loopFx,undefined)});
test('Merge/Mega randomisation stays subtle, slow and dry-biased',()=>{for(let n=0;n<100;n++){const s=FX.subtle(FX.normalize());for(const c of Object.values(s.channels)){assert(c.room<=.12);assert(c.delay<=.08);assert(c.feedback<=.24);assert(c.lfoDepth<=.07);assert(c.cutoff>=10000);assert(c.lfoBeats>=8);assert(c.reverbDecay<=4.2)}}});

test('Song DSP allowance includes native delay buffers, hall banks and a bounded IR cache',()=>{const s=FX.normalize(),dry=FX.estimatedBytes(s,48000);assert(dry>0);s.channels.A.delay=.1;assert.equal(FX.estimatedBytes(s,48000)-dry,2*12*48000*4);s.channels.A.room=.1;s.channels.A.reverbDecay=4;assert.equal(FX.estimatedBytes(s,48000)-dry,2*12*48000*4+4*48000*8*5);assert(FX.estimatedBytes(s,96000)>FX.estimatedBytes(s,48000));});

test('N gets dry space defaults without a second filter and retains its own space on recall',()=>{const old=FX.normalize({version:1,channels:{A:FX.defaults()}});assert.equal(old.channels.N.room,0);assert.equal(old.channels.N.delay,0);assert.equal(old.channels.N.filterEnabled,false);old.channels.N.room=.4;old.channels.N.delay=.25;const restored=FX.normalize(old);assert.equal(restored.channels.N.room,.4);assert.equal(restored.channels.N.delay,.25);const random=FX.subtle(old);assert.equal(random.channels.N.filterEnabled,false);assert.equal(random.channels.N.lfoDepth,0);});

test('card resonance uses linear-Q to native dB conversion for every slope',()=>{
 for(const slope of FX.SLOPES){const count=slope/12;
  const low=Array.from({length:count},(_,i)=>FX.filterStageQ(.1,i,count));
  const neutral=Array.from({length:count},(_,i)=>FX.filterStageQ(Math.SQRT1_2,i,count));
  const high=Array.from({length:count},(_,i)=>FX.filterStageQ(4,i,count));
  const sum=a=>a.reduce((v,n)=>v+n,0);
  assert(Math.abs(sum(neutral)+3.01029995664)<1e-6);
  assert(Math.abs((sum(high)-sum(low))-20*Math.log10(40))<1e-6);
  assert(Math.abs(sum(high)-20*Math.log10(4))<1e-6);
  assert(high.every(v=>Number.isFinite(v)&&v<30));
 }
});

test('pan defaults centre, clamps, survives recall and always centres on randomise',()=>{
 const s=FX.normalize();for(const c of Object.values(s.channels))assert.equal(c.pan,0);
 s.channels.A.pan=-.7;s.channels.B.pan=.65;
 assert.equal(FX.normalize(s).channels.A.pan,-.7);assert.equal(FX.normalize(s).channels.B.pan,.65);
 assert.equal(FX.channel({pan:9}).pan,1);assert.equal(FX.channel({pan:-9}).pan,-1);
 assert(Object.values(FX.subtle(s).channels).every(c=>c.pan===0));
});
