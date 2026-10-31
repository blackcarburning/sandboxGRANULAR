'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const body=html.slice(html.indexOf('        function captureKeyboardSampleDiagnostics() {'),html.indexOf('        function captureScrollTimelineState() {'));
test('sample diagnostics distinguish live, future, releasing and overdue voices and separate retired owners',()=>{
 const context={audioContext:{currentTime:10},keyboardSoundSource:'sample',keyboardSampleBuffer:{duration:2,length:96000,numberOfChannels:2},keyboardSampleOutputBuses:new Map([['sample',{}]]),getKeyboardDecaySeconds:()=>.4,holdEnabled:true,
 keyboardSamplePlayer:{activeVoices:new Set([{key:'arp:C4',instrument:'sample',start:9,end:11},{key:'keyboard:E4',instrument:'piano',start:9,end:9,released:true},{key:'arp:G4',instrument:'strings',start:11,end:12}]),voices:new Map([['a',{}],['b',{}]]),pending:new Map([['c',{}]]),metrics:{cachedBytes:4096}},
 retiredTransportVoices:new Set([{key:'arp:A4'},{role:'drums'}])};vm.createContext(context);vm.runInContext(body,context);const result=context.captureKeyboardSampleDiagnostics();
 assert.equal(result.active,3);assert.equal(result.keyed,2);assert.equal(result.pending,1);assert.equal(result.arp,2);assert.equal(result.retired,1);assert.equal(result.released,1);assert.equal(result.overdue,1);assert.equal(result.future,1);assert.equal(result.sampleBytes,768000);assert.equal(result.cachedBytes,4096);assert.equal(result.instruments.sample,1);
});
test('an unused sample player does not create a player or fetch any audio for diagnostics',()=>{
 const context={audioContext:null,keyboardSoundSource:'osc',keyboardSampleBuffer:null,keyboardSampleOutputBuses:new Map(),getKeyboardDecaySeconds:()=>0,holdEnabled:false,keyboardSamplePlayer:null,retiredTransportVoices:new Set()};vm.createContext(context);vm.runInContext(body,context);const result=context.captureKeyboardSampleDiagnostics();assert.equal(result.active,0);assert.equal(result.sampleBytes,0);assert.equal(result.pending,0);assert.equal(context.keyboardSamplePlayer,null);
});
