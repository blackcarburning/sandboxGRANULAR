'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(process.env.POPUP_BASELINE_HTML||require.resolve('../index.html'),'utf8');
function fixture(native){
 const listeners=[],style={getPropertyValue:()=>'',getPropertyPriority:()=>'',setProperty(){},removeProperty(){}};
 class Element{constructor(){this.style=style;this.parentElement=null}getClientRects(){return[{}]}closest(){return null}matches(){return false}querySelector(){return null}contains(el){return el===this}addEventListener(type,fn,opts){listeners.push({owner:this,type,fn,opts})}}
 const root=new Element(),body=new Element(),panel=new Element();panel.parentElement=body;
 const document={documentElement:root,body,querySelectorAll:()=>[panel],addEventListener:(type,fn,opts)=>listeners.push({owner:document,type,fn,opts})};
 const window={addEventListener:(type,fn,opts)=>listeners.push({owner:window,type,fn,opts}),scrollTo(){}};
 vm.runInNewContext(html.match(/<script id="mygrain-modal-scroll-guard">([\s\S]*?)<\/script>/)[1],{document,window,Element,CSS:{supports:()=>native},MutationObserver:class{observe(){}},getComputedStyle:()=>({visibility:'visible'}),scrollX:0,scrollY:0});
 return {listeners,document,panel};
}
test('modern WAV and arbitrary popup dialogs install no blocking touchmove/wheel or touchstart scanning',()=>{
 const f=fixture(true);assert.equal(f.listeners.filter(e=>['touchmove','wheel','touchstart'].includes(e.type)).length,0);
});
test('older browsers retain the boundary guard fallback',()=>{
 const f=fixture(false);assert(f.listeners.some(e=>e.owner===f.panel&&e.type==='touchmove'&&e.opts.passive===false));assert(f.listeners.some(e=>e.owner===f.panel&&e.type==='wheel'));assert(f.listeners.some(e=>e.owner===f.document&&e.type==='touchstart'));
});
test('blocking keyboard gestures are registered only on keyboard surfaces, never document',()=>{
 const bindings=[],keybed={addEventListener:(type,handler,options)=>bindings.push({type,handler,options})},document={querySelectorAll:selector=>{assert.equal(selector,'.keyboard-section');return[keybed]},addEventListener:()=>assert.fail('document must not receive keyboard blockers')};
 const start=html.indexOf('        // --- Touch Behaviour ---'),end=html.indexOf('        // --- Debug Functions ---',start);
 vm.runInNewContext(html.slice(start,end),{document});
 assert.deepEqual(bindings.map(x=>x.type),['touchstart','touchmove','touchend']);assert(bindings.every(x=>x.options.passive===false));
});
