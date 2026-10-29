'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const start=html.indexOf('        function stopAllBastardLoopXVoices('),end=html.indexOf('        function stopBastardLoopX(',start);
for(const handoff of [NaN,2])for(const preservePreview of [false,true])test(`X preview preservation=${preservePreview}, handoff=${handoff}`,()=>{
 const stopped=[],roles=[],retired=[],voices=new Set();
 for(const preview of [false,true])voices.add({preview,source:{stop:()=>stopped.push(preview)}});
 const ctx={bastardLoopXActiveVoices:voices,audioContext:{currentTime:0},transportSync:{handoffBoundary:handoff},stopOscillatorsByRole:r=>roles.push(r),stopRetiredTransportVoices(){},retireTransportVoice:v=>retired.push(v.preview)};
 vm.createContext(ctx);vm.runInContext(html.slice(start,end),ctx);ctx.stopAllBastardLoopXVoices({preservePreview,fade:false});
 assert.deepEqual(roles,preservePreview?['bastardloopx']:['bastardloopx','bastardloopx-preview']);
 assert.deepEqual(Number.isFinite(handoff)?retired:stopped,preservePreview?[false]:[false,true]);
 assert.equal(voices.size,preservePreview?1:0);
});
for(const cancelled of [false,true])test(`quick X sample release, cancelled=${cancelled}`,()=>{
 const scheduled=[],button={classList:{remove(){}}},hold={button,voice:{minimumReleaseTime:1.12,source:{context:{currentTime:1},stop:t=>scheduled.push(['stop',t])},gain:{gain:{cancelAndHoldAtTime:t=>scheduled.push(['hold',t]),linearRampToValueAtTime:(v,t)=>scheduled.push(['fade',t])}}}};
 const ctx={sequencerKeyboardHolds:new Set([hold])};vm.createContext(ctx);
 const a=html.indexOf('        function releaseSequencerKeyboardHold('),b=html.indexOf('        function releaseSequencerKeyboardHolds(',a);
 vm.runInContext(html.slice(a,b),ctx);ctx.releaseSequencerKeyboardHold(hold,cancelled);
 assert.equal(scheduled[0][1],cancelled?1:1.12);assert.equal(ctx.sequencerKeyboardHolds.size,0);
 ctx.releaseSequencerKeyboardHold(hold,cancelled);assert.equal(scheduled.length,3);
});
