'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18936/mygrain/';assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{for(const [engine,type] of Object.entries(process.env.INSTAREEL_ENGINE==='chromium'?{chromium}:process.env.INSTAREEL_ENGINE==='webkit'?{webkit}:{chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
  assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'instareel-fixture'}})).status(),200);
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainInstareel);
  await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  await page.evaluate(hats=>window.instareelTestHats=hats,!!process.env.INSTAREEL_HATS);
  await page.evaluate(value=>window.instareelTestVariations=value,!!process.env.INSTAREEL_RETRY_TEST);
  await page.evaluate(value=>window.instareelMusical=value,!!process.env.INSTAREEL_MUSICAL_TEST);
  await page.evaluate(value=>window.instareelRatchets=value,!!process.env.INSTAREEL_RATCHET_TEST);
  await page.evaluate(value=>window.instareelEvolution=value,!!process.env.INSTAREEL_EVOLUTION_TEST);
  await page.evaluate(()=>{
   stopAllPerformancePlayback({silent:true});
   const buffer=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate),data=buffer.getChannelData(0);
   // A distinctive periodic harmonic source and a hat give the variation engine real material.
   for(let i=0;i<data.length;i++)data[i]=.12*Math.sin(2*Math.PI*110*i/buffer.sampleRate)+.04*Math.sin(2*Math.PI*440*i/buffer.sampleRate);
   bastardLoopVBuffer=buffer;bastardLoopVEnabled=true;bastardLoopVSourceBpm=120;applyBastardLoopVDivisionSelection(['1'],{save:false});
   syncPatternLengthControls(16,{skipSave:true});applyGlobalBpm(120);bastardLoopVLevel=.5;document.getElementById('performanceBastardLoopVLevel').value='50';
   bastardLoopEnabled=false;bastardLoop2Enabled=false;bastardLoop3Enabled=false;bastardLoopWEnabled=false;bastardLoopPEnabled=false;bastardLoopOEnabled=false;bastardLoopLEnabled=false;bastardLoopXEnabled=false;bastardLoopMEnabled=false;bastardLoopMPlusEnabled=false;dropboxSampleLayerEnabled=false;generatedLoopBuffer=null;generatedLoopBaseBuffer=null;
   drumMachineEnabled=false;oscillatorsEnabled=false;seqGrainsEnabled=false;window.mygrainQ.state.enabled=false;
   syncBastardLoopVUi();syncPerformanceControlState();
   if(window.instareelTestHats){drumMachineEnabled=true;drumMachineHatBuffer=audioContext.createBuffer(1,2205,44100);const hat=drumMachineHatBuffer.getChannelData(0);for(let i=0;i<hat.length;i++)hat[i]=.08*Math.sin(i*2.3)*Math.exp(-i/300);drumMachineKickBuffer=null;drumMachineSnareBuffer=null;}
   if(window.instareelTestVariations&&!window.instareelMusical){
    bastardLoopWBuffer=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate);const w=bastardLoopWBuffer.getChannelData(0);for(let i=0;i<w.length;i++)w[i]=.3*Math.sin(2*Math.PI*880*i/audioContext.sampleRate);
    bastardLoopWSourceBpm=120;applyBastardLoopWDivisionSelection(['1'],{save:false});bastardLoopWEnabled=false;document.getElementById('performanceBastardLoopWLevel').value='50';
   }
   if(window.instareelMusical){
    bastardLoopVEnabled=false;
    const tone=(frequency,seconds)=>{const b=audioContext.createBuffer(1,Math.round(audioContext.sampleRate*seconds),audioContext.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=.16*Math.sin(2*Math.PI*frequency*i/b.sampleRate)*Math.min(1,i/100)*Math.min(1,(d.length-i)/200);return b};
    bastardLoopLSampleBuffer=tone(261.625565,.4);bastardLoopXSampleBuffer=tone(130.812783,.4);
    bastardLoopLRootNote='C3';bastardLoopXRootNote='C2';bastardLoopLEnabled=true;bastardLoopXEnabled=true;
    bastardLoopLSourceMode='sample';bastardLoopXSourceMode='sample';bastardLoopLTimingIndex=3;bastardLoopXTimingIndex=3;
    bastardLoopLSequence=Array.from({length:64},(_,i)=>({note:i%4===0?'C3':'',rest:i%4!==0,accent:false,slide:false,ratchet:1}));
    bastardLoopXSequence=Array.from({length:64},(_,i)=>({note:i%4===0?'C2':'',rest:i%4!==0,accent:false,slide:false,ratchet:1}));
    for(const key of ['L','X']){const el=document.getElementById('performanceBastardLoop'+key+'Level');el.value='40';el.dispatchEvent(new Event('input',{bubbles:true}))}
    drumMachineEnabled=true;drumMachineKickBuffer=tone(60,.07);drumMachineSnareBuffer=tone(1000,.05);drumMachineHatBuffer=null;
    drumMachineKickPattern=Array.from({length:64},(_,i)=>i%16===0||i%16===8);drumMachineSnarePattern=Array.from({length:64},(_,i)=>i%16===4||i%16===12);drumMachineHatPattern=Array(64).fill(false);drumMachineRoll=MygrainDrumRoll.normalize({length:64});
    if(window.instareelRatchets){drumMachineHatBuffer=tone(5000,.025);drumMachineHatPattern=Array.from({length:64},(_,i)=>i%2===0);drumMachineHatRatchetPattern=Array(64).fill(0);drumMachineHatAccentPattern=Array(64).fill(false)}
    syncPerformanceControlState();
   }
   if(window.instareelEvolution){
    const melodic=frequencies=>{const b=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++){const t=i/b.sampleRate,j=Math.min(3,Math.floor(t/.5)),local=t% .5;d[i]=.2*Math.sin(2*Math.PI*frequencies[j]*t)*Math.min(1,local/.006,(.5-local)/.006)}return b};
    bastardLoopVBuffer=melodic([220,330,440,550]);bastardLoopWBuffer=melodic([880,1100,1320,1540]);bastardLoopVEnabled=true;bastardLoopWEnabled=true;bastardLoopVSourceBpm=bastardLoopWSourceBpm=120;
    applyBastardLoopVDivisionSelection(['1'],{save:false});applyBastardLoopWDivisionSelection(['1'],{save:false});
    for(const key of ['V','W']){const e=document.getElementById('performanceBastardLoop'+key+'Level');e.value='40';e.dispatchEvent(new Event('input',{bubbles:true}))}
    mygrainNoise.restore({...mygrainNoise.settings(),enabled:false,level:0,source:'drums',cutoff:80,poles:16});
    window.instareelWOriginal=bastardLoopWBuffer;
   }
   window.instareelOriginal={buffer:bastardLoopVBuffer,snapshot:JSON.stringify(saveState({force:true,snapshotOnly:true}),(key,value)=>key==='timestamp'?undefined:value)};
  });
  await page.locator('#sectionJumpHandle').tap();await page.locator('.section-jump-option[data-jump-target="#genreatorCard"]').tap();
  if(process.env.INSTAREEL_MUSICAL_TEST){await page.locator('#instareelNotes').check();await page.locator('#instareelDrums').check()}
  await page.locator('#instareelSeconds').fill(process.env.INSTAREEL_SECONDS||'30');await page.locator('#instareelVariation').selectOption(process.env.INSTAREEL_VARIATION||'subtle');await page.locator('#instareelMake').scrollIntoViewIfNeeded();await page.locator('#instareelMake').tap();
  await page.waitForFunction(()=>mygrainInstareel.job||document.getElementById('instareelStatus').textContent.includes('Could not'),null,{timeout:30000});
  console.log(engine,'job',await page.locator('#instareelStatus').textContent());
  await page.waitForFunction(()=>!mygrainInstareel.busy,null,{timeout:240000});
  const status=await page.locator('#instareelStatus').textContent();console.log(engine,status);assert.match(status,/loopable reel ready/);
  assert.equal(await page.evaluate(()=>instareelOriginal.buffer===bastardLoopVBuffer),true,'Live source buffer identity must not change');
  assert.equal(await page.evaluate(()=>instareelOriginal.snapshot===JSON.stringify(saveState({force:true,snapshotOnly:true}),(key,value)=>key==='timestamp'?undefined:value)),true,'Live patch settings must not change');
  if(process.env.INSTAREEL_MUSICAL_TEST){const first=await page.evaluate(()=>mygrainInstareel.job.id),response=await context.request.get(base+`api/instareel/${first}`,{headers:{'X-Mygrain-User':'admin'}}),data=(await response.json()).job;assert.deepEqual(data.plan.options,{notes:true,drums:true});assert(data.plan.fills.length>0);}
  assert.equal(await page.locator('#instareelLoop').isChecked(),true);
  await page.locator('#instareelPlay').tap();await page.waitForFunction(()=>mygrainInstareel.player.playing);
  const preview=await page.evaluate(()=>{const api=mygrainInstareel.player;window.reelAnalyser=audioContext.createAnalyser();api.source.connect(reelAnalyser);return {duration:api.buffer.duration,loop:api.source.loop,end:api.source.loopEnd}});
  assert.equal(preview.loop,true);assert(preview.duration>=29.9&&preview.duration<=60.1);
  await page.waitForFunction(()=>{const pcm=new Float32Array(reelAnalyser.fftSize);reelAnalyser.getFloatTimeDomainData(pcm);return pcm.some(x=>Math.abs(x)>.001)});
  // Seek close to the join and require looping to stay audible and wrap position.
  await page.locator('#instareelSeek').evaluate(el=>{el.value=String(Number(el.max)-.6);el.dispatchEvent(new Event('input',{bubbles:true}))});
  await page.waitForTimeout(1600);assert.equal(await page.evaluate(()=>mygrainInstareel.player.playing),true);assert(Number(await page.locator('#instareelSeek').inputValue())<3);
  await page.locator('#instareelLoop').uncheck();assert.equal(await page.evaluate(()=>mygrainInstareel.player.source.loop),false);
  await page.locator('#instareelSeek').evaluate(el=>{el.value=String(Number(el.max)-.3);el.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(750);assert.equal(await page.evaluate(()=>mygrainInstareel.player.playing),false,'Unchecked Loop must stop at the end');
  await page.locator('#instareelPlay').tap();await page.waitForFunction(()=>mygrainInstareel.player.playing);await page.locator('#instareelPlay').tap();assert.equal(await page.evaluate(()=>mygrainInstareel.player.playing),false);
  await page.locator('#instareelName').fill('Test Reel '+engine);await page.locator('#instareelSave').tap();await page.waitForFunction(()=>document.getElementById('instareelStatus').textContent.startsWith('Saved '));
  await page.locator('#instareelLibrary summary').tap();await page.locator('.instareel-library-row').first().waitFor();
  await page.locator('.instareel-library-row button').first().tap();await page.waitForFunction(()=>mygrainInstareel.player.playing);
  await page.evaluate(()=>{window.savedReelAnalyser=audioContext.createAnalyser();mygrainInstareel.player.source.connect(savedReelAnalyser)});
  await page.waitForFunction(()=>{const pcm=new Float32Array(savedReelAnalyser.fftSize);savedReelAnalyser.getFloatTimeDomainData(pcm);return pcm.some(x=>Math.abs(x)>.001)});
  await page.locator('#instareelPlay').tap();assert.equal(await page.evaluate(()=>mygrainInstareel.player.playing),false);
  console.log('PASS',engine,'saved-browser Preview starts audible playback with one tap');
  for(const viewport of [{width:390,height:844},{width:844,height:390}]){await page.setViewportSize(viewport);await page.locator('#instareelControls').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  if(process.env.MYGRAIN_INSTAREEL_EVIDENCE)await page.screenshot({path:process.env.MYGRAIN_INSTAREEL_EVIDENCE+'/'+engine+'-g.png'});
  const id=await page.evaluate(()=>mygrainInstareel.job.id);
  const wav=await context.request.get(base+`api/instareel/${id}/wav`,{headers:{'X-Mygrain-User':'admin'}});assert.equal(wav.status(),200);
  if(process.env.MYGRAIN_INSTAREEL_EVIDENCE)fs.writeFileSync(process.env.MYGRAIN_INSTAREEL_EVIDENCE+'/'+engine+'.wav',await wav.body());
  assert.match(wav.headers()['cache-control'],/private, no-store/);
  assert.equal((await context.request.get(base+`api/instareel/${id}`,{headers:{'X-Mygrain-User':'wrong-account'}})).status(),401);
  if(process.env.INSTAREEL_RETRY_TEST){
   if(process.env.INSTAREEL_MUSICAL_TEST){await page.locator('#instareelNotes').uncheck();await page.locator('#instareelDrums').uncheck()}
   await page.locator('#instareelSeconds').fill('60');await page.locator('#instareelVariation').selectOption(process.env.INSTAREEL_RETRY_VARIATION||'moderate');
   await page.locator('#instareelMake').tap();
   await page.waitForFunction(old=>mygrainInstareel.job&&mygrainInstareel.job.id!==old,id,{timeout:30000});
   const nextId=await page.evaluate(()=>mygrainInstareel.job.id),next=(await (await context.request.get(base+`api/instareel/${nextId}`,{headers:{'X-Mygrain-User':'admin'}})).json()).job;assert.equal(next.plan.requestedSeconds,60);assert.equal(next.plan.variation,process.env.INSTAREEL_RETRY_VARIATION||'moderate');assert.equal(next.plan.duration,60);if(process.env.INSTAREEL_MUSICAL_TEST){assert.deepEqual(next.plan.options,{notes:false,drums:false});assert.equal(next.plan.fills.length,0)}
   assert.equal(await page.locator('#instareelPreview').isVisible(),false,'Old preview must not masquerade as the new render');
   await page.waitForFunction(()=>!mygrainInstareel.busy,null,{timeout:240000});assert((await page.locator('#instareelStatus').textContent()).includes('60.0s loopable reel ready · '+(process.env.INSTAREEL_RETRY_VARIATION||'moderate')));
   assert.equal(await page.evaluate(()=>instareelOriginal.snapshot===JSON.stringify(saveState({force:true,snapshotOnly:true}),(key,value)=>key==='timestamp'?undefined:value)),true);
   const nextWav=await context.request.get(base+`api/instareel/${next.id}/wav`,{headers:{'X-Mygrain-User':'admin'}});assert.equal(nextWav.status(),200);if(process.env.MYGRAIN_INSTAREEL_EVIDENCE)fs.writeFileSync(process.env.MYGRAIN_INSTAREEL_EVIDENCE+'/'+engine+'-retry.wav',await nextWav.body());
   console.log('PASS',engine,'Try Another rereads 60s/'+(process.env.INSTAREEL_RETRY_VARIATION||'moderate')+' and preserves live disabled layers');
  }
  if(process.env.INSTAREEL_EVOLUTION_TEST)assert(await page.evaluate(()=>instareelWOriginal===bastardLoopWBuffer),'Live W source identity unchanged');
  // Existing G generation contracts remain untouched and ready.
  assert.equal(await page.locator('#genreatorGenres [data-genre]:enabled').count(),15);
  await page.evaluate(()=>window.dispatchEvent(new Event('mygrain-account-lock')));assert.equal(await page.evaluate(()=>mygrainInstareel.player.buffer),null);
  assert.deepEqual(errors,[]);console.log('PASS',engine,'actual server render, unchanged patch, loop toggle/wrap, save/library, portrait/landscape and cleanup');await context.close();
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
