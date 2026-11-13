'use strict';
// Run against a real CEF helper and native VST3 host. No production account requests.
const {chromium}=require('playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const [hostExe,bundle,out]=process.argv.slice(2),app=path.resolve(process.env.MYGRAIN_CEF_APP_PATH||path.join(__dirname,'../..')),origin='https://openclaw.blackcarburning.com',delay=ms=>new Promise(r=>setTimeout(r,ms));
fs.mkdirSync(out,{recursive:true});
const loginPath=path.resolve(out,'private-login.dat');
const fixtureToken='cef_fixture_session_7_abcdefghijklmnopqrstuvwxyz';
const uploads=[];
const fx=process.env.MYGRAIN_CEF_FX_TEST==='1',api=fx?'mygrainDawFx':'mygrainDawBridge',fragment=fx?'fx':'daw';
function wavFixture(){const rate=48000,frames=rate*5,b=Buffer.alloc(44+frames*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*4,40);for(let i=0;i<frames;i++)for(let c=0;c<2;c++)b.writeInt16LE(Math.round(6500*Math.sin(2*Math.PI*(c?337:173)*i/rate)),44+i*4+c*2);return b;}
const previewWav=wavFixture();

async function until(fn,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await delay(100);}throw Error('Timeout '+label);}
const mime=p=>({'.html':'text/html','.js':'text/javascript','.cjs':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.webp':'image/webp','.wav':'audio/wav','.woff2':'font/woff2'}[path.extname(p)]||'application/octet-stream');
async function fixture(context,auth={signedIn:true,posts:0}){
 // Chromium AudioWorklet module fetches can bypass CDP request interception.
 // Pin the unchanged release module bytes in a same-origin blob instead of
 // accidentally executing the older production worklet during isolated tests.
 await context.addInitScript(source=>{
  const original=Worklet.prototype.addModule;
  Worklet.prototype.addModule=function(url,...args){
   const name=new URL(url,location.href).pathname.split('/').pop();
   if(source[name]){
    const blob=URL.createObjectURL(new Blob([source[name]],{type:'text/javascript'}));
    window.cefPinnedWorkletLoads=(window.cefPinnedWorkletLoads||0)+1;
    return original.call(this,blob,...args).finally(()=>URL.revokeObjectURL(blob));
   }
   return original.call(this,url,...args);
  };
 },Object.fromEntries(['daw-bridge-worklet.js','daw-fx-worklet.js'].map(n=>[n,fs.readFileSync(path.join(app,n),'utf8')])));
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin){await route.abort();return;}
  auth.signedIn=(route.request().headers().cookie||'').includes('mygrain_session='+fixtureToken);
  const n=decodeURIComponent(u.pathname.replace(/^\/mygrain\/?/,''))||'index.html';
  const headers={'x-mygrain-isolated-test':'cef-project','cache-control':'no-store'};
  if(n==='account-context.js'){await route.fulfill({headers,contentType:'text/javascript',body:'window.mygrainAccountContext='+JSON.stringify(auth.signedIn?{user:{username:'cef-fixture'}}:{user:null})+';'});return;}
  if(/^\/mygrain-(wavs|loopstore)\//.test(u.pathname)){
   if(route.request().method()==='POST'&&/\/api\/(upload|render-with-pattern)$/.test(u.pathname)){
    const bytes=route.request().postDataBuffer(),name=u.searchParams.get('filename');assert(bytes?.length>1000);assert.equal(route.request().headers()['x-mygrain-user'],'cef-fixture');
    const loop=u.pathname.includes('loopstore'),record={loop,name,bytes:bytes.length,file:path.join(out,(loop?'loopstore-export.wav':'wav-repo-export.zip'))};fs.writeFileSync(record.file,bytes);uploads.push(record);
    await route.fulfill({headers,contentType:'application/json',body:JSON.stringify({ok:true,savedName:name,patternExport:!loop,loopStore:{frames:48000,sampleRate:48000}})});return;
   }
   if(u.pathname.endsWith('/api/list')){await route.fulfill({headers,contentType:'application/json',body:JSON.stringify({ok:true,files:[{name:'cef-audition.wav',url:origin+'/mygrain-wavs/cef-audition.wav',size:previewWav.length,createdBy:'cef-fixture',modified:'2026-11-12T18:00:00Z'}]})});return;}
   if(u.pathname.endsWith('cef-audition.wav')){await route.fulfill({headers,contentType:'audio/wav',body:previewWav});return;}
   await route.fulfill({headers,contentType:'application/json',body:'{"ok":true,"files":[],"items":[]}'});return;
  }
  if(n==='api/auth/logout'){await route.fulfill({headers:{...headers,'set-cookie':'mygrain_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'},contentType:'application/json',body:'{"ok":true}'});return;}
  if(n==='api/auth/login'){
   const body=route.request().postDataJSON();assert.deepEqual(body,{username:'native-user7',password:'Aa7!@-z'});auth.signedIn=true;auth.posts++;
   await route.fulfill({headers:{...headers,'set-cookie':'mygrain_session='+fixtureToken+'; Path=/; Max-Age=7776000; HttpOnly; Secure; SameSite=Lax'},contentType:'application/json',body:JSON.stringify({ok:true,user:{username:'cef-fixture'}})});return;
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
let commandSerial=0;function command(c){fs.writeFileSync(control,c+'\n'+(++commandSerial));}
async function acknowledged(c,marker){const count=(log.match(new RegExp(marker,'g'))||[]).length;command(c);await until(()=>(log.match(new RegExp(marker,'g'))||[]).length>count,'native acknowledgement '+c,10000);await delay(80);}
async function toolbar(){await acknowledged('cef-toolbar','CEF_TOOLBAR=');return log.split('CEF_TOOLBAR=').pop().split('\n')[0];}
async function run(state,signedOutOnly=false){
 log='';exit=null;const argv=[bundle,raw,'300'];if(state)argv.push(state);
 child=spawn(hostExe,argv,{env:{...process.env,MYGRAIN_CEF_DEBUG_PORT:'19381',MYGRAIN_CEF_LOGIN_PATH:loginPath}});child.stdout.on('data',b=>{log+=b;process.stdout.write(b);});child.stderr.on('data',b=>fs.appendFileSync(raw+'.stderr',b));child.on('exit',n=>{exit=n;});
 await until(()=>/187\d{2}\.[a-f0-9]{32}/.test(log),'native code');code=log.match(/187\d{2}\.[a-f0-9]{32}/)[0];
 await until(async()=>{try{const r=await fetch('http://127.0.0.1:19381/json/version');return r.ok;}catch{return false;}},'real CEF debugger',45000);
 browser=await chromium.connectOverCDP('http://127.0.0.1:19381');const c=browser.contexts()[0];const auth={signedIn:false,posts:0};await fixture(c,auth);const p=c.pages()[0];
 await p.waitForURL(u=>u.href.startsWith(origin+'/mygrain/'));
 const savedCookies=await c.cookies(origin);assert.equal(savedCookies.some(x=>x.name==='mygrain_session'&&x.value===fixtureToken),!!state&&!signedOutOnly,'session imported into a fresh isolated helper');
 p.on('dialog',()=>{});
 const response=await p.goto(origin+'/mygrain/?mygrain_cef=1&account=login&cef_fixture='+Date.now()+'#'+fragment+'='+code);assert.equal(response.headers()['x-mygrain-isolated-test'],'cef-project');
 p.on('pageerror',e=>fs.appendFileSync(path.join(out,'page-errors.txt'),e.stack+'\n'));
 if(signedOutOnly){await p.locator('#mygrainLoginUsername').waitFor({state:'visible'});return p;}
 if(!state){
  const click=async selector=>{const box=await p.locator(selector).boundingBox();assert(box);command(`cef-click ${Math.round(box.x+box.width/2)} ${Math.round(box.y+box.height/2)}`);await delay(150);};
  const acknowledged=async(c,marker)=>{const count=(log.match(new RegExp(marker,'g'))||[]).length;command(c);await until(()=>(log.match(new RegExp(marker,'g'))||[]).length>count,'native input acknowledgement '+c,10000);await delay(30);};
  const key=(ch,code=0,mod=0)=>acknowledged(`cef-host-key ${ch} ${code} ${mod}`,'CEF_KEY=');
  const focus=state=>acknowledged('cef-host-focus '+state,'CEF_FOCUS=');
  await p.locator('#mygrainLoginUsername').waitFor({state:'visible'});await p.evaluate(async()=>{await document.fonts.ready;});await delay(500);await focus(1);await click('#mygrainLoginUsername');await p.waitForFunction(()=>document.activeElement.id==='mygrainLoginUsername');
  // Native window fallback before any host keyboard callback is delivered.
  command('cef-native-key 110 78');await p.waitForFunction(()=>document.querySelector('#mygrainLoginUsername').value==='n');
  await focus(1);
  for(const ch of 'ative-user8')await key(ch.charCodeAt(0));
  await p.waitForFunction(()=>document.querySelector('#mygrainLoginUsername').value==='native-user8');
  await key(97,0,4);for(const ch of 'native-user8')await key(ch.charCodeAt(0)); // Ctrl/Cmd+A uses Chromium's focused frame.
  await p.waitForFunction(()=>document.querySelector('#mygrainLoginUsername').value==='native-user8');
  await key(0,1);await key(55); // Backspace then 7.
  await p.waitForFunction(()=>document.querySelector('#mygrainLoginUsername').value==='native-user7');
  await focus(0);await key(88);await delay(150);
  assert.equal(await p.locator('#mygrainLoginUsername').inputValue(),'native-user7','blurred plugin must not consume host keys');
  await focus(1);await key(9,2); // Tab, not a mouse/CDP focus command.
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
 await p.waitForFunction(api=>window[api].connected&&window[api].diagnostics().project.ready&&isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy,api,{timeout:90000});
 assert.equal(await p.evaluate(()=>mygrainAccounts.user.username),'cef-fixture');if(state)assert.equal(auth.posts,0,'fresh instance must not submit credentials');
 return p;
}
async function close(){command('quit');if(browser){await browser.close().catch(()=>{});browser=null;}await until(()=>exit!==null,'native clean unload',15000);assert.equal(exit,0,log);fs.writeFileSync(path.join(out,'cef-native-host.log'),log);}
function rms(){const bytes=fs.readFileSync(raw);let power=0,n=0;for(let at=Math.max(0,bytes.length-48000*8);at+4<=bytes.length;at+=4){const v=bytes.readFloatLE(at);assert(Number.isFinite(v));power+=v*v;n++;}return Math.sqrt(power/Math.max(1,n));}
(async()=>{try{
 const p=await run();if(fx){await require('./fx_tests.cjs')({p,run,close,command,acknowledged,toolbar,rms,delay,until,out,raw,control,loginPath});return;}await until(()=>fs.existsSync(loginPath),'remembered session persisted');assert(!fs.readFileSync(loginPath).includes(Buffer.from('Aa7!@-z')),'never store the account password');command('stop');const diag=()=>p.evaluate(()=>mygrainDawBridge.diagnostics());
 const audit=async label=>{const value=await p.evaluate(async()=>{const a=audioContext.createAnalyser();a.fftSize=2048;finalAmplifierNode.connect(a);await new Promise(r=>setTimeout(r,150));const v=new Float32Array(2048);a.getFloatTimeDomainData(v);finalAmplifierNode.disconnect(a);return {audio:{state:audioContext.state,time:audioContext.currentTime,rate:audioContext.sampleRate,rms:Math.sqrt(v.reduce((sum,x)=>sum+x*x,0)/v.length)},visibility:document.visibilityState,bridge:mygrainDawBridge.diagnostics(),status:document.querySelector('#dawBridgeStatus')?.textContent};});value.nativeRms=rms();fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(value,null,2));};

 assert.equal((await diag()).project.auto.enabled,true);assert.equal((await diag()).project.auto.interval,60);
 await delay(400);assert.match(await toolbar(),/Auto-save: On/);
 await acknowledged('cef-auto','CEF_CONTROL=');await p.waitForFunction(()=>!mygrainDawBridge.diagnostics().project.auto.enabled);await delay(400);const pausedToolbar=await toolbar();assert.match(pausedToolbar,/Auto-save: Off/);assert.match(pausedToolbar,/Automatic storage paused;/);
 await acknowledged('cef-interval 14','CEF_CONTROL=');assert.equal((await diag()).project.auto.interval,60,'invalid interval must be rejected');
 await acknowledged('cef-interval 15','CEF_CONTROL=');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().project.auto.interval===15);
 await acknowledged('cef-auto','CEF_CONTROL=');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().project.auto.enabled);await delay(400);assert.match(await toolbar(),/Auto-save: On/);
 await acknowledged('cef-size-small','CEF_SIZE=');await acknowledged('cef-size-normal','CEF_SIZE=');
 // Verify the actual native editor input route, not just DevTools input.
 await p.evaluate(()=>{window.cefNativeClick=0;const b=document.createElement('button');b.id='cef-native-input-probe';b.textContent='Native input test';b.style.cssText='position:fixed;left:20px;top:90px;width:200px;height:40px;z-index:2147483647';b.onclick=()=>window.cefNativeClick++;document.body.append(b);});
 await delay(500);command('cef-click 60 110');await p.waitForFunction(()=>window.cefNativeClick===1,null,{timeout:10000});await p.locator('#cef-native-input-probe').evaluate(b=>b.remove());
 await acknowledged('screenshot','CEF_SCREENSHOT=');

 await p.evaluate(async()=>{stopAllPerformancePlayback({silent:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});applyGlobalBpm(120);syncPatternLengthControls(16,{skipSave:true});setFxMuted(true,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);setDrumMachineEnabled(false,{silent:true,skipSave:true});
  const b=audioContext.createBuffer(2,audioContext.sampleRate*4,audioContext.sampleRate);for(let c=0;c<2;c++)for(let i=0;i<b.length;i++)b.getChannelData(c)[i]=.15*Math.cos(2*Math.PI*(c?223:110)*i/b.sampleRate);bastardLoopBuffer=b;bastardLoopSourceBpm=120;bastardLoopMetadata={bpm:120,summary:'CEF isolated auto-save source',durationSeconds:4};setBastardLoopEnabled(true,{silent:true,skipSave:true});setLoopLayerSolo('bastarda',{silent:true,skipSave:true});

 });

 // Actual CEF dialogs, no Playwright accept() or replacement prompt().
 async function dialogReply(text,accept=true){
  await delay(350);await acknowledged('cef-dialog-state','CEF_DIALOG=');assert.notEqual(Number(log.split('CEF_DIALOG=').pop().split('\n')[0]),0,'a native dialog must be visible');
  await acknowledged(accept?'cef-dialog-ok '+text:'cef-dialog-cancel','CEF_DIALOG_REPLY=');
 }
 await p.evaluate(()=>{window.cefDialogResult='pending';setTimeout(()=>cefDialogResult=prompt('CEF filename probe','original'),0);});
 await dialogReply('native filename');await p.waitForFunction(()=>cefDialogResult==='native filename');
 await p.evaluate(()=>{window.cefDialogResult='pending';setTimeout(()=>cefDialogResult=confirm('CEF confirm probe'),0);});
 await dialogReply('',false);await p.waitForFunction(()=>cefDialogResult===false);
 await p.evaluate(()=>{window.cefDialogResult='pending';setTimeout(()=>cefDialogResult=prompt('CEF cancel probe','leave intact'),0);});
 await dialogReply('',false);await p.waitForFunction(()=>cefDialogResult===null);
 console.log('PASS native filename/confirm/cancel dialogs');
 // Render using the unchanged real capture engine, then accept the native naming
 // dialog and inspect the actual authenticated request body at an isolated sink.
 await p.evaluate(()=>{applyGlobalBpm(240);syncPerformanceExportBars(1,{skipSave:true});});
 for(const [selector,name] of [['#performanceRepoExportBtn','cef-native-wav'],['#performanceLoopStoreAddBtn','cef-native-loop']]){
  await p.evaluate(selector=>{setTimeout(()=>document.querySelector(selector).click(),0);},selector);
  if(selector==='#performanceRepoExportBtn'){
   await until(async()=>{await acknowledged('cef-dialog-state','CEF_DIALOG=');return Number(log.split('CEF_DIALOG=').pop().split('\n')[0])===2;},'native editable-patch confirmation',15000);
   await dialogReply('',true);
  }
  await until(async()=>{await acknowledged('cef-dialog-state','CEF_DIALOG=');return Number(log.split('CEF_DIALOG=').pop().split('\n')[0])===3;},'native repository filename prompt',45000);
  const before=uploads.length;await dialogReply(name);await until(()=>uploads.length>before,'real repository export upload',45000);
  await p.waitForFunction(selector=>!document.querySelector(selector).disabled,selector,{timeout:45000});
 }
 const uploadCount=uploads.length;
 await p.evaluate(()=>{setTimeout(()=>document.querySelector('#performanceLoopStoreAddBtn').click(),0);});
 await until(async()=>{await acknowledged('cef-dialog-state','CEF_DIALOG=');return Number(log.split('CEF_DIALOG=').pop().split('\n')[0])===3;},'cancellable repository prompt',45000);
 await dialogReply('',false);await p.waitForFunction(()=>!document.querySelector('#performanceLoopStoreAddBtn').disabled);assert.equal(uploads.length,uploadCount,'cancelled export cannot upload');
 await p.evaluate(()=>applyGlobalBpm(120));
 fs.writeFileSync(path.join(out,'native-repository-results.json'),JSON.stringify({uploads:uploads.map(({loop,name,bytes})=>({loop,name,bytes})),cancelPreventedUpload:true,nativeDialogs:true},null,2));
 // Stopped/disarmed HTMLMediaElement WAV preview: assert the native callback PCM,
 // not an upstream Web Audio analyser. Then exercise decoded Loop and another
 // standalone widget context, and the main-bus inline audition path.
 await acknowledged('stop-plugin','CEF_STOPPED=');command('stop');await delay(500);
 await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});openWavRepositoryBrowser();});
 const player=p.locator('#wavRepositoryBrowserList .wav-iphone-preview').first();await player.waitFor({state:'visible'});
 await player.locator('.wav-preview-play').click();await delay(1700);const wavRms=rms();assert(wavRms>.005,'WAV browser preview must reach disarmed native DAW output: '+wavRms);
 await player.locator('.wav-preview-play').click();await delay(1700);assert(rms()<.00001,'paused preview must become silent');
 await player.locator('.wav-preview-loop').click();await delay(1700);const loopRms=rms();assert(loopRms>.005,'decoded WAV loop must reach native output');
 await p.evaluate(()=>closeWavRepositoryBrowser());await delay(1700);assert(rms()<.00001,'closing WAV browser must stop preview');
 await p.evaluate(async()=>{window.cefWidgetContext=new AudioContext({sampleRate:44100});await cefWidgetContext.resume();const o=cefWidgetContext.createOscillator(),g=cefWidgetContext.createGain();g.gain.value=.08;o.connect(g);g.connect(cefWidgetContext.destination);o.start();});
 await delay(1700);const widgetRms=rms();assert(widgetRms>.005,'independent widget AudioContext must reach native output');await p.evaluate(()=>cefWidgetContext.close());await delay(1700);assert(rms()<.00001);
 await p.evaluate(()=>{const o=audioContext.createOscillator(),g=audioContext.createGain();g.gain.value=.08;o.connect(g);g.connect(finalAmplifierNode);o.start();window.cefInlineOsc=o;});
 await delay(1700);const inlineRms=rms();assert(await p.evaluate(()=>cefPinnedWorkletLoads>0),'exact release worklet must load');assert(inlineRms>.005,'inline main-bus audition must reach native output while disarmed');await p.evaluate(()=>cefInlineOsc.stop());await delay(1700);assert(rms()<.00001);
 fs.writeFileSync(path.join(out,'native-preview-results.json'),JSON.stringify({wavRms,loopRms,widgetRms,inlineRms,stopped:true,disarmed:true,pauseAndCloseSilence:true},null,2));
 console.log('PASS real WAV/decoded Loop/widget/inline previews at stopped-disarmed native output');
 // Graph-ready is not sample-load-ready. Auto-store deliberately defers while
 // startup loaders/history are busy; measure its interval after those settle.
 await p.waitForFunction(()=>!window.mygrainSongBeta?.busy&&!window.mygrainSongBeta?.playing&&!window.mygrainAiPatch?.busy&&!window.mygrainCardHistory?.busy&&!(typeof megaRandomizeInFlight!=='undefined'&&megaRandomizeInFlight)&&!(typeof hasPendingMegaRandomLoads==='function'&&hasPendingMegaRandomLoads()),null,{timeout:90000});
 // Interval was set through the actual native CEF toolbar, not the web UI.
 assert.equal((await diag()).project.auto.interval,15);
 console.log('AUTO_STORE_START',JSON.stringify(await diag()));
 command('arm-plugin');await delay(250);command('play');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock.running,null,{timeout:25000});await delay(1200);assert(rms()>.0001,'real native output must be audible');
 await p.waitForFunction(()=>mygrainDawBridge.diagnostics().project.stats.count>=1,null,{timeout:45000});const first=(await diag()).project;assert(first.stats.snapshotBytes>100000,'real source WAV must be stored');assert.equal(first.auto.interval,15);
 await delay(400);const toolbarStored=await toolbar();assert.match(toolbarStored,/Last store [0-9]/);assert.match(toolbarStored,/sent .*patch/);assert.match(toolbarStored,/Save your DAW project normally/);fs.writeFileSync(path.join(out,'native-toolbar-status.txt'),toolbarStored);
 const skipped=(await diag()).project.stats.skipped;await p.waitForFunction(n=>mygrainDawBridge.diagnostics().project.stats.skipped>n,skipped,{timeout:35000});
 await delay(400);assert.match(await toolbar(),/unchanged/);
 await acknowledged('cef-store','CEF_CONTROL=');await p.waitForFunction(n=>mygrainDawBridge.diagnostics().project.stats.count>n,first.stats.count,{timeout:45000});
 await acknowledged('screenshot','CEF_SCREENSHOT=');fs.copyFileSync(raw+(process.platform==='win32'?'.bmp':'.png'),path.join(out,'native-toolbar'+(process.platform==='win32'?'.bmp':'.png')));
 await audit('before-close');command('close-editor');await delay(500);const count=(await diag()).project.stats.count;await p.evaluate(()=>{bastardLoopMetadata.summary='CEF updated while native editor closed';});
 await p.waitForFunction(n=>mygrainDawBridge.diagnostics().project.stats.count>n,count,{timeout:35000});await audit('after-close');assert(rms()>.0001,'audio continues with editor closed');
 const expected=await p.evaluate(()=>({frames:bastardLoopBuffer.length,first:bastardLoopBuffer.getChannelData(0)[100],summary:bastardLoopMetadata.summary}));
 command('save-project');await until(()=>/PROJECT_SAVED=/.test(log),'DAW project saved');assert.match(log,/PROJECT_STATE_CHECKS_OK/);assert.match(log,/PROJECT_DIRTY_UI=/);const state=path.join(out,'saved-project.bin');fs.copyFileSync(raw+'.project.bin',state);const savedBytes=fs.readFileSync(state);assert(!savedBytes.includes(Buffer.from(fixtureToken))&&!savedBytes.includes(Buffer.from('Aa7!@-z')),'session and password must not be embedded in DAW projects');
 // Reopen is the same running CEF instance, not an empty new browser.
 command('reopen-editor');await delay(500);assert.equal((await diag()).connected,true);assert.equal(await p.evaluate(()=>bastardLoopMetadata.summary),expected.summary);
 // Match the real app's clean URL: changing only #daw must not count as a reload.
 await p.evaluate(()=>history.replaceState(null,'',location.pathname));const previousDocument=await p.evaluate(()=>performance.timeOrigin);
 command('stop');await delay(400);command('cef-reload');await p.waitForEvent('framenavigated',{predicate:f=>f===p.mainFrame(),timeout:125000});
 await p.waitForFunction(()=>window.mygrainDawBridge&&document.documentElement.dataset.mygrainStartup==='ready',null,{timeout:90000});if(await p.locator('#start-btn').isVisible())await p.locator('#start-btn').click();await p.waitForFunction(()=>window.mygrainDawBridge?.connected&&mygrainDawBridge.diagnostics().project.ready&&!mygrainDawBridge.diagnostics().project.busy,null,{timeout:90000});assert.notEqual(await p.evaluate(()=>performance.timeOrigin),previousDocument,'reload must fetch a new document, not just change the URL fragment');assert.equal(await p.evaluate(()=>bastardLoopMetadata.summary),expected.summary);assert.equal((await diag()).project.auto.interval,15);
 await p.screenshot({path:path.join(out,'cef-embedded-app.png')});await close();
 fs.writeFileSync(control,'');const q=await run(state);assert.equal(await q.evaluate(()=>bastardLoopMetadata.summary),expected.summary);assert.equal(await q.evaluate(()=>bastardLoopBuffer.length),expected.frames);assert(Math.abs(await q.evaluate(()=>bastardLoopBuffer.getChannelData(0)[100])-expected.first)<.00005);assert.equal((await q.evaluate(()=>mygrainDawBridge.diagnostics())).project.auto.interval,15);// Explicit logout clears the remembered session, including after a full unload.
 await q.evaluate(()=>fetch('/mygrain/api/auth/logout',{method:'POST'}));await until(()=>!fs.existsSync(loginPath),'remembered session removed on logout',5000);await close();
 fs.writeFileSync(control,'');await run(state,true);await close();assert(!fs.existsSync(loginPath));
 fs.writeFileSync(path.join(out,'native-session-results.json'),JSON.stringify({loginRememberedAcrossFullUnload:true,freshIsolatedProfile:true,noPasswordStored:true,logoutForgotten:true},null,2));
 fs.writeFileSync(path.join(out,'cef-results.json'),JSON.stringify({first,expected,nativeToolbar:true,nativeAutoToggle:true,nativeInterval:true,unchangedSkipped:true,manualStore:true,autoSaveWhileClosed:true,reloadRecall:true,freshNativeRecall:true,nativeAudio:true,nativeSurfaceInput:true},null,2));console.log('PASS real CEF, native PCM, closed-editor auto-save, safe reload, fresh DAW recall and clean unload');
}catch(error){if(browser){const p=browser.contexts()[0]?.pages()[0];if(p){await p.screenshot({path:path.join(out,'failed-native-input.png')}).catch(()=>{});const value=await p.evaluate(()=>({focused:document.activeElement?.id,username:document.querySelector('#mygrainLoginUsername')?.value,passwordLength:document.querySelector('#mygrainLoginPassword')?.value.length,url:location.href,bridge:window.mygrainDawBridge?.diagnostics(),capture:{songBusy:window.mygrainSongBeta?.busy,songPlaying:window.mygrainSongBeta?.playing,aiBusy:window.mygrainAiPatch?.busy,historyBusy:window.mygrainCardHistory?.busy,engineStarting:typeof engineStarting!=='undefined'&&engineStarting,stateSaveSuspended:typeof stateSaveSuspended!=='undefined'&&stateSaveSuspended,mega:typeof megaRandomizeInFlight!=='undefined'&&megaRandomizeInFlight,pendingLoads:typeof hasPendingMegaRandomLoads==='function'&&hasPendingMegaRandomLoads()},projectStatus:document.querySelector('.daw-project-status')?.textContent})).catch(()=>null);fs.writeFileSync(path.join(out,'failed-native-input.json'),JSON.stringify(value,null,2));}}throw error;}finally{for(const entry of fs.readdirSync(require('node:os').tmpdir()))if(entry.startsWith('mygrain-cef-')){const file=path.join(require('node:os').tmpdir(),entry,'profile','cef.log');if(fs.existsSync(file))fs.copyFileSync(file,path.join(out,entry+'-cef.log'));}if(exit===null&&child){command('quit');await delay(1000);child.kill();}if(browser)await browser.close().catch(()=>{});}})().catch(e=>{console.error(e);process.exitCode=1;});
