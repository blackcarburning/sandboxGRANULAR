const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const code=html.slice(html.indexOf('        let randomisationConfirmation = null;'),html.indexOf("        performanceSparseRandomBtn?.addEventListener"));
(async()=>{for(const[name,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(name==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});try{
 const p=await b.newPage({viewport:{width:390,height:844}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.setContent('<button id="sparse">Sparse</button><button id="mega">Mega</button>');
 await p.evaluate(code=>{window.calls=[];window.statuses=[];window.confirm=()=>{throw Error('Native confirmation used')};window.runMegaRandomization=async options=>calls.push(options?.sparseMode?'Sparse':'Mega');window.setStatus=s=>statuses.push(s);(0,eval)(code+'\nwindow.startSparse=handleSidebarSparseRandom;window.startMega=handleSidebarMegaRandom;');document.getElementById('sparse').onclick=()=>window.startSparse();document.getElementById('mega').onclick=()=>window.startMega();},code);
 for(const mode of ['Sparse','Mega']){
 await p.locator('#'+mode.toLowerCase()).click();assert(await p.getByRole('dialog').isVisible());assert.equal(await p.evaluate(()=>calls.length),mode==='Sparse'?0:1);
 assert.equal(await p.evaluate(()=>document.activeElement.textContent),'Cancel');await p.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await p.getByRole('dialog').count(),0);
 await p.locator('#'+mode.toLowerCase()).click();await p.keyboard.press('Escape');assert.equal(await p.getByRole('dialog').count(),0);
 await p.locator('#'+mode.toLowerCase()).click();await p.evaluate(()=>startMega());assert.equal(await p.getByRole('dialog').count(),1);await p.getByRole('button',{name:mode+' Randomise',exact:true}).click();
 }
 assert.deepEqual(await p.evaluate(()=>calls),['Sparse','Mega']);await p.locator('#sparse').click();await p.evaluate(()=>dispatchEvent(new Event('mygrain-account-lock')));assert.equal(await p.getByRole('dialog').count(),0);assert.deepEqual(await p.evaluate(()=>calls),['Sparse','Mega']);assert.deepEqual(errors,[]);console.log('PASS',name,'accept/cancel/Escape, duplicate prevention, account lock, suppressed native dialogs');
 }finally{await b.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
