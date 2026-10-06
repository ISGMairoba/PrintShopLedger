import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4174','--strictPort'],{stdio:'inherit'});
let browser;
try {
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4174')).ok)break;}catch{}await delay(100);}
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
 const actor='11111111-1111-4111-8111-111111111111',shop='22222222-2222-4222-8222-222222222222';
 const now=new Date().toISOString();
 let users=[{id:'33333333-3333-4333-8333-333333333333',userId:actor,name:'Test Manager',username:'manager',rank:3,accessLevel:3,role:'manager',archived:false,version:1,lastLogin:now,createdAt:now,modifiedAt:now,createdByLabel:'Test Manager',modifiedByLabel:'Test Manager'}];
 const makeToken=(id)=>[{alg:'HS256',typ:'JWT'},{sub:id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600},'c2lnbmF0dXJl'].map(part=>typeof part==='string'?part:Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
 const token=makeToken(actor),cashierId='55555555-5555-4555-8555-555555555555';
 const authUser={id:actor,aud:'authenticated',role:'authenticated',email:'owner@example.invalid',user_metadata:{full_name:'Test Manager'},app_metadata:{provider:'email'},created_at:now};
 await context.route('https://*.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const body=route.request().method()==='POST'?route.request().postDataJSON():{};
  let result;
  if(path==='/auth/v1/token')result={access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'mock-refresh',user:authUser};
  else if(path==='/auth/v1/user'){const bearer=route.request().headers().authorization?.slice(7);const id=bearer?JSON.parse(Buffer.from(bearer.split('.')[1],'base64url').toString()).sub:actor;result=id===actor?authUser:{...authUser,id:cashierId,email:'internal@example.invalid',user_metadata:{full_name:'Amina Updated'}};}
  else if(path==='/auth/v1/logout')result={};
  else if(path.endsWith('/list_business_shops'))result=[{id:shop,name:'Test business'}];
  else if(path.endsWith('/list_my_shops')){const bearer=route.request().headers().authorization?.slice(7);const id=bearer?JSON.parse(Buffer.from(bearer.split('.')[1],'base64url').toString()).sub:actor;result=[{id:shop,name:'Test business',role:id===actor?'manager':'cashier',rank:id===actor?3:1,accessLevel:id===actor?3:1,userId:id,username:id===actor?'manager':'amina.print',staffName:id===actor?'Test Manager':'Amina Updated'}];}
  else if(path.endsWith('/staff-login')){
   if(body.password==='wrong-password'){await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Username or password incorrect, or access is unavailable.'})});return;}
   const target=body.username==='manager'?actor:cashierId;result={access_token:makeToken(target),refresh_token:target===actor?'manager-refresh':'cashier-refresh'};
  }
  else if(path.endsWith('/list_shop_users'))result=users;
  else if(path.endsWith('/manage-users')&&body.action==='reset-password'){assert.ok(body.password.length>=12);result={success:true};}
  else if(path.endsWith('/manage-users')){
   assert.equal(body.username,'amina.print');assert.equal(body.role,'cashier');assert.equal(body.rank,1);assert.equal('email' in body,false);
   users.push({...users[0],id:'44444444-4444-4444-8444-444444444444',userId:'55555555-5555-4555-8555-555555555555',...body,accessLevel:body.rank,archived:false,lastLogin:null});result={success:true};
  }else if(path.endsWith('/save_shop_user')){
   const user=users.find(item=>item.id===body.p_data.id);assert.ok(user);
   if(body.p_action==='edit')Object.assign(user,body.p_data);
   else if(body.p_action==='grant')user.accessLevel=user.rank;
   else if(body.p_action==='revoke')user.accessLevel=0;
   else user.archived=body.p_action==='archive';
   user.version++;result=null;
  }else throw new Error('Unexpected mocked request: '+path);
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 const page=await context.newPage();
 await page.goto('http://127.0.0.1:4174');
 await page.getByLabel('Business email',{exact:true}).fill('owner@example.invalid');
 await page.getByLabel('Business password',{exact:true}).fill('test-only-password');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Users',exact:true}).click();
 await page.getByRole('button',{name:'Add user',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'Add user'});
 await dialog.getByLabel('Name',{exact:true}).fill('Amina');
 await dialog.getByLabel('Username',{exact:true}).fill('AMINA.Print');
 await dialog.getByLabel('Rank',{exact:true}).selectOption('cashier');
 assert.equal(await dialog.getByLabel('Email',{exact:true}).count(),0);
 await dialog.getByLabel('Password',{exact:true}).fill('test-only-password');
 const box=await dialog.boundingBox();
 assert.ok(Math.abs(box.x+box.width/2-640)<3);
 await assert.rejects(page.getByRole('button',{name:'Materials',exact:true,includeHidden:true}).click({timeout:400}));
 await dialog.getByRole('button',{name:'Save user',exact:true}).click();
 await dialog.waitFor({state:'detached'});
 await page.getByRole('button',{name:'Audit view',exact:true}).click();
 await page.getByRole('button',{name:'Created by',exact:true}).waitFor();
 await page.getByLabel('Search users').fill('amina.print');
 let row=page.locator('tbody tr');
 await row.getByRole('button',{name:'Edit',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'Edit user'});
 await dialog.getByLabel('Name',{exact:true}).fill('Amina Updated');
 await dialog.getByRole('button',{name:'Save user',exact:true}).click();
 await dialog.waitFor({state:'detached'});
 await row.getByRole('button',{name:'Revoke access',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Revoke access',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'detached'});
 await row.getByText('0 — Revoked',{exact:true}).waitFor();
 await row.getByRole('button',{name:'Grant access',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Grant access',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'detached'});
 await row.getByRole('button',{name:'Reset password',exact:true}).click();
 dialog=page.getByRole('dialog');
 await dialog.getByLabel('New password',{exact:true}).fill('new-test-only-password');
 await dialog.getByLabel('Confirm password',{exact:true}).fill('new-test-only-password');
 await dialog.getByRole('button',{name:'Reset password',exact:true}).click();
 await dialog.waitFor({state:'detached'});
 await row.getByRole('button',{name:'Archive',exact:true}).click();
 dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:'Archive user',exact:true}).click();
 await dialog.waitFor({state:'detached'});
 await page.getByLabel('User status').selectOption('archived');
 await page.getByRole('button',{name:'Restore',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Restore user',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'detached'});
 await page.getByLabel('User status').selectOption('active');
 await row.getByText('Amina Updated',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Name',exact:true}).click();
 assert.equal(await page.locator('th[aria-sort="descending"]').count(),1);
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Add user',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'Add user'});
 const mobile=await dialog.boundingBox();assert.ok(mobile.width<=390);
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
 await page.setViewportSize({width:1280,height:800});
 await page.getByRole('button',{name:'Switch user',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'Switch user'});
 await dialog.getByLabel('Username',{exact:true}).fill('amina.print');
 await dialog.getByLabel('Password',{exact:true}).fill('wrong-password');
 await dialog.getByRole('button',{name:'Sign in user',exact:true}).click();
 await dialog.getByText('Username or password incorrect, or access is unavailable.',{exact:true}).waitFor();
 await dialog.getByLabel('Password',{exact:true}).fill('new-test-only-password');
 await dialog.getByRole('button',{name:'Sign in user',exact:true}).click();
 await dialog.waitFor({state:'detached'});
 await page.getByText('Current user: Amina Updated',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Users',exact:true}).count(),0,'Cashier cannot view Users');
 await page.reload();
 await page.getByText('Current user: Amina Updated',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Sign out user',exact:true}).click();
 await page.getByRole('heading',{name:'Staff sign in',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Business email',{exact:true}).count(),0,'Business remains signed in');
 await page.getByLabel('Username',{exact:true}).fill('manager');
 await page.getByLabel('Password',{exact:true}).fill('test-only-password');
 await page.getByRole('button',{name:'Sign in user',exact:true}).click();
 await page.getByRole('button',{name:'Users',exact:true}).waitFor();
 await page.getByRole('button',{name:'Sign out business',exact:true}).click();
 await page.getByLabel('Business email',{exact:true}).waitFor();
 console.log('Users UI checks passed (mocked API): create, edit, archive, restore, search, audit, sort, access revoke/grant, password reset, popup and mobile.');
}finally{await browser?.close();server.kill();}
