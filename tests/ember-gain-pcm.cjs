'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const task=process.env.TASK,out=process.env.OUT;assert(task&&out,'TASK and OUT evidence paths are required');
(async()=>{for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{}),rows=[];
 try{
  for(const sr of [44100,48000]){
   // Paired complete bank; each bounded batch owns and closes its native contexts.
   for(let offset=0;offset<200;offset+=10){const p=await browser.newPage();try{
    await p.addScriptTag({path:task+'/before/ember-dsp.js'});await p.evaluate(()=>window.OldEmber=MygrainEmber);await p.addScriptTag({path:require.resolve('../ember-dsp.js')});
    rows.push(...await p.evaluate(async({sr,offset})=>{
     const M=MygrainEmber,O=OldEmber,rows=[];
     if(JSON.stringify(M.PRESETS)!==JSON.stringify(O.PRESETS)||JSON.stringify(M.STARTERS)!==JSON.stringify(O.STARTERS)||JSON.stringify(M.defaults())!==JSON.stringify(O.defaults()))throw Error('Recipe/default changed');
     const render=async(m,s)=>{const c=new OfflineAudioContext(2,Math.ceil(sr*1.5),sr),g=m.createGraph(c,c.destination,s,{time:0,origin:0,bpm:123}),b=await c.startRendering();g.dispose();return b;};
     const levels=b=>[0,1].map(ch=>{const a=b.getChannelData(ch);let sum=0,peak=0;for(let i=Math.round(sr*.05);i<a.length;i++){const v=a[i];if(!Number.isFinite(v))throw Error('nonfinite');sum+=v*v;peak=Math.max(peak,Math.abs(v));}return{rms:Math.sqrt(sum/(a.length-Math.round(sr*.05))),peak}});
     for(const preset of M.PRESETS.slice(offset,offset+10)){const s={...preset.settings,enabled:true},before=levels(await render(O,s)),b=await render(M,s),after=levels(b),db=after.map((v,ch)=>20*Math.log10(v.rms/before[ch].rms));let side=0;for(let i=0;i<b.length;i++)side+=(b.getChannelData(0)[i]-b.getChannelData(1)[i])**2;rows.push({kind:'bank',sr,id:preset.id,before,after,db,side:Math.sqrt(side/b.length)});}
     return rows;
    },{sr,offset}));
   }finally{await p.close()}}
   console.log(engine,sr,'200 paired stereo factory renders complete');
   const p=await browser.newPage();try{
    await p.addScriptTag({path:task+'/before/ember-dsp.js'});await p.evaluate(()=>window.OldEmber=MygrainEmber);await p.addScriptTag({path:require.resolve('../ember-dsp.js')});
    rows.push(...await p.evaluate(async sr=>{
     const M=MygrainEmber,O=OldEmber,rows=[],render=async(m,s,seconds=1)=>{const c=new OfflineAudioContext(2,sr*seconds,sr),g=m.createGraph(c,c.destination,s,{time:0,origin:0}),b=await c.startRendering();g.dispose();if(g.crossModNodeCount||g.lfoNodeCount)throw Error('retained resources');return [b.getChannelData(0).slice(sr/5),b.getChannelData(1).slice(sr/5)];},measure=a=>{let energy=0,peak=0;for(const v of a){if(!Number.isFinite(v))throw Error('nonfinite PCM');energy+=v*v;peak=Math.max(peak,Math.abs(v));}return{rms:Math.sqrt(energy/a.length),peak}},error=(a,b)=>a.reduce((v,x,i)=>Math.max(v,Math.abs(x-b[i])),0);
     const base={...M.defaults(),enabled:true,level:1,wave:'sine',frequencies:[220,331,440,550,660],feedback:0,bizarre:0,modDepth:0,cables:[{from:'osc1',to:'directL',amount:1},{from:'osc2',to:'directR',amount:1}]},old=await render(O,base),full=await render(M,base),half=await render(M,{...base,level:.5});
     for(let ch=0;ch<2;ch++){const before=measure(old[ch]),after=measure(full[ch]);if(after.rms<.17||after.rms>.19||error(half[ch],full[ch].map(v=>v*.5))>1e-7)throw Error('nominal gain/scaling failure');rows.push({kind:'nominal',sr,ch,before,after,db:20*Math.log10(after.rms/before.rms)});}
     for(const changes of [{enabled:false},{level:0},{cables:[]}]){const a=await render(O,{...base,...changes}),b=await render(M,{...base,...changes});if(b.some((v,ch)=>error(v,a[ch])!==0||measure(v).peak!==0))throw Error('inactive PCM changed');rows.push({kind:'inactive',sr,changes,exact:true});}
     const lfo=await render(M,{...base,level:0,lfo:M.normalizeLfo({enabled:true,wave:'sine',rate:2,depth:1,targets:[{key:'level',inverse:true}]})});if(lfo.some(a=>measure(a).rms<.05))throw Error('Volume LFO at zero base silenced');rows.push({kind:'zero-base-lfo',sr,after:lfo.map(measure)});
     const cables=[];for(const from of M.OUTPUTS)for(const to of M.INPUTS.filter(k=>!k.startsWith('mod')))if(cables.length<64)cables.push({from,to,amount:1});
     const dense=await render(M,{...base,wave:'square',crossMod:Array(5).fill(true),crossModDepth:1,cables,feedback:.78,bizarre:1},4);rows.push({kind:'dense64',sr,after:dense.map(measure)});
     // Sustained, seeded-noise and percussive TOUCH exercise different gain paths.
     for(const from of ['noise','touch','pulse1']){const c=new OfflineAudioContext(2,sr*2,sr),g=M.createGraph(c,c.destination,{...base,cables:[{from,to:'directL',amount:1},{from,to:'warmR',amount:1}],pulseFrequencies:[31.7,null,null,null,null,null]},{time:0,origin:0});if(from==='touch')g.touch();const b=await c.startRendering();const after=[0,1].map(ch=>measure(b.getChannelData(ch)));g.dispose();if(after.some(v=>v.rms<.0001))throw Error('silent '+from);rows.push({kind:from,sr,after});}
     return rows;
    },sr));
   }finally{await p.close()}
   for(let offset=0;offset<32;offset+=8){const p=await browser.newPage();try{await p.addScriptTag({path:require.resolve('../ember-dsp.js')});rows.push(...await p.evaluate(async({sr,offset})=>{const M=MygrainEmber,rows=[];for(let i=offset;i<offset+8;i++){const s=M.randomPatch({...M.defaults(),enabled:true,level:1},i+123,i%2?'hz':'bpm');s.feedback=.78;const c=new OfflineAudioContext(2,sr,sr),g=M.createGraph(c,c.destination,s,{time:0,origin:0}),b=await c.startRendering(),after=[0,1].map(ch=>{let sum=0,peak=0;for(const v of b.getChannelData(ch)){if(!Number.isFinite(v))throw Error('nonfinite random');sum+=v*v;peak=Math.max(peak,Math.abs(v));}return{rms:Math.sqrt(sum/b.length),peak}});g.dispose();rows.push({kind:'random',sr,seed:i+123,after});}return rows},{sr,offset}));}finally{await p.close()}}
  }
  fs.writeFileSync(out+'/'+engine+'-ember-gain-pcm.json',JSON.stringify(rows,null,2));
  const bank=rows.filter(r=>r.kind==='bank');assert.equal(bank.length,400);for(const r of bank){assert(r.after.every(v=>v.rms>1e-4&&v.peak<.9),JSON.stringify(r));assert(r.db.every(db=>db>9&&db<12.6),JSON.stringify(r));assert(r.side>Math.min(...r.after.map(v=>v.rms))*.1,JSON.stringify(r));}
  for(const r of rows.filter(r=>r.after))for(const v of (Array.isArray(r.after)?r.after:[r.after]))assert(v.peak<.9&&Number.isFinite(v.rms),JSON.stringify(r));
  assert.equal(rows.length,484);fs.writeFileSync(out+'/'+engine+'-ember-gain-pcm.json',JSON.stringify(rows,null,2));console.log('PASS',engine,rows.length,'stereo comparisons/checks: all factory patches, gain/scaling, exact inactivity, LFO, 64 cables, noise/TOUCH/pulses and random extremes');
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
