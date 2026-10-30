'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{plan}=require('../scripts/instareel-plan.cjs');
test('duration is whole source cycles within 30–60s; boundary sections retain the original groove',()=>{
 for(const bpm of [60,90,120,175])for(const steps of [16,32,64])for(const seconds of [30,45,60]){
  const p=plan({bpm,patternSteps:steps},seconds,'subtle',123);
  assert(p.duration>=30-1e-8&&p.duration<=60+1e-8);assert(Math.abs(p.duration/p.cycle-p.repeats)<1e-8);
  assert.equal(p.events[0].amount,0);assert.equal(p.events.at(-1).amount,0);
  for(const event of p.events)assert(Math.abs(event.at/(240/bpm)-Math.round(event.at/(240/bpm)))<1e-6);
 }
});
test('repeatable seeds and modest changes preserve tempo; try another is actually different',()=>{
 const meta={bpm:120,patternSteps:16};const a=plan(meta,45,'subtle',123);
 assert.deepEqual(a,plan(meta,45,'subtle',123));assert.notDeepEqual(a.events,plan(meta,45,'subtle',456).events);assert.notDeepEqual(a.events.map(e=>e.amount),plan(meta,45,'subtle',456).events.map(e=>e.amount),'One-layer reels must also differ between seeds');
 assert(a.events.some(e=>e.amount>0));assert(a.events.every(e=>e.amount<=.28));assert.equal(a.bpm,120);
});
test('reject unsafe targets and source cycles that cannot fit the range',()=>{
 for(const seconds of [0,29,61,NaN,Infinity])assert.throws(()=>plan({bpm:120,patternSteps:16},seconds,'subtle',1));
 assert.throws(()=>plan({bpm:40,patternSteps:64,patternCycleMultiplier:8},45,'subtle',1));
 assert.throws(()=>plan({bpm:120,patternSteps:16},45,'extreme',1));
});

test('one or two long source cycles still contain audible interior changes',()=>{
 for(const steps of [64,128]){const a=plan({bpm:120,patternSteps:steps},32,'subtle',8),b=plan({bpm:120,patternSteps:steps},32,'moderate',8);assert(a.events.some(e=>e.amount>.15));assert(b.events.some(e=>e.amount>.35));assert.equal(a.events.at(-1).amount,0)}
});
