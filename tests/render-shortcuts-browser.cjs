'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19243/mygrain/',out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp/mygrain-render-shortcuts';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);fs.mkdirSync(out,{recursive:true});
const keys=['sectionJumpFinalMixBtn','sectionJumpFinalMixPanelBtn','sectionJumpLoopStoreAddBtn'];
async function openDrawer(p,phone){if(phone&&!await p.locator('#sectionJumpDrawer').evaluate(el=>el.classList.contains('is-open')))await p.locator('#sectionJumpHandle').click();}
async function controls(p){return p.evaluate(ids=>ids.map(id=>{const el=document.getElementById(id),s=getComputedStyle(el),r=el.getBoundingClientRect();return{id,disabled:el.disabled,busy:el.getAttribute('aria-busy'),label:el.querySelector('.render-action-label').textContent,progress:el.querySelector('.render-action-progress').textContent,width:r.width,height:r.height,bg:s.backgroundColor,icon:getComputedStyle(el,'::before').content}}),keys);}
(async()=>{const results=[];for(const[engine,type,phone]of[['webkit',webkit,true],['webkit',webkit,false],['chromium',chromium,true],['chromium',chromium,false]]){
 const name=engine+'-'+(phone?'phone':'desktop');if(process.env.MYGRAIN_TEST_CASES&&!process.env.MYGRAIN_TEST_CASES.split(',').includes(name))continue;
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{
  const context=await browser.newContext({viewport:{width:phone?390:1440,height:phone?844:1000},isMobile:phone,hasTouch:phone});
  assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
  const p=await context.newPage(),errors=[],requests=[];p.setDefaultTimeout(45000);p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  let requestedName='',cancelName=false,paired=engine==='chromium'&&!phone;
  p.on('dialog',d=>d.type()==='confirm'?(paired?d.accept():d.dismiss()):d.type()==='prompt'?(cancelName?d.dismiss():d.accept(requestedName)):d.dismiss());
  let releaseUpload=null;
  await p.route(/\/mygrain-(wavs|loopstore)\/api\/(upload|render-with-pattern)/,async route=>{await new Promise(resolve=>{releaseUpload=resolve});await route.continue();});
  await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&document.querySelector('.render-action-copy'));
  await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  await p.evaluate(async()=>{
   stopAllPerformancePlayback({silent:true});applyGlobalBpm(137);syncPatternLengthControls(16,{skipSave:true});document.getElementById('performanceExportBars').value='1';
   setFxMuted(true,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);setDrumMachineEnabled(false,{silent:true,skipSave:true});mygrainNoise.restore({enabled:false});mygrainChannelEq.restore();await mygrainResonator.off();await mygrainWasp.restore(null);await mygrainTurntable.off();
   const n=Math.round(60/137*4*audioContext.sampleRate),src=audioContext.createBuffer(2,n,audioContext.sampleRate);
   for(let ch=0;ch<2;ch++)for(let i=0;i<n;i++)src.getChannelData(ch)[i]=.15*Math.cos(2*Math.PI*(ch?173:110)*i/n);
   bastardLoopBuffer=src;bastardLoopSourceBpm=137;bastardLoopMetadata={bpm:137,durationSeconds:n/audioContext.sampleRate};setBastardLoopEnabled(true,{silent:true,skipSave:true});setLoopLayerSolo('bastarda',{silent:true,skipSave:true});
   mygrainDisplay.reveal(document.getElementById('performanceLayerSwitchesCard'));document.getElementById('performanceLayerSwitchesCard').scrollIntoView({block:'center'});
   window.shortcutSource=src;const before=saveState({snapshotOnly:true,force:true});delete before.timestamp;window.shortcutSnapshot=JSON.stringify(before);
   window.shortcutJumps=0;window.addEventListener('mygrain-jump-change',()=>shortcutJumps++);
   window.shortcutClicks={repo:0,loop:0};document.getElementById('performanceRepoExportBtn').addEventListener('click',()=>shortcutClicks.repo++);document.getElementById('performanceLoopStoreAddBtn').addEventListener('click',()=>shortcutClicks.loop++);
   window.shortcutTrace=[];for(const el of document.querySelectorAll('[data-render-action] .render-action-progress'))new MutationObserver(()=>shortcutTrace.push({id:el.closest('button').id,text:el.textContent})).observe(el,{childList:true});
  });
  await p.evaluate(()=>{
   window.exportResumeEvents=[];window.exportContext=audioContext;window.exportCloseCalls=0;
   audioContext.close=()=>{exportCloseCalls++;throw Error('Export must not close the live context.');};
   const original=restoreAudioAfterRepositoryRender;
   restoreAudioAfterRepositoryRender=async function(button){
    const previous=audioContext,start=performance.now();
    const result=await original(button);
    exportResumeEvents.push({same:audioContext===previous&&audioContext===exportContext,ready:isAudioGraphReady(),state:audioContext.state,ms:performance.now()-start,closeCalls:exportCloseCalls});
    return result;
   };
  });
  await openDrawer(p,phone);const idle=await controls(p);
  assert.equal(await p.locator('#sectionJumpFinalMixPanelBtn').isVisible(),phone,'desktop duplicate panel export stays hidden');
  for(const c of idle){assert.equal(c.bg,'rgb(57, 255, 88)');assert(c.icon.includes('▶'),JSON.stringify(c));assert(!c.disabled&&!c.progress&&c.busy==='false');}
  assert.equal(await p.locator('#performanceLoopStoreAddBtn').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(57, 255, 88)');
  const actions=[];
  for(const kind of ['repo','loop']){
   const id=kind==='repo'?(phone?'sectionJumpFinalMixPanelBtn':'sectionJumpFinalMixBtn'):'sectionJumpLoopStoreAddBtn';
   requestedName='direct-'+name+'-'+kind;const routePart=kind==='repo'?'/mygrain-wavs/':'/mygrain-loopstore/';
   const before=await controls(p),responsePromise=p.waitForResponse(r=>r.url().includes(routePart+'api/')&&r.request().method()==='POST');
   responsePromise.catch(()=>{});const button=p.locator('#'+id);if(phone)await button.tap();else{await button.focus();await button.press('Enter');}
   await p.waitForFunction(id=>document.getElementById(id).getAttribute('aria-busy')==='true',id);
   assert.equal(await p.evaluate(()=>shortcutJumps),0,'direct action must not invoke the jump curtain or scroll path');
   if(phone)assert(await p.locator('#sectionJumpDrawer').evaluate(el=>el.classList.contains('is-open')),'drawer must remain open');
   await p.waitForFunction(()=>[...document.querySelectorAll('[data-render-action] .render-action-progress')].some(el=>el.textContent==='Rendering…'));
   assert((await controls(p)).every(c=>c.disabled),'both destinations are locked while capture is active');
   // Repeated taps and the other shortcut cannot start an overlapping operation.
   await p.evaluate(ids=>ids.forEach(id=>document.getElementById(id).click()),keys);
   const deadline=Date.now()+45000;while(!releaseUpload){assert(Date.now()<deadline,'render did not reach upload');await p.waitForTimeout(80);}
   await p.waitForFunction(id=>/Uploading|Adding/.test(document.querySelector('#'+id+' .render-action-progress').textContent),id);
   const during=await controls(p);
   for(const c of during){const b=before.find(x=>x.id===c.id);assert(Math.abs(c.width-b.width)<.1);assert(Math.abs(c.height-b.height)<.1);}
   await p.locator('#'+id).screenshot({path:out+'/'+name+'-'+kind+'-progress.png'});
   releaseUpload();releaseUpload=null;const response=await responsePromise;assert([200,201].includes(response.status()),await response.text());const saved=await response.json();
   await p.waitForFunction(()=>[...document.querySelectorAll('[data-render-action]')].every(el=>!el.disabled&&el.getAttribute('aria-busy')==='false'));
   const resets=await p.evaluate(()=>exportResumeEvents);
   assert.equal(resets.length,actions.length+1,'one bounded completion check per destination render');
   const reset=resets.at(-1);assert(reset.same&&reset.ready&&reset.state==='running'&&reset.closeCalls===0&&reset.ms<1200,JSON.stringify(reset));
   const livePcm=await p.evaluate(async()=>{
    const capture=recordLiveOutputPcm(audioContext,finalAmplifierNode,.7);
    restartAllTransport({keyboardPlay:false});
    const {audioBuffer:b}=await capture;stopAllPerformancePlayback({silent:true});
    let sum=0,peak=0;for(const x of b.getChannelData(0)){sum+=x*x;peak=Math.max(peak,Math.abs(x));}
    return{rms:Math.sqrt(sum/b.length),peak,frames:b.length};
   });
   assert(livePcm.rms>.005&&livePcm.peak>.01,'real live audio without context reset: '+JSON.stringify(livePcm));
   const original=await context.request.get(new URL(saved.url,base).href),bytes=await original.body();assert.equal(original.status(),200);assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.readUInt16LE(34),24);
   const frames=(bytes.length-44)/6,expected=await p.evaluate(()=>Math.round(60/137*4*audioContext.sampleRate));assert(Math.abs(frames-expected)<=1,{frames,expected});
   let peak=0;for(let i=44;i<bytes.length;i+=3)peak=Math.max(peak,Math.abs(bytes.readIntLE(i,3)/8388608));assert(peak>.01,'real render must contain audio');
   if(kind==='loop'){assert.equal(saved.loopStore.frames,expected);assert(saved.loopStore.exactCut);assert(Math.abs(peak-1)<2/8388608,'Loop Store peak-normalised');}else assert(peak<.9,'WAV repository render must retain its unnormalised level');
   if(kind==='repo'&&paired)assert(saved.patternExport,'editable ZIP path retained');
   assert(await p.evaluate(()=>{const state=saveState({snapshotOnly:true,force:true});delete state.timestamp;return bastardLoopBuffer===shortcutSource&&JSON.stringify(state)===shortcutSnapshot;}),'render must retain original editor');
   const after=await controls(p);for(const c of after){const b=before.find(x=>x.id===c.id);assert(!c.progress);assert.equal(c.label,b.label);assert(Math.abs(c.width-b.width)<.1);assert(Math.abs(c.height-b.height)<.1);}
   actions.push({kind,frames,peak,reset,livePcm,paired:!!saved.patternExport,during,savedName:saved.savedName});
  }
  assert.deepEqual(await p.evaluate(()=>shortcutClicks),{repo:1,loop:1});
  let cancel;
  if(phone&&engine==='webkit'){
   cancelName=true;requestedName='must-not-save';const uploads=requests.filter(r=>r.method==='POST'&&r.url.includes('/api/upload')).length;
   await p.locator('#sectionJumpLoopStoreAddBtn').tap();await p.waitForFunction(()=>!document.getElementById('sectionJumpLoopStoreAddBtn').disabled);
   assert.equal(requests.filter(r=>r.method==='POST'&&r.url.includes('/api/upload')).length,uploads);assert((await controls(p)).every(c=>!c.disabled&&!c.progress));cancel=true;
  }
  const layouts=[];for(const size of phone?[{width:390,height:844},{width:844,height:390}]:[{width:1440,height:1000}]){
   await p.setViewportSize(size);await openDrawer(p,phone);await p.locator('#sectionJumpLoopStoreAddBtn').scrollIntoViewIfNeeded();
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   layouts.push({size,controls:await controls(p)});await p.screenshot({path:out+'/'+name+'-'+size.width+'.png'});
  }
  // Error restores every shortcut; failure surfaces through the existing error dialog.
  await p.evaluate(()=>{window.originalShortcutRenderer=renderPatternWithOptionalSnapshot;renderPatternWithOptionalSnapshot=async()=>{throw Error('isolated shortcut failure')}});
  const exportId=phone?'sectionJumpFinalMixPanelBtn':'sectionJumpFinalMixBtn';await p.locator('#'+exportId).click();await p.locator('#wavExportErrorDialog').waitFor({state:'visible'});
  assert((await controls(p)).every(c=>!c.disabled&&!c.progress));await p.evaluate(()=>{renderPatternWithOptionalSnapshot=originalShortcutRenderer;document.getElementById('wavExportErrorDialog').close()});
  const trace=await p.evaluate(()=>shortcutTrace);assert(trace.some(x=>x.text==='Rendering…')&&trace.some(x=>/Uploading|Adding/.test(x.text)));
  const stalledResume=await p.evaluate(async()=>{
   const context=audioContext,resume=context.resume.bind(context),button=document.getElementById('performanceRepoExportBtn');
   await context.suspend();context.resume=()=>new Promise(()=>{});let ticks=0;const clock=setInterval(()=>ticks++,25),start=performance.now();
   try{button.disabled=true;await restoreAudioAfterRepositoryRender(button);return{ms:performance.now()-start,ticks,same:audioContext===context,closeCalls:exportCloseCalls};}
   finally{clearInterval(clock);context.resume=resume;await resume();button.disabled=false;button.textContent='Export Final Mix to Repo';}
  });
  assert(stalledResume.ms>=1100&&stalledResume.ms<2500&&stalledResume.ticks>10&&stalledResume.same&&stalledResume.closeCalls===0,JSON.stringify(stalledResume));
  await p.evaluate(()=>window.dispatchEvent(new Event('mygrain-account-lock')));assert((await controls(p)).every(c=>c.disabled&&c.busy==='false'&&!c.progress));
  assert.deepEqual(errors,[]);results.push({name,actions,cancel,layouts,trace,stalledResume,errors});fs.writeFileSync(out+'/render-shortcuts.json',JSON.stringify(results,null,2));console.log('PASS',name,'real direct renders, progress, guards, original editor, layout');
  await context.close();
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});
