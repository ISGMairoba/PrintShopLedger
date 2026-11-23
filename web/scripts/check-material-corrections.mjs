import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { useUsualSteps } from './usual-steps.mjs';
import { chromium, webkit } from 'playwright';
import { pick } from './pick.mjs';

// Correcting confirmed materials (plans/job-assignment.md): a job's materials are confirmed when it is
// marked complete; a correction then needs a reason, moves stock by the difference and is kept in the
// job's Corrections, on desktop and iPhone.

const port = 4253;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Material corrections check timed out');
  process.exit(1);
}, 300000).unref();
const fits = async (page, what) =>
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    `${what} fits the screen`,
  );
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
    const closeDialogs = async () => {
      while (await page.getByRole('dialog').count())
        await page
          .getByRole('dialog')
          .last()
          .getByRole('button', { name: 'Close', exact: true })
          .first()
          .click();
    };
    await useUsualSteps(page, nav);

    // A job that takes stock: printing on paper.
    await nav('Materials');
    await page.getByRole('button', { name: 'Add material', exact: true }).click();
    let d = page.getByRole('dialog');
    await d.getByLabel('Name', { exact: true }).fill('Paper');
    await d.getByLabel('Measurement unit', { exact: true }).fill('sheet');
    await d.getByRole('button', { name: 'Save material', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    if (mobile) {
      await page.getByRole('button', { name: 'More', exact: true }).first().click();
      await page
        .getByRole('dialog', { name: 'More actions' })
        .getByRole('button', { name: 'Add to stock', exact: true })
        .click();
    } else await page.getByRole('button', { name: 'Add to stock', exact: true }).click();
    d = page.getByRole('dialog');
    await d.getByLabel('Quantity to add').fill('50');
    await d.getByRole('button', { name: 'Add to stock', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    await nav('Services');
    await page.getByRole('button', { name: 'Add service', exact: true }).click();
    d = page.getByRole('dialog');
    await d.getByLabel('Service description').fill('Flyer printing');
    await pick(d, 'Base material', { text: 'Paper' });
    await d.getByLabel('Price (₦)').fill('100');
    await d.getByRole('button', { name: 'Save service', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    await nav('Point of Service');
    await page.getByRole('button', { name: 'Add job', exact: true }).click();
    d = page.getByRole('dialog', { name: 'New checkout' });
    await d.getByRole('button', { name: 'Add new customer', exact: true }).click();
    const cd = page.getByRole('dialog', { name: 'Add customer' });
    await cd.getByLabel('Full name').fill('Material customer');
    await cd.getByLabel('Phone number').fill('08012345670');
    await cd.getByRole('button', { name: 'Save customer', exact: true }).click();
    await cd.waitFor({ state: 'detached' });
    const line = d.locator('.cart-line').first();
    await pick(line, 'Service', { text: 'Flyer printing' });
    await line.getByLabel('Quantity', { exact: true }).fill('10');
    await line.getByLabel('Job description').fill('Ten flyers');
    await d.getByLabel('Money received (₦)').fill('0');
    await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
    await d.waitFor({ state: 'detached', timeout: 8000 }).catch(async () => {
      throw Error(`Checkout did not finish: ${await d.locator('[role=alert], .notice').allInnerTexts()}`);
    });
    await closeDialogs();

    // Marking it complete confirms the film used.
    await nav('Jobs');
    await page.getByRole('button', { name: 'Flyer printing', exact: true }).first().click();
    const job = page.getByRole('dialog').last();
    await job.getByRole('button', { name: 'Mark as Complete', exact: true }).click();
    d = page.getByRole('dialog', { name: /^Move job to/ });
    await d.getByRole('button', { name: 'Mark as Complete', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    await job
      .getByText(/^Confirmed by/)
      .first()
      .waitFor();

    // A correction needs a reason; it is saved at once for the demo's owner, and kept.
    await job.getByRole('button', { name: 'Correct materials used', exact: true }).click();
    d = page.getByRole('dialog', { name: 'Correct materials used' });
    const amount = d.getByLabel(/: amount used$/).first();
    await amount.fill(String(Number(await amount.inputValue()) + 2));
    await d.getByText(/^Saved at once/).waitFor();
    await fits(page, 'Correct materials used');
    await page.screenshot({ path: `/tmp/material-correct-${mobile ? 'mobile' : 'desktop'}.png` });
    await d.getByRole('button', { name: 'Save correction', exact: true }).click();
    assert.equal(await d.isVisible(), true, 'No reason: the dialog stays open');
    await d.getByLabel('Why').fill('Two sheets spoiled and reprinted');
    await d.getByRole('button', { name: 'Save correction', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    await job.getByText('Corrections (1)').click();
    await job
      .getByText(/Two sheets spoiled and reprinted/)
      .first()
      .waitFor();
    await closeDialogs();
    assert.deepEqual(errors, []);
    await browser.close();
    browser = undefined;
    console.log(`Material corrections passed ${mobile ? 'iPhone WebKit' : 'desktop Chromium'}`);
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
