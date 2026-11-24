const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core'),base=process.env.BASE,task=process.env.TASK;
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
 try{
  const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(90000);await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());assert((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).ok());await page.goto(base);await page.waitForFunction(()=>window.MygrainEmberSamples&&window.MygrainEmber?.loopActive);
  const rows=await page.evaluate(async()=>{
   const results=[];
   for(const rate of [44100,48000])for(const range of [[5,8],[6,6]]){
    const sound={...MygrainEmber.defaults(),enabled:true,level:.47,tempo:120,stepLoop:{enabled:true,start:range[0],end:range[1]}};sound.sampleSource.frames=12001;sound.matrix=sound.matrix.map(row=>row.map(()=>0));sound.voices.forEach((voice,index)=>{voice.on=index===0;voice.pattern=Array(16).fill(0);voice.chance=1;voice.glitch=0;voice.detune=0;voice.reverb.mix=0;voice.filter.notch=0;voice.lfo.widthDepth=voice.lfo.filterDepth=voice.lfo.reverbDepth=voice.lfo.panDepth=0;});
    const pattern=range[0]===range[1]?[1]:[1,0,2,0];pattern.forEach((value,index)=>sound.voices[0].pattern[range[0]-1+index]=value);
    const manual=structuredClone(sound),disabled=structuredClone(sound);delete manual.stepLoop;disabled.stepLoop.enabled=false;manual.voices[0].pattern=Array.from({length:16},(_,index)=>pattern[index%pattern.length]);
    const outputs=[];
    for(const state of [sound,manual,disabled]){const audio=new OfflineAudioContext(2,Math.round(rate*1.3),rate);await MygrainEmber.prepare(audio,state);const graph=MygrainEmber.createGraph(audio,audio.destination,state,{time:0,origin:0,bpm:120});outputs.push(await audio.startRendering());graph.dispose();}
    let referenceDifference=0,offDifferenceEnergy=0,energy=0;
    for(let channel=0;channel<2;channel++){const actual=outputs[0].getChannelData(channel),expected=outputs[1].getChannelData(channel),off=outputs[2].getChannelData(channel);for(let frame=0;frame<actual.length;frame++){if(!Number.isFinite(actual[frame]))throw Error('Nonfinite loop PCM');referenceDifference=Math.max(referenceDifference,Math.abs(actual[frame]-expected[frame]));offDifferenceEnergy+=(actual[frame]-off[frame])**2;energy+=actual[frame]**2;}}
    results.push({rate,range,referenceDifference,offDifferenceEnergy,energy,source:'actual industry corpus'});
   }
   return results;
  });
  for(const row of rows){assert(row.referenceDifference<1e-5,JSON.stringify(row));assert(row.offDifferenceEnergy>1e-3);assert(row.energy>1e-3);}fs.writeFileSync(task+'/evidence/'+engine+'-step-loop-pcm.json',JSON.stringify(rows,null,2));console.log('PASS',engine,'actual industry PCM: four-step/single-step loops match manual repetition at both rates and differ from Off');
 }finally{await browser.close();}
}})().catch(error=>{console.error(error);process.exitCode=1;});
