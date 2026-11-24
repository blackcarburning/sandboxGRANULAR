'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),G=require('../glasshaus-dsp.js');
const raw=fs.readFileSync(require.resolve('../glasshaus-worklet.js'),'utf8').replace(/^import .*;\n/,'');
function engine(state,rate=12000,bpm=120){let Klass;const scope={globalThis:{MygrainGlassHaus:G},Math,Number,Infinity,JSON,sampleRate:rate,currentTime:0,AudioWorkletProcessor:class{constructor(){this.port={}}},registerProcessor:(k,v)=>Klass=v};vm.runInNewContext(raw,scope);const p=new Klass({processorOptions:{state:G.normalize(state),bpm,time:.02,origin:.02}});return{p,scope,rate};}
function render(f,seconds){let sum=0,peak=0,lastPower=0,headPower=0;const frames=Math.ceil(seconds*f.rate),pcm=new Float32Array(frames);for(let n=0;n<frames;n+=128){const out=[new Float32Array(Math.min(128,frames-n)),new Float32Array(Math.min(128,frames-n))];f.scope.currentTime=n/f.rate;f.p.process([], [out]);for(let i=0;i<out[0].length;i++){const x=out[0][i];assert(Number.isFinite(x));sum+=x*x;peak=Math.max(peak,Math.abs(x));pcm[n+i]=x;if(n+i<frames/4)headPower+=x*x;if(n+i>frames*3/4)lastPower+=x*x;}}return{rms:Math.sqrt(sum/frames),peak,headPower,lastPower,pcm};}
function one(v={}){const s=G.normalize({enabled:true,...v});s.steps=s.steps.map((n,i)=>({...n,on:i===0}));s.bars=8;return s;}
test('three bounded objects, normalization and equal-tempered chord notes',()=>{const s=G.normalize();assert.equal(s.objects.length,3);s.chord='minor';assert.deepEqual(G.notes(s,{degree:0,octave:0}),[60,63,67]);assert.equal(G.normalize({objects:[{decay:999}]}).objects[0].decay,120);assert.equal(G.audible(s),false);});
test('shell ratios, geometry and Nyquist rejection',()=>{const s=one({tuning:'physical'}),o=s.objects[0],a=G.fundamental(s,o,60);assert.equal(G.fundamental(s,{...o,diameter:o.diameter*2},60),a/4);assert.equal(G.fundamental(s,{...o,thickness:o.thickness*2},60),a*2);assert(G.modes(s,o,84,8000).every(m=>m.hz<3360));assert(G.modes(s,o,60,48000)[2].hz/a>2.5);});
test('strike, rub and combined modes produce finite stereo PCM',()=>{for(const mode of ['strike','rub','both']){const r=render(engine(one({mode})),3);assert(r.rms>.001,mode+' '+r.rms);assert(r.peak<=.92);}});
test('120 second object rings across 20 seconds without a loop retrigger',()=>{const s=one();s.objects[0].decay=120;s.objects[0].damping=0;const f=engine(s,8000,30),r=render(f,20);assert(r.lastPower/r.headPower>.07,r.lastPower/r.headPower);assert.equal(f.p.voices.length,1);});
test('repeated same-pitch strikes reinforce existing resonator; 3 objects and chords split',()=>{const s=G.normalize({enabled:true,chord:'maj7',assignment:'split'});for(const o of s.objects)o.enabled=true;s.steps.forEach(x=>{x.on=true;x.degree=0});const f=engine(s);render(f,3);assert.equal(f.p.voices.length,4);assert(f.p.voices.every(x=>x.m.length<=12));});
test('all ratchets are equally spaced, including triplets',()=>{for(const ratchet of [1,2,3,4]){const s=one();s.steps[0].ratchet=ratchet;s.bars=1;const f=engine(s,12000),events=[];const original=f.p.trigger.bind(f.p);f.p.trigger=(s,t)=>{events.push(t);original(s,t)};render(f,.15);assert.equal(events.length,ratchet);for(let j=1;j<events.length;j++)assert(Math.abs(events[j]-events[j-1]-.125/ratchet)<=1/12000+1e-10,JSON.stringify({ratchet,events}));}});
test('BPM vibrato matches free-rate PCM at the same frequency',()=>{const s=one({vibrato:{sync:true,ratio:2,depth:35}}),a=render(engine(s),1),b=render(engine({...s,vibrato:{sync:false,rate:4,depth:35}}),1);assert.deepEqual(a.pcm,b.pcm);});
test('own seeded dice preserve power, levels, object activation, root and chord choice',()=>{const s=one({chord:'seventh',root:55}),copy=JSON.stringify(s);for(const kind of ['sound','pattern','all']){const n=G.randomize(s,kind,()=>.3);assert.equal(n.enabled,s.enabled);assert.equal(n.level,s.level);assert.equal(n.root,s.root);assert.equal(n.chord,s.chord);assert.deepEqual(n.objects.map(x=>x.enabled),s.objects.map(x=>x.enabled));assert.notEqual(JSON.stringify(n),copy);}assert.equal(JSON.stringify(s),copy);});

test('switching one object Off fades only its voices',()=>{const s=one();s.objects[1].enabled=true;const f=engine(s);render(f,.2);assert.equal(f.p.voices.length,2);s.objects[0].enabled=false;f.p.port.onmessage({data:{state:s}});render(f,.05);assert.equal(f.p.voices.length,1);assert.equal(f.p.voices[0].slot,1);});

test('circular finger and mallet contact have distinct smooth bounded sound at both native rates',()=>{
 for(const rate of [44100,48000]){
  const rows=[];
  for(const contact of ['finger','mallet']){
   const s=one({mode:'rub',contact,pressure:.9,speed:1.7});s.steps[0].gate=2;s.objects[0].decay=120;
   const f=engine(s,rate,120),r=render(f,1.2);let peakEnergy=0;
   for(const v of f.p.voices)for(const m of v.m){peakEnergy=Math.max(peakEnergy,m.x*m.x+m.y*m.y);assert(Math.abs(m.cx*m.cx+m.cy*m.cy-1)<1e-7);}
   assert(r.rms>.001);assert(r.peak<.4,contact+' '+r.peak);assert(peakEnergy<.2,'No emergency ceiling / hard modal clipping');rows.push(r.pcm);
  }
  assert.notDeepEqual(rows[0],rows[1]);
 }
});
test('rim speed moves contact phase without changing the modal centre frequency',()=>{
 const state=one({mode:'rub',contact:'finger'}),slow=engine({...state,speed:.2}),fast=engine({...state,speed:1.2});
 const a=render(slow,.3),b=render(fast,.3);assert.notDeepEqual(a.pcm,b.pcm);
 assert.equal(slow.p.voices[0].m[0].base,fast.p.voices[0].m[0].base);
 assert.notEqual(slow.p.voices[0].m[0].cx,fast.p.voices[0].m[0].cx);
});
test('zero pressure is silent in rub mode and repeated contact preserves phase/envelope',()=>{
 const silent=render(engine(one({mode:'rub',pressure:0})),.3);assert.equal(silent.rms,0);
 const s=one({mode:'rub'}),f=engine(s);render(f,.2);const v=f.p.voices[0],cx=v.m[0].cx,env=v.env,x=v.m[0].x,y=v.m[0].y;
 f.p.trigger(s.steps[0],.2);assert.equal(f.p.voices[0],v);assert.equal(v.env,env);assert.equal(v.m[0].cx,cx);assert.equal(v.m[0].x,x);assert.equal(v.m[0].y,y);
});
test('new render capability is selective; absent contact remains a portable default',()=>{
 assert.equal(G.normalize({contact:'invalid'}).contact,'auto');assert.equal(G.renderVersion(one()),38);assert.equal(G.renderVersion(G.normalize()),0);
});

test('drawn lanes are optional, bounded and fixed-note, preserving legacy schemas',()=>{
 assert(!('lanes' in G.normalize()));const s=G.fresh();assert.equal(s.lanes.length,3);assert(s.lanes.every(a=>a.length===128&&a.every(x=>x>=0&&x<=1)));assert.equal(G.renderVersion({...s,enabled:true}),41);assert.equal(G.renderVersion({...G.normalize(),enabled:true}),38);
 const f=engine({...s,enabled:true,chord:'maj7'},12000);render(f,1);assert.equal(f.p.voices.length,1);assert.equal(f.p.voices[0].m[0].hz,G.modes(s,s.objects[0],s.root,12000)[0].hz);
});
test('each continuous lane excites only its own object and empty lanes are exactly silent',()=>{
 const s=G.fresh();s.enabled=true;s.objects.forEach(o=>o.enabled=true);s.lanes=s.lanes.map(a=>a.map(()=>0));assert(!G.audible(s));let f=engine(s);assert.equal(render(f,.3).peak,0);assert.equal(f.p.voices.length,0);
 s.assignment='split';s.lanes[1].fill(.6);f=engine(s);assert(render(f,.5).rms>.001);assert.deepEqual(Array.from(f.p.voices,v=>v.slot),[1]);
 s.objects[1].enabled=false;assert(!G.audible(s));assert.equal(render(engine(s),.3).peak,0);
});
test('drawing height changes friction strength, tuning shifts only its object and tails survive empty curve',()=>{
 const s=G.fresh();s.enabled=true;s.bars=8;s.lanes=s.lanes.map(a=>a.map(()=>0));s.lanes[0].fill(1);let high=render(engine(s),1).rms;s.lanes[0].fill(.1);let low=render(engine(s),1).rms;assert(high>low*1.5,{high,low});
 s.objects[0].tune=12;const f=engine(s);render(f,.2);assert(Math.abs(f.p.voices[0].m[0].hz/G.modes({...s,objects:s.objects.map(o=>({...o,tune:0}))},{...s.objects[0],tune:0},s.root,12000)[0].hz-2)<1e-10);
 s.mode='strike';s.objects[0].decay=120;s.lanes[0].fill(0);s.lanes[0][0]=.8;const tail=render(engine(s,8000),2);assert(tail.lastPower>1e-5);assert(tail.peak<.92);
});
test('all three drawn objects stay bounded, smooth and limited to their fixed modal banks',()=>{
 const s=G.fresh();s.enabled=true;s.objects.forEach(o=>{o.enabled=true;o.decay=120});s.mode='both';s.vibrato.depth=25;const f=engine(s,12000,240),r=render(f,4);assert(r.rms>.001);assert(r.peak<.92);assert.equal(f.p.voices.length,3);assert(f.p.voices.every(v=>v.m.length<=12&&v.drawn));
 const before=JSON.stringify(s.objects);for(const kind of ['pattern','sound','all']){const n=G.randomize(s,kind,()=>.6);assert(n.lanes.every(a=>a.length===128));if(kind==='pattern')assert.equal(JSON.stringify(n.objects),before);assert.deepEqual(n.objects.map(o=>o.enabled),s.objects.map(o=>o.enabled));}
});

test('explicit mallet grid schedules only marked sixteenths, not curve peaks',()=>{
 for(const bars of [1,2,4,8]){
  const s=G.fresh();s.enabled=true;s.mode='strike';s.bars=bars;s.lanes.forEach(a=>a.fill(.8));s.hits.forEach(a=>a.fill(false));assert(!G.audible(s));assert.equal(render(engine(s),.3).peak,0);
  s.hits[0][0]=true;s.hits[0][3]=true;s.hits[0][bars*16-1]=true;assert(G.audible(s));const f=engine(s,8000,240),events=[],trigger=f.p.trigger.bind(f.p);f.p.trigger=(step,time,...rest)=>{events.push({time,velocity:step.velocity,slot:rest[0]});return trigger(step,time,...rest)};render(f,bars+.01);assert.equal(events.length,3);assert(Math.abs(events[1].time-events[0].time-3/16)<=1/8000+1e-9);assert(Math.abs(events[2].time-events[0].time-(bars*16-1)/16)<=1/8000+1e-9);assert(events.every(e=>e.slot===0&&e.velocity===.8));
 }
});
test('slide ignores every mallet marker; new sounds never randomise into combined mode',()=>{
 const s=G.fresh();s.enabled=true;s.mode='rub';const a=render(engine(s),1);s.hits.forEach(a=>a.fill(false));assert.deepEqual(render(engine(s),1).pcm,a.pcm);for(const n of [.1,.5,.9])assert.notEqual(G.randomize(s,'sound',()=>n).mode,'both');const old=G.withLanes(G.normalize({enabled:true,mode:'both'}));assert.equal(G.renderVersion(old),39);assert.equal(G.withHits(old).mode,'strike');assert.equal(G.renderVersion(G.withHits(old)),40);
});

test('Slide gain is optional, bounded, selective and increases quiet output without changing Strike',()=>{
 assert.equal(G.fresh().slideGain,8);assert(!('slideGain' in G.normalize({slideGain:1})));assert.equal(G.normalize({slideGain:999}).slideGain,16);
 const s=G.fresh();s.enabled=true;s.level=.08;for(const o of s.objects)o.level=.2;
 const a=render(engine({...s,slideGain:1}),2),b=render(engine({...s,slideGain:8}),2);assert(b.rms/a.rms>7.5&&b.rms/a.rms<8.01);assert(b.peak<.92);
 for(const mode of ['strike','both']){const original={...s,mode,slideGain:1};assert.deepEqual(render(engine(original),1).pcm,render(engine({...original,slideGain:16}),1).pcm);assert.equal(G.renderVersion(original),40);assert.equal(G.renderVersion({...original,slideGain:16}),40);}
 assert.equal(G.renderVersion({...s,slideGain:8}),41);assert.equal(G.renderVersion({...s,slideGain:1}),40);assert.equal(G.renderVersion({...s,enabled:false}),0);
});
