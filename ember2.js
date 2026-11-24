/* Ember 2 interface — new implementation. The account patch-manager block below
 * is the only UI carried forward. Existing MYGRAIN host contracts are adapters. */
(function(root){
'use strict';if(root.mygrainEmber)return;
const M=root.MygrainEmber,$=id=>document.getElementById(id),NAMES=['I','II','III','IV'];
const icon='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 3 43 14v20L24 45 5 34V14Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 26h5V15h5v19h5V14h5v19h5V22h4" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="24" cy="24" r="18" fill="none" stroke="currentColor" stroke-width="1" opacity=".28"/></svg>';
const CROSS_SCALE=100/.15;
let sectionCopy=null,soloVoice=-1,lastVoiceTap=null;
const fresh=recipe=>({...M.upgrade(recipe),crossDepth:M.upgrade(recipe).crossDepth*.15,sampleSource:{...M.upgrade(recipe).sampleSource,version:2,seed:1+Math.floor(Math.random()*16777214)}});
let state=fresh(M.defaults()),graph=null,retiringGraph=null,route=null,origin=0,selected=0,epoch=0,stopSerial=0,locked=false,graphTiming='',loadSerial=0,kOwner=null,kPreparing=false;
const card=document.createElement('section');card.id='emberCard';card.className='control-group ember-card ember2';card.setAttribute('aria-label','E Ember 2 stereo glitch instrument');
card.innerHTML=`<header class="e2-header">${icon}<div><small>E / STEREO GLITCH INSTRUMENT</small><h2>Ember <em>2</em></h2></div><span class="e2-edition">SAMPLE · SPACE<br>CROSS · MOTION</span></header>
<div class="e2-toolbar"><button id="emberPlay" type="button" class="e2-play">Play Ember 2</button><button id="emberPower" type="button" aria-pressed="false">E Off</button><button id="emberSolo" type="button" aria-pressed="false">Solo Off</button><button id="emberRandom" type="button">Generate patch</button><button id="emberInit" type="button">Clean start</button></div>
<div class="e2-k-export"><button id="emberExportK" type="button" aria-pressed="false">Export to K</button><label class="e2-k-destination">K track<select id="emberKRecordTrack" aria-label="Ember K recording destination" disabled><option value="0">K1</option><option value="1">K2</option><option value="2">K3</option><option value="3">K4</option><option value="4">K5</option></select></label><button id="emberJumpK" type="button" data-jump-target="#bastardLoopKCard">Jump to K</button><label>Steps<input id="emberKRecordSteps" type="number" min="1" step="1" inputmode="numeric" aria-label="Ember to K recording length in steps"></label><button id="emberKPattern" type="button" data-k-record-pattern>Use pattern</button><span data-k-record-length-value></span></div><p class="e2-caption">Export to K: four-beat count-in, then an exact audio-clock take of Ember only. K takes over without doubling Ember.</p>
<p id="emberStatus" class="e2-status" role="status" aria-live="polite">Four interlocking voices. One clock. Press Play Ember 2.</p>
<div class="e2-master"><label><span id="emberOutputLabel">Output · auto level</span><output id="emberVolumeOut"></output><input id="emberVolume" data-ember-volume type="range" min="0" max="100" step="1" aria-label="Ember volume"></label><label>BPM <input id="emberTempo" type="number" min="30" max="300" step="1" inputmode="numeric"></label><button id="emberFollow" type="button" aria-pressed="true">Follow song</button></div>
<label class="e2-bank-label">Sound studies · all BPM driven<div class="e2-bank"><button id="emberPrev" type="button" aria-label="Previous Ember 2 patch">‹</button><select id="emberPreset" aria-label="Ember 2 factory patch"><option value="">Custom Ember 2</option>${M.PRESETS.map(p=>'<option value="'+p.id+'">'+p.name+'</option>').join('')}</select><button id="emberNext" type="button" aria-label="Next Ember 2 patch">›</button></div></label><p id="emberPresetInfo" class="e2-caption">Normalised industry samples, rhythmic gates, LFOs and reverb timing.</p>
<div id="emberLegacy" class="e2-legacy" hidden><strong>Archived Ember 1 sound</strong><p>This saved sound is preserved in its original engine. Ember 2 starts fresh and does not convert or overwrite it.</p><button id="emberNewVersion" type="button">Start a new Ember 2</button></div>
<div id="ember2Editor"><div class="e2-sample-cut"><div class="e2-sample-width"><label for="emberSampleWidth">Sample cut width · frames<input id="emberSampleWidth" type="number" min="16" max="384000" step="1" inputmode="numeric" aria-label="Sample cut width in samples"></label><div class="e2-cut-slider"><input id="emberSampleWidthSlider" type="range" min="100" max="20000" step="100" aria-label="Sample cut width slider" aria-describedby="emberCutHelp"><div class="e2-cut-scale" aria-hidden="true"><span>100</span><span class="e2-cut-detent">5,000</span><span>20,000</span></div><div class="e2-cut-feedback" aria-live="polite"><output id="emberSampleWidthPopup" for="emberSampleWidthSlider" hidden></output><button id="emberSampleRegenerate" type="button" hidden>Regenerate</button></div></div></div><label class="e2-sample-decay">Sample decay <output id="emberSampleDecayOut">0 ms</output><input id="emberSampleDecay" type="range" min="0" max="2000" step="10" value="0" aria-label="Sample cut decay in milliseconds"><small>0 = original envelope · higher values let hits flow into the gaps.</small></label><p id="emberCutHelp" class="e2-caption">24,000 samples = 1 second. Adjust the cut, then Regenerate to apply. The slider sticks near 5,000. Randomisation never changes this width. Leading/trailing silence is trimmed before normalisation; the actual cut is shown below.</p></div><div class="e2-sample-actions"><button id="emberSamplesRandom" type="button">Regenerate samples</button><p class="e2-caption">New recordings and cut starts only. Keeps this patch, grid and current cut width.</p></div><section id="emberSamples" class="e2-samples" aria-label="Samples used by the four voices"></section><section class="e2-patterns" aria-label="Four voice rhythm patterns"><div class="e2-section-title"><h3>Sample architecture</h3><span>16 steps / bar · tap for 1–4 repeats</span></div><div class="e2-sequencer-clock"><label for="emberClockDivider">All sequencers · clock divider<select id="emberClockDivider" aria-label="All Ember sequencers clock divider">${M.DIVIDERS.map(n=>'<option value="'+n+'">÷'+n+'</option>').join('')}</select></label><button id="emberClockRandom" type="button">Randomise divider</button><button id="emberGridRandom" type="button">Randomise grid</button><button id="emberGridCopy" type="button" aria-pressed="false">Copy section</button></div><p id="emberGridCopyHint" class="e2-caption" role="status" hidden></p><p class="e2-caption">One divider for all four patterns and their repeats. Sample loops snap to musical divisions of the main BPM. Each hit restarts its sample; LFOs and reverbs keep the main BPM.</p><p class="e2-caption">I–IV: tap to edit, double-tap to solo; repeat to clear. Regen changes only that lane’s sample.</p><div id="emberPatterns"></div></section>
<section class="e2-cross"><div class="e2-section-title"><h3>Cross modulation</h3><span>Row receives from column</span></div><label>Coupling depth · gentler range <output id="emberCrossOut"></output><input id="emberCrossDepth" type="range" min="0" max="100" step="1" aria-label="Cross modulation depth"></label><div id="emberMatrix" class="e2-matrix"></div><p id="emberCrossHint" class="e2-caption">100% now equals the old 15%. Signed routes set direction; zero depth is off. Each voice can feed its reverb back into the network.</p></section>
<section class="e2-voice-editor"><div id="emberVoiceTabs" class="e2-tabs" role="tablist" aria-label="Edit voice">${NAMES.map((n,i)=>'<button id="emberVoiceTab'+i+'" type="button" role="tab" aria-selected="'+(i===0)+'" data-voice-tab="'+i+'">Voice '+n+'</button>').join('')}</div><div id="emberVoiceEditor" role="tabpanel"></div></section></div>
<div id="emberEqSlot" aria-label="Ember four-band EQ and automation"></div>
<details class="e2-library"><summary>Your saved patches</summary><section class="ember-library" aria-label="Saved Ember patches"><h3>Private patch library</h3><label for="emberPatchName">Patch name<input id="emberPatchName" type="text" maxlength="80" placeholder="Name this sound" autocomplete="off"></label><div class="ember-library-actions"><button type="button" data-ember-library="save" id="emberPatchSave">Save as new</button><button type="button" data-ember-library="replace">Replace selected</button></div><label for="emberPatchList">Account library<select id="emberPatchList"><option value="">No saved patches</option></select></label><div class="ember-library-actions"><button type="button" data-ember-library="recall" id="emberPatchLoad">Load selected</button><button type="button" data-ember-library="rename">Rename</button><button type="button" data-ember-library="delete">Delete selected</button><button type="button" data-ember-library="refresh">Refresh</button></div><p id="emberLibraryStatus" role="status">Save the complete sound, cross modulation, rhythm and EQ. Ember 1 patches stay archived.</p></section></details>
<details class="e2-guide"><summary>Inside Ember 2</summary><p>Each voice reads a different normalised industry sample through a rhythmic envelope, 96 dB/oct low/high filter edges and its own stereo feedback chamber. The cross matrix couples voices before they are summed. Width, filters, reverb and stereo position can move together or against each other.</p><p>Sample speeds snap to straight beat divisions. Every sequencer hit retriggers its cut on the grid. Stereo drift and cross phase modulation colour the read position without dragging the clock. All four sequencers share the divider above; no swing is applied. Every LFO rate is measured in beats. Reverb size is measured in beats too. Pattern cells cycle through silence and 1–4 hits. Glitch adds deterministic subdivisions and optional pitch jumps; there is no noise generator or bit crushing.</p><p>Patch changes keep the current power, output level and song/local BPM. Saving in your account also saves EQ. Whole-app randomisation does not replace Ember 2 recipes.</p></details>`;
const cCard=document.querySelector('[aria-label="Bastardloop C controls"]');
if(cCard)cCard.after(card);else document.querySelector('.synth-container').append(card);
const loopControls=document.createElement('section');loopControls.className='e2-step-loop';loopControls.setAttribute('aria-label','Ember step loop');
loopControls.innerHTML='<div class="e2-step-loop-controls"><button id="emberLoopPower" type="button" aria-pressed="false">Step loop Off</button><label>Start step<input id="emberLoopStart" type="number" min="1" max="16" step="1" inputmode="numeric" aria-label="Ember loop start step"></label><label>End step<input id="emberLoopEnd" type="number" min="1" max="16" step="1" inputmode="numeric" aria-label="Ember loop end step"></label><button id="emberLoopBack" type="button" aria-label="Move Ember step loop back one step">&lt;</button><button id="emberLoopForward" type="button" aria-label="Move Ember step loop forward one step">&gt;</button></div><p class="e2-caption">Inclusive range for all four voices. Arrows move the whole range one step; Off plays all 16 steps.</p><p id="emberTimingStatus" class="e2-caption" role="status" aria-live="polite"></p>';
$('emberGridCopyHint').before(loopControls);
const pitchControls=document.createElement('section');pitchControls.className='e2-pitch';pitchControls.setAttribute('aria-label','Global Ember pitch');pitchControls.innerHTML='<label for="emberPitch">Global pitch · ±2 octaves<output id="emberPitchOut">0 st</output><input id="emberPitch" type="range" min="-24" max="24" step="1" value="0" aria-label="Global Ember pitch in semitones"></label><div class="e2-pitch-actions"><label for="emberPitchMode">Sample duration<select id="emberPitchMode"><option value="keep">Keep duration · time stretch</option><option value="speed">Pitch + speed · change duration</option></select></label><button id="emberPitchReset" type="button">Reset pitch</button></div><p class="e2-caption">All four voices · −24 to +24 semitones. Keep duration preserves each sample cycle; Pitch + speed shortens higher cuts and lengthens lower cuts. Patterns, LFOs and reverb stay on the BPM. Changes wait for the next shared bar.</p>';card.querySelector('.e2-master').after(pitchControls);
function status(text){$('emberStatus').textContent=text;}
let sampleViewKey='';
function drawSamples(){
 const host=$('emberSamples'),A=root.MygrainEmberSamples;host.hidden=!state.sampleSource;if(!state.sampleSource){host.replaceChildren();sampleViewKey='';return;}
 const bank=A.prepared(state),key=A.key(state)+(bank?'ready':'pending');if(key===sampleViewKey)return;sampleViewKey=key;
 const heading=document.createElement('h3');heading.textContent='Samples used';host.replaceChildren(heading);
 let picks;try{picks=bank?.picks||A.selections(state);}catch(e){const text=document.createElement('p');text.textContent=e.message;host.append(text);return;}
 picks.forEach((pick,i)=>{const item=document.createElement('article'),name=document.createElement('strong'),file=document.createElement('span'),meta=document.createElement('small'),canvas=document.createElement('canvas');item.className='e2-sample-used';name.textContent='Voice '+NAMES[i]+' · '+pick.title;file.textContent=pick.file;file.title='SAMPLES_INDUSTRY/'+pick.file;
 const record=root.MygrainIndustryCatalog.records.find(r=>r.id===pick.id),prior=record.chunks.slice(0,pick.chunk).reduce((n,c)=>n+c.frames,0),seconds=(prior+pick.start)/pick.sampleRate;
 meta.textContent='Start '+seconds.toFixed(3)+' s · '+pick.frames.toLocaleString()+' samples · '+(pick.frames/pick.sampleRate*1000).toFixed(1)+' ms'+(bank?' · normalised'+(pick.requestedFrames?' · '+(pick.trimStart+pick.trimEnd)+' silent frames trimmed':''):' · selected; waveform loads on Play');if(pick.playbackFrames)meta.textContent+=' · playback '+pick.playbackFrames.toLocaleString()+' samples · '+(pick.pitchSemitones>0?'+':'')+pick.pitchSemitones+' st · '+(pick.pitchMode==='keep'?'duration kept':'pitch + speed');canvas.width=320;canvas.height=48;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Voice '+NAMES[i]+(bank?' normalised sample waveform':' sample waveform not loaded'));
 item.append(name,file,canvas,meta);host.append(item);const paint=()=>{if(root.mygrainDisplay&&!root.mygrainDisplay.canDraw(canvas,paint))return;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='#aa6545';ctx.lineWidth=1;ctx.beginPath();const pcm=bank?.pcms[i];if(pcm){for(let x=0;x<canvas.width;x++){const from=Math.floor(x*pcm.length/canvas.width),to=Math.max(from+1,Math.floor((x+1)*pcm.length/canvas.width));let lo=1,hi=-1;for(let n=from;n<Math.min(to,pcm.length);n++){lo=Math.min(lo,pcm[n]);hi=Math.max(hi,pcm[n]);}ctx.moveTo(x+.5,24-hi*23);ctx.lineTo(x+.5,24-lo*23);}}else{ctx.moveTo(0,24);ctx.lineTo(320,24);}ctx.stroke();};paint();});
}
function gate(){return getLoopLayerSoloGain('bastarde');}
function syncTimingStatus(){card.dataset.pendingChange=String(!!retiringGraph);$('emberTimingStatus').textContent=retiringGraph?'Waiting for next bar · current sound keeps playing.':'Keep it in time · sound changes wait for the next shared bar while playing. Stop is immediate.';}
function stop({preserveCapture=false}={}){stopSerial++;loadSerial++;if(kOwner&&!preserveCapture){kOwner=null;cancelBastardLoopKRecording({silent:true});}if(retiringGraph){retiringGraph.dispose();retiringGraph=null;}if(route){route.disconnect();route=null;}if(graph){graph.dispose();graph=null;}graphTiming='';syncTimingStatus();syncPower();}
function timingKey(){return JSON.stringify([M.normalize(state),getTransportClockBpm()]);}
function queueGraph(time){
 const context=audioContext,previous=retiringGraph&&context.currentTime<graph.startTime?retiringGraph:graph;
 const next=M.createGraph(context,route.tap,state,{time,origin:time,bpm:getTransportClockBpm(),gate,monitorVoice:soloVoice,onstarted(){if(graph===next)syncTimingStatus();}});
 if(retiringGraph&&retiringGraph!==previous)retiringGraph.dispose();
 if(graph!==previous)graph.dispose();previous.cancelRetirement();retiringGraph=previous;graph=next;origin=time;graphTiming=timingKey();
 previous.retireAt(time,()=>{if(retiringGraph===previous)retiringGraph=null;previous.dispose();syncTimingStatus();});
 syncTimingStatus();syncPower();
}
function resync(){
 const owner=graph,context=audioContext,token=epoch,ticket=++loadSerial,key=timingKey();
 const restart=()=>{if(!owner||owner!==graph||context!==audioContext||token!==epoch||ticket!==loadSerial||locked||!state.enabled||key!==timingKey())return;
  const now=context.currentTime,anchor=getSharedLoopTransportOriginTime()??origin,bar=4*60/(state.tempo??getTransportClockBpm()),at=anchor+Math.max(0,Math.ceil((now+.06-anchor)/bar))*bar;
  if(state.version===2&&owner.retireAt&&route?.tap)queueGraph(at);else start(at,{reset:true});status('Ember change queued · next bar.');};
 if(state.sampleSource&&!root.MygrainEmberSamples.prepared(state)){status('Loading cuts · waiting to resync…');root.MygrainEmberSamples.prepare(state).then(()=>{restart();drawSamples();}).catch(e=>{if(ticket===loadSerial)status(e.message);});}else restart();
}
function start(at,{reset=false}={}){stop({preserveCapture:true});if(!state.enabled||!audioContext||!preFilterGainNode)return false;const ctx=audioContext,time=Number.isFinite(at)?at:ctx.currentTime+.025;origin=reset?time:(getSharedLoopTransportOriginTime()??time);
 const tap=ctx.createGain(),link=root.mygrainCharacterFx.connect('E',tap,preFilterGainNode,null,ctx);route={tap,disconnect(){link.disconnect();tap.disconnect();}};
 try{graph=M.createGraph(ctx,tap,state,{time,origin,bpm:getTransportClockBpm(),gate,monitorVoice:root.__mygrainSongRenderDeck||kOwner?-1:soloVoice});graphTiming=timingKey();if(kOwner)(graph.node||graph.output).connect(kOwner.source);syncPower();drawSamples();status(state.version===1?'Playing archived Ember 1.':state.sampleSource?'Industry samples playing · BPM-locked stereo.':'Saved pulse source playing · BPM-locked stereo.');return true;}catch(e){route.disconnect();route=null;status(e.message);throw e;}}
function update({reset=false}={}){if(graph){if(graph.output.context!==(audioContext?.__mygrainNativeContext||audioContext))stop();else if(!root.__mygrainSongRenderDeck&&(reset||graphTiming!==timingKey()))resync();else if(!retiringGraph)graph.update(state,getTransportClockBpm());}syncPower();syncMaster();syncStepLoop();}
function syncStepLoop(){
 const loop=state.stepLoop||{enabled:false,start:1,end:16};$('emberLoopPower').textContent='Step loop '+(loop.enabled?'On':'Off');$('emberLoopPower').setAttribute('aria-pressed',String(loop.enabled));$('emberLoopStart').value=loop.start;$('emberLoopEnd').value=loop.end;
 $('emberLoopStart').max=loop.end;$('emberLoopEnd').min=loop.start;$('emberLoopBack').disabled=loop.start<=1;$('emberLoopForward').disabled=loop.end>=16;
 for(const cell of $('emberPatterns').querySelectorAll('[data-step]')){const step=Number(cell.dataset.step)+1;cell.dataset.loop=loop.enabled?(step>=loop.start&&step<=loop.end?'inside':'outside'):'off';}
 syncTimingStatus();
}
function editStepLoop(change){return edit('step loop',()=>{const loop=state.stepLoop||{enabled:false,start:1,end:16};state=M.normalize({...state,stepLoop:{...loop,...change(loop)}});update();drawPatterns();});}
function syncPower(){const on=state.enabled;for(const id of ['emberPower','emberLayerPower'])if($(id)){$(id).textContent=(id==='emberLayerPower'?'Ember ':'E ')+(on?'On':'Off');$(id).setAttribute('aria-pressed',String(on));}const solo=hasLoopLayerSolo('bastarde');for(const id of ['emberSolo','emberLayerSolo'])if($(id)){$(id).textContent=solo?'Solo On':'Solo Off';$(id).setAttribute('aria-pressed',String(solo));}$('emberPlay').textContent=graph?'Stop Ember':state.version===1?'Play archive':'Play Ember 2';card.dataset.playing=String(!!graph);$('emberLayerPower')?.classList.toggle('layer-muted',!on);syncBastardLoopUi();}
// Cut gestures preview locally; a single explicit action prepares PCM and enters history.
let cutDraft=null,cutMode='idle',cutTimer=0,cutPointer=false,cutBusy=false,samplesBusy=false;
function resetCutDraft(){clearTimeout(cutTimer);cutTimer=0;cutDraft=null;cutMode='idle';cutPointer=false;}
function syncCutWidth(){
 const value=cutDraft??state.sampleSource?.frames??2000,slider=$('emberSampleWidthSlider'),button=$('emberSampleRegenerate'),popup=$('emberSampleWidthPopup'),disabled=!state.sampleSource||cutBusy||samplesBusy||locked;
 $('emberSamplesRandom').disabled=disabled||!!root.__mygrainSongRenderDeck;$('emberSamplesRandom').setAttribute('aria-busy',String(samplesBusy));for(const b of card.querySelectorAll('.e2-voice-regen')){b.disabled=disabled||!!root.__mygrainSongRenderDeck;b.setAttribute('aria-busy',String(samplesBusy));}
 $('emberSampleWidth').value=String(value);$('emberSampleWidth').disabled=disabled;slider.value=String(Math.max(100,Math.min(20000,Math.round(value/100)*100)));slider.disabled=disabled;slider.setAttribute('aria-valuetext',Number(slider.value).toLocaleString()+' frames');
 popup.textContent=value.toLocaleString()+' frames';popup.hidden=cutDraft===null||cutMode!=='value';button.hidden=cutDraft===null||cutMode!=='ready';button.disabled=disabled;const caption=cutBusy?'Regenerating…':'Regenerate';if(button.textContent!==caption)button.textContent=caption;button.setAttribute('aria-label','Regenerate sample cuts at '+value+' frames');
}
function previewCutWidth(value,{slider=false,settled=false}={}){
 if(!state.sampleSource||cutBusy||samplesBusy)return;
 let frames=slider?Math.max(100,Math.min(20000,Math.round(Number(value)/100)*100)):Math.max(16,Math.min(384000,Math.round(Number(value)||2000)));
 if(slider&&cutPointer&&Math.abs(frames-5000)<=200)frames=5000;
 clearTimeout(cutTimer);cutDraft=frames===(state.sampleSource?.frames??2000)?null:frames;cutMode=settled?'ready':'value';syncCutWidth();
 if(!cutPointer&&!settled)cutTimer=setTimeout(settleCutWidth,450);
}
function settleCutWidth(){clearTimeout(cutTimer);cutTimer=0;cutMode='ready';syncCutWidth();}
function regenerateSampleCuts(){
 if(cutDraft===null||cutBusy||samplesBusy)return Promise.resolve(false);const frames=cutDraft;cutBusy=true;settleCutWidth();
 return edit('sample cut width',async()=>{const token=epoch,next=M.normalize({...state,sampleSource:{...state.sampleSource,frames}});status('Loading sample cuts…');await root.MygrainEmberSamples.prepare(next);if(token!==epoch||locked)throw Error('Sample width change cancelled');replace(next,{keepSolo:true});status('Sample cut width: '+frames+' frames · protected from randomisation.');}).finally(()=>{cutBusy=false;syncCutWidth();});
}
// Editor action: reroll source identity only; keep every synthesis/sequencer value.
function regenerateSamples(voice=null){
 if(!state.sampleSource||cutBusy||samplesBusy||root.__mygrainSongRenderDeck)return Promise.resolve(false);
 const lane=Number.isInteger(voice)&&voice>=0&&voice<4?voice:null;
 samplesBusy=true;syncCutWidth();
 return edit(lane===null?'regenerate samples':'regenerate sample '+NAMES[lane],async()=>{
  const token=epoch,stamp=JSON.stringify(state),A=root.MygrainEmberSamples;let seed=1+Math.floor(Math.random()*16777214),next;
  if(lane===null){
   const {voiceSeeds,...source}=state.sampleSource;if(seed===source.seed)seed=seed%16777215+1;
   next=M.normalize({...state,sampleSource:{...source,seed}});
  }else{
   const picks=A.selections(state),used=new Set(picks.map(p=>p.id)),seeds=Array.from({length:4},(_,i)=>state.sampleSource.voiceSeeds?.[i]??null);
   for(let attempt=0;attempt<64;attempt++,seed=seed%16777215+1){seeds[lane]=seed;const candidate=M.normalize({...state,sampleSource:{...state.sampleSource,voiceSeeds:seeds}});if(!used.has(A.selections(candidate)[lane].id)){next=candidate;break;}}
   if(!next)throw Error('Could not find a new distinct recording. Retry Regen.');
  }
  status(lane===null?'Loading new samples · patch and grid kept…':'Loading voice '+NAMES[lane]+' sample · other lanes kept…');await A.prepare(next);
  if(token!==epoch||locked||stamp!==JSON.stringify(state))throw Error('Sample regeneration cancelled.');
  replace(next,{keepSolo:true});status(lane===null?'Samples regenerated · patch, grid and cut width unchanged.':'Voice '+NAMES[lane]+' sample regenerated · other samples and patch unchanged.');
 }).finally(()=>{samplesBusy=false;syncCutWidth();});
}
function syncPitch(){const pitch=state.pitch||{semitones:0,mode:'keep'};$('emberPitch').value=pitch.semitones;$('emberPitchOut').textContent=(pitch.semitones>0?'+':'')+pitch.semitones+' st';$('emberPitchMode').value=pitch.mode;$('emberPitchReset').disabled=pitch.semitones===0;}
function syncMaster(){syncPitch();$('emberOutputLabel').textContent=state.version===1?'Output · archive':'Output · auto level';const bpm=state.tempo??getTransportClockBpm();$('emberTempo').value=Number(bpm.toFixed(1));$('emberFollow').setAttribute('aria-pressed',String(state.tempo==null));$('emberFollow').textContent=state.tempo==null?'Following song':'Follow song';$('emberVolume').value=Math.round(state.level*100);$('emberVolumeOut').textContent=Math.round(state.level*100)+'%';root.mygrainInstrumentMixer?.sync();$('emberClockDivider').value=String(state.clockDivider??1);syncCutWidth();$('emberSampleDecay').value=Math.round((state.sampleDecay??0)*1000);$('emberSampleDecay').disabled=!state.sampleSource;$('emberSampleDecayOut').textContent=Math.round((state.sampleDecay??0)*1000)+' ms';$('emberCrossDepth').value=Math.min(100,Math.round((state.crossDepth??0)*CROSS_SCALE));$('emberCrossOut').textContent=(state.crossDepth??0)>.15?'Saved '+Math.round(state.crossDepth*100)+'% · above new range':Math.round((state.crossDepth??0)*CROSS_SCALE)+'%';$('emberCrossHint').textContent=state.version===2&&state.matrix.every(row=>row.every(n=>n===0))?'All routes are zero. Raise a matrix route to hear coupling.':state.crossDepth===0?'Coupling is off at zero depth. Raise depth to hear the active routes.':'Level-normalised audio-rate phase coupling; the sample clock stays locked. Row receives from column; signed routes set direction. 100% equals the old 15%; saved depths above this remain exact until you move the slider.';}
function edit(label,fn){resetSectionCopy();const run=async()=>{if(locked||stateSaveSuspended||bastardLoopKRecordingState!=='idle'||root.mygrainSongBeta?.playing)throw Error('Stop saved Song playback and finish the current operation before editing Ember.');await fn();saveState();};try{return Promise.resolve(root.mygrainCardHistory?root.mygrainCardHistory.runDraftEdit('Ember 2 '+label,run):run()).catch(e=>{status(e.message);sync();return false;});}catch(e){status(e.message);sync();return Promise.resolve(false);}}
function replace(next,{keepSolo=false}={}){if(!keepSolo)resetVoiceSolo();resetSectionCopy();resetCutDraft();const running=!!graph,oldVersion=state.version;state=root.__mygrainSongRenderDeck?M.normalize(next):M.upgrade(next);if(!state.enabled)stop();else if(graph&&oldVersion!==state.version){stop();if(running)start();}else if(graph)update({reset:true});sync();}
function set(value,{save=false,replace:full=false}={}){replace({...(!full?state:{}),...value});if(save)saveState();}
function restore(value){resetVoiceSolo();resetSectionCopy();resetCutDraft();epoch++;stop();state=(root.__mygrainSongRenderDeck?M.normalize:M.upgrade)(value||fresh(M.defaults()));sync();}
function applySound(recipe){return edit('patch',async()=>{const token=epoch,next=fresh(recipe);next.sampleSource.frames=state.sampleSource?.frames??2000;if(state.stepLoop)next.stepLoop={...state.stepLoop};if(state.pitch)next.pitch={...state.pitch};status('Loading four industry samples…');await root.MygrainEmberSamples.prepare(next);if(token!==epoch||locked)throw Error('Industry sample load cancelled');const {enabled,level,tempo}=state;replace({...next,enabled,level,tempo});status('Ember 2 · all clocks follow '+(tempo==null?'song BPM':tempo+' BPM')+'.');});}
function read(path){if(path.startsWith('pitch.'))return(state.pitch||{semitones:0,mode:'keep'})[path.slice(6)];const value=path.split('.').reduce((x,k)=>x[k],state);return path==='sampleDecay'?(value??0):value;}
function put(path,value){if(path.startsWith('pitch.')&&!state.pitch)state.pitch={semitones:0,mode:'keep'};const keys=path.split('.'),key=keys.pop();keys.reduce((x,k)=>x[k],state)[key]=value;}
const sliders=new WeakMap();
function bindRange(input,path,scale=1,format=v=>Math.round(v*100)+'%'){
 const output=input.parentElement.querySelector('output'),draw=()=>{if(output)output.textContent=format(Number(input.value)/scale);};
 const begin=()=>{if(!locked&&!stateSaveSuspended&&!root.mygrainCardHistory?.busy&&!root.mygrainSongBeta?.playing)sliders.set(input,{state:M.normalize(state),epoch});};input.onpointerdown=begin;input.onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key)&&!sliders.has(input))begin();};
 input.oninput=()=>{if(!sliders.has(input))begin();const before=sliders.get(input);if(!before||before.epoch!==epoch)return;draw();};
 input.onchange=()=>{const before=sliders.get(input),value=Number(input.value)/scale;sliders.delete(input);if(!before){edit(path,()=>{put(path,value);update();draw();});return;}if(before.epoch!==epoch)return;edit(path,()=>{put(path,value);update();draw();});};input.onpointercancel=()=>{const before=sliders.get(input);sliders.delete(input);if(before?.epoch===epoch){input.value=read(path)*scale;draw();}};draw();
}
function range(path,label,lo,hi,step=1,scale=100,unit='%'){const v=read(path),id='e2-'+path.replaceAll('.','-');return '<label for="'+id+'">'+label+'<output>'+Number((v*scale).toFixed(2))+unit+'</output><input id="'+id+'" data-path="'+path+'" data-scale="'+scale+'" data-unit="'+unit+'" type="range" min="'+lo+'" max="'+hi+'" step="'+step+'" value="'+v*scale+'"></label>';}
function menu(path,label,choices){const id='e2-'+path.replaceAll('.','-');return '<label for="'+id+'">'+label+'<select id="'+id+'" data-select-path="'+path+'">'+choices.map(([v,t])=>'<option value="'+v+'"'+(String(read(path))===String(v)?' selected':'')+'>'+t+'</option>').join('')+'</select></label>';}
function drawEditor(){if(state.version!==2)return;const i=selected,p='voices.'+i,v=state.voices[i];$('emberVoiceEditor').innerHTML=`<div class="e2-voice-heading"><h3>Voice ${NAMES[i]}</h3><button id="emberVoiceOn" type="button" aria-pressed="${v.on}">${v.on?'Voice On':'Voice Off'}</button><button id="emberRhythm" type="button">New rhythm</button></div>
<div class="e2-control-grid">${range(p+'.level','Voice level',0,100)}${range(p+'.ratio',state.sampleSource?'Sample speed · grid-snap':'Pitch · cycles / beat',4,512,1,1,'×')}${range(p+'.width',state.sampleSource?'Sample offset':'Pulse width',5,95)}${range(p+'.body',state.sampleSource?'Original / shifted blend':'Sine body',0,100)}${range(p+'.detune',state.sampleSource?'Stereo drift':'Stereo detune',-30,30,.5,1,state.sampleSource?'':' ct')}${range(p+'.pan','Position',-100,100,1,100,'')}${range(p+'.gate','Gate length',5,98)}${range(p+'.glitch','Glitch probability',0,100)}${range(p+'.pitchJump','Glitch pitch jump',0,24,1,1,' st')}${range(p+'.chance','Step probability',0,100)}</div>
<details open class="e2-subsection"><summary>96 dB/oct filter <span>Damped 16-pole edges · serial moving notch</span></summary><div class="e2-control-grid">${range(p+'.filter.cutoff','Cutoff',70,16000,10,1,' Hz')}${range(p+'.filter.resonance','Resonance',0,85)}${range(p+'.filter.morph','LP → BP → HP',0,100)}${range(p+'.filter.notch','Notch blend',0,100)}${range(p+'.filter.highpass','Low cut',15,2000,1,1,' Hz')}${range(p+'.filter.spread','Stereo separation',0,100)}</div></details>
<details open class="e2-subsection"><summary>Individual reverb <span>inside this voice’s cross-modulation loop</span></summary><div class="e2-control-grid">${range(p+'.reverb.mix','Wet amount',0,100)}${range(p+'.reverb.size','Room · beats',.125,2,.125,1,' beats')}${range(p+'.reverb.decay','Decay',0,94)}${range(p+'.reverb.damping','Damping',0,100)}${range(p+'.reverb.cross','Reverb → cross',0,100)}</div></details>
<details open class="e2-subsection"><summary>Stereo motion / LFO <span>BPM locked · independent left / right phase</span></summary><div class="e2-control-grid">${menu(p+'.lfo.beats','Cycle length',M.RATES.map(n=>[n,n+' beats']))}${menu(p+'.lfo.shape','Motion shape',M.SHAPES.map(n=>[n,{sine:'Sine',triangle:'Triangle',pulse:'Variable pulse',hold:'Stepped'}[n]]))}${range(p+'.lfo.width','LFO pulse width',5,95)}${range(p+'.lfo.stereo','L / R phase',0,100)}${range(p+'.lfo.widthDepth',state.sampleSource?'Sample-offset motion':'Pulse-width motion',0,100)}${range(p+'.lfo.filterDepth','Filter motion',0,100)}${range(p+'.lfo.reverbDepth','Reverb motion',0,100)}${range(p+'.lfo.panDepth','Stereo travel',0,100)}</div></details>`;
 for(const input of $('emberVoiceEditor').querySelectorAll('[data-path]')){const scale=Number(input.dataset.scale),unit=input.dataset.unit;bindRange(input,input.dataset.path,scale,v=>Number((v*scale).toFixed(2))+unit);}
 for(const input of $('emberVoiceEditor').querySelectorAll('[data-select-path]'))input.onchange=()=>edit('motion',()=>{put(input.dataset.selectPath,input.dataset.selectPath.endsWith('shape')?input.value:Number(input.value));update();});
 $('emberVoiceOn').onclick=()=>edit('voice power',()=>{state.voices[i].on=!state.voices[i].on;update();drawPatterns();drawEditor();});$('emberRhythm').onclick=()=>edit('rhythm',()=>{const fresh=M.randomPatch(state,1+Math.floor(Math.random()*16777214));state.voices[i].pattern=fresh.voices[i].pattern;update();drawPatterns();});
 card.querySelectorAll('input,select').forEach(e=>e.dataset.mirrorControl='true');
}
// Selection is local UI state; only the final repeat-fill edits canonical patterns.
function syncSectionCopy(){
 const button=$('emberGridCopy'),hint=$('emberGridCopyHint');button.setAttribute('aria-pressed',String(!!sectionCopy));button.textContent=sectionCopy?'Cancel copy':'Copy section';hint.hidden=!sectionCopy;
 if(sectionCopy)hint.textContent=sectionCopy.phase==='start'?'Copy section: tap the first source step.':sectionCopy.phase==='end'?'Voice '+NAMES[sectionCopy.voice]+': tap the last source step.':'Steps '+(sectionCopy.start+1)+'–'+(sectionCopy.end+1)+' ready. Tap the insert step in any voice; the section repeats to step 16.';
}
function resetSectionCopy(){sectionCopy=null;syncSectionCopy();for(const cell of $('emberPatterns').querySelectorAll('[data-copy]'))delete cell.dataset.copy;}
function gridStep(i,j){
 if(!sectionCopy)return edit('step',()=>{state.voices[i].pattern[j]=root.MygrainStepGrid.nextRatchet(state.voices[i].pattern[j]);update();drawPatterns();});
 if(locked||stateSaveSuspended||root.mygrainCardHistory?.busy||root.mygrainSongBeta?.playing||bastardLoopKRecordingState!=='idle'){resetSectionCopy();status('Finish the current operation before copying a section.');return;}
 if(sectionCopy.phase==='start'){sectionCopy={phase:'end',voice:i,start:j};drawPatterns();return;}
 if(sectionCopy.phase==='end'){
  if(i!==sectionCopy.voice){status('Choose the last source step in voice '+NAMES[sectionCopy.voice]+'.');return;}
  const start=Math.min(sectionCopy.start,j),end=Math.max(sectionCopy.start,j);sectionCopy={phase:'insert',voice:i,start,end,buffer:state.voices[i].pattern.slice(start,end+1)};drawPatterns();return;
 }
 const buffer=[...sectionCopy.buffer];return edit('copy section',()=>{for(let n=j;n<16;n++)state.voices[i].pattern[n]=buffer[(n-j)%buffer.length];update();drawPatterns();status('Section copied to voice '+NAMES[i]+' · steps '+(j+1)+'–16.');});
}
function resetVoiceSolo(){soloVoice=-1;lastVoiceTap=null;graph?.setMonitorVoice?.(-1);retiringGraph?.setMonitorVoice?.(-1);}
function voiceTap(i,event){
 const now=performance.now(),double=event.detail!==0&&(event.detail>=2||(lastVoiceTap?.voice===i&&now-lastVoiceTap.at<500));
 lastVoiceTap=double||event.detail===0?null:{voice:i,at:now};
 if(double&&!locked&&!stateSaveSuspended&&!root.__mygrainSongRenderDeck&&!root.mygrainSongBeta?.playing&&!kPreparing&&bastardLoopKRecordingState==='idle'){
  soloVoice=soloVoice===i?-1:i;graph?.setMonitorVoice?.(soloVoice);retiringGraph?.setMonitorVoice?.(soloVoice);status(soloVoice<0?'All Ember voices · local solo cleared.':'Voice '+NAMES[i]+' solo · double-tap again to hear all Ember voices.');
 }
 selectVoice(i);
}
function drawPatterns(){const target=$('emberPatterns');target.replaceChildren();if(state.version!==2)return;state.voices.forEach((v,i)=>{
 const row=document.createElement('div');row.className='e2-pattern';const actions=document.createElement('div');actions.className='e2-voice-actions';const tab=document.createElement('button');tab.type='button';tab.className='e2-voice-select';tab.textContent=NAMES[i];tab.dataset.solo=String(soloVoice===i);tab.title=soloVoice===i?'Solo on · double-click to hear all voices':'Tap to edit · double-click to solo this voice';tab.setAttribute('aria-label','Edit voice '+NAMES[i]+(soloVoice===i?' · solo on; double-tap to clear':' · double-tap to solo'));tab.setAttribute('aria-pressed',String(selected===i));tab.onclick=e=>voiceTap(i,e);
 const regen=document.createElement('button');regen.type='button';regen.className='e2-voice-regen';regen.textContent='Regen';regen.setAttribute('aria-label','Regenerate sample for voice '+NAMES[i]);regen.title='Regenerate only voice '+NAMES[i]+' sample';regen.disabled=!state.sampleSource||cutBusy||samplesBusy||locked||!!root.__mygrainSongRenderDeck;regen.onclick=()=>regenerateSamples(i);actions.append(tab,regen);row.append(actions);
 const cells=document.createElement('div');cells.className='e2-steps';v.pattern.forEach((value,j)=>{const b=document.createElement('button');b.type='button';b.textContent=value===0?'·':String(value);b.className='e2-step';b.dataset.step=String(j);b.dataset.value=String(value);b.setAttribute('aria-label','Voice '+NAMES[i]+' step '+(j+1)+': '+value+' hits');if(sectionCopy&&sectionCopy.voice===i&&j>=sectionCopy.start&&j<=(sectionCopy.end??sectionCopy.start))b.dataset.copy='true';b.onclick=()=>gridStep(i,j);cells.append(b);});row.append(cells);target.append(row);
 });syncSectionCopy();syncStepLoop();}
function drawMatrix(){const m=$('emberMatrix');m.replaceChildren();if(state.version!==2)return;for(let i=-1;i<4;i++)for(let j=-1;j<4;j++){if(i<0||j<0||i===j){const label=document.createElement('span');label.textContent=i<0&&j<0?'←':i===j?'—':NAMES[i<0?j:i];m.append(label);continue;}const label=document.createElement('label'),input=document.createElement('input'),out=document.createElement('output');input.type='range';input.min='-100';input.max='100';input.step='1';input.value=state.matrix[i][j]*100;input.id='emberMatrix'+i+j;input.setAttribute('aria-label','Voice '+NAMES[i]+' receives voice '+NAMES[j]);out.textContent=Math.round(state.matrix[i][j]*100)+'%';label.append(out,input);m.append(label);bindRange(input,'matrix.'+i+'.'+j,100);}}
function selectVoice(i){selected=i;for(const tab of card.querySelectorAll('[data-voice-tab]'))tab.setAttribute('aria-selected',String(Number(tab.dataset.voiceTab)===i));drawPatterns();drawEditor();}
function sync(){syncMaster();drawSamples();card.querySelector('.e2-patterns h3').textContent=state.sampleSource?'Sample architecture':'Pulse architecture';card.querySelector('.e2-edition').innerHTML=(state.sampleSource?'SAMPLE':'PULSE')+' · SPACE<br>CROSS · MOTION';$('emberPresetInfo').textContent=state.sampleSource?'Four different industry recordings · normalised · new starts on fresh patch loads.':state.version===2?'Saved pulse source preserved · Generate patch loads industry samples.':'Archived Ember 1 sound preserved.';syncPower();$('emberLegacy').hidden=state.version!==1;$('ember2Editor').hidden=state.version===1;for(const id of ['emberClockDivider','emberClockRandom','emberGridRandom','emberGridCopy','emberCrossDepth'])$(id).disabled=state.version===1;drawPatterns();drawMatrix();drawEditor();$('emberPreset').value='';}
// Session-only shuffled bag: every divider appears once per cycle, across both random controls.
let dividerBag=[];
function nextRandomDivider(){
 // A manual selection may already be the sole remaining entry; never return a no-op.
 if(dividerBag.length===1&&dividerBag[0]===state.clockDivider)dividerBag=[];
 if(!dividerBag.length){dividerBag=[...M.DIVIDERS];for(let i=dividerBag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[dividerBag[i],dividerBag[j]]=[dividerBag[j],dividerBag[i]];}}
 if(dividerBag.length>1&&dividerBag[dividerBag.length-1]===state.clockDivider){const j=Math.floor(Math.random()*(dividerBag.length-1));[dividerBag[j],dividerBag[dividerBag.length-1]]=[dividerBag[dividerBag.length-1],dividerBag[j]];}
 return dividerBag.pop();
}
function generatePatch(){return edit('new patch',async()=>{const token=epoch,next=M.randomPatch(state,1+Math.floor(Math.random()*16777214));next.crossDepth*=.15;if(state.stepLoop)next.stepLoop={...state.stepLoop};if(state.pitch)next.pitch={...state.pitch};status('Loading four industry samples…');await root.MygrainEmberSamples.prepare(next);if(token!==epoch||locked)throw Error('Industry sample load cancelled');next.clockDivider=nextRandomDivider();replace(next);status('Four normalised industry samples · fresh starts, rhythm and stereo motion.');});}
$('emberPlay').onclick=async()=>{try{if(!await ensureAudioReadyForKeyInteraction())return;if(graph){stopAllBastardLoopLayers();return;}await edit('play',async()=>{const token=epoch,ticket=stopSerial;status('Loading industry samples…');await M.prepare(audioContext,{...state,enabled:true});if(token!==epoch||locked||ticket!==stopSerial)throw Error('Sample playback cancelled.');state.enabled=true;startAllBastardLoopLayers();syncPower();});}catch(e){status(e.message);}};
$('emberPower').onclick=()=>edit('power',()=>{state.enabled=!state.enabled;if(!state.enabled)stop();else if(bastardLoopPlaying||(!root.__mygrainSongRenderDeck&&sequencerPlaying))start();syncPower();});
$('emberSolo').onclick=()=>edit('solo',()=>{setLoopLayerSolo('bastarde',{toggle:true,silent:true,skipSave:true});syncPower();});
$('emberRandom').onclick=generatePatch;$('emberInit').onclick=()=>applySound(M.defaults());$('emberNewVersion').onclick=()=>applySound(M.defaults());
$('emberTempo').onchange=()=>edit('BPM',()=>{state.tempo=Math.max(30,Math.min(300,Number($('emberTempo').value)||120));update();});$('emberFollow').onclick=()=>edit('follow song',()=>{state.tempo=null;update();});
bindRange($('emberVolume'),'level',100);bindRange($('emberCrossDepth'),'crossDepth',CROSS_SCALE,v=>Math.round(v*CROSS_SCALE)+'%');bindRange($('emberSampleDecay'),'sampleDecay',1000,v=>Math.round(v*1000)+' ms');
$('emberSampleWidth').onchange=()=>previewCutWidth($('emberSampleWidth').value,{settled:true});
$('emberSampleWidthSlider').onpointerdown=()=>{cutPointer=true;clearTimeout(cutTimer);};
$('emberSampleWidthSlider').oninput=e=>previewCutWidth(e.target.value,{slider:true});
$('emberSampleWidthSlider').onchange=()=>{cutPointer=false;settleCutWidth();};
$('emberSampleWidthSlider').onpointerup=()=>{cutPointer=false;settleCutWidth();};
$('emberSampleWidthSlider').onpointercancel=()=>{resetCutDraft();syncCutWidth();};
$('emberSampleWidthSlider').onkeydown=e=>{cutPointer=false;if(e.key==='Escape'){resetCutDraft();syncCutWidth();}};
$('emberSampleRegenerate').onclick=regenerateSampleCuts;
$('emberSamplesRandom').onclick=()=>regenerateSamples();
$('emberGridCopy').onclick=()=>{if(sectionCopy){resetSectionCopy();return;}if(locked||stateSaveSuspended||root.mygrainCardHistory?.busy||root.mygrainSongBeta?.playing||bastardLoopKRecordingState!=='idle'){status('Finish the current operation before copying a section.');return;}sectionCopy={phase:'start'};syncSectionCopy();};
bindRange($('emberPitch'),'pitch.semitones',1,value=>(value>0?'+':'')+value+' st');
$('emberPitchMode').onchange=()=>edit('pitch mode',()=>{state=M.normalize({...state,pitch:{semitones:state.pitch?.semitones??0,mode:$('emberPitchMode').value}});update();});
$('emberPitchReset').onclick=()=>edit('reset pitch',()=>{put('pitch.semitones',0);update();});
$('emberLoopPower').onclick=()=>editStepLoop(loop=>({enabled:!loop.enabled}));
$('emberLoopStart').onchange=()=>{const value=Number($('emberLoopStart').value);return editStepLoop(loop=>({start:Math.max(1,Math.min(loop.end,Math.round(value)||1))}));};
$('emberLoopEnd').onchange=()=>{const value=Number($('emberLoopEnd').value);return editStepLoop(loop=>({end:Math.max(loop.start,Math.min(16,Math.round(value)||16))}));};
for(const [id,direction]of [['emberLoopBack',-1],['emberLoopForward',1]])$(id).onclick=()=>editStepLoop(loop=>loop.start+direction<1||loop.end+direction>16?{}:{start:loop.start+direction,end:loop.end+direction});
card.addEventListener('pointerdown',e=>{if(!e.target.closest('.e2-voice-select'))lastVoiceTap=null;});
card.addEventListener('keydown',e=>{if(e.key==='Escape'&&sectionCopy){resetSectionCopy();e.stopPropagation();}});
$('emberGridRandom').onclick=()=>edit('randomise voice grid',()=>{
 const next=M.randomPatch(state,1+Math.floor(Math.random()*16777214));
 state.voices.forEach((voice,i)=>{const pattern=[...next.voices[i].pattern];if(pattern.every((n,j)=>n===voice.pattern[j]))pattern[0]=pattern[0]===0?1:0;voice.pattern=pattern;});
 update();drawPatterns();status('Voice grid randomised · samples, divider and sound settings kept.');
});
$('emberClockDivider').onchange=()=>{const value=Number($('emberClockDivider').value);edit('sequencer divider',()=>{state.clockDivider=value;update();});};
$('emberClockRandom').onclick=()=>edit('randomise sequencer divider',()=>{state.clockDivider=nextRandomDivider();update();});
$('emberPreset').onchange=()=>{const p=M.PRESETS.find(p=>p.id===$('emberPreset').value);if(p)applySound(p.settings).then(()=>{$('emberPreset').value=p.id;$('emberPresetInfo').textContent=p.description;});};
for(const [id,dir]of [['emberPrev',-1],['emberNext',1]])$(id).onclick=()=>{const options=[...$('emberPreset').options].filter(o=>o.value),index=options.findIndex(o=>o.value===$('emberPreset').value);$('emberPreset').value=options[(index+dir+options.length)%options.length].value;$('emberPreset').onchange();};
for(const tab of card.querySelectorAll('[data-voice-tab]'))tab.onclick=()=>selectVoice(Number(tab.dataset.voiceTab));
const jump=document.createElement('button');jump.id='sectionJumpEmberBtn';jump.type='button';jump.className='section-jump-option';jump.dataset.jumpTarget='#emberCard';jump.innerHTML=icon+'<span>Ember</span>';jump.onclick=()=>root.mygrainJumpToButton?.(jump);const jumpC=$('sectionJumpBastardLoop3Btn');if(jumpC)jumpC.after(jump);else document.querySelector('#sectionJumpPanel .section-jump-grid')?.append(jump);
const cLayer=$('performanceBastardLoop3ToggleBtn')?.closest('.performance-layer-switch-row');if(cLayer){const row=document.createElement('div');row.id='emberLayerRow';row.className='performance-layer-switch-row';row.innerHTML='<button type="button" class="performance-btn layer-muted" id="emberLayerPower" aria-pressed="false">Ember Off</button><button type="button" class="performance-btn performance-layer-jump-btn" id="emberLayerJump" data-jump-target="#emberCard">Jump</button><button type="button" class="performance-btn performance-layer-solo-btn" id="emberLayerSolo" aria-pressed="false">Solo Off</button>';row.children[0].onclick=()=>$('emberPower').click();row.children[1].onclick=()=>root.mygrainJumpToButton?.(row.children[1]);row.children[2].onclick=()=>$('emberSolo').click();cLayer.after(row);}root.mygrainNavigation?.refresh();
function kCapture(){
 const context=audioContext,token=epoch,serial=stopSerial,snapshot=M.normalize(state),stamp=JSON.stringify(state),source=context.createGain();let owned=null,finished=false;
 const adapter={valid:()=>context===audioContext&&token===epoch&&serial===stopSerial&&stamp===JSON.stringify(state)&&!locked,label:'Ember 2',sourceLabel:'EMBER2',source,bpm:state.tempo??getTransportClockBpm(),
  async prepare(){await M.prepare(context,{...snapshot,enabled:true});if(!adapter.valid())throw Error('Ember export cancelled after Stop or context/account change');},
  arm(){if(context!==audioContext||token!==epoch||locked)throw Error('Ember export cancelled');state.enabled=true;resetVoiceSolo();drawPatterns();kOwner=adapter;syncPower();},
  start(at){if(kOwner!==adapter||context!==audioContext||token!==epoch)throw Error('Ember export cancelled');if(!graph)start(at,{reset:true});owned=graph;if(!owned)throw Error('Ember could not start');},
  complete(){if(kOwner!==adapter||graph!==owned||context!==audioContext||token!==epoch)throw Error('Ember export interrupted');kOwner=null;state.enabled=false;stop();syncPower();},
  finish(){if(finished)return;finished=true;if(kOwner===adapter){kOwner=null;stop();}source.disconnect();}
 };return adapter;
}
$('emberExportK').onclick=async()=>{if(kPreparing){stopSerial++;kPreparing=false;$('emberExportK').textContent='Export to K';return;}if(locked||stateSaveSuspended||root.mygrainSongBeta?.playing||root.mygrainCardHistory?.busy){status('Finish the current operation before exporting to K.');return;}try{kPreparing=true;syncBastardLoopKUi();$('emberExportK').textContent='Cancel export';await handleBastardLoopKRecordButtonPress({source:'ember'});}catch(e){status(e.message);}finally{kPreparing=false;syncBastardLoopKUi();}};
$('emberKRecordTrack').onchange=()=>{try{if(!root.mygrainKMultitrack)throw Error('K recorder is still loading.');root.mygrainKMultitrack.select(Number($('emberKRecordTrack').value));}catch(e){status(e.message);syncBastardLoopKUi();}};
for(const event of ['keydown','keyup'])$('emberKRecordTrack').addEventListener(event,e=>e.stopPropagation());
$('emberJumpK').onclick=()=>root.mygrainJumpToButton?.($('emberJumpK'));
$('emberKRecordSteps').onchange=()=>{try{setBastardLoopKRecordingSteps($('emberKRecordSteps').value);}catch(e){status(e.message);syncBastardLoopKRecordingLengthControls();}};
$('emberKPattern').onclick=()=>setBastardLoopKRecordingSteps(null);
syncBastardLoopKRecordingLengthControls();
root.mygrainEmber={get preparingK(){return kPreparing;},get localSolo(){return soloVoice;},get pendingChange(){return!!retiringGraph;},kCapture,settings:()=>M.normalize(state),restore,set,start,stop,sync,update,syncGain(){graph?.setGain(gate());retiringGraph?.setGain(gate());syncPower();},get running(){return!!graph;},get graph(){return graph;},generatePatch,randomize(){state.enabled=false;stop();syncPower();},releaseContext:stop,automationClock(){const now=audioContext?.currentTime||0,active=retiringGraph&&now<(graph?.startTime??0)?retiringGraph:graph,current=active?.settings?.()||state,clockOrigin=active?.origin??origin,steps=getPatternLengthSteps(),duration=steps*60/(active?.clockBpm?.()??current.tempo??getTransportClockBpm())/4*(current.engineRevision>=2?(current.clockDivider||1):1);return{running:!!active&&state.enabled&&audioContext?.state==='running',now,steps,duration,origin:active?clockOrigin:now,cycle:Math.floor((now-clockOrigin)/duration),phase:((now-clockOrigin)%duration+duration)%duration/duration};}};
root.mygrainKMultitrack?.sync();
root.addEventListener('mygrain-ember2-samples-ready',drawSamples);root.addEventListener('mygrain-ember2-error',e=>status(e.detail));root.addEventListener('pagehide',stop);root.addEventListener('mygrain-account-lock',()=>{locked=true;restore();});root.addEventListener('mygrain-account-changed',()=>{locked=true;resetVoiceSolo();resetSectionCopy();resetCutDraft();stop();drawPatterns();syncCutWidth();});
// Private account library. Not a factory recipe ID, generic slider or render field.
let library={revision:0,patches:[]},libraryBusy=false,libraryReady=false,libraryEpoch=0,libraryLocked=false;
const libraryAbort=new AbortController(),patchList=$('emberPatchList'),patchName=$('emberPatchName');
function libraryMessage(message){$('emberLibraryStatus').textContent=message;}
function libraryButtons(){const selected=library.patches.some(p=>p.id===patchList.value);for(const b of card.querySelectorAll('[data-ember-library]'))b.disabled=libraryBusy||libraryLocked||(b.dataset.emberLibrary!=='refresh'&&!libraryReady)||(['recall','replace','rename','delete'].includes(b.dataset.emberLibrary)&&!selected);}
function drawLibrary(selected=patchList.value){patchList.replaceChildren(new Option(library.patches.length?'Choose a saved patch':'No saved patches',''));for(const p of [...library.patches].sort((a,b)=>a.name.localeCompare(b.name)))patchList.add(new Option(p.name,p.id));patchList.value=library.patches.some(p=>p.id===selected)?selected:'';libraryButtons();}
patchList.onchange=()=>{const p=library.patches.find(p=>p.id===patchList.value);if(p)patchName.value=p.name;libraryButtons();};
async function libraryRequest(payload){const epoch=libraryEpoch,response=await root.fetch('/mygrain/api/ember-patches',{method:payload?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:libraryAbort.signal,headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined});const data=await response.json();if(epoch!==libraryEpoch||libraryLocked)throw Error('Account changed. Reload to access your patches.');if(!response.ok||!data.ok)throw Error(data.error||'Ember library request failed.');library={revision:data.revision,patches:data.patches};libraryReady=true;drawLibrary(data.selectedId||patchList.value);}
function captureEmberPatch(){return{version:1,ember:M.normalize(state),eq:root.mygrainChannelEq.settings().channels.E};}
async function libraryAction(action){
 if(libraryBusy||libraryLocked)return;
 if(!root.mygrainAccountContext?.user?.username){libraryMessage('Sign in to save Ember patches.');return;}
 libraryBusy=true;libraryButtons();
 try{
  if(action==='refresh'){await libraryRequest();libraryMessage('Your private Ember library is up to date · '+library.patches.length+' saved.');return;}
  if(!libraryReady)throw Error('Refresh your library before saving.');
  if(stateSaveSuspended||root.mygrainCardHistory?.busy||root.mygrainSongBeta?.busy||root.mygrainSongBeta?.playing)throw Error('Finish the current edit and stop Song playback first.');
  const p=library.patches.find(p=>p.id===patchList.value);
  if(action!=='save'&&!p)throw Error('Choose a saved Ember patch first.');
  if(action==='recall'){
   const saved=p.settings;if(saved?.version!==1||!saved.ember||!saved.eq)throw Error('Unsupported saved Ember patch. Nothing was loaded.');
   const recipe=(root.__mygrainSongRenderDeck?M.normalize:M.upgrade)(saved.ember),eq=root.MygrainChannelEq.channel(saved.eq);let applied=false;
   await edit('load '+p.name,async()=>{const token=epoch;await root.MygrainEmberSamples.prepare(recipe);if(token!==epoch||locked)throw Error('Industry sample load cancelled');if(root.mygrainEqAutomation.info('E').write)root.mygrainEqAutomation.write('E');root.mygrainChannelEq.set('E',eq);set({...recipe,enabled:state.enabled,level:state.level,tempo:state.tempo},{replace:true});applied=true;});
   if(applied){patchName.value=p.name;libraryMessage('Loaded “'+p.name+'” including EQ and completed automation. Power, volume and tempo kept.');}
   else throw Error('Patch was not loaded. Finish the current edit and retry.');
   return;
  }
  const name=patchName.value.trim();if(['save','rename'].includes(action)&&(!name||name.length>80||/[\u0000-\u001f\u007f]/.test(name)))throw Error('Use a patch name of 1–80 characters, on one line.');
  // Destructive library actions use the existing app confirmation flow.
  if(['replace','delete'].includes(action)&&!await chooseExportSaveOptions({snapshot:false,signal:libraryAbort.signal,title:action==='delete'?'Delete Ember patch':'Replace Ember patch',description:(action==='delete'?'Delete “':'Replace the saved sound in “')+p.name+'”?',action:action==='delete'?'Delete patch':'Replace patch'}))return;
  if(libraryLocked)throw Error('Account changed. Reload to access your patches.');
  if(libraryLocked)throw Error('Account changed. Reload to access your patches.');
  const payload={action,id:p?.id,name,revision:library.revision};if(['save','replace'].includes(action))payload.settings=captureEmberPatch();
  await libraryRequest(payload);libraryMessage(action==='delete'?'Saved patch deleted; the current sound is unchanged.':'Ember patch '+(action==='rename'?'renamed':'saved to your account')+'.');
 }catch(e){if(!libraryLocked)libraryMessage(e.message||'Ember library unavailable. No save was confirmed.');}
 finally{libraryBusy=false;libraryButtons();}
}
for(const b of card.querySelectorAll('[data-ember-library]'))b.onclick=()=>libraryAction(b.dataset.emberLibrary);
function lockLibrary(){libraryEpoch++;libraryLocked=true;libraryReady=false;libraryAbort.abort();library={revision:0,patches:[]};patchName.value='';drawLibrary();libraryMessage('Account locked. Reload to access your patches.');}
for(const name of ['mygrain-account-lock','mygrain-account-changed'])root.addEventListener(name,lockLibrary);
if(!root.__mygrainSongRenderDeck)libraryAction('refresh');else{libraryLocked=true;libraryButtons();}


card.querySelectorAll("input,select").forEach(e=>e.dataset.mirrorControl="true");sync();
})(window);
