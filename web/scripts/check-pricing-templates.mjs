import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readTemplateFile } from '../src/template-transfer.mjs';
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
    assert.equal(await page.getByRole('button', { name: 'Start with book', exact: true }).count(), 0);
    assert.equal(
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('button', { name: 'Pricing Templates', exact: true })
        .count(),
      0,
    );
    await page.getByLabel('Enable pricing templates').check();
    await page.getByRole('button', { name: 'Save pricing templates', exact: true }).click();
    // Private costs show on Services, never at checkout.
    await nav('Services');
    assert.match(
      await page.locator('body').innerText(),
      /Binding labour[\s\S]*Private[\s\S]*In templates as\s*binding/,
    );
    await nav('Pricing Templates');
    assert.equal(await page.getByLabel('Enable pricing templates').count(), 0);
    assert.match(await page.locator('body').innerText(), /No templates to price with/);
    await page.getByRole('tab', { name: 'Costs', exact: true }).click();
    assert.match(
      await page.getByRole('table', { name: 'Costs used in formulas' }).innerText(),
      /paper_70[\s\S]*₦10 \/ sheet/,
    );
    await page.getByRole('tab', { name: 'Templates', exact: true }).click();
    await page.getByRole('button', { name: 'New template', exact: true }).click();
    const d0 = page.getByRole('dialog', { name: 'New pricing template' });
    await d0.getByLabel('Template name', { exact: true }).fill('Books');
    const add = (name) => d0.getByRole('button', { name, exact: true }).click();
    await add('Add editable variable');
    let section = d0.locator('.template-section').nth(1);
    await section.getByLabel('Label', { exact: true }).fill('Sheets per book');
    await section.getByLabel('Default value', { exact: true }).fill('25');
    await section.getByLabel('Minimum', { exact: true }).fill('1');
    await section.getByLabel('Maximum', { exact: true }).fill('500');
    await section.getByLabel('Whole numbers only', { exact: true }).check();
    await add('Add editable variable');
    section = d0.locator('.template-section').nth(2);
    await section.getByLabel('Label', { exact: true }).fill('Inner paper');
    await section.getByLabel('Variable type', { exact: true }).selectOption('material');
    await section.getByLabel(/^Paper 70gsm/).check();
    await section.getByLabel(/^Paper 80gsm/).check();
    assert.equal(await section.getByLabel(/^Art card/).isDisabled(), true); // cards are not sheets
    await d0.getByRole('tab', { name: /Computed variables/ }).click();
    await add('Add computed variable');
    section = d0.locator('.template-section').first();
    await section.getByLabel('Name', { exact: true }).fill('Paper required');
    await section.getByLabel('Unit', { exact: true }).fill('sheet');
    await section.getByLabel('Take from stock', { exact: true }).selectOption({ label: 'Inner paper' });
    await section
      .getByLabel('Paper required formula', { exact: true })
      .fill('CEILING(quantity * sheets_per_book / 2 * 1.04)');
    await d0.getByRole('tab', { name: /^Expenses/ }).click();
    section = d0.locator('.template-section').first();
    await section.getByLabel('Expense name', { exact: true }).fill('Paper');
    await section.getByLabel('Calculation method', { exact: true }).selectOption('custom');
    await section.getByLabel('Formula · paper', { exact: true }).fill('paper_required * inner_paper_rate');
    await add('Add an expense');
    section = d0.locator('.template-section').nth(1);
    await section.getByLabel('Expense name', { exact: true }).fill('Binding');
    await section.getByLabel('Rate source', { exact: true }).selectOption('binding');
    // "binding" is a cost's formula name, so the expense gets its own name.
    assert.equal(
      await section.getByLabel('Formula · binding_2', { exact: true }).inputValue(),
      'quantity * (binding)',
    );
    assert.equal(await d0.getByRole('button', { name: 'Check & save template', exact: true }).count(), 0);
    await d0.getByRole('button', { name: 'Next: Pricing & preview', exact: true }).click();
    // Defaults: 1 book of 25 sheets = 13 sheets × ₦10 + ₦100 binding = ₦230 → +30% = ₦299 → rounded up to ₦300.
    assert.match(
      await d0.locator('.template-audit').innerText(),
      /Total expense[\s\S]*₦230\.00[\s\S]*Template price\s*₦300\.00/,
    );
    await d0.screenshot({ path: `/tmp/pricing-templates-editor-${mobile ? 'mobile' : 'desktop'}.png` });
    await d0.getByRole('button', { name: 'Check & save template', exact: true }).click();
    await d0.waitFor({ state: 'detached' });
    assert.match(
      await page.locator('.template-grid').innerText(),
      /Books[\s\S]*3 editable variables · 1 computed variables · 2 expenses/,
    );
    await page.screenshot({ path: `/tmp/pricing-templates-page-${mobile ? 'mobile' : 'desktop'}.png` });
    await nav('Quotations');
    await page.getByRole('button', { name: 'New quotation', exact: true }).click();
    let d = page.getByRole('dialog', { name: 'New quotation' });
    await d.getByLabel('Customer', { exact: true }).fill('Book customer');
    await d.getByLabel('Service', { exact: true }).selectOption({ label: 'Books — Template' });
    assert.equal(
      await d.getByLabel('Service', { exact: true }).locator('option', { hasText: 'Binding labour' }).count(),
      0,
    );
    await d.getByLabel('Quantity', { exact: true }).fill('50');
    // 650 sheets × ₦10 + 50 × ₦100 = ₦11,500 → +30% = ₦14,950 → ₦15,000.
    await d.getByText('₦15,000.00').first().waitFor();
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
    assert.equal(state.ledger.materials[0].available, 2000);
    assert.equal(state.ledger.quotations[0].lines[0].amount, 1500000);
    // Price & compare: views, comparison and PDFs live on the Pricing Templates page.
    await nav('Pricing Templates');
    const c = page.getByRole('region', { name: 'Price and compare' });
    await c.getByLabel('Quantity', { exact: true }).fill('50');
    await c.getByLabel('Inner paper', { exact: true }).selectOption({ label: 'Paper 80gsm' });
    // 650 × ₦13 + ₦5,000 = ₦13,450 → ₦17,485 → ₦17,500.
    await c.getByText('₦17,500.00').first().waitFor();
    assert.match(
      await c.locator('.template-specs').first().innerText(),
      /Sheets per book[\s\S]*25[\s\S]*Inner paper[\s\S]*Paper 80gsm/,
    );
    await c.getByRole('button', { name: 'Internal job & audit', exact: true }).click();
    assert.match(
      await c.locator('.template-audit').innerText(),
      /Paper required[\s\S]*650 sheet[\s\S]*Stock taken at checkout[\s\S]*Paper 80gsm[\s\S]*650 sheet/i,
    );
    await c.getByLabel('Quantities', { exact: true }).fill('50, 100');
    await c.getByRole('button', { name: 'Compare prices', exact: true }).click();
    assert.match(
      await c.getByRole('table', { name: 'Compared options' }).innerText(),
      /50[\s\S]*₦17,500\.00[\s\S]*100[\s\S]*₦35,000\.00/,
    );
    // The comparison downloads as an A4 or A5 PDF; nothing is printed from the page.
    await c.getByLabel('Customer name for the comparison', { exact: true }).fill('Book customer');
    for (const [button, name] of [
      ['A4 PDF', 'Books-options.pdf'],
      ['A5 PDF', 'Books-options-A5.pdf'],
    ]) {
      const download = page.waitForEvent('download');
      await c.getByRole('button', { name: button, exact: true }).click();
      const file = await download;
      assert.equal(file.suggestedFilename(), name);
      assert.ok((await file.path()) && (await import('node:fs')).statSync(await file.path()).size > 2000);
    }
    // The other buttons still work afterwards.
    await c.getByRole('button', { name: 'Use option', exact: true }).last().click();
    assert.equal(await c.getByLabel('Quantity', { exact: true }).inputValue(), '100');
    await c.getByLabel('Quantity', { exact: true }).fill('50');
    await c.getByText('₦17,500.00').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({
      path: `/tmp/pricing-templates-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    // Start checkout carries the priced line; checkout shows only the variables and the price.
    await c.getByRole('button', { name: 'Start checkout', exact: true }).click();
    d = page.getByRole('dialog', { name: 'New checkout' });
    assert.equal(await d.getByLabel('Quantity', { exact: true }).inputValue(), '50');
    await d.getByText('₦17,500.00').first().waitFor();
    assert.equal(await d.getByRole('button', { name: 'Internal job & audit', exact: true }).count(), 0);
    assert.equal(await d.getByLabel('Compare options', { exact: true }).count(), 0);
    await d.getByLabel('Customer name or phone', { exact: true }).fill('Book');
    await d.getByRole('option', { name: /Book customer/ }).click();
    await d.getByLabel('Money received (₦)', { exact: true }).fill('5000');
    await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    const receipt = page.getByRole('dialog');
    assert.match(await receipt.innerText(), /Books/);
    await receipt.getByRole('button', { name: 'Close', exact: true }).click();
    state = await readState();
    assert.equal(state.ledger.jobs.length, 1);
    assert.equal(state.ledger.jobs[0].amount, 1750000);
    assert.deepEqual(
      state.ledger.materials.map((m) => m.available),
      [2000, 1350, 100],
    );
    assert.equal(state.ledger.materialHistory.length, 1);
    // Start quotation opens a new quotation with the template line.
    await nav('Pricing Templates');
    await page
      .getByRole('region', { name: 'Price and compare' })
      .getByLabel('Quantity', { exact: true })
      .fill('20');
    await page.getByRole('button', { name: 'Start quotation', exact: true }).click();
    d = page.getByRole('dialog', { name: 'New quotation' });
    assert.equal(await d.getByLabel('Quantity', { exact: true }).inputValue(), '20');
    await d.getByRole('button', { name: 'Close', exact: true }).first().click();
    await d.waitFor({ state: 'detached' });
    // Saved costs can be imported once, then reused without overwriting current amounts.
    await nav('Pricing Templates');
    await page.getByRole('tab', { name: 'Costs', exact: true }).click();
    const importCosts = async (amount) => {
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Import costs', exact: true }).click();
      await (await chooser).setFiles({
        name: 'costs.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({
            format: 'printshopledger.pricing-costs',
            version: 1,
            costs: [
              {
                description: 'Imported training cost',
                costing: { key: 'training_imported', amount, per: 1, unit: 'item' },
              },
              {
                description: 'Customer supplied',
                costing: { key: 'training_supplied', amount: 0, per: 1, unit: 'item' },
              },
            ],
          }),
        ),
      });
    };
    const beforeCosts = await readState();
    await importCosts(5000);
    let costDialog = page.getByRole('dialog', { name: 'Import saved costs', exact: true });
    await costDialog.getByText(/Create 2 private costs and keep 0/).waitFor();
    await costDialog.getByRole('button', { name: 'Save imported costs', exact: true }).click();
    await costDialog.waitFor({ state: 'detached' });
    let withCosts = await readState();
    assert.equal(
      withCosts.ledger.services.find((s) => s.costing?.key === 'training_imported').costing.amount,
      5000,
    );
    assert.equal(withCosts.ledger.services.find((s) => s.costing?.key === 'training_supplied').private, true);
    assert.deepEqual(withCosts.ledger.materials, beforeCosts.ledger.materials);
    assert.deepEqual(withCosts.ledger.payments, beforeCosts.ledger.payments);
    await importCosts(9000);
    costDialog = page.getByRole('dialog', { name: 'Import saved costs', exact: true });
    await costDialog.getByText(/Create 0 private costs and keep 2/).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await costDialog.screenshot({
      path: `/tmp/pricing-templates-costs-${mobile ? 'mobile' : 'desktop'}.png`,
    });
    await costDialog.getByRole('button', { name: 'Save imported costs', exact: true }).click();
    await costDialog.waitFor({ state: 'detached' });
    withCosts = await readState();
    assert.equal(
      withCosts.ledger.services.find((s) => s.costing?.key === 'training_imported').costing.amount,
      5000,
    );
    assert.equal(withCosts.ledger.services.length, beforeCosts.ledger.services.length + 2);
    // File transfer is reviewed first, keeps existing jobs/stock intact, and survives reload.
    await nav('Pricing Templates');
    await page.getByRole('tab', { name: 'Templates', exact: true }).click();
    let card = page
      .locator('.template-card')
      .filter({ has: page.getByRole('heading', { name: 'Books', exact: true }) });
    await card.getByRole('button', { name: 'Export', exact: true }).click();
    let transfer = page.getByRole('dialog', { name: 'Export pricing templates', exact: true });
    assert.match(await transfer.innerText(), /fixed amounts|fixed/i);
    const downloadEvent = page.waitForEvent('download');
    await transfer.getByRole('button', { name: 'Download file', exact: true }).click();
    const exported = await downloadEvent;
    const exportedText = await readFile(await exported.path(), 'utf8');
    const portable = readTemplateFile(exportedText);
    assert.equal(portable.templates.length, 1);
    await transfer.getByRole('button', { name: 'Close', exact: true }).click();
    // Unsupported file sharing downloads a portable file and explains attachment.
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false }),
    );
    await card.getByRole('button', { name: 'Share', exact: true }).click();
    transfer = page.getByRole('dialog', { name: 'Share pricing template', exact: true });
    const sharedDownload = page.waitForEvent('download');
    await transfer.getByRole('button', { name: 'Share file', exact: true }).click();
    await sharedDownload;
    await transfer.getByText(/File downloaded. Attach it/).waitFor();
    await transfer.getByRole('button', { name: 'Close', exact: true }).click();
    const importFile = async (text) => {
      const chooserEvent = page.waitForEvent('filechooser');
      // On narrow screens ToolbarActions may put Import in the More menu.
      const importButton = page.getByRole('button', { name: 'Import', exact: true });
      if (!(await importButton.isVisible())) await page.getByRole('button', { name: /More/ }).click();
      await importButton.click();
      await (await chooserEvent).setFiles({
        name: 'templates.json',
        mimeType: 'application/json',
        buffer: Buffer.from(text),
      });
    };
    await importFile('{');
    await page.getByText('This is not a valid template JSON file.', { exact: true }).waitFor();
    await importFile(exportedText);
    transfer = page.getByRole('dialog', { name: 'Import pricing templates', exact: true });
    assert.equal(
      await transfer.getByLabel('Template name', { exact: true }).inputValue(),
      'Books (import 1)',
    );
    const match = transfer.locator('select').first();
    const suggested = await match.inputValue();
    assert.ok(suggested);
    await match.selectOption('');
    assert.equal(
      await transfer.getByRole('button', { name: 'Import 1 template', exact: true }).isDisabled(),
      true,
    );
    await match.selectOption(suggested);
    await transfer.getByText(/All references matched/).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await transfer.screenshot({ path: `/tmp/pricing-templates-import-${mobile ? 'mobile' : 'desktop'}.png` });
    const beforeImport = await readState();
    await transfer.getByRole('button', { name: 'Import 1 template', exact: true }).click();
    await transfer.waitFor({ state: 'detached' });
    const afterImport = await readState();
    assert.deepEqual(afterImport.ledger, beforeImport.ledger);
    assert.deepEqual(afterImport.pending, beforeImport.pending);
    await page.reload();
    await page.getByRole('button', { name: 'Try locally on this device', exact: true }).click();
    await nav('Pricing Templates');
    await page.getByRole('tab', { name: 'Templates', exact: true }).click();
    await page.getByRole('heading', { name: 'Books (import 1)', exact: true }).waitFor();
    await nav('Business Settings');
    await page.getByRole('tab', { name: 'Pricing templates', exact: true }).click();
    await page.getByLabel('Enable pricing templates').uncheck();
    await page.getByRole('button', { name: 'Save pricing templates', exact: true }).click();
    assert.equal(
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('button', { name: 'Pricing Templates', exact: true })
        .count(),
      0,
    );
    await nav('Point of Service');
    await page.getByRole('button', { name: 'Add job', exact: true }).click();
    d = page.getByRole('dialog', { name: 'New checkout' });
    assert.equal(
      await d
        .getByLabel('Service', { exact: true })
        .locator('option')
        .filter({ hasText: 'Books — Template' })
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
