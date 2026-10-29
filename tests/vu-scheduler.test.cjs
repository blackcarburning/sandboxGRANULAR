'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMeterScheduler}=require('../demand-ui.js');
function fixture(render=false){
 const doc=new EventTarget(),win=new EventTarget(),timers=new Map();let notify,time=0,next=0;
 doc.hidden=false;doc.documentElement={dataset:{}};
 Object.assign(win,{document:doc,__mygrainSongRenderDeck:render,mygrainUiActivity:{busy:false},performance:{now:()=>time},
  setTimeout(fn,ms){assert.equal(ms,125);timers.set(++next,fn);return next},clearTimeout:id=>timers.delete(id),
  IntersectionObserver:class{constructor(fn){notify=fn}observe(){}unobserve(){}}});
 const service=createMeterScheduler(win);
 return{win,doc,timers,service,visible(el,visible){notify([{target:el,isIntersecting:visible,intersectionRatio:visible?1:0}])},tick(){time+=125;for(const [id,fn]of [...timers]){timers.delete(id);fn()}}};
}
test('all registered meters share one clock; offscreen meters do no callbacks or polling',()=>{
 const f=fixture(),elements=Array.from({length:40},()=>({})),reads=elements.map(()=>0),disconnects=elements.map(()=>0);
 elements.forEach((el,i)=>f.service.watch(el,()=>reads[i]++,()=>disconnects[i]++));assert.equal(f.timers.size,0);
 for(const i of [4,5,7])f.visible(elements[i],true);assert.equal(f.timers.size,1);f.tick();assert.equal(reads.reduce((a,b)=>a+b),3);
 f.visible(elements[5],false);assert.equal(disconnects[5],1);f.tick();assert.equal(reads[5],1);
 for(const i of [4,7])f.visible(elements[i],false);assert.equal(f.timers.size,0);const before=[...reads];f.tick();assert.deepEqual(reads,before);
});
test('scroll, jump, pagehide and background cancel clocks and display taps; settling resumes once',()=>{
 const f=fixture(),el={};let reads=0,stops=0;f.service.watch(el,()=>reads++,()=>stops++);f.visible(el,true);f.tick();
 for(const mode of ['scroll','jump','background','pagehide']){
  if(mode==='scroll'){f.win.mygrainUiActivity.busy=true;f.win.dispatchEvent(new Event('mygrain-ui-busy'))}
  if(mode==='jump'){f.doc.documentElement.dataset.mygrainJumping='true';f.win.dispatchEvent(new Event('mygrain-jump-change'))}
  if(mode==='background'){f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'))}
  if(mode==='pagehide')f.win.dispatchEvent(new Event('pagehide'));
  const before=reads;assert.equal(f.timers.size,0);f.tick();assert.equal(reads,before);
  f.win.mygrainUiActivity.busy=false;delete f.doc.documentElement.dataset.mygrainJumping;f.doc.hidden=false;
  f.win.dispatchEvent(new Event('pageshow'));f.win.dispatchEvent(new Event('mygrain-ui-settled'));f.win.dispatchEvent(new Event('mygrain-jump-change'));f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.timers.size,1);f.tick();assert.equal(reads,before+1);
 }assert.equal(stops,4);
});
test('replacement registration does not duplicate timers; removal and render decks do no work',()=>{
 const f=fixture(),el={};let reads=0;const remove=f.service.watch(el,()=>reads++);f.visible(el,true);f.service.watch(el,()=>reads+=2);f.tick();assert.equal(reads,2);remove();assert.equal(f.timers.size,0);assert.equal(f.service.snapshot().registered,0);
 const r=fixture(true);r.service.watch({},()=>{throw Error('render UI')});assert.equal(r.service.snapshot().registered,0);assert.equal(r.timers.size,0);
});

test('IO lag and a preceding label layout shift cannot read or paint a newly offscreen meter',()=>{
 const f=fixture();f.win.innerWidth=400;f.win.innerHeight=500;let y=10,secondReads=0,stops=0;
 const rect=top=>({top,bottom:top+18,left:0,right:100,width:100,height:18});
 const first={getBoundingClientRect:()=>rect(10)},second={getBoundingClientRect:()=>rect(y)};
 f.service.watch(first,()=>{y=510});f.service.watch(second,()=>secondReads++,()=>stops++);
 f.visible(first,true);f.visible(second,true);f.tick();assert.equal(secondReads,0);assert.equal(stops,1);assert.equal(f.service.snapshot().active,1);
});
