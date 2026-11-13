/* Linked Layer controls: no new sound state, audio clock, context or audible route. */
(function(root){
'use strict';
function create(win,host){
 if(win.__mygrainSongRenderDeck)return null;
 const doc=win.document,states=[],powers=[],removers=[];let gesture=null,context=null,disposed=false,queued=false,reads=0,samples=0;
 // Safari can release capture before a bubbling pointerup, or omit an old
 // release. Keep Chrome/CriOS and every other browser on the original path.
 const safari=/Safari\//.test(win.navigator?.userAgent||'')&&/Apple/.test(win.navigator?.vendor||'')&&!/(?:Chrome|Chromium|CriOS|Edg|OPR|FxiOS)\//.test(win.navigator?.userAgent||'');
 const listen=(el,type,fn,options)=>{el.addEventListener(type,fn,options);removers.push(()=>el.removeEventListener(type,fn,options))};
 const running=()=>host.context()?.state==='running';
 const active=s=>!s.button.disabled&&s.button.getAttribute('aria-pressed')==='true'&&(!s.config.audible||s.config.audible());
 const numeric=s=>Number(s.control.value)||0;
 const range=s=>({min:Number(s.control.min)||0,max:Number(s.control.max)||100,step:Number(s.control.step)||1});
 function level(s,value){const {min,max,step}=range(s);return Math.min(max,Math.max(min,Math.round((value-min)/step)*step+min))}
 function apply(s,value){if(disposed)return;host.set(s.control.id,level(s,value));refresh()}
 function draw(s,value){const next=Math.max(0,Math.min(100,Math.round(value)));if(s.vu!==next){s.vu=next;s.button.style.setProperty('--layer-vu',next+'%')}}
 function disconnect(s){
  for(const [node,tap]of s.taps){try{node.disconnect(tap.input)}catch{}try{tap.trim?.disconnect()}catch{}}
  s.taps.clear();if(s.meter){try{s.meter.split.disconnect()}catch{}for(const a of s.meter.analysers)try{a.disconnect()}catch{}s.meter=null}draw(s,0);
 }
 function ensureMeter(s){
  if(s.meter)return s.meter;
  const ctx=host.context(),split=ctx.createChannelSplitter(2),analysers=[ctx.createAnalyser(),ctx.createAnalyser()];
  // Retain transients between slow display ticks, not just an 11ms snapshot.
  const size=s.config.captureInterval?Math.min(32768,2**Math.ceil(Math.log2(ctx.sampleRate*.5))):512;
  for(let i=0;i<2;i++){analysers[i].fftSize=size;split.connect(analysers[i],i)}
  return s.meter={split,analysers,data:new Float32Array(size)};
 }
 function dropTap(s,node){const tap=s.taps.get(node);if(!tap)return;try{node.disconnect(tap.input)}catch{}tap.trim?.disconnect();s.taps.delete(node)}
 function attach(s,node,spec={gain:1}){
  const ctx=host.context();if(!node||node.context!==ctx)return;
  const meter=ensureMeter(s),gain=typeof spec.gain==='function'?spec.gain():spec.gain??1;let tap=s.taps.get(node);
  if(!tap){
   const trim=typeof spec.gain==='function'||gain!==1?ctx.createGain():null,input=trim||meter.split;
   try{if(trim){trim.gain.value=gain;trim.connect(meter.split)}node.connect(input);tap={input,trim};s.taps.set(node,tap)}
   catch{try{node.disconnect(input)}catch{}trim?.disconnect();return}
  }
  if(tap.trim&&tap.trim.gain.value!==gain)tap.trim.gain.value=gain;
 }
 function specifications(s){const ctx=host.context();return new Map((s.config.nodes?.()||[]).filter(Boolean).map(entry=>[entry.node||entry,entry.node?entry:{gain:1}]).filter(([node])=>node.context===ctx))}
 function syncTaps(s){
  const specs=specifications(s);
  for(const node of s.taps.keys())if(!specs.has(node))dropTap(s,node);
  for(const [node,spec]of specs)attach(s,node,spec);
  if(!specs.size&&!s.config.followGrains)disconnect(s);
 }
 function read(s){
  if(!running()||!active(s)||numeric(s)<=0){disconnect(s);return}
  reads++;syncTaps(s);
  // A stable tap sees short grains between display ticks. It remains owned by
  // visibility, never by the audio transport, and uses only two small analysers.
  if(s.config.followGrains)ensureMeter(s);
  const meter=s.meter;if(!meter)return;let energy=0;
  for(const a of meter.analysers){a.getFloatTimeDomainData(meter.data);samples++;let sum=0;for(const v of meter.data)sum+=v*v;energy+=sum/meter.data.length/2}
  const db=20*Math.log10(Math.max(1e-8,Math.sqrt(energy)));draw(s,db<=-60?0:(db+60)/60*100);
 }
 function refresh(){
  if(disposed)return;
  if(gesture&&!active(gesture.s)&&gesture.canAdjust){finish(true);return}
  const next=host.context();if(next!==context){context?.removeEventListener('statechange',refresh);context=next;context?.addEventListener('statechange',refresh);for(const s of states)disconnect(s)}
  for(const s of states){
   const {min,max}=range(s),value=numeric(s),enabled=active(s),soloMuted=s.button.getAttribute('aria-pressed')==='true'&&!enabled;
   s.button.classList.toggle('layer-volume-active',enabled);s.button.classList.toggle('layer-solo-muted',soloMuted);s.button.classList.toggle('layer-level-zero',enabled&&value===0);
   const fill=Math.round((value-min)/(max-min)*100),display=Math.round(value)+'%';
   if(s.button.dataset.layerLevel!==display){s.button.dataset.layerLevel=display;s.button.style.setProperty('--layer-volume',fill+'%')}
   const help=enabled?`Volume ${display}. Swipe or drag left/right to adjust; arrow keys adjust, Shift for larger steps. Tap to mute.`:soloMuted?'Muted by Solo. Clear Solo to adjust volume.':'Layer off. Tap to enable.';
   if(s.button.getAttribute('aria-description')!==help)s.button.setAttribute('aria-description',help);
   if(s.button.title!==help)s.button.title=help;
   if(!enabled||value<=0||!running())disconnect(s);
  }
  for(const p of powers){
   const enabled=Boolean(p.config.enabled());
   const pressed=String(enabled),text=p.config.label+(enabled?' On':' Off'),disabled=p.pending||Boolean(host.powerBusy?.()),help=p.pending?'Applying effect power change.':'Turn '+p.config.label+(enabled?' off.':' on.');
   if(p.button.getAttribute('aria-pressed')!==pressed)p.button.setAttribute('aria-pressed',pressed);
   if(p.button.textContent!==text)p.button.textContent=text;
   p.button.classList.toggle('layer-muted',!enabled);if(p.button.disabled!==disabled)p.button.disabled=disabled;
   if(p.button.getAttribute('aria-description')!==help)p.button.setAttribute('aria-description',help);
  }
  // Navigation remains enabled: grey communicates the sound state, not a disabled link.
  for(const button of doc.querySelectorAll('.section-jump-option,.section-jump-quick,.performance-layer-jump-btn,.performance-mixer-jump-btn,[data-jump-target],[data-jump-click],[data-gain-stage-control]')){
   const binding=host.navigation?.[button.dataset.navSection],state=states.find(s=>s.button.id===binding);
   if(!state&&typeof binding!=='function')continue;
   const muted=typeof binding==='function'?!binding():!active(state)||numeric(state)<=0;
   button.classList.toggle('layer-nav-muted',muted);
   button.dataset.layerActive=String(!muted);
   const help=muted?'Layer off or muted. Jump remains available.':'Layer enabled. Jump to its controls.';
   if(button.getAttribute('aria-description')!==help)button.setAttribute('aria-description',help);
  }
  win.mygrainMeters?.refresh();
 }
 function queueRefresh(){if(queued||disposed)return;queued=true;win.queueMicrotask(()=>{queued=false;refresh()})}
 function transaction(s,action){if(host.busy?.())throw Error('Wait for the current sound change to finish.');return host.edit('Layer volume: '+s.config.label,action)}
 function finish(cancel=false){
  const g=gesture;if(!g)return;gesture=null;
  if(g.drag||g.moved||cancel)g.s.suppressUntil=win.performance.now()+600;
  if(g.drag){if(cancel)apply(g.s,g.start);g.resolve?.()}
  try{if(g.s.button.hasPointerCapture(g.id))g.s.button.releasePointerCapture(g.id)}catch{}
  g.s.button.classList.remove('layer-level-dragging');
  if(g.touch&&!g.drag&&!g.moved&&!cancel){g.s.suppressUntil=win.performance.now()+600;g.s.button.click()}
 }
 // Proxy buttons own no saved state and never enter the volume-gesture map.
 for(const config of host.powers||[]){
  const jump=doc.getElementById(config.jumpId);if(!jump)continue;
  let button=doc.getElementById(config.buttonId);
  if(!button){const row=doc.createElement('div');row.className='performance-layer-switch-row';button=doc.createElement('button');button.id=config.buttonId;button.type='button';button.className='performance-btn';jump.before(row);row.append(button,jump);}
  button.parentElement.classList.add('performance-layer-switch-row--effect');
  if(!jump.classList.contains('acoustic-jump'))jump.textContent='Jump';
  const p={config,button,pending:false};powers.push(p);
  listen(button,'click',()=>{
   if(disposed||p.pending)return;
   const failed=error=>{if(!disposed)(host.powerError||host.error)?.(error.message)};
   try{
    if(host.powerBusy?.())throw Error('Finish the current edit or stop Song playback before changing effect power.');
    const identity=win.mygrainAccounts?.user?.username,ctx=host.context();
    const guard=()=>{if(disposed||host.context()!==ctx||win.mygrainAccounts?.user?.username!==identity||win.mygrainAccounts?.authenticated===false)throw Error('Account or audio changed. Effect power change cancelled.')};
    p.pending=true;refresh();
    Promise.resolve(host.edit(config.label+' power',()=>config.toggle(guard))).catch(failed).finally(()=>{p.pending=false;if(!disposed)refresh()});
   }catch(error){p.pending=false;refresh();failed(error)}
  });
 }
 // A new Safari contact cannot complete a previous button's abandoned touch.
 // Other browsers retain the exact original pointerdown/up registration.
 if(safari)listen(win,'pointerdown',e=>{if(e.isPrimary&&e.button===0&&gesture)finish(true)},{capture:true});
 for(const config of host.layers){
  const button=doc.getElementById(config.buttonId),control=doc.getElementById(config.controlId);if(!button||!control)continue;
  const s={config,button,control,taps:new Map(),meter:null,viewing:false,vu:-1,suppressUntil:0};states.push(s);button.classList.add('layer-level-button');
  listen(button,'pointerdown',e=>{
   if(gesture||!e.isPrimary||e.button!==0)return;
   s.suppressUntil=0;
   const canAdjust=active(s),touch=canAdjust&&e.pointerType==='touch';
   gesture={s,canAdjust,touch,id:e.pointerId,x:e.clientX,y:e.clientY,start:numeric(s),width:Math.max(80,button.getBoundingClientRect().width),drag:false,moved:false};
   // touch-action is set before contact. Own the finger immediately, without
   // moving keyboard focus or waiting for Safari to decide this is a page pan.
   if(touch){e.preventDefault();try{button.setPointerCapture(e.pointerId)}catch{}}
  },{passive:false});
  listen(button,'pointermove',e=>{
   const g=gesture;if(!g||g.s!==s||g.id!==e.pointerId)return;
   const dx=e.clientX-g.x,dy=e.clientY-g.y;
   if(g.touch)e.preventDefault();
   if(Math.max(Math.abs(dx),Math.abs(dy))>8)g.moved=true;
   if(!g.drag){
    if(!g.touch&&Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){finish();return}
    // A volume touch stays anchored even with vertical drift; only x sets level.
    if(Math.abs(dx)<(g.touch?4:8)||(!g.touch&&Math.abs(dx)<Math.abs(dy)*1.3))return;
    if(!g.canAdjust){g.moved=true;finish();return}
    try{
     const pending=new Promise(resolve=>{g.resolve=resolve});
     const result=transaction(s,()=>{g.drag=true;button.classList.add('layer-level-dragging');return pending});
     Promise.resolve(result).catch(error=>{if(gesture===g)finish(true);host.error?.(error.message)});
     if(!g.drag){finish(true);return}try{button.setPointerCapture(e.pointerId)}catch{}
    }catch(error){finish(true);host.error?.(error.message);return}
   }
   e.preventDefault();const {min,max}=range(s);apply(s,g.start+dx/g.width*(max-min));
  },{passive:false});
  listen(button,'click',e=>{if(e.detail!==0&&win.performance.now()<s.suppressUntil){e.preventDefault();e.stopImmediatePropagation()}},{capture:true});
  listen(button,'lostpointercapture',e=>{if(gesture?.id===e.pointerId)finish(true)});
  listen(button,'keydown',e=>{
   if(!active(s)||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
   e.preventDefault();const {min,max,step}=range(s),value=level(s,e.key==='Home'?min:e.key==='End'?max:numeric(s)+(['ArrowLeft','ArrowDown'].includes(e.key)?-1:1)*step*(e.shiftKey?10:1));
   try{Promise.resolve(transaction(s,()=>apply(s,value))).catch(error=>host.error?.(error.message))}catch(error){host.error?.(error.message)}
  });
  s.unwatch=win.mygrainMeters?.watch(button,()=>read(s),()=>{s.viewing=false;disconnect(s)},{interval:500,enabled:()=>running()&&active(s)&&numeric(s)>0,
   resume:()=>{s.viewing=true;if(config.followGrains)ensureMeter(s);syncTaps(s)}});
 }
 if(safari){
  listen(win,'pointerup',e=>{if(gesture?.id===e.pointerId)finish(!gesture.s.button.contains(e.target))},{capture:true});
  listen(win,'pointercancel',e=>{if(gesture?.id===e.pointerId)finish(true)},{capture:true});
 }else{
 listen(win,'pointerup',e=>{if(gesture?.id===e.pointerId)finish()});
 listen(win,'pointercancel',e=>{if(gesture?.id===e.pointerId)finish(true)});
 }
 listen(win,'pagehide',()=>finish(true));listen(win,'blur',()=>finish(true));
 listen(doc,'visibilitychange',()=>{if(doc.hidden)finish(true)});
 listen(doc,'input',e=>{if(states.some(s=>s.control===e.target)||host.mirrored?.(e.target))queueRefresh()},{capture:true});
 // Canonical sync/recall changes these attributes even when it writes volume silently.
 const observer=new win.MutationObserver(queueRefresh);
 for(const s of states)observer.observe(s.button,{attributes:true,attributeFilter:['aria-pressed','disabled','class']});
 observer.observe(doc.body,{subtree:true,attributes:true,attributeFilter:['data-nav-section','aria-pressed']});
 listen(win,'mygrain-history-update',queueRefresh);
 for(const unsubscribe of host.subscribe?.(queueRefresh)||[])removers.push(unsubscribe);
 function dispose(){if(disposed)return;finish(true);disposed=true;for(const p of powers)p.button.disabled=true;observer.disconnect();context?.removeEventListener('statechange',refresh);for(const s of states){s.unwatch?.();disconnect(s)}for(const remove of removers.splice(0))remove()}
 listen(win,'mygrain-account-lock',dispose);
 const grainState=states.find(s=>s.config.followGrains);
 function grainStarted(voice){
  const s=grainState;if(!s?.viewing||!running()||!active(s)||numeric(s)<=0)return;
  const entry=host.grainEntry?.(voice);if(entry)attach(s,entry.node,entry);
 }
 function grainEnded(voice){if(grainState)dropTap(grainState,voice.meterNode)}
 function sourcesChanged(controlId){for(const s of states)if(s.control.id===controlId&&s.viewing&&running()&&active(s)&&numeric(s)>0){syncTaps(s);for(const [node,tap]of s.taps)try{node.connect(tap.input)}catch{}}}
 refresh();return{refresh,dispose,grainStarted,grainEnded,sourcesChanged,snapshot:()=>({buttons:states.length,reads,samples,taps:states.reduce((sum,s)=>sum+s.taps.size,0),analysers:states.reduce((sum,s)=>sum+(s.meter?2:0),0),dragging:Boolean(gesture?.drag),interval:500})};
}
if(typeof module==='object'&&module.exports)module.exports={create};else {root.MygrainLayerControls={create};if(root.mygrainLayerControlHost)root.mygrainLayerControls=create(root,root.mygrainLayerControlHost);}
})(typeof window==='undefined'?globalThis:window);
