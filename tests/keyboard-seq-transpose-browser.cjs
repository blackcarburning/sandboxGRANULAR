const assert=require('node:assert/strict');
const {chromium,webkit}=require('/root/.openclaw/workspace/node_modules/playwright-core');
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});
 try{const c=await b.newContext({viewport:{width:390,height:844}});const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='https://openclaw.blackcarburning.com')return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"seq-fixture"}};'});if(u.pathname.includes('/api/'))return r.fulfill({json:{ok:true,authenticated:true,user:{username:'seq-fixture'},files:[],songs:[],folders:[],samples:[],patches:[]}});if(!['GET','HEAD'].includes(r.request().method()))return r.abort();return r.continue()});
 await p.goto('https://openclaw.blackcarburning.com/mygrain/');await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
 const result=await p.evaluate(()=>{
 stopAllPerformancePlayback({silent:true});
 function select(notes){heldNotes.clear();document.querySelectorAll('#keyboardContainer .key.active').forEach(k=>k.classList.remove('active'));notes.forEach(n=>{heldNotes.add(n);document.querySelector(`#keyboardContainer .key[data-note="${n}"]`).classList.add('active')});}
 octaveOffset=0;updateOctaveDisplay();select(['C3','E3','G3']);document.getElementById('keyboardSeqUpBtn').click();
 const up={notes:getArpeggiatorNotes(),gui:getKeyboardActiveNotes(),oct:octaveOffset};document.getElementById('keyboardSeqDownBtn').click();const down=getArpeggiatorNotes();
 updateKeyboardGeometry();const visible=[...document.querySelectorAll('#keyboardContainer .key')].filter(k=>!k.hidden);const highest=visible.at(-1).dataset.note;select([highest]);transposeKeyboardSequence(1);const follow={oct:octaveOffset,visible:getKeyboardActiveNotes().every(n=>!document.querySelector(`#keyboardContainer .key[data-note="${n}"]`).hidden)};
 octaveOffset=0;updateOctaveDisplay();const lowest=[...document.querySelectorAll('#keyboardContainer .key')].find(k=>!k.hidden).dataset.note;select([lowest]);transposeKeyboardSequence(-1);const lower={oct:octaveOffset,visible:getKeyboardActiveNotes().every(n=>!document.querySelector(`#keyboardContainer .key[data-note="${n}"]`).hidden)};
 select(['C-1','E-1']);const edge=transposeKeyboardSequence(-1);return {up,down,follow,lower,edge,edgeNotes:getArpeggiatorNotes()};
 });assert.deepEqual(result.up.notes,['C#3','F3','G#3']);assert.deepEqual(result.up.gui,result.up.notes);assert.equal(result.up.oct,0);assert.deepEqual(result.down,['C3','E3','G3']);assert(result.follow.oct>0&&result.follow.visible);assert(result.lower.oct<0&&result.lower.visible);assert.equal(result.edge,false);assert.deepEqual(result.edgeNotes,['C-1','E-1']);assert.deepEqual(errors,[]);console.log('PASS',engine,result);await c.close();
 }finally{await b.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
