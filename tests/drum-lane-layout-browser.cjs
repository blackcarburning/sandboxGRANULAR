// Isolated localhost accounts only. Real runtime and trusted mouse/touch controls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, webkit} = require('playwright-core');
const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:19041/mygrain/';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/);
const evidence = process.env.DRUM_LAYOUT_EVIDENCE || '/tmp/mygrain-drum-lane-layout';
fs.mkdirSync(evidence, {recursive:true});
const kinds = ['kick','snare','hat','perc','clap','cymbals','etc','roll'];
async function geometry(page) {
    return page.evaluate(() => {
        const rect = e => {const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height};};
        const errors=[];
        const check=(test,message)=>{if(!test)errors.push(message);};
        const lanes=[...document.querySelectorAll('#drumMachineOverlay .drum-machine-track-card')].map(card=>{
            const parts=[card.querySelector('.drum-machine-track-copy'),card.querySelector('.drum-machine-track-head > .drum-machine-track-actions'),card.querySelector('.drum-machine-controls-grid, .drum-roll-controls'),card.querySelector(':scope > .channel-eq-entry'),card.querySelector('[id^="drumNormalize-"]')?.closest('.drum-machine-track-actions'),card.querySelector('[id^="drumNormalizeStatus-"]'),card.querySelector('.drum-machine-accent-copy-row'),card.querySelector('.drum-machine-track-meta'),card.querySelector('[data-drum-copy-prompt]'),card.querySelector('.drum-machine-step-grid')].filter(e=>e&&e.getBoundingClientRect().height);
            const r=rect(card); let end=-Infinity;
            for(const e of parts){const p=rect(e);check(p.y>=end-1,`${card.id}: ${e.className||e.id} out of order/overlap (${p.y}<${end})`);end=p.bottom;check(p.x>=r.x&&p.right<=r.right+1,`${card.id}: ${e.className} outside lane`);check(e.scrollWidth<=e.clientWidth+1,`${card.id}: ${e.className} horizontal overflow ${e.scrollWidth}/${e.clientWidth}`);}
            const title=card.querySelector('.drum-machine-track-copy'),head=card.querySelector('.drum-machine-track-head');
            check(rect(title).w>=rect(head).w-1,`${card.id}: collapsed title column`);
            const buttons=[...card.querySelectorAll('button,input,select')].filter(e=>e.getBoundingClientRect().height);
            for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++){
                const a=rect(buttons[i]),b=rect(buttons[j]);
                check(!(Math.min(a.right,b.right)-Math.max(a.x,b.x)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1),`${card.id}: controls overlap ${buttons[i].id||buttons[i].outerHTML.slice(0,70)} / ${buttons[j].id||buttons[j].outerHTML.slice(0,70)}`);
            }
            return {id:card.id,title:rect(title),parts:parts.map(e=>({id:e.id,cls:e.className,...rect(e)})),controls:buttons.length};
        });
        const layout=document.querySelector('#drumMachineOverlay .drum-machine-layout');
        check(document.documentElement.scrollWidth<=innerWidth+1,'document horizontal overflow');
        check(layout.scrollWidth<=layout.clientWidth+1,'lane scroller horizontal overflow');
        check(layout.clientHeight>90,'lane scroller not usable');
        return {errors,lanes,scrollOwner:{height:layout.clientHeight,scrollHeight:layout.scrollHeight,overflow:getComputedStyle(layout).overflowY}};
    });
}
(async()=>{
    const results=[];
    for(const engine of (process.env.DRUM_LAYOUT_ENGINE?[process.env.DRUM_LAYOUT_ENGINE]:['chromium','webkit'])){
        const browser=await ({chromium,webkit}[engine]).launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
        try{for(const mobile of [false,true]){
            const context=await browser.newContext({viewport:{width:mobile?390:1280,height:mobile?844:900},isMobile:mobile,hasTouch:mobile});
            assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-vst3-test'}})).status(),200);
            const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
            await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
            const press=async locator=>mobile?locator.tap():locator.click();
            const boot=async()=>{await page.waitForFunction(()=>window.mygrainCardHistory&&document.documentElement.dataset.mygrainStartup==='ready');await page.evaluate(()=>mygrainCardHistory.ready);await press(page.locator('#start-btn'));await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);};
            await page.goto(base);await boot();await page.evaluate(()=>{stopAllPerformancePlayback({silent:true});openDrumMachineOverlay();});
            const before=await page.evaluate(()=>Object.fromEntries(Object.entries(gatherPreset()).filter(([key])=>/drum/i.test(key)||key==='channelEq')));
            const viewports=mobile?[{width:320,height:640},{width:390,height:844},{width:430,height:932},{width:844,height:390},{width:390,height:844}]:[{width:1920,height:1080},{width:1280,height:900},{width:1024,height:768},{width:800,height:600},{width:641,height:700},{width:640,height:700},{width:600,height:700}];
            for(const viewport of viewports){
                await page.setViewportSize(viewport);await page.waitForTimeout(150);
                const metrics=await geometry(page);assert.deepEqual(metrics.errors,[],`${engine} ${mobile?'touch':'desktop'} ${viewport.width}: ${metrics.errors.join('; ')}`);assert.equal(metrics.lanes.length,8);
                assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.entries(gatherPreset()).filter(([key])=>/drum/i.test(key)||key==='channelEq'))),before,'layout/rotation changes drum/EQ settings');
                // Every lane remains reachable through the actual scroll owner.
                for(const kind of kinds){
                    const card=page.locator('#drumMachineLane-'+kind);
                    await press(page.locator(`[data-drum-jump="${kind}"]`));
                    await page.waitForTimeout(20);
                    const title=card.locator('.performance-chip');
                    assert(await title.isVisible());
                    const eq=card.locator('[data-eq-open]');await eq.scrollIntoViewIfNeeded();
                    assert(await eq.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),kind+' EQ is obstructed');
                }
                await press(page.locator('[data-drum-jump="kick"]'));await page.waitForTimeout(30);
                if([1280,800,390,320,844].includes(viewport.width))await page.screenshot({path:`${evidence}/${engine}-${mobile?'touch':'desktop'}-${viewport.width}x${viewport.height}.png`});
                results.push({engine,mobile,viewport,...metrics});console.log('PASS',engine,mobile?'touch':'desktop',JSON.stringify(viewport));
            }
            // Original handlers: browser, EQ dialog/toggle, normalise, accent, Copy Sec and grid.
            await page.setViewportSize({width:mobile?390:1280,height:mobile?844:900});
            const card=page.locator('#drumMachineLane-kick');
            await press(card.locator('#drumMachineKickBrowseBtn'));await page.locator('#sampleGridBrowser').waitFor({state:'visible'});await press(page.locator('#sampleGridBrowser [data-grid-action="close"]'));
            await press(card.locator('[data-eq-open]'));await page.locator('#channelEqDialog').waitFor({state:'visible'});await press(page.locator('#channelEqClose'));
            const eqOn=card.locator('[data-eq-on]'),old=await eqOn.isChecked();await press(eqOn);await page.waitForFunction(old=>mygrainChannelEq.get('drumKick').enabled!==old,old);await press(eqOn);
            await page.evaluate(async()=>{const b=audioContext.createBuffer(1,2400,24000);for(let i=0;i<2400;i++)b.getChannelData(0)[i]=.05*Math.sin(i*.08);await applyLoadedDrumMachineSampleBuffer('kick',b,{sourceKey:'samples_kick',fileName:'layout-source.wav'});});
            const sourceBefore=await page.evaluate(()=>[drumMachineKickBuffer.length,...drumMachineKickBuffer.getChannelData(0).slice(0,8)]);
            await press(card.locator('#drumNormalize-kick'));await page.waitForFunction(()=>!mygrainCardHistory.busy);
            const norm=await card.locator('#drumNormalizeBypass-kick').getAttribute('aria-pressed');await press(card.locator('#drumNormalizeBypass-kick'));assert.notEqual(await card.locator('#drumNormalizeBypass-kick').getAttribute('aria-pressed'),norm);
            assert.deepEqual(await page.evaluate(()=>[drumMachineKickBuffer.length,...drumMachineKickBuffer.getChannelData(0).slice(0,8)]),sourceBefore,'layout keeps original sample');
            const accent=card.locator('#drumMachineKickAccentAmount');await accent.fill('47');await accent.dispatchEvent('input');assert.equal(await card.locator('#drumMachineKickAccentAmountValue').textContent(),'47%');
            const copy=card.locator('[data-drum-copy-section]');await press(copy);assert.equal(await copy.getAttribute('aria-pressed'),'true');await press(copy);assert.equal(await copy.getAttribute('aria-pressed'),'false');
            const step=card.locator('.drum-machine-step-btn').first(),was=await step.getAttribute('aria-pressed');await press(step);assert.notEqual(await step.getAttribute('aria-pressed'),was);
            // Saved control values survive a real reload without duplicate controls.
            await page.reload();await boot();await page.evaluate(()=>openDrumMachineOverlay());assert.equal(await page.locator('#drumMachineKickAccentAmount').inputValue(),'47');assert.equal(await page.locator('#drumMachineOverlay .channel-eq-entry').count(),8);assert.deepEqual((await geometry(page)).errors,[]);
            assert.deepEqual(errors,[]);await context.close();
        }}finally{await browser.close();}
    }
    fs.writeFileSync(evidence+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
