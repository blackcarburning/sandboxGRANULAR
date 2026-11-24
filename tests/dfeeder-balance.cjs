'use strict';
const assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),fs=require('node:fs'),vm=require('node:vm');
const B=require('../scripts/dfeeder-balance.cjs'),Master=require('../mastering-dsp.js');
for(const rate of [44100,48000])for(const hz of [50,1000,8000]){
 const m=new B.Integrated(rate),n=rate*6,pcm=Buffer.alloc(n*8);
 for(let i=0;i<n;i++){const a=i<rate||i>=5*rate?0:.1*Math.sin(2*Math.PI*hz*i/rate),b=a*.3;m.process(a,b);pcm.writeFloatLE(a,i*8);pcm.writeFloatLE(b,i*8+4);}
 const ff=spawnSync('ffmpeg',['-hide_banner','-f','f32le','-ar',String(rate),'-ac','2','-i','pipe:0','-af','ebur128=peak=none','-f','null','-'],{input:pcm,maxBuffer:4e6});assert.equal(ff.status,0);const target=Number([...ff.stderr.toString().matchAll(/I:\s*([\d.-]+) LUFS/g)].at(-1)[1]);assert(Math.abs(m.result().lufs-target)<.15,JSON.stringify({rate,hz,ours:m.result().lufs,target}));
}
assert.equal(new B.Integrated(48000).result().lufs,null);
for(const [d,e,wanted] of [[-20,-10,'down'],[-20,-35,'up'],[-20,-60,'quiet']]){const v=B.decide({lufs:d,rms:.1,peak:.5},{lufs:e,rms:.01,peak:.03});assert(Number.isFinite(v.gain));if(wanted==='down')assert(v.effectiveLevel<.4);if(wanted==='up')assert(v.effectiveLevel>.4);if(wanted==='quiet')assert.equal(v.gain,1);}
const extreme=B.decide({lufs:-40,rms:.001,peak:.01},{lufs:0,rms:.7,peak:1});assert(extreme.gain<.025&&extreme.predictedEmberLufs<=extreme.aimLufs+.001);
assert.throws(()=>B.decide({lufs:null,rms:0},{lufs:-10,rms:.1}));assert.throws(()=>B.decide({lufs:-10,rms:.1},{lufs:null,rms:0}));
// Execute the actual worklet: decisions occur before saved PCM, remain fixed,
// preserve stereo ratio and do not leak the drum sidechain into Ember output.
for(const rate of [44100,48000])for(const amplitude of [.05,.5])for(const sourceKey of ['ember','d']){
 let W;const messages=[];class Base{constructor(){this.port={postMessage:x=>messages.push(x)};}}
 const scope={AudioWorkletProcessor:Base,sampleRate:rate,currentFrame:0,MygrainLoopBalance:B,MygrainMasterDSP:Master,registerProcessor:(n,c)=>{if(n==='mygrain-shop-ember-balance-v1')W=c}};vm.runInNewContext(fs.readFileSync(require.resolve('../scripts/dfeeder-balance-worklet.cjs'),'utf8'),scope);
 const w=new W({processorOptions:{startFrame:0,decisionFrame:rate*2,captureFrame:rate*3,endFrame:rate*6,drumScale:1,emberScale:1,sourceKey}});let lastGain;
 for(let at=0;at<rate*6+128;at+=128){scope.currentFrame=at;const el=new Float32Array(128),er=new Float32Array(128),dl=new Float32Array(128),dr=new Float32Array(128);for(let j=0;j<128;j++){el[j]=amplitude*Math.sin(2*Math.PI*700*(at+j)/rate);er[j]=el[j]*.4;dl[j]=dr[j]=.15*Math.sin(2*Math.PI*1000*(at+j)/rate);}const out=[new Float32Array(128),new Float32Array(128)];w.process([[el,er],[dl,dr]],[out]);if(at>=rate*3){for(let j=0;j<128;j++){assert(Math.abs(out[0][j]-el[j]*w.gain)<1e-7);assert(Math.abs(out[1][j]-er[j]*w.gain)<1e-7);}if(lastGain!==undefined)assert.equal(w.gain,lastGain);lastGain=w.gain;}}
 const applied=messages.find(m=>m.applied).applied,actual=messages.find(m=>m.verified).verified;assert.equal(messages.filter(m=>m.applied).length,1);if(sourceKey==='ember'){assert(Math.abs(actual.ember.lufs-actual.drums.lufs+6)<.15,JSON.stringify(actual));assert.equal(applied.effectiveLevel>.4,amplitude<.1);}else{assert(applied.gain<=1);assert(actual.d.lufs<=actual.drums.lufs+.15);if(amplitude<.1)assert.equal(applied.gain,1);}
}
console.log('PASS K-weighted integrated LUFS vs independent FFmpeg at 44.1/48 kHz; gates, silence, bounded up/down gain and actual fixed-trim worklet PCM');

// Conditional drum makeup must ignore louder/uneffected sources and reject
// silence, rather than amplifying a dead filter/noise floor.
const metric=(lufs,peak=.1)=>({lufs,peak,rms:.02,frames:96000});
assert.equal(B.drumMakeup(metric(-18),metric(-32),false).gain,1);
assert.equal(B.drumMakeup(metric(-18),metric(-12),true).gain,1);
assert(Math.abs(B.drumMakeup(metric(-18),metric(-32),true).gainDb-14)<1e-8);
assert(B.drumMakeup(metric(-10),metric(-45),true).gain<=8);
assert.throws(()=>B.drumMakeup(metric(-18),metric(-60),true));
for(const rate of [44100,48000])for(const wetFactor of [.15,1]){
 let W;const messages=[];class Base{constructor(){this.port={postMessage:x=>messages.push(x)};}}
 const scope={AudioWorkletProcessor:Base,sampleRate:rate,currentFrame:0,MygrainLoopBalance:B,registerProcessor:(n,c)=>{if(n==='mygrain-shop-postfx-balance-v1')W=c}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../scripts/dfeeder-balance-worklet.cjs'),'utf8'),scope);
 const routes=[{family:'drums',scale:.8},{family:'drums',scale:.8},{family:'ember',scale:.6},{family:'d',scale:.8}];
 const w=new W({processorOptions:{routes,rawScale:.8,hasD:true,drumEffected:wetFactor!==1,startFrame:0,decisionFrame:rate*2,captureFrame:rate*3,endFrame:rate*6}});
 for(let at=0;at<rate*6+128;at+=128){scope.currentFrame=at;const inputs=routes.map(()=>[new Float32Array(128),new Float32Array(128)]);inputs.push([new Float32Array(128),new Float32Array(128)]);
  for(let i=0;i<128;i++){const t=(at+i)/rate,k=.12*Math.sin(2*Math.PI*120*t),h=.04*Math.sin(2*Math.PI*2500*t),e=.2*Math.sin(2*Math.PI*600*t),d=.3*Math.sin(2*Math.PI*900*t);for(const [n,val]of [[0,k*wetFactor],[1,h*wetFactor],[2,e],[3,d],[4,k+h]]){inputs[n][0][i]=val;inputs[n][1][i]=val*.4;}}
  const outputs=routes.map(()=>[new Float32Array(128),new Float32Array(128)]);w.process(inputs,outputs);
  if(at>=rate*3)for(let n=0;n<routes.length;n++)for(let i=0;i<128;i++)for(let c=0;c<2;c++)assert(Math.abs(outputs[n][c][i]-inputs[n][c][i]*w.gains[routes[n].family])<1e-7,'Wrong family or sidechain leaked into output');
 }
 const applied=messages.find(m=>m.applied)?.applied,verified=messages.find(m=>m.verified)?.verified;assert(applied&&verified,JSON.stringify(messages));assert(Math.abs(applied.drumMakeup.gain-(1/wetFactor))<.01);assert(Math.abs(verified.drums.lufs-verified.raw.lufs)<.15);assert(Math.abs(verified.ember.lufs-verified.drums.lufs+6)<.15);assert(verified.d.lufs<=verified.drums.lufs+.15);assert(verified.d.peak<=verified.drums.peak*1.01);assert.equal(applied.referenceTap,'post-fx');
}
console.log('PASS post-FX family PCM, drum attenuation makeup, shared corrected drum reference and no cross-route leakage at 44.1/48 kHz');

assert(B.verifySaved(metric(-20,.3),metric(-26,.2),metric(-22,.25)));
assert.throws(()=>B.verifySaved(metric(-20,.3),metric(-18,.2)),/Ember/);
assert.throws(()=>B.verifySaved(metric(-20,.3),metric(-26,.4)),/Ember/);
assert.throws(()=>B.verifySaved(metric(-20,.3),metric(-26,.2),metric(-18,.25)),/D exceeded/);
assert.throws(()=>B.verifySaved(metric(-20,.3),{...metric(-26,.2),lufs:null}),/silent/);
console.log('PASS achieved saved-cycle audit rejects evolving effects that exceed the drum reference');

// Restructure-only families (native generator has no Ember), quiet/loud post-FX
// signals and nonlinear insert colour. Verify actual captured output, not merely
// predicted fader values, and ensure the drum sidechain never leaks into R.
for(const rate of [44100,48000])for(const hasEmber of [false,true])for(const rAmplitude of [.012,.65]){
 let W;const messages=[],scope={AudioWorkletProcessor:class{constructor(){this.port={postMessage:x=>messages.push(x)}}},sampleRate:rate,currentFrame:0,MygrainLoopBalance:B,registerProcessor:(n,c)=>{if(n==='mygrain-shop-postfx-balance-v1')W=c}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../scripts/dfeeder-balance-worklet.cjs'),'utf8'),scope);
 const routes=[{family:'drums',scale:.8},...(hasEmber?[{family:'ember',scale:.6}]:[]),{family:'restructure',scale:.73}];
 const w=new W({processorOptions:{routes,rawScale:.8,hasD:false,hasEmber,hasRestructure:true,restructureLevel:.7,drumEffected:true,startFrame:0,decisionFrame:rate,captureFrame:rate*2,endFrame:rate*4}});
 for(let at=0;at<rate*4+128;at+=128){scope.currentFrame=at;
  const inputs=routes.map(r=>[0,1].map(c=>Float32Array.from({length:128},(_,i)=>{const t=(at+i)/rate,x=r.family==='drums'?.03*Math.sin(2*Math.PI*150*t):r.family==='ember'?.06*Math.sin(2*Math.PI*800*t):Math.tanh(rAmplitude*3*Math.sin(2*Math.PI*700*t))/3;return x*(c?.4:1)})));
  inputs.push(inputs[0].map(ch=>Float32Array.from(ch,x=>x*4)));const output=routes.map(()=>[new Float32Array(128),new Float32Array(128)]);w.process(inputs,output);
  if(at>=rate*2)for(let n=0;n<routes.length;n++)for(let c=0;c<2;c++)for(let i=0;i<128;i++)assert(Math.abs(output[n][c][i]-inputs[n][c][i]*w.gains[routes[n].family])<1e-7);
 }
 const applied=messages.find(x=>x.applied)?.applied,verified=messages.find(x=>x.verified)?.verified;assert(applied&&verified,JSON.stringify(messages));assert(applied.restructure.gain<=1);assert.equal(applied.restructure.startLevel,.7);assert.equal(applied.restructure.sourceKey,'restructure');assert(B.verifySaved(verified.drums,verified.ember,null,verified.restructure));assert.equal(!!applied.ember,hasEmber);assert.equal(applied.d,null);if(rAmplitude<.02)assert.equal(applied.restructure.gain,1);else assert(applied.restructure.gain<1);
}
assert.throws(()=>B.verifySaved(metric(-20,.3),null,null,metric(-18,.2)),/Restructure/);
assert.throws(()=>B.verifySaved(metric(-20,.3),null,null,metric(-24,.4)),/Restructure/);
console.log('PASS Restructure-only and Ember+Restructure post-insert captured PCM, quiet non-boost, loud trim, corrected drum reference and absent-D independence');
