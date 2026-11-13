'use strict';
// Public downloads plus authenticated UI against a dedicated local account store.
const {chromium}=require('playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const task=process.env.MYGRAIN_MAC_TASK||fs.readFileSync('/tmp/mygrain-macos-task-path','utf8').trim(),out=task+'/evidence',base='https://openclaw.blackcarburning.com/mygrain/';
const files=['mygrain-bridge-macos-0.5.0.zip','mygrain-fx-macos-0.1.0.zip'],sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const http=[],downloads=[];
 for(const name of ['daw-bridge.js','daw-fx.js','vst3-setup.html',...files]){
  const r=await fetch(base+name+'?verify=mac-vst3-1'),body=Buffer.from(await r.arrayBuffer()),expected=fs.readFileSync('sandboxGRANULAR/'+name);
  assert.equal(r.status,200,name);assert.deepEqual(body,expected,name);
  if(name.endsWith('.zip')){assert.match(r.headers.get('content-disposition'),new RegExp('attachment;.*'+name.replaceAll('.','\\.')));assert.match(r.headers.get('content-type'),/zip|octet-stream/);}
  http.push({name,status:r.status,bytes:body.length,sha256:sha(body),disposition:r.headers.get('content-disposition')});
 }
 for(const name of ['mygrain-bridge-windows-0.5.0.zip','mygrain-fx-windows-0.1.0.zip']){
  const r=await fetch(base+name);assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),fs.readFileSync('sandboxGRANULAR/'+name));
 }
 assert.notEqual((await fetch(base+'vst3/src/editor_mac.inc')).status,200);
 const downloadsPath='/root/snap/chromium/common/mygrain-mac-download-'+Date.now();fs.mkdirSync(downloadsPath,{recursive:true});
 const browser=await chromium.launch({executablePath:'/snap/bin/chromium',downloadsPath,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 async function download(page,selector,file,label){
  const [d]=await Promise.all([page.waitForEvent('download'),page.locator(selector+' a[download][href="'+file+'"]').click()]);
  assert.equal(d.suggestedFilename(),file);const path=out+'/'+label+'-'+file;await d.saveAs(path);assert.equal(await d.failure(),null);
  const bytes=fs.readFileSync(path);assert.deepEqual(bytes,fs.readFileSync('sandboxGRANULAR/'+file));downloads.push({label,file,sha256:sha(bytes)});
 }
 try{
  const p=await browser.newPage({acceptDownloads:true,viewport:{width:1450,height:1100}});await p.goto(base+'vst3-setup.html#mac');
  for(const file of files)await download(p,'#mac',file,'public-setup');await p.locator('#mac').screenshot({path:out+'/published-mac-setup.png'});
  const c=await browser.newContext({acceptDownloads:true,viewport:{width:1450,height:1100}}),local='http://127.0.0.1:19109/mygrain/';
  assert.equal((await c.request.post(local+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
  const q=await c.newPage(),errors=[];q.on('pageerror',e=>errors.push(e.message));const response=await q.goto(local);assert.equal(response.headers()['x-mygrain-isolated-test'],'mac-19109');
  await q.waitForFunction(()=>window.mygrainDawBridge&&window.mygrainDawFx&&document.documentElement.dataset.mygrainStartup==='ready');
  await q.locator('#start-btn').click();await q.waitForFunction(()=>isAudioGraphReady()&&!engineStarting);await q.locator('#dawBridgeCard').evaluate(e=>e.open=true);await q.locator('#dawInputCard').evaluate(e=>e.open=true);
  for(const file of files)await download(q,'#dawBridgeCard',file,'bridge-card');await download(q,'#dawInputCard',files[1],'fx-card');assert.deepEqual(errors,[]);
 }finally{await browser.close();}
 fs.writeFileSync(out+'/published-downloads.json',JSON.stringify({http,downloads,retainedWindows:true,protectedSource:true},null,2));
 console.log('PASS exact HTTPS bytes/attachment headers, both Mac setup downloads, both Mac Bridge-card downloads, FX-card download, retained Windows and protected native sources');
})().catch(e=>{console.error(e);process.exitCode=1;});
