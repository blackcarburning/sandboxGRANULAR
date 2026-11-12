'use strict';
// Run against a real CEF helper and native VST3 host. No production account requests.
const {chromium}=require('playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const [hostExe,bundle,out]=process.argv.slice(2),app=path.resolve(process.env.MYGRAIN_CEF_APP_PATH||path.join(__dirname,'../..')),origin='https://openclaw.blackcarburning.com',delay=ms=>new Promise(r=>setTimeout(r,ms));
fs.mkdirSync(out,{recursive:true});
async function until(fn,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await delay(100);}throw Error('Timeout '+label);}
const mime=p=>({'.html':'text/html','.js':'text/javascript','.cjs':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.webp':'image/webp','.wav':'audio/wav','.woff2':'font/woff2'}[path.extname(p)]||'application/octet-stream');
async function fixture(context,auth={signedIn:true,posts:0}){
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin){await route.abort();return;}
  const n=decodeURIComponent(u.pathname.replace(/^\/mygrain\/?/,''))||'index.html';
  const headers={'x-mygrain-isolated-test':'cef-project','cache-control':'no-store'};
  if(n==='account-context.js'){await route.fulfill({headers,contentType:'text/javascript',body:'window.mygrainAccountContext='+JSON.stringify(auth.signedIn?{user:{username:'cef-fixture'}}:{user:null})+';'});return;}
  if(n==='api/auth/login'){
   const body=route.request().postDataJSON();assert.deepEqual(body,{username:'native-user7',password:'Aa7!@-z'});auth.signedIn=true;auth.posts++;
   await route.fulfill({headers,contentType:'application/json',body:JSON.stringify({ok:true,user:{username:'cef-fixture'}})});return;
  }
  if(n.startsWith('api/')){
   const body=n==='api/auth/session'?{ok:true,authenticated:auth.signedIn,user:auth.signedIn?{username:'cef-fixture'}:null}:{items:[],files:[],folders:[],songs:[],parts:[],presets:[],favourites:[],favorites:[],sources:[],libraries:[],jobs:[]};
   await route.fulfill({headers,contentType:'application/json',body:JSON.stringify(body)});return;
  }
  const file=path.resolve(app,n);if(!file.startsWith(app+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){await route.fulfill({status:404,headers,body:'Isolated fixture: missing asset'});return;}
  await route.fulfill({headers,contentType:mime(file),body:fs.readFileSync(file)});
 });
}
let child,browser,code,log='',exit=null;const raw=path.resolve(out,'cef-native.f32'),control=raw+'.control';
function command(c){fs.writeFileSync(control,c);}
async function run(state){
 log='';exit=null;const argv=[bundle,raw,'300'];if(state)argv.push(state);
 child=spawn(hostExe,argv,{env:{...process.env,MYGRAIN_CEF_DEBUG_PORT:'19381'}});child.stdout.on('data',b=>{log+=b;process.stdout.write(b);});child.stderr.on('data',b=>fs.appendFileSync(raw+'.stderr',b));child.on('exit',n=>{exit=n;});
 await until(()=>/187\d{2}\.[a-f0-9]{32}/.test(log),'native code');code=log.match(/187\d{2}\.[a-f0-9]{32}/)[0];
 await until(async()=>{try{const r=await fetch('http://127.0.0.1:19381/json/version');return r.ok;}catch{return false;}},'real CEF debugger',45000);
 browser=await chromium.connectOverCDP('http://127.0.0.1:19381');const c=browser.contexts()[0];const auth={signedIn:!!state,posts:0};await fixture(c,auth);const p=c.pages()[0];
 const response=await p.goto(origin+'/mygrain/?account=login&cef_fixture='+Date.now()+'#daw='+code);assert.equal(response.headers()['x-mygrain-isolated-test'],'cef-project');
 p.on('pageerror',e=>fs.appendFileSync(path.join(out,'page-errors.txt'),e.stack+'\n'));
 if(!state){
  const click=async selector=>{const box=await p.locator(selector).boundingBox();assert(box);command(`cef-click ${Math.round(box.x+box.width/2)} ${Math.round(box.y+box.height/2)}`);await delay(150);};
  const key=async(ch,code=0,mod=0)=>{command(`cef-host-key ${ch} ${code} ${mod}`);await delay(70);};
  await p.locator('#mygrainLoginUsername').waitFor({state:'visible'});await click('#mygrainLoginUsername');
  // Native window fallback before any host keyboard callback is delivered.
  command('cef-native-key 110 78');await p.waitForFunction(()=>document.querySelector('#mygrainLoginUsername').value==='n');
  command('cef-host-focus 1');await delay(100);
  for(const ch of 'ative-user8')await key(ch.charCodeAt(0));
  await p.waitForFunction(()=>document.querySelector('#mygrainLoginUsername').value==='native-user8');
  await key(97,0,4);for(const ch of 'native-user8')await key(ch.charCodeAt(0)); // Ctrl/Cmd+A uses Chromium's focused frame.
  await p.waitForFunction(()=>document.querySelector('#mygrainLoginUsername').value==='native-user8');
  await key(0,1);await key(55); // Backspace then 7.
  await p.waitForFunction(()=>document.querySelector('#mygrainLoginUsername').value==='native-user7');
  command('cef-host-focus 0');await delay(100);await key(88);await delay(150);
  assert.equal(await p.locator('#mygrainLoginUsername').inputValue(),'native-user7','blurred plugin must not consume host keys');
  command('cef-host-focus 1');await delay(100);await key(9,2); // Tab, not a mouse/CDP focus command.
  await p.waitForFunction(()=>document.activeElement.id==='mygrainLoginPassword');
  for(const ch of 'Aa7!@-z')await key(ch.charCodeAt(0));
  await p.waitForFunction(()=>document.querySelector('#mygrainLoginPassword').value==='Aa7!@-z');
  // A native duplicate after host handling must not insert a second character.
  command('cef-native-key 122 90');await delay(200);
  assert.equal(await p.locator('#mygrainLoginPassword').inputValue(),'Aa7!@-z');
  await p.screenshot({path:path.join(out,'native-login.png')});
  await Promise.all([p.waitForEvent('framenavigated',{predicate:f=>f===p.mainFrame(),timeout:15000}),key(13,4)]);
  await until(()=>auth.posts===1,'synthetic native login');
  fs.writeFileSync(path.join(out,'native-login-results.json'),JSON.stringify({nativeTyping:true,vst3Keyboard:true,editing:true,selectAllShortcut:true,tab:true,focusRelease:true,noDuplicate:true,loginSubmitted:true}));
 }

 await p.waitForFunction(()=>window.mygrainDawBridge&&document.documentElement.dataset.mygrainStartup==='ready',null,{timeout:90000}).catch(async error=>{fs.writeFileSync(path.join(out,'startup-diagnostic.json'),JSON.stringify(await p.evaluate(()=>({url:location.href,build:document.querySelector('.build-badge')?.textContent,status:document.documentElement.dataset,body:document.body.innerText.slice(0,15000)})),null,2));throw error;});
 if(await p.locator('#start-btn').isVisible())await p.locator('#start-btn').click();
 await p.waitForFunction(()=>mygrainDawBridge.connected&&mygrainDawBridge.diagnostics().project.ready&&isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy,null,{timeout:90000});
 return p;
}
async function close(){command('quit');if(browser){await browser.close().catch(()=>{});browser=null;}await until(()=>exit!==null,'native clean unload',15000);assert.equal(exit,0,log);fs.writeFileSync(path.join(out,'cef-native-host.log'),log);}
function rms(){const bytes=fs.readFileSync(raw);let power=0,n=0;for(let at=Math.max(0,bytes.length-48000*8);at+4<=bytes.length;at+=4){const v=bytes.readFloatLE(at);assert(Number.isFinite(v));power+=v*v;n++;}return Math.sqrt(power/Math.max(1,n));}
(async()=>{try{
 const p=await run();command('stop');const diag=()=>p.evaluate(()=>mygrainDawBridge.diagnostics());
 const audit=async label=>{const value=await p.evaluate(async()=>{const a=audioContext.createAnalyser();a.fftSize=2048;finalAmplifierNode.connect(a);await new Promise(r=>setTimeout(r,150));const v=new Float32Array(2048);a.getFloatTimeDomainData(v);finalAmplifierNode.disconnect(a);return {audio:{state:audioContext.state,time:audioContext.currentTime,rate:audioContext.sampleRate,rms:Math.sqrt(v.reduce((sum,x)=>sum+x*x,0)/v.length)},visibility:document.visibilityState,bridge:mygrainDawBridge.diagnostics(),status:document.querySelector('#dawBridgeStatus')?.textContent};});value.nativeRms=rms();fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(value,null,2));};

 assert.equal((await diag()).project.auto.enabled,true);assert.equal((await diag()).project.auto.interval,60);
 // Verify the actual native editor input route, not just DevTools input.
 await p.evaluate(()=>{window.cefNativeClick=0;const b=document.createElement('button');b.id='cef-native-input-probe';b.textContent='Native input test';b.style.cssText='position:fixed;left:20px;top:90px;width:200px;height:40px;z-index:2147483647';b.onclick=()=>window.cefNativeClick++;document.body.append(b);});
 await delay(500);command('cef-click 60 110');await p.waitForFunction(()=>window.cefNativeClick===1,null,{timeout:10000});await p.locator('#cef-native-input-probe').evaluate(b=>b.remove());
 command('screenshot');await until(()=>fs.existsSync(raw+(process.platform==='win32'?'.bmp':'.png')),'native surface screenshot');

 await p.evaluate(async()=>{stopAllPerformancePlayback({silent:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});applyGlobalBpm(120);syncPatternLengthControls(16,{skipSave:true});setFxMuted(true,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);setDrumMachineEnabled(false,{silent:true,skipSave:true});
  const b=audioContext.createBuffer(2,audioContext.sampleRate*4,audioContext.sampleRate);for(let c=0;c<2;c++)for(let i=0;i<b.length;i++)b.getChannelData(c)[i]=.15*Math.cos(2*Math.PI*(c?223:110)*i/b.sampleRate);bastardLoopBuffer=b;bastardLoopSourceBpm=120;bastardLoopMetadata={bpm:120,summary:'CEF isolated auto-save source',durationSeconds:4};setBastardLoopEnabled(true,{silent:true,skipSave:true});setLoopLayerSolo('bastarda',{silent:true,skipSave:true});
  const panel=document.querySelector('#dawBridgeCard .daw-project-panel');panel.querySelector('.daw-project-interval').value='15';panel.querySelector('.daw-project-interval').dispatchEvent(new Event('change'));
 });
 command('arm-plugin');await delay(250);command('play');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock.running,null,{timeout:25000});await delay(1200);assert(rms()>.0001,'real native output must be audible');
 await p.waitForFunction(()=>mygrainDawBridge.diagnostics().project.stats.count>=1,null,{timeout:45000});const first=(await diag()).project;assert(first.stats.snapshotBytes>100000,'real source WAV must be stored');assert.equal(first.auto.interval,15);
 await audit('before-close');command('close-editor');await delay(500);const count=first.stats.count;await p.evaluate(()=>{bastardLoopMetadata.summary='CEF updated while native editor closed';});
 await p.waitForFunction(n=>mygrainDawBridge.diagnostics().project.stats.count>n,count,{timeout:35000});await audit('after-close');assert(rms()>.0001,'audio continues with editor closed');
 const expected=await p.evaluate(()=>({frames:bastardLoopBuffer.length,first:bastardLoopBuffer.getChannelData(0)[100],summary:bastardLoopMetadata.summary}));
 command('save-project');await until(()=>/PROJECT_SAVED=/.test(log),'DAW project saved');assert.match(log,/PROJECT_STATE_CHECKS_OK/);assert.match(log,/PROJECT_DIRTY_UI=/);const state=path.join(out,'saved-project.bin');fs.copyFileSync(raw+'.project.bin',state);
 // Reopen is the same running CEF instance, not an empty new browser.
 command('reopen-editor');await delay(500);assert.equal((await diag()).connected,true);assert.equal(await p.evaluate(()=>bastardLoopMetadata.summary),expected.summary);
 // Match the real app's clean URL: changing only #daw must not count as a reload.
 await p.evaluate(()=>history.replaceState(null,'',location.pathname));const previousDocument=await p.evaluate(()=>performance.timeOrigin);
 command('stop');await delay(400);command('cef-reload');await p.waitForEvent('framenavigated',{predicate:f=>f===p.mainFrame(),timeout:125000});
 await p.waitForFunction(()=>window.mygrainDawBridge&&document.documentElement.dataset.mygrainStartup==='ready',null,{timeout:90000});if(await p.locator('#start-btn').isVisible())await p.locator('#start-btn').click();await p.waitForFunction(()=>window.mygrainDawBridge?.connected&&mygrainDawBridge.diagnostics().project.ready&&!mygrainDawBridge.diagnostics().project.busy,null,{timeout:90000});assert.notEqual(await p.evaluate(()=>performance.timeOrigin),previousDocument,'reload must fetch a new document, not just change the URL fragment');assert.equal(await p.evaluate(()=>bastardLoopMetadata.summary),expected.summary);assert.equal((await diag()).project.auto.interval,15);
 await p.screenshot({path:path.join(out,'cef-embedded-app.png')});await close();
 fs.writeFileSync(control,'');const q=await run(state);assert.equal(await q.evaluate(()=>bastardLoopMetadata.summary),expected.summary);assert.equal(await q.evaluate(()=>bastardLoopBuffer.length),expected.frames);assert(Math.abs(await q.evaluate(()=>bastardLoopBuffer.getChannelData(0)[100])-expected.first)<.00005);assert.equal((await q.evaluate(()=>mygrainDawBridge.diagnostics())).project.auto.interval,15);await close();
 fs.writeFileSync(path.join(out,'cef-results.json'),JSON.stringify({first,expected,autoSaveWhileClosed:true,reloadRecall:true,freshNativeRecall:true,nativeAudio:true,nativeSurfaceInput:true},null,2));console.log('PASS real CEF, native PCM, closed-editor auto-save, safe reload, fresh DAW recall and clean unload');
}catch(error){if(browser){const p=browser.contexts()[0]?.pages()[0];if(p){await p.screenshot({path:path.join(out,'failed-native-input.png')}).catch(()=>{});const value=await p.evaluate(()=>({focused:document.activeElement?.id,username:document.querySelector('#mygrainLoginUsername')?.value,passwordLength:document.querySelector('#mygrainLoginPassword')?.value.length,url:location.href})).catch(()=>null);fs.writeFileSync(path.join(out,'failed-native-input.json'),JSON.stringify(value,null,2));}}throw error;}finally{for(const entry of fs.readdirSync(require('node:os').tmpdir()))if(entry.startsWith('mygrain-cef-')){const file=path.join(require('node:os').tmpdir(),entry,'profile','cef.log');if(fs.existsSync(file))fs.copyFileSync(file,path.join(out,entry+'-cef.log'));}if(exit===null&&child){command('quit');await delay(1000);child.kill();}if(browser)await browser.close().catch(()=>{});}})().catch(e=>{console.error(e);process.exitCode=1;});
