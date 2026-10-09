import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {defaultBranding} from '../src/business-branding.mjs';
import {pages,canAccessPage} from '../src/page-access.mjs';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4178','--strictPort'],{stdio:'inherit'});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4178')).ok)break;}catch{}await delay(100);}
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 for(const mobile of [false,true])for(const rank of [1,2,3,4]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},serviceWorkers:'block'});
  const id='11111111-1111-4111-8111-111111111111',shop='22222222-2222-4222-8222-222222222222',role=['','cashier','admin','manager','developer'][rank];
  const now=new Date().toISOString();let username=role,calls=0,workspaceFailure=rank===3,customSettings=null;
  const token=[{alg:'HS256',typ:'JWT'},{sub:id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600},'c2lnbmF0dXJl'].map(x=>typeof x==='string'?x:Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  const user={id,aud:'authenticated',role:'authenticated',email:'test@example.invalid',user_metadata:{full_name:'Test User'},app_metadata:{provider:'email'},created_at:now};
  await context.route('https://*.supabase.co/**',async route=>{
   const path=new URL(route.request().url()).pathname,body=route.request().method()==='POST'?route.request().postDataJSON():{};let result={};
   if(path==='/auth/v1/token')result={access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'mock-refresh',user};
   else if(path==='/auth/v1/user')result=user;
   else if(path.endsWith('/list_business_shops')){if(workspaceFailure){await route.fulfill({status:504,contentType:'application/json',body:JSON.stringify({message:'Business lookup timed out'})});return;}result=[{id:shop,name:'Test business'}];}
   else if(path.endsWith('/list_my_shops'))result=[{id:shop,name:'Test business',role,rank,accessLevel:rank,userId:id,username,staffName:'Test User'}];
   else if(path.endsWith('/business_settings'))result=customSettings?[{settings:customSettings,version:1}]:[];
   else if(path.endsWith('/get_ledger'))result={customers:[],jobs:[],payments:[],materials:[],materialHistory:[],services:[],checkouts:[],drawerClosings:[],expenses:[],expenseHistory:[]};
   else if(path.endsWith('/update-credentials')){
    calls++;assert.equal(body.userId,id);assert.equal(body.shopId,shop);assert.equal(body.currentPassword,'current-password');
    if(body.action==='username')username=body.username;else assert.equal(body.password,'new-test-password');
    result={message:body.action==='username'?'Username saved.':'Password saved.'};
   }else throw Error('Unexpected request: '+path);
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  const page=await context.newPage();await page.goto('http://127.0.0.1:4178');
  await page.getByLabel('Business email',{exact:true}).fill('test@example.invalid');await page.getByLabel('Business password',{exact:true}).fill('current-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  if(rank===3){await page.getByRole('heading',{name:'Could not load your business',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Create your business workspace',exact:true}).count(),0,'Failed lookup must not offer duplicate workspace creation');workspaceFailure=false;await page.getByRole('button',{name:'Retry workspace lookup',exact:true}).click();}
  await page.getByRole('heading',{name:'Point of Service',exact:true}).waitFor();
  const open=async()=>{if(mobile)await page.getByRole('button',{name:'Menu',exact:true}).click();};
  await open();const nav=page.getByRole('navigation',{name:'Main'});await nav.getByRole('button',{name:'Point of Service',exact:true}).waitFor();
  assert.deepEqual(await nav.getByRole('button').allTextContents(),pages.filter(p=>canAccessPage(p,rank)));
  await nav.getByRole('button',{name:'My Account',exact:true}).click();
  await page.getByLabel('Username',{exact:true}).fill('bad name');assert.equal(await page.getByRole('button',{name:'Save username',exact:true}).isDisabled(),true);
  await page.getByLabel('Username',{exact:true}).fill('valid.user');await page.getByLabel('Current password',{exact:true}).first().fill('current-password');await page.getByRole('button',{name:'Save username',exact:true}).click();if(mobile)await open();await page.locator('.sidebar-user').getByText('Test User (valid.user)',{exact:true}).waitFor({state:'attached'});assert.equal(calls,1);if(mobile)await nav.getByRole('button',{name:'My Account',exact:true}).click();
  await page.getByLabel('Current password',{exact:true}).last().fill('current-password');await page.getByLabel('New password',{exact:true}).fill('new-test-password');await page.getByLabel('Confirm new password',{exact:true}).fill('different-password');await page.getByRole('button',{name:'Save password',exact:true}).click();await page.getByText('New passwords must match.',{exact:true}).waitFor();assert.equal(calls,1);
  await page.getByLabel('Confirm new password',{exact:true}).fill('new-test-password');await page.getByRole('button',{name:'Save password',exact:true}).click();await page.getByText('Password saved.',{exact:true}).waitFor();assert.equal(calls,2);
  await context.setOffline(true);await page.getByRole('button',{name:'Save password',exact:true}).waitFor({state:'visible'});await delay(50);assert.equal(await page.getByRole('button',{name:'Save password',exact:true}).isDisabled(),true);await context.setOffline(false);
  if(rank===4){await open();await nav.getByRole('button',{name:'Business Settings',exact:true}).click();await page.getByLabel('Business name',{exact:true}).waitFor();assert.equal(await page.getByLabel('Business name',{exact:true}).inputValue(),'Test business');}
  customSettings={...defaultBranding(),businessName:'Test business',pageAccess:{'1':['Point of Service','Jobs','My Account'],'2':['Point of Service','My Account','Sale Adjustments'],'3':['Point of Service','My Account','My Sales']}};await page.reload();await page.getByRole('heading',{name:'Point of Service',exact:true}).waitFor();await page.getByRole('heading',{name:'Point of Service',exact:true}).waitFor();await delay(150);await open();assert.deepEqual(await nav.getByRole('button').allTextContents(),pages.filter(p=>canAccessPage(p,rank,customSettings.pageAccess)));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Layout fits screen');await context.close();
 }
 console.log('Page access and account checks passed on desktop and mobile for all ranks.');
}finally{await browser?.close();server.kill();}
