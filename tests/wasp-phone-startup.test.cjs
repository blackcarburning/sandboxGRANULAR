'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const DSP=require('../wasp-dsp.js');
function processor(settings,keys=['V','X']){
 const registered={},messages=[];
 const scope={sampleRate:48000,MygrainWasp:DSP,AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m),onmessage:null}}},registerProcessor:(name,type)=>registered[name]=type};
 scope.globalThis=scope;
 const source=fs.readFileSync(process.env.MYGRAIN_WASP_PHONE_MODULE||path.join(__dirname,'../wasp-worklet-phone.js'),'utf8').replace(/^import .*;\s*$/gm,'');
 vm.runInNewContext(source,scope);
 const node=new registered['mygrain-wasp-v1']({processorOptions:{settings,keys}});
 const inputs=keys.map(()=>[new Float32Array(128).fill(.03),new Float32Array(128).fill(.03)]),outputs=keys.map(()=>[new Float32Array(128),new Float32Array(128)]);
 return{node,messages,tick:()=>node.process(inputs,outputs),outputs};
}
test('phone startup warms the bus graph with routes bypassed, then applies both requested sources unchanged',()=>{
 const s=DSP.preset('Melt');s.enabled=true;s.routes[1].enabled=true;
 const p=processor(s);
 assert(p.node.engine.settings.routes.every(r=>!r.enabled));
 assert(p.node.engine.delays.every(row=>row.every(v=>v===null)));
 for(let i=0;i<15;i++){assert(p.tick());assert(p.node.engine.settings.routes.every(r=>!r.enabled))}
 assert(p.tick());assert.deepEqual(p.node.engine.settings,s);assert.equal(p.messages.filter(m=>m.warmed).length,1);
 for(let i=0;i<20;i++)assert(p.tick());
 assert(p.outputs.every(bus=>bus.every(channel=>channel.every(Number.isFinite))));
 assert.equal(p.messages.filter(m=>m.warmed).length,1);
});
test('edits during warmup win over the initial route settings',()=>{
 const s=DSP.preset('Rust');s.enabled=true;const p=processor(s);
 p.tick();const next=DSP.normalize(s);next.routes[0].enabled=false;next.routes[1].enabled=true;next.routes[1].depth=.21;
 p.node.port.onmessage({data:{settings:next,keys:['V','X']}});
 for(let i=0;i<16;i++)p.tick();assert.deepEqual(p.node.engine.settings,next);
});
test('disposing during warmup cannot rearm routes or emit a false ready message',()=>{
 const p=processor({...DSP.preset('Melt'),enabled:true});p.tick();p.node.port.onmessage({data:{dispose:true}});
 for(let i=0;i<20;i++)assert.equal(p.tick(),false);
 assert.equal(p.messages.filter(m=>m.warmed).length,0);assert.equal(p.messages.filter(m=>m.disposed).length,1);
 assert.equal(p.node.engine.delays.length,0);
});
