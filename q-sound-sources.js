(function(root){
'use strict';
const q=root.mygrainQ,T=root.MygrainQTheory;
if(!q||!root.document)return;
const doc=root.document, names={piano:'Piano',strings:'Strings',osc:'OSC',grain:'Grain',sample:'Sample'};
let serial=0;const prepared=new Set();
function source(){return q.state.soundSource||q.state.instrument;}
function sync(){
 for(const button of doc.querySelectorAll('[data-q-sound]')){const selected=button.dataset.qSound===source();button.setAttribute('aria-pressed',String(selected));button.classList.toggle('active',selected)}
 for(const label of doc.querySelectorAll('[data-q-sample-name]'))label.textContent=qSourceSampleBuffer?(q.state.qSampleMetadata?.fileName||'Saved Q sample')+' · C4 original pitch':'No Q sample chosen';
}
function browse(){q.setMobilePanel(null);const overlay=doc.getElementById('dropboxSampleBrowserOverlay');overlay.classList.add('q-source-browser');openDropboxSampleBrowser(SAMPLE_BROWSER_TARGETS.qSample)}
async function prepare(kind){
 if(kind==='sample'){if(!qSourceSampleBuffer)throw new Error('Choose a Q sample first.');return}
 if(kind==='osc'){prepared.add(kind);return}
 if(kind==='grain'){
  setGranularLayersEnabled(true,{silent:true,skipSave:true});
  if(!getAllGranularSources().some(item=>getBufferPeak(item.buffer)>.0001)){
   if(root.__mygrainSongRenderDeck)throw new Error('Saved Q grain sources are missing.');
   await loadBuiltInDemoSample();
  }
  ensureGranularVoicePathAudible();prepared.add(kind);
 }
}
function selected(kind,pitch){
 if(kind==='sample'){
  if(!qSourceSampleBuffer)throw new Error('Choose a Q sample first.');
  return {buffer:qSourceSampleBuffer,sample:{midi:60},offset:0,duration:qSourceSampleBuffer.duration};
 }
 return {buffer:null,sample:{midi:pitch},offset:0,duration:Infinity};
}
function createSource(kind,pitch,velocity,destination){
 const context=audioContext,note=T.noteName(pitch),id='q:'+ ++serial+':'+pitch,clock=context.createConstantSource(),silent=context.createGain();
 silent.gain.value=0;clock.connect(silent).connect(destination);
 const nodes=[silent];let oscillator=null,started=false,disconnected=false,endTime=Infinity;
 // Duplicate only the local filter nodes; oscillator generation is the shared engine.
 let input=destination;
 if(kind==='osc'){
  const drive=context.createGain(),filter=context.createBiquadFilter();
  drive.gain.value=oscSynthDriveGain?.gain.value??1;
  if(oscSynthFilter){filter.type=oscSynthFilter.type;for(const key of ['frequency','Q','gain','detune'])filter[key].value=oscSynthFilter[key].value;}
  drive.connect(filter).connect(destination);nodes.push(drive,filter);input=drive;
 }
 const wrapper={playbackRate:{value:1},onended:null,
  start(when){
   if(started)return;started=true;clock.start(when);
   if(kind==='osc'){
    playOscillatorNote(note,when,velocity/127,{role:id,voiceId:id,destination:input});oscillator=activeOscVoices.get(id);
   }else{
    startGrainStream(note,when,velocity/127,{role:id,streamId:id,destination:input,endTime,continuousLoop:true});
   }
  },
  stop(time){
   const at=Number.isFinite(time)?Math.max(context.currentTime,time):context.currentTime;
   endTime=at;
   if(kind==='grain'){const stream=activeGrains.get(id);if(stream)stream.endTime=at;if(at<=context.currentTime+.001)stopGrainStream(note,{role:id,streamId:id,immediate:true});}
   else {oscillator=activeOscVoices.get(id)||oscillator;if(oscillator)releaseTransportOscillatorVoice(oscillator,at,true);}
   try{clock.stop(at)}catch(_){}
  },
  disconnect(){
   if(disconnected)return;disconnected=true;
   if(kind==='grain')stopGrainStream(note,{role:id,streamId:id,immediate:true});
   else if((oscillator=activeOscVoices.get(id)||oscillator)){activeOscVoices.delete(id);retiringOscillatorVoices.delete(oscillator);if(oscillator.cleanupTimer)clearTimeout(oscillator.cleanupTimer);for(const node of oscillator.nodes||[])try{node.disconnect()}catch(_){}}
   try{clock.disconnect()}catch(_){}for(const node of nodes)try{node.disconnect()}catch(_){}
  }
 };
 clock.onended=()=>{const done=wrapper.onended;wrapper.disconnect();done?.()};
 return wrapper;
}
function controls(){
 const panel=doc.createElement('section');panel.className='q-source-controls';panel.setAttribute('aria-label','Q sound source');
 panel.innerHTML='<strong>Q sound</strong><div class="q-source-buttons">'+Object.entries(names).map(([key,label])=>'<span><button type="button" class="performance-btn" data-q-sound="'+key+'">'+label+'</button>'+(['osc','grain'].includes(key)?'<button type="button" class="performance-btn" data-q-source-jump="'+key+'" aria-label="Jump to '+label+' controls">Jump</button>':'')+'</span>').join('')+'</div><div class="q-source-buttons"><button type="button" class="performance-btn" data-q-sample-browse>Choose Q sample</button><button type="button" class="performance-btn" data-q-sample-random>Random sample</button></div><small data-q-sample-name></small>';
 panel.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.qSound)q.task(async()=>{await q.setSoundSource(button.dataset.qSound);sync()});
  if(button.hasAttribute('data-q-sample-browse'))browse();
  if(button.hasAttribute('data-q-sample-random'))q.task(async()=>{button.disabled=true;try{await loadRandomPerformanceSample(SAMPLE_BROWSER_TARGETS.qSample)}finally{button.disabled=false;sync()}});
  if(button.dataset.qSourceJump){
   const overlay=doc.getElementById('bastardLoopQOverlay');q.setMobilePanel(null);overlay.hidden=true;overlay.setAttribute('aria-hidden','true');doc.body.classList.remove('q-sequencer-open');
   doc.getElementById(button.dataset.qSourceJump==='osc'?'performanceKeyboardSynthJumpBtn':'performanceKeyboardGrainJumpBtn')?.click();
  }
 });return panel;
}
for(const input of doc.querySelectorAll('[data-q-field="instrument"]'))input.closest('label').hidden=true;
const browserOverlay=doc.getElementById('dropboxSampleBrowserOverlay');new MutationObserver(()=>{if(browserOverlay.hidden)browserOverlay.classList.remove('q-source-browser')}).observe(browserOverlay,{attributes:true,attributeFilter:['hidden']});
const card=doc.getElementById('bastardLoopQCard');card?.querySelector('.q-controls')?.before(controls());
const tools=doc.querySelector('#qMobileRightPanel .q-mobile-panel-content');if(tools)tools.prepend(controls());
root.mygrainQSoundSources=Object.freeze({prepare,ready:kind=>kind==='sample'?!!qSourceSampleBuffer:prepared.has(kind),selected,createSource,browse,sample:()=>qSourceSampleBuffer,sync});
const originalSync=q.sync.bind(q);q.sync=function(...args){const result=originalSync(...args);sync();return result};
sync();
})(typeof window==='object'?window:globalThis);
