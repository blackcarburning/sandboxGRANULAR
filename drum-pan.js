/* Optional drum panning. No state/no pan preserves the historical audio graph. */
(function(root){
'use strict';
const lanes=['kick','snare','hat','perc','clap','cymbals','etc','roll'];
let state={version:1,lanes:{},hatSteps:[]},host;
const activeGestures=new Set();
const cancelGestures=()=>{for(const cancel of [...activeGestures])cancel();};
root.addEventListener('blur',cancelGestures);root.addEventListener('pagehide',cancelGestures);
const clamp=v=>Math.max(-1,Math.min(1,Number(v)||0));
const copy=v=>JSON.parse(JSON.stringify(v));
function normalize(s){
 const out={version:1,lanes:{},hatSteps:[]};
 if(s?.version!==1)return out;
 for(const lane of lanes)if(clamp(s.lanes?.[lane]))out.lanes[lane]=clamp(s.lanes[lane]);
 if(Array.isArray(s.hatSteps))out.hatSteps=s.hatSteps.slice(0,64).map(v=>v===null||v===undefined?null:clamp(v));
 while(out.hatSteps.length&&out.hatSteps.at(-1)===null)out.hatSteps.pop();
 return out;
}
function value(lane,step){return lane==='hat'&&Number.isInteger(step)&&state.hatSteps[step]!=null?state.hatSteps[step]:state.lanes[lane]||0;}
function capture(){const s=normalize(state);return Object.keys(s.lanes).length||s.hatSteps.some(v=>v!==null)?{drumPan:copy(s)}:{};}
function restore(s){state=normalize(s);refresh();}
function format(v){return v===0?'Centre':`${Math.round(Math.abs(v)*100)}% ${v<0?'L':'R'}`;}
function paintHat(button,step){
 const pan=value('hat',step);button.classList.add('drum-hat-pan');
 if(!button.querySelector('.drum-pan-label'))button.innerHTML='<span class="drum-pan-label">Accent</span>';
 button.style.setProperty('--pan-position',`${(pan+1)*50}%`);
 button.style.setProperty('--pan-fill-left',`${pan<0?(pan+1)*50:50}%`);
 button.style.setProperty('--pan-fill-width',`${Math.abs(pan)*50}%`);
 button.style.setProperty('--pan-fill-color',pan<0?'#138b39':'#bb2525');
 button.dataset.pan=String(pan);button.dataset.panOverride=String(state.hatSteps[step]!=null);
 button.setAttribute('aria-label',`Hat step ${step+1} accent; pan ${format(pan)}${state.hatSteps[step]!=null?' override':' (lane)'}; swipe left/right to pan, double tap to reset`);
}
function refresh(){
 if(!host)return;
 for(const lane of lanes){const input=host.document.querySelector(`[data-drum-pan="${lane}"]`);if(input){input.value=String(value(lane)*100);input.previousElementSibling.querySelector('output').textContent=format(value(lane));}}
 host.document.querySelectorAll('#drumMachineHatGrid .drum-machine-accent-btn').forEach((b,i)=>paintHat(b,i));
}
function run(label,action){try{return Promise.resolve(host.edit(label,action)).catch(host.error);}catch(e){host.error(e);return Promise.resolve();}}
function setLane(lane,pan){if(!lanes.includes(lane))throw Error('Invalid drum pan lane');state.lanes[lane]=clamp(pan);refresh();}
function setHat(step,pan){if(!Number.isInteger(step)||step<0||step>=64)throw Error('Invalid hat pan step');state.hatSteps=Array.from({length:Math.max(step+1,state.hatSteps.length)},(_,i)=>state.hatSteps[i]??null);state.hatSteps[step]=pan==null?null:clamp(pan);refresh();}
function connect(ctx,input,lane,override){const pan=override==null?value(lane):clamp(override);if(!pan)return null;const node=ctx.createStereoPanner();node.pan.value=pan;input.connect(node);return node;}
function bindHat(button,step){
 let gesture=null,suppress=false;
 const cancel=()=>{if(gesture)finish({pointerId:gesture.id},true);};
 button.addEventListener('pointerdown',e=>{if(e.isPrimary===false||e.button>0)return;cancel();activeGestures.add(cancel);gesture={id:e.pointerId,x:e.clientX,y:e.clientY,start:value('hat',step),before:copy(state),drag:false,ready:false,done:false};});
 button.addEventListener('pointermove',e=>{
  const g=gesture;if(!g||g.id!==e.pointerId)return;
  const dx=e.clientX-g.x,dy=e.clientY-g.y;
  if(!g.drag){if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){gesture=null;activeGestures.delete(cancel);return;}if(Math.abs(dx)<6)return;
   g.drag=true;suppress=true;button.setPointerCapture(e.pointerId);
   run('Hat step pan',()=>{g.ready=true;if(g.done){if(!g.cancelled)setHat(step,g.last);host.save();return;}return new Promise(resolve=>{g.resolve=resolve;setHat(step,g.last??g.start);});});
  }
  e.preventDefault();g.last=clamp(g.start+dx/Math.max(40,button.getBoundingClientRect().width)*2);if(g.ready&&!g.done)setHat(step,g.last);
 });
 const finish=(e,cancelled=false)=>{const g=gesture;if(!g||g.id!==e.pointerId)return;gesture=null;activeGestures.delete(cancel);g.done=true;g.cancelled=cancelled;if(!g.drag)return;if(cancelled){state=g.before;refresh();}host.save();g.resolve?.();setTimeout(()=>{suppress=false},500);};
 button.addEventListener('pointerup',e=>finish(e));button.addEventListener('pointercancel',e=>finish(e,true));button.addEventListener('lostpointercapture',e=>{if(e.target===button)finish(e,true);});
 button.addEventListener('click',e=>{if(suppress){e.preventDefault();e.stopImmediatePropagation();suppress=false;}},true);
 button.addEventListener('dblclick',e=>{e.preventDefault();run('Reset hat step pan',()=>{setHat(step,null);host.save();});});
 button.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','Delete','Backspace'].includes(e.key))return;e.preventDefault();run('Hat step pan',()=>{setHat(step,e.key==='ArrowLeft'?value('hat',step)-.05:e.key==='ArrowRight'?value('hat',step)+.05:null);host.save();});});
 paintHat(button,step);
}
function mount(h){host=h;h.document.addEventListener('visibilitychange',()=>{if(h.document.hidden)cancelGestures();});
 for(const lane of lanes){const card=h.document.getElementById(`drumMachineLane-${lane}`),group=card?.querySelector('.drum-machine-controls-grid, .drum-roll-controls');if(!group)continue;
  const field=h.document.createElement('div');field.className='performance-sound-card';const id=`drumMachine${lane[0].toUpperCase()+lane.slice(1)}Pan`;
  field.innerHTML=`<label for="${id}"><span>Pan</span><output>Centre</output></label><input type="range" id="${id}" data-drum-pan="${lane}" data-mirror-control="true" min="-100" max="100" step="1" value="0" aria-label="${lane} pan">`;group.append(field);
  const input=field.querySelector('input');let pending=null;
  const begin=()=>{if(pending)return;const p={};pending=p;activeGestures.add(end);run(`${lane} pan`,()=>new Promise(resolve=>{p.resolve=resolve;p.ready=true;if(p.value!==undefined)setLane(lane,p.value);if(p.done){h.save();resolve();}}));};
  input.addEventListener('pointerdown',begin);
  input.addEventListener('input',()=>{if(pending){pending.value=Number(input.value)/100;if(pending.ready)setLane(lane,pending.value);}else run(`${lane} pan`,()=>{setLane(lane,Number(input.value)/100);h.save();});});
  const end=()=>{if(!pending)return;const p=pending;pending=null;activeGestures.delete(end);p.done=true;p.value=Number(input.value)/100;h.save();p.resolve?.();};
  input.addEventListener('lostpointercapture',end);input.addEventListener('change',end);input.addEventListener('pointerup',end);input.addEventListener('pointercancel',end);input.addEventListener('blur',end);
 }
 const card=h.document.getElementById('drumMachineLane-hat');
 const hint=h.document.createElement('p');hint.className='sample-browser-status';hint.textContent='Swipe Accent ← / → to pan each hat, with accent On or Off. Yellow line = pan; green = left, red = right. Double-tap Accent to return to lane pan.';card.querySelector('.drum-machine-step-grid').before(hint);
 const reset=h.document.createElement('button');reset.type='button';reset.className='performance-btn';reset.textContent='Reset hat step pans';reset.dataset.resetHatPans='';reset.addEventListener('click',()=>run('Reset hat step pans',()=>{state.hatSteps=[];refresh();h.save();}));hint.before(reset);refresh();
}
root.MygrainDrumPan={renderVersion:m=>m?.drumMachineEnabled===true&&(Object.values(normalize(m.drumPan).lanes).some(Boolean)||normalize(m.drumPan).hatSteps.some(v=>v!=null&&v!==0))?1:0,normalize,capture,restore,value,connect,mount,bindHat,paintHat,setLane,setHat};
})(globalThis);
