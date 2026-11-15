/* D: original loop + non-destructive exact-pattern fit and cut/gap playback.
 * The original source is portable in ZIP/IDB; derived PCM never replaces it. */
(function(root){
'use strict';
const card=document.getElementById('bastardLoopDCard'),el=id=>document.getElementById(id);
const speedValues=[.125,.25,.5,1,2,4],normalizeSpeed=value=>speedValues.includes(Number(value))?Number(value):1;
const repositories={samples_loopstore:'SAMPLES_LOOPSTORE',samples_loops:'SAMPLES_LOOPS'};
const repositoryFor=(value,metadata)=>Object.hasOwn(repositories,value)?value:metadata?.sourceKey==='samples_loops'?'samples_loops':'samples_loopstore';
const potTaps=new Set();
// Monitor-only D lane audition. Never join the global Solo mask or saved state.
const localSolos=new Set();let localSoloSuspensions=0;
function localSoloActive(context=audioContext){return localSolos.size>0&&!localSoloSuspensions&&!!context&&!root.__mygrainSongRenderDeck&&!context.__mygrainNativeContext&&typeof context.startRendering!=='function';}
function localSoloGain(n,context=audioContext){return !localSoloActive(context)||localSolos.has(n)?1:0;}
function setLocalSolo(n,on=!localSolos.has(n)){
 if(![1,2,3,4].includes(n))throw Error('Unknown D sample lane.');
 if(localSoloSuspensions||root.__mygrainSongRenderDeck||root.mygrainSongBeta?.playing||stateSaveSuspended)return false;
 if(on)localSolos.add(n);else localSolos.delete(n);
 // Only D's existing voice lifecycle is touched; preserve shared transport phase.
 // Shared effects keep their natural decay, just as on a mixer input mute.
 update({gainOnly:true});return localSolos.has(n);
}
const {STRAINS:strains,normalize:normalizeMutilator,createGraph:mutilatorGraph}=root.MygrainMutilator;
const normalizeMix=v=>({enabled:v?.enabled!==false,level:Math.max(0,Math.min(1,Number.isFinite(v?.level)?v.level:1)),pan:Math.max(-1,Math.min(1,Number(v?.pan)||0))});
const extraDefaults=()=>({enabled:false,level:1,pan:0,speed:1,fill:'repeat',repository:'samples_loopstore',metadata:null});
const extraAudioDefaults=()=>({maximiser:0,pitch:0,reverse:false,shift:0,cut:MygrainVocalCut.normalize()});
function extraAudio(v){const a={maximiser:Math.max(0,Math.min(100,Number(v?.maximiser)||0)),pitch:Math.max(-24,Math.min(24,Number(v?.pitch)||0)),reverse:v?.reverse===true,shift:Math.max(-4096,Math.min(4096,Math.round(Number(v?.shift)||0))),cut:MygrainVocalCut.normalize(v?.cut)},defaults=extraAudioDefaults();return Object.fromEntries(Object.entries(a).filter(([k,value])=>JSON.stringify(value)!==JSON.stringify(defaults[k])));}
const extraEditors=new Map();
const normalizeExtra=v=>({...extraDefaults(),...normalizeMix(v),enabled:v?.enabled===true,repository:repositoryFor(v?.repository,v?.metadata),speed:normalizeSpeed(v?.speed),fill:v?.fill==='single'?'single':'repeat',metadata:v?.metadata||null,...extraAudio(v)});
let extraState=[2,3,4].map(()=>extraDefaults());const extraRuntime=[2,3,4].map(()=>({buffer:null,cache:null,voice:null,busy:false,revision:0,controller:null}));
const defaults=()=>({version:1,repository:'samples_loopstore',enabled:false,fill:'repeat',speed:1,level:.5,maximiser:0,pitch:0,reverse:false,shift:0,cut:MygrainVocalCut.normalize(),metadata:null,mutilator:normalizeMutilator(),mix:normalizeMix()});
let state=defaults(),cache=null,voice=null,revision=0,busy=false,controller=null,preview=false,auditionSerial=0,metroTimer=null,auditionLoops=false,transportWanted=false;
const metroNodes=new Set();
let checkedCycle=null;
const clone=v=>JSON.parse(JSON.stringify(v));
const duration=()=>getPatternLengthSteps()*60/getTransportClockBpm()/4;
function settings(){const result={...clone(state),metadata:bastardLoopDMetadata?clone(bastardLoopDMetadata):null};if(JSON.stringify(state.mix)===JSON.stringify(normalizeMix()))delete result.mix;if(extraState.some((s,i)=>extraRuntime[i].buffer||JSON.stringify(s)!==JSON.stringify(extraDefaults())))result.lanes=clone(extraState);return result;}
function restore(value){
 localSolos.clear();revision++;controller?.abort();if(el('loopDLoadStatus'))el('loopDLoadStatus').hidden=true;stop({preserveIntent:true});const v=value||{},base=defaults();
 extraRuntime.forEach(r=>{r.revision++;r.controller?.abort();r.cache=null;});extraState=[2,3,4].map((n,i)=>normalizeExtra(v.lanes?.[i]));
 state={...base,mix:normalizeMix(v.mix),maximiser:Math.max(0,Math.min(100,Number(v.maximiser)||0)),repository:repositoryFor(v.repository,v.metadata),enabled:v.enabled===true,fill:v.fill==='single'?'single':'repeat',speed:normalizeSpeed(v.speed),level:Math.max(0,Math.min(1,Number.isFinite(v.level)?v.level:.5)),pitch:Math.max(-24,Math.min(24,Number(v.pitch)||0)),reverse:v.reverse===true,shift:Math.round(Number(v.shift)||0),cut:MygrainVocalCut.normalize(v.cut),mutilator:normalizeMutilator(v.mutilator)};
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
function stopPrimary(options={}){
 if(!options.preserveIntent){transportWanted=false;checkedCycle=null;}
 auditionSerial++;if(metroTimer)clearInterval(metroTimer);metroTimer=null;
 for(const {oscillator,gain}of metroNodes){try{oscillator.stop();oscillator.disconnect();gain.disconnect()}catch{}}metroNodes.clear();
 preview=false;if(!Number.isFinite(transportSync.handoffBoundary))stopRetiredTransportVoices('bastardloopd');if(!voice)return;
 const v=voice;voice=null;unmeterLane(1);
 if(Number.isFinite(transportSync.handoffBoundary)){
  const boundary=transportSync.handoffBoundary,fadeAt=Math.max(audioContext.currentTime,boundary-.002),param=v.wetCardGain?.gain;if(v.potTap)v.potTap.gain.setTargetAtTime(0,fadeAt,.0005);if(param){if(typeof param.cancelAndHoldAtTime==='function')param.cancelAndHoldAtTime(fadeAt);else{param.cancelScheduledValues(fadeAt);param.setValueAtTime(param.value,fadeAt);}param.linearRampToValueAtTime(0,boundary);}
  retireTransportVoice({role:'bastardloopd',source:v.source,gain:v.gain,cleanupNodes:[{disconnect:()=>{v.mutilator?.dispose();v.wetCardGain?.disconnect();v.potTap?.disconnect();potTaps.delete(v.potTap);root.mygrainCookingPot?.syncSources();v.route?.disconnect();v.pan?.disconnect();}}]},transportSync.handoffBoundary);return;
 }
 try{v.source.onended=null;v.source.stop()}catch{};v.source.disconnect();v.mutilator?.dispose();v.gain.disconnect();v.wetCardGain?.disconnect();v.potTap?.disconnect();potTaps.delete(v.potTap);root.mygrainCookingPot?.syncSources();v.route?.disconnect();v.pan?.disconnect();
}
function startPrimary(at=null,{audition=false}={}){
 if(!audition)transportWanted=true;
 if(!audioContext||audioContext.state==='closed'||!preFilterGainNode||!sampleGridAudible('bastardLoopD',bastardLoopDBuffer)||(!audition&&primaryLevel()<=0))return false;
 const b=playback();if(!b)return false;
 stopPrimary({preserveIntent:true});const timing=resolveTransportLaneStart(at,'D'),time=timing.time,origin=timing.origin;
 const source=audioContext.createBufferSource(),gain=audioContext.createGain();source.buffer=b;source.loop=true;source.loopEnd=b.duration;
 const volume=audition?Math.max(.25,state.level):primaryLevel();gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(volume*MIX_HEADROOM*.88,time+.004);source.connect(gain);
 const pan=state.mix.pan!==0?audioContext.createStereoPanner():null;if(pan){pan.channelCount=2;pan.channelCountMode='explicit';pan.pan.value=state.mix.pan;gain.connect(pan);}
 const route=root.mygrainChannelEq.connect('D',pan||gain,preFilterGainNode,source);
 const shift=state.shift*60/getTransportClockBpm()/4,elapsed=Number.isFinite(origin)?Math.max(0,time-origin):0,offset=((elapsed-shift)%b.duration+b.duration)%b.duration;
 voice={source,gain,pan,route,origin:Number.isFinite(origin)?origin:time};source.onended=()=>{if(voice?.source===source)stopPrimary({preserveIntent:!preview})};startTransportSource(source,time,offset);root.mygrainCookingPot?.syncSources();preview=audition;return true;
}
async function audition(mode='metronome'){
 const serial=++auditionSerial;if(!await ensureAudioReadyForKeyInteraction()||serial!==auditionSerial)return;
 const origin=audioContext.currentTime+.06;
 if(mode==='loops'){startAllBastardLoopLayers(origin);startPrimary(origin,{audition:true});auditionLoops=true;return;}
 startPrimary(origin,{audition:true});let next=origin,beat=0;
 const tick=()=>{if(!voice||audioContext.state!=='running')return stop();while(next<audioContext.currentTime+.12){playKeyboardRepositoryMetronomeClick(next,beat%4===0,{nodeSet:metroNodes});next+=60/getTransportClockBpm();beat++}};
 tick();metroTimer=setInterval(tick,25);
}
function stopAudition(){const loops=auditionLoops;auditionLoops=false;stop();if(loops)stopAllBastardLoopLayers();}
function updatePrimary({gainOnly=false}={}){if(gainOnly&&voice&&!preview&&primaryLevel()>0){for(const n of [voice.gain,voice.wetCardGain,voice.potTap])n?.gain.setTargetAtTime(primaryLevel()*MIX_HEADROOM*.88,audioContext.currentTime,.01);sync();return;}if(voice){if(preview)startPrimary(audioContext.currentTime,{audition:true});else if(primaryLevel()>0)startPrimary(getSharedLoopTransportOriginTime());else stopPrimary({preserveIntent:true});}else if(transportWanted&&bastardLoopPlaying&&primaryLevel()>0)startPrimary(getSharedLoopTransportOriginTime());sync();}
// A health check, not a retrigger: existing/future-scheduled voices stay untouched.
// Audio time and the shared origin keep recovery phase-locked after UI stalls.
function checkCycle(){
 if(root.__mygrainSongRenderDeck||!transportWanted||!bastardLoopPlaying||preview||!audioContext||audioContext.state!=='running'||!engineInitialized||engineStarting||stateSaveSuspended||transportSync.depth>0||busy||root.mygrainCardHistory?.busy)return false;
 const origin=getSharedLoopTransportOriginTime(),seconds=duration();
 if(!Number.isFinite(origin)||!(seconds>0))return false;
 const cycle=Math.floor((audioContext.currentTime-origin)/seconds),stamp=[origin,seconds,cycle].join(':');
 if(stamp===checkedCycle)return false;
 checkedCycle=stamp;
 let recovered=false;for(const n of [2,3,4])if(!extraRuntime[n-2].voice&&extraLevel(n)>0&&extraRuntime[n-2].buffer)recovered=startExtra(n,origin)||recovered;
 if(voice||primaryLevel()<=0||!bastardLoopDBuffer)return recovered;
 return start(origin);
}
function enable(value,options={}){state.enabled=!!value;if(value&&bastardLoopPlaying)transportWanted=true;update();if(!options.skipSave)saveState();}
function setMutilator(value,options={}){
 state.mutilator=normalizeMutilator({...state.mutilator,...value});
 if(!MygrainEffectLfo.audible('mutilator',{...state.mutilator,enabled:true}))state.mutilator.enabled=false;
 voice?.mutilator?.set({...state.mutilator,enabled:state.enabled&&state.mutilator.enabled&&root.mygrainEffectOutput.allows('mutilator')&&(!state.mutilator.input||state.mutilator.input==='D')});sync();if(!options.skipSave)saveState();return clone(state.mutilator);
}
function finishMutilatorRandomization(){
 if(root.mygrainCookingPot?.active())return false;
 if(state.mutilator.enabled&&((state.mutilator.input&&state.mutilator.input!=='D'?!(root.mygrainCharacterFx?.eligible(state.mutilator.input)):!state.enabled||(!bastardLoopDBuffer&&!extraRuntime.some(r=>r.buffer))||level()<=0)||state.mutilator.mix<=0||state.mutilator.amount<=0)){setMutilator({enabled:false},{skipSave:true});return true;}return false;
}
function randomizeMutilator(options={}){
 if(!options.configureOnly&&(state.mutilator.input&&state.mutilator.input!=='D'?!root.mygrainCharacterFx?.eligible(state.mutilator.input):!state.enabled||(!bastardLoopDBuffer&&!extraRuntime.some(r=>r.buffer))||level()<=0))return setMutilator({enabled:false},options);
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
 syncExtra();
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
root.mygrainD={settings,restore,setLocalSolo,localSoloGain,localSoloLanes:()=>[...localSolos].sort(),setMaximiser,setRepository,get repository(){return state.repository},setMutilator,randomizeMutilator,finishMutilatorRandomization,normalizeMutilator,mutilatorGraph,get mutilatorActive(){return !!voice&&[...(root.mygrainCharacterFx?.groups||[])].some(g=>g.key==='D'&&g.m.active)},get mutilatorClock(){return [...(root.mygrainCharacterFx?.groups||[])].find(g=>g.key==='D'&&g.m.active)?.m.clock||null},checkCycle,playback,fitted,repetitions,duration,apply,start,stop,stopAll(){stop();stopBrowserPreview()},enable,level,cut,randomGaps,gapSettings,sync,random,load,choose:(path,repository=state.repository)=>edit('D choose loop',()=>load({path,repository})),get busy(){return busy||extraRuntime.some(r=>r.busy)},get previewing(){return [SAMPLE_BROWSER_TARGETS.bastardLoopD,SAMPLE_BROWSER_TARGETS.bastardLoopD2,SAMPLE_BROWSER_TARGETS.bastardLoopD3,SAMPLE_BROWSER_TARGETS.bastardLoopD4,SAMPLE_BROWSER_TARGETS.bastardLoopV,SAMPLE_BROWSER_TARGETS.bastardLoopX].includes(dropboxSampleBrowserTarget)&&Array.from(document.querySelectorAll('#dropboxSampleBrowserList audio')).some(audio=>!audio.paused)},get potTaps(){return [...potTaps]},get potTap(){return [...(root.mygrainCharacterFx?.groups||[])].find(g=>g.key==='D'&&g.context===audioContext)?.input},get source(){return voice?.source},get gain(){return voice?.gain},get state(){return state},invalidate(){cache=null;queueMicrotask(()=>{if(transportWanted&&bastardLoopPlaying)update()})},playable:()=>state.enabled&&state.level>0&&((state.mix.enabled&&!!bastardLoopDBuffer&&state.mix.level>0)||extraState.some((s,i)=>s.enabled&&s.level>0&&extraRuntime[i].buffer)),lane:laneApi,hasExtraAudio:()=>extraRuntime.some(r=>r.buffer),clearLanes(){for(const n of [2,3,4]){stopExtra(n);const r=extraRuntime[n-2];r.revision++;r.controller?.abort();r.buffer=r.cache=null;}extraState=[2,3,4].map(()=>extraDefaults());},prepare(){playback();for(const n of [2,3,4])if(extraState[n-2].enabled&&extraState[n-2].level>0)extraPlayback(n)},meterDiagnostics:()=>({enabled:meterEnabled,visible:meterVisible,analysers:laneMeters.size,frame:!!meterFrame}),get sources(){return [voice?.source,...extraRuntime.map(r=>r.voice?.source)].filter(Boolean)}};

// Extra lanes retain original PCM separately; only the derived fit is cached.
function extraFit(n){
 const r=extraRuntime[n-2],s=extraState[n-2],target='bastardLoopD'+n,raw=sampleGridAudible(target,r.buffer);
 if(!raw||!audioContext)return null;
 const meta=sampleGridAudible(target,s.metadata,'metadata'),nativeBpm=Number(meta?.sourceBpm||String(meta?.fileName||'').match(/(?:^|[^0-9])(\d{2,3})(?:[ _-]*bpm)(?:\b|_)/i)?.[1])||getTransportClockBpm();
 const repeats=s.fill==='single'?s.speed:Math.max(1,Math.min(getPatternLengthSteps()*2,Math.round(duration()/(raw.duration*nativeBpm/getTransportClockBpm()))))*s.speed;
 const frames=Math.max(1,Math.round(duration()*raw.sampleRate)),stamp=[frames,repeats,s.pitch||0,!!s.reverse,s.maximiser||0].join(':');
 if(r.cache?.raw===raw&&r.cache.context===audioContext&&r.cache.stamp===stamp)return r.cache.buffer;
 const unitFrames=Math.max(1,Math.round(frames/repeats)),unit=audioContext.createBuffer(raw.numberOfChannels,unitFrames,raw.sampleRate),out=audioContext.createBuffer(raw.numberOfChannels,frames,raw.sampleRate);
 MygrainVocalCut.stretchChannels(Array.from({length:raw.numberOfChannels},(_,c)=>raw.getChannelData(c)),Array.from({length:raw.numberOfChannels},(_,c)=>unit.getChannelData(c)),raw.sampleRate);
 for(let c=0;c<raw.numberOfChannels;c++){const a=unit.getChannelData(c),b=out.getChannelData(c);for(let i=0;i<frames;i++)b[i]=a[i%a.length];}
 MygrainVocalCut.crossfadeJoins(Array.from({length:out.numberOfChannels},(_,c)=>out.getChannelData(c)),Array.from({length:Math.max(0,repeats-1)},(_,i)=>(i+1)*unitFrames),raw.sampleRate,true);
 const transformed=s.pitch||s.reverse?getBastardLoopPlaybackBufferForMode(out,Math.pow(2,(s.pitch||0)/12),{preserveDuration:true,reversed:s.reverse===true}):out;
 const buffer=maximise(transformed,s.maximiser||0);
 r.cache={raw,context:audioContext,stamp,buffer};return buffer;
}
function extraPlayback(n,{uncut=false}={}){const b=extraFit(n);return !b||uncut?b:MygrainVocalCut.gate(audioContext,b,sampleGridAudible('bastardLoopD'+n,MygrainVocalCut.normalize(extraState[n-2].cut),'cut'),b.duration);}
function primaryLevel(){return state.mix.enabled?level()*state.mix.level*localSoloGain(1):0;}
function extraLevel(n){const s=extraState[n-2];return s.enabled?level()*s.level*localSoloGain(n):0;}
function stopExtra(n){
 const r=extraRuntime[n-2],v=r.voice;r.auditionSerial=(r.auditionSerial||0)+1;clearInterval(r.metroTimer);r.metroTimer=null;for(const {oscillator,gain}of r.metroNodes||[]){try{oscillator.stop();oscillator.disconnect();gain.disconnect()}catch{}}r.metroNodes?.clear();r.preview=false;if(!Number.isFinite(transportSync.handoffBoundary))stopRetiredTransportVoices('bastardloopd'+n);if(!v)return;r.voice=null;unmeterLane(n);
 const cleanup=()=>{v.route.disconnect();v.pan?.disconnect();v.gain.disconnect();};
 if(Number.isFinite(transportSync.handoffBoundary)){
  retireTransportVoice({role:'bastardloopd'+n,source:v.source,gain:v.gain,cleanupNodes:[{disconnect:cleanup}]},transportSync.handoffBoundary);return;
 }
 stopRetiredTransportVoices('bastardloopd'+n);v.source.onended=null;try{v.source.stop()}catch{}v.source.disconnect();cleanup();
}
function startExtra(n,at,{audition=false}={}){
 const r=extraRuntime[n-2],s=extraState[n-2];stopExtra(n);
 if(!audioContext||audioContext.state==='closed'||!preFilterGainNode||!audition&&extraLevel(n)<=0)return false;
 const b=extraPlayback(n);if(!b)return false;
 const timing=resolveTransportLaneStart(at,'D'),time=timing.time,origin=Number.isFinite(timing.origin)?timing.origin:time;
 const source=audioContext.createBufferSource(),gain=audioContext.createGain();source.buffer=b;source.loop=true;source.loopEnd=b.duration;
 gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime((audition?Math.max(.25,state.level):extraLevel(n))*MIX_HEADROOM*.88,time+.004);source.connect(gain);
 const pan=s.pan!==0?audioContext.createStereoPanner():null;if(pan){pan.channelCount=2;pan.channelCountMode='explicit';pan.pan.value=s.pan;gain.connect(pan);}
 const route=root.mygrainChannelEq.connect('D'+n,pan||gain,preFilterGainNode,source);
 r.voice={source,gain,pan,route,origin};source.onended=()=>{if(r.voice?.source===source)stopExtra(n)};
 r.preview=audition;const shift=(s.shift||0)*60/getTransportClockBpm()/4;startTransportSource(source,time,((time-origin-shift)%b.duration+b.duration)%b.duration);root.mygrainCookingPot?.syncSources();refreshMeters();return true;
}
function start(at=null,options={}){if(options.audition)return startPrimary(at,options);transportWanted=true;const first=startPrimary(at,options);let any=first;for(const n of [2,3,4])any=startExtra(n,at)||any;return any;}
function stop(options={}){for(const n of [2,3,4])stopExtra(n);stopPrimary(options);refreshMeters();}
function update(options={}){
 updatePrimary(options);
 for(const n of [2,3,4]){const r=extraRuntime[n-2];if(options.gainOnly&&r.voice&&extraLevel(n)>0)r.voice.gain.gain.setTargetAtTime(extraLevel(n)*MIX_HEADROOM*.88,audioContext.currentTime,.01);
 else if(r.voice||transportWanted&&bastardLoopPlaying){if(extraLevel(n)>0)startExtra(n,getSharedLoopTransportOriginTime());else stopExtra(n);}}
 refreshMeters();
}
function setExtra(n,value,{skipSave=false}={}){extraState[n-2]=normalizeExtra({...extraState[n-2],...value});const r=extraRuntime[n-2];r.cache=null;if(Object.keys(value).every(k=>k==='level')&&r.voice&&extraLevel(n)>0)r.voice.gain.gain.setTargetAtTime(extraLevel(n)*MIX_HEADROOM*.88,audioContext.currentTime,.01);else if(r.voice||transportWanted&&bastardLoopPlaying){if(r.preview)startExtra(n,audioContext.currentTime,{audition:true});else if(extraLevel(n)>0)startExtra(n,getSharedLoopTransportOriginTime());else stopExtra(n);}syncExtra();root.mygrainCookingPot?.changed();refreshMeters();if(!skipSave)saveState();}
function laneApi(n){
 if(![2,3,4].includes(n))throw Error('Unknown D sample lane.');
 const r=extraRuntime[n-2];return {get buffer(){return r.buffer},get metadata(){return extraState[n-2].metadata},get settings(){return clone(extraState[n-2])},get source(){return r.voice?.source},get gain(){return r.voice?.gain},get pan(){return r.voice?.pan},
 setBuffer(buffer){r.buffer=buffer||null;r.cache=null;},setMetadata(metadata){extraState[n-2].metadata=metadata||null;},set:value=>setExtra(n,value),
 async apply(buffer,label,metadata={}){if(!buffer?.length)throw Error('D lane '+n+' has no audio.');const old=r.buffer,oldMeta=extraState[n-2].metadata;r.buffer=buffer;extraState[n-2].metadata={...metadata,fileName:metadata.fileName||metadata.filename||label||'loop.wav',durationSeconds:buffer.duration};r.cache=null;try{extraFit(n);await saveAudioBufferToDB(buffer,'bastardLoopD'+n+'Buffer')}catch(e){r.buffer=old;extraState[n-2].metadata=oldMeta;r.cache=null;throw e}update();return buffer;},
 invalidate(){r.cache=null;queueMicrotask(()=>{if(transportWanted&&bastardLoopPlaying)startExtra(n,getSharedLoopTransportOriginTime());syncExtra();})},
 fitted:()=>extraFit(n),playback:options=>extraPlayback(n,options),cut:(value,options={})=>setExtra(n,{cut:value},options),randomGaps:()=>{if(!r.buffer)throw Error('Load a loop in D lane '+n+' first.');return setExtra(n,{cut:gapSettings(MygrainVocalCut.normalize(extraState[n-2].cut))});},load:(request,options)=>loadExtra(n,request,options),random:()=>edit('D lane '+n+' random loop',()=>loadExtra(n)),
 setRepository:repository=>{if(!Object.hasOwn(repositories,repository))throw Error('Unknown D library.');return edit('D lane '+n+' library',()=>{extraState[n-2].repository=repository;syncExtra();saveState();})}};
}
async function loadExtra(n,{file,path,repository=extraState[n-2].repository}={},options={}){
 const r=extraRuntime[n-2];if(r.busy)throw Error('Wait for D lane '+n+' to load.');if(!Object.hasOwn(repositories,repository))throw Error('Unknown D library.');
 if(!await ensureAudioReadyForKeyInteraction())throw Error('Start MYGRAIN before loading D.');
 const ctx=audioContext,account=root.mygrainAccounts?.user?.username,token=++r.revision,abort=r.controller=new AbortController();r.busy=true;
 const timeout=setTimeout(()=>abort.abort(),120000),old={buffer:r.buffer,state:clone(extraState[n-2])};
 const guard=()=>{options.guard?.();if(abort.signal.aborted||token!==r.revision||ctx!==audioContext||account!==root.mygrainAccounts?.user?.username||!root.mygrainAccounts?.authenticated)throw Error('D lane load cancelled because the sound or account changed.');};
 const status=(message,error=false)=>{const line=card.querySelector(`[data-d-status="${n}"]`);if(line){line.hidden=false;line.textContent=message;line.dataset.state=error?'error':'loading';}};
 const cancel=()=>abort.abort();options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel();status('Loading loop…');syncExtra();
 try{let data,metadata;guard();
  if(file){if(file.size>32*1024*1024)throw Error('Choose a loop smaller than 32 MB.');data=await file.arrayBuffer();metadata={sourceKey:'import',sourceLabel:'Imported loop',fileName:file.name};}
  else{const url=new URL(DROPBOX_SAMPLE_SOURCE_API_URL,document.baseURI);url.searchParams.set('source',repository);if(path)url.searchParams.set('path',path);url.searchParams.set('seed',Date.now()+'-'+Math.random());const response=await fetch(url,{cache:'no-store',signal:abort.signal});if(!response.ok)throw Error((await response.json().catch(()=>({}))).error||'D sample download failed.');if(Number(response.headers.get('Content-Length'))>32*1024*1024)throw Error('Choose a loop smaller than 32 MB.');data=await response.arrayBuffer();const source=response.headers.get('X-Mygrain-Source-Key');if(source&&source!==repository)throw Error('Unexpected D source library.');const relativePath=decodeRepositoryHeader(response.headers.get('X-Mygrain-Source-Path'))||path||'loop.wav';metadata={sourceKey:repository,sourceLabel:repositories[repository],relativePath,fileName:relativePath.split('/').pop(),sourceBpm:Number(response.headers.get('X-Mygrain-Source-Bpm'))||undefined};}
  guard();if(data.byteLength>32*1024*1024)throw Error('Choose a loop smaller than 32 MB.');status('Decoding and fitting loop…');const buffer=await ctx.decodeAudioData(data);guard();if(!buffer.length||buffer.duration>300)throw Error('Choose a loop no longer than five minutes.');
  extraState[n-2]=normalizeExtra({...extraState[n-2],cut:MygrainVocalCut.normalize()});await laneApi(n).apply(buffer,metadata.fileName,metadata);guard();extraState[n-2].repository=repository;extraState[n-2].enabled=true;state.enabled=true;if(bastardLoopPlaying)transportWanted=true;sourceMutationSerial++;root.mygrainMasterBaker?.randomiseOff();update();saveState();status('Loaded '+metadata.fileName+' · ready.');return laneApi(n).settings;
 }catch(error){if(token===r.revision&&ctx===audioContext&&account===root.mygrainAccounts?.user?.username){r.buffer=old.buffer;extraState[n-2]=old.state;r.cache=null;if(old.buffer)await saveAudioBufferToDB(old.buffer,'bastardLoopD'+n+'Buffer');else await clearAudioBufferFromDB('bastardLoopD'+n+'Buffer');update();status(error.message,true);}throw error;}
 finally{clearTimeout(timeout);options.signal?.removeEventListener('abort',cancel);if(r.controller===abort)r.controller=null;r.busy=false;syncExtra();}
}
function syncExtra(){
 if(!card)return;
 for(const n of [1,2,3,4]){const s=n===1?state.mix:extraState[n-2],r=n===1?null:extraRuntime[n-2],on=card.querySelector(`[data-d-on="${n}"]`);on.textContent=s.enabled?'On':'Off';on.setAttribute('aria-pressed',String(s.enabled));
  const solo=card.querySelector(`[data-d-solo="${n}"]`);if(solo){solo.textContent=localSolos.has(n)?'Solo On':'Solo';solo.setAttribute('aria-pressed',String(localSolos.has(n)));solo.disabled=localSoloSuspensions>0||!!root.__mygrainSongRenderDeck||!!root.mygrainSongBeta?.playing;}
  for(const f of ['level','pan']){const control=card.querySelector(`[data-d-${f}="${n}"]`),value=Math.round(s[f]*100);if(document.activeElement!==control)control.value=value;card.querySelector(`[data-d-${f}-value="${n}"]`).textContent=f==='level'?value+'%':value===0?'C':Math.abs(value)+(value<0?' L':' R');}
  if(!r)continue;for(const f of ['library','fill','speed']){const control=card.querySelector(`[data-d-${f}="${n}"]`);control.value=String(s[f==='library'?'repository':f]);control.disabled=r.busy;}
  for(const f of ['maximiser','pitch']){const value=s[f]||0,control=card.querySelector(`[data-d-${f}="${n}"]`);if(document.activeElement!==control)control.value=value;card.querySelector(`[data-d-${f}-value="${n}"]`).textContent=f==='pitch'?value+' st':value?Math.round(value)+'%':'Off';}
  const reverse=card.querySelector(`[data-d-reverse="${n}"]`);reverse.textContent='Reverse '+(s.reverse?'On':'Off');reverse.setAttribute('aria-pressed',String(!!s.reverse));card.querySelector(`[data-d-shift-value="${n}"]`).textContent=s.shift||0;
  for(const f of ['cut','gaps'])card.querySelector(`[data-d-${f}="${n}"]`).disabled=!r.buffer||r.busy;extraEditors.get(n)?.refresh();
  for(const f of ['random','browse','file'])card.querySelector(`[data-d-${f}="${n}"]`).disabled=r.busy;
  card.querySelector(`[data-d-meta="${n}"]`).textContent=r.busy?'Loading and fitting loop…':r.buffer?`${s.metadata?.fileName||s.metadata?.filename||'Imported loop'} · ${duration().toFixed(3)}s · ${getPatternLengthSteps()} steps`:'No loop loaded.';
 }
}
// Optional post-EQ/post-fader meters: no analyser or animation work when disabled/offscreen.
const laneMeters=new Map();let meterFrame=null,meterVisible=false,meterEnabled=false,lastMeterPaint=0;
function unmeterLane(n){const m=laneMeters.get(n);if(!m)return;try{m.source.disconnect(m.analyser)}catch{}m.analyser.disconnect();laneMeters.delete(n);const node=card.querySelector(`[data-d-meter="${n}"]`);if(node)node.value=0;}
function refreshMeters(){
 const active=meterEnabled&&meterVisible&&!document.hidden&&!root.__mygrainSongRenderDeck&&audioContext?.state==='running';
 for(const n of [1,2,3,4]){const v=n===1?voice:extraRuntime[n-2].voice,source=root.mygrainCharacterFx?.meterTap(n===1?'D':'D'+n,v?.pan||v?.gain),old=laneMeters.get(n);if(old&&(!active||old.source!==source))unmeterLane(n);if(active&&source&&!laneMeters.has(n)){const analyser=source.context.createAnalyser();analyser.fftSize=256;source.connect(analyser);laneMeters.set(n,{source,analyser,data:new Float32Array(256)});}}
 if(!laneMeters.size&&meterFrame){cancelAnimationFrame(meterFrame);meterFrame=null;}
 if(laneMeters.size&&!meterFrame)meterFrame=requestAnimationFrame(paintMeters);
}
function paintMeters(time){meterFrame=null;if(time-lastMeterPaint>66){lastMeterPaint=time;for(const[n,m]of laneMeters){m.analyser.getFloatTimeDomainData(m.data);let energy=0;for(const x of m.data)energy+=x*x;card.querySelector(`[data-d-meter="${n}"]`).value=Math.sqrt(energy/m.data.length);}}refreshMeters();}
function wireLanes(){
 const run=(label,action)=>Promise.resolve().then(()=>edit(label,action)).catch(e=>{setStatus(e.message,'error');syncExtra();});
 for(const n of [1,2,3,4]){
  const set=value=>{if(n===1){state.mix=normalizeMix({...state.mix,...value});updatePrimary({gainOnly:Object.keys(value).every(k=>k==='level')});refreshMeters();saveState();}else setExtra(n,value);};
  card.querySelector(`[data-d-solo="${n}"]`).onclick=()=>setLocalSolo(n);
  card.querySelector(`[data-d-on="${n}"]`).onclick=()=>run('D lane '+n+' on/off',()=>set({enabled:!(n===1?state.mix:extraState[n-2]).enabled}));
  for(const field of (n===1?['level','pan']:['level','pan','pitch','maximiser'])){
   const control=card.querySelector(`[data-d-${field}="${n}"]`);let gesture=null;
   const begin=()=>{if(gesture)return gesture;if(root.mygrainCardHistory?.busy||root.mygrainSongBeta?.busy||root.mygrainSongBeta?.playing||stateSaveSuspended)throw Error('Finish the current edit or stop Song playback first.');
    let end;const done=new Promise(resolve=>{end=resolve}),g=gesture={end,ready:false,value:null,cancelled:false,original:clone(n===1?state.mix:extraState[n-2])};
    const apply=()=>{if(g.ready&&g.value!==null)set({[field]:g.value});};g.move=value=>{g.value=value;apply();};
    const action=async()=>{g.ready=true;apply();await done;if(g.cancelled)set({[field]:g.original[field]??0});else apply();};
    Promise.resolve().then(()=>edit('D lane '+n+' '+field,action)).catch(e=>setStatus(e.message,'error')).finally(()=>{if(gesture===g)gesture=null;syncExtra();});return g;};
   const finish=()=>gesture?.end();control.addEventListener('pointerdown',()=>{try{begin()}catch(e){setStatus(e.message,'error');syncExtra();}});
   control.addEventListener('input',e=>{const value=Number(e.target.value)/(['level','pan'].includes(field)?100:1);try{begin().move(value)}catch(error){setStatus(error.message,'error');syncExtra();}});
   for(const event of ['change','pointerup','keyup','blur'])control.addEventListener(event,finish);
   control.addEventListener('pointercancel',()=>{if(gesture){gesture.cancelled=true;gesture.end();}});window.addEventListener('pointerup',finish);
  }
  if(n===1)continue;
  card.querySelector(`[data-d-reverse="${n}"]`).onclick=()=>run('D lane '+n+' reverse',()=>set({reverse:!extraState[n-2].reverse}));
  for(const [direction,delta]of [['left',-1],['right',1]])card.querySelector(`[data-d-shift-${direction}="${n}"]`).onclick=()=>run('D lane '+n+' shift',()=>set({shift:(extraState[n-2].shift||0)+delta}));
  card.querySelector(`[data-d-cut="${n}"]`).onclick=()=>extraEditors.get(n).open();
  card.querySelector(`[data-d-gaps="${n}"]`).onclick=()=>run('D lane '+n+' random gaps',()=>laneApi(n).randomGaps());
  card.querySelector(`[data-d-random="${n}"]`).onclick=()=>run('D lane '+n+' random loop',()=>loadExtra(n));
  card.querySelector(`[data-d-browse="${n}"]`).onclick=()=>openDropboxSampleBrowser('bastardLoopD'+n);
  card.querySelector(`[data-d-file="${n}"]`).onchange=e=>{const file=e.target.files[0];e.target.value='';if(file)run('D lane '+n+' import loop',()=>loadExtra(n,{file}));};
  card.querySelector(`[data-d-library="${n}"]`).onchange=e=>{const repository=e.target.value;run('D lane '+n+' library',()=>{extraState[n-2].repository=repository;syncExtra();saveState();});};
  for(const field of ['speed','fill'])card.querySelector(`[data-d-${field}="${n}"]`).onchange=e=>{const value=field==='speed'?normalizeSpeed(e.target.value):e.target.value;run('D lane '+n+' '+field,()=>set({[field]:value}));};
 }
 card.querySelector('[data-d-meters]').onchange=e=>{meterEnabled=e.target.checked;for(const m of card.querySelectorAll('[data-d-meter]'))m.hidden=!meterEnabled;refreshMeters();};
 if(!root.__mygrainSongRenderDeck){const observer=new IntersectionObserver(entries=>{meterVisible=entries.some(e=>e.isIntersecting);refreshMeters();});observer.observe(card.querySelector('.d-mini-mixer'));document.addEventListener('visibilitychange',refreshMeters);}
}

// Factory browsing remembers its place when a sound becomes Custom.
const bank=root.MygrainMutilatorPresets;let lastMutilatorPreset='',choosingMutilator=false;
const mutilatorCard=el('loopDMutilator'),bankPanel=document.createElement('section');bankPanel.className='d-mutilator-bank';bankPanel.dataset.mutilatorOwned='';bankPanel.setAttribute('aria-label','Mutilator factory presets');
bankPanel.innerHTML=`<label for="mutilatorPreset">PATCH BANK · 100 patches · 50 synced / 50 non-synced</label><div class="d-mutilator-preset-row"><button type="button" class="performance-btn" id="mutilatorPrev" aria-label="Previous Mutilator patch">−</button><select id="mutilatorPreset" aria-describedby="mutilatorPresetDescription"><option value="">Custom / choose a patch…</option>${bank.SECTIONS.map(section=>`<optgroup label="${section}">${bank.PRESETS.filter(p=>p.section===section).map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</optgroup>`).join('')}</select><button type="button" class="performance-btn" id="mutilatorNext" aria-label="Next Mutilator patch">+</button></div><p id="mutilatorPresetDescription" aria-live="polite"></p>`;
mutilatorCard.querySelector('.performance-actions').after(bankPanel);
const extra=document.createElement('div');extra.className='d-mutilator-extras';extra.dataset.mutilatorOwned='';
const extraRanges=[['resonance','Resonance',0,100,1,.5],['sweep','Sweep depth',0,100,1,1],['freeDepth','Free motion depth',0,100,1,0],['freeRate','Free motion rate · Hz',.125,12,.125,1],['output','Wet output · dB',-18,6,.5,0]];
extra.innerHTML=`<label class="d-mutilator-control">Filter type<select id="mutilatorFilter" data-mutilator-field="filter">${[['auto','Strain character (original)'],['lowpass','Low-pass'],['bandpass','Band-pass'],['highpass','High-pass'],['notch','Notch']].map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label><label class="d-mutilator-control">Tempo cycle<select id="mutilatorCycleBeats" data-mutilator-field="cycleBeats">${[[8,'2 bars'],[4,'1 bar (original)'],[2,'Half bar'],[1,'1 beat'],[.5,'Half beat']].map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label>${extraRanges.map(([field,label,min,max,step,def])=>`<label class="d-mutilator-control" for="mutilator-${field}"><span>${label}<output data-mutilator-value="${field}"></output></span><input id="mutilator-${field}" data-mutilator-field="${field}" type="range" min="${min}" max="${max}" step="${step}" value="${field==='freeRate'||field==='output'?def:def*100}"></label>`).join('')}<p class="performance-feature-note d-mutilator-motion-help">Tempo sync On: rhythmic accents follow the song tempo and Tempo cycle. Off: Free motion depth adds a BPM-independent sine sweep; zero depth keeps a static sound. Sweep depth scales either motion. Wet output trims only the processed sound.</p>`;
mutilatorCard.lastElementChild.before(extra);
function syncMutilatorBank(){root.mygrainEffectLfoUi?.sync('mutilator');if(!bankPanel)return;const s=state.mutilator,id=bank.match(s),preset=bank.PRESETS.find(p=>p.id===id);if(id)lastMutilatorPreset=id;el('mutilatorPreset').value=id;el('mutilatorPresetDescription').textContent=preset?preset.description:'Custom settings. + / − continues from the last patch. Power and input routing stay unchanged.';for(const control of extra.querySelectorAll('[data-mutilator-field]')){const field=control.dataset.mutilatorField,value=s[field]??root.MygrainMutilator.EXT[field];if(document.activeElement!==control)control.value=control.type==='range'&&!['freeRate','output'].includes(field)?value*100:value;const out=extra.querySelector(`[data-mutilator-value="${field}"]`);if(out)out.textContent=field==='output'?(value>0?'+':'')+value.toFixed(1)+' dB':field==='freeRate'?value.toFixed(3).replace(/0+$/,'').replace(/\.$/,'')+' Hz':Math.round(value*100)+'%';control.disabled=field==='cycleBeats'?!s.rhythm:['freeRate','freeDepth'].includes(field)?s.rhythm:false;}}
async function chooseMutilatorPreset(id){const p=bank.PRESETS.find(p=>p.id===id);if(!p||choosingMutilator){sync();return;}choosingMutilator=true;const controls=['mutilatorPreset','mutilatorPrev','mutilatorNext'].map(el);controls.forEach(c=>c.disabled=true);try{await edit('Mutilator patch · '+p.name,()=>{const enabled=state.mutilator.enabled,input=state.mutilator.input;state.mutilator=normalizeMutilator({...p.settings(),enabled,input,...(state.mutilator.lfo?{lfo:state.mutilator.lfo}:{})});setMutilator(state.mutilator);});}catch(e){setStatus(e.message,'error');}finally{choosingMutilator=false;controls.forEach(c=>c.disabled=false);sync();}}
el('mutilatorPreset').onchange=e=>chooseMutilatorPreset(e.target.value);
for(const[suffix,step]of[['Prev',-1],['Next',1]])el('mutilator'+suffix).onclick=()=>{if(choosingMutilator)return;const options=[...el('mutilatorPreset').options].filter(o=>o.value),index=options.findIndex(o=>o.value===(el('mutilatorPreset').value||lastMutilatorPreset)),next=index<0?(step>0?0:options.length-1):(index+step+options.length)%options.length;chooseMutilatorPreset(options[next].value);};
let controlEditBusy=false;const controlEdits=new Map();
async function editMutilatorControl(field,value){controlEdits.set(field,value);if(controlEditBusy)return;controlEditBusy=true;try{while(controlEdits.size){const[key,next]=controlEdits.entries().next().value;controlEdits.delete(key);try{await edit('Mutilator '+key,()=>setMutilator({[key]:next}));}catch(e){setStatus(e.message,'error');sync();}}}finally{controlEditBusy=false;}}
for(const control of extra.querySelectorAll('[data-mutilator-field]'))control.addEventListener(control.type==='range'?'input':'change',()=>{const field=control.dataset.mutilatorField,value=field==='filter'?control.value:Number(control.value)/(control.type==='range'&&!['freeRate','output'].includes(field)?100:1);editMutilatorControl(field,value);});
card.querySelector('[data-loop-d-repository]').addEventListener('change',event=>{const value=event.target.value;setRepository(value).catch(e=>{setStatus(e.message,'error');sync();});});
restore(readStoredStateSnapshot()?.modes?.loopD);
wireLanes();
const cutTemplate=el('bastardLoopDCutOverlay').outerHTML;
for(const n of [2,3,4]){const template=document.createElement('template');template.innerHTML=cutTemplate.replaceAll('bastardLoopDCut','bastardLoopD'+n+'Cut').replaceAll('Layer D','Layer D · Lane '+n);document.body.append(template.content);}
editor=new MygrainVocalCut.Editor({prefix:'bastardLoopDCut',settings:()=>state.cut,set:cut,randomize:()=>randomGaps(),edit,buffer:()=>playback({uncut:true}),timing:()=>({duration:duration(),cycle:duration(),bar:getLoopBarDurationSeconds(),frames:Math.round(duration()*(bastardLoopDBuffer?.sampleRate||48000))}),audition,stop:stopAudition,phase:()=>voice?((audioContext.currentTime-voice.origin)%duration())/duration():null});
for(const n of [2,3,4]){
 const r=extraRuntime[n-2];
 const stopPreview=()=>{r.auditionSerial=(r.auditionSerial||0)+1;const loops=r.auditionLoops;r.auditionLoops=false;if(r.preview){stopExtra(n);if(transportWanted&&bastardLoopPlaying)startExtra(n,getSharedLoopTransportOriginTime());}if(loops)stopAllBastardLoopLayers();};
 const audition=async(mode='metronome')=>{const serial=(r.auditionSerial||0)+1;r.auditionSerial=serial;if(!await ensureAudioReadyForKeyInteraction()||serial!==r.auditionSerial)return;const origin=audioContext.currentTime+.06;if(mode==='loops'){startAllBastardLoopLayers(origin);startExtra(n,origin,{audition:true});r.auditionLoops=true;return;}startExtra(n,origin,{audition:true});let next=origin,beat=0;r.metroNodes=new Set();const tick=()=>{if(!r.preview||audioContext.state!=='running')return stopPreview();while(next<audioContext.currentTime+.12){playKeyboardRepositoryMetronomeClick(next,beat%4===0,{nodeSet:r.metroNodes});next+=60/getTransportClockBpm();beat++;}};tick();r.metroTimer=setInterval(tick,25);};
 extraEditors.set(n,new MygrainVocalCut.Editor({prefix:'bastardLoopD'+n+'Cut',settings:()=>MygrainVocalCut.normalize(extraState[n-2].cut),set:value=>setExtra(n,{cut:value}),randomize:()=>laneApi(n).randomGaps(),edit:(label,action)=>edit('D lane '+n+' · '+label,action),buffer:()=>extraPlayback(n,{uncut:true}),timing:()=>({duration:duration(),cycle:duration(),bar:getLoopBarDurationSeconds(),frames:Math.round(duration()*(r.buffer?.sampleRate||48000))}),audition,stop:stopPreview,phase:()=>r.voice?((audioContext.currentTime-r.voice.origin)%duration())/duration():null}));
}
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
 const grid=root.mygrainSampleGridBrowser;if(grid&&!grid.overlay.hidden&&['bastardLoopD','bastardLoopD2','bastardLoopD3','bastardLoopD4','bastardLoopV','bastardLoopX'].includes(grid.config?.target))grid.stopPreview();
 if([SAMPLE_BROWSER_TARGETS.bastardLoopD,SAMPLE_BROWSER_TARGETS.bastardLoopD2,SAMPLE_BROWSER_TARGETS.bastardLoopD3,SAMPLE_BROWSER_TARGETS.bastardLoopD4,SAMPLE_BROWSER_TARGETS.bastardLoopV,SAMPLE_BROWSER_TARGETS.bastardLoopX].includes(dropboxSampleBrowserTarget))document.querySelectorAll('#dropboxSampleBrowserList audio').forEach(audio=>{if(audio.__mygrainPreview?.stop)audio.__mygrainPreview.stop();else audio.pause()});
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
// WAV/Loop Store exports capture the live graph rather than a Song deck.
// Bypass this monitor mask for the whole capture, restoring it even on failure.
const renderBars=root.renderLiveOutputBarsBuffer;
root.renderLiveOutputBarsBuffer=async function(...args){
 if(!localSolos.size||root.__mygrainSongRenderDeck)return renderBars.apply(this,args);
 localSoloSuspensions++;
 try{update({gainOnly:true});return await renderBars.apply(this,args);}
 finally{localSoloSuspensions--;if(audioContext&&audioContext.state!=='closed')update({gainOnly:true});else syncExtra();}
};
const soloSync=syncLoopLayerSoloButtons;syncLoopLayerSoloButtons=function(...a){const r=soloSync(...a);if(root.mygrainD){if(voice||(transportWanted&&bastardLoopPlaying))update({gainOnly:true});else sync();}return r};
sync();
root.addEventListener('mygrain-account-lock',()=>{localSolos.clear();stop();syncExtra();extraRuntime.forEach(r=>{r.revision++;r.controller?.abort();});});
root.addEventListener('mygrain-effect-solo',()=>{voice?.mutilator?.set({...state.mutilator,enabled:state.enabled&&state.mutilator.enabled&&root.mygrainEffectOutput.allows('mutilator')&&(!state.mutilator.input||state.mutilator.input==='D')});});
})(window);
