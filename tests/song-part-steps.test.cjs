const test=require('node:test');
const assert=require('node:assert/strict');
const {Controller,partDurationSeconds,sourcePartDurationSeconds}=require('../song-beta.js');
const {schedule,scheduleStored}=require('../song-beta-clock.js');
const {wav}=require('../song-beta-export.js');
const full={id:'a',name:'Long',bpm:120,patternSteps:64,patternCycleMultiplier:2,repeats:1};

test('steps trim only playback duration; full source duration is retained',()=>{
    assert.equal(partDurationSeconds(full),16);
    const trimmed={...full,playbackSteps:31,repeats:3};
    assert.equal(partDurationSeconds(trimmed),11.625);
    assert.equal(sourcePartDurationSeconds(trimmed),16);
    for(const playbackSteps of [0,-1,129,1.5,'16',true])assert.throws(()=>partDurationSeconds({...full,playbackSteps}),/timing/);
});

function context(){const sources=[];return {sources,state:'running',currentTime:1,sampleRate:8000,destination:{},addEventListener(){},removeEventListener(){},createBufferSource(){const s={playbackRate:{},connect(){},disconnect(){},start(at){this.startTime=at},stop(at){this.stopTime=at}};sources.push(s);return s;}};}
for(const stored of [false,true])test(`${stored?'stored':'memory'} trim repeats cut audio without pitch compression and keep exact boundaries`,async()=>{
    const c=context(),part={...full,playbackSteps:31,repeats:2};
    const parts=[part,{...full,id:'b',sourcePartId:'a',playbackSteps:64}],buffer={duration:16};
    const p=stored?await scheduleStored(c,parts,async()=>buffer):schedule(c,parts,new Map([['a',buffer]]));
    assert.deepEqual(c.sources.map(s=>s.playbackRate.value),[1,1]);
    assert.deepEqual(c.sources.map(s=>s.loopEnd),[3.875,8]);
    assert.equal(p.entries[0].end-p.entries[0].start,7.75);
    assert.equal(p.entries[1].start,p.entries[0].end);assert.equal(p.entries[1].end-p.entries[1].start,8);p.stop();
});

test('WAV export repeats only the cut region, without consuming the discarded tail or changing pitch',async()=>{
    const part={id:'a',name:'Cut',bpm:120,patternSteps:16,repeats:2,playbackSteps:8};
    const data=Float32Array.from({length:16000},(_,i)=>i<8000?.2*Math.sin(2*Math.PI*220*i/8000):.8);
    const buffer={length:data.length,numberOfChannels:1,getChannelData:()=>data};
    const result=await wav([part],new Map([['a',buffer]]),8000);assert.equal(result.frames,16000);
    const bytes=new Uint8Array(await result.blob.arrayBuffer());
    const sample=frame=>{const i=44+frame*6;let v=bytes[i]|bytes[i+1]<<8|bytes[i+2]<<16;if(v&0x800000)v-=0x1000000;return v/(v<0?0x800000:0x7fffff);};
    for(const frame of [1,1001,3999,6001,7999,8001,14001])assert(Math.abs(sample(frame)-data[frame%8000])<.000001);
    assert(result.peak<.201);
});

test('Steps saves only the chosen occurrence and rejects invalid or unsafe edits',async()=>{
    const other={...full,id:'b',sourcePartId:'a',playbackSteps:12};let saved;
    const fixture={song:{parts:[full,other]},saveArrangement:async parts=>{saved=parts},status(){}};
    await Controller.prototype.setSteps.call(fixture,full,'32');
    assert.equal(saved[0].playbackSteps,32);assert.equal(saved[1].playbackSteps,12);assert.equal(full.playbackSteps,undefined);
    for(const value of ['',0,129,2.5])await assert.rejects(()=>Controller.prototype.setSteps.call(fixture,full,value),/Choose/);
    fixture.playing=true;await assert.rejects(()=>Controller.prototype.setSteps.call(fixture,full,32),/Stop/);
    fixture.playing=false;fixture.editing={};await assert.rejects(()=>Controller.prototype.setSteps.call(fixture,full,32),/Stop/);
});
