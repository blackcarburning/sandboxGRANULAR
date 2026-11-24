/* Session-only opt-in. Numeric pipeline indicators, never audio/patches/log text. */
(function(root){
'use strict';
if(root.__mygrainSongRenderDeck)return;
let button,status,enabled=false,run=null,timer=0,controller=null,observer=null,previous=null,errors=0,longTasks=0,longTaskMax=0;
const safe=(fn,fallback=null)=>{try{return fn()??fallback;}catch{return fallback;}};
const nativeNumbers='rate clock epoch target tempo ppq bufferMs driftPpm underruns overflows received leadMs latencySamples latencyMs mix inputPeakLeft inputPeakRight lateReturns missingBlocks inputDrops timelineJumps cycleWraps projectRevision projectBytes'.split(' ');
const nativeFlags='armed running active playing offline browserReady bypass'.split(' ');
function snapshot(){
 const now=performance.now(),ctx=safe(()=>audioContext),fx=safe(()=>root.mygrainDawFx.diagnostics()),bridge=safe(()=>root.mygrainDawBridge.diagnostics()),api=fx?.connected?fx:bridge?.connected?bridge:null,clock=api?.clock||{};
 const sample={elapsedMs:run?Math.max(0,now-run.start):0,plugin:fx?.connected?'fx':bridge?.connected?'bridge':'web',mode:fx?.connected?'fx':bridge?.connected&&bridge.mode==='rendered'?'rendered':bridge?.connected?'live':'web',contextState:['suspended','running','closed','interrupted'].includes(ctx?.state)?ctx.state:'unavailable',visible:!document.hidden,online:navigator.onLine,connected:!!api,errors,longTasks,longTaskMaxMs:longTaskMax};
 const put=(key,value)=>{if(typeof value==='number'&&Number.isFinite(value))sample[key]=Math.round(value*1000000)/1000000;};
 put('audioTime',ctx?.currentTime);put('sampleRate',ctx?.sampleRate);put('baseLatencyMs',ctx?.baseLatency*1000);put('outputLatencyMs',ctx?.outputLatency*1000);put('heapBytes',safe(()=>performance.memory.usedJSHeapSize));
 if(previous&&previous.context===ctx){const wall=now-previous.wall,advance=(ctx.currentTime-previous.audio)*1000;put('timerDelayMs',Math.max(0,wall-1000));put('audioAdvanceMs',advance);if(wall>0&&ctx.state==='running')put('clockRatio',advance/wall);}
 previous=ctx?{context:ctx,wall:now,audio:ctx.currentTime}:null;
 const schedule=safe(()=>audioSchedulingStats,{});for(const key of ['lateTicks','skippedSteps','maxLatenessMs'])put(key,schedule[key]);put('lookaheadMs',safe(()=>SCHEDULE_AHEAD_TIME*1000));put('grains',safe(()=>activeGrainNodes));put('oscillators',safe(()=>activeOscVoices.size));
 for(const key of nativeNumbers)put(key,clock[key]);for(const key of nativeFlags)if(typeof clock[key]==='boolean')sample[key]=clock[key];
 const p=api?.project;sample.ready=!!p?.ready;sample.storing=!!p?.storing;sample.historyBusy=!!root.mygrainCardHistory?.busy;sample.renderBusy=!!safe(()=>repositoryRenderInFlight,false);
 for(const [key,value] of Object.entries({projectDurationMs:p?.stats?.durationMs,projectTransferBytes:p?.stats?.transferBytes,projectStores:p?.stats?.count}))put(key,value);
 const keys=['mutilator','bassFace','turntable','henrysHose','wireWorld','sonicCrystal','bubbleChamber','resonator','wasp','playground','heavyLifter','masterBaker'];put('potMask',keys.reduce((mask,key,i)=>{const value=safe(()=>root.mygrainLayerControlHost.navigation[key]);return mask|((typeof value==='function'?safe(value,false):value?document.getElementById(value)?.getAttribute('aria-pressed')==='true':false)?1<<i:0);},0));
 return sample;
}
function paint(text){if(!button)return;button.textContent=enabled?'Telemetry: ON':'Telemetry: Off';button.setAttribute('aria-pressed',String(enabled));if(text)status.textContent=text;}
function stop(message){
 enabled=false;clearTimeout(timer);timer=0;controller?.abort();controller=null;observer?.disconnect();observer=null;root.removeEventListener('error',onError);root.removeEventListener('unhandledrejection',onError);const sent=run?.sent||0;run=null;previous=null;paint(message||'Off · '+sent+' samples sent. No further telemetry is collected or sent.');
}
function onError(){if(enabled)errors++;}
async function send(target){
 if(!enabled||run!==target||controller||!target.samples.length)return;
 const samples=target.samples.splice(0,10),sequence=target.sequence++,request=controller=new AbortController(),deadline=setTimeout(()=>request.abort(),8000);
 try{
  const response=await root.fetch('/mygrain/api/audio-telemetry',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal:request.signal,body:JSON.stringify({sessionId:target.id,sequence,startedAt:target.startedAt,build:target.build,samples})});
  const result=await response.json();if(!response.ok||!result.ok)throw Error('Telemetry upload unavailable ('+response.status+').');
  if(run===target&&enabled){target.sent+=samples.length;target.failed=0;paint('Sending audio metrics · '+target.sent+' samples · capture '+target.id.slice(0,8));}
 }catch(error){if(enabled&&run===target){target.failed++;paint('Telemetry ON · upload unavailable; retrying. Capture '+target.id.slice(0,8));if(target.failed>=3)stop('Telemetry stopped after three upload failures. Switch on to start a new capture.');}}
 finally{clearTimeout(deadline);if(controller===request)controller=null;}
}
function tick(target){
 if(!enabled||run!==target)return;
 if(!root.mygrainAccounts?.authenticated||root.mygrainAccounts.user?.username!==target.account){stop('Telemetry off · account changed.');return;}
 target.samples.push(snapshot());if(target.samples.length>10)target.samples.shift();
 if(target.sequence===0||target.samples.length>=5)void send(target);
 timer=setTimeout(()=>tick(target),1000);
}
function start(){
 if(enabled||!root.mygrainAccounts?.authenticated)return;
 enabled=true;previous=null;errors=longTasks=longTaskMax=0;
 const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
 const target=run={id,start:performance.now(),startedAt:new Date().toISOString(),build:document.querySelector('.build-badge strong')?.textContent.trim()||'vunknown',account:root.mygrainAccounts.user?.username,samples:[],sent:0,sequence:0,failed:0};
 safe(()=>{observer=new PerformanceObserver(list=>{if(!enabled||run!==target)return;for(const entry of list.getEntries()){longTasks++;longTaskMax=Math.max(longTaskMax,entry.duration);}});observer.observe({entryTypes:['longtask']});});
 root.addEventListener('error',onError);root.addEventListener('unhandledrejection',onError);paint('Sending audio timing, buffers and dropout counters. No audio or patch contents.');tick(target);
}
function mount(){
 button=document.getElementById('audioTelemetryBtn');status=document.getElementById('audioTelemetryStatus');if(!button||!status)return;
 button.onclick=()=>enabled?stop():start();paint('Off by default · enable only while reproducing an audio problem.');
}
for(const event of ['mygrain-account-lock','mygrain-account-changed','pagehide'])root.addEventListener(event,()=>stop('Telemetry off.'));
root.mygrainAudioTelemetry={start,stop,snapshot,diagnostics:()=>({enabled,sessionId:run?.id||null,sent:run?.sent||0,queued:run?.samples.length||0})};
if(document.readyState==='complete')mount();else root.addEventListener('load',mount,{once:true});
})(window);
