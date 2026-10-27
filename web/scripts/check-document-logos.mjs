import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { settingsSection } from './settings-navigation.mjs';
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    '--mode',
    'production',
    '--host',
    '127.0.0.1',
    '--port',
    '4198',
    '--strictPort',
  ],
  { stdio: 'inherit' },
);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4198')).ok) break;
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
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4198');
    await page.evaluate(async () => {
      const { defaultBranding } = await import('/src/business-branding.mjs');
      const b = defaultBranding();
      b.businessName = 'Document logo test';
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 120;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#235488';
      ctx.fillRect(0, 0, 300, 120);
      b.logo = canvas.toDataURL();
      b.logoVariants.complete.light = b.logo;
      ctx.clearRect(0, 0, 300, 120);
      ctx.fillStyle = '#cc2233';
      ctx.fillRect(100, 10, 100, 100);
      b.logoVariants.icon.light = canvas.toDataURL();
      localStorage.setItem(
        'printshopledger:branding:v1:local-trial',
        JSON.stringify({ settings: b, version: 1 }),
      );
    });
    const nav = async () => {
      if (mobile) await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('button', { name: 'Business Settings', exact: true })
        .click();
      await settingsSection(page, 'Receipts');
      await page.getByRole('button', { name: 'Full page (A4 / A5)', exact: true }).click();
    };
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    await nav();
    await page.getByLabel('Watermark logo', { exact: true }).selectOption('icon');
    await page
      .getByLabel('Show a faint watermark on full-page documents and report PDFs', { exact: true })
      .check();
    for (const position of ['left', 'right', 'top-left', 'top-center', 'top-right']) {
      await page.getByLabel('Full-page logo position', { exact: true }).selectOption(position);
      const preview = page.locator('.receipt-sheet .psl-w');
      await preview.locator('.logo').waitFor();
      const images = await preview
        .locator('img')
        .evaluateAll((imgs) => imgs.map((i) => ({ src: i.src, ratio: i.naturalWidth / i.naturalHeight })));
      assert.equal(images.length, 2);
      assert.notEqual(images[0].src, images[1].src);
      assert.equal(images[1].ratio, 2.5);
      if (position.startsWith('top-')) assert.equal(await preview.locator('.head-logo').count(), 1);
    }
    await page.getByRole('button', { name: 'Save receipt settings', exact: true }).click();
    await page.getByText('Receipt settings saved.', { exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    await nav();
    assert.equal(await page.getByLabel('Watermark logo', { exact: true }).inputValue(), 'icon');
    assert.equal(await page.getByLabel('Full-page logo position', { exact: true }).inputValue(), 'top-right');
    await page.screenshot({
      path: `/tmp/document-logos-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    if (!mobile) {
      const pdfs = await page.evaluate(async () => {
        const { createReceiptPdf } = await import('/src/receipt-pdf.ts');
        const { createReportPdf } = await import('/src/report-pdf.ts');
        const { sampleReceipt } = await import('/src/receipt-sample.mjs');
        const b = JSON.parse(localStorage.getItem('printshopledger:branding:v1:local-trial')).settings;
        return ['left', 'right', 'top-left', 'top-center', 'top-right'].map((position) => {
          b.receiptPage.logoPosition = position;
          return {
            position,
            receipt: createReceiptPdf(sampleReceipt(), b, false, [], 'a4').output('datauristring'),
            report: createReportPdf(b, {
              title: 'Sales report',
              sections: [],
              generatedAt: new Date().toISOString(),
            }).output('datauristring'),
          };
        });
      });
      for (const p of pdfs)
        for (const kind of ['receipt', 'report'])
          await writeFile(
            `/tmp/logo-${kind}-${p.position}.pdf`,
            Buffer.from(p[kind].split(',')[1], 'base64'),
          );
    }
    await context.close();
    console.log(`Document logos passed: ${mobile ? 'mobile' : 'desktop'}`);
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
