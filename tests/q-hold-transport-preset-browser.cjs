const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('playwright-core');
const base = process.env.SONG_BETA_TEST_URL || 'http://127.0.0.1:18891/mygrain/';
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/mygrain\/$/.test(base)) throw Error('Isolated localhost required.');
const evidence = process.env.Q_HOLD_EVIDENCE || '/tmp/mygrain-q-hold-copy';
(async () => {
    const results = [];
    for (const engine of ['chromium','webkit']) {
        const browser = await ({chromium,webkit}[engine]).launch(engine === 'chromium' ? { executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'] } : {});
        try { for (const mobile of [false,true]) {
            const context = await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
            assert.equal((await context.request.post(base+'api/auth/register',{data:{username:`tp_${engine[0]}_${+mobile}_${Date.now()}`,password:'isolated-transport-preset'}})).status(),200);
            const page=await context.newPage(), errors=[]; page.setDefaultTimeout(45000); page.on('pageerror',e=>errors.push(e.message));
            await page.route('**/*',r=>new URL(r.request().url()).origin === new URL(base).origin ? r.continue():r.abort());
            const tap=s=>mobile?page.locator(s).tap():page.locator(s).click();
            await page.goto(base); await page.waitForFunction(()=>window.mygrainQ&&document.documentElement.dataset.mygrainStartup==='ready');
            await tap('#start-btn'); await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended&&!mygrainCardHistory.busy);
            await page.evaluate(()=>{
                stopAllPerformancePlayback({silent:true});applyGlobalBpm(150);syncPatternLengthControls(16,{skipSave:true});setOscillatorsEnabled(false,{skipSave:true,silent:true});setGranularLayersEnabled(false,{skipSave:true,silent:true});
                const q=MygrainQTheory.defaults();q.chordHold=true;q.sequence[0]=MygrainQTheory.normalizeStep({root:60,type:'custom',notes:[60,65,70],velocity:73,gate:.5,accent:true});q.sequence[8]=MygrainQTheory.normalizeStep({notes:[62,66,69]});mygrainQ.restore(q);
                window.originalQPrepare=mygrainQ.preparePlayback.bind(mygrainQ);mygrainQ.preparePlayback=()=>new Promise(resolve=>{window.releaseQPreparation=resolve;});
            });
            assert.equal(await page.locator('#performanceBastardLoopPlayBtn').isEnabled(),true);
            await tap('#performanceBastardLoopPlayBtn');await page.waitForFunction(()=>isQPreparingUiTransport()&&typeof releaseQPreparation==='function');
            assert.equal(await page.locator('#performanceBastardLoopStopBtn').isEnabled(),true);
            await tap('#performanceBastardLoopStopBtn');await page.evaluate(()=>{releaseQPreparation();mygrainQ.preparePlayback=originalQPrepare;});
            await page.waitForFunction(()=>!isQPreparingUiTransport());await page.waitForTimeout(60);
            assert.equal(await page.evaluate(()=>mygrainQ.running||bastardLoopPlaying),false,'Stop cancels a pending Start');
            await page.evaluate(async()=>{await mygrainQ.setInstrument('strings');window.qStarts=[];const voice=mygrainQ.voice.bind(mygrainQ);mygrainQ.voice=(...args)=>{qStarts.push({start:args[2],origin:mygrainQ.origin});return voice(...args);};});
            assert.equal(await page.evaluate(()=>mygrainQ.piano.cache.size),0,'cold global Start');
            const global = async()=>{
                const selector=mobile?'#sectionJumpTransportBtn:visible, #sectionJumpTransportPanelBtn:visible':'#desktopTransportBtn';
                const control=page.locator(selector).first();
                if (await control.count()) {if(mobile)await control.tap();else await control.click();}
                else await page.evaluate(()=>handleSidebarTransportToggle());
            };
            await global();await page.waitForFunction(()=>mygrainQ.running&&qStarts.length>0);
            const starts=await page.evaluate(()=>qStarts.slice(0,3));assert(starts.every(v=>Math.abs(v.start-v.origin)<.002),JSON.stringify(starts));
            await global();await page.waitForFunction(()=>!mygrainQ.running&&!isDesktopTransportRunning());
            const preset=await page.evaluate(()=>{
                const exported=JSON.parse(JSON.stringify(gatherPreset()));const expected=MygrainQTheory.copy(exported.q);
                mygrainQ.state.chordHold=false;mygrainQ.state.sequence[0]=null;
                applyPreset(exported);
                const restored=MygrainQTheory.copy(mygrainQ.state);
                const legacy={...exported};delete legacy.q;applyPreset(legacy);
                return {expected,restored,legacyPreserved:JSON.stringify(mygrainQ.state)===JSON.stringify(restored)};
            });
            assert.deepEqual(preset.restored,preset.expected);assert.equal(preset.legacyPreserved,true);
            assert.deepEqual(errors,[]);results.push({engine,mobile,stopCancelsPendingStart:true,coldGlobalStart:starts,presetExact:true,legacyPresetUnchanged:true});
            console.log(`${engine}/${mobile}: pending Stop, cold global Start/Stop and JSON preset roundtrip passed.`);
            await context.close();
        }}finally{await browser.close();}
    }
    fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(evidence+'/transport-preset-results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
