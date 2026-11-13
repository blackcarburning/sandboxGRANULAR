'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19038/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const ctx=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true});assert.equal((await ctx.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-q-drag'}})).status(),200);
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(45000);await page.goto(base);await page.waitForFunction(()=>window.mygrainQCustomChords&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});mygrainQ.open();mygrainQ.state.record=false;mygrainQ.state.sequence.fill(null);mygrainQ.changed({reschedule:false});window.auditions=[];mygrainQ.audition=async chord=>auditions.push(chord.notes.slice());});
 async function drag(source,target,mobile){
 await target.scrollIntoViewIfNeeded(); await source.scrollIntoViewIfNeeded();
 if(!mobile)await source.dragTo(target);
 else{
 const a=await source.boundingBox(),b=await target.boundingBox(),start={x:a.x+a.width/2,y:a.y+a.height/2},end={x:b.x+b.width/2,y:b.y+b.height/2};
 if(engine==='chromium'){const cdp=await ctx.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});await page.waitForTimeout(380);for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/12,y:start.y+(end.y-start.y)*i/12}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
 else{await source.dispatchEvent('pointerdown',{pointerId:99,pointerType:'touch',clientX:start.x,clientY:start.y,bubbles:true});await page.waitForTimeout(380);await source.dispatchEvent('pointermove',{pointerId:99,pointerType:'touch',clientX:end.x,clientY:end.y,bubbles:true});await source.dispatchEvent('pointerup',{pointerId:99,pointerType:'touch',clientX:end.x,clientY:end.y,bubbles:true});}
 }
 }
 for(const mobile of [false,true]){
 await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:900});await page.evaluate(()=>{mygrainQ.state.record=false;mygrainQ.state.sequence.fill(null);mygrainQ.changed({reschedule:false});mygrainQ.resetEditorHistory()});
 const source=page.locator('#bastardLoopQPalette [data-q-degree]').first(),target=page.locator('[data-q-step="2"]');await source.scrollIntoViewIfNeeded();
 const expected=(await source.getAttribute('data-notes')).split(',').map(Number);
 if(mobile){
 const a=await source.boundingBox(),start={x:a.x+a.width/2,y:a.y+a.height/2};
 const scrollable=await page.evaluate(()=>{const p=document.getElementById('bastardLoopQPalette');p.scrollTop=0;return p.scrollHeight>p.clientHeight+30});
 if(scrollable){
 if(engine==='chromium'){const cdp=await ctx.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});for(const dy of [15,30,45])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x,y:start.y-dy}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
 else{await source.dispatchEvent('pointerdown',{pointerId:98,pointerType:'touch',clientX:start.x,clientY:start.y,bubbles:true});await source.dispatchEvent('pointermove',{pointerId:98,pointerType:'touch',clientX:start.x,clientY:start.y-45,bubbles:true});await source.dispatchEvent('pointerup',{pointerId:98,pointerType:'touch',clientX:start.x,clientY:start.y-45,bubbles:true});}
 assert(await page.evaluate(()=>document.getElementById('bastardLoopQPalette').scrollTop>0));assert(await page.evaluate(()=>mygrainQ.state.sequence.every(s=>!s)));await page.evaluate(()=>document.getElementById('bastardLoopQPalette').scrollTop=0);await page.waitForTimeout(720);
 }
 }
 // Ordinary Practice tap remains audition-only.
 if(mobile)await source.tap();else await source.click();assert(await page.evaluate(()=>mygrainQ.state.sequence.every(s=>!s)));assert(await page.evaluate(()=>auditions.length>0));
 await target.scrollIntoViewIfNeeded();
 await drag(source,target,mobile);
 await page.waitForFunction(()=>!!mygrainQ.state.sequence[2]);assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[2].notes),expected);assert.equal(await page.evaluate(()=>mygrainQ.state.record),false);
 assert.equal(await page.evaluate(()=>mygrainQ.state.sequence.filter(s=>s?.notes?.length).length),1);
 await page.evaluate(()=>mygrainQ.travelEditorHistory('undo'));assert.equal(await page.evaluate(()=>mygrainQ.state.sequence[2]),null);await page.evaluate(()=>mygrainQ.travelEditorHistory('redo'));assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[2].notes),expected);
 const before=await page.evaluate(()=>JSON.stringify(mygrainQ.state.sequence));const a=await source.boundingBox();await source.dispatchEvent('pointerdown',{pointerId:100,pointerType:'touch',clientX:a.x+5,clientY:a.y+5,bubbles:true});await page.waitForTimeout(350);await source.dispatchEvent('pointercancel',{pointerId:100,pointerType:'touch',bubbles:true});assert.equal(await page.evaluate(()=>JSON.stringify(mygrainQ.state.sequence)),before);assert.equal(await page.locator('.q-custom-drag-ghost').count(),0);
 // Complete saved snapshot contains the explicit edit in the existing Q schema.
 const saved=await page.evaluate(async()=>{const blob=await mygrainSongBetaAdapter.capture();const entries=parseStoredZipEntries(await blob.arrayBuffer());return JSON.parse(getZipText(entries,'song-part.json')).state.q});assert.deepEqual(saved.sequence[2].notes,expected);assert.equal(saved.record,false);
 const entriesBefore=await page.evaluate(()=>mygrainQCustomChords.getEntries().length);await drag(source,page.locator('#qCustomChordPool'),mobile);assert.equal(await page.evaluate(()=>mygrainQCustomChords.getEntries().length),entriesBefore+1);
 const poolSource=page.locator('.q-custom-chord-play').last();await poolSource.scrollIntoViewIfNeeded();await drag(poolSource,page.locator('[data-q-step="2"]'),mobile);await page.waitForFunction(()=>mygrainQ.state.sequence[2]?.customChord===true);assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[2].notes),expected);assert.equal(await page.evaluate(()=>mygrainQ.state.record),false);
 console.log('PASS',engine,mobile?'touch':'desktop',JSON.stringify({expected,practiceTap:true,drop:true,undoRedo:true,cancel:true,snapshot:true}));
 }
 assert.deepEqual(errors,[]);await ctx.close();
 }finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
