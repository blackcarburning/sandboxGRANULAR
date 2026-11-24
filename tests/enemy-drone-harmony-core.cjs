'use strict';
const assert=require('node:assert/strict'),H=require('../enemy-drone-harmony.js');
const recipe={transpose:7,voices:Array.from({length:8},(_,i)=>({note:48+i,fine:35,on:i===0,level:.4,pan:i/8}))};
let cases=0,seed=23;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
assert.equal(H.constrain(recipe,{mode:'random'},random),recipe);
for(const root of H.NOTES)for(const octaves of [1,2,3,4])for(const chord of ['single',...H.CHORDS.map(c=>c.id)])for(let repeat=0;repeat<4;repeat++){
 const o={mode:chord==='single'?'single':'chord',root,chord,octaves},copy=JSON.stringify(recipe),next=H.constrain(recipe,o,random),base=36+H.NOTES.indexOf(root),expected=[...new Set(H.intervals(o).map(n=>(base+n)%12))].sort((a,b)=>a-b);
 assert.equal(JSON.stringify(recipe),copy);assert.equal(next.transpose,0);assert.equal(next.voices.length,8);
 assert.deepEqual([...new Set(next.voices.map(v=>v.note%12))].sort((a,b)=>a-b),expected);
 for(const [i,v]of next.voices.entries()){assert(v.note>=base&&v.note<base+12*octaves);assert(v.on);assert.equal(v.fine,0);assert.equal(v.pan,recipe.voices[i].pan);assert.equal(v.level,.4);}
 assert.deepEqual(H.previewNotes(o),H.intervals(o).map(n=>48+H.NOTES.indexOf(root)+n));cases++;
}
assert.equal(new Set(H.CHORDS.map(c=>c.id)).size,23);
console.log('PASS',cases,'root/chord/octave cases: complete degree coverage, exact pitch classes, bounds, immutable original recipe and preview intervals');
