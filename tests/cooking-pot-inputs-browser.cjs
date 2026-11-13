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
 const inventory=await p.evaluate(()=>[...document.querySelectorAll('[data-effect-input-proxy]')].map(s=>({key:s.dataset.effectInputProxy,index:Number(s.dataset.potInputIndex),id:s.id,value:s.value,expected:potInputValue(s.dataset.effectInputProxy,Number(s.dataset.potInputIndex)),options:[...s.options].map(o=>o.value),label:s.getAttribute('aria-label')})));
 assert.equal(inventory.length,11);for(const s of inventory){assert.deepEqual(s.options,await p.evaluate(()=>MygrainEffectInputs.SOURCES));assert.equal(s.value,s.expected);assert.equal(s.id,'');assert(s.label.includes('input'));}
 const potBefore=await p.evaluate(()=>mygrainCookingPot.settings()),powerBefore=await p.evaluate(()=>Object.fromEntries(Object.entries(potInputSettings()).map(([k,v])=>[k,v.enabled])));
 const choices=['all','K5','drums','Q','DAW','W','A','drumKick','D','N','sample'];
 for(const [i,s]of inventory.entries()){
  const selector=`[data-effect-input-proxy="${s.key}"][data-pot-input-index="${s.index}"]`,input=p.locator(selector),value=choices[i];
  await input.scrollIntoViewIfNeeded();await input.selectOption(value);await p.waitForFunction(({key,index,value})=>!mygrainCardHistory.busy&&potInputValue(key,index)===value,{key:s.key,index:s.index,value});assert.equal(await input.inputValue(),value);
  const cardValue=await p.evaluate(({key,index})=>{const ids={mutilator:'#mutilatorInput',bassFace:'#bassFaceInput',turntable:'[data-tt="input"]',resonator:`#resonator-${index}-source`,wireWorld:'#wireWorldSource',sonicCrystal:'#sonicCrystalSource',bubbleChamber:'#bubbleChamberSource',wasp:`[data-wasp-route="${index}"] [data-wasp="source"]`,playground:'[data-playground="input"]'};return document.querySelector(ids[key]).value;},s);assert.equal(cardValue,value);
 }
 await p.evaluate(()=>mygrainCookingPot.whenReady());assert.deepEqual(await p.evaluate(()=>mygrainCookingPot.settings()),potBefore);assert.deepEqual(await p.evaluate(()=>Object.fromEntries(Object.entries(potInputSettings()).map(([k,v])=>[k,v.enabled]))),powerBefore);
 // One source choice is one history step, not a separate proxy snapshot.
 await p.evaluate(()=>mygrainCardHistory.undo());await p.waitForFunction(()=>!mygrainCardHistory.busy&&potInputValue('playground',0)==='all');assert.equal(await p.locator('[data-effect-input-proxy="playground"]').inputValue(),'all');
 await p.evaluate(()=>mygrainCardHistory.redo());await p.waitForFunction(()=>!mygrainCardHistory.busy&&potInputValue('playground',0)==='sample');
 const canonical={mutilator:'#mutilatorInput',bassFace:'#bassFaceInput',turntable:'[data-tt="input"]',resonator:'#resonator-0-source',wireWorld:'#wireWorldSource',sonicCrystal:'#sonicCrystalSource',bubbleChamber:'#bubbleChamberSource',wasp:'[data-wasp-route="0"] [data-wasp="source"]',playground:'[data-playground="input"]'};
 for(const [key,selector]of Object.entries(canonical)){
  const target=p.locator(selector);await target.evaluate(el=>{mygrainDisplay.reveal(el.closest('.performance-feature-card')||el.parentElement);el.scrollIntoView({block:'center'})});await target.selectOption('K2');await p.waitForFunction(k=>!mygrainCardHistory.busy&&potInputValue(k,0)==='K2',key);await p.waitForFunction(k=>document.querySelector(`[data-effect-input-proxy="${k}"]`).value==='K2',key);
 }
 // Changing the fader/power, Pot order and saves must not create a second source owner.
 const saved=await p.evaluate(async()=>{const preset=gatherPreset(),state=saveState({snapshotOnly:true,force:true}),blob=await mygrainSongBetaAdapter.capture(),decoded=await mygrainSongBetaAdapter.decode(await blob.arrayBuffer(),{buffers:new Map(),bytes:0,limitBytes:256*1024*1024});window.inputPreset=preset;window.inputDecoded=decoded;window.inputExpected=potInputSettings();return{expected:inputExpected,state:state.selects,zipSelects:decoded.snapshot.state.selects,controls:decoded.snapshot.extra.controls};});
 const withoutProxies=await p.evaluate(()=>{const inputs=[...document.querySelectorAll('[data-effect-input-proxy]')].map(s=>({s,parent:s.parentNode}));for(const {s}of inputs)s.remove();try{return saveState({snapshotOnly:true,force:true}).selects;}finally{for(const {s,parent}of inputs)parent.append(s);}});assert.deepEqual(saved.state,withoutProxies);const zipExpected={...withoutProxies};delete zipExpected.songBetaSongs;delete zipExpected.songBetaArmConcurrency;assert.deepEqual(saved.zipSelects,zipExpected);assert(!JSON.stringify(saved.controls).includes('effect-input-proxy'));
 await p.evaluate(async()=>{await mygrainTurntable.restore({...mygrainTurntable.settings(),input:'A'});applyPreset(inputPreset);await mygrainCookingPot.whenReady();});
 assert.deepEqual(await p.evaluate(()=>potInputSettings()),saved.expected);
 await p.evaluate(async()=>{await mygrainAcousticFx.set('wireWorld',{...mygrainAcousticFx.settings('wireWorld'),source:'B'});mygrainSongBetaAdapter.recall(inputDecoded,{start:false});await mygrainCookingPot.whenReady();});
 assert.deepEqual(await p.evaluate(()=>potInputSettings()),saved.expected);
 for(const width of [320,390,844,960,961,1440]){
  await p.setViewportSize({width,height:900});await p.evaluate(()=>{mygrainDisplay.reveal(document.getElementById('cookingPotCard'));document.getElementById('cookingPotCard').scrollIntoView({block:'start'})});await p.waitForTimeout(200);
  const geometry=await p.evaluate(()=>{const c=document.getElementById('cookingPotCard');return{card:c.clientWidth,scroll:c.scrollWidth,root:document.documentElement.scrollWidth,width:innerWidth,rows:[...c.querySelectorAll('[data-pot-effect]')].map(row=>{const a=row.querySelector('.pot-effect-jump').getBoundingClientRect(),b=row.querySelector('.pot-inputs').getBoundingClientRect(),s=row.querySelector('select').getBoundingClientRect();return{key:row.dataset.potEffect,name:{x:a.x,y:a.y,right:a.right,bottom:a.bottom},input:{x:b.x,y:b.y,right:b.right,bottom:b.bottom},selectWidth:s.width,rowHeight:row.getBoundingClientRect().height,font:getComputedStyle(row.querySelector('select')).fontSize}})}});
  assert(geometry.scroll<=geometry.card+1,JSON.stringify(geometry));assert(geometry.root<=geometry.width+1);for(const row of geometry.rows){if(width<=960)assert(row.input.y>=row.name.bottom-1,JSON.stringify({width,row}));else assert(row.input.x>=row.name.right-1,JSON.stringify({width,row}));assert(row.selectWidth>=52,JSON.stringify({width,row}));}
  if(width===(phone?390:1440))await p.locator('#cookingPotCard .pot-table').screenshot({path:out+'/'+label+'-sources.png'});
 }
 await p.evaluate(()=>saveState({force:true}));await p.reload();await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await p.evaluate(()=>{window.potInputSettings=()=>({mutilator:mygrainD.settings().mutilator,bassFace:mygrainBassFace.settings(),turntable:mygrainTurntable.settings(),resonator:mygrainResonator.settings(),...mygrainAcousticFx.settings(),wasp:mygrainWasp.settings(),playground:mygrainWasp.settings().playground});});
 assert.deepEqual(await p.evaluate(()=>potInputSettings()),saved.expected);assert.deepEqual(await p.evaluate(()=>[...document.querySelectorAll('[data-effect-input-proxy]')].map(s=>s.value)),inventory.map(s=>s.index===1?(s.key==='resonator'?'DAW':'N'):'K2'));
 assert.deepEqual(errors,[]);results.push({label,menus:11,options:33,linkedDirections:11+9,undoRedo:true,jsonZipReload:true,noDuplicateSavedState:true,geometry:[320,390,844,960,961,1440],errors});fs.writeFileSync(out+'/pot-inputs-browser.json',JSON.stringify(results,null,2));console.log('PASS',label);await c.close();
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
