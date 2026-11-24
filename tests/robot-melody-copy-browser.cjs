'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.BASE||'http://127.0.0.1:19351/mygrain/',out=process.env.MYGRAIN_TEST_OUTPUT;
assert(out,'MYGRAIN_TEST_OUTPUT required');fs.mkdirSync(out,{recursive:true});
const live=process.env.MYGRAIN_LIVE_AUTH?JSON.parse(fs.readFileSync(0,'utf8')).token:null;
const words='Come with me Stay with me Live with me die with me',notes=Array.from({length:12},(_,i)=>({note:60+i,beats:[.25,.5,1,2][i%4]}));
// Deterministic response at the network boundary: no model installation or inference needed.
const wav=Buffer.alloc(44+24000*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);for(let i=0;i<24000;i++)wav.writeInt16LE(Math.round(2000*Math.sin(i*2*Math.PI*220/24000)),44+2*i);
(async()=>{const results=[];for(const [engine,B]of Object.entries({chromium,webkit}))for(const phone of [true,false]){
 const label=engine+'-'+(phone?'phone':'desktop'),browser=await B.launch(engine==='chromium'?{executablePath:'/snap/chromium/current/usr/lib/chromium-browser/chrome',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const c=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1440,height:1000},hasTouch:phone,isMobile:phone});
 if(live)await c.addCookies([{name:'mygrain_session',value:live,domain:new URL(base).hostname,path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);else assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-copy-test'}})).status(),200);
 const p=await c.newPage(),errors=[],renders=[];p.setDefaultTimeout(45000);p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==new URL(base).origin)return r.abort();if(u.pathname.endsWith('/api/robot/render')){const body=q.postDataJSON();renders.push(body);return r.fulfill({json:{ok:true,audioBase64:wav.toString('base64'),metadata:{device:'cpu',lanes:[{word:body.text,offset:0,duration:1}]}}});}if(live&&!['GET','HEAD'].includes(q.method()))return r.abort();return r.continue();});
 for(const file of ['robot.js','robot.css']){const r=await c.request.get(base+file+'?v=20261123-robot-copy-sec-2');assert.equal(r.status(),200);assert((await r.body()).equals(fs.readFileSync('sandboxGRANULAR/'+file)));}
 async function ready(){await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);await p.evaluate(()=>mygrainDisplay.reveal(document.getElementById('robotCard')));}
 await p.goto(base);await ready();console.log(label,'runtime ready');
 await p.evaluate(async({words,notes})=>{const b=audioContext.createBuffer(1,audioContext.sampleRate,audioContext.sampleRate);b.getChannelData(0).fill(.04);mygrainRobot.restore({loopBars:4,phrases:[{id:'copy-original',text:words,voice:'diffsinger_qixuan',speed:170,note:null,melody:{bpm:130,notes},enabled:true,lanes:[{word:words,offset:0,duration:1,pattern:[1,...Array(15).fill(0)]}]}]});mygrainRobot.setBuffer(b);await saveAudioBufferToDB(b,'robotWordsBuffer');saveState();await mygrainCardHistory.flush();window.__copyBaseline=JSON.stringify({robot:mygrainRobot.settings(),pot:mygrainCookingPot.settings(),fx:mygrainLoopFx.settings()});window.__copyPCM=Array.from(b.getChannelData(0));},{words,notes});
 console.log(label,'fixture ready');const copy=p.locator('#robotMelodyCopySec'),rows=p.locator('#robotMelodyNotes .robot-melody-note');assert.equal(await copy.count(),1,'Required Copy Sec control missing');assert.equal(await rows.count(),12);await copy.scrollIntoViewIfNeeded();assert(await copy.isVisible());
 async function act(locator){await locator.scrollIntoViewIfNeeded();if(phone)await locator.tap();else await locator.click();}
 async function word(i){await act(rows.nth(i).locator('button'));}
 async function read(){return rows.evaluateAll(rs=>rs.map(r=>({note:+r.querySelectorAll('select')[0].value,beats:+r.querySelectorAll('select')[1].value})));}
 async function start(){await act(copy);assert.equal(await copy.getAttribute('aria-pressed'),'true');}
 // Reverse endpoints, source highlights, overlap and a partial final repetition.
 await start();await word(3);await word(1);assert.equal(await rows.locator('button[aria-pressed="true"]').count(),3);await word(2);
 const expected=notes.map((n,i)=>i<2?n:notes[1+(i-2)%3]);assert.deepEqual(await read(),expected);assert.equal(await copy.getAttribute('aria-pressed'),'false');
 assert.equal(await p.locator('#robotText').inputValue(),words);assert.equal(await p.locator('#robotMelodyBpm').inputValue(),'130');assert.equal(renders.length,0);
 assert(await p.evaluate(()=>__copyBaseline===JSON.stringify({robot:mygrainRobot.settings(),pot:mygrainCookingPot.settings(),fx:mygrainLoopFx.settings()})&&__copyPCM.every((v,i)=>v===mygrainRobot.buffer.getChannelData(0)[i])));
 await start();await word(0);await act(copy);assert.deepEqual(await read(),expected);assert.equal(await copy.getAttribute('aria-pressed'),'false');
 await start();await word(0);await p.keyboard.press('Escape');assert.equal(await copy.getAttribute('aria-pressed'),'false');assert.deepEqual(await read(),expected);
 // Changing a dropdown or the lyric draft invalidates the clipboard.
 await start();await word(0);await word(2);await rows.nth(0).locator('select').first().selectOption('72');assert.equal(await copy.getAttribute('aria-pressed'),'false');
 await start();await word(0);await p.locator('#robotText').fill(words+' now');assert.equal(await copy.getAttribute('aria-pressed'),'false');assert.equal(await rows.count(),13);await p.locator('#robotText').fill(words);
 await start();await word(0);await p.locator('#robotVoice').selectOption('bark_sing');assert.equal(await copy.getAttribute('aria-pressed'),'false');assert(await p.locator('#robotMelody').isHidden());await p.locator('#robotVoice').selectOption('diffsinger_qixuan');
 // Single-word repeat from a middle destination, preserving its prefix.
 const beforeSingle=await read();await start();await word(2);await word(2);await word(5);const finalNotes=beforeSingle.map((n,i)=>i<5?n:beforeSingle[2]);assert.deepEqual(await read(),finalNotes);
 const bounds=await rows.first().boundingBox(),cardBounds=await p.locator('#robotCard').boundingBox();assert(bounds.width<=cardBounds.width);assert((await rows.first().locator('button').boundingBox()).height>=44);
 await act(p.locator('#robotReplace'));await p.waitForFunction(()=>!mygrainRobot.busy&&document.getElementById('robotStatus').textContent.startsWith('Phrase ready'));await p.evaluate(()=>mygrainCardHistory.flush());assert.equal(renders.length,1);assert.deepEqual(renders[0].melody,{bpm:130,notes:finalNotes});assert.equal(renders[0].text,words);
 console.log(label,'copy and render checks passed');const committed=await p.evaluate(()=>mygrainRobot.settings());assert.deepEqual(committed.phrases[0].melody.notes,finalNotes);
 await p.evaluate(()=>mygrainCardHistory.undo());assert.deepEqual(await p.evaluate(()=>mygrainRobot.settings().phrases[0].melody.notes),notes);assert.deepEqual(await read(),notes);
 await p.evaluate(()=>mygrainCardHistory.redo());assert.deepEqual(await p.evaluate(()=>mygrainRobot.settings()),committed);assert.deepEqual(await read(),finalNotes);
 const portable=await p.evaluate(async()=>{const a=mygrainSongBetaAdapter,zip=await a.capture(),part=await a.decode(await zip.arrayBuffer(),{buffers:new Map(),bytes:0}),before=JSON.stringify(mygrainRobot.settings());mygrainRobot.restore();await a.recall(part,{start:false});await a.whenPersisted();saveState();await mygrainCardHistory.flush();return before===JSON.stringify(mygrainRobot.settings());});assert(portable);await p.waitForFunction(()=>!stateSaveSuspended&&!mygrainCardHistory.busy);
 await start();await word(0);await p.evaluate(()=>mygrainRobot.restore(mygrainRobot.settings()));assert.equal(await copy.getAttribute('aria-pressed'),'false');
 await copy.scrollIntoViewIfNeeded();await p.screenshot({path:out+'/'+label+'.png'});await p.reload();await ready();assert.deepEqual(await read(),finalNotes);assert.equal(renders.length,1,'Reload must not synthesize again');assert.deepEqual(errors,[]);
 results.push({label,reverseRange:true,overlap:true,partialRepeat:true,singleWord:true,cancel:true,escape:true,staleSelectionCleared:true,lyricsBpmPCMEffectsPreserved:true,renderPayload:true,undoRedo:true,portable,reload:true,errors});console.log('PASS',label);
 }finally{await browser.close();}}
 assert.equal(results.length,4);fs.writeFileSync(out+'/browser.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
