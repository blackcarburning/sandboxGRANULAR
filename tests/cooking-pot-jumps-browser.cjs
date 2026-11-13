'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {chromium, webkit} = require('playwright-core');
const base = process.env.BASE || 'http://127.0.0.1:19348/mygrain/';
const out = process.env.OUT || '/tmp';
const cases = process.env.CASES?.split(',');
const targets = {
  mutilator: ['loopDMutilator', '.d-mutilator-head'],
  bassFace: ['bassFaceCard', '.bass-face-head'],
  turntable: ['turntableCard', '.tt-header'],
  resonator: ['resonatorCard', '.r-head'],
  wireWorld: ['wireWorldCard', '.acoustic-head'],
  sonicCrystal: ['sonicCrystalCard', '.acoustic-head'],
  bubbleChamber: ['bubbleChamberCard', '.acoustic-head'],
  wasp: ['waspCard', '.wasp-head'],
  playground: ['filterPlaygroundCard', '.wasp-pg-head']
};

async function arrived(page, id, header) {
  await page.waitForFunction(({id, header}) => {
    const target = document.getElementById(id);
    const head = target?.querySelector(header);
    const rect = head?.getBoundingClientRect();
    return rect?.height > 0 && rect.top >= -3 && rect.top < innerHeight - 30 &&
      target.style.contentVisibility !== 'hidden' && !document.documentElement.dataset.mygrainJumping;
  }, {id, header});
}
async function snapshot(page) {
  return page.evaluate(() => ({
    pot: mygrainCookingPot.settings(), d: mygrainD.settings(),
    bass: mygrainBassFace.settings(), turntable: mygrainTurntable.settings(),
    resonator: mygrainResonator.settings(), acoustic: mygrainAcousticFx.settings(),
    wasp: mygrainWasp.settings()
  }));
}

(async () => {
  const receipts = [];
  for (const [engine, type] of Object.entries({chromium, webkit})) {
    for (const phone of [false, true]) {
      const name = engine + (phone ? '-phone' : '-desktop');
      if (cases && !cases.includes(name)) continue;
      const browser = await type.launch(engine === 'chromium' ? {
        executablePath: '/snap/bin/chromium',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
      } : {});
      try {
        const context = await browser.newContext(phone ? {
          viewport: {width:390, height:844}, isMobile:true, hasTouch:true
        } : {viewport:{width:1440, height:1000}});
        const page = await context.newPage();
        const errors = [], failedAssets = [];
        page.setDefaultTimeout(45000);
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => {
          if (response.status() >= 400 && /cooking-pot\.(js|css)/.test(response.url()))
            failedAssets.push(response.url());
        });
        await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
        if(process.env.LIVE_ASSET_BASE)await page.route(/\/cooking-pot\.(js|css)\?/,async route=>{
          const url=new URL(route.request().url()),name=url.pathname.split('/').pop();
          const response=await context.request.get(process.env.LIVE_ASSET_BASE+name+url.search);
          assert.equal(response.status(),200);
          const body=await response.body(),expected=fs.readFileSync(path.join(__dirname,'..',name));
          assert.equal(crypto.createHash('sha256').update(body).digest('hex'),crypto.createHash('sha256').update(expected).digest('hex'));
          await route.fulfill({status:200,contentType:response.headers()['content-type'],body});
        });
        assert.equal((await context.request.post(base+'api/auth/login', {
          data:{username:'admin', password:'isolated-vst3-test'}
        })).status(), 200);
        await page.goto(base);
        await page.waitForFunction(() => document.documentElement.dataset.mygrainStartup === 'ready');
        await page.evaluate(() => mygrainCardHistory.ready);
        await page.locator('#start-btn').click();
        await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended && !mygrainCardHistory.busy);
        const before = await snapshot(page);
        const cold = await page.evaluate(() => [['waspCard','.wasp-head'],['filterPlaygroundCard','.wasp-pg-head'],['turntableCard','.tt-header']].filter(([id,head]) => !document.getElementById(id)?.querySelector(head)).length);
        await page.evaluate(() => {
          const card = document.getElementById('cookingPotCard');
          mygrainDisplay.reveal(card); card.scrollIntoView({block:'start'});
        });
        assert.equal(await page.locator('[data-pot-jump]').count(), 9);
        const activate = async locator => {try {if(phone)await locator.tap();else await locator.click();}catch(error){await page.screenshot({path:out+'/'+name+'-failure.png'});fs.writeFileSync(out+'/'+name+'-failure.json',JSON.stringify(await page.evaluate(()=>({scrollY,innerHeight,jumping:document.documentElement.dataset.mygrainJumping,buttons:[...document.querySelectorAll('[data-pot-return]')].map(el=>({key:el.dataset.potReturn,rect:el.getBoundingClientRect().toJSON(),ancestors:[...function*(n){while(n){yield n;n=n.parentElement}}(el)].slice(0,8).map(n=>({tag:n.tagName,id:n.id,cls:n.className,style:n.getAttribute('style'),hidden:n.hidden,cv:getComputedStyle(n).contentVisibility,display:getComputedStyle(n).display,visibility:getComputedStyle(n).visibility}))}))})),null,2));throw error;}};
        let rounds = 0;
        for (const [key, [id, header]] of Object.entries(targets)) {
          console.log('CHECK',name,key);
          // Collapse all enclosing details, then exercise the real reveal/navigation helper.
          await page.evaluate(id => {
            for (let el=document.getElementById(id); el; el=el.parentElement)
              if (el.tagName==='DETAILS') el.open=false;
          }, id);
          const jump = page.locator(`[data-pot-jump="${key}"]`);
          await jump.scrollIntoViewIfNeeded(); await activate(jump);
          await arrived(page, id, header);
          assert(await page.evaluate(id => {
            for(let el=document.getElementById(id); el; el=el.parentElement)
              if(el.tagName==='DETAILS'&&!el.open) return false;
            return true;
          }, id));
          const back = page.locator(`#${id} [data-pot-return="${key}"]`);
          await back.waitFor({state:'visible'});
          assert.equal(await back.count(),1);
          assert.equal(await back.locator('svg').count(),1);
          const rect = await back.boundingBox();
          assert(rect.width>=44 && rect.height>=44, key+' touch target');
          assert(await page.evaluate(() => {
            const r=document.getElementById('cookingPotCard').getBoundingClientRect();
            return r.bottom<=0 || r.top>=innerHeight;
          }), key+' pot card must be offscreen before return');
          await activate(back); await arrived(page,'cookingPotCard','.pot-heading');
          rounds++;
        }
        // Repeat a hydrated lazy-card round trip using keyboard Enter.
        const wasp = page.locator('[data-pot-jump="wasp"]');
        await wasp.focus(); await page.keyboard.press('Enter');
        await arrived(page,'waspCard','.wasp-head');
        await page.locator('#waspCard [data-pot-return]').focus();
        await page.keyboard.press('Enter'); await arrived(page,'cookingPotCard','.pot-heading');
        // Layers is a single navigation entry, not another power/volume control.
        await page.evaluate(() => {
          const card=document.getElementById('performanceLayerSwitchesCard');
          mygrainDisplay.reveal(card);card.scrollIntoView({block:'start'});
        });
        const layer = page.locator('#performanceLayerCookingPotJumpBtn');
        assert.equal(await layer.count(),1);
        assert.equal(await layer.getAttribute('aria-pressed'),null);
        assert.equal(await layer.locator('input').count(),0);
        await layer.scrollIntoViewIfNeeded(); await activate(layer);
        await arrived(page,'cookingPotCard','.pot-heading');
        assert.deepEqual(await snapshot(page),before,'navigation changed audio/power/order');
        const handle=page.locator('[data-pot-effect="bassFace"] .pot-handle');
        await handle.focus();await page.keyboard.press('ArrowUp');
        await page.waitForFunction(()=>!mygrainCardHistory.busy&&mygrainCookingPot.settings().order[0]==='bassFace');
        assert.equal(await page.locator('#cookingPotCard tbody tr').first().getAttribute('data-pot-effect'),'bassFace');
        await page.evaluate(()=>mygrainCardHistory.undo());
        await page.waitForFunction(()=>!mygrainCardHistory.busy&&!mygrainCookingPot.settings().enabled);
        assert.deepEqual(await snapshot(page),before,'reorder Undo did not restore baseline');
        await page.evaluate(() => {mygrainCookingPot.mount();mygrainNavigation.refresh()});
        assert.equal(await layer.count(),1);
        assert.equal(await page.locator('[data-pot-return]').count(),9);
        await page.locator('#cookingPotCard').screenshot({path:out+'/'+name+'-pot-jumps.png'});
        const widths=[320,390,844,1440];
        for(const width of widths) {
          await page.setViewportSize({width,height:900});
          const layout=await page.evaluate(() => {
            const card=document.getElementById('cookingPotCard');
            for(const button of document.querySelectorAll('[data-pot-return]'))mygrainDisplay.reveal(button);
            mygrainDisplay.reveal(card);card.scrollIntoView({block:'start'});
            const returns=[...document.querySelectorAll('[data-pot-return]')].every(button=>{const r=button.getBoundingClientRect(),c=button.closest('.pot-return-nav').parentElement.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=c.left&&r.right<=c.right});
            return {returns,
              contained:card.scrollWidth<=card.clientWidth+1 && document.documentElement.scrollWidth<=innerWidth+1,
              jumps:[...card.querySelectorAll('[data-pot-jump]')].every(button=>{
                const r=button.getBoundingClientRect(),c=card.getBoundingClientRect();
                return r.width>0&&r.height>=44&&r.left>=c.left&&r.right<=c.right;
              })
            };
          });
          assert(layout.contained && layout.jumps && layout.returns,name+' layout '+width+' '+JSON.stringify(layout));
        }
        assert.deepEqual(errors,[]); assert.deepEqual(failedAssets,[]);
        const receipt={name,roundTrips:rounds,keyboardReturn:true,reorderUndo:true,layersJumpOnly:true,duplicates:0,stateUnchanged:true,widths,coldCandidates:cold,liveAssets:!!process.env.LIVE_ASSET_BASE};
        receipts.push(receipt);console.log('PASS',JSON.stringify(receipt));
      } finally { await browser.close(); }
    }
  }
  fs.writeFileSync(out+'/cooking-pot-jumps-browser.json',JSON.stringify(receipts,null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
