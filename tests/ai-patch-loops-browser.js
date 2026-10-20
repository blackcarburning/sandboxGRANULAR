const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const schema = require('../ai-patch-controls.json');
const base = process.env.AI_PATCH_TEST_URL || 'http://127.0.0.1:18876/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const out = process.env.AI_LOOP_EVIDENCE || '/tmp/mygrain-ai-loop-evidence'; fs.mkdirSync(out,{recursive:true});
function wav(hz) {
 const rate=44100,frames=rate*2,b=Buffer.alloc(44+frames*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*hz/rate)*6000),44+i*2);return b;
}
const suffix={A:'',B:'2',C:'3',V:'V',P:'P',O:'O',L:'L',X:'X',Q:'Q',M:'M','M+':'MPlus',K:'K'};
const params={globalBpmSlider:142,grainSize:280,lpfCutoff:7900,hpfCutoff:40};
for(const key of Object.keys(schema.loops)){
 const p='performanceBastardLoop'+suffix[key];params[p+(key==='Q'?'LevelMixer':'Level')]=25;
 if(key!=='Q')params[p+(key==='C'?'Pitch':'Semitone')]=key==='C'?-1:3;
 if(key!=='Q')params[p+'FilterCutoff']=4300;
}
const recipe={title:'Audible loop direction',description:'A real tempo, loop, sample and note change.',parameters:params,loops:Object.fromEntries(Object.keys(schema.loops).map(key=>[key,{enabled:true}]))};
Object.assign(recipe.loops.A,{reload:true,divisions:['1/8']});Object.assign(recipe.loops.L,{reload:true,notes:[60,null,64,67]});Object.assign(recipe.loops.X,{reload:true,notes:[36,null,43,null]});Object.assign(recipe.loops.Q,{instrument:'strings',chords:[[48,52,55]]});
const results=[];
(async()=>{
 for(const [engine,type] of Object.entries({chromium,webkit})){
  if(process.env.AI_PATCH_ENGINES&&!process.env.AI_PATCH_ENGINES.split(',').includes(engine))continue;
  const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
  try{for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1280,height:800}]){
   if(process.env.AI_PATCH_WIDTHS&&!process.env.AI_PATCH_WIDTHS.split(',').includes(String(viewport.width)))continue;
   const ctx=await browser.newContext({viewport,isMobile:viewport.width<960,hasTouch:viewport.width<960}),page=await ctx.newPage();page.setDefaultTimeout(45000);
   const errors=[];page.on('pageerror',e=>errors.push(e.message));let mode='normal',release,seen=0;
   await page.route('**/*',async r=>{
    const u=new URL(r.request().url());if(u.origin!==new URL(base).origin)return r.abort();
    if(u.pathname.endsWith('/api/ai-patch-direction'))return r.fulfill({json:{ok:true,model:'openai/gpt-6.1-sol',recipe}});
    if(r.request().method()==='POST'&&(u.pathname.endsWith('/api/bastardloop')||u.pathname.endsWith('/api/source-sample'))){
     const data=r.request().postDataJSON();seen++;if(mode==='hold'&&data.source==='samples_leads')await new Promise(resolve=>release=resolve);
     if(mode==='fail'&&data.source==='samples_leads')return r.fulfill({status:503,json:{error:'Test source unavailable.'}});
     const file=data.source==='sampledrop'?'ai-kick-fixture.wav':data.source==='samples_leads'?'ai-lead-fixture.wav':data.source==='samples_bass'?'ai-bass-fixture.wav':data.source+'-fixture.wav';
     const meta={sourceKey:data.source,sourceLabel:data.source,sampleNames:[file],bpm:data.bpm||142,durationSeconds:2};
     return r.fulfill({contentType:'audio/wav',headers:{'X-Mygrain-Bastardloop-Meta':Buffer.from(JSON.stringify(meta)).toString('base64url'),'X-Mygrain-Source-Name':encodeURIComponent(file),'X-Mygrain-Source-Path':encodeURIComponent(file),'X-Mygrain-Source-Key':data.source},body:wav(data.source==='sampledrop'?110:data.source==='samples_leads'?440:220)});
    }
    return r.continue();
   });
   try{
    const reg=await ctx.request.post(base+'api/auth/register',{data:{username:'ailoop'+Date.now(),password:'isolated-test-fixture'}});assert.equal(reg.status(),200);
    await page.goto(base);await page.waitForFunction(()=>mygrainAiPatch?.ready&&window.mygrainQ&&window.mygrainSongBeta&&!mygrainSongBeta.busy);
    await page.locator('#start-btn').click();await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
    await page.evaluate(async()=>{
     stopAllPerformancePlayback({silent:true});
     const tone=audioContext.createBuffer(1,44100,44100);for(let i=0;i<tone.length;i++)tone.getChannelData(0)[i]=Math.sin(2*Math.PI*77*i/44100)*.1;
     for(const apply of [applyLoadedBastardLoopBuffer,applyLoadedBastardLoop2Buffer,applyLoadedBastardLoop3Buffer,applyLoadedBastardLoopVBuffer,applyLoadedBastardLoopPBuffer,applyLoadedBastardLoopOBuffer])await apply(tone,'Original',{sampleNames:['original-77hz.wav'],bpm:120});
     for(const apply of [applyRecordedBastardLoopMBuffer,applyRecordedBastardLoopMPlusBuffer,applyRecordedBastardLoopKBuffer])await apply(tone,{bpm:120});
     window.__originalAIbuffer=bastardLoopBuffer;window.__originalM=bastardLoopMRawBuffer;window.__originalK=bastardLoopKRawBuffer;window.__originalContext=audioContext;
     syncBastardLoopKUi();window.__aiBaseline=saveState({force:true,snapshotOnly:true});
    });
    await page.locator('#aiPatchPrompt').fill('Change the tempo, samples and all loops.');
    await page.evaluate(()=>{document.getElementById('aiPatchCard').scrollIntoView();});
    mode='hold';await page.locator('#aiPatchGenerate').click();
    await page.waitForFunction(()=>document.getElementById('aiPatchChanges').textContent.includes('LOADED ai-kick-fixture.wav'));
    assert.equal(await page.evaluate(()=>sequencerBPM),142);
    assert.equal(await page.evaluate(()=>bastardLoopBuffer===window.__originalAIbuffer),false);
    assert.match(await page.locator('#aiPatchChanges').textContent(),/requesting fresh audio from samples_leads/);
    assert.equal(await page.evaluate(()=>mygrainAiPatch.busy),true);
    const deadline=Date.now()+10000;while(!release&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));assert(release);release();mode='normal';
    await page.waitForFunction(()=>!mygrainAiPatch.busy,{},{timeout:90000});
    assert.match(await page.locator('#aiPatchStatus').textContent(),/^Applied/);
    const actual=await page.evaluate(()=>({sliders:gatherPreset().sliders,inventory:mygrainAiPatchAdapter.inventory(),bpm:sequencerBPM,sameContext:audioContext===window.__originalContext,recordingUnchanged:bastardLoopMRawBuffer===window.__originalM&&bastardLoopKRawBuffer===window.__originalK,lead:bastardLoopLSequence.slice(0,4),bass:bastardLoopXSequence.slice(0,4),q:mygrainQ.getState(),firstSample:Array.from(bastardLoopBuffer.getChannelData(0).slice(0,100))}));
    for(const [key,value]of Object.entries(params))assert.equal(Number(actual.sliders[key]),value,key);
    for(const [key,lane]of Object.entries(actual.inventory))assert(lane.enabled&&lane.loaded,'real enabled/audio for '+key);
    assert(actual.sameContext&&actual.recordingUnchanged);assert.equal(actual.lead[0].note,'C4');assert(actual.lead[1].rest);assert.equal(actual.bass[0].note,'C2');assert.equal(actual.q.instrument,'strings');assert.deepEqual(actual.q.sequence[0].notes,[48,52,55]);
    assert(Math.abs(actual.firstSample[50]-Math.sin(2*Math.PI*110*50/44100)*6000/32768)<.001,'actual loaded PCM matches fixture');
    const log=await page.locator('#aiPatchChanges').textContent();for(const name of ['ai-kick-fixture.wav','ai-lead-fixture.wav','ai-bass-fixture.wav'])assert(log.includes('LOADED '+name));assert.match(log,/Loop Q: LOADED/);assert.equal(await page.locator('#aiPatchSamples li').count(),15);
    await page.locator('#aiPatchHear').click();await page.waitForFunction(()=>Boolean(bastardLoopSource));
    const audio=await page.evaluate(async()=>{const analyser=audioContext.createAnalyser();analyser.fftSize=2048;finalAmplifierNode.connect(analyser);await new Promise(r=>setTimeout(r,350));const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);finalAmplifierNode.disconnect(analyser);const qa=audioContext.createAnalyser();qa.fftSize=2048;mygrainQ.graph.pan.connect(qa);await new Promise(r=>setTimeout(r,200));const qd=new Float32Array(qa.fftSize);qa.getFloatTimeDomainData(qd);mygrainQ.graph.pan.disconnect(qa);return{qRms:Math.sqrt(qd.reduce((s,v)=>s+v*v,0)/qd.length),rms:Math.sqrt(data.reduce((s,v)=>s+v*v,0)/data.length),source:Boolean(bastardLoopSource.buffer?.length),playbackRate:bastardLoopSource.playbackRate.value,bpm:sequencerBPM};});assert(audio.rms>.0001,JSON.stringify(audio));assert(audio.source);assert(audio.qRms>.0001,'Q must be independently audible: '+JSON.stringify(audio));
    await page.screenshot({path:out+'/'+engine+'-'+viewport.width+'-applied.png'});
    await page.locator('#aiPatchUndo').click();await page.waitForFunction(()=>!mygrainAiPatch.busy);
    assert.match(await page.locator('#aiPatchStatus').textContent(),/^Undone/);
    assert.equal(await page.evaluate(()=>bastardLoopBuffer===window.__originalAIbuffer&&bastardLoopMRawBuffer===window.__originalM&&bastardLoopKRawBuffer===window.__originalK),true);
    assert.equal(await page.evaluate(()=>sequencerBPM),120);
    assert.equal(await page.evaluate(()=>Boolean(bastardLoopLSampleBuffer||bastardLoopXSampleBuffer)),false);
    // Cancellation after one real sample mutation restores it; no late decode enters the patch.
    mode='hold';release=null;await page.locator('#aiPatchGenerate').click();await page.waitForFunction(()=>document.getElementById('aiPatchChanges').textContent.includes('LOADED ai-kick-fixture.wav'));
    await page.locator('#aiPatchCancel').click();release?.();await page.waitForFunction(()=>!mygrainAiPatch.busy);assert.equal(await page.evaluate(()=>bastardLoopBuffer===window.__originalAIbuffer&&sequencerBPM===120),true);assert.match(await page.locator('#aiPatchStatus').textContent(),/restored/);
    mode='fail';await page.locator('#aiPatchGenerate').click();await page.waitForFunction(()=>!mygrainAiPatch.busy);assert.match(await page.locator('#aiPatchStatus').textContent(),/Test source unavailable/);assert.equal(await page.evaluate(()=>bastardLoopBuffer===window.__originalAIbuffer&&sequencerBPM===120&&mygrainAccounts.authenticated),true);
    mode='normal';
    for(const keys of [['B','C','V'],['P','O']]) {
     const loaded=await page.evaluate(async keys=>{const recipe={parameters:{globalBpmSlider:136},loops:Object.fromEntries(keys.map(key=>[key,{reload:true,enabled:true,divisions:['1/4']}]))};const result=await mygrainAiPatchAdapter.execute(recipe,mygrainAiPatchAdapter.fingerprint(),{signal:new AbortController().signal});const inventory=mygrainAiPatchAdapter.inventory();await mygrainAiPatchAdapter.undo(result.before,result.fingerprint);return inventory;},keys);
     for(const key of keys)assert(loaded[key].loaded&&loaded[key].samples[0].includes(schema.loops[key].source+'-fixture.wav'),'real loader mapping '+key);
    }
    assert.deepEqual(errors,[]);const result={engine,viewport,audio,changes:Object.keys(params).length,checks:['real-time-log-before-completion','actual-sample-PCM','all-12-loop-controls','all-8-library-loaders','Q-independently-audible','BPM-clock','lead-bass-chords','recordings-preserved','audible-final-output','undo-sample-identity','cancel-mid-load-rollback','source-failure-rollback'],errors};results.push(result);console.log(JSON.stringify(result));
   }catch(e){console.error('STATE',await page.evaluate(()=>({status:document.getElementById('aiPatchStatus')?.textContent,log:document.getElementById('aiPatchChanges')?.textContent,ready:mygrainAiPatch?.ready})),errors);throw e;}finally{release?.();await ctx.close();}
  }}finally{await browser.close();}
 }
 fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
