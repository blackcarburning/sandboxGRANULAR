/* Per-account/device LIVE quality preference. Never part of patch/export settings. */
(function(root){
'use strict';
const eligible=/iPhone/i.test(navigator.userAgent)&&!root.__mygrainSongRenderDeck;
const preferenceKey='mygrain-iphone-low-power-v1';
let enabled=false;try{enabled=eligible&&localStorage.getItem(preferenceKey)==='true';}catch{}
const button=document.getElementById('iphoneLowPowerBtn'),control=document.getElementById('iphoneLowPowerControl'),status=document.getElementById('iphoneLowPowerStatus');
if(control){control.hidden=!eligible;if(!eligible)control.remove();}else if(button){button.hidden=!eligible;if(!eligible)button.remove();}
const native=ctx=>ctx?.__mygrainNativeContext||ctx;
function isLive(ctx){ctx=native(ctx);return enabled&&eligible&&!!ctx&&typeof ctx.startRendering!=='function'&&typeof audioContext!=='undefined'&&ctx===native(audioContext)&&!root.__mygrainSongRenderDeck;}
const divisor=ctx=>isLive(ctx)?2:1;
function processImpulse(ctx,buffer){
 if(!isLive(ctx)||!buffer)return buffer;
 // Mono and a short actual impulse reduce native FFT/convolution cost. Repeated
 // values alone would not reduce work, so the live tail itself is bounded.
 const length=Math.min(buffer.length,Math.round(ctx.sampleRate*.75));
 const next=ctx.createBuffer(1,length,ctx.sampleRate),out=next.getChannelData(0),channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
 for(let i=0;i<length;i++){let value=0;for(const ch of channels)value+=ch[i];out[i]=value/channels.length*Math.max(0,Math.min(1,(length-1-i)/(ctx.sampleRate*.025)));}
 return next;
}
function sync(){
 const label='Low Power '+(enabled?'On':'Off');
 if(status)status.textContent=label+' · renders stay full quality';
 if(control?.dataset)control.dataset.power=enabled?'on':'off';
 if(button){button.setAttribute('aria-pressed',String(enabled));button.setAttribute('aria-label',label);button.setAttribute('title',label+' — lighter live DSP only');button.textContent='⚡';}
}
let noticeTimer=null;
function announce(){
 if(!eligible)return;
 let notice=document.getElementById('mygrainPowerNotice');
 if(!notice){notice=document.createElement('div');notice.id='mygrainPowerNotice';notice.setAttribute('role','status');notice.style.cssText='position:fixed;z-index:25000;left:12px;right:12px;top:max(12px,env(safe-area-inset-top));padding:12px;color:#fff;border:1px solid;border-radius:9px;font:14px system-ui;pointer-events:none;text-align:center';document.body.append(notice);}
 notice.style.background=enabled?'#173f32':'#54331c';notice.style.borderColor=enabled?'#77e3b8':'#ffc17c';
 notice.dataset.power=enabled?'on':'off';notice.hidden=false;notice.textContent='MYGRAIN Low Power '+(enabled?'ON — lighter live DSP.':'OFF — full live quality.')+' Renders always use full quality.';
 clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{notice.hidden=true;noticeTimer=null;},4500);
}
function set(value,{silent=false}={}){
 const next=!!value&&eligible;if(next===enabled)return enabled;
 enabled=next;try{localStorage.setItem(preferenceKey,String(enabled));}catch{}
 root.mygrainRuntimeDiagnostics?.event('power-mode',{enabled,reason:'user-toggle'});sync();
 if(typeof audioContext!=='undefined'&&audioContext){
  // Mark bindings preparing before any secondary graph refresh can observe the
  // changed quality. Recipes and live transport/source identity remain intact.
  root.mygrainCookingPot?.changed();
  rebuildFilterChain();finalReverbImpulseKey='';refreshFinalReverbImpulseFromControls();root.mygrainLoopFx?.update();
  for(const node of [...(finalDistortionNodes||[]),distortionNode].filter(Boolean))node.oversample=enabled?'none':'2x';
  startModulationLoop();if(drumSendFxGraph){drumSendFxGraph.baseImpulseKey='';drumSendFxGraph.requestedImpulseKey='';configureDrumSendFxGraph(drumSendFxGraph,drumSendFxState,getSharedBpmClockValue(),true);}
 }
 if(!silent){setStatus(enabled?'Low Power on. Half-rate live effects, shorter mono reverbs, lighter filters and modulation. Renders stay full quality.':'Low Power off. Full live and render quality restored.');announce();}
 return enabled;
}
root.mygrainPower={get active(){return enabled},eligible,isLive,divisor,processImpulse,set,whenReady:()=>root.mygrainCookingPot?.whenReady()||Promise.resolve()};
sync();if(eligible)document.getElementById('start-btn')?.addEventListener('click',()=>{announce();root.mygrainRuntimeDiagnostics?.event('power-mode',{enabled,reason:'startup'});});
button?.addEventListener('click',()=>{try{set(!enabled)}catch(e){setStatus(e.message,'error')}});
})(window);
