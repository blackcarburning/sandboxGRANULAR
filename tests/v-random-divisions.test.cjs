'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../vocal-loop-cut.js');
test('V random source and output widths are only half, quarter and eighth notes across tempos, long vocals, fine grids and snap off',()=>{
 let seed=123;const random=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/2**32;const widths=new Set(),modes=new Set();
 for(const bpm of [60,93,120,180,240])for(const bars of [.125,.25,1,4,16])for(const snap of [false,true]){
  const bar=240/bpm,cycle=bars*bar,input=C.normalize({snap,grid:1/32,repeat:true}),before=JSON.stringify(input);
  for(let i=0;i<100;i++){
   const n=C.randomizeV(input,{cycle,bar},random);assert(n.enabled);assert([.5,.25,.125].includes(n.grid));
   for(const width of [n.end-n.start,C.region(n).duration]){const fraction=width*cycle/bar;assert([.5,.25,.125].some(x=>Math.abs(x-fraction)<1e-8));widths.add(Number(fraction.toFixed(6)));}
   assert(n.start>=0&&n.end<=1&&C.region(n).end<=1+1e-9);modes.add(n.stretch+':'+n.fromStart);
  }assert.equal(JSON.stringify(input),before);
 }assert.equal(widths.size,3);assert.equal(modes.size,4);
});
test('too-short sources do not invent sub-eighth cuts; narrow original reel regions remain unchanged',()=>{
 const n=C.randomizeV({}, {cycle:.1,bar:2},()=>0);assert(!n.enabled&&!n.repeat);
 const original=C.normalize({enabled:true,start:.1,end:.11});assert.deepEqual(C.randomizeV(original,{cycle:2,bar:2},()=>0,{withinRegion:true}),original);
});
test('random V build and AI division requests clamp to permitted choices without mutating input or manual normalization',()=>{
 const input=['1/32','1/16','1/8','1/4','1/2','1','4','uncut'];assert.deepEqual(C.randomVDivisions(input),['1/8','1/4','1/2']);assert.equal(input.length,8);
 assert.deepEqual(C.randomVDivisions([]),['1/8']);assert.equal(C.normalize({grid:1/32}).grid,1/32);
});
