'use strict';
// Compare the actual shipped graph against a pre-change worklet, at native rates.
// Run sequentially on an idle host; timings are observations, never pass/fail limits.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19047/mygrain/',out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
const before=fs.readFileSync(process.argv[2],'utf8');
(async()=>{const rows=[];for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
 try{const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(180000);
 await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-robot-fixture'}});
 await page.goto(base+'glasshaus.css');await page.addScriptTag({url:base+'glasshaus-dsp.js?v=20261123-glasshaus-hits-1'});
 for(const rate of [44100,48000])for(const [mode,depth]of [['strike',0],['rub',0],['strike',25],['rub',25]]){
 const row=await page.evaluate(async({before,base,rate,mode,depth})=>{
  const state=MygrainGlassHaus.normalize({enabled:true,root:36,mode,chord:'maj7',vibrato:{depth,sync:true,ratio:2}});
  state.objects.forEach(o=>{o.enabled=true;o.decay=120});state.steps.forEach((s,i)=>{s.on=true;s.degree=i%14;s.ratchet=2});
  const data=[];for(const tag of ['before','after']){
   const ctx=new OfflineAudioContext(2,rate*6,rate);let url;
   if(tag==='before'){
    const source=before.replace(/^import .*;\n/,"import '"+base+"glasshaus-dsp.js';\n").replace("registerProcessor('mygrain-glasshaus-v1'","registerProcessor('glasshaus-frozen-before'");
    url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));await ctx.audioWorklet.addModule(url);
    new AudioWorkletNode(ctx,'glasshaus-frozen-before',{outputChannelCount:[2],processorOptions:{state,bpm:240,time:0,origin:0}}).connect(ctx.destination);
   }else{await MygrainGlassHaus.prepare(ctx);MygrainGlassHaus.createGraph(ctx,ctx.destination,state,{bpm:240,time:0,origin:0});}
   const start=performance.now(),buffer=await ctx.startRendering();data.push({ms:performance.now()-start,pcm:[buffer.getChannelData(0),buffer.getChannelData(1)]});if(url)URL.revokeObjectURL(url);
  }
  let maxDifference=0,power=0,peak=0;for(let ch=0;ch<2;ch++)for(let i=0;i<data[0].pcm[ch].length;i++){
   const v=data[1].pcm[ch][i];if(!Number.isFinite(v))throw Error('Nonfinite PCM');maxDifference=Math.max(maxDifference,Math.abs(v-data[0].pcm[ch][i]));power+=v*v;peak=Math.max(peak,Math.abs(v));
  }
  return{rate,mode,depth,beforeMs:data[0].ms,afterMs:data[1].ms,speedup:data[0].ms/data[1].ms,maxDifference,rms:Math.sqrt(power/(rate*6*2)),peak};
 },{before,base,rate,mode,depth});assert.equal(row.maxDifference,0,JSON.stringify({engine,...row}));assert(row.rms>.001);assert(row.peak<=.921);rows.push({engine,...row});console.log(JSON.stringify({engine,...row}));
 }
 }finally{await browser.close()}
}fs.writeFileSync(out+'/glasshaus-cpu-native-parity.json',JSON.stringify(rows,null,2));console.log('PASS 16 dense native stereo PCM comparisons: Chromium/WebKit, 44.1/48 kHz, strike/rub, vibrato off/on; exact samples');})().catch(e=>{console.error(e);process.exitCode=1});
