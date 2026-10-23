const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const extract=name=>{const start=html.indexOf(`        function ${name}(`);assert.ok(start>=0);return html.slice(start,html.indexOf('\n        function ',start+1));};
function fixture(){
 const elements={synthPresetSelect:{value:'custom'},synthPresetValue:{},keyboardSynthPresetValue:{}};
 const presets=Array.from({length:500},(_,i)=>({id:`preset-${i}`,name:`Preset ${i}`})),calls=[];
 const context=vm.createContext({document:{getElementById:id=>elements[id]},SYNTH_POPUP_PRESETS:presets,SYNTH_POPUP_PRESET_MAP:new Map(presets.map(p=>[p.id,p])),synthCustomPatches:[{id:'saved-one',name:'Saved One'}],loadedSynthCustomPatchId:'',window:{},applySynthPopupPreset:id=>{elements.synthPresetSelect.value=id;calls.push(id);}});
 vm.runInContext(['syncSynthPresetLabel','setSynthPresetSelectValue','stepSynthPreset'].map(extract).join('\n'),context);
 return{context,elements,calls,presets};
}
test('factory navigation walks all 500 presets in either direction and wraps without Custom',()=>{
 const f=fixture();for(let i=0;i<501;i++){f.context.stepSynthPreset(1);assert.equal(f.calls.at(-1),f.presets[i%500].id);}
 for(let i=0;i<501;i++){f.context.stepSynthPreset(-1);assert.equal(f.calls.at(-1),f.presets[(499-i%500+500)%500].id);}
});
test('Custom and saved custom sounds enter at first/last without modifying the saved library',()=>{
 const f=fixture();f.context.stepSynthPreset(-1);assert.equal(f.calls.at(-1),'preset-499');
 f.context.setSynthPresetSelectValue('custom');f.context.loadedSynthCustomPatchId='saved-one';f.context.syncSynthPresetLabel();
 assert.equal(f.elements.keyboardSynthPresetValue.textContent,'Saved: Saved One');f.context.stepSynthPreset(1);assert.equal(f.calls.at(-1),'preset-0');assert.equal(f.context.synthCustomPatches.length,1);
});
test('both names follow factory, Custom and saved-patch identity',()=>{
 const f=fixture();for(const id of ['preset-7','custom']){f.context.setSynthPresetSelectValue(id);assert.equal(f.elements.synthPresetValue.textContent,f.elements.keyboardSynthPresetValue.textContent);}
 f.context.loadedSynthCustomPatchId='saved-one';f.context.syncSynthPresetLabel();assert.equal(f.elements.synthPresetValue.textContent,'Saved: Saved One');assert.equal(f.elements.keyboardSynthPresetValue.textContent,'Saved: Saved One');
});
test('preset steps use one draft transaction and refuse invalid direction or concurrent history',()=>{
 const f=fixture(),labels=[];f.context.window.mygrainCardHistory={busy:false,runDraftEdit:(label,action)=>{labels.push(label);return action();}};
 f.context.stepSynthPreset(1);assert.deepEqual(labels,['synth preset']);assert.equal(f.calls.length,1);
 f.context.window.mygrainCardHistory.busy=true;assert.throws(()=>f.context.stepSynthPreset(-1),/Wait/);assert.throws(()=>f.context.stepSynthPreset(0),/Invalid/);assert.equal(f.calls.length,1);
});
