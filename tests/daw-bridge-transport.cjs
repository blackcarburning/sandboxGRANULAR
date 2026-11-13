'use strict';
const {chromium}=require('playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs'),{spawn}=require('node:child_process');
const out=fs.readFileSync('/tmp/mygrain-vst3-transport-output','utf8').trim()+'/evidence',raw=out+'/transport-windows.f32',control=raw+'.control';
const plugin=process.env.MYGRAIN_TEST_PLUGIN||'/tmp/mygrain-bridge-win/MygrainBridge.vst3';
const liveWrapCount=Number(process.env.MYGRAIN_CYCLE_TEST_WRAPS||5);assert(liveWrapCount>=5&&liveWrapCount<=40);
const windows=p=>'Z:'+p.replaceAll('/','\\'),origin='https://openclaw.blackcarburning.com',local='http://127.0.0.1:19109';
try{fs.unlinkSync(control);}catch{}
(async()=>{
 const host=spawn('/usr/bin/env',['-i','PATH=/usr/bin:/bin','WINEPREFIX=/tmp/mygrain-vst3-wine-clean','WINEDEBUG=-all','xvfb-run','-a','/usr/lib/wine/wine64','/tmp/mygrain-bridge-win/bridge-windows-host.exe',windows(plugin),windows(raw),'150']);let log='',stderr='';host.stdout.on('data',c=>log+=c);host.stderr.on('data',c=>stderr+=c);
 const code=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Host start timeout: '+stderr)),8000);host.stdout.on('data',()=>{const m=log.match(/187\d{2}\.[a-f0-9]{32}/);if(m){clearTimeout(t);resolve(m[0]);}});host.on('exit',n=>{clearTimeout(t);reject(Error('Host exited '+n+': '+log+' '+stderr));});});
 fs.writeFileSync(control,'rewind');
 const browser=await chromium.launch({executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--host-resolver-rules=MAP openclaw.blackcarburning.com 127.0.0.1:19110']});
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1100}});assert.equal((await context.request.post(local+'/mygrain/api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);const cookies=await context.cookies(local);await context.addCookies(cookies.map(c=>({...c,domain:'openclaw.blackcarburning.com',secure:true})));
  const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));const cdp=await context.newCDPSession(p);await cdp.send('Browser.setPermission',{permission:{name:'local-network-access'},setting:'granted',origin});const response=await p.goto(origin+'/mygrain/#daw='+code);assert.equal(response.headers()['x-mygrain-isolated-test'],'vst3-19110');await p.waitForFunction(()=>window.mygrainDawBridge&&document.documentElement.dataset.mygrainStartup==='ready');await p.waitForFunction(()=>mygrainDawBridge.connected&&isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy,{},{timeout:20000});assert.equal(new URL(p.url()).hash,'');assert.equal(await p.locator('#dawBridgeCode').inputValue(),'');
  await p.evaluate(()=>{
   stopAllPerformancePlayback({silent:true});applyGlobalBpm(120);syncPatternLengthControls(16,{skipSave:true});setFxMuted(true,{silent:true});setFilterEnabled('lpf',false);setFilterEnabled('hpf',false);setDrumMachineEnabled(false,{silent:true,skipSave:true});mygrainNoise.restore({enabled:false});mygrainChannelEq.restore();
   const b=audioContext.createBuffer(2,Math.round(audioContext.sampleRate*2),audioContext.sampleRate);for(let ch=0;ch<2;ch++)for(let i=0;i<b.length;i++)b.getChannelData(ch)[i]=.15*Math.cos(2*Math.PI*(ch?223:110)*i/b.sampleRate);bastardLoopBuffer=b;bastardLoopSourceBpm=120;bastardLoopMetadata={bpm:120,durationSeconds:2};setBastardLoopEnabled(true,{silent:true,skipSave:true});setLoopLayerSolo('bastarda',{silent:true,skipSave:true});
   const original=renderLiveOutputBarsBuffer;window.renderLiveOutputBarsBuffer=async function(options){const result=await original(options);window.__preparedTestBuffer=result.audioBuffer;return result;};
  });
  await p.waitForFunction(()=>mygrainDawBridge.connected&&mygrainDawBridge.diagnostics().clock?.protocol===2,{},{timeout:15000});await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock.playing===false);
  assert.equal(await p.locator('#dawBridgeMode').inputValue(),'live');
  assert.equal(await p.locator('#dawBridgeRenderControls').isVisible(),false);
  await p.locator('#dawBridgeMode').selectOption('rendered');
  assert.equal(await p.locator('#dawBridgeArm').isDisabled(),true);
  fs.writeFileSync(control,'arm-plugin');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.armed);
  await p.locator('#dawBridgeBars').selectOption('1');await p.locator('#dawBridgePrepare').click();
  try{await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.prepared&&mygrainDawBridge.diagnostics().clock.armed,{},{timeout:22000});}catch(e){throw Error('Prepare failed: '+await p.locator('#dawBridgeStatus').textContent());}
  const ready=await p.evaluate(()=>{window.__readyChanges=[];let previous='';setInterval(()=>{const d=mygrainDawBridge.diagnostics(),v=JSON.stringify([d.clock?.armed,d.clock?.browserReady,d.clock?.running,d.clock?.active,audioContext.state,engineStarting,stateSaveSuspended]);if(v!==previous){__readyChanges.push({v,clock:d.clock?.clock});previous=v;}},50);return mygrainDawBridge.diagnostics();});assert.equal(ready.clock.target,0);assert.equal(ready.clock.loopBeats,4);assert.equal(ready.clock.running,false);
  const source=await p.evaluate(()=>({rate:__preparedTestBuffer.sampleRate,left:Array.from(__preparedTestBuffer.getChannelData(0)),right:Array.from(__preparedTestBuffer.getChannelData(1))}));
  fs.writeFileSync(control,'loop');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.cycleActive===true);fs.writeFileSync(control,'play');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.running);await p.waitForFunction(wrap=>mygrainDawBridge.diagnostics().clock?.cycleWraps>=wrap+4,ready.clock.cycleWraps,{timeout:12000});
  const cycling=await p.evaluate(()=>mygrainDawBridge.diagnostics());assert.equal(cycling.clock.underruns,0);assert.equal(cycling.clock.target,0);assert.equal(cycling.clock.loopRevision,ready.clock.loopRevision);
  fs.writeFileSync(control,'offline-setup');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.offline);const offlineStart=await p.evaluate(()=>mygrainDawBridge.diagnostics().clock.clock);await p.waitForFunction(n=>mygrainDawBridge.diagnostics().clock?.clock>n+48000,offlineStart);assert.equal(await p.evaluate(()=>mygrainDawBridge.diagnostics().clock.running),true,JSON.stringify(await p.evaluate(()=>({d:mygrainDawBridge.diagnostics(),changes:__readyChanges}))));
  fs.writeFileSync(control,'realtime-setup');await p.waitForFunction(()=>!mygrainDawBridge.diagnostics().clock?.offline);
  fs.writeFileSync(control,'rewind');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.playing===false&&mygrainDawBridge.diagnostics().clock.ppq===0);const stopped=await p.evaluate(()=>mygrainDawBridge.diagnostics().clock.clock);fs.writeFileSync(control,'play');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.running);
  const replay=await p.evaluate(()=>mygrainDawBridge.diagnostics());assert.equal(replay.clock.loopRevision,ready.clock.loopRevision);const preparedEnd=replay.clock.clock;
  // Switch back to the actual live browser patch; cycle wraps must not change
  // the epoch, stop the browser, or cause a new future-bar start.
  await p.locator('#dawBridgeMode').selectOption('live');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.prepared===false);await p.locator('#dawBridgeArm').click();await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.running,{},{timeout:12000});const liveStart=await p.evaluate(()=>mygrainDawBridge.diagnostics());
  fs.writeFileSync(control,'screenshot');
  // A duplicate tab is rejected BEFORE starting another audio engine.
  const duplicate=await context.newPage();await duplicate.goto(origin+'/mygrain/#daw='+code);await duplicate.waitForFunction(()=>window.mygrainDawBridge&&document.getElementById('dawBridgeStatus').textContent.includes('Another MYGRAIN tab'));assert.equal(await duplicate.evaluate(()=>mygrainDawBridge.connected),false);assert.equal(await duplicate.evaluate(()=>typeof audioContext==='undefined'||!audioContext),true);await duplicate.close();
  // A separate browser/profile cannot bypass native ownership protection.
  const WebSocket=require(require('node:path').join(require('node:path').dirname(require.resolve('playwright-core')),'lib/utilsBundle.js')).ws;
  await new Promise((resolve,reject)=>{const [port,token]=code.split('.'),socket=new WebSocket(`ws://127.0.0.1:${port}/stream?token=${token}`,{origin});socket.on('unexpected-response',(_,r)=>{try{assert.equal(r.statusCode,409);r.resume();socket.terminate();resolve();}catch(e){reject(e);}});socket.on('open',()=>reject(Error('Duplicate native connection accepted')));socket.on('error',()=>{});});
  assert.equal(await p.evaluate(()=>mygrainDawBridge.diagnostics().epoch),liveStart.epoch);await p.locator('#dawBridgeCard').screenshot({path:out+'/live-mode-card.png'});await p.waitForFunction(x=>mygrainDawBridge.diagnostics().clock?.cycleWraps>=x.start+x.count,{start:liveStart.clock.cycleWraps,count:liveWrapCount},{timeout:liveWrapCount*2000+6000});const liveEnd=await p.evaluate(()=>mygrainDawBridge.diagnostics());assert.equal(liveEnd.epoch,liveStart.epoch);assert.equal(liveEnd.clock.underruns,0);assert.equal(liveEnd.clock.overflows,0);assert.equal(await p.evaluate(()=>bastardLoopPlaying),true);
  // No cycle metadata at all: real host wraps must still preserve the live
  // stream. Then a manual seek must also leave the queue/epoch untouched.
  fs.writeFileSync(control,'loop-no-metadata');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.cycleActive===false);
  const noMetaStart=await p.evaluate(()=>mygrainDawBridge.diagnostics());
  await p.waitForFunction(n=>mygrainDawBridge.diagnostics().clock?.timelineJumps>=n+5,noMetaStart.clock.timelineJumps,{timeout:14000});
  const noMetaEnd=await p.evaluate(()=>mygrainDawBridge.diagnostics());assert.equal(noMetaEnd.epoch,liveStart.epoch);assert.equal(noMetaEnd.clock.underruns,0);assert.equal(noMetaEnd.clock.overflows,0);
  fs.writeFileSync(control,'seek');await p.waitForFunction(n=>mygrainDawBridge.diagnostics().clock?.timelineJumps>n,noMetaEnd.clock.timelineJumps,{timeout:4000});
  const seeked=await p.evaluate(()=>mygrainDawBridge.diagnostics());assert.equal(seeked.epoch,liveStart.epoch);assert.equal(seeked.clock.running,true);
  // Tweak the real live control WITHOUT rendering, while DAW cycles continue.
  const tweakStart=seeked.clock.clock,originalLevel=await p.locator('#performanceBastardLoopLevel').inputValue();
  await p.locator('#performanceBastardLoopLevel').evaluate(el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await p.waitForFunction(n=>mygrainDawBridge.diagnostics().clock?.clock>n+96000,tweakStart,{timeout:6000});
  const tweakEnd=await p.evaluate(()=>mygrainDawBridge.diagnostics().clock.clock);
  assert.equal(await p.evaluate(()=>mygrainDawBridge.diagnostics().clock.loopRevision),ready.clock.loopRevision);
  // Re-select the SAME rendered snapshot with the live level still at zero.
  // It must play the old audible snapshot immediately and not render again.
  await p.locator('#dawBridgeMode').selectOption('rendered');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.prepared&&!mygrainDawBridge.diagnostics().busy);
  await p.locator('#dawBridgeArm').click();await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.running);
  const cachedStart=await p.evaluate(()=>mygrainDawBridge.diagnostics());await p.locator('#dawBridgeCard').screenshot({path:out+'/rendered-mode-card.png'});assert.equal(cachedStart.clock.loopRevision,ready.clock.loopRevision);
  await p.waitForFunction(n=>mygrainDawBridge.diagnostics().clock?.clock>n+48000,cachedStart.clock.clock,{timeout:4000});
  const cachedEnd=await p.evaluate(()=>mygrainDawBridge.diagnostics());
  await p.locator('#performanceBastardLoopLevel').evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},originalLevel);
  // Cancellation must abort the existing PCM capture promptly, never upload a
  // stale snapshot, leave the transport running or strand Chrome monitoring.
  fs.writeFileSync(control,'rewind');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.playing===false&&mygrainDawBridge.diagnostics().clock.ppq===0);
  await p.locator('#dawBridgeBars').selectOption('4');await p.locator('#dawBridgePrepare').click();
  await p.waitForFunction(()=>mygrainDawBridge.diagnostics().rendering&&bastardLoopPlaying);
  fs.writeFileSync(control,'stop-plugin');await p.waitForFunction(()=>!mygrainDawBridge.diagnostics().clock?.armed);
  const cancelAt=Date.now();await p.locator('#dawBridgeDisconnect').click();await p.waitForFunction(()=>!mygrainDawBridge.diagnostics().rendering&&!mygrainDawBridge.diagnostics().muted,{},{timeout:2500});
  const cancelMs=Date.now()-cancelAt;assert.equal(await p.evaluate(()=>bastardLoopPlaying),false);assert.equal(await p.evaluate(()=>mygrainDawBridge.connected),false);
  fs.writeFileSync(control,'quit');const exit=await new Promise(resolve=>host.once('exit',resolve));assert.equal(exit,0,log+' '+stderr);assert.deepEqual(errors,[]);
  const pcm=fs.readFileSync(raw),rows=fs.readFileSync(raw+'.blocks.csv','utf8').trim().split(/\r?\n/).slice(1).map(line=>line.split(',').map(Number)),preparedRows=rows.filter(x=>x[0]>ready.clock.clock&&x[0]<preparedEnd&&x[3]);
  const first=preparedRows[0];assert.equal(first[1],0,'first prepared callback must be timeline zero');
  let maxError=0,compared=0,wrapsChecked=0;const total=source.left.length;
  for(let rowIndex=0;rowIndex<preparedRows.length;rowIndex++){
   const row=preparedRows[rowIndex];if(row[1]===0)wrapsChecked++;
   for(let j=0;j<128;j++)for(let ch=0;ch<2;ch++){
    const pos=((row[1]+j)%96000)/96000*total,a=Math.floor(pos)%total,b=(a+1)%total,f=pos-Math.floor(pos),samples=ch?source.right:source.left,expected=samples[a]+(samples[b]-samples[a])*f,actual=pcm.readFloatLE((row[0]+j)*8+ch*4);assert(Number.isFinite(actual));maxError=Math.max(maxError,Math.abs(expected-actual));compared++;
   }
  }
  assert(wrapsChecked>=5);assert(compared>48000*8);assert(maxError<.00001,'prepared source/timeline mismatch '+maxError);
  // Every live wrap block and its preceding block remain audible. No inserted
  // wait, fade-to-zero or queued-audio loss at cycle zero.
  const liveRows=rows.filter(x=>x[0]>liveStart.clock.clock+4800&&x[0]<liveEnd.clock.clock&&x[3]&&x[1]===0);assert(liveRows.length>=4);
  let minWrapRms=Infinity;for(const row of liveRows){let sum=0;for(let i=row[0]-128;i<row[0]+128;i++){const x=pcm.readFloatLE(i*8);sum+=x*x;}const rms=Math.sqrt(sum/256);assert(rms>1e-5,'live wrap muted');minWrapRms=Math.min(minWrapRms,rms);}
  const rms=(a,b)=>{let sum=0,n=0;for(let i=a;i<b;i++){const x=pcm.readFloatLE(i*8);assert(Number.isFinite(x));sum+=x*x;n++;}assert(n>10000);return Math.sqrt(sum/n);};
  const liveTweak={before:rms(tweakStart-48000,tweakStart-12000),after:rms(tweakEnd-24000,tweakEnd-1000),cached:rms(cachedEnd.clock.clock-24000,cachedEnd.clock.clock-1000)};
  assert(liveTweak.before>1e-5&&liveTweak.after<liveTweak.before*.05&&liveTweak.cached>1e-5,JSON.stringify(liveTweak));
  const noMetaRows=rows.filter(x=>x[0]>noMetaStart.clock.clock+4800&&x[0]<noMetaEnd.clock.clock&&x[3]&&x[1]===0);assert(noMetaRows.length>=4);
  for(const row of noMetaRows){let sum=0;for(let i=row[0]-128;i<row[0]+128;i++){const x=pcm.readFloatLE(i*8);sum+=x*x;}assert(Math.sqrt(sum/256)>1e-5,'missing-cycle-metadata wrap muted');}
  const report={noMetaStart,noMetaEnd,seeked,liveTweak,cachedStart,cachedEnd,missingMetadataWrapsChecked:noMetaRows.length,dllSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(plugin)).digest('hex'),ready,cycling,replay,liveStart,liveEnd,sourceRate:source.rate,preparedFirstCallbackProjectSample:first[1],preparedSamplesCompared:compared,preparedMaxError:maxError,preparedWrapsChecked:wrapsChecked,cancelMs,liveWrapsChecked:liveRows.length,minLiveWrapRms:minWrapRms,errors,hostLog:log.replace(code,'[ephemeral code]'),stderr};fs.writeFileSync(out+'/transport-windows.json',JSON.stringify(report,null,2));console.log('PASS actual Windows DLL and Chrome preparation: first callback at zero; '+wrapsChecked+' prepared wraps, '+liveRows.length+' live wraps, '+compared+' samples compared, max error '+maxError);assert(stopped>offlineStart);
 }finally{await browser.close();fs.writeFileSync(control,'quit');host.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
