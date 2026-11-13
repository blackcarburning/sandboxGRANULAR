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

// Legacy speed is bit-identical; changing surface speed leaves music unchanged.
assert.equal(normalize({rpm:99}).rpm,33);assert.equal(normalize().rpm,33);
for(const rpm of [33,45,78]){assert.equal(normalize({rpm}).rpm,rpm);assert.deepEqual(render({...clean,rpm}),render(clean));}
assert.deepEqual(render({...clean,clicks:1}),render({...clean,clicks:1,rpm:33}));
function pulse(rpm){const e=new Engine(48000,{...clean,rpm});e.pop=1;e.random=()=>1;const out=[new Float32Array(128)];e.process([[]],[out]);return out[0][95];}
assert(pulse(78)<pulse(45));assert(pulse(45)<pulse(33));
function transients(rpm){const a=render({...clean,rpm,clicks:1},0);let count=0;for(let i=1;i<a.length;i++)if(Math.abs(a[i]-a[i-1])>.003)count++;return count;}
const counts=[33,45,78].map(transients);assert(counts[2]>counts[0]*1.4,JSON.stringify(counts));console.log('PASS RPM decay, event density, legacy PCM, unchanged music',counts);
// Identify the dominant wow/flutter modulation rate in actual pitched PCM.
function modulationPower(pcm,hz){let re=0,im=0,last=null;for(let i=4800;i<pcm.length-1;i++)if(pcm[i]<=0&&pcm[i+1]>0){const cross=i-pcm[i]/(pcm[i+1]-pcm[i]);if(last!==null){const value=48000/(cross-last)-440,phase=2*Math.PI*hz*(cross+last)/96000;re+=value*Math.cos(phase);im+=value*Math.sin(phase)}last=cross}return re*re+im*im;}
for(const [control,hz]of [['wow',.556],['flutter',7.7]])for(const rpm of [33,45,78]){const pcm=render({...clean,[control]:.3,rpm}),powers=[1,1.35,2.34].map(r=>modulationPower(pcm,hz*r)),best=powers.indexOf(Math.max(...powers));assert.equal([33,45,78][best],rpm,JSON.stringify({control,rpm,powers}));}
console.log('PASS actual PCM wow/flutter frequencies follow all three RPM detents');
// Moving the lever changes angular velocity without jumping rotational phase.
{const a=new Engine(48000,{...clean,wow:.4,flutter:.2}),b=new Engine(48000,{...clean,wow:.4,flutter:.2});const input=[Float32Array.from({length:128},(_,i)=>Math.sin(i*.04))];for(let n=0;n<20;n++){a.process([input],[[new Float32Array(128)]]);b.process([input],[[new Float32Array(128)]]);}a.update({...a.settings,rpm:78});const x=[new Float32Array(128)],y=[new Float32Array(128)];a.process([input],[x]);b.process([input],[y]);assert.equal(x[0][0],y[0][0]);assert.notDeepEqual(x[0],y[0]);}
console.log('PASS speed-change rotational phase continuity');

// Mains frequency and second harmonic are independent of platter RPM.
function toneAmplitude(pcm,hz){let re=0,im=0;for(let i=0;i<pcm.length;i++){const phase=2*Math.PI*hz*i/48000;re+=pcm[i]*Math.cos(phase);im+=pcm[i]*Math.sin(phase)}return 2*Math.hypot(re,im)/pcm.length;}
assert.equal(normalize().mainsHz,50);assert.equal(normalize({mainsHz:49}).mainsHz,50);
for(const mainsHz of [50,60]){const pcm=render({...clean,hum:1,mainsHz},0);assert(Math.abs(toneAmplitude(pcm,mainsHz)-.009)<1e-6);assert(Math.abs(toneAmplitude(pcm,mainsHz*2)-.009*.17)<1e-6);assert(toneAmplitude(pcm,mainsHz===50?60:50)<1e-6);assert.deepEqual(pcm,render({...clean,hum:1,mainsHz,rpm:78},0));}
const humDb=20*Math.log10(rms(render({...clean,hum:.12},0)));assert(humDb>-63&&humDb<-61);console.log('PASS 50/60 Hz mains fundamentals/harmonics, RPM independence; default hum dBFS RMS',humDb);
