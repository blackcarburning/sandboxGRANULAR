// Real catalogued WAVs + exact GET/build APIs; model responses are deterministic fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium,webkit}=require('playwright-core');
const base=process.env.AI_PATCH_TEST_URL||'http://127.0.0.1:18876/mygrain/';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const testRoot=fs.readFileSync(process.env.AI_CATALOGUE_SERVER_LOG||'/tmp/mygrain-ai-catalogue-server.log','utf8').split('\n')[0].split(': ')[1];
const out=process.env.AI_CATALOGUE_EVIDENCE||'/tmp/mygrain-ai-catalogue-exact';fs.mkdirSync(out,{recursive:true});const results=[];
(async()=>{for(const[engine,type]of Object.entries({chromium,webkit})){
 if(process.env.AI_PATCH_ENGINES&&!process.env.AI_PATCH_ENGINES.split(',').includes(engine))continue;
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
 try{for(const viewport of [{width:390,height:844},{width:1280,height:800}]){
  if(process.env.AI_PATCH_WIDTHS&&!process.env.AI_PATCH_WIDTHS.split(',').includes(String(viewport.width)))continue;
  const ctx=await browser.newContext({viewport,isMobile:viewport.width<960,hasTouch:viewport.width<960}),page=await ctx.newPage();page.setDefaultTimeout(90000);
  const username='catalogue'+Date.now();assert.equal((await ctx.request.post(base+'api/auth/register',{data:{username,password:'isolated-test-fixture'}})).status(),200);
  const fixture=JSON.parse(execFileSync('python3',[path.join(__dirname,'ai-catalogue-fixture.py'),testRoot,username],{encoding:'utf8'}));
  const sels=fixture.selections,events=[],errors=[];let mode='normal',release,held=false;
  let recipe={title:'Catalogue Cm',description:'Catalogue-selected root bass with piano and orchestral phrases; claims remain tentative.',parameters:{globalBpmSlider:104,performanceBastardLoopXSemitone:0,performanceBastardLoopXLevel:35,performanceBastardLoopPLevel:30,performanceBastardLoopOLevel:30},loops:{X:sels.X,P:sels.P,O:sels.O,Q:{enabled:false}},drums:{enabled:false}};
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());if(u.origin!==new URL(base).origin)return route.abort();
   if(u.pathname.endsWith('/api/ai-patch-direction'))return route.fulfill({json:{ok:true,model:'openai/gpt-6.1-sol',recipe,catalogue:{status:mode==='fallback'?'fallback':'ready',reason:'Fixture unavailable catalogue',catalogueCount:941,eligibleCount:5,shortlistCount:5,fallbackLanes:[]}}});
   if(u.pathname.endsWith('/api/source-sample')&&req.method()==='GET'){
    events.push({method:'GET',source:u.searchParams.get('source'),path:u.searchParams.get('path')});
    if(mode==='hold'){held=true;await new Promise(resolve=>release=resolve);}
    if(mode==='changed'){const response=await route.fetch(),body=await response.body();body[body.length-1]^=255;return route.fulfill({response,body});}
   }
   if(u.pathname.endsWith('/api/bastardloop')&&req.method()==='POST'){
    events.push({method:'POST',...req.postDataJSON()});
    if(mode==='wrongGenerated'){const response=await route.fetch(),meta=JSON.parse(Buffer.from(response.headers()['x-mygrain-bastardloop-meta'],'base64url').toString());meta.samplePaths=['wrong.wav'];return route.fulfill({response,headers:{...response.headers(),'x-mygrain-bastardloop-meta':Buffer.from(JSON.stringify(meta)).toString('base64url')}});}
   }
   return route.continue();
  });
  const ready=async()=>{await page.waitForFunction(()=>!mygrainAiPatch.busy);assert(await page.evaluate(()=>!megaRandomizeInFlight&&!stateSaveSuspended&&mygrainAccounts.authenticated&&audioContext===__catalogueContext));};
  const generate=async()=>{await page.locator('#aiPatchGenerate').click();await ready();assert.match(await page.locator('#aiPatchStatus').textContent(),/^Applied/);};
  const undo=async()=>{await page.locator('#aiPatchUndo').click();await ready();assert.match(await page.locator('#aiPatchStatus').textContent(),/^Undone/);};
  try{
   await page.goto(base);await page.waitForFunction(()=>mygrainAiPatch?.ready&&window.mygrainSongBeta&&!mygrainSongBeta.busy);await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
   await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});syncBastardLoopKUi();window.__catalogueContext=audioContext;window.__catalogueBefore=mygrainAiPatchAdapter.fingerprint();});
   await page.locator('#aiPatchPrompt').fill('C minor piano, strings and bass from the catalogue at 104 BPM');await generate();
   let state=await page.evaluate(()=>({root:bastardLoopXRootNote,meta:bastardLoopXSampleMetadata,p:bastardLoopPMetadata,o:bastardLoopOMetadata,inventory:mygrainAiPatchAdapter.inventory()}));
   assert.equal(state.root,sels.X.selection.playbackRoot.note);assert.equal(state.meta.relativePath,sels.X.selection.relativePath);
   for(const key of ['X','P','O']){assert(state.inventory[key].loaded&&state.inventory[key].enabled);assert((await page.locator('#aiPatchChanges').textContent()).includes('CATALOGUE '+sels[key].selection.name));}
   assert(events.some(e=>e.method==='GET'&&e.path===sels.X.selection.relativePath));for(const key of ['P','O'])assert(events.some(e=>e.source===sels[key].selection.source&&e.sourceFiles?.[0]===sels[key].selection.relativePath));
   await page.locator('#aiPatchHear').click();await ready();await page.locator('#aiPatchRender').click();await ready();assert.match(await page.locator('#aiPatchStatus').textContent(),/^Preview captured/);const capture=await page.locator('#aiPatchPreviewStatus').textContent();assert.match(capture,/RMS 0\.(?!0000)/);
   await generate();await undo();await page.locator('#aiPatchStop').click();
   mode='changed';await page.locator('#aiPatchGenerate').click();await ready();assert.match(await page.locator('#aiPatchStatus').textContent(),/changed since catalogue/);
   mode='hold';await page.locator('#aiPatchGenerate').click();await page.waitForFunction(()=>document.getElementById('aiPatchChanges').textContent.includes('CATALOGUE'));await page.waitForTimeout(200);assert(held);await page.locator('#aiPatchCancel').click();release?.();mode='normal';await ready();assert.match(await page.locator('#aiPatchStatus').textContent(),/restored/);
   mode='wrongGenerated';await page.locator('#aiPatchGenerate').click();await ready();assert.match(await page.locator('#aiPatchStatus').textContent(),/did not return the selected/);mode='normal';
   recipe={title:'Lead and vocal',description:'Other catalogue lanes',parameters:{performanceBastardLoopLLevel:32,performanceBastardLoopVLevel:30},loops:{L:sels.L,V:sels.V,X:{enabled:false},P:{enabled:false},O:{enabled:false}}};await generate();
   assert.equal(await page.evaluate(()=>bastardLoopLRootNote),sels.L.selection.playbackRoot.note);for(const key of ['L','V'])assert((await page.locator('#aiPatchChanges').textContent()).includes('CATALOGUE '+sels[key].selection.name));await undo();
   recipe={title:'Fallback controls',description:'Ordinary generation remains available',parameters:{lpfCutoff:4100},loops:{}};mode='fallback';await generate();assert((await page.locator('#aiPatchChanges').textContent()).includes('Catalogue fallback'));await undo();
   assert.deepEqual(errors,[]);await page.locator('#aiPatchCard').screenshot({path:out+'/'+engine+'-'+viewport.width+'.png'});
   const result={engine,viewport,capture,exactSources:Object.fromEntries(Object.entries(sels).map(([k,v])=>[k,v.selection.name])),roots:{X:sels.X.selection.playbackRoot,L:sels.L.selection.playbackRoot},checks:['exact-real-X-L-GET','exact-real-P-O-V-render','applied-catalogue-root','actual-nonsilent-capture','regenerate-no-restart','Undo','changed-audio-hash-rollback','mid-exact-load-cancel','generated-identity-mismatch-rollback','fallback','no-page-errors'],requests:events.length};results.push(result);console.log(JSON.stringify(result));
  }catch(e){console.error('STATE',await page.evaluate(()=>({status:document.getElementById('aiPatchStatus')?.textContent,log:document.getElementById('aiPatchChanges')?.textContent})));throw e;}finally{release?.();await ctx.close();}
 }}finally{await browser.close();}
}fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
