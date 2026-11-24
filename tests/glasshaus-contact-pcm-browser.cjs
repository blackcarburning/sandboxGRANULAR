'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19046/mygrain/',out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{const rows=[];for(const [name,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
 try{const c=await b.newContext(),p=await c.newPage();p.setDefaultTimeout(60000);
 await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-robot-fixture'}});
 await p.goto(base+'glasshaus.css');await p.addScriptTag({url:base+'glasshaus-dsp.js?v=20261122-glasshaus-contact-2'});
 const stats=await p.evaluate(async()=>{
  const rows=[];
  for(const rate of [44100,48000])for(const contact of ['finger','mallet']){
   const state=MygrainGlassHaus.normalize({enabled:true,mode:'rub',contact,chord:'minor',pressure:.9,speed:1.5});state.objects.forEach(o=>{o.enabled=true;o.decay=120});state.steps.forEach((s,i)=>{s.on=i%4===0;s.degree=0;s.gate=2});
   const ctx=new OfflineAudioContext(2,rate*3,rate);await MygrainGlassHaus.prepare(ctx);MygrainGlassHaus.createGraph(ctx,ctx.destination,state,{time:.02,origin:.02,bpm:120});
   const start=performance.now(),buf=await ctx.startRendering(),pcm=buf.getChannelData(0);let sum=0,peak=0,maxDelta=0,previous=0;
   for(const v of pcm){if(!Number.isFinite(v))throw Error('Nonfinite');sum+=v*v;peak=Math.max(peak,Math.abs(v));maxDelta=Math.max(maxDelta,Math.abs(v-previous));previous=v;}
   rows.push({rate,contact,rms:Math.sqrt(sum/pcm.length),peak,maxDelta,renderMs:performance.now()-start});
  }
  return rows;
 });for(const r of stats){assert(r.rms>.001);assert(r.peak<.4);assert(r.maxDelta<.05,JSON.stringify(r));}rows.push({engine:name,stats});console.log('PASS native circular contact PCM',name,JSON.stringify(stats));
 }finally{await b.close();}
}fs.writeFileSync(out+'/glasshaus-contact-native-pcm.json',JSON.stringify(rows,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
