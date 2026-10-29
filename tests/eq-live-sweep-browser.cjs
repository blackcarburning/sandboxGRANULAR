'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core');
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox']}:{});
 try{const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',async r=>{const u=new URL(r.request().url());if(u.pathname==='/mygrain/')return r.fulfill({contentType:'text/html',body:'<button onclick="window.ctx=new AudioContext();ctx.resume()">Start</button><script src="channel-eq.js"></script>'});return r.fulfill({response:await r.fetch({url:'http://127.0.0.1:8765'+u.pathname+u.search})})});
 await p.goto('https://openclaw.blackcarburning.com/mygrain/');await p.locator('button').click();
 const results=await p.evaluate(async()=>{const results=[];for(const key of ['A','X','L']){
 const eq=MygrainChannelEq.create(),v=MygrainChannelEq.defaults(),source=ctx.createOscillator(),gain=ctx.createGain(),meter=ctx.createAnalyser(),mute=ctx.createGain();mute.gain.value=0;source.frequency.value=220;gain.gain.value=.03;source.connect(gain);meter.connect(mute);mute.connect(ctx.destination);
 v.enabled=true;v.bands[1].gain=12;eq.set(key,v);const route=eq.connect(key,gain,meter);await eq.prepareAutomation(key);await new Promise(r=>setTimeout(r,90));source.start();let jump=0,peak=0,transitions=0;
 for(let i=0;i<100;i++){v.bands[1].frequency=80*100**((1-Math.cos(i*Math.PI/25))/2);v.bands[1].gain=18*Math.sin(i/12);eq.set(key,v);transitions=Math.max(transitions,eq.diagnostics().transitions);await new Promise(r=>setTimeout(r,8));const data=new Float32Array(2048);meter.getFloatTimeDomainData(data);for(let j=1;j<data.length;j++)jump=Math.max(jump,Math.abs(data[j]-data[j-1]));for(const x of data){if(!Number.isFinite(x))throw Error('Nonfinite PCM');peak=Math.max(peak,Math.abs(x))}}
 const enabled=eq.diagnostics();v.enabled=false;eq.set(key,v);v.enabled=true;eq.set(key,v);transitions=Math.max(transitions,eq.diagnostics().transitions);source.stop();route.disconnect();results.push({key,jump,peak,transitions,enabled,remaining:eq.diagnostics().groups});
 }await ctx.close();return results;});
 for(const r of results){assert.equal(r.enabled.automated,1,JSON.stringify(r));assert.equal(r.transitions,0,JSON.stringify(r));assert.equal(r.remaining,0);assert(r.peak>.01&&r.peak<.4&&r.jump<.025,JSON.stringify(r));assert.deepEqual(r.enabled.automationErrors,[])}assert.deepEqual(errors,[]);console.log('PASS',engine,'manual EQ sweeps, bypass, stable routing, cleanup',JSON.stringify(results));
 }finally{await b.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
