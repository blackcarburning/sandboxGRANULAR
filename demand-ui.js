/* Display-only scroll budget. Never suspend a context, DSP or audio scheduler. */
(function(root){
    'use strict';
    function create(host){
        const doc=host.document,now=()=>host.performance.now();
        const eligible=!host.__mygrainSongRenderDeck &&
            (/iPhone|iPad|iPod/.test(host.navigator?.userAgent||'') || host.matchMedia?.('(any-pointer: coarse)').matches);
        let scrolling=false,timer=null,until=0,events=0,bursts=0,reason=null,width=host.innerWidth,height=host.innerHeight;
        const listeners=[];
        function settle(){
            timer=null;
            if(doc.hidden || now()>=until){
                scrolling=false;delete doc.documentElement.dataset.mygrainScrolling;
                host.dispatchEvent(new host.CustomEvent('mygrain-ui-settled'));
            }else timer=host.setTimeout(settle,Math.max(1,until-now()));
        }
        function mark(nextReason='scroll'){
            if(!eligible || doc.hidden)return;
            events++;reason=nextReason;until=now()+180;
            if(!scrolling){scrolling=true;bursts++;doc.documentElement.dataset.mygrainScrolling='true';host.dispatchEvent(new host.CustomEvent('mygrain-ui-busy'));}
            // At most one pending timer, including continuous momentum scrolling.
            if(timer===null)timer=host.setTimeout(settle,180);
        }
        function reset(){
            if(timer!==null)host.clearTimeout(timer);timer=null;until=0;
            scrolling=false;delete doc.documentElement.dataset.mygrainScrolling;
        }
        function listen(target,type,fn,options){target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));}
        if(eligible){
            listen(doc,'scroll',()=>mark('scroll'),{passive:true,capture:true});
            listen(host,'resize',()=>{
                if(host.innerWidth===width && host.innerHeight!==height)mark('viewport-height');
                width=host.innerWidth;height=host.innerHeight;
            },{passive:true});
            listen(doc,'visibilitychange',()=>{if(doc.hidden)reset();});
            listen(host,'pagehide',reset);
        }
        return {get busy(){return scrolling;},snapshot:()=>({eligible:Boolean(eligible),scrolling,events,bursts,reason}),
            destroy(){reset();for(const remove of listeners.splice(0))remove();}};
    }
    if(typeof module==='object'&&module.exports)module.exports={create};
    else root.mygrainUiActivity=create(root);
})(typeof window==='undefined'?globalThis:window);


/* One visibility-driven clock for legacy VUs. No polling when no meter is viewed. */
(function(root){
'use strict';
function createMeterScheduler(win){
 const doc=win.document, entries=new Map(), active=new Set();let timer=null,hidden=false;
 const blocked=()=>doc.hidden||hidden||win.__mygrainSongRenderDeck||win.mygrainUiActivity?.busy||doc.documentElement.dataset.mygrainJumping==='true';
 function schedule(){if(active.size&&!blocked()&&timer===null)timer=win.setTimeout(tick,125);else if((!active.size||blocked())&&timer!==null){win.clearTimeout(timer);timer=null}}
 function sync(){for(const e of entries.values()){const next=e.visible&&!blocked();if(!next&&active.delete(e))e.suspend?.();else if(next)active.add(e)}schedule()}
 function tick(){
  timer=null;if(blocked()){sync();return}
  // IO can lag a scroll/layout shift. Recheck only active meters immediately
  // before their read; a preceding label must not move a later meter offscreen.
  const now=win.performance.now();
  for(const e of active){const r=e.el.getBoundingClientRect?.();if(r&&(!r.width||!r.height||r.bottom<=0||r.right<=0||r.top>=win.innerHeight||r.left>=win.innerWidth)){active.delete(e);e.visible=false;e.suspend?.()}else e.read(now)}
  schedule()
 }
 const observer=win.IntersectionObserver?new win.IntersectionObserver(changes=>{for(const c of changes){const e=entries.get(c.target);if(e)e.visible=c.isIntersecting&&c.intersectionRatio>0}sync()},{threshold:[0,0.001]}):null;
 function watch(el,read,suspend){if(!el||!observer||win.__mygrainSongRenderDeck)return()=>{};const old=entries.get(el);if(old){old.read=read;old.suspend=suspend;sync();return old.remove}const e={el,read,suspend,visible:false};e.remove=()=>{if(entries.get(el)!==e)return;active.delete(e);entries.delete(el);observer.unobserve(el);e.suspend?.();schedule()};entries.set(el,e);observer.observe(el);return e.remove}
 doc.addEventListener('visibilitychange',sync);
 for(const event of ['mygrain-ui-busy','mygrain-ui-settled','mygrain-jump-change'])win.addEventListener(event,sync);
 win.addEventListener('mygrain-account-lock',()=>{for(const e of [...entries.values()])e.remove()});
 win.addEventListener('pagehide',()=>{hidden=true;sync()});win.addEventListener('pageshow',()=>{hidden=false;sync()});
 function refresh(container){if(container&&observer){for(const e of entries.values())if(container.contains(e.el)){observer.unobserve(e.el);observer.observe(e.el)}}sync()}
 return {watch,refresh,get blocked(){return Boolean(blocked())},snapshot:()=>({registered:entries.size,active:active.size,timer:timer!==null})};
}
if(typeof module==='object'&&module.exports)module.exports.createMeterScheduler=createMeterScheduler;
else if(root.document)root.mygrainMeters=createMeterScheduler(root);
})(typeof window==='undefined'?globalThis:window);

(function(root){
'use strict';
if(!root.document)return;
// Reclaim display-only backing stores. Never unload controls or audio state.
(function installViewportResources(){
 const doc=root.document, states=new Map(), visible=new Set(), pending=new Set();
 const cards=new Map();let released=0,redraws=0,parked=0;
 const style=doc.createElement('style');style.textContent='[data-mygrain-visual-parked], [data-mygrain-visual-parked] * { animation-play-state:paused!important; transition:none!important; will-change:auto!important; backdrop-filter:none!important; -webkit-backdrop-filter:none!important; }';doc.head.append(style);
 const blocked=()=>doc.hidden||root.mygrainUiActivity?.busy||doc.documentElement.dataset.mygrainJumping==='true';
 const inViewport=el=>{if(!el.isConnected||el.closest('[data-mygrain-visual-parked]'))return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<root.innerHeight&&r.left<root.innerWidth};
 function release(s){
  if(s.parked||s.el.tagName!=='CANVAS')return;
  const el=s.el,r=el.getBoundingClientRect();
  s.size=[el.width,el.height];s.css=[el.style.width,el.style.height];
  // Preserve layout even for canvases whose CSS height depends on their bitmap.
  if(r.width&&r.height){el.style.width=r.width+'px';el.style.height=r.height+'px'}
  el.width=0;el.height=0;s.parked=true;released++;s.invalidate?.();
  for(const paint of s.jobs.values())if('lastRender' in paint)paint.lastRender=null;
 }
 function restore(s){if(!s.parked)return;const el=s.el;el.style.width=s.css[0];el.style.height=s.css[1];el.width=s.size[0];el.height=s.size[1];s.parked=false}
 function draw(s){
  if(blocked()||!s.visible||!inViewport(s.el))return;
  restore(s);pending.delete(s);const jobs=[...s.jobs.values()];
  for(const [slot] of s.jobs)if(slot!=='paint')s.jobs.delete(slot);
  for(const job of jobs){redraws++;job()}
 }
 const canvasObserver=new IntersectionObserver(changes=>{for(const e of changes){const s=states.get(e.target);if(!s)continue;s.visible=e.isIntersecting&&e.intersectionRatio>0;if(s.visible){visible.add(s);pending.add(s);draw(s)}else{visible.delete(s);pending.add(s);release(s)}}},{threshold:[0,0.001]});
 function register(el){let s=states.get(el);if(!s){s={el,jobs:new Map(),visible:false,parked:false};if(el.dataset?.source)s.jobs.set('paint',()=>root.drawSourceWaveform?.(el.dataset.source));states.set(el,s);canvasObserver.observe(el)}return s}
 function reveal(el){for(let node=el;node;node=node.parentElement){const state=cards.get(node);if(state)revealCard(node,state)}}
 root.mygrainDisplay={
  reveal,
  canDraw(el,paint,slot='paint',invalidate){
   if(!el)return false;const s=register(el);s.jobs.set(slot,paint);if(invalidate)s.invalidate=invalidate;
   if(blocked()||!s.visible||!inViewport(el)){pending.add(s);return false}
   restore(s);pending.delete(s);if(slot!=='paint')s.jobs.delete(slot);return true;
  },
  snapshot(){let bytes=0,live=0;for(const s of states.values())if(s.el.tagName==='CANVAS'){bytes+=s.el.width*s.el.height*4;if(s.el.width&&s.el.height)live++}return{registered:states.size,visible:visible.size,pending:pending.size,backingBytes:bytes,liveCanvases:live,releases:released,redraws,cards:cards.size,parkedCards:parked}},
  refresh(){for(const s of visible)draw(s)}
 };
 const selector='.performance-feature-card,.performance-sound-card';
 function parkCard(el,state){
  if(state.parked||!el.isConnected||root.__mygrainSongRenderDeck)return;
  const r=el.getBoundingClientRect();if(!r.width||!r.height)return;
  // Release children before size containment makes their layout unavailable.
  for(const canvas of el.querySelectorAll('canvas')){const s=register(canvas);s.visible=false;visible.delete(s);pending.add(s);release(s)}
  const cs=root.getComputedStyle(el),height=Math.max(0,r.height-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom)-parseFloat(cs.borderTopWidth)-parseFloat(cs.borderBottomWidth));
  state.css=[el.style.contentVisibility,el.style.containIntrinsicBlockSize];
  el.style.containIntrinsicBlockSize=height+'px';el.style.contentVisibility='hidden';el.dataset.mygrainVisualParked='true';state.parked=true;parked++;
 }
 function revealCard(el,state){if(!state.parked)return;el.style.contentVisibility=state.css[0];el.style.containIntrinsicBlockSize=state.css[1];delete el.dataset.mygrainVisualParked;state.parked=false;parked--;cardObserver.unobserve(el);cardObserver.observe(el);root.mygrainMeters?.refresh(el);for(const canvas of el.querySelectorAll('canvas')){const s=states.get(canvas);if(s){canvasObserver.unobserve(canvas);canvasObserver.observe(canvas)}}}
 const cardObserver=new IntersectionObserver(changes=>{for(const e of changes){const state=cards.get(e.target);if(!state)continue;if(e.isIntersecting&&e.intersectionRatio>0)revealCard(e.target,state);else parkCard(e.target,state)}},{threshold:[0,0.001]});
 function addTree(el){
  if(el.nodeType!==1)return;
  for(const canvas of [...(el.matches('canvas')?[el]:[]),...el.querySelectorAll('canvas')])register(canvas);
  for(const card of [...(el.matches(selector)?[el]:[]),...el.querySelectorAll(selector)]){
   // Only leaf visual cards: never contain a scrolling page, nested cards or modal.
   if(card.querySelector(selector)||card.closest('[role="dialog"]')||cards.has(card))continue;
   for(let ancestor=card.parentElement?.closest(selector);ancestor;ancestor=ancestor.parentElement?.closest(selector)){const previous=cards.get(ancestor);if(previous){revealCard(ancestor,previous);cardObserver.unobserve(ancestor);cards.delete(ancestor)}}
   cards.set(card,{parked:false});cardObserver.observe(card);
  }
 }
 function cleanup(){for(const [el,s]of states)if(!el.isConnected){release(s);canvasObserver.unobserve(el);visible.delete(s);pending.delete(s);s.jobs.clear();states.delete(el)}for(const [el,state]of cards)if(!el.isConnected){if(state.parked)parked--;cardObserver.unobserve(el);cards.delete(el)}}
 const mutation=new MutationObserver(changes=>{let removed=false;for(const change of changes){for(const el of change.addedNodes)addTree(el);if(change.removedNodes.length)removed=true}if(removed)cleanup()});
 function settle(){for(const s of visible)if(pending.has(s))draw(s)}
 for(const event of ['mygrain-ui-settled','mygrain-jump-change'])root.addEventListener(event,settle);
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden){for(const s of states.values()){pending.add(s);release(s)}}else{for(const s of visible){pending.add(s);draw(s)}}});
 const nativeScroll=root.Element?.prototype.scrollIntoView;
 if(nativeScroll&&!root.__mygrainSongRenderDeck)root.Element.prototype.scrollIntoView=function(...args){reveal(this);return nativeScroll.apply(this,args)};
 function start(){if(root.__mygrainSongRenderDeck)return;addTree(doc.body);mutation.observe(doc.body,{subtree:true,childList:true})}
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

root.mygrainPhone=/iPhone|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
const jobs=new Map(),scripts=new Map(),inflight=new WeakMap();
function load(src,attributes={}){if(!scripts.has(src))scripts.set(src,new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;for(const [key,value] of Object.entries(attributes))el.setAttribute(key,value);const timer=setTimeout(()=>fail('Loading timed out: '),20000);const fail=message=>{clearTimeout(timer);scripts.delete(src);el.remove();reject(Error(message+src+'. Check the connection and retry.'));};el.onload=()=>{clearTimeout(timer);resolve();};el.onerror=()=>fail('Unable to load ');document.head.append(el)}));return scripts.get(src)}
const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting)run(e.target)},{rootMargin:'180px'});
function run(el){const opening=document.getElementById('start-overlay');if(opening&&getComputedStyle(opening).display!=='none'&&getComputedStyle(opening).opacity!=='0')return;const job=jobs.get(el);if(!job)return inflight.get(el); jobs.delete(el);observer.unobserve(el);const ready=Promise.resolve().then(job).catch(error=>{const retry=document.createElement('button');retry.textContent='Retry loading controls';retry.onclick=()=>{retry.remove();whenVisible(el,job);run(el)};const message=document.createElement('p');message.setAttribute('role','alert');message.textContent=error.message||'Unable to load controls. Please retry.';el.append(message,retry);console.error(error)});inflight.set(el,ready);return ready;}
function whenVisible(el,job){if(!el)return;jobs.set(el,job);observer.observe(el)}
root.mygrainDemand={load,whenVisible,run};
document.addEventListener('click',event=>{const button=event.target.closest('[data-jump-target]');if(button){let el;try{el=document.querySelector(button.dataset.jumpTarget)}catch{}if(el){run(el);for(const card of jobs.keys())if(el.contains(card)||card.contains(el))run(card)}}},true);
document.addEventListener('DOMContentLoaded',()=>{
 if(root.__mygrainSongRenderDeck)return;
 const opening=document.getElementById('start-overlay');if(opening)new MutationObserver(()=>{if(getComputedStyle(opening).display==='none'||getComputedStyle(opening).opacity==='0'){for(const card of jobs.keys()){observer.unobserve(card);observer.observe(card)}}}).observe(opening,{attributes:true,attributeFilter:['style']});
 const radio=()=>load('radiolab.js?v=20261027-fx-idle-1');
 whenVisible(document.getElementById('radiolabCard'),radio);
 whenVisible(document.getElementById('performanceVideoLabCard'),async()=>{const status=document.getElementById('videolabStatus');if(status)status.textContent='Loading Video Lab controls…';await radio();await load('videolab.js?v=20261028-instagram-1')});
 const card=document.createElement('section');card.id='waspCard';card.className='performance-feature-card wasp-card';card.innerHTML='<h3>F · THE WASP</h3><p>Two stings. Open to load controls.</p>';
 document.getElementById('finalPanSection')?.after(card);
 const nav=document.createElement('button');nav.type='button';nav.className='section-jump-option';nav.dataset.jumpTarget='#waspCard';nav.textContent='F · The Wasp';nav.onclick=()=>root.mygrainJumpToButton?.(nav);document.querySelector('[data-jump-target="#finalPanSection"]')?.parentElement.append(nav);
 whenVisible(card,async()=>{await load(root.mygrainPhone?'wasp-filter-phone.js?v=20261026-poles-1':'wasp-filter-desktop.js?v=20261026-mobile-vocals-1');card.removeAttribute('id');await load('wasp-ui.js?v=20261026-single-1');card.remove();nav.remove()});
});
})(typeof window==='undefined'?globalThis:window);
