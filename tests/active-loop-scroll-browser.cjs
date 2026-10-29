// Read-only native audio regression: API writes and off-origin requests are blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');

(async () => {
 const results = [];
 for (const [engine, type] of Object.entries({ chromium, webkit })) {
  const b = await type.launch(engine === 'chromium'
   ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {});
  try {
   const c = await b.newContext(), p = await c.newPage(), errors = [];
   p.on('pageerror', e => errors.push(e.message));
   await p.route('**/*', r => {
    const req = r.request(), u = new URL(req.url());
    if (u.origin !== 'https://openclaw.blackcarburning.com' || !['GET', 'HEAD'].includes(req.method())) return r.abort();
    if (process.env.BASELINE && ['/mygrain/','/mygrain/index.html'].includes(u.pathname)) return r.fulfill({contentType:'text/html',body:fs.readFileSync(process.env.BASELINE,'utf8')});
    if (u.pathname.endsWith('/account-context.js')) return r.fulfill({
     contentType: 'text/javascript', body: 'window.mygrainAccountContext={user:{username:"audio-regression-readonly"}}'
    });
    if (u.pathname.includes('/api/')) return r.fulfill({ json: {
     ok: true, authenticated: true, user: { username: 'audio-regression-readonly' },
     files: [], songs: [], folders: [], stations: [], samples: [], favourites: [], patches: []
    }});
    return r.continue();
   });
   await p.goto('https://openclaw.blackcarburning.com/mygrain/');
   await p.waitForFunction(() => window.mygrainWEffects && document.documentElement.dataset.mygrainStartup === 'ready');
   await p.locator('#start-btn').click();
   await p.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended);



const lanes=[];
for(const lane of ['X','L']){
 await p.setViewportSize({width:1440,height:650});
 await p.evaluate(({lane,sourceMode})=>{
  stopAllPerformancePlayback({silent:true});stopModulationLoop();stopPerformanceMixerVuMeters();window.mygrainXDebug.setEnabled(false);
  const buffer=audioContext.createBuffer(1,audioContext.sampleRate*1.1,audioContext.sampleRate);
  const data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=.15*Math.sin(2*Math.PI*110*i/buffer.sampleRate);
  eval(`bastardLoop${lane}SampleBuffer=buffer;bastardLoop${lane}SourceMode='${sourceMode}';bastardLoop${lane}Enabled=true;ensureBastardLoop${lane}SequenceCapacity();bastardLoop${lane}Sequence=bastardLoop${lane}Sequence.map(()=>normalizeBastardLoop${lane}Step({note:'C2',rest:false}));setBastardLoop${lane}LevelPercent(50,{skipSave:true});openBastardLoop${lane}Overlay()`);
  oscillatorsEnabled=false;seqGrainsEnabled=false;sequencerSteps.forEach(step=>step.enabled=true);
  const t=audioContext.currentTime+.2;startSequencer(t,{force:true});window[`startBastardLoop${lane}`](t);
  window.scrollAudit={refreshes:0,notes:0,synthNotes:0,maxLateMs:0,startAudio:audioContext.currentTime,errors:[]};
  const sync=syncPerformanceControlState;
  window.restoreAudit=()=>{syncPerformanceControlState=sync;window[`scheduleBastardLoop${lane}Voice`]=voice;playOscillatorNote=osc};
  syncPerformanceControlState=(...a)=>{scrollAudit.refreshes++;return sync(...a)};
  const voice=window[`scheduleBastardLoop${lane}Voice`],osc=playOscillatorNote;
  playOscillatorNote=(...a)=>{const result=osc(...a);if(a[3]?.role===`bastardloop${lane.toLowerCase()}` && [...activeOscVoices.values()].some(v=>v.role===a[3].role))scrollAudit.synthNotes++;return result};
  window[`scheduleBastardLoop${lane}Voice`]=(...a)=>{scrollAudit.notes++;scrollAudit.maxLateMs=Math.max(scrollAudit.maxLateMs,(audioContext.currentTime-a[1])*1000);return voice(...a)};
 },{lane,sourceMode:process.env.MYGRAIN_LOOP_SOURCE||'sample'});
 await p.waitForTimeout(300);
 const box=await p.locator(`#bastardLoop${lane}Overlay .lead-sequencer-layout`).boundingBox();
 await p.mouse.move(box.x+box.width-20,box.y+60);
 const positions=[];
 for(let i=0;i<24;i++){
  await p.mouse.wheel(0,i%2? -100:180);await p.waitForTimeout(125);
  positions.push(await p.evaluate(lane=>document.querySelector(`#bastardLoop${lane}Overlay .lead-sequencer-layout`).scrollTop,lane));
 }
 const before=positions.at(-1);await p.waitForTimeout(500);
 const result=await p.evaluate(lane=>{
  const layout=document.querySelector(`#bastardLoop${lane}Overlay .lead-sequencer-layout`);
  const result={...scrollAudit,elapsedAudio:audioContext.currentTime-scrollAudit.startAudio,after:layout.scrollTop,playing:sequencerPlaying&&window[`isBastardLoop${lane}Running`](),voices:eval(`bastardLoop${lane}ActiveVoices.size`),currentCells:document.querySelectorAll(`#bastardLoop${lane}StepGrid .is-current`).length};
  restoreAudit();stopAllPerformancePlayback({silent:true});window[`closeBastardLoop${lane}Overlay`]();return result;
 },lane);
 assert(positions.some(n=>n>0),`${lane} actually scrolled`);assert.equal(result.after,before,`${lane} no scroll reset`);
 assert.equal(result.refreshes,0,`${lane} no global repaint per note`);assert(result.notes>15,`${lane} real notes scheduled`);assert.equal(result.playing,true);assert(result.maxLateMs<10,`${lane} scheduled before deadline`);assert.equal(result.currentCells,1);
 if(process.env.MYGRAIN_LOOP_SOURCE==='synth')assert(result.synthNotes>15,`${lane} real synth voices, not sample voices`);
 lanes.push({lane,sourceMode:process.env.MYGRAIN_LOOP_SOURCE||'sample',...result,positions});
}
console.log(engine,JSON.stringify(lanes));results.push({engine,lanes});assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}
fs.writeFileSync((process.env.MYGRAIN_AUDIO_EVIDENCE||'/tmp')+'/active-loop-scroll-'+(process.env.MYGRAIN_LOOP_SOURCE||'sample')+'.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
