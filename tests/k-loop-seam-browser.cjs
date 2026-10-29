'use strict';
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright-core');
(async()=>{for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});
 try{const page=await browser.newPage();await page.addScriptTag({path:require.resolve('../k-multitrack.js')});
 const results=await page.evaluate(async()=>{
  const out=[];
  for(const rate of [8000,44100,48000])for(const speed of [.5,1,2]){
   async function render(smooth){
    const ctx=new OfflineAudioContext(2,rate,rate),raw=ctx.createBuffer(2,Math.round(rate*.125),rate);
    for(let c=0;c<2;c++){const d=raw.getChannelData(c);for(let i=0;i<d.length;i++)d[i]=(c?-.3:.4)*(i<d.length/2?1:-1);}
    const k=MygrainKMultitrack.create({context:()=>ctx,bpm:()=>120,pitchRate:()=>speed,masterGain:()=>1,memoryBudget:()=>16e6,timing:()=>({time:0,origin:0}),route(g,p){g.connect(p);p.connect(ctx.destination);return[]},startSource(s,t,o){s.buffer=s.patternSectionBuffer;s.start(t,o)}});
    k.setBuffer(0,raw);const original=raw.getChannelData(0).slice();
    if(!smooth)k.bufferFor=()=>raw;
    k.start();const period=k.voices.get(0).source.loopEnd;const rendered=await ctx.startRendering();let seamStep=0;
    const data=rendered.getChannelData(0),cycle=period/speed;
    for(let t=cycle;t<.95;t+=cycle){const frame=Math.round(t*rate);for(let j=frame-2;j<=frame+2;j++)seamStep=Math.max(seamStep,Math.abs(data[j]-data[j-1]));}
    return {seamStep,period,frames:rendered.length,unchanged:original.every((v,i)=>v===raw.getChannelData(0)[i])};
   }
   const before=await render(false),after=await render(true);out.push({rate,speed,before:before.seamStep,after:after.seamStep});
   if(!(after.seamStep<before.seamStep*.02&&after.unchanged&&after.period===before.period&&after.frames===before.frames))throw Error(JSON.stringify(out.at(-1)));
  }return out;
 });assert.equal(results.length,9);console.log('PASS',engine,JSON.stringify(results));await page.close();
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
