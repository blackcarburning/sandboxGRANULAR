const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright-core'),{execFileSync}=require('node:child_process');
const base=process.env.MYGRAIN_TEST_URL||'http://127.0.0.1:18950/mygrain/';assert.match(base,/^http:\/\/127\.0\.0\.1:18950\/mygrain\/$/);
(async()=>{for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});
 try{for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(20000);await page.goto(base+'?account=create',{waitUntil:'domcontentloaded'});await page.waitForSelector('#mygrainLoginForm');
  const username=`approval_${engine[0]}_${+mobile}_${Date.now().toString(36)}`;
  await page.fill('#mygrainLoginUsername',username);await page.fill('#mygrainLoginPassword','new-account-test-password');
  console.log('loaded',engine,mobile);await page.click('#mygrainCreateUserBtn');assert.equal(await page.locator('#mygrainLoginEmail').evaluate(e=>e.validity.valueMissing),true);
  await page.fill('#mygrainLoginEmail','applicant@example.com');
  const registration=page.waitForResponse(r=>r.url().endsWith('/api/auth/register'));await page.click('#mygrainCreateUserBtn');const response=await registration,payload=await response.json();assert.equal(response.status(),202);assert(payload.pending&&!payload.authenticated);
  await page.waitForFunction(()=>document.getElementById('mygrainLoginStatus').textContent.includes('awaiting approval'));
  assert.equal(await page.inputValue('#mygrainLoginPassword'),'');assert.equal((await context.cookies()).some(c=>c.name==='mygrain_session'),false);
  await page.fill('#mygrainLoginPassword','new-account-test-password');const pendingLogin=page.waitForResponse(r=>r.url().endsWith('/api/auth/login'));await page.click('#mygrainLoginBtn');assert.equal((await pendingLogin).status(),403);await page.waitForFunction(()=>document.getElementById('mygrainLoginStatus').textContent.includes('awaiting approval'));
  const session=await context.request.get(base+'api/auth/session');assert.equal((await session.json()).authenticated,false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  execFileSync('python3',['-c',"import importlib.util,sys;s=importlib.util.spec_from_file_location('worker','/tmp/mygrain-eq-song-2/workspace/scripts/mygrain_account_approvals.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);a=m.store('/tmp/mygrain-approval-ui/store/auth/accounts.sqlite3','/tmp/mygrain-approval-ui/store/users');r=a.registration_request(sys.argv[1]);a.decide_registration(r['id'],'approved',r['approval_token'],'8645802908')",payload.requestId]);
  await page.waitForFunction(()=>!document.getElementById('mygrainLoginBtn').disabled);await page.click('#mygrainLoginBtn');await page.waitForFunction(()=>window.mygrainAccounts?.authenticated===true);
  assert.equal((await(await context.request.get(base+'api/auth/session')).json()).authenticated,true);
  assert.deepEqual(errors,[]);console.log('PASS',engine,mobile?'phone':'desktop',username);await context.close();
 }}finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
