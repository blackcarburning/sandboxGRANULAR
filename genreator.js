(function(root){
'use strict';
if(root.__mygrainSongRenderDeck)return;
const card=document.getElementById('genreatorCard');if(!card)return;
const bpm=document.getElementById('genreatorBpm'),status=document.getElementById('genreatorStatus'),cancel=document.getElementById('genreatorCancel'),undo=document.getElementById('genreatorUndo');
let genres=[],pending=false,lastGenre=null;
function sync(){
 const ai=root.mygrainAiPatch,busy=pending||ai?.busy||root.mygrainCardHistory?.busy;
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
 const response=await fetch(new URL('genre-presets.json?v=20261029-genre-1',document.baseURI),{credentials:'same-origin'});if(!response.ok)throw Error('Genre list could not load. Reload to try again.');genres=await response.json();
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
