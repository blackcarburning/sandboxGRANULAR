'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),DSP=require('../wasp-dsp.js');
test('external carrier uses retained patch drivers without rewriting destinations',()=>{
 const patch=DSP.normalize();Object.assign(patch,{enabled:true,blend:1,melt:1});Object.assign(patch.routes[0],{enabled:true,source:'all',destination:'B',method:'am',depth:1});
 const before=JSON.stringify(patch),engine=new DSP.Engine(48000,2);engine.update({...patch,externalInputOnly:true},['A','DAW']);
 assert.equal(engine.settings.routes[0].destination,'DAW');assert.deepEqual(engine.program[0].sources,[0]);assert.equal(JSON.stringify(patch),before);
 engine.update(patch,['A','DAW']);assert.equal(engine.settings.routes[0].destination,'B');assert.equal(JSON.stringify(DSP.normalize({...patch,externalInputOnly:true})),before);
});
test('external drawn-curve phase follows host-tempo origin and holds on stop',()=>{
 const rate=48000,engine=new DSP.MasterEngine(rate),patch=DSP.normalize();patch.playground=DSP.playground({enabled:true,tempo:120,modulation:{cutoff:{source:'drawn',clock:'sync',beats:1}}});engine.update(patch);
 const inputs=[[new Float32Array(128),new Float32Array(128)]],outputs=[[new Float32Array(128),new Float32Array(128)]];
 engine.externalTransport={playing:true,startFrame:4800,frame:0};engine.process(inputs,outputs,10800);const phase=engine.playground.phases[0];assert(Math.abs(phase-(10800+128-4800)/24000)<1e-8);
 engine.externalTransport={playing:false,startFrame:4800,frame:10800};engine.process(inputs,outputs,24000);const held=engine.playground.phases[0];engine.process(inputs,outputs,48000);assert.equal(engine.playground.phases[0],held);
 engine.externalTransport=null;engine.process(inputs,outputs);assert.notEqual(engine.playground.phases[0],held);
});
