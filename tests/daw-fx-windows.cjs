'use strict';
const {chromium}=require('playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const task=fs.readFileSync('/tmp/mygrain-fx-output','utf8').trim(),out=path.join(task,'evidence'),raw=out+'/fx-native.f32',control=raw+'.control';
const origin='https://openclaw.blackcarburning.com',local='http://127.0.0.1:19109',win=p=>'Z:'+p.replaceAll('/','\\'),plugin=process.env.MYGRAIN_FX_BINARY||'/tmp/mygrain-bridge-win/MygrainFX.vst3';
try{fs.unlinkSync(control);}catch{}
(async()=>{
 const host=spawn('/usr/bin/env',['-i','PATH=/usr/bin:/bin','WINEPREFIX=/tmp/mygrain-vst3-wine-clean','WINEDEBUG=-all','xvfb-run','-a','/usr/lib/wine/wine64','/tmp/mygrain-bridge-win/fx-windows-host.exe',win(plugin),win(raw),'150']);let log='',stderr='';host.stdout.on('data',b=>log+=b);host.stderr.on('data',b=>stderr+=b);
 const code=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Host start: '+log+stderr)),10000);host.stdout.on('data',()=>{const m=log.match(/187\d{2}\.[a-f0-9]{32}/);if(m){clearTimeout(t);resolve(m[0]);}});host.on('exit',n=>{clearTimeout(t);reject(Error('Host exit '+n+' '+log+stderr));});});
 const browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--host-resolver-rules=MAP openclaw.blackcarburning.com 127.0.0.1:19110']});
 const ranges={},snapshots={};
 try{
  const c=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1500,height:1120}});assert.equal((await c.request.post(local+'/mygrain/api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);await c.addCookies((await c.cookies(local)).map(v=>({...v,domain:'openclaw.blackcarburning.com',secure:true})));
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});const cdp=await c.newCDPSession(p);await cdp.send('Browser.setPermission',{permission:{name:'local-network-access'},setting:'granted',origin});
  const response=await p.goto(origin+'/mygrain/#fx='+code);assert.equal(response.headers()['x-mygrain-isolated-test'],'fx-19110');
  await p.waitForFunction(()=>window.mygrainDawFx?.connected&&isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&mygrainDawFx.diagnostics().clock?.browserReady,{},{timeout:30000});assert.equal(new URL(p.url()).hash,'');assert.equal(await p.locator('#dawFxCode').inputValue(),'');
  assert.equal(await p.evaluate(()=>mygrainDawBridge.connected),false);assert.equal(await p.evaluate(()=>mygrainDawFx.diagnostics().mutedMonitor),true);
  await p.evaluate(async()=>{stopAllPerformancePlayback({silent:true});setFxMuted(true,{silent:true});for(const id of ['lfoDepth','lfo2Depth','lfo3Depth']){setSliderValue(id,0);document.getElementById(id).dispatchEvent(new Event('input',{bubbles:true}));}setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);setDrumMachineEnabled(false,{silent:true,skipSave:true});mygrainNoise.restore({enabled:false});mygrainChannelEq.restore();await mygrainResonator.off();await mygrainTurntable.off();await mygrainWasp.restore(null);});
  await p.locator('#dawFxRoute').selectOption('direct');fs.writeFileSync(control,'arm-plugin');
  await p.waitForFunction(()=>mygrainDawFx.diagnostics().clock?.running,{},{timeout:12000});
  const frame=()=>p.evaluate(()=>mygrainDawFx.diagnostics().clock.clock);
  async function span(label,seconds=2){const start=await frame();await p.waitForFunction(f=>mygrainDawFx.diagnostics().clock.clock>f,start+seconds*48000,{timeout:(seconds+8)*1000});ranges[label]=[start+12000,await frame()];snapshots[label]=await p.evaluate(()=>mygrainDawFx.diagnostics());}
  await span('direct');
  await p.locator('#dawFxGain').evaluate(el=>{el.value='-6';el.dispatchEvent(new Event('input',{bubbles:true}));});await span('gainSettle',1.5);await span('gain');
  await p.locator('#dawFxMute').click();await span('muteSettle',1.5);await span('mute');
  await p.locator('#dawFxMute').click();await p.locator('#dawFxGain').evaluate(el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await p.locator('#dawFxRoute').selectOption('filters');await p.evaluate(()=>{setFilterEnabled('lpf',true);setSliderValue('lpfCutoff',90);setSliderValue('lpfQ',.707);updateEffects();});await span('filterSettle',2);await span('filtered');await p.evaluate(()=>setFilterEnabled('lpf',false));await span('filtersDrySettle',1.5);await span('filtersDry');
  await p.locator('#dawFxRoute').selectOption('master');await span('masterSettle',1.5);await span('master');
  await p.locator('#dawFxRoute').selectOption('final');await span('finalSettle',1.5);await span('final');
  await p.evaluate(()=>mygrainResonator.restore(MygrainResonator.normalize({enabled:true,slots:[{enabled:true,source:'all',object:'pipe',band:'full',level:.7,drive:20,length:1,pan:0},{enabled:false}]})));await span('resonatorSettle',1.5);await span('resonator');await p.evaluate(()=>mygrainResonator.off());
  await p.locator('#dawFxRoute').selectOption('direct');await span('routeSettle',1.5);
  fs.writeFileSync(control,'bypass');await p.waitForFunction(()=>mygrainDawFx.diagnostics().clock?.bypass===true);await span('bypass');fs.writeFileSync(control,'wet');await p.waitForFunction(()=>mygrainDawFx.diagnostics().clock?.bypass===false);
  fs.writeFileSync(control,'routing-change');await p.waitForFunction(()=>mygrainDawFx.diagnostics().clock?.armed===true&&mygrainDawFx.diagnostics().clock?.running,{},{timeout:10000});await span('routing',2);
  fs.writeFileSync(control,'state-roundtrip');await span('state',2);assert.equal(snapshots.state.clock.armed,true);
  // DAW loops/seeks do not re-index the FX sample stream.
  fs.writeFileSync(control,'loop-no-metadata');await span('loop',3);fs.writeFileSync(control,'seek');await span('seek',2);assert.equal(snapshots.seek.clock.armed,true);
  await p.locator('#dawFxMix').evaluate(el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});await span('drySettle',.5);await span('dry');
  await p.locator('#dawFxMix').evaluate(el=>{el.value='100';el.dispatchEvent(new Event('input',{bubbles:true}));});await span('wetSettle',.5);
  fs.writeFileSync(control,'silence');await span('silenceSettle',1.5);await span('silence');fs.writeFileSync(control,'input');await span('inputSettle',1.5);
  fs.writeFileSync(control,'stop-plugin');await p.waitForFunction(()=>mygrainDawFx.diagnostics().clock?.armed===false);await span('stopped',2);
  fs.writeFileSync(control,'arm-plugin');await p.waitForFunction(()=>mygrainDawFx.diagnostics().clock?.running,{},{timeout:10000});await span('rearmed',2);
  fs.writeFileSync(control,'offline');await p.waitForFunction(()=>mygrainDawFx.diagnostics().clock?.offline);await span('offline',2);assert.equal(snapshots.offline.clock.armed,true);fs.writeFileSync(control,'realtime');await p.waitForFunction(()=>mygrainDawFx.diagnostics().clock?.running,{},{timeout:10000});
  snapshots.browserRate=await p.evaluate(()=>audioContext.sampleRate);
  await p.locator('#dawInputCard').screenshot({path:out+'/fx-input-card.png'});fs.writeFileSync(control,'screenshot');await span('screenshot',.5);
  await p.locator('#dawFxDisconnect').click();assert.equal(await p.evaluate(()=>mygrainDawFx.connected),false);assert.equal(await p.evaluate(()=>mygrainDawFx.diagnostics().mutedMonitor),false);
  // Native dry continues without Chrome. Reconnect preserves the explicit Arm.
  await new Promise(resolve=>setTimeout(resolve,1600));
  await p.locator('#dawFxCode').fill(code);await p.locator('#dawFxConnect').click();await p.waitForFunction(()=>mygrainDawFx.diagnostics().clock?.running,{},{timeout:15000});assert.equal(await p.evaluate(()=>mygrainDawFx.diagnostics().clock.armed),true);await span('reconnect',2);
  // Same-tab Bridge is rejected before it can steal routing.
  await p.locator('#dawBridgeCard').evaluate(el=>el.open=true);await p.locator('#dawBridgeCode').fill(code);await p.locator('#dawBridgeConnect').click();assert.match(await p.locator('#dawBridgeStatus').textContent(),/Disconnect MYGRAIN FX/);assert.equal(await p.evaluate(()=>mygrainDawBridge.connected),false);
  await p.evaluate(()=>dispatchEvent(new Event('mygrain-account-lock')));assert.equal(await p.evaluate(()=>mygrainDawFx.connected),false);assert.match(await p.locator('#dawFxStatus').textContent(),/Account locked/);
  fs.writeFileSync(control,'quit');const exit=await new Promise(resolve=>host.once('exit',resolve));assert.equal(exit,0,log+stderr);assert.match(log,/LATENCY=48000/);assert.deepEqual(errors,[]);
  const pcm=fs.readFileSync(raw);const metrics=(range)=>{let sum=0,err=0,peak=0,n=0,dot=0,ref=0;for(let i=range[0];i<range[1]&&i*8+8<=pcm.length;i++){const l=pcm.readFloatLE(i*8),r=pcm.readFloatLE(i*8+4),f=i-48000,t=f/48000,expected=.1*Math.sin(2*Math.PI*173*t)+(f%48000===12345?.2:0);assert(Number.isFinite(l)&&Number.isFinite(r));dot+=l*expected;ref+=expected*expected;sum+=l*l;err+=(l-expected)**2;peak=Math.max(peak,Math.abs(l));n++;}return{rms:Math.sqrt(sum/n),alignedError:Math.sqrt(err/n),peak,frames:n,scale:dot/ref,normalisedAlignedError:Math.sqrt(Math.max(0,sum-dot*dot/ref)/n)};};
  const audio=Object.fromEntries(Object.entries(ranges).map(([name,r])=>[name,metrics(r)]));
  fs.writeFileSync(out+'/fx-windows-observed.json',JSON.stringify({plugin,ranges,snapshots,audio,errors,hostLog:log.replaceAll(code,'[ephemeral code]'),stderr},null,2));
  assert(audio.direct.rms>.05&&audio.direct.alignedError<.004,JSON.stringify(audio.direct));assert(audio.gain.rms/audio.direct.rms>.47&&audio.gain.rms/audio.direct.rms<.54,JSON.stringify(audio.gain));assert(audio.mute.rms<.0001,JSON.stringify(audio.mute));assert(audio.silence.rms<.0001,JSON.stringify(audio.silence));assert(audio.filtered.rms>1e-5&&audio.filtered.rms<audio.direct.rms*.7,JSON.stringify(audio.filtered));assert(audio.master.rms>audio.filtered.rms*1.5,JSON.stringify(audio.master));assert(audio.final.rms>.05&&audio.final.alignedError<.004,JSON.stringify(audio.final));assert(Math.abs(audio.resonator.rms/audio.final.rms-1)>.05,JSON.stringify(audio.resonator));for(const name of ['filtersDry','master'])assert(audio[name].scale>0&&audio[name].normalisedAlignedError<.002,JSON.stringify({name,...audio[name]}));for(const name of ['dry','stopped','offline','bypass'])assert(audio[name].alignedError<.001,JSON.stringify({name,...audio[name]}));
  for(const name of ['routing','loop','seek','rearmed','reconnect'])assert(audio[name].rms>.05,JSON.stringify({name,...audio[name]}));
  fs.writeFileSync(out+'/fx-windows.json',JSON.stringify({plugin,ranges,snapshots,audio,errors,hostLog:log.replaceAll(code,'[ephemeral code]'),stderr},null,2));console.log('PASS Windows FX DLL + Chrome real stereo, fixed PDC, gain, mute, filters, dry mix, routing/state/loop/seek/offline/reconnect/Stop',JSON.stringify(audio));
 }finally{await browser.close();fs.writeFileSync(control,'quit');host.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
