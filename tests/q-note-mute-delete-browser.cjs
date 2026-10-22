// Real pointer gestures, local piano/strings audio, isolated accounts/stores only.
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:18891/mygrain/',evidence=process.env.Q_NOTE_EVIDENCE||'/tmp/mygrain-q-note';fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const results=[];
 for(const engine of ['chromium','webkit']){
  if(process.env.Q_NOTE_ENGINE&&process.env.Q_NOTE_ENGINE!==engine)continue;
  const browser=await({chromium,webkit}[engine]).launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{for(const mobile of [false,true]){
   const context=await browser.newContext({viewport:mobile?{width:402,height:874}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
   const registered=await context.request.post(base+'api/auth/register',{data:{username:`nm_${engine[0]}_${+mobile}_${Date.now()}`,password:'isolated-note-test'}});assert.equal(registered.status(),200);
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
   const ready=()=>page.waitForFunction(()=>mygrainQ.chordEditor.preview?.running&&!mygrainQ.chordEditor.loading);
   const load=async()=>{await page.goto(base);await page.waitForFunction(()=>window.mygrainQ&&window.mygrainSongBeta&&!mygrainSongBeta.busy&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy)};
   await load();
   await page.evaluate(()=>{
    stopAllPerformancePlayback({silent:true});resetStemIsolationState();applyGlobalBpm(300);syncPatternLengthControls(64,{skipSave:true});
    const q=MygrainQTheory.defaults();q.enabled=true;
    for(const index of [8,12])q.sequence[index]=MygrainQTheory.normalizeStep({notes:[60,64,67],root:60,type:'major',gate:4,velocity:87,accent:true,ratchet:2});
    mygrainQ.restore(q);drumMachineEnabled=true;drumMachineHatPattern=Array(64).fill(true);
    window.noteEvents=[];window.hatEvents=[];const hat=scheduleDrumMachineHatStep;scheduleDrumMachineHatStep=(index,time,...args)=>{hatEvents.push({index,time,origin:mygrainPatternSection.active?.origin});return hat(index,time,...args)};
    const e=mygrainQ.chordEditor,create=e.createPreview.bind(e);e.createPreview=()=>{const p=create(),voice=p.voice.bind(p);p.voice=(...args)=>{const before=new Set(p.voices);voice(...args);const v=[...p.voices].find(v=>!before.has(v));if(v)noteEvents.push({pitch:args[0],time:args[2],origin:p.origin})};return p};saveState();
   });
   await page.locator('#performanceBastardLoopQEditBtn').click();
   const open=async()=>{const cell=page.locator('#bastardLoopQStepGrid [data-q-step="8"]');if(mobile){await cell.tap();if(!await page.evaluate(()=>mygrainQ.chordEditor.opened))await cell.tap()}else await cell.dblclick();await ready()};
   const note=i=>page.locator(`[data-q-note-index="${i}"]`);
   const toggle=async i=>{await note(i).scrollIntoViewIfNeeded();const before=await note(i).getAttribute('class');if(mobile){await note(i).tap();await note(i).tap()}else await note(i).dblclick();await page.waitForFunction(({i,before})=>document.querySelector(`[data-q-note-index="${i}"]`)?.getAttribute('class')!==before,{i,before});await ready()};
   const snapshot=()=>page.evaluate(()=>({state:JSON.stringify(mygrainQ.getState()),undo:mygrainCardHistory.counts.undo}));
   const collect=async()=>{await page.waitForTimeout(950);return page.evaluate(()=>{const e=mygrainQ.chordEditor,p=e.preview,s=mygrainPatternSection.active;return {notes:noteEvents.filter(v=>v.origin===p.origin).map(v=>({pitch:v.pitch,step:Math.round((v.time-p.origin)/.05)%e.loopSteps})),hats:hatEvents.filter(v=>v.origin===p.origin).length,section:s?.duration,running:p.running,muted:[...e.mutedNotes]}})};
   await open();const before=await snapshot();await toggle(1);
   assert.match(await note(1).getAttribute('class'),/q-chord-note-muted/);assert.match(await note(1).getAttribute('aria-label'),/muted/);
   const muted=await collect();assert(muted.notes.some(v=>v.pitch===60&&v.step<4));assert(!muted.notes.some(v=>v.pitch===64&&v.step<4));assert(muted.notes.some(v=>v.pitch===64&&v.step>=4),'same note in another chord must not be muted');assert(muted.hats>16&&muted.running&&muted.section===.8);
   assert.deepEqual(await snapshot(),before,'audition muting must not save or create history');
   await toggle(1);assert((await collect()).notes.some(v=>v.pitch===64&&v.step<4));
   // Every voice can be silent without stopping or shortening the accompaniment loop.
   await toggle(0);await toggle(1);await toggle(2);const allMuted=await collect();assert(!allMuted.notes.some(v=>v.step<4));assert(allMuted.hats>16&&allMuted.running&&allMuted.section===.8);
   const sectionAudio=await page.evaluate(async()=>{const a=audioContext.createAnalyser();a.fftSize=1024;preFilterGainNode.connect(a);const d=new Float32Array(1024);let peak=0;for(let i=0;i<30;i++){a.getFloatTimeDomainData(d);peak=Math.max(peak,Math.sqrt(d.reduce((sum,v)=>sum+v*v,0)/d.length));await new Promise(r=>setTimeout(r,15))}preFilterGainNode.disconnect(a);return peak});assert(sectionAudio>.0001,'accompaniment remains audible with every edited note muted');
   const portable=await page.evaluate(async()=>{const b=await mygrainSongBetaAdapter.capture(),part=mygrainSongBetaAdapter.inspectPart(await b.arrayBuffer());return {notes:part.snapshot.state.q.sequence[8].notes,keys:Object.keys(part.snapshot.state.q),controls:part.snapshot.extra.controls.map(c=>c.id)}});
   assert.deepEqual(portable.notes,[60,64,67]);assert(!portable.keys.some(k=>/muted|editor/i.test(k)));assert(!portable.controls.includes('qChordLoopSteps'));
   await page.screenshot({path:`${evidence}/${engine}-${mobile?'phone':'desktop'}-muted.png`});
   await page.locator('#qChordEditorClose').click();assert.equal(await page.evaluate(()=>mygrainQ.chordEditor.mutedNotes.size),0);await open();assert.equal(await page.locator('.q-chord-note-muted').count(),0);assert((await collect()).notes.some(v=>v.pitch===64&&v.step<4));
   // A muted voice follows semitone changes, sorting and whole-chord transpose.
   await toggle(1);await note(1).press('ArrowUp');await ready();assert.deepEqual(await page.evaluate(()=>[...mygrainQ.chordEditor.mutedNotes]),[65]);assert.match(await note(1).getAttribute('class'),/muted/);
   await page.locator('[data-q-note-action="chord-up"]').click();await ready();assert.deepEqual(await page.evaluate(()=>[...mygrainQ.chordEditor.mutedNotes]),[66]);
   const undoBefore=await page.evaluate(()=>mygrainCardHistory.counts.undo);await note(1).click();await page.locator('[data-q-note-action="delete"]').click();await page.waitForFunction(()=>mygrainQ.state.sequence[8].notes.length===2&&!mygrainQ.chordEditor.loading);
   assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[8].notes),[61,68]);assert.equal(await page.evaluate(()=>mygrainQ.chordEditor.mutedNotes.size),0);assert.equal(await page.evaluate(()=>mygrainCardHistory.counts.undo),undoBefore+1);
   const settings=await page.evaluate(()=>{const s=mygrainQ.state.sequence[8];return [s.gate,s.velocity,s.accent,s.ratchet]});assert.deepEqual(settings,[4,87,true,2]);
   await page.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[8].notes),[61,66,68]);assert.equal(await page.locator('#qChordEditorOverlay').isVisible(),false);await page.evaluate(()=>mygrainCardHistory.redo());assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[8].notes),[61,68]);
   await open();await note(1).click();await note(1).press('Delete');await page.waitForFunction(()=>mygrainQ.state.sequence[8].notes.length===1&&!mygrainQ.chordEditor.loading);assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[8].notes),[61]);assert.equal(await page.evaluate(()=>document.activeElement?.dataset.qNoteIndex),'0','keyboard deletion retains focus on the remaining note');
   // Number input Backspace edits its text, never the selected note.
   await page.locator('#qChordLoopSteps').focus();await page.locator('#qChordLoopSteps').press('Backspace');assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[8].notes),[61]);await page.locator('#qChordLoopSteps').fill('16');await page.locator('#qChordLoopSteps').press('Enter');
   await page.locator('#qChordEditorClose').click();const originalOrigin=await page.evaluate(async()=>{stopAllPerformancePlayback({silent:true});await mygrainQ.preparePlayback();const t=audioContext.currentTime+.06;mygrainQ.start(t);return t});await open();
   await page.locator('[data-q-note-action="delete"]').click();try{await page.waitForFunction(()=>!mygrainQ.chordEditor.opened&&mygrainQ.state.sequence[8]===null)}catch(e){console.error('FINAL NOTE',await page.evaluate(()=>({opened:mygrainQ.chordEditor.opened,step:mygrainQ.state.sequence[8],status:document.getElementById('qChordEditorStatus').textContent,historyBusy:mygrainCardHistory.busy})),errors);throw e}assert.equal(await page.evaluate(()=>mygrainPatternSection.active),null);assert.equal(await page.evaluate(()=>mygrainQ.running),true);assert.equal(await page.evaluate(()=>mygrainQ.origin),originalOrigin);await page.evaluate(()=>stopAllPerformancePlayback({silent:true}));
   await page.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[8].notes),[61]);await page.evaluate(()=>mygrainCardHistory.redo());assert.equal(await page.evaluate(()=>mygrainQ.state.sequence[8]),null);await page.evaluate(()=>mygrainCardHistory.undo());
   // Keep the permanent removal over a device-scoped save/reload.
   await page.evaluate(()=>mygrainCardHistory.flush());await load();assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[8].notes),[61]);assert.equal(await page.locator('#qChordEditorOverlay').isVisible(),false);
   // Strings, global transpose, note dragging and custom ARP use the same transient mute path.
   await page.evaluate(async()=>{const q=mygrainQ.getState();q.transpose=2;q.arpEnabled=true;q.arpPattern='custom';q.arpSteps=[1,2,0,3];q.arpRepeat='until-next';q.sequence[8]=MygrainQTheory.normalizeStep({notes:[60,64,67],root:60});mygrainQ.restore(q);await mygrainQ.setInstrument('strings')});
   await page.locator('#performanceBastardLoopQEditBtn').click();await open();await toggle(1);
   const arp=await page.evaluate(()=>{const e=mygrainQ.chordEditor,p=e.preview;return {events:p.timeline().filter(v=>v.index===0).map(v=>({notes:v.notes,start:v.start})),muted:[...e.mutedNotes]}});assert(arp.events.some(v=>!v.notes.length));assert(!arp.events.some(v=>v.notes.includes(66)));assert(arp.events.some(v=>v.notes.includes(62)));
   const box=await note(1).boundingBox(),row=await page.evaluate(()=>mygrainQ.chordEditor.rowHeight());await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2-row,{steps:5});await page.mouse.up();await page.waitForFunction(()=>mygrainQ.state.sequence[8].notes[1]===65&&!mygrainQ.chordEditor.loading);assert.deepEqual(await page.evaluate(()=>[...mygrainQ.chordEditor.mutedNotes]),[65]);
   const layouts=[];
   for(const viewport of mobile?[{width:402,height:874},{width:874,height:402},{width:320,height:640}]:[{width:1280,height:900}]){
    await page.setViewportSize(viewport);const fit=await page.evaluate(()=>{const s=document.querySelector('#qChordEditorOverlay section'),r=s.getBoundingClientRect(),buttons=[...s.querySelectorAll('.q-chord-editor-tools button')];return {inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:s.scrollWidth>s.clientWidth,buttons:buttons.every(b=>b.scrollWidth<=b.clientWidth),width:innerWidth}});assert(fit.inside&&!fit.overflow&&fit.buttons,JSON.stringify(fit));layouts.push(fit);
   }
   await page.screenshot({path:`${evidence}/${engine}-${mobile?'phone':'desktop'}-delete.png`});await page.locator('#qChordEditorClose').click();assert.equal(await page.evaluate(()=>mygrainQ.chordEditor.mutedNotes.size),0);
   assert.deepEqual(errors,[]);results.push({engine,mobile,muted,allMuted,sectionAudio,portable,arp,settings,layouts,history:true,lastNote:true,reload:true});console.log('PASS',engine,mobile?'phone':'desktop','trusted mute/unmute, all-muted section audio, same-pitch other chord, Close reset, voice moves, delete/last note, Undo/Redo, portable snapshot and reload');await context.close();
  }}finally{await browser.close()}
 }
 fs.writeFileSync(evidence+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
