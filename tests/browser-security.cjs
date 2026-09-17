const {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async()=>{
  const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  try {
    for(const root of process.argv.slice(2)) for(const width of [390,1280]) {
      const context = await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
      const page = await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
      let signedIn=false;const requests=[];
      await context.route('https://loyalty.test/**', async route=>{
        const url=new URL(route.request().url());
        if(url.pathname==='/api/neon'){
          const p=route.request().postDataJSON();requests.push(p);let status=200,body={ok:true};
          if(p.action==='public_business')body={business:{name:'Test store',loyalty_rate:10}};
          else if(p.action==='register_customer'||p.action==='customer_login')signedIn=true;
          else if(p.action==='customer_logout')signedIn=false;
          else if(p.action==='wallet') {if(!signedIn){status=401;body={error:'Please sign in'};}else body={customer:{name:'Alice',business_name:'<img src=x onerror=alert(1)>',business_id:7,balance:50,loyalty_rate:10},transactions:[{type:'earn',purchase_amount:100,earned_amount:10}]};}
          else if(p.action==='customer_approve_redemption')body={code:'abcdef1234567890',amount:10,expires_in:300};
          return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
        }
        try {const file=path.join(root,url.pathname==='/' ? 'index.html' : url.pathname.slice(1));const body=await fs.readFile(file);return route.fulfill({body,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});}catch{return route.fulfill({status:404,body:''});}
      });
      await page.goto('https://loyalty.test/join.html?business_id=7');
      await page.waitForFunction(()=>!document.getElementById('btn').disabled);
      await page.locator('#modeBtn').click();assert.equal(await page.locator('#name').isVisible(),false);
      await page.locator('#modeBtn').click();assert.equal(await page.locator('#name').isVisible(),true);
      await page.locator('#name').fill('Alice');await page.locator('#phone').fill('050-1234567');await page.locator('#password').fill('strong password 123');await page.locator('#btn').click();
      await page.waitForURL('**/customer.html');await page.waitForFunction(()=>document.getElementById('total').textContent.includes('50.00'));
      assert.equal(await page.locator('#businessName img').count(),0);
      assert.equal(await page.evaluate(()=>localStorage.getItem('loyalty_wallet_token')),null);
      await page.locator('#approvalAmount').fill('10');await page.locator('#approveBtn').click();await page.waitForFunction(()=>document.getElementById('approvalCode').textContent.includes('abcd-ef12-3456-7890'));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.locator('#logoutBtn').click();await page.waitForURL('**/join.html?mode=login*');
      assert(requests.some(x=>x.action==='customer_logout'));assert.equal(signedIn,false);
      await page.goto('https://loyalty.test/customer.html?token=stolen-old-token');await page.waitForURL('**/join.html?mode=login*');
      assert.equal(requests.filter(x=>x.action==='wallet').some(x=>x.token),false);
      assert.deepEqual(errors,[]);
      console.log(path.basename(root),width,'signup/login controls, safe rendering, redemption, logout, legacy-link rejection: PASS');
      await context.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
