'use strict';
// Run against an isolated Song test server; never a production account.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18938/mygrain/';assert(['127.0.0.1','localhost'].includes(new URL(base).hostname));
(async()=>{const results=[];for(const [engine,B]of Object.entries({chromium,webkit})){
const browser=await B.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
try{const context=await browser.newContext();assert((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:process.env.MYGRAIN_TEST_ADMIN_PASSWORD||'isolated-berlin'}})).ok());const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(90000);
await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await page.click('#start-btn');await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
const checks=await page.evaluate(async()=>{
 stopAllPerformancePlayback({silent:true});applyGlobalBpm(120);syncPatternLengthControls(8,{skipSave:true});
 const raw=audioContext.createBuffer(2,Math.round(audioContext.sampleRate*.3),audioContext.sampleRate);
 for(let c=0;c<2;c++)for(let i=0;i<raw.length;i++)raw.getChannelData(c)[i]=.1*Math.sin(i*.08)*(c?-.7:1);
 bastardLoopDBuffer=raw;bastardLoopDMetadata={sourceBpm:120,fileName:'cache-fixture_120bpm.wav'};mygrainD.restore({...mygrainD.settings(),enabled:true,fill:'single',maximiser:25});
 const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b.getChannelData(0)))).join(',');
 const sourceHash=await hash(raw),first=mygrainD.fitted(),firstHash=await hash(first),stretch=MygrainVocalCut.stretchChannels;let calls=0;
 MygrainVocalCut.stretchChannels=function(...args){calls++;return stretch.apply(this,args)};
 try{
  for(let i=0;i<3;i++){applyGlobalBpm(120);syncPatternLengthControls(8,{skipSave:true});if(mygrainD.fitted()!==first)throw Error('Identical tempo/pattern refitted D');}
  if(calls!==0)throw Error('Warm capture stretched again');
  applyGlobalBpm(93);const retimed=mygrainD.fitted();if(retimed===first||retimed.length!==Math.round(8*60/93/4*raw.sampleRate))throw Error('Tempo edit failed to refit');
  syncPatternLengthControls(16,{skipSave:true});const longer=mygrainD.fitted();if(longer===retimed||longer.length!==Math.round(16*60/93/4*raw.sampleRate))throw Error('Pattern edit failed to refit');
  applyGlobalBpm(120);syncPatternLengthControls(8,{skipSave:true});const rebuilt=mygrainD.fitted();if(await hash(rebuilt)!==firstHash)throw Error('Cache retention changed rendered PCM');
  const replacement=audioContext.createBuffer(2,raw.length,raw.sampleRate);for(let c=0;c<2;c++)replacement.copyToChannel(raw.getChannelData(c),c);bastardLoopDBuffer=replacement;const replaced=mygrainD.fitted();if(replaced===rebuilt||await hash(replaced)!==firstHash)throw Error('Source identity invalidation failed');
  if(await hash(raw)!==sourceHash)throw Error('Original PCM changed');
  return{sameTempoAndPatternReuse:true,zeroWarmStretches:true,tempoRefit:true,patternRefit:true,exactPCM:true,sourceIdentityRefit:true,originalUnchanged:true};
 }finally{MygrainVocalCut.stretchChannels=stretch;stopAllPerformancePlayback({silent:true})}
});assert.deepEqual(errors,[]);results.push({engine,...checks});console.log('PASS',JSON.stringify(results.at(-1)));await context.close();
}finally{await browser.close()}}
if(process.env.MYGRAIN_TEST_RESULT)fs.writeFileSync(process.env.MYGRAIN_TEST_RESULT,JSON.stringify(results,null,2)+'\n');})().catch(e=>{console.error(e);process.exitCode=1});
