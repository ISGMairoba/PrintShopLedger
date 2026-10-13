import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fixture } from '../tests/pricing-fixture.mjs';
const port = 4189;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Pricing template UI check timed out');
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
    await nav('Business Settings');
    await page.getByRole('tab', { name: 'Pricing templates', exact: true }).click();
    await page.getByLabel('Enable pricing templates').check();
    await page.getByRole('button', { name: 'Start with book', exact: true }).click();
    let d = page.getByRole('dialog', { name: 'New pricing template' });
    const picks = d.getByLabel('Item or service', { exact: true });
    assert.equal(await picks.count(), 4);

    for (const [index, label] of [
      'Art cards — ₦200.00',
      'DI printing — ₦500.00',
      'Paper Printing — ₦100.00',
      'Binding — ₦300.00',
    ].entries())
      await picks.nth(index).selectOption({ label });
    await d.getByLabel('Default', { exact: true }).nth(2).fill('2');
    await d.getByLabel('Preview quantity', { exact: true }).fill('10');
    await d.getByLabel('Pages per book', { exact: true }).fill('41');
    assert.match(await d.locator('.cart-total').innerText(), /₦17,500\.00/);
    await d.getByRole('button', { name: 'Use template', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Save pricing templates', exact: true }).click();
    assert.match(await page.locator('.template-list').innerText(), /Book[\s\S]*4 components/);
    await nav('Quotations');
    await page.getByRole('button', { name: 'New quotation', exact: true }).click();
    d = page.getByRole('dialog', { name: 'New quotation' });
    await d.getByLabel('Customer', { exact: true }).fill('Book customer');
    await d.getByLabel('Service', { exact: true }).selectOption({ label: 'Book — Template' });
    await d.getByLabel('Quantity', { exact: true }).fill('10');
    await d.getByLabel('Pages per book', { exact: true }).fill('41');
    assert.match(await d.locator('.cart-total').innerText(), /₦17,500\.00/);
    await d.getByRole('button', { name: 'Save quotation', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    const readState = () =>
      page.evaluate(async () => {
        const db = await new Promise((resolve) => {
          const r = indexedDB.open('printshopledger-v1', 1);
          r.onsuccess = () => resolve(r.result);
        });
        const state = await new Promise((resolve) => {
          const r = db.transaction('ledgers').objectStore('ledgers').get('local-trial');
          r.onsuccess = () => resolve(r.result);
        });
        db.close();
        return state;
      });
    let state = await readState();
    assert.equal(state.ledger.jobs.length, 0);
    assert.deepEqual(
      state.ledger.materials.map((m) => m.available),
      [100, 200],
    );
    assert.equal(state.ledger.quotations[0].lines[0].templateSnapshot.components.length, 4);
    await nav('Point of Service');
    await page.getByRole('button', { name: 'Add job', exact: true }).click();
    d = page.getByRole('dialog', { name: 'New checkout' });
    await d.getByLabel('Service', { exact: true }).selectOption({ label: 'Book — Template' });
    await d.getByLabel('Quantity', { exact: true }).fill('10');
    await d.getByLabel('Pages per book', { exact: true }).fill('41');
    await d.locator('.template-breakdown summary').click();
    assert.match(
      await d.locator('.template-breakdown').innerText(),
      /Cover cards[\s\S]*Stock: 5 card[\s\S]*No stock deduction[\s\S]*Stock: 110 sheet/,
    );
    await d.getByLabel('Customer name or phone', { exact: true }).fill('Book');
    await d.getByRole('option', { name: /Book customer/ }).click();
    await d.getByLabel('Money received (₦)', { exact: true }).fill('5000');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await d.locator('.modal-body').evaluate((el) => (el.scrollTop = 0));
    await d.screenshot({ path: `/tmp/pricing-templates-${mobile ? 'mobile' : 'desktop'}.png` });
    await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    const receipt = page.getByRole('dialog');
    assert.match(await receipt.innerText(), /Book/);
    await receipt.getByRole('button', { name: 'Close', exact: true }).click();
    state = await readState();
    assert.equal(state.ledger.jobs.length, 1);
    assert.equal(state.ledger.jobs[0].productionStatus, 'Added');
    assert.equal(state.ledger.jobs[0].amount, 1750000);
    assert.deepEqual(
      state.ledger.materials.map((m) => m.available),
      [95, 90],
    );
    assert.equal(state.ledger.materialHistory.length, 2);
    assert.equal(state.ledger.payments[0].allocations[0].jobId, state.ledger.jobs[0].id);
    await nav('Business Settings');
    await page.getByRole('tab', { name: 'Pricing templates', exact: true }).click();
    await page.getByLabel('Enable pricing templates').uncheck();
    await page.getByRole('button', { name: 'Save pricing templates', exact: true }).click();
    await nav('Point of Service');
    await page.getByRole('button', { name: 'Add job', exact: true }).click();
    d = page.getByRole('dialog', { name: 'New checkout' });
    assert.equal(
      await d
        .getByLabel('Service', { exact: true })
        .locator('option')
        .filter({ hasText: 'Book — Template' })
        .count(),
      0,
    );
    await d.getByRole('button', { name: 'Close', exact: true }).click();
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Pricing templates passed: ${mobile ? 'phone, dark theme' : 'desktop, light theme'}`);
  }
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        console.error('Current dialogs:', await page.getByRole('dialog').allTextContents());
        await page.screenshot({ path: '/tmp/pricing-templates-failure.png', fullPage: true }).catch(() => {});
      }
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
