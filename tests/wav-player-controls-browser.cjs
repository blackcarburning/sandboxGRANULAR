'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19073/mygrain/';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
function wav(){const rate=44100,n=rate*3,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(4096,44+i*2);return b;}
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{for(const phone of [false,true]){
  const context=await browser.newContext({viewport:{width:phone?390:1440,height:960},isMobile:phone,hasTouch:phone,...phone?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{}});
  assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'wav-loop-test'}})).status(),200);
  const p=await context.newPage(),errors=[],loads=[];p.on('pageerror',e=>errors.push(e.message));
  let failOriginal=false;
  await p.route('**/*',async r=>{
   const u=new URL(r.request().url());if(u.origin!==new URL(base).origin)return r.abort();
   if(u.pathname==='/mygrain-wavs/api/list')return r.fulfill({json:{ok:true,files:['one.wav','two.wav'].map(name=>({name,url:'/mygrain-wavs/'+name,size:wav().length,modified:1}))}});
   if(u.pathname.startsWith('/mygrain-wavs/')&&u.pathname.endsWith('.wav')||u.pathname.startsWith('/mygrain/api/wav-preview')){
    loads.push(u.pathname);await new Promise(resolve=>setTimeout(resolve,180));
    if(failOriginal&&u.pathname.startsWith('/mygrain-wavs/'))return r.fulfill({status:503,body:'Unavailable'});
    const body=wav(),range=r.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    if(range){const first=Number(range[1]),last=range[2]?Math.min(body.length-1,Number(range[2])):body.length-1;return r.fulfill({status:206,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes','Content-Range':`bytes ${first}-${last}/${body.length}`},body:body.subarray(first,last+1)});}
    return r.fulfill({contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'},body});
   }
   return r.continue();
  });
  await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();
  await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
  await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});openWavRepositoryBrowser();});
  await p.waitForFunction(()=>document.querySelectorAll('#wavRepositoryBrowserList .wav-iphone-preview').length===2);
  const row=p.locator('#wavRepositoryBrowserList .wav-iphone-preview').first(),play=row.locator('.wav-preview-play'),loop=row.locator('.wav-preview-loop'),seek=row.locator('input');
  const geometry=()=>row.evaluate(e=>[...e.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect(),parent=e.getBoundingClientRect();return{x:r.x-parent.x,y:r.y-parent.y,width:r.width,height:r.height};}));
  const before=await geometry();assert(before.every(b=>b.width===108));
  const stable=async()=>{
   assert(await play.isVisible());assert(await loop.isVisible());assert(await seek.isVisible());
   assert.equal(await p.locator('#wavRepositoryBrowserList audio:visible').count(),0);
   assert.deepEqual(await geometry(),before);
   assert(await p.locator('#wavRepositoryBrowserList audio').evaluateAll(a=>a.every(x=>!x.controls)));
  };
  assert.equal(loads.length,0);await stable();
  await play.click();if(phone){await p.waitForFunction(()=>document.querySelector('#wavRepositoryBrowserList .wav-preview-play').textContent==='Loading…');await stable();}
  await p.waitForFunction(()=>document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview.playing);
  await p.waitForFunction(()=>Number(document.querySelector('#wavRepositoryBrowserList .wav-iphone-preview input').value)>.05);
  assert.equal(await play.textContent(),'Pause');assert.equal(await play.getAttribute('aria-label'),'Pause one.wav');await stable();
  if(!phone)assert(await p.evaluate(()=>!document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview.buffer),'normal desktop Play must keep native streaming');
  await play.click();await p.waitForFunction(()=>!document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview.playing);await stable();
  await seek.evaluate(el=>{el.value='.8';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await p.waitForFunction(()=>Math.abs(Number(document.querySelector('#wavRepositoryBrowserList .wav-iphone-preview input').value)-.8)<.05,{},{timeout:3000}).catch(async error=>{throw Error(error.message+' '+JSON.stringify(await p.evaluate(()=>{const a=document.querySelector('#wavRepositoryBrowserList audio'),s=document.querySelector('#wavRepositoryBrowserList .wav-iphone-preview input');return{value:s.value,max:s.max,currentTime:a.currentTime,duration:a.duration,paused:a.paused,seeking:a.seeking,error:a.error?.message};})));});
  const requestCount=loads.length;await play.click();await p.waitForFunction(()=>document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview.playing);
  assert.equal(loads.length,requestCount,'replay retains the existing stream/buffer');await stable();
  await loop.click();await p.waitForFunction(()=>document.querySelector('#wavRepositoryBrowserList .wav-preview-play').textContent==='Loading…');await stable();
  await p.waitForFunction(()=>document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview.source?.loop);
  await stable();assert.equal(await loop.getAttribute('aria-pressed'),'true');
  await loop.click();assert.equal(await loop.getAttribute('aria-pressed'),'false');await stable();
  // Turning Loop back on must not turn a running decoded source into Pause.
  await loop.click();assert(await p.evaluate(()=>document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview.playing));await stable();
  await play.click();assert.equal(await play.textContent(),'Play');await stable();
  await play.click();await stable();
  if(process.env.MYGRAIN_PREVIEW_EVIDENCE)await p.screenshot({path:process.env.MYGRAIN_PREVIEW_EVIDENCE+'/'+engine+'-'+(phone?'phone':'desktop')+'.png'});
  await p.locator('#wavRepositoryBrowserList .wav-iphone-preview').nth(1).locator('.wav-preview-play').click();
  await p.waitForFunction(()=>document.querySelectorAll('#wavRepositoryBrowserList audio')[1].__mygrainIphonePreview.playing);
  assert(await p.evaluate(()=>{const a=document.querySelector('#wavRepositoryBrowserList audio');return !a.__mygrainIphonePreview.playing&&!a.__mygrainIphonePreview.buffer&&a.paused;}));
  await p.evaluate(()=>{window.retired=[...document.querySelectorAll('#wavRepositoryBrowserList audio')];closeWavRepositoryBrowser();});
  assert(await p.evaluate(()=>retired.every(a=>a.paused&&!a.__mygrainIphonePreview.source&&!a.__mygrainIphonePreview.buffer)));
  await p.evaluate(()=>openWavRepositoryBrowser());await play.waitFor();failOriginal=true;
  await loop.click();if(phone)await play.click();
  await p.waitForFunction(()=>document.getElementById('wavRepositoryBrowserStatus').textContent.includes('503'));
  assert.equal(await play.textContent(),'Play');await stable();failOriginal=false;
  await loop.click();if(phone)await play.click();await p.waitForFunction(()=>document.querySelector('#wavRepositoryBrowserList audio').__mygrainIphonePreview.playing);
  await p.evaluate(()=>window.dispatchEvent(new Event('mygrain-account-lock')));
  assert(await p.evaluate(()=>[...document.querySelectorAll('#wavRepositoryBrowserList audio')].every(a=>a.paused&&!a.__mygrainIphonePreview.source&&!a.__mygrainIphonePreview.buffer)));
  assert.deepEqual(errors,[]);console.log('PASS',engine,phone?'phone':'desktop','stable Play/Pause + Loop + timeline, native streaming, seamless promotion, seek/replay, exclusivity, close/error/lock');await context.close();
 }}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
