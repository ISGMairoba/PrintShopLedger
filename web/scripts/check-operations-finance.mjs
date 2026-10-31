import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { readCopy } from './local-copy.mjs';
import { pick } from './pick.mjs';
const port = 4196,
  base = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
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
    const context = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
        serviceWorkers: 'block',
      }),
      page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    const nav = async (name) => {
      if (mobile) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
      }
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
    };
    const dialog = () => page.getByRole('dialog'),
      save = async (name) => {
        const d = dialog();
        await d.getByRole('button', { name, exact: true }).click();
        await d.waitFor({ state: 'detached' });
      };
    await nav('Payees');
    await page.getByRole('button', { name: 'Add payee', exact: true }).click();
    await dialog().getByLabel('Payee name', { exact: true }).fill('Paper House');
    await dialog().getByLabel('Phone', { exact: true }).fill('08012345678');
    await save('Save payee');
    await nav('Accounts');
    for (const [name, balance, type, method] of [
      ['Main Bank', '1000', 'Bank', 'Transfer'],
      ['Till', '100', 'Cash', 'Cash'],
    ]) {
      await page.getByRole('button', { name: 'Add account', exact: true }).click();
      const d = dialog();
      await d.getByLabel('Account name', { exact: true }).fill(name);
      await d.getByLabel('Account type', { exact: true }).selectOption({ label: type });
      await d.getByLabel('Opening date', { exact: true }).fill('2026-10-01');
      await d.getByLabel('Opening balance (₦)', { exact: true }).fill(balance);
      await d.getByLabel(method, { exact: true }).check();
      await save('Save account');
    }
    await page.getByRole('button', { name: 'Transfer', exact: true }).click();
    await dialog().getByLabel('Source account').selectOption({ label: 'Main Bank' });
    await dialog().getByLabel('Destination account').selectOption({ label: 'Till' });
    await dialog().getByLabel('Amount (₦)', { exact: true }).fill('200');
    await dialog().getByLabel('Account entry reason').fill('Cash withdrawal');
    await save('Save transfer');
    await nav('Expenses');
    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    await dialog().getByLabel('Description', { exact: true }).fill('Paper purchase');
    await dialog().getByLabel('Total cost (₦)').fill('50');
    await pick(dialog(), 'Expense payee', { label: 'Paper House' });
    await dialog().getByLabel('Payment method', { exact: true }).selectOption({ label: 'Transfer' });
    assert.equal(
      await dialog().getByLabel('Pay from account').locator('option:checked').innerText(),
      'Main Bank',
    );
    await save('Save expense');
    let state = await readCopy(page, 'local-trial');
    assert.equal(state.ledger.expenses[0].payeeId, state.ledger.payees[0].id);
    assert.equal(
      state.ledger.expenses[0].payments[0].accountId,
      state.ledger.moneyAccounts.find((a) => a.name === 'Main Bank').id,
    );
    await nav('Payees');
    await page.getByRole('button', { name: 'Transactions', exact: true }).click();
    await dialog().getByText('Paper purchase', { exact: false }).waitFor();
    await dialog().getByRole('button', { name: 'Close', exact: true }).click();
    await nav('Accounts');
    await page
      .getByRole('row')
      .filter({ hasText: 'Main Bank' })
      .first()
      .getByRole('button', { name: 'Reconcile', exact: true })
      .click();
    await dialog().getByLabel('Actual balance (₦)').fill('740');
    await dialog().getByLabel('Account entry reason').fill('Verified against bank statement');
    await save('Save reconciliation');
    state = await readCopy(page, 'local-trial');
    assert.equal(state.ledger.accountEntries.filter((e) => e.action === 'reconciliation')[0].amount, -1000);
    const at = new Date().toISOString(),
      due = new Date(Date.now() + 2 * 86400000).toISOString();
    state.ledger.customers.push({
      id: 'deadline-customer',
      name: 'Deadline customer',
      phone: '0801',
      address: '',
      creditLimit: 0,
      archived: false,
      version: 1,
    });
    state.ledger.jobs.push({
      id: 'deadline-job',
      customerId: 'deadline-customer',
      service: 'Printing',
      description: 'Countdown example',
      quantity: 1,
      amount: 10000,
      createdAt: at,
      dueAt: due,
      productionStatus: 'Added',
      version: 1,
    });
    await page.route('**/__test_seed__', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body>Fixture setup</body></html>' }),
    );
    await page.goto(base + '/__test_seed__');
    await page.evaluate(
      (state) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('printshopledger-v1', 1);
          open.onsuccess = () => {
            const db = open.result,
              tx = db.transaction('ledgers', 'readwrite'),
              store = tx.objectStore('ledgers'),
              keys = store.getAllKeys();
            keys.onsuccess = () => {
              for (const k of keys.result) if (String(k).startsWith('local-trial|')) store.delete(k);
              store.put(state, 'local-trial');
            };
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      state,
    );
    await page.goto(base);
    const trial = page.getByRole('button', { name: 'Try locally on this device' });
    await trial.or(page.getByRole('heading', { name: 'Point of Service', exact: true })).waitFor();
    if (await trial.isVisible()) await trial.click();
    await nav('Jobs');
    if (mobile) await page.getByRole('button', { name: 'More', exact: true }).first().click();
    await page.getByRole('button', { name: 'Change due date', exact: true }).first().click();
    await dialog().getByRole('button', { name: 'Postpone 2 days', exact: true }).click();
    await dialog().getByLabel('Reason for due date change').fill('Customer requested later collection');
    await save('Save due date');
    state = await readCopy(page, 'local-trial');
    assert.equal(state.ledger.jobs.find((j) => j.id === 'deadline-job').dueHistory.length, 1);
    assert.ok(Date.parse(state.ledger.jobs.find((j) => j.id === 'deadline-job').dueAt) > Date.parse(due));
    assert.ok(await page.getByLabel('Deadline countdown').count());
    await nav('Dashboard');
    await page.getByLabel('Trend interval').selectOption('daily');
    await page.getByRole('button', { name: 'Hide Expenses incurred', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Hide Expenses paid', exact: true }).waitFor();
    if (mobile)
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'Mobile page stays within viewport',
      );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Operations finance ${mobile ? 'mobile' : 'desktop'} passed`);
  }
} finally {
  await browser?.close();
  server.kill();
}
