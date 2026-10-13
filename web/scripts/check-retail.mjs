// Retail use: a product (stock item + shelf item) sold at the till is Collected at once and takes
// stock; the Words setting renames the screens. Runs against the local trial.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const port = 4181;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Retail check timed out');
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
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByRole('button', { name: 'Try locally on this device' }).click();
  const menu = page.getByRole('navigation', { name: 'Main' });
  const nav = (name) => menu.getByRole('button', { name, exact: true }).click();

  // A product in one step.
  await nav('Services');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  let d = page.getByRole('dialog', { name: 'Add product' });
  await d.getByLabel('Product name').fill('Blue pen');
  await d.getByLabel('Price (₦)').fill('500');
  await d.getByLabel('Opening stock').fill('10');
  await d.getByLabel('Minimum stock').fill('2');
  await d.getByRole('button', { name: 'Save product', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  assert.match(await page.locator('table').innerText(), /Blue pen[\s\S]*Shelf/);
  await nav('Materials');
  assert.match(await page.locator('table').innerText(), /Blue pen[\s\S]*10/);

  // Sell it: no deadline field, description filled in, Collected straight away.
  await nav('Point of Service');
  await page.getByRole('button', { name: 'Add job', exact: true }).click();
  d = page.getByRole('dialog', { name: 'New checkout' });
  await d.getByRole('button', { name: 'Add new customer', exact: true }).click();
  const cd = page.getByRole('dialog', { name: 'Add customer' });
  await cd.getByLabel('Full name').fill('Walk-in');
  await cd.getByLabel('Phone number').fill('080222');
  await cd.getByRole('button', { name: 'Save customer', exact: true }).click();
  await cd.waitFor({ state: 'detached' });
  const line = d.locator('.cart-line').first();
  await line.getByLabel('Service', { exact: true }).selectOption({ label: 'Blue pen — ₦500.00' });
  assert.equal(await line.getByLabel('Job description').inputValue(), 'Blue pen');
  assert.equal(await line.getByLabel('Deadline').count(), 0, 'Shelf items have no deadline');
  await line.getByLabel('Quantity', { exact: true }).fill('3');
  await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  const receipt = page.getByRole('dialog');
  await receipt.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Show collected and cancelled jobs').check();
  assert.match(await page.locator('table').first().innerText(), /Stage: Collected · Shelf/);
  await nav('Materials');
  assert.match(await page.locator('table').innerText(), /Blue pen[\s\S]*\b7\b/);

  // Quick sale: tap the product twice, take ₦2,000, give ₦1,000 change.
  await nav('Point of Service');
  await page.getByRole('button', { name: 'Quick sale', exact: true }).click();
  d = page.getByRole('dialog', { name: 'Quick sale' });
  const tile = d.getByRole('group', { name: 'Products' }).getByRole('button', { name: /Blue pen/ });
  await tile.click();
  await tile.click();
  assert.equal(await d.getByLabel('Quantity of Blue pen').inputValue(), '2');
  await d.getByLabel('Money received (₦)').fill('2000');
  assert.match(
    await d.locator('.cart-total').innerText(),
    /Total ₦1,000\.00[\s\S]*Change to give: ₦1,000\.00/,
  );
  await d.getByRole('button', { name: /Complete sale/ }).click();
  await d.waitFor({ state: 'detached' });
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await nav('Materials');
  assert.match(await page.locator('table').innerText(), /Blue pen[\s\S]*\b5\b/);
  await nav('Customers');
  assert.match(await page.locator('table').innerText(), /Walk-in customer/);

  // Retail words.
  await nav('Business Settings');
  await page.getByRole('tab', { name: 'Jobs & payments' }).click();
  await page.getByLabel('Words for').selectOption('retail');
  await page.getByRole('button', { name: 'Save words', exact: true }).click();
  await menu.getByRole('button', { name: 'Orders', exact: true }).waitFor();
  for (const name of ['Products', 'Stock items'])
    await menu.getByRole('button', { name, exact: true }).waitFor();
  await nav('Point of Service');
  await page.getByRole('button', { name: 'Add order', exact: true }).click();
  d = page.getByRole('dialog', { name: 'New checkout' });
  await d.getByRole('heading', { name: 'Orders in this checkout' }).waitFor();
  assert.match(await d.innerText(), /Order description/);
  assert.doesNotMatch(await d.innerText(), /\bjobs?\b/i, 'checkout says order, not job');
  await d.getByRole('button', { name: 'Close', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  await page.getByLabel('Show collected and cancelled orders').waitFor();
  await nav('Orders');
  assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), 'Orders');
  await page.getByRole('button', { name: 'New order', exact: true }).waitFor();
  assert.doesNotMatch(
    await page.locator('main').innerText(),
    /\bjobs?\b/i,
    'Orders page says order, not job',
  );
  await nav('Business Settings');
  await page.getByRole('tab', { name: 'Orders & payments' }).waitFor();
  await page.screenshot({ path: process.env.SHOT ?? '/tmp/retail-orders.png' });
  assert.deepEqual(errors, []);
  console.log('Retail check passed');
} finally {
  await browser?.close();
  server.kill();
}
