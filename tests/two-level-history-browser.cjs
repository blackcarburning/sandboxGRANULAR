const {chromium,webkit}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18967/mygrain/';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{const results=[];for(const [name,engine]of Object.entries({chromium,webkit})){
 const b=await engine.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{for(const viewport of [{width:402,height:768},{width:768,height:402}]){
 const c=await b.newContext({viewport,isMobile:true,hasTouch:true}),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(60000);
 assert((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-page-scroll'}})).ok());
 await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 async function open(){await p.goto(base);await p.waitForFunction(()=>window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);}
 await open();
 const edits=await p.evaluate(async()=>{stopAllPerformancePlayback({silent:true});const make=n=>{const x=audioContext.createBuffer(1,4800,48000);for(let i=0;i<x.length;i++)x.getChannelData(0)[i]=n*.02*Math.sin(2*Math.PI*220*i/x.sampleRate);return x};bastardLoopVBuffer=make(0);const hashes={};const hash=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',x.getChannelData(0)))).join(',');
 for(let n=1;n<=4;n++){mygrainCardHistory.run('Replace V '+n,()=>{bastardLoopVBuffer=make(n)});await mygrainCardHistory.flush();hashes[n]=await hash(bastardLoopVBuffer);}
 const memory=mygrainCardHistory.memory([bastardLoopVBuffer]);const diagnostic=capturePhoneDiagnosticState(true);return{hashes,memory,diagnostic:{undoMemory:diagnostic.undoMemory,total:diagnostic.buffers.knownLiveAndUndoPCMBytes,cuts:diagnostic.loopCuts},counts:mygrainCardHistory.counts}});
 assert.deepEqual(edits.counts,{undo:2,redo:0});assert.equal(edits.memory.residentBuffers,3);assert.equal(edits.memory.additionalBuffers,2);assert.equal(edits.memory.additionalPCMBytes,38400);assert.equal(edits.diagnostic.undoMemory.limit,2);assert.equal(Object.keys(edits.diagnostic.cuts).length,7);
 async function travel(direction){await p.evaluate(direction=>mygrainCardHistory[direction](),direction);return p.evaluate(()=>bastardLoopVBuffer.getChannelData(0)[1]);}
 async function verifyHash(n){assert.equal(await p.evaluate(async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bastardLoopVBuffer.getChannelData(0)))).join(',')),edits.hashes[n]);}
 const expected=n=>n*.02*Math.sin(2*Math.PI*220/48000);
 assert(Math.abs(await travel('undo')-expected(3))<1e-8);await verifyHash(3);assert(Math.abs(await travel('undo')-expected(2))<1e-8);await verifyHash(2);assert.deepEqual(await p.evaluate(()=>mygrainCardHistory.counts),{undo:0,redo:2});await p.evaluate(()=>mygrainCardHistory.flush());
 await open();assert.deepEqual(await p.evaluate(()=>mygrainCardHistory.counts),{undo:0,redo:2});assert.equal(await p.evaluate(()=>mygrainCardHistory.memory().residentBuffers),0);assert(Math.abs(await travel('redo')-expected(3))<1e-8);await verifyHash(3);assert(Math.abs(await travel('redo')-expected(4))<1e-8);await verifyHash(4);
 // Seed an actual old ten-level journal; migration must prune audio without decoding it.
 const migration=await p.evaluate(async()=>{const owner='migration-owner',device='migration-'+crypto.randomUUID();let s=new MygrainSongStorage.HistoryStore(owner,device);await s.open();const tone=audioContext.createBuffer(1,32,48000);tone.getChannelData(0).fill(.125);const entry={owner,label:'old',json:[],buffers:[{index:0,before:null,after:tone}],piano:null};await s.save([entry],[]);let raw=await s.read('journals',device);const oldId=device+':old-unused';raw.undo=Array.from({length:10},(_,i)=>({...raw.undo[0],label:'old'+i}));raw.references.push(oldId);await new Promise((resolve,reject)=>{const tx=s.database.transaction(['journals','audio'],'readwrite');tx.objectStore('journals').put(raw,device);tx.objectStore('audio').put({length:1,channels:1,sampleRate:48000,data:[new Float32Array(1)]},oldId);tx.oncomplete=resolve;tx.onabort=reject});s.close();await new Promise(r=>setTimeout(r,20));s=new MygrainSongStorage.HistoryStore(owner,device);const restored=await s.open();const result={labels:restored.undo.map(e=>e.label),redo:restored.redo.length,deleted:(await s.read('audio',oldId))===undefined,decoded:s.decoded.size};await s.save([],[]);s.close();return result});
 assert.deepEqual(migration,{labels:['old8','old9'],redo:0,deleted:true,decoded:0});
 const logging=await p.evaluate(()=>{const out=document.getElementById('debugConsoleOutput');out.style.display='none';let renders=0;const old=getSelectedDebugConsoleText;getSelectedDebugConsoleText=()=>{renders++;return old()};for(let i=0;i<50;i++)window.dispatchEvent(new ErrorEvent('error',{message:'fixture masked burst',filename:'',lineno:0,colno:0}));getSelectedDebugConsoleText=old;
 const runtime=mygrainRuntimeDiagnostics.snapshot().events.filter(e=>e.type==='javascript-error'&&e.message==='fixture masked burst');const phone=phoneAudioDiagnostics.snapshot().events.filter(e=>e.type==='error'&&e.message.includes('fixture masked burst'));return{renders,runtime:runtime.map(e=>e.count),phone:phone.map(e=>e.count)}});
 assert.deepEqual(logging,{renders:0,runtime:[50],phone:[50]});
 await p.evaluate(()=>{mygrainCardHistory.runPatternEdit('V cut test',()=>setBastardLoopVCut({enabled:true,start:.2,end:.7},{skipSave:true,skipRestart:true}));});
 const loopLog=await p.evaluate(()=>capturePhoneDiagnosticState(true).loopCuts.V);assert.equal(loopLog.start,.2);assert.equal(loopLog.enabled,true);
 await p.evaluate(()=>window.dispatchEvent(new Event('mygrain-account-lock')));assert.deepEqual(await p.evaluate(()=>mygrainCardHistory.counts),{undo:0,redo:0});assert.deepEqual(errors,[]);
 const result={engine:name,viewport,memory:edits.memory,migration,logging,errors};results.push(result);console.log('PASS',name,viewport.width,JSON.stringify(result));await c.close();
 }}finally{await b.close()}}
 if(process.env.MYGRAIN_EVIDENCE)fs.writeFileSync(process.env.MYGRAIN_EVIDENCE,JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
