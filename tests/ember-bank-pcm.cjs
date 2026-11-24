'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const out=process.env.OUT;
(async()=>{for(const[name,type]of Object.entries({chromium,webkit})){
const browser=await type.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
try{
const pcm=[];{
  for(const sr of [44100,48000]){const rows=[];for(let offset=0;offset<200;offset+=25){const p=await browser.newPage();await p.addScriptTag({path:require.resolve('../ember-dsp.js')});try{rows.push(...await p.evaluate(async({sr,offset})=>{const M=MygrainEmber,rows=[];for(const preset of M.PRESETS.slice(offset,offset+25)){const ctx=new OfflineAudioContext(2,Math.ceil(sr*1.5),sr),graph=M.createGraph(ctx,ctx.destination,{...preset.settings,enabled:true},{bpm:123,time:0,origin:0}),b=await ctx.startRendering(),L=b.getChannelData(0),R=b.getChannelData(1);let l=0,r=0,d=0,peak=0,delta=0;for(let i=Math.round(sr*.05);i<L.length;i++){if(!Number.isFinite(L[i])||!Number.isFinite(R[i]))throw Error('Nonfinite '+preset.id);l+=L[i]*L[i];r+=R[i]*R[i];d+=(L[i]-R[i])**2;peak=Math.max(peak,Math.abs(L[i]),Math.abs(R[i]));delta+=(L[i]-L[i-1])**2+(R[i]-R[i-1])**2;}const n=L.length-Math.round(sr*.05);rows.push({id:preset.id,sr,rmsL:Math.sqrt(l/n),rmsR:Math.sqrt(r/n),side:Math.sqrt(d/n),peak,edge:Math.sqrt(delta/(2*n))});graph.dispose()}return rows},{sr,offset}));}finally{await p.close()}}for(const row of rows){assert(row.rmsL>1e-4&&row.rmsR>1e-4,JSON.stringify(row));assert(row.side>Math.min(row.rmsL,row.rmsR)*.15,JSON.stringify(row));assert(row.peak<.9,JSON.stringify(row))}pcm.push(...rows);console.log(name,sr,rows.length,'finite bounded non-silent stereo renders');}
 }
fs.writeFileSync(out+'/'+name+'-ember-bank-pcm.json',JSON.stringify(pcm,null,2));console.log('PASS',name,'all 400 stereo PCM renders');}finally{await browser.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
