/* Account-private rendered ideas. Ordinary WAV renderer + ordinary editable source ZIP. */
(function(root){
'use strict';
if(root.__mygrainSongRenderDeck)return;
const base='/mygrain/api/plugin-library/scratchpad',build='SCRATCH.1';
const icon='<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 4h18v24H7zM11 2v5m5-5v5m5-5v5M11 12h10m-10 5h10m-10 5h6"/></svg>';
let browser,op=null,view=null,viewSerial=0,owner=null,items=[],folders=[],folder='all',offset=0,total=0,previewUrl=null,previewId=null,searchTimer=null;
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const user=()=>root.mygrainAccounts?.user?.username;
function guard(token){token.signal.throwIfAborted();if(token.owner!==user())throw Error('The account changed. Open Scratchpad again.');}
function token(){const t=new AbortController();t.owner=user();if(!t.owner)throw Error('Sign in to MYGRAIN first.');return t;}
function say(text,error=false){if(browser){const s=browser.querySelector('#scratchpadStatus');s.textContent=text;s.dataset.error=String(error);}}
function stopPreview(){const a=browser?.querySelector('audio');if(a){a.pause();a.removeAttribute('src');a.load();}if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;previewId=null;if(browser)browser.querySelector('#scratchpadPlayer').hidden=true;}
function close(){view?.abort();viewSerial++;op?.abort();stopPreview();if(browser?.open)browser.close();}
function reset(){clearTimeout(searchTimer);items=[];folders=[];folder='all';offset=0;total=0;if(browser){browser.querySelector('#scratchpadSearch').value='';browser.querySelector('#scratchpadPreviewName').textContent='';render();say('Loading your ideas…');}}
function clear(){close();owner=null;reset();document.getElementById('scratchpadForm')?.close();}
function sync(){for(const id of['sectionJumpScratchpadBtn','scratchpadCaptureAction']){const b=document.getElementById(id);if(b)b.disabled=!!op;}if(browser)for(const e of browser.querySelectorAll('[data-scratch-write]'))e.disabled=!!op;}
async function request(path,t,options={}){guard(t);const r=await fetch(base+path,{cache:'no-store',...options,signal:t.signal});guard(t);if(!r.ok){const data=await r.json().catch(()=>({}));throw Error(data.error||'Scratchpad request failed ('+r.status+').');}return r;}
async function digest(data){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');}
async function asset(item,kind,t){const data=await(await request('/items/'+item.id+'/'+kind,t)).arrayBuffer();guard(t);if(data.byteLength!==item[kind+'Bytes']||await digest(data)!==item[kind+'Sha256'])throw Error('This '+kind+' failed its integrity check. Refresh Scratchpad.');guard(t);return data;}
function choice({title,description='',value,select,selected='',action='Save',danger=false},t){
 if(document.getElementById('scratchpadForm'))throw Error('Finish the open Scratchpad choice first.');
 const d=node('dialog','scratch-paper');d.id='scratchpadForm';d.setAttribute('aria-labelledby','scratchpadFormTitle');const h=node('h2','',title);h.id='scratchpadFormTitle';const form=node('form'),p=node('p','',description),buttons=node('div','scratch-form-actions'),cancel=node('button','','Cancel'),accept=node('button','',action);cancel.type='button';accept.type='submit';accept.dataset.scratchAccept='';if(danger)accept.dataset.danger='';let input;
 if(value!==undefined){const label=node('label','','Name');input=node('input');input.value=value;input.maxLength=120;input.required=true;input.autocomplete='off';input.id='scratchpadName';label.htmlFor=input.id;form.append(label,input);}
 if(select){const label=node('label','','Folder');input=node('select');input.id='scratchpadDestination';label.htmlFor=input.id;for(const option of select){const o=node('option','',option.name);o.value=option.id||'';input.append(o);}input.value=selected;form.append(label,input);}
 buttons.append(cancel,accept);form.append(buttons);d.append(h,p,form);document.body.append(d);const before=document.activeElement;
 return new Promise(resolve=>{let finished=false;const finish=value=>{if(finished)return;finished=true;t.signal.removeEventListener('abort',abort);if(d.open)d.close();d.remove();before?.isConnected&&before.focus({preventScroll:true});resolve(value);},abort=()=>finish(null);cancel.onclick=abort;d.oncancel=e=>{e.preventDefault();abort();};d.onclose=abort;form.onsubmit=e=>{e.preventDefault();const text=input?.value.trim();if(input&&value!==undefined&&!text){input.setCustomValidity('Enter a name.');input.reportValidity();return;}finish(input?text:true);};input?.addEventListener('input',()=>input.setCustomValidity(''));t.signal.addEventListener('abort',abort,{once:true});d.showModal();cancel.focus();});
}
async function refresh(){
 if(!browser?.open||!user()||owner!==user())return;view?.abort();const t=view=token(),serial=++viewSerial,q=browser.querySelector('#scratchpadSearch').value;
 try{const data=await(await request('?'+new URLSearchParams({folder,q,offset,limit:50}),t)).json();guard(t);if(serial!==viewSerial||!browser.open)return;items=data.items;folders=data.folders;total=data.total;render();say(total+' idea'+(total===1?'':'s')+' · audio + editable patches · no library quota');}
 catch(e){if(!t.signal.aborted)say(e.message,true);}
}
function render(){
 stopPreview();const picker=browser.querySelector('#scratchpadFolder'),selected=folder;picker.replaceChildren();for(const f of[{id:'all',name:'All ideas'},{id:'',name:'Unfiled'},...folders]){const o=node('option','',f.name);o.value=f.id;picker.append(o);}picker.value=selected;
 const list=browser.querySelector('#scratchpadItems');list.replaceChildren();if(!items.length)list.append(node('li','scratch-row','Your next idea starts here. Use Scratchpad to render and save it.'));
 for(const item of items){const row=node('li','scratch-row');row.dataset.scratchId=item.id;const heading=node('strong','',item.name),meta=node('small','',new Date(item.created*1000).toLocaleString()+' · '+(item.frames/item.sampleRate).toFixed(1)+'s · '+(folders.find(f=>f.id===item.folder)?.name||'Unfiled')),actions=node('div','scratch-row-actions');
  for(const[label,kind]of[['Preview','preview'],['Load patch','load'],['Rename','rename'],['Move…','move'],['Delete','delete']]){const b=node('button','',label);b.type='button';b.dataset.scratchAction=kind;if(kind!=='preview')b.dataset.scratchWrite='';if(kind==='delete')b.dataset.danger='';b.setAttribute('aria-label',label+' '+item.name);b.onclick=()=>void run(kind,item);actions.append(b);}row.append(heading,meta,actions);list.append(row);
 }
 browser.querySelector('#scratchpadPage').textContent=total?(offset+1)+'–'+Math.min(offset+50,total)+' / '+total:'No ideas yet';browser.querySelector('#scratchpadPrevious').disabled=offset===0;browser.querySelector('#scratchpadNext').disabled=offset+50>=total;sync();
}
async function run(kind,item){
 if(op)return;if(!user()){root.mygrainAccounts?.showLogin?.();return;}const t=op=token();sync();let rendering=false,ownsRender=false;
 try{
  if(kind==='capture'){
   if(typeof repositoryRenderInFlight!=='undefined'&&repositoryRenderInFlight)throw Error('Wait for the current render to finish.');
   if(!isAudioGraphReady()||engineStarting||stateSaveSuspended)throw Error('Start MYGRAIN and wait for the audio engine first.');
   const title=await choice({title:'Scratchpad',description:'Render this idea and always save its editable patch and original sounds. Private to your account; available in the browser and CEF plugin.',value:'Idea '+new Date().toLocaleString(),action:'Render & save'},t);if(title===null)return;guard(t);stopPreview();mount();if(owner!==t.owner)reset();owner=t.owner;if(!browser.open)browser.showModal();
   repositoryRenderInFlight=true;ownsRender=true;say('Preparing editable patch and original sounds…');
   const result=await renderPatternWithOptionalSnapshot({exportChoice:{name:title,includeSnapshot:true},signal:t.signal,onRenderStart:()=>{rendering=true;say('Rendering idea…');}});guard(t);if(!result){say('Cancelled. No idea saved.');return;}if(!result.patternBlob||result.patternOwner!==t.owner)throw Error('An editable patch is required. Nothing was saved.');
   say('Saving WAV and matching patch…');const body=await createStoredZip([{path:'render.wav',data:result.blob},{path:'pattern.zip',data:result.patternBlob}]);guard(t);const q=new URLSearchParams({name:title});if(folder&&folder!=='all')q.set('folder',folder);const saved=await(await request('/items?'+q,t,{method:'POST',headers:{'Content-Type':'application/zip'},body})).json();guard(t);offset=0;browser.querySelector('#scratchpadSearch').value='';await refresh();guard(t);say('Saved “'+saved.item.name+'” with its editable patch.');
  }else if(kind==='preview'){
   if(previewId===item.id){stopPreview();return;}stopPreview();say('Loading preview…');const bytes=await asset(item,'audio',t);guard(t);if(!browser.open)return;previewUrl=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));previewId=item.id;const a=browser.querySelector('audio');document.querySelectorAll('audio').forEach(other=>{if(other!==a)other.pause();});a.src=previewUrl;browser.querySelector('#scratchpadPreviewName').textContent=item.name;browser.querySelector('#scratchpadPlayer').hidden=false;await a.play();guard(t);say('Previewing “'+item.name+'”.');
  }else if(kind==='folder'){
   const title=await choice({title:'New folder',value:'',action:'Create folder'},t);if(title===null)return;const f=await(await request('/folders',t,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:title})})).json();guard(t);folder=f.id;offset=0;await refresh();
  }else if(kind==='load'){
   if(!await choice({title:'Load “'+item.name+'”?',description:'Restore the editable patch and original sounds. Playback stops; Undo can restore your current patch.',action:'Load patch'},t))return;
   stopPreview();say('Downloading and checking editable patch…');const data=await asset(item,'patch',t);guard(t);if(browser.open)browser.close();await runPatchImport(item.name,()=>importEditablePattern(data,item.name,{signal:t.signal}));guard(t);
  }else{
   let change;
   if(kind==='rename'){const title=await choice({title:'Rename idea',value:item.name,action:'Rename'},t);if(title===null)return;change={name:title};}
   if(kind==='move'){const destination=await choice({title:'Move “'+item.name+'”',description:'The audio and patch stay together.',select:[{id:'',name:'Unfiled'},...folders],value:undefined,selected:item.folder||'',action:'Move idea'},t);if(destination===null)return;change={folder:destination||null};}
   if(kind==='delete'){if(!await choice({title:'Delete “'+item.name+'”?',description:'Remove this saved idea and its patch from Scratchpad. Your loaded patch and independent copies are kept.',action:'Delete idea',danger:true},t))return;}
   guard(t);stopPreview();await request('/items/'+item.id,t,kind==='delete'?{method:'DELETE',headers:{'If-Match':String(item.revision)}}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...change,revision:item.revision})});guard(t);if(kind==='delete'&&items.length===1&&offset)offset=Math.max(0,offset-50);await refresh();
  }
 }catch(e){if(!t.signal.aborted){say(e.message,true);if(!browser?.open){mount();owner=t.owner;if(user()===t.owner)browser.showModal();say(e.message,true);}}}
 finally{if(rendering)await restoreAudioAfterRepositoryRender();if(ownsRender)repositoryRenderInFlight=false;if(op===t)op=null;sync();}
}
function mount(){if(browser)return;browser=node('dialog','scratch-paper');browser.id='scratchpadBrowser';browser.dataset.build=build;browser.setAttribute('aria-labelledby','scratchpadTitle');browser.innerHTML='<header class="scratch-head"><div><h2 id="scratchpadTitle">'+icon+'Scratchpad</h2><small>Little ideas. Kept for later.</small></div><button id="scratchpadDone" type="button">Done</button></header><div class="scratch-tools"><button type="button" id="scratchpadCapture" data-scratch-write>✎ New idea</button><button type="button" id="scratchpadNewFolder" data-scratch-write>+ Folder</button><button type="button" id="scratchpadRefresh">Refresh</button><label>Folder<select id="scratchpadFolder"></select></label><label>Find an idea<input type="search" id="scratchpadSearch" maxlength="120" autocomplete="off"></label></div><p id="scratchpadStatus" role="status" aria-live="polite"></p><div id="scratchpadPlayer" hidden><div class="scratch-player-tools"><span id="scratchpadPreviewName"></span><button id="scratchpadStopPreview" type="button">Stop preview</button></div><audio id="scratchpadAudio" controls preload="none"></audio></div><ul id="scratchpadItems"></ul><footer class="scratch-footer"><button id="scratchpadPrevious" type="button">Previous</button><span id="scratchpadPage"></span><button id="scratchpadNext" type="button">Next</button></footer>';document.body.append(browser);
 browser.querySelector('#scratchpadDone').onclick=close;browser.oncancel=e=>{e.preventDefault();close();};browser.addEventListener('close',()=>{view?.abort();stopPreview();root.guardSectionJumpAfterOverlayClose?.();});browser.querySelector('#scratchpadCapture').onclick=()=>void run('capture');browser.querySelector('#scratchpadNewFolder').onclick=()=>void run('folder');browser.querySelector('#scratchpadRefresh').onclick=()=>void refresh();browser.querySelector('#scratchpadStopPreview').onclick=stopPreview;browser.querySelector('#scratchpadFolder').onchange=e=>{folder=e.target.value;offset=0;void refresh();};browser.querySelector('#scratchpadSearch').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{offset=0;void refresh();},200);};for(const[id,direction]of[['scratchpadPrevious',-1],['scratchpadNext',1]])browser.querySelector('#'+id).onclick=()=>{offset=Math.max(0,offset+50*direction);void refresh();};
}
async function open(){try{const identity=user();if(!identity)throw Error('Sign in first.');mount();if(owner!==identity){stopPreview();reset();owner=identity;}if(!browser.open)browser.showModal();await refresh();}catch(e){if(browser)say(e.message,true);}}
function init(){document.getElementById('scratchpadCaptureAction').onclick=()=>void run('capture');document.getElementById('scratchpadBrowserAction').onclick=()=>void open();}
for(const name of['mygrain-account-lock','mygrain-account-changed','pagehide'])root.addEventListener(name,clear);
root.mygrainScratchpad={open,capture:()=>run('capture'),close,build,get busy(){return!!op;}};
if(document.readyState==='complete')init();else root.addEventListener('load',init,{once:true});
})(window);
