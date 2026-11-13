'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.BASE||'http://127.0.0.1:19334/mygrain/',out=process.env.OUT||'/tmp';assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{const results=[];for(const [engine,type]of Object.entries({chromium,webkit}))for(const phone of [false,true]){
 const label=engine+'-'+(phone?'phone':'desktop');if(process.env.CASES&&!process.env.CASES.split(',').includes(label))continue;
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{
 const c=await browser.newContext({viewport:{width:phone?390:1440,height:phone?844:1000},isMobile:phone,hasTouch:phone});
 assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
 const p=await c.newPage(),errors=[];p.setDefaultTimeout(90000);p.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.stack)});
 await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await p.evaluate(async()=>{for(const id of ['turntableCard','waspCard','filterPlaygroundCard']){const card=document.getElementById(id);mygrainDisplay.reveal(card);await mygrainDemand.run(card);}mygrainDisplay.reveal(document.getElementById('cookingPotCard'));document.getElementById('cookingPotCard').scrollIntoView({block:'start'});
 window.potInputSettings=()=>({mutilator:mygrainD.settings().mutilator,bassFace:mygrainBassFace.settings(),turntable:mygrainTurntable.settings(),resonator:mygrainResonator.settings(),...mygrainAcousticFx.settings(),wasp:mygrainWasp.settings(),playground:mygrainWasp.settings().playground});
 window.potInputValue=(key,index)=>{const v=potInputSettings()[key];return key==='resonator'?v.slots[index].source:key==='wasp'?v.routes[index].source:key==='turntable'?v.input||(v.route==='drums'?'drums':'all'):key==='playground'?v.input||'all':v.input||v.source||(key==='mutilator'?'D':'X')};
 });

 const report=await p.evaluate(async()=>{
 const layers=[...document.querySelectorAll('#performanceLayerSwitchesCard .acoustic-jump')].map(b=>b.textContent.trim());if(layers.length!==3||layers.some(t=>t!=='Jump'))throw Error('Layers labels '+layers);
 const menus=[...document.querySelectorAll('[data-effect-input-proxy]')],targets=[];
 for(const s of menus){const key=s.dataset.effectInputProxy;for(const value of ['drumKick','K3','D','all','DAW']){s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}));await mygrainCookingPot.whenReady();await new Promise(r=>setTimeout(r,60));const j=s.parentElement.querySelector('[data-pot-source-jump]'),expected=MygrainEffectInputs.jumpTarget(value);if(j.hidden!==!expected||j.dataset.jumpTarget!==(expected||undefined))throw Error('J mismatch '+key+' '+value+' '+j.outerHTML);if(expected&&!document.querySelector(expected))throw Error('Missing destination '+expected);targets.push({key,value,hidden:j.hidden,target:j.dataset.jumpTarget});}}
 await mygrainAcousticFx.set('wireWorld',{...mygrainAcousticFx.settings('wireWorld'),enabled:true,source:'D',level:.6});await mygrainAcousticFx.set('sonicCrystal',{...mygrainAcousticFx.settings('sonicCrystal'),enabled:true,source:'A',level:.6});clearAllPerformanceSoloStates({silent:true,skipSave:true});setLoopLayerSolo('bastardd',{silent:true,skipSave:true});await mygrainCookingPot.whenReady();if(!mygrainEffectOutput.isSolo('wireWorld')||mygrainEffectOutput.isSolo('sonicCrystal'))throw Error('Source Solo missing route');
 await mygrainAcousticFx.set('wireWorld',{...mygrainAcousticFx.settings('wireWorld'),source:'A'});await mygrainCookingPot.whenReady();if(mygrainEffectOutput.isSolo('wireWorld'))throw Error('Route change retained stale Solo');
 await mygrainAcousticFx.set('wireWorld',{...mygrainAcousticFx.settings('wireWorld'),source:'D'});mygrainEffectOutput.setSolo('wireWorld');setLoopLayerSolo('none',{silent:true,skipSave:true});await mygrainCookingPot.whenReady();if(!mygrainEffectOutput.isSolo('wireWorld'))throw Error('Manual Solo lost');mygrainEffectOutput.setSolo(null);
 return {layers,targets};});
 const geometry=[];for(const width of [320,390,844,960,961,1440]){await p.setViewportSize({width,height:900});await p.waitForTimeout(80);geometry.push(await p.evaluate(()=>{const rows=[...document.querySelectorAll('.pot-input')].map(el=>{const r=el.getBoundingClientRect(),s=el.querySelector('select').getBoundingClientRect();return{w:r.width,sw:s.width,overflow:s.right>r.right+1};});if(rows.some(r=>r.sw<52||r.overflow))throw Error('Input overflow '+innerWidth+JSON.stringify(rows));return{width:innerWidth,rows};}));}
 await p.screenshot({path:out+'/route-solo-'+label+'.png',fullPage:false});assert.deepEqual(errors,[]);results.push({label,report,geometry});await c.close();
 }finally{await browser.close();}
 }fs.writeFileSync(out+'/route-solo-browser.json',JSON.stringify(results,null,2));console.log('PASS '+results.length+' Chromium/WebKit desktop/touch profiles: Layers labels, 55 linked routes/profile, grouped destinations, route Solo refresh, manual ownership, six widths');
})().catch(e=>{console.error(e);process.exitCode=1});
