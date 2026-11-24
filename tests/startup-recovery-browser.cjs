'use strict';
// Recovery uses inline system fonts; a stalled original FontFaceSet is not a UI gate.
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';

const {chromium,webkit}=require('playwright-core'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const path=require('node:path'),base=process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:19232/mygrain/';assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);const d={out:process.env.STARTUP_OUTPUT_DIR || '/tmp/mygrain-startup-recovery'};fs.mkdirSync(d.out,{recursive:true});const script=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').match(/<script id="mygrain-startup-script">([\s\S]*?)<\/script>/)[1],results=[];
for(const [kind,B]of Object.entries({chromium,webkit})){
const b=await B.launch(kind==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
try{for(const mode of ['candidate-paused-frames','candidate-script-error','candidate-style-error','candidate-script-stall','candidate-normal']){
const c=await b.newContext({viewport:{width:390,height:844}}),p=await c.newPage(),errors=[],held=[];p.on('pageerror',e=>errors.push(e.message));let retrying=false;p.setDefaultTimeout(45000);const wait=f=>p.waitForFunction(f,null,{polling:100});assert.equal((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-startup-check'}})).status(),200);
await p.addInitScript(({paused})=>{window.__rawLocal=localStorage;localStorage.setItem('mygrain-startup-sentinel','keep-me');},{paused:mode.includes('paused-frames')});
await p.route(base+'?**',async r=>{const response=await r.fetch();let html=await response.text();html=html.replace(/<script id="mygrain-startup-script">[\s\S]*?<\/script>/,original=>{if(mode.startsWith('baseline'))return original.replaceAll('requestAnimationFrame(', '(()=>0)(');let candidate=kind==='webkit'&&mode.includes('script-stall')&&!retrying?script.replace('}, 30000);','}, 500);'):script;if(mode.includes('paused-frames'))candidate=candidate.replaceAll('requestAnimationFrame(', '(()=>0)(');return '<script id="mygrain-startup-script">'+candidate+'</script>';});await r.fulfill({response,body:html});});
if(mode.includes('script-error'))await p.route('**/mygrain-load-notes.js*',r=>r.abort('failed'));
if(mode.includes('style-error'))await p.route('**/mygrain-accounts.css*',r=>r.abort('failed'));
if(mode.includes('script-stall'))await p.route('**/mygrain-load-notes.js*',r=>{held.push(r);});
const t=Date.now();await p.goto(base+'?startup-check='+mode,{waitUntil:'commit'});
let result;
if(mode==='baseline-paused-frames'){await wait(()=>document.readyState==='complete');await p.waitForTimeout(1000);result=await p.evaluate(()=>({startup:document.documentElement.dataset.mygrainStartup,failed:!!mygrainStartup.failed,accountReady:!!mygrainAccounts}));assert.equal(result.startup,'loading');assert(result.accountReady);}
else if(mode.includes('error')||mode.includes('stall')){await wait(()=>window.mygrainStartup?.failed);assert(await p.locator('#mygrainStartupRetry').isVisible());result=await p.evaluate(()=>({startup:document.documentElement.dataset.mygrainStartup,message:document.getElementById('mygrain-account-shell').innerText,sentinel:__rawLocal.getItem('mygrain-startup-sentinel')}));assert.equal(result.sentinel,'keep-me');assert(result.message.includes('saved workspace is unchanged'));await p.screenshot({path:d.out+'/'+kind+'-'+mode+'.png',animations:'disabled',timeout:5000});for(const r of held)await r.abort().catch(()=>{});await p.unroute('**/mygrain-load-notes.js*');await p.unroute('**/mygrain-accounts.css*');retrying=true;await p.locator('#mygrainStartupRetry').click();await wait(()=>document.documentElement.dataset.mygrainStartup==='ready'&&!mygrainStartup.failed);result.retry=true;}
else{await wait(()=>document.documentElement.dataset.mygrainStartup==='ready');assert(!(await p.evaluate(()=>mygrainStartup.failed)));result={startup:'ready'};if(mode==='candidate-normal'){await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await wait(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);result.audioReady=true;}}
assert.deepEqual(errors,[]);const row={browser:kind,mode,ms:Date.now()-t,...result,errors};results.push(row);console.log(JSON.stringify(row));fs.appendFileSync(d.out+'/progress.jsonl',JSON.stringify(row)+'\n');await c.close();}
}finally{await b.close();}}
fs.writeFileSync(d.out+'/recovery-results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
