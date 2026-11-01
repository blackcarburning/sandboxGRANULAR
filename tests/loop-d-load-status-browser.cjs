'use strict';
const {chromium,webkit}=require('playwright-core'),assert=require('node:assert/strict');
(async()=>{for(const [name,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{
 const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await c.request.post('http://127.0.0.1:18983/mygrain/api/auth/login',{data:{username:'admin',password:'isolated-d-loop'}});
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 if(name==='webkit')await p.addInitScript(()=>{const N=window.AudioContext||window.webkitAudioContext;window.AudioContext=class extends N{constructor(o){super({...o,sampleRate:48000})}}});
 await p.goto('http://127.0.0.1:18983/mygrain/');await p.waitForFunction(()=>window.mygrainD&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
 let release,seen;const requested=new Promise(r=>seen=r),hold=new Promise(r=>release=r);
 await p.route('**/api/sample-source*',async route=>{seen();await hold;await route.continue()});
 // The API constant is used so this test follows the app's actual download endpoint.
 const endpoint=await p.evaluate(()=>new URL(DROPBOX_SAMPLE_SOURCE_API_URL,document.baseURI).pathname);
 await p.unroute('**/api/sample-source*');await p.route('**'+endpoint+'?*',async route=>{seen();await hold;await route.continue()});
 await p.evaluate(()=>{window.loadDone=mygrainD.load({path:'Drums/Bass/Loop_120bpm.wav'}).then(()=>null,e=>e.message)});await requested;
 assert.match(await p.locator('#loopDLoadStatus').textContent(),/Downloading Loop_120bpm.wav/);
 await p.locator('#loopDLoadStatus').scrollIntoViewIfNeeded();assert(await p.locator('#loopDLoadStatus').isVisible());
 assert.equal(await p.locator('#loopDRandom').isDisabled(),true);release();assert.equal(await p.evaluate(()=>window.loadDone),null);
 assert.match(await p.locator('#loopDLoadStatus').textContent(),/Loaded Loop_120bpm.wav · ready/);
 await p.unroute('**'+endpoint+'?*');await p.route('**'+endpoint+'?*',route=>route.fulfill({status:500,body:'failure'}));
 const failed=await p.evaluate(async()=>{const previous=bastardLoopDBuffer;try{await mygrainD.load({path:'missing.wav'})}catch{}return previous===bastardLoopDBuffer});assert(failed);
 assert.match(await p.locator('#loopDLoadStatus').textContent(),/Load failed:.*500/);assert.equal(await p.locator('#loopDRandom').isDisabled(),false);
 await p.unroute('**'+endpoint+'?*');await p.evaluate(()=>mygrainD.load({path:'Drums/Bass/Loop_120bpm.wav'}));assert.equal(await p.locator('#loopDLoadStatus').getAttribute('data-state'),'success');
 await p.evaluate(()=>mygrainD.random());assert.equal(await p.locator('#loopDLoadStatus').getAttribute('data-state'),'success');assert(await p.locator('#loopDLoadStatus').isVisible());
 await p.evaluate(()=>openDropboxSampleBrowser(SAMPLE_BROWSER_TARGETS.bastardLoopD));
 await p.waitForFunction(()=>document.querySelectorAll('#dropboxSampleBrowserList .sample-browser-card').length>0);
 let releaseBrowser,seeBrowser;const browserSeen=new Promise(r=>seeBrowser=r),browserHold=new Promise(r=>releaseBrowser=r);
 await p.route('**'+endpoint+'?*',async route=>{seeBrowser();await browserHold;await route.continue()});
 await p.locator('#dropboxSampleBrowserList').getByRole('button',{name:'Load Loop D',exact:true}).first().click();await browserSeen;
 assert(await p.evaluate(()=>Array.from(document.querySelectorAll('#dropboxSampleBrowserOverlay [role="status"],#dropboxSampleBrowserStatus')).some(e=>e.textContent.includes('Downloading'))));
 releaseBrowser();await p.waitForFunction(()=>document.getElementById('dropboxSampleBrowserOverlay').hidden&&!mygrainD.busy&&!mygrainCardHistory.busy);assert.match(await p.locator('#loopDLoadStatus').textContent(),/Loaded/);
 await p.unroute('**'+endpoint+'?*');
 // Import also reports success, without changing the source loading pipeline.
 await p.evaluate(async()=>{const raw=await (await fetch(new URL(DROPBOX_SAMPLE_SOURCE_API_URL,document.baseURI)+'?source=samples_loops&path=Drums%2FBass%2FLoop_120bpm.wav')).arrayBuffer();await mygrainD.load({file:new File([raw],'Imported.wav')})});assert.match(await p.locator('#loopDLoadStatus').textContent(),/Loaded Imported.wav/);
 for(const size of [{width:390,height:844},{width:1280,height:900}]){await p.setViewportSize(size);await p.locator('#loopDLoadStatus').scrollIntoViewIfNeeded();assert(await p.locator('#loopDLoadStatus').isVisible());assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 assert.deepEqual(errors,[]);console.log('PASS',name,'D download pending, success, failure rollback, retry, import and phone/desktop status');
 }finally{await b.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
