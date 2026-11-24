'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const base=require('node:path').resolve(__dirname,'..'),stage=base,B=require(base+'/scripts/dfeeder-balance.cjs');
for(const rate of [44100,48000]){let W;const messages=[],scope={sampleRate:rate,currentFrame:0,MygrainLoopBalance:B,AudioWorkletProcessor:class{constructor(){this.port={postMessage:data=>messages.push(data)}}},registerProcessor:(_,c)=>W=c};
 vm.runInNewContext(fs.readFileSync(stage+'/random-balance-worklet.js','utf8').replace(/^import .*;$/gm,''),scope);
 const routes=[{family:'drums',scale:.7},{family:'drums',scale:.7},{family:'d',scale:.7}],w=new W({processorOptions:{routes}}),reference={drums:new B.Integrated(rate),d:new B.Integrated(rate)},n=Math.round(rate*2/128)*128;
 w.port.onmessage({data:{arm:{start:0,end:n}}});
 for(let at=0;at<=n;at+=128){scope.currentFrame=at;const inputs=routes.map((_,r)=>[0,1].map(ch=>Float32Array.from({length:128},(_,i)=>.1*(r+1)*(ch?.4:1)*Math.sin(2*Math.PI*(90+r*110)*(at+i)/rate)))),out=[[new Float32Array(128),new Float32Array(128)]];w.process(inputs,out);assert(out[0].every(ch=>ch.every(x=>x===0)),'meter output must stay silent');if(at<n)for(let i=0;i<128;i++){reference.drums.process((inputs[0][0][i]+inputs[1][0][i])*.7,(inputs[0][1][i]+inputs[1][1][i])*.7);reference.d.process(inputs[2][0][i]*.7,inputs[2][1][i]*.7);}}
 const measured=messages.find(m=>m.measured)?.measured;assert(measured);for(const key of ['drums','d']){const actual=reference[key].result();assert(Math.abs(actual.lufs-measured[key].lufs)<1e-10);assert(Math.abs(actual.peak-measured[key].peak)<1e-14);assert.equal(actual.frames,measured[key].frames);}w.port.onmessage({data:{dispose:true}});assert.equal(w.process([],[[new Float32Array(128)]]),false);
 console.log('PASS',rate,'Hz: exact stereo multi-route post-FX metering, bounded full-cycle window, silent observer and disposal');
}
for(const hasD of [false,true]){
 let W;const messages=[],rate=48000,scope={sampleRate:rate,currentFrame:0,MygrainLoopBalance:B,AudioWorkletProcessor:class{constructor(){this.port={postMessage:x=>messages.push(x)}}},registerProcessor:(_,c)=>W=c};
 vm.runInNewContext(fs.readFileSync(stage+'/random-balance-worklet.js','utf8').replace(/^import .*;$/gm,''),scope);
 const routes=[{family:'drums',scale:.6},{family:'restructure',scale:.35},...(hasD?[{family:'d',scale:.8}]:[])],w=new W({processorOptions:{routes}}),n=48000;
 for(const amplitude of [.8,.1]){w.port.onmessage({data:{arm:{start:0,end:n}}});for(let at=0;at<=n;at+=128){scope.currentFrame=at;const inputs=routes.map((r,k)=>[0,1].map(c=>Float32Array.from({length:128},(_,i)=>amplitude*(k+1)*(c?.5:1)*Math.sin(2*Math.PI*(150+k*500)*(at+i)/rate))));w.process(inputs,[[new Float32Array(128),new Float32Array(128)]]);}}
 assert.equal(messages.length,2);assert.equal(!!messages[0].measured.d,hasD);assert(messages[0].measured.restructure.peak>messages[1].measured.restructure.peak*7.9);assert.equal(messages[1].measured.restructure.frames,n);
}
console.log('PASS optional Restructure without D, source-specific post-FX scaling and fresh remeasurement windows');
