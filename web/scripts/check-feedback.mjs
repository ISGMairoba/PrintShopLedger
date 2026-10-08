import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,webkit} from 'playwright';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4188','--strictPort'],{stdio:'inherit'});
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4188')).ok)break;}catch{}await delay(100);}
 for(const engine of [chromium,webkit]){
 const browser=await engine.launch();try{for(const mobile of [false,true]){
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1280,height:900},serviceWorkers:'block',reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/auth/v1/token*',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'invalid_grant',error_description:'Invalid login credentials'})}));
 await page.goto('http://127.0.0.1:4188');await page.getByLabel('Business email').fill('invalid@example.com');await page.getByLabel('Business password').fill('incorrect-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 const alert=page.getByRole('alert');await alert.waitFor();assert.match(await alert.innerText(),/Sign-in failed/);assert.equal(await page.getByLabel('Business password').getAttribute('aria-invalid'),'true');assert.equal(await alert.evaluate(el=>document.activeElement===el),true);
 const failure=page.getByRole('group',{name:'Action failed notification'});await failure.waitFor();assert.equal(await failure.evaluate(el=>getComputedStyle(el).animationName),'none');await failure.getByRole('button',{name:'Dismiss action failed notification'}).click();assert.equal(await page.getByRole('alert').count(),1,'Persistent error remains after popup dismissal');
 await page.getByRole('button',{name:'Try locally on this device'}).click();
 const nav=async name=>{if(mobile){await page.evaluate(()=>scrollTo(0,0));await page.getByRole('button',{name:'Menu',exact:true}).click();}await page.getByRole('navigation',{name:'Main'}).getByRole('button',{name,exact:true}).click();};
 await nav('Business Settings');await page.getByLabel('Address',{exact:true}).fill('Kano');await page.getByRole('button',{name:'Save business details',exact:true}).click();const success=page.getByRole('group',{name:'Success notification'});await success.waitFor();assert.match(await success.innerText(),/Business details saved/);await success.getByRole('button',{name:'Dismiss success notification'}).click();
 await page.getByLabel('Business default theme').selectOption('dark');await page.getByRole('button',{name:'Save appearance',exact:true}).click();await page.getByRole('group',{name:'Success notification'}).getByRole('button',{name:'Dismiss success notification'}).click();
 await nav('Print Settings');await page.getByRole('button',{name:'Edit settings',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Automatically print after transactions that require printing').check();await dialog.getByRole('button',{name:'Save settings',exact:true}).click();const error=page.getByRole('group',{name:'Action failed notification'});await error.waitFor();
 assert.equal(await error.evaluate(el=>{const button=el.querySelector('button'),r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'Error popup is visible above native dialog');
 assert.equal(await error.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(62, 32, 35)','Dark error remains red');assert.ok(await dialog.locator('.notice-error').count());assert.equal(await error.evaluate(el=>getComputedStyle(el.querySelector('p')).color),'rgb(255, 229, 229)');
 await error.getByRole('button',{name:'Dismiss action failed notification'}).click();assert.ok(await dialog.getByRole('alert').isVisible());await dialog.getByLabel('Automatically print after transactions that require printing').uncheck();await dialog.getByRole('button',{name:'Save settings',exact:true}).click();await dialog.waitFor({state:'detached'});await page.getByRole('group',{name:'Success notification'}).waitFor();assert.ok(await page.getByRole('heading',{name:'Print Settings',exact:true}).isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}}
 console.log('Feedback passed Chromium/WebKit desktop/mobile: login error focus, invalid fields, dismissal, save confirmation, top-layer visibility, dark error colour, readable text and reduced motion.');
}finally{server.kill();}
