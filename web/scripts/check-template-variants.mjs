// A pricing template that takes stock from a product with variants: the variant is picked at
// checkout (and taken from its stock), or left for production; the editor offers the product.
import { readCopy } from './local-copy.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fixture, id, bookTemplate } from '../tests/pricing-fixture.mjs';
import { validatePricingSettings } from '../src/pricing-templates.mjs';
const port = 4196;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Template variants check timed out');
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
    const group = id(60);
    for (const [n, colour] of [
      [61, 'Blue'],
      [62, 'White'],
    ]) {
      ledger.materials.push({
        ...ledger.materials[0],
        id: id(n),
        name: `Envelope — ${colour}`,
        measurementUnit: 'piece',
        available: 100,
      });
      ledger.services.push({
        ...ledger.services[3],
        id: id(n + 10),
        description: `Envelope — ${colour}`,
        materialId: id(n),
        price: 5000,
        shelfItem: true,
        variantGroup: group,
        variantName: colour,
        private: false,
        costing: null,
      });
    }
    const template = bookTemplate();
    template.computed.push({
      key: 'envelopes',
      label: 'Envelopes',
      unit: 'piece',
      formula: 'quantity',
      stock: { variantGroup: group },
    });
    delete ledger.pricing;
    settings.pricing = validatePricingSettings({ enabled: true, templates: [template] });
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
    const readState = () => readCopy(page, 'local-trial');

    // The editor offers the product under "Take from stock".
    await nav('Pricing Templates');
    await page.getByRole('tab', { name: 'Templates', exact: true }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    const editor = page.getByRole('dialog');
    await editor.getByRole('tab', { name: /Computed variables/ }).click();
    const take = editor.getByLabel('Take from stock', { exact: true }).last();
    assert.match(
      await take.locator('option:checked').innerText(),
      /Envelope \(variant picked at checkout or confirmed in production\)/,
    );
    await editor.getByRole('button', { name: 'Close', exact: true }).first().click();
    await editor.waitFor({ state: 'detached' });

    // Price & compare: the variant can be left for production or picked now.
    await nav('Pricing Templates');
    const c = page.getByRole('region', { name: 'Price and compare' });
    await c.getByLabel('Quantity', { exact: true }).fill('10');
    const variant = c.getByLabel('Envelope variant', { exact: true });
    assert.equal(await variant.inputValue(), '');
    assert.deepEqual(await variant.locator('option').allInnerTexts(), [
      'Decide in production',
      'Blue',
      'White',
    ]);
    await c.getByText('Staff confirm the variant used in production.').waitFor();
    await variant.selectOption({ label: 'White' });
    await c.getByText('Taken from stock at checkout.').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    // Checkout carries the pick and takes the envelopes from the White variant's stock.
    await c.getByRole('button', { name: 'Start checkout', exact: true }).click();
    const d = page.getByRole('dialog', { name: 'New checkout' });
    assert.equal(await d.getByLabel('Envelope variant', { exact: true }).inputValue(), id(72));
    await d.getByLabel('Customer name or phone', { exact: true }).fill('Book');
    await d.getByRole('option', { name: /Book customer/ }).click();
    await d.getByLabel('Money received (₦)', { exact: true }).fill('1000');
    await page.screenshot({
      path: `/tmp/template-variants-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    const receipt = page.getByRole('dialog');
    assert.match(await receipt.innerText(), /Envelopes: Envelope — White/);
    await receipt.getByRole('button', { name: 'Close', exact: true }).click();
    const state = await readState();
    assert.equal(state.ledger.materials.find((m) => m.id === id(62)).available, 90);
    assert.equal(state.ledger.materials.find((m) => m.id === id(61)).available, 100);
    assert.deepEqual(state.ledger.jobs[0].templateSnapshot.variantPicks, { envelopes: id(72) });
    assert.equal(state.ledger.jobs[0].materialChoice, undefined);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Template variants passed: ${mobile ? 'phone' : 'desktop'}`);
  }
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        console.error('Current dialogs:', await page.getByRole('dialog').allTextContents());
        await page.screenshot({ path: '/tmp/template-variants-failure.png', fullPage: true }).catch(() => {});
      }
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
