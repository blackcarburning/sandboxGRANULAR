'use strict';
const assert=require('node:assert/strict'),{chromium}=require('playwright-core');
(async()=>{const browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});try{
const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
const base='http://127.0.0.1:18952/mygrain/';assert.equal((await ctx.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-weird-test'}})).status(),200);
await p.goto(base);await p.waitForFunction(()=>window.mygrainWEffects&&document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!stateSaveSuspended);
console.log('BROWSER');await p.locator('#performanceBastardLoopWBrowserBtn').click();const f=p.frameLocator('#bastardloopRepositoryOverlay iframe');await f.locator('#grid .card').first().waitFor();console.log('LIST OK');await f.locator('#grid .card button').first().click();await f.locator('#preview audio').waitFor();
await p.waitForFunction(()=>document.querySelector('#bastardloopRepositoryOverlay iframe').contentDocument.querySelector('#preview audio').readyState>=1);
const href=await f.locator('#preview a.download').getAttribute('href'),r=await ctx.request.get(new URL(href,base).href),bytes=await r.body();assert.equal(r.status(),200);assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');await p.locator('#bastardloopRepositoryOverlay>button').click();
const checks=await p.evaluate(async()=>{
 const results=[];const sampleButtons=[...document.querySelectorAll('[data-grain-browser-target]')].map(b=>b.id).filter(Boolean);sampleButtons.push('performanceDropboxSampleBrowseBtn','performanceKeyboardSampleBrowseBtn','drumMachineKickBrowseBtn','drumMachineSnareBrowseBtn','drumMachineHatBrowseBtn','drumMachinePercBrowseBtn');
 for(const id of sampleButtons){const b=document.getElementById(id);if(!b)throw Error('Missing '+id);b.click();if(document.getElementById('dropboxSampleBrowserOverlay').hidden)throw Error('Wrong sample browser '+id);closeDropboxSampleBrowser();results.push(id);}
 for(const key of ['Wav','Stem','Midi','Patch']){document.getElementById('performance'+key+'BrowserBtn').click();const id=key.toLowerCase()+'RepositoryBrowserOverlay';if(document.getElementById(id).hidden)throw Error('Wrong repository '+key);window['close'+key+'RepositoryBrowser']();results.push(key);}
 return results;
});assert.equal(ctx.pages().length,1);assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,wavBytes:bytes.length,extraTabs:0,errors}));await ctx.close();
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
