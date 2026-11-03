'use strict';
const assert=require('node:assert/strict'),{Engine,normalize,TODAY}=require('../turntable-dsp.js');
assert.equal(normalize().enabled,false);assert.equal(normalize({enabled:1}).enabled,false);assert.equal(normalize({year:9999}).year,TODAY);
function render(settings,hz=440){const rate=48000,e=new Engine(rate,{...settings,enabled:true}),a=new Float32Array(rate*4);for(let n=0;n<a.length;n+=128){const src=Float32Array.from({length:128},(_,i)=>.15*Math.sin(2*Math.PI*hz*(n+i)/rate)),out=[new Float32Array(128),new Float32Array(128)];assert(e.process([[src,src]],[out]));for(let i=0;i<128&&n+i<a.length;i++){assert(Number.isFinite(out[0][i]));assert.equal(out[0][i],out[1][i]);a[n+i]=out[0][i];}}e.dispose();assert.equal(e.buffers.length,0);assert.equal(e.process([],[]),false);return a;}
const clean={year:TODAY,needle:'modern',wow:0,flutter:0,hum:0,clicks:0,crackle:0,wear:0};const rms=a=>Math.sqrt(a.slice(4800).reduce((s,x)=>s+x*x,0)/(a.length-4800));
assert(rms(render(clean))>.09);assert(rms(render({...clean,year:1920},8000))<rms(render(clean,8000))*.03);
assert(rms(render({...clean,needle:'old',wear:1},4000))<rms(render(clean,4000)));
const diff=(a,b)=>rms(a.map((x,i)=>x-b[i]));for(const k of ['wow','flutter','hum','clicks','crackle'])assert(diff(render({...clean,[k]:1}),render(clean))>1e-5,k+' must change real PCM');
assert.deepEqual(render({...clean,crackle:.4}),render({...clean,crackle:.4}));console.log('PASS Turntable DSP: age, needles, all effects, stereo, finite PCM and disposal');
