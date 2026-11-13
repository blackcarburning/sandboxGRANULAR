'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),FX=require('../loop-card-fx.js');
test('new card filters start Off, while saved v1 and legacy filter settings retain their meaning',()=>{
 assert.equal(FX.defaults().filterEnabled,false);
 assert(Object.values(FX.normalize().channels).every(c=>!c.filterEnabled));
 const legacy=FX.normalize(null,{modes:{bastardLoopXFilterMode:'highpass-48',bastardLoopXFilterCutoff:900}});
 assert(legacy.channels.X.filterEnabled);assert.equal(legacy.channels.X.filterType,'highpass');
 assert(FX.normalize({version:1,channels:{A:{cutoff:900}}}).channels.A.filterEnabled);
 assert.equal(FX.normalize({version:1,channels:{A:{filterEnabled:false,cutoff:900}}}).channels.A.filterEnabled,false);
});
test('random filter cleanup drops muted/no-op cards without erasing useful static filters, LFOs, envelopes or other effects',()=>{
 const s=FX.normalize();
 for(const c of Object.values(s.channels))Object.assign(c,{filterEnabled:true,cutoff:18000,lfoDepth:0,resonance:.707});
 s.channels.A.cutoff=1200;s.channels.B.cutoff=800;s.channels.C.lfoDepth=.05;s.channels.D.filterType='highpass';s.channels.D.cutoff=20;
 s.channels.Q.room=.32;s.channels.Q.pan=.4;s.channels.Q.delay=.2;
 const cleaned=FX.pruneFilters(s,['A','C','D','L','Q'],{L:.2});
 for(const key of FX.KEYS)assert.equal(cleaned.channels[key].filterEnabled,['A','C','L'].includes(key),key);
 assert.equal(s.channels.B.filterEnabled,true,'input snapshot must not be mutated');
 assert.equal(cleaned.channels.Q.room,.32);assert.equal(cleaned.channels.Q.pan,.4);assert.equal(cleaned.channels.Q.delay,.2);
 const activeRandom=FX.pruneFilters(FX.subtle(s,()=>.5),['A','X']);
 assert.deepEqual(Object.entries(activeRandom.channels).filter(([,c])=>c.filterEnabled).map(([key])=>key),['A','X']);
});
test('all loop cards including D / five K lanes have bounded independent portable settings',()=>{const s=FX.normalize();assert.equal(Object.keys(s.channels).length,20);s.channels.A.room=.9;assert.equal(s.channels.B.room,0);assert.deepEqual(FX.normalize(JSON.parse(JSON.stringify(s))),s);assert.throws(()=>FX.normalize({version:2}));const c=FX.channel({feedback:5,cutoff:-1,reverbDecay:300,lfoDepth:10});assert.deepEqual([c.feedback,c.cutoff,c.reverbDecay,c.lfoDepth],[.7,20,12,1]);});
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

test('generation explicitly disables every unused filter, hall and delay, without rewriting saved/manual state',()=>{
 const s=FX.normalize();for(const c of Object.values(s.channels))Object.assign(c,{filterEnabled:true,cutoff:900,lfoDepth:.1,reverbEnabled:true,room:.2,delayEnabled:true,delay:.2});
 s.channels.A.room=0;s.channels.A.delay=0;Object.assign(s.channels.X,{cutoff:18000,lfoDepth:0,resonance:.707});s.channels.V.reverbEnabled=false;s.channels.V.delayEnabled=false;
 const pruned=FX.pruneEffects(s,['A','V','X']);
 for(const[k,c]of Object.entries(pruned.channels))if(!['A','V','X'].includes(k))assert.deepEqual([c.filterEnabled,c.reverbEnabled,c.delayEnabled],[false,false,false],k);
 assert.deepEqual([pruned.channels.A.filterEnabled,pruned.channels.A.reverbEnabled,pruned.channels.A.delayEnabled],[true,false,false]);
 assert.deepEqual([pruned.channels.V.filterEnabled,pruned.channels.V.reverbEnabled,pruned.channels.V.delayEnabled],[true,false,false]);
 assert.deepEqual([pruned.channels.X.filterEnabled,pruned.channels.X.reverbEnabled,pruned.channels.X.delayEnabled],[false,true,true]);
 assert.equal(s.channels.B.filterEnabled,true);assert.equal(s.channels.B.room,.2);assert.equal(s.channels.B.delay,.2);assert.equal(FX.normalize(s).channels.B.reverbEnabled,true);
 for(let n=0;n<50;n++){const out=FX.pruneEffects(FX.subtle(s),['A','V','L']);for(const[k,c]of Object.entries(out.channels)){assert.equal(c.delayEnabled,false,k);assert.equal(c.reverbEnabled,['V','L'].includes(k)&&c.room>0,k);if(!['A','V','L'].includes(k))assert.equal(c.filterEnabled,false,k)}}
});

test('Dropbox FX are independent, dry on legacy recall, never double-pan, and do not migrate standard old archives',()=>{const old=FX.normalize();delete old.channels.sample;const snapshot={state:{modes:{loopFx:old}},assets:[],extra:{}};assert.equal(FX.convertSnapshot(snapshot).changed,false);const now=FX.normalize(old);assert.deepEqual([now.channels.sample.filterEnabled,now.channels.sample.reverbEnabled,now.channels.sample.delayEnabled],[false,false,false]);Object.assign(now.channels.sample,{filterEnabled:true,cutoff:900,lfoDepth:.15,reverbEnabled:true,room:.2,delayEnabled:true,delay:.2,pan:.9});assert.equal(FX.normalize(now).channels.sample.pan,0);const muted=FX.pruneEffects(now,[]).channels.sample;assert.deepEqual([muted.filterEnabled,muted.reverbEnabled,muted.delayEnabled],[false,false,false]);const audible=FX.pruneEffects(now,['sample']).channels.sample;assert(audible.filterEnabled&&audible.reverbEnabled&&audible.delayEnabled);assert.equal(FX.convertSnapshot({state:{modes:{loopFx:FX.normalize()}}}).changed,false);});
