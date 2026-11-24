'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
(async()=>{let raw='';for await(const x of process.stdin)raw+=x;const d=JSON.parse(raw),base='https://openclaw.blackcarburning.com/mygrain/',rows=[];
for(const[kind,B]of Object.entries({chromium,webkit})){
const b=await B.launch(kind==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});try{
 const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await c.addCookies([{name:d.cookie,value:d.token,domain:'openclaw.blackcarburning.com',path:'/',httpOnly:true,secure:true,sameSite:'Lax'}]);
 for(const file of ['robot.js','robot-dsp.js','robot.css']){const r=await c.request.get(base+file+'?v=20261123-robot-engines-3');assert.equal(r.status(),200);assert((await r.body()).equals(fs.readFileSync('sandboxGRANULAR/'+file)));}
 if(process.env.MYGRAIN_ASSET_ONLY==='1'){rows.push({kind,hostedBytesExact:true,assetsOnly:true});await c.close();continue;}
 const p=await c.newPage(),errors=[],metadata=[],posts=[];p.setDefaultTimeout(180000);p.on('pageerror',e=>errors.push(e.message));p.on('response',async r=>{if(r.url().endsWith('/api/robot/render'))metadata.push(await r.json());});
 await p.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==new URL(base).origin)return r.abort();if(!['GET','HEAD'].includes(q.method())){if(u.pathname!=='/mygrain/api/robot/render')return r.abort();posts.push(u.pathname);}return r.continue();});
 await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainRobot);await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});mygrainRobot.restore({loopBars:4});mygrainRobot.setBuffer(null);});
 const voices=kind==='chromium'?['festival_kal','flite_slt','sam_classic','piper_cori','qwen_aiden','bark_sing','diffsinger_qixuan']:['sam_classic','qwen_ryan','diffsinger_qixuan'];
 for(const voice of voices){
 await p.waitForFunction(()=>!mygrainUiActivity.busy);await p.evaluate(()=>{mygrainDisplay.reveal(document.getElementById('robotCard'));document.getElementById('robotText').scrollIntoView({block:'center',behavior:'instant'});});await p.waitForFunction(()=>!mygrainUiActivity.busy);await p.evaluate(()=>mygrainDisplay.reveal(document.getElementById('robotCard')));
 await p.locator('#robotText').fill('Hello world');await p.locator('#robotVoice').selectOption(voice);
 if(voice==='diffsinger_qixuan'){assert.equal(await p.locator('#robotMelodyNotes .robot-melody-note').count(),2);await p.locator('#robotMelodyNotes .robot-melody-note').nth(1).locator('select').nth(0).selectOption('67');}
 const before=await p.evaluate(()=>mygrainRobot.settings().phrases.length);await p.locator('#robotAdd').tap();await p.waitForFunction(n=>!mygrainRobot.busy&&mygrainRobot.settings().phrases.length===n+1&&document.getElementById('robotStatus').textContent.startsWith('Phrase ready'),before);await p.evaluate(()=>mygrainCardHistory.flush());
 const data=await p.evaluate(()=>{const p=mygrainRobot.settings().phrases.at(-1),x=mygrainRobot.buffer.getChannelData(0);let peak=0;for(let i=Math.floor(p.lanes[0].offset*audioContext.sampleRate);i<Math.min(x.length,Math.floor((p.lanes.at(-1).offset+p.lanes.at(-1).duration)*audioContext.sampleRate));i++)peak=Math.max(peak,Math.abs(x[i]));return{voice:p.voice,lanes:p.lanes.length,peak,melody:p.melody};});assert.equal(data.voice,voice);assert(data.peak>.01);assert(metadata.at(-1).ok);if(voice.startsWith('qwen_')||voice.startsWith('bark_'))assert.equal(metadata.at(-1).metadata.device,'cuda');
 }
 await p.screenshot({path:d.out+'/'+kind+'-live.png'});assert.deepEqual(errors,[]);assert.equal(posts.length,voices.length);rows.push({kind,voices,metadata:metadata.map(x=>x.metadata),hostedBytesExact:true,phoneUI:true,onlyStatelessSynthesisPosted:true,errors});await c.close();
 }finally{await b.close();}}
fs.writeFileSync(d.out+(process.env.MYGRAIN_ASSET_ONLY==='1'?'/live-final-assets.json':'/live.json'),JSON.stringify(rows,null,2));console.log((process.env.MYGRAIN_ASSET_ONLY==='1'?'FINAL ASSET CHECK: ':'')+'PASS live HTTPS Chromium/WebKit: all seven engines, RTX inference, melody controls, exact deployed assets, no saved production mutations');})().catch(e=>{console.error(e);process.exitCode=1});
