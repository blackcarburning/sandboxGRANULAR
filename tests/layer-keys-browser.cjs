'use strict';
const assert=require('node:assert/strict');
const {webkit,chromium}=require('playwright-core');
(async()=>{for(const [engine,type] of Object.entries({webkit,chromium})){const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});try{const c=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='https://openclaw.blackcarburning.com')return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"wasp-fixture"}};'});if(u.pathname.includes('/api/'))return r.fulfill({json:{ok:true,authenticated:true,user:{username:'wasp-fixture'},files:[],songs:[],folders:[],samples:[],patches:[]}});if(!['GET','HEAD'].includes(r.request().method()))return r.abort();return r.continue()});await p.goto('https://openclaw.blackcarburning.com/mygrain/');await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting);

await p.waitForTimeout(400);
assert.equal(await p.locator('[data-layer-enable-for]').count(),12);
for (const id of await p.locator('[data-layer-enable-for]').evaluateAll(bs=>bs.map(b=>b.dataset.layerEnableFor))) {
 const original=p.locator('#'+id),proxy=p.locator('[data-layer-enable-for="'+id+'"]');
 const before=await original.getAttribute('aria-pressed');
 await proxy.evaluate(b=>b.click());await p.waitForTimeout(40);
 assert.notEqual(await original.getAttribute('aria-pressed'),before,id);
 assert.equal(await proxy.getAttribute('aria-pressed'),await original.getAttribute('aria-pressed'));
 await original.evaluate(b=>b.click());await p.waitForTimeout(40);
 assert.equal(await proxy.getAttribute('aria-pressed'),before);
}
for(const name of ['Piano','Strings']) {
 const key=name.toLowerCase();
 await p.locator('#performanceLayer'+name+'Btn').evaluate(b=>b.click());
 assert.equal(await p.evaluate(k=>getKeyboardSampleSoloGain(k),key),0);
 const persisted=await p.evaluate(()=>{saveState();return JSON.parse(localStorage.getItem(STATE_STORAGE_KEY)).modes.keyboardInstrumentEnabled;});
 assert.equal(persisted[key],false);
 assert.equal(await p.evaluate(k=>gatherPreset().keyboardInstrumentEnabled[k],key),false);
 await p.evaluate(k=>{keyboardInstrumentEnabled[k]=true;restoreState();},key);
 assert.equal(await p.evaluate(k=>getKeyboardSampleSoloGain(k),key),0);
 await p.locator('#performanceLayer'+name+'Btn').evaluate(b=>b.click());
 assert.equal(await p.evaluate(k=>getKeyboardSampleSoloGain(k),key),1);
 await p.locator('#performanceLayer'+name+'SoloBtn').evaluate(b=>b.click());
 assert.equal(await p.locator('#performanceLayer'+name+'SoloBtn').getAttribute('aria-pressed'),'true');
 assert.equal(await p.evaluate(()=>getLoopLayerSoloGain('bastarda')),0);
 await p.locator('#performanceLayer'+name+'SoloBtn').evaluate(b=>b.click());
 await p.locator('#performanceLayer'+name+'JumpBtn').evaluate(b=>b.click());
 await p.waitForTimeout(800);
 assert.equal(await p.evaluate(()=>keyboardSoundSource),key);
}
for(const width of [390,844]){await p.setViewportSize({width,height:width===390?844:390});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
assert.deepEqual(errors,[]);console.log('PASS',engine,'12 synchronized card toggles, piano/strings mute/solo/jump, portrait/landscape');
await c.close();}finally{await b.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
