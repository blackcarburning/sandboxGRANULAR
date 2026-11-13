'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),W=require('../wasp-dsp.js');
test('independent clocks, note lengths, dotted/triplets, BPM multipliers and legacy Hz',()=>{
 const pg=W.playground({rate:2,modulation:{cutoff:{clock:'sync',beats:1,multiplier:2,timing:'triplet'},resonant:{clock:'bpm',bpm:90,beats:4,timing:'dotted'},q:{clock:'hz',hz:3}}});
 assert.equal(W.curveHz(pg.modulation.cutoff,120),6);assert.equal(W.curveHz(pg.modulation.resonant,240),.25);assert.equal(W.curveHz(pg.modulation.q,240),3);
 const legacy=W.playground({rate:2});for(const lane of Object.values(legacy.modulation))assert.equal(W.curveHz(lane,120),2);
 const e=new W.PlaygroundEngine(48000,pg);for(let i=0;i<12000;i++)e.beginFrame([],0);for(const [i,expected] of [.5-6/48000,.0625-.25/48000,.75-3/48000].entries())assert(Math.abs(e.phases[i]-expected)<1e-9);
 const old=e.phases.slice();e.update({...pg,tempo:240});assert.deepEqual(e.phases,old);assert.equal(e.increments[0],12/48000);assert.equal(e.increments[1],.25/48000);
});
test('horizontal snapping maps to musical grid while Off keeps point resolution',()=>{
 const lane=W.playground({modulation:{cutoff:{clock:'sync',beats:4,snap:1}}}).modulation.cutoff;
 assert.equal(W.curveSnapIndex(11,lane,120),16);assert.equal(W.curveSnapIndex(11,{...lane,snap:0},120),11);
 assert.equal(W.curveSnapIndex(11,{...lane,snapTiming:'triplet'},120),11);assert.equal(W.curveSnapIndex(15,{...lane,snapTiming:'dotted'},120),24);
 for(const snap of W.CURVE_BEATS)for(const snapTiming of ['straight','triplet','dotted'])for(let i=0;i<64;i++)assert(W.curveSnapIndex(i,{...lane,snap,snapTiming},120)>=0);
});
test('new controls survive normalization without changing curve samples',()=>{
 const pg=W.playground({routeKick:true,tempo:99,modulation:{q:{clock:'bpm',bpm:75,multiplier:.25,snap:.125,snapTiming:'triplet',timing:'dotted',curve:Array(64).fill(.25)}}});assert.deepEqual(W.playground(pg),pg);assert.equal(pg.routeKick,true);assert.equal(pg.modulation.q.curve[5],.25);
});
test('every coarse grid retains both drawable boundaries at all clock multipliers',()=>{
 for(const clock of ['hz','bpm','sync'])for(const multiplier of W.CURVE_MULTIPLIERS)for(const beats of W.CURVE_BEATS)for(const snap of W.CURVE_BEATS)for(const snapTiming of ['straight','triplet','dotted']){
 const lane=W.playground({modulation:{cutoff:{clock,hz:20,bpm:90,multiplier,beats,snap,snapTiming}}}).modulation.cutoff;
 assert.equal(W.curveSnapIndex(0,lane,120),0);assert.equal(W.curveSnapIndex(63,lane,120),63,JSON.stringify(lane));
 const window=W.curveWindow(lane,120);assert(Math.abs(window.seconds*W.curveHz(lane,120)-1)<1e-10);
 let previous=0;for(const i of [0,10,20,30,40,50,63]){const index=W.curveSnapIndex(i,lane,120);assert(index>=previous&&index<=63);previous=index;}
 }
});
