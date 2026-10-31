'use strict';
const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright-core');
const base = 'http://127.0.0.1:18959';
function wav() {
 const rate=48000, frames=rate*6, b=Buffer.alloc(44+frames*6);
 b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*6,28);b.writeUInt16LE(6,32);b.writeUInt16LE(24,34);b.write('data',36);b.writeUInt32LE(frames*6,40);
 for(let i=0;i<frames;i++)for(let ch=0;ch<2;ch++)b.writeIntLE(Math.round(1600000*Math.sin(2*Math.PI*220*i/rate)),44+i*6+ch*3,3);
 return b;
}
(async()=>{for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
 try {
  const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6.1 Mobile/15E148 Safari/604.1'});
  assert((await c.request.post(base+'/mygrain/api/auth/login',{data:{username:'admin',password:'isolated-render-refresh-fixture'}})).ok());
  const name=`iphone-${engine}-${Date.now()}.wav`;
  assert((await c.request.post(base+'/mygrain-wavs/api/upload?filename='+name,{headers:{'X-Mygrain-User':'admin','Content-Type':'audio/wav'},data:process.env.MYGRAIN_IPHONE_TEST_WAV?require('node:fs').readFileSync(process.env.MYGRAIN_IPHONE_TEST_WAV):wav()})).ok());
  await c.addInitScript(()=>{window.__gains=[];const create=AudioContext.prototype.createGain;AudioContext.prototype.createGain=function(){const gain=create.call(this);__gains.push({context:this,gain});return gain;};});
  const p=await c.newPage(),errors=[],loads=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().includes('/mygrain-wavs/'+name)||r.url().includes('/api/wav-preview'))loads.push(r.url())});
  await p.goto(base+'/mygrain/');await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
  await p.evaluate(()=>openWavRepositoryBrowser());
  const list=p.locator('#wavRepositoryBrowserList'),card=list.locator('.sample-browser-card').filter({has:p.getByText(name,{exact:true})});await card.waitFor();
  // Real iPhone-only library player, not the hidden native audio widget.
  await card.locator('.wav-iphone-preview button').tap();
  await p.waitForFunction(n=>[...document.querySelectorAll('#wavRepositoryBrowserList .sample-browser-card')].find(c=>c.querySelector('.sample-browser-name').textContent===n)?.querySelector('audio').__mygrainIphonePreview.playing,name);
  await card.locator('.wav-iphone-preview button').tap();
  await card.getByRole('button',{name:'Master',exact:true}).tap();await p.locator('.live-legacy').tap();await p.locator('.mastering-live').waitFor({state:'detached'});const d=p.locator('.mastering-dialog');await d.locator('.mastering-preset').selectOption('dense');await d.locator('.mastering-target').selectOption('-6');await d.locator('.mastering-start').tap();
  await p.waitForFunction(()=>document.querySelector('.mastering-comparison')?.hidden===false||!document.querySelector('.mastering-start')?.disabled,null,{timeout:90000});assert.match(await d.locator('.mastering-status').textContent(),/^Saved /);
  assert.equal(await d.locator('.wav-iphone-preview').count(),2);assert.equal(await d.locator('audio:visible').count(),0);
  const player=d.locator('.wav-iphone-preview');
  async function checkPlaying(index) {
   await p.waitForFunction(i=>document.querySelectorAll('.mastering-dialog audio')[i].__mygrainIphonePreview?.playing,index);
   const evidence=await p.evaluate(async i=>{const a=document.querySelectorAll('.mastering-dialog audio')[i].__mygrainIphonePreview,ctx=a.source.context,an=ctx.createAnalyser();a.source.connect(an);await new Promise(r=>setTimeout(r,150));const pcm=new Float32Array(an.fftSize);an.getFloatTimeDomainData(pcm);an.disconnect();a.source.disconnect(an);return {peak:Math.max(...pcm.map(Math.abs)),time:ctx.currentTime};},index);
   assert(evidence.peak>.01,JSON.stringify(evidence));assert(evidence.time>0);
  }
  await player.nth(1).locator('button').tap();await checkPlaying(1);
  assert.equal(await p.evaluate(()=>__gains.filter(x=>x.context===document.querySelector('.mastering-result').__mygrainIphonePreview.source.context).at(-1).gain.gain.value),1);
  await d.locator('.mastering-match').check();
  await p.waitForFunction(()=>__gains.filter(x=>x.context===document.querySelector('.mastering-result').__mygrainIphonePreview.source.context).at(-1).gain.gain.value<1);
  await p.waitForFunction(()=>document.querySelector('.mastering-result').__mygrainIphonePreview.source.context.state==='running');
  await d.locator('.mastering-match').uncheck();
  await p.waitForFunction(()=>__gains.filter(x=>x.context===document.querySelector('.mastering-result').__mygrainIphonePreview.source.context).at(-1).gain.gain.value===1);
  let fail=true;await p.route('**/mygrain-wavs/'+name+'?*',route=>{if(fail){fail=false;return route.fulfill({status:503,body:'test failure'});}return route.continue();});
  await player.nth(0).locator('button').tap();await p.waitForFunction(()=>document.querySelector('.mastering-playback-status').textContent.includes('503'));assert.equal(await player.nth(0).locator('button').isEnabled(),true);
  await player.nth(0).locator('button').tap();await checkPlaying(0);
  assert.equal(await d.locator('.mastering-result').evaluate(a=>a.__mygrainIphonePreview.playing),false);
  await player.nth(0).locator('input').fill('1.5');await player.nth(0).locator('input').dispatchEvent('input');
  const before=loads.length;await player.nth(1).locator('button').tap();await checkPlaying(1);assert.equal(loads.length,before,'A/B reuses decoded WAV');
  for(const width of [390,844]) {await p.setViewportSize({width,height:width===390?844:390});const box=await d.boundingBox();assert(box.x>=0&&box.x+box.width<=width+1);}
  await p.setViewportSize({width:390,height:844});
  await p.evaluate(()=>{window.__comparisonApis=[...document.querySelectorAll('.mastering-dialog audio')].map(a=>a.__mygrainIphonePreview);window.__comparisonContext=__comparisonApis[1].source.context;});
  await d.getByRole('button',{name:'Close',exact:true}).tap();await d.waitFor({state:'detached'});
  await p.waitForFunction(()=>__comparisonContext.state==='closed'&&__comparisonApis.every(a=>!a.source&&!a.buffer));
  // An inherited main-list filter must not hide new masters; Close -> Masters refreshes.
  await p.evaluate(()=>{mygrainFavourites.state('wav').filter='nonexistent';document.getElementById('wavRepositoryBrowserFilter').value='unmatched-source';});
  await list.locator('.wav-library-sections').getByRole('button',{name:'Masters',exact:true}).tap();
  await p.waitForFunction(()=>document.querySelector('#wavRepositoryBrowserList .sample-browser-card[data-master-kind="waves"]'));
  assert.equal(await p.locator('#wavRepositoryBrowserFilter').inputValue(),'');
  await list.locator('.wav-master-kinds').getByRole('button',{name:'Reels',exact:true}).tap();assert.equal(await list.locator('.sample-browser-card[data-master-kind="waves"]').count(),0);
  await list.locator('.wav-master-kinds').getByRole('button',{name:'Waves',exact:true}).tap();assert(await list.locator('.sample-browser-card[data-master-kind="waves"]').count()>0);
  assert.deepEqual(errors,[]);console.log('PASS',engine,'iPhone UA: library 24-bit WAV, original/master PCM, nonzero audio, trusted taps, A/B cache, compensation, 390/844, cleanup, stale-list and filter regression');await c.close();
 } finally {await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
