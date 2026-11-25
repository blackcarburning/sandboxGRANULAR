'use strict';
// Synthetic port inventories; not a claim of physical MIDI/CEF/DAW coverage.
const {chromium, webkit} = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const source = path.resolve(process.env.MYGRAIN_MIDI_SOURCE || path.join(__dirname, '../index.html'));
const evidence = process.env.MYGRAIN_MIDI_EVIDENCE;
(async () => {
 for (const [name, engine] of Object.entries({chromium, webkit})) {
  const browser = await engine.launch(name === 'chromium' ? {executablePath:'/snap/bin/chromium', args:['--no-sandbox','--disable-dev-shm-usage']} : {});
  try {
   const context = await browser.newContext({viewport:{width:1440,height:900}});
   const page = await context.newPage(), errors = [], reports = [];
   page.on('pageerror', error => {errors.push(error.message);console.error(error.stack);});
   await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== 'https://openclaw.blackcarburning.com') return route.abort();
    if (url.pathname === '/mygrain/api/debug-logs' && req.method() === 'POST') {
     reports.push(req.postDataJSON());
     return route.fulfill({status:201,json:{ok:true,logId:'audio-20261125T150000Z-0123456789abcdef',receivedAt:new Date().toISOString()}});
    }
    if (!['GET','HEAD'].includes(req.method())) return route.abort();
    if (['/mygrain/','/mygrain/index.html'].includes(url.pathname)) return route.fulfill({contentType:'text/html',body:fs.readFileSync(source)});
    if (url.pathname.endsWith('/account-context.js')) return route.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"midi-parity-readonly"}};'});
    if (url.pathname.includes('/api/')) return route.fulfill({json:{ok:true,authenticated:true,user:{username:'midi-parity-readonly'},files:[],songs:[],folders:[],stations:[],samples:[],favourites:[],patches:[],jobs:[],items:[],parts:[],presets:[]}});
    return route.continue();
   });
   await context.addInitScript(() => {
    window.midiTestRequests = 0;
    window.midiTestOpens = 0;
    const port = (id, name, state = 'connected') => ({id,name,manufacturer:'USB fixture',type:'input',state,connection:'closed',onmidimessage:null,open(){midiTestOpens++;return Promise.resolve(this);}});
    window.midiTestAccess = {inputs:new Map([
     ['private-id-a',port('private-id-a','USB keys A')],
     ['private-id-b',port('private-id-b','USB keys B')],
     ['private-id-c',port('private-id-c','Unavailable keys','disconnected')]
    ]),outputs:new Map(),onstatechange:null};
    Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async()=>{midiTestRequests++;return midiTestAccess;}});
   });
   await page.goto('https://openclaw.blackcarburning.com/mygrain/');
   await page.waitForFunction(() => window.mygrainMidiKeyboardInput?.diagnostics && document.documentElement.dataset.mygrainStartup === 'ready');
   const original = await page.evaluate(() => ({snapshot:mygrainMidiKeyboardInput.diagnostics(),requests:midiTestRequests,opens:midiTestOpens,labels:[...document.querySelector('#performanceMidiInputSelect').options].map(x=>x.textContent)}));
   assert.equal(original.snapshot.inputCount,3);
   assert.equal(original.snapshot.connectedInputCount,2);
   assert.equal(original.snapshot.requestState,'resolved');
   assert.equal(original.snapshot.messagesReceived,0);
   assert(original.labels.some(x=>x.includes('USB keys A')));
   assert(!original.labels.some(x=>x.includes('Unavailable keys')),'diagnostics must not change the connected-input filter');
   for(let i=0;i<5;i++) await page.evaluate(() => mygrainMidiKeyboardInput.diagnostics());
   assert.deepEqual(await page.evaluate(() => [midiTestRequests,midiTestOpens]),[original.requests,original.opens],'passive capture cannot request permission/open ports');
   await page.locator('#start-btn').click();
   await page.waitForFunction(() => isAudioGraphReady() && !stateSaveSuspended);
   await page.evaluate(() => openBastardLoopLOverlay());
   await page.locator('#bastardLoopLMidiInput').selectOption('private-id-a');
   await page.evaluate(() => {const input=midiTestAccess.inputs.get('private-id-a');input.onmidimessage({data:[0xB0,21,127]});input.onmidimessage({data:[0xB0,21,0]});});
   const selected = await page.evaluate(() => mygrainMidiKeyboardInput.diagnostics());
   assert.equal(selected.messagesReceived,2);
   assert(selected.lastMessageAtMs);
   assert.equal(selected.inputs.find(x=>x.selected).name,'USB keys A');
   assert(!JSON.stringify(selected).includes('private-id-'));
   assert(!('data' in selected));
   await page.evaluate(() => {const port=midiTestAccess.inputs.get('private-id-c');port.state='connected';midiTestAccess.onstatechange({port});});
   const hotplug = await page.evaluate(() => mygrainMidiKeyboardInput.diagnostics());
   assert.equal(hotplug.connectedInputCount,3);
   assert.equal(hotplug.stateChanges,1);
   assert(hotplug.lastStateChange);
   assert((await page.locator('#performanceMidiInputSelect').textContent()).includes('Unavailable keys'));
   await page.evaluate(() => closeBastardLoopLOverlay());
   await page.locator('#audioClockWidgetBtn').click();
   await page.locator('#audioClockWidget .clock-submit').click();
   await page.waitForFunction(() => document.querySelector('#debugLogSubmitStatus').textContent.includes('saved on server'));
   assert.equal(reports.length,1);
   assert.deepEqual(reports[0].currentState.midi,hotplug);
   assert.equal(reports[0].application,'MYGRAIN');
   if(evidence){fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,name+'-submitted-report.json'),JSON.stringify(reports[0]));}
   await page.evaluate(async () => {Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async()=>{throw new DOMException('private-error-detail','NotAllowedError');}});await mygrainMidiKeyboardInput.refresh();});
   const rejected = await page.evaluate(() => mygrainMidiKeyboardInput.diagnostics());
   assert.equal(rejected.requestState,'rejected');
   assert.equal(rejected.requestError,'NotAllowedError');
   assert(!JSON.stringify(rejected).includes('private-error-detail'));
   await page.evaluate(async () => {Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:undefined});await mygrainMidiKeyboardInput.refresh();});
   const unsupported = await page.evaluate(() => mygrainMidiKeyboardInput.diagnostics());
   assert.equal(unsupported.apiAvailable,false);
   assert.equal(unsupported.requestState,'unsupported');
   assert.deepEqual(errors,[]);
   console.log('PASS',name,'passive complete inventory, unchanged selector, selected-input counts without payloads/IDs, hotplug, actual Submit Current Log payload, rejected/unsupported access');
   await context.close();
  } finally {await browser.close();}
 }
})().catch(error => {console.error(error);process.exitCode=1;});
