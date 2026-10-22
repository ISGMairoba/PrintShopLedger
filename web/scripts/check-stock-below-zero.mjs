// "Stock below zero" set to block: checkout shows why and cannot be completed until the stock is
// updated; the setting is chosen under Business Settings → Jobs & payments.
import { readCopy } from './local-copy.mjs';
import { settingsSection } from './settings-navigation.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fixture } from '../tests/pricing-fixture.mjs';
import { pick } from './pick.mjs';
const port = 4197;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Stock below zero check timed out');
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
    settings.jobs = { ...settings.jobs, stockBelowZero: 'block' };
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
    await nav('Business Settings');
    await settingsSection(page, 'Jobs & payments');
    const rule = page.getByLabel('When a sale or job needs more than is in stock', { exact: true });
    assert.equal(await rule.inputValue(), 'block');

    // 120 art cards with 100 in stock: checkout explains and cannot be completed.
    await nav('Point of Service');
    await page.getByRole('button', { name: 'Add job', exact: true }).click();
    const d = page.getByRole('dialog', { name: 'New checkout' });
    const line = d.locator('.cart-line').first();
    await pick(line, 'Service', { text: 'Art card' });
    if (await line.getByLabel('Job description').count())
      await line.getByLabel('Job description').fill('Cards');
    await line.getByLabel('Quantity', { exact: true }).fill('120');
    await d.getByLabel('Customer name or phone', { exact: true }).fill('Book');
    await d.getByRole('option', { name: /Book customer/ }).click();
    await d
      .getByRole('alert')
      .filter({
        hasText:
          'Not enough Art card: 100 card in stock, this needs 120. Ask an admin to update the stock first.',
      })
      .waitFor();
    const complete = d.getByRole('button', { name: 'Complete checkout', exact: true });
    assert.equal(await complete.isDisabled(), true);
    // Within the stock, the sale goes through.
    await line.getByLabel('Quantity', { exact: true }).fill('100');
    await d.getByRole('alert').filter({ hasText: 'Not enough Art card' }).waitFor({ state: 'detached' });
    assert.equal(await complete.isDisabled(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await complete.click();
    await d.waitFor({ state: 'detached' });
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    const state = await readCopy(page, 'local-trial');
    assert.equal(state.ledger.materials.find((m) => m.name === 'Art card').available, 0);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Stock below zero passed: ${mobile ? 'phone' : 'desktop'}`);
  }
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        console.error('Current dialogs:', await page.getByRole('dialog').allTextContents());
        await page.screenshot({ path: '/tmp/stock-below-zero-failure.png', fullPage: true }).catch(() => {});
      }
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
