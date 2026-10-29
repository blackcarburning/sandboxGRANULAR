'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {create}=require('../demand-ui.js');
function fixture({touch=true,renderDeck=false}={}){
 let time=0,serial=0;const timers=new Map(),doc=new EventTarget(),win=new EventTarget(),listeners=[];
 doc.hidden=false;doc.documentElement={dataset:{}};
 const host={document:doc,navigator:{userAgent:touch?'iPhone':'Desktop'},matchMedia:()=>({matches:touch}),__mygrainSongRenderDeck:renderDeck,
  innerWidth:402,innerHeight:768,performance:{now:()=>time},CustomEvent,
  dispatchEvent:e=>win.dispatchEvent(e),addEventListener:(...a)=>{listeners.push(a);win.addEventListener(...a)},removeEventListener:(...a)=>win.removeEventListener(...a),
  setTimeout(fn,delay){const id=++serial;timers.set(id,{fn,at:time+delay});return id},clearTimeout:id=>timers.delete(id)};
 const ui=create(host);
 function advance(ms){time+=ms;for(const [id,t]of [...timers])if(t.at<=time){timers.delete(id);t.fn()}}
 return{ui,host,doc,win,timers,advance,listeners};
}
test('momentum scrolling uses one settling timer and emits one settled event per burst',()=>{
 const f=fixture();let settled=0;f.win.addEventListener('mygrain-ui-settled',()=>settled++);
 for(let i=0;i<40;i++){f.doc.dispatchEvent(new Event('scroll'));f.advance(10);assert.equal(f.timers.size,1);assert(f.ui.busy)}
 assert.equal(f.ui.snapshot().bursts,1);assert.equal(f.ui.snapshot().events,40);assert.equal(f.doc.documentElement.dataset.mygrainScrolling,'true');
 f.advance(200);assert.equal(f.ui.busy,false);assert.equal(f.timers.size,0);assert.equal(settled,1);assert.equal(f.doc.documentElement.dataset.mygrainScrolling,undefined);
});
test('height-only browser bar changes defer displays; real width changes do not masquerade as scrolling',()=>{
 const f=fixture();f.host.innerHeight=660;f.win.dispatchEvent(new Event('resize'));assert.equal(f.ui.snapshot().reason,'viewport-height');assert(f.ui.busy);f.advance(200);
 f.host.innerWidth=768;f.host.innerHeight=402;f.win.dispatchEvent(new Event('resize'));assert.equal(f.ui.busy,false);assert.equal(f.ui.snapshot().events,1);
});
test('background/pagehide/destroy clear timers and the display-only attribute',()=>{
 const f=fixture();f.doc.dispatchEvent(new Event('scroll'));f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(f.timers.size,0);assert(!f.ui.busy);
 f.doc.hidden=false;f.doc.dispatchEvent(new Event('scroll'));f.win.dispatchEvent(new Event('pagehide'));assert.equal(f.timers.size,0);
 f.doc.dispatchEvent(new Event('scroll'));f.ui.destroy();assert.equal(f.timers.size,0);f.doc.dispatchEvent(new Event('scroll'));assert(!f.ui.busy);
});
test('desktop and server render decks never install scroll budgeting or change audio state',()=>{
 for(const opts of [{touch:false},{renderDeck:true}]){const f=fixture(opts);f.doc.dispatchEvent(new Event('scroll'));assert.equal(f.ui.snapshot().eligible,false);assert.equal(f.timers.size,0);assert.equal(f.listeners.length,0)}
});
test('display work coalesces per slot, remains deferred while scrolling, and paints latest work on settling',()=>{
 const observers=[],doc=new EventTarget(),root=new EventTarget(),element={tagName:'CANVAS',width:12,height:8,style:{width:'',height:''},isConnected:true,closest:()=>null,getBoundingClientRect:()=>({width:12,height:8,top:0,left:0,right:12,bottom:8})};doc.hidden=false;doc.documentElement={dataset:{}};doc.readyState='loading';doc.head={append(){}};doc.createElement=()=>({});let paints=0;
 Object.assign(root,{document:doc,navigator:{userAgent:'Desktop'},performance:{now:()=>0},matchMedia:()=>({matches:false}),mygrainUiActivity:{busy:true},innerWidth:390,innerHeight:844});
 // Use the actual display queue, with only DOM discovery/lazy-loader setup stubbed.
 const source=fs.readFileSync(require.resolve('../demand-ui.js'),'utf8');const start=source.indexOf('// Reclaim display-only backing stores.'),end=source.indexOf('root.mygrainPhone=',start);
 const sandbox={root,document:doc,IntersectionObserver:class{constructor(fn){this.fn=fn;observers.push(this)}observe(){}unobserve(){}},MutationObserver:class{constructor(){}observe(){}},Map,WeakSet};
 vm.runInNewContext(source.slice(start,end),sandbox);
 assert.equal(root.mygrainDisplay.canDraw(element,()=>paints++),false);observers[0].fn([{target:element,isIntersecting:true,intersectionRatio:1}]);assert.equal(paints,0);
 for(let i=0;i<20;i++)assert.equal(root.mygrainDisplay.canDraw(element,()=>{paints=i+1}),false);
 root.mygrainUiActivity.busy=false;root.dispatchEvent(new Event('mygrain-ui-settled'));assert.equal(paints,20);
 root.dispatchEvent(new Event('mygrain-ui-settled'));assert.equal(paints,20,'must not replay a backlog');
 doc.documentElement.dataset.mygrainJumping='true';
 for(let i=0;i<5;i++)assert.equal(root.mygrainDisplay.canDraw(element,()=>{paints=100+i}),false);
 root.dispatchEvent(new Event('mygrain-jump-change'));assert.equal(paints,20);
 delete doc.documentElement.dataset.mygrainJumping;root.dispatchEvent(new Event('mygrain-jump-change'));assert.equal(paints,104,'reveal paints latest work exactly once');
 root.dispatchEvent(new Event('mygrain-jump-change'));assert.equal(paints,104);
 observers[0].fn([{target:element,isIntersecting:false,intersectionRatio:0}]);assert.equal(element.width,0);assert.equal(element.height,0);assert.equal(root.mygrainDisplay.snapshot().backingBytes,0);
 observers[0].fn([{target:element,isIntersecting:true,intersectionRatio:1}]);assert.equal(element.width,12);assert.equal(element.height,8);assert.equal(paints,104);assert.equal(root.mygrainDisplay.snapshot().releases,1);
});
