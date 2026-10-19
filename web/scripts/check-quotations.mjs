// Quotations: create, edit, view and turn into an order through checkout (local trial).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { pick, pickedValue, pickOptions } from './pick.mjs';

const port = 4182;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
// Never hold up CI: a stuck browser step fails the check instead.
setTimeout(() => {
  console.error('Quotations check timed out');
  process.exit(1);
}, 240000).unref();
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A desktop test browser: no phone share sheet, and WhatsApp links are recorded, not opened.
  await page.addInitScript(() => {
    delete Navigator.prototype.share;
    delete Navigator.prototype.canShare;
    window.__opened = [];
    window.open = (url) => {
      window.__opened.push(String(url));
      return null;
    };
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByRole('button', { name: 'Try locally on this device' }).click();
  const menu = page.getByRole('navigation', { name: 'Main' });
  const nav = (name) => menu.getByRole('button', { name, exact: true }).click();

  // A service to quote for.
  await nav('Services');
  await page.getByRole('button', { name: 'Add service', exact: true }).click();
  let d = page.getByRole('dialog');
  await d.getByLabel('Service description').fill('Design');
  await d.getByLabel('Price (₦)').fill('10000');
  await d.getByRole('button', { name: 'Save service', exact: true }).click();
  await d.waitFor({ state: 'detached' });

  // New quotation for someone who is not a saved customer.
  await nav('Quotations');
  assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), 'Quotations');
  await page.getByRole('button', { name: 'New quotation', exact: true }).click();
  d = page.getByRole('dialog', { name: 'New quotation' });
  await d.getByLabel('Customer', { exact: true }).fill('Bello Stores');
  await d.getByLabel('Phone').fill('080333');
  await pick(d, 'Service', { label: 'Design — ₦10,000.00' });
  assert.equal(await d.getByLabel('Description').inputValue(), 'Design');
  await d.getByLabel('Quantity', { exact: true }).fill('2');
  assert.match(await d.locator('.cart-total').innerText(), /₦20,000\.00/);
  await d.getByRole('button', { name: 'Save quotation', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  assert.match(await page.locator('table').innerText(), /Bello Stores[\s\S]*₦20,000\.00[\s\S]*Open/);

  // Edit it directly.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  d = page.getByRole('dialog', { name: /Edit quotation Q-/ });
  await d.getByLabel('Quantity', { exact: true }).fill('3');
  await d.getByRole('button', { name: 'Save quotation', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  assert.match(await page.locator('table').innerText(), /₦30,000\.00/);

  // View, then download it.
  await page.getByRole('button', { name: 'View', exact: true }).click();
  d = page.getByRole('dialog', { name: /Quotation Q-/ });
  const waiting = page.waitForEvent('download');
  await d.getByRole('button', { name: 'Download PDF (A4)', exact: true }).click();
  assert.match((await waiting).suggestedFilename(), /^Quotation-Q-[0-9A-F]{8}\.pdf$/);

  // Share: without a phone share sheet, the PDF downloads and WhatsApp opens with the message.
  // A desktop browser has no share sheet; record the WhatsApp link instead of opening a window.
  const shared = page.waitForEvent('download');
  await d.getByRole('button', { name: 'Share', exact: true }).click();
  const sharedFile = await shared.catch(async (cause) => {
    console.error('Share did not download. Dialog says:', await d.innerText());
    console.error('Opened:', await page.evaluate(() => window.__opened));
    throw cause;
  });
  assert.match(sharedFile.suggestedFilename(), /^Quotation-Q-[0-9A-F]{8}\.pdf$/);
  await page.waitForFunction(() => window.__opened.length > 0);
  assert.match(await page.evaluate(() => window.__opened[0]), /^https:\/\/wa\.me\/\?text=Hello%20Bello/);

  // Create the order: checkout opens filled from the quote.
  await d.getByRole('button', { name: 'Create job', exact: true }).click();
  d = page.getByRole('dialog', { name: 'New checkout' });
  await d.getByText(/From quotation Q-/).waitFor();
  assert.equal(await d.locator('.cart-line').count(), 1);
  assert.equal(await d.getByLabel('Quantity', { exact: true }).inputValue(), '3');
  await d.getByRole('button', { name: 'Add new customer', exact: true }).click();
  const cd = page.getByRole('dialog', { name: 'Add customer' });
  await cd.getByLabel('Full name').fill('Bello Stores');
  await cd.getByLabel('Phone number').fill('080333');
  await cd.getByRole('button', { name: 'Save customer', exact: true }).click();
  await cd.waitFor({ state: 'detached' });
  await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Quotation status').selectOption('converted');
  assert.match(await page.locator('table').innerText(), /Bello Stores[\s\S]*Converted/);
  await nav('Jobs');
  assert.match(await page.locator('table').innerText(), /Design[\s\S]*Bello Stores/);
  assert.deepEqual(errors, []);
  console.log('Quotations check passed');
} finally {
  await browser?.close();
  server.kill();
}
