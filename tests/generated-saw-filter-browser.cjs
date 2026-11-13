'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL,out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp';assert.match(base||'',/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{const results=[];for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});try{
 const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(60000);await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
 await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 const result=await p.evaluate(async()=>{
 const recipes=Array.from({length:60},(_,i)=>buildGeneratedSourceFilterRecipe(mygrainUtils.createSeededRandom('saw-recipe-'+i)));
 const same=JSON.stringify(buildGeneratedSourceFilterRecipe(mygrainUtils.createSeededRandom('saw-fixed')))===JSON.stringify(buildGeneratedSourceFilterRecipe(mygrainUtils.createSeededRandom('saw-fixed')));
 const original=window.MygrainLoopFx,captures=[];window.MygrainLoopFx={...original,createGraph(...args){const g=original.createGraph(...args);captures.push({stages:g.filters.length,types:g.filters.map(x=>x.type),frequency:g.lfo?.frequency.value||0,settings:g.settings});return g}};
 const rows=[];
 try {for(const rate of [44100,48000]){
  const source=new AudioBuffer({numberOfChannels:2,length:rate,sampleRate:rate});for(let ch=0;ch<2;ch++){const d=source.getChannelData(ch);for(let i=0;i<d.length;i++)d[i]=.12*Math.sin(2*Math.PI*100*i/rate)+.12*Math.sin(2*Math.PI*6000*i/rate)}
  for(const type of ['lowpass','highpass']){
   const recipe={...buildGeneratedSourceFilterRecipe(()=>0.5),filterType:type,cutoff:1000,lfoDepth:0};const b=await renderGeneratedSourceFilter(source,120,recipe),d=b.getChannelData(0);
   const amplitude=f=>{let a=0,b=0;const start=Math.floor(rate*.2);for(let i=start;i<d.length;i++){a+=d[i]*Math.cos(2*Math.PI*f*i/rate);b+=d[i]*Math.sin(2*Math.PI*f*i/rate)}return 2*Math.hypot(a,b)/(d.length-start)};
   rows.push({rate,type,frames:b.length,low:amplitude(100),high:amplitude(6000)});
  }
  for(const beats of [.25,.5,1,2,4])for(const type of ['lowpass','highpass']){
   const recipe={...buildGeneratedSourceFilterRecipe(()=>0.5),filterType:type,lfoBeats:beats};const b=await renderGeneratedSourceFilter(source,120,recipe);let sum=0;for(const x of b.getChannelData(0)){if(!Number.isFinite(x))throw Error('Invalid filtered PCM');sum+=x*x}rows.push({rate,type,beats,frames:b.length,rms:Math.sqrt(sum/b.length)});
  }
 }}finally{window.MygrainLoopFx=original}
 return {recipes,same,captures,rows};
 });
 assert(result.same);assert.deepEqual([...new Set(result.recipes.map(x=>x.lfoBeats))].sort((a,b)=>a-b),[.25,.5,1,2,4]);assert.deepEqual([...new Set(result.recipes.map(x=>x.filterType))].sort(),['highpass','lowpass']);for(const x of result.recipes){assert.equal(x.filterSlope,96);assert.equal(x.lfoWave,'sawtooth');assert(x.lfoDepth>0)}
 for(const row of result.rows){assert.equal(row.frames,row.rate);if(row.beats){assert(row.rms>.00001)}else if(row.type==='lowpass'){assert(row.low>.02&&row.high<row.low*.005,JSON.stringify(row))}else assert(row.high>.02&&row.low<row.high*.005,JSON.stringify(row))}
 for(const cap of result.captures){assert.equal(cap.stages,8);if(cap.settings.lfoDepth)assert(Math.abs(cap.frequency-2/cap.settings.lfoBeats)<1e-6)}assert.deepEqual(errors,[]);results.push({engine,...result,errors});console.log('PASS 96 dB LP/HP actual attenuation, all five saw rates at both sample rates:',engine);

 }finally{await browser.close()}}
 fs.writeFileSync(out+'/generated-saw-filter.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
