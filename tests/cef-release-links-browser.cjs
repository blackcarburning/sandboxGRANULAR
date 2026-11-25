'use strict';
// Public setup downloads plus account-isolated frontend navigation. No production account writes.
const {chromium,webkit}=require('playwright-core'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const base='https://openclaw.blackcarburning.com/mygrain/',app=path.resolve(process.env.MYGRAIN_RELEASE_APP||path.join(__dirname,'..')),out=path.resolve(process.env.MYGRAIN_RELEASE_EVIDENCE||'/tmp/mygrain-cef-release-links');
const live=process.env.MYGRAIN_RELEASE_LIVE==='1',downloads=process.env.MYGRAIN_RELEASE_DOWNLOADS==='1',fx='0.1.2',instrument='0.1.6';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const changed=new Set(['cef-setup.html','cef-fx-setup.html','vst3-setup.html','daw-bridge.js','daw-fx.js']);
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const rows=[];
 for(const engine of (process.env.ENGINE?[process.env.ENGINE]:['chromium','webkit'])){
  const browser=await({chromium,webkit}[engine]).launch(engine==='chromium'?{executablePath:'/snap/chromium/current/usr/lib/chromium-browser/chrome',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
  try{
   const context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900}}),p=await context.newPage();
   if(!live)await p.route('**/*',async r=>{const u=new URL(r.request().url()),n=u.pathname.replace('/mygrain/','');if(u.origin===new URL(base).origin&&changed.has(n))return r.fulfill({contentType:n.endsWith('.js')?'text/javascript':'text/html',body:fs.readFileSync(path.join(app,n))});return r.continue();});
   for(const pageName of ['cef-setup.html','cef-fx-setup.html','vst3-setup.html']){
    const response=await p.goto(base+pageName);assert.equal(response.status(),200);
    assert.deepEqual(await response.body(),fs.readFileSync(path.join(app,pageName)),'exact deployed page '+pageName);
    const links=await p.locator('a').evaluateAll(nodes=>nodes.map(a=>({text:a.textContent,href:a.getAttribute('href')})));
    for(const a of links){
     if(a.href==='cef-setup.html')assert.match(a.text,new RegExp(instrument.replaceAll('.','\\.')));
     if(a.href==='cef-fx-setup.html')assert.match(a.text,new RegExp(fx.replaceAll('.','\\.')));
     if(/^mygrain-cef-(windows|macos)-/.test(a.href))assert(a.href.endsWith('-'+instrument+'.zip'));
     if(/^mygrain-cef-fx-(windows|macos)-/.test(a.href))assert(a.href.endsWith('-'+fx+'.zip'));
    }
    if(engine==='chromium'&&downloads&&pageName!=='vst3-setup.html'){
     for(const selector of (pageName==='cef-setup.html'?['#cefWindows','#cefMac']:['#cefFxWindows','#cefFxMac'])){
      const a=p.locator(selector),name=path.basename(await a.getAttribute('href'));
      const pending=p.waitForEvent('download',{timeout:180000});await a.click();const d=await pending;
      assert.equal(d.suggestedFilename(),name);const target=path.join(out,name);await d.saveAs(target);assert.equal(await d.failure(),null);
      const bytes=fs.readFileSync(target);assert.deepEqual(bytes,fs.readFileSync(path.join(app,name)));
      rows.push({engine,pageName,selector,filename:name,bytes:bytes.length,sha256:sha(bytes),actualBrowserDownload:true});
     }
    }
    rows.push({engine,pageName,exactBytes:true,links});
   }
   // Render the full editor with a synthetic identity. Intercept all backend requests,
   // and never provide production credentials or allow a production account write.
   await p.route('**/*',async r=>{
    const u=new URL(r.request().url()),n=u.pathname.replace(/^\/mygrain\/?/,'')||'index.html';
    if(u.origin!==new URL(base).origin)return r.abort();
    if(n==='account-context.js')return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"cef-release-link-fixture"}};'});
    if(n.startsWith('api/')||/\/api\//.test(u.pathname))return r.fulfill({status:r.request().method()==='GET'?200:403,contentType:'application/json',body:JSON.stringify({ok:true,authenticated:true,user:{username:'cef-release-link-fixture'},revision:0,patches:[],items:[],files:[],folders:[],songs:[],parts:[],presets:[],favourites:[],favorites:[],sources:[],libraries:[],jobs:[]})});
    if(n==='index.html'||(!live&&changed.has(n)))return r.fulfill({contentType:n.endsWith('.js')?'text/javascript':'text/html',body:fs.readFileSync(path.join(app,n))});
    return r.continue();
   });
   const errors=[];p.on('pageerror',e=>{errors.push(e.stack);console.error(e.stack);});
   await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready'&&window.mygrainDawFx&&window.mygrainDawBridge,null,{timeout:90000});
   if(await p.locator('#start-btn').isVisible())await p.locator('#start-btn').click();
   await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended,null,{timeout:90000});
   for(const id of ['dawBridgeCard','dawInputCard']){
    await p.locator('#'+id).evaluate(e=>{window.mygrainDisplay?.reveal(e);e.open=true;});
    const links=await p.locator('#'+id+' a').evaluateAll(nodes=>nodes.map(a=>({text:a.textContent,href:a.getAttribute('href')})));
    for(const a of links.filter(a=>a.href.includes('cef'))){
     const version=a.href.includes('cef-fx')?fx:instrument;
     assert(a.text.includes(version),id+' stale label '+JSON.stringify(a));
     if(a.href.endsWith('.zip'))assert(a.href.endsWith('-'+version+'.zip'),id+' stale destination');
    }
    assert.equal(links.filter(a=>/^mygrain-cef-fx-(windows|macos)-/.test(a.href)).length,2);
    if(id==='dawBridgeCard')assert.equal(links.filter(a=>/^mygrain-cef-(windows|macos)-/.test(a.href)).length,2);
    await p.locator('#'+id+' a[href^="mygrain-cef-"]').first().scrollIntoViewIfNeeded();assert(await p.locator('#'+id+' a[download]').first().isVisible());await p.screenshot({path:path.join(out,engine+'-'+id+'.png')});
    rows.push({engine,accountIsolated:true,id,links});
   }
   assert.deepEqual(errors,[]);
  }finally{await browser.close();}
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({live,downloads,rows},null,2));
 console.log('PASS setup labels, exact page bytes and full account-isolated runtime download cards'+(downloads?'; actual setup-button downloads byte-exact':''));
})().catch(e=>{console.error(e);process.exitCode=1;});
