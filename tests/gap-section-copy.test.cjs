'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),cut=require('../vocal-loop-cut.js');
test('copy includes silence and audible areas, clips partial gaps and snapshots its source',()=>{
 const state=cut.normalize({gaps:[[.05,.15],[.2,.3],[.7,.8]]});const clip=cut.copyGapSection(state,.1,.25);
 assert.equal(clip.length,.15);assert.deepEqual(clip.gaps,[[0,.04999999999999999],[.1,.15]]);
 state.gaps[0][0]=0;assert.equal(clip.gaps[0][0],0);
 const result=cut.pasteGapSection({gaps:[[.4,.9]]},clip,.5);
 assert.deepEqual(result.gaps,[[.4,.55],[.6,.9]]);assert(result.gapEnabled);
});
test('Copy replaces only its destination; copying an audible section clears destination gaps',()=>{
 const clip=cut.copyGapSection({gaps:[[0,1/16]]},0,4/16);
 const source={enabled:true,repeat:true,start:.25,end:.5,gaps:[[.5,1]]};
 const pasted=cut.pasteGapSection(source,clip,.5);
 assert.deepEqual(pasted.gaps,[[.5,9/16],[.75,1]]);assert.equal(pasted.start,.25);assert(pasted.repeat);
 assert.deepEqual(cut.pasteGapSection(source,{length:.25,gaps:[]},.5).gaps,[[.75,1]]);
});
test('Copy Sec repeats the immutable section through the end, clipping final repetition',()=>{
 const clip=cut.copyGapSection({gaps:[[0,1/16],[2/16,3/16]]},0,3/16);
 const source={gaps:[[.4,1]]};const pasted=cut.pasteGapSection(source,clip,.5,true);
 assert.deepEqual(pasted.gaps,[[.4,9/16],[10/16,12/16],[13/16,15/16]]);
 assert.deepEqual(cut.pasteGapSection({gaps:[[0,1]]},{length:.25,gaps:[]},.25,true).gaps,[[0,.25]]);
 assert.deepEqual(source.gaps,[[.4,1]]);
 assert.throws(()=>cut.pasteGapSection({},clip,1),/destination/);
});
function buffer(data){const values=Float32Array.from(data);return{length:values.length,numberOfChannels:1,sampleRate:values.length,duration:1,getChannelData:()=>values};}
test('output waveform matches exact unfaded repeated PCM, placement, truncated end and cut bypass',()=>{
 const b=buffer(Array.from({length:32},(_,i)=>(i+1)/32)),ctx={createBuffer(ch,n,rate){const a=new Float32Array(n);return{length:n,numberOfChannels:ch,sampleRate:rate,getChannelData:()=>a};}};
 for(const fromStart of [false,true])for(const repeat of [false,true]){
  const state={enabled:true,start:5/32,end:12/32,repeat,fromStart};const pcm=cut.gate(ctx,b,state,1,0).getChannelData(0);
  assert.deepEqual(cut.timelinePeaks(b,32,1,state).map(p=>p.high),Array.from(pcm));
 }
 assert.deepEqual(cut.timelinePeaks(b,32,1,{enabled:false,repeat:true}),cut.peaks(b,32,1));
});
test('stretched repeated waveform shows destination length and silence before its placement',()=>{
 const b=buffer([.1,.2,.3,.4,.5,.6,.7,.8]);const values=cut.timelinePeaks(b,8,1,{enabled:true,stretch:true,start:.5,end:1,targetStart:.25,targetDuration:.25,repeat:true});
 assert.equal(values[0].high,0);assert.equal(values[1].high,0);
 assert.deepEqual(values.slice(2,4),values.slice(4,6));assert.deepEqual(values.slice(4,6),values.slice(6,8));
});
