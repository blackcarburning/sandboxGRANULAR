const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(process.env.MYGRAIN_NORMALISE_SOURCE || require('node:path').join(__dirname,'../index.html'),'utf8');
function fn(name) {
 const start = html.search(new RegExp('        (?:async )?function '+name+'\\('));
 assert(start >= 0, name);
 return html.slice(start, html.indexOf('\n        }',start) + 10);
}
function buffer(channels) {
 const data=channels.map(x=>Float32Array.from(x));
 return {numberOfChannels:data.length,length:data[0].length,sampleRate:48000,getChannelData:ch=>data[ch]};
}
function fixture(input) {
 const context=vm.createContext({Blob,Float32Array,ArrayBuffer,DataView,Number,Math,Error,
  renderLiveOutputBarsBuffer: async()=>({audioBuffer:input,bpm:120,bars:1}),createBpmWavFilename:()=> 'test.wav'});
 for(const name of ['peakNormaliseLoopStoreBuffer','writeString','interleaveChannels','audioBufferToWav24bit','renderDawReadyBarsExport'])vm.runInContext(fn(name),context);
 return context;
}
async function samples(result) {
 const v=new DataView(await result.blob.arrayBuffer()),out=[];
 for(let i=44;i<v.byteLength;i+=3)out.push((v.getUint8(i)|(v.getUint8(i+1)<<8)|(v.getInt8(i+2)<<16))/8388608);
 return {v,out};
}
test('quiet loop peaks at full scale with one gain for all channels before PCM24 encoding',async()=>{
 const b=buffer([[.25,-.125,0],[.0625,-.03125,0],[.125,-.0625,0]]),ctx=fixture(b);
 const {v,out}=await samples(await ctx.renderDawReadyBarsExport({normaliseForLoopStore:true}));
 assert.equal(v.getUint32(24,true),48000);assert.equal(v.getUint16(22,true),3);assert.equal(v.getUint16(34,true),24);
 const expected=[1,.25,.5,-.5,-.125,-.25,0,0,0];out.forEach((x,i)=>assert(Math.abs(x-expected[i])<2/8388608));
 assert.equal(v.getUint32(40,true),b.length*3*3);
});
test('over-full-scale capture is reduced before clipping, retaining relative sample levels',async()=>{
 const ctx=fixture(buffer([[2,-1],[.5,-.25]]));
 const {out}=await samples(await ctx.renderDawReadyBarsExport({normaliseForLoopStore:true}));
 [1,.25,-.5,-.125].forEach((x,i)=>assert(Math.abs(x-out[i])<2/8388608));
});
test('normal WAV/DAW render remains at the original level and does not mutate its buffer',async()=>{
 const b=buffer([[.25,-.125],[.0625,-.03125]]),ctx=fixture(b);
 const {out}=await samples(await ctx.renderDawReadyBarsExport());
 [.25,.0625,-.125,-.03125].forEach((x,i)=>assert(Math.abs(x-out[i])<2/8388608));
 assert.deepEqual([...b.getChannelData(0)],[.25,-.125]);
});
test('silence remains finite silence with original frame count',async()=>{
 const {out}=await samples(await fixture(buffer([[0,0],[0,0]])).renderDawReadyBarsExport({normaliseForLoopStore:true}));
 assert.deepEqual(out,[0,0,0,0]);
});
test('invalid capture is rejected instead of saving corrupt normalised audio',async()=>{
 await assert.rejects(fixture(buffer([[.1,NaN]])).renderDawReadyBarsExport({normaliseForLoopStore:true}),/invalid audio/);
});
test('only Loop Store opts in; source renderer and ordinary repository export are not changed',()=>{
 const flags=html.match(/normaliseForLoopStore: true/g)||[];
 assert.equal(flags.length,1);
 assert.match(fn('addCurrentLoopToStore'),/loopWarmupCycles: 1, normaliseForLoopStore: true/);
 assert.doesNotMatch(fn('renderPatternWithOptionalSnapshot'),/normaliseForLoopStore/);
 assert.doesNotMatch(fn('exportGeneratedLoopToRepository'),/normaliseForLoopStore/);
});
