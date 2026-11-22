import { settingsSection } from './settings-navigation.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { useUsualSteps } from './usual-steps.mjs';
import { chromium, webkit } from 'playwright';
import { pick } from './pick.mjs';

// Holding a job: "Hold and extend deadline", the held message, and resuming.

const port = 4250;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Job hold check timed out');
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
    await page.getByRole('button', { name: 'Explore demo' }).click();
    const nav = async (name) => {
      if (mobile) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
      }
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
    };
    await useUsualSteps(page, nav);
    await nav('Services');
    await page.getByRole('button', { name: 'Add service', exact: true }).click();
    let d = page.getByRole('dialog', { name: 'Add service' });
    await d.getByLabel('Service description').fill('Pressing');
    await d.getByLabel('Price (₦)').fill('1000');
    await d.getByRole('button', { name: 'Save service', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    // New jobs are due three days after they are added.
    await nav('Business Settings');
    await settingsSection(page, 'Jobs & payments');
    await page.getByLabel('Job description entry').selectOption('optional');
    await page.getByLabel('Duration', { exact: true }).fill('3');
    await page.getByRole('button', { name: 'Save job and payment settings', exact: true }).click();
    await nav('Point of Service');
    await page.getByRole('button', { name: 'Add job', exact: true }).click();
    d = page.getByRole('dialog', { name: 'New checkout' });
    await d.getByRole('button', { name: 'Add new customer', exact: true }).click();
    const cd = page.getByRole('dialog', { name: 'Add customer' });
    await cd.getByLabel('Full name').fill('Hold customer');
    await cd.getByLabel('Phone number').fill('08012345678');
    await cd.getByRole('button', { name: 'Save customer', exact: true }).click();
    await cd.waitFor({ state: 'detached' });
    await pick(d.locator('.cart-line').first(), 'Service', { label: 'Pressing — ₦1,000.00' });
    await d.getByLabel('Money received (₦)').fill('0');
    await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
    await d.waitFor({ state: 'detached', timeout: 8000 }).catch(async () => {
      throw Error(`Checkout did not finish: ${(await d.innerText()).slice(0, 600)}`);
    });
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();

    await nav('Jobs');
    let hold = page.getByRole('button', { name: 'Put on hold', exact: true }).first();
    if (!(await hold.isVisible())) {
      // The row's actions may sit in the job's details.
      await page.getByRole('button', { name: 'Pressing', exact: true }).first().click();
      hold = page.getByRole('dialog').last().getByRole('button', { name: 'Put on hold', exact: true });
    }
    await hold.click();
    d = page.getByRole('dialog', { name: 'Put job on hold' });
    const extend = d.getByLabel('Extend the deadline');
    // Waits on the customer extend the deadline by default; waits on the shop do not.
    await d.getByLabel('Hold reason').selectOption('Waiting for materials');
    assert.equal(await extend.isChecked(), false);
    await d.getByRole('button', { name: 'Put on hold', exact: true }).waitFor();
    await d.getByLabel('Hold reason').selectOption('Waiting for design approval');
    assert.equal(await extend.isChecked(), true);
    assert.match(await d.innerText(), /Now due .*\. It moves when you resume the job\./);
    await page.screenshot({ path: `/tmp/job-hold-${mobile ? 'mobile' : 'desktop'}.png` });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      'Hold dialog fits',
    );
    await d.getByRole('button', { name: 'Hold and extend deadline', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    await page
      .getByText(/On hold: Waiting for design approval · deadline extends/)
      .first()
      .waitFor();
    // The customer can be told it is on hold.
    assert.ok(
      (await page.getByTitle('Send the customer a message that their job is on hold').count()) > 0,
      'Tell customer offers the held message',
    );
    await page.getByRole('button', { name: 'Resume', exact: true }).first().click();
    await page
      .getByText(/deadline extends/)
      .first()
      .waitFor({ state: 'detached' });
    // On a phone the actions are in the job's details: close it before using the menu.
    while (await page.getByRole('dialog').count()) {
      await page
        .getByRole('dialog')
        .last()
        .getByRole('button', { name: 'Close', exact: true })
        .first()
        .click();
    }
    await nav('Business Settings');
    await settingsSection(page, 'Messages');
    assert.match(await page.locator('main').innerText(), /Order on hold/);
    assert.deepEqual(errors, []);
    await browser.close();
    browser = undefined;
    console.log(`Job hold passed ${mobile ? 'iPhone WebKit' : 'desktop Chromium'}`);
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
