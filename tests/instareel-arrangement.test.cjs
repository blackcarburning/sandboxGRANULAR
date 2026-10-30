'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const script=require('../scripts/instareel-arrangement.cjs');
function fixture(){
 const elements=new Map(),ctx={window:{},Event:class{},drumMachineEnabled:false,drumMachineHatBuffer:null,drumMachineHatPattern:[],drumMachineHatAccentPattern:[],drumMachineHatRatchetPattern:Array(16).fill(0),getPatternLengthSteps:()=>16};
 for(const match of script.matchAll(/\['([^']+)','([^']+)',(bastardLoop\w*Enabled),!!(bastardLoop\w*),v=>(setBastardLoop\w*Enabled)\(v,quiet\)\]/g)){
  const [,key,id,on,buffer,set]=match;ctx[on]=key==='V';ctx[buffer]=['V','W'].includes(key)?{}:null;
  ctx[set]=value=>{assert(ctx[buffer]||!value,'Never enable an unloaded lane');ctx[on]=value};
  elements.set(id,{value:'50',dispatchEvent(){this.applied=Number(this.value)}});
 }
 ctx.MygrainVocalCut=require('../vocal-loop-cut.js');ctx.bastardLoopVCut=ctx.MygrainVocalCut.normalize();ctx.bastardLoopWCut=ctx.MygrainVocalCut.normalize();
 for(const key of ['V','W']){ctx['getBastardLoop'+key+'LevelValue']=()=>ctx['bastardLoop'+key+'Enabled']?Number(elements.get('performanceBastardLoop'+key+'Level').value)/100:0;ctx['setBastardLoop'+key+'Cut']=(value)=>ctx['bastardLoop'+key+'Cut']=ctx.MygrainVocalCut.normalize(value)}
 ctx.hasPlayableBastardLoopLTransportSource=()=>!!ctx.bastardLoopLSampleBuffer;ctx.hasPlayableBastardLoopXTransportSource=()=>!!ctx.bastardLoopXSampleBuffer;
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
 const f=musicalFixture({notes:false,drums:false}),c=f.ctx,before=JSON.stringify([c.bastardLoopLSequence,c.bastardLoopXSequence,c.drumMachineRoll,c.drumMachineHatPattern,c.drumMachineHatRatchetPattern,c.drumMachineBaseAccents]);
 for(const e of f.plan.events)f.apply(e);assert.equal(JSON.stringify([c.bastardLoopLSequence,c.bastardLoopXSequence,c.drumMachineRoll,c.drumMachineHatPattern,c.drumMachineHatRatchetPattern,c.drumMachineBaseAccents]),before);assert.equal(f.prepared.fills,0);
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
test('successive loops retain prior bass changes, develop gradually within a cap and restore at the join',()=>{
 const f=musicalFixture({notes:true,drums:false}),c=f.ctx,original=JSON.parse(JSON.stringify(c.bastardLoopXSequence)),events=f.plan.events.filter(e=>e.amount>0);
 f.apply(events[0]);const first=JSON.parse(JSON.stringify(c.bastardLoopXSequence)),firstIndex=first.findIndex((s,i)=>JSON.stringify(s)!==JSON.stringify(original[i]));
 f.apply(events[1]);const second=JSON.parse(JSON.stringify(c.bastardLoopXSequence));assert.deepEqual(second[firstIndex],first[firstIndex]);assert.equal(second.filter((s,i)=>JSON.stringify(s)!==JSON.stringify(original[i])).length,2);
 const stages=new Set([JSON.stringify(first),JSON.stringify(second)]);
 for(const event of events.slice(2)){f.apply(event);stages.add(JSON.stringify(c.bastardLoopXSequence));assert(c.bastardLoopXSequence.filter((s,i)=>JSON.stringify(s)!==JSON.stringify(original[i])).length<=4)}assert(stages.size>=5);
 f.apply(f.plan.events.at(-1));assert.equal(JSON.stringify(c.bastardLoopXSequence),JSON.stringify(original));
});
test('hat and backbeat detail carries into following loops without unbounded density growth',()=>{
 const f=musicalFixture({notes:false,drums:true}),c=f.ctx;c.drumMachineHatBuffer={};c.drumMachineHatPattern=Array(16).fill(false);c.drumMachineHatAccentPattern=Array(16).fill(false);
 const events=f.plan.events.filter(e=>e.amount>0);f.apply(events[0]);const first=c.drumMachineHatPattern.findIndex(Boolean),accent=c.drumMachineBaseAccents.snare.slice();
 f.apply(events[1]);assert(c.drumMachineHatPattern[first]);assert.equal(c.drumMachineHatPattern.filter(Boolean).length,2);assert.equal(c.drumMachineBaseAccents.snare[4],accent[4]);
 for(const event of events.slice(2)){f.apply(event);assert(c.drumMachineHatPattern.filter(Boolean).length<=2)}
 f.apply(f.plan.events.at(-1));assert(!c.drumMachineHatPattern.some(Boolean));assert(!c.drumMachineBaseAccents.snare.some(Boolean));
});

test('temporary hat ratchets enter periodically, withdraw next loop and preserve manual ratchets',()=>{
 const f=musicalFixture({drums:true}),c=f.ctx;c.drumMachineHatBuffer={};
 const events=f.plan.events.filter(e=>e.amount>0);
 const states=[];for(const event of events){f.apply(event);states.push(c.drumMachineHatRatchetPattern.some(n=>n>1))}
 assert.deepEqual(states.slice(0,7),[true,false,false,true,false,false,true]);
 f.apply(f.plan.events.at(-1));assert(!c.drumMachineHatRatchetPattern.some(n=>n>1));
 const g=fixture();g.ctx.drumMachineHatRatchetPattern[2]=4;
 // Baseline is captured when the isolated script is evaluated, before preparation.
 const apply=vm.runInNewContext(script,g.ctx);Object.assign(g.ctx,{drumMachineEnabled:true,drumMachineHatBuffer:{},drumMachineSnareBuffer:null,drumMachineBaseAccents:{snare:[]},isDrumMachineLaneAudible:()=>true});
 apply.prepare(f.plan);for(const event of f.plan.events){apply(event);assert.equal(g.ctx.drumMachineHatRatchetPattern[2],4)}
});

test('generated ratchets respect hat audibility and stay outside the queued closing section',()=>{
 const f=musicalFixture({drums:true}),c=f.ctx;c.drumMachineHatBuffer={};c.isDrumMachineLaneAudible=()=>false;
 const events=f.plan.events.filter(e=>e.amount>0);for(const event of events){f.apply(event);assert(!c.drumMachineHatRatchetPattern.some(n=>n>1))}
 c.isDrumMachineLaneAudible=()=>true;f.apply(f.plan.events[0]);
 for(const event of events){f.apply(event);if(event.at+2>=f.plan.events.at(-1).at)assert(!c.drumMachineHatRatchetPattern.some(n=>n>1))}
});

test('moderate hat bursts use three hits then return to unratcheted steps',()=>{
 const f=musicalFixture({drums:true}),c=f.ctx;c.drumMachineHatBuffer={};f.plan.variation='moderate';
 const events=f.plan.events.filter(e=>e.amount>0);f.apply(events[0]);assert(c.drumMachineHatRatchetPattern.includes(3));
 f.apply(events[1]);assert(!c.drumMachineHatRatchetPattern.some(n=>n>1));
});

test('four-second sections also withdraw ratchets before the two-second queued closing boundary',()=>{
 const f=musicalFixture({drums:true}),c=f.ctx;c.drumMachineHatBuffer={};
 const plan=require('../scripts/instareel-plan.cjs').plan({bpm:120,patternSteps:32},60,'subtle',123,{drums:true});f.apply.prepare(plan);
 for(const event of plan.events){f.apply(event);if(c.drumMachineHatRatchetPattern.some(n=>n>1))assert(event.at+4+2<=plan.events.at(-1).at)}
});

test('N enters even with no dormant sample lanes, withdraws and restores original settings',()=>{
 const f=fixture(),c=f.ctx,DSP=require('../noise-card-dsp.js'),original=DSP.normalize({enabled:false,level:0,source:'drums',cutoff:80,poles:16});let state={...original};
 c.window.mygrainNoise={settings:()=>state,restore:value=>state={...value},start(){this.running=true},running:false};c.bastardLoopWBuffer=null;
 const apply=vm.runInNewContext(script,c),p=require('../scripts/instareel-plan.cjs').plan({bpm:120,patternSteps:16},30,'subtle',123);apply.prepare(p);
 assert(apply(p.events[1]).added.includes('N'));assert.equal(state.enabled,true);assert.equal(state.level,6);assert.equal(state.filterType,'bandpass');assert(c.window.mygrainNoise.running);
 apply(p.events[3]);assert.deepEqual(state,original);apply(p.events.at(-1));assert.deepEqual(state,original);
 c.hasAnyPerformanceLayerSoloSelection=()=>true;c.loopLayerSolo=['bastardv'];assert(!apply(p.events[1]).added.includes('N'));assert.deepEqual(state,original);
});
test('V/W re-cuts retain source bounds and exact original closure; Extreme cuts are stronger',()=>{
 const f=musicalFixture({notes:false,drums:false}),c=f.ctx,p=f.plan;
 f.apply(p.events[1]);assert(c.bastardLoopVCut.gaps.length>0);
 f.apply(p.events[2]);assert(c.bastardLoopVCut.repeat);assert.equal(c.bastardLoopVCut.end-c.bastardLoopVCut.start,.75);
 p.variation='extreme';f.apply(p.events[2]);assert.equal(c.bastardLoopVCut.end-c.bastardLoopVCut.start,.25);
 f.apply(p.events.at(-1));assert.deepEqual(c.bastardLoopVCut,c.MygrainVocalCut.normalize());assert.deepEqual(c.bastardLoopWCut,c.MygrainVocalCut.normalize());
});
test('native-synth L is an eligible layer without a sample but empty sequences are not',()=>{
 const f=fixture(),c=f.ctx;c.bastardLoopWBuffer=null;c.hasPlayableBastardLoopLTransportSource=()=>true;c.setBastardLoopLEnabled=value=>c.bastardLoopLEnabled=value;
 const apply=vm.runInNewContext(script,c);assert(apply({amount:.25,pick:0,at:2,seed:4}).added.includes('L'));
 c.bastardLoopLEnabled=false;c.hasPlayableBastardLoopLTransportSource=()=>false;const empty=vm.runInNewContext(script,c);assert(!empty({amount:.25,pick:0,at:2,seed:4}).added.includes('L'));
});
