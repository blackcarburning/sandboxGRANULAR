'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(process.env.ADAPTER||path.join(__dirname,'../song-beta-adapter.js'),'utf8'),start=source.indexOf('        function run(label, action,'),end=source.indexOf('        function recordAI(',start);
assert(start>=0&&end>start);
function fixture(){
 const state={enabled:true,stops:0,saves:0},scope={restoring:false,busy:false,generation:0,initializing:false,undo:[],redo:[],historyLimit:10,
  window:{mygrainRobot:{randomiseOff(){state.enabled=false;state.stops++;return true;}}},
  assertReady(){},capture:()=>({enabled:state.enabled}),update(){},persist(){},saveState(){state.saves++;},applyGeneratedLXEnvelope(){},
  delta:()=>({json:[{}],buffers:[],piano:null})};
 return {state,run:vm.runInNewContext(source.slice(start,end)+'\nrun',scope)};
}
for(const label of ['Stir the cooking pot','BIG STIR cooking pot']){
 test(label+' preserves Robot after the effect transaction',async()=>{const f=fixture();await f.run(label,async()=>42);assert.deepEqual(f.state,{enabled:true,stops:0,saves:0});});
 test(label+' failure preserves Robot',async()=>{const f=fixture();await assert.rejects(f.run(label,async()=>{throw Error('Source unchanged');}),/Source unchanged/);assert.equal(f.state.stops,0);});
}
for(const label of ['Random patch','Mega / Sparse patch','Loop A pattern'])test(label+' retains full-generation Robot shutdown',async()=>{const f=fixture();await f.run(label,async()=>42);assert.equal(f.state.enabled,false);assert.equal(f.state.stops,1);});
test('Robot randomise grid remains source-local',()=>{const f=fixture();f.run('Robot randomise grid',()=>{});assert.equal(f.state.stops,0);});
