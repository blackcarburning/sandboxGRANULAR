/* All native and embedded range controls own touch from FIRST contact.
 * Delegation includes lazy dialogs/cards. Outside gestures and mouse/keyboard
 * stay native; input/change remain the canonical parameter-edit path. */
(function(root){'use strict';
if(root.mygrainSliderGesture)return;
const selector='input[type="range"]:enabled',touches=new Set();let drag=null;
const style=document.createElement('style');style.id='mygrain-slider-gesture-style';style.textContent='html body input[type="range"]{touch-action:none!important}#wireWorldCard label:has(input[type="range"]),#wireWorldCard .effect-lfo-field:has(input[type="range"]),#resonatorCard label:has(input[type="range"]),#heavyLifterCard label:has(input[type="range"]),#heavyLifterCard .heavy-mod-field:has(input[type="range"]){touch-action:none!important}';document.head.append(style);
function target(event){const path=event.composedPath?.()||[event.target];for(const node of path)if(node?.matches?.(selector))return node;
// Compact WireWorld, Resonator and Heavy Lifter rows include gaps beside the tiny range.
// Give those gaps to the same owner, not a second handler; other cards stay native.
const origin=path[0];if(origin?.closest?.('button,select,a,input,[role="button"]'))return null;
return origin?.closest?.('#wireWorldCard label,#wireWorldCard .effect-lfo-field,#resonatorCard label,#heavyLifterCard label,#heavyLifterCard .heavy-mod-field')?.querySelector(selector)||null;}
function update(point){if(!drag||!drag.element.isConnected||drag.element.disabled)return;const e=drag.element,r=e.getBoundingClientRect(),css=getComputedStyle(e),vertical=css.writingMode.startsWith('vertical')||e.getAttribute('orient')==='vertical';let t=vertical?1-(point.clientY-r.top)/Math.max(1,r.height):(point.clientX-r.left-11)/Math.max(1,r.width-22);if(css.direction==='rtl')t=1-t;const before=e.value,min=e.min===''?0:Number(e.min),max=e.max===''?100:Number(e.max);e.value=String(min+Math.max(0,Math.min(1,t))*(max-min));if(e.value!==before){drag.changed=true;e.dispatchEvent(new Event('input',{bubbles:true}));}}
function finish(){const d=drag;if(!d)return;drag=null;if(d.pointerId!=null&&d.element.hasPointerCapture?.(d.pointerId))d.element.releasePointerCapture(d.pointerId);if(d.changed&&d.element.isConnected)d.element.dispatchEvent(new Event('change',{bubbles:true}));}
function begin(element,point,pointerId=null,touchId=null){if(drag&&drag.element!==element)return false;if(!drag){drag={element,pointerId,touchId,changed:false};element.focus({preventScroll:true});}else{if(pointerId!=null)drag.pointerId=pointerId;if(touchId!=null)drag.touchId=touchId;}return true;}
// Safari can start native range/page gestures before a later touchmove cancel.
// Cancel touchstart itself, then drive the range through its real input events.
root.addEventListener('touchstart',event=>{const e=target(event);if(!e)return;for(const t of event.changedTouches)touches.add(t.identifier);if(event.cancelable)event.preventDefault();const t=event.changedTouches[0];if(t&&begin(e,t,null,t.identifier))update(t);},{capture:true,passive:false});
root.addEventListener('touchmove',event=>{if(![...event.changedTouches].some(t=>touches.has(t.identifier)))return;if(event.cancelable)event.preventDefault();if(drag?.touchId!=null){const t=[...event.changedTouches].find(t=>t.identifier===drag.touchId);if(t)update(t);}},{capture:true,passive:false});
function endTouches(event){const active=drag?.touchId;for(const t of event.changedTouches)touches.delete(t.identifier);if(active!=null&&[...event.changedTouches].some(t=>t.identifier===active))finish();}
for(const type of ['touchend','touchcancel'])root.addEventListener(type,endTouches,{capture:true,passive:true});
root.addEventListener('pointerdown',event=>{const e=target(event);if(!e||!['touch','pen'].includes(event.pointerType)||!event.isPrimary||event.button!==0)return;if(!begin(e,event,event.pointerId))return;if(event.cancelable)event.preventDefault();e.setPointerCapture?.(event.pointerId);queueMicrotask(()=>{if(drag?.pointerId===event.pointerId&&drag.touchId==null)update(event);});},{capture:true,passive:false});
root.addEventListener('pointermove',event=>{if(!drag||drag.pointerId!==event.pointerId)return;if(event.cancelable)event.preventDefault();if(drag.touchId==null)update(event);},{capture:true,passive:false});
for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,event=>{if(drag?.pointerId===event.pointerId&&drag.touchId==null)finish();},{capture:true});
function clear(){finish();touches.clear();}
root.addEventListener('pagehide',clear);root.addEventListener('blur',clear);document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});
root.mygrainSliderGesture=Object.freeze({version:'20261121-heavy-hit-area-1',diagnostics:()=>({active:!!drag,pointerId:drag?.pointerId??null,touchId:drag?.touchId??null,touches:touches.size})});
})(window);
