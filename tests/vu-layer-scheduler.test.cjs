'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createMeterScheduler}=require('../demand-ui.js');
function fixture(){
 let now=0,id=0,notify;const timers=new Map(),win=new EventTarget(),doc=new EventTarget();
 doc.documentElement={dataset:{}};doc.hidden=false;
 Object.assign(win,{document:doc,performance:{now:()=>now},setTimeout(fn,delay){timers.set(++id,{fn,at:now+delay});return id},clearTimeout:id=>timers.delete(id),IntersectionObserver:class{constructor(fn){notify=fn}observe(){}unobserve(){}}});
 const service=createMeterScheduler(win);
 return{win,doc,timers,service,visible(el,value){notify([{target:el,isIntersecting:value,intersectionRatio:Number(value)}])},advance(ms){const end=now+ms;while(timers.size){const [key,job]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(job.at>end)break;now=job.at;timers.delete(key);job.fn()}now=end}};
}
test('2 Hz layer meters share the existing clock without raising the legacy meter rate',()=>{
 const f=fixture(),fast={},slow={};let fastReads=0,slowReads=0;
 f.service.watch(fast,()=>fastReads++);f.service.watch(slow,()=>slowReads++,null,{interval:500});f.visible(fast,true);f.visible(slow,true);
 assert.equal(f.timers.size,1);f.advance(2000);assert.equal(fastReads,16);assert.equal(slowReads,4);
 f.visible(fast,false);f.advance(2000);assert.equal(fastReads,16);assert.equal(slowReads,8);assert.equal(f.timers.size,1);
 f.visible(slow,false);assert.equal(f.timers.size,0);
});
test('muted, suspended, hidden and removed layer meters release their taps and own no timer',()=>{
 const f=fixture(),el={};let enabled=false,reads=0,disconnects=0;
 const remove=f.service.watch(el,()=>reads++,()=>disconnects++,{interval:500,enabled:()=>enabled});f.visible(el,true);assert.equal(f.timers.size,0);f.advance(2000);assert.equal(reads,0);
 enabled=true;f.service.refresh();f.advance(500);assert.equal(reads,1);
 enabled=false;f.service.refresh();assert.equal(disconnects,1);assert.equal(f.timers.size,0);f.advance(1000);assert.equal(reads,1);
 enabled=true;f.service.refresh();f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(f.timers.size,0);assert.equal(disconnects,2);
 f.doc.hidden=false;f.doc.dispatchEvent(new Event('visibilitychange'));f.advance(499);assert.equal(reads,1);f.advance(1);assert.equal(reads,2);
 remove();assert.equal(disconnects,3);assert.equal(f.service.snapshot().registered,0);assert.equal(f.timers.size,0);
});
test('tap preparation follows visibility and eligibility without raising the read rate',()=>{
 const f=fixture(),el={};let resumes=0,stops=0,reads=0,enabled=true;
 f.service.watch(el,()=>reads++,()=>stops++,{interval:500,enabled:()=>enabled,resume:()=>resumes++});assert.equal(resumes,0);
 f.visible(el,true);assert.equal(resumes,1);assert.equal(reads,0);f.service.refresh();assert.equal(resumes,1);f.advance(500);assert.equal(reads,1);
 f.visible(el,false);assert.equal(stops,1);assert.equal(f.timers.size,0);
 f.visible(el,true);assert.equal(resumes,2);enabled=false;f.service.refresh();assert.equal(stops,2);f.advance(1000);assert.equal(reads,1);assert.equal(f.timers.size,0);
});
