'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),W=require('../wasp-dsp.js');
test('all factory presets and random patches arm at most one Wasp source',()=>{
 for(const name of Object.keys(W.presets))assert(W.preset(name).routes.filter(route=>route.enabled).length<=1,name);
 for(let i=0;i<100;i++)assert.equal(W.randomize(W.normalize(),['A','V','X','drumKick']).routes.filter(route=>route.enabled).length,1);
});
test('legacy six-record state retains alternate settings, including when only row two is armed',()=>{
 const legacy=W.normalize();legacy.routes[0].enabled=true;legacy.routes[1]={...legacy.routes[1],enabled:true,source:'A',destination:'X',depth:.71};
 const one=W.normalize(legacy);assert.equal(one.routes.length,6);assert.equal(one.routes[0].enabled,true);assert.equal(one.routes[1].enabled,false);assert.equal(one.routes[1].source,'A');assert.equal(one.routes[1].depth,.71);
 legacy.routes[0].enabled=false;const second=W.normalize(legacy);assert.equal(second.routes[1].enabled,true);assert.deepEqual(second.routes[1],legacy.routes[1]);
});
test('old two-source PCM is the first source only in the shared engine',()=>{
 const raw=W.normalize();raw.enabled=true;raw.blend=1;raw.routes[0]={...raw.routes[0],enabled:true,source:'V',destination:'X',method:'am',depth:.6};raw.routes[1]={...raw.routes[1],enabled:true,source:'V',destination:'X',method:'ring',mode:'audio',depth:.9};
 const single=structuredClone(raw);single.routes[1].enabled=false;
 const engines=[raw,single].map(s=>{const engine=new W.Engine(48000,2);engine.update(s,['V','X']);return engine});
 for(let block=0;block<100;block++){
  const inputs=Array.from({length:2},(_,lane)=>Array.from({length:2},()=>Float32Array.from({length:128},(_,i)=>.1*Math.sin((block*128+i)*(lane?.03:.017)))));
  const outputs=engines.map(engine=>{const output=Array.from({length:2},()=>[new Float32Array(128),new Float32Array(128)]);engine.process(inputs,output);return output});assert.deepEqual(outputs[0],outputs[1]);
 }
});
