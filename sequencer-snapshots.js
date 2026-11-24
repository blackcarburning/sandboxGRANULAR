/* Per-patch sequencer memories. JSON references only; snapshots never store PCM. */
(function(root){
'use strict';
const KEYS=['drums','L','X','Q','R','E'],labels={drums:'Drum Machine',L:'L',X:'X',Q:'Q',R:'Restructure',E:'Ember'};
const copy=v=>v==null?v:JSON.parse(JSON.stringify(v));
const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(v||{},k)).map(k=>[k,copy(v[k])]));
const qKeys='instrument soundSource tonic scale customScale octave chordRoot chordType inversion voicing paletteSize transpose paletteTranspose rate gate velocity accentAmount sampleLength sampleDecay selection chordHold paletteFamilies paletteBassRoots arpEnabled arpPattern arpRepeat arpDivision arpSteps sequence customChords'.split(' ');
const voiceKeys='on pattern ratio width body gate glitch pitchJump chance'.split(' ');
let lists={},epoch=0,busy=false,locked=false,abort=null,owner=null;
const panels=new Map(),aliases=new WeakMap();
let pendingBindings=null;
function slots(){return{L:bastardLoopLSampleBuffer,X:bastardLoopXSampleBuffer,Q:qSourceSampleBuffer,...Object.fromEntries(['kick','snare','hat','perc',...Object.keys(drumMachineExtraTracks)].map(k=>['drums:'+k,drumBuffer(k)]))};}
function localRefs(key,cards=lists){const entries=key.startsWith('drums:')?cards.drums:cards[key];return(entries||[]).flatMap(e=>{const ref=key.startsWith('drums:')?e.data.references?.[key.slice(6)]:key==='Q'?e.data.qSampleReference:e.data.reference;return Array.isArray(ref?.patchAudio)?ref.patchAudio:ref?.patchAudio?[ref.patchAudio]:[];});}
function bindings(value,cards){if(value==null)return{};if(typeof value!=='object'||Array.isArray(value))throw Error('Invalid snapshot sound bindings.');const out={};for(const[key,ids]of Object.entries(value)){const refs=localRefs(key,cards);if(!['L','X','Q'].includes(key)&&!/^drums:[a-zA-Z0-9_-]+$/.test(key)||!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!/^\d+:\d+:[a-f0-9]{64}(:[a-f0-9]{64})*$/.test(id)||!refs.includes(id)))throw Error('Invalid snapshot sound binding.');if(ids.length)out[key]=[...new Set(ids)];}return out;}
function adoptRestoredAssets(valid=true){if(valid&&pendingBindings)for(const[key,ids]of Object.entries(pendingBindings)){const b=slots()[key];if(b)aliases.set(b,new Set([...(aliases.get(b)||[]),...ids]));}pendingBindings=null;}
function normalize(value){
 if(value==null)return{};
 if(value.version!==1||!value.cards||typeof value.cards!=='object'||Array.isArray(value.cards)||Object.keys(value.cards).some(k=>!KEYS.includes(k)))throw Error('Unsupported sequencer snapshots.');
 const out={};
 for(const key of KEYS){const entries=value.cards[key];if(entries==null)continue;if(!Array.isArray(entries))throw Error('Invalid sequencer snapshot list.');const ids=new Set();
  out[key]=entries.map(e=>{if(!e||typeof e.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(e.id)||ids.has(e.id)||typeof e.name!=='string'||!e.name.trim()||e.name.length>80||/[\u0000-\u001f\u007f]/.test(e.name)||!e.data||e.data.version!==1||e.data.card!==key)throw Error('Invalid sequencer snapshot.');ids.add(e.id);metadataOnly(e.data);return{id:e.id,name:e.name,data:copy(e.data)};});
 }
 bindings(value.bindings,out);
 return out;
}
function metadataOnly(value,depth=0){
 if(depth>40)throw Error('Invalid sequencer snapshot nesting.');
 if(value&&typeof value==='object'){for(const[k,v]of Object.entries(value)){if(['audio','pcm','buffer','audiobuffer','base64','__proto__','constructor','prototype'].includes(k.toLowerCase()))throw Error('Snapshots store sound references, not audio.');metadataOnly(v,depth+1);}}
 else if(typeof value==='number'&&!Number.isFinite(value))throw Error('Invalid snapshot number.');
}
function settings(){if(!KEYS.some(k=>lists[k]?.length))return;const bound={...pendingBindings};for(const[key,b]of Object.entries(slots())){const ids=localRefs(key).filter(id=>b&&aliases.get(b)?.has(id));if(ids.length)bound[key]=[...new Set(ids)];}return{version:1,cards:copy(lists),...(Object.keys(bound).length?{bindings:bound}:{})};}
function restore(value,options={}){const next=normalize(value),bound=options.source?bindings(value?.bindings,next):null;epoch++;abort?.abort();lists=next;pendingBindings=bound;drawAll();}
function clear(key){epoch++;abort?.abort();if(key)delete lists[key];else lists={};pendingBindings=null;drawAll();}
function message(key,text){const p=panels.get(key);if(p)p.querySelector('[data-status]').textContent=text;}
function guard(ticket){if(ticket!==epoch||locked||abort?.signal.aborted||owner&&(owner.context!==audioContext||owner.account!==root.mygrainAccounts?.user?.username))throw Error('Snapshot operation cancelled after a patch or account change.');}
function drumBuffer(kind){return drumMachineExtraTracks[kind]?.buffer||(kind==='kick'?drumMachineKickBuffer:kind==='snare'?drumMachineSnareBuffer:kind==='hat'?drumMachineHatBuffer:kind==='perc'?drumMachinePercBuffer:null);}
async function fingerprint(buffer,serialized=false){
 if(!buffer)return null;const hashes=[];
 for(let c=0;c<buffer.numberOfChannels;c++){
  let data=buffer.getChannelData(c);if(serialized){const encoded=new Float32Array(data.length);for(let i=0;i<data.length;i++){const x=Math.max(-1,Math.min(1,data[i]));encoded[i]=(Math.trunc(x<0?x*32768:x*32767)||0)/32768;}data=encoded;}
  hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(n=>n.toString(16).padStart(2,'0')).join(''));
 }
 return[buffer.sampleRate,buffer.length,...hashes].join(':');
}
async function localIdentities(buffer){const ids=[...new Set([...(aliases.get(buffer)||[]),await fingerprint(buffer),await fingerprint(buffer,true)])];aliases.set(buffer,new Set(ids));return ids;}
async function reference(buffer,metadata){if(!buffer)return null;return{...pick(metadata,['sourceKey','relativePath','fileName','rootNote','rootMidi','sourceRegion']),...(metadata?.relativePath?{}:{patchAudio:await localIdentities(buffer)})};}
function sameRef(a,b){return a?.sourceKey===b?.sourceKey&&a?.relativePath===b?.relativePath&&JSON.stringify(a?.sourceRegion||null)===JSON.stringify(b?.sourceRegion||null);}
async function prepareReference(ref,buffer,metadata,signal){
 if(!ref)return{buffer:null,metadata:null,changed:!!buffer};
 if(ref.patchAudio){const ids=Array.isArray(ref.patchAudio)?ref.patchAudio:[ref.patchAudio];if(!buffer||!ids.some(id=>aliases.get(buffer)?.has(id))&&!ids.includes(await fingerprint(buffer)))throw Error('This snapshot references a replaced local sound. Reload its original patch first.');aliases.set(buffer,new Set([...(aliases.get(buffer)||[]),...ids]));return{buffer,metadata,changed:false};}
 if(buffer&&sameRef(ref,metadata))return{buffer,metadata,changed:false};
 if(!ref.sourceKey||!ref.relativePath)throw Error('The saved sound reference is unavailable.');
 const response=await fetch(buildDropboxSampleSourcePreviewUrl(ref.sourceKey,ref.relativePath),{cache:'no-store',signal});
 if(!response.ok)throw Error('Could not load snapshot sound: '+(ref.fileName||ref.relativePath));
 const length=Number(response.headers.get('Content-Length'));if(length>128*1024*1024)throw Error('Snapshot sound exceeds the existing source size limit.');
 let decoded=await audioContext.decodeAudioData(await response.arrayBuffer());if(decoded.duration>MAX_SAMPLE_DURATION_SECONDS)throw Error('Snapshot sound exceeds the existing source duration limit.');
 return{buffer:decoded,metadata:copy(ref),changed:true};
}
async function capture(key){
 const data={version:1,card:key,patternLength:getPatternLengthSteps()};
 if(key==='L'||key==='X'){
  const x=key==='X';Object.assign(data,{sequence:copy(x?bastardLoopXSequence:bastardLoopLSequence),timingIndex:x?bastardLoopXTimingIndex:bastardLoopLTimingIndex,rootNote:x?bastardLoopXRootNote:bastardLoopLRootNote,sourceMode:x?(isBastardLoopXUsingSynth()?'synth':'sample'):normalizeBastardLoopLSourceMode(bastardLoopLSourceMode),pitch:x?bastardLoopXPitchSemitones:bastardLoopLPitchSemitones,reference:await reference(x?bastardLoopXSampleBuffer:bastardLoopLSampleBuffer,x?bastardLoopXSampleMetadata:bastardLoopLSampleMetadata)});
 }else if(key==='drums'){
  const m=saveState({force:true,snapshotOnly:true}).modes;
  data.patterns=pick(m,['drumMachineKickPattern','drumMachineSnarePattern','drumMachineHatPattern','drumMachinePercPattern','drumMachineKickRatchetPattern','drumMachineSnareRatchetPattern','drumMachineHatRatchetPattern','drumMachinePercRatchetPattern','drumMachineBaseAccents','drumMachineHatAccentPattern','drumMachineHatTimingMode','drumMachineRoll']);
  data.extra=Object.fromEntries(Object.entries(captureExtraDrumMachineTracks()).map(([kind,v])=>[kind,pick(v,['pattern','ratchets','accents','accentAmount'])]));
  data.clockDivider=captureClockDividers().clockDividers?.drums??1;
  data.references={};for(const kind of ['kick','snare','hat','perc',...Object.keys(drumMachineExtraTracks)])data.references[kind]=await reference(drumBuffer(kind),getDrumMachineTrackMetadata(kind));
 }else if(key==='Q'){data.q=pick(root.mygrainQ.getState(),qKeys);if(data.q.soundSource==='sample')data.qSampleReference=await reference(qSourceSampleBuffer,root.mygrainQ.state.qSampleMetadata);}
 else{
  const api=key==='E'?root.mygrainEmber:root.mygrainRestructure,s=api.settings();if(s?.version!==2)throw Error('Load the current '+labels[key]+' instrument to save sequencer snapshots.');
  data.instrument={...pick(s,['version','engineRevision','clockDivider','seed']),stepLoop:copy(s.stepLoop??null),pitch:copy(s.pitch??null),sampleSource:copy(s.sampleSource??null)};data.voices=s.voices.map(v=>pick(v,voiceKeys));
 }
 return data;
}
async function prepare(data,signal){
 const key=data.card;
 if(!Number.isInteger(data.patternLength)||data.patternLength<8||data.patternLength>64)throw Error('Invalid snapshot pattern length.');
 if(key==='L'||key==='X'){if(data.sourceMode==='synth'&&(key==='L'?isBastardLoopXUsingSynth():normalizeBastardLoopLSourceMode(bastardLoopLSourceMode)==='synth'))throw Error('OSC3 is currently connected to the other sequencer. Disconnect it before recalling this snapshot.');if(!Array.isArray(data.sequence)||data.sequence.length!==64)throw Error('Invalid note sequence.');const x=key==='X';return{sound:await prepareReference(data.reference,x?bastardLoopXSampleBuffer:bastardLoopLSampleBuffer,x?bastardLoopXSampleMetadata:bastardLoopLSampleMetadata,signal)};}
 if(key==='drums'){const sounds={};for(const[k,v]of Object.entries(data.references||{})){if(!['kick','snare','hat','perc',...Object.keys(drumMachineExtraTracks)].includes(k))throw Error('Invalid drum lane.');sounds[k]=await prepareReference(v,drumBuffer(k),getDrumMachineTrackMetadata(k),signal);}return{sounds};}
 if(key==='Q'){
  const q=root.mygrainQ,s={...q.getState(),...pick(data.q,qKeys),record:false};
  if(s.instrument!==q.state.instrument||s.soundSource!==q.state.soundSource)s.bank=null;
  if(s.soundSource==='sample'){const qSample=await prepareReference(data.qSampleReference,qSourceSampleBuffer,q.state.qSampleMetadata,signal);if(!qSample.buffer)throw Error('This snapshot has no Q sample reference. Choose a Q sample first.');return{q:{...s,bank:null,qSampleMetadata:{...pick(qSample.metadata,['sourceKey','relativePath','fileName']),rootMidi:60},qSampleSourceKey:qSample.metadata?.sourceKey},qSample,audio:null};}
  if(s.soundSource==='grain'){if(!getAllGranularSources().some(item=>getBufferPeak(item.buffer)>.0001))throw Error('Load this patch’s shared Grain source before recalling the Q snapshot.');return{q:{...s,bank:null},audio:null};}
  if(s.soundSource==='osc'){await root.mygrainQSoundSources.prepare('osc');return{q:{...s,bank:null},audio:null};}
  const piano=new root.MygrainQ.Piano(q.host);piano.select(s.instrument);if(s.bank&&q.piano.atlas)piano.restored(q.piano.atlas,s.bank);
  await piano.capture(s);return{q:{...s,bank:copy(piano.bank)},audio:piano.atlas};
 }
 const api=key==='E'?root.mygrainEmber:root.mygrainRestructure,s=api.settings();if(s?.version!==2||data.instrument?.version!==2)throw Error('Load the current '+labels[key]+' instrument before recalling this snapshot.');
 if(!Array.isArray(data.voices)||data.voices.length!==s.voices.length)throw Error('Invalid voice sequence.');
 const next={...s,...pick(data.instrument,['version','engineRevision','clockDivider','seed','stepLoop','pitch','sampleSource']),voices:s.voices.map((v,i)=>({...v,...pick(data.voices[i],voiceKeys)}))};
 await(key==='E'?root.MygrainEmber:root.MygrainRestructure).prepare(audioContext,next);return{instrument:next};
}
function installSound(key,sound){if(!sound.changed)return;const {buffer,metadata}=sound;if(key==='L'){bastardLoopLSampleBuffer=buffer;bastardLoopLSampleMetadata=metadata;}else if(key==='X'){bastardLoopXSampleBuffer=buffer;bastardLoopXSampleMetadata=metadata;}else if(drumMachineExtraTracks[key]){drumMachineExtraTracks[key].buffer=buffer;drumMachineExtraTracks[key].metadata=metadata;}else if(key==='kick'){drumMachineKickBuffer=buffer;drumMachineKickMetadata=metadata;}else if(key==='snare'){drumMachineSnareBuffer=buffer;drumMachineSnareMetadata=metadata;}else if(key==='hat'){drumMachineHatBuffer=buffer;drumMachineHatMetadata=metadata;}else if(key==='perc'){drumMachinePercBuffer=buffer;drumMachinePercMetadata=metadata;}}
async function apply(data,ready,check){
 check();const key=data.card;
 if(ready.sound?.changed||ready.qSample?.changed||ready.audio||Object.values(ready.sounds||{}).some(sound=>sound.changed)){sourceMutationSerial+=1;lastSourceWriteAt=Date.now();}
 // All shared sequencers use this one saved patch length; BPM is untouched.
 if(getPatternLengthSteps()!==data.patternLength)syncPatternLengthControls(data.patternLength,{skipSave:true});
 if(key==='L'){
  installSound(key,ready.sound);bastardLoopLSequence=data.sequence.map(normalizeBastardLoopLStep);bastardLoopLTimingIndex=clampBastardLoopLTimingIndex(data.timingIndex);bastardLoopLRootNote=data.rootNote;setBastardLoopLSourceMode(data.sourceMode,{silent:true,skipSave:true,skipRestart:true,prepareSynth:false});setBastardLoopLPitchSemitoneOffset(data.pitch,{silent:true,skipSave:true});resetBastardLoopLStepTapMemory();syncBastardLoopLUi();syncBastardLoopLEditorUi();restartBastardLoopLPlaybackIfNeeded();
 }else if(key==='X'){
  installSound(key,ready.sound);bastardLoopXSequence=data.sequence.map(normalizeBastardLoopXStep);bastardLoopXTimingIndex=clampBastardLoopXTimingIndex(data.timingIndex);bastardLoopXRootNote=data.rootNote;setBastardLoopXSourceMode(data.sourceMode,{silent:true,skipSave:true,skipRestart:true,prepareSynth:false});setBastardLoopXPitchSemitoneOffset(data.pitch,{silent:true,skipSave:true});resetBastardLoopXStepTapMemory();syncBastardLoopXUi();syncBastardLoopXEditorUi();restartBastardLoopXPlaybackIfNeeded();
 }else if(key==='drums'){
  for(const[k,v]of Object.entries(ready.sounds))installSound(k,v);
  const p=data.patterns;for(const kind of ['kick','snare','hat','perc'])setDrumMachinePattern(kind,copy(p['drumMachine'+kind[0].toUpperCase()+kind.slice(1)+'Pattern']),{skipSave:true});
  drumMachineKickRatchetPattern=normalizeDrumMachineRatchetPattern(p.drumMachineKickRatchetPattern);drumMachineSnareRatchetPattern=normalizeDrumMachineRatchetPattern(p.drumMachineSnareRatchetPattern);drumMachineHatRatchetPattern=normalizeDrumMachineRatchetPattern(p.drumMachineHatRatchetPattern);drumMachinePercRatchetPattern=normalizeDrumMachineRatchetPattern(p.drumMachinePercRatchetPattern);
  restoreDrumMachineBaseAccents(p.drumMachineBaseAccents);drumMachineHatAccentPattern=normalizeDrumMachinePattern(p.drumMachineHatAccentPattern);drumMachineHatTimingMode=p.drumMachineHatTimingMode;restoreDrumMachineRoll(p.drumMachineRoll);
  for(const[k,v]of Object.entries(data.extra||{})){const t=drumMachineExtraTracks[k];if(t)Object.assign(t,pick(v,['pattern','ratchets','accents','accentAmount']));}
  setClockDivider('drums',data.clockDivider);syncDrumMachineUi();
 }else if(key==='Q'){
  const q=root.mygrainQ,running=q.running,origin=q.origin;if(ready.qSample)qSourceSampleBuffer=ready.qSample.buffer;q.restore(ready.q);if(ready.audio)q.setAudioBuffer(ready.audio);if(running)q.start(audioContext.currentTime+.04,{origin});
 }else (key==='E'?root.mygrainEmber:root.mygrainRestructure).set(ready.instrument,{replace:true});
 const persist=async(sound,id)=>{if(!sound?.changed)return;check();if(sound.buffer)await saveAudioBufferToDB(sound.buffer,id);else await clearAudioBufferFromDB(id);check();};
 if(key==='L'||key==='X')await persist(ready.sound,key==='L'?BASTARD_LOOP_L_AUDIO_BUFFER_KEY:BASTARD_LOOP_X_AUDIO_BUFFER_KEY);
 if(key==='Q')await persist(ready.qSample,'qSourceSampleBuffer');
 if(key==='drums')for(const[k,sound]of Object.entries(ready.sounds)){const id=drumMachineExtraTracks[k]?drumMachineExtraTracks[k].id+'Buffer':({kick:DRUM_MACHINE_KICK_AUDIO_BUFFER_KEY,snare:DRUM_MACHINE_SNARE_AUDIO_BUFFER_KEY,hat:DRUM_MACHINE_HAT_AUDIO_BUFFER_KEY,perc:DRUM_MACHINE_PERC_AUDIO_BUFFER_KEY})[k];await persist(sound,id);}
}

async function edit(key,action,fn){
 if(busy||locked||stateSaveSuspended||root.mygrainSongBeta?.playing)throw Error('Finish the current operation and stop saved Song playback first.');
 busy=true;const ticket=epoch;owner={context:audioContext,account:root.mygrainAccounts?.user?.username};abort=new AbortController();drawAll();
 try{const run=async()=>{guard(ticket);await fn(ticket,abort.signal);guard(ticket);saveState();};if(root.mygrainCardHistory)await root.mygrainCardHistory.runDraftEdit(labels[key]+' snapshot '+action,run);else await run();}
 finally{busy=false;abort=null;owner=null;drawAll();}
}
async function save(key,name){name=String(name||'').trim();if(!name||name.length>80||/[\u0000-\u001f\u007f]/.test(name))throw Error('Name the snapshot using 1–80 characters.');let id;
 await edit(key,'save',async ticket=>{const data=await capture(key);guard(ticket);id=crypto.randomUUID();(lists[key]||=[]).push({id,name,data});});drawAll(key,id);return id;
}
async function recall(key,id){const entry=lists[key]?.find(e=>e.id===id);if(!entry)throw Error('Choose a saved snapshot.');await edit(key,'recall',async(ticket,signal)=>{const ready=await prepare(copy(entry.data),signal);guard(ticket);await apply(copy(entry.data),ready,()=>guard(ticket));});}
async function remove(key,id){if(!lists[key]?.some(e=>e.id===id))throw Error('Choose a saved snapshot.');await edit(key,'delete',()=>{lists[key]=lists[key].filter(e=>e.id!==id);});}
function drawAll(selectedKey,selectedId){for(const[key,p]of panels){const select=p.querySelector('select'),current=key===selectedKey?selectedId:select.value;select.replaceChildren(new Option((lists[key]?.length||0)+' saved · choose snapshot',''));for(const e of lists[key]||[])select.add(new Option(e.name,e.id));select.value=current||'';for(const button of p.querySelectorAll('button'))button.disabled=busy||locked||(button.dataset.action!=='save'&&!select.value);select.disabled=busy||locked;p.querySelector('input').disabled=busy||locked;}}
function mount(key,host){if(!host||panels.has(key))return;const panel=document.createElement('section');panel.className='sequencer-snapshots';panel.dataset.sequencerSnapshots=key;panel.setAttribute('aria-label',labels[key]+' sequencer snapshots');
 panel.innerHTML='<h4>Sequencer snapshots</h4><div class="seq-snapshot-actions"><input type="text" maxlength="80" placeholder="Snapshot name" aria-label="Snapshot name"><button type="button" data-action="save">Save snapshot</button><select aria-label="Saved sequencer snapshots"></select><button type="button" data-action="recall">Recall</button><button type="button" data-action="delete">Delete</button></div><p>Patterns, chords &amp; sound references · saved in this patch · cleared only by Mega/Sparse randomisation. Recall also restores the shared pattern length; no audio is copied.</p><p data-status role="status" aria-live="polite"></p>';
 for(const control of panel.querySelectorAll('input,select'))control.dataset.mirrorControl='true';
 panel.querySelector('select').onchange=()=>drawAll();panel.querySelector('input').onkeydown=e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();panel.querySelector('[data-action="save"]').click();}};
 for(const b of panel.querySelectorAll('button'))b.onclick=async()=>{try{const action=b.dataset.action;if(action==='save')await save(key,panel.querySelector('input').value);else if(action==='recall')await recall(key,panel.querySelector('select').value);else await remove(key,panel.querySelector('select').value);message(key,action==='save'?'Snapshot saved in this patch.':action==='recall'?'Sequencer recalled.':'Snapshot deleted.');}catch(e){message(key,e.message);}};
 const anchor=key==='drums'?host.querySelector('.drum-machine-toolbar'):host.querySelector('.performance-feature-head');if(anchor)anchor.after(panel);else host.append(panel);panels.set(key,panel);drawAll();
}
root.mygrainSequencerSnapshots={settings,restore,clear,capture,save,recall,remove,normalize,adoptRestoredAssets,get busy(){return busy;}};
const style=document.createElement('style');style.textContent='.sequencer-snapshots{margin:14px 0;padding:12px;border:1px solid #8babb277;border-radius:10px;min-width:0;box-sizing:border-box;grid-column:1/-1}.sequencer-snapshots h4{margin:0 0 8px}.seq-snapshot-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.seq-snapshot-actions input,.seq-snapshot-actions select{min-width:0;max-width:100%;flex:1 1 170px;background:#18232d;color:#fff;padding:9px;border:1px solid #89a6aa;border-radius:6px}.seq-snapshot-actions button{min-height:40px;padding:8px 12px;background:#29434c;color:#fff;border:1px solid #8baeb7;border-radius:6px}.sequencer-snapshots p{margin:8px 0 0;font-size:12px;line-height:1.4;opacity:.85}.sequencer-snapshots [data-status]{min-height:1.4em}@media(max-width:480px){.seq-snapshot-actions select{flex-basis:100%}}';document.head.append(style);
mount('drums',document.querySelector('#drumMachineOverlay .drum-machine-shell'));
for(const[key,id]of [['L','bastardLoopLCard'],['X','bastardLoopXCard'],['Q','bastardLoopQCard'],['R','restructureCard'],['E','emberCard']])mount(key,document.getElementById(id)||document.querySelector('[aria-label="Bastardloop '+key+' controls"]'));
restore(readStoredStateSnapshot()?.modes?.sequencerSnapshots,{source:true});
for(const event of ['mygrain-account-lock','mygrain-account-changed'])root.addEventListener(event,()=>{locked=true;clear();for(const p of panels.values())p.querySelector('input').value='';});
})(window);
