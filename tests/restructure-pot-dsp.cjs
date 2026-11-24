'use strict';
// Real native processors, not UI state or reimplementations of their DSP.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const names=['mutilator','bassFace','turntable','resonator','wireWorld','sonicCrystal','bubbleChamber','wasp','playground','henrysHose','heavyLifter'];
const folder=fs.mkdtempSync(path.join(process.env.MYGRAIN_SCRATCH_ROOT||os.tmpdir(),'restructure-pot-test-'));
try{
 const frames=6000,pcm=new Float32Array(names.length*frames*2);
 for(let n=0;n<names.length;n++)for(let i=0;i<frames;i++){pcm[(n*frames+i)*2]=.4*Math.sin(2*Math.PI*220*i/48000);pcm[(n*frames+i)*2+1]=.3*Math.sin(2*Math.PI*311*i/48000);}
 fs.writeFileSync(path.join(folder,'dry.f32'),Buffer.from(pcm.buffer));
 fs.writeFileSync(path.join(folder,'effects.json'),JSON.stringify({bpm:120,recipe:names.map((name,i)=>({frames,effect:{name,amount:.6,seed:7+i}}))}));
 execFileSync(process.execPath,[path.resolve(__dirname,'../scripts/restructure-effects.cjs'),folder],{timeout:65000,stdio:'pipe'});
 const bytes=fs.readFileSync(path.join(folder,'wet.f32')),wet=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));assert.equal(wet.length,pcm.length);
 for(let n=0;n<names.length;n++){
  let diff=0,energy=0;for(let i=n*frames*2;i<(n+1)*frames*2;i++){assert(Number.isFinite(wet[i]));diff+=(wet[i]-pcm[i])**2;energy+=wet[i]**2;}
  assert(diff/(frames*2)>1e-8,names[n]+' did not change PCM');assert(energy>1e-8,names[n]+' silent');
 }
 console.log('PASS all eleven native per-grain Cooking Pot processors');
}finally{fs.rmSync(folder,{recursive:true,force:true});}
