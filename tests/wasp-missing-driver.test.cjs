'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),W=require('../wasp-dsp.js');
for(const method of W.METHODS)for(const missing of ['unregistered','disconnected'])test(`100% wet ${method} remains audible with ${missing} driver`,()=>{
 const e=new W.Engine(48000,2),s=W.normalize();s.blend=1;s.routes[0]={...s.routes[0],enabled:true,source:'V',destination:'A',method,mode:'audio',depth:1};e.update(s,['A',missing==='unregistered'?null:'V']);let energy=0;
 for(let block=0;block<180;block++){const a=Float32Array.from({length:128},(_,f)=>.1*Math.sin(2*Math.PI*220*(block*128+f)/48000)),out=Array.from({length:2},()=>[new Float32Array(128),new Float32Array(128)]);e.process([[a,a],[]],out);if(block>100)for(const x of out[0][0]){assert(Number.isFinite(x));energy+=x*x;}}
 assert(energy>1,'missing source erased carrier');
});
test('disconnect fades a gated carrier back in and reconnect restores intentional gating',()=>{
 const e=new W.Engine(48000,2),s=W.normalize();s.blend=1;s.routes[0]={...s.routes[0],enabled:true,source:'V',destination:'A',method:'am',depth:1};e.update(s,['A','V']);const tone=new Float32Array(128),silence=new Float32Array(128),out=Array.from({length:2},()=>[new Float32Array(128),new Float32Array(128)]);let frame=0;
 const render=driver=>{for(let i=0;i<128;i++)tone[i]=.1*Math.sin(2*Math.PI*220*frame++/48000);e.process([[tone,tone],driver],out);return out[0][0].reduce((sum,x)=>sum+x*x,0);};
 for(let i=0;i<150;i++)render([silence,silence]);assert(render([silence,silence])<1e-10);
 for(let i=0;i<150;i++)render([]);assert(render([])>.1);
 for(let i=0;i<150;i++)render([silence,silence]);assert(render([silence,silence])<1e-10);
});
