'use strict';
const assert=require('node:assert/strict'),{Engine,normalize,TODAY}=require('../turntable-dsp.js');
assert.equal(normalize().enabled,false);assert.equal(normalize({enabled:1}).enabled,false);assert.equal(normalize({year:9999}).year,TODAY);
function render(settings,hz=440){const rate=48000,e=new Engine(rate,{...settings,enabled:true}),a=new Float32Array(rate*4);for(let n=0;n<a.length;n+=128){const src=Float32Array.from({length:128},(_,i)=>.15*Math.sin(2*Math.PI*hz*(n+i)/rate)),out=[new Float32Array(128),new Float32Array(128)];assert(e.process([[src,src]],[out]));for(let i=0;i<128&&n+i<a.length;i++){assert(Number.isFinite(out[0][i]));assert.equal(out[0][i],out[1][i]);a[n+i]=out[0][i];}}e.dispose();assert.equal(e.buffers.length,0);assert.equal(e.process([],[]),false);return a;}
const clean={year:TODAY,needle:'modern',wow:0,flutter:0,hum:0,clicks:0,crackle:0,wear:0};const rms=a=>Math.sqrt(a.slice(4800).reduce((s,x)=>s+x*x,0)/(a.length-4800));
assert(rms(render(clean))>.09);assert(rms(render({...clean,year:1920},8000))<rms(render(clean,8000))*.03);
assert(rms(render({...clean,needle:'old',wear:1},4000))<rms(render(clean,4000)));
const diff=(a,b)=>rms(a.map((x,i)=>x-b[i]));for(const k of ['wow','flutter','hum','clicks','crackle'])assert(diff(render({...clean,[k]:1}),render(clean))>1e-5,k+' must change real PCM');
assert.deepEqual(render({...clean,crackle:.4}),render({...clean,crackle:.4}));console.log('PASS Turntable DSP: age, needles, all effects, stereo, finite PCM and disposal');
// Measure instantaneous pitch from interpolated upward zero crossings of 440Hz.
// Sample differences alone would also pass for amplitude changes or static delay.
function pitchStats(pcm,rate=48000){const crossings=[];for(let i=Math.round(rate*.15);i<pcm.length-1;i++)if(pcm[i]<=0&&pcm[i+1]>0)crossings.push(i-pcm[i]/(pcm[i+1]-pcm[i]));const cents=[];for(let i=1;i<crossings.length;i++)cents.push(1200*Math.log2(rate/(crossings[i]-crossings[i-1])/440));cents.sort((a,b)=>a-b);return{low:cents[Math.floor(cents.length*.05)],high:cents[Math.floor(cents.length*.95)],span:cents[Math.floor(cents.length*.95)]-cents[Math.floor(cents.length*.05)]};}
const straight=pitchStats(render(clean));assert(straight.span<1,JSON.stringify(straight));
for(const [control,amount,minSpan]of [['wow',.22,25],['flutter',.14,18],['wow',1,130],['flutter',1,130]]){const stats=pitchStats(render({...clean,[control]:amount}));assert(stats.span>minSpan,JSON.stringify({control,amount,...stats}));assert(stats.low<0&&stats.high>0);console.log('Pitch swing in cents',control,amount,JSON.stringify(stats));}
const extreme=render({...clean,wow:1,flutter:1});assert(rms(extreme)>.07,'Extreme modulation must retain non-silent audio');
