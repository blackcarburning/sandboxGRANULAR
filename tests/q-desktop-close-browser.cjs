// Read-only live smoke: mocked identity/API, all server writes blocked.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'https://openclaw.blackcarburning.com/mygrain/',out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp/mygrain-q-edge-loop-evidence';fs.mkdirSync(out,{recursive:true});
(async()=>{const results=[];for(const[engine,type]of Object.entries({chromium,webkit})){
const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
try{const ctx=await browser.newContext({viewport:{width:1280,height:800}}),page=await ctx.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(45000);
await page.route('**/*',r=>{const req=r.request(),u=new URL(req.url()),identity={ok:true,authenticated:true,user:{username:'q-quick-readonly-live'}};if(u.origin!==new URL(base).origin)return r.abort();if(!['GET','HEAD'].includes(req.method())){writes.push(req.method()+' '+u.pathname);return r.abort()}if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext='+JSON.stringify(identity)});if(u.pathname.includes('/api/'))return r.fulfill({json:{...identity,files:[],songs:[],folders:[],stations:[],samples:[],favourites:[],patches:[]}});return r.continue()});
await page.goto(base);await page.waitForFunction(()=>window.mygrainQCustomChords&&document.documentElement.dataset.mygrainStartup==='ready');await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});mygrainQ.open();const q=mygrainQ;q.state.sequence.fill(null);for(const[i,n]of[[4,60],[6,65]])q.state.sequence[i]=MygrainQTheory.normalizeStep({notes:[n,n+4,n+7]});q.state.record=false;q.changed({reschedule:false});q.resetEditorHistory();const b=audioContext.createBuffer(1,audioContext.sampleRate,audioContext.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=.1*Math.sin(2*Math.PI*261.63*i/b.sampleRate);drumMachineKickBuffer=b;drumMachineKickPattern=Array.from({length:16},(_,i)=>i===0);q.piano.ensure=async()=>{};q.piano.source=p=>({sample:{midi:p},buffer:b,offset:0,duration:1,loopStart:.1,loopEnd:.9});});


for(const size of [{width:1280,height:800},{width:1920,height:1080},{width:1024,height:600}]){
 await page.setViewportSize(size);await page.evaluate(()=>mygrainQ.open());
 const b=await page.locator('#bastardLoopQCloseBtn').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}});
 assert(b.width>=44&&b.height>=40&&b.hit,JSON.stringify({size,b}));
 assert(b.right<=size.width&&size.width-b.right<=20&&b.bottom<=size.height&&size.height-b.bottom<=20,JSON.stringify({size,b}));
 await page.locator('#bastardLoopQCloseBtn').click();assert(await page.locator('#bastardLoopQOverlay').evaluate(e=>e.hidden));results.push({engine,size,b});
}
assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);console.log('PASS',engine,results);await ctx.close();}finally{await browser.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
