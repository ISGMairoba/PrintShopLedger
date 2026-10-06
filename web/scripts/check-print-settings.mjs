import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], {stdio:'inherit'});
let browser;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch('http://127.0.0.1:4174')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1280,height:800}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4174');
  await page.getByRole('button',{name:'Try locally on this device'}).click();
  await page.getByRole('button',{name:'Print Settings',exact:true}).click();
  await page.getByRole('button',{name:'Edit settings',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Edit print settings'});
  await dialog.getByLabel('Paper size',{exact:true}).selectOption('Receipt 80mm');
  await dialog.getByLabel('Font size (pt)',{exact:true}).fill('12');
  await dialog.getByLabel('Left margin (mm)',{exact:true}).fill('3');
  await dialog.getByLabel('Bold',{exact:true}).check();
  await dialog.getByRole('button',{name:'Save settings'}).click();
  await assert.doesNotReject(()=>dialog.waitFor({state:'detached'}));
  await page.reload();
  await page.getByRole('button',{name:'Try locally on this device'}).click();
  await page.getByRole('button',{name:'Print Settings',exact:true}).click();
  assert.ok(await page.getByText('Receipt 80mm · 80 × 200 mm',{exact:true}).isVisible());
  assert.ok(await page.getByText('Arial · 12 pt · Bold',{exact:true}).isVisible());
  await page.setViewportSize({width:375,height:812});
  await page.getByRole('button',{name:'Edit settings',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Edit print settings'});
  const box=await dialog.boundingBox(); assert.ok(box.x>=0 && box.x+box.width<=376);
  await dialog.getByLabel('Automatically print after transactions that require printing').check();
  await dialog.getByRole('button',{name:'Save settings'}).click();
  assert.ok(await dialog.getByText('Select a printer before enabling automatic printing.').isVisible());
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'detached'});
  assert.deepEqual(errors,[]);
  console.log('Print settings browser checks passed: save, reload, mobile modal, automatic-print validation.');
} finally { await browser?.close(); server.kill(); }
