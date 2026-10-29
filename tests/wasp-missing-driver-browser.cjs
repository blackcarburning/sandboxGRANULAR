'use strict';
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright-core');
(async()=>{for(const [engine,type] of Object.entries({chromium,webkit}))for(const phone of [false,true]){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}:{});
 try{const context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1440,height:1000},...(phone?{isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='https://openclaw.blackcarburning.com')return r.abort();if(u.pathname.endsWith('/account-context.js'))return r.fulfill({contentType:'text/javascript',body:'window.mygrainAccountContext={user:{username:"wasp-test"}};'});if(u.pathname.includes('/api/'))return r.fulfill({json:{ok:true,authenticated:true,user:{username:'wasp-test'},files:[],songs:[],folders:[],samples:[],patches:[]}});if(!['GET','HEAD'].includes(r.request().method()))return r.abort();return r.continue();});
 await page.goto('https://openclaw.blackcarburning.com/mygrain/?wasp-wet-test=1');await page.waitForFunction(()=>window.mygrainWasp&&document.documentElement.dataset.mygrainStartup==='ready');
 const result=await page.evaluate(async()=>{
  const checks=[];
  for(const driver of ['absent','disconnected','silent','tone'])for(const blend of [0,.5,1]){
   const sr=48000,ctx=new OfflineAudioContext(2,sr*.4,sr),s=MygrainWasp.normalize();s.enabled=true;s.melt=1;s.blend=blend;s.routes[0]={...s.routes[0],enabled:true,source:'V',destination:'A',method:'am',mode:'envelope',depth:1};
   await mygrainWasp.prepare(ctx,s);
   const node=new AudioWorkletNode(ctx,'mygrain-wasp-v1',{numberOfInputs:32,numberOfOutputs:32,outputChannelCount:Array(32).fill(2),channelCount:2,channelCountMode:'explicit',processorOptions:{settings:s,keys:['A',driver==='absent'?null:'V',...Array(30).fill(null)]}});
   const master=new AudioWorkletNode(ctx,'mygrain-wasp-master-v2',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{settings:s}});
   const carrier=ctx.createOscillator(),gain=ctx.createGain();gain.gain.value=.1;carrier.frequency.value=220;carrier.connect(gain);gain.connect(node,0,0);carrier.start();
   if(['silent','tone'].includes(driver)){const osc=ctx.createOscillator(),g=ctx.createGain();g.gain.value=driver==='tone'?.25:0;osc.connect(g);g.connect(node,0,1);osc.start();}
   node.connect(master,0);master.connect(ctx.destination);const buffer=await ctx.startRendering(),a=buffer.getChannelData(0).slice(sr*.2);let energy=0;for(const x of a){if(!Number.isFinite(x))throw Error('nonfinite');energy+=x*x;}
   checks.push({driver,blend,rms:Math.sqrt(energy/a.length)});node.disconnect();master.disconnect();node.port.close();master.port.close();
  }return{phone:window.mygrainPhone,checks};
 });assert.equal(!!result.phone,phone);for(const c of result.checks){if(c.driver==='silent'&&c.blend===1)assert(c.rms<1e-6,JSON.stringify(c));else assert(c.rms>.005,JSON.stringify(c));}assert.deepEqual(errors,[]);console.log('PASS',engine,phone?'phone':'desktop',JSON.stringify(result));await context.close();
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
