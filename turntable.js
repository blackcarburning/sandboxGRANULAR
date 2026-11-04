(function(root){
'use strict';
const DSP=root.MygrainTurntable,bindings=new Set(),modules=new WeakMap(),listeners=new Set();
let state=DSP.normalize(readStoredStateSnapshot()?.modes?.turntable),pending=Promise.resolve(),generation=0,error='';state.enabled=false;
const emit=()=>{for(const f of listeners)f();},unlink=(a,b)=>{try{a.disconnect(b)}catch{}};
const native=ctx=>ctx.__mygrainNativeContext||ctx;
async function prepare(ctx,value=state){if(!DSP.normalize(value).enabled||!ctx)return;ctx=native(ctx);if(!ctx.audioWorklet)throw Error('Turntable requires AudioWorklet support.');if(!modules.has(ctx)){const p=ctx.audioWorklet.addModule(new URL('turntable-worklet.js?v=20261104-turntable-drums-1',document.baseURI));modules.set(ctx,p);p.catch(()=>modules.delete(ctx));}await modules.get(ctx);}
function retire(node){node.onprocessorerror=null;node.disconnect();node.port.onmessage=()=>node.port.close();node.port.postMessage({dispose:true});}
function bypass(link){if(!link.node)return;const node=link.node;unlink(link.source,node);link.node=null;retire(node);link.source.connect(link.destination);}
function detach(link){if(!bindings.has(link))return;if(link.node){unlink(link.source,link.node);retire(link.node);link.node=null;}else unlink(link.source,link.destination);bindings.delete(link);}
function nodeSettings(link){return link.route==='drums'&&!link.surface?{...state,hum:0,clicks:0,crackle:0}:state;}
async function reconcile(){const token=++generation;
 // Remove the old insert before loading/activating another route. Never double-process.
 for(const link of bindings)if(!state.enabled||link.route!==state.route)bypass(link);
 if(!state.enabled){emit();return;}
 for(const link of bindings){if(link.route!==state.route)continue;await prepare(link.context);if(token!==generation||!state.enabled)return;if(!bindings.has(link)||link.context.state==='closed')continue;
  if(!link.node){const node=new AudioWorkletNode(link.context,'mygrain-turntable-v1',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{settings:nodeSettings(link),clockAligned:link.route==='drums'}});link.node=node;node.onprocessorerror=()=>{error='Turntable processor stopped · dry signal restored';state.enabled=false;generation++;for(const l of bindings)bypass(l);emit();};unlink(link.source,link.destination);link.source.connect(node);node.connect(link.destination);
  }else link.node.port.postMessage({settings:nodeSettings(link)});
 }emit();}
function restore(value,{startup=false}={}){state=DSP.normalize(value);if(startup)state.enabled=false;error='';pending=reconcile().catch(e=>{state.enabled=false;error=e.message;generation++;for(const l of bindings)bypass(l);emit();throw e;});pending.catch(()=>{});emit();return pending;}
const api={settings:()=>DSP.normalize(state),restore,prepare,whenReady:()=>pending,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},off(){return restore({...state,enabled:false})},
 bind(source,destination,{route='mix',surface=true}={}){for(const old of [...bindings])if(old.context.state==='closed')detach(old);const link={source,destination,context:source.context,route,surface,node:null};bindings.add(link);source.connect(destination);pending=reconcile();pending.catch(()=>{});return{disconnect(){detach(link);emit();}};},
 releaseContext(ctx){generation++;for(const l of [...bindings])if(!ctx||l.context===ctx||l.context===native(ctx))detach(l);emit();},
 diagnostics(){const active=[...bindings].filter(l=>l.node);return{enabled:state.enabled,route:state.route,processors:active.length,bindings:bindings.size,masterProcessors:active.filter(l=>l.route==='mix').length,drumProcessors:active.filter(l=>l.route==='drums').length,masterBindings:[...bindings].filter(l=>l.route==='mix').length,drumBindings:[...bindings].filter(l=>l.route==='drums').length,error};}};root.mygrainTurntable=api;
const eq=root.mygrainChannelEq,release=eq.releaseContext.bind(eq);eq.releaseContext=ctx=>{api.releaseContext(ctx);return release(ctx)};
})(window);
