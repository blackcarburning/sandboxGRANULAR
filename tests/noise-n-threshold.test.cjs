'use strict';
const assert=require('node:assert/strict'),N=require('../noise-card-dsp.js');
const sr=48000;
function run(mode,threshold){const e=new N.Envelope(sr,{source:'A',mode,threshold,sensitivity:1,attack:5,decay:40,sustain:0,hold:5,release:30});let hits=0,peak=0;const fire=e.trigger.bind(e);e.trigger=(...v)=>{hits++;fire(...v)};for(let i=0;i<sr;i++){const t=i/sr,a=t<.1?.2:t>=.3&&t<.4?.6:t>=.6&&t<.7?.9:0;peak=Math.max(peak,e.sample(a,t))}return{hits,peak,e};}
assert.equal(run('trigger',.3).hits,2);assert.equal(run('trigger',.7).hits,1);assert(run('trigger',.3).peak>.999);assert(run('trigger',.7).peak>.999);
for(const mode of ['trigger','follow']){const e=new N.Envelope(sr,{source:'A',mode,threshold:.7,sensitivity:1,attack:1});for(let i=0;i<sr/4;i++)assert.equal(e.sample(.6,i/sr),0);}
const e=new N.Envelope(sr,{source:'A',mode:'follow',threshold:.3,sensitivity:1,attack:1,release:5});let t=0;function settle(a){for(let i=0;i<sr/5;i++)e.sample(a,t++/sr);return e.value;}
assert(settle(.6)>.59);e.configure({...e.s,threshold:.8});assert(settle(.6)<1e-6,'raising threshold must close a currently-open gate');e.configure({...e.s,threshold:.3});assert(settle(.6)>.59);assert(settle(.2)>.19,'hysteresis avoids chatter');assert(settle(.1)<1e-6);e.configure({...e.s,invert:true});assert(settle(.1)>.999);
const manual=new N.Envelope(sr,{source:'manual',threshold:.95,attack:1});manual.trigger(0);let max=0;for(let i=0;i<sr/20;i++)max=Math.max(max,manual.sample(0,i/sr));assert(max>.99);
console.log('PASS N threshold rejection, full-depth triggers, follower gate/hysteresis, live edits, invert and manual bypass');
