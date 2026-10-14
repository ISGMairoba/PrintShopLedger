import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const openMore = async (scope) => {
  const toggle = scope.locator('.toolbar-actions .more-menu > button').first();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await scope.locator('.more-menu-panel').first().waitFor();
  return scope;
};

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4179', '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4179')).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  for (const mobile of [false, true]) {
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      serviceWorkers: 'block',
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:4179');
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    const nav = async (name) => {
      if (mobile) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await delay(200);
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
      }
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
    };
    await nav('Business Settings');
    await page.getByLabel('Business name', { exact: true }).fill('Mairoba Studio');
    await page.getByLabel('Address', { exact: true }).fill('Kano, Nigeria');
    await page.getByLabel('Phone / WhatsApp numbers', { exact: true }).fill('08011112222');
    await page.getByLabel('Email', { exact: true }).fill('studio@example.com');
    await page.getByLabel('Website', { exact: true }).fill('https://example.com');
    await page.getByRole('tab', { name: 'Receipts' }).click();
    await page.getByLabel('Receipt footer', { exact: true }).fill('Thank you from Mairoba.');
    // Receipt printer and full-page receipts are set separately.
    await page.getByRole('button', { name: 'Full page (A4 / A5)', exact: true }).click();
    await page.getByLabel('Receipt footer', { exact: true }).fill('Thank you from Mairoba.');
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 120;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#235488';
      ctx.fillRect(0, 0, 300, 120);
      return canvas.toDataURL('image/png');
    });
    await page.getByRole('tab', { name: /Profile & logo/ }).click();
    await page.getByLabel('Upload logo', { exact: true }).setInputFiles({
      name: 'brand.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png.split(',')[1], 'base64'),
    });
    await page.getByAltText('Business logo preview').waitFor();
    const ratio = await page
      .getByAltText('Business logo preview')
      .evaluate((img) => img.naturalWidth / img.naturalHeight);
    assert.equal(ratio, 2.5, 'Logo proportions preserved');
    assert.ok((await page.locator('.logo-palette button').count()) > 0);
    await page.getByRole('tab', { name: /Dropdowns & workflow/ }).click();
    await page.getByLabel('New payment method', { exact: true }).fill('Opay');
    await page.getByLabel('New payment accounting type', { exact: true }).selectOption('Transfer');
    await page.getByRole('button', { name: 'Add payment method', exact: true }).click();
    await page.getByLabel('Expense categories', { exact: true }).fill('Materials\nFinishing supplies\nOther');
    await page.getByLabel('Job sources', { exact: true }).fill('Instagram DM\nWhatsApp');
    await page.getByLabel('Stock reasons', { exact: true }).fill('Weekly restock\nStock Count Correction');
    await page.getByLabel('Material units', { exact: true }).fill('sheet\nbox');
    await page
      .getByLabel('Job stages', { exact: true })
      .fill('Added\nDesign\nApproval\nFinishing\nCompleted\nCollected');
    await page.getByRole('tab', { name: /Profile & logo/ }).click();
    await page.getByLabel('Email', { exact: true }).fill('invalid');
    await page.getByRole('button', { name: 'Save logo', exact: true }).click();
    await page.getByText('Logo saved.', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), 'invalid');
    await page.getByLabel('Email', { exact: true }).fill('studio@example.com');
    await page.getByRole('tab', { name: /Appearance/ }).click();
    await page.getByLabel('Primary color', { exact: true }).fill('#f4d945');
    await page.getByLabel('Accent color', { exact: true }).fill('#235488');
    await page.getByLabel('Business default theme', { exact: true }).selectOption('dark');
    await page.getByRole('button', { name: 'Save business settings', exact: true }).click();
    await page.getByText('Business settings saved.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(
      await page
        .getByRole('button', { name: 'Save business settings', exact: true })
        .evaluate((el) => getComputedStyle(el).color),
      'rgb(0, 0, 0)',
      'Light brand color has readable dark button text',
    );
    if (!mobile) assert.equal(await page.locator('.sidebar-business-logo').count(), 1);
    await page.reload();
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    await nav('Business Settings');
    assert.equal(await page.getByLabel('Business name', { exact: true }).inputValue(), 'Mairoba Studio');
    assert.equal(await page.getByLabel('Address', { exact: true }).inputValue(), 'Kano, Nigeria');
    assert.equal(await page.getByAltText('Business logo preview').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await page.getByRole('tab', { name: /Corrections/ }).click();
    await page.getByLabel('Recent jobs window (days)').fill('14');
    await page.getByRole('button', { name: 'Save correction settings', exact: true }).click();
    await page.getByText('Correction settings saved.', { exact: true }).waitFor();
    await page.getByRole('tab', { name: /Page access/ }).click();
    assert.equal(
      await page.getByLabel('Cashier access to Sale Adjustments', { exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await page.getByLabel('Cashier access to Business Settings', { exact: true }).isDisabled(),
      true,
    );
    // Every page is listed, and Business Settings can be given to Manager with chosen tabs.
    await page.getByLabel('Admin access to Quotations', { exact: true }).uncheck();
    await page.getByLabel('Manager access to Business Settings', { exact: true }).check();
    await page.getByLabel('Manager access to the Receipts tab', { exact: true }).uncheck();
    await page.getByLabel('Manager access to Jobs', { exact: true }).uncheck();
    assert.equal(await page.getByLabel('Cashier access to My Account', { exact: true }).isDisabled(), true);
    await page.getByLabel('Cashier access to Jobs', { exact: true }).check();
    await page.getByLabel('Admin access to Payments', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Save page access', exact: true }).click();
    await page.getByText('Page access saved.', { exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    await nav('Business Settings');
    await page.getByRole('tab', { name: /Corrections/ }).click();
    assert.equal(await page.getByLabel('Recent jobs window (days)').inputValue(), '14');
    await page.getByRole('tab', { name: /Page access/ }).click();
    assert.equal(await page.getByLabel('Cashier access to Jobs', { exact: true }).isChecked(), true);
    assert.equal(await page.getByLabel('Admin access to Payments', { exact: true }).isChecked(), false);
    assert.equal(await page.getByLabel('Manager access to Jobs', { exact: true }).isChecked(), false);
    assert.equal(await page.getByLabel('Admin access to Quotations', { exact: true }).isChecked(), false);
    assert.equal(
      await page.getByLabel('Manager access to Business Settings', { exact: true }).isChecked(),
      true,
    );
    assert.equal(
      await page.getByLabel('Manager access to the Receipts tab', { exact: true }).isChecked(),
      false,
    );
    assert.equal(
      await page.getByLabel('Manager access to the Appearance tab', { exact: true }).isChecked(),
      true,
    );
    await nav('My Account');
    await page.getByLabel('Appearance on this device', { exact: true }).selectOption('light');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    await page.reload();
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    await nav('My Account');
    assert.equal(await page.getByLabel('Appearance on this device', { exact: true }).inputValue(), 'light');
    await page.getByLabel('Appearance on this device', { exact: true }).selectOption('business');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await nav('Services');
    await page.getByRole('button', { name: 'Add service', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Service description').fill('Cap pressing');
    await dialog.getByLabel('Price (₦)').fill('45000');
    await dialog.getByRole('button', { name: 'Save service', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await nav('Point of Service');
    await page.getByRole('button', { name: 'Add job', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'New checkout' });
    await dialog.getByRole('button', { name: 'Add new customer', exact: true }).click();
    let customer = page.getByRole('dialog', { name: 'Add customer' });
    await customer.getByLabel('Full name').fill('Branding Customer');
    await customer.getByLabel('Phone number').fill('08022223333');
    await customer.getByRole('button', { name: 'Save customer', exact: true }).click();
    await customer.waitFor({ state: 'detached' });
    await dialog.getByLabel('Service', { exact: true }).selectOption({ index: 1 });
    await dialog.getByLabel('Job description').fill('Client cap');
    assert.equal(await dialog.getByLabel('Job received through').inputValue(), 'Instagram DM');
    await dialog.getByLabel('Payment method', { exact: true }).selectOption('Opay');
    await dialog.getByLabel('Money received (₦)').fill('5000');
    await dialog.getByRole('button', { name: 'Complete checkout', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    const receipt = page.getByRole('dialog');
    await receipt.getByText('Thank you from Mairoba.', { exact: true }).waitFor();
    assert.ok((await receipt.innerText()).includes('Kano, Nigeria'));
    assert.ok((await receipt.innerText()).includes('Paid now (Opay)'));
    assert.ok((await receipt.innerText()).includes('Instagram DM'));
    assert.equal(await receipt.getByAltText('Business logo', { exact: true }).count(), 1);
    assert.equal(
      await receipt.locator('.receipt-sheet').evaluate((el) => getComputedStyle(el).backgroundColor),
      'rgb(255, 255, 255)',
    );
    const waiting = page.waitForEvent('download');
    await receipt.getByRole('button', { name: 'Download PDF (A4)', exact: true }).click();
    const download = await waiting;
    const bytes = await readFile(await download.path());
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.ok(bytes.toString().includes('/Subtype /Image'), 'PDF contains the business logo');
    await receipt.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Next: Design', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Confirm next action', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Next: Approval', exact: true }).waitFor();
    await nav('Business Settings');
    await page.getByRole('tab', { name: /Dropdowns & workflow/ }).click();
    await page.getByLabel('Job stages', { exact: true }).fill('Added\nPrinting\nCompleted\nCollected');
    await page.getByRole('button', { name: 'Remove payment method 4', exact: true }).click();
    await page.getByRole('button', { name: 'Save business settings', exact: true }).click();
    await page.getByText('Business settings saved.', { exact: true }).waitFor();
    await nav('Point of Service');
    await page.getByRole('button', { name: 'Next: Approval', exact: true }).waitFor();
    await (await openMore(page)).getByRole('button', { name: 'Receipts', exact: true }).click();
    await page.getByRole('button', { name: 'Receipt', exact: true }).click();
    await page.getByRole('dialog').getByText('Paid now (Opay)', { exact: false }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await nav('Expenses');
    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Description', { exact: true }).fill('Category test');
    await dialog.getByLabel('Total cost (₦)', { exact: true }).fill('100');
    await dialog.getByLabel('Category', { exact: true }).fill('Not configured');
    await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: 'Choose a category from the list.' }).waitFor();
    await dialog.getByRole('button', { name: 'Show category options' }).click();
    await dialog.getByRole('option', { name: 'Finishing supplies', exact: true }).click();
    assert.equal(await dialog.getByLabel('Category', { exact: true }).inputValue(), 'Finishing supplies');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await nav('Materials');
    await page.getByRole('button', { name: 'Add material', exact: true }).click();
    dialog = page.getByRole('dialog');
    assert.ok(await dialog.locator('#material-units option[value="box"]').count());
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'No horizontal scrolling',
    );
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: mobile ? '/tmp/business-branding-mobile.png' : '/tmp/business-branding-desktop.png',
      fullPage: true,
    });
    await page.close();
  }
  console.log(
    'Business branding passed desktop/mobile: profile persistence, proportional logo upload, palette suggestions, contrast, business/personal themes and branded receipt/PDF, custom payment methods, dropdowns and saved job workflows.',
  );
} finally {
  await browser?.close();
  server.kill();
}
