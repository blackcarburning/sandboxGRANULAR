/* Plugin-session library. Never saved in browser storage, source ZIPs or Songs. */
(function(root){
'use strict';
const LIMIT=96*1048576,MAX_PARTS=32;
const icon='<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M8 25h48l-5 30H13zM8 25l8-9h32l8 9M24 36h16v8H24z"/><path d="m19 16-3-7 12-4 4 11m6 0 5-10 10 5-3 7M12 55h40"/></svg>';
let card=null,session=null,busy=false,locked=false,operation=null,renderKey='',previewUrl=null,previewId=null;
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const bytes=n=>(n/1048576).toFixed(1)+' MiB';
const current=()=>[...(root.mygrainProjectSessions||[])].find(s=>s.worker&&s.supported)||null;
const total=parts=>parts.reduce((n,p)=>n+p.zip.byteLength+p.preview.byteLength,0);
function say(text,error=false){const e=card?.querySelector('#partsBinStatus');if(e){e.textContent=text;e.dataset.error=String(error);}}
function stopPreview(){const audio=card?.querySelector('audio');if(audio){audio.pause();audio.removeAttribute('src');audio.load();}if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;previewId=null;if(card)card.querySelector('#partsBinPreviewName').textContent='Choose a part to preview';}
function available(s){return !!(!locked&&root.mygrainAccounts?.authenticated&&s?.worker&&s.supported&&s.ready&&!s.busy&&!s.storing&&!s.options.blocked()&&!s.partsBusy);}
function check(s){if(!available(s)||current()!==s)throw Error('Wait for the connected plugin to finish storing or restoring its patch.');}
function guard(s,token){token.signal.throwIfAborted();if(locked||current()!==s||!s.worker||!root.mygrainAccounts?.authenticated||token.generation!==s.generation||token.account!==root.mygrainAccounts.user?.username)throw Error('The plugin connection or account changed. No new part was committed.');}
function conflicts(){if(root.mygrainSongBeta?.busy||root.mygrainSongBeta?.playing||root.mygrainSongBeta?.editing||root.mygrainCardHistory?.busy||root.mygrainAiPatch?.busy||typeof megaRandomizeInFlight!=='undefined'&&megaRandomizeInFlight||typeof hasPendingMegaRandomLoads==='function'&&hasPendingMegaRandomLoads()||typeof repositoryRenderInFlight!=='undefined'&&repositoryRenderInFlight||typeof loopStoreRenderInFlight!=='undefined'&&loopStoreRenderInFlight||typeof editablePatternImportInFlight!=='undefined'&&editablePatternImportInFlight||typeof isOutputRecording!=='undefined'&&(isOutputRecording||isOutputRecordingArmed))throw Error('Finish the current recording, render, loading, AI or Song operation first.');root.mygrainSongBetaAdapter?.assertNotRecording();}
function dialog({title,description,name,action,signal}){
 if(document.getElementById('partsBinDialog')||signal.aborted)return Promise.resolve(null);
 const d=node('dialog','parts-bin-dialog');d.id='partsBinDialog';d.setAttribute('aria-labelledby','partsBinDialogTitle');const h=node('h3','',title);h.id='partsBinDialogTitle';const p=node('p','',description),form=node('form'),row=node('div','parts-bin-dialog-actions'),cancel=node('button','','Cancel'),accept=node('button','',action);cancel.type='button';accept.type='submit';accept.dataset.partsAccept='';let input=null;
 if(name!==undefined){const label=node('label','','Part name');input=node('input');input.type='text';input.id='partsBinName';input.maxLength=80;input.required=true;input.autocomplete='off';input.value=name;label.htmlFor=input.id;form.append(label,input);}
 row.append(cancel,accept);form.append(row);d.append(h,p,form);document.body.append(d);const previous=document.activeElement;
 return new Promise(resolve=>{let done=false;const finish=value=>{if(done)return;done=true;signal.removeEventListener('abort',abort);if(d.open)d.close();d.remove();previous?.isConnected&&previous.focus({preventScroll:true});resolve(value);};const abort=()=>finish(null);cancel.onclick=abort;d.oncancel=e=>{e.preventDefault();abort();};d.onclose=abort;form.onsubmit=e=>{e.preventDefault();if(input&&!input.value.trim()){input.setCustomValidity('Enter a part name.');input.reportValidity();return;}finish(input?input.value.trim():true);};input?.addEventListener('input',()=>input.setCustomValidity(''));signal.addEventListener('abort',abort,{once:true});d.showModal();cancel.focus();});
}
function preview(part){if(busy||!available(session))return;const audio=card.querySelector('audio');if(previewId!==part.id){stopPreview();previewUrl=URL.createObjectURL(new Blob([part.preview],{type:'audio/wav'}));previewId=part.id;audio.src=previewUrl;card.querySelector('#partsBinPreviewName').textContent=part.name;}audio.play().catch(e=>say('Preview could not play: '+e.message,true));sync();}
function sync(){
 if(!card)return;const active=current();if(active!==session){operation?.abort();stopPreview();session=active;renderKey='';say(active?'Connected to this plugin session.':'Open MYGRAIN in the plugin, or connect Bridge / FX, to use this bin.');}
 const parts=session?.partsBin.parts||[],key=(session?.generation??-1)+':'+(session?.partsBin.version??0)+':'+parts.map(p=>p.id).join(',');
 if(key!==renderKey){renderKey=key;const list=card.querySelector('#partsBinList');list.replaceChildren();for(const part of parts){const row=node('li','parts-bin-part');row.dataset.partId=part.id;const copy=node('div','parts-bin-part-copy'),name=node('strong','',part.name),meta=node('small','',part.bpm+' BPM · '+part.bars+' bars · '+bytes(part.zip.byteLength+part.preview.byteLength));copy.append(name,meta);const actions=node('div','parts-bin-part-actions');for(const [label,fn]of [['Preview',()=>preview(part)],['Load',()=>run('load',part)],['Delete',()=>run('delete',part)]]){const b=node('button','performance-btn',label);b.type='button';b.dataset.partsAction=label.toLowerCase();b.setAttribute('aria-label',label+' '+part.name);b.onclick=fn;actions.append(b);}row.append(copy,actions);list.append(row);}}
 const ready=available(session)&&!busy,setDisabled=(e,value)=>{if(e.disabled!==value)e.disabled=value;};
 setDisabled(card.querySelector('#partsBinAdd'),!ready||parts.length>=MAX_PARTS);
 setDisabled(card.querySelector('#partsBinStore'),!ready||session.partsBin.storedVersion===session.partsBin.version);
 for(const b of card.querySelectorAll('[data-parts-action]'))setDisabled(b,!ready);
 card.querySelector('#partsBinEmpty').hidden=parts.length>0;
 const summary=card.querySelector('#partsBinSummary');const text=parts.length+' / '+MAX_PARTS+' parts · '+bytes(total(parts))+' / 96 MiB';if(summary.textContent!==text)summary.textContent=text;
 const storage=card.querySelector('#partsBinStorage');const message=!session?'Plugin-only storage · no browser library':!session.ready?'Waiting for plugin snapshot recall…':session.storing?'Storing patch and Parts Bin in plugin…':session.partsBin.version!==session.partsBin.storedVersion?'Changes not yet stored in plugin · use Store bin to retry':parts.length?'Stored in this plugin · save your DAW project to keep it on disk':'This plugin’s bin is empty';if(storage.textContent!==message)storage.textContent=message;
}
async function run(kind,part){
 if(busy)return;const s=current();try{check(s);conflicts();}catch(e){say(e.message,true);return;}
 busy=true;const token=operation=new AbortController();token.generation=s.generation;token.account=root.mygrainAccounts.user?.username;s.partsBusy=true;s.update();sync();let renderStarted=false;
 try{
  if(kind==='add'){
   const name=await dialog({title:'Add to The Parts Bin',description:'Keep the current editable patch, its original sounds and a rendered preview in this plugin session. Save the DAW project afterwards. Nothing is uploaded to the browser library.',name:'Part '+(s.partsBin.parts.length+1),action:'Render & add',signal:token.signal});if(name===null)return;
   guard(s,token);conflicts();if(s.partsBin.parts.length>=MAX_PARTS)throw Error('The bin is full. Delete a part first.');
   say('Capturing editable patch and original sounds…');stopPreview();const adapter=root.mygrainSongBetaAdapter;await adapter.ready();guard(s,token);conflicts();const captured=await adapter.capture();guard(s,token);
   const stable=()=>{const state=saveState({force:true,snapshotOnly:true});delete state.timestamp;return JSON.stringify(state);};const before=stable(),mutation=sourceMutationSerial;
   const zip=await captured.arrayBuffer();if(zip.byteLength+total(s.partsBin.parts)>LIMIT)throw Error('This part would exceed the 96 MiB bin limit. The existing bin is unchanged.');
   const info=adapter.inspectPart(zip),steps=Number(info.snapshot.state.patternLength)*(info.snapshot.extra.patternCycleMultiplier||1);
   const renderBytes=Math.ceil(steps/16*240/Number(document.getElementById('globalBpmSlider').value)*audioContext.sampleRate)*6+44;if(renderBytes+zip.byteLength+total(s.partsBin.parts)>LIMIT)throw Error('The full-pattern preview would exceed the 96 MiB bin limit. Shorten this patch before adding it.');
   say('Rendering preview · keep this patch unchanged until complete…');renderStarted=true;
   const result=await renderDawReadyBarsExport({exportSteps:steps,loopWarmupCycles:1,signal:token.signal}),preview=await result.blob.arrayBuffer();guard(s,token);if(sourceMutationSerial!==mutation||stable()!==before)throw Error('The current patch changed during capture. Existing parts were kept; add this patch again.');
   if(total(s.partsBin.parts)+zip.byteLength+preview.byteLength>LIMIT)throw Error('The patch and render exceed the 96 MiB bin limit. The existing bin is unchanged.');
   const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
   s.partsBin.parts=[...s.partsBin.parts,{id,name,createdAt:new Date().toISOString(),bpm:result.bpm,bars:result.bars,zip,preview}];s.partsBin.version++;say('Part captured. Storing in plugin…');
  }else if(kind==='delete'){
   const yes=await dialog({title:'Delete part?',description:'Delete “'+part.name+'” from this plugin’s bin? The current loaded patch is not changed. Save the DAW project afterwards to retain this deletion.',action:'Delete part',signal:token.signal});if(!yes)return;guard(s,token);if(previewId===part.id)stopPreview();s.partsBin.parts=s.partsBin.parts.filter(p=>p.id!==part.id);s.partsBin.version++;
  }else if(kind==='load'){
   const yes=await dialog({title:'Load part into plugin?',description:'Replace the current editable patch with “'+part.name+'”? The rest of the bin is kept. Playback stops; Undo can restore the previous patch. Bridge switches to Live so it plays the loaded part.',action:'Load part',signal:token.signal});if(!yes)return;guard(s,token);conflicts();stopPreview();say('Decoding part and original sounds…');const adapter=root.mygrainSongBetaAdapter;await adapter.ready();guard(s,token);const decoded=await adapter.decode(part.zip,{buffers:new Map(),bytes:0,limitBytes:256*1048576});guard(s,token);conflicts();
   await root.mygrainCardHistory.run('Load from The Parts Bin',()=>adapter.recall(decoded,{start:false,persist:false}));
   await Promise.all([root.mygrainResonator?.whenReady(),root.mygrainAcousticFx?.whenReady(),root.mygrainWasp?.whenReady(),root.mygrainCookingPot?.whenReady(),root.mygrainMasterBaker?.whenReady(),root.mygrainTurntable?.whenReady()]);guard(s,token);
   if(s.options.kind==='bridge'&&root.mygrainDawBridge?.diagnostics().mode==='rendered'){root.mygrainDawBridge.selectMode('live');const end=performance.now()+15000;while(root.mygrainDawBridge.diagnostics().busy){guard(s,token);if(performance.now()>end)throw Error('Patch loaded; plugin is still switching to Live. Wait, then Store bin.');await new Promise(r=>setTimeout(r,50));}}
   s.partsBin.version++;
  }
  guard(s,token);s.partsBusy=false;s.nextAt=Date.now();say('Storing current patch and Parts Bin in plugin…');sync();const stored=await s.storeAndWait();guard(s,token);
  if(!stored)throw Error('Not stored yet. '+s.label.textContent+' Use Store bin to retry.');
  say((kind==='add'?'Part added':kind==='delete'?'Part deleted':kind==='load'?'Part loaded into plugin · playback stopped':'Bin stored')+' · save your DAW project normally.');
 }catch(e){if(!token.signal.aborted)say(e.message,true);}
 finally{if(renderStarted)await restoreAudioAfterRepositoryRender();if(operation===token){operation=null;busy=false;s.partsBusy=false;s.update();sync();}}
}
// Validate the project extension separately: ordinary Song/patch ZIP admission stays strict.
async function unpackProject(zip){
 const entries=parseStoredZipEntries(zip),manifestBytes=entries.get('parts-bin.json');
 if(!manifestBytes){if([...entries.keys()].some(p=>p.startsWith('parts-bin/')))throw Error('Parts Bin manifest is missing.');return {zip,parts:[]};}
 if(manifestBytes.byteLength>65536)throw Error('Parts Bin manifest is too large.');
 const m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));if(m.format!=='mygrain-parts-bin'||m.version!==1||!Array.isArray(m.parts)||m.parts.length>MAX_PARTS)throw Error('Invalid saved Parts Bin.');
 // Check every local entry CRC and duplicate name before detaching the extension.
 const v=new DataView(zip);let at=0;const seen=new Set();while(at+30<=zip.byteLength&&v.getUint32(at,true)===0x04034b50){const n=v.getUint16(at+26,true),name=new TextDecoder().decode(new Uint8Array(zip,at+30,n)),start=at+30+n+v.getUint16(at+28,true),size=v.getUint32(at+18,true);if(start+size>zip.byteLength||seen.has(name)||(v.getUint16(at+6,true)&9)||crc32(new Uint8Array(zip,start,size))!==v.getUint32(at+14,true))throw Error('Corrupt or duplicate project archive entry.');seen.add(name);at=start+size;}
 const allowed=new Set(['parts-bin.json']),ids=new Set(),parts=[];let size=0;
 for(const p of m.parts){
  if(!/^[a-f0-9]{32}$/.test(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>80||typeof p.createdAt!=='string'||!Number.isFinite(Date.parse(p.createdAt))||!Number.isFinite(p.bpm)||p.bpm<1||p.bpm>300||!Number.isFinite(p.bars)||p.bars<=0||p.bars>1024||p.patch!=='parts-bin/'+p.id+'.zip'||p.render!=='parts-bin/'+p.id+'.wav')throw Error('Invalid saved part metadata.');
  ids.add(p.id);allowed.add(p.patch);allowed.add(p.render);const a=entries.get(p.patch),b=entries.get(p.render);if(!a||!b)throw Error('A saved part is missing its patch or preview.');size+=a.byteLength+b.byteLength;if(size>LIMIT)throw Error('Saved Parts Bin exceeds 96 MiB.');
  const source=a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength);root.mygrainSongBetaAdapter.inspectPart(source);
  const w=new DataView(b.buffer,b.byteOffset,b.byteLength);if(b.byteLength<44||w.getUint32(0,false)!==0x52494646||w.getUint32(8,false)!==0x57415645||w.getUint32(4,true)+8!==b.byteLength)throw Error('A saved preview WAV is incomplete.');
  parts.push({id:p.id,name:p.name,createdAt:p.createdAt,bpm:p.bpm,bars:p.bars,zip:source,preview:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)});
 }
 for(const path of entries.keys())if(path.startsWith('parts-bin/')&&!allowed.has(path))throw Error('Unlisted Parts Bin asset.');
 const main=await createStoredZip([...entries].filter(([path])=>!allowed.has(path)).map(([path,data])=>({path,data})));return {zip:await main.arrayBuffer(),parts};
}
function mount(){
 if(root.__mygrainSongRenderDeck)return;const shell=document.querySelector('.synth-container');if(!shell)return;card=node('section','parts-bin-card');card.id='partsBinCard';card.setAttribute('aria-label','The Parts Bin');card.innerHTML='<header class="parts-bin-header">'+icon+'<h3>The Parts Bin</h3></header><p class="parts-bin-help"><strong>For your DAW plugin session — not a browser library.</strong> This plugin stores the bin, including each editable patch, its original sounds and a rendered preview, inside its DAW patch save. Store changes in the plugin, then <strong>save your DAW project normally</strong> to keep them on disk. Reopening that saved plugin restores the bin. Nothing is uploaded to WAV Browser or Loop Store.</p><div class="parts-bin-toolbar"><button type="button" class="performance-btn" id="partsBinAdd">Add current patch</button><button type="button" class="performance-btn" id="partsBinStore">Store bin in plugin</button><span id="partsBinSummary"></span></div><p id="partsBinStorage" class="parts-bin-storage"></p><p id="partsBinStatus" role="status" aria-live="polite"></p><div class="parts-bin-preview"><label id="partsBinPreviewName" for="partsBinAudio">Choose a part to preview</label><audio id="partsBinAudio" controls preload="none" aria-labelledby="partsBinPreviewName"></audio></div><p id="partsBinEmpty">No parts yet. Add a patch you may want to use later in this song.</p><ul id="partsBinList" aria-label="Saved parts"></ul>';
 shell.append(card);const grid=document.querySelector('#sectionJumpPanel .section-jump-grid');if(grid){const b=node('button','section-jump-option');b.id='sectionJumpPartsBinBtn';b.type='button';b.dataset.jumpTarget='#partsBinCard';b.innerHTML=icon+'<span>The Parts Bin</span>';b.onclick=()=>root.mygrainJumpToButton(b);const pot=grid.querySelector('#sectionJumpCookingPotBtn');if(pot)pot.after(b);else grid.append(b);}
 card.querySelector('#partsBinAdd').onclick=()=>run('add');card.querySelector('#partsBinStore').onclick=()=>run('store');card.querySelector('audio').onerror=()=>{if(previewUrl)say('This preview could not be decoded. The saved editable part is unchanged.',true);};root.mygrainNavigation?.refresh(card);sync();
}
root.mygrainPartsBin={sync,unpackProject,get busy(){return busy;},diagnostics:()=>({connected:!!session,parts:session?.partsBin.parts.map(({zip,preview,...p})=>({...p,zipBytes:zip.byteLength,previewBytes:preview.byteLength}))||[],bytes:total(session?.partsBin.parts||[]),dirty:!!session&&session.partsBin.version!==session.partsBin.storedVersion,busy,previewId})};
for(const name of ['mygrain-account-lock','mygrain-account-changed','pagehide'])root.addEventListener(name,()=>{locked=true;operation?.abort();stopPreview();for(const s of root.mygrainProjectSessions||[])s.partsBin={parts:[],version:0,storedVersion:0};renderKey='';sync();});
root.addEventListener('load',mount,{once:true});
})(window);
