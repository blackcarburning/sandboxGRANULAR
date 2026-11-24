'use strict';
// Isolated account or read-only live session; every MIDI mutation/file is synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:19351/mygrain/';
const out = process.env.OUT || '/tmp/mygrain-midi-dialog-tests';
fs.mkdirSync(out, {recursive:true});
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const auth = process.env.MYGRAIN_LIVE_AUTH ? JSON.parse(fs.readFileSync(0,'utf8')) : null;
 if (!auth) assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
 const results=[];
 for (const [engine,type] of Object.entries({chromium,webkit})) {
  const downloadsPath=path.join(out,engine+'-downloads');fs.mkdirSync(downloadsPath,{recursive:true});
  const browser=await type.launch(engine==='chromium'?{downloadsPath,executablePath:'/snap/chromium/current/usr/lib/chromium-browser/chrome',args:['--no-sandbox','--disable-dev-shm-usage']}:{downloadsPath});
  try {
   const context=await browser.newContext({acceptDownloads:true,viewport:{width:390,height:844},hasTouch:true,isMobile:true});
   if(auth) await context.addCookies([{name:auth.cookie,value:auth.token,domain:new URL(base).hostname,path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
   else assert((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-midi-test'}})).ok());
   const p=await context.newPage(), errors=[],native=[],uploads=[],renames=[];let midiBytes=null,failUpload=false,failDownload=false,fileGets=0,downloadEvents=0;
   p.setDefaultTimeout(60000);
   p.on('pageerror',e=>errors.push(e.message));
   p.on('dialog',async d=>{native.push(d.type());await d.dismiss();});
   p.on('download',()=>downloadEvents++);
   await p.route('**/*',async r=>{
    const req=r.request(),u=new URL(req.url());
    if(u.origin!==new URL(base).origin)return r.abort();
    if(process.env.BASELINE && ['/mygrain/','/mygrain/index.html'].includes(u.pathname))return r.fulfill({contentType:'text/html',body:fs.readFileSync(process.env.BASELINE)});
    if(u.pathname.startsWith('/mygrain-midi/')){
     if(u.pathname.endsWith('/api/upload')){
      const bytes=req.postDataBuffer()||Buffer.from(await p.evaluate(()=>window.__midiUploadPayload));
      uploads.push({name:u.searchParams.get('filename'),bytes});
      if(failUpload)return r.fulfill({status:503,json:{ok:false,error:'Synthetic upload failure'}});
      midiBytes=bytes;return r.fulfill({json:{ok:true,savedName:u.searchParams.get('filename')}});
     }
     if(u.pathname.endsWith('/api/rename')){renames.push(req.postDataJSON());return r.fulfill({json:{ok:true,savedName:req.postDataJSON().to}});}
     if(u.pathname.endsWith('/api/list'))return r.fulfill({json:{ok:true,files:midiBytes?[{name:'fixture.mid',url:new URL('/mygrain-midi/fixture.mid',base).href,size:midiBytes.length}]:[]}});
     if(u.pathname.endsWith('/fixture.mid')){fileGets++;return failDownload?r.fulfill({status:503,body:'Synthetic download failure'}):r.fulfill({contentType:'audio/midi',body:midiBytes});}
     return r.fulfill({json:{ok:true}});
    }
    if(!['GET','HEAD'].includes(req.method()))return r.abort();
    return r.continue();
   });
   await p.addInitScript(()=>{
    // WebKit CDP omits Blob request bodies; observe the real upload Blob at
    // the network boundary without altering it or the product's save functions.
    const originalFetch=window.fetch;
    window.fetch=async function(resource,options){
     const url=resource instanceof Request?resource.url:String(resource);
     if(url.includes('/mygrain-midi/api/upload')) {
      const body=resource instanceof Request?await resource.clone().arrayBuffer():await options.body.arrayBuffer();
      window.__midiUploadPayload=Array.from(new Uint8Array(body));
     }
     return originalFetch.call(this,resource,options);
    };
    window.__nativePickers=0;
    window.showSaveFilePicker=async()=>{__nativePickers++;throw Error('Unexpected OS save picker');};
    Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{__nativePickers++;throw Error('Unexpected share sheet');}});
   });
   await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');
   if(auth){const response=await context.request.get(base);assert.equal(response.status(),200);assert((await response.body()).equals(fs.readFileSync('sandboxGRANULAR/index.html')),'exact live authenticated HTML');}
   await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   await p.evaluate(()=>{
    stopAllPerformancePlayback({silent:true});
    bastardLoopLSequence[0]={note:'C4',rest:false,velocity:100};bastardLoopXSequence[0]={note:'D4',rest:false,velocity:100};drumMachineKickPattern[0]=true;
   });
   const rows=[];
   const choice=()=>p.locator('#exportSaveDialog');
   async function click(selector){assert.equal(await p.locator(selector).count(),1,selector);await p.locator(selector).evaluate(el=>{mygrainDisplay.reveal(el.closest('.performance-feature-card,section[id]')||el);el.scrollIntoView({block:'center',behavior:'instant'});});await p.locator(selector).tap();}
   const exportCases=[['L','#performanceBastardLoopLExportMidiBtn'],['X','#performanceBastardLoopXExportMidiBtn'],['drums','#performanceDrumMachineMidiExportBtn']];
   for(const[label,selector]of exportCases){
    await click(selector);
    if(process.env.BASELINE){await p.waitForTimeout(200);assert.deepEqual(native,[],'MIDI export must not invoke native prompt');}
    await choice().waitFor({state:'visible'});assert.equal(await p.locator('#exportSaveSnapshot').count(),0);
    await choice().getByRole('button',{name:'Cancel',exact:true}).tap();await p.waitForFunction(sel=>!document.querySelector(sel).disabled,selector);assert.equal(uploads.length,rows.length);
    await click(selector);await choice().waitFor({state:'visible'});await p.locator('#exportSaveName').fill('   ');await choice().getByRole('button',{name:'Save MIDI',exact:true}).tap();assert(await choice().isVisible());assert.equal(uploads.length,rows.length);
    await p.locator('#exportSaveName').fill('Shared MIDI '+label+'.midi');await choice().getByRole('button',{name:'Save MIDI',exact:true}).tap();await p.waitForFunction(sel=>!document.querySelector(sel).disabled,selector);
    assert.equal(uploads.length,rows.length+1);const upload=uploads.at(-1);assert.equal(upload.name,'Shared-MIDI-'+label+'.mid');assert.equal(upload.bytes.subarray(0,4).toString(),'MThd');assert(upload.bytes.includes(Buffer.from('MTrk')));
    rows.push({label,filename:upload.name,bytes:upload.bytes.length,sha256:hash(upload.bytes)});
   }
   // Escape and account transitions must abandon choices without uploads.
   for(const action of ['escape','mygrain-account-lock','mygrain-account-changed']){
    const count=uploads.length;await click(exportCases[0][1]);await choice().waitFor({state:'visible'});
    if(action==='escape')await p.keyboard.press('Escape');else await p.evaluate(name=>window.dispatchEvent(new Event(name)),action);
    await choice().waitFor({state:'detached'});assert.equal(uploads.length,count);await p.waitForFunction(()=>!document.querySelector('#performanceBastardLoopLExportMidiBtn').disabled);
   }
   // Fetch/upload rejection must unlock the real button and permit retry.
   failUpload=true;const uploadCount=uploads.length;await click(exportCases[2][1]);await choice().waitFor({state:'visible'});await choice().getByRole('button',{name:'Save MIDI',exact:true}).tap();await p.waitForFunction(()=>!document.querySelector('#performanceDrumMachineMidiExportBtn').disabled);assert.equal(uploads.length,uploadCount+1);failUpload=false;
   // Real MIDI Browser download button, cancel before fetch, and unchanged bytes.
   await p.evaluate(()=>openMidiRepositoryBrowser());
   const download=()=>p.locator('#midiRepositoryBrowserList').getByRole('button',{name:'Download MIDI',exact:true});
   assert.equal(await download().count(),1);await download().tap();await choice().waitFor({state:'visible'});await choice().getByRole('button',{name:'Cancel',exact:true}).tap();assert.equal(fileGets,0);assert.equal(downloadEvents,0);
   const downloads=[];
   for(let i=0;i<2;i++){
    await download().tap();await choice().waitFor({state:'visible'});await p.locator('#exportSaveName').fill('My downloaded notes.mid');
    const pending=p.waitForEvent('download');await choice().getByRole('button',{name:'Download MIDI',exact:true}).tap();const d=await pending;
    assert.equal(d.suggestedFilename(),'My-downloaded-notes.mid');const dest=path.join(out,engine+'-midi-'+i+'.mid');await d.saveAs(dest);assert.equal(await d.failure(),null);assert.deepEqual(fs.readFileSync(dest),midiBytes);downloads.push({filename:d.suggestedFilename(),sha256:hash(fs.readFileSync(dest)),bytes:midiBytes.length});
   }
   // Failed fetch does not emit a download and leaves its button reusable.
   failDownload=true;await download().tap();await choice().waitFor({state:'visible'});const count=downloadEvents;await choice().getByRole('button',{name:'Download MIDI',exact:true}).tap();await p.waitForFunction(()=>document.querySelector('#midiRepositoryBrowserStatus').textContent.includes('Download failed'));assert.equal(downloadEvents,count);assert(await download().isEnabled());failDownload=false;
   const rename=()=>p.locator('#midiRepositoryBrowserList').getByRole('button',{name:'Rename MIDI',exact:true});await rename().tap();await choice().waitFor({state:'visible'});await choice().getByRole('button',{name:'Cancel',exact:true}).tap();assert.equal(renames.length,0);
   await rename().tap();await choice().waitFor({state:'visible'});await p.locator('#exportSaveName').fill('Renamed notes.mid');await choice().getByRole('button',{name:'Rename MIDI',exact:true}).tap();await p.waitForFunction(()=>!document.querySelector('#exportSaveDialog'));await p.waitForTimeout(100);assert.deepEqual(renames,[{from:'fixture.mid',to:'Renamed-notes.mid'}]);
   // Dialog fits phone/desktop and never exposes a native prompt or file picker.
   const layouts=[];for(const width of [390,1440]){await p.setViewportSize({width,height:844});await p.evaluate(()=>openMidiRepositoryBrowser());await download().waitFor({state:'visible'});await download().tap();await choice().waitFor({state:'visible'});const box=await choice().boundingBox();assert(box.x>=0&&box.x+box.width<=width+1);layouts.push({width,box});await p.screenshot({path:path.join(out,engine+'-midi-dialog-'+width+'.png')});await p.keyboard.press('Escape');}
   assert.deepEqual(native,[]);assert.equal(await p.evaluate(()=>__nativePickers),0);assert.deepEqual(errors,[]);
   results.push({engine,exports:rows,downloads,layouts,cancelEscapeAccountSafe:true,failureRetrySafe:true,renameAppDialog:true,nativeDialogs:0,nativePickers:0,errors});
   console.log('PASS',engine,'3 MIDI exports, cancel/blank/Escape/account safety, upload failure, 2 exact downloads, download failure, rename, phone/desktop');
  } finally {await browser.close();}
 }
 fs.writeFileSync(path.join(out,auth?'midi-dialog-live.json':'midi-dialog-browser.json'),JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
