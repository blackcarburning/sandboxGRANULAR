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
 assert.throws(()=>plan({bpm:120,patternSteps:16},45,'unsupported',1));
});

test('one or two long source cycles still contain audible interior changes',()=>{
 for(const steps of [64,128]){const a=plan({bpm:120,patternSteps:steps},32,'subtle',8),b=plan({bpm:120,patternSteps:steps},32,'moderate',8);assert(a.events.some(e=>e.amount>.15));assert(b.events.some(e=>e.amount>.35));assert.equal(a.events.at(-1).amount,0)}
});
test('musical options default off and produce bounded interior fills only when requested',()=>{
 const meta={bpm:120,patternSteps:16},a=plan(meta,30,'subtle',12),b=plan(meta,30,'subtle',12,{notes:true,drums:true,recutV:false}),c=plan(meta,30,'moderate',12,{drums:true});
 assert.deepEqual(a.options,{notes:false,drums:false,recutV:false});assert.deepEqual(a.fills,[]);assert.deepEqual(a.rollIterations,[]);assert.deepEqual(b.options,{notes:true,drums:true,recutV:false});assert(b.fills.length>0);for(const fill of c.fills){assert(fill.at>=2&&fill.end<=28);assert(fill.end-fill.at<=1);assert(fill.ratchet>=2&&fill.ratchet<=3)}
});
test('Roll is freshly evaluated each main pattern, independently of a longer saved Roll cycle',()=>{
 const p=plan({bpm:120,patternSteps:16,patternCycleMultiplier:4},60,'subtle',123,{drums:true});
 assert.equal(p.version,8);assert.equal(p.duration,56,'The existing complete-source-cycle rounding remains in force');assert.equal(p.rollIterations.length,24);assert(p.rollIterations.every((d,i)=>d.iteration===i+2&&d.at===4+i*2&&d.end===6+i*2));
 assert(p.rollIterations.some(d=>d.fill));assert(p.rollIterations.some(d=>!d.fill));assert.equal(p.fills.length,p.rollIterations.filter(d=>d.fill).length);
 assert(new Set(p.fills.map(f=>f.hits)).size>1);assert(p.fills.some(f=>f.hits!==4));
 const signature=f=>JSON.stringify([p.rollIterations.find(d=>d.iteration===f.iteration).end-f.end,f.windowSteps,f.notes]);
 for(let i=1;i<p.fills.length;i++)assert.notEqual(signature(p.fills[i]),signature(p.fills[i-1]));
 assert.notDeepEqual(p.fills,plan({bpm:120,patternSteps:16,patternCycleMultiplier:4},60,'subtle',456,{drums:true}).fills);
});

test('Extreme is deterministic and stronger, while retaining original boundary and duration',()=>{
 const meta={bpm:120,patternSteps:16},a=plan(meta,30,'moderate',123,{notes:true,drums:true,recutV:false}),b=plan(meta,30,'extreme',123,{notes:true,drums:true,recutV:false});
 assert(b.events[1].amount>a.events[1].amount);assert(b.fills.length>a.fills.length);assert(b.fills.every(f=>f.ratchet>=2&&f.ratchet<=4));assert.equal(b.duration,30);assert.equal(b.events[0].amount,0);assert.equal(b.events.at(-1).amount,0);assert.deepEqual(b,plan(meta,30,'extreme',123,{notes:true,drums:true,recutV:false}));
});

test('V re-cut option is explicit and defaults off',()=>{const meta={bpm:120,patternSteps:16};assert.equal(plan(meta,30,'subtle',1).options.recutV,false);assert.equal(plan(meta,30,'subtle',1,{recutV:true}).options.recutV,true);assert.equal(plan(meta,30,'subtle',1,{recutV:'1'}).options.recutV,false)});

test('random Roll decisions stay on-grid and within each pattern and protected boundaries across seeds and lengths',()=>{
 for(const bpm of [60,90,120,175])for(const patternSteps of [16,32,64,128])for(const variation of ['subtle','moderate','extreme'])for(const seed of [0,1,123,456,0xffffffff]){
  const meta={bpm,patternSteps},p=plan(meta,30,variation,seed,{drums:true}),step=60/bpm/4;assert(p.fills.length>0);assert.deepEqual(p,plan(meta,30,variation,seed,{drums:true}));
  assert.deepEqual(p.events,plan(meta,30,variation,seed).events,'Roll draws must not change unrelated arrangement choices');
  for(const f of p.fills){const d=p.rollIterations.find(d=>d.iteration===f.iteration);assert(d.fill);assert(f.at>=d.at-1e-7&&f.end<=d.end+1e-7);assert(f.at>=p.events[1].at-1e-7);assert(f.end<=p.events.at(-1).at+1e-7);assert.equal(f.hits,f.notes.length);assert(f.ratchet>1);assert.equal(f.windowSteps,Math.round((f.end-f.at)/step));assert(Math.abs(f.at/step-Math.round(f.at/step))<1e-7);
   assert.equal(new Set(f.notes.map(n=>n.step)).size,f.notes.length);for(const note of f.notes){assert(Number.isInteger(note.step)&&note.step>=0&&note.step<f.windowSteps);assert(note.ratchet>=1&&note.ratchet<=(variation==='subtle'?2:variation==='moderate'?3:4))}
  }
 }
});

test('strength increases average density and Roll rhythms vary in length, position, gaps and ratchets',()=>{
 const totals=[],meta={bpm:120,patternSteps:16};
 for(const variation of ['subtle','moderate','extreme']){
  let hits=0;const widths=new Set(),positions=new Set(),rhythms=new Set();
  for(let seed=1;seed<=100;seed++)for(const f of plan(meta,60,variation,seed,{drums:true}).fills){hits+=f.notes.reduce((sum,n)=>sum+n.ratchet,0);widths.add(f.windowSteps);positions.add(Math.round(f.end/.125)%16);rhythms.add(JSON.stringify(f.notes))}
  assert(widths.size>2);assert(positions.size>2);assert(rhythms.size>20);totals.push(hits);
 }
 assert(totals[0]<totals[1]&&totals[1]<totals[2]);
});
