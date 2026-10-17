// Layout regressions need a real layout engine: exercise populated lists, hints and native form footers.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, webkit } from 'playwright';
import { fixture } from '../tests/pricing-fixture.mjs';
import { applyEvent } from '../src/domain.mjs';
import { settingsSection } from './settings-navigation.mjs';

const out = process.env.UI_SCREENSHOTS ?? '/tmp/ui-consistency';
mkdirSync(out, { recursive: true });
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4196', '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4196')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert.ok(ready, 'Preview starts');
  for (const [engine, widths] of [
    [chromium, [320, 390, 740, 1024, 1280, 1440]],
    [webkit, [390]],
  ]) {
    browser = await engine.launch();
    for (const theme of ['light', 'dark'])
      for (const width of widths) {
        const mobile = width <= 740;
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          isMobile: mobile,
          hasTouch: mobile,
          serviceWorkers: 'block',
          colorScheme: theme,
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        await page.goto('http://127.0.0.1:4196');
        const f = fixture();
        const ledger = applyEvent(f.ledger, f.event);
        const settings = { ...f.settings, theme, businessName: 'Mairoba Studio' };
        await page.evaluate(
          async ({ ledger, settings }) => {
            localStorage.setItem(
              'printshopledger:branding:v1:local-trial',
              JSON.stringify({ settings, version: 1 }),
            );
            const db = await new Promise((resolve, reject) => {
              const request = indexedDB.open('printshopledger-v1', 1);
              request.onupgradeneeded = () => request.result.createObjectStore('ledgers');
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
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
        await page.getByRole('button', { name: 'Try locally on this device', exact: true }).click();
        const nav = async (name) => {
          if (mobile) {
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.getByRole('button', { name: 'Menu', exact: true }).click();
          }
          await page
            .getByRole('navigation', { name: 'Main' })
            .getByRole('button', { name, exact: true })
            .click();
        };
        const fits = async (name) => {
          const failures = await page.evaluate(() =>
            [
              ...document.querySelectorAll(
                'main, .responsive-records, dialog[open], dialog[open] .modal-body',
              ),
            ]
              .filter(
                (element) =>
                  element.getBoundingClientRect().width && element.scrollWidth > element.clientWidth + 2,
              )
              .map(
                (element) =>
                  `${element.tagName}.${element.className}: ${element.scrollWidth}/${element.clientWidth}`,
              ),
          );
          assert.deepEqual(failures, [], `${engine.name()} ${theme} ${width} ${name} fits its container`);
          assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            `${name} fits screen`,
          );
        };
        for (const name of [
          'Materials',
          'Services',
          'Customers',
          'Point of Service',
          'Jobs',
          'Payments',
          'Stock History',
        ]) {
          await nav(name);
          await fits(name);
        }
        await nav('Point of Service');
        await page.getByRole('button', { name: 'Add job', exact: true }).click();
        const checkout = page.getByRole('dialog', { name: 'New checkout', exact: true });
        await checkout.waitFor();
        const source = await checkout.getByPlaceholder('Optional sender, device or reference').boundingBox();
        const deadline = await checkout.getByLabel('Deadline', { exact: true }).boundingBox();
        if (!mobile)
          assert.ok(Math.abs(source.y - deadline.y) <= 2, 'A deadline hint does not move its neighbour');
        assert.equal(Math.round(source.height), 44, 'Shared control height');
        await checkout.locator('.modal-body').evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        const footer = await checkout.locator('.modal-footer').boundingBox();
        assert.ok(footer.y >= 0 && footer.y + footer.height <= 845, 'Checkout footer stays inside viewport');
        await fits('checkout');
        await page.screenshot({ path: `${out}/${engine.name()}-${theme}-${width}-checkout.png` });
        await checkout.getByRole('button', { name: 'Cancel', exact: true }).click();
        await nav('Materials');
        await page.getByRole('button', { name: 'Add material', exact: true }).click();
        const material = page.getByRole('dialog', { name: 'Add material', exact: true });
        await material.getByLabel('Name', { exact: true }).fill('UI layout paper');
        await material.getByLabel('Measurement unit', { exact: true }).fill('sheet');
        assert.equal(
          await material
            .getByRole('button', { name: 'Save material', exact: true })
            .evaluate((button) => button.form?.id),
          await material.locator('form').getAttribute('id'),
          'Footer submits its native form',
        );
        await material.getByRole('button', { name: 'Save material', exact: true }).click();
        await material.waitFor({ state: 'detached' });
        await page.getByText('UI layout paper', { exact: true }).waitFor();
        await fits('saved material');
        await page.screenshot({ path: `${out}/${engine.name()}-${theme}-${width}-materials.png` });
        await nav('Business Settings');
        await settingsSection(page, 'Jobs & payments');
        await fits('settings');
        if (mobile)
          assert.ok(await page.getByLabel('Business settings section', { exact: true }).isVisible());
        else {
          const tabs = page.getByRole('tablist', { name: 'Business settings sections' });
          assert.equal(await tabs.getAttribute('aria-orientation'), 'vertical');
          await page.getByRole('tab', { name: 'Jobs & payments', exact: true }).press('ArrowUp');
          assert.equal(
            await page
              .getByRole('tab', { name: 'Dropdowns & workflow', exact: true })
              .getAttribute('aria-selected'),
            'true',
          );
        }
        await page.screenshot({ path: `${out}/${engine.name()}-${theme}-${width}-settings.png` });
        await context.close();
      }
    await browser.close();
    browser = undefined;
  }
  console.log('UI layout checks passed in both themes, 320–1440px, Chromium and iPhone WebKit.');
} finally {
  await browser?.close();
  server.kill();
}
