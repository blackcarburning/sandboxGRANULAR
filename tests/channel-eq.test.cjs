'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Eq=require('../channel-eq.js');
test('all 26 legacy channels default to completely bypassed four-band EQ',()=>{
 const state=Eq.normalize();assert.equal(Eq.KEYS.length,26);assert.deepEqual(Object.keys(state.channels),Eq.KEYS);
 for(const channel of Object.values(state.channels)){assert.equal(channel.enabled,false);assert.equal(channel.bands.length,4);assert.deepEqual(Eq.response(channel,[20,100,1000,10000,20000]),[0,0,0,0,0]);}
 assert.deepEqual(Eq.normalize(state),state);
});
test('metadata conversion is idempotent, preserves source manifests and all unrelated fields',()=>{
 const original={format:'mygrain-song-part',version:1,state:{patternLength:16,modes:{kMultitrack:{version:2,tracks:[]},other:'retained'}},extra:{metadata:{a:'retained'}},assets:[{key:'bastardA',path:'audio/bastardA.wav',frames:48000,sampleRate:48000}]};
 const before=JSON.stringify(original),converted=Eq.convertSnapshot(original);assert.equal(converted.changed,true);assert.equal(JSON.stringify(original),before);assert.deepEqual(converted.snapshot.assets,original.assets);assert.deepEqual(converted.snapshot.extra,original.extra);assert.equal(Eq.convertSnapshot(converted.snapshot).changed,false);
});
test('four bands have bounded independent frequencies, positive Q, gain and exact cut slopes',()=>{
 const c=Eq.defaults();c.enabled=true;c.bands[0]={type:'highpass',frequency:1,gain:100,q:0,slope:96};c.bands[3]={type:'highshelf',frequency:50000,gain:-100,q:99,slope:48};const n=Eq.channel(c);
 assert.equal(n.bands[0].frequency,20);assert.equal(n.bands[0].gain,24);assert.equal(n.bands[0].q,.1);assert.equal(n.bands[0].slope,96);assert.equal(n.bands[3].frequency,20000);assert.equal(n.bands[3].gain,-24);assert.equal(n.bands[3].q,18);
 for(const invalid of [{version:2,channels:{}},{version:1,channels:[]},{version:1,channels:{A:{bands:[]}}}])assert.throws(()=>Eq.normalize(invalid));
});
test('bells boost and cut at their exact centres and shelf Q is effective',()=>{
 const c=Eq.defaults();c.enabled=true;c.bands.forEach(b=>b.enabled=false);c.bands[1]={...c.bands[1],enabled:true,type:'bell',frequency:1000,gain:12,q:2};assert(Math.abs(Eq.response(c,[1000])[0]-12)<1e-8);
 c.bands[1].gain=-18;assert(Math.abs(Eq.response(c,[1000])[0]+18)<1e-8);
 for(const type of ['lowshelf','highshelf']){c.bands[1]={...c.bands[1],type,gain:12,q:.707};const a=Eq.response(c,[500]);c.bands[1].q=3;assert(Math.abs(Eq.response(c,[500])[0]-a[0])>1);}
});
test('all cut orders have a Butterworth -3 dB corner and approach the selected asymptotic dB/octave slope',()=>{
 for(const type of ['lowpass','highpass'])for(const slope of Eq.SLOPES){const c=Eq.defaults();c.enabled=true;c.bands.forEach(b=>b.enabled=false);c.bands[0]={enabled:true,type,frequency:type==='lowpass'?200:4000,gain:0,q:Math.SQRT1_2,slope};
  assert.equal(Eq.sections(c.bands[0],48000).length,slope/12);assert(Math.abs(Eq.response(c,[c.bands[0].frequency])[0]+3.0103)<.0002);
  const levels=Eq.response(c,type==='lowpass'?[800,1600]:[500,250]);assert(Math.abs((levels[0]-levels[1])-slope)<2.5,`${type} ${slope}: ${levels}`);
 }
});
test('every allowed shelf and cut is finite over the audible range at 44.1/48/96k, including maximum Q',()=>{
 const frequencies=Array.from({length:200},(_,i)=>20*1000**(i/199));
 for(const sampleRate of [44100,48000,96000])for(const type of Eq.TYPES)for(const frequency of [20,1000,20000])for(const q of [.1,Math.SQRT1_2,18]){
  const c=Eq.defaults();c.enabled=true;c.bands.forEach(b=>b.enabled=false);c.bands[0]={enabled:true,type,frequency,gain:24,q,slope:96};assert(Eq.response(c,frequencies,sampleRate).every(Number.isFinite));
 }
});
