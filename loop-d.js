/* D: original loop + non-destructive exact-pattern fit and cut/gap playback.
 * The original source is portable in ZIP/IDB; derived PCM never replaces it. */
(function(root){
'use strict';
const card=document.getElementById('bastardLoopDCard'),el=id=>document.getElementById(id);
const defaults=()=>({version:1,enabled:false,fill:'repeat',level:.5,pitch:0,reverse:false,shift:0,cut:MygrainVocalCut.normalize(),metadata:null});
let state=defaults(),cache=null,voice=null,revision=0,busy=false,controller=null,preview=false,catalog=[],auditionSerial=0,metroTimer=null,auditionLoops=false;
const metroNodes=new Set();
const clone=v=>JSON.parse(JSON.stringify(v));
const duration=()=>getPatternLengthSteps()*60/getTransportClockBpm()/4;
function settings(){return {...clone(state),metadata:bastardLoopDMetadata?clone(bastardLoopDMetadata):null};}
function restore(value){
 revision++;controller?.abort();stop();const v=value||{},base=defaults();
 state={...base,enabled:v.enabled===true,fill:v.fill==='single'?'single':'repeat',level:Math.max(0,Math.min(1,Number.isFinite(v.level)?v.level:.5)),pitch:Math.max(-24,Math.min(24,Number(v.pitch)||0)),reverse:v.reverse===true,shift:Math.round(Number(v.shift)||0),cut:MygrainVocalCut.normalize(v.cut)};
 bastardLoopDMetadata=v.metadata||null;cache=null;sync();
}
function repetitions(buffer=bastardLoopDBuffer){
 if(!buffer||state.fill==='single')return 1;
 const name=bastardLoopDMetadata?.fileName||bastardLoopDMetadata?.filename||'';
 const match=name.match(/(?:^|[^0-9])(\d{2,3})(?:[ _-]*bpm)(?:\b|_)/i);
 const nativeBpm=Number(bastardLoopDMetadata?.sourceBpm||match?.[1])||getTransportClockBpm();
 const naturalSeconds=buffer.duration*nativeBpm/getTransportClockBpm();
 return Math.max(1,Math.min(getPatternLengthSteps()*2,Math.round(duration()/naturalSeconds)));
}
function fitted(){
 const raw=bastardLoopDBuffer;if(!raw||!audioContext){cache=null;return null;}
 const frames=Math.max(1,Math.round(duration()*raw.sampleRate)),repeats=repetitions(raw),key=[frames,repeats,state.pitch,state.reverse].join(':');
 if(cache?.raw===raw&&cache.context===audioContext&&cache.key===key)return cache.buffer;
 const unitFrames=Math.max(1,Math.round(frames/repeats));
 const unit=audioContext.createBuffer(raw.numberOfChannels,unitFrames,raw.sampleRate);
 MygrainVocalCut.stretchChannels(Array.from({length:raw.numberOfChannels},(_,i)=>raw.getChannelData(i)),Array.from({length:raw.numberOfChannels},(_,i)=>unit.getChannelData(i)),raw.sampleRate);
 const filled=audioContext.createBuffer(raw.numberOfChannels,frames,raw.sampleRate);
 for(let c=0;c<raw.numberOfChannels;c++){const a=unit.getChannelData(c),out=filled.getChannelData(c);for(let i=0;i<frames;i++)out[i]=a[i%a.length];}
 const buffer=getBastardLoopPlaybackBufferForMode(filled,Math.pow(2,state.pitch/12),{preserveDuration:true,reversed:state.reverse});
 cache={raw,context:audioContext,key,buffer};return buffer;
}
function playback({uncut=false}={}){const b=fitted();return !b||uncut?b:MygrainVocalCut.gate(audioContext,b,state.cut,b.duration);}
function level(){return state.enabled?state.level*getLoopLayerSoloGain('bastardd'):0;}
function stop(){
 auditionSerial++;if(metroTimer)clearInterval(metroTimer);metroTimer=null;
 for(const {oscillator,gain}of metroNodes){try{oscillator.stop();oscillator.disconnect();gain.disconnect()}catch{}}metroNodes.clear();
 preview=false;if(!voice)return;
 const v=voice;voice=null;try{v.source.onended=null;v.source.stop()}catch{};v.source.disconnect();v.gain.disconnect();v.route?.disconnect();
}
function start(at=null,{audition=false}={}){
 if(!audioContext||!preFilterGainNode||!bastardLoopDBuffer||(!audition&&level()<=0))return false;
 const b=playback();if(!b)return false;
 stop();const timing=resolveTransportLaneStart(at,'D'),time=timing.time,origin=timing.origin;
 const source=audioContext.createBufferSource(),gain=audioContext.createGain();source.buffer=b;source.loop=true;source.loopEnd=b.duration;
 const volume=audition?Math.max(.25,state.level):level();gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(volume*MIX_HEADROOM*.88,time+.004);source.connect(gain);
 const route=root.mygrainChannelEq.connect('D',gain,preFilterGainNode,source);
 const shift=state.shift*60/getTransportClockBpm()/4,elapsed=Number.isFinite(origin)?Math.max(0,time-origin):0,offset=((elapsed-shift)%b.duration+b.duration)%b.duration;
 voice={source,gain,route,origin:Number.isFinite(origin)?origin:time};source.onended=()=>{if(voice?.source===source)stop()};startTransportSource(source,time,offset);preview=audition;return true;
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
function update({gainOnly=false}={}){if(gainOnly&&voice&&!preview&&level()>0){voice.gain.gain.setTargetAtTime(level()*MIX_HEADROOM*.88,audioContext.currentTime,.01);sync();return;}if(voice){if(preview)start(audioContext.currentTime,{audition:true});else if(level()>0)start(getSharedLoopTransportOriginTime());else stop();}else if(bastardLoopPlaying&&level()>0)start(getSharedLoopTransportOriginTime());sync();}
function enable(value,options={}){state.enabled=!!value;update();if(!options.skipSave)saveState();}
function cut(value,options={}){state.cut=MygrainVocalCut.normalize(value);if(!options.skipRestart)update();else sync();if(!options.skipSave)saveState();return state.cut;}
function gapSettings(base=state.cut,random=Math.random,amount=3){
 const n=getPatternLengthSteps(),candidates=Array.from({length:n-1},(_,i)=>i+1),gaps=[];
 for(let j=0;j<Math.min(amount,Math.max(1,Math.floor(n/3)));j++){const i=Math.floor(random()*candidates.length),cell=candidates.splice(i,1)[0];gaps.push([cell/n,(cell+1)/n]);}
 return MygrainVocalCut.normalize({...base,gapEnabled:true,gaps});
}
function randomGaps(options={}){if(!bastardLoopDBuffer)throw Error('Load a loop in D first.');return cut(gapSettings(),options);}
function sync(){
 if(!card)return;
 el('loopDFill').value=state.fill;el('performanceBastardLoopDLevel').value=String(state.level*100);el('loopDPitch').value=state.pitch;
 el('loopDPitchValue').textContent=state.pitch+' st';el('loopDLevelValue').textContent=Math.round(state.level*100)+'%';el('loopDShiftValue').textContent=state.shift;
 for(const [id,on,label]of[['loopDToggle',state.enabled,'D'],['loopDReverse',state.reverse,'Reverse']]){el(id).textContent=label+(on?' On':' Off');el(id).setAttribute('aria-pressed',String(on));}
 const solo=loopLayerSolo==='bastardd';el('loopDSolo').textContent=solo?'Solo On':'Solo Off';el('loopDSolo').setAttribute('aria-pressed',String(solo));
 for(const id of ['loopDCut','loopDGaps'])el(id).disabled=!bastardLoopDBuffer||busy;
 for(const id of ['loopDRandom','loopDBrowse','loopDFile'])el(id).disabled=busy;
 el('loopDMeta').textContent=busy?'Loading and stretching loop…':bastardLoopDBuffer?`${bastardLoopDMetadata?.fileName||bastardLoopDMetadata?.filename||'Imported loop'} · ${duration().toFixed(3)}s · ${repetitions()} repeat${repetitions()===1?'':'s'} · ${getPatternLengthSteps()} steps`:'No loop loaded.';
 editor?.refresh();
}
async function apply(buffer,label,metadata={}){
 if(!buffer)throw Error('Loop D has no audio frames.');
 const old=bastardLoopDBuffer;bastardLoopDBuffer=buffer;bastardLoopDMetadata={...metadata,fileName:metadata.fileName||metadata.filename||label||'loop.wav',durationSeconds:buffer.duration};cache=null;
 try{fitted();await saveAudioBufferToDB(buffer,BASTARD_LOOP_D_AUDIO_BUFFER_KEY)}catch(e){bastardLoopDBuffer=old;cache=null;throw e}sync();return buffer;
}
async function load({path,file}={},options={}){
 if(busy)throw Error('Wait for Loop D to finish loading.');
 if(!await ensureAudioReadyForKeyInteraction())throw Error('Start MYGRAIN before loading Loop D.');
 busy=true;const token=++revision,ctx=audioContext,account=root.mygrainAccounts?.user?.username;
 const abort=controller=new AbortController();const guard=()=>{if(token!==revision||ctx!==audioContext||!root.mygrainAccounts?.authenticated||account!==root.mygrainAccounts.user?.username||abort.signal.aborted)throw Error('Loop D load cancelled because the sound or account changed.');};
 const timeout=setTimeout(()=>abort.abort(),120000);sync();
 const old={buffer:bastardLoopDBuffer,metadata:bastardLoopDMetadata,state:clone(state)};
 try{
  guard();let data,meta;
  if(file){if(file.size>32*1024*1024)throw Error('Choose a loop smaller than 32 MB.');data=await file.arrayBuffer();meta={fileName:file.name,sourceKey:'import',sourceLabel:'Imported loop'};}
  else{
   const url=new URL(DROPBOX_SAMPLE_SOURCE_API_URL,document.baseURI);url.searchParams.set('source','samples_loops');if(path)url.searchParams.set('path',path);url.searchParams.set('seed',String(Date.now())+'-'+Math.random());
   const r=await fetch(url,{cache:'no-store',signal:abort.signal});if(!r.ok)throw Error(`Loop D sample failed (${r.status}).`);
   if(Number(r.headers.get('Content-Length'))>32*1024*1024)throw Error('Choose a loop smaller than 32 MB.');
   data=await r.arrayBuffer();if(data.byteLength>32*1024*1024)throw Error('Choose a loop smaller than 32 MB.');
   const sourceKey=r.headers.get('X-Mygrain-Source-Key');if(sourceKey&&sourceKey!=='samples_loops')throw Error('Unexpected D source library.');
   const relativePath=decodeRepositoryHeader(r.headers.get('X-Mygrain-Source-Path'))||path||'';
   meta={sourceKey:'samples_loops',sourceLabel:'SAMPLES_LOOPS',relativePath,fileName:relativePath.split('/').pop()||'loop.wav'};
  }
  guard();const buffer=await ctx.decodeAudioData(data);guard();
  if(!buffer.length||buffer.duration>300)throw Error('Choose a loop no longer than five minutes.');
  state.cut=MygrainVocalCut.normalize();await apply(buffer,meta.fileName,meta);guard();state.enabled=true;sourceMutationSerial++;
  if(options.batch)randomGaps({skipSave:true,skipRestart:true});update();saveState();return settings();
 }catch(e){if(token===revision&&ctx===audioContext&&account===root.mygrainAccounts?.user?.username){bastardLoopDBuffer=old.buffer;bastardLoopDMetadata=old.metadata;state=old.state;cache=null;if(old.buffer)await saveAudioBufferToDB(old.buffer,BASTARD_LOOP_D_AUDIO_BUFFER_KEY);else await clearAudioBufferFromDB(BASTARD_LOOP_D_AUDIO_BUFFER_KEY);update();}throw e;}
 finally{clearTimeout(timeout);if(controller===abort)controller=null;busy=false;sync();}
}
function edit(label,action){if(root.mygrainCardHistory?.busy)throw Error('Wait for the current sound change.');return root.mygrainCardHistory?root.mygrainCardHistory.runDraftEdit(label,action):action();}
function random(options={}){return options.batch?load({},options):edit('D random loop',()=>load({},options));}
let editor=null;
root.mygrainD={settings,restore,playback,fitted,repetitions,duration,apply,start,stop,enable,level,cut,randomGaps,gapSettings,sync,random,load,get busy(){return busy},get source(){return voice?.source},get gain(){return voice?.gain},get state(){return state},invalidate(){cache=null},playable:()=>state.enabled&&!!bastardLoopDBuffer&&state.level>0};
restore(readStoredStateSnapshot()?.modes?.loopD);
editor=new MygrainVocalCut.Editor({prefix:'bastardLoopDCut',settings:()=>state.cut,set:cut,randomize:()=>randomGaps(),edit,buffer:()=>playback({uncut:true}),timing:()=>({duration:duration(),cycle:duration(),bar:getLoopBarDurationSeconds(),frames:Math.round(duration()*(bastardLoopDBuffer?.sampleRate||48000))}),audition,stop:stopAudition,phase:()=>voice?((audioContext.currentTime-voice.origin)%duration())/duration():null});
const handle=(id,action)=>el(id).addEventListener('click',()=>Promise.resolve().then(action).catch(e=>setStatus(e.message,'error')));
handle('loopDRandom',()=>random());handle('loopDToggle',()=>edit('D on/off',()=>enable(!state.enabled)));handle('loopDSolo',()=>{setLoopLayerSolo('bastardd',{toggle:true});update()});
handle('loopDReverse',()=>edit('D reverse',()=>{state.reverse=!state.reverse;cache=null;update();saveState()}));
for(const [id,dir]of [['loopDShiftLeft',-1],['loopDShiftRight',1]])handle(id,()=>edit('D shift',()=>{state.shift+=dir;update();saveState()}));
handle('loopDCut',()=>editor.open());handle('loopDGaps',()=>edit('D random gaps',()=>randomGaps()));
el('loopDFile').addEventListener('change',e=>{const file=e.target.files[0];if(file)edit('D import loop',()=>load({file})).catch(e=>setStatus(e.message,'error'));e.target.value=''});
for(const [id,event,field,convert]of [['loopDFill','change','fill',v=>v],['performanceBastardLoopDLevel','input','level',v=>Number(v)/100],['loopDPitch','input','pitch',Number]])el(id).addEventListener(event,e=>{state[field]=convert(e.target.value);if(field!=='level')cache=null;update({gainOnly:field==='level'});saveState()});
function filter(){const q=el('loopDSearch').value.toLocaleLowerCase();el('loopDChoices').replaceChildren(...catalog.filter(f=>f.relativePath.toLocaleLowerCase().includes(q)).map(f=>{const o=document.createElement('option');o.value=f.relativePath;o.textContent=f.relativePath;return o}));}
handle('loopDBrowse',async()=>{el('loopDBrowser').showModal();el('loopDBrowserStatus').textContent='Loading all loop folders…';const r=await fetch(new URL('/mygrain-bastardloops/api/source-files?source=samples_loops&refresh=1',document.baseURI),{cache:'no-store'}),p=await r.json();if(!r.ok||!p.ok)throw Error(p.error||'Loop directory unavailable.');catalog=p.files||[];filter();el('loopDBrowserStatus').textContent=catalog.length+' loops';});
el('loopDSearch').addEventListener('input',filter);handle('loopDBrowserClose',()=>el('loopDBrowser').close());handle('loopDLoad',async()=>{const path=el('loopDChoices').value;if(!path)throw Error('Choose a loop.');await edit('D choose loop',()=>load({path}));el('loopDBrowser').close()});
// Shared parameter changes refit from the original, never stretch a stretched copy.
for(const name of ['applyGlobalBpm','syncPatternLengthControls']){const raw=root[name];root[name]=function(...args){const was=!!voice,result=raw(...args);cache=null;if(was)update();else sync();return result};}
const soloSync=syncLoopLayerSoloButtons;syncLoopLayerSoloButtons=function(...a){const r=soloSync(...a);if(root.mygrainD)update();return r};
sync();
})(window);
