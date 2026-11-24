/* All recipes, both native rates; pitch/level-neutral diversity corpus. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const M=require('../enemy-drone-dsp.js'),B=require('../enemy-drone-presets.js'),out=process.env.OUT;assert(out);
const rows=B.rows;assert.equal(rows.length,200);assert.equal(new Set(rows.map(x=>x.id)).size,200);assert.equal(new Set(rows.map(x=>x.name)).size,200);
const groups=Object.groupBy?Object.groupBy(rows,x=>x.family):rows.reduce((a,r)=>((a[r.family]||=[]).push(r),a),{});assert.equal(Object.keys(groups).length,10);for(const g of Object.values(groups))assert.equal(g.length,20);
const normal=s=>{const v=M.normalize(s),base=Math.min(...v.voices.filter(x=>x.on).map(x=>x.note));v.enabled=true;v.level=.45;v.voices.forEach(x=>{if(x.on)x.note-=base;else x.note=0;});return v;};
assert.equal(new Set(rows.map(x=>JSON.stringify(normal(x.settings)))).size,200,'Transposed clones');
for(const row of rows){assert.deepEqual(M.normalize(row.settings),row.settings);const fresh=B.clone(row.id);fresh.voices[0].note=96;assert.notDeepEqual(fresh,row.settings);assert.equal(B.identify({...row.settings,enabled:true,level:.07}),row.id);}
fs.mkdirSync(out+'/neutral-pcm',{recursive:true});const results=[];
function render(s,rate,seconds){const e=new M.Engine(rate,s),n=Math.round(rate*seconds),l=new Float32Array(n),r=new Float32Array(n);e.process(l,r);let a=0,b=0,c=0,peak=0;const from=Math.round(rate*.25);for(let i=0;i<n;i++){assert(Number.isFinite(l[i])&&Number.isFinite(r[i]));peak=Math.max(peak,Math.abs(l[i]),Math.abs(r[i]));if(i>=from){a+=l[i]**2;b+=r[i]**2;c+=l[i]*r[i];}}for(const key of ['phase','last','gains','freq','panL','panR','roomFilter','roomReads','dcX','dcY','low'])assert(e[key].every(Number.isFinite),key);for(const x of [...e.delay,...e.room])assert(x.every(Number.isFinite));assert(peak<=.850001);assert(a>0&&b>0);return{l,r,metrics:{rms:Math.sqrt((a+b)/(n-from)/2),peak,correlation:c/Math.sqrt(a*b),side:Math.sqrt(Math.max(0,a+b-2*c)/(a+b+2*c))}};}
for(const rate of [44100,48000])for(const [i,row]of rows.entries()){
 const s=M.normalize({...row.settings,enabled:true}),actual=render(s,rate,2.5);assert(actual.metrics.rms>.00015,row.id);results.push({id:row.id,family:row.family,rate,...actual.metrics});
 if(rate===44100){const ns=normal(s);ns.voices.forEach(x=>{x.note=x.on?x.note+36:48;});const neutral=render(ns,rate,2.5),stereo=new Float32Array(neutral.l.length*2);for(let j=0;j<neutral.l.length;j++){stereo[j*2]=neutral.l[j];stereo[j*2+1]=neutral.r[j];}fs.writeFileSync(out+'/neutral-pcm/'+row.id+'.f32',Buffer.from(stereo.buffer));}
 if(i%20===19)console.log('Rendered',rate,i+1,'/200');
}
// Preset addition never edits either audio engine: compare exact old saved PCM.
const old=require(process.env.ENEMY_BASELINE_DSP);for(const routing of ['pairs','ring','swarm'])for(const engineRevision of [undefined,2]){const s=M.normalize({engineRevision,enabled:true,routing,tone:.63,cross:.57});const a=render(s,44100,.5),e=new old.Engine(44100,s),l=new Float32Array(a.l.length),r=new Float32Array(l.length);e.process(l,r);assert.deepEqual(a.l,l);assert.deepEqual(a.r,r);}
fs.writeFileSync(out+'/preset-core.json',JSON.stringify({count:rows.length,renderCount:results.length,results},null,2));console.log('PASS 400 actual stereo renders + 200 root/level-neutral renders, unique recipes, exact retained DSP PCM');
