'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.BASE||'http://127.0.0.1:19334/mygrain/',out=process.env.OUT||'/tmp';assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{const results=[];for(const [engine,type]of Object.entries({chromium,webkit}))for(const phone of [false,true]){
 const label=engine+'-'+(phone?'phone':'desktop');if(process.env.CASES&&!process.env.CASES.split(',').includes(label))continue;
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{
 const c=await browser.newContext({viewport:{width:phone?390:1440,height:phone?844:1000},isMobile:phone,hasTouch:phone});
 assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
 const p=await c.newPage(),errors=[];p.setDefaultTimeout(90000);p.on('console',m=>console.log('BROWSER',m.text()));p.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.stack)});
 await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await p.evaluate(async()=>{for(const id of ['turntableCard','waspCard','filterPlaygroundCard']){const card=document.getElementById(id);mygrainDisplay.reveal(card);await mygrainDemand.run(card);}mygrainDisplay.reveal(document.getElementById('cookingPotCard'));document.getElementById('cookingPotCard').scrollIntoView({block:'start'});
 window.potInputSettings=()=>({mutilator:mygrainD.settings().mutilator,bassFace:mygrainBassFace.settings(),turntable:mygrainTurntable.settings(),resonator:mygrainResonator.settings(),...mygrainAcousticFx.settings(),wasp:mygrainWasp.settings(),playground:mygrainWasp.settings().playground});
 window.potInputValue=(key,index)=>{const v=potInputSettings()[key];return key==='resonator'?v.slots[index].source:key==='wasp'?v.routes[index].source:key==='turntable'?v.input||(v.route==='drums'?'drums':'all'):key==='playground'?v.input||'all':v.input||v.source||(key==='mutilator'?'D':'X')};
 });

 const report=await p.evaluate(async()=>{
  const destinations=MygrainEffectInputs.SOURCES.map(source=>{const selector=MygrainEffectInputs.jumpTarget(source);if(selector&&!document.querySelector(selector))throw Error('Missing card '+source+' '+selector);return{source,selector}});
  console.log('navigation destinations checked');stopAllPerformancePlayback({silent:true});for(const l of SPARSE_RANDOM_LAYER_DEFINITIONS)l.setEnabled(false,{silent:true,skipSave:true});const buffer=audioContext.createBuffer(2,audioContext.sampleRate,audioContext.sampleRate);for(const ch of [0,1])for(let i=0;i<buffer.length;i++)buffer.getChannelData(ch)[i]=.05*Math.sin(i*.04);console.log('loading D');await mygrainD.apply(buffer,'route-test.wav',{bpm:240});mygrainD.enable(true,{skipSave:true});console.log('stir start');await mygrainCookingPot.stir({big:true});console.log('stir done');await mygrainCookingPot.whenReady();await new Promise(r=>setTimeout(r,150));
  const menus=[...document.querySelectorAll('[data-effect-input-proxy]')];for(const s of menus){const key=s.dataset.effectInputProxy,index=+s.dataset.potInputIndex,v=potInputValue(key,index),expected=MygrainEffectInputs.jumpTarget(v),j=s.parentElement.querySelector('[data-pot-source-jump]');if(s.value!==v||j.hidden!==!expected||j.dataset.jumpTarget!==(expected||undefined))throw Error('Randomise J stale '+key);}
  window.routeJumpTrace=[];const original=mygrainJumpToButton;window.mygrainJumpToButton=(button,...args)=>{const result=original(button,...args);routeJumpTrace.push(button.dataset.jumpTarget);return result;};return{destinations,stir:true};
 });
 for(const source of ['drumSnare','K3','D']){
  await p.evaluate(async source=>{await mygrainAcousticFx.set('wireWorld',{...mygrainAcousticFx.settings('wireWorld'),source});await mygrainCookingPot.whenReady();mygrainJumpToButton(document.getElementById('sectionJumpCookingPotBtn'));},source);await p.waitForTimeout(500);
  await p.screenshot({path:out+'/pot-source-'+label+'-'+source+'.png'});console.log('click',source);await p.locator('[data-pot-source-jump="wireWorld"]').click();await p.waitForTimeout(400);assert.equal(await p.evaluate(()=>routeJumpTrace.at(-1)),await p.evaluate(s=>MygrainEffectInputs.jumpTarget(s),source));
 }
 assert.deepEqual(errors,[]);results.push({label,report,jumps:await p.evaluate(()=>routeJumpTrace)});console.log('PASS actual J navigation, all 31 destinations, BIG STIR refresh',label);await c.close();
 }finally{await browser.close()}
}fs.writeFileSync(out+'/route-navigation.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
