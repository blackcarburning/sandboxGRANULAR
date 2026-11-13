'use strict';
// Read-only public verification + authenticated UI only in the isolated fixture.
const {chromium}=require('playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const task=fs.readFileSync('/tmp/mygrain-vst3-live-output','utf8').trim(),stage=path.join(task,'stage'),out=path.join(task,'evidence');
const origin='https://openclaw.blackcarburning.com',base=origin+'/mygrain/',file='mygrain-bridge-windows-0.5.0.zip',bytes=fs.readFileSync(path.join(stage,file));
const sha=body=>crypto.createHash('sha256').update(body).digest('hex');
(async()=>{
 const http=[];
 for(const name of ['daw-bridge.js','daw-bridge.css','daw-bridge-worker.js','vst3-setup.html',file]){
  const r=await fetch(base+name+'?verify=vst3-stable-5'),body=Buffer.from(await r.arrayBuffer());assert.equal(r.status,200,name);assert.deepEqual(body,fs.readFileSync(path.join(stage,name)),name);
  if(name===file){assert.match(r.headers.get('content-disposition'),/attachment;.*mygrain-bridge-windows-0\.5\.0\.zip/);assert.match(r.headers.get('content-type'),/zip|octet-stream/);}
  http.push({name,status:r.status,bytes:body.length,sha256:sha(body),contentDisposition:r.headers.get('content-disposition')});
 }
 for(const name of ['mygrain-bridge-windows-0.1.0.zip','mygrain-bridge-windows-0.2.0.zip','mygrain-bridge-windows-0.3.0.zip','mygrain-bridge-windows-0.4.0.zip']){
  const r=await fetch(base+name),body=Buffer.from(await r.arrayBuffer());assert.equal(r.status,200);assert.deepEqual(body,fs.readFileSync(path.join(task,'before',name)));assert.match(r.headers.get('content-disposition'),/attachment/);
 }
 const protectedResponse=await fetch(base+'vst3/src/core.h');assert.notEqual(protectedResponse.status,200);
 const downloadsPath='/root/snap/chromium/common/mygrain-vst3-live-download-'+Date.now();fs.mkdirSync(downloadsPath,{recursive:true});
 const browser=await chromium.launch({executablePath:'/snap/bin/chromium',downloadsPath,args:['--no-sandbox']});
 const saved=[];
 async function download(page,label){
  const [d]=await Promise.all([page.waitForEvent('download'),page.locator('a[download]').filter({hasText:'0.5.0'}).click()]);
  assert.equal(d.suggestedFilename(),file);const destination=path.join(out,label+'-download.zip');await d.saveAs(destination);assert.equal(await d.failure(),null);assert.deepEqual(fs.readFileSync(destination),bytes);saved.push({label,filename:d.suggestedFilename(),sha256:sha(fs.readFileSync(destination))});
 }
 try{
  const p=await browser.newPage({acceptDownloads:true});await p.goto(base+'vst3-setup.html');await download(p,'public-setup');
 }finally{await browser.close();}
 // Use trusted loopback HTTP for this fixture-only link click. Chrome cancels
 // downloads from the self-signed TLS fixture even with context TLS exceptions.
 // The public HTTPS download above is exercised without any TLS exceptions.
 const isolated=await chromium.launch({executablePath:'/snap/bin/chromium',downloadsPath,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 try{
  const c=await isolated.newContext({acceptDownloads:true,viewport:{width:1440,height:1100}}),local='http://127.0.0.1:19109';
  assert.equal((await c.request.post(local+'/mygrain/api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
  const p=await c.newPage(),response=await p.goto(local+'/mygrain/');assert.equal(new URL(response.url()).origin,local);assert.equal(response.status(),200);
  await p.waitForFunction(()=>window.mygrainDawBridge&&document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady());
  await p.locator('#dawBridgeCard').evaluate(el=>el.open=true);assert.equal(await p.locator('#dawBridgeMode').inputValue(),'live');
  await download(p,'desktop-card');await p.locator('#dawBridgeCard').screenshot({path:path.join(out,'published-live-mode-card.png')});
 }finally{await isolated.close();}
 fs.writeFileSync(path.join(out,'public-downloads.json'),JSON.stringify({http,downloads:saved,protectedSourceStatus:protectedResponse.status},null,2));
 console.log('PASS actual HTTPS bytes/attachment, retained old ZIPs, protected source and real public + desktop browser downloads',JSON.stringify(saved));
})().catch(e=>{console.error(e);process.exitCode=1;});
