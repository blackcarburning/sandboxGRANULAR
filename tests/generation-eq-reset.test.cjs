const test=require('node:test'),assert=require('node:assert/strict');
const Eq=require('../channel-eq.js'),Auto=require('../eq-automation.js');
test('generation bypasses all EQs, deletes curves and cancels armed writes; saved state and Undo restore correctly',()=>{
 const eq=Eq.create(),auto=Auto.create(eq,()=>({running:true,phase:.5,steps:16}),()=>{},{manual:true});
 for(const key of Eq.KEYS){const v=eq.get(key);v.enabled=true;v.bands[1].gain=9;v.automation={version:1,read:true,steps:16,points:[{phase:0,...Eq.defaults(),enabled:true},{phase:1,...v}]};eq.set(key,v)}
 const before=eq.settings();for(const key of Eq.KEYS)auto.write(key);
 eq.resetForGeneration();
 for(const key of Eq.KEYS){const v=eq.get(key);assert.equal(v.enabled,false,key);assert.equal(v.manualBypass,true,key);assert.equal(v.automation,undefined,key);assert.equal(v.bands[1].gain,9,key);assert.equal(auto.info(key).write,false,key);assert.equal(auto.info(key).read,false,key)}
 const saved=JSON.parse(JSON.stringify(eq.settings()));assert.deepEqual(Eq.normalize(saved),saved);
 auto.tick();assert(Eq.KEYS.every(key=>!eq.get(key).enabled));eq.restore(before);assert.deepEqual(eq.settings(),before);auto.dispose();
});
