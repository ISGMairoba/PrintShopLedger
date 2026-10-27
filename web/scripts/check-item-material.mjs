import { readCopy } from './local-copy.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fixture } from '../tests/pricing-fixture.mjs';
const port = 4197;
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
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
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
          {
            const st = tx.objectStore('ledgers');
            st.delete(IDBKeyRange.bound('local-trial' + '|', 'local-trial' + '|\uffff'));
            st.put({ ledger, pending: [] }, 'local-trial');
          }
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
    await page.getByRole('button', { name: 'Add service', exact: true }).click();
    let d = page.getByRole('dialog', { name: 'Add service', exact: true });
    await d.locator('input[name="description"]').fill('Inline stock test');
    await d.locator('input[name="price"]').fill('250');
    await d.getByRole('combobox', { name: 'Base material', exact: true }).click();
    assert.deepEqual((await d.getByRole('option').allTextContents()).slice(0, 3), [
      'No material — service only',
      'A choice of materials…',
      'Create base material',
    ]);
    await d.getByRole('option', { name: 'Create base material', exact: true }).click();
    await d.getByLabel('Material opening stock', { exact: true }).fill('10');
    await d.getByLabel('Material minimum stock', { exact: true }).fill('2');
    await d.getByRole('button', { name: 'Save service', exact: true }).click();
    await d.waitFor({ state: 'hidden' });
    let state = await readCopy(page, 'local-trial');
    const service = state.ledger.services.find((s) => s.description === 'Inline stock test');
    assert.ok(service.materialId);
    const materialId = service.materialId;
    assert.equal(state.ledger.materials.find((m) => m.id === materialId).available, 10);
    const row = page.getByRole('row').filter({ hasText: 'Inline stock test' });
    if (mobile) await row.getByRole('button', { name: /More/ }).click();
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    d = page.getByRole('dialog', { name: 'Edit service', exact: true });
    await d.getByRole('button', { name: 'Edit base material', exact: true }).click();
    await d.getByLabel('Material name', { exact: true }).fill('Inline material updated');
    await d.getByLabel('Material stock change', { exact: true }).selectOption('add');
    await d.getByLabel('Material stock quantity', { exact: true }).fill('5');
    await d.getByLabel('Material stock reason', { exact: true }).fill('Restocking');
    await d.getByRole('button', { name: 'Save service', exact: true }).click();
    await d.waitFor({ state: 'hidden' });
    state = await readCopy(page, 'local-trial');
    const material = state.ledger.materials.find((m) => m.id === materialId);
    assert.equal(material.available, 15);
    assert.equal(material.name, 'Inline material updated');
    await page.reload();
    await page.getByRole('row').filter({ hasText: 'Inline stock test' }).waitFor();
    if (mobile) await row.getByRole('button', { name: /More/ }).click();
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    d = page.getByRole('dialog', { name: 'Edit service', exact: true });
    await d.getByRole('button', { name: 'Edit base material', exact: true }).click();
    await d.getByLabel('Material name', { exact: true }).fill('Must not save');
    await d.getByRole('button', { name: 'Cancel', exact: true }).click();
    state = await readCopy(page, 'local-trial');
    assert.equal(state.ledger.materials.find((m) => m.id === materialId).name, 'Inline material updated');
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: `/tmp/item-material-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    await context.close();
    console.log(`Item material passed: ${mobile ? 'phone, dark theme' : 'desktop, light theme'}`);
  }
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        console.error('Current dialogs:', await page.getByRole('dialog').allTextContents());
        await page.screenshot({ path: '/tmp/item-material-failure.png', fullPage: true }).catch(() => {});
      }
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
