import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fixture } from '../tests/pricing-fixture.mjs';
import { readCopy } from './local-copy.mjs';
const base = 'http://127.0.0.1:4198';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4198', '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
        serviceWorkers: 'block',
      }),
      page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.setDefaultTimeout(15000);
    await page.goto(base);
    const { ledger, settings } = fixture();
    await page.evaluate(
      async ({ ledger, settings }) => {
        localStorage.setItem(
          'printshopledger:branding:v1:local-trial',
          JSON.stringify({ settings, version: 1 }),
        );
        const db = await new Promise((resolve, reject) => {
          const o = indexedDB.open('printshopledger-v1', 1);
          o.onupgradeneeded = () => o.result.createObjectStore('ledgers');
          o.onsuccess = () => resolve(o.result);
          o.onerror = () => reject(o.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction('ledgers', 'readwrite');
          tx.objectStore('ledgers').put({ ledger, pending: [] }, 'local-trial');
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      { ledger, settings },
    );
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    if (mobile) await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Pricing Templates', exact: true })
      .click();
    await page
      .getByRole('region', { name: 'Price and compare' })
      .getByRole('button', { name: 'Start checkout', exact: true })
      .click();
    const d = page.getByRole('dialog', { name: 'New checkout' });
    await d.getByLabel('Job discount', { exact: true }).selectOption('percent');
    await d.getByLabel('Job discount percentage', { exact: true }).fill('100');
    const warning = d.locator('.notice-warning').filter({ hasText: 'item discount limit exceeded' });
    await warning.waitFor();
    assert.match(await warning.innerText(), /Estimated expenses ₦22,100.00/);
    assert.match(await warning.innerText(), /Loss ₦22,100.00/);
    await d.getByLabel('Customer name or phone', { exact: true }).fill('Book');
    await d.getByRole('option', { name: /Book customer/ }).click();
    await d.getByLabel('Money received (₦)', { exact: true }).fill('0');
    await d.screenshot({ path: `/tmp/template-discount-${mobile ? 'mobile' : 'desktop'}.png` });
    await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    const state = await readCopy(page, 'local-trial');
    assert.equal(state.ledger.jobs[0].amount, 0);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Template discount override and cost warning: ${mobile ? 'mobile' : 'desktop'} passed`);
  }
} finally {
  await browser?.close();
  server.kill();
}
