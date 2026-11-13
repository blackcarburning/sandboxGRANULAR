'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright-core');
const task=process.env.MYGRAIN_TEST_OUTPUT||'/tmp/mygrain-browser-transport-results',stage=process.env.MYGRAIN_TEST_STAGE,base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19026/mygrain/';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);fs.mkdirSync(task,{recursive:true});
const targets=['drumMachineKick','drumMachineSnare','drumMachineHat','drumMachinePerc','drumMachineClap','drumMachineCymbals','drumMachineEtc','drumMachineRoll','bastardLoopD','bastardLoopL','bastardLoopX','dropboxSampleLayer','grainA','grainB','keyboardSample',...['A','B','C','W','V','P','O'].map(l=>'bastardLoop'+l)];
(async()=>{const results=[];for(const [engine,type]of Object.entries(process.env.QUICK?{chromium}:{chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
 try {for(const phone of process.env.QUICK?[true]:[true,false]){
 const context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1280,height:900},isMobile:phone,hasTouch:phone}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==new URL(base).origin)return r.abort();const name=u.pathname==='/mygrain/'?'index.html':u.pathname.replace('/mygrain/','');if(stage&&['index.html','sample-grid-browser.js','sample-grid-browser.css'].includes(name))return r.fulfill({path:path.join(stage,name),contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html'});return r.continue()});
 assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
 await page.goto(base);await page.waitForFunction(()=>window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await page.evaluate(async()=>{
 stopAllPerformancePlayback({silent:true});for(const l of SPARSE_RANDOM_LAYER_DEFINITIONS)l.setEnabled(false,{silent:true,skipSave:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});setFxMuted(true,{silent:true});
 setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);mygrainLoopFx.restore();mygrainChannelEq.restore();
 applyGlobalBpm(180);syncPatternLengthControls(16,{skipSave:true});await loadDrumMachineSampleFromSourceRelativePath('kick','samples_kicks','Nested/Tone_000_C4.wav','Tone_000_C4.wav');
 for(const k of ['kick','snare','hat','perc',...Object.keys(drumMachineExtraTracks)])getDrumMachinePattern(k).fill(k==='kick');setDrumMachineDirectOutput(true,{silent:true,skipSave:true});
 await applyLoadedBastardLoopBuffer(cloneAudioBufferForCurrentContext(drumMachineKickBuffer),'Transport fixture',{sourceKey:'import',bpm:180});setBastardLoopEnabled(true,{silent:true,skipSave:true});
 window.transportPCM=[];const meter=audioContext.createScriptProcessor(2048,2,2),mute=audioContext.createGain();mute.gain.value=0;finalAmplifierNode.connect(meter);meter.connect(mute);mute.connect(audioContext.destination);meter.onaudioprocess=e=>{let p=0;for(const x of e.inputBuffer.getChannelData(0)){if(!Number.isFinite(x))throw Error('Nonfinite PCM');p+=x*x}transportPCM.push(p)};
 });
 const grid=page.locator('#sampleGridBrowser'),click=async l=>phone?l.tap():l.click(),play=grid.locator('[data-grid-action=transport-play]'),stop=grid.locator('[data-grid-action=transport-stop]');
 const open=async target=>{await page.evaluate(t=>openDropboxSampleBrowser(t),target);await page.waitForFunction(()=>mygrainSampleGridBrowser.files.length&&!mygrainSampleGridBrowser.listController)};
 const checked=[];for(const target of process.env.QUICK?['bastardLoopA']:targets){
 await open(target);assert.equal(await play.innerText(),'▶');assert.equal(await stop.innerText(),'■');assert.equal(await play.getAttribute('aria-label'),'Start whole loop');assert.equal(await stop.getAttribute('aria-label'),'Stop whole loop');
 const same=await play.evaluate(b=>{const title=document.querySelector('#sampleGridTitle');return title.nextElementSibling===b&&b.nextElementSibling.dataset.gridAction==='transport-stop'});assert(same);
 await click(play);await page.waitForFunction(()=>drumMachinePlaying&&bastardLoopPlaying);const origin=await page.evaluate(()=>getSharedLoopTransportOriginTime());await click(play);assert.equal(await page.evaluate(()=>getSharedLoopTransportOriginTime()),origin,'Play must not restart');
 await click(stop);assert(await page.evaluate(()=>!drumMachinePlaying&&!bastardLoopPlaying&&!sequencerPlaying));assert(await grid.isVisible());
 await click(grid.locator('.sample-grid-cell').first());await page.waitForFunction(()=>!mygrainSampleGridBrowser.audio.paused&&mygrainSampleGridBrowser.audio.currentTime>.015);assert(await page.evaluate(()=>!drumMachinePlaying&&!bastardLoopPlaying),'sample audition must leave composition stopped');
 await click(stop);assert(await page.evaluate(()=>mygrainSampleGridBrowser.audio.paused));checked.push(target);await click(grid.locator('[data-grid-action=close]'));
 }
 console.log('PASS headers/start/stop/sample-only',engine,phone,checked.length);
 await open('bastardLoopA');const geometry=[];for(const size of [{width:320,height:568},{width:390,height:844},{width:699,height:800},{width:700,height:800},{width:701,height:800},{width:768,height:1024},{width:844,height:390},{width:1280,height:900}]){
 await page.setViewportSize(size);await page.waitForTimeout(60);const g=await grid.evaluate(e=>{const rect=s=>e.querySelector(s).getBoundingClientRect().toJSON(),style=s=>{const c=getComputedStyle(e.querySelector(s));return{color:c.color,background:c.backgroundColor}};return{panel:rect('.sample-grid-panel'),title:rect('.sample-grid-title'),play:rect('.sample-grid-transport-play'),stop:rect('.sample-grid-transport-stop'),close:rect('.sample-grid-close'),scroll:e.querySelector('.sample-grid-scroller').clientHeight,client:e.querySelector('.sample-grid-center').clientWidth,full:e.querySelector('.sample-grid-center').scrollWidth,green:style('.sample-grid-transport-play'),red:style('.sample-grid-transport-stop')}});
 assert(g.play.right<=g.stop.left&&g.stop.right<=g.close.left);assert(g.panel.left>=0&&g.panel.right<=size.width);assert(g.title.width>20,JSON.stringify(g));assert.equal(g.client,g.full);assert(g.scroll>40);assert(g.play.height>=44&&g.stop.height>=44);geometry.push({size,...g});if([320,390,844,1280].includes(size.width))await page.screenshot({path:path.join(task,`${engine}-${phone?'touch':'mouse'}-${size.width}.png`)});
 }
 await page.setViewportSize(phone?{width:390,height:844}:{width:1280,height:900});
 // Actual final-output silence/nonzero boundary, not just transport flags.
 await click(play);await page.evaluate(()=>transportPCM=[]);await page.waitForFunction(()=>transportPCM.some(x=>x>1e-4));await click(stop);await page.waitForTimeout(350);await page.evaluate(()=>transportPCM=[]);await page.waitForFunction(()=>transportPCM.length>=8);assert(await page.evaluate(()=>transportPCM.every(x=>x<1e-7)));
 // Stop and Close must invalidate a pending Q preparation before it reaches restart.
 for(const mode of ['stop','close']){
 await page.evaluate(()=>{window.realPrepare=prepareQForUiTransport;prepareQForUiTransport=()=>new Promise(r=>window.releasePrepare=()=>r(true))});await click(play);await page.waitForFunction(()=>Boolean(window.releasePrepare));await click(mode==='stop'?stop:grid.locator('[data-grid-action=close]'));await page.evaluate(()=>{releasePrepare();prepareQForUiTransport=realPrepare;delete window.releasePrepare});await page.waitForTimeout(80);assert(await page.evaluate(()=>!drumMachinePlaying&&!bastardLoopPlaying));if(mode==='close')await open('bastardLoopA');
 }
 // Native keyboard activation remains on the icon controls.
 await play.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>drumMachinePlaying);await stop.focus();await page.keyboard.press('Space');await page.waitForFunction(()=>!drumMachinePlaying);
 // Existing selected-source player is independent and still usable.
 await click(grid.locator('[data-grid-action=play-loop]'));await page.waitForFunction(()=>mygrainSampleGridBrowser.resultPlaying&&!mygrainSampleGridBrowser.audio.paused);assert(await page.evaluate(()=>!drumMachinePlaying));await click(stop);assert(await page.evaluate(()=>!mygrainSampleGridBrowser.previewing));
 assert.deepEqual(errors,[]);results.push({engine,phone,checked,geometry,finalPCM:true,pendingCancellation:true,keyboard:true,errors});await context.close();console.log('PASS',engine,phone,'geometry, PCM, cancellation, keyboard, multisample-result player');
 }}finally{await browser.close()}
}fs.writeFileSync(path.join(task,process.env.INSTALLED?'installed-results.json':'transport-results.json'),JSON.stringify(results,null,2))})().catch(e=>{console.error(e);process.exitCode=1});
