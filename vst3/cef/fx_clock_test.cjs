'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'fx_clock.h'),'utf8').match(/R"JS\(([\s\S]*)\)JS"/)[1];
let tick,hide,created=0,loads=0;const blobs=new Map(),processors=new Map();
const env={window:{mygrainDawFx:{connected:false}},audioContext:null,Blob:class{constructor(parts){this.text=parts.join('');}},URL:{createObjectURL(blob){const key='blob:'+blobs.size;blobs.set(key,blob.text);return key;},revokeObjectURL(url){blobs.delete(url);}},setInterval(fn){tick=fn;return 1;},clearInterval(){tick=null;},addEventListener(name,fn){assert.equal(name,'pagehide');hide=fn;},AudioWorkletNode:class{constructor(ctx,name,options){assert.equal(options.numberOfInputs,0);assert.equal(options.numberOfOutputs,0);this.processor=new (processors.get(name))();this.port={postMessage:d=>this.processor.port.onmessage({data:d})};created++;}}};
const makeContext=()=>({state:'running',audioWorklet:{async addModule(url){loads++;vm.runInNewContext(blobs.get(url),{AudioWorkletProcessor:class{constructor(){this.port={};}},registerProcessor:(name,processor)=>processors.set(name,processor)});}}});
vm.runInNewContext(script,env);
(async()=>{
 await tick();assert.equal(created,0,'no disconnected clock');env.window.mygrainDawFx.connected=true;env.audioContext={...makeContext(),startRendering(){}};await tick();assert.equal(created,0,'never alter OfflineAudioContext/Song rendering');
 env.audioContext=makeContext();await tick();assert(env.window.mygrainCefFxClock.ready);assert.equal(created,1);await tick();assert.equal(loads,1,'reuse main-context guard');assert.equal(blobs.size,0,'no retained module URL');
 env.audioContext=makeContext();await tick();assert.equal(created,2,'replace guard after engine replacement');hide();assert(!env.window.mygrainCefFxClock.ready);assert.equal(tick,null);
 console.log('PASS FX-only zero-output clock guard, offline exclusion, context replacement and navigation cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
