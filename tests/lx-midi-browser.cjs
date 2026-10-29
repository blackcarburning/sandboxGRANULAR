// Read-only native audio regression: API writes and off-origin requests are blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');

(async () => {
 const results = [];
 for (const [engine, type] of Object.entries(process.env.BASELINE ? { chromium } : { chromium, webkit })) {
  const b = await type.launch(engine === 'chromium'
   ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {});
  try {
   const c = await b.newContext({viewport:{width:390,height:640},isMobile:engine==='chromium',hasTouch:true}), p = await c.newPage(), errors = [];
   p.on('pageerror', e => errors.push(e.message));
   await p.route('**/*', r => {
    const req = r.request(), u = new URL(req.url());
    if (u.origin !== 'https://openclaw.blackcarburning.com' || !['GET', 'HEAD'].includes(req.method())) return r.abort();
    if(process.env.BASELINE && ['/mygrain/','/mygrain/index.html'].includes(u.pathname)) return r.fulfill({contentType:'text/html',body:fs.readFileSync(process.env.BASELINE,'utf8')});
    if (u.pathname.endsWith('/account-context.js')) return r.fulfill({
     contentType: 'text/javascript', body: 'window.mygrainAccountContext={user:{username:"audio-regression-readonly"}}'
    });
    if (u.pathname.includes('/api/')) return r.fulfill({ json: {
     ok: true, authenticated: true, user: { username: 'audio-regression-readonly' },
     files: [], songs: [], folders: [], stations: [], samples: [], favourites: [], patches: []
    }});
    return r.continue();
   });
   await p.addInitScript(() => {
    const port={id:'fixture-midi',name:'Test keyboard',state:'connected',onmidimessage:null};
    window.testMidiPort=port;
    Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async()=>({inputs:new Map([[port.id,port]]),onstatechange:null})});
   });
   await p.goto('https://openclaw.blackcarburning.com/mygrain/');
   await p.waitForFunction(() => window.mygrainWEffects && document.documentElement.dataset.mygrainStartup === 'ready');
   await p.locator('#start-btn').click();
   await p.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended);




await p.evaluate(()=>stopAllPerformancePlayback({silent:true}));
for(const layer of ['X','L']) {
 await p.evaluate(layer=>{if(layer==='X')openBastardLoopXOverlay();else openBastardLoopLOverlay()},layer);
 await p.locator(`#bastardLoop${layer}MidiInput`).selectOption('fixture-midi');
 await p.waitForFunction(()=>!!window.testMidiPort.onmidimessage);
 await p.evaluate(layer=>{
  if(layer==='X'){bastardLoopXRecordArmed=true;setBastardLoopXEditStepIndex(0);}else{bastardLoopLRecordArmed=true;setBastardLoopLEditStepIndex(0);}
 },layer);
 const send=async data=>p.evaluate(data=>window.testMidiPort.onmidimessage({data}),data);
 await p.locator(`#bastardLoop${layer}MidiRestAssign`).click();
 await send([0x90,24,100]);await send([0x80,24,0]);
 assert((await p.locator(`#bastardLoop${layer}MidiStatus`).textContent()).includes('C1'));
 let cursor=await p.evaluate(layer=>layer==='X'?bastardLoopXEditStepIndex:bastardLoopLEditStepIndex,layer);assert.equal(cursor,0,'learn must not advance');
 await send([0x90,60,100]);await send([0x80,60,0]);
 await p.waitForFunction(layer=>(layer==='X'?bastardLoopXEditStepIndex:bastardLoopLEditStepIndex)===1,layer);
 await send([0x90,24,100]);await send([0x90,24,100]);await send([0x90,24,0]);
 await p.waitForFunction(layer=>(layer==='X'?bastardLoopXEditStepIndex:bastardLoopLEditStepIndex)===2,layer);
 let steps=await p.evaluate(layer=>(layer==='X'?bastardLoopXSequence:bastardLoopLSequence).slice(0,2),layer);
 assert.equal(steps[0].note,'C4');assert.equal(steps[1].rest,true);assert.equal(await p.evaluate(()=>lxMainMidiHeld.size),0,'editor must not double-trigger main keyboard');
 await p.locator(`#bastardLoop${layer}MidiRestAssign`).click();await send([0xB1,21,127]);await send([0xB1,21,0]);
 await send([0xB1,21,127]);await send([0xB1,21,127]);await send([0xB1,21,0]);
 await p.waitForFunction(layer=>(layer==='X'?bastardLoopXEditStepIndex:bastardLoopLEditStepIndex)===3,layer);
 assert((await p.locator(`#bastardLoop${layer}MidiStatus`).textContent()).includes('CC 21'));
 await p.evaluate(layer=>{if(layer==='X')bastardLoopXRecordArmed=false;else bastardLoopLRecordArmed=false;},layer);
 await send([0x90,62,100]);await send([0x90,62,0]);await send([0xB1,21,127]);await send([0xB1,21,0]);await p.waitForTimeout(180);
 assert.equal(await p.evaluate(layer=>layer==='X'?bastardLoopXEditStepIndex:bastardLoopLEditStepIndex,layer),3,'practice must not insert');
 for(const width of [390,430,1440]){await p.setViewportSize({width,height:800});await p.locator(`#bastardLoop${layer}MidiRestAssign`).scrollIntoViewIfNeeded();assert(await p.locator(`#bastardLoop${layer}MidiRestAssign`).isVisible());assert(await p.locator(`#bastardLoop${layer}MidiRestClear`).isVisible());const box=await p.locator(`#bastardLoop${layer}MidiStatus`).evaluate(el=>({rowWidth:el.parentElement.clientWidth,scrollWidth:el.parentElement.scrollWidth,top:el.getBoundingClientRect().top,buttonBottom:Math.max(...Array.from(el.parentElement.querySelectorAll('button,select'),b=>b.getBoundingClientRect().bottom))}));assert(box.scrollWidth<=box.rowWidth+1);assert(box.top>=box.buttonBottom-1,'status below controls');}
 await p.locator(`#bastardLoop${layer}MidiRestAssign`).click();
 await p.evaluate(layer=>{if(layer==='X')closeBastardLoopXOverlay();else closeBastardLoopLOverlay()},layer);
 assert.equal(await p.evaluate(()=>lxMidi.learn),null);
}
const stored=await p.evaluate(()=>JSON.parse(localStorage.getItem(lxMidiStorageKey)));
assert.equal(stored.X.number,21);assert.equal(stored.L.number,21);
await p.reload();await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');
assert((await p.locator('#bastardLoopXMidiStatus').textContent()).includes('CC 21'));
assert((await p.locator('#bastardLoopLMidiStatus').textContent()).includes('CC 21'));
await p.evaluate(()=>{Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:undefined});syncLxMidiUi();});
assert(await p.locator('#bastardLoopXMidiRestAssign').isDisabled());
assert((await p.locator('#bastardLoopXMidiStatus').textContent()).includes('iPhone Safari'));
console.log('PASS',engine,'X/L MIDI note entry, learned key/CC rests, latch/release, Practice, cancel on close, stored mappings/reload, 390/430/1440 layouts');
assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
