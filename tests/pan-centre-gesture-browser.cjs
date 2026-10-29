const assert=require('node:assert/strict');
const {chromium,webkit}=require('/root/.openclaw/workspace/node_modules/playwright-core');
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});
 try{const c=await b.newContext({viewport:{width:1280,height:900},hasTouch:true});const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='https://openclaw.blackcarburning.com')return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"seq-fixture"}};'});if(u.pathname.includes('/api/'))return r.fulfill({json:{ok:true,authenticated:true,user:{username:'seq-fixture'},files:[],songs:[],folders:[],samples:[],patches:[]}});if(!['GET','HEAD'].includes(r.request().method()))return r.abort();return r.continue()});
 await p.goto('https://openclaw.blackcarburning.com/mygrain/');await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);

 await p.waitForFunction(()=>window.mygrainLoopFx&&window.mygrainKMultitrack&&performance.getEntriesByType('resource').some(x=>x.name.includes('pan-centre-gesture.js')));
 await p.evaluate(()=>{for(const card of document.querySelectorAll('.performance-feature-card,#noiseCard'))mygrainDemand.run(card)});await p.waitForTimeout(200);
 const selector='[data-loop-fx="pan"], [data-k-pan], #grainSynthAPan, #grainSynthBPan, #performanceBastardLoopMPlusPan, #finalPanCenter';
 const pans=p.locator(selector);assert.equal(await pans.count(),21);
 for(let i=0;i<await pans.count();i++){
  const el=pans.nth(i);await el.fill(Number(await el.getAttribute('max'))===1?'0.7':'70');
  await el.dblclick({position:{x:20,y:8},delay:60});
  await p.waitForFunction(()=>!mygrainCardHistory.busy);await p.waitForTimeout(80);assert.equal(await el.inputValue(),'0','desktop pan '+i);
 }
 // Ordinary drags must remain edits, not be recognised as double taps.
 const pan=p.locator('#loopFx-X-pan');await pan.scrollIntoViewIfNeeded();let box=await pan.boundingBox();
 for(let i=0;i<2;i++){await p.mouse.move(box.x+box.width*.3,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+box.width*.8,box.y+box.height/2,{steps:5});await p.mouse.up();}
 assert.notEqual(await pan.inputValue(),'0');assert.notEqual(await p.evaluate(()=>mygrainLoopFx.channel('X').pan),0);
 // Real touch input, not dispatched synthetic events, on dynamically mounted and native pans.
 await p.setViewportSize({width:390,height:844});
 for(const sel of ['#loopFx-X-pan','#grainSynthAPan','[data-k-track="2"] [data-k-pan]','#performanceBastardLoopMPlusPan','#finalPanCenter']){
  const el=p.locator(sel);await el.scrollIntoViewIfNeeded();await el.fill(Number(await el.getAttribute('max'))===1?'-0.6':'-60');box=await el.boundingBox();
  const x=box.x+box.width*.25,y=box.y+box.height/2;await p.touchscreen.tap(x,y);await p.waitForTimeout(60);await p.touchscreen.tap(x,y);await p.waitForTimeout(120);await p.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await el.inputValue(),'0','touch '+sel);
 }
 const state=await p.evaluate(()=>({loop:mygrainLoopFx.channel('X').pan,grain:Number(document.getElementById('grainSynthAPan').value),k:mygrainKMultitrack.tracks[2].pan,mplus:bastardLoopMPlusPan,final:Number(document.getElementById('finalPanCenter').value)}));assert(Object.values(state).every(x=>x===0),JSON.stringify(state));
 // Non-pan bipolar sliders remain unchanged by a double click at their centre? Use dispatch to avoid native position edits.
 await p.evaluate(()=>{const el=document.getElementById('grainSynthAFineTune');el.value='45';el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));});assert.equal(await p.locator('#grainSynthAFineTune').inputValue(),'45');
 assert.deepEqual(errors,[]);console.log('PASS',engine,'21 desktop pans + 5 native-touch families; drag and non-pan exclusion',state);await c.close();
 }finally{await b.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
