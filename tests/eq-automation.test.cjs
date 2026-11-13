const test=require('node:test'),assert=require('node:assert/strict');
const Eq=require(process.env.EQ_CHANNEL_BASELINE||'../channel-eq.js'),Auto=require(process.env.EQ_AUTOMATION_BASELINE||'../eq-automation.js');
function fixture(){const eq=Eq.create();let now=0,running=false;let saves=0;const clock=()=>({running,now,steps:16,duration:2,origin:Math.floor(now/2)*2,phase:(now%2)/2});const a=Auto.create(eq,clock,()=>saves++,{manual:true});return {eq,a,time(t,on=true){now=t;running=on;a.tick()},get saves(){return saves}};}
test('W waits for sequence zero, captures one whole loop, arms R and saves',()=>{const f=fixture();f.time(.5);f.a.write('X');f.time(1.8);assert(!f.a.info('X').recording);f.time(2.001);assert(f.a.info('X').recording);for(let i=1;i<=200;i++){const v=f.eq.get('X');v.enabled=true;v.bands[1].frequency=400*2**(i/100);v.bands[1].gain=i/10;f.eq.set('X',v);f.time(2.001+i*.01)}const a=f.eq.get('X').automation;assert(!f.a.info('X').write);assert(a.read);assert(a.points.length>=2);assert.equal(a.points[0].phase,0);assert.equal(a.points.at(-1).phase,1);assert.equal(f.saves,1);assert(!f.eq.get('L').automation);f.a.dispose();});
test('interpolation is log-frequency/log-Q and linear dB, not note/step quantised',()=>{const a=Eq.defaults(),b=Eq.defaults();b.bands[1].frequency=6400;b.bands[1].q=a.bands[1].q*16;b.bands[1].gain=20;const points=[{phase:0,...a},{phase:1,...b}];const x=Auto.interpolate(points,.5);assert.equal(x.bands[1].frequency,1600);assert.equal(x.bands[1].q,a.bands[1].q*4);assert.equal(x.bands[1].gain,10);assert(Auto.interpolate(points,.501).bands[1].frequency>x.bands[1].frequency);});
test('read is transient and patch metadata survives JSON and canonical normalization',()=>{const f=fixture(),v=f.eq.get('L'),b=Eq.defaults();b.bands[0].gain=20;v.automation={version:1,read:true,steps:16,points:[{phase:0,...Eq.defaults()},{phase:1,...b}]};f.eq.set('L',v);f.time(1);assert.equal(f.eq.get('L').bands[0].gain,10);assert.equal(f.eq.settings().channels.L.bands[0].gain,0);assert.deepEqual(Eq.normalize(JSON.parse(JSON.stringify(f.eq.settings()))),f.eq.settings());f.a.read('L');f.time(1.1);assert.equal(f.eq.get('L').bands[0].gain,10);f.a.remove('L');assert(!f.eq.get('L').automation);f.a.dispose();});
test('early stop discards partial take; restore disarms W',()=>{const f=fixture();f.a.write('X');f.time(.001);f.time(.5);assert(f.a.info('X').recording);f.time(.7,false);assert(!f.a.info('X').write);assert(!f.eq.get('X').automation);f.a.write('L');f.eq.restore();assert(!f.a.info('L').write);f.a.dispose();});
test('bad or unbounded automation positions are rejected',()=>{for(const phases of [[0,.7,.6,1],[0,.4],[0,0,1],[-1,1]]){const a={version:1,read:true,steps:16,points:phases.map(phase=>({phase,...Eq.defaults()}))};assert.throws(()=>Eq.automation(a));}});

test('curve reduction bounds error and makes long continuous takes small',()=>{const points=[];for(let i=0;i<=2400;i++){const v=Eq.defaults();v.bands[1].frequency=400*4**(i/2400);v.bands[1].gain=12*i/2400;points.push({phase:i/2400,...v})}const compressed=Auto.simplify(points);assert.equal(compressed.length,2);for(const p of points){const x=Auto.interpolate(compressed,p.phase);assert(Math.abs(Math.log(x.bands[1].frequency/p.bands[1].frequency))<.0011);assert(Math.abs(x.bands[1].gain-p.bands[1].gain)<.011)}});

test('every existing EQ can write, read, stop, JSON-roundtrip and delete independently',()=>{
 for(const key of Eq.KEYS){const f=fixture();f.a.write(key);f.time(.001);const offset=key.startsWith('drum')?2:0;if(offset){assert(!f.a.info(key).recording,key);f.time(1.9);f.time(2.001)}assert(f.a.info(key).recording,key);const v=f.eq.get(key);v.enabled=true;v.bands[2].gain=12;f.eq.set(key,v);f.time(offset+1);f.time(offset+1.8);f.time(offset+2.01);const a=f.eq.settings().channels[key].automation;assert(a?.read,key);assert.equal(a.points[0].phase,0);assert.equal(a.points.at(-1).phase,1);f.time(offset+3);assert(f.eq.get(key).bands[2].gain>0,key);assert.deepEqual(Eq.normalize(JSON.parse(JSON.stringify(f.eq.settings()))),f.eq.settings());f.a.remove(key);assert(!f.eq.get(key).automation);f.a.dispose();}
});
test('only enabled automation or armed writes consult clocks; an unused app does zero polling work',()=>{
 const eq=Eq.create(),seen=[];const a=Auto.create(eq,key=>{seen.push(key);return {running:true,steps:16,phase:.5}},()=>{},{manual:true});a.tick();assert.deepEqual(seen,[]);
 const v=eq.get('D'),end=Eq.defaults();end.enabled=true;end.bands[1].gain=9;v.automation={version:1,read:true,steps:16,points:[{phase:0,...Eq.defaults()},{phase:1,...end}]};eq.set('D',v);a.tick();assert.deepEqual(seen,['D']);seen.length=0;a.read('D');a.tick();assert.deepEqual(seen,[]);a.dispose();
});

test('one shared timer is used and the last Read off removes it immediately',()=>{
 const pending=new Map(),oldSet=global.setTimeout,oldClear=global.clearTimeout;let serial=0;
 global.setTimeout=fn=>{pending.set(++serial,fn);return serial};global.clearTimeout=id=>pending.delete(id);
 let a;
 try {const eq=Eq.create();a=Auto.create(eq,()=>({running:false,steps:16,phase:0}),()=>{});assert.equal(pending.size,0);
 for(const key of ['D','K2']){const v=eq.get(key);v.automation={version:1,read:true,steps:16,points:[{phase:0,...Eq.defaults()},{phase:1,...Eq.defaults()}]};eq.set(key,v);assert.equal(pending.size,1);}
 a.read('D');assert.equal(pending.size,1);a.read('K2');assert.equal(pending.size,0);a.read('D');assert.equal(pending.size,1);const off=eq.get('D');off.enabled=false;off.manualBypass=true;eq.set('D',off);assert.equal(pending.size,0);assert(a.info('D').read);
 } finally {a?.dispose();global.setTimeout=oldSet;global.clearTimeout=oldClear;}
});

test('explicit EQ Off pauses R for every channel, survives JSON, and On resumes at current phase',()=>{
 for(const key of Eq.KEYS){const f=fixture(),v=Eq.defaults(),end=Eq.defaults();v.enabled=end.enabled=true;end.bands[1].gain=18;v.automation={version:1,read:true,steps:16,points:[{phase:0,...Eq.defaults(),enabled:true},{phase:1,...end}]};f.eq.set(key,v);f.time(.5);assert(f.eq.get(key).bands[1].gain>0,key);
 const off=f.eq.get(key);off.enabled=false;off.manualBypass=true;f.eq.set(key,off);const gain=f.eq.get(key).bands[1].gain,points=JSON.stringify(off.automation.points);f.time(1);assert.equal(f.eq.get(key).enabled,false);assert.equal(f.eq.get(key).bands[1].gain,gain);assert(f.a.info(key).read);assert.match(f.a.info(key).message,/R paused/);
 f.eq.restore(JSON.parse(JSON.stringify(f.eq.settings())));f.time(1.2);assert.equal(f.eq.get(key).enabled,false);assert.equal(JSON.stringify(f.eq.get(key).automation.points),points);
 const on=f.eq.get(key);on.enabled=true;delete on.manualBypass;f.eq.set(key,on);f.time(1.5);assert.equal(f.eq.get(key).bands[1].gain,13.5);assert.equal(f.eq.get(key).enabled,true);f.a.dispose();}
});


test('all drum EQ writers skip the initial sequence/count-in boundary; other channels start immediately',()=>{
 for(const key of Eq.KEYS){const f=fixture();f.a.write(key);f.time(.001);
  if(key.startsWith('drum')){assert(!f.a.info(key).recording,key);assert.match(f.a.info(key).message,/count-in/);f.time(1.8);assert(!f.a.info(key).recording,key);f.time(2.001);assert(f.a.info(key).recording,key)}
  else assert(f.a.info(key).recording,key);
  f.a.dispose();
 }
});
test('drum W armed mid-loop skips next boundary, records following full loop and retains earlier curve until completion',()=>{
 const f=fixture(),key='drumKick',v=f.eq.get(key);v.automation={version:1,read:false,steps:16,points:[{phase:0,...Eq.defaults()},{phase:1,...Eq.defaults()}]};f.eq.set(key,v);const old=JSON.stringify(v.automation);
 f.time(.7);f.a.write(key);f.time(1.9);f.time(2.001);assert(!f.a.info(key).recording);f.time(3.9);assert(!f.a.info(key).recording);assert.equal(JSON.stringify(f.eq.get(key).automation),old);assert.equal(f.saves,0);
 f.time(4.001);assert(f.a.info(key).recording);f.time(5);f.time(5.9);f.time(6.001);assert(!f.a.info(key).write);assert(f.eq.get(key).automation.read);assert.equal(f.saves,1);f.a.dispose();
});
test('drum count-in is cancellable, resets on stop/restart and is discarded on patch restore',()=>{
 const f=fixture(),key='drumRoll';f.a.write(key);f.time(.001);f.a.write(key);assert(!f.a.info(key).write);assert(!f.eq.get(key).automation);
 f.a.write(key);f.time(1.9);f.time(2.001);f.time(2.2,false);f.time(4.2);assert(!f.a.info(key).recording);f.time(5.9);f.time(6.001);assert(f.a.info(key).recording);
 f.eq.restore();assert(!f.a.info(key).write);assert(!f.eq.get(key).automation);f.a.dispose();
});
