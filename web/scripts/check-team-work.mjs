import { settingsSection } from './settings-navigation.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { useUsualSteps } from './usual-steps.mjs';
import { chromium, webkit } from 'playwright';
import { pick } from './pick.mjs';

// Team work (plans/job-assignment.md): switching it on, adding a Team person, assigning a job,
// "Done by" with Done at when the job moves on, and confirming the work, on desktop and iPhone.

const port = 4251;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Team work check timed out');
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

    // Off by default: no Team tab. The General Manager switches it on.
    await nav('Users');
    assert.equal(
      await page.getByRole('tab', { name: 'Team', exact: true }).count(),
      0,
      'No Team tab while off',
    );
    await nav('Business Settings');
    await settingsSection(page, 'Jobs & payments');
    const track = page.getByLabel('Track team work', { exact: true });
    assert.equal(await track.isChecked(), false, 'Team work is off by default');
    await page.getByLabel('Job description entry').selectOption('optional');
    await track.check();
    assert.equal(await page.getByLabel('Ask "Done by" on every stage move').isChecked(), true);
    assert.equal(await page.getByLabel('Who confirms work').inputValue(), '2');
    await page.getByRole('button', { name: 'Save job and payment settings', exact: true }).click();
    await page.getByText('Job and payment settings saved.', { exact: true }).waitFor();

    // A Team person added by name.
    await nav('Users');
    await page.getByRole('tab', { name: 'Team', exact: true }).click();
    await page.getByRole('button', { name: 'Add person', exact: true }).click();
    let d = page.getByRole('dialog', { name: 'Add a Team person' });
    await d.getByLabel('Name').fill('Ada Finisher');
    await d.getByLabel('Role (optional)').fill('Finisher');
    await fits(page, 'Add a Team person');
    await page.screenshot({ path: `/tmp/team-person-${mobile ? 'mobile' : 'desktop'}.png` });
    await d.getByRole('button', { name: 'Save person', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    await page.getByText('Ada Finisher', { exact: true }).first().waitFor();

    // A job to work on.
    await nav('Services');
    await page.getByRole('button', { name: 'Add service', exact: true }).click();
    d = page.getByRole('dialog', { name: 'Add service' });
    await d.getByLabel('Service description').fill('Laminating');
    await d.getByLabel('Price (₦)').fill('1000');
    await d.getByRole('button', { name: 'Save service', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    await nav('Point of Service');
    await page.getByRole('button', { name: 'Add job', exact: true }).click();
    d = page.getByRole('dialog', { name: 'New checkout' });
    await d.getByRole('button', { name: 'Add new customer', exact: true }).click();
    const cd = page.getByRole('dialog', { name: 'Add customer' });
    await cd.getByLabel('Full name').fill('Team customer');
    await cd.getByLabel('Phone number').fill('08012345679');
    await cd.getByRole('button', { name: 'Save customer', exact: true }).click();
    await cd.waitFor({ state: 'detached' });
    await pick(d.locator('.cart-line').first(), 'Service', { label: 'Laminating — ₦1,000.00' });
    await d.getByLabel('Money received (₦)').fill('0');
    await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
    await d.waitFor({ state: 'detached', timeout: 8000 }).catch(async () => {
      throw Error(`Checkout did not finish: ${(await d.innerText()).slice(0, 600)}`);
    });
    await closeDialogs();

    // Assign the whole job to Ada (from the job's details).
    await nav('Jobs');
    await page.getByRole('button', { name: 'Laminating', exact: true }).first().click();
    const details = page.getByRole('dialog').last();
    await details.getByRole('button', { name: 'Assign', exact: true }).click();
    d = page.getByRole('dialog', { name: 'Assign job' });
    await d.getByLabel('Assign Ada Finisher').check();
    await fits(page, 'Assign job');
    await d.getByRole('button', { name: 'Save assignment', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    await details.getByText('Ada Finisher').first().waitFor();

    // Marking it complete asks who did the work, pre-filled with Ada.
    await details.getByRole('button', { name: 'Mark as Complete', exact: true }).click();
    d = page.getByRole('dialog').last();
    assert.equal(await d.getByLabel('Done by Ada Finisher').isChecked(), true, 'Assignee pre-filled');
    await d.getByLabel('Done by Local trial user').check();
    await d.getByLabel('Shares').selectOption('percent');
    await d.getByLabel('Share for Ada Finisher').fill('70');
    await d.getByLabel('Share for Local trial user').fill('20');
    await fits(page, 'Done by');
    await page.screenshot({ path: `/tmp/team-done-by-${mobile ? 'mobile' : 'desktop'}.png` });
    await d.getByRole('button', { name: 'Mark as Complete', exact: true }).click();
    await d.getByText('The shares must add up to 100%.').waitFor();
    await d.getByLabel('Share for Local trial user').fill('30');
    await d.getByRole('button', { name: 'Mark as Complete', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    await closeDialogs();

    // The work waits to be confirmed; it is credited to the trial user too, but no one else confirms.
    await nav('Users');
    await page.getByRole('tab', { name: /^Work to confirm/ }).click();
    await page.getByText('Ada Finisher 70%, Local trial user 30%').first().waitFor();
    await page.getByRole('button', { name: /^Select all you can confirm/ }).click();
    await page.getByRole('button', { name: /^Confirm selected/ }).click();
    await page.getByText('No work is waiting to be confirmed.', { exact: true }).waitFor();
    await fits(page, 'Work to confirm');

    // A correction (the trial user is cleared: saved at once, with the reason).
    await nav('Jobs');
    await page.getByRole('button', { name: 'Laminating', exact: true }).first().click();
    const job = page.getByRole('dialog').last();
    await job.getByText(/^Work records/).click();
    await job.getByRole('button', { name: 'Correct', exact: true }).first().click();
    d = page.getByRole('dialog', { name: /^Correct work/ });
    await d.getByLabel('Share for Ada Finisher').fill('80');
    await d.getByLabel('Share for Local trial user').fill('20');
    await d.getByLabel('Reason for the correction').fill('Ada did most of it');
    await fits(page, 'Correct work');
    await d.getByRole('button', { name: 'Save correction', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    await job.getByText('Ada Finisher 80%, Local trial user 20%').first().waitFor();
    await job
      .getByText(/Corrected 1×/)
      .first()
      .waitFor();
    await closeDialogs();
    assert.deepEqual(errors, []);
    await browser.close();
    browser = undefined;
    console.log(`Team work passed ${mobile ? 'iPhone WebKit' : 'desktop Chromium'}`);
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
