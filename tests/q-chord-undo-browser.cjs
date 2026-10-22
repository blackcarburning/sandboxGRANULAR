const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.SONG_BETA_TEST_URL||'http://127.0.0.1:18891/mygrain/';assert.match(base,/^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/);
const evidence=process.env.Q_HOLD_EDITOR_EVIDENCE||'/tmp/mygrain-q-hold-editor';fs.mkdirSync(evidence,{recursive:true});
(async()=>{const results=[];for(const engine of ['chromium','webkit']){
 const browser=await({chromium,webkit}[engine]).launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});assert.equal((await c.request.post(base+'api/auth/register',{data:{username:`un_${engine[0]}_${Date.now()}`,password:'isolated-chord-undo'}})).status(),200);
 const p=await c.newPage(),errors=[];p.setDefaultTimeout(45000);p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await p.goto(base);await p.waitForFunction(()=>window.mygrainQ&&document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});applyGlobalBpm(150);syncPatternLengthControls(16,{skipSave:true});const q=MygrainQTheory.defaults();q.instrument='strings';q.chordHold=true;q.sequence[0]=MygrainQTheory.normalizeStep({root:48,type:'custom',notes:[48,65,70,73],velocity:73,gate:.7,accent:true,ratchet:2});q.sequence[8]=MygrainQTheory.normalizeStep({notes:[62,66,69]});mygrainQ.restore(q);saveState();});
 await p.locator('#performanceBastardLoopQEditBtn').tap();const cell=p.locator('[data-q-step="0"]');await cell.tap();if(!await p.evaluate(()=>mygrainQ.chordEditor.opened))await cell.tap();
 const settled=()=>p.waitForFunction(()=>!mygrainQ.chordEditor.loading&&!mygrainQ.editorHistoryBusy&&!mygrainCardHistory.busy);
 await settled();await p.locator('[data-q-note-index="0"]').tap();
 const before=await p.evaluate(()=>({chord:MygrainQTheory.copy(mygrainQ.state.sequence[0]),bass:JSON.stringify(bastardLoopXSequence),drums:JSON.stringify([drumMachineKickPattern,drumMachineHatPattern])}));
 assert.equal(await p.locator('#qChordEditorUndo').isEnabled(),false);
 for(let i=0;i<12;i++){await p.locator('[data-q-note-action="up"]').tap();await settled();}
 assert.equal(await p.locator('#qChordEditorUndo').textContent(),'Undo 10');assert.equal(await p.evaluate(()=>mygrainQ.state.sequence[0].notes[0]),60);
 for(let i=0;i<10;i++){await p.locator('#qChordEditorUndo').tap();await settled();assert.equal(await p.evaluate(()=>mygrainQ.chordEditor.opened),true);}
 assert.equal(await p.locator('#qChordEditorUndo').isEnabled(),false);assert.equal(await p.locator('#qChordEditorRedo').textContent(),'Redo 10');assert.equal(await p.evaluate(()=>mygrainQ.state.sequence[0].notes[0]),50);
 for(let i=0;i<10;i++){await p.locator('#qChordEditorRedo').tap();await settled();}
 assert.equal(await p.locator('#qChordEditorRedo').isEnabled(),false);assert.equal(await p.evaluate(()=>mygrainQ.state.sequence[0].notes[0]),60);
 const restored=await p.evaluate(()=>mygrainQ.state.sequence[0]);assert.equal(restored.velocity,before.chord.velocity);assert.equal(restored.gate,before.chord.gate);assert.equal(restored.accent,true);assert.equal(restored.ratchet,2);
 await p.locator('#qChordEditorUndo').tap();await settled();await p.locator('[data-q-note-action="down"]').tap();await settled();assert.equal(await p.locator('#qChordEditorRedo').isEnabled(),false);
 // Undo and Redo retain the same modal and work in portrait and landscape.
 const layouts=[];for(const viewport of [{width:390,height:844},{width:844,height:390},{width:320,height:640}]){await p.setViewportSize(viewport);const fit=await p.evaluate(()=>{const s=document.querySelector('#qChordEditorOverlay section'),r=s.getBoundingClientRect();return{inside:r.x>=0&&r.right<=innerWidth+1&&r.y>=0&&r.bottom<=innerHeight+1,overflow:s.scrollWidth>s.clientWidth+1,labels:[...s.querySelectorAll('.q-chord-editor-tools button')].every(b=>b.scrollWidth<=b.clientWidth+1)};});assert(fit.inside&&!fit.overflow&&fit.labels,JSON.stringify(fit));layouts.push(fit);}
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:`${evidence}/undo-${engine}.png`});
 // Deleting the last note closes the modal, but main-editor Undo restores it.
 for(let i=0;i<4;i++){await p.locator('[data-q-note-action="delete"]').tap();await settled();}
 assert.equal(await p.evaluate(()=>mygrainQ.chordEditor.opened),false);assert.equal(await p.evaluate(()=>mygrainQ.state.sequence[0]),null);
 await p.locator('#bastardLoopQEditorUndo').tap();await settled();assert.equal(await p.evaluate(()=>mygrainQ.state.sequence[0].notes.length),1);
 await p.locator('#bastardLoopQEditorRedo').tap();await settled();assert.equal(await p.evaluate(()=>mygrainQ.state.sequence[0]),null);
 await p.locator('#bastardLoopQEditorUndo').tap();await settled();
 const after=await p.evaluate(()=>({bass:JSON.stringify(bastardLoopXSequence),drums:JSON.stringify([drumMachineKickPattern,drumMachineHatPattern]),hold:mygrainQ.state.chordHold}));assert.equal(after.bass,before.bass);assert.equal(after.drums,before.drums);assert.equal(after.hold,true);
 await p.locator('#bastardLoopQCloseBtn').tap();assert.deepEqual(errors,[]);results.push({engine,levels:10,twelveEdits:true,tenUndos:true,tenRedos:true,branchClearsRedo:true,lastNoteRestored:true,otherPatternsUnchanged:true,layouts});console.log(`PASS ${engine}: 10-level chord Undo/Redo, touch, custom voicing, deletion and layouts.`);await c.close();
 }finally{await browser.close();}
}fs.writeFileSync(evidence+'/undo-results.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
