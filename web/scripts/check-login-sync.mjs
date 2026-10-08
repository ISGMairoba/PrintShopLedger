import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {emptyLedger,applyEvent} from '../src/domain.mjs';

const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4180','--strictPort'],{stdio:'inherit'});
let browser;
try {
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4180')).ok)break;}catch{}await delay(100);}
 browser=await chromium.launch({headless:true});
 for(const mobile of [false,true]) {
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},serviceWorkers:'block'});
  const id='11111111-1111-4111-8111-111111111111',shop='22222222-2222-4222-8222-222222222222',material='33333333-3333-4333-8333-333333333333';
  const now=new Date().toISOString(),user={id,aud:'authenticated',role:'authenticated',email:'test@example.invalid',user_metadata:{full_name:'Test User'},app_metadata:{provider:'email'},created_at:now};
  const token=[{alg:'HS256',typ:'JWT'},{sub:id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600},'c2lnbmF0dXJl'].map(x=>typeof x==='string'?x:Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  let failBusiness=true,failStaff=false,holdLookup=false,held=[],writes=0,conflictCode='PT409';
  let cloud=applyEvent(emptyLedger(),{id:crypto.randomUUID(),kind:'material.created',data:{id:material,name:'Paper',available:10,measurementUnit:'sheet',requireSize:false,modifiedBy:id,modifiedByLabel:'Test User',modifiedAt:now}});
  await context.route('https://*.supabase.co/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   let result={},status=200;
   if(path==='/auth/v1/token'){
    if(route.request().postDataJSON().password==='wrong-password'){status=400;result={error:'invalid_grant',error_description:'Invalid login credentials'};}
    else result={access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'mock-refresh',user};
   }else if(path==='/auth/v1/user')result=user;
   else if(path==='/auth/v1/logout')result={};
   else if(path.endsWith('/list_business_shops')){
    if(holdLookup){held.push(route);return;}
    if(failBusiness){status=504;result={message:'Business lookup timed out'};}else result=[{id:shop,name:'Test business'}];
   }else if(path.endsWith('/list_my_shops')){
    if(failStaff){status=403;result={message:'Staff lookup unavailable'};}else result=[{id:shop,name:'Test business',role:'manager',rank:3,accessLevel:3,userId:id,username:'manager',staffName:'Test User'}];
   }else if(path.endsWith('/business_settings'))result=[];
   else if(path.endsWith('/get_ledger'))result=cloud;
   else if(path.endsWith('/apply_material_event')){
    writes++;const event=route.request().postDataJSON().p_event;
    cloud=applyEvent(cloud,{id:crypto.randomUUID(),kind:'material.updated',data:{...event.data,name:'Business paper '+writes,baseVersion:cloud.materials[0].version}});
    status=409;result={code:conflictCode,message:'Material changed elsewhere. Sync and reopen it before editing.'};
   }else if(path.endsWith('/staff-login'))result={access_token:token,refresh_token:'mock-refresh'};
   else throw Error('Unexpected request '+path);
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4180');
  await page.getByLabel('Business email',{exact:true}).fill('test@example.invalid');
  await page.getByLabel('Business password',{exact:true}).fill('wrong-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Invalid login credentials'}).waitFor();
  await page.getByLabel('Business password',{exact:true}).fill('correct-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('heading',{name:'Could not load your business',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Create your business workspace'}).count(),0);
  await page.getByRole('alert').filter({hasText:'Business lookup timed out'}).waitFor();
  failBusiness=false;failStaff=true;
  await page.getByRole('button',{name:'Retry workspace lookup',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Staff lookup unavailable'}).waitFor();
  failStaff=false;holdLookup=true;
  await page.clock.install();
  await page.getByRole('button',{name:'Retry workspace lookup',exact:true}).click();
  await page.getByRole('heading',{name:'Loading business workspace…',exact:true}).waitFor();
  await page.clock.runFor(25001);
  await page.getByRole('heading',{name:'Could not load your business',exact:true}).waitFor();
  holdLookup=false;
  await page.getByRole('button',{name:'Retry workspace lookup',exact:true}).click();
  await page.getByRole('heading',{name:'Point of Service',exact:true}).waitFor();
  for(const route of held)await route.fulfill({status:200,contentType:'application/json',body:'[]'}).catch(()=>{});
  // A late empty response from the old lookup must not replace the successful retry.
  await page.clock.runFor(1000);assert.equal(await page.getByRole('heading',{name:'Create your business workspace'}).count(),0);
  await page.reload();await page.getByRole('heading',{name:'Point of Service',exact:true}).waitFor();
  const nav=async name=>{if(mobile)await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('navigation',{name:'Main'}).getByRole('button',{name,exact:true}).click();};
  const saved=()=>page.evaluate(scope=>new Promise((resolve,reject)=>{const r=indexedDB.open('printshopledger-v1',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('ledgers').objectStore('ledgers').get(scope);q.onsuccess=()=>{resolve(q.result);db.close();};q.onerror=()=>reject(q.error);};r.onerror=()=>reject(r.error);}),id+':'+shop);
  for(const code of ['PT409','40001']) {
   conflictCode=code;await nav('Materials');await page.getByRole('button',{name:'Edit',exact:true}).click();
   const edit=page.getByRole('dialog',{name:'Edit material',exact:true});
   await edit.getByLabel('Name',{exact:true}).fill('Local paper');await edit.getByRole('button',{name:'Save material',exact:true}).click();
   await page.clock.runFor(1000);
   const review=page.getByRole('dialog',{name:'Review conflicting material edits',exact:true});await review.waitFor();
   const before=writes;assert.equal((await saved()).pending.length,1,'Conflict keeps pending work');
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.clock.runFor(10000);
   assert.equal(writes,before,'Conflict review pauses write retries, even after focus');
   await review.getByRole('button',{name:'Keep business version',exact:true}).click();await review.waitFor({state:'detached'});
   assert.equal((await saved()).pending.length,0);assert.equal((await saved()).ledger.materials[0].name,'Business paper '+writes);
  }
  if(mobile)await page.getByRole('button',{name:'Menu',exact:true}).click();
  await page.getByRole('button',{name:'Logout',exact:true}).click();await page.getByRole('heading',{name:'Staff sign in',exact:true}).waitFor();
  await page.getByLabel('Username',{exact:true}).fill('manager');await page.getByLabel('Password',{exact:true}).fill('correct-password');
  await page.getByRole('button',{name:'Sign in user',exact:true}).click();await page.getByRole('heading',{name:'Point of Service',exact:true}).waitFor();
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Login recovery, session restoration, staff logout/sign-in and conflict pause checks passed on desktop and mobile.');
}finally{await browser?.close();server.kill();}
