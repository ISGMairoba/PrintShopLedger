import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort'],{stdio:'inherit'});
let browser;
try {
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
    try { if((await fetch('http://127.0.0.1:4173')).ok){ready=true;break;} } catch {}
    await delay(100);
  }
  assert.ok(ready,'Preview server starts');
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto('http://127.0.0.1:4173');
  await page.getByRole('button',{name:'Try locally on this device'}).click();
  await page.getByRole('button',{name:'Materials',exact:true}).click();
  const add=page.getByRole('button',{name:'+ Add material',exact:true});
  await add.click();
  let dialog=page.getByRole('dialog',{name:'Add material',exact:true});
  await dialog.waitFor();
  const box=await dialog.boundingBox();
  assert.ok(Math.abs(box.x+box.width/2-640)<3,'Modal centred horizontally');
  assert.ok(Math.abs(box.y+box.height/2-400)<3,'Modal centred vertically');
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
  await assert.rejects(page.getByRole('button',{name:'Services',exact:true,includeHidden:true}).click({timeout:400}),'Background interaction is blocked');
  for(let i=0;i<10;i++){
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(()=>document.activeElement?.closest('dialog')!==null),'Keyboard stays in modal');
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  assert.equal(await add.evaluate(element=>document.activeElement===element),true,'Focus returns to opening button');
  await add.click();
  await dialog.getByLabel('Name',{exact:true}).fill('Modal test paper');
  await dialog.getByLabel('Measurement unit',{exact:true}).fill('sheet');
  await dialog.getByRole('button',{name:'Save material',exact:true}).click();
  await dialog.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Add to stock',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Add to stock: Modal test paper'});
  await dialog.getByLabel('Quantity to add').fill('25');
  await dialog.getByRole('button',{name:'Add to stock',exact:true}).click();
  await dialog.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByRole('dialog',{name:'Edit material'}).getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Archive',exact:true}).click();
  await page.getByRole('dialog',{name:'Archive Modal test paper?'}).getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Services',exact:true}).click();
  await page.getByRole('button',{name:'+ Add service',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Add service'});
  await dialog.getByLabel('Service description').fill('Modal test printing');
  await dialog.getByLabel('Base material').selectOption({index:1});
  await dialog.getByLabel('Price (₦)').fill('200');
  await dialog.getByRole('button',{name:'Save service',exact:true}).click();
  await dialog.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByRole('dialog',{name:'Edit service'}).getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Customers',exact:true}).click();
  await page.getByRole('button',{name:'+ Add customer',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Add customer'});
  await dialog.getByLabel('Customer name').fill('Modal test customer');
  await dialog.getByRole('button',{name:'Save record',exact:true}).click();
  await dialog.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Jobs',exact:true}).click();
  await page.getByRole('button',{name:'+ New job',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Create a job'});
  await dialog.getByLabel('Customer',{exact:true}).selectOption({index:1});
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Payments',exact:true}).click();
  await page.getByRole('button',{name:'+ Record payment',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Record a payment'});
  await dialog.getByLabel('Customer',{exact:true}).selectOption({index:1});
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Stock History',exact:true}).click();
  await page.getByRole('button',{name:'Details',exact:true}).first().click();
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.setViewportSize({width:375,height:667});
  await page.getByRole('button',{name:'Materials',exact:true}).click();
  await add.click();
  dialog=page.getByRole('dialog',{name:'Add material',exact:true});
  const mobileBox=await dialog.boundingBox();
  assert.ok(mobileBox.x>=0&&mobileBox.width<=375&&mobileBox.y>=0&&mobileBox.height<=667,'Modal fits small screen');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  console.log('Modal browser checks passed: centred placement, blocked background, keyboard focus, Escape, focus restoration, save/close, all editors, and mobile layout.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
