'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../audio-telemetry.js'),'utf8');
function fixture(){
 let now=0,serial=0,observing=0;const timers=new Map(),events=new Map(),sent=[],button={dataset:{},setAttribute(k,v){this[k]=v;}},status={};
 const fx={connected:true,clock:{armed:true,missingBlocks:7,epoch:2}};
 const host={document:{readyState:'complete',hidden:false,getElementById:id=>id==='audioTelemetryBtn'?button:status,querySelector:()=>({textContent:'vtest.1'})},navigator:{onLine:true},mygrainAccounts:{authenticated:true,user:{username:'isolated'}},mygrainDawFx:{diagnostics:()=>fx},audioContext:{state:'running',sampleRate:48000,get currentTime(){return now/1000;}},audioSchedulingStats:{lateTicks:0,skippedSteps:0},performance:{now:()=>now},crypto:require('node:crypto').webcrypto,AbortController,Uint8Array,setTimeout(fn,delay){const id=++serial;timers.set(id,{fn,due:now+delay});return id;},clearTimeout:id=>timers.delete(id),addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener:(name,fn)=>events.get(name)?.delete(fn),PerformanceObserver:class{observe(){observing++;}disconnect(){observing--;}}};
 host.fetch=async(url,request)=>{sent.push({url,request,body:JSON.parse(request.body)});return {ok:true,json:async()=>({ok:true})};};host.window=host;host.AudioContext=class{constructor(){throw Error('Telemetry must not create a context');}};vm.runInNewContext(script,host);
 const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
 async function advance(ms){const end=now+ms;for(;;){const next=[...timers].filter(([,v])=>v.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;now=next[1].due;timers.delete(next[0]);next[1].fn();await settle();}now=end;await settle();}
 return {host,button,status,sent,timers,advance,settle,get observing(){return observing;},emit(name){for(const fn of events.get(name)||[])fn();}};
}
test('off has no timer, network, observer or audio work; on samples correct clock; stop is final',async()=>{
 const f=fixture();await f.advance(120000);assert.equal(f.sent.length,0);assert.equal(f.timers.size,0);assert.equal(f.observing,0);
 f.button.onclick();await f.settle();const id=f.host.mygrainAudioTelemetry.diagnostics().sessionId;await f.advance(5000);assert.equal(f.sent.length,2);assert.equal(f.sent[1].body.samples.length,5);assert.equal(f.sent[1].body.samples[4].clockRatio,1);assert.equal(f.sent[1].body.samples[4].missingBlocks,7);assert.equal(f.observing,1);
 f.button.onclick();const count=f.sent.length;assert.equal(f.timers.size,0);assert.equal(f.observing,0);await f.advance(300000);assert.equal(f.sent.length,count);assert.equal(f.host.mygrainAudioTelemetry.diagnostics().queued,0);
 f.button.onclick();await f.settle();assert.notEqual(f.host.mygrainAudioTelemetry.diagnostics().sessionId,id);assert.equal('clockRatio' in f.sent.at(-1).body.samples[0],false);f.emit('mygrain-account-lock');assert.equal(f.host.mygrainAudioTelemetry.diagnostics().enabled,false);assert.equal(f.timers.size,0);assert.equal(f.observing,0);
});
test('deselection aborts an outstanding upload and late completion cannot restart collection',async()=>{
 const f=fixture();let resolve,signal;f.host.fetch=(url,r)=>{signal=r.signal;return new Promise(done=>resolve=done);};f.button.onclick();assert.equal(signal.aborted,false);f.button.onclick();assert.equal(signal.aborted,true);resolve({ok:true,json:async()=>({ok:true})});await f.settle();await f.advance(60000);assert.equal(f.timers.size,0);assert.equal(f.host.mygrainAudioTelemetry.diagnostics().enabled,false);
});
test('three failed uploads stop the session and release its observer/timer',async()=>{
 const f=fixture();f.host.fetch=async()=>({ok:false,status:503,json:async()=>({ok:false})});f.button.onclick();await f.advance(11000);assert.equal(f.host.mygrainAudioTelemetry.diagnostics().enabled,false);assert.equal(f.timers.size,0);assert.equal(f.observing,0);assert.match(f.status.textContent,/three upload failures/);
});
