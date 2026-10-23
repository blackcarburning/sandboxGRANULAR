'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const job=process.env.SERVER_K_JOB_STDIN?JSON.parse(fs.readFileSync(0,'utf8')):{};
const base=job.baseUrl||'http://127.0.0.1:18923/mygrain/',songId=job.songId||process.env.SERVER_K_TEST_SONG;
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);assert(songId);
(async()=>{const results=[];for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
 if(job.cookie){const [name,...value]=job.cookie.split('=');await context.addCookies([{name,value:value.join('='),url:base}])}else assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'snowpeas'}})).status(),200);
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
 if(process.env.SERVER_K_BASELINE){const before=fs.readFileSync(process.env.SERVER_K_BASELINE,'utf8');await page.route('**/song-beta.js?*',r=>r.fulfill({contentType:'text/javascript',body:before}))}
 await page.goto(base);await page.waitForFunction(()=>window.mygrainSongBeta&&window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await page.locator('#start-btn').tap();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
 const result=await page.evaluate(async({songId,baseline})=>{
  const c=mygrainSongBeta;await c.refresh();const song=c.songs.find(s=>s.id===songId);if(!song||!song.name.includes('server K test'))throw Error('Only the explicit server K test copy may be tested');c.acceptSong(song);if(c.memoryBudget.limitBytes!==96*1048576)throw Error('Phone memory configuration mismatch');
  if(baseline){try{await c.arm();throw Error('Baseline unexpectedly armed')}catch(e){if(!/197 MB.*96 MB/.test(e.message))throw e;return{baselineError:e.message}}}
  // The UI must not have any source-ZIP conversion escape hatch, even on desktop.
  c.readPart=async()=>{throw Error('Phone downloaded a source ZIP')};c.adapter.upgradePart=async()=>{throw Error('Phone rewrote a source ZIP')};
  const before={revision:song.revision,parts:song.parts.map(p=>({id:p.id,repeats:p.repeats,name:p.name,render:p.render?.sha256}))};
  await c.convertKTracks();const convertedRevision=c.song.revision;const after=c.song.parts.map(p=>({id:p.id,repeats:p.repeats,name:p.name,render:p.render?.sha256}));if(JSON.stringify(before.parts)!==JSON.stringify(after))throw Error('Conversion changed arrangement or existing playback WAVs');
  for(const p of c.uniqueParts()){const info=await c.readPartMetadata(p);if(info.snapshot.state.modes.kMultitrack?.version!==2)throw Error('K v2 conversion missing')}
  await c.convertKTracks();if(c.song.revision!==convertedRevision)throw Error('Repeated conversion was not idempotent');await c.finishEditing();
  const sources=c.song.parts.map(p=>p.sha256),revision=c.song.revision;await c.arm();if(!c.armed)throw Error('Song did not arm');if(c.song.revision!==revision||JSON.stringify(c.song.parts.map(p=>p.sha256))!==JSON.stringify(sources))throw Error('Arm rewrote saved originals');
  const p=c.uniqueParts()[0],buffer=await c.loadRender(p);let sum=0;for(const x of buffer.getChannelData(0)){if(!Number.isFinite(x))throw Error('Invalid render sample');sum+=x*x}await c.playSong(p.id);await new Promise(r=>setTimeout(r,250));const playing=c.playing;c.stop();
  return {armed:c.armed,ready:c.uniqueParts().filter(p=>c.isPartReady(p)).length,unique:c.uniqueParts().length,placements:c.song.parts.length,budget:c.memoryBudget.limitBytes,reserved:c.memoryBudget.bytes,rms:Math.sqrt(sum/buffer.length),playing,converted:convertedRevision-before.revision,sourceRevisionUnchangedByArm:true};
 },{songId,baseline:!!process.env.SERVER_K_BASELINE});
 if(!process.env.SERVER_K_BASELINE){assert.equal(result.ready,5);assert.equal(result.placements,7);assert.equal(result.playing,true);assert(result.rms>.00001);assert.equal(result.reserved,0);assert.deepEqual(errors,[]);const originals=requests.filter(r=>r.method==='GET'&&/\/parts\/[a-f0-9]{32}$/.test(new URL(r.url).pathname));assert.equal(originals.length,0);result.phoneSourceZipDownloads=originals.length;result.convertRequests=requests.filter(r=>r.method==='POST'&&r.url.endsWith('/convert-k')).length;assert.equal(result.convertRequests,2);result.serverJobs=requests.filter(r=>r.method==='POST'&&r.url.includes('/server-arm?')).length;for(const vp of [{width:320,height:640},{width:844,height:390}]){await page.setViewportSize(vp);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}}
 results.push({engine,...result});console.log(JSON.stringify(results.at(-1)));await context.close();
 }finally{await browser.close()}
 if(process.env.SERVER_K_BASELINE)break;
 }fs.writeFileSync(process.env.SERVER_K_EVIDENCE||'/tmp/server-k-browser-results.json',JSON.stringify(results,null,2))
})().catch(e=>{console.error(e);process.exitCode=1});
