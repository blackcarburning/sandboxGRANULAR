const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
 let ms=0, sid=0, connected=0, disconnected=0, observed=0;
 const intervals=new Map(), frames=new Map(), listeners=new Set();
 const target={addEventListener(type,fn){listeners.add(fn)},removeEventListener(type,fn){listeners.delete(fn)}};
 const document={...target,visibilityState:'visible'};
 class Observer { observe(){observed++} disconnect(){observed--} }
 const context={state:'running',currentTime:0,sampleRate:48000,createAnalyser(){return{fftSize:2048,getFloatTimeDomainData(a){a.fill(.01)},disconnect(){}}}};
 const node={context,connect(){connected++},disconnect(){disconnected++}};
 const box={window:null,document,performance:{now:()=>ms},Date,Float32Array,WeakMap,JSON,Number,Math,Error,queueMicrotask,
  setInterval(fn){intervals.set(++sid,fn);return sid},clearInterval(id){intervals.delete(id)},requestAnimationFrame(fn){frames.set(++sid,fn);return sid},cancelAnimationFrame(id){frames.delete(id)},
  MutationObserver:Observer,PerformanceObserver:Observer,...target};box.window=box;
 vm.runInNewContext(fs.readFileSync(require.resolve('../audio-diagnostics.js'),'utf8'),box);
 const trace=box.MygrainXTrace.create({context:()=>context,nodes:()=>[{label:'X only',node}],state:()=>({sample:'test.wav'}),health:()=>({voices:25,lfo:{depthHz:0}}),roots:()=>[target],transport:()=>({running:true,voices:25}),onToggle(){}});
 return{trace,intervals,frames,listeners,stats:()=>({connected,disconnected,observed}),advance(t=250){ms+=t;context.currentTime+=t/1000;for(const f of [...intervals.values()])f()}};
}
test('X diagnostics do no background or audio-node work while off; disable releases every owned resource',()=>{
 const f=fixture();f.trace.record('ignored');assert.equal(f.trace.snapshot().events.length,0);assert.equal(f.intervals.size,0);assert.equal(f.frames.size,0);assert.equal(f.listeners.size,0);
 f.trace.setEnabled(true);f.advance();assert.equal(f.intervals.size,1);assert.equal(f.stats().connected,1);assert(f.trace.snapshot().samples[0].meters[0].rms>0);
 f.trace.setEnabled(false);assert.equal(f.intervals.size,0);assert.equal(f.frames.size,0);assert.equal(f.listeners.size,0);assert.deepEqual(f.stats(),{connected:1,disconnected:1,observed:0});
 const before=f.trace.snapshot().events.length;f.advance();assert.equal(f.trace.snapshot().events.length,before);
});

test('fifteen-minute history retains per-second evidence after raw events roll over',()=>{
 const f=fixture();f.trace.setEnabled(true);
 const ui=f.trace.wrap('syncBastardLoopXUi',()=>42,false);
 for(let second=0;second<899;second++){
  for(let i=0;i<8;i++){f.trace.record('voice-scheduled',{scheduled:second+i*.125,expectedEnd:second+2.7+i*.125,note:'C2'});ui();}
  if(second%10===0)f.trace.mark();
  for(let i=0;i<4;i++)f.advance(250);
 }
 const t=f.trace.snapshot(), col=t.history.columns;
 assert.equal(t.enabled,true);assert(t.history.rows.length>=899);assert.equal(t.events.length,600);
 assert(t.health.length>=179);assert.equal(t.clickTimeline.length,90);assert.equal(t.marks.length,8);
 assert.equal(t.history.rows[0][col.indexOf('notesScheduled')],8);
 assert.equal(t.history.rows[0][col.indexOf('uiSyncs')],8);
 assert(t.history.rows.some(row=>row[col.indexOf('maxVoiceRecords')]===25));
 assert.equal(t.clickTimeline[1].intervalMs,10000);assert.equal(t.clickTimeline[1].audioIntervalMs,10000);
 assert(t.clickTimeline[1].nearbyAudio.some(cue=>cue.kind==='note-start'));
 assert(t.clickTimeline[1].recentCalls.some(call=>call.name==='syncBastardLoopXUi'));
 assert(t.metrics.syncBastardLoopXUi.caller);assert.equal(t.metrics.syncBastardLoopXUi.maxIntervalMs,1000);
 assert(t.samples.every(s=>s.meters[0].windowMs>250));
 t.history.rows[0][2]=999;assert.notEqual(f.trace.snapshot().history.rows[0][2],999);
 // Full long history plus saturated marks must leave ample room for the
 // existing report's repeated trace/text representations and incident state.
 assert(Buffer.byteLength(JSON.stringify(t))<800000);
 f.advance(1000);assert.equal(f.trace.enabled,false);assert.equal(f.intervals.size,0);
});

test('click intervals survive detailed-mark eviction and clearing resets the whole timeline',()=>{
 const f=fixture();f.trace.setEnabled(true);
 for(let i=0;i<140;i++){f.trace.mark();f.advance(2000);}
 const t=f.trace.snapshot();assert.equal(t.clickTimeline.length,128);assert.equal(t.marks.length,8);
 assert(t.clickTimeline.every(click=>click.intervalMs===2000));
 f.trace.clear();const cleared=f.trace.snapshot();
 assert.equal(cleared.history.rows.length,0);assert.equal(cleared.health.length,0);assert.equal(cleared.clickTimeline.length,0);
 f.trace.setEnabled(false);
});
test('wrappers preserve receiver, results, thrown errors and promise identity; stale completions cannot affect a new trace',async()=>{
 const f=fixture(), obj={value:41};obj.run=f.trace.wrap('run',function(n){return this.value+n});assert.equal(obj.run(1),42);assert.equal(Object.keys(f.trace.snapshot().metrics).length,0);
 f.trace.setEnabled(true);assert.equal(obj.run(1),42);assert.equal(f.trace.snapshot().metrics.run.calls,1);
 const error=new Error('failure');assert.throws(()=>f.trace.wrap('throw',()=>{throw error})(),e=>e===error);
 let resolve;const promise=new Promise(r=>resolve=r),wrapped=f.trace.wrap('sample',()=>promise);assert.equal(wrapped(),promise);assert.equal(f.trace.snapshot().metrics.sample.pending,1);
 f.trace.setEnabled(false);f.trace.setEnabled(true);resolve('done');await promise;await Promise.resolve();assert.equal(f.trace.snapshot().metrics.sample,undefined);f.trace.setEnabled(false);
});
test('rings and mark windows stay bounded and fifteen-minute tracing expires automatically',()=>{
 const f=fixture();f.trace.setEnabled(true);for(let i=0;i<2000;i++)f.trace.record('test',{i});
 assert.equal(f.trace.snapshot().events.length,600);for(let i=0;i<12;i++){f.trace.mark();f.advance();f.trace.record('after')}
 const capture=f.trace.snapshot();assert.equal(capture.marks.length,8);assert(capture.marks.every(m=>m.before.length<=48&&m.after.length<=24));
 f.advance(900000);assert.equal(f.trace.enabled,false);assert.equal(f.intervals.size,0);assert.equal(f.stats().observed,0);
});

test('Clear Log clears X history without stopping playback or adding resources',()=>{
 const f=fixture();f.trace.setEnabled(true);f.advance();f.trace.mark();const resources=f.stats();
 f.trace.clear();const capture=f.trace.snapshot();assert.equal(capture.enabled,true);assert.equal(capture.events.length,0);assert.equal(capture.samples.length,0);assert.equal(capture.marks.length,0);
 assert.deepEqual(f.stats(),resources);assert.equal(f.intervals.size,1);f.trace.setEnabled(false);
});
