(function(root){
'use strict';
if(root.__mygrainSongRenderDeck)return;
const card=document.getElementById('genreatorCard');if(!card)return;
const bpm=document.getElementById('genreatorBpm'),status=document.getElementById('genreatorStatus'),cancel=document.getElementById('genreatorCancel'),undo=document.getElementById('genreatorUndo');
let genres=[],pending=false,lastGenre=null;
function sync(){
 const ai=root.mygrainAiPatch,busy=pending||ai?.busy||root.mygrainCardHistory?.busy||root.mygrainInstareel?.capturing;
 for(const b of card.querySelectorAll('[data-genre]'))b.disabled=!!busy||!ai?.ready;
 bpm.disabled=!!busy;cancel.hidden=!pending;undo.disabled=!!busy||!root.mygrainCardHistory?.undoLabel;
 card.setAttribute('aria-busy',String(!!busy));
 if(pending&&ai?.diagnostics().status)status.textContent=ai.diagnostics().status;
}
async function generate(id){
 const profile=genres.find(g=>g.id===id),ai=root.mygrainAiPatch;
 if(!profile||pending||ai?.busy||!ai?.ready)return;
 const raw=bpm.value.trim(),tempo=raw===''?null:Number(raw);
 if(tempo!==null&&(!Number.isInteger(tempo)||tempo<60||tempo>180)){status.textContent='Enter a whole BPM from 60 to 180, or leave blank for AI tempo.';return;}
 pending=true;lastGenre=id;status.textContent=`Choosing a fresh ${profile.label} patch…`;sync();
 try{
  const prompt=`GENREator: create a fresh ${profile.label} patch. ${profile.direction} ${tempo===null?`Choose a suitable tempo within ${profile.bpm[0]}–${profile.bpm[1]} BPM.`:`Use exactly ${tempo} BPM.`} Choose coherent sources, notes, drum steps and useful levels using the supplied card knowledge. Respect this genre's excluded sources. Preserve recorded audio. Make a different musical variation each time.`;
  const result=await ai.generateGenre(id,tempo,prompt);
  status.textContent=result?.applied?`${profile.label} patch applied. ${document.getElementById('globalBpmSlider').value} BPM. Use Play to hear it if stopped; Undo restores the previous patch.`:(ai.diagnostics().status||'No patch applied.');
 }catch(error){status.textContent=error.message||'Generation failed. No fallback preset was applied.'}
 finally{pending=false;sync()}
}
cancel.addEventListener('click',()=>root.mygrainAiPatch?.cancel());
undo.addEventListener('click',async()=>{if(!pending&&!root.mygrainAiPatch?.busy){await root.mygrainCardHistory?.undo();status.textContent='Undo finished.';sync()}});
root.addEventListener('mygrain-ai-update',sync);root.addEventListener('mygrain-history-update',sync);
root.mygrainGenreator=Object.freeze({generate,get busy(){return pending},get genres(){return genres.map(g=>g.id)},get lastGenre(){return lastGenre}});
(async()=>{try{
 const response=await fetch(new URL('genre-presets.json?v=20261029-genre-3',document.baseURI),{credentials:'same-origin'});if(!response.ok)throw Error('Genre list could not load. Reload to try again.');genres=await response.json();
 const host=document.getElementById('genreatorGenres');
 for(const group of [...new Set(genres.map(g=>g.group))]){
  const section=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=group;section.append(legend);
  const grid=document.createElement('div');grid.className='genreator-buttons';
  for(const profile of genres.filter(g=>g.group===group)){const button=document.createElement('button');button.type='button';button.className='performance-btn';button.dataset.genre=profile.id;button.textContent=profile.label;button.title=`${profile.bpm[0]}–${profile.bpm[1]} BPM · ${profile.direction}`;button.addEventListener('click',()=>generate(profile.id));grid.append(button)}
  section.append(grid);host.append(section);
 }
 sync();
}catch(error){status.textContent=error.message;sync()}})();
})(window);

// INSTAREEL is deliberately confined to G; it never recalls or edits the live patch.
(function(root){
'use strict';
if(root.__mygrainSongRenderDeck)return;
const card=document.getElementById('genreatorCard');if(!card)return;
const box=document.createElement('fieldset');box.id='instareelControls';box.dataset.mygrainWorkspace='instareel';
box.innerHTML=`<legend>INSTAREEL <small>· 5</small></legend>
 <p>Evolve your current sounds into a loopable 30–60 second reel. Your patch stays unchanged; the finished WAV is not editable.</p>
 <div class="instareel-options"><label>Target seconds <input id="instareelSeconds" type="number" min="30" max="60" step="1" value="45" inputmode="numeric"></label>
 <label>Variation <select id="instareelVariation"><option value="subtle">Subtle</option><option value="moderate">Moderate</option></select></label></div>
 <div class="instareel-options"><label><input id="instareelNotes" type="checkbox"> X / L root-note variations</label><label><input id="instareelDrums" type="checkbox"> Drum variations + Roll fills</label></div>
 <p>Optional: X/L notes and drums evolve from each previous loop, with occasional hat ratchets and short Roll fills. The original groove returns at the loop boundary.</p>
 <p id="instareelLength">Duration rounds to complete source cycles for a musical loop.</p>
 <div class="instareel-actions"><button id="instareelMake" type="button">Make Reel</button><button id="instareelCancel" type="button" hidden>Cancel reel</button></div>
 <p id="instareelStatus" role="status" aria-live="polite">Find a patch you like, then make a reel. No extra AI calls.</p>
 <div id="instareelPreview" hidden><strong id="instareelPreviewTitle">Rendered reel</strong>
 <div class="instareel-player"><button id="instareelPlay" type="button">Load & Play</button><label class="instareel-loop"><input id="instareelLoop" type="checkbox" checked> Loop</label><input id="instareelSeek" data-mirror-control="instareel-playback" type="range" min="0" max="1" value="0" step=".01" aria-label="Reel playback position" disabled><span id="instareelTime">0.0s</span></div>
 <div id="instareelSaveControls"><label>Reel name <input id="instareelName" type="text" maxlength="64" value="My Reel"></label><div class="instareel-actions"><button id="instareelSave" type="button">Save to INSTAREEL</button><button id="instareelDiscard" type="button">Discard preview</button></div></div></div>
 <details id="instareelLibrary"><summary>INSTAREEL WAV Browser</summary><button id="instareelRefresh" type="button">Refresh reels</button><div id="instareelLibraryList">Open to load your saved reels.</div></details>`;
card.append(box);
const el=id=>document.getElementById('instareel'+id),base='/mygrain/api/instareel';
let busy=false,capturing=false,job=null,generation=0,controller=null,timer=null,current=null,buffer=null,source=null,context=null,position=0,started=0,frame=0,loading=false,playerGeneration=0,disposed=false;
const user=()=>root.mygrainAccounts?.user?.username;
const message=text=>{el('Status').textContent=text};
function sync(){
 const blocked=busy||root.mygrainAiPatch?.busy||root.mygrainCardHistory?.busy;
 el('Make').disabled=!!blocked;el('Seconds').disabled=busy;el('Variation').disabled=busy;el('Notes').disabled=busy;el('Drums').disabled=busy;el('Cancel').hidden=!busy;el('Cancel').disabled=busy&&!job;
 el('Make').textContent=current?.jobId?'Try Another':'Make Reel';
 el('Save').disabled=busy||!current?.jobId||!!current?.saved;
}
function abortTask(){generation++;clearTimeout(timer);timer=null;controller?.abort();controller=null;busy=false;capturing=false;sync();root.dispatchEvent(new Event('mygrain-ai-update'))}
async function json(url,options={}){
 const response=await fetch(url,{...options,cache:'no-store'}),payload=await response.json();
 if(!response.ok||!payload.ok){const error=Error(payload.error||`Request failed (${response.status})`);error.status=response.status;throw error}return payload;
}
function currentPosition(){if(!source||!buffer)return position;const t=position+context.currentTime-started;return source.loop?t%(current.duration||buffer.duration):Math.min(current.duration||buffer.duration,t)}
function update(){const time=currentPosition();el('Seek').value=String(time);el('Time').textContent=`${time.toFixed(1)} / ${(current?.duration||0).toFixed(1)}s`;if(source)frame=requestAnimationFrame(update)}
function stopSource(){if(source){position=currentPosition();const old=source;source=null;old.onended=null;try{old.stop()}catch{}old.disconnect();old.buffer=null}cancelAnimationFrame(frame);frame=0;el('Play').textContent=buffer?'Play':'Load & Play'}
function cancelPlayer(){playerGeneration++;playerRequest?.abort();playerRequest=null;stopSource();buffer=null;context=null;position=0;loading=false;el('Play').disabled=false;el('Seek').disabled=true;el('Play').textContent='Load & Play';if(typeof wavIphonePreviewActive!=='undefined'&&wavIphonePreviewActive===player)wavIphonePreviewActive=null;update()}
let playerRequest=null;
const libraryRequest=new AbortController();
const player={cancel:cancelPlayer,get playing(){return !!source},get buffer(){return buffer},get source(){return source}};
function playBuffer(){
 const length=Math.min(buffer.duration,current.duration);if(position>=length)position=0;
 source=context.createBufferSource();source.buffer=buffer;source.loop=el('Loop').checked;source.loopEnd=length;source.connect(context.destination);
 source.onended=()=>{stopSource();position=0;update()};started=context.currentTime;source.start(0,position);
 if(!source.loop)source.stop(started+length-position);
 el('Play').textContent='Pause';update();
}
async function togglePreview(){
 if(!current||loading||disposed)return;if(source){stopSource();update();return}
 const identity=user();context=audioContext;
 if(!identity||!context){message('Start MYGRAIN and sign in before previewing.');return}
 if(typeof wavIphonePreviewActive!=='undefined'){if(wavIphonePreviewActive&&wavIphonePreviewActive!==player)wavIphonePreviewActive.cancel();wavIphonePreviewActive=player}
 context.resume().catch(()=>{});const token=++playerGeneration,selected=current;
 const valid=()=>!disposed&&token===playerGeneration&&selected===current&&identity===user()&&context===audioContext;
 let timeout;
 try{
  if(!buffer){loading=true;el('Play').disabled=true;el('Play').textContent='Loading…';playerRequest=new AbortController();timeout=setTimeout(()=>playerRequest?.abort(),120000);
   const response=await fetch(selected.preview,{cache:'no-store',signal:playerRequest.signal,priority:'high'});
   const decoded=await loadLoopAudioResponse(response,context,{signal:playerRequest.signal,maxEncodedBytes:4*1048576,maxDecodedBytes:64*1048576});
   if(!valid())return;buffer=decoded;playerRequest=null;el('Seek').max=String(Math.min(current.duration,buffer.duration));el('Seek').disabled=false;
  }
  await context.resume();if(valid())playBuffer();
 }catch(error){if(valid()){cancelPlayer();message(`Preview could not play: ${error.name==='AbortError'?'Download timed out; tap Play to retry':error.message}`)}}
 finally{clearTimeout(timeout);if(valid()){loading=false;el('Play').disabled=false}}
}
el('Play').addEventListener('click',togglePreview);
el('Loop').addEventListener('change',()=>{if(source){stopSource();playBuffer()}});
el('Seek').addEventListener('input',()=>{if(!buffer)return;const playing=!!source;stopSource();position=Number(el('Seek').value)||0;if(playing)playBuffer();else update()});
function select(item){cancelPlayer();current=item;el('Preview').hidden=false;el('PreviewTitle').textContent=item.name;el('SaveControls').hidden=!item.jobId;el('Seek').max=String(item.duration);update();sync()}
function length(){
 const seconds=Number(el('Seconds').value),bpm=Number(document.getElementById('globalBpmSlider')?.value)||120;
 el('Length').textContent=`Target ${Number.isFinite(seconds)?seconds:45}s · ${bpm} BPM. Actual duration rounds to complete source cycles (30–60s).`;
}
el('Seconds').addEventListener('input',length);
async function poll(token,identity){
 if(token!==generation||identity!==user())return;
 try{
  const data=await json(`${base}/${job.id}`,{signal:controller.signal});if(token!==generation||identity!==user())return;job=data.job;message(job.message);
  if(job.state==='done'){
   const ready=job;busy=false;controller=null;select({jobId:ready.id,preview:`${base}/${ready.id}/preview`,duration:ready.plan.duration,name:`${ready.plan.duration.toFixed(1)}s · ${ready.plan.variation} · ${ready.plan.bpm} BPM`});
   message(`${ready.plan.duration.toFixed(1)}s loopable reel ready · ${ready.plan.variation} variations${ready.plan.options?.notes?' · X/L notes':''}${ready.plan.options?.drums?' · drums/fills':''} (${ready.plan.requestedSeconds}s requested). Preview, save, or Try Another. Current patch unchanged.`);sync();return;
  }
  if(['failed','cancelled'].includes(job.state)){busy=false;controller=null;sync();return}
  timer=setTimeout(()=>poll(token,identity),1000);
 }catch(error){if(token===generation){if(error.status===404||error.status===401){busy=false;controller=null;message(error.message);sync()}else{message(`Reel status unavailable: ${error.message}. Retrying; Cancel remains available.`);timer=setTimeout(()=>poll(token,identity),2000)}}}
}
el('Make').addEventListener('click',async()=>{
 if(busy||disposed)return;const seconds=Number(el('Seconds').value),variation=el('Variation').value,notes=el('Notes').checked,drums=el('Drums').checked,identity=user();
 if(!Number.isFinite(seconds)||seconds<30||seconds>60){message('Enter a target from 30 to 60 seconds.');return}
 if(!identity||!root.mygrainSongBetaAdapter){message('Start MYGRAIN and sign in first.');return}
 if(root.mygrainAiPatch?.busy||root.mygrainCardHistory?.busy){message('Wait for the current patch change to finish.');return}
 abortTask();cancelPlayer();el('Preview').hidden=true;job=null;const token=generation;controller=new AbortController();busy=true;capturing=true;sync();root.dispatchEvent(new Event('mygrain-ai-update'));
 try{
  message(`Capturing current sounds · ${seconds}s requested · ${variation} variations…`);
  const adapter=root.mygrainSongBetaAdapter;
  const live=await adapter.capture({liveOnly:true});
  const estimated=[...live.buffers.values()].reduce((sum,b)=>sum+(b?b.length*b.numberOfChannels*2:0),0);
  const maxBytes=/iPhone|iPad|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1?48*1048576:96*1048576;
  if(estimated>maxBytes)throw Error('This patch has too much source audio to snapshot safely. Shorten its samples before making a reel.');
  const serial=sourceMutationSerial,archive=await adapter.capture();
  if(token!==generation||identity!==user())return;
  if(sourceMutationSerial!==serial)throw Error('Source sounds changed during capture. Try Make Reel again.');
  capturing=false;root.dispatchEvent(new Event('mygrain-ai-update'));
  const query=new URLSearchParams({seconds:String(seconds),variation,notes:notes?'1':'0',drums:drums?'1':'0'});
  message('Uploading snapshot. Rendering runs on the server; your current patch stays unchanged.');
  const data=await json(base+'?'+query,{method:'POST',headers:{'Content-Type':'application/zip'},body:archive,signal:controller.signal});
  if(token!==generation||identity!==user())return;job=data.job;sync();message(`Rendering ${job.plan.duration.toFixed(1)}s · ${job.plan.variation} variations (${job.plan.requestedSeconds}s requested)…`);poll(token,identity);
 }catch(error){if(token===generation){abortTask();message(`Could not make reel: ${error.message}. Current patch unchanged.`)}}
 finally{if(token===generation){capturing=false;root.dispatchEvent(new Event('mygrain-ai-update'));sync()}}
});
el('Cancel').addEventListener('click',async()=>{const pending=job;abortTask();const token=generation;busy=true;sync();message('Cancelling reel…');try{if(pending&&['queued','running'].includes(pending.state)){const data=await json(`${base}/${pending.id}/cancel`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(token!==generation)return;job=data.job}busy=false;message('Reel cancelled. Current patch unchanged.');sync()}catch(error){if(token===generation){message(`Cancellation could not be confirmed: ${error.message}. Tap Cancel to retry.`);sync()}}});
el('Save').addEventListener('click',async()=>{
 if(!current?.jobId||current.saved||busy)return;const item=current,identity=user();el('Save').disabled=true;
 try{const data=await json(`${base}/${item.jobId}/save`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:el('Name').value})});if(identity!==user()||item!==current)return;item.saved=true;message(`Saved ${data.reel.filename} to INSTAREEL and the WAV repository.`);await library()}
 catch(error){message(`Save failed: ${error.message}. Your preview is still available.`)}finally{sync()}
});
el('Discard').addEventListener('click',()=>{cancelPlayer();current=null;el('Preview').hidden=true;message('Preview discarded. Saved reels and current patch unchanged.');sync()});
async function library(){
 const identity=user(),list=el('LibraryList');list.textContent='Loading reels…';
 try{const data=await json(base+'/library');if(identity!==user()||disposed)return;list.replaceChildren();
  if(!data.reels.length){list.textContent='No saved reels yet.';return}
  for(const reel of data.reels){const row=document.createElement('div');row.className='instareel-library-row';const title=document.createElement('span');title.textContent=`${reel.name} · ${reel.duration.toFixed(1)}s · ${reel.bpm} BPM`;
   const play=document.createElement('button');play.type='button';play.textContent='Preview';play.addEventListener('click',()=>{select({libraryId:reel.id,name:title.textContent,duration:reel.duration,preview:`${base}/library/${reel.id}/preview`});togglePreview();el('Preview').scrollIntoView({block:'nearest'});el('Play').focus({preventScroll:true})});
   const download=document.createElement('button');download.type='button';download.textContent='Download WAV';download.addEventListener('click',async()=>{download.disabled=true;try{const response=await fetch(`${base}/library/${reel.id}/wav`,{cache:'no-store'});if(!response.ok)throw Error('Download failed');const blob=await response.blob();if(identity!==user()||disposed)return;downloadBlob(blob,reel.filename)}catch(error){message(error.message)}finally{download.disabled=false}});
   const rename=document.createElement('button');rename.type='button';rename.textContent='Rename';
   const remove=document.createElement('button');remove.type='button';remove.textContent='Delete';
   const upload=document.createElement('button');upload.type='button';upload.textContent='Upload to FTP';
   const form=document.createElement('form');form.className='instareel-rename';form.hidden=true;
   const input=document.createElement('input');input.value=reel.name;input.maxLength=64;input.setAttribute('aria-label','New reel name');
   const save=document.createElement('button');save.type='submit';save.textContent='Save name';
   const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>{form.hidden=true};form.append(input,save,cancel);
   let acting=false;
   const run=async action=>{if(acting||disposed||identity!==user())return;acting=true;for(const b of row.querySelectorAll('button,input'))b.disabled=true;try{await action()}catch(error){if(identity===user()&&!disposed)message(error.message)}finally{acting=false;for(const b of row.querySelectorAll('button,input'))b.disabled=false}};
   const mutate=(action,payload)=>json(`${base}/library/${reel.id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:libraryRequest.signal});
   rename.onclick=()=>{form.hidden=false;input.focus()};
   form.onsubmit=event=>{event.preventDefault();run(async()=>{const data=await mutate('rename',{name:input.value});if(disposed||identity!==user())return;if(current?.libraryId===reel.id){current.name=data.reel.name;el('PreviewTitle').textContent=current.name}await library();message(`Renamed to ${data.reel.name}.`)})};
   remove.onclick=()=>{if(!confirm(`Delete “${reel.name}” from INSTAREEL and the WAV repository? Uploaded FTP copies are kept.`))return;run(async()=>{await mutate('delete',{});if(disposed||identity!==user())return;if(current?.libraryId===reel.id||current?.jobId===reel.id){cancelPlayer();current=null;el('Preview').hidden=true;sync()}await library();message('Reel deleted. Uploaded FTP copies are unchanged.')})};
   upload.onclick=()=>run(async()=>{
    if(!root.mygrainFtp?.pickFolder)throw Error('FTP browser is not ready. Reload MYGRAIN and try again.');
    const folder=await root.mygrainFtp.pickFolder({title:'INSTAREEL · Choose private FTP folder',signal:libraryRequest.signal});if(disposed||identity!==user())return;if(folder===null){message('FTP upload cancelled.');return}
    message('Uploading reel to private FTP…');
    const response=await fetch(`${base}/library/${reel.id}/wav`,{cache:'no-store',signal:libraryRequest.signal});if(!response.ok)throw Error('Reel download failed. Refresh the INSTAREEL browser.');
    if(Number(response.headers.get('Content-Length'))>24*1048576)throw Error('Reel exceeds the upload memory limit.');
    const blob=await response.blob();if(blob.size>24*1048576)throw Error('Reel exceeds the upload memory limit.');if(disposed||identity!==user())return;
    const path=[folder,reel.filename].filter(Boolean).join('/');await json(`/mygrain/api/ftp/upload?${new URLSearchParams({path})}`,{method:'POST',body:blob,headers:{'Content-Type':'application/octet-stream'},signal:libraryRequest.signal});
    if(!disposed&&identity===user())message(`Uploaded ${reel.filename} to private FTP /${identity}/${folder}.`);
   });
   row.append(title,play,download,rename,remove,upload,form);list.append(row);
  }
 }catch(error){if(identity===user())list.textContent=`Could not load reels: ${error.message}`}
}
el('Library').addEventListener('toggle',()=>{if(el('Library').open)library()});el('Refresh').addEventListener('click',library);
function dispose(){disposed=true;libraryRequest.abort();const pending=job;abortTask();cancelPlayer();current=null;job=null;el('Preview').hidden=true;el('LibraryList').replaceChildren();message('Sign in again to use INSTAREEL.');if(pending&&['queued','running'].includes(pending.state))json(`${base}/${pending.id}/cancel`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{})}
root.addEventListener('mygrain-account-lock',dispose);root.addEventListener('mygrain-account-changed',dispose);
root.addEventListener('mygrain-ai-update',sync);root.addEventListener('mygrain-history-update',sync);
root.mygrainInstareel=Object.freeze({get busy(){return busy},get capturing(){return capturing},get player(){return player},get job(){return job?{id:job.id,state:job.state}:null}});
length();sync();
})(window);
