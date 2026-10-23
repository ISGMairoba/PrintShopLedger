// Services priced by quantity range or entered at each sale: set up on Services, charged at checkout.
import { readCopy } from './local-copy.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fixture } from '../tests/pricing-fixture.mjs';
import { pick } from './pick.mjs';
const port = 4198;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Price ranges check timed out');
  process.exit(1);
}, 180000).unref();
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({ headless: true });
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}`);
    const { ledger, settings } = fixture();
    delete ledger.pricing;
    settings.pricing = { enabled: false, templates: [] };
    await page.evaluate(
      async ({ ledger, settings }) => {
        localStorage.setItem(
          'printshopledger:branding:v1:local-trial',
          JSON.stringify({ settings, version: 1 }),
        );
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open('printshopledger-v1', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('ledgers');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction('ledgers', 'readwrite');
          const st = tx.objectStore('ledgers');
          st.delete(IDBKeyRange.bound('local-trial' + '|', 'local-trial' + '|￿'));
          st.put({ ledger, pending: [] }, 'local-trial');
          tx.oncomplete = resolve;
          tx.onerror = reject;
        });
        db.close();
      },
      { ledger, settings },
    );
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    const nav = async (name) => {
      if (mobile) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
      }
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
    };
    await nav('Services');
    // Binding: ₦100 each, ₦80 each from 26, ₦60 each from 101.
    await page.getByRole('button', { name: 'Add service', exact: true }).click();
    let d = page.getByRole('dialog');
    await d.getByLabel('Service description').fill('Binding');
    await d.getByLabel('How it is priced', { exact: true }).selectOption('ranges');
    await d.getByLabel('Price each for small orders (₦)').fill('100');
    for (const [i, from, price] of [
      [1, '26', '80'],
      [2, '101', '60'],
    ]) {
      await d.getByRole('button', { name: 'Add range', exact: true }).click();
      await d.getByLabel(`Range ${i} from quantity`).fill(from);
      await d.getByLabel(`Range ${i} price each`).fill(price);
    }
    await d.getByText('1–25: ₦100.00 each · 26–100: ₦80.00 each · 101+: ₦60.00 each').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await d.getByRole('button', { name: 'Save service', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    // Consultation: the price is typed at each sale.
    await page.getByRole('button', { name: 'Add service', exact: true }).click();
    d = page.getByRole('dialog');
    await d.getByLabel('Service description').fill('Consultation');
    await d.getByLabel('How it is priced', { exact: true }).selectOption('custom');
    await d.getByLabel('Suggested price (₦)').fill('5000');
    assert.equal(await d.getByLabel('Sold off the shelf').count(), 0);
    await d.getByRole('button', { name: 'Save service', exact: true }).click();
    await d.waitFor({ state: 'detached' });

    await nav('Point of Service');
    await page.getByRole('button', { name: 'Add job', exact: true }).click();
    d = page.getByRole('dialog', { name: 'New checkout' });
    let line = d.locator('.cart-line').first();
    await pick(line, 'Service', { text: 'Binding' });
    if (await line.getByLabel('Job description').count())
      await line.getByLabel('Job description').fill('Books');
    await line.getByLabel('Quantity', { exact: true }).fill('30');
    await line.getByText(/30 × ₦80\.00 \(range price/).waitFor();
    await d.getByRole('button', { name: 'Add another service', exact: true }).click();
    line = d.locator('.cart-line').nth(1);
    await pick(line, 'Service', { text: 'Consultation' });
    if (await line.getByLabel('Job description').count())
      await line.getByLabel('Job description').fill('Brand advice');
    const price = line.getByLabel('Price per item (₦)', { exact: true });
    assert.equal(await price.inputValue(), '5,000.00');
    await price.fill('12500');
    await price.blur();
    // 30 × ₦80 + ₦12,500 = ₦14,900.
    await d.locator('.cart-total').getByText('₦14,900.00').waitFor();
    await d.getByLabel('Customer name or phone', { exact: true }).fill('Book');
    await d.getByRole('option', { name: /Book customer/ }).click();
    await d.getByLabel('Money received (₦)', { exact: true }).fill('14900');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `/tmp/price-ranges-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    assert.match(await page.getByRole('dialog').innerText(), /30 × ₦80\.00 \(26–100 range price\)/);
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    const state = await readCopy(page, 'local-trial');
    const jobs = state.ledger.jobs;
    assert.deepEqual(
      jobs.map((j) => [j.service, j.unitPrice, j.amount]),
      [
        ['Binding', 8000, 240000],
        ['Consultation', 1250000, 1250000],
      ],
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Price ranges passed: ${mobile ? 'phone' : 'desktop'}`);
  }
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        console.error('Current dialogs:', await page.getByRole('dialog').allTextContents());
        await page.screenshot({ path: '/tmp/price-ranges-failure.png', fullPage: true }).catch(() => {});
      }
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
