'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18949/mygrain/',out='/tmp/mygrain-eq-song-2/evidence';assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);fs.mkdirSync(out,{recursive:true});
(async()=>{const results=[];for(const [engine,type] of Object.entries({chromium,webkit})){
 if(process.env.EQ_ENGINE&&process.env.EQ_ENGINE!==engine)continue;
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{for(const mobile of [false,true]){
  const c=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});assert.equal((await c.request.post(base+'api/auth/register',{data:{username:`eqcopy_${engine[0]}_${+mobile}_${Date.now()}`,password:'isolated-eq-copy-test'}})).status(),200);
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());p.setDefaultTimeout(45000);await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());await p.goto(base);await p.waitForFunction(()=>mygrainChannelEqUi&&mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  const keys=await p.evaluate(()=>MygrainChannelEq.KEYS);for(const key of keys){await p.evaluate(key=>mygrainChannelEqUi.open(key),key);assert.equal(await p.locator('[data-eq-q-slider]').count(),4);await p.evaluate(()=>mygrainChannelEqUi.close());}
  await p.evaluate(()=>mygrainChannelEqUi.open('A'));
  for(let band=0;band<4;band++){
   const range=p.locator(`[data-eq-q-slider="${band}"]`);await range.scrollIntoViewIfNeeded();const rect=await range.boundingBox(),before=await p.evaluate(()=>({q:mygrainChannelEq.get('A').bands.map(b=>b.q),undo:mygrainCardHistory.counts.undo}));
   if(mobile&&engine==='chromium'){
    const client=await c.newCDPSession(p),x=rect.x+rect.width*.2,y=rect.y+rect.height/2;await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await p.waitForTimeout(70);await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:rect.x+rect.width*.8,y}]});await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await client.detach();
   }else{await p.mouse.move(rect.x+rect.width*.2,rect.y+rect.height/2);await p.mouse.down();await p.waitForTimeout(70);await p.mouse.move(rect.x+rect.width*.8,rect.y+rect.height/2,{steps:5});await p.mouse.up();}
   await p.waitForFunction(()=>!mygrainCardHistory.busy);const after=await p.evaluate(i=>mygrainChannelEq.get('A').bands[i].q,band);assert(after>1,`${engine} Q slider no effect ${after}`);assert.equal(await p.evaluate(()=>mygrainCardHistory.counts.undo),before.undo+1);await p.evaluate(()=>mygrainCardHistory.undo());await p.waitForFunction(()=>!mygrainCardHistory.busy);assert.equal(await p.evaluate(i=>mygrainChannelEq.get('A').bands[i].q,band),before.q[band]);
  }
  // Native keyboard adjustments remain undoable; pointer cancellation restores Q.
  const slider=p.locator('[data-eq-q-slider="0"]');await slider.scrollIntoViewIfNeeded();
  const keyBefore=await p.evaluate(()=>mygrainChannelEq.get('A').bands[0].q);
  await slider.focus();await p.keyboard.press('ArrowRight');await p.waitForFunction(()=>!mygrainCardHistory.busy);
  assert(await p.evaluate(()=>mygrainChannelEq.get('A').bands[0].q)>keyBefore);
  await p.evaluate(()=>mygrainCardHistory.undo());await p.waitForFunction(()=>!mygrainCardHistory.busy);
  assert.equal(await p.evaluate(()=>mygrainChannelEq.get('A').bands[0].q),keyBefore);
  const cancelBefore=await p.evaluate(()=>({q:mygrainChannelEq.get('A').bands[0].q,undo:mygrainCardHistory.counts.undo}));
  await slider.dispatchEvent('pointerdown',{pointerId:91,button:0});await p.waitForTimeout(30);
  await slider.evaluate(el=>{el.value='900';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await slider.dispatchEvent('pointercancel',{pointerId:91});await p.waitForFunction(()=>!mygrainCardHistory.busy);
  assert.equal(await p.evaluate(()=>mygrainChannelEq.get('A').bands[0].q),cancelBefore.q);
  assert.equal(await p.evaluate(()=>mygrainCardHistory.counts.undo),cancelBefore.undo);
  await p.locator('#channelEqDialog').screenshot({path:`${out}/${engine}-${mobile?'phone':'desktop'}-q.png`});await p.evaluate(()=>mygrainChannelEqUi.close());assert.equal(await p.evaluate(()=>mygrainChannelEq.diagnostics().filters),0);
  const setup=await p.evaluate(async()=>{
   const ctl=mygrainSongBeta;stopAllPerformancePlayback({silent:true});setGeneratedLoopTransportEnabled(false,{silent:true,skipSave:true});applyGlobalBpm(300);syncPatternLengthControls(8,{skipSave:true});mygrainChannelEq.restore();
   const b=audioContext.createBuffer(1,audioContext.sampleRate/10,audioContext.sampleRate);for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=.02*Math.sin(2*Math.PI*440*i/b.sampleRate);bastardLoopBuffer=b;setBastardLoopEnabled(true,{silent:true,skipSave:true});
   const setting=mygrainChannelEq.get('A');setting.enabled=true;setting.bands[1].gain=-9;setting.bands[1].q=3.25;mygrainChannelEq.set('A',setting);
   document.getElementById('songBetaName').value='EQ copy acceptance';await ctl.newSong();await ctl.newPart({name:'Source'});mygrainChannelEq.restore();await ctl.newPart({name:'Target 1'});await ctl.newPart({name:'Target 2'});
   // Genuine pre-EQ legacy target. Only this disposable archive is rewritten.
   let part=ctl.song.parts[2],bytes=await ctl.request(`/${ctl.song.id}/parts/${part.id}`,{binary:true}),entries=parseStoredZipEntries(bytes),snapshot=JSON.parse(getZipText(entries,'song-part.json'));delete snapshot.state.modes.channelEq;
   const legacy=await createStoredZip([...entries].map(([path,data])=>({path,data:path==='song-part.json'?JSON.stringify(snapshot):data})));const saved=await ctl.request(`/${ctl.song.id}/parts/${part.id}/save?sha256=${part.sha256}`,{method:'POST',body:legacy});ctl.acceptSong(saved.song);
   window.eqRead=async part=>{const bytes=await ctl.request(`/${ctl.song.id}/parts/${part.id}`,{binary:true}),entries=parseStoredZipEntries(bytes),snapshot=JSON.parse(getZipText(entries,'song-part.json')),audio={};for(const a of snapshot.assets)audio[a.key]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',entries.get(a.path)))).join(',');return{snapshot,audio}};
   window.eqBefore=await Promise.all(ctl.song.parts.map(eqRead));window.eqLiveBefore=JSON.stringify(mygrainChannelEq.settings());for(const part of ctl.song.parts)ctl.expandedParts.add(`${ctl.song.id}:${part.id}`);ctl.render();return {song:ctl.song,expected:setting};
  });
  await p.locator('.song-beta-copy').first().click();const copy=p.locator('.song-beta-copy-dialog');assert.equal(await copy.locator('input[data-layer^="eq:"]').count(),26);await copy.locator('[data-layer="eq:A"]').check();await copy.locator('.song-beta-copy-selected').click();await p.waitForFunction(()=>!mygrainSongBeta.busy);
  const noDeviceProcessing=await p.evaluate(()=>{window.eqArmCalls=0;mygrainSongBeta.arm=async()=>{eqArmCalls++;throw Error('Paste must not Arm')};for(const name of ['capture','decode','upgradePart'])mygrainSongBetaAdapter[name]=()=>{throw Error('No device conversion during paste')};return true});assert(noDeviceProcessing);
  let sourceReads=0,pastes=0,pasteOrder=[];const track=req=>{const url=new URL(req.url());if(req.method()==='GET'&&/\/parts\/[a-f0-9]{32}$/.test(url.pathname))sourceReads++;if(url.pathname.endsWith('/paste-loop')){pastes++;pasteOrder.push(url.pathname)}};p.on('request',track);
  await p.locator('#songBetaPasteParts').click();const picker=p.locator('.song-beta-paste-dialog');assert.equal(await picker.locator('[data-part-id]').count(),3);assert.equal(await picker.locator('[data-paste-eq]').count(),26);
  await picker.locator('[data-paste-eq="A"]').uncheck();for(const key of ['B','K2','K5','drumKick','drumRoll'])await picker.locator(`[data-paste-eq="${key}"]`).check();for(const part of setup.song.parts)await picker.locator(`[data-part-id="${part.id}"]`).check();
  await picker.screenshot({path:`${out}/${engine}-${mobile?'phone':'desktop'}-paste.png`});await picker.locator('.song-beta-paste-selected').click();await p.waitForFunction(()=>!mygrainSongBeta.busy);p.off('request',track);assert.equal(sourceReads,0);assert.equal(pastes,3);assert(pasteOrder[2].includes(setup.song.parts[0].id));
  const saved=await p.evaluate(async()=>{const c=mygrainSongBeta;return{song:c.song,parts:await Promise.all(c.song.parts.map(eqRead)),armCalls:eqArmCalls,liveUnchanged:eqLiveBefore===JSON.stringify(mygrainChannelEq.settings()),before:eqBefore}});
  assert.equal(saved.armCalls,0);assert(saved.liveUnchanged);assert.notEqual(saved.song.parts[0].sha256,setup.song.parts[0].sha256);for(const key of ['B','K2','K5','drumKick','drumRoll'])assert.deepEqual(saved.parts[0].snapshot.state.modes.channelEq.channels[key],setup.expected);
  for(let i=1;i<3;i++){assert.deepEqual(saved.parts[i].audio,saved.before[i].audio);const actual=saved.parts[i].snapshot,old=saved.before[i].snapshot;for(const key of ['B','K2','K5','drumKick','drumRoll'])assert.deepEqual(actual.state.modes.channelEq.channels[key],setup.expected);for(const key of ['A','K1','drumSnare'])assert.equal(actual.state.modes.channelEq.channels[key].enabled,false);delete actual.state.modes.channelEq;delete old.state.modes.channelEq;delete actual.createdAt;delete old.createdAt;assert.deepEqual(actual,old);assert.equal(saved.song.parts[i].eqVersion,1);}
  // Global destination chooser also includes individual audio targets from all-drums.
  await p.evaluate(()=>{const c=mygrainSongBeta;c.copyLoop(c.song.parts[0],['K2','K4','drums']);c.render()});await p.locator('#songBetaPasteParts').click();assert.equal(await picker.locator('[data-paste-layer]').count(),10);await picker.locator('button').filter({hasText:'Cancel'}).click();
  // Multi-EQ source mapping is explicit; stale destination pickers cannot write.
  await p.evaluate(()=>{const c=mygrainSongBeta;c.copyLoop(c.song.parts[0],['eq:A','eq:K5']);c.render()});await p.locator('#songBetaPasteParts').click();await picker.locator('[data-paste-eq="drumHat"]').check();await picker.locator('[data-eq-source-for="drumHat"]').selectOption('K5');await picker.locator(`[data-part-id="${setup.song.parts[1].id}"]`).check();await p.evaluate(()=>{mygrainSongBeta.song={...mygrainSongBeta.song,revision:mygrainSongBeta.song.revision+1}});await picker.locator('.song-beta-paste-selected').click();await p.waitForFunction(()=>!mygrainSongBeta.busy);assert.match(await p.locator('#songBetaStatus').textContent(),/changed while choosing destinations/);
  for(const viewport of mobile?[{width:320,height:640},{width:844,height:390}]:[{width:1280,height:900}]){await p.setViewportSize(viewport);await p.locator('#songBetaPasteParts').click();const rect=await picker.boundingBox();assert(rect.x>=0&&rect.x+rect.width<=viewport.width+1);assert(await picker.evaluate(d=>d.scrollWidth<=d.clientWidth+1));await picker.locator('button').filter({hasText:'Cancel'}).click();}
  assert.deepEqual(errors,[]);results.push({engine,mobile,editors:26,bandsPerEditor:4,qGestureUndo:true,eqOnlyPasteTargets:5,destinationParts:3,sourceSavedLast:true,serverOwned:true,legacyConversion:true,audioUnchanged:true,stalePickerRejected:true});fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));console.log('PASS',engine,mobile);await c.close();
 }}finally{await browser.close()}}
})().catch(e=>{console.error(e);process.exitCode=1});
