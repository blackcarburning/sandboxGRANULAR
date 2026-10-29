const assert=require('node:assert/strict');
const {chromium,webkit}=require('/root/.openclaw/workspace/node_modules/playwright-core');
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});
 try{const c=await b.newContext({viewport:{width:390,height:844}});const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='https://openclaw.blackcarburning.com')return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"seq-fixture"}};'});if(u.pathname.includes('/api/'))return r.fulfill({json:{ok:true,authenticated:true,user:{username:'seq-fixture'},files:[],songs:[],folders:[],samples:[],patches:[]}});if(!['GET','HEAD'].includes(r.request().method()))return r.abort();return r.continue()});
 await p.goto('https://openclaw.blackcarburning.com/mygrain/');await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);

 await p.waitForFunction(()=>window.mygrainLoopFx&&window.mygrainKMultitrack);
 await p.evaluate(()=>{for(const card of document.querySelectorAll('.performance-feature-card,#noiseCard'))mygrainDemand.run(card)});
 await p.waitForTimeout(200);
 assert.equal(await p.locator('[data-loop-fx="pan"]').count(),12); // 14 cards minus native K and M+
 assert.equal(await p.locator('[data-loop-fx-key="K"] [data-loop-fx="pan"]').count(),0);
 assert.equal(await p.locator('[data-loop-fx-key="M+"] [data-loop-fx="pan"]').count(),0);
 await p.locator('#loopFx-X-pan').fill('-0.65');await p.locator('#grainSynthAPan').fill('-75');await p.locator('#grainSynthBPan').fill('60');
 const persistence=await p.evaluate(()=>{const s=saveState({force:true,snapshotOnly:true}),preset=gatherPreset();mygrainLoopFx.randomise();restoreState({state:s,songSnapshot:true,throwOnError:true});return {saved:s.modes.loopFx.channels.X.pan,restored:mygrainLoopFx.channel('X').pan,grains:['A','B'].map(k=>Number(document.getElementById('grainSynth'+k+'Pan').value)),preset:[preset.loopFx.channels.X.pan,preset.sliders.grainSynthAPan,preset.sliders.grainSynthBPan]}});
 assert.equal(persistence.saved,-.65);assert.equal(persistence.restored,-.65);assert.deepEqual(persistence.grains,[-75,60]);assert.deepEqual(persistence.preset,[-.65,'-75','60']);
 const audio=await p.evaluate(async()=>{
  const checks=[];
  async function energy(ctx){const b=await ctx.startRendering();return [...Array(2)].map((_,c)=>b.getChannelData(c).reduce((sum,v)=>sum+v*v,0));}
  for(const pan of [-1,0,1]){const ctx=new OfflineAudioContext(2,16000,48000),graph=MygrainLoopFx.createGraph(ctx,ctx.destination,{...MygrainLoopFx.defaults(),filterEnabled:false,pan}),source=ctx.createBufferSource(),buffer=ctx.createBuffer(1,16000,48000);buffer.getChannelData(0).fill(.2);source.buffer=buffer;source.connect(graph.input);source.start();checks.push({kind:'loop',pan,energy:await energy(ctx)});graph.dispose();}
  stopAllPerformancePlayback({silent:true});grainLayerSolo = [];setGranularLayersEnabled(true,{skipSave:true,silent:true});
  const buffer=audioContext.createBuffer(1,48000,48000);for(let i=0;i<buffer.length;i++)buffer.getChannelData(0)[i]=.2*Math.sin(i*2*Math.PI*220/48000);grainASampleBuffer=grainBSampleBuffer=buffer;
  for(const key of ['A','B'])for(const pan of [-1,0,1]){
   setGranularLayerMuted(key,false,{skipSave:true,silent:true});document.getElementById('grainSynth'+key+'Source').value='grain'+key+'Sample';for(const [suffix,value]of Object.entries({Pan:pan*100,Volume:100,Start:0,Width:100,Tune:0,FineTune:0}))document.getElementById('grainSynth'+key+suffix).value=String(value);
   const online=audioContext,output=granularOutputGain,ctx=new OfflineAudioContext(2,24000,48000);audioContext=ctx;granularOutputGain=ctx.createGain();granularOutputGain.connect(ctx.destination);
   try{const layer=getGranularLayerSettings(65.41).find(l=>l.key===key);if(pan===0)layer.width=0;playGrain('C2',.04,1,{role:'pan-test',layerSettings:[layer],streamStartTime:.04});checks.push({kind:'grain'+key,pan,energy:await energy(ctx)});}finally{audioContext=online;granularOutputGain=output;}
  }
  for(let i=0;i<5;i++)mygrainKMultitrack.tracks[i].pan=.8;setBastardLoopMPlusPanPercent(90,{skipSave:true});mygrainQ.state.pan=.7;
  mygrainLoopFx.randomise();return {checks,centred:Object.values(mygrainLoopFx.settings().channels).every(c=>c.pan===0)&&mygrainKMultitrack.tracks.every(t=>t.pan===0)&&bastardLoopMPlusPan===0&&mygrainQ.state.pan===0&&['A','B'].every(k=>document.getElementById('grainSynth'+k+'Pan').value==='0')};
 });
 assert(audio.centred);for(const c of audio.checks){const [l,r]=c.energy;assert(l+r>.01,JSON.stringify(c));if(c.pan===-1)assert(r<l*1e-8,JSON.stringify(c));if(c.pan===1)assert(l<r*1e-8,JSON.stringify(c));if(c.pan===0)assert(Math.abs(l-r)/(l+r)<.15,JSON.stringify(c));}
 for(const width of [390,1440]){await p.setViewportSize({width,height:900});assert(await p.evaluate(()=>[...document.querySelectorAll('.loop-fx')].every(el=>el.scrollWidth<=el.clientWidth+1)),'pan panel overflow '+width);}
 await p.evaluate(()=>{const s=mygrainLoopFx.settings();s.channels.X.pan=.45;mygrainLoopFx.restore(s);setSliderValue('grainSynthAPan',-35);setSliderValue('grainSynthBPan',70);saveState({force:true});});
 await p.reload();await p.waitForFunction(()=>window.mygrainLoopFx&&document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
 assert.deepEqual(await p.evaluate(()=>[mygrainLoopFx.channel('X').pan,Number(document.getElementById('grainSynthAPan').value),Number(document.getElementById('grainSynthBPan').value)]),[.45,-35,70]);
 assert.deepEqual(errors,[]);console.log('PASS',engine,JSON.stringify({persistence,...audio}));await c.close();
 }finally{await b.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
