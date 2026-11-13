'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19383/mygrain/',out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp/mygrain-export-dialog-jumps';fs.mkdirSync(out,{recursive:true});
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
const results=[];
const labels=p=>p.locator('#sectionJumpPanel .section-jump-grid > button').evaluateAll(xs=>xs.filter(x=>!x.hidden).map(x=>x.textContent.replace(/\s+/g,' ').trim()));
async function ready(p){await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);}
async function drawer(p,phone,query=''){if(phone&&!await p.locator('#sectionJumpDrawer').evaluate(x=>x.classList.contains('is-open')))await p.locator('#sectionJumpHandle').click();await p.locator('#desktopNavSearch').fill(query);}
async function closeActivity(p){const b=p.locator('#exportActivityDialog button');if(await b.count())await b.click();await p.waitForFunction(()=>!document.getElementById('exportActivityDialog'));}
(async()=>{for(const [engine,type,phone] of [['chromium',chromium,false],['webkit',webkit,false],['chromium',chromium,true],['webkit',webkit,true]]){
 const name=engine+'-'+(phone?'phone':'desktop');if(process.env.MYGRAIN_TEST_CASE&&process.env.MYGRAIN_TEST_CASE!==name)continue;
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/chromium/current/usr/lib/chromium-browser/chrome',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{const c=await browser.newContext({viewport:{width:phone?390:1440,height:phone?844:900},isMobile:phone,hasTouch:phone,...phone?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{}});
 assert((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).ok());
 const p=await c.newPage(),errors=[],native=[],uploads=[];p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>{native.push(d.message());d.dismiss()});p.on('request',r=>{if(r.method()==='POST'&&/mygrain-(wavs|loopstore)\/api\//.test(r.url()))uploads.push(r.url())});
 await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await p.addInitScript(()=>{window.prompt=()=>{throw Error('Native prompt must not be used')};window.confirm=()=>{throw Error('Native confirm must not be used')};});
 await p.goto(base);await ready(p);await drawer(p,phone);
 if(!phone){
  assert.deepEqual((await labels(p)).slice(0,19),['Clear Patch','Top','✦ AI PATCH · BETA','The cooking pot','The Parts Bin','The Master Baker','Song','Layers','Mix','Mega','Sparse','Export Mix','WAV Browser','Add to loop store','Loop Store Browser','Keys','Actions','Drums','G · GENREator']);
  const geometry=await p.evaluate(()=>{const grid=document.querySelector('.section-jump-grid'),visible=[...grid.children].filter(x=>!x.hidden&&x.tagName==='BUTTON'),r=x=>{const b=x.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}};return{wide:visible.slice(0,7).map(r),pairs:visible.slice(7,19).map(r),grid:r(grid)}});
  for(const r of geometry.wide)assert(Math.abs(r.w-geometry.grid.w)<1);
  for(let i=0;i<geometry.pairs.length;i+=2){assert(Math.abs(geometry.pairs[i].y-geometry.pairs[i+1].y)<1);assert(Math.abs(geometry.pairs[i].w-geometry.pairs[i+1].w)<1)}
  const before=await p.locator('#desktopNavSearch').boundingBox(),panel=p.locator('#sectionJumpPanel');
  await panel.hover();await p.mouse.wheel(0,1800);await p.waitForFunction(()=>document.getElementById('sectionJumpPanel').scrollTop>500);
  const after=await p.locator('#desktopNavSearch').boundingBox();assert.deepEqual(before,after);
  const owners=await p.evaluate(()=>[...document.querySelectorAll('#sectionJumpDrawer *')].filter(x=>x.scrollHeight>x.clientHeight+5&&/auto|scroll/.test(getComputedStyle(x).overflowY)).map(x=>x.id||x.className));assert.deepEqual(owners,['sectionJumpPanel']);
  await p.setViewportSize({width:960,height:900});await p.waitForFunction(()=>document.getElementById('sectionJumpAiBtn').parentElement.classList.contains('section-jump-quick-stack'));
  await p.setViewportSize({width:961,height:900});await p.waitForFunction(()=>document.getElementById('sectionJumpAiBtn').parentElement.classList.contains('section-jump-grid'));
  await p.setViewportSize({width:1440,height:900});await p.waitForTimeout(200);
 }
 await drawer(p,phone,'filter playground');assert.deepEqual(await labels(p),['Filter Playground']);
 if(!phone){await p.locator('#sectionJumpPlaygroundBtn').click();await p.waitForFunction(()=>!document.documentElement.dataset.mygrainJumping&&document.getElementById('filterPlaygroundCard')?.querySelector('canvas'));assert.equal(await p.locator('#sectionJumpPlaygroundBtn').count(),1);}
 if(!phone){await drawer(p,false,'Bubble Chamber');await p.locator('#sectionJumpBubbleChamberBtn').click();await p.waitForFunction(()=>!document.documentElement.dataset.mygrainJumping);const r=await p.locator('#bubbleChamberCard').boundingBox();assert(r.y>=-1&&r.y<500);}
 await drawer(p,phone,'zznomatch');assert(await p.locator('.desktop-nav-empty').isVisible());assert.deepEqual(await labels(p),[]);
 await drawer(p,phone,'');
 if(!phone){const all=await labels(p);assert.deepEqual(all.filter(x=>/^Loop (?:A|B|C|D|V|W|P|O|L|X|Q|M|M\+|K)$/.test(x)),['Loop A','Loop B','Loop C','Loop D','Loop V','Loop W','Loop P','Loop O','Loop L','Loop X','Loop Q','Loop M','Loop M+','Loop K']);await p.screenshot({path:out+'/'+name+'-jump.png'});}
 await p.evaluate(async()=>{stopAllPerformancePlayback({silent:true});applyGlobalBpm(137);syncPatternLengthControls(16,{skipSave:true});document.getElementById('performanceExportBars').value='1';setFxMuted(true,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);setDrumMachineEnabled(false,{silent:true,skipSave:true});mygrainNoise.restore({enabled:false});mygrainChannelEq.restore();await mygrainResonator.off();await mygrainWasp.restore(null);await mygrainTurntable.off();const n=Math.round(60/137*4*audioContext.sampleRate),src=audioContext.createBuffer(2,n,audioContext.sampleRate);for(let ch=0;ch<2;ch++)for(let i=0;i<n;i++)src.getChannelData(ch)[i]=.15*Math.cos(2*Math.PI*(ch?173:110)*i/n);bastardLoopBuffer=src;bastardLoopSourceBpm=137;bastardLoopMetadata={bpm:137,durationSeconds:n/audioContext.sampleRate};setBastardLoopEnabled(true,{silent:true,skipSave:true});setLoopLayerSolo('bastarda',{silent:true,skipSave:true});window.sourceBefore=src;window.renderCalls=0;const original=renderDawReadyBarsExport;renderDawReadyBarsExport=async function(...args){renderCalls++;return original(...args)};window.snapshotBefore=saveState({snapshotOnly:true,force:true});delete snapshotBefore.timestamp;});
 const repo=phone?'sectionJumpFinalMixPanelBtn':'sectionJumpFinalMixBtn';
 for(const [id,query]of [[repo,'Export'],['sectionJumpLoopStoreAddBtn','Add to loop']]){
  for(const dismiss of ['cancel','escape','close']){await drawer(p,phone,query);await p.locator('#'+id).click();await p.locator('#exportSaveDialog').waitFor({state:'visible'});assert.equal(await p.locator('#exportSaveDialog button:focus').textContent(),'Cancel');if(dismiss==='cancel')await p.locator('#exportSaveDialog').getByRole('button',{name:'Cancel',exact:true}).click();else if(dismiss==='escape')await p.keyboard.press('Escape');else await p.evaluate(()=>document.getElementById('exportSaveDialog').close());await p.waitForFunction(()=>!document.getElementById('exportSaveDialog'));assert.equal(await p.evaluate(()=>renderCalls),0);assert.equal(uploads.length,0);}
 }
 // Cancelling the existing length warning also cancels the whole accepted save.
 if(!phone){await p.evaluate(()=>syncPatternLengthControls(32,{skipSave:true}));await drawer(p,false,'Export');await p.locator('#'+repo).click();await p.locator('[data-export-accept]').click();await p.locator('#exportLengthDialog').getByRole('button',{name:'Cancel',exact:true}).click();await p.waitForFunction(()=>document.getElementById('exportActivityDialog')?.getAttribute('aria-busy')==='false');assert.equal(await p.evaluate(()=>renderCalls),0);assert.equal(uploads.length,0);await closeActivity(p);await p.evaluate(()=>{syncPatternLengthControls(16,{skipSave:true});/* Fixture length editing creates extra hidden sequencer controls: baseline the deliberate fixture edit. */window.snapshotBefore=saveState({snapshotOnly:true,force:true});delete snapshotBefore.timestamp;});}
 // Repeated request is cancelled rather than creating a second choice.
 await drawer(p,phone,'Add to loop');await p.locator('#sectionJumpLoopStoreAddBtn').click();assert.equal(await p.evaluate(async()=>await chooseExportSaveOptions()),null);assert.equal(await p.locator('#exportSaveDialog').count(),1);
 await p.locator('#exportSaveName').fill('   ');await p.locator('[data-export-accept]').click();assert(await p.locator('#exportSaveDialog').isVisible());assert.equal(await p.evaluate(()=>renderCalls),0);await p.keyboard.press('Escape');
 const saves=[];
 for(const [kind,id,query]of [['repo',repo,'Export'],['loop','sectionJumpLoopStoreAddBtn','Add to loop']]){
  await drawer(p,phone,query);await p.locator('#'+id).click();await p.locator('#exportSaveName').fill('dialog-'+name+'-'+kind);
  const d=await p.locator('#exportSaveDialog').boundingBox();assert(d.x>=0&&d.y>=0&&d.x+d.width<=(phone?390:1440)+1&&d.y+d.height<=(phone?844:900)+1);await p.screenshot({path:out+'/'+name+'-'+kind+'-dialog.png'});
  const paired=kind==='repo'&&engine==='chromium'&&!phone;if(kind==='repo')await p.locator('#exportSaveSnapshot').setChecked(paired);
  const response=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/mygrain-'+(kind==='repo'?'wavs':'loopstore')+'/api/'));
  await p.locator('[data-export-accept]').click();const r=await response;assert(r.ok(),await r.text());const data=await r.json();saves.push(data);
  await p.waitForFunction(()=>document.getElementById('exportActivityDialog')?.getAttribute('aria-busy')==='false');assert.match(await p.locator('#exportActivityDialog').textContent(),kind==='repo'?/Saved .*WAV Browser/:/Added peak-normalised/);
  assert(await p.evaluate(()=>bastardLoopBuffer===sourceBefore&&audioContext.state==='running'));
  const after=await p.evaluate(()=>{const s=saveState({snapshotOnly:true,force:true});delete s.timestamp;return s});assert.deepEqual(after,await p.evaluate(()=>snapshotBefore));
  await closeActivity(p);await p.waitForFunction(()=>!document.getElementById('performanceRepoExportBtn').disabled&&!document.getElementById('performanceLoopStoreAddBtn').disabled);
 }
 // Local WAV and patch ZIP save choices also stay inside the editor.
 await p.evaluate(()=>{mygrainDisplay.reveal(document.querySelector('.performance-actions-card'));document.querySelector('.performance-actions-card').scrollIntoView({block:'center'})});
 for(const id of ['performanceExportBtn','performanceExportPatchZipBtn']){const count=await p.evaluate(()=>renderCalls);await p.locator('#'+id).click();await p.locator('#exportSaveDialog').waitFor({state:'visible'});await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.getElementById('exportSaveDialog'));assert.equal(await p.evaluate(()=>renderCalls),count);}
 if(!phone){
  // Disable OS destination picker in this automated fixture only; real browser download bytes still verified.
  await p.evaluate(()=>{delete window.showSaveFilePicker;Object.defineProperty(navigator,'share',{value:undefined,configurable:true})});
  await p.locator('#performanceExportBtn').click();await p.locator('#exportSaveName').fill('local-'+name);await p.locator('#exportSaveSnapshot').uncheck();
  const download=p.waitForEvent('download');await p.locator('[data-export-accept]').click();const file=await download;assert.equal(file.suggestedFilename(),'local-'+name+'.wav');const target=out+'/local-'+name+'.wav';await file.saveAs(target);const bytes=fs.readFileSync(target);assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.readUInt32LE(4)+8,bytes.length);assert.equal(bytes.readUInt16LE(34),24);assert(bytes.length>100000);
  await p.waitForFunction(()=>document.getElementById('exportActivityDialog')?.getAttribute('aria-busy')==='false');await closeActivity(p);
 }
 // Backend failure is visible inside the app and restores operation buttons.
 await p.route(/\/mygrain-wavs\/api\/(upload|render-with-pattern)/,r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Isolated upload failure'})}));
 await drawer(p,phone,'Export');await p.locator('#'+repo).click();await p.locator('#exportSaveSnapshot').uncheck();await p.locator('[data-export-accept]').click();await p.waitForFunction(()=>document.getElementById('exportActivityDialog')?.dataset.failed==='true');assert.match(await p.locator('.export-dialog-status').textContent(),/Isolated upload failure/);await closeActivity(p);
 // Account invalidation dismisses an unresolved choice without an extra render/upload.
 const count=await p.evaluate(()=>renderCalls),sent=uploads.length;await drawer(p,phone,'Add to loop');await p.locator('#sectionJumpLoopStoreAddBtn').click();await p.evaluate(()=>dispatchEvent(new Event('mygrain-account-changed')));await p.waitForFunction(()=>!document.getElementById('exportSaveDialog'));assert.equal(await p.evaluate(()=>renderCalls),count);assert.equal(uploads.length,sent);
 await p.evaluate(()=>{window.signalTest=new AbortController();window.dismissedChoice=chooseExportSaveOptions({signal:signalTest.signal});signalTest.abort()});assert.equal(await p.evaluate(()=>dismissedChoice),null);
 await p.evaluate(()=>{window.dismissedChoice=chooseExportSaveOptions();dispatchEvent(new Event('mygrain-account-lock'))});assert.equal(await p.evaluate(()=>dismissedChoice),null);
 assert.deepEqual(native,[]);assert.deepEqual(errors,[]);results.push({name,saves:saves.map(x=>({savedName:x.savedName,loopStore:x.loopStore,patternExport:x.patternExport})),nativeDialogs:native.length,errors});fs.writeFileSync(out+'/'+name+'-results.json',JSON.stringify(results,null,2));console.log('PASS',name);
 await c.close();
 }finally{await browser.close()}
}console.log(JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exit(1)});
