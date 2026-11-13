// No request routing: it disables the HTTP cache and invalidates warm measurements.
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19232/mygrain/';assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
(async()=>{const browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
 const results=[];try{for(let trial=0;trial<Number(process.env.STARTUP_TRIALS||3);trial++){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
  assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-startup-check'}})).status(),200);
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   window.startupTimings={};window.startupLongTasks=[];
   try{new PerformanceObserver(list=>startupLongTasks.push(...list.getEntries().map(x=>({start:x.startTime,duration:x.duration})))).observe({type:'longtask',buffered:true});}catch{}
   new MutationObserver(()=>{const b=document.getElementById('start-btn');if(b&&!b.disabled&&document.documentElement.dataset.mygrainStartup==='ready'&&getComputedStyle(b).visibility==='visible'&&!startupTimings.usable)startupTimings.usable=performance.now();}).observe(document,{attributes:true,childList:true,subtree:true});
  });
  const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:500000,uploadThroughput:500000});
  const responses=[];cdp.on('Network.responseReceived',({response:r})=>responses.push({name:r.url.split('/').pop(),status:r.status,fromDiskCache:!!r.fromDiskCache,encoding:r.headers['Content-Encoding']||r.headers['content-encoding']}));
  for(let visit=0;visit<2;visit++){
   responses.length=0;await page.goto(base,{waitUntil:'domcontentloaded',timeout:120000});
   await page.waitForFunction(()=>startupTimings.usable&&document.documentElement.dataset.mygrainStartup==='ready',null,{timeout:120000});
   const result=await page.evaluate(()=>({usableMs:startupTimings.usable,account:mygrainAccounts.user.username,navigation:performance.getEntriesByType('navigation')[0].toJSON(),resources:performance.getEntriesByType('resource').map(x=>({name:x.name.split('/').pop(),start:x.startTime,end:x.responseEnd,duration:x.duration,transferSize:x.transferSize,encodedBodySize:x.encodedBodySize,decodedBodySize:x.decodedBodySize,initiator:x.initiatorType})),longTasks:startupLongTasks}));
   assert.equal(result.account,'admin');assert.deepEqual(errors,[]);
   result.trial=trial;result.visit=visit===0?'cold':'repeat';result.responses=[...responses];results.push(result);
   console.log(JSON.stringify({trial,visit:result.visit,usableMs:Math.round(result.usableMs),htmlBytes:result.navigation.encodedBodySize,htmlEnd:Math.round(result.navigation.responseEnd),late:result.resources.filter(x=>x.end>result.usableMs-1500).map(x=>({name:x.name,start:Math.round(x.start),end:Math.round(x.end),bytes:x.transferSize})).sort((a,b)=>a.start-b.start)}));
  }
  // Ensure the measured screen's normal Start action actually works.
  await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended,null,{timeout:60000});
  await context.close();
 }}finally{await browser.close();}if(process.env.STARTUP_OUTPUT)fs.writeFileSync(process.env.STARTUP_OUTPUT,JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
