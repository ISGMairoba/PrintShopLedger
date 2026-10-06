import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { webkit, devices } from 'playwright';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort'],{stdio:'inherit'});
let browser;
try {
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4173')).ok)break;}catch{}await delay(100);}
  browser=await webkit.launch({headless:true});
  const page=await browser.newPage({...devices['iPhone 13']});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  async function fits(label){
    const overflow=await page.evaluate(()=>{
      const viewport=document.documentElement.clientWidth;
      const nodes=[...document.querySelectorAll('main,.panel,.mobile-list,dialog[open],dialog[open] .modal-body,dialog[open] aside')];
      return {width:viewport,scroll:document.documentElement.scrollWidth,wide:nodes.filter(node=>{
        const rect=node.getBoundingClientRect();return rect.width>0&&(rect.left<-.5||rect.right>viewport+.5||node.scrollWidth>node.clientWidth+1);
      }).map(node=>({tag:node.tagName,class:node.className,width:node.clientWidth,scroll:node.scrollWidth}))};
    });
    if(overflow.wide.length) console.log('Overflow descendants',await page.evaluate(()=>[...document.querySelectorAll('dialog[open] *')].filter(node=>node.getBoundingClientRect().width>0&&node.getBoundingClientRect().right>document.documentElement.clientWidth+1).map(node=>({tag:node.tagName,class:node.className,width:node.getBoundingClientRect().width,scroll:node.scrollWidth,text:node.textContent?.slice(0,50)}))));
    assert.ok(overflow.scroll<=overflow.width+1&&overflow.wide.length===0,label+': '+JSON.stringify(overflow));
  }
  async function navigate(name){await page.evaluate(()=>window.scrollTo(0,0));await delay(250);await page.getByRole('button',{name:'Menu',exact:true}).click();await fits('Sidebar');await page.getByRole('button',{name,exact:true}).click();}
  await page.goto('http://127.0.0.1:4173');await fits('Business login');
  await page.getByRole('button',{name:'Try locally on this device'}).click();await fits('Empty jobs');
  await navigate('Materials');await page.getByRole('button',{name:'Add material',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Add material'});
  await dialog.getByLabel('Name',{exact:true}).fill('Paper'+ 'X'.repeat(150));
  await dialog.getByLabel('Measurement unit',{exact:true}).fill('SquareMetres'+ 'X'.repeat(20));
  assert.ok(Number.parseFloat(await dialog.getByLabel('Name',{exact:true}).evaluate(node=>getComputedStyle(node).fontSize))>=16,'Safari inputs avoid focus zoom');
  await fits('Material editor');await dialog.getByRole('button',{name:'Save material',exact:true}).click();await dialog.waitFor({state:'detached'});
  await page.getByRole('button',{name:'More',exact:true}).click();await fits('Action menu');
  await page.getByRole('dialog',{name:'More actions'}).getByRole('button',{name:'Add to stock',exact:true}).click();
  dialog=page.getByRole('dialog');await dialog.getByLabel('Quantity to add').fill('999999999999');await fits('Stock editor');await dialog.getByRole('button',{name:'Add to stock',exact:true}).click();await dialog.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Audit view',exact:true}).click();await fits('Materials audit');
  await navigate('Services');await page.getByRole('button',{name:'Add service',exact:true}).click();dialog=page.getByRole('dialog');
  await dialog.getByLabel('Service description').fill('Printing'+ 'X'.repeat(140));await dialog.getByLabel('Base material').selectOption({index:1});await dialog.getByLabel('Price (₦)').fill('999999999');await fits('Service editor');await dialog.getByRole('button',{name:'Save service',exact:true}).click();await dialog.waitFor({state:'detached'});await fits('Services');
  await navigate('Customers');await page.getByRole('button',{name:'Add customer',exact:true}).click();dialog=page.getByRole('dialog');
  await dialog.getByLabel('Full name').fill('Customer'+ 'X'.repeat(140));await dialog.getByLabel('Phone number').fill('08012345678');await dialog.getByLabel('Address').fill('Address'+ 'X'.repeat(300));await dialog.getByLabel('Credit limit (₦)').fill('999999999');await fits('Customer editor');await dialog.getByRole('button',{name:'Save customer',exact:true}).click();await dialog.waitFor({state:'detached'});await page.getByRole('button',{name:'Audit view',exact:true}).click();await fits('Customers audit');
  await navigate('Jobs');await page.getByRole('button',{name:'New job',exact:true}).click();dialog=page.getByRole('dialog',{name:'New checkout'});await dialog.waitFor();
  await dialog.getByRole('combobox',{name:'Customer name or phone'}).fill('Customer');await dialog.getByRole('option').first().click();await dialog.getByLabel('Service',{exact:true}).selectOption({index:1});await dialog.getByLabel('Job description').fill('Large job');await fits('Job editor');await dialog.getByRole('button',{name:'Complete checkout',exact:true}).click();await dialog.waitFor({state:'detached'});await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await fits('Jobs with large amounts');
  await navigate('Payments');await page.getByRole('button',{name:'Record payment',exact:true}).click();dialog=page.getByRole('dialog',{name:'Receive payment'});await dialog.waitFor();
  await dialog.getByRole('combobox',{name:'Customer name or phone'}).fill('Customer');await dialog.getByRole('option').first().click();await dialog.getByLabel('Money received (₦)').fill('100');await fits('Payment editor and date input');await dialog.getByRole('button',{name:'Complete checkout',exact:true}).click();await dialog.waitFor({state:'detached'});await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await fits('Payments');
  await navigate('Stock History');await fits('Stock History filters');
  const reset=page.getByRole('button',{name:'Reset filters',exact:true});
  for(const name of ['From','To']){
    const date=await page.getByLabel(name,{exact:true}).boundingBox(),button=await reset.boundingBox();
    assert.ok(button.y>=date.y+date.height,'Reset is below '+name+' date picker');
  }
  await page.getByLabel('From',{exact:true}).fill('2020-01-01');await reset.click();
  assert.equal(await page.getByLabel('From',{exact:true}).inputValue(),'');
  const bar=page.locator('.mobile-app-bar');
  assert.equal(await bar.evaluate(node=>getComputedStyle(node).position),'fixed','Menu bar is fixed');
  await page.evaluate(()=>window.scrollTo(0,Math.min(350,document.documentElement.scrollHeight-innerHeight)));
  await delay(300);
  assert.ok(await bar.evaluate(node=>node.classList.contains('mobile-app-bar-hidden')),'Scrolling down hides menu bar');
  await page.evaluate(()=>window.scrollBy(0,-50));await delay(300);
  assert.ok(await bar.evaluate(node=>!node.classList.contains('mobile-app-bar-hidden')),'Scrolling up reveals menu bar');
  assert.ok(Math.abs((await bar.boundingBox()).y)<1,'Revealed menu bar remains at screen top');
  await delay(2800);
  assert.ok(await bar.evaluate(node=>node.classList.contains('mobile-app-bar-hidden')),'Idle menu bar hides after timeout');
  await page.evaluate(()=>window.scrollBy(0,-30));await delay(300);
  await page.getByRole('button',{name:'Menu',exact:true}).click();await delay(2800);
  assert.ok(await page.getByRole('dialog',{name:'Navigation'}).isVisible(),'Navigation remains open beyond hide timeout');
  await page.getByRole('dialog',{name:'Navigation'}).getByRole('button',{name:'Menu',exact:true}).click();
  await page.evaluate(()=>window.scrollTo(0,0));await delay(300);
  await page.getByRole('button',{name:'Details',exact:true}).first().click();await fits('History details');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await navigate('Print Settings');await fits('Print Settings');await page.getByRole('button',{name:'Edit settings',exact:true}).click();await fits('Print settings editor');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.setViewportSize({width:844,height:390});await fits('iPhone 13 landscape');
  assert.deepEqual(errors,[]);console.log('iPhone 13 WebKit checks passed: long records, large amounts, sidebar, lists, audit, filters, date inputs, editors and landscape.');
} catch(error) {console.error(error);throw error;} finally {await browser?.close();server.kill();}

