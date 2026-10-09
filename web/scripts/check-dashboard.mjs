import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {defaultBranding} from '../src/business-branding.mjs';
import {emptyLedger} from '../src/domain.mjs';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4181','--strictPort'],{stdio:'inherit'});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4181')).ok)break;}catch{}await delay(100);}
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 for(const mobile of [false,true])for(const rank of [1,2,3,4]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},serviceWorkers:'block'});
  const id='11111111-1111-4111-8111-111111111111',shop='22222222-2222-4222-8222-222222222222',now=new Date().toISOString(),role=['','cashier','admin','manager','developer'][rank];
  const token=[{alg:'HS256',typ:'JWT'},{sub:id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600},'c2lnbmF0dXJl'].map(x=>typeof x==='string'?x:Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  const user={id,aud:'authenticated',role:'authenticated',email:'test@example.invalid',user_metadata:{full_name:'Test User'},app_metadata:{provider:'email'},created_at:now};
  let settings={...defaultBranding(),businessName:'Mairoba Studios'};
  const ledger=emptyLedger();ledger.jobs=[{id:'test-job',customerId:'customer',service:'Banner printing',description:'Test banner',amount:4500000,createdAt:'2026-10-09T09:00:00Z',productionStatus:'Queued'}];ledger.customers=[{id:'customer',name:'Test customer',creditLimit:10000000}];ledger.payments=[{id:'payment',customerId:'customer',amount:1500000,method:'Cash',paidOn:'2026-10-09',createdAt:'2026-10-09',allocations:[{jobId:'test-job',amount:1500000}]}];ledger.materials=[{id:'material',name:'Flex roll',available:-2,measurementUnit:'ft',archived:false}];
  ledger.expenses=[{id:'expense',description:'Transport',amount:500000,incurredOn:'2026-10-09',payments:[{amount:200000,paidOn:'2026-10-09'}],voided:false}];
  await context.route('https://*.supabase.co/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result={};
   if(path==='/auth/v1/token')result={access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'mock-refresh',user};
   else if(path==='/auth/v1/user')result=user;
   else if(path.endsWith('/list_business_shops'))result=[{id:shop,name:'Mairoba Studios'}];
   else if(path.endsWith('/list_my_shops'))result=[{id:shop,name:'Mairoba Studios',userId:id,role,rank,accessLevel:rank,username:role,staffName:'Test User'}];
   else if(path.endsWith('/business_settings'))result=[{settings,version:1}];
   else if(path.endsWith('/get_ledger'))result=ledger;
   else throw Error('Unexpected request: '+path);
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:4181');await page.getByLabel('Business email',{exact:true}).fill('test@example.invalid');await page.getByLabel('Business password',{exact:true}).fill('test-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Point of Service',exact:true}).waitFor();
  const open=async()=>{if(mobile)await page.getByRole('button',{name:'Menu',exact:true}).click();};await open();const nav=page.getByRole('navigation',{name:'Main'});
  if(rank===1){assert.equal(await nav.getByRole('button',{name:'Dashboard',exact:true}).count(),0);await context.close();continue;}
  await nav.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();await page.getByLabel('From',{exact:true}).fill('2026-10-09');await page.getByLabel('To',{exact:true}).fill('2026-10-09');
  const values=page.locator('.dashboard-stats').first();await values.getByText('₦45,000.00',{exact:true}).waitFor();await values.getByText('₦15,000.00',{exact:true}).waitFor();await values.getByText('₦13,000.00',{exact:true}).waitFor();await page.getByText('₦30,000.00',{exact:true}).waitFor();
  await page.locator('.dashboard-row').filter({hasText:'Flex roll'}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Dashboard fits viewport');
  await page.screenshot({path:mobile?'/tmp/ledger-dashboard-mobile.png':'/tmp/ledger-dashboard-desktop.png',fullPage:true});
  await page.getByLabel('From',{exact:true}).fill('2026-10-10');await page.getByRole('alert').filter({hasText:'Choose valid From'}).waitFor();assert.equal(await page.locator('.dashboard-chart').count(),0);
  await page.getByLabel('From',{exact:true}).fill('2026-10-09');await context.setOffline(true);await page.getByText(/Offline — showing saved device records/).waitFor();await context.setOffline(false);
  if(rank===2||rank===3){settings={...settings,pageAccess:{...settings.pageAccess,[String(rank)]:['Dashboard','My Account']}};await page.reload();await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();await page.getByText('No summary sections are available under your current page permissions.',{exact:true}).waitFor();assert.equal(await page.locator('.dashboard-stats article').count(),0);assert.equal(await page.locator('.dashboard-chart').count(),0);}
  assert.deepEqual(errors,[]);console.log(`${mobile?'Mobile':'Desktop'} rank ${rank} dashboard passed.`);await context.close();
 }
 console.log('Dashboard figures, dates, permission filtering, offline notice and mobile layout passed.');
}finally{await browser?.close();server.kill();}
