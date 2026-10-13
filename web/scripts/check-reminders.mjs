// Payment reminders: a customer who owes appears, Remind shares the statement and is recorded.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const port = 4183;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Reminders check timed out');
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

  await nav('Services');
  await page.getByRole('button', { name: 'Add service', exact: true }).click();
  let d = page.getByRole('dialog');
  await d.getByLabel('Service description').fill('Banner');
  await d.getByLabel('Price (₦)').fill('25000');
  await d.getByRole('button', { name: 'Save service', exact: true }).click();
  await d.waitFor({ state: 'detached' });

  // A sale with nothing paid: the customer owes ₦25,000.
  await nav('Point of Service');
  await page.getByRole('button', { name: 'Add job', exact: true }).click();
  d = page.getByRole('dialog', { name: 'New checkout' });
  await d.getByRole('button', { name: 'Add new customer', exact: true }).click();
  const cd = page.getByRole('dialog', { name: 'Add customer' });
  await cd.getByLabel('Full name').fill('Chika Eze');
  await cd.getByLabel('Phone number').fill('08031234567');
  await cd.getByRole('button', { name: 'Save customer', exact: true }).click();
  await cd.waitFor({ state: 'detached' });
  const line = d.locator('.cart-line').first();
  await line.getByLabel('Service', { exact: true }).selectOption({ index: 1 });
  await line.getByLabel('Job description').fill('Shop banner');
  await d.getByLabel('Money received (₦)').fill('0');
  await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();

  await nav('Payment Reminders');
  const table = page.getByRole('table', { name: 'Customers owing' });
  assert.match(await table.innerText(), /Chika Eze[\s\S]*₦25,000\.00[\s\S]*Not yet/);
  const downloaded = page.waitForEvent('download');
  await table.getByRole('button', { name: 'Remind', exact: true }).click();
  assert.match((await downloaded).suggestedFilename(), /^Statement - Chika Eze/);
  await page.waitForFunction(() => window.__opened.length > 0);
  assert.match(
    await page.evaluate(() => window.__opened[0]),
    /^https:\/\/wa\.me\/2348031234567\?text=Hello%20Chika%2C%20this%20is%20a%20friendly%20reminder/,
  );
  await page.getByText('Not yet').waitFor({ state: 'detached' });
  assert.match(await table.innerText(), /₦25,000\.00 owed then/);
  assert.deepEqual(errors, []);
  console.log('Reminders check passed');
} finally {
  await browser?.close();
  server.kill();
}
