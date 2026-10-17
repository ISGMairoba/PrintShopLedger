// Screenshots of every page, main tabs and main dialogs, for a visual review of the whole app.
// Run after `npm run build`: node scripts/ui-screens.mjs <output folder>
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fixture } from '../tests/pricing-fixture.mjs';
import { applyEvent } from '../src/domain.mjs';
import { navigationPages } from '../src/page-access.mjs';

const out = process.argv[2] ?? '/tmp/ui-screens';
mkdirSync(out, { recursive: true });
const port = 4199;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
const failures = [];
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({ headless: true });
  for (const [mode, mobile, theme] of [
    ['desktop-light', false, 'light'],
    ['mobile-dark', true, 'dark'],
    ['desktop-dark', false, 'dark'],
    ['mobile-light', true, 'light'],
  ]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
      serviceWorkers: 'block',
      colorScheme: theme,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    await page.goto(`http://127.0.0.1:${port}`);
    await page.screenshot({ path: `${out}/${mode}-00-sign-in.png`, fullPage: true });
    await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
    await page.screenshot({ path: `${out}/${mode}-00-forgot-password.png`, fullPage: true });
    await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
    const f = fixture();
    const ledger = applyEvent(f.ledger, f.event);
    const settings = { ...f.settings, theme, businessName: 'Mairoba Studio' };
    settings.pricing = { ...settings.pricing, enabled: true };
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
    await page.reload();
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    await delay(500);
    const nav = async (name) => {
      if (mobile) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
      }
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
      await delay(400);
    };
    const shot = async (name, full = true) => {
      await delay(250);
      await page.screenshot({ path: `${out}/${mode}-${name}.png`, fullPage: full });
    };
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let n = 1;
    if (mobile) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await shot('01-menu-open', false);
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('button', { name: 'Point of Service', exact: true })
        .click();
      await delay(400);
    }
    for (const name of navigationPages) {
      if (name === 'Material Waste') continue;
      const id = String(++n).padStart(2, '0');
      try {
        await nav(name);
        await shot(`${id}-${slug(name)}`);
        // Toolbar controls should share one height, and rows should line up.
        const sizes = await page.evaluate(() =>
          [...document.querySelectorAll('main .toolbar')].flatMap((bar) =>
            [
              ...bar.querySelectorAll(
                ':scope > input:not([type=checkbox]), :scope > select, :scope > button, :scope > label > select, :scope > label > input:not([type=checkbox]), .toolbar-actions > button, .more-menu > button',
              ),
            ]
              .filter((el) => el.getBoundingClientRect().width > 0)
              .map((el) => Math.round(el.getBoundingClientRect().height)),
          ),
        );
        if (new Set(sizes).size > 1)
          failures.push(`${mode} ${name}: toolbar heights ${[...new Set(sizes)].join('/')}`);
        const picker = page.getByLabel('Business settings section', { exact: true });
        if (await picker.isVisible()) {
          const sections = await picker
            .locator('option')
            .evaluateAll((items) => items.map((item) => item.value));
          for (const section of sections.slice(1)) {
            await picker.selectOption(section);
            await shot(`${id}-${slug(name)}-section-${slug(section)}`);
          }
        }
        const tabs = page.getByRole('main').getByRole('tab');
        const count = await tabs.count();
        for (let t = 1; t < count; t++) {
          const label = (await tabs.nth(t).innerText()).replace(' •', '').trim();
          await tabs.nth(t).click();
          await shot(`${id}-${slug(name)}-tab-${slug(label)}`);
        }
      } catch (e) {
        failures.push(`${mode} ${name}: ${e.message.split('\n')[0]}`);
        await page.keyboard.press('Escape').catch(() => {});
      }
    }
    const closeDialogs = async () => {
      for (let i = 0; i < 3 && (await page.locator('dialog[open]').count()); i++) {
        await page
          .locator('dialog[open]')
          .last()
          .getByRole('button', { name: /^Close$|^Cancel$/ })
          .first()
          .click()
          .catch(() => {});
        await delay(300);
      }
    };
    // Every text box, date box and dropdown on screen should be one height.
    const fieldHeights = async (where) => {
      const sizes = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            'main input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=file]), main select, dialog[open] input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=file]), dialog[open] select',
          ),
        ]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => Math.round(el.getBoundingClientRect().height)),
      );
      if (new Set(sizes).size > 1)
        failures.push(`${mode} ${where}: field heights ${[...new Set(sizes)].join('/')}`);
    };
    // Expenses with its filter row open, and the statement customer search.
    try {
      await nav('Expenses');
      await page.locator('.filter-button').click();
      await page.getByRole('button', { name: /^Dates:/ }).click();
      await fieldHeights('Expenses filters');
      await shot('93-expenses-filters');
      await nav('Reports');
      await page.getByRole('button', { name: 'Show customer options', exact: true }).click();
      await fieldHeights('Reports customer');
      await shot('94-reports-customer-search', false);
      await nav('Dashboard');
      await fieldHeights('Dashboard period');
    } catch (e) {
      failures.push(`${mode} filters: ${e.message.split('\n')[0]}`);
    }
    // Main dialogs.
    const dialog = async (pageName, button, file) => {
      try {
        await nav(pageName);
        await page.getByRole('button', { name: button, exact: true }).first().click();
        await page.getByRole('dialog').first().waitFor();
        await shot(`90-dialog-${file}`, false);
        await fieldHeights(`dialog ${file}`);
        await page
          .getByRole('dialog')
          .first()
          .screenshot({ path: `${out}/${mode}-91-dialog-${file}-full.png` });
        await closeDialogs();
      } catch (e) {
        failures.push(`${mode} dialog ${file}: ${e.message.split('\n')[0]}`);
        await closeDialogs();
      }
    };
    await dialog('Point of Service', 'Add job', 'new-checkout');
    await dialog('Point of Service', 'Quick sale', 'quick-sale');
    try {
      await nav('Point of Service');
      await page.getByRole('button', { name: 'Quick sale', exact: true }).click();
      const q = page.getByRole('dialog', { name: 'Quick sale' });
      await q.locator('.quick-product').first().click();
      await q.getByRole('spinbutton').first().fill('');
      await q.getByLabel('Discount', { exact: true }).selectOption('percent');
      await shot('95-quick-sale-discount', false);
      await closeDialogs();
    } catch (e) {
      failures.push(`${mode} quick sale discount: ${e.message.split('\n')[0]}`);
      await closeDialogs();
    }
    await dialog('Point of Service', 'Receive payment', 'receive-payment');
    await dialog('Quotations', 'New quotation', 'new-quotation');
    await dialog('Expenses', 'Add expense', 'add-expense');
    await dialog('Customers', 'Add customer', 'add-customer');
    await dialog('Materials', 'Add material', 'add-material');
    await dialog('Services', 'Add service', 'add-service');
    // Edit item with its pricing-template fields open (name, cost, units and hints line up).
    try {
      await nav('Services');
      await page.getByRole('button', { name: 'Add service', exact: true }).click();
      const d = page.getByRole('dialog').first();
      await d.getByRole('checkbox', { name: /Use in pricing templates/ }).check();
      await d.screenshot({ path: `${out}/${mode}-91-dialog-service-costing.png` });
      await closeDialogs();
    } catch (e) {
      failures.push(`${mode} service costing: ${e.message.split('\n')[0]}`);
      await closeDialogs();
    }
    await dialog('Edit Products', 'Edit', 'edit-product');
    await dialog('Jobs', 'Books', 'job-details');
    try {
      await nav('Pricing Templates');
      await page.getByRole('tab', { name: 'Templates', exact: true }).click();
      await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
      const d = page.getByRole('dialog').first();
      await d.waitFor();
      for (let i = 0; i < 4; i++) {
        await d.screenshot({ path: `${out}/${mode}-92-template-editor-step-${i + 1}.png` });
        const next = d.getByRole('button', { name: /^Next/ });
        if (!(await next.count())) break;
        await next.click();
        await delay(250);
      }
      await closeDialogs();
    } catch (e) {
      failures.push(`${mode} template editor: ${e.message.split('\n')[0]}`);
    }
    // A choice of materials: link two papers to Lamination, sell it, then confirm what was used.
    try {
      await nav('Services');
      await page.getByRole('button', { name: 'Add service', exact: true }).click();
      const d = page.getByRole('dialog').first();
      await d.getByLabel('Service description').fill('Lamination (A4)');
      await d.getByLabel('Base material').selectOption('__choice');
      await d.getByRole('checkbox', { name: /Paper 70gsm/ }).check();
      await d.getByRole('checkbox', { name: /Paper 80gsm/ }).check();
      await d.getByRole('textbox', { name: 'Price (₦)' }).fill('300');
      await d.screenshot({ path: `${out}/${mode}-89-service-material-choice.png` });
      await d.getByRole('button', { name: /Save service/ }).click();
      await d.waitFor({ state: 'detached' });
      await nav('Point of Service');
      await page.getByRole('button', { name: 'Add job', exact: true }).click();
      const c = page.getByRole('dialog', { name: 'New checkout' });
      const line = c.locator('.cart-line').first();
      const value = await line
        .getByLabel('Service', { exact: true })
        .evaluate((el) => [...el.options].find((o) => o.textContent.includes('Lamination'))?.value);
      await line.getByLabel('Service', { exact: true }).selectOption(value);
      await line.getByLabel('Quantity', { exact: true }).fill('100');
      await line.getByLabel('Job description').fill('Laminate certificates');
      await c.getByRole('combobox', { name: 'Customer name or phone' }).fill('Book');
      await c.getByRole('listbox', { name: 'Customer suggestions' }).getByRole('option').first().click();
      await c
        .locator('.cart-line')
        .first()
        .screenshot({ path: `${out}/${mode}-89-checkout-material-choice.png` });
      await c.getByRole('button', { name: 'Complete checkout' }).click();
      await page.getByRole('dialog').last().getByRole('button', { name: 'Close', exact: true }).click();
      await nav('Jobs');
      await shot('89-jobs-material-to-confirm');
      await page
        .getByRole('main')
        .getByRole('button', { name: /Mark as Complete/ })
        .first()
        .click();
      const m = page.getByRole('dialog').last();
      await m.getByRole('button', { name: /Add another material/ }).click();
      await fieldHeights('Material used');
      await m.screenshot({ path: `${out}/${mode}-89-material-used.png` });
      await closeDialogs();
    } catch (e) {
      failures.push(`${mode} material choice: ${e.message.split('\n')[0]}`);
      await closeDialogs();
    }
    // Help: the panel from a page's ? button, and from the menu.
    try {
      await nav('Point of Service');
      await page.getByRole('button', { name: /^Help with / }).click();
      await page.getByRole('dialog', { name: 'Help' }).waitFor();
      await shot('95-help-page-topic', false);
      await closeDialogs();
    } catch (e) {
      failures.push(`${mode} help: ${e.message.split('\n')[0]}`);
      await closeDialogs();
    }
    // A product with colour variants: the Add product form, then Quick sale, Edit Products and the editor.
    try {
      await nav('Services');
      await page.getByRole('button', { name: 'Add product', exact: true }).click();
      const d = page.getByRole('dialog', { name: 'Add product' });
      await d.locator('input[name=name]').fill('Envelope');
      await d.getByRole('textbox', { name: 'Price (₦)' }).fill('100');
      await d.getByRole('checkbox', { name: /Comes in variants/ }).check();
      for (const [i, name, stock] of [
        [1, 'Pink', '400'],
        [2, 'Blue', '600'],
      ]) {
        await d.getByLabel(`Variant ${i} name`).fill(name);
        await d.getByLabel(`Variant ${i} opening stock`).fill(stock);
      }
      await d.screenshot({ path: `${out}/${mode}-96-add-product-variants.png` });
      await fieldHeights('Add product variants');
      await d.getByRole('button', { name: /Save product/ }).click();
      await d.waitFor({ state: 'detached' });
      await nav('Point of Service');
      await page.getByRole('button', { name: 'Quick sale', exact: true }).click();
      const q = page.getByRole('dialog', { name: 'Quick sale' });
      await q.getByRole('button', { name: /^Add Envelope — Blue/ }).click();
      await shot('97-quick-sale-variants', false);
      await closeDialogs();
      await nav('Edit Products');
      await page
        .getByRole('main')
        .getByPlaceholder(/Search/)
        .fill('Envelope');
      await shot('98-edit-products-variants');
      await page
        .getByRole('main')
        .getByRole('button', { name: /^Edit$/ })
        .first()
        .click();
      const e = page.getByRole('dialog').first();
      await e.waitFor();
      await e.getByRole('button', { name: 'Add variant' }).click();
      await e.screenshot({ path: `${out}/${mode}-99-edit-variant.png` });
      await fieldHeights('Edit variant');
      await e.getByRole('button', { name: /a separate item$/ }).click();
      await e.screenshot({ path: `${out}/${mode}-99-separate-variant.png` });
      await e.getByRole('button', { name: 'Choose another product' }).click();
      await e
        .getByRole('button', { name: /^Art card/ })
        .first()
        .click();
      await e.getByRole('button', { name: /Add variants/ }).click();
      await e.screenshot({ path: `${out}/${mode}-99-make-variants.png` });
      await fieldHeights('Make variants');
      await closeDialogs();
    } catch (e) {
      failures.push(`${mode} variants: ${e.message.split('\n')[0]}`);
      await closeDialogs();
    }
    await context.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
console.log(failures.length ? `Not captured:\n${failures.join('\n')}` : 'All screens captured.');
