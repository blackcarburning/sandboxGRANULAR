(function(root){
'use strict';
const DSP=root.MygrainTurntable,bindings=new Set(),modules=new WeakMap(),listeners=new Set(),selected=new Set();
const eq=root.mygrainChannelEq,rawConnect=eq.connect.bind(eq),rawRelease=eq.releaseContext.bind(eq),rawWaspConnect=root.mygrainWasp.connect.bind(root.mygrainWasp);
let state=DSP.normalize(readStoredStateSnapshot()?.modes?.turntable),pending=Promise.resolve(),generation=0,error='';
const emit=()=>{root.mygrainEffectOutput?.sync();for(const f of listeners)f();},unlink=(a,b)=>{try{a.disconnect(b)}catch{}};
const native=ctx=>ctx.__mygrainNativeContext||ctx;
async function prepare(ctx,value=state){if(!DSP.normalize(value).enabled||!ctx)return;ctx=native(ctx);if(!ctx.audioWorklet)throw Error('Turntable requires AudioWorklet support.');if(!modules.has(ctx)){const p=ctx.audioWorklet.addModule(new URL('turntable-worklet.js?v=20261111-fx-inputs-1',document.baseURI));modules.set(ctx,p);p.catch(()=>modules.delete(ctx));}await modules.get(ctx);}
function retire(node){node.onprocessorerror=null;node.disconnect();node.port.onmessage=()=>node.port.close();node.port.postMessage({dispose:true});}
function bypass(link){if(!link.node)return;const node=link.node;unlink(link.source,node);link.node=null;retire(node);link.source.connect(link.destination);}
function detach(link){if(!bindings.has(link))return;if(link.node){unlink(link.source,link.node);retire(link.node);link.node=null;}else unlink(link.source,link.destination);bindings.delete(link);root.mygrainCookingPot?.syncSources();}
function selectedBypass(link){link.dryGate.gain.value=1;if(!link.node)return;unlink(link.input,link.node);retire(link.node);link.node=null;link.input.connect(link.output);}
function releaseSelected(link){selectedBypass(link);for(const source of link.sources)unlink(source,link.input);link.input.disconnect();link.output.disconnect();link.dryGate.disconnect();link.route.disconnect();selected.delete(link);}
function selectedConnect(key,source,destination,owner=null,external=false){
 let link=[...selected].find(l=>l.key===key&&l.context===source.context&&l.destination===destination&&l.external===external);
 if(!link){const input=source.context.createGain(),output=source.context.createGain(),dryGate=source.context.createGain();input.connect(output);dryGate.connect(destination);const route=external?root.mygrainWasp.connectExternal(output,dryGate):key==='N'?rawWaspConnect(key,output,dryGate):rawConnect(key,output,dryGate);link={key,input,output,dryGate,destination,context:source.context,route,external,sources:new Set(),node:null};selected.add(link);}
 source.connect(link.input);link.sources.add(source);pending=reconcile();pending.catch(()=>{});let done=false;const disconnect=()=>{if(done)return;done=true;owner?.removeEventListener?.('ended',disconnect);unlink(source,link.input);link.sources.delete(source);if(!link.sources.size)releaseSelected(link);root.mygrainCookingPot?.syncSources();};owner?.addEventListener?.('ended',disconnect,{once:true});return{disconnect};
}
root.mygrainWasp.connect=(key,source,destination,owner)=>key==='N'?selectedConnect(key,source,destination,owner):rawWaspConnect(key,source,destination,owner);
eq.connect=(key,source,destination,owner)=>root.MygrainEffectInputs.SOURCES.includes(key)&&key!=='all'?selectedConnect(key,source,destination,owner):rawConnect(key,source,destination,owner);
function selectedSettings(link){const surface=[...selected].find(l=>l.context===link.context&&l.sources.size&&root.MygrainEffectInputs.matches(state.input,l.key));return surface===link?state:{...state,hum:0,clicks:0,crackle:0};}
function nodeSettings(link){return link.route==='drums'&&!link.surface?{...state,hum:0,clicks:0,crackle:0}:state;}
async function reconcile(){const token=++generation;
 // Remove the old insert before loading/activating another route. Never double-process.
 for(const link of selected)if(root.mygrainCookingPot?.active()||!root.mygrainEffectOutput.allows('turntable')||!state.enabled||!state.input||!root.MygrainEffectInputs.matches(state.input,link.key))selectedBypass(link);
 for(const link of bindings)if(state.input||root.mygrainCookingPot?.active()||!root.mygrainEffectOutput.allows('turntable')||!state.enabled||link.route!==state.route)bypass(link);
 for(const link of selected){link.dryGate.gain.value=root.mygrainCookingPot?.active()&&state.enabled&&state.input&&root.mygrainEffectOutput.allows('turntable')&&root.MygrainEffectInputs.matches(state.input,link.key)?0:1;}
 for(const link of bindings){const muted=root.mygrainCookingPot?.active()&&state.enabled&&state.route==='drums'&&link.route==='drums';if(muted&&!link.muted){unlink(link.source,link.destination);link.muted=true;}else if(!muted&&link.muted){link.source.connect(link.destination);link.muted=false;}}
 if(root.mygrainCookingPot?.active()||!root.mygrainEffectOutput.allows('turntable')||!state.enabled){emit();return;}
 for(const link of selected){if(!state.input||!root.MygrainEffectInputs.matches(state.input,link.key))continue;await prepare(link.context);if(token!==generation||!state.enabled)return;if(!selected.has(link)||link.context.state==='closed')continue;
  if(!link.node){const node=new AudioWorkletNode(link.context,'mygrain-turntable-v1',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',processorOptions:{settings:selectedSettings(link),clockAligned:true}});link.node=node;unlink(link.input,link.output);link.input.connect(node);node.connect(root.mygrainEffectOutput.input('turntable',link.context));node.onprocessorerror=()=>{error='Turntable processor stopped · dry signal restored';state.enabled=false;generation++;for(const l of selected)selectedBypass(l);emit();};}else link.node.port.postMessage({settings:selectedSettings(link)});
 }
 for(const link of bindings){if(state.input||link.route!==state.route)continue;await prepare(link.context);if(token!==generation||!state.enabled)return;if(!bindings.has(link)||link.context.state==='closed')continue;
  if(!link.node){const node=new AudioWorkletNode(link.context,'mygrain-turntable-v1',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{settings:nodeSettings(link),clockAligned:link.route==='drums'}});link.node=node;node.onprocessorerror=()=>{error='Turntable processor stopped · dry signal restored';state.enabled=false;generation++;for(const l of bindings)bypass(l);emit();};unlink(link.source,link.destination);link.source.connect(node);node.connect(link.route==='drums'?root.mygrainEffectOutput.input('turntable',link.context):link.destination);
  }else link.node.port.postMessage({settings:nodeSettings(link)});
 }emit();}
function restore(value){state=DSP.normalize(value);error='';pending=reconcile().catch(e=>{state.enabled=false;error=e.message;generation++;for(const l of bindings)bypass(l);for(const l of selected)selectedBypass(l);emit();throw e;});pending.catch(()=>{});emit();return pending;}
const api={connectExternal:(source,destination)=>selectedConnect('DAW',source,destination,null,true),inputs(ctx,route){return [...bindings].filter(b=>b.context===native(ctx)&&b.route===route).map(b=>({source:b.source,surface:b.surface}));},settings:()=>DSP.normalize(state),restore,prepare,whenReady:()=>pending,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},off(){return restore({...state,enabled:false})},
 bind(source,destination,{route='mix',surface=true}={}){for(const old of [...bindings])if(old.context.state==='closed')detach(old);const link={source,destination,context:source.context,route,surface,node:null};bindings.add(link);source.connect(destination);root.mygrainCookingPot?.syncSources();pending=reconcile();pending.catch(()=>{});return{disconnect(){detach(link);emit();}};},
 releaseContext(ctx){generation++;for(const l of [...selected])if(!ctx||l.context===native(ctx))releaseSelected(l);for(const l of [...bindings])if(!ctx||l.context===ctx||l.context===native(ctx))detach(l);emit();},
 diagnostics(){const active=[...bindings].filter(l=>l.node);return{enabled:state.enabled,route:state.route,input:state.input||(state.route==='drums'?'drums':'all'),processors:active.length+[...selected].filter(l=>l.node).length,selectedProcessors:[...selected].filter(l=>l.node).length,bindings:bindings.size,masterProcessors:active.filter(l=>l.route==='mix').length,drumProcessors:active.filter(l=>l.route==='drums').length,masterBindings:[...bindings].filter(l=>l.route==='mix').length,drumBindings:[...bindings].filter(l=>l.route==='drums').length,error};}};root.mygrainTurntable=api;
eq.releaseContext=ctx=>{api.releaseContext(ctx);return rawRelease(ctx)};
root.addEventListener('mygrain-effect-solo',()=>{pending=reconcile();pending.catch(()=>{});});
})(window);
