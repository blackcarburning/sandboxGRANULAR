const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function source(name){
 const start=html.search(new RegExp(`(?:async )?function ${name}\\(`));assert(start>=0,name);
 let i=html.indexOf('(',start),depth=0;
 for(;i<html.length;i++){if(html[i]==='(')depth++;if(html[i]===')'&&!--depth)break;}
 const body=html.indexOf('{',i);depth=0;
 for(i=body;i<html.length;i++){if(html[i]==='{')depth++;if(html[i]==='}'&&!--depth)return html.slice(start,i+1);}
 throw Error(name);
}
for(const layer of ['L','X']){
 function readiness(overrides={}){
  const applied=[],status=[];
  const c={ensureAudioReadyForKeyInteraction:async()=>true,
   [`isBastardLoop${layer}UsingSynth`]:()=>false,[`bastardLoop${layer}SampleBuffer`]:{},
   [`ensureBastardLoop${layer}SampleBufferReady`]:async()=>true,
   [`updateBastardLoop${layer}Status`]:s=>status.push(s),
   [`applyBastardLoop${layer}NoteEntry`]:(...args)=>{applied.push(args);return true},...overrides};
  vm.createContext(c);vm.runInContext(source(`previewBastardLoop${layer}NoteFromInput`),c);
  return {c,applied,status,preview:c[`previewBastardLoop${layer}NoteFromInput`]};
 }
 test(`${layer}: a released key cannot play after asynchronous audio readiness`,async()=>{
  let ready;const f=readiness({ensureAudioReadyForKeyInteraction:()=>new Promise(r=>ready=r)});
  const keyHold={released:false};const pending=f.preview('C3',{keyHold});keyHold.released=true;ready(true);
  assert.equal(await pending,false);assert.equal(f.applied.length,0);
 });
 test(`${layer}: reload the remembered sample without starting transport or substituting a tone`,async()=>{
  let loads=0;const f=readiness({[`bastardLoop${layer}SampleBuffer`]:null,[`ensureBastardLoop${layer}SampleBufferReady`]:async()=>{loads++;return true}});
  const keyHold={released:false};assert.equal(await f.preview('C3',{keyHold}),true);assert.equal(loads,1);assert.equal(f.applied[0][1].keyHold,keyHold);
 });
 test(`${layer}: releasing during sample restore cancels playback and note recording`,async()=>{
  let finish;const f=readiness({[`bastardLoop${layer}SampleBuffer`]:null,[`ensureBastardLoop${layer}SampleBufferReady`]:()=>new Promise(r=>finish=r)});
  const keyHold={released:false};const pending=f.preview('C3',{keyHold});await new Promise(resolve=>setImmediate(resolve));keyHold.released=true;finish(true);
  assert.equal(await pending,false);assert.equal(f.applied.length,0);
 });
 test(`${layer}: missing samples report the problem without playing a fallback tone`,async()=>{
  const f=readiness({[`bastardLoop${layer}SampleBuffer`]:null,[`ensureBastardLoop${layer}SampleBufferReady`]:async()=>false});
  assert.equal(await f.preview('C3',{keyHold:{released:false}}),false);assert.equal(f.applied.length,0);assert.match(f.status[0],/Choose a sample/);
 });
 test(`${layer}: selecting the synth preserves the existing synth audition path`,async()=>{
  const f=readiness({[`isBastardLoop${layer}UsingSynth`]:()=>true,[`bastardLoop${layer}SampleBuffer`]:null,[`ensureBastardLoop${layer}SampleBufferReady`]:()=>assert.fail('not a sample')});
  assert.equal(await f.preview('C3',{keyHold:{released:false}}),true);assert.equal(f.applied.length,1);
 });
}
test('layer cleanup leaves other keyboard holds alone and releases voices only once',()=>{
 const events=[];const button={classList:{remove:name=>events.push(name)}};
 const voice={source:{context:{currentTime:10},stop:time=>events.push(['stop',time])},gain:{gain:{cancelAndHoldAtTime:time=>events.push(['hold',time]),linearRampToValueAtTime:(value,time)=>events.push(['ramp',value,time])}}};
 const l={layer:'L',button,voice,cleanup:()=>events.push('cleanup')},x={layer:'X',button,voice:null};
 const c={sequencerKeyboardHolds:new Set([l,x])};vm.createContext(c);vm.runInContext([source('releaseSequencerKeyboardHold'),source('releaseSequencerKeyboardHolds')].join('\n'),c);
 c.releaseSequencerKeyboardHolds('L');assert(l.released);assert(!x.released);assert.equal(c.sequencerKeyboardHolds.size,1);
 c.releaseSequencerKeyboardHold(l);assert.equal(events.filter(e=>Array.isArray(e)&&e[0]==='stop').length,1);
 assert.deepEqual(events.find(e=>e[0]==='stop'),['stop',10.015]);c.releaseSequencerKeyboardHolds();assert.equal(c.sequencerKeyboardHolds.size,0);
});

test('held-key input ignores autorepeat and other pointers, and cleans up release listeners',async()=>{
 function target(){const handlers=new Map();return {addEventListener(name,fn){if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(fn)},removeEventListener(name,fn){handlers.get(name)?.delete(fn)},fire(name,props={}){const event={type:name,preventDefault(){},stopPropagation(){},...props};return Promise.all([...handlers.get(name)||[]].map(fn=>fn(event)))},count(name){return handlers.get(name)?.size||0}};}
 const doc=target(),button={...target(),dataset:{note:'C3'},style:{},classList:{add(){},remove(){}},setPointerCapture(){}};
 const calls=[];const c={window:{PointerEvent(){}},document:doc,sequencerKeyboardHolds:new Set(),console};
 vm.createContext(c);vm.runInContext([source('releaseSequencerKeyboardHold'),source('bindSequencerSampleKeyboardKey')].join('\n'),c);
 c.bindSequencerSampleKeyboardKey(button,'X',async(note,options)=>calls.push({note,options}),()=>{});
 await button.fire('pointerdown',{pointerId:1,button:0});await button.fire('pointerdown',{pointerId:2,button:0});
 assert.equal(calls.length,1);assert.equal(c.sequencerKeyboardHolds.size,1);
 await doc.fire('pointerup',{pointerId:2});assert.equal(c.sequencerKeyboardHolds.size,1);
 await doc.fire('pointercancel',{pointerId:1});assert.equal(c.sequencerKeyboardHolds.size,0);assert.equal(doc.count('pointerup'),0);assert.equal(doc.count('pointercancel'),0);
 await button.fire('keydown',{key:'Enter'});await button.fire('keydown',{key:'Enter',repeat:true});assert.equal(calls.length,2);
 await doc.fire('keyup',{key:' '});assert.equal(c.sequencerKeyboardHolds.size,1);
 await doc.fire('keyup',{key:'Enter'});assert.equal(c.sequencerKeyboardHolds.size,0);assert.equal(doc.count('keyup'),0);
});

test('transport LFO reset reconnects held X samples without starting any sequenced note',()=>{
 const voice={},events=[];const c={audioContext:{currentTime:10},bastardLoopXFilterLfoPendingStartTime:null,destroyBastardLoopXFilterLfoSource:()=>events.push('reset'),getSequencerKeyboardVoices:layer=>{assert.equal(layer,'X');return [voice]},attachBastardLoopXFilterLfoToVoice:v=>{assert.equal(v,voice);events.push(['attach',c.bastardLoopXFilterLfoPendingStartTime])}};
 vm.createContext(c);vm.runInContext(source('queueBastardLoopXFilterLfoReset'),c);c.queueBastardLoopXFilterLfoReset(12);
 assert.deepEqual(events,['reset',['attach',12]]);
});
