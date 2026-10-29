const assert = require('node:assert/strict');
const test = require('node:test');
const theory = require('../q-theory.js');
test('legacy Q mix survives and hall controls default without changing the saved schema',()=>{
 const s=theory.normalizeState({version:1,room:.27});
 assert.equal(s.version,1);assert.equal(s.room,.27);assert.equal(s.reverbDecay,4.5);assert.equal(s.reverbWidth,1);
 const round=theory.normalizeState(JSON.parse(JSON.stringify({...s,reverbDecay:10,reverbPredelay:65,reverbLowcut:250})));
 assert.equal(round.reverbDecay,10);assert.equal(round.reverbPredelay,65);assert.equal(round.reverbLowcut,250);
});
test('reverb controls bound malformed imported settings',()=>{
 const s=theory.normalizeState({reverbDecay:100,reverbSize:-2,reverbPredelay:900,reverbDamping:0,reverbLowcut:9000,reverbWidth:4});
 assert.deepEqual([s.reverbDecay,s.reverbSize,s.reverbPredelay,s.reverbDamping,s.reverbLowcut,s.reverbWidth],[12,0,200,1000,1500,1]);
});
