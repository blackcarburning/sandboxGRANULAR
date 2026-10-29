// Read-only live smoke: mocked identity/API, all server writes blocked.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'https://openclaw.blackcarburning.com/mygrain/',out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp/mygrain-q-edge-loop-evidence';fs.mkdirSync(out,{recursive:true});
(async()=>{const results=[];for(const[engine,type]of Object.entries({chromium,webkit})){
const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
try{const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await ctx.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(45000);
await page.route('**/*',r=>{const req=r.request(),u=new URL(req.url()),identity={ok:true,authenticated:true,user:{username:'q-quick-readonly-live'}};if(u.origin!==new URL(base).origin)return r.abort();if(!['GET','HEAD'].includes(req.method())){writes.push(req.method()+' '+u.pathname);return r.abort()}if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext='+JSON.stringify(identity)});if(u.pathname.includes('/api/'))return r.fulfill({json:{...identity,files:[],songs:[],folders:[],stations:[],samples:[],favourites:[],patches:[]}});return r.continue()});
await page.goto(base);await page.waitForFunction(()=>window.mygrainQCustomChords&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});mygrainQ.open();const q=mygrainQ;q.state.sequence.fill(null);for(const[i,n]of[[4,60],[6,65]])q.state.sequence[i]=MygrainQTheory.normalizeStep({notes:[n,n+4,n+7]});q.state.record=false;q.changed({reschedule:false});q.resetEditorHistory();const b=audioContext.createBuffer(1,audioContext.sampleRate,audioContext.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=.1*Math.sin(2*Math.PI*261.63*i/b.sampleRate);drumMachineKickBuffer=b;drumMachineKickPattern=Array.from({length:16},(_,i)=>i===0);q.piano.ensure=async()=>{};q.piano.source=p=>({sample:{midi:p},buffer:b,offset:0,duration:1,loopStart:.1,loopEnd:.9});});


// Direct rail editing must work while the grid remains interactive.
await page.locator('#qMobileRightTab').tap();
await page.locator('#qEdgeCopyRange').tap();
assert(!await page.locator('#qMobileRightPanel').isVisible());
assert(!await page.locator('.q-workbench').evaluate(e=>e.inert));
await page.locator('[data-q-step="4"]').tap();await page.locator('[data-q-step="6"]').tap();
await page.locator('[data-q-step="10"]').tap();
assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[10].notes),[60,64,67]);
assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[12].notes),[65,69,72]);
await page.locator('#qEdgeMarkTrans').tap();await page.locator('[data-q-step="10"]').tap();await page.locator('[data-q-step="12"]').tap();
await page.locator('#qEdgeTransposeUp').tap();assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[10].notes),[61,65,68]);assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[4].notes),[60,64,67]);
await page.locator('#qEdgeClearMark').tap();
await page.locator('[data-q-step="10"]').tap();await page.locator('#bastardLoopQCopyChordBtn').tap();await page.locator('[data-q-step="15"]').tap();await page.locator('#bastardLoopQPasteChordBtn').tap();assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[15].notes),[61,65,68]);
await page.locator('#qEdgeCopySection').tap();await page.locator('[data-q-step="4"]').tap();await page.locator('[data-q-step="4"]').tap();await page.locator('[data-q-step="14"]').tap();assert.deepEqual(await page.evaluate(()=>mygrainQ.state.sequence[15].notes),[60,64,67]);
await page.evaluate(()=>{const q=mygrainQ;q.state.sequence.fill(null);for(const[i,n]of[[4,60],[6,65]])q.state.sequence[i]=MygrainQTheory.normalizeStep({notes:[n,n+4,n+7]});q.mark=null;q.range=null;q.changed({reschedule:false});q.resetEditorHistory();});

const sequence=await page.evaluate(()=>JSON.stringify(mygrainQ.state.sequence));
async function audioPeak(){return page.evaluate(async()=>{const graph=mygrainQ.graph,a=audioContext.createAnalyser(),values=new Float32Array(2048);a.fftSize=2048;graph.pan.connect(a);let peak=0;try{for(let i=0;i<40;i++){await new Promise(requestAnimationFrame);a.getFloatTimeDomainData(values);for(const value of values)peak=Math.max(peak,Math.abs(value));}}finally{graph.pan.disconnect(a);a.disconnect();}return peak;});}

for(const [width,height]of [[390,844],[320,640],[844,390]]){
await page.setViewportSize({width,height});await page.waitForFunction(()=>document.querySelector('.q-shell').classList.contains('q-mobile-layout'));
assert(await page.locator('#qMobileLeftTab').isVisible());assert(!await page.locator('.q-pool-pitch').isVisible());
assert.equal(await page.locator('.q-sequence-panel button:not([data-q-step])').count(),0);
assert.equal(await page.locator('.q-workbench select').count(),0);
assert(await page.evaluate(()=>{const ids=[...document.querySelectorAll('#bastardLoopQOverlay [id]')].map(e=>e.id);return ids.length===new Set(ids).size}));
for(const id of ['qSequenceClearAll','qEdgeCopyRange','qEdgeMarkTrans','qSequenceLoopToggle']){const el=page.locator('#'+id);await el.scrollIntoViewIfNeeded();assert(await el.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}));}
assert(await page.locator('#bastardLoopQAllStopBtn').evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}));

for(const id of ['bastardLoopQAllPlayBtn','bastardLoopQAllStopBtn'])assert(await page.locator('#'+id).isVisible());
await page.locator('#qMobileLeftTab').tap();await page.locator('#qPoolTransposeUp').tap();await page.locator('#qPoolTransposeDown').tap();await page.locator('#qPoolTonicUp').tap();await page.locator('#qPoolTonicDown').tap();await page.locator('#qPoolOctaveUp').tap();await page.locator('#qPoolOctaveDown').tap();
assert(await page.locator('#qMobileLeftPanel').evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().bottom<=innerHeight));await page.screenshot({path:out+'/'+engine+'-'+width+'-left.png'});
assert(await page.locator('#bastardLoopQEditorUndo').isVisible());assert.equal(await page.locator('#qMobileLeftPanel .q-pool-pitch').count(),1);
await page.keyboard.press('Escape');assert(await page.locator('#bastardLoopQOverlay').isVisible());assert(!await page.locator('#qMobileLeftPanel').isVisible());
await page.locator('#qMobileRightTab').tap();
assert.equal(await page.locator('#qMobileRightPanel #qCustomChordOpen').count(),1);assert(await page.locator('#qMobileRightPanel').evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().bottom<=innerHeight));await page.screenshot({path:out+'/'+engine+'-'+width+'-right.png'});
if(!await page.locator('#bastardLoopQEditTools').evaluate(e=>e.open))await page.locator('#bastardLoopQEditTools summary').tap();await page.locator('#bastardLoopQAuditionStepBtn').scrollIntoViewIfNeeded();assert(await page.locator('#bastardLoopQAuditionStepBtn').isVisible());await page.locator('#bastardLoopQEditTools summary').tap();
await page.locator('#qCustomChordOpen').tap();assert(await page.locator('#qCustomChordDialog').isVisible());await page.keyboard.press('Escape');
if(!await page.locator('#bastardLoopQPlaybackSettings').evaluate(e=>e.open))await page.locator('#bastardLoopQPlaybackSettings summary').tap();await page.locator('#bastardLoopQArpEnabled').selectOption('1');assert(await page.evaluate(()=>mygrainQ.state.arpEnabled));await page.locator('#bastardLoopQArpEnabled').selectOption('0');
await page.locator('#qMobileRightPanel header button').tap();
for(const id of ['qSequenceLoopStart','qSequenceLoopEnd'])assert.equal(await page.locator('.q-sequence-panel #'+id).count(),1); for(const id of ['qSequenceLoopSet','qSequenceLoopToggle','qPlaybackMode'])assert.equal(await page.locator('#qEdgeRightActions #'+id).count(),1); for(const id of ['qEdgeCopyRange','qEdgeCopySection','qEdgeMarkTrans','bastardLoopQDeleteStepBtn','qSequenceClearAll'])assert.equal(await page.locator('#qEdgeLeftActions #'+id).count(),1);
await page.locator('#qSequenceLoopSet').tap();await page.locator('[data-q-step="4"]').tap();await page.locator('[data-q-step="7"]').tap();await page.waitForFunction(()=>mygrainQ.loopRange&&!mygrainQ.loopLoading);assert(!await page.evaluate(()=>mygrainQ.running));
if(await page.evaluate(()=>mygrainQ.playbackSolo))await page.locator('#qPlaybackMode').tap();await page.locator('#bastardLoopQAllPlayBtn').tap();await page.waitForFunction(()=>mygrainQ.running&&drumMachinePlaying);assert.deepEqual(await page.evaluate(()=>mygrainQ.loopRange),[4,7]);assert.deepEqual(await page.evaluate(()=>mygrainQ.timeline().map(e=>e.index)),[4,6]);assert(await page.evaluate(()=>Math.abs(mygrainQ.origin-(mygrainPatternSection.active?.origin??getSharedLoopTransportOriginTime()))<.001));if(width===390)assert(await audioPeak()>1e-5,'shared Q output must be audible');
await page.locator('#bastardLoopQAllStopBtn').tap();await page.waitForFunction(()=>!mygrainQ.running&&!drumMachinePlaying);assert.deepEqual(await page.evaluate(()=>mygrainQ.loopRange),[4,7]);
await page.locator('#qPlaybackMode').tap();await page.locator('#bastardLoopQAllPlayBtn').tap();await page.waitForFunction(()=>mygrainQ.running&&!drumMachinePlaying);if(width===390)assert(await audioPeak()>1e-5,'solo Q output must be audible');assert.deepEqual(await page.evaluate(()=>mygrainQ.loopRange),[4,7]);assert.deepEqual(await page.evaluate(()=>mygrainQ.timeline().map(e=>e.index)),[4,6]);
await page.locator('#bastardLoopQAllStopBtn').tap();await page.waitForFunction(()=>!mygrainQ.running);
const metrics=await page.evaluate(()=>{const shell=document.querySelector('.q-shell'),w=document.querySelector('.q-workbench').getBoundingClientRect(),p=document.querySelector('.q-candidate-pools').getBoundingClientRect(),g=document.querySelector('.q-grid-scroll').getBoundingClientRect();return{workbench:w.height,palette:p.height,grid:g.height,gridBottom:g.bottom,viewport:innerHeight,overflow:shell.scrollWidth-shell.clientWidth,body:document.getElementById('bastardLoopQOverlay').parentElement===document.body}});
assert(metrics.body);assert(metrics.overflow<=1,JSON.stringify(metrics));assert(metrics.palette>=50&&metrics.grid>=30,JSON.stringify(metrics));assert(metrics.gridBottom<=height,JSON.stringify(metrics));
await page.screenshot({path:out+'/'+engine+'-'+width+'.png'});
await page.locator('[data-q-step="4"]').tap();await page.locator('#bastardLoopQDeleteStepBtn').tap();assert.equal(await page.evaluate(()=>mygrainQ.state.sequence[4]),null);await page.locator('#qMobileLeftTab').tap();await page.locator('#bastardLoopQEditorUndo').tap();await page.locator('#qMobileLeftPanel header button').tap();await page.locator('#qSequenceClearAll').tap();await page.locator('#qMobileLeftTab').tap();await page.locator('#bastardLoopQEditorUndo').tap();assert.equal(await page.evaluate(()=>JSON.stringify(mygrainQ.state.sequence)),sequence);await page.locator('#bastardLoopQEditorRedo').tap();assert(await page.evaluate(()=>mygrainQ.state.sequence.every(x=>x===null)));await page.locator('#bastardLoopQEditorUndo').tap();assert.equal(await page.evaluate(()=>JSON.stringify(mygrainQ.state.sequence)),sequence);await page.keyboard.press('Escape');
results.push({engine,width,height,...metrics});
}
await page.setViewportSize({width:1280,height:900});assert(await page.locator('#qMobileLeftTab').isVisible());assert.equal(await page.locator('#bastardLoopQAllPlayBtn').count(),1);await page.screenshot({path:out+'/'+engine+'-desktop.png'});
assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);console.log('PASS',engine,JSON.stringify(results.filter(r=>r.engine===engine)));await ctx.close();
}finally{await browser.close()}}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
