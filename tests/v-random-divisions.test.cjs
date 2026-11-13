'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../vocal-loop-cut.js');
test('all random source/output widths are exclusively one or two bars regardless of manual grid, snap or tempo',()=>{
 let seed=123;const random=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/2**32;const widths=new Set();
 for(const generator of [C.randomizeV,C.randomize])for(const bpm of [60,93,120,180,240])for(const bars of [.125,.25,1,4,16])for(const snap of [false,true]){
  const bar=240/bpm,cycle=bars*bar,input=C.normalize({snap,grid:1/32,repeat:true}),before=JSON.stringify(input);
  for(let i=0;i<100;i++){
   const n=generator(input,{cycle,bar},random);
   if(bars<1){assert(!n.enabled&&!n.repeat);continue}
   assert(n.enabled);assert([2,1].includes(n.grid));
   for(const width of [n.end-n.start,C.region(n).duration]){const fraction=width*cycle/bar;assert([2,1].some(x=>Math.abs(x-fraction)<1e-8));widths.add(Number(fraction.toFixed(6)))}
   assert(n.start>=0&&n.end<=1&&C.region(n).end<=1+1e-9);
  }assert.equal(JSON.stringify(input),before);
 }assert.equal(widths.size,2);
});
test('too-short sources stay intact; within-region reel variations never invent smaller cuts',()=>{
 const n=C.randomizeV({}, {cycle:.1,bar:2},()=>0);assert(!n.enabled&&!n.repeat);
 const original=C.normalize({enabled:true,start:.1,end:.11});assert.deepEqual(C.randomizeV(original,{cycle:2,bar:2},()=>0,{withinRegion:true}),original);
});
test('random and AI division requests use 2/1 only; manual and legacy normalization remains unrestricted',()=>{
 const input=['1/32','1/16','1/8','1/4','1/2','1','4','uncut'];assert.deepEqual(C.randomVDivisions(input),['1']);assert.equal(input.length,8);
 assert.deepEqual(C.randomVDivisions([]),['2','1']);assert.deepEqual(C.randomVDivisions(['1/32']),['2','1']);assert.equal(C.normalize({grid:1/32}).grid,1/32);assert.equal(C.normalize({grid:2}).grid,2);
});
