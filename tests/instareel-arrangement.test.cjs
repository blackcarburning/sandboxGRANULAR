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
