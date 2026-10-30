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
   window.instareelOriginal={buffer:bastardLoopVBuffer,snapshot:JSON.stringify(saveState({force:true,snapshotOnly:true}),(key,value)=>key==='timestamp'?undefined:value)};
  });
  await page.locator('#sectionJumpHandle').tap();await page.locator('.section-jump-option[data-jump-target="#genreatorCard"]').tap();
  await page.locator('#instareelSeconds').fill(process.env.INSTAREEL_SECONDS||'30');await page.locator('#instareelVariation').selectOption(process.env.INSTAREEL_VARIATION||'subtle');await page.locator('#instareelMake').scrollIntoViewIfNeeded();await page.locator('#instareelMake').tap();
  await page.waitForFunction(()=>mygrainInstareel.job||document.getElementById('instareelStatus').textContent.includes('Could not'),null,{timeout:30000});
  console.log(engine,'job',await page.locator('#instareelStatus').textContent());
  await page.waitForFunction(()=>!mygrainInstareel.busy,null,{timeout:240000});
  const status=await page.locator('#instareelStatus').textContent();console.log(engine,status);assert.match(status,/loopable reel ready/);
  assert.equal(await page.evaluate(()=>instareelOriginal.buffer===bastardLoopVBuffer),true,'Live source buffer identity must not change');
  assert.equal(await page.evaluate(()=>instareelOriginal.snapshot===JSON.stringify(saveState({force:true,snapshotOnly:true}),(key,value)=>key==='timestamp'?undefined:value)),true,'Live patch settings must not change');
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
  for(const viewport of [{width:390,height:844},{width:844,height:390}]){await page.setViewportSize(viewport);await page.locator('#instareelControls').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  if(process.env.MYGRAIN_INSTAREEL_EVIDENCE)await page.screenshot({path:process.env.MYGRAIN_INSTAREEL_EVIDENCE+'/'+engine+'-g.png'});
  const id=await page.evaluate(()=>mygrainInstareel.job.id);
  const wav=await context.request.get(base+`api/instareel/${id}/wav`,{headers:{'X-Mygrain-User':'admin'}});assert.equal(wav.status(),200);
  if(process.env.MYGRAIN_INSTAREEL_EVIDENCE)fs.writeFileSync(process.env.MYGRAIN_INSTAREEL_EVIDENCE+'/'+engine+'.wav',await wav.body());
  assert.match(wav.headers()['cache-control'],/private, no-store/);
  assert.equal((await context.request.get(base+`api/instareel/${id}`,{headers:{'X-Mygrain-User':'wrong-account'}})).status(),401);
  // Existing G generation contracts remain untouched and ready.
  assert.equal(await page.locator('#genreatorGenres [data-genre]:enabled').count(),15);
  await page.evaluate(()=>window.dispatchEvent(new Event('mygrain-account-lock')));assert.equal(await page.evaluate(()=>mygrainInstareel.player.buffer),null);
  assert.deepEqual(errors,[]);console.log('PASS',engine,'actual server render, unchanged patch, loop toggle/wrap, save/library, portrait/landscape and cleanup');await context.close();
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
