/* Generation-only steering and source analysis. No saved-state/DSP migration. */
(function(root){
'use strict';
let dialog=null;
function validTone(tone){return tone==='tonal'||tone==='minimal';}
function prompt(options={}){
 if(dialog)return Promise.resolve(null);
 const sparse=!!options.sparseMode,plugin=!!(root.mygrainDawBridge?.connected||root.mygrainDawBridge?.diagnostics().connecting||root.mygrainDawFx?.connected||root.mygrainDawFx?.connecting),tempo=!sparse&&!plugin;
 const d=document.createElement('dialog');dialog=d;d.id='randomisationOptionsDialog';d.setAttribute('aria-labelledby','randomisationOptionsTitle');d.style.cssText='width:min(460px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box;padding:22px;border:1px solid #8cb6bd;border-radius:14px;background:#171b29;color:#fff';
 d.innerHTML=`<h2 id="randomisationOptionsTitle">${sparse?'Sparse':'Mega'} Randomise</h2><p>Replace the current patch. Cooking Pot finishes Off for normal output. Drums start at 100%; D and Restructure are checked against the drums after effects. Undo is available afterwards.</p><fieldset style="border:1px solid #62798e;border-radius:10px;padding:12px"><legend>Tone steer</legend><label style="display:flex;gap:10px;align-items:center;min-height:44px"><input type="radio" name="randomTone" value="tonal">Tonal</label><label style="display:flex;gap:10px;align-items:center;min-height:44px"><input type="radio" name="randomTone" value="minimal">Non-tonal</label><p style="margin:6px 0;font-size:14px">Tonal: L + X and either piano or orchestra. Non-tonal: none of those four sources.</p></fieldset>${tempo?'<fieldset style="margin-top:12px;border:1px solid #62798e;border-radius:10px;padding:12px"><legend>Tempo</legend><label style="display:flex;gap:10px;align-items:center;min-height:44px"><input type="radio" name="randomTempo" value="keep" checked>Keep current BPM</label><label style="display:flex;gap:10px;align-items:center;min-height:44px"><input type="radio" name="randomTempo" value="random">Random BPM · 60–180</label></fieldset>':''}<div style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:12px;margin-top:20px"><button type="button" class="performance-btn" data-cancel autofocus>Cancel</button><button type="button" class="performance-btn" data-confirm>${sparse?'Sparse':'Mega'} Randomise</button></div>`;
 d.querySelector(`input[name=randomTone][value=${validTone(options.tone)?options.tone:'tonal'}]`).checked=true;if(tempo&&options.tempoDecision===true)d.querySelector('[name=randomTempo][value=random]').checked=true;
 const focus=document.activeElement;document.body.append(d);
 return new Promise(resolve=>{const abort=new AbortController();const finish=value=>{if(dialog!==d)return;dialog=null;abort.abort();if(d.open)d.close();d.remove();if(focus?.isConnected)focus.focus({preventScroll:true});resolve(value);};d.querySelector('[data-cancel]').onclick=()=>finish(null);d.querySelector('[data-confirm]').onclick=()=>finish({...options,tone:d.querySelector('[name=randomTone]:checked').value,tempoDecision:tempo?d.querySelector('[name=randomTempo]:checked').value==='random':false});d.oncancel=e=>{e.preventDefault();finish(null);};d.onclose=()=>finish(null);root.addEventListener('mygrain-account-lock',()=>finish(null),{once:true,signal:abort.signal});d.showModal();});
}
async function resolve(options={}){
 const plugin=!!(root.mygrainDawBridge?.connected||root.mygrainDawBridge?.diagnostics().connecting||root.mygrainDawFx?.connected||root.mygrainDawFx?.connecting);
 return validTone(options.tone)&&(options.sparseMode||plugin||typeof options.tempoDecision==='boolean')?{...options,tempoDecision:options.sparseMode||plugin?false:options.tempoDecision}:prompt(options);
}
const modules=new WeakMap();let last=null,cancelAnalysis=null;
async function balance({context,report=()=>{},signal,onlyRestructure=false}){
 last=null;
 if(!context||context.state==='closed')return{status:'not-started'};
 // Generation sets powers Off before this boundary. Do not split/rebuild any
 // shared nonlinear graph, or install a permanent automatic gain controller.
 const rState=root.mygrainRestructure?.settings(),hasR=rState?!!rState.enabled&&rState.level>0:dropboxSampleLayerEnabled&&!!dropboxSampleLayerBuffer&&getDropboxSampleLayerLevelValue({applyLayerToggle:false})>0,hasD=!onlyRestructure&&!!root.mygrainD?.playable();
 if(!drumMachineEnabled||!hasD&&!hasR)return last={status:'no-comparison'};
 const rLevel=()=>root.mygrainRestructure?.settings()?.level??getDropboxSampleLayerLevelValue({applyLayerToggle:false});
 const setR=level=>{if(root.mygrainRestructure?.ownsSource)root.mygrainRestructure.set({level});else setSliderValue('performanceDropboxSampleLevel',level*100);};
 let module=modules.get(context);if(!module){module=context.audioWorklet.addModule(new URL('random-balance-worklet.js?v=20261122-restructure-balance-3',document.baseURI).href).catch(e=>{modules.delete(context);throw e;});modules.set(context,module);}await module;
 const active=()=>{if(signal?.aborted||audioContext!==context||context.state==='closed')throw new DOMException('Analysis cancelled.','AbortError');};active();
 const localAbort=new AbortController(),forwardAbort=()=>localAbort.abort();signal?.addEventListener('abort',forwardAbort,{once:true});if(signal?.aborted)localAbort.abort();const requestSignal=signal;signal=localAbort.signal;cancelAnalysis=forwardAbort;
 let node,timer,abortHandler,stateHandler,started=false;const taps=[];
 try{
  if(context.state!=='running')await context.resume();active();
  if(hasR&&rState){await root.MygrainRestructure.prepare(context,rState);active();}
  // Warm native source graphs while the existing generation output gate is shut.
  withBufferedTransportStart(null,time=>{setBastardLoopPlaying(true,{startTime:time,silent:true,skipSave:true});startDrumMachine(time,{skipUi:true,silent:true});started=true;},{reset:true,startLeadSeconds:.25});
  const steps=getPatternLengthSteps(),bpm=getTransportClockBpm(),cycle=steps*60/bpm/4;
  if(!Number.isFinite(cycle)||cycle>48)throw Error('Pattern too long for bounded drum analysis.');
  report('Warming drum and source effects · checking every lane before loudness analysis…');
  // Every drum lane has its own persistent post-EQ/local-FX route. Populate
  // lanes with late first hits before freezing the analysis route inventory.
  const origin=drumMachineTransportStartTime;
  const warmDeadline=performance.now()+cycle*1000+6000;
  while(context.currentTime<origin+cycle){active();if(context.state!=='running'||performance.now()>warmDeadline)throw Error('Audio was interrupted during loudness warm-up.');await new Promise(resolve=>setTimeout(resolve,40));}
  // Drum leaf routes arrive with the first scheduled hit, not startDrumMachine().
  // Wait for the real registry instead of sampling a transient empty dry graph.
  const deadline=performance.now()+4000;
  for(;;){
   active();await root.mygrainCookingPot.whenReady();active();root.mygrainCookingPot.syncSources();await root.mygrainCookingPot.whenReady();active();taps.length=0;
   const master=root.mygrainEffectOutput.diagnostics().level;
   for(const [family,keys]of [['drums',MygrainCookingPot.LEAVES.filter(k=>/^drum[A-Z]/.test(k))],...(hasD?[['d',['D']]]:[]),...(hasR?[['restructure',['sample']]]:[])])for(const route of root.mygrainCookingPot.analysisRoutes(keys,context).routes)taps.push({...route,family,scale:route.postEffect?(route.destination.gain.__effectOutputTarget??route.destination.gain.value):master});
   if(taps.some(t=>t.family==='drums')&&(!hasD||taps.some(t=>t.family==='d'))&&(!hasR||taps.some(t=>t.family==='restructure')))break;
   if(performance.now()>=deadline)throw Error('Source analysis routes are not ready.');
   await new Promise(resolve=>setTimeout(resolve,30));
  }
  report('Analysing post-FX drums and selected sources · one complete loop…');
  node=new AudioWorkletNode(context,'mygrain-random-balance-meter-v1',{numberOfInputs:taps.length,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',processorOptions:{routes:taps.map(({family,scale})=>({family,scale}))}});
  taps.forEach((t,i)=>t.source.connect(node,0,i));node.connect(context.destination);
  const measure=async()=>{
   active();const start=context.currentTime+.15;
   return await new Promise((resolve,reject)=>{const clean=()=>{clearTimeout(timer);signal.removeEventListener('abort',abortHandler);context.removeEventListener('statechange',stateHandler);};node.port.onmessage=({data})=>{if(data.error){clean();reject(Error(data.error));}else if(data.measured){clean();resolve(data.measured);}};node.onprocessorerror=()=>{clean();reject(Error('Loudness analysis stopped.'));};timer=setTimeout(()=>{clean();reject(Error('Loudness analysis timed out. Keep MYGRAIN in the foreground.'));},Math.ceil((cycle+.15)*1000)+6000);abortHandler=()=>{clean();reject(new DOMException('Analysis cancelled.','AbortError'));};signal.addEventListener('abort',abortHandler,{once:true});stateHandler=()=>{if(context.state!=='running'){clean();reject(Error('Audio was interrupted during loudness analysis.'));}};context.addEventListener('statechange',stateHandler);node.port.postMessage({arm:{start:Math.round(start*context.sampleRate),end:Math.round((start+cycle)*context.sampleRate)}});});
  };
  let metrics=await measure();active();const original=metrics,rStart=hasR?rLevel():null,decisions={};
  if(hasD){const decision=MygrainLoopBalance.decide(metrics.drums,metrics.d,{...MygrainLoopBalance.D_POLICY,startLevel:root.mygrainD.state.level});root.mygrainD.state.level=Math.floor(root.mygrainD.state.level*decision.gain*10000)/10000;root.mygrainD.sync();decisions.d=decision;}
  if(hasR){
   // The spring, source limiter, EQ and local/Pot inserts are all upstream of
   // these taps. Re-measure the actual result: pre-insert fader ratios alone
   // cannot predict nonlinear effects. Only generated levels are committed.
   for(let attempt=0;attempt<4;attempt++){
    const decision=MygrainLoopBalance.decide(metrics.drums,metrics.restructure,{...MygrainLoopBalance.R_POLICY,startLevel:rLevel()});decisions.restructure=decision;last={status:'checking',attempt,level:rLevel(),metrics,decision};
    if(decision.gain>=.995)break;
    setR(Math.floor(rLevel()*decision.gain*.8*1000000)/1000000);
    report('Checking Restructure after effects · pass '+(attempt+1)+'…');
    const settleAt=context.currentTime+4*60/bpm+1;while(context.currentTime<settleAt){active();await new Promise(resolve=>setTimeout(resolve,40));}metrics=await measure();active();
   }
   MygrainLoopBalance.verifySaved(metrics.drums,null,null,metrics.restructure);
  }
  last={status:'balanced',version:1,referenceTap:'post-fx',sourceTap:'post-fx',drumLevel:getDrumMachineLevelValue({applyLayerToggle:false}),...(hasD?{dLevel:root.mygrainD.state.level,d:original.d,decision:decisions.d}:{}),...(hasR?{restructureLevel:rLevel(),restructure:{startLevel:rStart,effectiveLevel:rLevel(),gain:rLevel()/rStart,verified:{drums:metrics.drums,restructure:metrics.restructure},decision:decisions.restructure}}:{}),drums:original.drums,cycleSeconds:cycle};
  report('Post-FX drum-reference balance complete'+(hasR?' · Restructure '+(rLevel()*100).toFixed(2)+'%':'')+'.');return last;
 }finally{cancelAnalysis=null;requestSignal?.removeEventListener('abort',forwardAbort);clearTimeout(timer);signal?.removeEventListener('abort',abortHandler);if(stateHandler)context.removeEventListener('statechange',stateHandler);if(started)stopAllPerformancePlayback({silent:true});if(node){for(const t of taps)try{t.source.disconnect(node);}catch{}node.port.postMessage({dispose:true});node.disconnect();node.port.onmessage=null;node.port.close();}}
}
let deferred=false;
async function balanceRestructure(options={}){
 if(!audioContext){deferred=true;return{status:'deferred'};}
 const wasSuppressed=megaRandomAudioSuppressed,wasPlaying=bastardLoopPlaying,context=audioContext;let interrupted=false;
 setMegaRandomAudioSuppressed(true);
 try{return await balance({...options,context:audioContext,onlyRestructure:true});}
 catch(error){interrupted=error.name==='AbortError';if(context===audioContext&&root.mygrainAccounts?.authenticated){if(root.mygrainRestructure?.ownsSource)root.mygrainRestructure.set({level:0});else setSliderValue('performanceDropboxSampleLevel',0);}throw error;}
 finally{setMegaRandomAudioSuppressed(wasSuppressed);if(wasPlaying&&!interrupted&&context===audioContext&&root.mygrainAccounts?.authenticated)startAllBastardLoopLayers();}
}
root.addEventListener('mygrain-account-lock',()=>{deferred=false;cancelAnalysis?.();});
root.mygrainRandomGeneration={prompt,resolve,balance,balanceRestructure,defer(){deferred=true;},async completeDeferred(){if(!deferred)return;deferred=false;await balanceRestructure({report:message=>setStatus(message,'info')});saveState();},cancelAnalysis(){cancelAnalysis?.();},get last(){return last;}};
})(window);
