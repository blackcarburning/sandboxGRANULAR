/* Shared control modulation. Saved recipes are never overwritten by effective values. */
(function(root){'use strict';
const H=root.MygrainHeavyLifter||(typeof module==='object'?require('./heavy-lifter-dsp.js'):null);
const range=(def,min=0,max=1)=>({def,min,max});
const SPECS={
 wireWorld:Object.fromEntries(Object.entries({dispersion:.72,travel:.38,feedback:.42,damping:.35,width:.75,level:.5}).map(([k,v])=>[k,range(v)])),
 sonicCrystal:{...Object.fromEntries(Object.entries({tuning:.48,spacing:.35,coupling:.55,disorder:.12,defect:.25,loss:.25,reflection:.28,width:.7,level:.7}).map(([k,v])=>[k,range(v)])),cells:{def:8,choices:[4,8,12]}},
 bubbleChamber:{...Object.fromEntries(Object.entries({radius:.48,spread:.42,decay:.4,resonance:0,damping:0,fizz:0,motion:.86,flow:0,width:.62,level:.88}).map(([k,v])=>[k,range(v)])),population:{def:8,choices:[8,16,24]}},
 bassFace:Object.fromEntries(Object.entries({amount:.35,tone:.45,mix:.5,body:.85}).map(([k,v])=>[k,range(v)])),
 mutilator:{...Object.fromEntries(Object.entries({amount:.5,tone:.5,mix:.5,resonance:.5,sweep:1,freeDepth:0}).map(([k,v])=>[k,range(v)])),freeRate:range(1,.125,12),output:range(0,-18,6),cycleBeats:{def:4,choices:[.5,1,2,4,8]}}
};
const KEYS=Object.keys(SPECS),clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),targets=k=>Object.keys(SPECS[k]||{});
function normalize(key,value){const v=value&&typeof value==='object'?value:{},s=H.normalizeLfo({...v,targets:[]});s.targets=[...new Set((Array.isArray(v.targets)?v.targets:[]).filter(t=>targets(key).includes(t)))];return s;}
function activeTargets(key,s){const v=normalize(key,s?.lfo);if(!v.depth)return[];return v.targets.filter(k=>key!=='mutilator'||(k==='cycleBeats'?s.rhythm: ['freeRate','freeDepth'].includes(k)?!s.rhythm:k==='sweep'?s.rhythm||(s.freeDepth||0)>0||v.targets.includes('freeDepth'):true)).filter(k=>key!=='bubbleChamber'||s.version!==1||!['resonance','damping','fizz','flow'].includes(k));}
const has=(key,s)=>!!activeTargets(key,s).length;
const canMove=(key,s,k)=>activeTargets(key,s).includes(k);
function audible(key,s){if(!s?.enabled)return false;return ['bassFace','mutilator'].includes(key)?((s.amount??.5)>0||canMove(key,s,'amount'))&&((s.mix??.5)>0||canMove(key,s,'mix')):(s.level??.5)>0||canMove(key,s,'level');}
function controlValue(key,k,base,w,depth){const spec=SPECS[key][k],v=base??spec.def;if(spec.choices){const choices=spec.choices,i=Math.max(0,choices.indexOf(v)),n=clamp(i/(choices.length-1)+depth*w);return choices[Math.round(n*(choices.length-1))];}return spec.min+(spec.max-spec.min)*clamp((v-spec.min)/(spec.max-spec.min)+depth*w);}
class Control {
 constructor(key,sr,s){this.key=key;this.sr=sr;this.clocks=[{origin:0,bpm:120,at:0}];this.frame=0;this.initial=true;this.set(s);}
 set(s){this.base=s;this.lfo=normalize(this.key,s.lfo);this.targets=activeTargets(this.key,s);this.effective={...s};for(const [k,v]of Object.entries(SPECS[this.key]))if(this.effective[k]===undefined)this.effective[k]=v.def;this.initial=true;}
 syncClock(c){if(!c||![c.origin,c.bpm,c.at].every(Number.isFinite)||c.bpm<=0)return;this.clocks=this.clocks.filter(x=>x.at!==c.at);this.clocks.push({...c,bpm:clamp(c.bpm,1,300)});this.clocks.sort((a,b)=>a.at-b.at);if(this.clocks.length>32)this.clocks.splice(0,this.clocks.length-32);}
 clock(t){let c=this.clocks[0];for(let i=1;i<this.clocks.length&&this.clocks[i].at<=t;i++)c=this.clocks[i];return c;}
 update(t){if(!this.targets.length)return false;if((this.frame++&31)!==0)return false;const c=this.clock(t),w=H.lfoValue(this.lfo,(t-c.origin)*c.bpm/(60*H.lfoPeriod(this.lfo)));this.wave=this.initial?w:this.wave+(w-this.wave)*(1-Math.exp(-32/(this.sr*.001)));this.initial=false;for(const k of this.targets)this.effective[k]=controlValue(this.key,k,this.base[k],this.wave,this.lfo.depth);return true;}
}
function renderVersion(modes={}){for(const key of KEYS){const s=key==='mutilator'?modes.loopD?.mutilator:modes[key];if(audible(key,s)&&has(key,s)&&(s.input||s.source)!=='DAW'&&(key!=='mutilator'||(s.input||'D')!=='D'||modes.loopD?.enabled))return 9;}return 0;}
function liquidize(values,random=Math.random){const draw=()=>{const n=random();if(!Number.isFinite(n))throw Error('Invalid Liquidizer random value.');return clamp(n,0,1-Number.EPSILON);},pick=a=>a[Math.floor(draw()*a.length)],out=structuredClone(values);for(const key of [...KEYS,'heavyLifter']){const s=out[key];if(!s)continue;const isHeavy=key==='heavyLifter',old=isHeavy?H.normalizeLfo(s.lfo):normalize(key,s.lfo),eligible=isHeavy?['level','width',...Object.keys(H.PARAMS[s.mode]).map(k=>s.mode+'.'+k)]:targets(key).filter(k=>key!=='mutilator'||(k==='cycleBeats'?s.rhythm:k==='freeDepth'?!s.rhythm:k==='freeRate'?!s.rhythm&&(s.freeDepth||0)>0:k==='sweep'?s.rhythm||(s.freeDepth||0)>0:true)).filter(k=>key!=='bubbleChamber'||s.version!==1||!['resonance','damping','fizz','flow'].includes(k));for(let i=eligible.length-1;i>0;i--){const j=Math.floor(draw()*(i+1));[eligible[i],eligible[j]]=[eligible[j],eligible[i]];}const assigned=eligible.slice(0,1+Math.floor(draw()*3));if(key==='bubbleChamber'&&s.version===2&&assigned.includes('motion')&&!(s.flow>0||s.fizz>0||assigned.includes('flow')||assigned.includes('fizz')))assigned[assigned.indexOf('motion')]='flow';s.lfo={...old,wave:pick(H.LFO_WAVES),beats:pick(H.LFO_RATES),timing:pick(['straight','dotted','triplet']),pulseWidth:.1+draw()*.8,depth:.8+draw()*.2,targets:isHeavy?[...old.targets.filter(t=>t.includes('.')&&!t.startsWith(s.mode+'.')),...assigned]:assigned};}return out;}
const api={SPECS,KEYS,targets,normalize,activeTargets,has,canMove,audible,controlValue,Control,renderVersion,liquidize};root.MygrainEffectLfo=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
