// Current hosted app, unchanged native FX: startup and uninterrupted editing.
module.exports=async function({p,diag,command,toolbar,assert,delay,rms,raw,out,fs,path,direct}){
 const report={};assert.equal((await diag()).clock.armed,true,'load arms the native FX without any Arm click');assert.match(await p.locator('#dawFxArm').textContent(),/FX armed/);assert.match(await toolbar(),/Armed - follow DAW/i);report.autoArmed=true;
 const slider=async(value)=>p.locator('#dawFxGain').evaluate((e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}));},value);
 await slider(-12);await delay(2500);const quiet=rms();assert(quiet<direct*.29&&quiet>direct*.21);
 const start=await diag(),from=start.clock.clock;await p.evaluate(()=>mygrainCardHistory.runDraftEdit('FX history continuity',()=>new Promise(r=>setTimeout(r,1200))));await delay(1600);const after=await diag();
 report.history={before:start.clock,after:after.clock};assert.equal(after.clock.epoch,start.clock.epoch,'ordinary history must not reset native PCM epoch');assert.equal(after.clock.missingBlocks,start.clock.missingBlocks,'history must not interrupt native return');assert(after.clock.browserReady&&after.clock.armed);
 // Test all real Pot switches without visiting/loading the standalone cards.
 await p.evaluate(()=>{mygrainDisplay.reveal(document.getElementById('cookingPotCard'));document.getElementById('cookingPotCard').scrollIntoView();});
 await p.evaluate(async()=>{for(const key of MygrainAcousticFx.KEYS)await mygrainAcousticFx.set(key,{...mygrainAcousticFx.settings(key),level:0});});
 const powers=await p.locator('[data-pot-effect-power]').evaluateAll(es=>es.map(e=>e.dataset.potEffectPower));report.power=[];
 for(const key of powers){const before=await p.locator(`[data-pot-effect-power="${key}"]`).getAttribute('aria-pressed');await p.locator(`[data-pot-effect-power="${key}"]`).click();await p.waitForFunction(()=>!mygrainCardHistory.busy);await p.waitForFunction(({key,before})=>document.querySelector(`[data-pot-effect-power="${key}"]`).getAttribute('aria-pressed')!==before,{key,before});await p.locator(`[data-pot-effect-power="${key}"]`).click();await p.waitForFunction(()=>!mygrainCardHistory.busy);await p.waitForFunction(({key,before})=>document.querySelector(`[data-pot-effect-power="${key}"]`).getAttribute('aria-pressed')===before,{key,before});report.power.push(key);}
 // Missing journal matches the already-supported standalone-card fallback.
 await p.evaluate(()=>{window.fxSavedHistory=mygrainCardHistory;delete window.mygrainCardHistory;});await p.locator('[data-pot-effect-power="wireWorld"]').click();await p.waitForFunction(()=>mygrainAcousticFx.settings('wireWorld').enabled);await p.locator('[data-pot-effect-power="wireWorld"]').click();await p.waitForFunction(()=>!mygrainAcousticFx.settings('wireWorld').enabled);await p.evaluate(()=>{window.mygrainCardHistory=fxSavedHistory;delete window.fxSavedHistory;});report.missingHistoryPower=true;
 await p.evaluate(()=>mygrainCookingPot.whenReady());await delay(2500);await slider(0);await delay(2500);
 // Explicit Stop is never defeated by a clock tick. Native and page stay synced.
 command('stop-plugin');await p.waitForFunction(()=>!mygrainDawFx.diagnostics().clock.armed);await delay(1000);assert.equal((await diag()).clock.armed,false);assert.match(await p.locator('#dawFxArm').textContent(),/Arm FX/);await p.locator('#dawFxArm').click();await p.waitForFunction(()=>mygrainDawFx.diagnostics().clock.running);report.stopStaysStopped=true;
 fs.writeFileSync(path.join(out,'fx-startup-continuity.json'),JSON.stringify(report,null,2));console.log('PASS auto-arm, native/page indicators, history continuity, every Cooking Pot power, missing history fallback and explicit Stop');return report;
};
