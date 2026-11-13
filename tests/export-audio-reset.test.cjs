'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(process.env.MYGRAIN_RESET_SOURCE||path.join(__dirname,'../index.html'),'utf8');
function fn(name){const start=html.search(new RegExp('        (?:async )?function '+name+'\\('));assert(start>=0,name);return html.slice(start,html.indexOf('\n        }',start)+10);}
function fixture(kind,mode='success'){
 const events=[],button={disabled:false,textContent:''},status={textContent:''},rendered={filename:'test.wav',blob:{},bars:1,bpm:120},window={mygrainAccounts:{user:{username:'admin'}},addEventListener(){},removeEventListener(){}},audioContext={state:'running',resume:async()=>{events.push('resume');if(mode==='resume-failure')throw Error('resume denied');audioContext.state='running';}},context=vm.createContext({AbortController,setTimeout,clearTimeout,console:{warn(){},error(){}},window,audioContext,backgroundAudioController:null,statusDiv:status,performanceRepoExportBtn:button,loopStoreRenderController:null,repositoryRenderInFlight:false,wavRepositoryBrowserStore:'loopstore',LOOP_STORE_BASE_URL:'/loopstore',
 document:{hidden:false,getElementById:id=>id==='wavRepositoryBrowserOverlay'?{hidden:false}:button},setStatus:s=>{status.textContent=s;},setAudioStatus(){},
 choosePerformanceExportSteps:async()=>mode==='preflight-cancel'?null:16,
 renderPatternWithOptionalSnapshot:async options=>{if(mode==='preflight-cancel')return null;if(mode==='snapshot-failure')throw Error('snapshot failed');options.onRenderStart();events.push('render');if(mode==='capture-failure')throw Error('capture failed');return rendered;},
 renderDawReadyBarsExport:async()=>{events.push('render');if(mode==='capture-failure')throw Error('capture failed');return rendered;},
 chooseExportSaveOptions:async()=>['filename-cancel','preflight-cancel'].includes(mode)?null:{name:'test',includeSnapshot:false},
 createBpmWavFilename:()=> 'test.wav',getSharedBpmClockValue:()=>120,
 showExportActivity:()=>({update(){},finish(){}}),sanitizeWavRepositoryFilename:x=>x,
 uploadWavToRepository:async()=>{events.push('upload');if(mode==='upload-failure')throw Error('upload failed');return{savedName:'test.wav',loopStore:{frames:96000}};},
 refreshWavRepositoryBrowser:async()=>{events.push('refresh');},
 resetEngineRoutine:async()=>{events.push('FORBIDDEN RESET');throw Error('Export must not rebuild the editor.');}
 });
 if(mode==='resume-failure')audioContext.state='suspended';
 vm.runInContext(fn('restoreAudioAfterRepositoryRender')+'\n'+fn(kind==='loop'?'addCurrentLoopToStore':'exportGeneratedLoopToRepository'),context);
 return{events,button,status,audioContext,run:()=>context[kind==='loop'?'addCurrentLoopToStore':'exportGeneratedLoopToRepository'](),context};
}
for(const kind of ['loop','wav']){
 test(kind+': healthy audio is left untouched after upload/refresh and controls unlock',async()=>{const f=fixture(kind);await f.run();assert.deepEqual(f.events,['render','upload','refresh']);assert(!f.button.disabled);assert.match(f.status.textContent,/test.wav/);assert.equal(f.audioContext.state,'running');});
 test(kind+': cancelling before render leaves audio untouched',async()=>{const f=fixture(kind,'preflight-cancel');await f.run();assert.deepEqual(f.events,[]);assert(!f.button.disabled);});
 test(kind+': cancelling app name choice never renders or uploads',async()=>{const f=fixture(kind,'filename-cancel');await f.run();assert.deepEqual(f.events,[]);assert(!f.button.disabled);assert.match(f.status.textContent,/cancelled/i);});
 for(const mode of ['capture-failure','upload-failure'])test(kind+': '+mode+' preserves original error and unlocks without reset',async()=>{const f=fixture(kind,mode);await assert.rejects(f.run(),new RegExp(mode.split('-')[0]+' failed'));assert(!f.events.includes('FORBIDDEN RESET'));assert(!f.button.disabled);});
 test(kind+': denied resume preserves saved-file success with a user-gesture hint',async()=>{const f=fixture(kind,'resume-failure');await f.run();assert.deepEqual(f.events,['render','upload','refresh','resume']);assert(!f.button.disabled);assert.match(f.status.textContent,/test.wav.*tap Play to resume/);});
 test(kind+': never-settling native resume cannot leave exports locked',async()=>{const f=fixture(kind);let deadline,cleared=false;f.audioContext.state='suspended';f.audioContext.resume=()=>{f.events.push('resume');return new Promise(()=>{});};f.context.setTimeout=(fn,ms)=>{assert.equal(ms,1200);deadline=fn;return 23;};f.context.clearTimeout=id=>{assert.equal(id,23);cleared=true;};const done=f.run();while(!deadline)await new Promise(resolve=>setImmediate(resolve));assert(f.button.disabled);assert.equal(f.button.textContent,'Resuming audio…');deadline();await done;assert(!f.button.disabled);assert(cleared);assert.match(f.status.textContent,/test.wav.*tap Play/);assert(!f.events.includes('FORBIDDEN RESET'));});
 test(kind+': interrupted context is resumed in place',async()=>{const f=fixture(kind);f.audioContext.state='interrupted';await f.run();assert.equal(f.context.audioContext,f.audioContext);assert.equal(f.audioContext.state,'running');assert.deepEqual(f.events,['render','upload','refresh','resume']);assert(!f.button.disabled);});
 for(const state of ['hidden','idle'])test(kind+': '+state+' audio is not forcibly resumed',async()=>{const f=fixture(kind);f.audioContext.state='suspended';if(state==='hidden')f.context.document.hidden=true;else f.context.backgroundAudioController={idleSuspended:true};await f.run();assert.deepEqual(f.events,['render','upload','refresh']);assert(!f.button.disabled);assert.equal(f.audioContext.state,'suspended');});
 test(kind+': closed audio does not trigger a fallback rebuild',async()=>{const f=fixture(kind);f.audioContext.state='closed';await f.run();assert.deepEqual(f.events,['render','upload','refresh']);assert(!f.button.disabled);assert.match(f.status.textContent,/test.wav.*reload MYGRAIN/);});
 test(kind+': late resume never overwrites a newer context/status',async()=>{const f=fixture(kind);let resume;f.audioContext.state='suspended';f.audioContext.resume=()=>new Promise(resolve=>{resume=resolve;});const done=f.run();while(!resume)await new Promise(resolve=>setImmediate(resolve));const replacement={state:'running'};f.context.audioContext=replacement;f.status.textContent='New account opened';resume();await done;assert.equal(f.context.audioContext,replacement);assert.equal(f.status.textContent,'New account opened');assert(!f.button.disabled);});
}
test('snapshot preparation failure never touches audio',async()=>{const f=fixture('wav','snapshot-failure');await assert.rejects(f.run(),/snapshot failed/);assert.deepEqual(f.events,[]);assert(!f.button.disabled);});
test('optional snapshot notifies exactly at rendering start, both WAV-only and paired paths',async()=>{
 for(const paired of [false,true]){
  const events=[],context=vm.createContext({window:{mygrainAccounts:{user:{username:'admin'}},mygrainSongBetaAdapter:{ready:async()=>events.push('ready'),capture:async()=>{events.push('snapshot');return{size:5};}}},choosePerformanceExportSteps:async()=>16,chooseExportSaveOptions:async()=>({includeSnapshot:paired}),setStatus(){},renderDawReadyBarsExport:async()=>{events.push('render');return{};}});
  vm.runInContext(fn('renderPatternWithOptionalSnapshot'),context);await context.renderPatternWithOptionalSnapshot({onRenderStart:()=>events.push('start')});assert.deepEqual(events,paired?['ready','snapshot','start','render']:['start','render']);
 }
});
test('resume is destination-owned; shared/native/Song capture and manual reset stay independent',()=>{
 for(const name of ['renderDawReadyBarsExport','renderLiveOutputBarsBuffer','capturePerformanceTake','uploadWavFilesToRepository'])assert.doesNotMatch(fn(name),/restoreAudioAfterRepositoryRender/);
 assert.doesNotMatch(fn('restoreAudioAfterRepositoryRender'),/resetEngineRoutine|rebuildAudioEngineGraph|\.close\(/);
 assert.match(fn('resetEngineRoutine'),/rebuildAudioEngineGraph/);
});
