import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fixture } from '../tests/pricing-fixture.mjs';
const port = 4191;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Product edit check timed out');
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
    settings.theme = mobile ? 'dark' : 'light';
    settings.primary = '#643248';
    settings.accent = '#c29a53';
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
          tx.objectStore('ledgers').put({ ledger, pending: [] }, 'local-trial');
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
    await nav('Point of Service');
    await page.getByRole('button', { name: 'Edit product', exact: true }).click();
    const d = page.getByRole('dialog', { name: 'Edit product' });
    await d.getByLabel('Search products', { exact: true }).fill('art');
    await d.getByRole('button', { name: /^Art card/ }).click();
    assert.equal(await d.getByLabel('Rename the stock item to the same name').isChecked(), true);
    await d.getByLabel('Name', { exact: true }).fill('Art card 300gsm');
    await d.getByLabel('Price', { exact: true }).fill('250');
    await d.getByLabel('Minimum stock', { exact: true }).fill('20');
    await d.getByLabel('Stock change', { exact: true }).selectOption('add');
    await d.getByLabel('Quantity to add', { exact: true }).fill('50');
    await d.getByLabel('Reason', { exact: true }).fill('Restocking');
    assert.match(
      await d.getByRole('status').filter({ hasText: 'This will' }).innerText(),
      /Rename[\s\S]*Change the price[\s\S]*Rename the stock item[\s\S]*Add 50 card to stock \(150 after\)/,
    );
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await d.screenshot({ path: `/tmp/product-edit-${mobile ? 'mobile' : 'desktop'}.png` });
    await d.getByRole('button', { name: 'Save changes', exact: true }).click();
    await d.getByText(/^Saved:/).waitFor();
    await d.getByRole('button', { name: 'Close', exact: true }).click();
    const state = await page.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const r = indexedDB.open('printshopledger-v1', 1);
        r.onsuccess = () => resolve(r.result);
      });
      const s = await new Promise((resolve) => {
        const r = db.transaction('ledgers').objectStore('ledgers').get('local-trial');
        r.onsuccess = () => resolve(r.result);
      });
      db.close();
      return s;
    });
    const service = state.ledger.services.find((s) => s.description === 'Art card 300gsm');
    const material = state.ledger.materials.find((m) => m.id === service.materialId);
    assert.equal(service.price, 25000);
    assert.equal(material.name, 'Art card 300gsm');
    assert.equal(material.available, 150);
    assert.equal(material.minimumStock, 20);
    // The Services page opens the same form for one item.
    await nav('Services');
    // On phones the extra row buttons sit under "More".
    if (mobile) await page.locator('.mobile-actions').first().getByRole('button', { name: /More/ }).click();
    await page.getByRole('button', { name: 'Price & stock', exact: true }).first().click();
    await page.getByRole('dialog', { name: 'Edit product' }).getByLabel('Name', { exact: true }).waitFor();
    await page
      .getByRole('dialog', { name: 'Edit product' })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Product edit passed: ${mobile ? 'phone, dark theme' : 'desktop, light theme'}`);
  }
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        console.error('Current dialogs:', await page.getByRole('dialog').allTextContents());
        await page.screenshot({ path: '/tmp/product-edit-failure.png', fullPage: true }).catch(() => {});
      }
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
