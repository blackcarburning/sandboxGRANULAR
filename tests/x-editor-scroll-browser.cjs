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
   await p.goto('https://openclaw.blackcarburning.com/mygrain/');
   await p.waitForFunction(() => window.mygrainWEffects && document.documentElement.dataset.mygrainStartup === 'ready');
   await p.locator('#start-btn').click();
   await p.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended);



await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});openBastardLoopXOverlay();});await p.waitForTimeout(250);
const geometry=await p.evaluate(()=>{
 const layout=document.querySelector('#bastardLoopXOverlay .lead-sequencer-layout');const key=document.querySelector('#bastardLoopXKeyboard .lead-sequencer-key');key.scrollIntoView({block:'center',behavior:'instant'});const b=key.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2,before:layout.scrollTop,max:layout.scrollHeight-layout.clientHeight,touchAction:getComputedStyle(key).touchAction,top:b.y,height:layout.clientHeight};
});let after=null;
if(engine==='chromium'){
const session=await c.newCDPSession(p);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:geometry.x,y:geometry.y}]});for(let i=1;i<=12;i++){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:geometry.x,y:geometry.y+i*12}]});await p.waitForTimeout(16);}await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(100);after=await p.evaluate(()=>document.querySelector('#bastardLoopXOverlay .lead-sequencer-layout').scrollTop);
if(process.env.BASELINE)assert.equal(after,geometry.before);else assert(Math.abs(after-geometry.before)>50,'Native vertical pan across the keyboard must scroll');
}
if(!process.env.BASELINE)assert.equal(geometry.touchAction,'pan-y pinch-zoom');
const held=await p.evaluate(()=>getSequencerKeyboardVoices('X').length);assert.equal(held,0);
// Desktop wheel remains scrollable while the playhead is painting.
await p.setViewportSize({width:1440,height:650});await p.evaluate(()=>{
 const layout=document.querySelector('#bastardLoopXOverlay .lead-sequencer-layout');layout.scrollTop=0;
 if(window.mygrainXDebug)window.mygrainXDebug.setEnabled(true);
});await p.waitForTimeout(100);
const wheelBox=await p.locator('#bastardLoopXOverlay .lead-sequencer-layout').boundingBox();
await p.mouse.move(wheelBox.x+wheelBox.width-20,wheelBox.y+60);await p.mouse.wheel(0,250);await p.waitForTimeout(150);
const desktop=await p.evaluate(async()=>{
 const layout=document.querySelector('#bastardLoopXOverlay .lead-sequencer-layout'),before=layout.scrollTop;
 for(let i=0;i<10 && typeof queueBastardLoopXPlayheadPaint==='function';i++){bastardLoopXCurrentStepIndex=i;queueBastardLoopXPlayheadPaint();await new Promise(requestAnimationFrame)}
 const after=layout.scrollTop;window.mygrainXDebug?.setEnabled(false);return{before,after,max:layout.scrollHeight-layout.clientHeight};
});if(!process.env.BASELINE){assert(desktop.before>0,'Desktop wheel must scroll X');assert.equal(desktop.after,desktop.before,'Playhead paint must not reset scrolling');}
console.log(engine,{...geometry,after,desktop});results.push({engine,...geometry,after,desktop});assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}
fs.writeFileSync((process.env.MYGRAIN_AUDIO_EVIDENCE || '/tmp')+'/'+(process.env.BASELINE?'baseline':'fixed')+'-x-scroll.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
