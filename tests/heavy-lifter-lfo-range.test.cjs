"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),H=require(process.env.MYGRAIN_RANGE_DSP||'../heavy-lifter-dsp.js');
const pcm=Float32Array.from({length:12000},(_,i)=>.1*Math.sin(i*.13)+.07*Math.sin(i*.37)*(1+.4*Math.sin(i*.003))),profile=H.analyse(pcm),raw={signature:'full-depth-range',sampleRate:24000,profiles:[profile,profile]};
const prep=(sr,s)=>({...raw,imprint:s.mode==='spectralImprint'?H.compileImprint(sr,s,raw):null,convolution:s.mode==='livingConvolution'?H.compileConvolution(sr,s,raw):null,modulation:H.compileModulation(sr,s,raw)});
test('full depth reaches zero and one at every continuous destination from every saved base, at both host rates',()=>{
 let destinations=new Set();
 for(const sr of[44100,48000])for(const mode of H.MODES)for(const base of[0,.25,.5,.75,1]){
  const s=H.normalize({enabled:true,mode,level:base,width:base,recipes:{[mode]:Object.fromEntries(Object.keys(H.PARAMS[mode]).map(k=>[k,k==='reverse'?(base>.5?1:0):base]))},lfo:{depth:1,wave:'square',beats:8,targets:H.LFO_TARGETS}}),saved=JSON.stringify(s),data=prep(sr,s);
  for(const sign of[-1,1]){
   const e=new H.Heavy(sr,s,data);e.tick(.01,.01,sign>0?0:3);
   for(const target of ['level','width',...Object.keys(H.PARAMS[mode]).map(k=>mode+'.'+k)]){
    destinations.add(target);const key=target.split('.').pop(),value=target.includes('.')?e.body.p[key]:e.modulation.effective[key],original=target.includes('.')?s.recipes[mode][key]:s[key],expected=key==='reverse'?(sign>0?1-original:original):sign>0?1:0;
    assert.equal(value,expected,JSON.stringify({sr,mode,base,sign,target}));
    if(key==='level')assert.equal(e.returnLevel,expected,'return gain must use effective level');
   }
   e.dispose();
  }
  assert.equal(JSON.stringify(s),saved,'modulation rewrote saved bases');
 }
 assert.equal(destinations.size,38);
});
test('full-range Worker kernel bank endpoints use the exact original FIR/convolution equations',()=>{
 for(const mode of['spectralImprint','livingConvolution']){
  const s=H.normalize({enabled:true,mode,lfo:{depth:1,targets:H.LFO_TARGETS}}),data=prep(48000,s);
  for(const sign of[-1,1]){
   const endpoint=structuredClone(s);for(const target of s.lfo.targets){const[m,k]=target.split('.');if(k&&m!==mode)continue;const owner=k?endpoint.recipes[mode]:endpoint,key=k||m;owner[key]=key==='reverse'?(sign>0?1-owner[key]:owner[key]):sign>0?1:0;}
   const compile=mode==='spectralImprint'?H.compileImprint:H.compileConvolution,expected=compile(48000,endpoint,raw),actual=data.modulation.states[sign>0?data.modulation.states.length-1:0];
   assert.deepEqual(actual,expected,mode+' wrong full-range kernel endpoint');
  }
 }
});
test('depth is a full normalized-range scaler, remains bounded, and zero depth is inactive',()=>{
 for(const depth of[0,.01,.25,.5,1])for(const base of[0,.2,.5,.8,1])for(const sign of[-1,1]){
  const s=H.normalize({enabled:true,mode:'mechanicalMotion',level:base,lfo:{depth,wave:'square',beats:8,targets:['level']}}),e=new H.Heavy(48000,s,prep(48000,s));e.tick(.01,.01,sign>0?0:3);
  assert.equal(e.returnLevel,Math.max(0,Math.min(1,base+depth*sign)));
  assert.equal(!!e.modulation,depth>0);e.dispose();
 }
});
