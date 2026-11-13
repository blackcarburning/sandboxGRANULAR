/* Optional serial effects rack. Missing state retains the original routing. */
(function(root){
'use strict';
const KEYS=['mutilator','bassFace','turntable','resonator','wireWorld','sonicCrystal','bubbleChamber','wasp','playground'];
function normalize(value){const order=Array.isArray(value?.order)?value.order:[],state={version:1,enabled:value?.enabled===true,order:[...new Set([...order.filter(k=>KEYS.includes(k)),...KEYS])]};
 // Optional group-switch memory is not an audio routing flag. Legacy enabled
 // continues to select the original native/serial engine without migration.
 if(typeof value?.power?.enabled==='boolean'&&value.power.remembered&&typeof value.power.remembered==='object')state.power={enabled:value.power.enabled,remembered:Object.fromEntries([...KEYS,'masterBaker'].map(key=>[key,value.power.remembered[key]===true]))};return state;}
function shuffle(value,random=Math.random){const order=normalize(value).order;for(let i=order.length-1;i>0;i--){const j=Math.max(0,Math.min(i,Math.floor(random()*(i+1))));[order[i],order[j]]=[order[j],order[i]];}return{version:1,enabled:true,order};}
// A combined wet return cannot be split back into its original sources. A later
// selector may receive it only when that selector covers its entire provenance.
const leaves=key=>key==='K'?['K1','K2','K3','K4','K5']:key==='drums'?['drumKick','drumSnare','drumHat','drumPerc','drumClap','drumCymbals','drumEtc','drumRoll']:[key];
function covers(selection,provenance){if(selection.includes('all'))return true;const allowed=new Set(selection.flatMap(leaves));return provenance.length>0&&provenance.flatMap(leaves).every(key=>allowed.has(key));}
const resonatorSlots=v=>[0,1].map(i=>({enabled:i===0,level:.45,source:i===0?'drumKick':'X',...v.slots?.[i]}));
function scope(key,v){if(key==='resonator')return [...new Set(resonatorSlots(v).filter(s=>s.enabled&&s.level>0).map(s=>s.source))];if(key==='wasp')return ['all'];if(key==='turntable')return [v.input||(v.route==='drums'?'drums':'all')];return [v.input||v.source||(key==='mutilator'?'D':key==='bassFace'?'X':'all')];}
function renderVersion(modes={}){
 const pot=normalize(modes.cookingPot);if(!pot.enabled)return 0;
 const w=modes.wasp||{},v={...modes,mutilator:modes.loopD?.mutilator||{},resonator:modes.resonatorR||{},wasp:w,playground:w.playground||{}};
 const active=pot.order.filter(key=>{const s=v[key]||{};return s.enabled&&(key==='resonator'?resonatorSlots(s).some(x=>x.enabled&&x.level>0):['mutilator','bassFace'].includes(key)?(s.amount??.5)>0&&(s.mix??.5)>0:['wireWorld','sonicCrystal','bubbleChamber'].includes(key)?(s.level??.5)>0:true);});
 for(let i=1;i<active.length;i++){const key=active[i],s=v[key],slots=key==='resonator'?resonatorSlots(s).filter(x=>x.enabled&&x.level>0).map(x=>[x.source]):[scope(key,s)];for(const selection of slots)for(const prior of active.slice(0,i))if(!covers(selection,scope(prior,v[prior])))return 3;}
 return KEYS.some(k=>v[k]?.enabled)?2:0;
}
const api={KEYS,normalize,shuffle,covers,scope,renderVersion};if(typeof module==='object'&&module.exports)module.exports=api;else root.MygrainCookingPot=api;
})(globalThis);
