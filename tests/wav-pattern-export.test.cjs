const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('        async function renderPatternWithOptionalSnapshot()'),html.indexOf('        async function exportDawReadyBars()'));
function fixture(checked=true){
 const events=[],render={blob:new Blob(['wav']),filename:'render.wav'};
 const window={mygrainAccounts:{user:{username:'fixture'}},mygrainSongBetaAdapter:{ready:async()=>events.push('ready'),capture:async()=>{events.push('capture');return new Blob(['pattern'],{type:'application/zip'})},decode:async()=>{events.push('decode');return {}},recall:async()=>events.push('recall'),whenPersisted:async()=>events.push('persisted')},mygrainCardHistory:{busy:false,run:async(label,action)=>{events.push(label);return action()}}};
 const context=vm.createContext({window,Map,confirm:()=>{events.push('prompt');return checked},parseStoredZipEntries:()=>new Map(),document:{getElementById:()=>({checked})},setStatus:()=>{},renderDawReadyBarsExport:async()=>{events.push('render');return render}});
 vm.runInContext(source,context);return {context,window,events,render};
}
test('opt-out remains a plain WAV export without snapshot work',async()=>{const f=fixture(false);delete f.window.mygrainSongBetaAdapter;assert.equal(await f.context.renderPatternWithOptionalSnapshot(),f.render);assert.deepEqual(f.events,['prompt','render'])});
test('paired render captures editable sources before starting the audio render',async()=>{const f=fixture();const result=await f.context.renderPatternWithOptionalSnapshot();assert.equal(result.patternBlob.type,'application/zip');assert.equal(result.patternOwner,'fixture');assert.deepEqual(f.events,['prompt','ready','capture','render'])});
test('each render prompts independently of old saved preferences',async()=>{const f=fixture(true);await f.context.renderPatternWithOptionalSnapshot();f.context.confirm=()=>{f.events.push('prompt-no');return false};await f.context.renderPatternWithOptionalSnapshot();assert.deepEqual(f.events,['prompt','ready','capture','render','prompt-no','render'])});
test('snapshot failure cannot silently save an uneditable WAV',async()=>{const f=fixture();f.window.mygrainSongBetaAdapter.capture=async()=>{throw Error('capture failed')};await assert.rejects(f.context.renderPatternWithOptionalSnapshot(),/capture failed/);assert(!f.events.includes('render'))});
test('paired export cannot move to another account during rendering',async()=>{const f=fixture();f.context.renderDawReadyBarsExport=async()=>{f.window.mygrainAccounts.user.username='other';return f.render};await assert.rejects(f.context.renderPatternWithOptionalSnapshot(),/active account changed/)});
test('corrupt patterns are decoded before any history or audio mutation',async()=>{const f=fixture();f.window.mygrainSongBetaAdapter.decode=async()=>{throw Error('invalid archive')};await assert.rejects(f.context.importEditablePattern(new ArrayBuffer(0)),/invalid archive/);assert.deepEqual(f.events,['ready'])});
test('closing the WAV browser while decoding cancels before state replacement',async()=>{const f=fixture(),controller=new AbortController();f.window.mygrainSongBetaAdapter.decode=async()=>{controller.abort();return {}};await assert.rejects(f.context.importEditablePattern(new ArrayBuffer(0),'saved.wav',{signal:controller.signal}),{name:'AbortError'});assert.deepEqual(f.events,['ready'])});
test('account switch during decoding rejects replacement',async()=>{const f=fixture();f.window.mygrainSongBetaAdapter.decode=async()=>{f.window.mygrainAccounts.user.username='other';return {}};await assert.rejects(f.context.importEditablePattern(new ArrayBuffer(0)),/Account or editing state changed/);assert.deepEqual(f.events,['ready'])});
test('a second concurrent import is rejected and failure releases the import guard',async()=>{const f=fixture();let finish;f.window.mygrainSongBetaAdapter.decode=()=>new Promise(resolve=>finish=resolve);const first=f.context.importEditablePattern(new ArrayBuffer(0));await new Promise(resolve=>setImmediate(resolve));await assert.rejects(f.context.importEditablePattern(new ArrayBuffer(0)),/finish loading/);finish({});await first;assert.deepEqual(f.events,['ready','Import Pattern','recall','persisted']);f.window.mygrainSongBetaAdapter.decode=async()=>({});await f.context.importEditablePattern(new ArrayBuffer(0));assert.equal(f.events.filter(e=>e==='Import Pattern').length,2)});
test('local share preserves WAV and ZIP media types',async()=>{let shared;class File extends Blob{constructor(parts,name,options){super(parts,options);this.name=name}}const start=html.indexOf('        async function saveAudioFiles('),end=html.indexOf('        const BPM_FILENAME_FIRST_WORDS',start);const c=vm.createContext({File,navigator:{canShare:()=>true,share:async data=>shared=data}});vm.runInContext(html.slice(start,end),c);await c.saveAudioFiles([{filename:'part.wav',blob:new Blob(['wav'],{type:'audio/wav'})},{filename:'part.pattern.zip',blob:new Blob(['zip'],{type:'application/zip'})}]);assert.deepEqual(Array.from(shared.files,f=>[f.name,f.type]),[['part.wav','audio/wav'],['part.pattern.zip','application/zip']])});
test('account switch during paired ZIP assembly cannot upload another account’s pattern',async()=>{const start=html.indexOf('        async function uploadWavToRepository('),end=html.indexOf('\n        async function ',start+30);let fetched=false;const window={mygrainAccounts:{user:{username:'fixture'}}};const context=vm.createContext({window,WAV_REPOSITORY_BASE_URL:'http://localhost/mygrain-wavs',createStoredZip:async()=>{window.mygrainAccounts.user.username='other';return new Blob(['zip'])},fetch:async()=>{fetched=true}});vm.runInContext(html.slice(start,end),context);await assert.rejects(context.uploadWavToRepository(new Blob(['wav']),'song.wav',{patternBlob:new Blob(['pattern']),patternOwner:'fixture'}),/active account changed/);assert.equal(fetched,false)});

function fn(name,next){return html.slice(html.indexOf(`        async function ${name}`),html.indexOf(`        async function ${next}`,html.indexOf(`        async function ${name}`)+1))}
test('standalone ZIP always prompts, including an already filled name; cancel does not capture/upload',async()=>{
 let captured=0,prompted;
 const c=vm.createContext({performanceExportPatchZipBtn:{},performancePatchZipName:{value:'existing-name'},buildPatchDefaultBaseName:()=> 'default',prompt:(text,value)=>{prompted=value;return null},setStatus(){},sanitizePatchRepositoryFilename(){throw Error('should not sanitize')},buildPatchZipBlob:async()=>{captured++}});
 vm.runInContext(fn('exportPatchZipToRepository()','deleteWavFromRepository'),c);await c.exportPatchZipToRepository();assert.equal(prompted,'existing-name');assert.equal(captured,0);assert.equal(c.performanceExportPatchZipBtn.disabled,false);
});
test('standalone ZIP uses the complete live codec, not a stale preset/stored snapshot',async()=>{
 const events=[],blob=new Blob(['complete']);
 const c=vm.createContext({window:{mygrainAccounts:{user:{username:'fixture'}},mygrainSongBetaAdapter:{ready:async()=>events.push('ready'),capture:async()=>{events.push('capture');return blob}}}});
 vm.runInContext(fn('buildPatchZipBlob(filename)','uploadPatchZipToRepository'),c);assert.equal(await c.buildPatchZipBlob('named.zip'),blob);assert.deepEqual(events,['ready','capture']);
});
test('paired local WAV export saves one private browser copy and uses the server-resolved name for both downloads',async()=>{
 let downloads,uploaded=0;const pattern=new Blob(['patch']),render={filename:'same.wav',blob:new Blob(['wav']),patternBlob:pattern,patternOwner:'fixture',bpm:120,bars:1};
 const c=vm.createContext({performanceExportBtn:{},renderPatternWithOptionalSnapshot:async()=>render,uploadWavToRepository:async(blob,name,options)=>{uploaded++;assert.equal(name,'same.wav');assert.equal(options.patternBlob,pattern);return {savedName:'same-2.wav'}},document:{getElementById:()=>({hidden:true})},setStatus(){},saveAudioFiles:async files=>{downloads=files}});
 vm.runInContext(html.slice(html.indexOf('        async function exportDawReadyBars()'),html.indexOf('        // Song render decks use about:srcdoc')),c);
 await c.exportDawReadyBars();assert.equal(uploaded,1);assert.deepEqual(Array.from(downloads,f=>f.filename),['same-2.wav','same-2.zip']);
});
test('Song ZIP keeps placement order and repeats while downloading each distinct source once',async()=>{
 const f=fixture(),read=[],released=[],parts=[{id:'a',name:'Verse',bytes:10,repeats:1},{id:'b',name:'Chorus',bytes:10,repeats:2},{id:'again',sourcePartId:'a',name:'Verse again',bytes:10,repeats:3}];
 f.window.mygrainSongBeta={generation:1,readPart:async part=>{read.push(part.id);return {body:new ArrayBuffer(10),releaseDownload:()=>released.push(part.id)}}};
 let entries;f.context.createStoredZip=async list=>{entries=list;return new Blob(['songzip'])};
 await f.context.buildSongRenderPatchZip(parts,new AbortController().signal);
 assert.deepEqual(read,['a','b']);assert.deepEqual(released,read);
 const manifest=JSON.parse(entries[0].data);assert.deepEqual(manifest.arrangement.map(p=>p.patch),['a','b','a']);assert.deepEqual(manifest.arrangement.map(p=>p.repeats),[1,2,3]);assert.equal(manifest.patches.length,2);
});
test('Take capture retains the render-time snapshot and renamed uploads use that snapshot, never the current patch',async()=>{
 const patch=new Blob(['original patch']),wav=new Blob(['render']),uploads=[];
 const c=vm.createContext({performanceTakeSlots:[null],performanceTakeCaptureInFlight:false,performanceTakeUploadInFlight:false,renderPatternWithOptionalSnapshot:async()=>({blob:wav,patternBlob:patch,patternOwner:'fixture',filename:'original.wav',bpm:120,bars:1}),syncPerformanceTakeButtons(){},syncPerformanceControlState(){},renderPerformanceTakeBrowser(){},setStatus(){},sanitizeWavRepositoryFilename:name=>name+'.wav',uploadWavToRepository:async(blob,name,options)=>uploads.push({blob,name,options}),refreshWavRepositoryBrowser:async()=>{}});
 vm.runInContext(html.slice(html.indexOf('        async function capturePerformanceTake('),html.indexOf('        let midiRepositoryBrowserFiles')),c);
 await c.capturePerformanceTake(0);c.performanceTakeSlots[0].draftName='renamed';await c.uploadPerformanceTakesToRepository();assert.equal(uploads.length,1);assert.equal(uploads[0].name,'renamed.wav');assert.equal(uploads[0].blob,wav);assert.equal(uploads[0].options.patternBlob,patch);assert.equal(uploads[0].options.patternOwner,'fixture');
});
test('Song patch selection restores the chosen complete patch; cancel never changes the workspace',async()=>{
 const f=fixture(),bundle=new ArrayBuffer(1),part=new ArrayBuffer(2),manifest={format:'mygrain-render-patches',version:1,patches:[{name:'Verse',path:'patches/1.zip'},{name:'Chorus',path:'patches/2.zip'}]};
 f.context.parseStoredZipEntries=bytes=>bytes.byteLength===1 ? new Map([['render-patches.json',new Uint8Array()],['patches/2.zip',new Uint8Array(part)]]) : new Map([['song-part.json',new Uint8Array()]]);
 f.context.getZipText=()=>JSON.stringify(manifest);f.context.prompt=()=>null;
 assert.equal(await f.context.importEditablePattern(bundle,'song.wav'),false);assert.deepEqual(f.events,[]);
 f.context.prompt=()=> '2';await f.context.importEditablePattern(bundle,'song.wav');assert.deepEqual(f.events,['ready','decode','Import Pattern','recall','persisted']);
});
