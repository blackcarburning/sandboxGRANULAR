'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),FX=require('../loop-card-fx.js');
test('space bypass switches survive recall without losing wet settings',()=>{const old=FX.channel({room:.2,delay:.3});assert.equal(old.reverbEnabled,true);assert.equal(old.delayEnabled,true);const s=FX.normalize();Object.assign(s.channels.A,{room:.27,delay:.19,reverbEnabled:false,delayEnabled:false});const restored=FX.normalize(JSON.parse(JSON.stringify(s)));assert.deepEqual(restored,s);assert.equal(restored.channels.A.room,.27);assert.equal(restored.channels.A.delay,.19);});
test('disabled native space does not reserve delay/IR processing buffers',()=>{const s=FX.normalize(),dry=FX.estimatedBytes(s);Object.assign(s.channels.A,{room:.5,delay:.5,reverbEnabled:false,delayEnabled:false});assert.equal(FX.estimatedBytes(s),dry);s.channels.A.reverbEnabled=true;assert(FX.estimatedBytes(s)>dry);});

test('randomisation resets enabled switches regardless of old wet amounts or switches',()=>{
 for(const previous of [true,false])for(const random of [()=>0,()=>.99]){
  const s=FX.normalize();for(const c of Object.values(s.channels))Object.assign(c,{reverbEnabled:previous,delayEnabled:previous,room:.8,delay:.6});
  const result=FX.subtle(s,random);
  for(const [key,c] of Object.entries(result.channels)){
   assert.equal(c.delayEnabled,false,key+' delay');
   assert.equal(c.reverbEnabled,key==='V'||key==='L',key+' reverb');
   const only=FX.normalize();only.channels[key]=c;
   if(key!=='V'&&key!=='L')assert.equal(FX.estimatedBytes(only),FX.estimatedBytes(FX.normalize()),key+' idle buffers');
  }
  assert.deepEqual(FX.normalize(JSON.parse(JSON.stringify(result))),result);
 }
});
