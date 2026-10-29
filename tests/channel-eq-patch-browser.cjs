'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18948/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
(async()=>{const results=[];for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 assert.equal((await c.request.post(base+'api/auth/register',{data:{username:`eqzip_${engine[0]}_${Date.now()}`,password:'isolated-eq-patch-fixture'}})).status(),200);
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());await p.goto(base);await p.waitForFunction(()=>window.mygrainChannelEqUi&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 // Genuine Chromium touch input (not mouse emulation), plus cancelled-drag history.
 await p.evaluate(()=>mygrainChannelEqUi.open('A'));await p.locator('.ceq-graph').scrollIntoViewIfNeeded();
 if(engine==='chromium'){
  const handle=await p.locator('[data-eq-handle="1"]').boundingBox(),before=await p.evaluate(()=>mygrainCardHistory.counts.undo),cdp=await c.newCDPSession(p),x=handle.x+handle.width/2,y=handle.y+handle.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await p.waitForTimeout(60);
  for(let i=1;i<=4;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+i*7,y:y-i*5}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForFunction(()=>!mygrainCardHistory.busy);assert(await p.evaluate(()=>mygrainChannelEq.get('A').bands[1].frequency>400&&mygrainChannelEq.get('A').bands[1].gain>0));assert.equal(await p.evaluate(()=>mygrainCardHistory.counts.undo),before+1);await cdp.detach();
 }
 const original=await p.evaluate(()=>({value:mygrainChannelEq.get('A'),undo:mygrainCardHistory.counts.undo})),handle=await p.locator('[data-eq-handle="1"]').boundingBox();await p.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await p.mouse.down();await p.mouse.move(handle.x+handle.width/2+20,handle.y+handle.height/2-20);await p.waitForTimeout(60);await p.keyboard.press('Escape');await p.mouse.up();await p.waitForFunction(()=>!mygrainCardHistory.busy);assert.deepEqual(await p.evaluate(()=>({value:mygrainChannelEq.get('A'),undo:mygrainCardHistory.counts.undo})),original);await p.evaluate(()=>mygrainChannelEqUi.close());
 const result=await p.evaluate(async()=>{
  const configs=mygrainChannelEq.settings();MygrainChannelEq.KEYS.forEach((key,i)=>{const c=configs.channels[key];c.enabled=i%2===0;c.bands[1].frequency=300+i*100;c.bands[1].gain=-12+i*.5;c.bands[0].q=1+i*.1;c.bands[3].type='lowpass';c.bands[3].slope=96;});mygrainChannelEq.restore(configs);
  const b=audioContext.createBuffer(2,Math.round(audioContext.sampleRate*.1),audioContext.sampleRate);for(let ch=0;ch<2;ch++)for(let i=0;i<b.length;i++)b.getChannelData(ch)[i]=.01*Math.sin(2*Math.PI*440*i/b.sampleRate);bastardLoopBuffer=b;setBastardLoopEnabled(true,{silent:true,skipSave:true});
  const before=JSON.stringify(mygrainChannelEq.settings()),blob=await buildPatchZipBlob('test-eq.zip'),bytes=await blob.arrayBuffer(),entries=parseStoredZipEntries(bytes),stored=JSON.parse(getZipText(entries,'song-part.json'));
  if(JSON.stringify(stored.state.modes.channelEq)!==before)throw Error('ZIP dropped channel EQ');const assets=stored.assets.map(a=>({key:a.key,hash:a.sha256}));
  mygrainChannelEq.restore();await openPatchZipFromArrayBuffer(bytes,'current-EQ-patch.zip');const exact=JSON.stringify(mygrainChannelEq.settings())===before;
  const loaded=await mygrainSongBetaAdapter.capture(),loadedEntries=parseStoredZipEntries(await loaded.arrayBuffer()),loadedState=JSON.parse(getZipText(loadedEntries,'song-part.json'));
  const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');const audio=[];for(const a of stored.assets){const other=loadedState.assets.find(x=>x.key===a.key);if(!other)throw Error('Lost patch audio '+a.key);audio.push({key:a.key,same:await digest(entries.get(a.path))===await digest(loadedEntries.get(other.path))});}
  const preset=gatherPreset();delete preset.channelEq;const legacy=await createStoredZip([{path:'preset.json',data:JSON.stringify(preset)}]);await openPatchZipFromArrayBuffer(await legacy.arrayBuffer(),'pre-EQ-preset.zip');const legacyOff=Object.values(mygrainChannelEq.settings().channels).every(c=>!c.enabled);
  return{exact,legacyOff,audio,channels:Object.keys(configs.channels).length,zipBytes:blob.size};
 });assert(result.exact&&result.legacyOff);assert.equal(result.channels,26);assert(result.audio.length&&result.audio.every(a=>a.same),JSON.stringify(result));assert.deepEqual(errors,[]);console.log('PATCH',engine,result);results.push({engine,...result});await c.close();
 }finally{await browser.close()}}
 fs.writeFileSync('/tmp/mygrain-channel-eq/patch-results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
