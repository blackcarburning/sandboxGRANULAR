'use strict';
const {chromium,webkit}=require('playwright-core'),assert=require('node:assert/strict');
const run=Date.now();(async()=>{for(const [engine,type]of Object.entries({webkit,chromium})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),p=await context.newPage();p.setDefaultTimeout(20000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const base='http://127.0.0.1:18958/mygrain/';await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-cut-test'}});await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});document.getElementById('globalBpmSlider').value='120';sequencerBPM=120;syncPatternLengthControls(16);const b=audioContext.createBuffer(2,Math.round(audioContext.sampleRate*2),audioContext.sampleRate);for(let c=0;c<2;c++)for(let i=0;i<b.length;i++)b.getChannelData(c)[i]=.25*Math.sin(2*Math.PI*(c?330:220)*i/b.sampleRate);
 bastardLoopBuffer=b;bastardLoop2Buffer=b;bastardLoop3Buffer=b;bastardLoopVBuffer=b;bastardLoopWBuffer=b;
 bastardLoopMetadata={bpm:120,durationSeconds:2};bastardLoop2Metadata={bpm:120,durationSeconds:2};bastardLoop3Metadata={bpm:120,durationSeconds:2};bastardLoopVMetadata={bpm:120,durationSeconds:2};bastardLoopWMetadata={bpm:120,durationSeconds:2};bastardLoopSourceBpm=120;bastardLoop2SourceBpm=120;bastardLoop3SourceBpm=120;bastardLoopVSourceBpm=120;bastardLoopWSourceBpm=120;syncBastardLoopUi();syncBastardLoop2Ui();syncBastardLoop3Ui();syncBastardLoopVUi();syncBastardLoopWUi();});
 let paired=false;p.on('dialog',d=>d.type()==='prompt'?d.accept('phone-repo-'+run+'-'+engine+'-'+(paired?'paired':'wav')):paired?d.accept():d.dismiss());
 await p.evaluate(()=>{setBastardLoopEnabled(true,{silent:true,skipSave:true});setLoopLayerSolo('bastarda',{silent:true});syncPerformanceExportBars(1,{skipSave:true});setBastardLoopCut({gapEnabled:true,gaps:[[.25,.5]]});});
 for(const withPatch of [false,true]) {
 paired=withPatch;
 console.log(engine,withPatch,await p.evaluate(async()=>{await exportGeneratedLoopToRepository();return document.querySelector('#status')?.textContent;}));
 const files=await context.request.get('http://127.0.0.1:18958/mygrain-wavs/api/list',{headers:{'X-Mygrain-User':'admin'}});
 const data=await files.json();const file=data.files.find(f=>f.name==='phone-repo-'+run+'-'+engine+'-'+(paired?'paired':'wav')+'.wav');assert(file,JSON.stringify(data));
 const response=await context.request.get(new URL(file.url,base).href,{headers:{'X-Mygrain-User':'admin'}});const bytes=await response.body();assert.equal(bytes.toString('ascii',0,4),'RIFF');assert(bytes.length>100000);if(paired)assert(file.patternExport);
 console.log('PASS',engine,paired?'WAV + editable ZIP':'WAV only',bytes.length);
 }
 assert.deepEqual(errors,[]);await context.close();}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});
