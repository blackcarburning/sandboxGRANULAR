'use strict';
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright-core');
(async () => {
  for (const [engine, type] of Object.entries({chromium, webkit})) {
    const browser = await type.launch(engine === 'chromium' ? {executablePath:'/snap/bin/chromium',args:['--no-sandbox']} : {});
    try {
      for (const viewport of [{width:390,height:844},{width:844,height:390}]) {
        const context = await browser.newContext({viewport,isMobile:true,hasTouch:true});
        const base = 'http://127.0.0.1:18967/mygrain/';
        assert.equal((await context.request.post(base+'api/auth/login',{data:{username:'admin',password:'isolated-page-scroll'}})).status(),200);
        const page = await context.newPage();
        const errors = []; page.on('pageerror',e=>errors.push(e.message));
        await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
        await page.goto(base);
        await page.waitForFunction(()=>window.mygrainQ && document.documentElement.dataset.mygrainStartup==='ready');
        assert.match(await page.locator('#start-overlay').innerText(),/This app works best in Chrome/);
        await page.locator('#start-btn').tap();
        await page.waitForFunction(()=>isAudioGraphReady()&&!engineStarting&&!stateSaveSuspended);
        for (const [open, overlay, close] of [
          ['openBastardLoopLOverlay()','bastardLoopLOverlay','bastardLoopLCloseBtn'],
          ['openBastardLoopXOverlay()','bastardLoopXOverlay','bastardLoopXCloseBtn'],
          ['mygrainQ.open()','bastardLoopQOverlay','bastardLoopQCloseBtn'],
          ['openDrumMachineOverlay()','drumMachineOverlay','drumMachineCloseBtn'],
          ['openSynthPopup()','synthPopupOverlay','oscPopupCloseBtn']
        ]) {
          await page.evaluate(code=>(0,eval)(code),open);
          const button = page.locator('#'+close); await button.waitFor({state:'visible'});
          const r = await button.boundingBox();
          assert(r.x+r.width<=viewport.width-24,`${engine} ${viewport.width} ${close}: right edge ${r.x+r.width}`);
          assert(r.height>=44);
          assert(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}));
          await button.tap(); await page.locator('#'+overlay).waitFor({state:'hidden'});
        }
        assert.deepEqual(errors,[]);
        console.log('PASS close insets and taps',engine,viewport.width);
        await context.close();
      }
    } finally { await browser.close(); }
  }
})().catch(e=>{console.error(e);process.exit(1)});
