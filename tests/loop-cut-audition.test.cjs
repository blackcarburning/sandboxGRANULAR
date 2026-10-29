'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
for(const layer of ['V','W'])for(const mode of ['metronome','loops'])test(`${layer} ${mode}: prepare, replan from beat one, preserve preview, and clean up failure`,async()=>{
 const name=`auditionBastardLoop${layer}Cut`,source=html.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n        \\}`))[0],events=[];
 const c={audioContext:{currentTime:20,state:'running'},window:{setTimeout(){return 1}},ensureAudioReadyForKeyInteraction:async()=>true,prepareQForUiTransport:async()=>{events.push('Q prepared');return true},stopAllPerformancePlayback(){events.push('stopped')},stopHeldKeyboardPlaybackPreserveSelection(){},stopAllBastardLoopLayers(){},startAllBastardLoopLayers(t){assert(events.includes('Q prepared'));events.push(`loops ${t}`)},syncPerformanceControlState(){},playKeyboardRepositoryMetronomeClick(){},getKeyboardRepositoryMetronomeIntervalSeconds:()=>.5,bastardLoopPlaying:false};
 c[`bastardLoop${layer}Buffer`]={};c[`bastardLoop${layer}CutPreviewGeneration`]=0;c[`bastardLoop${layer}CutMetronomeNodes`]=new Set();
 c.withBufferedTransportStart=(reference,operation,options)=>{assert.equal(reference,null);assert.equal(options.reset,true);assert.equal(options.exactStart,true);operation(21);operation(22)};
 c[`startBastardLoop${layer}`]=(t,options)=>{const p=c[`bastardLoop${layer}CutPreview`];assert.equal(p.origin,t);assert(options.audition&&options.preserveCutPreview);events.push(`source ${t}`);return true};
 c[`stopBastardLoop${layer}CutAudition`]=()=>{c[`bastardLoop${layer}CutPreview`]=null;events.push('cleanup')};vm.createContext(c);vm.runInContext(source,c);await c[name](mode);
 assert.equal(c[`bastardLoop${layer}CutPreview`].origin,22);assert.equal(c[`bastardLoop${layer}CutPreview`].nextBeat,22);assert.equal(c.bastardLoopPlaying,mode==='loops');
 if(mode==='loops')assert(events.indexOf('Q prepared')<events.indexOf('stopped'));
 c.withBufferedTransportStart=()=>{throw Error('failed preparation')};await assert.rejects(c[name](mode),/failed preparation/);assert.equal(c[`bastardLoop${layer}CutPreview`],null);assert.equal(events.at(-1),'cleanup');
});
