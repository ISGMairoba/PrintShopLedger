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
        if (new Set(sizes).size > 1) failures.push(`${mode} ${name}: toolbar heights ${[...new Set(sizes)].join('/')}`);
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
    // Main dialogs.
    const dialog = async (pageName, button, file) => {
      try {
        await nav(pageName);
        await page.getByRole('button', { name: button, exact: true }).first().click();
        await page.getByRole('dialog').first().waitFor();
        await shot(`90-dialog-${file}`, false);
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
    await dialog('Point of Service', 'Receive payment', 'receive-payment');
    await dialog('Quotations', 'New quotation', 'new-quotation');
    await dialog('Expenses', 'Add expense', 'add-expense');
    await dialog('Customers', 'Add customer', 'add-customer');
    await dialog('Materials', 'Add material', 'add-material');
    await dialog('Services', 'Add service', 'add-service');
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
    await context.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
console.log(failures.length ? `Not captured:\n${failures.join('\n')}` : 'All screens captured.');
