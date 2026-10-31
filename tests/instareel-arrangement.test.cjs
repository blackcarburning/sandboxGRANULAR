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
 ctx.MygrainVocalCut=require('../vocal-loop-cut.js');
 for(const suffix of ['','2','3','V','W']){
  ctx['bastardLoop'+suffix+'Cut']=ctx.MygrainVocalCut.normalize();
  ctx['getBastardLoop'+suffix+'LevelValue']=()=>ctx['bastardLoop'+suffix+'Enabled']?Number(elements.get('performanceBastardLoop'+suffix+'Level').value)/100:0;
  ctx['getBastardLoop'+suffix+'CycleDuration']=()=>2;
  ctx['setBastardLoop'+suffix+'Cut']=value=>ctx['bastardLoop'+suffix+'Cut']=ctx.MygrainVocalCut.normalize(value);
 }

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
 const f=fixture(),c=f.ctx;Object.assign(c,{drumMachineEnabled:true,drumMachineSnareBuffer:{},drumMachineSnarePattern:Array.from({length:16},(_,i)=>i%8===4),drumMachineBaseAccents:{snare:Array(16).fill(false)},drumMachineRoll:require('../drum-roll.js').normalize({length:64}),drumMachineLaneSolos:[],restoreDrumMachineLaneSolos:value=>c.drumMachineLaneSolos=[...value],isDrumMachineLaneAudible:kind=>!c.drumMachineLaneSolos.length||c.drumMachineLaneSolos.includes(kind)});
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
 const tones=new Set(),drivers=new Set(),entries=[];
 for(const e of p.events){const result=apply(e);entries.push(result.added.includes('N'));if(result.added.includes('N')){assert(state.level>=3&&state.level<=7);assert(state.filterEnabled);assert.equal(state.poles,4);assert(state.amount>=2);assert(state.decay<=85);assert.equal(state.sustain,0);tones.add(state.cutoff);drivers.add(state.source)}}
 assert(entries.some(Boolean));assert(entries.slice(1,-1).some(x=>!x));assert(tones.size>1);assert(drivers.has('sample'));assert(c.window.mygrainNoise.running);assert.deepEqual(state,original);
 c.hasAnyPerformanceLayerSoloSelection=()=>true;c.loopLayerSolo=['bastardv'];assert(!apply(p.events[1]).added.includes('N'));assert.deepEqual(state,original);
});
test('V optional alternating original, fresh cuts every developed repeat; A/B/C/W never alternate back',()=>{
 const f=fixture(),c=f.ctx,plan=require('../scripts/instareel-plan.cjs').plan({bpm:120,patternSteps:64},32,'subtle',123,{recutV:true});
 for(const suffix of ['','2','3','W']){c['bastardLoop'+suffix+'Enabled']=true;c['bastardLoop'+suffix+'Buffer']={}}
 const apply=vm.runInNewContext(script,c);apply.prepare(plan);
 const originals=Object.fromEntries(['','2','3','V','W'].map(suffix=>[suffix,JSON.stringify(c['bastardLoop'+suffix+'Cut'])]));
 const timeline=apply.cutEvents(),seen={},widths={};
 for(const event of timeline){
  const cut=apply.cut(event),suffix={A:'',B:'2',C:'3',V:'V',W:'W'}[event.key];
  if(event.restore){assert.equal(JSON.stringify(cut),originals[suffix]);continue}
  if(event.key==='V')assert.equal(event.repeat%2,1);
  const width=Number((cut.end-cut.start).toFixed(6));assert.notEqual(width,widths[event.key]);widths[event.key]=width;
  const key=JSON.stringify(cut);assert.notEqual(key,originals[suffix]);assert.notEqual(key,seen[event.key]);seen[event.key]=key;
 }
 assert.deepEqual(Array.from(timeline.filter(e=>e.key==='V'&&e.at>0&&e.at<28).slice(0,6),e=>e.restore),[false,true,false,true,false,true]);
 for(const key of ['A','B','C','W']){const events=timeline.filter(e=>e.key===key&&e.at>0&&e.at<28);assert(events.length>8);assert(events.every(e=>!e.restore));assert.equal(events[1].at-events[0].at,2)}
 for(const suffix of ['','2','3','V','W'])assert.equal(JSON.stringify(c['bastardLoop'+suffix+'Cut']),originals[suffix]);
});
test('V option off is untouched; native lane lengths, existing cut regions, solos and boundaries are respected',()=>{
 const f=fixture(),c=f.ctx;c.bastardLoopWEnabled=true;c.getBastardLoopWCycleDuration=()=>1;
 c.bastardLoopWCut=c.MygrainVocalCut.normalize({enabled:true,start:.25,end:.75,gapEnabled:true,gaps:[[.4,.45]]});
 const apply=vm.runInNewContext(script,c),p=require('../scripts/instareel-plan.cjs').plan({bpm:120,patternSteps:16},30,'extreme',123);
 apply.prepare(p);const timeline=apply.cutEvents();assert(!timeline.some(e=>e.key==='V'));assert.equal(timeline.filter(e=>e.key==='W')[1].at,1);
 const event=timeline.find(e=>e.key==='W'&&!e.restore);const next=apply.cut(event);assert(next.start>=.25&&next.end<=.75);assert.deepEqual([...next.gaps[0]],[.4,.45]);
 c.getBastardLoopWLevelValue=()=>0;assert.equal(JSON.stringify(apply.cut({...event,repeat:3})),JSON.stringify(c.MygrainVocalCut.normalize({enabled:true,start:.25,end:.75,gapEnabled:true,gaps:[[.4,.45]]})));
});
test('native-synth L is an eligible layer without a sample but empty sequences are not',()=>{
 const f=fixture(),c=f.ctx;c.bastardLoopWBuffer=null;c.hasPlayableBastardLoopLTransportSource=()=>true;c.setBastardLoopLEnabled=value=>c.bastardLoopLEnabled=value;
 const apply=vm.runInNewContext(script,c);assert(apply({amount:.25,pick:0,at:2,seed:4}).added.includes('L'));
 c.bastardLoopLEnabled=false;c.hasPlayableBastardLoopLTransportSource=()=>false;const empty=vm.runInNewContext(script,c);assert(!empty({amount:.25,pick:0,at:2,seed:4}).added.includes('L'));
});

test('native repeat phase and callback bounds survive unequal cycles; original V regions are exact',()=>{
 const f=fixture(),c=f.ctx;c.bastardLoopWEnabled=true;c.getBastardLoopWCycleDuration=()=>.75;
 c.bastardLoopVCut=c.MygrainVocalCut.normalize({enabled:true,start:.125,end:.875,repeat:false,stretch:true,fromStart:false,targetStart:.25,targetDuration:.5,gapEnabled:true,gaps:[[.4,.45]]});
 const original=JSON.stringify(c.bastardLoopVCut),apply=vm.runInNewContext(script,c),p=require('../scripts/instareel-plan.cjs').plan({bpm:120,patternSteps:16},30,'subtle',123,{recutV:true});apply.prepare(p);
 const timeline=apply.cutEvents();assert.equal(timeline.find(e=>e.key==='W'&&e.at>0).at,.25);
 for(const event of timeline.filter(e=>e.key==='V')){apply.cut(event);if(event.restore)assert.equal(JSON.stringify(c.bastardLoopVCut),original)}
 c.getBastardLoopWCycleDuration=()=>.01;assert(apply.cutEvents().filter(e=>e.key==='W').length<=514);
});

test('reel-only four-pole LFO and X/L envelope amounts vary and restore exactly',()=>{
 const f=fixture(),c=f.ctx,p=require('../scripts/instareel-plan.cjs').plan({bpm:120,patternSteps:16},60,'extreme',717);
 Object.assign(c,{lpfSlope:12,lpfEnabled:false,setFilterPoles:(key,poles)=>c.lpfSlope=poles*6,setFilterEnabled:(key,on)=>c.lpfEnabled=on});
 for(const key of ['L','X']){c['bastardLoop'+key+'Enabled']=true;f.elements.set('performanceBastardLoop'+key+'FilterEnvelope',{value:'30',dispatchEvent(){}})}
 const apply=vm.runInNewContext(script,c);apply.prepare(p);let moves=0;
 for(const e of p.events){apply(e);if(c.lpfSlope===24&&c.lpfEnabled){apply.tick(e.at+.1);const first=Number(f.elements.get('lpfCutoff').value);apply.tick(e.at+.4);assert.notEqual(Number(f.elements.get('lpfCutoff').value),first);moves++}}
 assert(moves>0);assert.equal(c.lpfSlope,12);assert.equal(c.lpfEnabled,false);assert.equal(Number(f.elements.get('lpfCutoff').value),12000);
 for(const key of ['L','X'])assert.equal(Number(f.elements.get('performanceBastardLoop'+key+'FilterEnvelope').value),30);
});

test('mix driver copies current sources only, excludes N feedback and disconnects at closure',()=>{
 const f=fixture(),c=f.ctx,DSP=require('../noise-card-dsp.js'),native={},target={},connected=new Set(),make=key=>({key,context:native,source:{connect:t=>{assert.equal(t,target);connected.add(key)},disconnect:t=>{assert.equal(t,target);connected.delete(key)}}});
 let state=DSP.normalize({enabled:false});c.drumMachineEnabled=true;c.window.mygrainNoise={mixDriverSources:()=>[],settings:()=>state,restore:s=>state=s,start(){},graph:{native,envelope:target},taps:new Set([make('V'),make('N')])};
 const apply=vm.runInNewContext(script,c),p=require('../scripts/instareel-plan.cjs').plan({bpm:120,patternSteps:16},30,'subtle',123);apply.prepare(p);
 let heard=false;for(const e of p.events){apply(e);apply.tick(e.at);assert(!connected.has('N'));if(state.enabled){assert.equal(state.source,'sample');assert(connected.has('V'));heard=true}}
 assert(heard);assert.equal(connected.size,0);apply.cleanup();assert.equal(connected.size,0);
});

test('Roll compiles each per-pattern rhythm and exact ratchets, including an existing shallow Dip',()=>{
 for(const variation of ['subtle','moderate','extreme'])for(const dip of [0,15,100]){
  const f=musicalFixture({drums:false}),c=f.ctx,old=c.window.MygrainDrumRoll.normalize({length:64,dip});
  old.pattern[0]=true;old.ratchets[0]=3;old.dips[0]=dip>0;c.drumMachineRoll=old;
  const p=require('../scripts/instareel-plan.cjs').plan({bpm:120,patternSteps:16},30,variation,123,{drums:true});
  assert(f.apply.prepare(p).fills>0);
  for(const fill of p.fills){const start=Math.round((p.warmup+fill.at)/.125);
   for(const note of fill.notes){const i=(start+note.step)%c.drumMachineRoll.length;if(i%64===0)continue;assert(c.drumMachineRoll.pattern[i]);assert.equal(c.drumMachineRoll.ratchets[i],note.ratchet);if(dip===100)assert(!c.drumMachineRoll.dips[i])}
  }
  assert.equal(c.drumMachineRoll.ratchets[0],3);
 }
});

test('Roll inserts only planned notes, retains colliding manual events and accepts older queued fill plans',()=>{
 const f=musicalFixture({drums:false}),c=f.ctx,p=require('../scripts/instareel-plan.cjs').plan({bpm:120,patternSteps:16},30,'moderate',123,{drums:true});
 const before=c.window.MygrainDrumRoll.normalize({length:64,dip:35}),first=p.fills[0],collision=(Math.round((p.warmup+first.at)/.125)+first.notes[0].step)%64;
 before.pattern[collision]=true;before.ratchets[collision]=7;before.dips[collision]=true;before.accents[collision]=true;c.drumMachineRoll=before;
 f.apply.prepare(p);const roll=c.drumMachineRoll,expected=new Map();
 for(let i=0;i<roll.length;i++)if(before.pattern[i%64])expected.set(i,{ratchet:7,manual:true});
 for(const fill of p.fills)for(const note of fill.notes){const i=(Math.round((p.warmup+fill.at)/.125)+note.step)%roll.length;if(!expected.has(i))expected.set(i,note)}
 for(let i=0;i<roll.length;i++){assert.equal(roll.pattern[i],expected.has(i));if(expected.has(i)){assert.equal(roll.ratchets[i],expected.get(i).ratchet);if(expected.get(i).manual){assert(roll.dips[i]);assert(roll.accents[i])}}}
 const g=musicalFixture({drums:false}),legacy={...p,version:7,fills:[{at:15.5,end:16,hits:4,ratchet:2}]};g.apply.prepare(legacy);
 assert.deepEqual(Array.from({length:4},(_,j)=>g.ctx.drumMachineRoll.ratchets[(16+124+j)%240]),[1,1,2,2]);
});

test('Roll development respects blocked lanes and disabled drums without touching the saved pattern',()=>{
 for(const blocked of ['roll','drums']){
  const f=musicalFixture({drums:false}),c=f.ctx,original=JSON.stringify(c.drumMachineRoll);
  if(blocked==='roll')c.isDrumMachineLaneAudible=lane=>lane!=='roll';else c.drumMachineEnabled=false;
  const p=require('../scripts/instareel-plan.cjs').plan({bpm:120,patternSteps:16},30,'subtle',123,{drums:true});
  assert.equal(f.apply.prepare(p).fills,0);assert.equal(JSON.stringify(c.drumMachineRoll),original);
 }
});

test('reel Roll joins existing drum-lane solos additively; no solos stays unrestricted',()=>{
 for(const solos of [[],['kick'],['snare'],['hat'],['kick','hat'],['roll'],['kick','roll']]){
  const f=musicalFixture({drums:false}),c=f.ctx;c.drumMachineLaneSolos=solos.slice();let writes=0;
  c.restoreDrumMachineLaneSolos=value=>{writes++;c.drumMachineLaneSolos=[...value]};
  const p=require('../scripts/instareel-plan.cjs').plan({bpm:120,patternSteps:16},30,'subtle',123,{drums:true});
  assert(f.apply.prepare(p).fills>0);assert(c.isDrumMachineLaneAudible('roll'));
  assert.deepEqual(c.drumMachineLaneSolos,solos.length?[...new Set([...solos,'roll'])]:[]);
  assert.equal(writes,solos.length&&!solos.includes('roll')?1:0);
  for(const lane of ['kick','snare','hat','perc'])assert.equal(c.isDrumMachineLaneAudible(lane),!solos.length||solos.includes(lane));
  f.apply.prepare(p);assert.equal(writes,solos.length&&!solos.includes('roll')?1:0,'Repeated preparation must not duplicate Roll');
 }
});

test('Drums off, disabled drums and missing Snare preserve the original lane solos',()=>{
 for(const blocked of ['option','drums','snare']){
  const f=musicalFixture({drums:false}),c=f.ctx;c.drumMachineLaneSolos=['kick','hat'];
  c.restoreDrumMachineLaneSolos=()=>assert.fail('Ineligible reel must not change lane solos');
  if(blocked==='drums')c.drumMachineEnabled=false;
  if(blocked==='snare')c.drumMachineSnareBuffer=null;
  const p=require('../scripts/instareel-plan.cjs').plan({bpm:120,patternSteps:16},30,'subtle',123,{drums:blocked!=='option'});
  assert.equal(f.apply.prepare(p).fills,0);assert.deepEqual(c.drumMachineLaneSolos,['kick','hat']);
 }
});

test('protected layers retain levels, enabled states, notes, drums, cuts and master filter',()=>{
 const f=musicalFixture({notes:true,drums:true,recutV:true,protectedLayers:['V','W','L','X','DRUMS','GLOBAL']}),c=f.ctx;
 const before=JSON.stringify([c.bastardLoopVEnabled,c.bastardLoopWEnabled,c.bastardLoopLSequence,c.bastardLoopXSequence,c.drumMachineRoll,c.drumMachineHatPattern,c.drumMachineHatRatchetPattern,c.drumMachineBaseAccents,c.bastardLoopVCut,c.bastardLoopWCut]);
 const levels=['V','W','L','X'].map(k=>f.elements.get('performanceBastardLoop'+k+'Level').value);
 for(const e of f.plan.events)f.apply(e);
 for(const e of f.apply.cutEvents())f.apply.cut(e);
 f.apply.cut({key:'V',restore:false});f.apply.tick(12);
 assert.equal(JSON.stringify([c.bastardLoopVEnabled,c.bastardLoopWEnabled,c.bastardLoopLSequence,c.bastardLoopXSequence,c.drumMachineRoll,c.drumMachineHatPattern,c.drumMachineHatRatchetPattern,c.drumMachineBaseAccents,c.bastardLoopVCut,c.bastardLoopWCut]),before);
 assert.deepEqual(['V','W','L','X'].map(k=>f.elements.get('performanceBastardLoop'+k+'Level').value),levels);
 assert.equal(f.prepared.fills,0);assert.equal(f.elements.get('lpfCutoff').value,'12000');
 assert(!f.apply.cutEvents().some(e=>['V','W'].includes(e.key)));
});
test('protecting one layer still permits the others to develop',()=>{
 const f=musicalFixture({notes:true,drums:true,protectedLayers:['L']});
 const l=JSON.stringify(f.ctx.bastardLoopLSequence),x=JSON.stringify(f.ctx.bastardLoopXSequence);
 f.apply(f.plan.events.find(e=>e.amount>0));assert.equal(JSON.stringify(f.ctx.bastardLoopLSequence),l);assert.notEqual(JSON.stringify(f.ctx.bastardLoopXSequence),x);
});
test('generated Roll fills never add ducking over a protected layer',()=>{
 const f=musicalFixture({drums:true,protectedLayers:['L']});
 assert(f.prepared.fills>0);
 assert(f.ctx.drumMachineRoll.pattern.some(Boolean));
 assert(!f.ctx.drumMachineRoll.dips.some(Boolean));
});
