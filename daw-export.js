/* DAW handoff: private server jobs; isolated current-engine render decks. */
(function(root){
'use strict';
const id=x=>document.getElementById(x),RATE=48000;
let controller=null,jobId=null,who=null,requestedCancel=false;
async function request(action,options={}){
 const r=await fetch('/mygrain/api/ftp/daw-'+action,{credentials:'same-origin',cache:'no-store',...options,headers:{'X-Mygrain-User':who||root.mygrainAccounts?.user?.username,...options.headers}});
 const data=await r.json();if(!r.ok||!data.ok)throw Error(data.error||`DAW export failed (${r.status})`);return data;
}
function status(s){if(id('dawExportStatus'))id('dawExportStatus').textContent=s;}
async function start(){
 if(controller)return;
 const c=root.mygrainSongBeta,scope=id('dawExportScope').value;
 if(c?.busy||root.mygrainCardHistory?.busy)throw Error('Wait for the current sound change to finish.');
 if(scope==='song'&&(!c?.song?.parts?.length||c.editing||c.playing))throw Error('Select a saved song, stop playback and finish its amendment first.');
 if(scope==='pattern'){await root.mygrainSongBetaAdapter.ready();root.mygrainSongBetaAdapter.assertNotRecording();}
 who=root.mygrainAccounts?.user?.username;if(!who)throw Error('Sign into MYGRAIN first.');
 requestedCancel=false;controller=new AbortController();const signal=controller.signal;
 id('dawExportStart').disabled=true;id('dawExportCancel').hidden=false;id('dawExportDownload').hidden=true;
 try{
  const folder=await root.mygrainFtp.pickFolder({title:'DAW ZIP · Choose private FTP folder',signal});if(folder===null)return;
  const name=id('dawExportName').value.trim()||(scope==='song'?c.song.name:'MYGRAIN-pattern');
  const params=new URLSearchParams({scope,name,folder,notes:id('dawExportNotes').value,reference:id('dawExportReference').checked?'1':'0'});
  let body;
  if(scope==='pattern'){status('Capturing your pattern and source sounds…');body=await root.mygrainSongBetaAdapter.capture();}
  else{params.set('songId',c.song.id);params.set('revision',String(c.song.revision));body=new Blob([]);}
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  const data=await request('start?'+params,{method:'POST',body,signal,headers:{'Content-Type':'application/zip'}});jobId=data.job.id;
  try{localStorage.setItem('mygrain-daw-job-'+who,jobId);}catch{}
  await monitor(signal);
 }catch(e){status(e.name==='AbortError'?(requestedCancel?'DAW export cancelled. No new FTP file was published.':'Export monitoring stopped. The server job can be checked after reload.'):e.message);}
 finally{controller=null;id('dawExportStart').disabled=false;id('dawExportCancel').hidden=true;}
}
async function monitor(signal){
 while(!signal.aborted){
  const {job}=await request('status?id='+encodeURIComponent(jobId),{signal});status(job.message);
  if(['done','failed','cancelled'].includes(job.state)){
   if(job.state==='done'){const a=id('dawExportDownload');a.href='/mygrain/api/ftp/file?'+new URLSearchParams({path:job.path,mygrainUser:who});a.download=job.filename;a.textContent='⇩ Download '+job.filename;a.hidden=false;}
   try{localStorage.removeItem('mygrain-daw-job-'+who);}catch{}return;
  }
  await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},1800);signal.addEventListener('abort',abort,{once:true});});
 }
}
async function cancel(){requestedCancel=true;if(!jobId){controller?.abort();return;}const data=await request('cancel?id='+encodeURIComponent(jobId),{method:'POST'});status(data.job.message);if(data.job.state==='done'){requestedCancel=false;return;}controller?.abort();}
for(const event of ['mygrain-account-changed','mygrain-account-lock'])root.addEventListener(event,()=>{controller?.abort();jobId=null;who=null;if(id('dawExportDownload'))id('dawExportDownload').hidden=true;});
if(!root.__mygrainSongRenderDeck){
 id('dawExportStart')?.addEventListener('click',()=>start().catch(e=>status(e.message)));
 id('dawExportCancel')?.addEventListener('click',()=>cancel().catch(e=>status(e.message)));
 id('dawExportFiles')?.addEventListener('click',()=>root.mygrainFtp.open());
 // Reattach after reload, without recreating the job or rewriting a ZIP.
 who=root.mygrainAccounts?.user?.username;try{jobId=localStorage.getItem('mygrain-daw-job-'+who);}catch{}
 if(jobId){controller=new AbortController();id('dawExportStart').disabled=true;id('dawExportCancel').hidden=false;monitor(controller.signal).catch(e=>status(e.message)).finally(()=>{controller=null;id('dawExportStart').disabled=false;id('dawExportCancel').hidden=true;});}
}
// The server worker uses the same renderer as Song preparation, never changes
// the editor or reuses a wet playback freeze for a dry stem.
function components(decoded){
 const m=decoded.snapshot.state.modes,b=decoded.buffers,items=[],extra=decoded.snapshot.extra||{};
 const values=value=>Array.isArray(value)?value:String(value||'').split(',').filter(v=>v&&v!=='none');
 const loops=values(m.loopLayerSolo).map(v=>String(v).toLowerCase()),grains=values(m.grainLayerSolo).map(v=>String(v).toUpperCase()),sources=values(extra.performanceSourceLayerSolo).map(v=>String(v).toLowerCase());
 const anySolo=loops.length||grains.length||sources.length;
 const loopAllowed=key=>!anySolo||loops.includes(key);
 const grainAllowed=key=>!anySolo||sources.includes('granular')||sources.includes('sample')||grains.includes(key);
 const drumSolos=values(m.drumMachineLaneSolos),drumAllowed=key=>!drumSolos.length||drumSolos.includes(key);
 const audible=key=>{
  if(key.startsWith('loop'))return loopAllowed('bastard'+key.slice(4).toLowerCase().replace('+','plus'));
  if(key.startsWith('drum'))return loopAllowed('drums')&&drumAllowed(key.slice(4));
  if(key.startsWith('K'))return loopAllowed('bastardk');
  if(key.startsWith('grain'))return grainAllowed(key==='grainMain'?'main':key.slice(5));
  if(key==='keyboard')return !anySolo||sources.includes(m.keyboardSoundSource==='sample'?'keyboardsample':m.keyboardSoundSource);
  if(key==='generatedLayer')return grainAllowed('main');
  if(key==='dryLoop')return !anySolo||sources.includes('loop');
  if(key==='dropboxSample')return loopAllowed('dropbox');
  if(key==='noise')return loopAllowed('noise');
  return !anySolo||sources.includes(key);
 };
 const add=(key,label,enabled)=>{if(enabled&&audible(key))items.push({key,label});};
 add('osc','Oscillators',m.oscillatorsEnabled);
 add('keyboard','Keyboard '+(m.keyboardSoundSource||''),['piano','strings','sample'].includes(m.keyboardSoundSource));
 add('grainMain','Grain Main',m.granularLayersEnabled&&!m.grainMainMuted);
 add('grainA','Grain A',m.granularLayersEnabled&&!m.grainAMuted);
 add('grainB','Grain B',m.granularLayersEnabled&&!m.grainBMuted);
 add('generatedLayer','Generated Sample',m.generatedSampleLayerEnabled&&b.has('generated'));
 add('dryLoop','Generated Loop',m.generatedDryLoopEnabled&&b.has('generated'));
 add('dropboxSample','Atmosphere',m.dropboxSampleLayerEnabled&&b.has('dropboxSample'));
 for(const [letter,mode] of Object.entries({A:'bastardLoopEnabled',B:'bastardLoop2Enabled',C:'bastardLoop3Enabled',V:'bastardLoopVEnabled',W:'bastardLoopWEnabled',P:'bastardLoopPEnabled',O:'bastardLoopOEnabled',L:'bastardLoopLEnabled',X:'bastardLoopXEnabled',M:'bastardLoopMEnabled','M+':'bastardLoopMPlusEnabled'}))add('loop'+letter,'Loop '+letter,m[mode]);
 add('loopQ','Q Chords',decoded.snapshot.state.q?.enabled);
 for(let i=0;i<5;i++)add('K'+(i+1),'K Track '+(i+1),m.bastardLoopKEnabled&&m.kMultitrack?.tracks?.[i]?.enabled!==false&&!m.kMultitrack?.tracks?.[i]?.mute&&b.has(i?'bastardKTrack'+(i+1):'bastardK'));
 for(const kind of ['kick','snare','hat','perc','clap','cymbals','etc']){const pattern=m['drumMachine'+kind[0].toUpperCase()+kind.slice(1)+'Pattern']||m.drumMachineExtraTracks?.[kind]?.pattern;add('drum'+kind,'Drums '+kind,m.drumMachineEnabled&&(pattern?.some(Boolean)||(kind==='snare'&&m.drumMachineRoll?.pattern?.some(Boolean))));}
 add('drumroll','Drums Snare Roll',m.drumMachineEnabled&&m.drumMachineRoll?.pattern?.some(Boolean));
 add('noise','Noise N',m.noiseN?.enabled);
 for(const item of items)if(item.key==='drumsnare')item.rollActive=drumAllowed('roll');
 return items;
}
function isolate(deck,component){
 const q={silent:true,skipSave:true,skipRestart:true};
 deck.clearAllPerformanceSoloStates(q);deck.resetStemIsolationState();deck.setBastardLoopKEnabled(false,q);
 deck.mygrainNoise?.restore({...deck.mygrainNoise.settings(),enabled:false});
 if(!['osc','grainMain','grainA','grainB','generatedLayer','keyboard'].includes(component.key)){deck.setHoldEnabled(false,q);deck.setArpeggiatorEnabled(false,q);deck.eval('heldNotes.clear()');}
 if(component.key==='noise')deck.mygrainNoise?.restore({...deck.mygrainNoise.settings(),enabled:true});
 else if(component.key.startsWith('K')){deck.setBastardLoopKEnabled(true,q);for(const [i,t]of deck.mygrainKMultitrack.tracks.entries())t.mute=i!==Number(component.key.slice(1))-1;}
 else if(component.key.startsWith('drum')){
  deck.setDrumMachineEnabled(true,q);deck.restoreDrumMachineLaneSolos([]);const keep=component.key.slice(4);
  for(const kind of ['kick','snare','hat','perc','clap','cymbals','etc'])if(kind!==keep){deck.getDrumMachinePattern(kind)?.fill(false);if(deck.eval('drumMachineExtraTracks')?.[kind])deck.eval('drumMachineExtraTracks')[kind].pattern.fill(false);}
  if(!['snare','roll'].includes(keep))deck.restoreDrumMachineRoll(null);
  if(keep==='snare'){
   if(component.rollActive===false)deck.restoreDrumMachineRoll(null);
   else deck.scheduleDrumMachineRoll=(index)=>Boolean(deck.MygrainDrumRoll.eventAt(deck.eval('drumMachineRoll'),index));
  }
 }else if(component.key.startsWith('loop')){
  const letter=component.key.slice(4),key=letter==='M+'?'bastardMPlus':'bastard'+letter;deck.applyStemIsolation(key);
 }else if(component.key!=='keyboard')deck.applyStemIsolation(component.key);
 // These are export-only bypasses in the isolated deck. Instrument tuning,
 // granular synthesis, sample slicing and note envelopes remain unchanged.
 deck.setFxMuted(true,q);deck.setFinalReverbEnabled(false,q);deck.setGlobalMixDelayEnabled(false,q);deck.setFinalFxPlacementLfoEnabled(false,q);
 deck.setFilterEnabled('lpf',false);deck.setFilterEnabled('hpf',false);deck.resetFinalPanLab();
 for(const key of ['reverb','distortion','finalDriveSoft','finalDriveHard','finalDriveFold','finalDriveCrush','finalCompressorAmount','finalSidechainAmount','delayMix','finalReverbMix'])deck.setSliderValue(key,0);
 for(const letter of ['M','MPlus'])for(const suffix of ['DelayMix','ChorusMix','RoomReverbMix','CompressorAmount'])deck.setSliderValue('performanceBastardLoop'+letter+suffix,0);
 for(const track of deck.mygrainKMultitrack?.tracks||[])Object.assign(track.processing,{delayMix:0,reverbMix:0});
 deck.updateBastardLoopMFxBusSettings();deck.updateBastardLoopMPlusFxBusSettings();
 const fx=deck.mygrainLoopFx?.settings();if(fx){for(const c of Object.values(fx.channels))Object.assign(c,{enabled:false,filterEnabled:false,lfoDepth:0,room:0,delay:0,reverbEnabled:false,delayEnabled:false});deck.mygrainLoopFx.restore(fx);}
 deck.mygrainChannelEq?.restore(null);deck.mygrainWasp?.dispose();
 if(deck.mygrainQ){deck.mygrainQ.state.room=0;deck.mygrainQ.state.delay=0;deck.mygrainQ.updateEffects();}
 deck.updateEffects();
}
function recordMidi(deck,component,origin,duration){
 const events=[],held=new Map(),key=component.key;
 const note=(n,t,d,v=100)=>{const start=t-origin;if(start<-.001||start>=duration)return;const pitch=typeof n==='string'?deck.noteNameToMidi(n):Number(n);if(!Number.isFinite(pitch))return;events.push({track:component.label,note:Math.max(0,Math.min(127,pitch)),start:Math.max(0,start),duration:Math.max(.001,Math.min(d,duration-start)),velocity:Math.max(1,Math.min(127,Math.round(v))),drum:key.startsWith('drum')});};
 const wrap=(name,fn)=>{const original=deck[name];if(typeof original==='function')deck[name]=function(...args){fn(...args);const value=original.apply(this,args);
    if(name==='playOscillatorNote'){const voices=deck.eval('activeOscVoices');for(const voice of voices.values())if(voice.startTime===args[1]&&['keyboard','arp'].includes(voice.role))deck.releaseTransportOscillatorVoice(voice,origin+duration);}
    if(name==='startGrainStream'){for(const stream of deck.eval('activeGrains').values()){if(stream.releasing)continue;const release=deck.getGranularStreamReleaseSeconds(stream);stream.endTime=origin+duration+release;stream.releasing=true;stream.releaseStartTime=origin+duration;stream.releaseEndTime=origin+duration+release;stream.releaseVelocity=stream.velocity;}}
    return value;};};
 if(key==='loopL'||key==='loopX'){
  const letter=key.slice(4);for(const type of ['SingleVoice','SynthVoice'])wrap(type==='SingleVoice'?`scheduleBastardLoop${letter}SingleVoice`:`playBastardLoop${letter}SynthVoice`,(step,t,dt,next,o={})=>note(deck.noteNameToMidi(step.note)+deck[`getBastardLoop${letter}PitchSemitones`](),t,dt*deck[`getBastardLoop${letter}StepLengthRatio`](),84*(o.levelScale||1)*(step.accent?1.3:1)));
 }else if(key==='loopQ'&&deck.mygrainQ){const orig=deck.mygrainQ.voice;deck.mygrainQ.voice=function(p,v,t,d,...args){note(p,t,d,v);return orig.call(this,p,v,t,d,...args);};}
 else if(key.startsWith('drum')){
  const kind=key.slice(4),mapping={kick:36,snare:38,roll:38,hat:42,perc:75,clap:39,cymbals:49,etc:56};
  wrap('playDrumMachineHit',(buffer,t,ratio,o={})=>{const buffers={kick:deck.eval('drumMachineKickBuffer'),snare:deck.eval('drumMachineSnareBuffer'),roll:deck.eval('drumMachineSnareBuffer'),hat:deck.eval('drumMachineHatBuffer'),perc:deck.eval('drumMachinePercBuffer'),...Object.fromEntries(Object.entries(deck.eval('drumMachineExtraTracks')||{}).map(([k,v])=>[k,v.buffer]))};if(buffers[kind]===buffer)note(mapping[kind],t,Math.min(.2,buffer.duration/(ratio||1)),(o.level??.8)*110);});
  if(kind==='hat'&&!deck.eval('drumMachineHatBuffer'))wrap('playDrumMachineHatHit',(t,o={})=>note(42,t,.1,(o.level??.8)*110));
 }else if(['osc','grainMain','grainA','grainB','generatedLayer','keyboard'].includes(key)){
  const play=key==='keyboard'?'playKeyboardSound':key==='osc'?'playOscillatorNote':'startGrainStream',stop=key==='keyboard'?'stopKeyboardSound':key==='osc'?'stopOscillatorNote':'stopGrainStream';
  wrap(play,(n,t,v=1,o={})=>{if(String(o.role||'').startsWith('bastardloop')||String(o.role||'').startsWith('q:'))return;const start=t??deck.mygrainSongBetaAdapter.context()?.currentTime??origin;const k=(o.role||'')+n;const previous=held.get(k);if(previous)previous.duration=Math.max(.001,start-origin-previous.start);const count=events.length;note(n,start,duration,v*127);if(events.length>count)held.set(k,events.at(-1));});
  wrap(stop,(n,t,o={})=>{if(t&&typeof t==='object'){o=t;t=null;}const e=held.get((o.role||'')+n);if(e){e.duration=Math.max(.001,Math.min(e.duration,(typeof t==='number'?t:deck.mygrainSongBetaAdapter.context()?.currentTime??origin)-origin-e.start));held.delete((o.role||'')+n);}});
 }
 return events;
}
async function renderComponent(decoded,timing,component,signal,write,tailSeconds=2){
 const duration=MygrainSongBeta.partDurationSeconds({...timing,repeats:1});let midi=[];
 const sourceBytes=[...decoded.buffers.values()].reduce((n,b)=>n+(b?b.length*b.numberOfChannels*4:0),0);
 if(sourceBytes*2+(duration+tailSeconds)*RATE*8*4+32*1048576>512*1048576)throw Error(component.label+' exceeds the server render memory budget. Shorten the source or pattern.');
 const buffer=await MygrainSongClock.render(mygrainSongBetaAdapter.context(),decoded,timing,signal,{
  durationSeconds:duration,tailSeconds,
  prepareDeck:deck=>{
   if(component.key==='noise'){
    // Keep envelope-driver lanes running, but capture N alone before its insert
    // bus. Muting the driver would otherwise erase follow/triggered noise.
    const graph=deck.mygrainNoise?.graph;if(!graph)throw Error('Noise render graph is not ready.');
    const output=deck.mygrainSongBetaAdapter.context().createGain();graph.gain.connect(output);deck.__dawNoiseOutput=output;
    deck.mygrainSongBetaAdapter.output=()=>output;deck.getTransportOutputLatencySeconds=()=>0;
   }else if(!component.reference)isolate(deck,component);
  },
  beforeStart:(deck,origin)=>{
   midi=recordMidi(deck,component,origin,duration);
   if(deck.__dawNoiseOutput){const p=deck.__dawNoiseOutput.gain;p.setValueAtTime(1,origin+duration-.003);p.linearRampToValueAtTime(0,origin+duration);}
   for(const [name,index]of [['playOscillatorNote',1],['startGrainStream',1],['playKeyboardSound',1],['playDrumMachineHit',1],['playDrumMachineHatHit',0],['scheduleBastardLoopLSingleVoice',1],['playBastardLoopLSynthVoice',1],['scheduleBastardLoopXSingleVoice',1],['playBastardLoopXSynthVoice',1]]){const original=deck[name];if(typeof original==='function')deck[name]=function(...args){if(typeof args[index]==='number'&&args[index]>=origin+duration-.00001)return false;if(name==='playDrumMachineHit'&&!component.reference)args[3]={...args[3],distortionAmount:0};const value=original.apply(this,args);
    if(name==='playOscillatorNote'){const voices=deck.eval('activeOscVoices');for(const voice of voices.values())if(voice.startTime===args[1]&&['keyboard','arp'].includes(voice.role))deck.releaseTransportOscillatorVoice(voice,origin+duration);}
    if(name==='startGrainStream'){for(const stream of deck.eval('activeGrains').values()){if(stream.releasing)continue;const release=deck.getGranularStreamReleaseSeconds(stream);stream.endTime=origin+duration+release;stream.releasing=true;stream.releaseStartTime=origin+duration;stream.releaseEndTime=origin+duration+release;stream.releaseVelocity=stream.velocity;}}
    return value;};}
   if(deck.mygrainQ){const voice=deck.mygrainQ.voice;deck.mygrainQ.voice=function(p,v,t,...args){if(t>=origin+duration-.00001)return;return voice.call(this,p,v,t,...args);};}

   deck.setTimeout(()=>deck.mygrainNoise?.stop(),Math.max(0,(origin+duration-deck.mygrainSongBetaAdapter.context().currentTime)*1000));
   // Prevent the next cycle from leaking into the release-tail window. Native
   // looping audio ends at the boundary; one-shots retain their natural tail.
   const ctx=deck.mygrainSongBetaAdapter.context(),create=ctx.createBufferSource.bind(ctx);
   ctx.createBufferSource=function(...args){const source=create(...args),start=source.start.bind(source),stop=source.stop.bind(source);let suppressed=false;source.start=function(t=ctx.currentTime,...rest){if(t>=origin+duration-.00001){suppressed=true;return;}start(t,...rest);if(source.loop)try{stop(origin+duration);}catch{}};source.stop=function(...a){if(!suppressed)return stop(...a)};return source;};
  }
 });
 let peak=0;for(let ch=0;ch<buffer.numberOfChannels;ch++)for(const sample of buffer.getChannelData(ch)){if(!Number.isFinite(sample))throw Error('Invalid audio in '+component.label);peak=Math.max(peak,Math.abs(sample));}
 let tailPeak=0;for(let ch=0;ch<buffer.numberOfChannels;ch++){const samples=buffer.getChannelData(ch);for(let i=Math.max(0,samples.length-4800);i<samples.length;i++)tailPeak=Math.max(tailPeak,Math.abs(samples[i]));}
 if(tailPeak>.00003){if(tailSeconds>=64)throw Error(component.label+' still has an audible release after 64 seconds. Reduce its release or omit the wet reference and retry.');return renderComponent(decoded,timing,component,signal,write,tailSeconds*2);}
 await write(buffer);return {midi,peak,tailSeconds};
}
root.mygrainDaw={components,renderComponent,RATE,start};
})(window);
