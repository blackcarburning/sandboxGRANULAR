// Actual isolated runtime: stationary navigation, trusted taps, native scrolling.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:19047/mygrain/';assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/mygrain\/$/);
const out=process.env.DRUM_NAV_EVIDENCE||'/tmp/drum-nav-evidence';fs.mkdirSync(out,{recursive:true});
const baseline=process.env.EXPECT_BASELINE==='1',lanes=['kick','snare','hat','perc','clap','cymbals','etc','roll'];
async function metrics(p){return p.evaluate(()=>{
 const s=document.querySelector('.drum-machine-shell'),n=document.querySelector('.drum-machine-jumps'),close=document.querySelector('#drumMachineCloseBtn');
 const hit=e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));};
 return {scroll:s.scrollTop,height:s.clientHeight,scrollHeight:s.scrollHeight,nav:n.getBoundingClientRect().toJSON(),buttons:[...n.children].map(e=>({lane:e.dataset.drumJump,hit:hit(e)})),close:hit(close),overflow:document.documentElement.scrollWidth>innerWidth+1};
});}
(async()=>{const results=[];for(const engine of(baseline?['chromium']:['chromium','webkit'])){
 const b=await({chromium,webkit}[engine]).launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});
 try{const c=await b.newContext({viewport:{width:390,height:740},hasTouch:true,isMobile:true});assert((await c.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).ok());const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await p.goto(base);await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});openDrumMachineOverlay();});
 for(const viewport of(baseline?[{width:390,height:740}]:[{width:320,height:640},{width:390,height:740},{width:844,height:390},{width:1280,height:900}])){
  await p.setViewportSize(viewport);await p.waitForTimeout(100);await p.evaluate(()=>document.querySelector('.drum-machine-shell').scrollTop=1e6);await p.waitForTimeout(80);const m=await metrics(p);results.push({engine,viewport,...m});
  if(baseline){assert(m.buttons.some(b=>!b.hit),'Baseline must reproduce missing navigation');await p.screenshot({path:out+'/baseline-bottom.png'});continue;}
  assert(m.buttons.every(b=>b.hit),JSON.stringify(m));assert(m.close);assert(!m.overflow);assert(m.height-(m.nav.bottom-(viewport.height-m.height)/2)>80,'Pinned controls must leave content room');
  for(const lane of lanes){const tab=p.locator(`[data-drum-jump="${lane}"]`);await tab.tap();assert.equal(await tab.getAttribute('aria-current'),'true');const pos=await p.locator('#drumMachineLane-'+lane).evaluate(e=>({card:e.getBoundingClientRect().top,pinned:document.querySelector('.drum-machine-sticky-nav').getBoundingClientRect().bottom}));assert(pos.card>=pos.pinned-1&&pos.card<pos.pinned+30,JSON.stringify({engine,viewport,lane,pos}));assert((await metrics(p)).buttons.every(b=>b.hit));}
  await p.screenshot({path:out+'/'+engine+'-'+viewport.width+'x'+viewport.height+'.png'});
 }
 if(!baseline){
  await p.setViewportSize({width:390,height:740});await p.evaluate(()=>{document.querySelector('.drum-machine-shell').scrollTop=1e6;restoreDrumMachineLaneSolos([]);});await p.waitForTimeout(400);
  const doubleTap=async tab=>{await tab.tap();await tab.tap();await p.waitForFunction(()=>!mygrainCardHistory.busy);};
  for(const lane of lanes){const tab=p.locator(`[data-drum-jump="${lane}"]`);await doubleTap(tab);assert.equal(await tab.getAttribute('aria-pressed'),'true',lane+' solo');await p.waitForTimeout(380);await doubleTap(tab);assert.equal(await tab.getAttribute('aria-pressed'),'false',lane+' unsolo');await p.waitForTimeout(380);}
  await p.evaluate(()=>startDrumMachine());assert(await p.evaluate(()=>drumMachinePlaying));const hat=p.locator('[data-drum-jump="hat"]');await doubleTap(hat);assert.equal(await hat.getAttribute('aria-pressed'),'true');assert(await p.evaluate(()=>drumMachinePlaying));await p.evaluate(()=>{stopDrumMachine();restoreDrumMachineLaneSolos([]);});
  // The snapshots panel must still initiate native vertical scrolling.
  await p.locator('#drumMachineOverlay .sequencer-snapshots > p').first().evaluate(e=>e.scrollIntoView({block:'center'}));await p.waitForTimeout(150);const note=p.locator('#drumMachineOverlay .sequencer-snapshots > p').first(),r=await note.boundingBox(),before=await p.evaluate(()=>document.querySelector('.drum-machine-shell').scrollTop);
  if(engine==='chromium'){const cdp=await c.newCDPSession(p),x=r.x+r.width/2,y=r.y+r.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*12}]});await p.waitForTimeout(20);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(200);assert(await p.evaluate(()=>document.querySelector('.drum-machine-shell').scrollTop)>before+30);}
  assert((await metrics(p)).buttons.every(b=>b.hit));await p.locator('#drumMachineCloseBtn').tap();assert(await p.locator('#drumMachineOverlay').isHidden());assert.deepEqual(errors,[]);
 }
 console.log('PASS',engine,baseline?'reproduced baseline missing navigation':'four pinned layouts; eight jumps/solo/unsolo; playing solo; snapshot scroll; Close');await c.close();}finally{await b.close()}
}fs.writeFileSync(out+'/'+(baseline?'baseline':'navigation')+'-results.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
