'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.BASE||'http://127.0.0.1:19042/mygrain/',out=process.env.MYGRAIN_ROBOT_TEST_OUTPUT;
assert(out);const old=JSON.parse(fs.readFileSync(out+'/before/03.json')),oldAudio=fs.readFileSync(out+'/before/03.wav').toString('base64');
const live=process.env.MYGRAIN_LIVE_AUTH==='1';
(async()=>{let auth;if(live){let raw='';for await(const x of process.stdin)raw+=x;auth=JSON.parse(raw);}else assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);let rows=[];
for(const[kind,B]of Object.entries({chromium,webkit})){
 const browser=await B.launch(kind==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{const c=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),p=await c.newPage(),errors=[],renders=[];
 p.setDefaultTimeout(90000);p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.url().endsWith('/api/robot/render'))renders.push(r.json());});
 if(auth)await c.addCookies([{name:auth.cookie,value:auth.token,domain:new URL(base).hostname,path:'/',httpOnly:true,secure:true,sameSite:'Lax'}]);
 else assert((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-robot-fixture'}})).ok());
 await p.route('**/*',r=>{const q=r.request(),u=new URL(q.url());return u.origin===new URL(base).origin&&(q.method()==='GET'||u.pathname.endsWith('/api/robot/render'))?r.continue():r.abort();});
 async function ready(){await p.waitForFunction(()=>window.mygrainRobot&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);if(await p.locator('#start-btn').isVisible())await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);}
 async function reveal(){await p.waitForFunction(()=>!mygrainUiActivity.busy);await p.evaluate(()=>{mygrainDisplay.reveal(document.getElementById('robotCard'));document.getElementById('robotText').scrollIntoView({block:'center',behavior:'instant'});});await p.waitForFunction(()=>!mygrainUiActivity.busy);await p.evaluate(()=>mygrainDisplay.reveal(document.getElementById('robotCard')));}
 await p.goto(base);await ready();
 const baseline=await p.evaluate(async({old,oldAudio})=>{
  stopAllPerformancePlayback({silent:true});const bytes=Uint8Array.from(atob(oldAudio),c=>c.charCodeAt(0)),bank=await audioContext.decodeAudioData(bytes.buffer);
  mygrainRobot.restore({enabled:false,level:.7,loopBars:2,timingBars:1,phrases:[{id:'archived',text:old.lanes.map(x=>x.word).join(' '),voice:old.voice,note:null,speed:old.speed,enabled:true,lanes:old.lanes.map((l,i)=>({...l,pattern:Array.from({length:16},(_,j)=>j===i*2?1:0)}))}]});mygrainRobot.setBuffer(bank);await saveAudioBufferToDB(bank,'robotWordsBuffer');saveState();await mygrainCardHistory.flush();
  window.trimHash=async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',mygrainRobot.buffer.getChannelData(0)))).map(x=>x.toString(16).padStart(2,'0')).join('');return{hash:await trimHash(),settings:mygrainRobot.settings()};
 },{old,oldAudio});
 await reveal();await p.locator('#robotVoice').selectOption('kokoro_bf_emma');assert.equal(await p.evaluate(()=>trimHash()),baseline.hash);assert.equal(renders.length,0);
 await p.locator('#robotVoice').selectOption(old.voice);await p.locator('#robotReplace').tap();await p.waitForFunction(()=>!mygrainRobot.busy&&document.getElementById('robotStatus').textContent.startsWith('Phrase ready'));await p.evaluate(()=>mygrainCardHistory.flush());
 const changed=await p.evaluate(async()=>({hash:await trimHash(),settings:mygrainRobot.settings(),status:document.getElementById('robotStatus').textContent}));
 assert.notEqual(changed.hash,baseline.hash);assert.equal(changed.settings.timingBars,1);assert.equal(changed.settings.loopBars,2);assert.deepEqual(changed.settings.phrases[0].lanes.map(x=>x.pattern),baseline.settings.phrases[0].lanes.map(x=>x.pattern));
 await p.evaluate(()=>mygrainCardHistory.undo());assert.equal(await p.evaluate(()=>trimHash()),baseline.hash);await p.evaluate(()=>mygrainCardHistory.redo());assert.equal(await p.evaluate(()=>trimHash()),changed.hash);
 const portable=await p.evaluate(async()=>{const before=mygrainRobot.settings(),data=mygrainRobot.buffer.getChannelData(0).slice(),a=mygrainSongBetaAdapter,zip=await a.capture(),part=await a.decode(await zip.arrayBuffer(),{buffers:new Map(),bytes:0}),expected=part.buffers.get('robotWords').getChannelData(0).slice();mygrainRobot.restore();a.recall(part,{start:false});await a.whenPersisted();saveState();await mygrainCardHistory.flush();return{before,after:mygrainRobot.settings(),frames:[data.length,mygrainRobot.buffer.length],maxError:data.reduce((v,x,i)=>Math.max(v,Math.abs(x-mygrainRobot.buffer.getChannelData(0)[i])),0),settings:JSON.stringify(before)===JSON.stringify(mygrainRobot.settings()),pcm:expected.length===mygrainRobot.buffer.length&&expected.every((v,i)=>v===mygrainRobot.buffer.getChannelData(0)[i])};});fs.writeFileSync(out+'/'+kind+'-portable-debug.json',JSON.stringify(portable,null,2));// Compare with this browser's canonical decoded WAV (WebKit uses different PCM16 scaling).
assert(portable.settings&&portable.pcm,JSON.stringify({kind,settings:portable.settings,pcm:portable.pcm,maxError:portable.maxError,frames:portable.frames}));
 const saved=await p.evaluate(()=>trimHash());await p.reload();await ready();assert.equal(await p.evaluate(async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',mygrainRobot.buffer.getChannelData(0)))).map(x=>x.toString(16).padStart(2,'0')).join('')),saved);assert.equal(renders.length,1);
 const response=await renders[0];assert(response.ok);assert.equal(response.metadata.device,'cuda');
 const onset=await p.evaluate(async(body)=>{const b=await audioContext.decodeAudioData(Uint8Array.from(atob(body.audioBase64),c=>c.charCodeAt(0)).buffer),l=body.metadata.lanes[0],a=b.getChannelData(0).slice(0,Math.round(l.duration*b.sampleRate));let peak=0;for(const v of a)peak=Math.max(peak,Math.abs(v));return a.findIndex(v=>Math.abs(v)>peak*.01)*1000/b.sampleRate;},response);assert(onset<35,String(onset));assert.deepEqual(errors,[]);
 rows.push({kind,device:response.metadata.device,gpu:response.metadata.gpu,firstWordOnsetMs:onset,selectionDoesNotRender:true,oldPcmUndoExact:true,redoExact:true,patternsAndTimingKept:true,portable,reloadWithoutResynthesis:true,errors});
 await c.close();}finally{await browser.close();}
}
fs.writeFileSync(out+(live?'/live-browser.json':'/trim-browser.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
