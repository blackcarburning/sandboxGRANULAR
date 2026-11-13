(function(root){
'use strict';
if(root.__mygrainSongRenderDeck||root.mygrainPhone||/iPhone|iPad|Android|iPod/i.test(navigator.userAgent))return;
const version='20261112-cef-preview-1',moduleContexts=new WeakMap();
let releaseTabLock=null,attachment=null,detachStateListener=null,reportedReady=null,automatic=false,autoStartTimer=null;
let liveStartPreparation=null,liveStartPrepared=false;
let mode='live',prepareController=null,prepared=false,switchingLive=false,switchingRendered=false,uploadId=0,awaitingUpload=0,rendering=false;
let source=null,destination=null,capture=null,worker=null,connected=false,connecting=false,muted=false,epoch=0,lastDisplay=0,lastClock=null,busy=false,connectionGeneration=0;
const card=document.createElement('details');card.id='dawBridgeCard';
card.innerHTML=`<summary>VST3 · Mac + Windows · Bridge + FX + CEF downloads <span class="daw-bridge-note">— preview</span></summary>
<p>Keep MYGRAIN in Chrome and stream the live patch into your DAW. macOS universal (Apple Silicon (ARM64) + Intel (x86_64)) and Windows x64; no virtual audio cable.</p>
<div class="daw-bridge-row"><a class="daw-bridge-download" href="mygrain-bridge-windows-0.8.0.zip" download>Windows · Bridge 0.8.0</a><a href="vst3-setup.html" target="_blank" rel="noopener">Bridge 0.8.0 setup</a></div>
<div class="daw-bridge-row"><a class="daw-bridge-download" href="mygrain-fx-windows-0.4.0.zip" download>Windows · FX 0.4.0</a><a href="vst3-setup.html#fx" target="_blank" rel="noopener">FX 0.4.0 setup</a></div>
<div class="daw-bridge-row"><a class="daw-bridge-download" href="mygrain-bridge-macos-0.8.0.zip" download>Mac · Bridge 0.8.0 · Apple Silicon (ARM64) + Intel (x86_64)</a><a class="daw-bridge-download" href="mygrain-fx-macos-0.4.0.zip" download>Mac · FX 0.4.0 · Apple Silicon (ARM64) + Intel (x86_64)</a><a href="vst3-setup.html#mac" target="_blank" rel="noopener">Mac / Bitwig · Bridge 0.8.0 + FX 0.4.0 setup</a></div>
<p><strong>Embedded Chromium plugins</strong> · the app opens inside the plugin, without a separate Chrome window.</p>
<div class="daw-bridge-row"><a class="daw-bridge-download" href="mygrain-cef-windows-0.1.4.zip" download>Windows · CEF instrument 0.1.4</a><a class="daw-bridge-download" href="mygrain-cef-macos-0.1.4.zip" download>Mac · CEF instrument 0.1.4 · Apple Silicon + Intel</a><a href="cef-setup.html" target="_blank" rel="noopener">CEF instrument 0.1.4 setup</a></div>
<div class="daw-bridge-row"><a class="daw-bridge-download" href="mygrain-cef-fx-windows-0.1.0.zip" download>Windows · CEF FX 0.1.0</a><a class="daw-bridge-download" href="mygrain-cef-fx-macos-0.1.0.zip" download>Mac · CEF FX 0.1.0 · Apple Silicon + Intel</a><a href="cef-fx-setup.html" target="_blank" rel="noopener">CEF FX 0.1.0 setup</a></div>
<p class="daw-bridge-note">Bridge plays MYGRAIN into your DAW as an instrument. FX processes incoming DAW audio using MYGRAIN’s effects; use the separate DAW Input panel to connect it. Each plugin needs its own MYGRAIN browser tab.</p>
<p><strong>Mac:</strong> extract the ZIP, close Bitwig, open Terminal in the extracted folder and run <code>./"Install MYGRAIN.command"</code> (capital I), then re-scan in Bitwig. See Mac / Bitwig setup above for folder and permission instructions. <strong>Windows:</strong> copy the <strong>whole MYGRAIN Bridge.vst3 folder</strong> into <code>C:\\Program Files\\Common Files\\VST3\\</code>, then re-scan VST3 plugins. Add MYGRAIN Bridge as an instrument and open Chrome from its window.</p>
<div class="daw-bridge-row"><label for="dawBridgeCode">Connection code</label><input id="dawBridgeCode" type="password" autocomplete="off" spellcheck="false" placeholder="Paste the code from the plugin"><button type="button" id="dawBridgeConnect">Connect</button><button type="button" id="dawBridgeDisconnect" disabled>Disconnect</button></div>
<div class="daw-bridge-row"><button type="button" id="dawBridgeArm" disabled>Arm · follow DAW</button><button type="button" id="dawBridgeStart" disabled>Start now / next bar</button><button type="button" id="dawBridgeStop" disabled>Stop / disarm</button></div>
<div class="daw-bridge-row"><label for="dawBridgeMode">Playback mode</label><select id="dawBridgeMode" disabled><option value="live">Live · edit while playing</option><option value="rendered">Rendered · follow DAW timeline</option></select></div>
<p id="dawBridgeModeHelp" class="daw-bridge-note"></p>
<div id="dawBridgeRenderControls" hidden><div class="daw-bridge-row"><label for="dawBridgeBars">Rendered loop length</label><select id="dawBridgeBars"><option>1</option><option>2</option><option selected>4</option><option>8</option><option>16</option></select><span>bars (4 beats each)</span><button type="button" id="dawBridgePrepare" disabled>Render / refresh loop</button></div><p class="daw-bridge-note">Stop the DAW, then render the current patch after one warm-up cycle. Refresh only when you want to replace this snapshot. Switching back to Rendered reuses the last render. Arm stays latched until Stop / disarm.</p></div>
<p id="dawBridgeStatus" role="status">Disconnected. Open Chrome from the plugin to connect automatically, or paste a code and Connect. Automatic patch storage defaults to every minute; save the DAW project normally.</p>
<p class="daw-bridge-note">Preview: physical Mac / Windows DAW testing pending. Live: buffered edits, real-time recording only. Rendered: immediate timeline playback, cycles and offline output from the retained loop; refresh after edits. No DAW automation. Automatic storage embeds the editable patch and, in Rendered mode, its last loop.</p>`;
const anchor=document.getElementById('manualBottomCard');if(!anchor)return;anchor.after(card);
const el=id=>document.getElementById(id),status=message=>{if(el('dawBridgeStatus').textContent!==message)el('dawBridgeStatus').textContent=message;};
const project=new root.MygrainProjectSession({kind:'bridge',card,blocked:()=>busy||rendering,
    settings:()=>({mode,bars:Number(el('dawBridgeBars').value)}),
    apply(settings,clock){cancelLiveStart();mode=settings.mode;el('dawBridgeBars').value=String(settings.bars);prepared=mode==='rendered'&&(clock?.projectRendered||clock?.loopFrames>0);switchingLive=switchingRendered=false;busy=false;stopCapture();stopPlayback();},
    changed:()=>controls()});
const remote=new root.MygrainDawRemote({ready:()=>project.ready&&!project.busy&&!busy&&!rendering&&!!capture&&source?.context.state==='running'&&!engineStarting&&!stateSaveSuspended,rendered:()=>mode==='rendered',renderedReady:()=>prepared,render:async()=>{const previous=uploadId;await prepareLoop();if(uploadId===previous)throw Error(el('dawBridgeStatus').textContent);const end=performance.now()+32000;while(awaitingUpload&&performance.now()<end){if(!connected)throw Error('Plugin disconnected during render.');await new Promise(r=>setTimeout(r,50));}if(awaitingUpload||!prepared)throw Error(el('dawBridgeStatus').textContent);},clock:()=>lastClock,project});
function controls(){
    const projectBusy=project.busy||!project.ready;
    el('dawBridgeConnect').disabled=connected||connecting||rendering;el('dawBridgeDisconnect').disabled=!connected&&!connecting;el('dawBridgeCode').disabled=connected||connecting;
    el('dawBridgeMode').value=mode;el('dawBridgeMode').disabled=!connected||busy||projectBusy;
    el('dawBridgeRenderControls').hidden=mode!=='rendered';
    el('dawBridgePrepare').disabled=!connected||busy||projectBusy||lastClock?.protocol!==2;
    el('dawBridgePrepare').title=lastClock?.protocol===2?'Capture the current patch before DAW playback.':'Requires plugin 0.3.0 or newer: replace the old bundle and re-scan.';
    el('dawBridgeBars').disabled=busy;
    for(const id of ['dawBridgeArm','dawBridgeStart'])el(id).disabled=!connected||busy||projectBusy||(mode==='rendered'&&!prepared);
    el('dawBridgeStop').disabled=!connected;
    el('dawBridgeModeHelp').textContent=mode==='live'
        ? 'Live: change sounds and effects while playing; no render needed. '+(lastClock?.continuousLive?'DAW loops and seeks keep MYGRAIN advancing without restarting it.':'Install plugin 0.3.0 for continuous playback through DAW loops and seeks, including hosts without cycle metadata.')+' The MYGRAIN pattern does not rewind with the DAW. First start uses a future bar; edits arrive after roughly 350 ms of buffering.'
        : 'Rendered: repeat the captured audio at the DAW’s musical position, including timeline zero. This is a snapshot: live edits are not heard until you refresh. Store MYGRAIN in project includes this render; then save the DAW project.';
}
function selectMode(next){
    if(!connected||busy||project.busy||!project.ready||!['live','rendered'].includes(next))return;
    cancelLiveStart();mode=next;stopCapture();stopPlayback();
    if(next==='live'){
        command('live');prepared=false;switchingLive=true;busy=true;
        status('Selecting Live. Arm to start at a future DAW bar.');
    }else if(lastClock?.selectRendered&&lastClock.loopFrames>0){
        command('rendered');prepared=false;switchingRendered=true;busy=true;
        status('Selecting the last rendered loop. No new render is needed. Enable track monitoring or Play if DAW processing is suspended.');
    }else{
        command(lastClock?.stickyArm?'rendered':'stop');prepared=lastClock?.prepared===true;
        status(prepared?'Rendered loop selected. Arm and Play in the DAW.':'Rendered selected. Stop the DAW, then Render / refresh loop.');
    }
    controls();
}

// A native Arm/Play does not pass through the browser's async arm() handler.
// Prepare every cold Q voice before starting any layer; never let Q join later.
function cancelLiveStart(){liveStartPreparation=null;liveStartPrepared=false;}
function prepareLiveStart(){
    if(liveStartPreparation)return;
    const plan={generation:connectionGeneration};liveStartPreparation=plan;
    status('Preparing all live layers before the next DAW bar…');
    (async()=>{
        if(root.mygrainQ?.playable())await root.mygrainQ.preparePlayback();
        if(liveStartPreparation!==plan||plan.generation!==connectionGeneration||!connected||mode!=='live')return;
        if(typeof prewarmTransportBuffers==='function')prewarmTransportBuffers();
        liveStartPrepared=true;
    })().catch(error=>{
        if(liveStartPreparation!==plan)return;
        command(lastClock?.stickyArm?'hold':'stop');
        status('Could not prepare live layers: '+error.message+'. Press Play to retry.');
    }).finally(()=>{
        if(liveStartPreparation!==plan)return;
        liveStartPreparation=null;
        if(liveStartPrepared&&lastClock)onClock(lastClock);
    });
}
function command(command){worker?.postMessage({type:'command',command});}
function stopCapture(){epoch=0;worker?.postMessage({type:'stopCapture'});}
function stopPlayback(){if(typeof stopAllPerformancePlayback==='function')stopAllPerformancePlayback({silent:true});}
function restoreMonitor(){
    if(muted&&source&&destination){try{source.connect(destination);}catch{}muted=false;}
}
function disconnect(message='Disconnected. Playback stopped.'){
    prepareController?.abort();if(autoStartTimer)clearTimeout(autoStartTimer);autoStartTimer=null;automatic=false;attachment=null;detachStateListener?.();detachStateListener=null;reportedReady=null;releaseTabLock?.();releaseTabLock=null;
    cancelLiveStart();remote.reset();project.reset();connectionGeneration++;connecting=false;connected=false;busy=false;prepared=false;switchingLive=false;switchingRendered=false;awaitingUpload=0;lastClock=null;stopCapture();
    worker?.postMessage({type:'disconnect'});worker?.terminate();worker=null;
    if(capture){try{source?.disconnect(capture);}catch{}capture.disconnect();capture=null;}
    stopPlayback();if(!rendering)restoreMonitor();controls();status(message+(rendering?' Finishing preparation cleanup before restoring local monitoring.':' Local monitoring restored.'));
}
async function acquireTabLock(port){
    if(!navigator.locks?.request)return ()=>{}; // The native listener also enforces exclusivity.
    return new Promise((resolve,reject)=>{
        navigator.locks.request('mygrain-daw-plugin-'+port,{ifAvailable:true},async lock=>{
            if(!lock){resolve(false);return;}
            await new Promise(release=>resolve(release));
        }).catch(reject);
    });
}
function maybeStartEngine(){
    if(!automatic||!connected)return;
    if(typeof isAudioGraphReady==='function'&&isAudioGraphReady())return;
    const button=el('start-btn');
    if(document.documentElement.dataset.mygrainStartup==='ready'&&button&&!button.disabled&&typeof engineStarting!=='undefined'&&!engineStarting)button.click();
    autoStartTimer=setTimeout(maybeStartEngine,250);
}
// A first automatic Start may be suspended by Chrome's autoplay policy.
// Resume during the next real gesture, even while Start is awaiting resume().
function unlockAutomaticAudio(event){
    if(event.isTrusted&&automatic&&connected&&typeof audioContext!=='undefined'&&audioContext?.state==='suspended')audioContext.resume().catch(()=>{});
}
for(const event of ['pointerdown','click','keydown'])document.addEventListener(event,unlockAutomaticAudio,true);
function reportReadiness(){
    const ready=!!(project.ready&&!project.busy&&!remote.audioBusy&&capture&&(source?.context.state==='running'||(mode==='rendered'&&prepared))&&typeof engineStarting!=='undefined'&&(reportedReady===true||(!engineStarting&&!stateSaveSuspended&&!root.mygrainCardHistory?.busy)));
    if(reportedReady!==ready){reportedReady=ready;command(ready?'ready':'not-ready');}
}
async function attachCapture(){
    if(attachment)return attachment;
    if(!connected||capture||!source||!destination||source.context.state==='closed'||!isAudioGraphReady())return;
    const attempt=connectionGeneration,ctx=source.context,output=source;
    attachment=(async()=>{
        if(!moduleContexts.has(ctx))moduleContexts.set(ctx,ctx.audioWorklet.addModule(new URL(`daw-bridge-worklet.js?v=${version}`,document.baseURI)).catch(error=>{moduleContexts.delete(ctx);throw error;}));
        await moduleContexts.get(ctx);
        if(attempt!==connectionGeneration||!connected||source!==output)return;
        stopPlayback();
        capture=new AudioWorkletNode(ctx,'mygrain-daw-capture-v1',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',processorOptions:{cefPreview:new URL(location.href).searchParams.get('mygrain_cef')==='1'}});
        capture.onprocessorerror=()=>disconnect('Audio capture stopped. Reconnect to try again.');
        output.connect(capture);capture.connect(destination);worker.postMessage({type:'port',port:capture.port},[capture.port]);
        try{output.disconnect(destination);muted=true;}catch(error){disconnect('Could not isolate Chrome monitoring: '+error.message);return;}
        const ready=()=>{if(attempt===connectionGeneration)reportReadiness();};ready();ctx.addEventListener('statechange',ready);detachStateListener=()=>ctx.removeEventListener('statechange',ready);
    })().catch(error=>{if(attempt===connectionGeneration)disconnect('Audio capture failed: '+error.message);}).finally(()=>{if(attempt===connectionGeneration)attachment=null;});
    return attachment;
}
async function connect(options={}){
    if(connected||connecting||rendering)return;
    if(root.mygrainDawFx?.connected||root.mygrainDawFx?.connecting){status('Disconnect MYGRAIN FX in this tab first, or open Bridge in a separate tab.');return;}
    const match=el('dawBridgeCode').value.trim().match(/^(187(?:3[1-9]|[45]\d|6[0-2]))\.([a-f0-9]{32})$/);
    if(!match){status('Paste the connection code copied from the MYGRAIN Bridge plugin.');return;}
    const attempt=++connectionGeneration;connecting=true;automatic=options.auto===true;controls();status('Connecting to the local Windows plugin…');
    try{
        const lease=await acquireTabLock(match[1]);
        if(!lease){connecting=false;automatic=false;controls();status('Another MYGRAIN tab already controls this plugin. Use that tab, or disconnect it first.');return;}
        if(attempt!==connectionGeneration){lease();return;}
        releaseTabLock=lease;
        worker=new Worker(new URL(`daw-bridge-worker.js?v=${version}`,document.baseURI));
        project.reset(worker);remote.reset(worker);
        worker.onerror=()=>disconnect('The local audio worker failed. Reconnect to try again.');
        worker.onmessage=({data})=>{
            if(attempt!==connectionGeneration)return;
            if(data.type==='remoteCommand'){remote.event(data);return;}
            if(data.type.startsWith('project')){project.event(data);return;}
            if(data.type==='connected'){
                connecting=false;connected=true;el('dawBridgeCode').value='';controls();
                status('Connected. Load a patch, then use the plugin’s green Arm or orange Play.');
                attachCapture();maybeStartEngine();
            }
            if(data.type==='failure')disconnect(data.message);
            if(data.type==='closed')disconnect('Plugin disconnected. Playback stopped.');
            if(data.type==='loopStored'&&data.id===awaitingUpload){
                awaitingUpload=0;busy=false;mode='rendered';prepared=true;if(!lastClock?.stickyArm)command('arm');controls();status('Rendered loop ready. Use green Arm if needed, then DAW Play: starts at the DAW position, including timeline zero. Select Live for editing without re-rendering.');
            }
            if(data.type==='loopRejected'&&data.id===awaitingUpload){awaitingUpload=0;busy=false;controls();status('Plugin could not adopt the loop yet. Enable track monitoring, then render again.');}
            if(data.type==='clock')onClock(data);
        };
        worker.postMessage({type:'connect',port:Number(match[1]),token:match[2]});
        setTimeout(()=>{if(attempt===connectionGeneration&&connecting)disconnect('Connection timed out. Open the plugin, copy a fresh code and allow Chrome local-network access if prompted.');},12000);
    }catch(error){if(attempt===connectionGeneration)disconnect('Connection failed: '+error.message);}
}
async function arm(manual){
    if(!connected||busy||project.busy||!project.ready)return;
    if(!source||!capture){status('Connected. Press Start MYGRAIN in Chrome once to enable audio.');return;}
    if(source.context.state!=='running')await source.context.resume();
    if(prepared){command(manual?'start':'arm');status(manual?'Auditioning the prepared loop.':'Prepared loop armed. Press Play in the DAW.');return;}
    busy=true;controls();status('Preparing the live patch…');const attempt=connectionGeneration;
    try{
        if(root.mygrainQ?.playable())await root.mygrainQ.preparePlayback();
        if(typeof prewarmTransportBuffers==='function')prewarmTransportBuffers();
        if(!connected||attempt!==connectionGeneration)return;
        command(manual?'start':'arm');status(manual?'Start requested. Waiting for the plugin clock…':'Armed. Press Play in the DAW; the plugin selects a future bar.');
    }catch(error){status('Could not arm: '+error.message);}
    finally{if(attempt===connectionGeneration){busy=false;controls();}}
}
function onClock(info){
    if(!Number.isFinite(info.rate)||info.rate<8000||!Number.isFinite(info.clock)||!Number.isInteger(info.epoch))return;
    const previous=lastClock;lastClock=info;project.observe(info);remote.observe(info);
    if(!project.ready||project.busy||remote.audioBusy){cancelLiveStart();reportReadiness();attachCapture();return;}
    if(previous?.protocol!==info.protocol||previous?.continuousLive!==info.continuousLive)controls();
    if(switchingLive){if(info.prepared)return;switchingLive=false;busy=false;controls();status('Live selected. Arm to start at a future DAW bar.');}
    if(switchingRendered){if(!info.prepared)return;switchingRendered=false;prepared=true;busy=false;controls();status('Last rendered loop selected. Arm and Play; no re-render needed.');}
    if(previous?.prepared!==info.prepared)controls();
    reportReadiness();
    if(info.browserReady&&!previous?.browserReady&&!busy&&!info.armed)status('Connected. Load a patch, then use the plugin’s green Arm or orange Play.');
    if(busy)return;
    if(!capture){attachCapture();status('Connected. Starting MYGRAIN… If Chrome requests it, press Start MYGRAIN once to enable audio.');return;}
    if(info.prepared||prepared){
        if(mode!=='rendered'||!prepared){mode='rendered';prepared=true;controls();}if(epoch){stopCapture();stopPlayback();}
        if(performance.now()-lastDisplay>250){lastDisplay=performance.now();status(info.musical===false?'Rendered loop: DAW musical position/tempo is missing. Enable host transport timing.':`Rendered loop · ${info.loopBeats||Number(el('dawBridgeBars').value)*4} beats · ${info.running?'playing from DAW timeline':info.armed?'armed, ready at timeline zero':'stopped'} · refresh after patch edits. Use Store, then DAW Save to keep this loop.`);}
        return;
    }
    if(mode==='rendered'){status('Rendered selected. Stop the DAW, then Render / refresh loop.');return;}
    if(info.active===false){cancelLiveStart();if(epoch){stopCapture();stopPlayback();}status('DAW processing is suspended. Enable track monitoring or playback, then arm again.');return;}
    if(info.offline){cancelLiveStart();if(epoch){stopCapture();stopPlayback();}status('Offline bounce is not supported. Use real-time recording/export.');return;}
    if(!info.target||!info.armed){cancelLiveStart();if(epoch){stopCapture();stopPlayback();status(info.armed?'Armed. Waiting for DAW playback.':'Stopped and disarmed. Chrome remains connected.');}return;}
    if(info.epoch!==epoch){
        if(liveStartPreparation)return;
        if(info.tempo<1||info.tempo>300||Math.abs(info.tempo-Math.round(info.tempo))>.0001){command(lastClock?.stickyArm?'hold':'stop');status('This preview requires a whole-number DAW tempo between 1 and 300 BPM.');return;}
        const ctx=source.context;
        if(ctx.state!=='running'){command(lastClock?.stickyArm?'hold':'stop');status('Chrome audio is suspended. Resume MYGRAIN, then arm again.');return;}
        if(!liveStartPrepared){
            stopCapture();stopPlayback();
            applyGlobalBpm(info.tempo,{preserveRates:false});
            prepareLiveStart();return;
        }
        stopCapture(); // Preserve the Q graph prepared above.
        const wait=(info.target-info.clock)/info.rate-info.leadMs/1000;
        if(wait<.15){command('start');status('Preparing a later bar: the previous start arrived too late.');return;}
        try{
            applyGlobalBpm(info.tempo,{preserveRates:false});
            const startFrame=Math.ceil((ctx.currentTime+wait)*ctx.sampleRate),startTime=startFrame/ctx.sampleRate;
            // Match Rendered/WAV: the transport origin precedes audible output
            // by the measured graph delay (compressor/oversampling). Capture the
            // audible origin, not the leading processing silence. Browser prefill
            // is already scheduled ahead; it is not an extra DAW PDC offset.
            const captureStartFrame=startFrame+Math.round(getTransportOutputLatencySeconds()*ctx.sampleRate);
            withBufferedTransportStart(startTime,()=>restartAllTransport({silent:true,skipSave:true,startTime,keyboardPlay:true}),{reset:true,exactStart:true,origin:startTime});
            liveStartPrepared=false;epoch=info.epoch;worker.postMessage({type:'capture',epoch,startFrame:captureStartFrame});
            status(info.musical?'Scheduled for a future DAW bar. Chrome monitoring is muted.':'Scheduled start: host musical position unavailable; bar alignment cannot be guaranteed.');
        }catch(error){command(lastClock?.stickyArm?'hold':'stop');stopCapture();stopPlayback();status('Start failed: '+error.message);}
    }
    if(performance.now()-lastDisplay>250&&info.running){
        lastDisplay=performance.now();status(`Live · ${info.continuousLive?'continuous through DAW loops/seeks · ':''}${Math.round(info.bufferMs)} ms buffer · ${Math.round(info.rate)} Hz DAW · ${Math.round(info.driftPpm)} ppm correction · ${info.underruns} underruns. Real-time recording only.`);
    }
}
async function prepareLoop(){
    if(!connected||busy||mode!=='rendered')return;
    if(!source||!capture){status('Start MYGRAIN before rendering.');return;}
    if(lastClock?.protocol!==2){status('Install plugin 0.3.0 or newer to prepare a DAW loop.');return;}
    if(lastClock.playing&&lastClock.active!==false){status('Stop the DAW before preparing a loop.');return;}
    if(root.mygrainCardHistory?.busy||root.mygrainSongBeta?.busy||root.mygrainSongBeta?.playing){status('Finish the current operation and stop Song playback first.');return;}
    const bars=Number(el('dawBridgeBars').value),bpm=lastClock.tempo;
    if(!Number.isInteger(bpm)||bpm<1||bpm>300){status('Prepare at a whole-number DAW tempo between 1 and 300 BPM.');return;}
    if(bars*4*60/bpm*source.context.sampleRate>4*1024*1024){status('That loop exceeds the 32 MiB limit. Choose fewer bars.');return;}
    const attempt=connectionGeneration,ctx=source.context,controller=new AbortController();prepareController=controller;busy=true;rendering=true;controls();command(lastClock?.stickyArm?'hold':'stop');stopCapture();stopPlayback();
    status(`Rendering ${bars} bars after one warm-up cycle. Keep this patch unchanged until ready…`);
    try{
        root.mygrainSongBetaAdapter?.assertNotRecording();
        applyGlobalBpm(bpm,{preserveRates:false});
        const result=await renderLiveOutputBarsBuffer({exportSteps:bars*16,loopWarmupCycles:1,signal:controller.signal});
        if(attempt!==connectionGeneration||!connected)return;
        const b=result.audioBuffer;if(!b.length||b.length>4*1024*1024)throw Error('Prepared audio exceeds 32 MiB.');
        const pcm=new Float32Array(b.length*2),left=b.getChannelData(0),right=b.getChannelData(Math.min(1,b.numberOfChannels-1));
        for(let i=0;i<b.length;i++){pcm[i*2]=left[i];pcm[i*2+1]=right[i];}
        awaitingUpload=++uploadId;
        worker.postMessage({type:'prepareLoop',id:awaitingUpload,rate:b.sampleRate,frames:b.length,beats:bars*4,bpm,buffer:pcm.buffer},[pcm.buffer]);
        status('Sending the prepared loop to the plugin…');
        const id=awaitingUpload;setTimeout(()=>{if(attempt===connectionGeneration&&awaitingUpload===id)disconnect('Loop upload timed out. Reconnect and prepare again.');},30000);
    }catch(error){if(attempt===connectionGeneration){awaitingUpload=0;busy=false;status('Could not prepare loop: '+error.message);}}
    finally{rendering=false;if(prepareController===controller)prepareController=null;if(source?.context===ctx)stopPlayback();if(attempt===connectionGeneration){if(!awaitingUpload)busy=false;}else if(!connected){restoreMonitor();status(el('dawBridgeStatus').textContent.replace(' Finishing preparation cleanup before restoring local monitoring.',' Local monitoring restored.'));}controls();}
}
el('dawBridgePrepare').addEventListener('click',prepareLoop);
el('dawBridgeMode').addEventListener('change',()=>selectMode(el('dawBridgeMode').value));
el('dawBridgeConnect').addEventListener('click',()=>connect());el('dawBridgeDisconnect').addEventListener('click',()=>disconnect());
el('dawBridgeArm').addEventListener('click',()=>arm(false));el('dawBridgeStart').addEventListener('click',()=>arm(true));
el('dawBridgeStop').addEventListener('click',()=>{cancelLiveStart();prepareController?.abort();command('stop');stopCapture();stopPlayback();status('Stopped and disarmed. Chrome remains connected.');});
root.addEventListener('pagehide',()=>{if(connected||connecting)disconnect();});
root.addEventListener('mygrain-account-lock',()=>{if(connected||connecting)disconnect('Account locked. DAW connection closed.');});
root.mygrainDawBridge={
    bindOutput(nextSource,nextDestination){if(source&&(connected||connecting))disconnect('Audio engine restarted. Connect to the plugin again.');if(source?.context!==nextSource.context)muted=false;source=nextSource;destination=nextDestination;source.connect(destination);if(connected)queueMicrotask(attachCapture);},
    disconnect,connect,arm,prepareLoop,selectMode,storeProject:()=>project.store(),restoreProject:()=>project.restore(),get connected(){return connected;},
    get needsAudio(){return connected&&(mode==='live'||rendering||project.busy);},
    diagnostics:()=>({remote:remote.diagnostics(),project:project.diagnostics(),mode,connected,connecting,muted,epoch,livePreparing:!!liveStartPreparation,prepared,awaitingUpload,rendering,busy,clock:lastClock?{...lastClock}:null})
};
if(/^#daw=/.test(location.hash)){
    const code=location.hash.slice(5);history.replaceState(null,'',location.pathname+location.search);
    if(/^187\d{2}\.[a-f0-9]{32}$/.test(code)){el('dawBridgeCode').value=code;card.open=true;queueMicrotask(()=>connect({auto:true}));}
}
controls();
})(window);
