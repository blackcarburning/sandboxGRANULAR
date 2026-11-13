(function(root){
'use strict';
if(root.__mygrainSongRenderDeck||root.mygrainPhone||/iPhone|iPad|Android|iPod/i.test(navigator.userAgent))return;
const maxZip=128*1048576,decoder=new TextDecoder('utf-8',{fatal:true});
const bytes=n=>n>=1048576?(n/1048576).toFixed(2)+' MiB':n>=1024?(n/1024).toFixed(1)+' KiB':n+' B';
function decode(buffer,kind){
 if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<20)throw Error('Incomplete project snapshot.');
 const view=new DataView(buffer),n=view.getUint32(8,true),m=view.getUint32(12,true);
 if(view.getUint32(0,true)!==0x3150474d||view.getUint32(4,true)!==1||n<2||n>65536||m<4||m>maxZip||16+n+m!==buffer.byteLength)throw Error('Unsupported project snapshot.');
 const settings=JSON.parse(decoder.decode(new Uint8Array(buffer,16,n)));
 if(settings.format!=='mygrain-daw-project'||settings.version!==1||settings.kind!==kind)throw Error('Snapshot belongs to a different plugin or needs a newer MYGRAIN.');
 if(kind==='bridge'&&(!['live','rendered'].includes(settings.mode)||![1,2,4,8,16].includes(settings.bars)))throw Error('Invalid saved Bridge settings.');
 if(kind==='fx'&&(!Number.isInteger(settings.gainDb)||settings.gainDb< -24||settings.gainDb>12||typeof settings.mute!=='boolean'||!['filters','master','final','direct'].includes(settings.route)))throw Error('Invalid saved FX settings.');
 return {settings,zip:buffer.slice(16+n)};
}
class Session {
 constructor(options){
  this.partsBin={parts:[],version:0,storedVersion:0};this.partsBusy=false;this.knownParts=new Set();this.storeWaiters=[];
  (root.mygrainProjectSessions ||= new Set()).add(this);
  this.options=options;this.worker=null;this.codec=null;this.generation=0;this.id=0;this.revision=-1;this.ready=false;this.busy=false;this.storing=false;this.supported=false;this.last=null;this.pending=null;this.timer=null;
  this.auto={enabled:true,interval:60};this.stats={lastSave:0,durationMs:0,transferBytes:0,snapshotBytes:0,totalBytes:0,count:0,skipped:0};this.nextAt=0;this.fingerprint='';this.assets=new WeakMap();this.assetSerial=0;this.knownAssets=new Set();this.lastEdit=0;this.preferenceAccount=null;
  const box=document.createElement('div');box.className='daw-project-panel';box.innerHTML='<div class="daw-project-actions"><button type="button" class="daw-project-store" disabled>Store now</button><button type="button" class="daw-project-restore" disabled>Restore project snapshot</button></div><div class="daw-project-auto"><label><input class="daw-project-auto-enabled" type="checkbox" checked> Automatically store patch in plugin</label><label>Check every <input class="daw-project-interval" type="number" min="15" max="3600" step="1" value="60"> seconds</label></div><p class="daw-project-status" role="status">Connect the updated plugin for automatic patch storage.</p><dl class="daw-project-stats"></dl><p class="daw-project-help">Auto-store keeps this plugin’s editable patch and required sounds up to date, not the Songs library. Unchanged patches are skipped. Saves wait for recording, sample loads and other edits to finish; playback can continue. Save your DAW project normally to write it to disk. If a DAW Save happens during transfer, it contains the previous completed snapshot. Rendered audio is separate: use Refresh render after sound changes. Chrome must remain connected for new edits to be stored. Transfer figures count project payload and application headers, not TCP/WebSocket framing. Background storage requires Bridge 0.8.0 / FX 0.4.0 or newer.</p>';
  options.card.append(box);this.box=box;this.label=box.querySelector('[role="status"]');this.storeButton=box.querySelector('.daw-project-store');this.restoreButton=box.querySelector('.daw-project-restore');this.storeButton.onclick=()=>this.store();this.restoreButton.onclick=()=>this.restore();
  this.autoInput=box.querySelector('.daw-project-auto-enabled');this.intervalInput=box.querySelector('.daw-project-interval');this.statsLabel=box.querySelector('.daw-project-stats');this.autoInput.onchange=()=>this.configure({enabled:this.autoInput.checked});this.intervalInput.onchange=()=>this.configure({interval:Number(this.intervalInput.value)});
  document.addEventListener('input',e=>{if(!e.target.closest('.daw-project-panel'))this.lastEdit=Date.now();},true);document.addEventListener('change',e=>{if(!e.target.closest('.daw-project-panel'))this.lastEdit=Date.now();},true);
  this.pulse=null;this.preferences();this.drawStats();
 }
 text(value){if(this.label.textContent!==value)this.label.textContent=value;}
 preferences(){const user=root.mygrainAccounts?.user?.username;if(user===this.preferenceAccount)return;this.preferenceAccount=user;this.auto={enabled:true,interval:60};if(user)try{const a=JSON.parse(localStorage.getItem('mygrainProjectAuto:'+user+':'+this.options.kind));if(a)this.configure(a,false);}catch{}this.nextAt=Date.now()+this.auto.interval*1000;}
 configure(value,persist=true){if(typeof value.enabled==='boolean')this.auto.enabled=value.enabled;if(Number.isFinite(value.interval))this.auto.interval=Math.max(15,Math.min(3600,Math.round(value.interval)));this.autoInput.checked=this.auto.enabled;this.intervalInput.value=String(this.auto.interval);this.nextAt=Date.now()+this.auto.interval*1000;if(persist&&this.preferenceAccount)try{localStorage.setItem('mygrainProjectAuto:'+this.preferenceAccount+':'+this.options.kind,JSON.stringify(this.auto));}catch{}this.drawStats();}
 update(){this.storeButton.disabled=!this.worker||!this.supported||!this.ready||this.busy||this.storing||this.partsBusy||this.options.blocked();this.restoreButton.disabled=!this.worker||!this.supported||!this.last?.projectBytes||this.busy||this.storing||this.partsBusy;this.options.changed?.();this.drawStats();root.mygrainPartsBin?.sync();}
 finishStore(ok){for(const resolve of this.storeWaiters.splice(0))resolve(ok);}
 async storeAndWait(){await this.store();if(!this.storing)return false;return new Promise(resolve=>this.storeWaiters.push(resolve));}
 reset(worker=null){this.finishStore(false);this.partsBin={parts:[],version:0,storedVersion:0};this.partsBusy=false;this.knownParts.clear();clearInterval(this.pulse);this.pulse=worker?setInterval(()=>this.tick(),1000):null;this.generation++;clearTimeout(this.timer);this.timer=null;this.worker=worker;this.codec?.terminate();this.codec=null;this.assets=new WeakMap();this.knownAssets.clear();this.fingerprint='';this.ready=false;this.busy=false;this.storing=false;this.revision=-1;this.last=null;this.pending=null;this.supported=false;this.stats={lastSave:0,durationMs:0,transferBytes:0,snapshotBytes:0,totalBytes:0,count:0,skipped:0};this.preferences();this.nextAt=Date.now()+this.auto.interval*1000;this.text(worker?'Checking saved project state…':'Disconnected. Plugin snapshot retained; save the DAW project to keep it on disk.');this.update();}
 observe(info){
  this.preferences();this.last=info;this.supported=info.projectState===1;
  if(!this.supported){this.ready=true;this.text('Install Bridge 0.8.0 / FX 0.4.0 for automatic project storage and Pot controls.');this.update();return;}
  if(!this.busy&&!this.storing&&this.revision!==info.projectRevision){
   if(info.projectBytes){this.restore();return;}
   this.revision=info.projectRevision;this.ready=true;this.nextAt=Date.now()+this.auto.interval*1000;this.text('No patch stored yet. Automatic storage is '+(this.auto.enabled?'scheduled.':'paused; use Store now.'));
  }this.update();
 }
 guard(generation){if(generation!==this.generation||!this.worker||(!this.busy&&!this.storing))throw Error('Connection changed.');if(!root.mygrainAccounts?.authenticated)throw Error('Sign in to use project storage.');}
 async engine(generation){const until=performance.now()+120000;while(!root.mygrainSongBetaAdapter||typeof isAudioGraphReady!=='function'||!isAudioGraphReady()||audioContext.state!=='running'||engineStarting||stateSaveSuspended||root.mygrainCardHistory?.busy){this.guard(generation);if(performance.now()>until)throw Error('Press Start MYGRAIN once, then retry.');await new Promise(r=>setTimeout(r,100));}this.guard(generation);return audioContext;}
 timeout(message){clearTimeout(this.timer);this.timer=setTimeout(()=>this.fail(message),120000);}
 fail(message){this.finishStore(false);this.knownParts.clear();clearTimeout(this.timer);this.timer=null;this.busy=false;this.storing=false;this.pending=null;this.nextAt=Date.now()+this.auto.interval*1000;this.text(message+' Previous stored snapshot retained; automatic storage will retry.');this.update();}
 conflicts(){return this.partsBusy||this.options.blocked()||root.mygrainSongBeta?.busy||root.mygrainSongBeta?.playing||root.mygrainAiPatch?.busy||root.mygrainCardHistory?.busy||typeof megaRandomizeInFlight!=='undefined'&&megaRandomizeInFlight||typeof hasPendingMegaRandomLoads==='function'&&hasPendingMegaRandomLoads()||typeof isOutputRecording!=='undefined'&&(isOutputRecording||isOutputRecordingArmed);}
 tick(){this.drawStats();if(this.worker&&this.ready&&this.supported&&this.auto.enabled&&this.last?.projectTransfer!==2){this.text('Install Bridge 0.8.0 / FX 0.4.0 for uninterrupted automatic storage. Older plugins can use Store now while the DAW is stopped.');return;}if(!this.worker||!this.supported||!this.ready||this.busy||this.storing||!this.auto.enabled||Date.now()<this.nextAt)return;
  if(this.conflicts()||Date.now()-this.lastEdit<1200){this.text('Automatic store due · waiting for the current edit, loading or recording to finish.');return;}
  try{root.mygrainSongBetaAdapter?.assertNotRecording();}catch{this.text('Automatic store due · waiting for recording to finish.');return;}this.store({automatic:true});
 }
 drawStats(){if(!this.statsLabel)return;const s=this.stats,active=this.worker&&this.ready&&this.supported;const next=!this.auto.enabled?'Paused':!active?'Waiting for connection / recall':this.storing?'In progress':Math.max(0,Math.ceil((this.nextAt-Date.now())/1000))+' s';
  const pairs=[['Last completed store',s.lastSave?new Date(s.lastSave).toLocaleString()+' · '+Math.max(0,Math.floor((Date.now()-s.lastSave)/1000))+' s ago':'Not yet in this connection'],['Last store duration',s.lastSave?(s.durationMs/1000).toFixed(2)+' s':'—'],['Last data transferred',s.lastSave?bytes(s.transferBytes)+' · '+(s.delta?'incremental':'full snapshot'):'—'],['Complete snapshot size',bytes(s.snapshotBytes)],['This connection',s.count+' stores · '+s.skipped+' unchanged checks · '+bytes(s.totalBytes)+' transferred'],['Next automatic check',next]];
  const text=pairs.map(([a,b])=>'<div><dt>'+a+'</dt><dd>'+b+'</dd></div>').join('');if(this.statsLabel.innerHTML!==text)this.statsLabel.innerHTML=text;
 }
 restore(){
  if(!this.worker||!this.supported||!this.last?.projectBytes||this.busy||this.storing||this.partsBusy)return;
  this.busy=true;this.ready=false;const id=++this.id;this.pending={type:'restore',id,revision:this.last.projectRevision};this.revision=this.last.projectRevision;
  this.text('Restoring the project’s saved patch and sounds… Press Start MYGRAIN once if Chrome needs an audio gesture.');this.update();this.timeout('Project restore timed out. Press Restore project snapshot to retry.');this.worker.postMessage({type:'getProject',id,revision:this.revision});
 }
 codecWorker(){if(this.codec)return this.codec;const generation=this.generation;const worker=this.codec=new Worker(new URL('daw-project-codec.js?v=20261112-parts-bin-1',document.baseURI));worker.onmessage=({data})=>{
  if(generation!==this.generation||this.pending?.type!=='store'||data.id!==this.pending.id)return;
  if(data.type==='error'){this.assets=new WeakMap();this.knownAssets.clear();return this.fail('Could not prepare snapshot: '+data.message);}
  if(data.type!=='prepared')return;
  const p=this.pending;p.snapshotBytes=data.documentBytes;p.assetBytes=data.assetBytes;p.delta=data.delta;this.text('Transferring '+bytes(data.buffer.byteLength)+' to the plugin… Playback continues.');
  this.worker.postMessage({type:'storeProject',id:data.id,rendered:p.settings.mode==='rendered'&&!!(this.last?.loopFrames||this.last?.projectRendered),buffer:data.buffer,hash:data.hash,delta:data.delta,revision:p.revision},[data.buffer]);
 };worker.onerror=()=>this.fail('Snapshot preparation failed.');return worker;}
 async store({automatic=false}={}){
  if(this.last?.projectTransfer!==2&&(automatic||this.last?.playing)){this.text('Update the plugin for background storage, or stop DAW playback and use Store now.');return;}
  if(!this.worker||!this.ready||!this.supported||this.busy||this.storing||this.partsBusy||this.options.blocked())return;
  if(this.conflicts()){this.text('Waiting for the current edit, recording or Song operation to finish.');return;}
  const generation=this.generation;this.storing=true;const id=++this.id;this.pending={type:'store',id,started:performance.now(),revision:this.revision,automatic};this.text('Preparing editable patch in the background… Playback continues.');this.update();this.timeout('Project transfer timed out.');
  try{
   const context=await this.engine(generation),account=root.mygrainAccounts.user?.username,settings={kind:this.options.kind,...this.options.settings(),autoStore:{...this.auto}};
   const captured=await root.mygrainSongBetaAdapter.capture({liveOnly:true,projectCapture:true});this.guard(generation);
   if(context!==audioContext||account!==root.mygrainAccounts.user?.username||this.conflicts())throw Error('Account, audio or edit changed during capture.');
   const slots=[],audio=[],transfers=[],pcm16=new Set(captured.pcm16Keys);let total=0;
   for(const [key,buffer]of captured.buffers){if(!buffer)continue;total+=44+buffer.length*buffer.numberOfChannels*2;if(total>maxZip)throw Error('Required sounds exceed the 128 MB patch limit.');let asset=this.assets.get(buffer);if(!asset){asset={id:++this.assetSerial};this.assets.set(buffer,asset);}slots.push({key,id:asset.id,channels:buffer.numberOfChannels,frames:buffer.length,rate:buffer.sampleRate,pcm16:pcm16.has(key)});}
   const stable=structuredClone(captured.snapshot);delete stable.createdAt;if(stable.state)delete stable.state.timestamp;
   const fingerprint=JSON.stringify([stable,settings,slots,this.partsBin.version,this.partsBin.parts.map(p=>p.id)]);
   if(automatic&&fingerprint===this.fingerprint){clearTimeout(this.timer);this.timer=null;this.pending=null;this.storing=false;this.stats.skipped++;this.nextAt=Date.now()+this.auto.interval*1000;this.text('Up to date in plugin · unchanged patch; no data transferred. Save the DAW project normally.');this.update();return;}
   for(const slot of slots){if(this.knownAssets.has(slot.id))continue;const buffer=captured.buffers.get(slot.key),channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i).slice());channels.forEach(c=>transfers.push(c.buffer));audio.push({id:slot.id,rate:slot.rate,pcm16:slot.pcm16,channels});this.knownAssets.add(slot.id);}
   // Remove main-side cache identities not held by the bounded codec cache.
   const active=new Set(slots.map(a=>a.id));for(const key of this.knownAssets)if(!active.has(key))this.knownAssets.delete(key);
   this.pending.fingerprint=fingerprint;this.pending.settings=settings;this.pending.partsVersion=this.partsBin.version;
   const parts=this.partsBin.parts.map(({zip,preview,...part})=>part),partData=[];
   for(const part of this.partsBin.parts)if(!this.knownParts.has(part.id)){partData.push({id:part.id,zip:part.zip,preview:part.preview});this.knownParts.add(part.id);}
   const activeParts=new Set(parts.map(p=>p.id));for(const id of this.knownParts)if(!activeParts.has(id))this.knownParts.delete(id);
   this.codecWorker().postMessage({type:'pack',id,settings:{...settings,storedAt:new Date().toISOString()},snapshot:captured.snapshot,slots,audio,parts,partData,delta:this.last?.projectTransfer===2,revision:this.revision},transfers);
  }catch(e){if(generation===this.generation)this.fail('Could not store: '+e.message);}
 }
 async event(data){
  if(!['projectStored','projectError','projectSnapshot','projectProgress','projectTransferStats'].includes(data.type))return false;
  const pending=this.pending;if(data.type==='projectError'){if(pending&&(!data.id||data.id===pending.id))this.fail(data.message||'Project snapshot was rejected.');return true;}
  if(!pending||data.id!==pending.id)return true;
  if(data.type==='projectProgress'){this.text('Transferring snapshot · '+bytes(data.sent)+' / '+bytes(data.bytes)+' · playback continues.');return true;}
  if(data.type==='projectTransferStats'){pending.transferBytes=data.bytes;return true;}
  if(data.type==='projectStored'&&pending.type==='store'){
   clearTimeout(this.timer);this.timer=null;this.revision=data.revision;this.partsBin.storedVersion=pending.partsVersion;this.fingerprint=pending.fingerprint;this.codec?.postMessage({type:'commit',id:pending.id,revision:data.revision});this.stats={...this.stats,lastSave:Date.now(),durationMs:performance.now()-pending.started,transferBytes:pending.transferBytes||0,snapshotBytes:pending.snapshotBytes,delta:pending.delta,totalBytes:this.stats.totalBytes+(pending.transferBytes||0),count:this.stats.count+1};this.pending=null;this.storing=false;this.ready=true;this.nextAt=Date.now()+this.auto.interval*1000;this.text('Ready for DAW save · snapshot stored in this plugin. '+(this.auto.enabled?'Automatic storage is on. ':'')+'Save the DAW project normally.');this.finishStore(true);this.update();return true;
  }
  if(data.type==='projectSnapshot'&&pending.type==='restore'&&data.revision===pending.revision){
   const generation=this.generation;
   try{
    const {settings,zip}=decode(data.buffer,this.options.kind),context=await this.engine(generation),account=root.mygrainAccounts.user?.username;
    if(this.pending!==pending||this.last?.projectRevision!==pending.revision)throw Error('Project changed during restore.');
    const adapter=root.mygrainSongBetaAdapter;adapter.assertNotRecording();const bin=await root.mygrainPartsBin.unpackProject(zip),part=await adapter.decode(bin.zip,{buffers:new Map(),bytes:0,limitBytes:256*1048576});this.guard(generation);
    if(this.pending!==pending||this.last?.projectRevision!==pending.revision||context!==audioContext||account!==root.mygrainAccounts.user?.username||root.mygrainSongBeta?.busy||root.mygrainAiPatch?.busy||root.mygrainCardHistory?.busy)throw Error('Audio, account or editor operation changed during restore.');
    adapter.recall(part,{start:false,persist:false});this.guard(generation);this.options.apply(settings,this.last);this.partsBin={parts:bin.parts,version:0,storedVersion:0};this.codec?.terminate();this.codec=null;this.knownParts.clear();this.knownAssets.clear();this.assets=new WeakMap();this.fingerprint='';if(settings.autoStore)this.configure(settings.autoStore);this.stats.snapshotBytes=data.buffer.byteLength;
    this.worker.postMessage({type:'projectRestored',revision:data.revision});clearTimeout(this.timer);this.timer=null;this.pending=null;this.busy=false;this.ready=true;this.nextAt=Date.now()+this.auto.interval*1000;
    this.text('Project snapshot restored · editable patch and sounds'+(settings.mode==='rendered'?' + saved rendered loop':'')+'. '+(settings.storedAt?'Captured '+new Date(settings.storedAt).toLocaleString()+'. ':'')+'Automatic storage '+(this.auto.enabled?'resumes after recall.':'is paused.'));this.update();
   }catch(e){if(generation===this.generation)this.fail('Could not restore: '+e.message);}
  }return true;
 }
 diagnostics(){return {ready:this.ready,busy:this.busy,storing:this.storing,supported:this.supported,revision:this.revision,status:this.label.textContent,auto:{...this.auto},stats:{...this.stats},nextIn:Math.max(0,Math.ceil((this.nextAt-Date.now())/1000))};}
}
root.MygrainProjectSession=Session;
})(window);
