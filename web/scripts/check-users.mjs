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
 let downloads=0,uploads=0,failDownload=false;
 const serverLedger={customers:[],jobs:[],payments:[],materials:[],materialHistory:[],services:[],checkouts:[],drawerClosings:[]};
 let users=[{id:'33333333-3333-4333-8333-333333333333',userId:actor,name:'Test Manager',username:'manager',rank:3,accessLevel:3,role:'manager',archived:false,version:1,lastLogin:now,createdAt:now,modifiedAt:now,createdByLabel:'Test Manager',modifiedByLabel:'Test Manager'}];
 const makeToken=(id)=>[{alg:'HS256',typ:'JWT'},{sub:id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600},'c2lnbmF0dXJl'].map(part=>typeof part==='string'?part:Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
 const token=makeToken(actor),cashierId='55555555-5555-4555-8555-555555555555';
 const staff = { [actor]: {name:'Test Manager',username:'manager',role:'manager',rank:3}, [cashierId]: {name:'Amina Updated',username:'amina.print',role:'cashier',rank:1}, '66666666-6666-4666-8666-666666666666': {name:'Test Admin',username:'admin',role:'admin',rank:2}, '77777777-7777-4777-8777-777777777777': {name:'Test Developer',username:'developer',role:'developer',rank:4} };
 const authUser={id:actor,aud:'authenticated',role:'authenticated',email:'owner@example.invalid',user_metadata:{full_name:'Test Manager'},app_metadata:{provider:'email'},created_at:now};
 await context.route('https://*.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const body=route.request().method()==='POST'?route.request().postDataJSON():{};
  let result;
  if(path==='/auth/v1/token')result={access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'mock-refresh',user:authUser};
  else if(path==='/auth/v1/user'){const bearer=route.request().headers().authorization?.slice(7);const id=bearer?JSON.parse(Buffer.from(bearer.split('.')[1],'base64url').toString()).sub:actor;result={...authUser,id,user_metadata:{full_name:staff[id].name}};}
  else if(path==='/auth/v1/logout')result={};
  else if(path.endsWith('/list_business_shops'))result=[{id:shop,name:'Test business'}];
  else if(path.endsWith('/list_my_shops')){const bearer=route.request().headers().authorization?.slice(7);const id=bearer?JSON.parse(Buffer.from(bearer.split('.')[1],'base64url').toString()).sub:actor;result=[{id:shop,name:'Test business',role:staff[id].role,rank:staff[id].rank,accessLevel:staff[id].rank,userId:id,username:staff[id].username,staffName:staff[id].name}];}
  else if(path.endsWith('/staff-login')){
   if(body.password==='wrong-password'){await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Username or password incorrect, or access is unavailable.'})});return;}
   const target=Object.keys(staff).find(id=>staff[id].username===body.username);assert.ok(target);result={access_token:makeToken(target),refresh_token:target===actor?'manager-refresh':'cashier-refresh'};
  }
  else if(path.endsWith('/close-drawer')){
   const bearer=route.request().headers().authorization.slice(7),id=JSON.parse(Buffer.from(bearer.split('.')[1],'base64url').toString()).sub;
   if(body.currentPassword!=='test-only-password'||body.nextPassword!=='new-test-only-password'){
    await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Check both users’ credentials.'})});return;
   }
   assert.equal(id,actor);assert.equal(body.nextUsername,'amina.print');
   const own=serverLedger.checkouts.filter(r=>r.createdBy===actor&&!r.drawerClosingId);
   assert.deepEqual([...body.checkoutIds].sort(),own.map(r=>r.id).sort());assert.equal(body.countedCash,7500);
   const closing={id:body.id,fromUserId:actor,fromUserLabel:'Test Manager',toUserId:cashierId,toUserLabel:'Amina Updated',closedAt:new Date().toISOString(),checkoutIds:body.checkoutIds,openingId:null,openingCash:0,cashCollected:8000,totalCollected:11000,posCollected:3000,transferCollected:0,walletUsed:0,jobSales:16000,expectedCash:8000,countedCash:7500,difference:-500,note:body.note};
   serverLedger.drawerClosings.push(closing);own.forEach(r=>r.drawerClosingId=closing.id);
   result={closing,access_token:makeToken(cashierId),refresh_token:'handover-refresh'};
  }
  else if(path.endsWith('/business_settings'))result=[];
  else if(path.endsWith('/get_ledger')){
   downloads++;
   if(failDownload){failDownload=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Temporary test outage'})});return;}
   result=serverLedger;
  }
  else if(path.endsWith('/apply_customer_event')){
   uploads++;const e=body.p_event,c=e.data;
   assert.equal(e.kind,'customer.created');
   if(!serverLedger.customers.some(item=>item.id===c.id))serverLedger.customers.push({...c,archived:false,version:1,createdBy:actor,createdByLabel:'Test Manager',modifiedByLabel:'Test Manager',lastEventId:e.id});
   result=null;
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
 await page.locator('.sync-status').getByText('Saved',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Sync workspace',exact:true}).count(),0,'Manual sync button removed');
 assert.ok(downloads>0,'Workspace syncs on opening');
 async function sidebarScrollCheck() {
  const before=await page.evaluate(()=>{
   const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,width:r.width};};
   const menu=document.querySelector('.sidebar-menu');menu.scrollTop=0;
   return {header:rect('.sidebar-header'),footer:rect('.sidebar-bottom'),sidebar:rect('.app-sidebar'),mainScroll:window.scrollY,overflow:menu.scrollHeight>menu.clientHeight};
  });
  assert.ok(before.overflow,'Long navigation scrolls within available space');
  const after=await page.evaluate(()=>{
   document.querySelector('.sidebar-menu').scrollTop=200;
   const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,width:r.width};};
   return {header:rect('.sidebar-header'),footer:rect('.sidebar-bottom'),mainScroll:window.scrollY,menuScroll:document.querySelector('.sidebar-menu').scrollTop};
  });
  assert.ok(after.menuScroll>0);assert.deepEqual(after.header,before.header);assert.deepEqual(after.footer,before.footer);assert.equal(after.mainScroll,before.mainScroll);
  assert.ok(before.footer.bottom<=await page.evaluate(()=>innerHeight),'Account controls remain inside viewport');
  return before.sidebar;
 }
 assert.equal(await page.locator('.app-sidebar select').count(),0,'Sidebar has no business selector');assert.equal(await page.locator('.sidebar-header .brand-title').innerText(),'Test business');assert.equal(await page.locator('.sidebar-header').getByText('PrintShopLedger',{exact:true}).count(),0);
 await page.locator('.sidebar-user').getByText('Test Manager (manager)',{exact:true}).waitFor();
 assert.equal((await page.locator('.sidebar-user .staff-rank').innerText()).toLowerCase(),'manager');assert.equal(await page.locator('.sidebar-user').getByText(/Rank:|Access:/).count(),0);assert.match(await page.locator('.sidebar-header .connection').innerText(),/Online.*pending changes/);assert.equal(await page.locator('.sidebar-bottom .connection').count(),0);
 assert.equal(await page.getByRole('button',{name:'Sign out business',exact:true}).count(),1);
 await page.setViewportSize({width:1280,height:600});
 const wide=await sidebarScrollCheck();assert.equal(wide.left,0);await page.waitForFunction(()=>document.querySelector('.sidebar-menu')?.classList.contains('is-scrolling'));await page.waitForFunction(()=>!document.querySelector('.sidebar-menu')?.classList.contains('is-scrolling'));assert.ok(await page.locator('.sidebar-bottom button').first().evaluate(el=>el.getBoundingClientRect().height)<=40,'Footer buttons are compact');
 await page.setViewportSize({width:1060,height:600});
 await page.waitForFunction(()=>innerWidth===1060);
 assert.equal((await sidebarScrollCheck()).width,wide.width,'Desktop sidebar width stays fixed');
 await page.evaluate(()=>window.scrollTo(0,100));
 assert.equal(await page.locator('.app-sidebar').evaluate(el=>el.getBoundingClientRect().top),0,'Sidebar stays fixed while main scrolls');
 await page.setViewportSize({width:390,height:600});
 await page.locator('.mobile-app-bar').waitFor();
 assert.equal(await page.locator('.app-sidebar').count(),0,'Mobile sidebar starts hidden');
 await page.getByRole('button',{name:'Menu',exact:true}).click();
 await page.getByRole('dialog',{name:'Navigation'}).waitFor();
 await sidebarScrollCheck();
 await page.getByRole('button',{name:'Customers',exact:true}).click();
 assert.equal(await page.locator('.app-sidebar').count(),0,'Selecting a page closes mobile navigation');
 await page.setViewportSize({width:1280,height:800});

 await context.setOffline(true);
 await page.getByRole('button',{name:'Customers',exact:true}).click();
 await page.getByRole('button',{name:'Add customer',exact:true}).click();
 const customerDialog=page.getByRole('dialog',{name:'Add customer'});
 await customerDialog.getByLabel('Full name').fill('Offline sync customer');
 await customerDialog.getByLabel('Phone number').fill('08012345678');
 await customerDialog.getByRole('button',{name:'Save customer',exact:true}).click();
 await customerDialog.waitFor({state:'detached'});
 await page.locator('.sync-status').getByText('Waiting for connection',{exact:false}).waitFor();
 assert.equal(uploads,0,'Offline customer stays local');
 failDownload=true;
 await context.setOffline(false);
 await page.locator('.sync-status').getByText('Waiting to retry',{exact:false}).waitFor();
 await page.locator('.sync-status').getByText('Saved',{exact:false}).waitFor();
 assert.equal(serverLedger.customers.length,1,'Reconnect sends offline work');
 assert.equal(uploads,1,'Retry does not duplicate uploaded event');
 await page.getByRole('button',{name:'Add customer',exact:true}).click();
 await customerDialog.getByLabel('Full name').fill('Online sync customer');
 await customerDialog.getByLabel('Phone number').fill('08099999');
 await customerDialog.getByRole('button',{name:'Save customer',exact:true}).click();
 await customerDialog.waitFor({state:'detached'});
 await page.locator('.sync-status').getByText('Saved',{exact:false}).waitFor();
 assert.equal(serverLedger.customers.length,2,'Online save syncs automatically');
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
 await page.locator('.mobile-list').waitFor();
 assert.equal(await page.locator('.mobile-list thead th').count(),3);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Users fits mobile screen');
 assert.match(await row.innerText(),/Created by:/,'Audit data remains visible beneath user');
 await row.getByRole('button',{name:'More',exact:true}).click();
 await page.getByRole('dialog',{name:'More actions'}).getByRole('button',{name:'Reset password',exact:true}).click();
 await page.getByRole('dialog',{name:'Reset password: Amina Updated'}).waitFor();
 await page.keyboard.press('Escape');
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
 await page.locator('.sidebar-user').getByText('Amina Updated (amina.print)',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Sign out business',exact:true}).count(),0,'Cashier cannot sign out business');
 assert.equal(await page.getByRole('button',{name:'Users',exact:true}).count(),0,'Cashier cannot view Users');
 await page.reload();
 await page.locator('.sidebar-user').getByText('Amina Updated (amina.print)',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Sign out business',exact:true}).count(),0,'Cashier cannot sign out business');
 await page.getByRole('button',{name:'Logout',exact:true}).click();
 await page.getByRole('heading',{name:'Staff sign in',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Business email',{exact:true}).count(),0,'Business remains signed in');
 assert.equal(await page.getByRole('button',{name:'Sign out business',exact:true}).count(),0,'Business sign out requires an active manager');
 await page.getByLabel('Username',{exact:true}).fill('manager');
 await page.getByLabel('Password',{exact:true}).fill('test-only-password');
 await page.getByRole('button',{name:'Sign in user',exact:true}).click();
 await page.getByRole('button',{name:'Users',exact:true}).waitFor();

 for (const username of ['admin','developer','manager']) {
  await page.getByRole('button',{name:'Switch user',exact:true}).click();
  const switchDialog=page.getByRole('dialog',{name:'Switch user'});
  await switchDialog.getByLabel('Username',{exact:true}).fill(username);
  await switchDialog.getByLabel('Password',{exact:true}).fill('test-only-password');
  await switchDialog.getByRole('button',{name:'Sign in user',exact:true}).click();
  await switchDialog.waitFor({state:'detached'});
  await page.locator('.sidebar-user strong').filter({hasText:'('+username+')'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Sign out business',exact:true}).count(),username==='admin'?0:1,username+' business sign out permission');
  assert.equal(await page.getByRole('button',{name:'Logout',exact:true}).count(),1);
 }
 // My Sales uses receipt records, not jobs/payment rows, and always isolates the current user.
 const receipt=(id,creator,method,cash,total,createdAt,description)=>({id,createdBy:creator,createdByLabel:staff[creator].name,customerId:serverLedger.customers[0].id,customerSnapshot:{id:serverLedger.customers[0].id,name:'Offline sync customer',phone:'08012345678',address:''},jobs:[{id:'job-'+id,description}],jobBalances:[],cashReceived:cash,total,walletUsed:0,walletAdded:0,walletAfter:0,outstandingAfter:total-cash,method,paidOn:createdAt.slice(0,10),createdAt,reference:''});
 serverLedger.checkouts.push(receipt('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor,'Cash',7000,10000,now,'Manager print'),receipt('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',actor,'POS',3000,5000,now,'Manager copy'),receipt('cccccccc-cccc-4ccc-8ccc-cccccccccccc',actor,'Cash',1000,1000,new Date(Date.now()-86400000).toISOString(),'Overnight job'),receipt('dddddddd-dddd-4ddd-8ddd-dddddddddddd',cashierId,'Cash',5000,5000,now,'Cashier only'));
 await page.reload();await page.locator('.sync-status').getByText('Saved',{exact:false}).waitFor();
 await page.getByRole('button',{name:'My Sales',exact:true}).click();
 await page.locator('tbody tr').filter({hasText:'Manager print'}).waitFor();
 assert.equal(await page.locator('tbody tr').count(),2,'Today only shows this user’s receipts');
 assert.equal(await page.getByText('Cashier only',{exact:true}).count(),0);
 assert.match(await page.locator('.stats article').first().innerText(),/70\.00/,'Cash summary uses amount received, not 100 due');
 await page.locator('tbody tr').filter({hasText:'Manager print'}).getByRole('button',{name:'Receipt',exact:true}).click();
 await page.getByRole('dialog',{name:'Receipt AAAAAAAA'}).getByRole('button',{name:'Print receipt',exact:true}).waitFor();
 await page.keyboard.press('Escape');
 await page.getByLabel('Search my sales').fill('POS');assert.equal(await page.locator('tbody tr').count(),1);
 await page.getByLabel('Search my sales').fill('');
 await page.getByRole('button',{name:'All dates',exact:true}).click();assert.equal(await page.locator('tbody tr').count(),3,'Overnight unclosed receipts remain accessible');
 await page.getByRole('button',{name:'Date',exact:true}).click();assert.equal(await page.locator('th[aria-sort="ascending"]').count(),1);
 await page.getByRole('button',{name:'Money received',exact:true}).click();assert.equal(await page.locator('th[aria-sort="ascending"]').count(),1);
 await context.setOffline(true);await page.locator('.sync-status').getByText('Waiting for connection',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Close drawer',exact:true}).isDisabled(),true);
 assert.equal(await page.locator('tbody tr').count(),3);await context.setOffline(false);
 await page.locator('.sync-status').getByText('Saved',{exact:false}).waitFor();
 await page.setViewportSize({width:390,height:844});
 await page.locator('.mobile-list').waitFor();
 assert.equal(await page.locator('.mobile-list thead th').count(),3);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.getByRole('button',{name:'Close drawer',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'Close drawer'});assert.ok((await dialog.boundingBox()).width<=390);
 await dialog.getByLabel('Current user password',{exact:true}).fill('wrong-password');
 await dialog.getByLabel('Receiving username',{exact:true}).fill('amina.print');
 await dialog.getByLabel('Receiving user password',{exact:true}).fill('new-test-only-password');
 await dialog.getByLabel('Cash counted / handed over (₦)',{exact:true}).fill('75');
 await dialog.getByLabel('Handover note').fill('Cash shortage');
 await dialog.getByRole('checkbox').check();
 await dialog.getByRole('button',{name:'Close drawer and switch user',exact:true}).click();
 await dialog.getByRole('alert').getByText('Check both users’ credentials.',{exact:true}).waitFor();
 assert.equal(serverLedger.drawerClosings.length,0,'Wrong password cannot close transactions');
 await dialog.getByLabel('Current user password',{exact:true}).fill('test-only-password');
 await dialog.getByRole('button',{name:'Close drawer and switch user',exact:true}).click();
 await dialog.waitFor({state:'detached'});
 await page.setViewportSize({width:1280,height:800});
 await page.locator('.sidebar-user').getByText('Amina Updated (amina.print)',{exact:true}).waitFor();
 await page.locator('tbody tr').filter({hasText:'Cashier only'}).waitFor();
 assert.equal(await page.getByText('Manager print',{exact:true}).count(),0);
 assert.equal(serverLedger.drawerClosings.length,1);
 const outgoingCache=await page.evaluate(scope=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('printshopledger-v1',1);request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,tx=db.transaction('ledgers'),read=tx.objectStore('ledgers').get(scope);read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error);tx.oncomplete=()=>db.close();};
 }),`${actor}:${shop}`);
 assert.equal(outgoingCache.ledger.drawerClosings.length,1,'Outgoing drawer closing is available offline before switching back');
 assert.equal(outgoingCache.ledger.checkouts.filter(r=>r.createdBy===actor&&!r.drawerClosingId).length,0,'Cached receipts retain their closed status');
 assert.equal(serverLedger.checkouts.filter(r=>r.createdBy===actor&&r.drawerClosingId).length,3);
 assert.equal(serverLedger.checkouts.find(r=>r.createdBy===cashierId).drawerClosingId,undefined);
 await page.getByRole('button',{name:'Drawer history',exact:true}).click();
 await page.getByRole('button',{name:'Details',exact:true}).click();
 dialog=page.getByRole('dialog');assert.match(await dialog.innerText(),/cash shortage|Cash shortage/);assert.match(await dialog.innerText(),/75\.00/);await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Close drawer',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'Close drawer'});assert.match(await dialog.locator('.checkout-summary').innerText(),/Opening cash.*75\.00/s,'Receiver gets counted opening cash');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Switch user',exact:true}).click();dialog=page.getByRole('dialog',{name:'Switch user'});
 await dialog.getByLabel('Username',{exact:true}).fill('manager');await dialog.getByLabel('Password',{exact:true}).fill('test-only-password');await dialog.getByRole('button',{name:'Sign in user',exact:true}).click();await dialog.waitFor({state:'detached'});
 await page.locator('.sidebar-user').getByText('Test Manager (manager)',{exact:true}).waitFor();
 await page.getByRole('button',{name:'My Sales',exact:true}).click();
 await page.getByLabel('My sales status').selectOption('closed');await page.getByRole('button',{name:'All dates',exact:true}).click();
 await page.locator('tbody tr').filter({hasText:'Manager print'}).waitFor();assert.equal(await page.locator('tbody tr').count(),3,'Closed receipts remain viewable');
 await page.getByRole('button',{name:'Sign out business',exact:true}).click();
 await page.getByLabel('Business email',{exact:true}).waitFor();
 console.log('My Sales / handover and Users UI checks passed (mocked API): create, edit, archive, restore, search, audit, sort, access revoke/grant, password reset, popup and mobile.');
}finally{await browser?.close();server.kill();}

