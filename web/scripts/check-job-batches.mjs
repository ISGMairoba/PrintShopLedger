import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, webkit } from 'playwright';
const openMore = async (scope) => {
  const toggle = scope.locator('.toolbar-actions .more-menu > button').first();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await scope.locator('.more-menu-panel').first().waitFor();
  return scope;
};

const port = 4187;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Job batch check timed out');
  process.exit(1);
}, 240000).unref();
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) break;
    } catch {}
    await delay(100);
  }
  for (const mobile of [false, true]) {
    browser = await (mobile ? webkit : chromium).launch({ headless: true });
    const context = await browser.newContext(
      mobile
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
        : { viewport: { width: 1280, height: 900 } },
    );
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}`);
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    const nav = async (name) => {
      if (mobile) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
      }
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
    };
    await nav('Services');
    for (const [name, price] of [
      ['Pressing', '1000'],
      ['Binding', '2000'],
    ]) {
      await page.getByRole('button', { name: 'Add service', exact: true }).click();
      const d = page.getByRole('dialog', { name: 'Add service' });
      await d.getByLabel('Service description').fill(name);
      await d.getByLabel('Price (₦)').fill(price);
      await d.getByRole('button', { name: 'Save service', exact: true }).click();
      await d.waitFor({ state: 'detached' });
    }
    await nav('Business Settings');
    await page.getByRole('tab', { name: 'Jobs & payments' }).click();
    await page.getByLabel('Job description entry').selectOption('optional');
    await page.getByRole('button', { name: 'Save job and payment settings', exact: true }).click();
    await nav('Point of Service');
    await page.getByRole('button', { name: 'Add job', exact: true }).click();
    let d = page.getByRole('dialog', { name: 'New checkout' });
    await d.getByRole('button', { name: 'Add new customer', exact: true }).click();
    const cd = page.getByRole('dialog', { name: 'Add customer' });
    await cd.getByLabel('Full name').fill('Batch customer');
    await cd.getByLabel('Phone number').fill('08012345678');
    await cd.getByRole('button', { name: 'Save customer', exact: true }).click();
    await cd.waitFor({ state: 'detached' });
    await d
      .locator('.cart-line')
      .first()
      .getByLabel('Service', { exact: true })
      .selectOption({ label: 'Pressing — ₦1,000.00' });
    await d.getByRole('button', { name: 'Add another service', exact: true }).click();
    await d
      .locator('.cart-line')
      .nth(1)
      .getByLabel('Service', { exact: true })
      .selectOption({ label: 'Binding — ₦2,000.00' });
    await d.getByLabel('Money received (₦)').fill('0');
    await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    let receipt = page.getByRole('dialog');
    assert.match(await receipt.innerText(), /₦3,000.00/);
    await receipt.getByRole('button', { name: 'Close', exact: true }).click();
    await (await openMore(page)).getByRole('button', { name: 'Group by checkout', exact: true }).click();
    assert.equal(await page.locator('.checkout-group').count(), 1);
    const group = page.locator('.checkout-group');
    assert.match(await group.innerText(), /2 jobs shown/);
    await group.getByRole('button', { name: 'Next action', exact: true }).click();
    d = page.getByRole('dialog', { name: 'Update selected jobs' });
    assert.match(await d.innerText(), /2 will update · 0 will be skipped/);
    await d.getByRole('button', { name: 'Apply to 2 jobs', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    assert.equal(await group.getByText('Stage: In Queue', { exact: true }).count(), 2);
    await (await openMore(page)).getByRole('button', { name: 'Group by checkout', exact: true }).click();
    await (await openMore(page)).getByRole('button', { name: 'Select', exact: true }).click();
    await page.getByLabel('Select all visible jobs').check();
    const selection = page.getByRole('region', { name: 'Selection actions' });
    assert.equal(
      await selection.locator('.app-icon').count(),
      3,
      'Bulk actions reuse the three action icons',
    );
    assert.equal(
      await selection.locator('.job-bulk-actions').evaluate((node) => getComputedStyle(node).flexDirection),
      'row',
    );
    if (!mobile) {
      const boxes = await selection
        .locator('.job-bulk-actions button')
        .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
      assert.ok(
        boxes.every((top) => Math.abs(top - boxes[0]) < 2),
        'Desktop actions share one row',
      );
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      'Selection view fits',
    );
    assert.ok(
      await page
        .locator('.more-menu > button')
        .first()
        .evaluate((node) => node.closest('.job-list-toolbar') !== null),
      'View options are in the main toolbar',
    );
    await page.screenshot({ path: `/tmp/job-batches-${mobile ? 'mobile' : 'desktop'}.png` });
    await page.locator('.job-batch-toolbar').getByRole('button', { name: 'Set Action', exact: true }).click();
    d = page.getByRole('dialog', { name: 'Update selected jobs' });
    await d.getByLabel('Desired stage').selectOption('Completed');
    assert.match(await d.innerText(), /Printing → Completed/);
    await d.getByRole('button', { name: 'Apply to 2 jobs', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    assert.equal(await page.getByText('Stage: Completed', { exact: true }).count(), 2);
    // Searching must remove invisible selections, not apply an action to hidden rows.
    await page.getByLabel('Search point of service').fill('Pressing');
    await page.getByText('1 selected', { exact: true }).waitFor();
    await page.getByLabel('Search point of service').fill('');
    await page.getByText('1 selected', { exact: true }).waitFor();
    await nav('Jobs');
    await (await openMore(page)).getByRole('button', { name: 'Select', exact: true }).click();
    await page.getByLabel('Select all visible jobs').check();
    await page
      .locator('.job-batch-toolbar')
      .getByRole('button', { name: 'Next action', exact: true })
      .click();
    d = page.getByRole('dialog', { name: 'Update selected jobs' });
    assert.match(await d.innerText(), /Completed → Collected/);
    // Collecting unpaid work needs a deliberate tick.
    assert.match(
      await d.innerText(),
      /2 jobs will be marked Collected[\s\S]*2 of these still owe ₦3,000\.00/,
    );
    assert.equal(await d.getByRole('button', { name: 'Apply to 2 jobs', exact: true }).isDisabled(), true);
    await d.getByLabel('Hand over unpaid jobs anyway').check();
    await d.getByRole('button', { name: 'Apply to 2 jobs', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    assert.equal(await page.getByText('Stage: Collected', { exact: true }).count(), 2);
    await nav('Business Settings');
    await page.getByRole('tab', { name: 'Jobs & payments' }).click();
    await page.getByLabel('Job description entry').selectOption('hidden');
    await page.getByRole('button', { name: 'Save job and payment settings', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Try locally on this device', exact: true }).click();
    await page.getByRole('heading', { name: 'Point of Service', exact: true }).waitFor();
    await nav('Business Settings');
    await page.getByRole('tab', { name: 'Jobs & payments' }).click();
    assert.equal(await page.getByLabel('Job description entry').inputValue(), 'hidden');
    await nav('Point of Service');
    await page.getByRole('button', { name: 'Add job', exact: true }).click();
    d = page.getByRole('dialog', { name: 'New checkout' });
    assert.equal(await d.getByLabel('Job description', { exact: true }).count(), 0);
    await d.getByRole('button', { name: 'Close', exact: true }).click();
    await nav('Quotations');
    await page.getByRole('button', { name: 'New quotation', exact: true }).click();
    d = page.getByRole('dialog', { name: 'New quotation' });
    assert.equal(await d.getByLabel('Description', { exact: true }).count(), 0);
    await d.getByRole('combobox', { name: 'Customer', exact: true }).fill('Quote customer');
    await d.getByLabel('Service', { exact: true }).selectOption({ label: 'Pressing — ₦1,000.00' });
    await d.getByRole('button', { name: 'Save quotation', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    assert.match(await page.locator('main').innerText(), /Quote customer/);
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      'No horizontal overflow',
    );
    await browser.close();
    browser = undefined;
    console.log(`Job batches and descriptions passed ${mobile ? 'iPhone WebKit' : 'desktop Chromium'}`);
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
