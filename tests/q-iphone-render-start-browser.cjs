// Explicit iPhone UA, actual export confirmation, no manual sequencer Start.
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:19073/mygrain/';
(async()=>{for(const[name,type]of Object.entries({chromium,webkit})){
 if(process.env.Q_EXPORT_ENGINES&&!process.env.Q_EXPORT_ENGINES.split(',').includes(name))continue;
 const browser=await type.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"});assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'q-repo-local-test'}})).status(),200);const p=await c.newPage();p.setDefaultTimeout(60000);let includeSnapshot=false;const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.type()==='prompt'?d.accept('Q export fixture'):includeSnapshot?d.accept():d.dismiss());await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainQ);await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});resetStemIsolationState();applyGlobalBpm(240);syncPatternLengthControls(16,{skipSave:true});syncPerformanceExportBars(1,{skipSave:true});setFxMuted(true,{silent:true});const q=MygrainQTheory.defaults();Object.assign(q,{enabled:true,instrument:'piano',level:.8,room:0,delay:0});q.sequence[0]=MygrainQTheory.normalizeStep({notes:[60,64,67],velocity:100,gate:12});mygrainQ.restore(q);window.qExportStarts=0;const start=mygrainQ.start.bind(mygrainQ);mygrainQ.start=(...args)=>{qExportStarts++;return start(...args)};uploadWavToRepository=async(blob,filename)=>{const b=await audioContext.decodeAudioData(await blob.arrayBuffer());let peak=0,sum=0;for(const x of b.getChannelData(0)){peak=Math.max(peak,Math.abs(x));sum+=x*x}window.qExportResult={peak,rms:Math.sqrt(sum/b.length),frames:b.length,rate:b.sampleRate,starts:qExportStarts};return{savedName:filename}};});
 const results=[];
 for(const mode of ['piano','strings','sample','editor','snapshot','disabled']){
  if(process.env.Q_IPHONE_MODES&&!process.env.Q_IPHONE_MODES.split(',').includes(mode))continue;
  includeSnapshot=mode==='snapshot';
  await p.evaluate(async mode=>{
    stopAllPerformancePlayback({silent:true});qExportStarts=0;qExportResult=null;
    const state=MygrainQTheory.defaults();Object.assign(state,{enabled:mode!=='disabled',instrument:mode==='strings'?'strings':'piano',soundSource:mode==='sample'?'sample':mode==='strings'?'strings':'piano',level:.8,room:0,delay:0});
    state.sequence[0]=MygrainQTheory.normalizeStep({notes:[60,64,67],velocity:100,gate:12});mygrainQ.restore(state);
    if(mode==='sample'){const b=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate);for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=.2*Math.sin(i*2*Math.PI*261.63/b.sampleRate);qSourceSampleBuffer=b;}
    if(mode==='editor')await mygrainQ.chordEditor.open(0);
    // No Q manual Start. Suspend on entry AFTER the real confirmation dialogue.
    if(!window.qIphoneRenderProbe){window.qIphoneRenderProbe=true;const render=renderLiveOutputBarsBuffer;renderLiveOutputBarsBuffer=async options=>{await audioContext.suspend();return render(options)};
      startTransportChordLayer=()=>{throw Error('iPhone export used ordinary transport gate')};}
  },mode);
  await p.evaluate(()=>document.getElementById('performanceRepoExportBtn').click());await p.waitForFunction(()=>window.qExportResult!==null);const r=await p.evaluate(()=>({...qExportResult,qRunning:mygrainQ.running,editorOpen:mygrainQ.chordEditor.opened}));assert.equal(r.qRunning,false);if(mode==='editor')assert.equal(r.editorOpen,false);assert(r.frames===r.rate,JSON.stringify(r));if(mode==='disabled'){assert(r.peak<1e-6,JSON.stringify({mode,...r}));assert.equal(r.starts,0)}else{assert(r.rms>.0001,JSON.stringify({mode,...r}));assert.equal(r.starts,1)}results.push({mode,...r});console.log(name,mode,JSON.stringify(r));
 }
 assert.deepEqual(errors,[]);console.log('PASS',name,JSON.stringify(results));await c.close();}finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
