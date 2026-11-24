const assert=require('node:assert/strict'),fs=require('fs'),{chromium,webkit}=require('playwright-core'),T=process.env.TASK,base=process.env.BASE,out=process.env.OUT;
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{}),rows=[];try{
 const p=await b.newPage();await p.goto(base+'ember.css');await p.addScriptTag({path:T+'/before/ember-dsp.js'});await p.evaluate(()=>window.OldEmber=MygrainEmber);await p.addScriptTag({path:T+'/stage/sandboxGRANULAR/ember-dsp.js'});
 for(const sr of [44100,48000])rows.push(...await p.evaluate(async sr=>{
  const M=MygrainEmber,old=OldEmber,rows=[],levels=arrays=>arrays.map(a=>{let square=0,peak=0;for(const x of a){if(!Number.isFinite(x))throw Error('Nonfinite PCM');square+=x*x;peak=Math.max(peak,Math.abs(x))}return{rms:Math.sqrt(square/a.length),peak}}),render=async(module,s)=>{const c=new OfflineAudioContext(2,Math.round(sr*1.5),sr);await module.prepare(c);const g=module.createGraph(c,c.destination,s,{time:0,origin:0,bpm:173}),b=await c.startRendering(),arrays=[0,1].map(ch=>b.getChannelData(ch).slice());g.dispose();if(g.lfoNodeCount||g.crossModNodeCount)throw Error('Leaked nodes');return arrays};
  for(const mode of ['hz','bpm'])for(const i of [1,2,17,37,109,257]){const s=M.randomPatch({...M.defaults(),enabled:true,tempo:i%2?null:93},Math.imul(i,0x9e3779b9)>>>0,mode),arrays=await render(M,s),l=levels(arrays);if(l.some(x=>x.rms<1e-5||x.peak>=1))throw Error('Generated stereo output invalid '+JSON.stringify({sr,mode,i,l}));rows.push({kind:'generated',sr,mode,i,frames:arrays[0].length,levels:l,crossMod:s.crossMod,pulseCrossMod:s.pulseCrossMod,targets:s.lfo.targets});}
  const saved=[{...old.defaults(),enabled:true},{...old.PRESETS[231].settings,enabled:true},old.randomPatch({...old.defaults(),enabled:true},0x9e3779b9,'bpm'),{...old.PRESETS[12].settings,enabled:true,cableStrengthBypass:true}];
  for(const [i,s]of saved.entries()){const a=await render(old,s),b=await render(M,s);let max=0;for(let ch=0;ch<2;ch++)for(let n=0;n<a[ch].length;n++)max=Math.max(max,Math.abs(a[ch][n]-b[ch][n]));if(max!==0)throw Error('Saved recipe PCM changed '+JSON.stringify({sr,i,max}));rows.push({kind:'saved-exact',sr,i,maximumDifference:max,levels:levels(b)});}
  return rows;
 },sr));
 fs.writeFileSync(out+'/'+engine+'-random-switches-pcm.json',JSON.stringify(rows,null,2));console.log('PASS',engine,'24 generated stereo renders and 8 exact saved old/new PCM comparisons at 44.1/48 kHz; finite/nonzero/bounded and disposed');
 }finally{await b.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
