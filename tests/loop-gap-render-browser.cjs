'use strict';
const {chromium,webkit}=require('playwright-core'),assert=require('node:assert/strict');
(async()=>{for(const [engine,type]of Object.entries({chromium})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),p=await context.newPage();p.setDefaultTimeout(20000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const base='http://127.0.0.1:18958/mygrain/';await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-cut-test'}});await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});document.getElementById('globalBpmSlider').value='120';sequencerBPM=120;syncPatternLengthControls(16);const b=audioContext.createBuffer(2,Math.round(audioContext.sampleRate*2),audioContext.sampleRate);for(let c=0;c<2;c++)for(let i=0;i<b.length;i++)b.getChannelData(c)[i]=.25*Math.sin(2*Math.PI*(c?330:220)*i/b.sampleRate);
 bastardLoopBuffer=b;bastardLoop2Buffer=b;bastardLoop3Buffer=b;bastardLoopVBuffer=b;bastardLoopWBuffer=b;
 bastardLoopMetadata={bpm:120,durationSeconds:2};bastardLoop2Metadata={bpm:120,durationSeconds:2};bastardLoop3Metadata={bpm:120,durationSeconds:2};bastardLoopVMetadata={bpm:120,durationSeconds:2};bastardLoopWMetadata={bpm:120,durationSeconds:2};bastardLoopSourceBpm=120;bastardLoop2SourceBpm=120;bastardLoop3SourceBpm=120;bastardLoopVSourceBpm=120;bastardLoopWSourceBpm=120;syncBastardLoopUi();syncBastardLoop2Ui();syncBastardLoop3Ui();syncBastardLoopVUi();syncBastardLoopWUi();});
 for(const [lane,suffix,key]of [['A','','bastarda'],['B','2','bastardb'],['C','3','bastardc'],['V','V','bastardv'],['W','W','bastardw']]){
 const result=await p.evaluate(async({lane,suffix,key})=>{
  stopAllPerformancePlayback({silent:true});
  window['setBastardLoop'+suffix+'Enabled'](true,{silent:true,skipSave:true});document.getElementById('performanceBastardLoop'+suffix+'Level').value='70';window['updateBastardLoop'+suffix+'Mix']();
  setLoopLayerSolo(key,{silent:true});window['setBastardLoop'+suffix+'Cut']({gapEnabled:true,gaps:[[.25,.5]]});
  const part=await mygrainSongBetaAdapter.capture({liveOnly:true});
  const render=await mygrainSongBetaAdapter.renderPart(part,{bpm:120,patternSteps:16,patternCycleMultiplier:1,repeats:1});
  const rms=(a,b)=>{const d=render.getChannelData(0).slice(Math.round(a*render.sampleRate),Math.round(b*render.sampleRate));return Math.sqrt(d.reduce((s,x)=>s+x*x,0)/d.length)};
  return{duration:render.duration,before:rms(.15,.35),gap:rms(.65,.85),after:rms(1.25,1.5),sourceDuration:part.buffers.get({A:'bastardA',B:'bastardB',C:'bastardC',V:'bastardV',W:'bastardW'}[lane])?.duration};
 },{lane,suffix,key});console.log('RENDER',engine,lane,result);assert(Math.abs(result.duration-2)<.001);assert(result.before>.001);assert(result.after>.001);assert(result.gap<result.before/20);assert.equal(result.sourceDuration,2);
 }
 assert.deepEqual(errors,[]);await context.close();}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});
