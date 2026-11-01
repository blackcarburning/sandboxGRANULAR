'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const base='http://127.0.0.1:18983/mygrain/';
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
if(process.env.D_ENGINE&&process.env.D_ENGINE!==engine)continue;
const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']}:{});
try{const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});await ctx.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-d-loop'}});const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push({name:e.name,message:e.message,stack:e.stack}));p.setDefaultTimeout(45000);
async function start(){await p.waitForFunction(()=>window.mygrainD&&window.mygrainSongBetaAdapter&&document.documentElement.dataset.mygrainStartup==='ready');await p.evaluate(()=>mygrainCardHistory.ready);await p.locator('#start-btn').tap();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);}
if(engine==='webkit')await p.addInitScript(()=>{const Native=window.AudioContext||window.webkitAudioContext;window.AudioContext=class extends Native{constructor(options){super({...options,sampleRate:48000})}}});await p.goto(base);await start();await p.evaluate(()=>{stopAllPerformancePlayback({silent:true});applyGlobalBpm(120);syncPatternLengthControls(32,{skipSave:true});});
assert.equal(await p.locator('#bastardLoopDCard .instrument-splash-badge').textContent(),'D');
await p.locator('#loopDRandom').scrollIntoViewIfNeeded();await p.locator('#loopDRandom').tap();await p.waitForFunction(()=>!mygrainD.busy&&!mygrainCardHistory.busy&&!!bastardLoopDBuffer);
const fit=await p.evaluate(async()=>{
 const d=mygrainD,raw=bastardLoopDBuffer;window.dHash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b.getChannelData(0)))).join(',');
 const original=await dHash(raw);const results=[];
 for(const bpm of [93,120,173])for(const steps of [8,32,64])for(const fill of ['single','repeat']){applyGlobalBpm(bpm);syncPatternLengthControls(steps,{skipSave:true});const value={...d.settings(),fill};d.restore(value);const b=d.playback();results.push({bpm,steps,fill,frames:b.length,expected:Math.round(steps*60/bpm/4*b.sampleRate),repeats:d.repetitions(),energy:b.getChannelData(0).reduce((n,v)=>n+v*v,0)});}
 applyGlobalBpm(120);syncPatternLengthControls(32,{skipSave:true});d.restore({...d.settings(),enabled:true,fill:'repeat'});d.enable(true,{skipSave:true});const before=d.playback();const source=await dHash(raw);d.randomGaps({skipSave:true});const cut=d.settings().cut,b=d.playback();
 let zeros=0;for(const[a,z]of cut.gaps){const data=b.getChannelData(0);for(let i=Math.ceil(a*data.length)+220;i<Math.floor(z*data.length)-220;i++)if(data[i]===0)zeros++;}
 return {results,original,source,after:await dHash(raw),zeros,cut,sourceKey:bastardLoopDMetadata.sourceKey};
});assert(fit.results.every(x=>x.frames===x.expected&&x.energy>0));assert(fit.results.filter(x=>x.fill==='single').every(x=>x.repeats===1));assert(fit.results.some(x=>x.repeats>1));assert.equal(fit.original,fit.after);assert(fit.zeros>100);assert.equal(fit.sourceKey,'samples_loops');
console.log('PASS',engine,'18 exact-frame fit modes and source-preserving gaps');
// Real browser source selection, history, and local file import share one fitter.
await p.locator('#loopDBrowse').tap();await p.waitForFunction(()=>document.querySelectorAll('#dropboxSampleBrowserList .sample-browser-card').length===2);const previousPath=await p.evaluate(()=>bastardLoopDMetadata.relativePath),chosen=previousPath.endsWith('Other_120bpm.wav')?'Drums/Bass/Loop_120bpm.wav':'Drums/Bass/Other_120bpm.wav';await p.locator('#dropboxSampleBrowserList .sample-browser-card').filter({hasText:chosen}).getByRole('button',{name:'Load Loop D',exact:true}).tap();await p.waitForFunction(path=>!mygrainD.busy&&!mygrainCardHistory.busy&&bastardLoopDMetadata?.relativePath===path,chosen);
const beforeUndo=await p.evaluate(()=>dHash(bastardLoopDBuffer));await p.evaluate(()=>mygrainCardHistory.undo());assert.equal(await p.evaluate(()=>bastardLoopDMetadata?.relativePath),previousPath);await p.evaluate(()=>mygrainCardHistory.redo());assert.equal(await p.evaluate(()=>dHash(bastardLoopDBuffer)),beforeUndo);
await p.locator('#loopDFile').setInputFiles({name:'Imported_120bpm.wav',mimeType:'audio/wav',buffer:fs.readFileSync('/tmp/mygrain-d-20261101/admin/source_mirrors/SAMPLES_LOOPS/Drums/Bass/Loop_120bpm.wav')});await p.waitForFunction(()=>!mygrainD.busy&&!mygrainCardHistory.busy&&bastardLoopDMetadata?.sourceKey==='import');
await p.locator('#loopDCut').tap();assert.equal(await p.locator('#bastardLoopDCutOverlay').isVisible(),true);await p.locator('#bastardLoopDCutRandomize').tap();await p.waitForFunction(()=>!mygrainCardHistory.busy);await p.locator('#bastardLoopDCutClose').tap();
console.log('PASS',engine,'browse/import/Undo/Redo/cut editor');
// Exercise actual Mega task dispatch while bounding unrelated generators.
const batches=await p.evaluate(async()=>{
 const originals={patch:runPatchRandomization,build:buildMegaRandomBastardLoopTaskSpecs,grain:loadMegaRandomGranularSample,l:loadBastardLoopLSampleFromSource,x:loadBastardLoopXSampleFromSource,drop:loadDropboxSampleLayerFromSource,drums:loadRandomDrumMachineSamples};
 const records=[];const load=mygrainD.random;mygrainD.random=async o=>{records.push(o);return load(o)};
 runPatchRandomization=async()=>({randomizeState:{bpm:120}});buildMegaRandomBastardLoopTaskSpecs=()=>[];loadMegaRandomGranularSample=loadBastardLoopLSampleFromSource=loadBastardLoopXSampleFromSource=loadDropboxSampleLayerFromSource=loadRandomDrumMachineSamples=async()=>{};
 try{for(const sparseMode of [false,true])await runMegaRandomization({sparseMode});return {records,eligible:SPARSE_RANDOM_LAYER_DEFINITIONS.some(x=>x.key==='bastardd'),source:bastardLoopDMetadata.sourceKey};}
 finally{runPatchRandomization=originals.patch;buildMegaRandomBastardLoopTaskSpecs=originals.build;loadMegaRandomGranularSample=originals.grain;loadBastardLoopLSampleFromSource=originals.l;loadBastardLoopXSampleFromSource=originals.x;loadDropboxSampleLayerFromSource=originals.drop;loadRandomDrumMachineSamples=originals.drums;mygrainD.random=load;}
});assert.equal(batches.records.length,2);assert(batches.records.every(x=>x.batch));assert(batches.eligible);assert.equal(batches.source,'samples_loops');
// D is never source-randomised in reels; its real arrangement callback changes gaps only.
const arrangement=require('../scripts/instareel-arrangement.cjs');
const reel=await p.evaluate(async source=>{
 stopAllPerformancePlayback({silent:true});mygrainD.enable(true,{skipSave:true});const hash=await dHash(bastardLoopDBuffer),meta=JSON.stringify(bastardLoopDMetadata),cut=mygrainD.settings().cut;
 const apply=(0,eval)(source);apply.prepare({variation:'moderate',seed:123,bpm:120,duration:16,warmup:4,events:[{at:0},{at:16}],options:{notes:false,drums:false,recutV:false}});
 const events=apply.cutEvents().filter(e=>e.key==='D'),event=events.find(e=>!e.restore);if(!event)throw Error('No D reel cut events');const next=apply.cut(event);apply.cleanup();
 return {events,next,cut,hash,after:await dHash(bastardLoopDBuffer),meta,afterMeta:JSON.stringify(bastardLoopDMetadata)};
},arrangement.toString());assert.equal(reel.after,reel.hash);assert.equal(reel.afterMeta,reel.meta);assert(reel.next.gapEnabled&&reel.next.gaps.length>0);for(const k of ['start','end','repeat','stretch','targetStart','targetDuration'])assert.equal(reel.next[k],reel.cut[k]);
// New D and legacy pre-D parts through real private server render jobs.
await p.evaluate(force=>window.dForceServer=force,process.env.D_FORCE_SERVER==='1');
const songs=await p.evaluate(async()=>{
 stopAllPerformancePlayback({silent:true});applyGlobalBpm(240);syncPatternLengthControls(8,{skipSave:true});setFxMuted(true,{silent:true});setLoopLayerSolo('bastardd',{silent:true,skipSave:true});mygrainD.enable(true,{skipSave:true});mygrainD.randomGaps({skipSave:true});
 const c=mygrainSongBeta;document.getElementById('songBetaName').value='Loop D regression';await c.newSong();await c.newPart({name:'D loop',repeats:1});
 // Legacy part uses W PCM and no D settings/audio. No synthetic silence fixture.
 const old=mygrainD.settings();await applyLoadedBastardLoopWBuffer(bastardLoopDBuffer,'Legacy W fixture',{sourceKey:'samples_modular',bpm:240,durationSeconds:bastardLoopDBuffer.duration});mygrainD.restore(null);bastardLoopDBuffer=null;setBastardLoopWEnabled(true,{skipSave:true,silent:true});setLoopLayerSolo('bastardw',{skipSave:true,silent:true});await c.newPart({name:'Pre-D part',repeats:1});await c.finishEditing();
 const part=c.song.parts[1],zip=await c.request(`/${c.song.id}/parts/${part.id}`,{binary:true}),entries=parseStoredZipEntries(zip),snapshot=JSON.parse(getZipText(entries,'song-part.json'));delete snapshot.state.modes.loopD;delete snapshot.state.modes.loopFx.channels.D;delete snapshot.state.modes.channelEq.channels.D;delete snapshot.extra.audioSlots.bastardD;
 function stripD(value){if(Array.isArray(value))return value.filter(x=>!x?.id||!/^(?:loopD|bastard(?:Loop)?D|performanceBastardLoopD)/i.test(x.id)).map(stripD);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).filter(([k])=>!/^(?:loopD|bastard(?:Loop)?D|performanceBastardLoopD)/i.test(k)).map(([k,v])=>[k,stripD(v)]));}Object.assign(snapshot,stripD(snapshot));
 const legacy=await createStoredZip([...entries].map(([path,data])=>({path,data:path==='song-part.json'?JSON.stringify(snapshot):data})));await c.run(()=>c.amendPart(part));c.acceptSong((await c.request(`/${c.song.id}/parts/${part.id}/save?sha256=${part.sha256}`,{method:'POST',headers:{'Content-Type':'application/zip'},body:legacy})).song);await c.finishEditing();
 await c.recall(c.song.parts[1],{start:false});const legacyOff=!mygrainD.settings().enabled&&!bastardLoopDBuffer;
 await c.recall(c.song.parts[0],{start:false});const restored=!!bastardLoopDBuffer&&mygrainD.settings().enabled;const hashes=c.song.parts.map(x=>x.sha256);
 if(window.dForceServer){c.serverPreparation=true;c.phonePreparation=true;}await c.arm();if(!c.armed)throw Error(document.getElementById('songBetaStatus').textContent);const rms=[];for(const x of c.song.parts){const b=await c.loadRender(x),a=b.getChannelData(0);rms.push(Math.sqrt(a.reduce((n,v)=>n+v*v,0)/a.length))}const renders=c.song.parts.map(x=>x.render.sha256);await c.arm();const warm=c.song.parts.map(x=>x.render.sha256);await c.playSong();const playing=c.playing;c.stop();await c.recall(c.song.parts[0],{start:false});saveState({force:true});await mygrainSongBetaAdapter.whenPersisted();return{legacyOff,restored,hashes,after:c.song.parts.map(x=>x.sha256),rms,renders,warm,playing,settings:mygrainD.settings()};
});assert(songs.legacyOff&&songs.restored&&songs.playing);assert(songs.rms.every(x=>x>1e-6));assert.deepEqual(songs.hashes,songs.after);assert.deepEqual(songs.renders,songs.warm);
await p.reload();await start();assert(await p.evaluate(()=>!!bastardLoopDBuffer&&mygrainD.settings().enabled));
for(const size of [{width:390,height:844},{width:844,height:390}]){await p.setViewportSize(size);await p.locator('#loopDCut').scrollIntoViewIfNeeded();await p.locator('#loopDCut').tap();assert(await p.locator('#bastardLoopDCutClose').isVisible());assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await p.locator('#bastardLoopDCutClose').tap();}
console.log('PAGE_ERRORS',engine,JSON.stringify(errors));await p.locator('#bastardLoopDCard').scrollIntoViewIfNeeded();await p.locator('#bastardLoopDCard').screenshot({path:'/tmp/mygrain-d-'+engine+'.png'});assert.deepEqual(errors,[]);console.log('PASS',engine,JSON.stringify({fit,batches,reel,songs}));await ctx.close();
}finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
