'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL;assert.match(base||'',/^http:\/\/127\.0\.0\.1:\d+$/);
(async()=>{for(const [name,engine]of Object.entries({chromium,webkit})){
 const browser=await engine.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',extraHTTPHeaders:{'X-Mygrain-User':'admin'}});
 assert.equal((await context.request.post(base+'/mygrain/api/auth/login',{data:{username:'admin',password:process.env.MYGRAIN_TEST_ADMIN_PASSWORD}})).status(),200);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 await page.goto(base+'/mygrain/');await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');
 await page.evaluate(()=>mygrainPower.set(true));
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');
 assert.equal(await page.evaluate(()=>mygrainPower.active),true);
 await page.locator('#start-btn').tap();
 await page.waitForFunction(()=>!document.getElementById('mygrainPowerNotice')?.hidden);
 assert.match(await page.locator('#mygrainPowerNotice').textContent(),/Low Power ON/);
 await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended,{timeout:60000});
 await page.evaluate(()=>{
  // Actual drum randomisation is safe without a loop sample; all random APIs are statically checked too.
  randomizeDrumMachinePatterns({skipSave:true});
 });
 assert.equal(await page.evaluate(()=>mygrainPower.active),true);
 await page.evaluate(()=>{
  const card=document.createElement('section');card.id='diagnosticReverbCard';card.className='performance-feature-card';
  card.innerHTML='<input id="diagnosticReverbMix" type="range" min="0" max="100" value="5"><input id="diagnosticReverbOn" type="checkbox"><input id="privateText" value="DO_NOT_LOG_ME"><select id="privateSample"><option>PRIVATE.wav</option></select>';
  document.body.append(card);const slider=card.querySelector('input');
  slider.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
  for(let i=0;i<500;i++){slider.value=i%100;slider.dispatchEvent(new Event('input',{bubbles:true}));}
  slider.value=72;slider.dispatchEvent(new Event('change',{bubbles:true}));
  const on=document.getElementById('diagnosticReverbOn');on.checked=true;on.dispatchEvent(new Event('change',{bubbles:true}));
  for(const id of ['privateText','privateSample'])document.getElementById(id).dispatchEvent(new Event('change',{bubbles:true}));
  dispatchEvent(new CustomEvent('mygrain-ui-busy'));dispatchEvent(new CustomEvent('mygrain-ui-settled'));
 });
 const log=await page.evaluate(()=>mygrainRuntimeDiagnostics.snapshot());
 assert.equal(log.breadcrumbs.filter(e=>e.control==='diagnosticReverbMix'&&e.action==='slider-start').length,1);
 assert.equal(log.breadcrumbs.filter(e=>e.control==='diagnosticReverbMix'&&e.action==='slider-end'&&e.value===72).length,1);
 assert(log.breadcrumbs.some(e=>e.control==='diagnosticReverbOn'&&e.value===true));
 assert(log.breadcrumbs.some(e=>e.action==='scroll-start'));assert(log.breadcrumbs.some(e=>e.type==='power-mode'&&e.enabled===true));
 assert(!JSON.stringify(log.breadcrumbs).includes('PRIVATE.wav'));assert(!JSON.stringify(log.breadcrumbs).includes('DO_NOT_LOG_ME'));
 const normal=await page.evaluate(()=>buildDebugLogPayload());assert(JSON.stringify(normal).includes('diagnosticReverbMix'),'Breadcrumbs must reach the normal submitted log');
 await page.evaluate(()=>mygrainPower.set(false));await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');assert.equal(await page.evaluate(()=>mygrainPower.active),false);
 await page.locator('#start-btn').tap();await page.waitForFunction(()=>document.getElementById('mygrainPowerNotice')?.textContent.includes('Low Power OFF'));
 assert.deepEqual(errors,[]);console.log('PASS',name,'ON/OFF reload preference; startup notices; real randomisation retains ON; bounded slider/toggle/scroll breadcrumbs in normal log; private text excluded');
 await context.close();
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
