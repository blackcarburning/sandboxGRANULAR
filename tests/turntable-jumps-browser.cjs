'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:19083/mygrain/';
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
 try{for(const phone of [false,true]){const c=await b.newContext({viewport:phone?{width:390,height:844}:{width:1440,height:1000},isMobile:phone,hasTouch:phone,reducedMotion:'reduce'});await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-turntable'}});const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());await p.goto(base);await p.waitForFunction(()=>window.mygrainTurntable&&window.mygrainJumpToButton&&document.documentElement.dataset.mygrainStartup==='ready');
 await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 assert.equal(await p.locator('#sectionJumpPanel [data-jump-target="#turntableCard"]').count(),1);assert.equal(await p.locator('.section-jump-quick-stack [data-jump-target="#turntableCard"]').count(),0);assert.equal(await p.locator('#sectionJumpTurntableBtn').getAttribute('data-nav-section'),'turntable');
 if(phone)await p.locator('#sectionJumpHandle').tap();await p.locator('#desktopNavSearch').fill('turntable');await p.locator('#sectionJumpTurntableBtn').click();await p.waitForFunction(()=>!document.documentElement.dataset.mygrainJumping&&document.getElementById('turntableCard').getBoundingClientRect().top>=-1&&document.getElementById('turntableCard').getBoundingClientRect().top<160);
 const result=await p.evaluate(()=>({top:document.getElementById('turntableCard').getBoundingClientRect().top,edgeLinks:document.querySelectorAll('.section-jump-quick-stack [data-jump-target="#turntableCard"]').length,power:mygrainTurntable.settings().enabled}));assert.equal(result.power,false);assert.deepEqual(errors,[]);console.log('PASS',engine,phone?'iPhone drawer':'desktop menu',JSON.stringify(result));await c.close();}
 }finally{await b.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
