(function(root){
'use strict';
if(root.__mygrainSongRenderDeck||root.mygrainPhone||/iPhone|iPad|Android|iPod/i.test(navigator.userAgent))return;
const version='20261111-auto-1',modules=new WeakMap();
let graph=null,input=null,returned=null,gain=null,worker=null,connected=false,connecting=false,mutedMonitor=false,releaseLock=null,lastClock=null,attempt=0,attaching=false,automatic=false,startTimer=null,readySent=null,stateListener=null,generators=false,mute=false,mixTouched=false,latencyFrames=null,generatorRequest=0,effectsOnly=false,priorPlayback=null,preparing=false,clockTempo=null,transportStart=null,externalRoute=null,releaseAcousticFeed=null;
const layerGateCache=new WeakMap(),layerGateRefs=new Set();
function* layerGates(){for(const ref of layerGateRefs){const node=ref.deref();if(!node||node.context.state==='closed'){node?.disconnect();layerGateRefs.delete(ref);}else yield node;}}
const card=document.createElement('details');card.id='dawInputCard';card.className='daw-fx-card';
card.innerHTML=`<summary><span>DAW INPUT <small>MYGRAIN FX · stereo send / return</small></span><span class="daw-fx-chip">MAC + WINDOWS</span></summary>
<div class="daw-fx-body"><p class="daw-fx-intro">Your DAW track. MYGRAIN’s effects. Back into your session.</p>
<div class="daw-fx-links"><a href="mygrain-fx-windows-0.4.0.zip" download>Windows · FX 0.4.0</a><a href="mygrain-fx-macos-0.4.0.zip" download>Mac · FX 0.4.0 · Apple Silicon (ARM64) + Intel (x86_64)</a><a href="vst3-setup.html#mac" target="_blank" rel="noopener">Mac / Bitwig · FX 0.4.0 setup</a><a href="vst3-setup.html#fx" target="_blank" rel="noopener">FX 0.4.0 install &amp; routing guide</a></div>
<div class="daw-fx-links"><a href="mygrain-cef-fx-windows-0.1.0.zip" download>Windows · CEF FX 0.1.0</a><a href="mygrain-cef-fx-macos-0.1.0.zip" download>Mac · CEF FX 0.1.0 · Apple Silicon + Intel</a><a href="cef-fx-setup.html" target="_blank" rel="noopener">CEF FX 0.1.0 · embedded app setup</a></div>
<p class="daw-fx-note">CEF FX opens MYGRAIN inside the plugin; no separate Chrome window or connection code. The connection controls below are for the external-Chrome FX plugin.</p>
<p class="daw-fx-note">Add <strong>MYGRAIN FX as a stereo insert effect</strong> on the track you want to process. Open Chrome from its window, or paste its code below. This is separate from the MYGRAIN Bridge instrument.</p>
<div class="daw-fx-connect"><input id="dawFxCode" type="password" aria-label="MYGRAIN FX connection code" autocomplete="off" spellcheck="false" placeholder="Connection code from MYGRAIN FX"><button id="dawFxConnect" type="button">Connect FX</button><button id="dawFxDisconnect" type="button" disabled>Disconnect</button></div>
<div class="daw-fx-grid"><div class="daw-fx-panel"><div class="daw-fx-label">01 / INPUT</div><div class="daw-fx-meters"><meter id="dawFxLeft" min="0" max="1" value="0" aria-label="DAW input left"></meter><meter id="dawFxRight" min="0" max="1" value="0" aria-label="DAW input right"></meter></div>
<label for="dawFxGain">Input gain <output id="dawFxGainValue">0 dB</output></label><input id="dawFxGain" type="range" min="-24" max="12" value="0" step="1"><button id="dawFxMute" type="button" aria-pressed="false">Mute input</button></div>
<div class="daw-fx-panel"><div class="daw-fx-label">02 / ROUTING</div><label for="dawFxRoute">Send DAW audio through</label><select id="dawFxRoute"><option value="filters">Filters + main / final effects</option><option value="master">Master chain · after input filters</option><option value="final">Turntable / R / Wasp final stage</option><option value="direct">Direct return · no processing</option></select>
<p class="daw-fx-note">Choose “VST3 FX” in WireWorld, Sonic Crystal or Bubble Chamber, or “DAW / FX plugin input” in Bass Face or Mutilator to process this audio. Direct bypasses these processors. Uses the existing effects settings. R receives this input with source “All”. <strong>Arm is effects-only:</strong> DAW Play runs the patch’s enabled sources silently for modulation. Wasp routes process the DAW input; other layers are not mixed into the return. Stop / dry or Disconnect restores normal layer routing.</p><p id="dawFxClock" class="daw-fx-note">DAW clock · waiting for connection</p></div>
<div class="daw-fx-panel"><div class="daw-fx-label">03 / RETURN</div><label for="dawFxMix">Dry / wet <output id="dawFxMixValue">100% wet</output></label><input id="dawFxMix" type="range" min="0" max="100" value="100"><p class="daw-fx-note">Time-aligned dry/wet in the plugin. Fixed <strong>1,000 ms</strong> transport delay reported to the DAW for compensation.</p><div class="daw-fx-actions"><button class="daw-fx-arm" id="dawFxArm" type="button" disabled>▶ Arm FX</button><button class="daw-fx-stop" id="dawFxStop" type="button" disabled>■ Stop / dry</button></div></div></div>
<p id="dawFxStatus" class="daw-fx-status" role="status">Disconnected. Open MYGRAIN FX on your DAW track to connect.</p><p class="daw-fx-note">Creative-processing preview · real-time recording/export only. Bypass, Stop, missing returns and disconnect use delayed dry audio. Chrome is not an audible monitor. Keep DAW monitoring on; never route this return back into its own input. One FX instance per MYGRAIN tab; Bridge and FX cannot share a tab. Store MYGRAIN in project embeds this editable patch, sounds and input gain/routing; then save the DAW project. These input controls remain separate from Song content.</p></div>`;
const anchor=document.getElementById('dawBridgeCard')||document.getElementById('manualBottomCard');if(!anchor)return;anchor.after(card);
const jumpGrid=document.querySelector('#sectionJumpPanel .section-jump-grid');
if(jumpGrid){const jump=document.createElement('button');jump.id='sectionJumpDawInputBtn';jump.type='button';jump.className='section-jump-option daw-fx-jump';jump.dataset.jumpTarget='#dawInputCard';jump.setAttribute('aria-label','Jump to DAW Input');const label=document.createElement('span');label.className='jump-button-label';label.textContent='DAW\nInput';jump.append(label);jump.onclick=()=>{card.open=true;root.mygrainDisplay?.reveal(card);root.mygrainJumpToButton(jump);};const exportJump=jumpGrid.querySelector('[data-jump-target="#dawExportCard"]');if(exportJump)exportJump.after(jump);else jumpGrid.append(jump);root.mygrainNavigation?.refresh(jump);}
const el=id=>document.getElementById(id),command=value=>worker?.postMessage({type:'command',command:value});
function status(text){if(el('dawFxStatus').textContent!==text)el('dawFxStatus').textContent=text;}
const project=new root.MygrainProjectSession({kind:'fx',card,blocked:()=>attaching||preparing,
    settings:()=>({gainDb:Number(el('dawFxGain').value),mute,route:el('dawFxRoute').value}),
    apply(settings){el('dawFxGain').value=String(settings.gainDb);mute=settings.mute;el('dawFxMute').setAttribute('aria-pressed',String(mute));el('dawFxMute').textContent=mute?'Unmute input':'Mute input';el('dawFxRoute').value=settings.route;applyGain();route();},
    changed:()=>controls()});
const remote=new root.MygrainDawRemote({ready:()=>project.ready&&!project.busy&&!attaching&&!preparing&&!!input&&graph?.source.context.state==='running'&&!engineStarting&&!stateSaveSuspended,rendered:()=>false,renderedReady:()=>false,clock:()=>lastClock,project});
function controls(){el('dawFxConnect').disabled=connected||connecting;el('dawFxDisconnect').disabled=!connected&&!connecting;el('dawFxCode').disabled=connected||connecting;for(const id of ['dawFxArm','dawFxStop'])el(id).disabled=!connected||(!project.ready||project.busy)&&id==='dawFxArm';el('dawFxMix').disabled=!connected;el('dawFxArm').textContent=lastClock?.armed?'▶ FX armed':'▶ Arm FX';}
// These gates are downstream of the Wasp/Playground/Noise detection taps.
// They never write a layer slider, mute, solo, source setting or saved patch.
function layerInput(destination){
    if(!destination||typeof destination.context.startRendering==='function')return destination;
    if(!layerGateCache.has(destination)){const node=destination.context.createGain();node.gain.value=effectsOnly?0:1;node.connect(destination);layerGateCache.set(destination,node);layerGateRefs.add(new WeakRef(node));}
    return layerGateCache.get(destination);
}
function stopGenerators(){
    if(!generators&&!preparing)return;
    generatorRequest++;preparing=false;
    if(generators&&typeof stopAllPerformancePlayback==='function')stopAllPerformancePlayback({silent:true});
    generators=false;
    if(transportStart!==null)root.mygrainWasp?.syncExternalTransport({playing:false,startTime:transportStart});
}
function setEffectsOnly(value,{resumePlayback=true}={}){
    if(effectsOnly===value)return;
    if(value){
        priorPlayback={sequencer:sequencerPlaying,loops:bastardLoopPlaying,drums:drumMachinePlaying,arp:keyboardArpTransportPlaying||isArpeggiatorPlaying(),keys:activeKeyCount>0,q:!!root.mygrainQ?.running,noise:!!root.mygrainNoise?.running};
        effectsOnly=true;transportStart=graph.source.context.currentTime;root.mygrainWasp?.syncExternalTransport({playing:false,startTime:transportStart});
        for(const node of layerGates()){const now=node.context.currentTime;node.gain.cancelScheduledValues(now);node.gain.setTargetAtTime(0,now,.008);}
        stopAllPerformancePlayback({silent:true});
    }else{
        stopGenerators();effectsOnly=false;clockTempo=null;transportStart=null;
        root.mygrainWasp?.syncExternalTransport(null);
        const resume=priorPlayback;priorPlayback=null;
        // Restore routing without altering settings, including any intentional
        // patch edits made while armed. Resume only the transports running before Arm.
        if(resumePlayback&&resume&&isAudioGraphReady()&&graph?.source.context.state==='running'){
            try{withBufferedTransportStart(null,()=>{const at=transportSync.startTime;if(resume.sequencer)startSequencer(at);if(resume.loops)startAllBastardLoopLayers(at,{silent:true,skipUi:true});if(resume.drums)startDrumMachine(at,{silent:true,skipUi:true});if(resume.arp)playLoopAndHeldKeys({silent:true});else if(resume.keys)startHeldKeyboardPlayback(at);if(resume.q&&!resume.loops)root.mygrainQ?.start(at,{origin:at});if(resume.noise)root.mygrainNoise?.start(at);},{reset:true});}catch(e){console.warn('FX layer routing restored; prior playback could not resume:',e.message);}
        }
        for(const node of layerGates()){const now=node.context.currentTime;node.gain.cancelScheduledValues(now);node.gain.setTargetAtTime(1,now,.008);}
    }
    root.mygrainWasp?.syncExternal();root.mygrainWasp?.syncTempo();root.mygrainResonator?.syncExternalInput();root.mygrainAcousticFx?.syncExternalInput();root.mygrainResonator?.syncTempo();
    if(isAudioGraphReady())updateEffects();
}
async function syncClock(){
    if(!input||!connected||!lastClock||!project.ready||project.busy||remote.audioBusy||!isAudioGraphReady())return;
    setEffectsOnly(!!lastClock.armed);
    if(!effectsOnly){el('dawFxClock').textContent='DAW clock · normal layer routing';return;}
    const valid=lastClock.musical&&Number.isFinite(lastClock.tempo)&&lastClock.tempo>=1&&lastClock.tempo<=300;
    const tempo=valid?lastClock.tempo:null;
    const changed=tempo!==clockTempo;
    if(changed){stopGenerators();clockTempo=tempo;root.mygrainWasp?.syncTempo();root.mygrainResonator?.syncTempo();updateEffects();}
    el('dawFxClock').textContent=(tempo?'DAW clock · '+tempo+' BPM':'DAW musical clock unavailable · patch BPM')+' · layers silent · '+(generators?'modulation running':'waiting for DAW Play');
    const running=lastClock.playing&&lastClock.active&&!lastClock.offline&&!lastClock.bypass&&lastClock.browserReady&&graph.source.context.state==='running'&&!engineStarting&&!stateSaveSuspended&&!root.mygrainCardHistory?.busy;
    if(!running){stopGenerators();return;}
    if(generators||preparing)return;
    const request=++generatorRequest;preparing=true;
    try{
        if(root.mygrainQ?.playable())await root.mygrainQ.preparePlayback();
        if(!effectsOnly||!connected||request!==generatorRequest)return;
        restartAllTransport({silent:true,skipSave:true,keyboardPlay:true,startLeadSeconds:.12});
        transportStart=transportSync.startTime;
        root.mygrainWasp?.syncExternalTransport({playing:true,startTime:transportStart});generators=true;
    }catch(e){if(request===generatorRequest)status('Could not start silent modulation sources: '+e.message);}
    finally{if(request===generatorRequest)preparing=false;}
}
function applyGain(){const db=Number(el('dawFxGain').value);el('dawFxGainValue').textContent=(db>0?'+':'')+db+' dB';if(gain)gain.gain.setTargetAtTime(mute?0:10**(db/20),gain.context.currentTime,.008);}
function updateLatency(){if(!graph||!worker)return;const frames=(graph.routes.latencySeconds?.(el('dawFxRoute').value)||0)*graph.source.context.sampleRate;if(frames!==latencyFrames){latencyFrames=frames;worker.postMessage({type:'latency',frames});}}
function route(){if(!gain||!graph)return;releaseAcousticFeed?.();releaseAcousticFeed=null;root.mygrainAcousticFx?.clear();externalRoute?.disconnect();externalRoute=null;gain.disconnect();const selected=el('dawFxRoute').value;if(selected!=='direct')releaseAcousticFeed=root.mygrainAcousticFx?.observeExternal(gain);if(selected!=='direct'&&root.mygrainCharacterFx)externalRoute=root.mygrainCharacterFx.connectExternal(gain,graph.routes[selected]);else if(selected!=='direct'&&root.mygrainWasp)externalRoute=root.mygrainWasp.connectExternal(gain,graph.routes[selected]);else gain.connect(graph.routes[selected]);updateLatency();}
function disconnect(message='Disconnected. Using delayed dry audio in the plugin.',options={}){
    remote.reset();project.reset();attempt++;connecting=false;connected=false;automatic=false;attaching=false;readySent=null;lastClock=null;mixTouched=false;latencyFrames=null;
    if(startTimer)clearTimeout(startTimer);startTimer=null;releaseLock?.();releaseLock=null;
    stateListener?.();stateListener=null;if(worker){const oldWorker=worker;oldWorker.postMessage({type:'disconnect'});oldWorker.onmessage=null;oldWorker.onerror=null;setTimeout(()=>oldWorker.terminate(),100);}worker=null;
    for(const node of [input,returned])node?.disconnect();
    if(returned&&graph){try{graph.source.disconnect(returned);}catch{}}
    releaseAcousticFeed?.();releaseAcousticFeed=null;externalRoute?.disconnect();externalRoute=null;gain?.disconnect();input=null;returned=null;gain=null;setEffectsOnly(false,options);
    if(mutedMonitor&&graph){try{graph.source.connect(graph.destination);}catch{}mutedMonitor=false;}
    el('dawFxLeft').value=el('dawFxRight').value=0;el('dawFxClock').textContent='DAW clock · disconnected · normal layer routing';controls();status(message);
}
async function lock(port){if(!navigator.locks?.request)return ()=>{};return new Promise((resolve,reject)=>{navigator.locks.request('mygrain-daw-plugin-'+port,{ifAvailable:true},async lease=>{if(!lease){resolve(false);return;}await new Promise(release=>resolve(release));}).catch(reject);});}
function reportReady(){const ready=!!(project.ready&&!project.busy&&!remote.audioBusy&&input&&graph?.source.context.state==='running'&&typeof engineStarting!=='undefined'&&!engineStarting&&!stateSaveSuspended&&!root.mygrainCardHistory?.busy);if(ready!==readySent){readySent=ready;command(ready?'ready':'not-ready');}}
async function attach(){
    if(attaching||input||!connected||!graph||!isAudioGraphReady())return;
    const generation=attempt,ctx=graph.source.context;attaching=true;
    try{
        if(!modules.has(ctx))modules.set(ctx,ctx.audioWorklet.addModule(new URL('daw-fx-worklet.js?v='+version,document.baseURI)).catch(e=>{modules.delete(ctx);throw e;}));await modules.get(ctx);
        if(!connected||generation!==attempt)return;
        const id='fx-'+generation;
        input=new AudioWorkletNode(ctx,'mygrain-fx-input-v1',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{id}});
        returned=new AudioWorkletNode(ctx,'mygrain-fx-return-v1',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',processorOptions:{id,delayFrames:(graph.routes.latencySeconds?.(el('dawFxRoute').value)||0)*ctx.sampleRate}});
        gain=ctx.createGain();applyGain();input.connect(gain);route();
        // Silent dependency guarantees same-quantum source mapping even while
        // the selected route or input gain is muted. No graph cycle is added.
        input.connect(returned,0,1);graph.source.connect(returned,0,0);returned.connect(graph.destination);
        graph.source.disconnect(graph.destination);mutedMonitor=true;
        input.onprocessorerror=returned.onprocessorerror=()=>disconnect('FX audio processor stopped. Using delayed dry audio.');
        worker.postMessage({type:'ports',input:input.port,returned:returned.port},[input.port,returned.port]);
        const listener=()=>reportReady();ctx.addEventListener('statechange',listener);stateListener=()=>ctx.removeEventListener('statechange',listener);reportReady();
    }catch(e){if(generation===attempt)disconnect('FX audio setup failed: '+e.message);}finally{if(generation===attempt)attaching=false;}
}
function startEngine(){if(!connected||!automatic)return;if(isAudioGraphReady()){attach();return;}const button=el('start-btn');if(document.documentElement.dataset.mygrainStartup==='ready'&&button&&!button.disabled&&typeof engineStarting!=='undefined'&&!engineStarting)button.click();startTimer=setTimeout(startEngine,250);}
async function connect(options={}){
    if(connected||connecting)return;
    if(root.mygrainDawBridge?.connected||root.mygrainDawBridge?.diagnostics().connecting){status('Disconnect the Bridge instrument in this tab first, or open FX in a separate tab.');return;}
    const match=el('dawFxCode').value.trim().match(/^(187(?:3[1-9]|[45]\d|6[0-2]))\.([a-f0-9]{32})$/);if(!match){status('Paste the connection code from the MYGRAIN FX effect plugin.');return;}
    const generation=++attempt;connecting=true;automatic=options.auto===true;controls();status('Connecting to MYGRAIN FX on this computer…');
    try{
        const lease=await lock(match[1]);if(!lease){connecting=false;controls();status('Another MYGRAIN tab owns this plugin. Disconnect that tab first.');return;}if(generation!==attempt){lease();return;}releaseLock=lease;
        worker=new Worker(new URL('daw-fx-worker.js?v='+version,document.baseURI));project.reset(worker);remote.reset(worker);worker.onerror=()=>disconnect('FX connection worker failed. Using delayed dry audio.');
        worker.onmessage=({data})=>{
            if(generation!==attempt)return;
            if(data.type==='remoteCommand'){remote.event(data);return;}
            if(data.type.startsWith('project')){project.event(data);return;}
            if(data.type==='connected'){connected=true;connecting=false;el('dawFxCode').value='';controls();status('Connected. Start MYGRAIN audio, then Arm FX.');attach();startEngine();}
            if(data.type==='failure')disconnect(data.message);
            if(data.type==='closed')disconnect('Plugin disconnected. Using delayed dry audio.');
            if(data.type==='clock'){
                lastClock=data;project.observe(data);remote.observe(data);controls();attach();reportReady();updateLatency();syncClock();
                if(!mixTouched){el('dawFxMix').value=String(Math.round(data.mix*100));el('dawFxMixValue').textContent=Math.round(data.mix*100)+'% wet';}
                el('dawFxLeft').value=Math.min(1,data.inputPeakLeft||0);el('dawFxRight').value=Math.min(1,data.inputPeakRight||0);
                status(data.offline?'Offline bounce: delayed dry only. Use real-time export to include Chrome effects.':data.bypass?'DAW bypass: time-aligned dry audio.':!data.active?'DAW processing paused. Arm is retained; enable monitoring or playback.':!data.browserReady?'Connected. Press Start MYGRAIN once if Chrome needs an audio gesture.':!data.armed?'Connected · delayed dry. Press green Arm FX to process the track.':data.running?'FX return active · 1,000 ms fixed compensated delay · '+Math.round(data.mix*100)+'% wet.':'FX armed · buffering return · delayed dry until ready.');
            }
        };worker.postMessage({type:'connect',port:Number(match[1]),token:match[2]});
        setTimeout(()=>{if(generation===attempt&&connecting)disconnect('Connection timed out. Copy a fresh FX code and allow Chrome local-network access.');},12000);
    }catch(e){if(generation===attempt)disconnect('FX connection failed: '+e.message);}
}
el('dawFxConnect').onclick=()=>connect();el('dawFxDisconnect').onclick=()=>disconnect();
el('dawFxArm').onclick=async()=>{if(graph?.source.context.state==='suspended')await graph.source.context.resume();command('arm');};
el('dawFxStop').onclick=()=>command('stop');
el('dawFxGain').oninput=applyGain;el('dawFxRoute').onchange=route;
el('dawFxMute').onclick=()=>{mute=!mute;el('dawFxMute').setAttribute('aria-pressed',String(mute));el('dawFxMute').textContent=mute?'Unmute input':'Mute input';applyGain();};
el('dawFxMix').oninput=()=>{mixTouched=true;const value=Number(el('dawFxMix').value);el('dawFxMixValue').textContent=value+'% wet';command('mix:'+value);};
for(const event of ['pointerdown','click','keydown'])document.addEventListener(event,e=>{const ctx=graph?.source.context||(typeof audioContext!=='undefined'?audioContext:null);if(e.isTrusted&&connected&&automatic&&ctx?.state==='suspended')ctx.resume().catch(()=>{});},true);
root.addEventListener('pagehide',()=>{if(connected||connecting)disconnect(undefined,{resumePlayback:false});});root.addEventListener('mygrain-account-lock',()=>{if(connected||connecting)disconnect('Account locked. FX disconnected; delayed dry audio remains.',{resumePlayback:false});});
root.mygrainDawFx={bindAudio(source,destination,routes){if(graph&&(connected||connecting))disconnect('Audio engine restarted. Reconnect MYGRAIN FX.');graph={source,destination,routes};if(connected)queueMicrotask(attach);},connect,disconnect,storeProject:()=>project.store(),restoreProject:()=>project.restore(),get connected(){return connected;},get connecting(){return connecting;},get needsAudio(){return connected;},get effectsOnly(){return effectsOnly;},get tempo(){return effectsOnly&&typeof audioContext!=='undefined'&&audioContext===graph?.source.context?clockTempo:null;},isExternalContext:ctx=>effectsOnly&&ctx===graph?.source.context,layerInput,diagnostics:()=>({remote:remote.diagnostics(),project:project.diagnostics(),connected,connecting,attached:!!input,mutedMonitor,generators,effectsOnly,clockTempo,transportStart,layerGates:[...layerGates()].length,mute,gainDb:Number(el('dawFxGain').value),route:el('dawFxRoute').value,latencyFrames,clock:lastClock?{...lastClock}:null})};
if(/^#fx=/.test(location.hash)){const code=location.hash.slice(4);history.replaceState(null,'',location.pathname+location.search);if(/^187\d{2}\.[a-f0-9]{32}$/.test(code)){el('dawFxCode').value=code;card.open=true;queueMicrotask(()=>connect({auto:true}));}}
controls();
})(window);
