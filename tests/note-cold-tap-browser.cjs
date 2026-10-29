'use strict';
const assert=require('node:assert/strict');
const {webkit,chromium}=require('playwright-core');
(async()=>{for(const [engine,type] of Object.entries({webkit,chromium})){const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});try{const c=await b.newContext({viewport:{width:process.env.MYGRAIN_NOTE_DESKTOP?1440:390,height:process.env.MYGRAIN_NOTE_DESKTOP?1000:844},hasTouch:!process.env.MYGRAIN_NOTE_DESKTOP,isMobile:!process.env.MYGRAIN_NOTE_DESKTOP,...(process.env.MYGRAIN_NOTE_DESKTOP?{}:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'})});const p=await c.newPage();p.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text())});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='https://openclaw.blackcarburning.com')return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"wasp-fixture"}};'});if(u.pathname.includes('/api/'))return r.fulfill({json:{ok:true,authenticated:true,user:{username:'wasp-fixture'},files:[],songs:[],folders:[],samples:[],patches:[]}});if(!['GET','HEAD'].includes(r.request().method()))return r.abort();return r.continue()});await p.goto('https://openclaw.blackcarburning.com/mygrain/');await p.waitForFunction(()=>document.documentElement.dataset.mygrainStartup==='ready');await p.locator('#start-btn').click();await p.waitForFunction(()=>isAudioGraphReady()&&!engineStarting);


await p.waitForFunction(()=>getComputedStyle(document.getElementById('start-overlay')).display==='none');
await p.waitForFunction(()=>!stateSaveSuspended&&!mygrainCardHistory.busy);await p.waitForTimeout(1000);

await p.route('**/*.wav',async r=>{await new Promise(resolve=>setTimeout(resolve,350));await r.fulfill({contentType:'audio/wav',body:require('node:fs').readFileSync(require('node:path').join(__dirname,'..',decodeURIComponent(new URL(r.request().url()).pathname.split('/mygrain/')[1])))})});
for(const width of (process.env.MYGRAIN_NOTE_WIDTHS||'1440,390').split(',').map(Number))for(const instrument of ['piano','strings']){
 await p.setViewportSize({width,height:width===1440?1000:844});
 const result=await p.evaluate(async ({instrument,width})=>{
  stopAllPerformancePlayback({silent:true});clearAllPerformanceSoloStates({silent:true,skipSave:true});setFinalReverbEnabled(false,{silent:true,skipSave:true});setGlobalMixDelayEnabled(false,{silent:true,skipSave:true});
  setKeyboardSoundSource(instrument,{skipSave:true});arpEnabled=false;holdEnabled=false;
  const player=getKeyboardSamplePlayer();player.stop();for(const entry of player.samplers.values()){entry.piano.cache.clear();entry.piano.atlas=null;}
  keyboardSoundPreparation=null;keyboardSoundReadiness='idle';
  const analyser=audioContext.createAnalyser();analyser.fftSize=2048;splitterNode.connect(analyser,0);const a=new Float32Array(2048);
  const key=document.querySelector('#keyboardContainer .key[data-note="C4"]');
  key.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,button:0,pointerType:width===390?'touch':'mouse'}));await new Promise(r=>setTimeout(r,40));key.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,button:0,pointerType:width===390?'touch':'mouse'}));if(width===390)key.dispatchEvent(new PointerEvent('pointerleave',{bubbles:false,pointerId:1,pointerType:'touch'}));
  let peak=0;for(let j=0;j<100;j++){await new Promise(r=>setTimeout(r,25));analyser.getFloatTimeDomainData(a);for(const v of a)peak=Math.max(peak,Math.abs(v));}
  analyser.disconnect();player.stop();return{peak,activeKeys:activeKeyCount,voices:player.activeVoices.size};
 },{instrument,width});
 assert(result.peak>.0001,JSON.stringify(result));assert.equal(result.activeKeys,0);assert.equal(result.voices,0);
 console.log('PASS',engine,width,instrument,'cold 40ms tap audible; released cleanly',result);
}
assert.deepEqual(errors,[]);await c.close();}finally{await b.close()}}})().catch(e=>{console.error(e);process.exitCode=1});
