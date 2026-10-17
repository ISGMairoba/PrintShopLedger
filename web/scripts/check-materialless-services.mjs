import { readCopy } from './local-copy.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4179', '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4179')).ok) break;
    } catch {}
    await delay(100);
  }
  for (const mobile of [false, true]) {
    browser = await (mobile && !process.env.SERVICE_MOBILE_CHROMIUM ? webkit : chromium).launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_CHANNEL && (!mobile || process.env.SERVICE_MOBILE_CHROMIUM)
        ? { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL }
        : {}),
    });
    const page = await browser.newPage(
      mobile
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1440, height: 1000 } },
    );
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:4179');
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    const nav = async (name) => {
      if (mobile) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
      }
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
    };
    const state = () => readCopy(page, 'local-trial');
    await nav('Services');
    await page.getByRole('button', { name: 'Add service', exact: true }).click();
    let d = page.getByRole('dialog');
    assert.equal(await d.getByLabel('Base material').inputValue(), '');
    await d.getByLabel('Service description').fill('Cap pressing');
    await d.getByLabel('Price (₦)').fill('500');
    await d.getByRole('button', { name: 'Save service', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    assert.equal((await state()).services[0].materialId, null);
    assert.match(await page.locator('tbody').innerText(), /No material/);
    await nav('Materials');
    await page.getByRole('button', { name: 'Add material', exact: true }).click();
    d = page.getByRole('dialog');
    await d.getByLabel('Name', { exact: true }).fill('Paper');
    await d.getByLabel('Measurement unit', { exact: true }).fill('sheet');
    await d.getByRole('button', { name: 'Save material', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    await nav('Services');
    await page.getByRole('button', { name: 'Add service', exact: true }).click();
    d = page.getByRole('dialog');
    await d.getByLabel('Service description').fill('Printing');
    await d.getByLabel('Base material').selectOption({ index: 1 });
    await d.getByLabel('Price (₦)').fill('100');
    await d.getByRole('button', { name: 'Save service', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    const row = page.locator('tbody tr').filter({ hasText: 'Cap pressing' });
    for (const index of [1, 0]) {
      await row.getByRole('button', { name: 'Edit', exact: true }).click();
      d = page.getByRole('dialog');
      await d.getByLabel('Base material').selectOption({ index });
      await d.getByRole('button', { name: 'Save service', exact: true }).click();
      await d.waitFor({ state: 'detached' });
    }
    await page.getByLabel('Search services').fill('No material');
    assert.equal(await page.locator('tbody tr').count(), 1);
    await page.getByLabel('Search services').fill('');
    await nav('Point of Service');
    await page.getByRole('button', { name: 'Add job', exact: true }).click();
    d = page.getByRole('dialog', { name: 'New checkout' });
    const line = d.locator('.cart-line').first();
    await line.getByLabel('Service', { exact: true }).selectOption({ index: 1 });
    await line.getByLabel('Job description').fill('Customer caps');
    await line.getByLabel('Quantity', { exact: true }).fill('5');
    assert.match(await line.innerText(), /No stock deduction/);
    assert.equal(await line.getByLabel('Width', { exact: true }).count(), 0);
    await d.getByRole('button', { name: 'Add another service', exact: true }).click();
    const printing = d.locator('.cart-line').nth(1);
    await printing.getByLabel('Service', { exact: true }).selectOption({ index: 2 });
    await printing.getByLabel('Job description').fill('Customer caps');
    await printing.getByLabel('Quantity', { exact: true }).fill('2');
    await d.getByRole('button', { name: 'Add new customer', exact: true }).click();
    const cd = page.getByRole('dialog', { name: 'Add customer' });
    await cd.getByLabel('Full name').fill('Customer');
    await cd.getByLabel('Phone number').fill('080111');
    await cd.getByRole('button', { name: 'Save customer', exact: true }).click();
    await cd.waitFor({ state: 'detached' });
    assert.match(await d.locator('.cart-total').innerText(), /₦2,700.00/);
    assert.deepEqual((await d.locator('.allocation-service').allTextContents()).sort(), [
      'Cap pressing',
      'Printing',
    ]);
    assert.equal(await d.locator('.allocation-description').filter({ hasText: 'Customer caps' }).count(), 2);
    await d.getByRole('button', { name: 'Override allocation', exact: true }).click();
    assert.equal(await d.getByLabel(/Allocate to Cap pressing: Customer caps/).count(), 1);
    assert.equal(await d.getByLabel(/Allocate to Printing: Customer caps/).count(), 1);
    await d.getByLabel('Money received (₦)').fill('500');
    assert.ok(await d.evaluate((el) => el.scrollWidth <= el.clientWidth), 'Checkout fits screen');
    await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    const receipt = page.getByRole('dialog');
    assert.match(await receipt.innerText(), /Cap pressing/);
    await receipt.getByRole('button', { name: 'Close', exact: true }).click();
    let saved = await state();
    assert.equal(saved.jobs.length, 2);
    assert.equal(saved.materials[0].available, -2);
    assert.equal(saved.materialHistory.filter((h) => h.action === 'material.job_used').length, 1);
    assert.equal(saved.checkouts[0].total, 270000);
    assert.equal(saved.checkouts[0].outstandingAfter, 220000);
    assert.equal(saved.jobs.find((j) => j.service === 'Cap pressing').materialId, null);
    await page.reload();
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    saved = await state();
    assert.equal(saved.jobs.length, 2);
    assert.equal(saved.services.find((s) => s.description === 'Cap pressing').materialId, null);
    assert.deepEqual(errors, []);
    await browser.close();
    browser = null;
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'} materialless service setup, editing, mixed checkout, payments, stock and persistence passed.`,
    );
  }
} finally {
  await browser?.close();
  server.kill();
}
