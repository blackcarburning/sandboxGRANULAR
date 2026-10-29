'use strict';
const {readFileSync}=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=readFileSync('sandboxGRANULAR/index.html','utf8');
const code=html.slice(html.indexOf('        function chopLoadedLoopAudio('),html.indexOf('        async function recutLoadedBastardLoop('));
const buffer=(channels,length,rate)=>{const data=Array.from({length:channels},()=>new Float32Array(length));return {numberOfChannels:channels,length,sampleRate:rate,duration:length/rate,getChannelData:i=>data[i]};};
const context=vm.createContext({MAX_SAMPLE_DURATION_SECONDS:180,audioContext:{createBuffer:buffer}});vm.runInContext(code,context);
const source=buffer(2,8000,8000);for(let i=0;i<8000;i++){source.getChannelData(0)[i]=.25+i/16000;source.getChannelData(1)[i]=-source.getChannelData(0)[i];}
const original=source.getChannelData(0).slice();
for(const divisions of [['1/16'],['uncut'],['1/1'],['1/8','1/32']]){
 const output=context.chopLoadedLoopAudio(source,divisions,120,16,()=>.7);assert.equal(output.duration,2);assert.equal(output.numberOfChannels,2);let energy=0;for(let i=0;i<output.length;i++){assert(Number.isFinite(output.getChannelData(0)[i]));assert.equal(output.getChannelData(0)[i],-output.getChannelData(1)[i]);energy+=output.getChannelData(0)[i]**2;}assert(energy>1);
}
assert.deepEqual(source.getChannelData(0),original);assert.throws(()=>context.chopLoadedLoopAudio(source,['1/16'],120,100000));console.log('PASS stereo alignment, non-silent rhythmic chops, Uncut/oversized fallback, immutable original, duration bound');
