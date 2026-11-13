/* D: original loop + non-destructive exact-pattern fit and cut/gap playback.
 * The original source is portable in ZIP/IDB; derived PCM never replaces it. */
(function(root){
'use strict';
const card=document.getElementById('bastardLoopDCard'),el=id=>document.getElementById(id);
const speedValues=[.125,.25,.5,1,2,4],normalizeSpeed=value=>speedValues.includes(Number(value))?Number(value):1;
const repositories={samples_loopstore:'SAMPLES_LOOPSTORE',samples_loops:'SAMPLES_LOOPS'};
const repositoryFor=(value,metadata)=>Object.hasOwn(repositories,value)?value:metadata?.sourceKey==='samples_loops'?'samples_loops':'samples_loopstore';
const potTaps=new Set();
const {STRAINS:strains,normalize:normalizeMutilator,createGraph:mutilatorGraph}=root.MygrainMutilator;
const defaults=()=>({version:1,repository:'samples_loopstore',enabled:false,fill:'repeat',speed:1,level:.5,maximiser:0,pitch:0,reverse:false,shift:0,cut:MygrainVocalCut.normalize(),metadata:null,mutilator:normalizeMutilator()});
let state=defaults(),cache=null,voice=null,revision=0,busy=false,controller=null,preview=false,auditionSerial=0,metroTimer=null,auditionLoops=false,transportWanted=false;
const metroNodes=new Set();
let checkedCycle=null;
const clone=v=>JSON.parse(JSON.stringify(v));
const duration=()=>getPatternLengthSteps()*60/getTransportClockBpm()/4;
function settings(){return {...clone(state),metadata:bastardLoopDMetadata?clone(bastardLoopDMetadata):null};}
function restore(value){
 revision++;controller?.abort();if(el('loopDLoadStatus'))el('loopDLoadStatus').hidden=true;stop({preserveIntent:true});const v=value||{},base=defaults();
 state={...base,maximiser:Math.max(0,Math.min(100,Number(v.maximiser)||0)),repository:repositoryFor(v.repository,v.metadata),enabled:v.enabled===true,fill:v.fill==='single'?'single':'repeat',speed:normalizeSpeed(v.speed),level:Math.max(0,Math.min(1,Number.isFinite(v.level)?v.level:.5)),pitch:Math.max(-24,Math.min(24,Number(v.pitch)||0)),reverse:v.reverse===true,shift:Math.round(Number(v.shift)||0),cut:MygrainVocalCut.normalize(v.cut),mutilator:normalizeMutilator(v.mutilator)};
 bastardLoopDMetadata=v.metadata||null;cache=null;if(transportWanted&&bastardLoopPlaying)update();else sync();
}
function repetitions(buffer=sampleGridAudible('bastardLoopD',bastardLoopDBuffer)){
 if(!buffer)return 1;
 if(state.fill==='single')return state.speed;
 const metadata=sampleGridAudible('bastardLoopD',bastardLoopDMetadata,'metadata');
 const name=metadata?.fileName||metadata?.filename||'';
 const match=name.match(/(?:^|[^0-9])(\d{2,3})(?:[ _-]*bpm)(?:\b|_)/i);
 const nativeBpm=Number(metadata?.sourceBpm||match?.[1])||getTransportClockBpm();
 const naturalSeconds=buffer.duration*nativeBpm/getTransportClockBpm();
 return Math.max(1,Math.min(getPatternLengthSteps()*2,Math.round(duration()/naturalSeconds)))*state.speed;
}
// Non-destructive, stereo-linked 5ms lookahead limiter. Original PCM stays portable.
function maximise(buffer,amount){
 if(!(amount>0))return buffer;
 const channels=Array.from({length:buffer.numberOfChannels},(_,c)=>buffer.getChannelData(c)),n=buffer.length;
 let energy=0;for(const a of channels)for(const x of a)energy+=x*x;
 const rms=Math.sqrt(energy/Math.max(1,n*channels.length));if(!(rms>1e-9))return buffer;
 const boost=Math.pow(10,Math.min(24,Math.max(0,-12-20*Math.log10(rms)))*amount/2000),ceiling=Math.pow(10,-1/20);
 const peaks=new Float32Array(n);for(let i=0;i<n;i++)for(const a of channels)peaks[i]=Math.max(peaks[i],Math.abs(a[i])*boost);
 const look=Math.max(1,Math.round(buffer.sampleRate*.005)),queue=new Int32Array(n),release=Math.exp(-1/(buffer.sampleRate*.05));let head=0,tail=0,end=0,gain=1;
 const out=audioContext.createBuffer(buffer.numberOfChannels,n,buffer.sampleRate),dest=Array.from({length:channels.length},(_,c)=>out.getChannelData(c));
 for(let i=0;i<n;i++){
  while(end<Math.min(n,i+look+1)){while(tail>head&&peaks[queue[tail-1]]<=peaks[end])tail--;queue[tail++]=end++;}
  while(head<tail&&queue[head]<i)head++;
  const target=Math.min(1,ceiling/Math.max(1e-20,peaks[queue[head]]));gain=target<gain?target:target+(gain-target)*release;
  for(let c=0;c<channels.length;c++)dest[c][i]=channels[c][i]*boost*gain;
 }
 return out;
}
function setMaximiser(value){state.maximiser=Math.max(0,Math.min(100,Number(value)||0));cache=null;update();saveState();return state.maximiser;}
function fitted(){
 const raw=sampleGridAudible('bastardLoopD',bastardLoopDBuffer);if(!raw||!audioContext){cache=null;return null;}
 const frames=Math.max(1,Math.round(duration()*raw.sampleRate)),repeats=repetitions(raw),key=[frames,repeats,state.pitch,state.reverse,state.maximiser].join(':');
 if(cache?.raw===raw&&cache.context===audioContext&&cache.key===key)return cache.buffer;
 const unitFrames=Math.max(1,Math.round(frames/repeats));
 const unit=audioContext.createBuffer(raw.numberOfChannels,unitFrames,raw.sampleRate);
 MygrainVocalCut.stretchChannels(Array.from({length:raw.numberOfChannels},(_,i)=>raw.getChannelData(i)),Array.from({length:raw.numberOfChannels},(_,i)=>unit.getChannelData(i)),raw.sampleRate);
 const filled=audioContext.createBuffer(raw.numberOfChannels,frames,raw.sampleRate);
 for(let c=0;c<raw.numberOfChannels;c++){const a=unit.getChannelData(c),out=filled.getChannelData(c);for(let i=0;i<frames;i++)out[i]=a[i%a.length];}
 MygrainVocalCut.crossfadeJoins(Array.from({length:filled.numberOfChannels},(_,c)=>filled.getChannelData(c)),Array.from({length:Math.max(0,repeats-1)},(_,i)=>(i+1)*unitFrames),raw.sampleRate,true);
 const buffer=maximise(getBastardLoopPlaybackBufferForMode(filled,Math.pow(2,state.pitch/12),{preserveDuration:true,reversed:state.reverse}),state.maximiser);
 cache={raw,context:audioContext,key,buffer};return buffer;
}
function playback({uncut=false}={}){const b=fitted();return !b||uncut?b:MygrainVocalCut.gate(audioContext,b,sampleGridAudible('bastardLoopD',state.cut,'cut'),b.duration);}
function level(){return state.enabled?state.level*getLoopLayerSoloGain('bastardd'):0;}
function stop(options={}){
 if(!options.preserveIntent){transportWanted=false;checkedCycle=null;}
 auditionSerial++;if(metroTimer)clearInterval(metroTimer);metroTimer=null;
 for(const {oscillator,gain}of metroNodes){try{oscillator.stop();oscillator.disconnect();gain.disconnect()}catch{}}metroNodes.clear();
 preview=false;if(!Number.isFinite(transportSync.handoffBoundary))stopRetiredTransportVoices('bastardloopd');if(!voice)return;
 const v=voice;voice=null;
 if(Number.isFinite(transportSync.handoffBoundary)){
  const boundary=transportSync.handoffBoundary,fadeAt=Math.max(audioContext.currentTime,boundary-.002),param=v.wetCardGain?.gain;if(v.potTap)v.potTap.gain.setTargetAtTime(0,fadeAt,.0005);if(param){if(typeof param.cancelAndHoldAtTime==='function')param.cancelAndHoldAtTime(fadeAt);else{param.cancelScheduledValues(fadeAt);param.setValueAtTime(param.value,fadeAt);}param.linearRampToValueAtTime(0,boundary);}
  retireTransportVoice({role:'bastardloopd',source:v.source,gain:v.gain,cleanupNodes:[{disconnect:()=>{v.mutilator?.dispose();v.wetCardGain?.disconnect();v.potTap?.disconnect();potTaps.delete(v.potTap);root.mygrainCookingPot?.syncSources();v.route?.disconnect();}}]},transportSync.handoffBoundary);return;
 }
 try{v.source.onended=null;v.source.stop()}catch{};v.source.disconnect();v.mutilator?.dispose();v.gain.disconnect();v.wetCardGain?.disconnect();v.potTap?.disconnect();potTaps.delete(v.potTap);root.mygrainCookingPot?.syncSources();v.route?.disconnect();
}
function start(at=null,{audition=false}={}){
 if(!audition)transportWanted=true;
 if(!audioContext||audioContext.state==='closed'||!preFilterGainNode||!sampleGridAudible('bastardLoopD',bastardLoopDBuffer)||(!audition&&level()<=0))return false;
 const b=playback();if(!b)return false;
 stop({preserveIntent:true});const timing=resolveTransportLaneStart(at,'D'),time=timing.time,origin=timing.origin;
 const source=audioContext.createBufferSource(),gain=audioContext.createGain();source.buffer=b;source.loop=true;source.loopEnd=b.duration;
 const volume=audition?Math.max(.25,state.level):level();gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(volume*MIX_HEADROOM*.88,time+.004);source.connect(gain);
 const route=root.mygrainChannelEq.connect('D',gain,preFilterGainNode,source);
 const shift=state.shift*60/getTransportClockBpm()/4,elapsed=Number.isFinite(origin)?Math.max(0,time-origin):0,offset=((elapsed-shift)%b.duration+b.duration)%b.duration;
 voice={source,gain,route,origin:Number.isFinite(origin)?origin:time};source.onended=()=>{if(voice?.source===source)stop({preserveIntent:!preview})};startTransportSource(source,time,offset);root.mygrainCookingPot?.syncSources();preview=audition;return true;
}
async function audition(mode='metronome'){
 const serial=++auditionSerial;if(!await ensureAudioReadyForKeyInteraction()||serial!==auditionSerial)return;
 const origin=audioContext.currentTime+.06;
 if(mode==='loops'){startAllBastardLoopLayers(origin);start(origin,{audition:true});auditionLoops=true;return;}
 start(origin,{audition:true});let next=origin,beat=0;
 const tick=()=>{if(!voice||audioContext.state!=='running')return stop();while(next<audioContext.currentTime+.12){playKeyboardRepositoryMetronomeClick(next,beat%4===0,{nodeSet:metroNodes});next+=60/getTransportClockBpm();beat++}};
 tick();metroTimer=setInterval(tick,25);
}
function stopAudition(){const loops=auditionLoops;auditionLoops=false;stop();if(loops)stopAllBastardLoopLayers();}
function update({gainOnly=false}={}){if(gainOnly&&voice&&!preview&&level()>0){for(const n of [voice.gain,voice.wetCardGain,voice.potTap])n?.gain.setTargetAtTime(level()*MIX_HEADROOM*.88,audioContext.currentTime,.01);sync();return;}if(voice){if(preview)start(audioContext.currentTime,{audition:true});else if(level()>0)start(getSharedLoopTransportOriginTime());else stop({preserveIntent:true});}else if(transportWanted&&bastardLoopPlaying&&level()>0)start(getSharedLoopTransportOriginTime());sync();}
// A health check, not a retrigger: existing/future-scheduled voices stay untouched.
// Audio time and the shared origin keep recovery phase-locked after UI stalls.
function checkCycle(){
 if(root.__mygrainSongRenderDeck||!transportWanted||!bastardLoopPlaying||preview||!audioContext||audioContext.state!=='running'||!engineInitialized||engineStarting||stateSaveSuspended||transportSync.depth>0||busy||root.mygrainCardHistory?.busy)return false;
 const origin=getSharedLoopTransportOriginTime(),seconds=duration();
 if(!Number.isFinite(origin)||!(seconds>0))return false;
 const cycle=Math.floor((audioContext.currentTime-origin)/seconds),stamp=[origin,seconds,cycle].join(':');
 if(stamp===checkedCycle)return false;
 checkedCycle=stamp;
 if(voice||level()<=0||!bastardLoopDBuffer)return false;
 return start(origin);
}
function enable(value,options={}){state.enabled=!!value;if(value&&bastardLoopPlaying)transportWanted=true;update();if(!options.skipSave)saveState();}
function setMutilator(value,options={}){
 state.mutilator=normalizeMutilator({...state.mutilator,...value});
 if(state.mutilator.mix<=0||state.mutilator.amount<=0)state.mutilator.enabled=false;
 voice?.mutilator?.set({...state.mutilator,enabled:state.enabled&&state.mutilator.enabled&&root.mygrainEffectOutput.allows('mutilator')&&(!state.mutilator.input||state.mutilator.input==='D')});sync();if(!options.skipSave)saveState();return clone(state.mutilator);
}
function finishMutilatorRandomization(){
 if(root.mygrainCookingPot?.active())return false;
 if(state.mutilator.enabled&&((state.mutilator.input&&state.mutilator.input!=='D'?!(root.mygrainCharacterFx?.eligible(state.mutilator.input)):!state.enabled||!bastardLoopDBuffer||level()<=0)||state.mutilator.mix<=0||state.mutilator.amount<=0)){setMutilator({enabled:false},{skipSave:true});return true;}return false;
}
function randomizeMutilator(options={}){
 if(!options.configureOnly&&(state.mutilator.input&&state.mutilator.input!=='D'?!root.mygrainCharacterFx?.eligible(state.mutilator.input):!state.enabled||!bastardLoopDBuffer||level()<=0))return setMutilator({enabled:false},options);
 const random=options.random||Math.random;
 return setMutilator({enabled:true,strain:strains[Math.min(strains.length-1,Math.floor(random()*strains.length))],amount:.25+random()*.65,tone:.2+random()*.65,mix:.25+random()*.55},options);
}
function cut(value,options={}){state.cut=MygrainVocalCut.normalize(value);if(!options.skipRestart)update();else sync();if(!options.skipSave)saveState();return state.cut;}
function gapSettings(base=state.cut,random=Math.random,amount=3){
 const cycle=duration(),bar=getLoopBarDurationSeconds(),gaps=[];
 const choices=[2,1].map(bars=>bars*bar/cycle).filter(width=>width>0&&width<1-1e-9);
 if(choices.length){const width=choices[Math.floor(random()*choices.length)],slots=Math.floor(1/width+1e-9);const cell=Math.floor(random()*slots);gaps.push([cell*width,(cell+1)*width]);}
 return MygrainVocalCut.normalize({...base,gapEnabled:true,gaps});
}
function randomGaps(options={}){if(!bastardLoopDBuffer)throw Error('Load a loop in D first.');return cut(gapSettings(),options);}
function loadStatus(message,kind='loading'){
 const line=el('loopDLoadStatus');if(line){line.hidden=false;line.textContent=message;line.dataset.state=kind;}
 if(dropboxSampleBrowserTarget===SAMPLE_BROWSER_TARGETS.bastardLoopD&&!el('dropboxSampleBrowserOverlay')?.hidden)setDropboxSampleBrowserStatus(message);
}
function sync(){
 root.mygrainCookingPot?.changed();
 if(!card)return;
 const maximiser=card.querySelector('[data-loop-d-maximiser]');maximiser.value=state.maximiser;card.querySelector('[data-loop-d-maximiser-value]').textContent=state.maximiser?Math.round(state.maximiser)+'%':'Off';
 const repository=card.querySelector('[data-loop-d-repository]');repository.value=state.repository;repository.disabled=busy||repositoryChanging;card.querySelector('.performance-chip').textContent=repositories[state.repository];
 el('loopDFill').value=state.fill;el('loopDSpeed').value=String(state.speed);for(const id of ['performanceBastardLoopDLevel','performanceBastardLoopDCardLevel'])el(id).value=String(state.level*100);el('performanceBastardLoopDLevelValue').textContent=Math.round(state.level*100)+'%';const layerToggle=el('performanceBastardLoopDToggleBtn');layerToggle.classList.toggle('layer-muted',!state.enabled);layerToggle.textContent=state.enabled?'Loop D On':'Loop D Off';layerToggle.setAttribute('aria-pressed',String(state.enabled));const layerSolo=el('performanceBastardLoopDLayerSoloBtn');layerSolo.textContent=hasLoopLayerSolo('bastardd')?'Solo On':'Solo Off';layerSolo.setAttribute('aria-pressed',String(hasLoopLayerSolo('bastardd')));el('loopDPitch').value=state.pitch;
 el('loopDPitchValue').textContent=state.pitch+' st';el('loopDLevelValue').textContent=Math.round(state.level*100)+'%';el('loopDShiftValue').textContent=state.shift;
 for(const [id,on,label]of[['loopDToggle',state.enabled,'D'],['loopDReverse',state.reverse,'Reverse']]){el(id).textContent=label+(on?' On':' Off');el(id).setAttribute('aria-pressed',String(on));}
 const solo=hasLoopLayerSolo('bastardd');el('loopDSolo').textContent=solo?'Solo On':'Solo Off';el('loopDSolo').setAttribute('aria-pressed',String(solo));
 for(const id of ['loopDCut','loopDGaps'])el(id).disabled=!bastardLoopDBuffer||busy;
 for(const id of ['loopDRandom','loopDBrowse','loopDFile'])el(id).disabled=busy;
 el('loopDMeta').textContent=busy?'Loading and stretching loop…':bastardLoopDBuffer?`${bastardLoopDMetadata?.fileName||bastardLoopDMetadata?.filename||'Imported loop'} · ${duration().toFixed(3)}s · ${repetitions()} repeat${repetitions()===1?'':'s'} · ${getPatternLengthSteps()} steps`:'No loop loaded.';
 const m=state.mutilator,button=el('loopDMutilatorToggle');if(button){button.disabled=false;button.textContent='Mutilator '+(m.enabled?'On':'Off');button.setAttribute('aria-pressed',String(m.enabled));el('loopDMutilator').dataset.active=String(m.enabled);el('loopDMutilatorStrain').value=m.strain;const rhythm=el('loopDMutilator').querySelector('[data-mutilator-rhythm]');rhythm.checked=m.rhythm;rhythm.disabled=false;el('loopDMutilatorRandom').disabled=false;for(const field of ['amount','tone','mix']){const input=el('loopDMutilator'+field[0].toUpperCase()+field.slice(1));input.value=String(Math.round(m[field]*100));el(input.id+'Value').textContent=Math.round(m[field]*100)+'%';}}
 syncMutilatorBank();root.mygrainCharacterFx?.update();editor?.refresh();
}
async function apply(buffer,label,metadata={},report=null){
 if(!buffer)throw Error('Loop D has no audio frames.');
 const old=bastardLoopDBuffer;bastardLoopDBuffer=buffer;bastardLoopDMetadata={...metadata,fileName:metadata.fileName||metadata.filename||label||'loop.wav',durationSeconds:buffer.duration};cache=null;
 try{report?.('Fitting loop to the pattern…');fitted();report?.('Saving sample…');await saveAudioBufferToDB(buffer,BASTARD_LOOP_D_AUDIO_BUFFER_KEY)}catch(e){bastardLoopDBuffer=old;cache=null;throw e}update();return buffer;
}
async function load({path,file,repository=state.repository}={},options={}){
 if(!Object.hasOwn(repositories,repository))throw Error('Unknown Loop D library.');
 if(busy)throw Error('Wait for Loop D to finish loading.');
 if(!await ensureAudioReadyForKeyInteraction()){loadStatus('Load failed: Start MYGRAIN before loading Loop D.','error');throw Error('Start MYGRAIN before loading Loop D.');}
 busy=true;const token=++revision,ctx=audioContext,account=root.mygrainAccounts?.user?.username;
 const abort=controller=new AbortController();const cancel=()=>abort.abort();options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel();const guard=(browser=true)=>{if(browser)options.guard?.();if(token!==revision||ctx!==audioContext||!root.mygrainAccounts?.authenticated||account!==root.mygrainAccounts.user?.username||(browser&&abort.signal.aborted))throw Error('Loop D load cancelled because the sound or account changed.');};
 const timeout=setTimeout(()=>abort.abort(),options.batch?MEGA_RANDOM_SAMPLE_LOAD_TIMEOUT_MS:120000);sync();
 const report=message=>{if(token===revision)loadStatus(message);};
 report(file?`Reading ${file.name}…`:path?`Downloading ${path.split('/').pop()}…`:'Finding and downloading a random loop…');
 const old={buffer:bastardLoopDBuffer,metadata:bastardLoopDMetadata,state:clone(state)};
 try{
  guard();let data,meta;
  if(file){if(file.size>32*1024*1024)throw Error('Choose a loop smaller than 32 MB.');data=await file.arrayBuffer();meta={fileName:file.name,sourceKey:'import',sourceLabel:'Imported loop'};}
  else{
   const url=new URL(DROPBOX_SAMPLE_SOURCE_API_URL,document.baseURI);url.searchParams.set('source',repository);if(path)url.searchParams.set('path',path);url.searchParams.set('seed',String(Date.now())+'-'+Math.random());
   const r=await fetch(url,{cache:'no-store',signal:abort.signal});if(!r.ok){const error=await r.json().catch(()=>({}));throw Error(error.error||`Loop D sample failed (${r.status}).`);}
   if(Number(r.headers.get('Content-Length'))>32*1024*1024)throw Error('Choose a loop smaller than 32 MB.');
   data=await r.arrayBuffer();if(data.byteLength>32*1024*1024)throw Error('Choose a loop smaller than 32 MB.');
   const sourceKey=r.headers.get('X-Mygrain-Source-Key');if(sourceKey&&sourceKey!==repository)throw Error('Unexpected D source library.');
   const relativePath=decodeRepositoryHeader(r.headers.get('X-Mygrain-Source-Path'))||path||'';
   const sourceBpm=Number(r.headers.get('X-Mygrain-Source-Bpm'));
   meta={sourceKey:repository,sourceLabel:repositories[repository],relativePath,fileName:relativePath.split('/').pop()||'loop.wav',...(sourceBpm>0&&sourceBpm<=300?{sourceBpm}:{})};
  }
  guard();report(`Decoding ${meta.fileName}…`);const buffer=await ctx.decodeAudioData(data);guard();
  if(!buffer.length||buffer.duration>300)throw Error('Choose a loop no longer than five minutes.');
  state.cut=MygrainVocalCut.normalize();await apply(buffer,meta.fileName,meta,report);guard(false);if(!file)state.repository=repository;state.enabled=true;sourceMutationSerial++;
  if(bastardLoopPlaying)transportWanted=true;
  if(options.batch)randomGaps({skipSave:true,skipRestart:true});update();saveState();loadStatus(`Loaded ${meta.fileName} · ready.`, 'success');return settings();
 }catch(e){if(token===revision)loadStatus(`Load failed: ${e.message}`, 'error');if(token===revision&&ctx===audioContext&&account===root.mygrainAccounts?.user?.username){bastardLoopDBuffer=old.buffer;bastardLoopDMetadata=old.metadata;state=old.state;cache=null;if(old.buffer)await saveAudioBufferToDB(old.buffer,BASTARD_LOOP_D_AUDIO_BUFFER_KEY);else await clearAudioBufferFromDB(BASTARD_LOOP_D_AUDIO_BUFFER_KEY);update();}throw e;}
 finally{clearTimeout(timeout);options.signal?.removeEventListener('abort',cancel);if(controller===abort)controller=null;busy=false;sync();}
}
function edit(label,action){if(root.mygrainCardHistory?.busy)throw Error('Wait for the current sound change.');return root.mygrainCardHistory?root.mygrainCardHistory.runDraftEdit(label,action):action();}
let repositoryChanging=false;
async function setRepository(value){
 if(!Object.hasOwn(repositories,value))throw Error('Unknown Loop D library.');
 if(busy||repositoryChanging||root.mygrainCardHistory?.busy||root.mygrainSongBeta?.busy||root.mygrainSongBeta?.playing||stateSaveSuspended){sync();throw Error('Finish the current edit or stop Song playback first.');}
 if(value===state.repository){sync();return;}
 repositoryChanging=true;sync();
 try{await edit('D sample library',()=>{state.repository=value;sync();saveState();});
  setStatus('Loop D library saved: '+repositories[value]+'. Choose or randomise a loop to replace the current sound.');
  if(dropboxSampleBrowserTarget===SAMPLE_BROWSER_TARGETS.bastardLoopD&&!el('dropboxSampleBrowserOverlay').hidden){syncDropboxSampleBrowserTargetUi();await refreshDropboxSampleBrowser();}
 }finally{repositoryChanging=false;sync();}
}
function random(options={}){return options.batch?load({},options):edit('D random loop',()=>load({},options));}
let editor=null;
root.mygrainD={settings,restore,setMaximiser,setRepository,get repository(){return state.repository},setMutilator,randomizeMutilator,finishMutilatorRandomization,normalizeMutilator,mutilatorGraph,get mutilatorActive(){return !!voice&&[...(root.mygrainCharacterFx?.groups||[])].some(g=>g.key==='D'&&g.m.active)},get mutilatorClock(){return [...(root.mygrainCharacterFx?.groups||[])].find(g=>g.key==='D'&&g.m.active)?.m.clock||null},checkCycle,playback,fitted,repetitions,duration,apply,start,stop,stopAll(){stop();stopBrowserPreview()},enable,level,cut,randomGaps,gapSettings,sync,random,load,choose:(path,repository=state.repository)=>edit('D choose loop',()=>load({path,repository})),get busy(){return busy},get previewing(){return [SAMPLE_BROWSER_TARGETS.bastardLoopD,SAMPLE_BROWSER_TARGETS.bastardLoopV,SAMPLE_BROWSER_TARGETS.bastardLoopX].includes(dropboxSampleBrowserTarget)&&Array.from(document.querySelectorAll('#dropboxSampleBrowserList audio')).some(audio=>!audio.paused)},get potTaps(){return [...potTaps]},get potTap(){return [...(root.mygrainCharacterFx?.groups||[])].find(g=>g.key==='D'&&g.context===audioContext)?.input},get source(){return voice?.source},get gain(){return voice?.gain},get state(){return state},invalidate(){cache=null;queueMicrotask(()=>{if(transportWanted&&bastardLoopPlaying)update()})},playable:()=>state.enabled&&!!bastardLoopDBuffer&&state.level>0};

// Factory browsing remembers its place when a sound becomes Custom.
const bank=root.MygrainMutilatorPresets;let lastMutilatorPreset='',choosingMutilator=false;
const mutilatorCard=el('loopDMutilator'),bankPanel=document.createElement('section');bankPanel.className='d-mutilator-bank';bankPanel.dataset.mutilatorOwned='';bankPanel.setAttribute('aria-label','Mutilator factory presets');
bankPanel.innerHTML=`<label for="mutilatorPreset">PATCH BANK · 100 patches · 50 synced / 50 non-synced</label><div class="d-mutilator-preset-row"><button type="button" class="performance-btn" id="mutilatorPrev" aria-label="Previous Mutilator patch">−</button><select id="mutilatorPreset" aria-describedby="mutilatorPresetDescription"><option value="">Custom / choose a patch…</option>${bank.SECTIONS.map(section=>`<optgroup label="${section}">${bank.PRESETS.filter(p=>p.section===section).map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</optgroup>`).join('')}</select><button type="button" class="performance-btn" id="mutilatorNext" aria-label="Next Mutilator patch">+</button></div><p id="mutilatorPresetDescription" aria-live="polite"></p>`;
mutilatorCard.querySelector('.performance-actions').after(bankPanel);
const extra=document.createElement('div');extra.className='d-mutilator-extras';extra.dataset.mutilatorOwned='';
const extraRanges=[['resonance','Resonance',0,100,1,.5],['sweep','Sweep depth',0,100,1,1],['freeDepth','Free motion depth',0,100,1,0],['freeRate','Free motion rate · Hz',.125,12,.125,1],['output','Wet output · dB',-18,6,.5,0]];
extra.innerHTML=`<label class="d-mutilator-control">Filter type<select id="mutilatorFilter" data-mutilator-field="filter">${[['auto','Strain character (original)'],['lowpass','Low-pass'],['bandpass','Band-pass'],['highpass','High-pass'],['notch','Notch']].map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label><label class="d-mutilator-control">Tempo cycle<select id="mutilatorCycleBeats" data-mutilator-field="cycleBeats">${[[8,'2 bars'],[4,'1 bar (original)'],[2,'Half bar'],[1,'1 beat'],[.5,'Half beat']].map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label>${extraRanges.map(([field,label,min,max,step,def])=>`<label class="d-mutilator-control" for="mutilator-${field}"><span>${label}<output data-mutilator-value="${field}"></output></span><input id="mutilator-${field}" data-mutilator-field="${field}" type="range" min="${min}" max="${max}" step="${step}" value="${field==='freeRate'||field==='output'?def:def*100}"></label>`).join('')}<p class="performance-feature-note d-mutilator-motion-help">Tempo sync On: rhythmic accents follow the song tempo and Tempo cycle. Off: Free motion depth adds a BPM-independent sine sweep; zero depth keeps a static sound. Sweep depth scales either motion. Wet output trims only the processed sound.</p>`;
mutilatorCard.lastElementChild.before(extra);
function syncMutilatorBank(){if(!bankPanel)return;const s=state.mutilator,id=bank.match(s),preset=bank.PRESETS.find(p=>p.id===id);if(id)lastMutilatorPreset=id;el('mutilatorPreset').value=id;el('mutilatorPresetDescription').textContent=preset?preset.description:'Custom settings. + / − continues from the last patch. Power and input routing stay unchanged.';for(const control of extra.querySelectorAll('[data-mutilator-field]')){const field=control.dataset.mutilatorField,value=s[field]??root.MygrainMutilator.EXT[field];if(document.activeElement!==control)control.value=control.type==='range'&&!['freeRate','output'].includes(field)?value*100:value;const out=extra.querySelector(`[data-mutilator-value="${field}"]`);if(out)out.textContent=field==='output'?(value>0?'+':'')+value.toFixed(1)+' dB':field==='freeRate'?value.toFixed(3).replace(/0+$/,'').replace(/\.$/,'')+' Hz':Math.round(value*100)+'%';control.disabled=field==='cycleBeats'?!s.rhythm:['freeRate','freeDepth'].includes(field)?s.rhythm:false;}}
async function chooseMutilatorPreset(id){const p=bank.PRESETS.find(p=>p.id===id);if(!p||choosingMutilator){sync();return;}choosingMutilator=true;const controls=['mutilatorPreset','mutilatorPrev','mutilatorNext'].map(el);controls.forEach(c=>c.disabled=true);try{await edit('Mutilator patch · '+p.name,()=>{const enabled=state.mutilator.enabled,input=state.mutilator.input;state.mutilator=normalizeMutilator({...p.settings(),enabled,input});setMutilator(state.mutilator);});}catch(e){setStatus(e.message,'error');}finally{choosingMutilator=false;controls.forEach(c=>c.disabled=false);sync();}}
el('mutilatorPreset').onchange=e=>chooseMutilatorPreset(e.target.value);
for(const[suffix,step]of[['Prev',-1],['Next',1]])el('mutilator'+suffix).onclick=()=>{if(choosingMutilator)return;const options=[...el('mutilatorPreset').options].filter(o=>o.value),index=options.findIndex(o=>o.value===(el('mutilatorPreset').value||lastMutilatorPreset)),next=index<0?(step>0?0:options.length-1):(index+step+options.length)%options.length;chooseMutilatorPreset(options[next].value);};
let controlEditBusy=false;const controlEdits=new Map();
async function editMutilatorControl(field,value){controlEdits.set(field,value);if(controlEditBusy)return;controlEditBusy=true;try{while(controlEdits.size){const[key,next]=controlEdits.entries().next().value;controlEdits.delete(key);try{await edit('Mutilator '+key,()=>setMutilator({[key]:next}));}catch(e){setStatus(e.message,'error');sync();}}}finally{controlEditBusy=false;}}
for(const control of extra.querySelectorAll('[data-mutilator-field]'))control.addEventListener(control.type==='range'?'input':'change',()=>{const field=control.dataset.mutilatorField,value=field==='filter'?control.value:Number(control.value)/(control.type==='range'&&!['freeRate','output'].includes(field)?100:1);editMutilatorControl(field,value);});
card.querySelector('[data-loop-d-repository]').addEventListener('change',event=>{const value=event.target.value;setRepository(value).catch(e=>{setStatus(e.message,'error');sync();});});
restore(readStoredStateSnapshot()?.modes?.loopD);
editor=new MygrainVocalCut.Editor({prefix:'bastardLoopDCut',settings:()=>state.cut,set:cut,randomize:()=>randomGaps(),edit,buffer:()=>playback({uncut:true}),timing:()=>({duration:duration(),cycle:duration(),bar:getLoopBarDurationSeconds(),frames:Math.round(duration()*(bastardLoopDBuffer?.sampleRate||48000))}),audition,stop:stopAudition,phase:()=>voice?((audioContext.currentTime-voice.origin)%duration())/duration():null});
const handle=(id,action)=>el(id).addEventListener('click',()=>Promise.resolve().then(action).catch(e=>setStatus(e.message,'error')));
handle('performanceBastardLoopDToggleBtn',()=>edit('D on/off',()=>enable(!state.enabled)));handle('performanceBastardLoopDLayerSoloBtn',()=>setLoopLayerSolo('bastardd',{toggle:true}));
handle('loopDRandom',()=>random());handle('loopDToggle',()=>edit('D on/off',()=>enable(!state.enabled)));handle('loopDSolo',()=>setLoopLayerSolo('bastardd',{toggle:true}));
el('loopDMutilator').querySelector('[data-mutilator-rhythm]').addEventListener('change',e=>{const rhythm=e.target.checked;Promise.resolve().then(()=>edit('D Mutilator rhythm',()=>setMutilator({rhythm}))).catch(e=>setStatus(e.message,'error'));});
handle('loopDMutilatorToggle',()=>edit('D Mutilator on/off',()=>setMutilator({enabled:!state.mutilator.enabled})));
handle('loopDMutilatorRandom',()=>edit('Mutilator strain',()=>randomizeMutilator({configureOnly:true})));
el('loopDMutilatorStrain').addEventListener('change',e=>{const strain=e.target.value;Promise.resolve().then(()=>edit('D Mutilator strain',()=>setMutilator({strain}))).catch(e=>setStatus(e.message,'error'))});
for(const field of ['amount','tone','mix'])el('loopDMutilator'+field[0].toUpperCase()+field.slice(1)).addEventListener('input',e=>setMutilator({[field]:Number(e.target.value)/100}));
handle('loopDReverse',()=>edit('D reverse',()=>{state.reverse=!state.reverse;cache=null;update();saveState()}));
for(const [id,dir]of [['loopDShiftLeft',-1],['loopDShiftRight',1]])handle(id,()=>edit('D shift',()=>{state.shift+=dir;update();saveState()}));
handle('loopDCut',()=>editor.open());handle('loopDGaps',()=>edit('D random gaps',()=>randomGaps()));
el('loopDFile').addEventListener('change',e=>{const file=e.target.files[0];if(file)edit('D import loop',()=>load({file})).catch(e=>setStatus(e.message,'error'));e.target.value=''});
for(const [id,event,field,convert]of [['loopDFill','change','fill',v=>v],['loopDSpeed','change','speed',normalizeSpeed],['performanceBastardLoopDLevel','input','level',v=>Number(v)/100],['performanceBastardLoopDCardLevel','input','level',v=>Number(v)/100],['loopDPitch','input','pitch',Number]])el(id).addEventListener(event,e=>{state[field]=convert(e.target.value);if(field!=='level')cache=null;update({gainOnly:field==='level'});saveState()});
card.querySelector('[data-loop-d-maximiser]').addEventListener('change',async e=>{const value=e.target.value;try{await edit('D maximiser',()=>setMaximiser(value));}catch(error){setStatus(error.message,'error');sync();}});
card.querySelector('[data-loop-d-maximiser]').addEventListener('input',e=>{card.querySelector('[data-loop-d-maximiser-value]').textContent=Number(e.target.value)?e.target.value+'%':'Off';});
function stopBrowserPreview(){
 const grid=root.mygrainSampleGridBrowser;if(grid&&!grid.overlay.hidden&&['bastardLoopD','bastardLoopV','bastardLoopX'].includes(grid.config?.target))grid.stopPreview();
 if([SAMPLE_BROWSER_TARGETS.bastardLoopD,SAMPLE_BROWSER_TARGETS.bastardLoopV,SAMPLE_BROWSER_TARGETS.bastardLoopX].includes(dropboxSampleBrowserTarget))document.querySelectorAll('#dropboxSampleBrowserList audio').forEach(audio=>{if(audio.__mygrainPreview?.stop)audio.__mygrainPreview.stop();else audio.pause()});
}
handle('loopDBrowse',()=>openDropboxSampleBrowser(SAMPLE_BROWSER_TARGETS.bastardLoopD));
// Shared parameter changes refit from the original, never stretch a stretched copy.
for(const name of ['applyGlobalBpm','syncPatternLengthControls']){const raw=root[name];root[name]=function(...args){
 const before=voice,result=raw(...args);
 // The shared transport may already have scheduled a new D voice at its handoff.
 // A second restart here used to cancel that voice and cut the outgoing loop early.
 if(voice&&voice!==before){sync();return result;}
 cache=null;if(before)update();else sync();return result;
};}
const soloSync=syncLoopLayerSoloButtons;syncLoopLayerSoloButtons=function(...a){const r=soloSync(...a);if(root.mygrainD){if(voice||(transportWanted&&bastardLoopPlaying))update({gainOnly:true});else sync();}return r};
sync();
root.addEventListener('mygrain-effect-solo',()=>{voice?.mutilator?.set({...state.mutilator,enabled:state.enabled&&state.mutilator.enabled&&root.mygrainEffectOutput.allows('mutilator')&&(!state.mutilator.input||state.mutilator.input==='D')});});
})(window);
