global.window={};
const test=require('node:test'),assert=require('node:assert/strict'),{Controller}=require('../song-beta');
test('expanded Mutilator invalidates only audible new processing and retains legacy renders',()=>{
 const c={snapshots:new Map(),cache:new Map(),renderSources:new Map(),isRenderCompatible:Controller.prototype.isRenderCompatible,needsCurrentMutilator:Controller.prototype.needsCurrentMutilator};
 const render={version:1,sourceSha256:'a'.repeat(64),loopDVersion:1,characterFxVersion:1,effectOutputVersion:1,mutilatorVersion:2,keyboardVersion:1,grainVersion:5,portableVersion:1,kReverbVersion:1};
 const part={id:'d'.repeat(32),sha256:'a'.repeat(64),loopDVersion:1,render};
 const decoded=m=>({snapshot:{state:{modes:{loopD:{enabled:true,mutilator:{enabled:true,strain:'gnaw',amount:.7,mix:.8,tone:.4,...m}}}},assets:[{key:'bastardD'}]}});
 for(const m of [{},{filter:'auto',resonance:.5,sweep:1,cycleBeats:4,freeDepth:0,freeRate:1,output:0},{enabled:false,filter:'notch'},{mix:null,filter:'notch'},{amount:'',filter:'notch'},{input:'DAW',filter:'notch'},{rhythm:false,cycleBeats:8,freeRate:3}])assert(c.isRenderCompatible(part,decoded(m)),JSON.stringify(m));
 for(const m of [{filter:'notch'},{resonance:.8},{rhythm:true,sweep:.4},{rhythm:true,cycleBeats:1},{freeDepth:.5,freeRate:3},{output:-6}]){assert.equal(c.isRenderCompatible(part,decoded(m)),false,JSON.stringify(m));assert(c.isRenderCompatible({...part,render:{...render,mutilatorControlsVersion:1}},decoded(m)));}
 assert.equal(c.isRenderCompatible({...part,mutilatorControlsVersion:1}),false);assert(c.isRenderCompatible({...part,mutilatorControlsVersion:1,render:{...render,mutilatorControlsVersion:1}}));
});
