// Real samples/audio and trusted input; disposable local accounts only.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18891/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence=process.env.Q_CHORD_EVIDENCE||'/tmp/mygrain-q-chord';fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const results=[];
 for(const [engine,type] of Object.entries({chromium,webkit})){
  if(process.env.Q_CHORD_ENGINE&&process.env.Q_CHORD_ENGINE!==engine)continue;
  const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{for(const mobile of [false,true]){
   if(process.env.Q_CHORD_MOBILE&&process.env.Q_CHORD_MOBILE!==String(+mobile))continue;
   const context=await browser.newContext({viewport:mobile?{width:402,height:874}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
   const registered=await context.request.post(base+'api/auth/register',{data:{username:`ce_${engine[0]}_${+mobile}_${Date.now()}`,password:'isolated-chord-fixture'}});assert.equal(registered.status(),200,await registered.text());
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   const openPage=async()=>{await page.goto(base);await page.waitForFunction(()=>window.mygrainQ&&window.mygrainSongBeta&&!mygrainSongBeta.busy&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy)};
   await openPage();
   await page.evaluate(()=>{
    stopAllPerformancePlayback({silent:true});resetStemIsolationState();applyGlobalBpm(300);syncPatternLengthControls(64,{skipSave:true});
    const q=MygrainQTheory.defaults();q.enabled=false;
    for(const [index,notes] of [[0,[36,40,43]],[8,[60,64,67]],[12,[65,69,72]],[24,[66,70,73]],[60,[48,52,55]]])q.sequence[index]=MygrainQTheory.normalizeStep({root:notes[0],type:'major',notes,gate:4,velocity:96});
    mygrainQ.restore(q);saveState();
    window.editLoopEvents=[];window.editLoopStops=[];
    const editor=mygrainQ.chordEditor,create=editor.createPreview.bind(editor);
    editor.createPreview=()=>{const p=create(),voice=p.voice.bind(p),stop=p.stop.bind(p);p.stop=()=>{editLoopStops.push({time:performance.now(),stack:new Error().stack});return stop()};p.voice=(...args)=>{const before=new Set(p.voices);const result=voice(...args);const v=[...p.voices].find(v=>!before.has(v));editLoopEvents.push({pitch:args[0],time:args[2],origin:p.origin,steps:editor.loopSteps,end:v?.end});return result};return p};
   });
   await page.locator('#performanceBastardLoopQEditBtn').click();
   await page.evaluate(()=>{window.chordInputLog=[];for(const type of ['pointerdown','pointerup','touchend','click','dblclick'])document.getElementById('bastardLoopQStepGrid').addEventListener(type,e=>chordInputLog.push({type,step:e.target.closest('[data-q-step]')?.dataset.qStep,detail:e.detail,pointer:e.pointerType,time:e.timeStamp}))});
   const cell=index=>page.locator(`#bastardLoopQStepGrid [data-q-step="${index}"]`);
   const openChord=async index=>{if(mobile){await cell(index).tap();if(!await page.evaluate(()=>mygrainQ.chordEditor.opened))await cell(index).tap()}else await cell(index).dblclick();try{await page.waitForFunction(index=>mygrainQ.chordEditor.opened&&mygrainQ.chordEditor.index===index&&mygrainQ.chordEditor.preview?.running&&!mygrainQ.chordEditor.loading,index,{timeout:15000})}catch(e){console.error('OPEN DIAGNOSTICS',engine,mobile,await page.evaluate(()=>({log:chordInputLog,status:document.getElementById('bastardLoopQStatus').textContent,editor:document.getElementById('qChordEditorStatus').textContent,stops:editLoopStops.slice(-4),index:mygrainQ.chordEditor.index,request:mygrainQ.chordEditor.request,loading:mygrainQ.chordEditor.loading,running:mygrainQ.chordEditor.preview?.running,context:audioContext.state,lastTouch:mygrainQ.lastChordTouch,opened:mygrainQ.chordEditor.opened,busy:mygrainCardHistory.busy,ai:mygrainAiPatch.busy,song:mygrainSongBeta.busy})));throw e}};
   const notes=()=>page.evaluate(()=>mygrainQ.state.sequence[8].notes);
   await openChord(8);
   assert.equal(await page.locator('#qChordLoopSteps').inputValue(),'16');
   assert.equal(await page.locator('#qChordEditorName').textContent(),'C major');
   const firstNote=page.locator('[data-q-note-index="0"]');await firstNote.press('ArrowRight');assert.equal(await page.evaluate(()=>mygrainQ.chordEditor.selected),1);await page.locator('[data-q-note-index="1"]').press('ArrowLeft');assert.equal(await page.evaluate(()=>mygrainQ.chordEditor.selected),0);assert.deepEqual(await notes(),[60,64,67]);
   await page.screenshot({path:`${evidence}/${engine}-${mobile?'phone':'desktop'}-default.png`});
   assert.equal(await page.evaluate(()=>mygrainQ.running||mygrainQ.state.enabled),false);
   const audio=await page.evaluate(async()=>{
    const p=mygrainQ.chordEditor.preview,a=audioContext.createAnalyser();a.fftSize=1024;p.graph.pan.connect(a);let peak=0;
    const data=new Float32Array(a.fftSize),until=audioContext.currentTime+1.8;
    while(audioContext.currentTime<until){a.getFloatTimeDomainData(data);peak=Math.max(peak,Math.sqrt(data.reduce((s,v)=>s+v*v,0)/data.length));await new Promise(r=>setTimeout(r,15))}
    p.graph.pan.disconnect(a);return {peak,origin:p.origin,events:editLoopEvents.slice(),period:16*60/300/4};
   });
   assert(audio.peak>.0001,`${engine}/${mobile} silent edit loop`);
   assert(audio.events.some(e=>e.pitch===60&&e.time-audio.origin>.7));
   assert(!audio.events.some(e=>[36,40,43,66,70,73,48,52,55].includes(e.pitch)),'outside-region chord sounded');
   for(const e of audio.events){const boundary=audio.origin+(Math.floor((e.time-audio.origin)/.8+.000001)+1)*.8;assert(e.end<=boundary+.002,`voice crossed loop end ${JSON.stringify(e)}`)}
   // Note selection and keyboard semitone edits identify the changed chord immediately.
   const middle=page.locator('[data-q-note-index="1"]');await middle.click();await middle.press('ArrowDown');
   await page.waitForFunction(()=>mygrainQ.state.sequence[8].type==='minor'&&!mygrainQ.chordEditor.loading);
   assert.deepEqual(await notes(),[60,63,67]);assert.equal(await page.locator('#qChordEditorName').textContent(),'C minor');
   await page.locator('[data-q-note-action="chord-up"]').click();await page.waitForFunction(()=>mygrainQ.state.sequence[8].notes[0]===61&&!mygrainQ.chordEditor.loading);assert.deepEqual(await notes(),[61,64,68]);
   await page.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual(await notes(),[60,63,67]);assert.equal(await page.locator('#qChordEditorOverlay').isVisible(),false);
   await page.evaluate(()=>mygrainCardHistory.redo());assert.deepEqual(await notes(),[61,64,68]);
   await openChord(8);
   const historyBefore=await page.evaluate(()=>mygrainCardHistory.counts.undo),box=await middle.boundingBox(),height=await page.evaluate(()=>mygrainQ.chordEditor.rowHeight());
   const x=box.x+box.width/2,y=box.y+box.height/2;
   let touch;
   if(mobile&&engine==='chromium'){
    touch=await context.newCDPSession(page);await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-2*height}]});
   }else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-2*height,{steps:6})}
   assert.deepEqual(await notes(),[61,64,68],'drag draft must not mutate the saved chord');assert.match(await page.locator('#qChordEditorName').textContent(),/sus4/);
   if(touch){await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach()}else await page.mouse.up();
   await page.waitForFunction(()=>mygrainQ.state.sequence[8].notes[1]===66&&!mygrainQ.chordEditor.loading);assert.deepEqual(await notes(),[61,66,68]);assert.equal(await page.evaluate(()=>mygrainCardHistory.counts.undo),historyBefore+1);
   // Four steps excludes the following chord exactly, and wraps on the audio clock.
   const length=page.locator('#qChordLoopSteps');await length.fill('4');await length.press('Enter');await page.waitForFunction(()=>mygrainQ.chordEditor.loopSteps===4&&!mygrainQ.chordEditor.loading);
   await page.waitForTimeout(650);
   const short=await page.evaluate(()=>{const p=mygrainQ.chordEditor.preview;return {origin:p.origin,events:editLoopEvents.filter(e=>e.origin===p.origin)}});
   assert(short.events.length>=9);assert(short.events.every(e=>[61,66,68].includes(e.pitch)));assert(short.events.some(e=>Math.abs(e.time-short.origin-.2)<.001));
   for(const e of short.events){const boundary=short.origin+(Math.floor((e.time-short.origin)/.2+.000001)+1)*.2;assert(e.end<=boundary+.002)}
   await length.fill('0');await length.press('Enter');assert.equal(await length.inputValue(),'4');
   const layouts=[];
   for(const viewport of mobile?[{width:402,height:874},{width:874,height:402},{width:320,height:640}]:[{width:1280,height:900}]){
    await page.setViewportSize(viewport);await page.waitForTimeout(60);
    const fit=await page.evaluate(()=>{const o=document.getElementById('qChordEditorOverlay'),s=o.querySelector('section'),r=s.getBoundingClientRect(),buttons=[...o.querySelectorAll('.q-chord-editor-tools button,#qChordEditorClose,#qChordLoopToggle')];return {width:innerWidth,inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,parent:o.parentElement.tagName,overflow:s.scrollWidth>s.clientWidth,buttons:buttons.every(b=>b.scrollWidth<=b.clientWidth),hit:document.elementFromPoint(r.right-40,r.top+30)?.closest('#qChordEditorOverlay')===o}});
    assert(fit.inside&&!fit.overflow&&fit.buttons&&fit.parent==='BODY');layouts.push(fit);
   }
   await page.screenshot({path:`${evidence}/${engine}-${mobile?'phone':'desktop'}.png`});
   await page.locator('#qChordEditorClose').click();
   assert.equal(await page.evaluate(()=>mygrainQ.chordEditor.preview.running||mygrainQ.chordEditor.preview.voices.size>0),false);
   // Opening at the end wraps to the beginning, rather than shortening the region.
   await openChord(60);await length.fill('8');await length.press('Enter');await page.waitForFunction(()=>mygrainQ.chordEditor.loopSteps===8&&!mygrainQ.chordEditor.loading);await page.waitForTimeout(550);
   const wrapped=await page.evaluate(()=>{const p=mygrainQ.chordEditor.preview;return editLoopEvents.filter(e=>e.origin===p.origin).map(e=>({pitch:e.pitch,offset:e.time-p.origin}))});assert(wrapped.some(e=>e.pitch===48&&e.offset<.01));assert(wrapped.some(e=>e.pitch===36&&Math.abs(e.offset-.2)<.001));
   // Stop All cancels the edit loop and pending restart, including on Close.
   await page.evaluate(()=>stopAllPerformancePlayback({silent:true}));assert.equal(await page.evaluate(()=>mygrainQ.chordEditor.preview.running),false);await page.locator('#qChordEditorClose').click();
   // A running Q clock resumes in phase after Close, but explicit Stop All cancels it.
   const originalOrigin=await page.evaluate(async()=>{mygrainQ.setEnabled(true);await mygrainQ.preparePlayback();const origin=audioContext.currentTime+.06;mygrainQ.start(origin);return origin});
   await openChord(8);assert.equal(await page.evaluate(()=>mygrainQ.running),false);await page.locator('#qChordEditorClose').click();assert.equal(await page.evaluate(()=>mygrainQ.running),true);assert.equal(await page.evaluate(()=>mygrainQ.origin),originalOrigin);
   await openChord(8);await page.evaluate(()=>stopAllPerformancePlayback({silent:true}));await page.locator('#qChordEditorClose').click();assert.equal(await page.evaluate(()=>mygrainQ.running||mygrainQ.chordEditor.preview.running),false);await page.evaluate(()=>mygrainQ.setEnabled(false));
   // Closing during loading must prevent a delayed edit loop from starting.
   await page.evaluate(()=>{window.originalQEnsure=mygrainQ.piano.ensure.bind(mygrainQ.piano);window.pendingQEnsure=new Promise(resolve=>window.releaseQEnsure=resolve);mygrainQ.piano.ensure=async events=>{await pendingQEnsure;return originalQEnsure(events)};void mygrainQ.chordEditor.open(8)});
   await page.waitForFunction(()=>mygrainQ.chordEditor.loading);await page.locator('#qChordEditorClose').click();await page.evaluate(()=>{releaseQEnsure();mygrainQ.piano.ensure=originalQEnsure});await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>mygrainQ.chordEditor.preview.running),false);
   // Sustained strings use their real local multisample and strict loop cutoff too.
   await page.evaluate(()=>mygrainQ.setInstrument('strings'));await openChord(8);
   const strings=await page.evaluate(async()=>{const p=mygrainQ.chordEditor.preview,a=audioContext.createAnalyser();a.fftSize=1024;p.graph.pan.connect(a);let peak=0;const data=new Float32Array(1024),end=audioContext.currentTime+.5;while(audioContext.currentTime<end){a.getFloatTimeDomainData(data);peak=Math.max(peak,Math.sqrt(data.reduce((s,v)=>s+v*v,0)/data.length));await new Promise(r=>setTimeout(r,15))}p.graph.pan.disconnect(a);return {peak,instrument:p.state.instrument,looped:[...p.voices].some(v=>v.source.loop)}});assert(strings.peak>.0001&&strings.instrument==='strings'&&strings.looped);
   const portable=await page.evaluate(async()=>{const b=await mygrainSongBetaAdapter.capture(),part=mygrainSongBetaAdapter.inspectPart(await b.arrayBuffer());return {controls:part.snapshot.extra.controls.map(c=>c.id),steps:part.snapshot.state.q.sequence.length,notes:part.snapshot.state.q.sequence[8].notes}});assert(!portable.controls.includes('qChordLoopSteps'));assert.equal(portable.steps,64);assert.deepEqual(portable.notes,[61,66,68]);await page.locator('#qChordEditorClose').click();
   const stored=await page.evaluate(()=>{const s=mygrainQ.getState();return {notes:s.sequence[8].notes,length:s.sequence.length,enabled:s.enabled,keys:Object.keys(s)}});assert.equal(stored.length,64);assert.equal(stored.enabled,false);assert(!stored.keys.some(k=>/loopSteps|editor/i.test(k)));
   await page.evaluate(()=>mygrainCardHistory.flush());await openPage();assert.deepEqual(await notes(),[61,66,68]);assert.equal(await page.locator('#qChordEditorOverlay').isVisible(),false);
   assert.deepEqual(errors,[]);results.push({engine,mobile,audio,short,wrapped,strings,portable,layouts,historySingleDrag:true,reload:true,normalTransportRestored:true,lateLoadCancelled:true});console.log('PASS',engine,mobile?'phone':'desktop','double click/tap, piano/strings audio, drag/arrows/naming, transpose, exact looping/wrap, history, transport, cancellation, portable source and reload');await context.close();
  }}finally{await browser.close()}
 }
 fs.writeFileSync(evidence+'/results.json',JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
