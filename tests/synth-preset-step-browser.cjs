// Actual app/AudioContext and disposable localhost accounts only.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18934/mygrain/';assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence=process.env.MYGRAIN_SYNTH_STEP_EVIDENCE||'/tmp/mygrain-synth-preset-step';fs.mkdirSync(evidence,{recursive:true});
(async()=>{const results=[];for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{for(const [layout,width,height]of [['desktop',1280,900],['phone',390,844],['landscape',844,390]]){
  const mobile=layout!=='desktop';const c=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
  assert.equal((await c.request.post(base+'api/auth/register',{data:{username:`ps_${engine[0]}_${layout}_${Date.now()}`,password:'isolated-preset-stepping'}})).status(),200);
  const page=await c.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  const press=async selector=>{await page.locator(selector).scrollIntoViewIfNeeded();if(mobile)await page.locator(selector).tap();else await page.locator(selector).click();await page.waitForFunction(()=>!mygrainCardHistory.busy);};
  await page.goto(base);await page.waitForFunction(()=>mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await press('#start-btn');await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
  const ids=await page.evaluate(()=>SYNTH_POPUP_PRESETS.map(p=>p.id));assert.equal(ids.length,500);
  const identity=()=>page.evaluate(()=>({id:document.getElementById('synthPresetSelect').value,synth:document.getElementById('synthPresetValue').textContent,keyboard:document.getElementById('keyboardSynthPresetValue').textContent}));
  const check=async id=>{const s=await identity();assert.equal(s.id,id);assert.equal(s.synth,s.keyboard);return s;};
  await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});setSynthPresetSelectValue('custom');applyGlobalBpm(137);setKeyboardSoundSource('osc');setHoldEnabled(true);setArpeggiatorEnabled(false,{skipSave:true});});
  const count=await page.evaluate(()=>mygrainCardHistory.counts.undo);
  await press('#keyboardSynthPresetNextBtn');await check(ids[0]);assert.equal(await page.evaluate(()=>mygrainCardHistory.counts.undo),count+1);
  await press('#keyboardSynthPresetNextBtn');await check(ids[1]);
  await page.evaluate(()=>mygrainCardHistory.undo());await check(ids[0]);await page.evaluate(()=>mygrainCardHistory.redo());await check(ids[1]);
  await press('#keyboardSynthPresetPreviousBtn');await check(ids[0]);
  const geometry=await page.evaluate(()=>{const a=document.querySelector('#performanceKeyboardSoundSwitch [data-keyboard-sound="osc"]').getBoundingClientRect(),b=document.getElementById('keyboardSynthPresetNextBtn').getBoundingClientRect();return {below:b.y>=a.bottom,w:b.width,h:b.height,overflow:document.documentElement.scrollWidth>innerWidth};});assert.ok(geometry.below&&geometry.w>=44&&geometry.h>=44&&!geometry.overflow,JSON.stringify(geometry));
  await page.screenshot({path:`${evidence}/${engine}-${layout}-keyboard.png`});
  await page.evaluate(()=>openSynthPopup());await press('#synthPresetPreviousBtn');await check(ids.at(-1));await press('#synthPresetNextBtn');await check(ids[0]);
  await page.locator('#synthPresetSelect').selectOption(ids[250]);await check(ids[250]);await press('#synthPresetNextBtn');await check(ids[251]);
  await page.screenshot({path:`${evidence}/${engine}-${layout}-synth.png`});await press('#oscPopupCloseBtn');
  // A held physical key keeps sounding while presets change.
  await press('#keyboardContainer .key[data-note="C4"]');
  await page.evaluate(()=>{window.stepMeter=audioContext.createAnalyser();window.stepMute=audioContext.createGain();stepMute.gain.value=0;masterGain.connect(stepMeter);stepMeter.connect(stepMute);stepMute.connect(audioContext.destination);});
  const audible=()=>page.waitForFunction(()=>{const a=new Float32Array(stepMeter.fftSize);stepMeter.getFloatTimeDomainData(a);return a.some(v=>Math.abs(v)>1e-5);});await audible();
  const held=await page.evaluate(()=>[...heldNotes]);assert.ok(held.includes('C4'));
  await press('#keyboardSynthPresetNextBtn');await check(ids[252]);await audible();assert.deepEqual(await page.evaluate(()=>[...heldNotes]),held);assert.equal(await page.evaluate(()=>keyboardSoundSource),'osc');assert.equal(await page.evaluate(()=>Number(document.getElementById('globalBpmSlider').value)),137);
  await page.evaluate(()=>{masterGain.disconnect(stepMeter);stepMeter.disconnect();stepMute.disconnect();stopAllPerformancePlayback({silent:true});});
  // Saved custom patches keep their own library; stepping never overwrites one.
  await page.evaluate(()=>{document.getElementById('synthCustomPatchName').value='Keep my saved synth';saveSynthCustomPatchAs();});assert.match((await identity()).keyboard,/Saved: Keep my saved synth/);
  await press('#keyboardSynthPresetNextBtn');await check(ids[0]);assert.equal(await page.evaluate(()=>readSynthCustomPatchLibrary().length),1);
  // Actual amendment/save/recall on the portrait phone lane, never production Songs.
  if(layout==='phone'){
   await page.evaluate(async()=>{const c=mygrainSongBeta;document.getElementById('songBetaName').value='Disposable synth navigation';await c.newSong();await c.newPart({name:'Preset navigation',repeats:1});await c.finishEditing();await c.run(()=>c.amendPart(c.song.parts[0]));if(!c.editing)throw Error(document.getElementById('songBetaStatus').textContent);});
   await press('#keyboardSynthPresetNextBtn');const expected=await identity();
   await page.evaluate(async()=>{const c=mygrainSongBeta;await c.run(()=>c.savePart());await c.finishEditing();applySynthPopupPreset(SYNTH_POPUP_PRESETS[19].id);await c.recall(c.song.parts[0],{start:false});saveState({force:true});await mygrainSongBetaAdapter.whenPersisted();});
   assert.deepEqual(await identity(),expected);
  }
  const expected=await identity();await page.evaluate(()=>saveState({force:true}));await page.reload();await page.waitForFunction(()=>mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await press('#start-btn');await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);assert.deepEqual(await identity(),expected);
  assert.deepEqual(errors,[]);const result={engine,layout,factoryCount:500,synced:true,wrap:true,undoRedo:true,heldAudio:true,savedCustomPreserved:true,amendment:layout==='phone',reload:true,geometry,errors};results.push(result);console.log(JSON.stringify(result));await c.close();
 }}finally{await browser.close();}
}fs.writeFileSync(`${evidence}/results.json`,JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
