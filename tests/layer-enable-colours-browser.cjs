'use strict';
const assert=require('node:assert/strict');
const {webkit,chromium}=require('playwright-core');
(async()=>{for(const [engine,type] of Object.entries({webkit,chromium})){const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});try{const c=await b.newContext({viewport:{width:1440,height:1000},hasTouch:false,isMobile:false,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='https://openclaw.blackcarburning.com')return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"wasp-fixture"}};'});if(u.pathname.includes('/api/'))return r.fulfill({json:{ok:true,authenticated:true,user:{username:'wasp-fixture'},files:[],songs:[],folders:[],samples:[],patches:[]}});if(!['GET','HEAD'].includes(r.request().method()))return r.abort();return r.continue()});await p.goto('https://openclaw.blackcarburning.com/mygrain/');await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting);


await p.waitForFunction(()=>getComputedStyle(document.getElementById('start-overlay')).display==='none');
for (const width of [1440,390,844]) {
 await p.setViewportSize({width,height:width===1440?1000:width===390?844:390});
 const buttons=p.locator('[data-layer-enable-for]');assert.equal(await buttons.count(),12);
 for(const button of await buttons.all()) {
  const id=await button.getAttribute('data-layer-enable-for');
  assert.equal(await button.evaluate(b=>b.parentElement.classList.contains('performance-feature-actions')),true,id);
  for(const enabled of [false,true]) {
   await p.evaluate(({id,enabled})=>{const t=document.getElementById(id);if((t.getAttribute('aria-pressed')==='true')!==enabled)t.click()}, {id,enabled});
   await p.waitForTimeout(20);
   assert.equal(await button.textContent(),enabled?'Enabled':'Disabled');
   assert.equal(await button.evaluate(b=>getComputedStyle(b).backgroundColor),enabled?'rgb(23, 101, 52)':'rgb(134, 28, 43)');
  }
  await button.evaluate(b=>b.scrollIntoView({behavior:'instant',block:'center'}));await p.waitForTimeout(30);
  const hit=await button.evaluate(b=>{const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {ok:b.contains(hit),rect:r.toJSON(),hit:hit?.outerHTML.slice(0,400),parent:b.parentElement.getBoundingClientRect().toJSON()}});assert(hit.ok,JSON.stringify({id,width,...hit}));
 }
 const q=p.locator('#performanceBastardLoopQToggleBtn');await q.scrollIntoViewIfNeeded();
 for(const enabled of [false,true]){
  await p.evaluate(enabled=>window.mygrainQ.setEnabled(enabled,{silent:true,skipSave:true}),enabled);
  assert.equal(await q.textContent(),enabled?'Enabled':'Disabled');
  assert.equal(await q.evaluate(b=>getComputedStyle(b).backgroundColor),enabled?'rgb(23, 101, 52)':'rgb(134, 28, 43)');
 }
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 console.log('PASS',engine,width,'13 card enable states, colours and 12 unobstructed action buttons');
}
assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
