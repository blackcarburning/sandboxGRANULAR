const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
require('../song-beta.js');
const {partDurationSeconds} = globalThis.MygrainSongBeta;
const {schedule, scheduleStored} = require('../song-beta-clock.js');
const {layout} = require('../song-beta-export.js');
const source = fs.readFileSync(path.join(__dirname, '../song-beta-adapter.js'), 'utf8');
const cycle = vm.runInNewContext(`(${source.slice(source.indexOf('    function songPatternCycleMultiplier('), source.indexOf('    function prepareSongState('))})`);
function state(lane, timing, enabled = true, steps = 64) {
    const sequence = Array(64).fill(null); sequence[steps - 1] = {note:'C3',notes:[48],rest:false};
    return {patternLength:steps,modes:{[`bastardLoop${lane}Enabled`]:enabled,[`bastardLoop${lane}TimingIndex`]:timing,[`bastardLoop${lane}Sequence`]:sequence}};
}
for (const lane of ['L','X']) for (const [index, multiplier] of [[0,1],[2,1],[3,1],[4,2],[5,4],[6,8]]) {
    test(`${lane} timing index ${index} captures a complete x${multiplier} cycle`,()=>assert.equal(cycle(state(lane,index)),multiplier));
}
test('disabled, empty and out-of-grid slow lanes do not extend the current pattern',()=>{
    assert.equal(cycle(state('X',6,false)),1);
    const s=state('X',6); s.modes.bastardLoopXSequence[63]=null; assert.equal(cycle(s),1);
    s.patternLength=32; s.modes.bastardLoopXSequence[63]={note:'C3'}; assert.equal(cycle(s),1);
});
test('the slowest enabled L/X/Q cycle wins without altering notes, rates or grid',()=>{
    const s=state('X',4);s.q={enabled:true,rate:.25,sequence:[{notes:[48],rest:false}]};const before=JSON.stringify(s);
    assert.equal(cycle(s),4);assert.equal(JSON.stringify(s),before);
    s.q.enabled=false;assert.equal(cycle(s),2);
});
test('legacy parts retain duration; full-cycle timing also scales whole-pattern repeats and WAV layout',()=>{
    const legacy={id:'a',bpm:120,patternSteps:64,repeats:1};
    assert.equal(partDurationSeconds(legacy),8);
    const full={...legacy,patternCycleMultiplier:2};assert.equal(partDurationSeconds(full),16);
    assert.equal(partDurationSeconds({...full,repeats:3}),48);
    assert.equal(layout([full,{...full,id:'b'}],null,8000).frames,32*8000);
    for(const value of [0,3,16,'2',true,null]) {
        if(value===null)continue;
        assert.throws(()=>partDurationSeconds({...legacy,patternCycleMultiplier:value}),/timing/);
    }
});
function context() {
    const sources=[];return {sources,state:'running',currentTime:1,sampleRate:8000,destination:{},addEventListener(){},removeEventListener(){},createBufferSource(){const source={playbackRate:{},connect(){},disconnect(){},start(at){this.startTime=at},stop(at){this.endTime=at}};sources.push(source);return source;}};
}
for(const stored of [false,true])test(`full cycle ${stored?'stored':'memory'} playback preserves pitch and exact adjacent boundaries`,async()=>{
    const c=context(),a={id:'a',bpm:120,patternSteps:64,patternCycleMultiplier:2,repeats:1};const b={...a,id:'b',repeats:2};
    const buffer={duration:16};const playback=stored?await scheduleStored(c,[a,b],async()=>buffer):schedule(c,[a,b],new Map([['a',buffer],['b',buffer]]));
    assert.equal(c.sources[0].playbackRate.value,1);assert.equal(playback.entries[0].end-playback.entries[0].start,16);
    assert.equal(playback.entries[1].end-playback.entries[1].start,32);assert.equal(playback.entries[0].end,playback.entries[1].start);playback.stop();
});
