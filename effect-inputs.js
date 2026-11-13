/* One ordered input inventory for every specialised effect. No saved UI state. */
(function(root){
'use strict';
const SOURCES=Object.freeze(['all','A','B','C','D','V','W','P','O','L','X','Q','M','M+','generated','sample','K','K1','K2','K3','K4','K5','drums','drumKick','drumSnare','drumHat','drumPerc','drumClap','drumCymbals','drumEtc','drumRoll','N','DAW']);
const labels={all:'Whole mix · all tracks',A:'A · Loop',B:'B · Loop',C:'C · Loop',D:'D · Loop',V:'V · Vocal',W:'W · Wave',P:'P · Piano',O:'O · Orch',L:'L · Lead',X:'X · Bass',Q:'Q · Instrument',M:'M · Synth','M+':'M+ · Synth',generated:'Generated loop',sample:'Dropbox sample',K:'K · All five tracks',drums:'Drums · All lanes',N:'N · Noise',DAW:'VST3 FX · Host input'};
for(let i=1;i<=5;i++)labels['K'+i]='K'+i+' · Recorder track '+i;
for(const key of SOURCES.filter(k=>k.startsWith('drum')&&k!=='drums'))labels[key]='Drums · '+key.slice(4).replace(/^[a-z]/,c=>c.toUpperCase());
const label=key=>labels[key]||key;
const matches=(selection,key)=>selection==='all'||selection===key||selection==='K'&&/^K[1-5]$/.test(key)||selection==='drums'&&key.startsWith('drum');
// Display-only destinations; grouped lanes always lead to their parent card.
function jumpTarget(key){
 if(['all','DAW'].includes(key)||!SOURCES.includes(key))return null;
 if(key==='drums'||key.startsWith('drum'))return '[aria-label="Drum machine controls"]';
 if(/^K[1-5]?$/.test(key))return '#bastardLoopKCard';
 if(key==='generated')return '#generatedWaveformEditor';
 if(key==='sample')return '[aria-label="Dropbox sample layer controls"]';
 if(key==='N')return '#noiseCard';
 if(key==='D')return '#bastardLoopDCard';
 if(key==='Q')return '#bastardLoopQCard';
 return '[aria-label="Bastardloop'+(key==='A'?'':' '+key)+' controls"]';
}
const selected=value=>(Array.isArray(value)?value:String(value||'').split(',')).map(v=>String(v).trim()).filter(v=>v&&v.toLowerCase()!=='none');
function soloSources(modes={},sourceSelection=[]){
 const out=new Set(),loops=selected(modes.loopLayerSolo),source=selected(sourceSelection);
 for(const key of ['A','B','C','D','V','W','P','O','L','X','Q','M','M+'])if(loops.includes('bastard'+(key==='M+'?'mplus':key.toLowerCase())))out.add(key);
 if(loops.includes('dropbox'))out.add('sample');if(loops.includes('noise'))out.add('N');
 if(loops.includes('bastardk'))for(let i=1;i<=5;i++)out.add('K'+i);
 const lanes=loops.includes('drums')?['kick','snare','hat','perc','clap','cymbals','etc','roll']:selected(modes.drumMachineLaneSolos);
 for(const lane of lanes)out.add('drum'+lane[0].toUpperCase()+lane.slice(1).toLowerCase());
 if(modes.generatedSampleSolo===true||source.includes('loop')||selected(modes.sourceWaveformSolo).includes('generated'))out.add('generated');
 // Non-routable granular/keyboard/raw-source Solos still excite Whole mix.
 if(source.length||loops.length||selected(modes.grainLayerSolo).length||selected(modes.sourceWaveformSolo).length)out.add('*');
 return [...out];
}
function effectSettings(modes={}){return {...modes,mutilator:modes.loopD?.mutilator||{},resonator:modes.resonatorR||{},playground:modes.wasp?.playground||{}};}
function routedEffects(sources,settings={}){
 const has=selection=>selection==='all'?sources.length>0:sources.some(key=>key!=='*'&&matches(selection,key)),out=[];
 for(const key of ['resonator','turntable','playground','mutilator','bassFace','sonicCrystal','bubbleChamber','wireWorld','wasp']){
  const v=settings[key]||{};if(v.enabled!==true)continue;
  let inputs=[];
  if(key==='resonator')inputs=(v.slots||[{enabled:true,source:'drumKick',level:.45}]).filter((s,i)=>(s.enabled??i===0)&&(s.level??.45)>0).map(s=>s.source||'drumKick');
  else if(key==='wasp'){if((v.blend??.5)<=0)continue;inputs=(v.routes||[]).slice(0,2).filter(s=>s.enabled&&s.depth!==0).flatMap(s=>[s.source||'V',s.destination||'X']);}
  else if(key==='turntable')inputs=[v.input||(v.route==='drums'?'drums':'all')];
  else if(key==='playground'){if((v.mix??.5)<=0)continue;inputs=[v.input||'all'];}
  else if(['mutilator','bassFace'].includes(key)){if((v.mix??.5)<=0||(v.amount??.5)<=0)continue;inputs=[v.input||(key==='mutilator'?'D':'X')];}
  else {if((v.level??.5)<=0)continue;inputs=[v.source||'all'];}
  if(inputs.some(has))out.push(key);
 }
 return out;
}
const api=Object.freeze({SOURCES,label,matches,jumpTarget,soloSources,effectSettings,routedEffects,options:()=>SOURCES.map(key=>[key,label(key)])});root.MygrainEffectInputs=api;
if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
