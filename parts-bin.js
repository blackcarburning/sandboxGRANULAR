/* Browser staging + plugin bins; explicit account-private universal snapshots. Never in Songs. */
(function(root){
'use strict';
// Bound working allocations by the existing universal account quota, not a separate bin cap.
const STORAGE_QUOTA=512*1048576,ARCHIVE_RESERVE=131072,LIMIT=STORAGE_QUOTA-ARCHIVE_RESERVE,MAX_PARTS=32;
const icon='<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M8 25h48l-5 30H13zM8 25l8-9h32l8 9M24 36h16v8H24z"/><path d="m19 16-3-7 12-4 4 11m6 0 5-10 10 5-3 7M12 55h40"/></svg>';
let card=null,session=null,busy=false,locked=false,operation=null,renderKey='',previewUrl=null,previewId=null;
let universal=[],libraryOwner=null,previewRendering=false,opened=null;
const contentKey=parts=>JSON.stringify(parts.map(({id,name,createdAt,bpm,bars,zip,preview})=>[id,name,createdAt,bpm,bars,zip.byteLength,preview.byteLength]));
const universalDirty=()=>!!session&&(opened?contentKey(session.partsBin.parts)!==opened.signature:session.partsBin.parts.length>0);
const digest=async buffer=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),n=>n.toString(16).padStart(2,'0')).join('');
const identity=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const bytes=n=>(n/1048576).toFixed(1)+' MiB';
const workspace={browser:true,generation:0,partsBin:{parts:[],version:0,storedVersion:0},partsBusy:false,update:()=>sync()};
const current=()=>locked?null:([...(root.mygrainProjectSessions||[])].find(s=>s.worker&&s.supported)||(root.mygrainAccounts?.authenticated?workspace:null));
const total=parts=>parts.reduce((n,p)=>n+p.zip.byteLength+p.preview.byteLength,0);
function say(text,error=false){const e=card?.querySelector('#partsBinStatus');if(e){e.textContent=text;e.dataset.error=String(error);}}
function stopPreview(){const audio=card?.querySelector('audio');if(audio){audio.pause();audio.removeAttribute('src');audio.load();}if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;previewId=null;if(card)card.querySelector('#partsBinPreviewName').textContent='Choose a part to preview';}
function available(s){return !!(!locked&&root.mygrainAccounts?.authenticated&&s&&(s.browser||s.worker&&s.supported&&s.ready&&!s.busy&&!s.storing&&!s.options.blocked())&&!s.partsBusy);}
function check(s){if(!available(s)||current()!==s)throw Error('Sign in and wait for the bin or connected plugin to finish its current operation.');}
function guard(s,token){token.signal.throwIfAborted();if(locked||current()!==s||!s.browser&&!s.worker||!root.mygrainAccounts?.authenticated||token.generation!==s.generation||token.account!==root.mygrainAccounts.user?.username)throw Error('The bin, plugin connection or account changed. No new part was committed.');}
function conflicts(){if(root.mygrainSongBeta?.busy||root.mygrainSongBeta?.playing||root.mygrainSongBeta?.editing||root.mygrainCardHistory?.busy||root.mygrainAiPatch?.busy||typeof megaRandomizeInFlight!=='undefined'&&megaRandomizeInFlight||typeof hasPendingMegaRandomLoads==='function'&&hasPendingMegaRandomLoads()||typeof repositoryRenderInFlight!=='undefined'&&repositoryRenderInFlight||typeof loopStoreRenderInFlight!=='undefined'&&loopStoreRenderInFlight||typeof editablePatternImportInFlight!=='undefined'&&editablePatternImportInFlight||typeof isOutputRecording!=='undefined'&&(isOutputRecording||isOutputRecordingArmed))throw Error('Finish the current recording, render, loading, AI or Song operation first.');root.mygrainSongBetaAdapter?.assertNotRecording();}
function dialog({title,description,name,action,signal,label='Part name',options,selected,choices,cancelLabel='Cancel'}){
 if(document.getElementById('partsBinDialog')||signal.aborted)return Promise.resolve(null);
 const d=node('dialog','parts-bin-dialog');d.id='partsBinDialog';d.setAttribute('aria-labelledby','partsBinDialogTitle');const h=node('h3','',title);h.id='partsBinDialogTitle';const p=node('p','',description),form=node('form'),row=node('div','parts-bin-dialog-actions'),cancel=node('button','',cancelLabel),accept=node('button','',action);cancel.type='button';accept.type='submit';accept.dataset.partsAccept='';let input=null,select=null;
 if(options){const field=node('label','','Destination');select=node('select');select.id='partsBinDestination';field.htmlFor=select.id;for(const option of options){const o=node('option','',option.label);o.value=option.value;select.append(o);}select.value=selected||options[0].value;form.append(field,select);}
 if(name!==undefined){const field=node('label','',label);input=node('input');input.type='text';input.id='partsBinName';input.maxLength=80;input.required=true;input.autocomplete='off';input.value=name;field.htmlFor=input.id;form.append(field,input);}
 const updateName=()=>{if(input&&options){input.hidden=select.value!=='new';form.querySelector('label[for=partsBinName]').hidden=input.hidden;input.required=!input.hidden;}};select?.addEventListener('change',updateName);updateName();
 row.append(cancel);for(const choice of choices||[]){const b=node('button','',choice.label);b.type='button';b.dataset.partsChoice=choice.value;row.append(b);}row.append(accept);form.append(row);d.append(h,p,form);document.body.append(d);const previous=document.activeElement;
 return new Promise(resolve=>{let done=false;const finish=value=>{if(done)return;done=true;signal.removeEventListener('abort',abort);if(d.open)d.close();d.remove();previous?.isConnected&&previous.focus({preventScroll:true});resolve(value);};const abort=()=>finish(null);cancel.onclick=abort;for(const b of row.querySelectorAll('[data-parts-choice]'))b.onclick=()=>finish(b.dataset.partsChoice);d.oncancel=e=>{e.preventDefault();abort();};d.onclose=abort;form.onsubmit=e=>{e.preventDefault();if(input&&!input.hidden&&!input.value.trim()){input.setCustomValidity('Enter a part name.');input.reportValidity();return;}finish(options?{destination:select.value,name:input?.value.trim()}:input?input.value.trim():true);};input?.addEventListener('input',()=>input.setCustomValidity(''));signal.addEventListener('abort',abort,{once:true});d.showModal();cancel.focus();});
}
function preview(part){if(busy||!available(session))return;const audio=card.querySelector('audio');if(previewId!==part.id){stopPreview();previewUrl=URL.createObjectURL(new Blob([part.preview],{type:'audio/wav'}));previewId=part.id;audio.src=previewUrl;card.querySelector('#partsBinPreviewName').textContent=part.name;}audio.play().catch(e=>say('Preview could not play: '+e.message,true));sync();}
async function downloadPart(part){
 try{
  check(session);
  const filename=(part.name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/[. ]+$/g,'')||'mygrain-part').replace(/\.wav$/i,'')+'.wav';
  await downloadBlob(new Blob([part.preview],{type:'audio/wav'}),filename);
  say('WAV download requested · check Downloads.');
 }catch(e){say('WAV download failed: '+e.message,true);}
}
function sync(){
 if(!card)return;const active=current();document.documentElement.toggleAttribute('data-mygrain-parts-connected',!!active&&!active.browser);if(active!==session){operation?.abort();stopPreview();session=active;opened=null;renderKey='';libraryOwner=null;universal=[];renderUniversal();say(active?.browser?'Browser workspace · upload patches, then make the bin available universally for Cubase.':active?'Connected to this plugin session.':'Sign in to use The Parts Bin.');}
 if(opened&&opened.generation!==session?.generation){opened=null;renderUniversal();}
 const parts=session?.partsBin.parts||[],key=(session?.generation??-1)+':'+(session?.partsBin.version??0)+':'+parts.map(p=>p.id).join(',');
 if(key!==renderKey){renderKey=key;const list=card.querySelector('#partsBinList');list.replaceChildren();for(const part of parts){const row=node('li','parts-bin-part');row.dataset.partId=part.id;const copy=node('div','parts-bin-part-copy'),name=node('strong','',part.name),meta=node('small','',part.bpm+' BPM · '+part.bars+' bars · '+bytes(part.zip.byteLength+part.preview.byteLength));copy.append(name,meta);const actions=node('div','parts-bin-part-actions');for(const [label,fn]of [['Preview',()=>preview(part)],['Download WAV',()=>downloadPart(part)],['Load',()=>run('load',part)],['Copy to bin…',()=>run('copy',part)],['Move to bin…',()=>run('move',part)],['Delete',()=>run('delete',part)]]){const b=node('button','performance-btn',label);b.type='button';b.dataset.partsAction=label.startsWith('Copy')?'copy':label.startsWith('Move')?'move':label.toLowerCase();b.setAttribute('aria-label',label+' '+part.name);b.onclick=fn;actions.append(b);}row.append(copy,actions);list.append(row);}}
 const ready=available(session)&&!busy,setDisabled=(e,value)=>{if(e.disabled!==value)e.disabled=value;};
 setDisabled(card.querySelector('#partsBinAdd'),!ready||parts.length>=MAX_PARTS);
 setDisabled(card.querySelector('#partsBinUpload'),!ready||parts.length>=MAX_PARTS);
 card.querySelector('#partsBinDrop').setAttribute('aria-disabled',String(!ready||parts.length>=MAX_PARTS));
 card.querySelector('#partsBinStore').hidden=!session||!!session.browser;
 setDisabled(card.querySelector('#partsBinStore'),!ready||session.partsBin.storedVersion===session.partsBin.version);
 setDisabled(card.querySelector('#partsBinUniversalSave'),!ready||(!parts.length&&!opened));
 setDisabled(card.querySelector('#partsBinNew'),!ready);
 const title=card.querySelector('#partsBinOpenName'),dirty=universalDirty();title.textContent=opened?'Open bin: '+opened.name:session?.browser?'Open bin: Unsaved browser bin':'Open bin: Project / working bin';
 card.querySelector('#partsBinOpenState').textContent=opened?.deleted?'Server bin deleted elsewhere — save as a new bin.':opened?(dirty?'Unsaved changes — save to update this universal bin.':'Saved universal copy — edits need Save to universal bin.'):(parts.length?'Not saved universally — choose an existing bin or create one.':'Upload patches or add the current patch to begin.');
 card.querySelector('#partsBinOpen').dataset.dirty=String(dirty||!!opened?.deleted);
 setDisabled(card.querySelector('#partsBinUniversalRefresh'),!ready);
 for(const b of card.querySelectorAll('[data-parts-action]'))setDisabled(b,!ready);
 card.querySelector('#partsBinEmpty').hidden=parts.length>0;
 const summary=card.querySelector('#partsBinSummary');const text=parts.length+' / '+MAX_PARTS+' parts · '+bytes(total(parts));if(summary.textContent!==text)summary.textContent=text;
 const storage=card.querySelector('#partsBinStorage');const message=!session?'Sign in to stage patches and access your private universal bins.':session.browser?(parts.length?(universalDirty()?'Browser staging only · changes not saved universally. Use Save to universal bin before closing this tab.':'Server copy saved · available in CEF / Cubase. Save again after editing.'):'Browser workspace is empty · upload complete patch ZIPs or add the current patch.'):!session.ready?'Waiting for plugin snapshot recall…':session.storing?'Storing patch and Parts Bin in plugin…':session.partsBin.version!==session.partsBin.storedVersion?'Changes not yet stored in plugin · use Store bin to retry':parts.length?'Stored in this plugin · save your DAW project to keep it on disk':'This plugin’s bin is empty';if(storage.textContent!==message)storage.textContent=message;
 if(ready&&libraryOwner!==session){libraryOwner=session;queueMicrotask(()=>{if(!busy&&current()===libraryOwner)void run('universal-refresh');});}
}
function renderUniversal(){
 if(!card)return;const list=card.querySelector('#partsBinUniversalList');list.replaceChildren();
 for(const bin of universal){const row=node('li','parts-bin-part');row.dataset.binId=bin.id;row.dataset.open=String(bin.id===opened?.id);const copy=node('div','parts-bin-part-copy');copy.append(node('strong','',bin.name+(bin.id===opened?.id?' · OPEN NOW':'')),node('small','',bin.parts+' parts · '+bytes(bin.bytes)));const actions=node('div','parts-bin-part-actions');for(const [title,kind]of [['Open a copy','open'],['Rename','rename'],['Delete','delete']]){const b=node('button','performance-btn',title);b.type='button';b.dataset.partsAction='universal-'+kind;b.setAttribute('aria-label',title+' '+bin.name);b.onclick=()=>run('universal-'+kind,bin);actions.append(b);}row.append(copy,actions);list.append(row);}
 card.querySelector('#partsBinUniversalEmpty').hidden=universal.length>0;
}
async function request(path,token,options={}){
 const response=await root.fetch('/mygrain/api/plugin-library/bins'+path,{cache:'no-store',...options,signal:token.signal});
 if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'Universal bin request failed ('+response.status+').');}
 return response;
}
async function refreshUniversal(s,token){const data=await(await request('',token)).json();guard(s,token);universal=data.bins;if(opened){const found=universal.find(b=>b.id===opened.id);opened.deleted=!found;if(found)opened.name=found.name;}renderUniversal();}
async function packParts(parts){
 const entries=[],manifest={format:'mygrain-parts-bin',version:1,parts:parts.map(({zip,preview,...p})=>{const patch='parts-bin/'+p.id+'.zip',render='parts-bin/'+p.id+'.wav';entries.push({path:patch,data:zip},{path:render,data:preview});return {...p,patch,render};})};
 entries.unshift({path:'parts-bin.json',data:JSON.stringify(manifest)});return createStoredZip(entries);
}
function linkBin(result,parts){opened={generation:session.generation,id:result.id,name:result.name,revision:result.revision,signature:contentKey(parts),ids:new Map(parts.map(p=>[p.id,p.id]))};renderUniversal();}
function destinations({includeUpdate=false,exclude=null}={}){
 const options=[];if(includeUpdate&&opened&&!opened.deleted)options.push({value:'update:'+opened.id,label:'Save changes to “'+opened.name+'” (open bin)'});
 options.push({value:'new',label:'Create a new universal bin'});
 for(const bin of universal)if(bin.id!==exclude&&(!includeUpdate||bin.id!==opened?.id))options.push({value:'append:'+bin.id,label:'Add to “'+bin.name+'” ('+bin.parts+' parts)'});
 return options;
}
async function saveUniversal(s,token,parts=s.partsBin.parts,afterAdd=false){
 await refreshUniversal(s,token);guard(s,token);
 const choice=await dialog({title:afterAdd?'Save added patches to a universal bin?':'Save to universal bin',description:afterAdd?'Keep these patches for other Cubase projects now, or choose Not now to keep them in this working bin. Existing destination bins keep all their other parts.':'Update the open bin, add these parts to another bin without replacing its contents, or create a new bin. Nothing changes until you save.',name:'My bin',label:'New bin name',options:destinations({includeUpdate:true}),action:'Save universal bin',cancelLabel:afterAdd?'Not now':'Cancel',signal:token.signal});
 if(choice===null)return false;guard(s,token);conflicts();
 const updating=choice.destination.startsWith('update:'),creating=choice.destination==='new',saved=updating?s.partsBin.parts:parts;
 if(!saved.length&&!updating&&!creating)throw Error('There are no parts to add.');
 const archive=await packParts(saved);guard(s,token);
 const path=creating?'?name='+encodeURIComponent(choice.name):'/'+choice.destination.split(':')[1]+(updating?'/replace':'/append');
 const result=await(await request(path,token,{method:'POST',headers:{'Content-Type':'application/zip',...(updating?{'If-Match':'"'+opened.revision+'"'}:{})},body:archive})).json();guard(s,token);
 if(updating||creating&&contentKey(saved)===contentKey(s.partsBin.parts))linkBin(result,s.partsBin.parts);
 if(s.browser&&opened&&!universalDirty())s.partsBin.storedVersion=s.partsBin.version;
 await refreshUniversal(s,token);say((creating?'Created “':updating?'Saved changes to “':'Added patches to “')+result.name+'” · saved universally for your account.');return true;
}
async function transferPart(kind,part,s,token){
 await refreshUniversal(s,token);guard(s,token);
 const choice=await dialog({title:(kind==='move'?'Move':'Copy')+' “'+part.name+'” to a bin',description:kind==='move'?'The destination is saved first. This part is then removed from the working bin and, if already saved there, from the open universal bin. Other parts and the loaded patch stay unchanged.':'Save an exact copy, including original sounds and preview. The source part and loaded patch stay unchanged.',name:'My bin',label:'New bin name',options:destinations({exclude:opened?.id}),action:kind==='move'?'Move part':'Copy part',signal:token.signal});
 if(choice===null)return false;guard(s,token);conflicts();
 const creating=choice.destination==='new';let path=creating?'?name='+encodeURIComponent(choice.name):'/'+choice.destination.split(':')[1]+'/append';
 const remoteId=kind==='move'&&opened&&!opened.deleted?opened.ids.get(part.id):null;
 if(remoteId){const q=new URLSearchParams({moveFrom:opened.id,revision:opened.revision,part:remoteId});path+=(creating?'&':'?')+q;}
 const archive=await packParts([part]);guard(s,token);const result=await(await request(path,token,{method:'POST',headers:{'Content-Type':'application/zip'},body:archive})).json();guard(s,token);
 if(kind==='move'){
  const wasDirty=universalDirty();if(previewId===part.id)stopPreview();s.partsBin.parts=s.partsBin.parts.filter(p=>p.id!==part.id);s.partsBin.version++;
  if(remoteId){opened.ids.delete(part.id);opened.revision=result.sourceRevision;if(!wasDirty)opened.signature=contentKey(s.partsBin.parts);}
 }
 await refreshUniversal(s,token);say('“'+part.name+'” '+(kind==='move'?'moved':'copied')+' to “'+result.name+'” · destination saved universally.');return kind==='move';
}
async function beforeReplacing(s,token){
 if(!universalDirty())return true;
 const choice=await dialog({title:'Save your working bin first?',description:'This working bin has changes that are not saved universally. Save them before switching bins, or explicitly discard the working changes. Your loaded patch is not replaced.',action:'Save first…',choices:[{value:'discard',label:'Discard working changes'}],signal:token.signal});
 if(choice===null)return false;if(choice==='discard')return true;return saveUniversal(s,token);
}
async function universalAction(kind,bin,s,token){
 if(kind==='universal-refresh'){await refreshUniversal(s,token);say('Universal bins refreshed · private to your account · available in FX and instrument instances.');return false;}
 if(kind==='universal-save'){await saveUniversal(s,token);return false;}
 if(kind==='universal-rename'){
  const name=await dialog({title:'Rename universal bin',description:'Rename this server-saved bin for all your instances. Copies already stored in DAW projects are unchanged.',label:'Bin name',name:bin.name,action:'Rename bin',signal:token.signal});if(name===null)return false;guard(s,token);
  await(await request('/'+bin.id+'/rename',token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})})).json();guard(s,token);await refreshUniversal(s,token);say('Universal bin renamed.');return false;
 }
 if(kind==='universal-delete'){
  if(!await dialog({title:'Delete universal bin?',description:'Delete “'+bin.name+'” and its server-stored assets? Copies already in plugins and saved DAW projects are kept.',action:'Delete server bin',signal:token.signal}))return false;guard(s,token);
  await(await request('/'+bin.id,token,{method:'DELETE'})).json();guard(s,token);await refreshUniversal(s,token);say('Universal bin deleted · local copies kept.');return false;
 }
 if(kind==='universal-open'){
  if(!await beforeReplacing(s,token))return false;
  if(!await dialog({title:'Open “'+bin.name+'”?',description:'Open this universal bin in the '+(s.browser?'browser workspace':'plugin')+'. The bin name will appear above the parts. Your loaded patch stays unchanged; use Load on a part to change it.',action:'Open bin',signal:token.signal}))return false;guard(s,token);stopPreview();say('Downloading and checking bin…');
  const response=await request('/'+bin.id,token),size=Number(response.headers.get('Content-Length'));if(size>STORAGE_QUOTA)throw Error('This bin exceeds the 512 MiB universal storage quota for your account.');const data=await response.arrayBuffer();guard(s,token);if(data.byteLength>STORAGE_QUOTA)throw Error('This bin exceeds the 512 MiB universal storage quota for your account.');const decoded=await unpackProject(data);guard(s,token);
  const copied=decoded.parts.map(p=>({...p,id:identity()}));s.partsBin.parts=copied;s.partsBin.version++;if(s.browser)s.partsBin.storedVersion=s.partsBin.version;
  opened={generation:s.generation,id:bin.id,name:bin.name,revision:await digest(data),signature:contentKey(copied),ids:new Map(copied.map((p,i)=>[p.id,decoded.parts[i].id]))};guard(s,token);renderUniversal();return true;
 }
 return false;
}
// Decode/render an isolated saved source, never recall uploads into the live editor.
async function renderSourcePreview(zip,s,token,occupied){
 const adapter=root.mygrainSongBetaAdapter,info=adapter.inspectPart(zip),bpm=Number(info.snapshot.state.globalBpm),steps=Number(info.snapshot.state.patternLength)*(info.snapshot.extra.patternCycleMultiplier||1);
 if(!Number.isFinite(bpm)||bpm<1||bpm>300||!Number.isFinite(steps)||steps<=0||steps>16384)throw Error('Invalid patch timing.');
 const frames=Math.round(steps/4*60/bpm*audioContext.sampleRate);
 if(zip.byteLength+frames*6+44+occupied>LIMIT)throw Error('The patch and full-pattern preview exceed the 512 MiB universal storage quota for your account. Existing parts were kept.');
 let decoded;previewRendering=true;configureBackgroundAudio()?.sync();
 try{
  if(!await ensureAudioReadyForKeyInteraction())throw Error('Resume MYGRAIN before rendering a preview.');guard(s,token);
  decoded=await adapter.decode(zip,{buffers:new Map(),bytes:0,limitBytes:256*1048576});guard(s,token);
  const rendered=await root.MygrainSongClock.render(audioContext,decoded,{bpm,patternSteps:Number(info.snapshot.state.patternLength),patternCycleMultiplier:info.snapshot.extra.patternCycleMultiplier||1,repeats:1},token.signal,{durationSeconds:frames*2/audioContext.sampleRate});guard(s,token);
  if(rendered.length!==frames*2)throw Error('Incomplete isolated preview. Existing parts were kept.');
  const buffer=audioContext.createBuffer(2,frames,rendered.sampleRate);
  for(let channel=0;channel<2;channel++)buffer.copyToChannel(rendered.getChannelData(channel).subarray(frames,frames*2),channel);
  return {bpm,bars:steps/16,preview:audioBufferToWav24bit(buffer)};
 }finally{decoded?.buffers?.clear();previewRendering=false;configureBackgroundAudio()?.sync();}
}
async function uploadPatches(files,s,token){
 files=Array.from(files||[]);if(!files.length)return false;
 if(files.length+s.partsBin.parts.length>MAX_PARTS)throw Error('The bin holds up to 32 parts. Existing parts were kept.');
 if(files.some(f=>!(/\.zip$/i.test(f.name))||!Number.isSafeInteger(f.size)||f.size<22))throw Error('Choose complete MYGRAIN patch ZIPs, including their original sounds. Load JSON recipes in the editor and use Add current patch.');
 if(files.reduce((n,f)=>n+f.size,0)+total(s.partsBin.parts)>LIMIT)throw Error('These patches exceed the 512 MiB universal storage quota for your account. Existing parts were kept.');
 const pending=[];for(const [index,file]of files.entries()){
  say('Checking patch '+(index+1)+' / '+files.length+' · '+file.name+'…');const zip=await file.arrayBuffer();guard(s,token);conflicts();
  const preview=await renderSourcePreview(zip,s,token,total(s.partsBin.parts)+total(pending));guard(s,token);conflicts();
  if(total(s.partsBin.parts)+total(pending)+zip.byteLength+preview.preview.byteLength>LIMIT)throw Error('The patches and previews exceed the 512 MiB universal storage quota for your account. Existing parts were kept.');
  pending.push({id:identity(),name:(file.name.replace(/\.zip$/i,'').replace(/[\x00-\x1f]/g,' ').trim()||'Uploaded patch').slice(0,80),createdAt:new Date().toISOString(),...preview,zip});
 }
 guard(s,token);s.partsBin.parts=[...s.partsBin.parts,...pending];s.partsBin.version++;return true;
}
async function run(kind,part){
 if(busy)return;const s=current();try{check(s);if(kind!=='universal-refresh')conflicts();}catch(e){say(e.message,true);return;}
 busy=true;const token=operation=new AbortController();token.generation=s.generation;token.account=root.mygrainAccounts.user?.username;s.partsBusy=true;s.update();sync();let renderStarted=false,added=[],nativeStoreError=null;const priorIds=new Set(s.partsBin.parts.map(p=>p.id));
 try{
  if(['add','upload','load','universal-open'].includes(kind)){if(!await ensureAudioReadyForKeyInteraction())throw Error('Start MYGRAIN before adding or loading patches.');guard(s,token);}
  if(kind==='upload'){if(!await uploadPatches(part,s,token))return;}
  else if(kind==='copy'||kind==='move'){if(!await transferPart(kind,part,s,token))return;}
  else if(kind==='new'){if(!await beforeReplacing(s,token))return;guard(s,token);stopPreview();s.partsBin.parts=[];s.partsBin.version++;opened=null;renderUniversal();}
  else if(kind.startsWith('universal-')){if(!await universalAction(kind,part,s,token))return;}
  else if(kind==='add'){
   const name=await dialog({title:'Add to The Parts Bin',description:'Keep the current editable patch, its original sounds and a rendered preview in this working bin. In a browser, use Make available universally before closing the tab. In a plugin, also save your DAW project.',name:'Part '+(s.partsBin.parts.length+1),action:'Render & add',signal:token.signal});if(name===null)return;
   guard(s,token);conflicts();if(s.partsBin.parts.length>=MAX_PARTS)throw Error('The bin is full. Delete a part first.');
   say('Capturing editable patch and original sounds…');stopPreview();const adapter=root.mygrainSongBetaAdapter;await adapter.ready();guard(s,token);conflicts();const captured=await adapter.capture();guard(s,token);
   const stable=()=>{const state=saveState({force:true,snapshotOnly:true});delete state.timestamp;return JSON.stringify(state);};const before=stable(),mutation=sourceMutationSerial;
   const zip=await captured.arrayBuffer();if(zip.byteLength+total(s.partsBin.parts)>LIMIT)throw Error('This part would exceed the 512 MiB universal storage quota for your account. The existing bin is unchanged.');
   const info=adapter.inspectPart(zip),steps=Number(info.snapshot.state.patternLength)*(info.snapshot.extra.patternCycleMultiplier||1);
   const renderBytes=Math.ceil(steps/16*240/getTransportClockBpm()*audioContext.sampleRate)*6+44;if(renderBytes+zip.byteLength+total(s.partsBin.parts)>LIMIT)throw Error('The full-pattern preview would exceed the 512 MiB universal storage quota for your account. Shorten this patch before adding it.');
   say('Rendering preview · keep this patch unchanged until complete…');let result;
   if(s.browser){const source=await renderSourcePreview(zip,s,token,total(s.partsBin.parts));result={bpm:source.bpm,bars:source.bars,blob:new Blob([source.preview],{type:'audio/wav'})};}
   else if(s.options.kind==='fx'){
    // The live FX graph intentionally mutes patch generators. Render an isolated
    // canonical copy, never unmute those generators into the DAW's FX return or
    // bake incoming track audio into a reusable bin preview.
    const decoded=await adapter.decode(zip,{buffers:new Map(),bytes:0,limitBytes:256*1048576});guard(s,token);
    const bpm=getTransportClockBpm(),frames=Math.round(steps/4*60/bpm*audioContext.sampleRate);
    const rendered=await root.MygrainSongClock.render(audioContext,decoded,{bpm,patternSteps:Number(info.snapshot.state.patternLength),patternCycleMultiplier:info.snapshot.extra.patternCycleMultiplier||1,repeats:1},token.signal,{durationSeconds:frames*2/audioContext.sampleRate});guard(s,token);
    if(rendered.length!==frames*2)throw Error('Incomplete isolated preview. Existing parts were kept.');
    const buffer=audioContext.createBuffer(2,frames,rendered.sampleRate);
    for(let channel=0;channel<2;channel++)buffer.copyToChannel(rendered.getChannelData(channel).subarray(frames,frames*2),channel);
    result={bpm,bars:steps/16,blob:new Blob([audioBufferToWav24bit(buffer)],{type:'audio/wav'})};
   }else{renderStarted=true;result=await renderDawReadyBarsExport({exportSteps:steps,loopWarmupCycles:1,signal:token.signal});}
   const preview=await result.blob.arrayBuffer();guard(s,token);if(sourceMutationSerial!==mutation||stable()!==before)throw Error('The current patch changed during capture. Existing parts were kept; add this patch again.');
   if(total(s.partsBin.parts)+zip.byteLength+preview.byteLength>LIMIT)throw Error('The patch and render exceed the 512 MiB universal storage quota for your account. The existing bin is unchanged.');
   const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
   s.partsBin.parts=[...s.partsBin.parts,{id,name,createdAt:new Date().toISOString(),bpm:result.bpm,bars:result.bars,zip,preview}];s.partsBin.version++;say('Part captured. Storing in plugin…');
  }else if(kind==='delete'){
   const yes=await dialog({title:'Delete part?',description:'Delete “'+part.name+'” from this working bin? The current loaded patch and saved universal copies are not changed.'+(s.browser?'':' Save the DAW project afterwards to retain this deletion.'),action:'Delete part',signal:token.signal});if(!yes)return;guard(s,token);if(previewId===part.id)stopPreview();s.partsBin.parts=s.partsBin.parts.filter(p=>p.id!==part.id);s.partsBin.version++;
  }else if(kind==='load'){
   const yes=await dialog({title:s.browser?'Load part into editor?':'Load part into plugin?',description:'Replace the current editable patch with “'+part.name+'”? The rest of the bin is kept. Playback stops; Undo can restore the previous patch.'+(s.browser?'':' Bridge switches to Live so it plays the loaded part.'),action:'Load part',signal:token.signal});if(!yes)return;guard(s,token);conflicts();stopPreview();say('Decoding part and original sounds…');const adapter=root.mygrainSongBetaAdapter;await adapter.ready();guard(s,token);const decoded=await adapter.decode(part.zip,{buffers:new Map(),bytes:0,limitBytes:256*1048576});guard(s,token);conflicts();
   await root.mygrainCardHistory.run('Load from The Parts Bin',()=>adapter.recall(decoded,{start:false,persist:!!s.browser}));
   await Promise.all([root.mygrainResonator?.whenReady(),root.mygrainAcousticFx?.whenReady(),root.mygrainWasp?.whenReady(),root.mygrainCookingPot?.whenReady(),root.mygrainMasterBaker?.whenReady(),root.mygrainTurntable?.whenReady()]);guard(s,token);
   if(!s.browser&&s.options.kind==='bridge'&&root.mygrainDawBridge?.diagnostics().mode==='rendered'){root.mygrainDawBridge.selectMode('live');const end=performance.now()+15000;while(root.mygrainDawBridge.diagnostics().busy){guard(s,token);if(performance.now()>end)throw Error('Patch loaded; plugin is still switching to Live. Wait, then Store bin.');await new Promise(r=>setTimeout(r,50));}}
   if(!s.browser)s.partsBin.version++;
  }
  guard(s,token);added=s.partsBin.parts.filter(p=>!priorIds.has(p.id));
  if(!s.browser){s.partsBusy=false;s.nextAt=Date.now();say('Storing current patch and Parts Bin in plugin…');sync();const stored=await s.storeAndWait();guard(s,token);if(!stored){nativeStoreError='Not stored in plugin. '+s.label.textContent+' Working parts are kept; use Save to universal bin to keep a server copy.';if(kind!=='add'&&kind!=='upload')throw Error(nativeStoreError);}}
  if(kind==='add'||kind==='upload'){
   say(nativeStoreError||('Patches added to the working bin'+(s.browser?'.':' · stored in plugin; save your DAW project.')),!!nativeStoreError);
   const saved=await saveUniversal(s,token,added,true);
   if(nativeStoreError)say(nativeStoreError+(saved?' Universal copy saved.':''),true);
  }else if(kind!=='move')say(kind==='universal-open'?'Opened “'+opened.name+'”'+(s.browser?' · universal server copy kept.':' · stored in plugin; save your DAW project.'):kind==='load'?'Part loaded · bin kept · playback stopped.':kind==='new'?'New empty working bin · add or upload patches.':kind==='delete'?'Part removed from working bin · Save to universal bin to update the server.':'Bin stored · save your DAW project.');
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
  ids.add(p.id);allowed.add(p.patch);allowed.add(p.render);const a=entries.get(p.patch),b=entries.get(p.render);if(!a||!b)throw Error('A saved part is missing its patch or preview.');size+=a.byteLength+b.byteLength;if(size>LIMIT)throw Error('Saved Parts Bin exceeds the 512 MiB universal storage quota for your account.');
  const source=a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength);root.mygrainSongBetaAdapter.inspectPart(source);
  const w=new DataView(b.buffer,b.byteOffset,b.byteLength);if(b.byteLength<44||w.getUint32(0,false)!==0x52494646||w.getUint32(8,false)!==0x57415645||w.getUint32(4,true)+8!==b.byteLength)throw Error('A saved preview WAV is incomplete.');
  parts.push({id:p.id,name:p.name,createdAt:p.createdAt,bpm:p.bpm,bars:p.bars,zip:source,preview:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)});
 }
 for(const path of entries.keys())if(path.startsWith('parts-bin/')&&!allowed.has(path))throw Error('Unlisted Parts Bin asset.');
 const main=await createStoredZip([...entries].filter(([path])=>!allowed.has(path)).map(([path,data])=>({path,data})));return {zip:await main.arrayBuffer(),parts};
}
function mount(){
 if(root.__mygrainSongRenderDeck)return;const shell=document.querySelector('.synth-container');if(!shell)return;card=node('section','parts-bin-card');card.id='partsBinCard';card.setAttribute('aria-label','The Parts Bin');card.innerHTML='<header class="parts-bin-header">'+icon+'<h3>The Parts Bin</h3></header><div id="partsBinOpen" class="parts-bin-open"><strong id="partsBinOpenName"></strong><span id="partsBinOpenState"></span></div><p class="parts-bin-help"><strong>Patches for your Cubase / DAW projects.</strong> Upload or drop complete MYGRAIN patch ZIPs (including their original sounds), or use Add current patch. <strong>Browser staging lasts only for this tab:</strong> choose <strong>Save to universal bin</strong> before closing or reloading it. This saves a named, private copy for all CEF, FX and Bridge instances signed into your account — not other users. In Cubase, open Your universal bins → Open a copy, Load a part, then save your DAW project normally. Connected plugins also store their local bin inside the DAW project; server copies and WAV Browser remain separate. There is no separate 96 MiB bin cap. Universal bins share your account’s 512 MiB storage quota. Installed plugins can embed up to 128 MiB for the current patch and bin together; larger working bins can be saved universally but not embedded in that plugin.</p><div class="parts-bin-toolbar"><button type="button" class="performance-btn" id="partsBinNew">New working bin</button><button type="button" class="performance-btn" id="partsBinAdd">Add current patch</button><button type="button" class="performance-btn" id="partsBinUpload">Upload patch ZIPs</button><input id="partsBinUploadFiles" type="file" accept=".zip,application/zip" multiple hidden aria-label="Upload complete MYGRAIN patch ZIPs"><button type="button" class="performance-btn" id="partsBinStore">Store bin in plugin</button><button type="button" class="performance-btn" id="partsBinUniversalSave">Save to universal bin…</button><span id="partsBinSummary"></span></div><div id="partsBinDrop" class="parts-bin-drop" role="group" aria-label="Patch ZIP drop area"><p>Drop complete MYGRAIN patch ZIPs here, or use Upload patch ZIPs. Notes, original sounds and a preview stay together; your loaded patch is not replaced.</p></div><p id="partsBinStorage" class="parts-bin-storage"></p><p id="partsBinStatus" role="status" aria-live="polite"></p><div class="parts-bin-preview"><label id="partsBinPreviewName" for="partsBinAudio">Choose a part to preview</label><audio id="partsBinAudio" controls preload="none" aria-labelledby="partsBinPreviewName"></audio></div><p id="partsBinEmpty">No parts yet. Upload patch ZIPs or add the current patch.</p><ul id="partsBinList" aria-label="Saved parts"></ul><section class="parts-bin-universal" aria-labelledby="partsBinUniversalTitle"><h4 id="partsBinUniversalTitle">Your universal bins</h4><p>Your named bins, available in every FX and instrument instance. Save changes to the open bin, or copy and move individual parts to other bins. Open a copy into this browser workspace or your connected plugin. Only your signed-in account can see these bins. Renaming or deleting a server bin never changes copies in DAW projects.</p><button type="button" class="performance-btn" id="partsBinUniversalRefresh">Refresh universal bins</button><p id="partsBinUniversalEmpty">No universal bins saved yet.</p><ul id="partsBinUniversalList" aria-label="Universal bins"></ul></section>';
 shell.append(card);const grid=document.querySelector('#sectionJumpPanel .section-jump-grid');if(grid){const b=node('button','section-jump-option');b.id='sectionJumpPartsBinBtn';b.type='button';b.dataset.jumpTarget='#partsBinCard';b.innerHTML=icon+'<span>The Parts Bin</span>';b.onclick=()=>root.mygrainJumpToButton(b);const pot=grid.querySelector('#sectionJumpCookingPotBtn');if(pot)pot.after(b);else grid.append(b);}
 const picker=card.querySelector('#partsBinUploadFiles'),drop=card.querySelector('#partsBinDrop');let uploadOwner=null;
 card.querySelector('#partsBinUpload').onclick=()=>{if(!available(current())||busy)return;uploadOwner={context:current(),generation:current().generation,account:root.mygrainAccounts.user?.username};picker.click();};
 picker.onchange=()=>{const files=[...picker.files];picker.value='';const owner=uploadOwner;uploadOwner=null;if(!files.length)return;if(!owner||owner.context!==current()||owner.generation!==current()?.generation||owner.account!==root.mygrainAccounts.user?.username){say('The account or bin changed. Choose the files again.',true);return;}void run('upload',files);};
 drop.addEventListener('dragover',e=>{e.preventDefault();if(available(current())&&!busy){drop.dataset.over='true';if(e.dataTransfer)e.dataTransfer.dropEffect='copy';}});drop.addEventListener('dragleave',()=>delete drop.dataset.over);
 drop.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();delete drop.dataset.over;if(!available(current())||busy)return;void run('upload',[...e.dataTransfer.files]);});
 card.querySelector('#partsBinNew').onclick=()=>run('new');card.querySelector('#partsBinUniversalSave').onclick=()=>run('universal-save');card.querySelector('#partsBinUniversalRefresh').onclick=()=>run('universal-refresh');card.querySelector('#partsBinAdd').onclick=()=>run('add');card.querySelector('#partsBinStore').onclick=()=>run('store');card.querySelector('audio').onerror=()=>{if(previewUrl)say('This preview could not be decoded. The saved editable part is unchanged.',true);};root.mygrainNavigation?.refresh(card);sync();
}
root.mygrainPartsBin={sync,unpackProject,get busy(){return busy;},get rendering(){return previewRendering;},universal:()=>universal.map(b=>({...b})),diagnostics:()=>({opened:opened?{id:opened.id,name:opened.name,dirty:universalDirty(),deleted:!!opened.deleted}:null,universalDirty:universalDirty(),connected:!!session&&!session.browser,browserWorkspace:!!session?.browser,parts:session?.partsBin.parts.map(({zip,preview,...p})=>({...p,zipBytes:zip.byteLength,previewBytes:preview.byteLength}))||[],bytes:total(session?.partsBin.parts||[]),dirty:!!session&&session.partsBin.version!==session.partsBin.storedVersion,busy,previewId})};
for(const name of ['mygrain-account-lock','mygrain-account-changed','pagehide'])root.addEventListener(name,()=>{locked=true;operation?.abort();stopPreview();workspace.generation++;workspace.partsBin={parts:[],version:0,storedVersion:0};for(const s of root.mygrainProjectSessions||[])s.partsBin={parts:[],version:0,storedVersion:0};renderKey='';sync();});
root.addEventListener('focus',()=>{if(session&&available(session)&&!busy)void run('universal-refresh');});
root.addEventListener('load',mount,{once:true});
})(window);
