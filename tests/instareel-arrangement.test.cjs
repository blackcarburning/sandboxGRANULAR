'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const script=require('../scripts/instareel-arrangement.cjs');
function fixture(){
 const elements=new Map(),ctx={window:{},Event:class{},drumMachineEnabled:false,drumMachineHatBuffer:null,drumMachineHatPattern:[],drumMachineHatAccentPattern:[],getPatternLengthSteps:()=>16};
 for(const match of script.matchAll(/\['([^']+)','([^']+)',(bastardLoop\w*Enabled),!!(bastardLoop\w*),v=>(setBastardLoop\w*Enabled)\(v,quiet\)\]/g)){
  const [,key,id,on,buffer,set]=match;ctx[on]=key==='V';ctx[buffer]=['V','W'].includes(key)?{}:null;
  ctx[set]=value=>{assert(ctx[buffer]||!value,'Never enable an unloaded lane');ctx[on]=value};
  elements.set(id,{value:'50',dispatchEvent(){this.applied=Number(this.value)}});
 }
 elements.set('lpfCutoff',{value:'12000',min:'500',dispatchEvent(){}});ctx.document={getElementById:id=>elements.get(id)};
 return {ctx,elements,apply:vm.runInNewContext(script,ctx)};
}
test('changes real active controls, wakes a loaded disabled lane, and restores the original boundary',()=>{
 const {ctx,elements,apply}=fixture();const original=apply({amount:0,pick:0,hat:false});assert.deepEqual([...original.added],[]);
 const mid=apply({amount:.5,pick:0,hat:false});assert.equal(ctx.bastardLoopWEnabled,true);assert.deepEqual([...mid.added],['W']);
 assert.equal(elements.get('performanceBastardLoopWLevel').applied,30);assert.equal(elements.get('performanceBastardLoopVLevel').applied,25);
 apply({amount:0,pick:0,hat:false});assert.equal(ctx.bastardLoopWEnabled,false);assert.equal(elements.get('performanceBastardLoopWLevel').applied,50);assert.equal(elements.get('performanceBastardLoopVLevel').applied,50);
});
test('subtle additions are quieter than moderate; no missing source is activated',()=>{
 const a=fixture(),b=fixture();a.apply({amount:.25,pick:0});b.apply({amount:.5,pick:0});assert(a.elements.get('performanceBastardLoopWLevel').applied<b.elements.get('performanceBastardLoopWLevel').applied);
});
function musicalFixture(options){
 const f=fixture(),c=f.ctx;Object.assign(c,{drumMachineEnabled:true,drumMachineSnareBuffer:{},drumMachineSnarePattern:Array.from({length:16},(_,i)=>i%8===4),drumMachineBaseAccents:{snare:Array(16).fill(false)},drumMachineRoll:require('../drum-roll.js').normalize({length:64}),isDrumMachineLaneAudible:()=>true});
 c.window.MygrainDrumRoll=require('../drum-roll.js');c.noteNameToMidi=note=>{const m=/^([A-G])(#?)(-?\d)$/.exec(note);return (Number(m[3])+1)*12+({C:0,D:2,E:4,F:5,G:7,A:9,B:11})[m[1]]+(m[2]?1:0)};
 c.midiToNoteName=n=>['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n%12]+(Math.floor(n/12)-1);
 for(const key of ['L','X']){c['bastardLoop'+key+'Sequence']=Array.from({length:64},(_,i)=>({note:i%4===0?'C3':'',rest:i%4!==0,accent:false,slide:false,ratchet:1}));c['bastardLoop'+key+'Enabled']=true;c['bastardLoop'+key+'SampleBuffer']={};c['getBastardLoop'+key+'PatternLength']=()=>16;c['hasBastardLoop'+key+'PlaybackSource']=()=>true;c['getBastardLoop'+key+'RootNote']=()=> 'C3';c['getBastardLoop'+key+'StepDurationSeconds']=()=>.125;}
 const plan=require('../scripts/instareel-plan.cjs').plan({bpm:120,patternSteps:16},30,'subtle',123,options);
 const prepared=f.apply.prepare(plan);return {...f,plan,prepared};
}
test('note option changes a bounded number of root/fifth notes only in used lanes and restores both sequences',()=>{
 const f=musicalFixture({notes:true,drums:false}),c=f.ctx,original=JSON.stringify(c.bastardLoopLSequence),x=JSON.stringify(c.bastardLoopXSequence);
 const event=f.plan.events.find(e=>e.amount>0);f.apply(event);
 for(const key of ['L','X']){const seq=c['bastardLoop'+key+'Sequence'];assert.notEqual(JSON.stringify(seq),original);const changed=seq.filter((s,i)=>JSON.stringify(s)!==JSON.stringify(JSON.parse(original)[i]));assert.equal(changed.length,1);assert([0,7].includes(c.noteNameToMidi(changed[0].note)%12));}
 f.apply(f.plan.events.at(-1));assert.equal(JSON.stringify(c.bastardLoopLSequence),original);assert.equal(JSON.stringify(c.bastardLoopXSequence),x);
 c.hasBastardLoopLPlaybackSource=()=>false;f.apply(event);assert.equal(JSON.stringify(c.bastardLoopLSequence),original);
});
test('unchecked options leave note/drum sequences and Roll exactly unchanged',()=>{
 const f=musicalFixture({notes:false,drums:false}),c=f.ctx,before=JSON.stringify([c.bastardLoopLSequence,c.bastardLoopXSequence,c.drumMachineRoll,c.drumMachineHatPattern,c.drumMachineBaseAccents]);
 for(const e of f.plan.events)f.apply(e);assert.equal(JSON.stringify([c.bastardLoopLSequence,c.bastardLoopXSequence,c.drumMachineRoll,c.drumMachineHatPattern,c.drumMachineBaseAccents]),before);assert.equal(f.prepared.fills,0);
});
test('Roll fills compile before scheduling with quiet short hits, no opening/closing fill and no missing-snare fallback',()=>{
 const f=musicalFixture({notes:false,drums:true}),c=f.ctx;assert(f.prepared.fills>0);assert.equal(c.drumMachineRoll.length,240);
 const offset=Math.round(f.plan.warmup/.125);for(let i=0;i<240;i++){const index=(offset+i)%240;if(c.drumMachineRoll.pattern[index]){assert(i>=16&&i<224);assert(c.drumMachineRoll.dips[index]);assert(c.drumMachineRoll.ratchets[index]<=2)}}
 const g=musicalFixture({notes:false,drums:false});g.ctx.drumMachineSnareBuffer=null;assert.equal(g.apply.prepare(f.plan).fills,0);
});
test('precompiled Roll preserves independently repeating existing notes, ratchets and dip',()=>{
 const f=musicalFixture({notes:false,drums:false}),c=f.ctx,roll=c.window.MygrainDrumRoll.normalize({length:64,dip:70});roll.pattern[20]=true;roll.ratchets[20]=3;roll.dips[20]=true;roll.accents[20]=true;c.drumMachineRoll=roll;
 const p=require('../scripts/instareel-plan.cjs').plan({bpm:120,patternSteps:16,patternCycleMultiplier:4},32,'subtle',123,{drums:true});f.apply.prepare(p);
 assert.equal(c.drumMachineRoll.dip,70);for(let i=20;i<c.drumMachineRoll.length;i+=64){assert(c.drumMachineRoll.pattern[i]);assert.equal(c.drumMachineRoll.ratchets[i],3);assert(c.drumMachineRoll.dips[i]);assert(c.drumMachineRoll.accents[i])}
});
