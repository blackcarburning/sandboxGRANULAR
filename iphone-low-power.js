/* Transient live-DSP quality only. Never part of patch/settings storage. */
(function(root){
'use strict';
const eligible=/iPhone/i.test(navigator.userAgent)&&!root.__mygrainSongRenderDeck;
let enabled=false;
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
 enabled=next;if(status)status.textContent=enabled?'low power mode is on':'low power mode is off';if(button){button.setAttribute('aria-pressed',String(enabled));button.textContent=enabled?'⚡ Low Power On':'⚡ Low Power Off';}
 if(typeof audioContext!=='undefined'&&audioContext){
  rebuildFilterChain();finalReverbImpulseKey='';refreshFinalReverbImpulseFromControls();root.mygrainLoopFx?.update();
  for(const node of [...(finalDistortionNodes||[]),distortionNode].filter(Boolean))node.oversample=enabled?'none':'2x';
  startModulationLoop();if(drumSendFxGraph){drumSendFxGraph.baseImpulseKey='';drumSendFxGraph.requestedImpulseKey='';configureDrumSendFxGraph(drumSendFxGraph, drumSendFxState, getSharedBpmClockValue(), true);}
 }
 if(!silent)setStatus(enabled?'iPhone Low Power on. Lighter reverb tails, filters and modulation; your settings are unchanged.':'Low Power off. Normal processing restored.');
 return enabled;
}
root.mygrainPower={get active(){return enabled},eligible,isLive,processImpulse,set};
document.addEventListener('click',event=>{const b=event.target.closest?.('button');if(b&&!b.closest('#drumPatternLibrary')&&(/random|sparse|mega|shuffle/i.test(b.id)||/^(Random Pattern|Randomise|Randomize|Shuffle)$/i.test(b.textContent.trim())))set(false,{silent:true});},true);
button?.addEventListener('click',()=>{try{set(!enabled)}catch(e){setStatus(e.message,'error')}});
})(window);
