const test=require('node:test'),assert=require('node:assert/strict'),M=require('../ember-dsp.js'),old=require(process.env.TASK+'/before/ember-dsp.js');
test('legacy recipes, factories, non-cable generation stream and render capabilities remain exact',()=>{assert.deepEqual(M.defaults(),old.defaults());assert.deepEqual(M.PRESETS,old.PRESETS);assert.deepEqual(M.STARTERS,old.STARTERS);for(const mode of ['hz','bpm'])for(let i=1;i<=256;i++){const input={...M.PRESETS[i%300].settings,enabled:!!(i%2),level:.371,tempo:i%3?null:93},seed=Math.imul(i,0x9e3779b9)>>>0,a=M.randomPatch(input,seed,mode);const previous=old.randomPatch(input,seed,mode);assert.deepEqual({...a,cables:previous.cables},previous);assert.deepEqual(a,M.randomPatch(input,seed,mode,{excludeCrossMod:false}));assert.deepEqual(M.normalize(input),old.normalize(input));assert.equal(M.renderVersion(input),old.renderVersion(input));}});
test('excluded C retains absent/off/mixed/on flags, zero/base depth and Mod/Inverse; both dividers still cover all ratios and pairs',()=>{const fixtures=[M.defaults(),{...M.defaults(),crossMod:Array(5).fill(false),pulseCrossMod:Array(6).fill(false),crossModDepth:0},{...M.defaults(),crossMod:[true,false,true,false,true],pulseCrossMod:[false,true,false,true,false,true],crossModDepth:.371,lfo:{enabled:true,depth:.7,rate:.37,wave:'hold',targets:[{key:'crossModDepth',inverse:true},{key:'freq3',inverse:false}]}},{...M.defaults(),crossMod:Array(5).fill(true),pulseCrossMod:Array(6).fill(true),crossModDepth:1}];
for(const mode of ['hz','bpm']){const pairs=new Set;for(let i=1;i<=1024;i++){const input=M.normalize({...fixtures[i%fixtures.length],enabled:!!(i%2),level:.371,balance:.173,tempo:i%3?93:null}),before=structuredClone(input),seed=Math.imul(i,0x9e3779b9)>>>0,a=M.randomPatch(input,seed,mode,{excludeCrossMod:true}),full=M.randomPatch(input,seed,mode);for(const key of ['crossMod','pulseCrossMod','crossModDepth']){assert.deepEqual(a[key],input[key]);assert.equal(Object.hasOwn(a,key),Object.hasOwn(input,key));}assert.deepEqual(a.lfo.targets.find(t=>t.key==='crossModDepth'),input.lfo?.targets.find(t=>t.key==='crossModDepth'));assert.deepEqual([a.oscDivider,a.pulseDivider],[full.oscDivider,full.pulseDivider]);pairs.add((a.oscDivider??1)+':'+(a.pulseDivider??1));assert.equal(a.cableStrengthBypass,true);assert.deepEqual([a.enabled,a.level,a.balance,a.tempo],[input.enabled,.371,.173,input.tempo]);if(mode==='bpm')assert.equal(a.lfo.depth,1);assert.deepEqual(input,before);}assert.equal(pairs.size,81);}});

test('both randomisers change actual cable endpoints on every action, retain stereo paths, and are deterministic/nonmutating',()=>{
 const signature=s=>s.cables.map(c=>c.from+':'+c.to).sort().join('|');
 for(const mode of ['hz','bpm'])for(const excludeCrossMod of [true,false]){
  let previous=M.normalize({...M.defaults(),enabled:true}),seen=new Set,sources=new Set,inputs=new Set;
  for(let i=1;i<=512;i++){
   const before=structuredClone(previous),seed=Math.imul(i,0x9e3779b9)>>>0,s=M.randomPatch(previous,seed,mode,{excludeCrossMod});
   assert.deepEqual(s,M.randomPatch(previous,seed,mode,{excludeCrossMod}));assert.deepEqual(previous,before);assert.notEqual(signature(s),signature(previous));
   const same=M.randomPatch(s,seed,mode,{excludeCrossMod});assert.notEqual(signature(same),signature(s),'repeated seed retained wiring');
   assert(s.cables.length>=5&&s.cables.length<=10);assert.equal(new Set(s.cables.map(c=>c.from+':'+c.to)).size,s.cables.length);
   for(const side of ['L','R'])for(const group of ['osc','pulse'])assert(s.cables.some(c=>c.from.startsWith(group)&&c.to==='direct'+side),'missing stereo '+group+side);
   for(const c of s.cables){assert(M.OUTPUTS.includes(c.from));assert(M.INPUTS.includes(c.to));assert(c.amount>=.35&&c.amount<.75);sources.add(c.from);inputs.add(c.to);}
   seen.add(signature(s));previous=s;
  }
  assert(seen.size>500);assert(sources.size>=17);assert(inputs.size>=16);
 }
});
