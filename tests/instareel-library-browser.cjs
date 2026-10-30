'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18936/mygrain/';assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{let fixture;
 for(const [engine,type] of Object.entries(process.env.INSTAREEL_ENGINE==='webkit'?{webkit}:{chromium,webkit})){
  const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
  try{
   const reelName='Renamed '+engine+' '+Date.now();
   const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'instareel-fixture'}})).status(),200);
   const headers={'X-Mygrain-User':'admin'};
   if(!fixture)fixture=(await (await context.request.get(base+'api/instareel/library',{headers})).json()).reels[0];
   assert(fixture,'First run instareel-browser.cjs to create the real render fixture');
   const restored=await context.request.post(base+`api/instareel/${fixture.id}/save`,{headers,data:{name:'Library Fixture '+engine}});assert.equal(restored.status(),200);
   const original=await (await context.request.get(base+`api/instareel/library/${fixture.id}/wav`,{headers})).body();
   await page.goto(base);await page.waitForFunction(()=>window.mygrainInstareel&&window.mygrainFtp&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);
   await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
   await page.locator('#sectionJumpHandle').tap();await page.locator('.section-jump-option[data-jump-target="#genreatorCard"]').tap();
   await page.evaluate(()=>window.libraryOriginal=JSON.stringify(saveState({force:true,snapshotOnly:true}),(k,v)=>k==='timestamp'?undefined:v));
   await page.locator('#instareelLibrary summary').tap();let row=page.locator('.instareel-library-row').first();await row.waitFor();
   await row.getByRole('button',{name:'Rename',exact:true}).tap();await row.getByRole('textbox',{name:'New reel name'}).fill(reelName);await row.getByRole('button',{name:'Save name',exact:true}).tap();
   await page.waitForFunction(name=>document.getElementById('instareelStatus').textContent===`Renamed to ${name}.`,reelName);
   const renamed=(await (await context.request.get(base+'api/instareel/library',{headers})).json()).reels[0];assert.equal(renamed.name,reelName);assert(renamed.filename.startsWith('INSTAREEL-'+reelName+'-'));
   assert(original.equals(await (await context.request.get(base+`api/instareel/library/${fixture.id}/wav`,{headers})).body()));
   const normal=await context.request.get(new URL('/mygrain-wavs/api/list?refresh=1',base).href,{headers});assert.equal(normal.status(),200);assert(!(await normal.json()).files.some(f=>f.name===renamed.filename||f.name===fixture.filename),'Saved reels must not appear in the normal WAV browser');
   // Cancelled folder selection does not upload or delete anything.
   row=page.locator('.instareel-library-row').first();await row.getByRole('button',{name:'Upload to FTP',exact:true}).tap();await page.locator('dialog.ftp-picker').getByRole('button',{name:'Cancel',exact:true}).tap();
   await row.getByRole('button',{name:'Upload to FTP',exact:true}).tap();await page.locator('dialog.ftp-picker').getByRole('button',{name:'Use this folder',exact:true}).tap();await page.waitForFunction(()=>document.getElementById('instareelStatus').textContent.startsWith('Uploaded '));
   const listing=await (await context.request.get(base+'api/ftp/list?path=',{headers})).json(),uploaded=listing.entries.find(r=>r.name===renamed.filename);assert(uploaded);
   const download=await context.request.get(base+'api/ftp/file?'+new URLSearchParams({path:uploaded.path}),{headers});assert.equal(download.status(),200);assert(original.equals(await download.body()),'FTP copy must retain exact rendered WAV bytes');
   await row.getByRole('button',{name:'Upload to FTP',exact:true}).tap();await page.locator('dialog.ftp-picker').getByRole('button',{name:'Use this folder',exact:true}).tap();await page.waitForFunction(()=>/exist|overwrit/i.test(document.getElementById('instareelStatus').textContent));assert(await row.getByRole('button',{name:'Upload to FTP',exact:true}).isEnabled());
   await row.getByRole('button',{name:'Preview',exact:true}).tap();await page.waitForFunction(()=>mygrainInstareel.player.playing);
   page.once('dialog',dialog=>dialog.dismiss());await row.getByRole('button',{name:'Delete',exact:true}).tap();assert.equal(await row.count(),1);assert(await page.evaluate(()=>mygrainInstareel.player.playing));
   for(const viewport of [{width:390,height:844},{width:844,height:390}]){
    await page.setViewportSize(viewport);
    // Reopen the visible section through normal navigation after viewport rotation.
    await page.locator('#sectionJumpHandle').tap();await page.locator('.section-jump-option[data-jump-target="#genreatorCard"]').tap();
    await row.evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    for(const name of ['Preview','Download WAV','Rename','Delete','Upload to FTP'])await row.getByRole('button',{name,exact:true}).waitFor({state:'visible',timeout:10000});
   }
   if(process.env.MYGRAIN_INSTAREEL_EVIDENCE)await page.screenshot({path:process.env.MYGRAIN_INSTAREEL_EVIDENCE+'/'+engine+'-library.png'});
   page.once('dialog',dialog=>dialog.accept());await row.getByRole('button',{name:'Delete',exact:true}).tap();await page.waitForFunction(()=>document.getElementById('instareelStatus').textContent.startsWith('Reel deleted.'));assert.equal(await page.evaluate(()=>mygrainInstareel.player.playing),false);
   assert.equal((await context.request.get(base+`api/instareel/library/${fixture.id}/wav`,{headers})).status(),404);
   assert(original.equals(await (await context.request.get(base+'api/ftp/file?'+new URLSearchParams({path:uploaded.path}),{headers})).body()),'Delete must retain the uploaded FTP copy');
   assert.equal((await context.request.post(base+`api/instareel/library/${fixture.id}/rename`,{headers:{'X-Mygrain-User':'wrong-account'},data:{name:'No'}})).status(),401);
   assert(await page.evaluate(()=>libraryOriginal===JSON.stringify(saveState({force:true,snapshotOnly:true}),(k,v)=>k==='timestamp'?undefined:v)));assert.deepEqual(errors,[]);
   console.log('PASS',engine,'real rename, exact FTP bytes, cancel/conflict recovery, playback, confirmed delete, retained FTP copy, account isolation, portrait/landscape, unchanged patch');
  }finally{await browser.close()}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
