'use strict';
const {chromium}=require('playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs'),{spawn}=require('node:child_process');
const local='http://127.0.0.1:19109',origin='https://openclaw.blackcarburning.com',out=fs.readFileSync('/tmp/mygrain-vst3-output','utf8').trim()+'/evidence';
const raw=out+'/windows-dll.f32',control=raw+'.control',sustain=Number(process.env.MYGRAIN_STREAM_TEST_SECONDS||8);
assert(sustain>=6&&sustain<=600);
try{fs.unlinkSync(control);}catch{}
const windows=p=>'Z:'+p.replaceAll('/','\\');
(async()=>{
 const host=spawn('/usr/bin/env',['-i','PATH=/usr/bin:/bin','WINEPREFIX=/tmp/mygrain-vst3-wine-clean','WINEDEBUG=-all','xvfb-run','-a','/usr/lib/wine/wine64','/tmp/mygrain-bridge-win/bridge-windows-host.exe',windows('/tmp/mygrain-bridge-win/MygrainBridge.vst3'),windows(raw),String(sustain+65)]);
 let log='',stderr='';host.stdout.on('data',c=>log+=c);host.stderr.on('data',c=>stderr+=c);
 const code=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Windows host start timeout: '+stderr)),8000);host.stdout.on('data',()=>{const m=log.match(/187\d{2}\.[a-f0-9]{32}/);if(m){clearTimeout(t);resolve(m[0]);}});host.on('exit',n=>{clearTimeout(t);reject(Error('Windows host exited '+n+': '+log+' '+stderr));});});
 const browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--host-resolver-rules=MAP openclaw.blackcarburning.com 127.0.0.1:19110']});
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});
  assert.equal((await context.request.post(local+'/mygrain/api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
  const cookies=await context.cookies(local);
  await context.addCookies(cookies.map(c=>({...c,domain:'openclaw.blackcarburning.com',secure:true})));
  const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  const cdp=await context.newCDPSession(p);let localPermission;
  try{await cdp.send('Browser.setPermission',{permission:{name:'local-network-access'},setting:'granted',origin});localPermission='granted by test harness';}catch(e){localPermission=e.message;}
  const response=await p.goto(origin+'/mygrain/');assert.equal(response.headers()['x-mygrain-isolated-test'],'vst3-19110','DNS must resolve only to the isolated TLS fixture');await p.waitForFunction(()=>window.mygrainDawBridge&&document.documentElement.dataset.mygrainStartup==='ready');
  await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
  await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});applyGlobalBpm(120);setFxMuted(true,{silent:true});const b=audioContext.createBuffer(2,Math.round(audioContext.sampleRate*2),audioContext.sampleRate);for(let ch=0;ch<2;ch++)for(let i=0;i<b.length;i++)b.getChannelData(ch)[i]=.12*Math.sin(2*Math.PI*110*i/b.sampleRate);bastardLoopBuffer=b;bastardLoopSourceBpm=120;bastardLoopMetadata={bpm:120,durationSeconds:2};setBastardLoopEnabled(true,{silent:true,skipSave:true});setLoopLayerSolo('bastarda',{silent:true,skipSave:true});});
  await p.locator('#dawBridgeCard').evaluate(el=>el.open=true);
  await p.locator('#dawBridgeCode').fill(code);await p.locator('#dawBridgeConnect').click();
  try{await p.waitForFunction(()=>mygrainDawBridge.diagnostics().connected,{},{timeout:14000});}catch(e){throw Error('Windows DLL connection failed: '+await p.locator('#dawBridgeStatus').textContent()+'; permission='+localPermission);}
  await p.locator('#dawBridgeArm').click();await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.running,{},{timeout:15000});
  const first=await p.evaluate(()=>mygrainDawBridge.diagnostics());
  await p.waitForFunction(seconds=>mygrainDawBridge.diagnostics().clock?.received>seconds*48000,sustain,{timeout:(sustain+20)*1000});
  const running=await p.evaluate(()=>mygrainDawBridge.diagnostics());assert.equal(running.clock.underruns,0);assert.equal(running.clock.overflows,0);
  const tweakStart=running.clock.clock;
  const originalLevel=await p.locator('#performanceBastardLoopLevel').inputValue();
  await p.locator('#performanceBastardLoopLevel').evaluate(el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await p.waitForFunction(frame=>mygrainDawBridge.diagnostics().clock?.clock>frame+48000*2,tweakStart,{timeout:6000});
  const tweakEnd=await p.evaluate(()=>mygrainDawBridge.diagnostics().clock.clock);
  await p.locator('#performanceBastardLoopLevel').evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},originalLevel);
  // Exercise the actual native transport buttons, not browser substitutes.
  fs.writeFileSync(control,'stop-plugin');await p.waitForFunction(()=>!mygrainDawBridge.diagnostics().clock?.armed&&mygrainDawBridge.diagnostics().epoch===0);
  fs.writeFileSync(control,'stop');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.playing===false);
  fs.writeFileSync(control,'arm-plugin');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.armed===true);assert.equal(await p.evaluate(()=>mygrainDawBridge.diagnostics().clock.target),0);
  fs.writeFileSync(control,'play-plugin');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.running,{},{timeout:7000});
  const audition=await p.evaluate(()=>mygrainDawBridge.diagnostics());assert.equal(audition.clock.playing,false);assert(audition.clock.target>0);
  fs.writeFileSync(control,'arm-plugin');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.target===0&&mygrainDawBridge.diagnostics().epoch===0);assert.equal(await p.evaluate(()=>mygrainDawBridge.diagnostics().clock.armed),true);
  fs.writeFileSync(control,'play');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.running,{},{timeout:10000});
  // Actual host transport stop, play, seek and offline transitions.
  fs.writeFileSync(control,'stop');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.playing===false&&mygrainDawBridge.diagnostics().epoch===0);
  fs.writeFileSync(control,'play');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.running,{},{timeout:10000});
  const resumed=await p.evaluate(()=>mygrainDawBridge.diagnostics());assert(resumed.epoch>first.epoch);
  fs.writeFileSync(control,'seek');await p.waitForFunction(n=>mygrainDawBridge.diagnostics().clock?.timelineJumps>n,resumed.clock.timelineJumps,{timeout:4000});
  assert.equal(await p.evaluate(()=>mygrainDawBridge.diagnostics().epoch),resumed.epoch);assert.equal(await p.evaluate(()=>mygrainDawBridge.diagnostics().clock.running),true);
  const sought=await p.evaluate(()=>mygrainDawBridge.diagnostics());
  fs.writeFileSync(control,'offline');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.offline===true);assert.match(await p.locator('#dawBridgeStatus').textContent(),/Offline bounce/);
  assert.equal(await p.evaluate(()=>bastardLoopPlaying),false);
  fs.writeFileSync(control,'realtime');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.running,{},{timeout:10000});
  await p.locator('#dawBridgeDisconnect').click();assert.equal(await p.evaluate(()=>mygrainDawBridge.connected),false);
  fs.writeFileSync(control,'quit');
  const exit=await new Promise(resolve=>{host.once('exit',resolve);});assert.equal(exit,0,stderr+' '+log);
  assert.match(log,/PASS Windows DLL/);assert.deepEqual(errors,[]);
  const pcm=fs.readFileSync(raw),rms=(first,last)=>{let sum=0,n=0;for(let i=first;i<last&&i*8+4<=pcm.length;i++){const x=pcm.readFloatLE(i*8);assert(Number.isFinite(x));sum+=x*x;n++;}assert(n>10000);return Math.sqrt(sum/n);};
  const liveTweak={before:rms(tweakStart-48000,tweakStart-12000),after:rms(tweakEnd-24000,tweakEnd-1000)};
  assert(liveTweak.before>1e-5&&liveTweak.after<liveTweak.before*.05,JSON.stringify(liveTweak));
  const dllSha256=require('node:crypto').createHash('sha256').update(fs.readFileSync('/tmp/mygrain-bridge-win/MygrainBridge.vst3')).digest('hex');
  const report={nativeButtons:{armStopped:true,stopDisarmed:true,playAudition:audition,armCancelsAudition:true},liveTweak,dllSha256,sustainSeconds:sustain,localPermission,first,running,resumed,sought,errors,hostLog:log.replace(code,'[ephemeral code]'),stderr};
  fs.writeFileSync(out+'/windows-dll.json',JSON.stringify(report,null,2));console.log('PASS actual Windows release DLL: editor, Chrome PCM, start/stop/play/seek/offline, clean unload',JSON.stringify(running));
 }finally{await browser.close();fs.writeFileSync(control,'quit');host.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
