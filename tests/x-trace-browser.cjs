// Read-only native audio regression: API writes and off-origin requests are blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');

(async () => {
 const results = [];
 for (const [engine, type] of Object.entries({ chromium, webkit })) {
  const b = await type.launch(engine === 'chromium'
   ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {});
  try {
   const c = await b.newContext(), p = await c.newPage(), errors = [];
   p.on('pageerror', e => errors.push(e.message));
   await p.route('**/*', r => {
    const req = r.request(), u = new URL(req.url());
    if (u.origin !== 'https://openclaw.blackcarburning.com' || !['GET', 'HEAD'].includes(req.method())) return r.abort();
    if (u.pathname.endsWith('/account-context.js')) return r.fulfill({
     contentType: 'text/javascript', body: 'window.mygrainAccountContext={user:{username:"audio-regression-readonly"}}'
    });
    if (u.pathname.includes('/api/')) return r.fulfill({ json: {
     ok: true, authenticated: true, user: { username: 'audio-regression-readonly' },
     files: [], songs: [], folders: [], stations: [], samples: [], favourites: [], patches: []
    }});
    return r.continue();
   });
   await p.goto('https://openclaw.blackcarburning.com/mygrain/');
   await p.waitForFunction(() => window.mygrainWEffects && document.documentElement.dataset.mygrainStartup === 'ready');
   await p.locator('#start-btn').click();
   await p.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended);



const result = await p.evaluate(async () => {
 stopAllPerformancePlayback({silent:true}); stopModulationLoop(); stopPerformanceMixerVuMeters();
 const trace=window.mygrainXDebug;
 if(!trace) throw Error('missing X trace');
 const disabled=trace.snapshot();
 if(disabled.enabled || disabled.events.length || disabled.samples.length) throw Error('Trace must default off');
 trace.setEnabled(true);
 // Decode and persist only to this disposable browser's local store.
 const buffer=audioContext.createBuffer(1,22050,44100);
 const pcm=buffer.getChannelData(0);for(let i=0;i<pcm.length;i++)pcm[i]=.2*Math.cos(2*Math.PI*70*i/44100);
 const wav=audioBufferToWav24bit(buffer);
 await loadBastardLoopXSampleFromResponse(new Response(wav,{headers:{'Content-Type':'audio/wav'}}),{fileName:'trace-C3.wav',sourceKey:'samples_bass'});
 try{await loadBastardLoopXSampleFromResponse(new Response('{"error":"intentional-test-error"}',{status:404,headers:{'Content-Type':'application/json'}}))}catch(_){}
 openBastardLoopXOverlay();
 const input=document.getElementById('performanceBastardLoopXStartTrim');input.value=3;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
 await Promise.resolve();
 dropboxSampleBrowserTarget=SAMPLE_BROWSER_TARGETS.bastardLoopX;
 const browserFilter=document.getElementById('dropboxSampleBrowserFilter');browserFilter.value='trace';browserFilter.dispatchEvent(new Event('input',{bubbles:true}));
 const mixer=document.getElementById('performanceBastardLoopXLevelMixer');mixer.dispatchEvent(new Event('input',{bubbles:true}));
 setBastardLoopXStep(0,{note:'C3',rest:false,accent:true,slide:false,ratchet:1},{skipSave:true});
 const off=audioContext.currentTime+.1;
 previewBastardLoopXStep({note:'C3',rest:false});
 scheduleBastardLoopXSingleVoice({note:'C3',rest:false},off,.125,null);
 bastardLoopXSequence=Array.from({length:64},()=>({note:'C3',rest:false,accent:false,slide:false,ratchet:1}));
 getBastardLoopXStepDurationSeconds=()=>.125;
 bastardLoopXTransportActive=true;bastardLoopXNextStepTime=audioContext.currentTime+.1;bastardLoopXNextStepIndex=0;
 ensureSharedRhythmClockRunning({immediate:true});
 await new Promise(r=>setTimeout(r,1500));
 document.getElementById('bastardLoopXMarkBtn').click();
 await new Promise(r=>setTimeout(r,500));
 stopBastardLoopX();
 await new Promise(r=>setTimeout(r,650));
 const snapshot=trace.snapshot(), formatted=MygrainAudioDiagnostics.formatText(phoneAudioDiagnostics.snapshot());
 const payload=buildDebugLogPayload();
 const preOff=JSON.stringify(trace.snapshot());trace.setEnabled(false);
 const stopped=trace.snapshot();
 await new Promise(r=>setTimeout(r,350));
 const after=trace.snapshot();
 // Bound the ring and duplicated export size, including saturated marked incidents.
 trace.setEnabled(true);
 for(let i=0;i<10;i++){for(let j=0;j<750;j++)trace.record('bounded-test',{value:j,note:'C3'});document.getElementById('markAudioProblemBtn').click();}
 const saturated=trace.snapshot(), saturatedBytes=new Blob([JSON.stringify(buildDebugLogPayload())]).size;
 // Saturate the fifteen-minute summary and health/marker timelines as well as
 // the detailed rings, then measure the real payload builder's duplication.
 const long=structuredClone(saturated);
 long.history.rows=Array.from({length:900},(_,i)=>[i,...Array.from({length:long.history.columns.length-1},()=>123.456789)]);
 long.health=Array.from({length:180},(_,i)=>({...long.health[0],ms:i*5000}));
 const click=long.clickTimeline[long.clickTimeline.length-1];
 long.clickTimeline=Array.from({length:128},(_,i)=>({...click,ms:i*6000}));
 const originalSnapshot=trace.snapshot;let longBytes;
 try{trace.snapshot=()=>long;longBytes=new Blob([JSON.stringify(buildDebugLogPayload())]).size;}finally{trace.snapshot=originalSnapshot;}
 trace.setEnabled(false);
 return {snapshot,formattedIncludes:formatted.includes('Loop X state / trace:'),payloadTrace:!!payload.phoneDiagnostics.application.loopX.trace,
  payloadBytes:new Blob([JSON.stringify(payload)]).size,saturatedBytes,longBytes,saturatedEvents:saturated.events.length,saturatedMarks:saturated.marks.length,
  stoppedSamples:stopped.samples.length,afterSamples:after.samples.length,stoppedEvents:stopped.events.length,afterEvents:after.events.length,
  offButton:document.getElementById('bastardLoopXTraceBtn').textContent,offMarkDisabled:document.getElementById('bastardLoopXMarkBtn').disabled,
  pending: snapshot.metrics.loadBastardLoopXSampleFromResponse?.pending };
});
const trace=result.snapshot;
fs.writeFileSync((process.env.MYGRAIN_AUDIO_EVIDENCE || '/tmp')+'/'+engine+'-x-trace.json',JSON.stringify(trace,null,2));
assert(trace.enabled);
assert(trace.events.some(e=>e.type==='voice-scheduled'&&e.detail.kind==='sequence'));
assert(trace.events.some(e=>e.type==='voice-ended'&&e.detail.kind==='preview'));
assert(trace.events.some(e=>e.type==='voice-cleanup'));
assert(trace.events.some(e=>e.type==='call-error'&&e.detail.error?.stack));
assert(trace.events.some(e=>e.type==='gui'&&e.detail.event==='input'));
assert(trace.events.some(e=>e.type==='control-applied'));
assert(trace.events.some(e=>e.type==='gui'&&e.detail.target==='dropboxSampleBrowserFilter'));
assert(trace.events.some(e=>e.type==='gui'&&e.detail.target==='performanceBastardLoopXLevelMixer'));
assert(trace.events.some(e=>e.type==='scheduler-advance'));
assert(trace.events.some(e=>e.type==='call-error'&&e.detail.name==='loadBastardLoopXSampleFromResponse'));
assert(trace.events.some(e=>e.type==='call-resolved'&&e.detail.name==='loadBastardLoopXSampleFromResponse'));
assert(trace.metrics.scheduleBastardLoopXSteps.calls>10);
assert(trace.samples.some(s=>s.meters.some(m=>m.rms>0)),'X-only probe must measure the live sound');
assert(trace.marks.length===1&&trace.marks[0].before.length>0&&trace.marks[0].after.length>0);
assert.equal(result.pending,0);assert(result.payloadTrace&&result.formattedIncludes);
assert.equal(result.stoppedSamples,result.afterSamples);assert.equal(result.stoppedEvents,result.afterEvents);
assert.equal(result.offButton,'X Trace: Off');assert(result.offMarkDisabled);
assert.equal(result.saturatedEvents,600);assert.equal(result.saturatedMarks,8);
assert(result.saturatedBytes<4*1024*1024,'Saturated log must remain submittable');
assert(result.longBytes<4*1024*1024,'Full fifteen-minute capture must remain submittable');
assert(trace.health.length>0&&trace.health[0].state.lfo.depthHz>=0);
assert(trace.history.rows.length>0&&trace.clickTimeline.length===1);
assert(trace.samples.some(s=>s.meters.some(m=>m.windowMs>250)),'X probes must overlap at 44.1/48kHz');
const report={engine,events:trace.events.length,samples:trace.samples.length,calls:trace.metrics.scheduleBastardLoopXSteps.calls,
 voiceSchedules:trace.events.filter(e=>e.type==='voice-scheduled').length,
 voiceEnds:trace.events.filter(e=>e.type==='voice-ended').length,payloadBytes:result.payloadBytes,saturatedBytes:result.saturatedBytes,longBytes:result.longBytes,
 schedulerMaxMs:trace.metrics.scheduleBastardLoopXSteps.maxMs};
console.log(report);results.push(report);
assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}
fs.writeFileSync((process.env.MYGRAIN_AUDIO_EVIDENCE || '/tmp')+'/x-trace-browser.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
