/* Local-only UI fixture: all APIs and writes are intercepted; no production requests. */
const {chromium,webkit}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const evidence=process.env.DESKTOP_JUMP_EVIDENCE||'/tmp/mygrain-desktop-card-jumps';
const baseline=process.env.DESKTOP_JUMP_BASELINE;
fs.mkdirSync(evidence,{recursive:true});
const origin='http://127.0.0.1:18916';
const results=[];
function palette(filename){const window={document:{readyState:'loading',addEventListener(){}}};vm.runInNewContext(fs.readFileSync(filename,'utf8'),{window});return JSON.parse(JSON.stringify(window.mygrainNavigation.palette));}
if(baseline)assert.deepEqual(palette(path.join(root,'navigation-palette.js')),palette(path.join(baseline,'navigation-palette.js.before')),'Pinned palette changed');
async function open(browser,width,height,touch=false,before=false){
 const context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch});
 const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();
  if(!['GET','HEAD'].includes(req.method()))return route.fulfill({json:{ok:true}});
  if(url.pathname.endsWith('/account-context.js'))return route.fulfill({body:'window.mygrainAccountContext={user:{username:"desktop-jump-fixture"}};',contentType:'application/javascript'});
  if(url.pathname.includes('/api/'))return route.fulfill({json:{ok:true,authenticated:true,user:{username:'desktop-jump-fixture'},samples:[],files:[],sources:[],stations:[],patches:[],songs:[],favourites:[],shares:[],users:[],takes:[],bookmarks:[]}});
  const relative=decodeURIComponent(url.pathname.replace(/^\/mygrain\//,''))||'index.html';
  const saved=before&&baseline&&['index.html','navigation-palette.js','navigation-palette.css'].includes(relative);
  const file=saved?path.join(baseline,relative+'.before'):path.resolve(root,relative);
  if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  return route.fulfill({body:fs.readFileSync(file),contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.wav':'audio/wav'})[path.extname(relative)]||'application/octet-stream'});
 });
 await page.goto(origin+'/mygrain/');await page.locator('#start-btn').click();
 await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
 await page.evaluate(()=>stopAllPerformancePlayback({silent:true}));await page.waitForTimeout(1500);
 return{page,context,errors};
}
async function snapshot(page,selector){return page.locator(selector).evaluateAll(nodes=>nodes.map(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return{id:n.id,label:n.getAttribute('aria-label'),classes:n.className,text:n.innerText,disabled:n.disabled,rect:[r.x,r.y,r.width,r.height],style:Object.fromEntries(['display','position','background','color','border','padding','fontSize','lineHeight','textAlign','opacity','boxShadow','width','height','transform','writingMode'].map(k=>[k,s[k]]))};}));}
async function idle(page){await page.waitForFunction(()=>!document.documentElement.dataset.mygrainJumping);await page.waitForTimeout(40);}
async function installMonitor(page){await page.evaluate(()=>{
 window.__jumpMonitor={events:[],frames:[],bad:[],scrolls:[]};
 const scroll=Element.prototype.scrollIntoView;
 Element.prototype.scrollIntoView=function(options){__jumpMonitor.scrolls.push({id:this.id,options,covered:document.documentElement.dataset.mygrainJumping==='true'});return scroll.call(this,options);};
 const n=document.getElementById('desktopJumpCurtain');
 new MutationObserver(()=>__jumpMonitor.events.push({hidden:n.hidden,time:performance.now(),y:scrollY})).observe(n,{attributes:true,attributeFilter:['hidden']});
 const tick=()=>{if(document.documentElement.dataset.mygrainJumping==='true'){
  const s=getComputedStyle(n),r=n.getBoundingClientRect(),hit=document.elementFromPoint(2,2);
  const valid=!n.hidden&&s.opacity==='1'&&s.backgroundColor==='rgb(4, 10, 18)'&&r.x===0&&r.y===0&&r.width===innerWidth&&r.height===innerHeight&&(hit===n||n.contains(hit));
  __jumpMonitor.frames.push({y:scrollY,valid});if(!valid)__jumpMonitor.bad.push({y:scrollY,css:s.cssText,hidden:n.hidden});
 }requestAnimationFrame(tick);};requestAnimationFrame(tick);
 });}
async function actualJump(page,selector,target){
 const before=await page.evaluate(()=>__jumpMonitor.events.length);
 // Dispatch the actual bound button action even when it lives below the fold of the dock.
 await page.locator(selector).first().evaluate(n=>n.click());
 assert.equal(await page.locator('#desktopJumpCurtain').isVisible(),true,selector+' shows curtain synchronously');
 await idle(page);
 assert.ok(await page.evaluate(n=>__jumpMonitor.events.slice(n).some(e=>!e.hidden),before),selector+' curtain was observed');
 if(target){const box=await page.locator(target).first().boundingBox();assert.ok(box&&box.y>=-5&&box.y<await page.evaluate(()=>innerHeight),selector+' destination '+JSON.stringify(box));}
}
(async()=>{for(const[name,type]of Object.entries({chromium,webkit})){
 if(process.env.DESKTOP_JUMP_ENGINES&&!process.env.DESKTOP_JUMP_ENGINES.split(',').includes(name))continue;
 const browser=await type.launch(name==='chromium'?{executablePath:'/snap/chromium/current/usr/lib/chromium-browser/chrome',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{
  for(const[width,height]of [[1024,768],[1440,1000],[1920,1080]]){
   if(process.env.DESKTOP_JUMP_WIDTHS&&!process.env.DESKTOP_JUMP_WIDTHS.split(',').includes(String(width)))continue;
   const{page,context,errors}=await open(browser,width,height);await installMonitor(page);
   const cards=await page.evaluate(()=>[...document.querySelectorAll('[data-nav-card]')].map(n=>{
    const key=n.dataset.navCard,button=document.querySelector(`.section-jump-drawer button[data-nav-section="${key}"]`);
    return{key,id:n.id,label:n.getAttribute('aria-label'),actual:getComputedStyle(n).backgroundImage,expected:button?getComputedStyle(button).backgroundImage:null};
   }));
   assert.ok(cards.length>=18,cards.length);for(const card of cards)assert.equal(card.actual,card.expected,card.key+' background');
   assert.equal(await page.locator('#performanceDrumMachineCard').getAttribute('data-nav-card'),null);
   let drumsUnchanged=false;
   if(baseline){const old=await open(browser,width,height,false,true);assert.deepEqual(await snapshot(page,'#performanceDrumMachineCard'),await snapshot(old.page,'#performanceDrumMachineCard'));assert.deepEqual(old.errors,[]);await old.context.close();drumsUnchanged=true;}
   const links=await page.locator('.section-jump-drawer [data-jump-target]').evaluateAll(nodes=>{
    const seen=new Set();return nodes.filter(n=>!n.dataset.jumpClick&&n.dataset.jumpTarget!=='.synth-container'&&!seen.has(n.dataset.jumpTarget)&&seen.add(n.dataset.jumpTarget)).map(n=>({target:n.dataset.jumpTarget,selector:n.id?'#'+n.id:`.section-jump-drawer [data-jump-target=${JSON.stringify(n.dataset.jumpTarget)}]`}));
   });
   for(const link of links)await actualJump(page,link.selector,link.target.replace(/'/g,'"')==='[aria-label="Mix controls"]'?'#performanceMixerTrimGrid':link.target);
   await page.locator('[aria-label="Bastardloop B controls"]').screenshot({path:path.join(evidence,`${name}-${width}-loop-b.png`)});
   // Layer-card Jump, mixer module Jump and exact mixer slider shortcut share the curtain.
   await actualJump(page,'#performanceKeyboardGrainJumpBtn','#grainAWaveformEditor');
   const moduleButton=page.locator('[data-performance-module-jump="performanceBastardLoopVLevel"]');
   if(await moduleButton.count())await actualJump(page,'[data-performance-module-jump="performanceBastardLoopVLevel"]','[aria-label="Bastardloop V controls"]');
   const sliderId='performanceMasterTrim';const value=await page.locator('#'+sliderId).inputValue();
   await page.evaluate(id=>jumpToPerformanceMixerSlider(id),sliderId);await idle(page);assert.equal(await page.locator('#'+sliderId).inputValue(),value);assert.equal(await page.locator('#'+sliderId).evaluate(n=>n===document.activeElement),true);
   await page.evaluate(id=>jumpToGainStageControl(id),sliderId);await idle(page);assert.equal(await page.locator('#'+sliderId).inputValue(),value);
   await actualJump(page,'.section-jump-drawer [data-jump-target=".synth-container"]',null);assert.equal(await page.locator('#oscPopupCloseBtn').isVisible(),true);await page.locator('#oscPopupCloseBtn').click();await page.waitForTimeout(500);
   await actualJump(page,'.section-jump-drawer [data-jump-click="#performanceWavBrowserBtn"]',null);assert.equal(await page.locator('#wavRepositoryBrowserCloseBtn').isVisible(),true);await page.locator('#wavRepositoryBrowserCloseBtn').click();await page.waitForTimeout(500);
   if(width===1024){
    // A delayed destination must remain covered until readiness resolves.
    let releaseVideo, videoRequested;
    const requested=new Promise(resolve=>{videoRequested=resolve;});
    const delayedVideoRoute=async route=>{videoRequested();await new Promise(resolve=>{releaseVideo=resolve;});await route.fulfill({json:{ok:true,bookmarks:[]}});};
    await page.route('**/api/videolab/bookmarks',delayedVideoRoute);
    await page.evaluate(()=>mygrainVideolab.close());
    await page.locator('.section-jump-drawer [data-jump-target="#performanceVideoLabCard"]').evaluate(n=>n.click());
    await Promise.race([requested,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Video readiness request did not start')),5000))]);await page.waitForTimeout(250);
    assert.equal(await page.locator('#desktopJumpCurtain').isVisible(),true);
    assert.equal(await page.locator('#desktopJumpCurtain p').textContent(),'jumping');assert.equal(await page.locator('#desktopJumpCurtain img').evaluate(n=>n.complete&&n.naturalWidth>0),true);
    await page.screenshot({path:path.join(evidence,`${name}-jumping.png`)});
    releaseVideo();await idle(page);await page.unroute('**/api/videolab/bookmarks',delayedVideoRoute);
    // Superseding, Escape, rejection and reduced motion cannot leave a stuck curtain.
    await page.evaluate(()=>mygrainNavigation.transitionJump(()=>({ready:new Promise(resolve=>window.__releaseOld=resolve)})));
    await page.waitForFunction(()=>window.__releaseOld);
    await page.evaluate(()=>mygrainNavigation.transitionJump(()=>({ready:new Promise(resolve=>window.__releaseNew=resolve)})));
    await page.waitForFunction(()=>window.__releaseNew);await page.evaluate(()=>__releaseOld());await page.waitForTimeout(80);assert.equal(await page.locator('#desktopJumpCurtain').isVisible(),true);
    await page.evaluate(()=>__releaseNew());await idle(page);
    await page.evaluate(()=>mygrainNavigation.transitionJump(()=>({ready:new Promise(resolve=>window.__releaseEscape=resolve)})));await page.waitForFunction(()=>window.__releaseEscape);await page.keyboard.press('Escape');assert.equal(await page.locator('#desktopJumpCurtain').isVisible(),false);await page.evaluate(()=>__releaseEscape());
    await page.evaluate(()=>mygrainNavigation.transitionJump(()=>{throw new Error('Synthetic navigation failure');}));await idle(page);
    await page.emulateMedia({reducedMotion:'reduce'});await actualJump(page,'#sectionJumpSongBtn','#songBetaCard');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.locator('#desktopTransportBtn').click();
    await page.waitForFunction(()=>sequencerPlaying||bastardLoopPlaying);
    assert.equal(await page.locator('#desktopJumpCurtain').isVisible(),false,'Transport is not a Jump');
    const state=await page.evaluate(()=>({sequencerPlaying,bastardLoopPlaying,time:audioContext.currentTime}));
    await actualJump(page,'#sectionJumpLayerSwitchBtn','#performanceLayerSwitchesCard');
    assert.deepEqual(await page.evaluate(()=>({sequencerPlaying,bastardLoopPlaying})),{sequencerPlaying:state.sequencerPlaying,bastardLoopPlaying:state.bastardLoopPlaying});assert.ok(await page.evaluate(t=>audioContext.currentTime>t,state.time));
    await page.locator('#desktopTransportBtn').click();assert.equal(await page.locator('#desktopJumpCurtain').isVisible(),false);
    await page.locator('#sectionJumpTransportBtn').click();await page.waitForFunction(()=>sequencerPlaying||bastardLoopPlaying);assert.equal(await page.locator('#desktopJumpCurtain').isVisible(),false,'Jump-dock transport must not show jumping');
    await page.locator('#sectionJumpTransportBtn').click();await page.waitForFunction(()=>!sequencerPlaying&&!bastardLoopPlaying);assert.equal(await page.locator('#desktopJumpCurtain').isVisible(),false);
   }
   const monitor=await page.evaluate(()=>__jumpMonitor);assert.deepEqual(monitor.bad,[]);assert.ok(monitor.frames.length>0);
   assert.ok(monitor.scrolls.filter(s=>s.covered).every(s=>s.options.behavior==='instant'));
   assert.deepEqual(errors,[]);results.push({engine:name,width,cardsMatched:cards.length,drumsUnchanged,mainDestinations:links.length,curtainFrames:monitor.frames.length,badFrames:monitor.bad.length,errors});console.log('PASS desktop',name,width);await context.close();
  }
  if(baseline)for(const[width,height]of [[390,844],[844,390],[1024,768]]){
   const old=await open(browser,width,height,true,true),now=await open(browser,width,height,true);
   const selector='.performance-feature-card,.performance-layer-switches-card,.section-jump-drawer,.section-jump-drawer button';
   assert.deepEqual(await snapshot(now.page,selector),await snapshot(old.page,selector),'mobile/touch computed styles and geometry changed');
   const oldScrolls=await old.page.evaluate(()=>{window.__mobileScrolls=[];Element.prototype.scrollIntoView=function(o){__mobileScrolls.push(o);};document.getElementById('sectionJumpSongBtn').click();return __mobileScrolls;});
   const nowScrolls=await now.page.evaluate(()=>{window.__mobileScrolls=[];Element.prototype.scrollIntoView=function(o){__mobileScrolls.push(o);};document.getElementById('sectionJumpSongBtn').click();return __mobileScrolls;});
   assert.deepEqual(nowScrolls,oldScrolls);assert.equal(await now.page.locator('#desktopJumpCurtain').isVisible(),false);assert.equal(await now.page.evaluate(()=>document.documentElement.dataset.mygrainJumping),undefined);
   assert.deepEqual(old.errors,[]);assert.deepEqual(now.errors,[]);results.push({engine:name,width,height,touch:true,stylesAndGeometryUnchanged:true,jumpBehaviorUnchanged:true});console.log('PASS touch unchanged',name,width,height);await old.context.close();await now.context.close();
  }
 }finally{await browser.close();}
}fs.writeFileSync(path.join(evidence,'RESULTS.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));})().catch(e=>{console.error(e);process.exitCode=1;});
