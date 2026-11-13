/* Per-account/device quality preference. Never part of patch/export settings. */
(function(root){
'use strict';
const eligible=/iPhone/i.test(navigator.userAgent)&&!root.__mygrainSongRenderDeck;
const preferenceKey='mygrain-iphone-low-power-v1';
let enabled=false;try{enabled=eligible&&localStorage.getItem(preferenceKey)==='true';}catch{}
const button=document.getElementById('iphoneLowPowerBtn'),control=document.getElementById('iphoneLowPowerControl'),status=document.getElementById('iphoneLowPowerStatus');
if(control){control.hidden=!eligible;if(!eligible)control.remove();}else if(button){button.hidden=!eligible;if(!eligible)button.remove();}
function isLive(ctx){return enabled&&eligible&&typeof audioContext!=='undefined'&&ctx===audioContext&&!root.__mygrainSongRenderDeck;}
function processImpulse(ctx,buffer){
 if(!isLive(ctx)||!buffer)return buffer;
 // Native convolution must use the context rate. Mono, a bounded tail and
 // four-sample temporal resolution cut FFT work without changing saved knobs.
 const length=Math.min(buffer.length,Math.round(ctx.sampleRate*1.5));
 const next=ctx.createBuffer(1,length,ctx.sampleRate),out=next.getChannelData(0),channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
 for(let i=0;i<length;i+=4){let value=0;for(const ch of channels)value+=ch[i];value/=channels.length;for(let j=i;j<Math.min(length,i+4);j++)out[j]=value*Math.min(1,(length-1-j)/(ctx.sampleRate*.025));}
 return next;
}
function set(value,{silent=false}={}){
 const next=!!value&&eligible;if(next===enabled)return enabled;
 enabled=next;try{localStorage.setItem(preferenceKey,String(enabled));}catch{}
 root.mygrainRuntimeDiagnostics?.event('power-mode',{enabled,reason:'user-toggle'});
 if(status)status.textContent=enabled?'low power mode is on':'low power mode is off';if(button){button.setAttribute('aria-pressed',String(enabled));button.textContent=enabled?'⚡ Low Power On':'⚡ Low Power Off';}
 if(typeof audioContext!=='undefined'&&audioContext){
  rebuildFilterChain();finalReverbImpulseKey='';refreshFinalReverbImpulseFromControls();root.mygrainLoopFx?.update();
  for(const node of [...(finalDistortionNodes||[]),distortionNode].filter(Boolean))node.oversample=enabled?'none':'2x';
  startModulationLoop();if(drumSendFxGraph){drumSendFxGraph.baseImpulseKey='';drumSendFxGraph.requestedImpulseKey='';configureDrumSendFxGraph(drumSendFxGraph, drumSendFxState, getSharedBpmClockValue(), true);}
 }
 if(!silent)setStatus(enabled?'iPhone Low Power on. Lighter reverb tails, filters and modulation; your settings are unchanged.':'Low Power off. Normal processing restored.');
 return enabled;
}
root.mygrainPower={get active(){return enabled},eligible,isLive,processImpulse,set};
// Randomisation must never change this preference or restore heavier processing.
function sync(){if(status)status.textContent=enabled?'low power mode is on':'low power mode is off';if(button){button.setAttribute('aria-pressed',String(enabled));button.textContent=enabled?'⚡ Low Power On':'⚡ Low Power Off';}}
sync();
let noticeTimer=null;
function announce(){
 if(!eligible)return;
 let notice=document.getElementById('mygrainPowerNotice');
 if(!notice){notice=document.createElement('div');notice.id='mygrainPowerNotice';notice.setAttribute('role','status');notice.style.cssText='position:fixed;z-index:25000;left:12px;right:12px;top:max(12px,env(safe-area-inset-top));padding:12px;background:#173329;color:#fff;border:1px solid #77d9bc;border-radius:9px;font:14px system-ui;pointer-events:none;text-align:center';document.body.append(notice);}
 notice.hidden=false;notice.textContent='MYGRAIN Low Power '+(enabled?'ON — lighter processing retained.':'OFF — normal processing.');
 root.mygrainRuntimeDiagnostics?.event('power-mode',{enabled,reason:'startup'});
 clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{notice.hidden=true;noticeTimer=null;},4500);
}
if(eligible){document.getElementById('start-btn')?.addEventListener('click',announce);}
button?.addEventListener('click',()=>{try{set(!enabled)}catch(e){setStatus(e.message,'error')}});
})(window);
