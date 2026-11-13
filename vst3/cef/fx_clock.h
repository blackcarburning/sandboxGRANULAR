#pragma once
// An active zero-output AudioWorklet is an automatic-pull node in Chromium.
// It disables the 30-second silent-sink clock migration for interactive contexts
// without injecting any signal or opening a second audio stream. FX sends its
// audio over the existing timestamped return, not the browser's silent output.
constexpr const char* fxClockScript=R"JS(
(()=>{
 if(window.mygrainCefFxClock)return;
 const state=window.mygrainCefFxClock={ready:false,error:''};
 let pending=false,context=null,node=null,closed=false;
 const dispose=()=>{node?.port.postMessage('dispose');node=null;context=null;state.ready=false;};
 const tick=async()=>{
  if(closed||pending||!window.mygrainDawFx?.connected)return;
  let ctx;try{ctx=typeof audioContext==='undefined'?null:audioContext;}catch{return;}
  if(!ctx||typeof ctx.startRendering==='function'||ctx.state==='closed'||ctx===context||!ctx.audioWorklet)return;
  pending=true;dispose();
  const url=URL.createObjectURL(new Blob([`class MygrainCefFxClock extends AudioWorkletProcessor {constructor(){super();this.alive=true;this.port.onmessage=()=>this.alive=false;}process(){return this.alive;}}registerProcessor('mygrain-cef-fx-clock-v1',MygrainCefFxClock);`],{type:'text/javascript'}));
  try{
   await ctx.audioWorklet.addModule(url);
   if(closed||ctx.state==='closed')return;
   node=new AudioWorkletNode(ctx,'mygrain-cef-fx-clock-v1',{numberOfInputs:0,numberOfOutputs:0});
   context=ctx;state.ready=true;state.error='';
  }catch(e){state.error=String(e?.message||e);}
  finally{URL.revokeObjectURL(url);pending=false;}
 };
 const timer=setInterval(tick,250);tick();
 addEventListener('pagehide',()=>{closed=true;clearInterval(timer);dispose();},{once:true});
})();
)JS";
