// Real native PCM: source Solo must gate insert excitation, not only effect returns.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.BASE,out=process.env.OUT;assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{for(const[name,type]of Object.entries(process.env.ONLY_BROWSER?{[process.env.ONLY_BROWSER]:{chromium,webkit}[process.env.ONLY_BROWSER]}:{chromium,webkit})){
const browser=await type.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
try{const ctx=await browser.newContext(name==='webkit'?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1440,height:1000}}),p=await ctx.newPage(),errors=[];p.setDefaultTimeout(90000);p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());assert((await ctx.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).ok());await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
const result=await p.evaluate(async()=>{
 stopAllPerformancePlayback({silent:true});for(const l of SPARSE_RANDOM_LAYER_DEFINITIONS)l.setEnabled(false,{silent:true,skipSave:true});setSliderValue('volume',100);
 const sr=48000,n=16384,rms=a=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length),diff=(a,b)=>rms(a.map((x,i)=>x-b[i]));
 const reset=async()=>{clearAllPerformanceSoloStates({silent:true,skipSave:true});mygrainEffectOutput.setSolo(null);await mygrainAcousticFx.off();await mygrainResonator.off();await mygrainTurntable.off();await mygrainWasp.restore();mygrainBassFace.restore();mygrainD.setMutilator({enabled:false});mygrainLoopFx.restore();mygrainChannelEq.restore();mygrainEffectOutput.restore();await mygrainCookingPot.restore();await mygrainCookingPot.whenReady()};
 const render=async({mask=[],effect=true,manual=false,split=false,mute=false,source='all',keys=['A','B'],gains=[.06,.06],raw=false,zero=false,through=false,wet=false}={})=>{
  await reset();setLoopLayerSolo(mask,{silent:true,skipSave:true});if(raw)performanceSourceLayerSolo=['granular'];
  if(effect)mygrainBassFace.restore(MygrainBassFace.normalize({enabled:true,input:source,amount:.6,mix:wet?1:0}));
  if(split)await mygrainAcousticFx.set('wireWorld',MygrainAcousticFx.normalize('wireWorld',{enabled:true,source:'A',level:zero?0:.5}));
  await mygrainCookingPot.restore({mixes:{wireWorld:zero?1:0}});mygrainEffectOutput.restore({mainMuted:mute,throughMain:through?{bassFace:true,wireWorld:true}:{}});if(manual)mygrainEffectOutput.setSolo('bassFace',true);await mygrainCookingPot.whenReady();
  const c=new OfflineAudioContext(2,n,sr);await mygrainCookingPot.prepare(c);const bus=c.createGain();mygrainEffectOutput.bind(bus,c.destination);mygrainCookingPot.bind(bus);await mygrainCookingPot.whenReady();const links=[],sources=[],gates=[];
  for(let k=0;k<keys.length;k++){
   const key=keys[k],buffer=c.createBuffer(2,n,sr);for(let ch=0;ch<2;ch++)for(let i=0;i<n;i++)buffer.getChannelData(ch)[i]=gains[k]*Math.sin(2*Math.PI*(k?887:113)*i/sr);
   const voice=c.createBufferSource(),gate=c.createGain();voice.buffer=buffer;
   // Faithful pre-fader sends: the normal source output has its own Solo gate,
   // but an insert tap taken before that gate must enforce the same source mask.
   const selected=raw?false:!mask.length||getSoloEffectInputSources().includes(/^D[234]$/.test(key)?'D':key);gate.gain.value=selected?1:0;gate.connect(bus);gates.push(gate);
   links.push(mygrainChannelEq.connect(key,voice,gate,null,c));sources.push(voice);
  }
  if(raw){const voice=c.createOscillator(),gain=c.createGain();voice.frequency.value=113;gain.gain.value=.06;voice.connect(gain).connect(bus);voice.start(0);voice.stop(n/sr);}
  await mygrainCookingPot.whenReady();mygrainCookingPot.syncSources();mygrainEffectOutput.setMaster(1);const diag=mygrainCookingPot.diagnostics();for(const s of sources)s.start(0);const rendered=await c.startRendering(),data=Array.from(rendered.getChannelData(0));
  for(const l of links)l.disconnect();mygrainCookingPot.releaseContext(c);mygrainChannelEq.releaseContext(c);mygrainEffectOutput.releaseContext(c);gates.forEach(g=>g.disconnect());return{data,diag};
 };
 const rows=[],check=(name,got,want,extra={})=>rows.push({name,error:diff(got.data,want.data),rms:rms(got.data),...extra});
 const dryA=await render({mask:['bastarda'],effect:false}),dryB=await render({mask:['bastardb'],effect:false}),dryBoth=await render({effect:false});
 check('Pot off source A isolation',dryA,{data:dryBoth.data.map((x,i)=>x-dryB.data[i])});
 check('Whole mix insert source A only',await render({mask:['bastarda']}),dryA);
 check('Whole mix insert source B only',await render({mask:['bastardb']}),dryB);
 check('Additive source A+B',await render({mask:['bastarda','bastardb']}),dryBoth);
 check('Whole mix to A-only split chain',await render({mask:['bastarda'],split:true}),dryA);
 check('Independent output with main muted',await render({mask:['bastarda'],mute:true}),dryA);
 check('Following main with main muted',await render({mask:['bastarda'],mute:true,through:true}),{data:dryA.data.map(()=>0)});
 check('Manual effect Solo retains full effect input',await render({manual:true}),dryBoth);
 check('Transient manual monitor does not leak into offline source Solo',await render({mask:['bastarda'],manual:true}),dryA);
 check('Unselected A branch may not escape via final effect key',await render({mask:['bastardb'],split:true}),dryB);
 check('Full wet zero level stays silent',await render({mask:['bastarda'],split:true,zero:true}),{data:dryA.data.map(()=>0)});
 const wetA=await render({wet:true,keys:['A'],gains:[.06]});check('Nonlinear effect receives only selected A',await render({wet:true,mask:['bastarda']}),wetA);
 const wetB=await render({wet:true,keys:['B'],gains:[.06]});
 // The single B reference uses oscillator index zero (113 Hz), so use an A=0
 // two-input reference to preserve B's exact 887 Hz fixture and nonlinear memory.
 const wetBRef=await render({wet:true,gains:[0,.06]});check('Nonlinear effect receives only selected B',await render({wet:true,mask:['bastardb']}),wetBRef);
 const dKeys=['D','D2','D3','D4','B'],dDry=await render({effect:false,mask:['bastardd'],keys:dKeys,gains:dKeys.map(()=>.06)});check('D Solo retains all four lanes and excludes B',await render({mask:['bastardd'],keys:dKeys,gains:dKeys.map(()=>.06)}),dDry);
 const dOnly=await render({effect:false,keys:['D','D2','D3','D4'],gains:[.06,.06,.06,.06]});check('Dry D Solo excludes unrelated B',dDry,dOnly);
 const kDry=await render({effect:false,mask:['bastardk'],keys:['K1','K5']});check('K Solo retains all selected recorder tracks',await render({mask:['bastardk'],keys:['K1','K5']}),kDry);
 const drumDry=await render({effect:false,mask:['drums'],keys:['drumKick','drumSnare']});check('Drums Solo retains selected drum group',await render({mask:['drums'],keys:['drumKick','drumSnare']}),drumDry);
 const rawDry=await render({effect:false,raw:true});check('Granular/raw Solo excludes named insert inputs',await render({raw:true}),rawDry);
 for(const key of ['X','Q','N','K1','K5','drumKick','drumSnare','drumRoll'])check('Reject non-solo '+key,await render({mask:['bastarda'],keys:['A',key],gains:[0,.06]}),{data:dryA.data.map(()=>0)});
 await reset();return rows;
});fs.writeFileSync(out+'/source-solo-'+name+(process.env.EXPECT_LEAK?'-before':'-after')+'.json',JSON.stringify({result,errors},null,2));assert.deepEqual(errors,[]);
if(process.env.EXPECT_LEAK){assert(result.find(r=>r.name==='Whole mix insert source A only').error>.01);console.log('REPRODUCED',name,result.filter(r=>r.error>1e-6).map(r=>({name:r.name,error:r.error})));}else{for(const r of result)assert(r.error<1e-6,JSON.stringify(r));console.log('PASS',name,result.length,'source isolation, additive/manual Solo, grouped/raw inputs, split chains and main-output PCM checks');}
}finally{await browser.close()}}
})().catch(e=>{console.error(e);process.exitCode=1});
