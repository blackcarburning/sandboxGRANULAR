const test = require('node:test');
const assert = require('node:assert/strict');
const cut = require('../vocal-loop-cut.js');

test('V random cuts stay non-empty and grid-aligned; both switches vary without changing other options', () => {
 let seed=47;const random=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/2**32;
 const variants=new Set(),positions=new Set();
 for(const snap of [false,true])for(const grid of [1/32,1/16,1/4,1])for(const bars of [1,4,16]){
  const current=cut.normalize({enabled:false,repeat:true,snap,grid});const original=JSON.stringify(current);
  for(let i=0;i<64;i++){
   const next=cut.randomize(current,{cycle:bars*2,bar:2},random);const region=cut.region(next);
   assert.equal(next.enabled,true);assert.equal(next.repeat,true);assert.equal(next.snap,snap);assert.equal(next.grid,grid);
   assert.ok(next.start>=0&&next.end>next.start&&next.end<=1);assert.ok(region.start>=0&&region.duration>0&&region.end<=1+1e-9);
   assert.deepEqual(cut.normalize(JSON.parse(JSON.stringify(next))),next);
   if(snap){const step=grid/bars;for(const v of [next.start,next.end,region.start,region.end])assert.ok(Math.abs(v/step-Math.round(v/step))<1e-8);}
   if(next.stretch){assert.ok(region.duration/(next.end-next.start)>=.5-1e-9&&region.duration/(next.end-next.start)<=2+1e-9);if(next.fromStart)assert.equal(region.start,0);}
   variants.add(`${next.stretch}:${next.fromStart}`);positions.add(`${next.start}:${next.end}`);
  }
  assert.equal(JSON.stringify(current),original);
 }
 assert.equal(variants.size,4);assert.ok(positions.size>100);
});

test('random cut gate keeps full loop length and original PCM untouched across stretched/un-stretched variants', () => {
 let seed=9;const random=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/2**32;
 const context={createBuffer:(channels,length,sampleRate)=>{const data=Array.from({length:channels},()=>new Float32Array(length));return {numberOfChannels:channels,length,sampleRate,duration:length/sampleRate,getChannelData:i=>data[i]};}};
 const source=context.createBuffer(2,4800,8000);for(let c=0;c<2;c++)for(let i=0;i<source.length;i++)source.getChannelData(c)[i]=.2*Math.sin(2*Math.PI*(c?330:220)*i/source.sampleRate);
 const originals=[...Array(2)].map((_,i)=>source.getChannelData(i).slice());
 for(let i=0;i<32;i++){
  const next=cut.randomize({repeat:false},{cycle:.6,bar:.6},random);const result=cut.gate(context,source,next);
  assert.equal(result.length,source.length);assert.equal(result.sampleRate,source.sampleRate);assert.equal(result.numberOfChannels,2);
  assert.ok(result.getChannelData(0).some(v=>Math.abs(v)>.01));
  for(let c=0;c<2;c++){assert.ok(result.getChannelData(c).every(Number.isFinite));assert.deepEqual(source.getChannelData(c),originals[c]);}
 }
});

test('Mega and Sparse choose the V cut only after replacement audio settles, then save and restart it', async () => {
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const start=html.indexOf('        async function runMegaRandomization(');
 const source=html.slice(start,html.indexOf('\n        }',start)+10);
 for(const sparseMode of [false,true]){
  const events=[],noop=()=>{},newBuffer={},context={console,megaRandomizeInFlight:false,audioContext:{},bastardLoopVBuffer:{},bastardLoopVCut:cut.normalize(),
   muteRandomizeManualLoopLayers:noop,syncPerformanceControlState:noop,stopAllPerformancePlayback:noop,setMegaRandomAudioSuppressed:noop,setStatus:noop,
   createMegaRandomCommentary:()=>({message:noop,addTasks:noop,task:noop,stop:noop}),
   runPatchRandomization:async()=>({generationProfile:{},randomizeState:{bpm:120}}),waitForMegaRandomLoadsToSettle:async()=>{events.push('settled');},
   randomizeMegaBastardLoopSettings:noop,randomizeMegaBastardLoopLeadAndBassSettings:noop,randomizeMegaDropboxSampleLayerSettings:noop,randomizeMegaDrumMachineSettings:noop,
   buildMegaRandomBastardLoopTaskSpecs:()=>[{label:'V'}],requestMegaRandomBastardLoopBuild:async()=>newBuffer,
   applyMegaRandomBastardLoopBuild:async buffer=>{context.bastardLoopVBuffer=buffer;context.bastardLoopVCut=cut.normalize();events.push('replaced');},
   loadBastardLoopLSampleFromSource:noop,loadBastardLoopXSampleFromSource:noop,loadDropboxSampleLayerFromSource:noop,loadRandomDrumMachineSamples:noop,
   randomizeBastardLoopVCut:options=>{assert.equal(context.bastardLoopVBuffer,newBuffer);assert.equal(events.at(-1),'settled');assert.equal(options.skipRestart,true);context.bastardLoopVCut=cut.randomize({}, {cycle:2,bar:2},()=>0);events.push('cut');},
   applySparseRandomLayerSelection:()=>[],describeSparseRandomLayerSelection:()=>'',
   saveState:()=>{assert.equal(context.bastardLoopVCut.stretch,true);events.push('saved');},applyFinalBusDefaults:noop,hideSettlePopup:noop,restartAllTransport:()=>events.push('restarted')};
  vm.runInNewContext(source,context);await context.runMegaRandomization({sparseMode});
  assert.deepEqual(events,['settled','replaced','settled','cut','saved','restarted']);assert.equal(context.megaRandomizeInFlight,false);
 }
});
