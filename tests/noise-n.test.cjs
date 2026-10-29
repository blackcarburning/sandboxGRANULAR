'use strict';
const assert=require('node:assert/strict'),N=require('../noise-card-dsp.js');
assert.equal(N.normalize().enabled,false);assert.equal(N.normalize(null,{selects:{noiseType:'white'},sliders:{noiseMix:23}}).enabled,true);assert.equal(N.normalize({cutoff:Infinity}).cutoff,1800);assert.equal(N.normalize({poles:100}).poles,4);
for(const source of ['K1','K2','K3','K4','K5','drumKick','drumSnare','drumHat','drumPerc','drumClap','drumCymbals','drumEtc','drumRoll','A','B','C','V','W','P','O','L','X','Q','M','M+','L1','L2','L3'])assert(N.SOURCES.includes(source));
const sr=48000,s=N.normalize({source:'A',mode:'follow',sensitivity:1,attack:5,release:50}),e=new N.Envelope(sr,s);let peak=0;for(let i=0;i<sr;i++){const v=e.sample(i<sr/4?.5:0,i/sr);assert(Number.isFinite(v)&&v>=0&&v<=1);peak=Math.max(peak,v)}assert(peak>.49);assert(e.value<1e-6);
const tr=new N.Envelope(sr,{source:'A',mode:'trigger',sensitivity:4,threshold:.1,attack:10,decay:100,hold:40,sustain:.2,release:90});let hits=0;const trigger=tr.trigger.bind(tr);tr.trigger=(...a)=>{hits++;trigger(...a)};for(let i=0;i<sr;i++)tr.sample(i<sr/10||i>sr/2&&i<sr*.6?.3:0,i/sr);assert.equal(hits,2);assert.equal(tr.value,0);
for(let i=0;i<1000;i++){const s=N.randomise({enabled:true});assert.equal(s.enabled,false);assert(s.level>=6&&s.level<=22);assert(N.SOURCES.includes(s.source));assert(s.source!=='manual')}
console.log('PASS N normalization, driver inventory, follower, triggered ADSR, randomisation');

const startup=N.startupSettings({enabled:true,cutoff:15000,source:'L1',mode:'trigger',poles:2,level:23});
for(const [key,value] of Object.entries({enabled:false,filterEnabled:true,filterType:'lowpass',poles:16,cutoff:80,source:'drums',mode:'follow',amount:8,decay:50,release:50,sustain:0,level:23}))assert.equal(startup[key],value,key);
assert.equal(N.normalize({enabled:true,source:'L1',cutoff:15000}).enabled,true);
assert.equal(N.normalize({enabled:true,source:'L1',cutoff:15000}).cutoff,15000);
console.log('PASS N startup preset and explicit restore preservation');
