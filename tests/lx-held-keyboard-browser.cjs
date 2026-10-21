// Real audio and input checks against disposable local stores only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18889/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence = process.env.LX_KEY_EVIDENCE || '/tmp/mygrain-lx-keyboard';
fs.mkdirSync(evidence, {recursive:true});
(async () => {
 const results=[];
 for (const [engine,type] of Object.entries({chromium,webkit})) {
  const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try {
   for (const mobile of (process.env.LX_KEY_DESKTOP_ONLY ? [false] : [false,true])) {
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
    const credentials={username:`lx_${engine}_${mobile}_${Date.now()}`,password:'isolated-lx-fixture'};
    assert.equal((await context.request.post(base+'api/auth/register',{data:credentials})).status(),200);
    const page=await context.newPage(), errors=[];
    page.setDefaultTimeout(35000);
    page.on('pageerror', e=>errors.push(e.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
    await page.goto(base);
    await page.waitForFunction(()=>window.mygrainSongBeta&&!mygrainSongBeta.busy&&document.documentElement.dataset.mygrainStartup==='ready');
    await page.locator('#start-btn').click();
    await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
    await page.evaluate(()=>{
     stopAllPerformancePlayback({silent:true});
     window.keyFeedbackCalls=0;
     const l=playBastardLoopLFeedbackTone, x=playBastardLoopXFeedbackTone;
     playBastardLoopLFeedbackTone=(...args)=>{window.keyFeedbackCalls++;return l(...args)};
     playBastardLoopXFeedbackTone=(...args)=>{window.keyFeedbackCalls++;return x(...args)};
     window.lxReadAudio=()=>{
      const data=new Float32Array(window.keyAnalyser.fftSize);
      window.keyAnalyser.getFloatTimeDomainData(data);
      const output=new Float32Array(finalPanAnalyser.fftSize); finalPanAnalyser.getFloatTimeDomainData(output);
      const rms=a=>Math.sqrt(a.reduce((sum,v)=>sum+v*v,0)/a.length);
      return {voiceRms:rms(data),outputRms:rms(output),feedback:window.keyFeedbackCalls,holds:sequencerKeyboardHolds.size,voice:!![...sequencerKeyboardHolds][0]?.voice};
     };
    });
    for (const layer of ['L','X']) {
     const note=await page.evaluate(layer=>{
      stopAllPerformancePlayback({silent:true});
      setLoopLayerSolo('none',{silent:true,skipSave:true});
      applyGlobalBpm(120);syncPatternLengthControls(8,{skipSave:true});
      for(const [suffix,value] of Object.entries({Level:70,Length:5,Decay:5,StartTrim:0,Attack:1,FilterCutoff:18000,FilterEnvelope:0,DelayMix:0,FilterLfoAmount:0})) {
       const el=document.getElementById(`performanceBastardLoop${layer}${suffix}`);
       if(el){el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));}
      }
      const buffer=audioContext.createBuffer(2,Math.round(audioContext.sampleRate*5.2),audioContext.sampleRate);
      for(let ch=0;ch<2;ch++){const samples=buffer.getChannelData(ch);for(let i=0;i<samples.length;i++)samples[i]=.16*Math.sin(2*Math.PI*(ch?911:317)*i/audioContext.sampleRate);}
      const note=document.querySelector(`#bastardLoop${layer}Keyboard button`)?.dataset.note || (layer==='L'?BASTARD_LOOP_L_KEYBOARD_NOTES[0]:BASTARD_LOOP_X_KEYBOARD_NOTES[0]);
      if(layer==='L'){
       bastardLoopLSourceMode='sample';bastardLoopLSampleBuffer=buffer;bastardLoopLRootNote=note;bastardLoopLSampleMetadata=null;bastardLoopLPitchSemitones=0;bastardLoopLRecordArmed=false;
       bastardLoopLSequence=Array.from({length:64},()=>createEmptyBastardLoopLStep());openBastardLoopLOverlay();
      }else{
       bastardLoopXSourceMode='sample';bastardLoopXSampleBuffer=buffer;bastardLoopXRootNote=note;bastardLoopXSampleMetadata=null;bastardLoopXPitchSemitones=0;bastardLoopXRecordArmed=false;
       bastardLoopXSequence=Array.from({length:64},()=>createEmptyBastardLoopXStep());openBastardLoopXOverlay();
      }
      window.keyFixtureBuffer=buffer;window.keyFeedbackCalls=0;
      return note;
     },layer);
     const key=page.locator(`#bastardLoop${layer}Keyboard button`).filter({hasText:new RegExp('^'+note.replace('#','\\#')+'$')}).first();
     await key.scrollIntoViewIfNeeded();
     const box=await key.boundingBox();assert(box);
     // Pointer down without release, then attach an analyser to the actual sample voice.
     await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
     await page.waitForFunction(()=>[...sequencerKeyboardHolds].some(hold=>hold.voice));
     const identity=await page.evaluate(()=>{
      const voice=[...sequencerKeyboardHolds][0].voice;
      window.keyAnalyser=audioContext.createAnalyser();window.keyAnalyser.fftSize=2048;voice.gain.connect(window.keyAnalyser);window.keyAnalyserSink=audioContext.createGain();window.keyAnalyserSink.gain.value=0;window.keyAnalyser.connect(window.keyAnalyserSink);window.keyAnalyserSink.connect(audioContext.destination);
      return {same:voice.source.buffer===window.keyFixtureBuffer,rate:voice.source.playbackRate.value,loop:voice.source.loop};
     });
     assert.deepEqual(identity,{same:true,rate:1,loop:false});
     await page.waitForTimeout(850);
     const held=await page.evaluate(()=>window.lxReadAudio());
     assert(held.voiceRms>.005,`${engine}/${mobile}/${layer} held voice ${JSON.stringify(held)}`);
     assert(held.outputRms>.0001,`${engine}/${mobile}/${layer} stopped output ${JSON.stringify(held)}`);
     assert.equal(held.feedback,0);
     // A running sequence/record edit must not truncate the held voice.
     const before=await page.evaluate(layer=>{
      if(layer==='L'){bastardLoopLRecordArmed=true;setBastardLoopLStep(0,{note:'C3',rest:false});bastardLoopLEditStepIndex=2;setBastardLoopLEnabled(true,{skipSave:true});startBastardLoopL();}
      else{bastardLoopXRecordArmed=true;setBastardLoopXStep(0,{note:'C3',rest:false});bastardLoopXEditStepIndex=2;setBastardLoopXEnabled(true,{skipSave:true});startBastardLoopX();}
      return lxReadAudio();
     },layer);
     assert(before.voice);
     await page.mouse.up();await page.waitForTimeout(240);
     const released=await page.evaluate(()=>lxReadAudio());assert(released.voiceRms<.00001,JSON.stringify(released));assert.equal(released.holds,0);
     // Record while running, keyboard autorepeat ignored; audio sustains independently of short sequence gates.
     await key.focus();await page.keyboard.down('Enter');await page.keyboard.down('Enter');
     await page.waitForFunction(()=>[...sequencerKeyboardHolds].some(hold=>hold.voice));
     await page.evaluate(()=>[...sequencerKeyboardHolds][0].voice.gain.connect(window.keyAnalyser));
     await page.waitForTimeout(800);
     const recording=await page.evaluate(layer=>({audio:lxReadAudio(),index:layer==='L'?bastardLoopLEditStepIndex:bastardLoopXEditStepIndex,note:(layer==='L'?getBastardLoopLStep(2):getBastardLoopXStep(2)).note,running:layer==='L'?isBastardLoopLRunning():isBastardLoopXRunning()}),layer);
     assert.equal(recording.index,3);assert.equal(recording.note,note);assert(recording.running);assert(recording.audio.voiceRms>.005);assert.equal(recording.audio.feedback,0);
     await page.evaluate(()=>stopAllBastardLoopLayers({skipUi:true,fade:false}));
     if(layer==='X')assert.equal(await page.evaluate(()=>[...sequencerKeyboardHolds][0].voice.filterLfoSourceNode===bastardLoopXFilterLfoSourceNode),true);
     await page.waitForTimeout(160);
     assert((await page.evaluate(()=>lxReadAudio())).voiceRms>.005,'Stopping transport must not cut off a held key');
     await page.keyboard.up('Enter');await page.waitForTimeout(90);assert.equal((await page.evaluate(()=>lxReadAudio())).holds,0);
     // Natural end is not capped at the old four seconds; it never loops a sample.
     if(!mobile){
      await page.evaluate(layer=>{if(layer==='L'){stopBastardLoopL({fade:false});bastardLoopLRecordArmed=false;}else{stopBastardLoopX({fade:false});bastardLoopXRecordArmed=false;}},layer);
      await page.keyboard.down('Enter');await page.waitForFunction(()=>[...sequencerKeyboardHolds].some(hold=>hold.voice));
      await page.evaluate(()=>[...sequencerKeyboardHolds][0].voice.gain.connect(window.keyAnalyser));
      await page.waitForTimeout(4450);const tail=await page.evaluate(()=>lxReadAudio());assert(tail.voiceRms>.005,JSON.stringify(tail));
      await page.waitForTimeout(1000);const ended=await page.evaluate(()=>lxReadAudio());assert(!ended.voice);assert(ended.voiceRms<.00001);await page.keyboard.up('Enter');
     }
     // Pitch, trim and X's bounded source region remain respected by full-length auditions.
     if(!mobile){
      await page.evaluate(layer=>{
       const trim=document.getElementById(`performanceBastardLoop${layer}StartTrim`);trim.value='50';document.getElementById(`performanceBastardLoop${layer}Semitone`).value='12';
       if(layer==='L'){bastardLoopLPitchSemitones=12;}
       else{bastardLoopXPitchSemitones=12;bastardLoopXSampleMetadata={sourceRegion:{start:1,end:1.8}};}
       const create=audioContext.createBufferSource.bind(audioContext);
       window.keySourceStarts=[];
       audioContext.createBufferSource=()=>{const src=create(),start=src.start.bind(src);src.start=(...args)=>{keySourceStarts.push(args);return start(...args)};return src};
       window.restoreKeySourceFactory=()=>{audioContext.createBufferSource=create};
      },layer);
      await page.keyboard.down('Enter');await page.waitForFunction(()=>[...sequencerKeyboardHolds].some(hold=>hold.voice));
      await page.waitForTimeout(60); // WebKit AudioParam.value advances at the scheduled source start.
      const pitched=await page.evaluate(()=>({rate:[...sequencerKeyboardHolds][0].voice.source.playbackRate.value,start:keySourceStarts.at(-1)}));
      assert.equal(pitched.rate,2,`${engine}/${layer} ${JSON.stringify(pitched)}`);
      assert(Math.abs(pitched.start[1]-(layer==='L'?2.6:1.4))<.0001,JSON.stringify(pitched));
      if(layer==='X')assert(Math.abs(pitched.start[2]-.4)<.0001);
      await page.waitForTimeout(layer==='L'?1500:400);
      assert.equal(await page.evaluate(()=>!![...sequencerKeyboardHolds][0].voice),false);
      await page.keyboard.up('Enter');
      await page.evaluate(layer=>{restoreKeySourceFactory();document.getElementById(`performanceBastardLoop${layer}StartTrim`).value='0';document.getElementById(`performanceBastardLoop${layer}Semitone`).value='0';if(layer==='L')bastardLoopLPitchSemitones=0;else{bastardLoopXPitchSemitones=0;bastardLoopXSampleMetadata=null;}},layer);
     }
     // Browser blur and panel close must leave no pending key or stuck sample.
     await page.keyboard.down('Enter');await page.waitForFunction(()=>[...sequencerKeyboardHolds].some(hold=>hold.voice));
     await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('Enter');assert.equal(await page.evaluate(()=>sequencerKeyboardHolds.size),0);
     await page.mouse.down();await page.mouse.up();
     // Touch lifecycle, including pointer cancellation, in both mobile browser engines.
     if(mobile){
      await key.dispatchEvent('pointerdown',{pointerId:81,pointerType:'touch',button:0,bubbles:true});
      await page.waitForFunction(()=>[...sequencerKeyboardHolds].some(hold=>hold.voice));
      await key.dispatchEvent('pointercancel',{pointerId:81,pointerType:'touch',bubbles:true});
      assert.equal(await page.evaluate(()=>sequencerKeyboardHolds.size),0);
     }
     await key.dispatchEvent('pointerdown',{pointerId:91,pointerType:'touch',button:0,bubbles:true});
     await page.waitForFunction(()=>[...sequencerKeyboardHolds].some(hold=>hold.voice));
     await page.evaluate(layer=>layer==='L'?closeBastardLoopLOverlay():closeBastardLoopXOverlay(),layer);
     assert.equal(await page.evaluate(()=>sequencerKeyboardHolds.size),0);
     results.push({engine,mobile,layer,note,identity,held,released,recording});
     console.log('PASS',engine,mobile?'phone':'desktop',layer,JSON.stringify(held));
    }
    assert.deepEqual(errors,[]);
    await context.close();
   }
  }finally{await browser.close();}
 }
 fs.writeFileSync(evidence+'/results.json',JSON.stringify(results,null,2));
 console.log('All L/X held keyboard browser checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
