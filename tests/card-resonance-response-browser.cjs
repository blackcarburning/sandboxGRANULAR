'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{webkit,chromium}=require('playwright-core');
(async()=>{for(const [name,type]of Object.entries({webkit,chromium})){
 const browser=await type.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});
 try{const p=await browser.newPage();await p.goto('about:blank');await p.addScriptTag({content:fs.readFileSync(require.resolve('../loop-card-fx.js'),'utf8')});
 const result=await p.evaluate(async()=>{
  const peaks=[];
  for(const filterType of ['lowpass','highpass'])for(const filterSlope of MygrainLoopFx.SLOPES)for(const cutoff of [80,1000,16000]){
   const ctx=new OfflineAudioContext(1,24000,48000),g=MygrainLoopFx.createGraph(ctx,ctx.destination,{filterType,filterSlope,cutoff,resonance:4},120);
   const frequencies=Float32Array.from({length:2000},(_,i)=>20*1000**(i/1999)),total=new Float32Array(2000).fill(1),m=new Float32Array(2000),phase=new Float32Array(2000);
   for(const f of g.filters){f.getFrequencyResponse(frequencies,m,phase);for(let i=0;i<m.length;i++)total[i]*=m[i];}
   peaks.push({filterType,filterSlope,cutoff,peakDb:20*Math.log10(Math.max(...total))});g.dispose();
  }
  const pcm=[];
  for(const resonance of [.1,4]){const ctx=new OfflineAudioContext(1,24000,48000),g=MygrainLoopFx.createGraph(ctx,ctx.destination,{filterEnabled:false,resonance,lfoDepth:1},120),o=ctx.createOscillator();o.frequency.value=1000;o.connect(g.input);o.start();const a=(await ctx.startRendering()).getChannelData(0);pcm.push(Array.from(a.slice(12000,12100)));g.dispose();}
  return{peaks,bypassEqual:JSON.stringify(pcm[0])===JSON.stringify(pcm[1])};
 });assert(result.bypassEqual);for(const c of result.peaks)assert(c.peakDb<14&&c.peakDb>11,JSON.stringify(c));console.log('PASS response / bypass',name,result.peaks.length,'curves',Math.max(...result.peaks.map(c=>c.peakDb)),'dB maximum');
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
